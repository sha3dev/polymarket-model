# Static Code & Design Review of polymarket-model for the Dual-Model Polymarket Microstructure Strategy

## Executive summary

The repository **largely implements** the dual-model strategy as specified: **(i)** per-asset *trend* models keyed by asset only (window-agnostic) forecasting **30s-ahead RTDS Chainlink log-return**, **(ii)** per-asset-window *CLOB* models forecasting **30s-ahead UP midpoint** (with an auxiliary direction head), and **(iii)** a **cost-aware fusion layer** that produces trade gating (`shouldTrade`), side suggestion, and detailed veto/reason diagnostics every time `/predict` is called. citeturn41view0turn45view0turn19view1

The biggest correctness/completeness constraints are not the modeling logic, but **production hardening** and **strategy boundary clarity**:
- The Node service **does not include order execution** (signing, order placement, risk management). It produces a decision payload; a separate trading service must consume it. citeturn42view0turn45view0
- Remote TensorFlow execution is delegated to a **separate “tensorflow-api” service** over HTTP; that Python/TensorFlow backend is **not present** here, so its training loop, checkpointing, and runtime safety cannot be statically audited from this repo. citeturn41view0turn32view0
- Reliability gaps: **no retries/backoff** on remote inference/training calls, and fee-rate fetch has **no explicit timeout/retry**. citeturn33view0turn17view0
- Deployment gaps: **no Dockerfile** in-repo; process management exists via PM2 config, but containerization and rollout patterns are “unspecified”. citeturn41view0turn42view0

A key positive architectural change (relevant to your earlier dilation question): the repo keeps a legacy/local TFJS TCN builder with a comment that **tfjs-node can’t backprop Conv1D dilation gradients**, but the *actual runtime path* uses the remote Python/TensorFlow “tensorflow-api”, whose generated Keras model definition uses **true causal dilated Conv1D** blocks. citeturn23view0turn35view0turn41view0

## Repo audit

The repo is a long-running Node service that owns: snapshot ingestion, feature engineering, walk-forward orchestration, fusion, and the public HTTP API, while delegating TensorFlow training/inference to a remote `tensorflow-api`. citeturn41view0turn42view0

### Key modules to inspect and initial red flags

| Area | Files / modules | Purpose | Immediate flags / notes |
|---|---|---|---|
| Entry points | `src/main.ts`, `src/index.ts` | Boot service + export package entrypoints | Not reviewed line-by-line here; module structure indicates typical Node service layout. citeturn42view0 |
| Runtime orchestration | `src/model/model-runtime.service.ts` | Start/stop, training cycle scheduler, remote registry restore, predict endpoint core | Training timer uses `setInterval(async () => …)`; errors should be guarded to avoid unhandled rejections. Artifact registry is simple `Map.set` (atomic enough in JS), but no multi-version retention despite `MODEL_ARTIFACT_RETENTION`. citeturn45view0turn43view0 |
| Feature engineering | `src/model/model-context.service.ts`, `src/model/model-feature.service.ts`, `src/model/model-signal-cache.service.ts` | Parse snapshots to contexts; build trend/clob sequences and targets; cached derived signals | Feature dictionaries are explicit and short (≤50-ish). However, cross-asset leader/follower weighting rules should be verified in signal-cache (not fully inspected here). citeturn15view0turn13view2turn40view5 |
| Training/inference orchestration | `src/model/model-training.service.ts`, `src/model/model-preprocessing.service.ts` | Walk-forward fold building with embargo; robust scaling; call remote training & predict | Strong: embargo + overlap purge exists. Risk: sends full training arrays to remote each cycle; can be heavy. No retry/backoff for polling failures. citeturn36view2turn38view1turn39view4 |
| Remote TF integration | `src/tensorflow-api/*` | HTTP client + Keras definition JSON | Client has timeout via `AbortController` but **no retries/backoff**. Auth token is env-based (good), but must be treated as a secret. citeturn33view0turn33view1 |
| Fusion/cost model | `src/model/model-cost.service.ts` | fee-rate fetch, slippage/spread buffers, time-weighted score, veto logic | Implements fee curve consistent with Polymarket docs; but fee-rate fetch lacks retry/timeout. citeturn19view0turn20search0turn20search1 |
| Tests | `test/*.test.ts` | Unit/integration-ish tests for core modules | Test coverage exists across key services, including training and TF API client. No CI workflow file was seen at repo root. citeturn44view0turn41view0 |
| Deployment | `ecosystem.config.cjs` | PM2 process config | No Dockerfile; rollout/rollback patterns unspecified. citeturn41view0turn42view0 |
| Order execution | (none in `src/`) | Place/cancel orders, signing, risk | Not present. This repo outputs `shouldTrade` + diagnostics, but does not execute trades. citeturn42view0turn45view0 |

