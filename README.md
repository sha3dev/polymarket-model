# @sha3/polymarket-model

Long-running Node service that watches crypto prices and Polymarket order books, trains short-horizon models through a remote `tensorflow-api`, and exposes a simple HTTP API plus an operator dashboard.

## TL;DR

```bash
npm install
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Open the dashboard:

```bash
open http://127.0.0.1:3000/dashboard
```

Request a prediction directly:

```bash
curl -X POST http://127.0.0.1:3000/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

## Why

Polymarket prices move for at least two different reasons:

- the underlying crypto price is moving;
- the Polymarket order book itself is moving because traders are adding, cancelling, or lifting orders.

This service tries to estimate whether a market price looks attractive right now.

In plain language:

- it watches live crypto prices from Chainlink and exchange books;
- it watches live Polymarket books for UP and DOWN tokens;
- it trains one model that asks, "where is the crypto reference price likely to move over the next 30 seconds?";
- it trains another model that asks, "where is the Polymarket midpoint price likely to move over the next 30 seconds?";
- it combines both views and subtracts realistic trading costs;
- it returns a prediction and a clear yes/no trade decision.

This repo is not an order executor. It is a decision engine.

## Main Capabilities

- Trend model per asset:
  predicts the short-horizon direction of the reference crypto price for `btc`, `eth`, `sol`, and `xrp`.
- CLOB model per market:
  predicts the short-horizon midpoint movement of the Polymarket UP token for each `asset/window` market.
- Cost-aware fusion:
  combines both models, then subtracts fee estimates, slippage, and spread buffers.
- Walk-forward training:
  trains on older data and validates on newer data to reduce optimistic backtests.
- Remote TensorFlow execution:
  training and inference run through `tensorflow-api`, while this service keeps strategy logic local.
- Operator dashboard:
  a built-in `/dashboard` page for state inspection and live predictions.

### Strategy in simple terms

The service uses two model families because they answer different questions:

- Trend model:
  "Is the underlying crypto price drifting up, down, or sideways over the next 30 seconds?"
- CLOB model:
  "Is the Polymarket UP token midpoint drifting up, down, or sideways over the next 30 seconds?"

Fusion means:

- convert the trend forecast into a fairer UP probability;
- compare that with the current executable market price;
- compare the CLOB forecast with the current midpoint;
- subtract costs such as fees, slippage, and spread;
- only trade if the remaining edge is still positive.

`shouldTrade` can be `false` for normal reasons:

- the data is stale;
- the spread is too wide;
- there is not enough liquidity;
- the fee rate is unavailable;
- the predicted edge is too weak after costs.

## Setup

The service expects three things:

1. a snapshot collector that serves historical snapshots and supports live polling;
2. a reachable `tensorflow-api` deployment;
3. a writable local state directory for the runtime cursor.

Recommended real-network defaults for your environment:

```bash
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000
TENSORFLOW_API_URL=http://192.168.1.2:3100
```

## Installation

Install dependencies:

```bash
npm install
```

Run the main verification gate:

```bash
npm run check
```

## Running Locally

Start the service:

```bash
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Then open:

- dashboard: `http://127.0.0.1:3000/dashboard`
- health root: `http://127.0.0.1:3000/`
- models: `http://127.0.0.1:3000/models`

For a faster local smoke run, reduce the historical load:

```bash
MODEL_HISTORY_LOOKBACK_HOURS=2 \
MODEL_TRAIN_WINDOW_DAYS=1 \
MODEL_VALIDATION_WINDOW_DAYS=0.25 \
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

## Usage

### From code

```ts
import { ServiceRuntime } from "@sha3/polymarket-model";

const runtime = ServiceRuntime.createDefault();
await runtime.startServer();
```

### From the dashboard

1. start the service;
2. open `/dashboard`;
3. inspect the summary and model cards;
4. choose an asset and window;
5. click `Predict`;
6. read the trend forecast, CLOB forecast, executable scores, vetoes, and reasons.

## Examples

Read the service info:

```bash
curl http://127.0.0.1:3000/
```

Read all model states:

```bash
curl http://127.0.0.1:3000/models
```

Read one model state:

```bash
curl http://127.0.0.1:3000/models/btc/5m
```

Run a prediction:

```bash
curl -X POST http://127.0.0.1:3000/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

What a prediction means in plain language:

- `trend.predictedReturn`:
  how the underlying crypto reference price is expected to move.