## Correctness checks vs the dual-model spec

### Strategy conformance matrix

| Spec item | Expected | Observed status | Code locations |
|---|---|---|---|
| Crypto trend models decoupled from windows | One model per asset (`btc`, `eth`, `sol`, `xrp`) forecasting 30s log-return of RTDS Chainlink | **Correct**: trend registry keyed by asset; training loop trains trend per-asset; predict uses `trendArtifactRegistry.get(request.asset)` | `ModelRuntimeService.runTrainingCycle` trains per asset (≈L2410–L2427) and stores via `replaceTrendArtifact(asset, artifact)` (≈L2229–L2238). `predict()` fetches `trendArtifact` by asset (≈L2502–L2515). citeturn45view0 |
| CLOB models per asset-window | One model per `{asset}_{window}` forecasting UP mid (and Δmid/direction head) | **Correct**: CLOB registry keyed by `asset_window`; training loops by asset and window; predict loads clob artifact by modelKey | `runTrainingCycle` trains per modelKey (≈L2430–L2453). `predict()` uses `clobArtifactRegistry.get(modelKey)`. citeturn45view0 |
| Targets (trend and CLOB) | Trend: 30s-ahead return target; CLOB: 30s-ahead UP mid / Δmid | **Mostly correct** at service contract level: README & payload fields match; CLOB training uses `logit_probability` encoding for regression head | Public payload includes `trend.predictedReturn` and `clob.predictedUpMid`. citeturn45view0turn41view0turn39view4 |
| Feature dictionaries CT/CB | Explicit ≤50 features per tower; stable ordering | **Correct**: `TREND_FEATURE_NAMES` and `CLOB_FEATURE_NAMES` are explicit; sequence lengths are fixed per asset/window | Feature lists and sequence lengths defined in `ModelFeatureService` (≈L1765–L1893). citeturn13view2turn40view1 |
| Staleness gating | Drop/veto decisions if Chainlink or orderbook stale | **Correct**: `isChainlinkFresh` and `isOrderBookFresh` exist; fusion adds global veto on staleness | Context service freshness checks (≈L2083–L2096). Fusion vetoes `chainlink_stale` / `order_book_stale` (≈L1598–L1612). citeturn15view0turn19view1 |
| Walk-forward validation with purge/embargo | Avoid leakage from horizon/lookback overlap | **Correct**: fold builder filters out training samples whose span overlaps validation ± embargo | Trend fold logic (≈L1870–L1899) with embargo and overlap test. citeturn36view2turn39view0 |
| Continuous training | Ongoing retraining, safe scheduling | **Partial**: retraining is scheduled (default daily) and configurable; not truly “online incremental” | Training timer set to `MODEL_TRAINING_INTERVAL_MS` (default 86,400,000ms) and horizon/decision interval are 30s. citeturn45view0turn43view0 |
| Fusion logic (cost-aware) | fair prob from trend; combine with CLOB; subtract fees/slippage/spread; veto rules | **Correct**: builds fair probability via approx normal CDF; computes execution prices from asks, estimates fee using Polymarket fee curve; time-weighted score; vetoes | `buildTrendFairProbability`, `buildEstimatedFee`, `buildTimeWeight`, and veto rules in `buildFusionPayload`. citeturn19view0turn18view0turn19view1turn20search0turn20search1 |
| Decision output schema & order params | Return what a trader needs to decide | **Partial**: payload is rich (`scoreUp/Down`, `shouldTrade`, vetoes, fees) but **no order placement** or portfolio sizing in this repo | `buildPredictionPayload` returns `trend`, `clob`, and `fusion` objects (≈L2278–L2326). `fusion` includes `shouldTrade` and `suggestedSide`. citeturn45view0turn18view4 |

### Notes on “Chainlink = RTDS Chainlink data”
Your clarification (“Chainlink is what Polymarket RTDS provides, updates every second”) matches the Polymarket RTDS doc: `crypto_prices_chainlink` messages contain `timestamp` (ms) and `value` (price). citeturn21view0

## Security, reliability, and performance review

### Remote TensorFlow API calls: timeouts exist, retries do not
`TensorflowApiClientService.requestJson()` uses `AbortController` and a configured `requestTimeoutMs`, but does **not** retry on transient network errors or 5xx responses. citeturn33view0turn33view1  
Impact: a single transient outage can (a) break training cycles, (b) break predict, and (c) cause model registry restore to fail at startup. citeturn45view0turn38view0

### Fee-rate fetch is correct but not hardened
The fusion layer correctly calls Polymarket’s `/fee-rate` endpoint and expects `{ base_fee }` (bps). citeturn17view0turn20search1  
The fee computation matches Polymarket’s fee curve formula and exponent=2 for crypto markets. citeturn19view0turn20search0  
But `readFeeRateBps()` does not apply explicit timeouts/retries and caches failures as `null` (“trade vetoed”), which may create avoidable downtime during transient errors. citeturn17view0turn19view1

### Hot-swap / atomicity
Within this repo, swapping to a new model artifact is “atomic enough” because `Map.set()` replaces the reference in one step. citeturn45view0  
However:
- There is no explicit version pinning per request (requests might get mixed versions across trend/clob in rare interleavings).
- `MODEL_ARTIFACT_RETENTION` exists but is not used by the in-memory registries (appears “unspecified”/unused). citeturn43view0turn45view0  
If you need strict atomic pair swaps (trend+clob consistent), you should introduce a “bundle version” object and swap that reference once.

### Order execution security
No signing keys or trading credentials appear in the module tree; so classic risks (private key leakage, nonce handling, replay, etc.) are out of scope here. citeturn42view0  
The most relevant secret in this repo is `TENSORFLOW_API_AUTH_TOKEN` (Bearer token) used for remote model service auth. citeturn33view0turn33view1

## Testing, observability, deployment

### Tests present, but CI is unspecified
The `test/` folder includes targeted tests across collector client, HTTP server, fusion/cost, feature extraction, preprocessing, runtime state, runtime, training, and TF API client. citeturn44view0turn41view0  
I did not see a GitHub Actions workflow in the root file list (so CI is “unspecified”). citeturn41view0

### Observability gaps
Logging exists (via `logger` imports), and prediction payload contains diagnostics (`vetoes`, `reasons`, scores). citeturn45view0turn19view1  
Missing: Prometheus metrics / structured event telemetry. Recommended minimal metrics:
- `polymarket_model_predict_latency_ms{asset,window}`
- `polymarket_model_training_cycle_duration_ms`
- `polymarket_model_tensorflow_api_errors_total{endpoint,status}`
- `polymarket_model_fee_rate_fetch_fail_total`
- `polymarket_model_veto_total{reason}`

### Deployment & checkpointing expectations
The Node service persists a runtime cursor (`lastTrainingCycleAt`, `lastTrainedSnapshotAt`) and restores remote registries on start (reads remote model records). citeturn45view0turn41view0  
However, the on-disk model checkpointing is primarily a responsibility of the **remote** TensorFlow service. For Python/TensorFlow, official guidance supports saving either Keras `.keras` files or SavedModel directories and restoring with `tf.keras.models.load_model`. citeturn46search0turn46search2turn46search16

Example (remote service side) save/load commands:
```python
# Save (Keras / SavedModel)
model.save("/models/polymarket-model.clob.btc_5m/2026-03-20T12-00-00Z")

# Load
model = tf.keras.models.load_model("/models/polymarket-model.clob.btc_5m/2026-03-20T12-00-00Z")
```
citeturn46search0turn46search2

Atomic swap pattern (remote service): write to a versioned directory, then update a `current` symlink or a small metadata pointer file (apply filesystem atomic rename on the pointer).

## Prioritized action list and code patches

### Critical (fix next)
**Add retries/backoff to remote TensorFlow API calls (S/M).**  
Reason: a single transient error breaks training/predict. Currently: timeout but no retries. citeturn33view0turn45view0  

**Harden fee-rate fetch with timeout+retries (S).**  
Reason: `fee_rate_unavailable_*` veto can unnecessarily disable trading. citeturn17view0turn19view1  

### Major (fix soon)
**Wrap `setInterval(async …)` with a top-level try/catch (S).**  
Reason: avoid unhandled rejections in timer callback. Training already catches internally, but outer safety is cheap. citeturn45view0  

**Make model pairing swap explicit (M).**  
Reason: if you ever require trend+clob version consistency, introduce a “bundle swap” object; current approach swaps independently. citeturn45view0  

### Medium / Low
**Document and centralize cross-asset leader/follower mapping (M).**  
Trend features include `leader_ret_*`, `btc_shock`, `eth_shock`; the mapping rules should be explicit and unit-tested. citeturn40view1turn13view2  