- `trend.fairUpProbability`:
  the service's fair estimate of how likely the UP side is.
- `clob.predictedUpMid`:
  where the Polymarket UP midpoint is expected to move.
- `fusion.scoreUp` and `fusion.scoreDown`:
  edge after costs.
- `fusion.shouldTrade`:
  whether the remaining edge is strong enough to act on.
- `fusion.vetoes`:
  exact reasons the service refused the trade.

## Public API

### `ServiceRuntime`

Primary package entrypoint.

#### `createDefault()`

Builds the default runtime composition.

It wires:

- collector access;
- live snapshot buffering;
- feature extraction;
- remote TensorFlow transport;
- runtime-state persistence;
- HTTP transport.

Returns:

- `ServiceRuntime`

#### `buildServer()`

Builds the HTTP server without binding a port.

Exposes:

- `GET /`
- `GET /dashboard`
- `GET /models`
- `GET /models/:asset/:window`
- `POST /predict`

Returns:

- Node server instance compatible with `@hono/node-server`

#### `start()`

Starts the internal runtime without binding the HTTP listener.

It:

- checks `tensorflow-api` connectivity;
- restores the local runtime cursor;
- restores ready remote models;
- starts the live snapshot stream;
- runs an initial training cycle;
- schedules periodic retraining.

Returns:

- `Promise<void>`

#### `startServer()`

Starts the runtime and binds the HTTP server to `DEFAULT_PORT`.

Returns:

- server instance returned by `buildServer()`

#### `stop()`

Stops the retraining timer, snapshot stream, and HTTP listener.

Returns:

- `Promise<void>`

### `AppInfoPayload`

Returned by `GET /`.

Important fields:

- `ok`
- `serviceName`

### `ModelPredictionRequest`

```ts
type ModelPredictionRequest = {
  asset: "btc" | "eth" | "sol" | "xrp";
  window: "5m" | "15m";
};
```

### `ModelPredictionPayload`

Returned by `POST /predict`.

Important fields:

- `trend.predictedReturn`
- `trend.fairUpProbability`
- `trend.probabilities`
- `clob.currentUpMid`
- `clob.predictedUpMid`
- `clob.edge`
- `clob.probabilities`
- `fusion.scoreUp`
- `fusion.scoreDown`
- `fusion.selectedScore`
- `fusion.shouldTrade`
- `fusion.suggestedSide`
- `fusion.mode`
- `fusion.vetoes`
- `fusion.reasons`

### `ModelStatus`

Returned by `GET /models` and `GET /models/:asset/:window`.

Important fields:

- `state`
- `trendVersion`
- `clobVersion`
- `headVersionSkew`
- `trainingSampleCount`
- `validationSampleCount`
- `latestSnapshotAt`
- `activeMarket`
- `metrics`
- `lastError`

`headVersionSkew` is informational only.
It means the trend head and CLOB head were restored or refreshed at different versions or training timestamps.
That does not automatically veto trading.

### `ModelStatusPayload`

Returned by `GET /models`.

Important fields:

- `isTrainingCycleRunning`
- `lastTrainingCycleAt`
- `models`
- `liveSnapshotCount`
- `latestSnapshotAt`

## HTTP API

### `GET /`

Simple root info payload:

```json
{
  "ok": true,
  "serviceName": "@sha3/polymarket-model"
}
```

### `GET /dashboard`

Returns the built-in HTML dashboard.

### `GET /models`

Returns aggregate runtime state:

- whether a training cycle is running;
- last training cycle time;
- latest snapshot time;
- one status object per `asset/window`.

### `GET /models/:asset/:window`

Returns one market status object.

Example:

```bash
curl http://127.0.0.1:3000/models/btc/5m
```

### `POST /predict`

Runs a live prediction using the current in-memory snapshot buffer.

Request:

```json
{
  "asset": "btc",
  "window": "5m"
}
```

Response shape includes:

- trend forecast;
- CLOB forecast;
- fused trade decision.

## Runtime Flow

1. Verify that `tensorflow-api` is reachable.
2. Restore the local runtime cursor from `MODEL_STATE_DIR`.
3. Restore ready trend and CLOB model metadata from `tensorflow-api`.
4. Start the live snapshot stream.
5. Load historical snapshots from the collector.
6. Merge historical and live snapshots.
7. Resample to a canonical 500ms grid.
8. Build asset-level trend samples and market-level CLOB samples.
9. Fit preprocessing on training folds only.
10. Queue training jobs in `tensorflow-api`.
11. Poll remote jobs until they finish or time out.
12. Refresh the local in-memory model registries from remote metadata.
13. Persist only the runtime cursor locally.
14. Serve live predictions and dashboard state from the refreshed registries.