**Add Prometheus metrics endpoint (M).**  
Improve ops visibility; tests already exist to support refactors. citeturn44view0  

### Minimal patches (ready-to-apply snippets)

#### Patch: retry/backoff in `TensorflowApiClientService.requestJson`
Add a small retry loop for 429/5xx + network errors. Keep signature unchanged.

```ts
// inside TensorflowApiClientService
private async requestJson<TResponse>(
  pathname: string,
  method: "GET" | "PATCH" | "POST",
  payload?: unknown,
): Promise<TResponse> {
  const maxAttempts = 4;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.requestTimeoutMs);

    try {
      const requestInit: RequestInit = {
        headers: this.buildHeaders(),
        method,
        signal: abortController.signal,
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      };

      const response = await this.fetcher(`${this.baseUrl}${pathname}`, requestInit);

      // Retry on rate-limit or transient server errors
      if (!response.ok) {
        const body = await response.text();
        const status = response.status;
        if ((status === 429 || status >= 500) && attempt < maxAttempts) {
          const backoffMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw new Error(`tensorflow-api request failed path=${pathname} status=${status} body=${body}`);
      }

      return (await response.json()) as TResponse;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) throw err;
      const backoffMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("tensorflow-api request failed");
}
```
Rationale: preserves existing behavior for hard failures while making training/predict robust to transient events. citeturn33view0turn33view1  

#### Patch: timeout+retry wrapper for Polymarket fee-rate fetch
Since `/fee-rate` is critical to the cost model, use an AbortController and retry on transient errors.

```ts
// helper (module-local)
async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
}

// in ModelCostService.readFeeRateBps
const url = this.buildFeeRateUrl(tokenId);
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const response = await fetchJsonWithTimeout(url, 1500);
    if (response.ok) {
      const payload = (await response.json()) as { base_fee?: number };
      feeRateBps = typeof payload.base_fee === "number" ? payload.base_fee : null;
      this.setCachedFeeRate(tokenId, feeRateBps);
      break;
    }
  } catch {
    // swallow and retry
  }
  if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
}
```

This keeps the existing “veto on null” behavior but reduces false vetoes from transient timeouts. citeturn17view0turn20search1  

## Mermaid diagrams

### Data flow and decision path
```mermaid
flowchart TD
  A[Snapshot Collector] -->|historical snapshots| B(ModelRuntimeService.runTrainingCycle)
  C[Live Snapshot Store] -->|live snapshots| B
  B --> D[ModelFeatureService: buildTrendTrainingSamples/buildClobTrainingSamples]
  D --> E[ModelTrainingService.trainTrend (per-asset)]
  D --> F[ModelTrainingService.trainClob (per-asset-window)]
  E --> G[(Remote tensorflow-api: Keras/TensorFlow)]
  F --> G
  H[POST /predict asset,window] --> I[ModelFeatureService.buildPredictionInput]
  I --> J[ModelTrainingService.predictTrend]
  I --> K[ModelTrainingService.predictClob]
  J --> G
  K --> G
  J --> L[ModelCostService.buildFusionPayload]
  K --> L
  L --> M[ModelPredictionPayload: shouldTrade + suggestedSide + vetoes]
```

### Remote model “hot swap” concept
```mermaid
sequenceDiagram
  participant Node as Node model service
  participant TF as Remote tensorflow-api
  Node->>TF: queueTrainingJob(modelId, data)
  loop poll
    Node->>TF: readJob(jobId)
    TF-->>Node: status=running|succeeded
  end
  Node->>TF: updateModelMetadata(modelId, metrics, scalers)
  TF-->>Node: modelRecord(version, metadata)
  Node->>Node: trendArtifactRegistry.set(asset, newArtifact)
  Node->>Node: clobArtifactRegistry.set(asset_window, newArtifact)
  Note over Node: swap is ref-atomic per Map.set; <br/>bundle-atomic swap requires a wrapper object
```

## Security checklist

- Secrets: keep `TENSORFLOW_API_AUTH_TOKEN` in env-only; never log it; scope it least-privilege. citeturn33view0turn33view1  
- Dependencies: run `npm audit` and pin lockfile updates; no Python deps are present in this repo (remote service is external/unspecified). citeturn41view0turn42view0  
- Network: add retries/backoff + timeouts; monitor error rates and add circuit-breaker behavior for remote TF outages. citeturn33view0turn45view0  
- Trading keys: not in this repo; if added later, enforce HSM/keystore usage and strict separation between “decision service” and “execution service”. citeturn42view0