## Configuration

Every top-level key exported from [`src/config.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/config.ts) is documented here.

- `RESPONSE_CONTENT_TYPE`: response `content-type` used by JSON endpoints.
- `DEFAULT_PORT`: TCP port used by `startServer()`.
- `SERVICE_NAME`: service name returned by `GET /`.
- `MODEL_STATE_PATH`: legacy alias for the state path.
- `MODEL_STATE_DIR`: directory used to persist the runtime cursor.
- `MODEL_STATE_TMP_DIR`: optional temporary-write directory override under the state area.
- `SNAPSHOT_COLLECTOR_URL`: base URL of the snapshot collector.
- `SNAPSHOT_COLLECTOR_CACHE_TTL_MS`: cache TTL for repeated collector reads.
- `SNAPSHOT_COLLECTOR_PAGE_LIMIT`: page size used while paging historical snapshots.
- `LIVE_SNAPSHOT_INTERVAL_MS`: polling interval for live snapshots.
- `LIVE_SNAPSHOT_BUFFER_LIMIT`: maximum live snapshots kept in memory.
- `MODEL_SUPPORTED_ASSETS`: supported assets as a comma-separated env value.
- `MODEL_SUPPORTED_WINDOWS`: supported windows as a comma-separated env value.
- `MODEL_HISTORY_LOOKBACK_HOURS`: maximum lookback requested from the collector for retraining. Default `336` means `14` days.
- `MODEL_TRAINING_INTERVAL_MS`: interval between retraining cycles.
- `MODEL_DECISION_INTERVAL_MS`: cadence used when building decision points.
- `MODEL_PREDICTION_HORIZON_MS`: forecast horizon used for targets.
- `MODEL_EMBARGO_MS`: embargo gap around validation windows.
- `MODEL_CHAINLINK_STALE_MS`: maximum accepted Chainlink staleness.
- `MODEL_POLYMARKET_STALE_MS`: maximum accepted Polymarket order-book staleness.
- `MODEL_MIN_SAMPLE_COUNT`: minimum sample count required before training a head.
- `MODEL_RESTORE_ON_START`: whether runtime state and ready remote models are restored on startup.
- `MODEL_LOG_TRAINING_PROGRESS`: whether completed training steps are logged.
- `MODEL_FEE_CACHE_TTL_MS`: cache TTL for Polymarket fee-rate lookups.
- `MODEL_FEE_REQUEST_TIMEOUT_MS`: timeout per fee-rate request attempt.
- `MODEL_FEE_MAX_ATTEMPTS`: maximum fee-rate request attempts before falling back to `null`.
- `MODEL_FEE_RETRY_BASE_DELAY_MS`: base backoff for fee-rate retries.
- `MODEL_MAX_SPREAD`: maximum spread tolerated before a spread veto.
- `MODEL_SPREAD_BUFFER_KAPPA`: spread penalty multiplier used in fusion.
- `MODEL_FUSION_ALPHA_0`: base weight used by fusion time weighting.
- `MODEL_FUSION_ALPHA_1`: slope used by fusion time weighting.
- `MODEL_VETO_DOWN_THRESHOLD`: probability threshold used for opposite-side vetoes.
- `MODEL_ENABLE_CLOB_ONLY_FALLBACK`: enables `clob_only` mode when fair-value inputs are missing.
- `MODEL_TRAIN_WINDOW_DAYS`: walk-forward training window length.
- `MODEL_VALIDATION_WINDOW_DAYS`: walk-forward validation window length.
- `MODEL_CLASSIFICATION_WEIGHT`: class-balance training knob retained in the local policy.
- `MODEL_TF_EPOCHS`: epochs sent to remote training jobs.
- `MODEL_TF_BATCH_SIZE`: batch size sent to remote training jobs.
- `MODEL_TF_LEARNING_RATE`: learning rate encoded into generated model definitions.
- `MODEL_TF_EARLY_STOPPING_PATIENCE`: retained training-policy knob for remote training contracts.
- `MODEL_EXECUTION_SIZE`: execution size used for fee and slippage estimates.
- `TENSORFLOW_API_URL`: base URL of the remote `tensorflow-api`.
- `TENSORFLOW_API_AUTH_TOKEN`: optional bearer token for `tensorflow-api`.
- `TENSORFLOW_API_REQUEST_TIMEOUT_MS`: timeout per remote API request attempt.
- `TENSORFLOW_API_MAX_ATTEMPTS`: maximum retry attempts for retryable remote API requests.
- `TENSORFLOW_API_RETRY_BASE_DELAY_MS`: base backoff for retryable remote API requests.
- `TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS`: polling interval for remote training jobs.
- `TENSORFLOW_API_TRAIN_TIMEOUT_MS`: hard timeout for remote training-job completion.

## Compatibility

- Node.js 20+
- ESM runtime
- snapshot collector reachable over HTTP
- `tensorflow-api` reachable over HTTP

Expected `tensorflow-api` capabilities:

- persisted model metadata;
- synchronous named-output prediction responses;
- training jobs with multi-output sample weights.

## Scripts

- `npm run start`: start the service with `tsx`
- `npm run build`: compile TypeScript to `dist/`
- `npm run standards:check`: run the contract verifier
- `npm run lint`: run Biome checks
- `npm run format:check`: verify formatting
- `npm run typecheck`: run the TypeScript compiler
- `npm run test`: run the Node test suite
- `npm run check`: run the full verification gate

## Structure

- [`src/app/service-runtime.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/app/service-runtime.service.ts): top-level runtime lifecycle
- [`src/http/http-server.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/http/http-server.service.ts): HTTP routes and server composition
- [`src/dashboard/dashboard.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/dashboard/dashboard.service.ts): inline operator dashboard HTML
- [`src/model/model-runtime.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-runtime.service.ts): training and prediction orchestration
- [`src/model/model-training.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-training.service.ts): remote TensorFlow orchestration
- [`src/model/model-feature.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-feature.service.ts): feature construction and training-sample generation
- [`src/model/model-signal-cache.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-signal-cache.service.ts): cross-asset signal aggregation
- [`src/model/model-preprocessing.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-preprocessing.service.ts): scaling, labels, weights, and local metrics
- [`src/model/model-cost.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-cost.service.ts): fee, slippage, spread, and fusion scoring
- [`src/model/model-runtime-state.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-runtime-state.service.ts): runtime cursor persistence
- [`src/tensorflow-api/tensorflow-api-client.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/tensorflow-api/tensorflow-api-client.service.ts): remote `tensorflow-api` HTTP client
- [`src/tensorflow-api/tensorflow-api-model-definition.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/tensorflow-api/tensorflow-api-model-definition.service.ts): declarative Keras model builder

## Troubleshooting

### The dashboard loads but shows no models

That usually means one of these:

- the runtime has not trained yet;
- `tensorflow-api` has no ready models yet;
- restore failed because remote metadata is missing or invalid.

Check:

```bash
curl http://127.0.0.1:3000/models
curl http://192.168.1.2:3100/api/models
```

### Predictions fail with a model-missing error

The service requires both:

- one ready trend head for the asset;
- one ready CLOB head for the requested `asset/window`.

If one head is missing, wait for training or inspect remote model state.

### The first training cycle is slow

This is usually caused by a large historical bootstrap window.

Reduce:

- `MODEL_HISTORY_LOOKBACK_HOURS`
- `MODEL_TRAIN_WINDOW_DAYS`
- `MODEL_VALIDATION_WINDOW_DAYS`

for smoke runs.

### Fee-rate lookups are failing

The service now retries fee-rate reads, but persistent failures still veto trading.

You will see vetoes such as:

- `fee_rate_unavailable_up`
- `fee_rate_unavailable_down`

### `tensorflow-api` is flaky

The client now retries transient failures like timeouts, `429`, and `5xx`, but repeated failures will still surface as model errors.

Check:

```bash
curl "$TENSORFLOW_API_URL/"
```

If auth is enabled, also set `TENSORFLOW_API_AUTH_TOKEN`.

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the relevant `ai/<assistant>.md` before changing behavior.
- Keep managed files read-only unless the task is explicitly a standards update.
- Update tests, README, and exported types in the same pass as behavior changes.
- Prefer the simplest direct implementation that still respects the project contract.
- Run `npm run standards:check` and `npm run check` before finishing.
