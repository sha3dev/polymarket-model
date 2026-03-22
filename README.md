# @sha3/polymarket-model

Long-running Node service that watches crypto prices and Polymarket order books, trains short-horizon models through a remote `tensorflow-api`, and exposes an HTTP API plus an operator dashboard.

## TL;DR

```bash
npm install
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Then open:

```bash
open http://127.0.0.1:3200/dashboard
```

Run a prediction:

```bash
curl -X POST http://127.0.0.1:3200/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

## Why

This service tries to answer one practical question:

"Given the live crypto price and the live Polymarket book, is the current market price attractive enough to trade right now?"

It does that with two separate model families:

- A trend model predicts where the underlying crypto reference price is likely to move over the next 30 seconds.
- A CLOB model predicts where the Polymarket UP-token midpoint is likely to move over the next 30 seconds.

The service then combines both views, subtracts realistic costs, and returns a decision payload.

This repository is not an order executor. It is a decision engine and model runtime.

## Main Capabilities

- Trend model per asset for `btc`, `eth`, `sol`, and `xrp`
- CLOB model per market for every `asset/window` pair such as `btc_5m` or `eth_15m`
- Continuous catch-up training from the beginning of collector history
- Live inference on the newest buffered snapshots
- Remote TensorFlow execution through `tensorflow-api`
- Built-in operator dashboard at `GET /dashboard`
- Cost-aware trade scoring with spread, slippage, liquidity, and fee vetoes

### Strategy in plain language

The service keeps two separate views of the same market:

- The trend model looks at the broader crypto tape.
- The CLOB model looks at the local Polymarket microstructure.

The final score is not just "what does the model predict?" It is:

- what the trend model implies for fair UP probability,
- what the CLOB model implies for the UP midpoint,
- what the current book lets you actually execute,
- what fees and slippage will cost,
- whether the remaining edge is still worth taking.

That is why `shouldTrade` can be `false` even when one of the models looks directionally strong.

## Setup

The service expects:

1. A snapshot collector that serves historical snapshots.
2. A reachable `tensorflow-api` deployment that stores and trains models.
3. A writable local state directory for the runtime cursor.

Typical real-network settings:

```bash
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000
TENSORFLOW_API_URL=http://192.168.1.2:3100
```

## Installation

Install dependencies:

```bash
npm install
```

Run the verification gate:

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

Default local port:

- `http://127.0.0.1:3200`

Useful endpoints:

- dashboard: `GET /dashboard`
- info: `GET /`
- model status: `GET /models`
- one model: `GET /models/:asset/:window`
- prediction: `POST /predict`

## Usage

### From code

```ts
import { ServiceRuntime } from "@sha3/polymarket-model";

const runtime = ServiceRuntime.createDefault();
await runtime.startServer();
```

### From the dashboard

1. Start the service.
2. Open `/dashboard`.
3. Wait for model cards to move from `training` to `ready`.
4. Pick an asset and window.
5. Press `Predict`.
6. Read the trend block, CLOB block, fusion scores, vetoes, and reasons.

## Examples

Read service info:

```bash
curl http://127.0.0.1:3200/
```

Read all model states:

```bash
curl http://127.0.0.1:3200/models
```

Read one model:

```bash
curl http://127.0.0.1:3200/models/btc/5m
```

Run one prediction:

```bash
curl -X POST http://127.0.0.1:3200/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

Read the result:

- `trend.predictedReturn`: predicted log-return of the underlying asset over the horizon
- `trend.fairUpProbability`: trend forecast translated into a fair UP probability
- `clob.predictedUpMid`: predicted future midpoint of the UP token
- `clob.edge`: predicted midpoint minus current midpoint
- `fusion.scoreUp` / `fusion.scoreDown`: cost-aware edge scores
- `fusion.shouldTrade`: final yes/no decision
- `fusion.vetoes`: exact reasons the trade was blocked

## Public API

### `ServiceRuntime`

Primary package entrypoint.

#### `createDefault(): ServiceRuntime`

Builds the default runtime composition.

It wires:

- collector access
- live snapshot buffering
- feature extraction
- remote TensorFlow transport
- runtime cursor persistence
- HTTP server

#### `buildServer()`

Builds the HTTP server without binding a port.

Routes:

- `GET /`
- `GET /dashboard`
- `GET /models`
- `GET /models/:asset/:window`
- `POST /predict`

#### `start(): Promise<void>`

Starts the runtime without binding the HTTP listener.

It:

- checks `tensorflow-api` reachability
- restores the local runtime cursor
- restores remote ready models
- starts the live snapshot store
- runs an initial training cycle
- schedules periodic retraining

#### `startServer(): Promise<void>`

Starts the runtime and binds the HTTP server.

#### `stop(): Promise<void>`

Stops the HTTP server and runtime resources.

### `AppInfoPayload`

Returned by `GET /`.

Contains the top-level service identity payload, including the service name and the simple health-style `ok` flag.

### `ModelPredictionRequest`

Request body for `POST /predict`.

Fields:

- `asset`: one of `btc`, `eth`, `sol`, `xrp`
- `window`: one of `5m`, `15m`

### `ModelPredictionPayload`

Response body for `POST /predict`.

Contains:

- `activeMarket`
- `trend`
- `clob`
- `fusion`
- `generatedAt`
- `liveSnapshotCount`
- `modelKey`

It is the main inference contract of the package.

### `ModelStatus`

One model-status record from `GET /models` or `GET /models/:asset/:window`.

Contains:

- model identity fields
- head versions
- sequence lengths
- feature counts
- training and validation counts
- active market information
- metrics
- last error
- `headVersionSkew`

### `ModelStatusPayload`

Response body for `GET /models`.

Contains:

- `isTrainingCycleRunning`
- `lastTrainingCycleAt`
- `latestSnapshotAt`
- `liveSnapshotCount`
- `models`

## HTTP API

### `GET /`

Returns basic service information.

### `GET /dashboard`

Returns the built-in operator dashboard HTML.

### `GET /models`

Returns:

- whether a training cycle is running
- last training cycle time
- latest live snapshot time
- live snapshot count
- one status record per `asset/window`

Each model status includes:

- trend and CLOB versions
- feature counts
- sequence lengths
- active market details
- training and validation counts
- latest metrics
- `headVersionSkew`

`headVersionSkew` means trend and CLOB heads were trained at different times or versions. This is informational. It does not block inference by itself.

### `GET /models/:asset/:window`

Returns the status for one market key.

### `POST /predict`

Request:

```json
{
  "asset": "btc",
  "window": "5m"
}
```

Response contains:

- active market context
- trend prediction
- CLOB prediction
- fusion decision
- live snapshot count

## Runtime Flow

### High-level runtime

The service has two external dependencies:

- the snapshot collector for historical data
- `tensorflow-api` for training and inference

Node keeps all strategy logic locally:

- snapshot merging
- feature extraction
- target construction
- preprocessing statistics
- label thresholds
- class weights
- validation metrics
- fusion and veto logic

Remote TensorFlow keeps:

- model definitions
- trained weights
- training execution
- prediction execution
- remote model metadata

### Startup flow

On startup the service:

1. checks that `tensorflow-api` is reachable
2. restores local runtime state:
   - `lastTrainingCycleAt`
   - `lastTrainedSnapshotAt`
3. reads existing remote models from `tensorflow-api`
4. restores ready models into in-memory registries
5. starts the live snapshot stream
6. starts the first training cycle in the background
7. schedules future retraining

### Historical catch-up flow

The training loop does not request many days of history in one collector call.

Instead it:

1. reads `lastTrainedSnapshotAt`
2. asks the collector for one page starting at that cursor
3. trains on that page plus the minimum overlap needed for sequences and horizon
4. persists the new cursor
5. requests the next page
6. repeats until it reaches the present

Important consequences:

- first boot can train from the beginning of available history
- catch-up is incremental and resumable
- the service does not need a huge single historical request

### Snapshot preparation

Raw snapshots are resampled into 500 ms buckets.

If a bucket is missing, the previous snapshot is carried forward. This produces a regular time grid, which the sequence models need.

Decision timestamps are then sampled at `MODEL_DECISION_INTERVAL_MS`, which defaults to 30 seconds.

### Sequence lengths

Trend sequence lengths:

- `btc`: 180 steps
- `eth`: 180 steps
- `sol`: 180 steps
- `xrp`: 180 steps

At 500 ms resampling, `180` steps means a 90-second sequence.

CLOB sequence lengths:

- `*_5m`: 96 steps
- `*_15m`: 128 steps

At 500 ms resampling:

- `96` steps is 48 seconds
- `128` steps is 64 seconds

### Training order

Each catch-up pass trains in this order:

1. trend models for each asset
2. CLOB models for each `asset/window`
3. persist runtime cursor
4. refresh status

### Validation split

Training uses the full accumulated sample history for that head, sorted by time.

The newest tail is held out for validation:

- validation size = `max(1, floor(sampleCount * 0.2))`
- training = older `80%`
- validation = newest `20%`

This is a simple chronological holdout, not a walk-forward embargo scheme.

## Training Data And Targets

### Trend training samples

One trend sample is built per:

- supported asset
- decision timestamp

The target is:

- future 30-second log-return of the Chainlink price

Exact rule:

- current and future Chainlink values must both exist
- both must be considered fresh
- target = `log(future_chainlink / current_chainlink)`

If those conditions are not met, the sample is dropped.

### CLOB training samples

One CLOB sample is built per:

- supported asset
- supported window
- decision timestamp

There are two targets:

1. Regression target:
   `logit(future_up_mid)`
2. Classification target:
   `future_up_mid - current_up_mid`

The CLOB target is only valid when:

- a current active market exists
- a future active market exists
- current UP midpoint exists
- future UP midpoint exists
- the future order book is fresh

### Direction labels

Both trend and CLOB use a 3-class direction head:

- `up`
- `flat`
- `down`

Labels come from a thresholded version of the regression target:

- threshold = `max(minimumThreshold, median(abs(targets)) * 0.5)`

Minimum thresholds:

- trend: `0.0001`
- CLOB direction: `0.0025`

Class mapping:

- `up` if target > threshold
- `flat` if `-threshold <= target <= threshold`
- `down` if target < -threshold

### Sample weighting

Classification uses inverse-frequency-style class weights with a floor:

- class weight = `max(0.25, maxClassSupport / classSupport)`

Regression uses uniform sample weights of `1`.

## Features

### Trend features

Trend features are asset-level only. They deliberately do not use Polymarket-specific market timing or `priceToBeat`.

The full trend feature set is:

- `cl_log_px`
- `cl_stale_s`
- `cl_ret_30s`
- `ex_cl_basis`
- `ex_cl_basis_chg_5s`
- `ex_logret_1s`
- `ex_logret_5s`
- `ex_logret_15s`
- `ex_logret_30s`
- `ex_mom_5s_mean`
- `ex_rv_10s`
- `ex_rv_30s`
- `ex_ret_accel`
- `ex_spread_med`
- `ex_spread_wmean`
- `ex_depth3_log`
- `ex_imb1_wmean`
- `ex_imb3_wmean`
- `ex_imb3_chg_5s`
- `ex_disp_log`
- `ex_disp_chg_5s`
- `ex_best_stale_s`
- `ex_mean_stale_s`
- `ex_valid_px_n`
- `ex_valid_book_n`
- `binance_premium`
- `coinbase_premium`
- `okx_premium`
- `kraken_premium`
- `leader_ret_5s`
- `leader_ret_15s`
- `leader_imb3`
- `breadth_ret_5s`
- `disp_ret_5s`
- `btc_shock`
- `eth_shock`
- `cl_valid_flag`
- `cl_update_recent_60s`
- `ex_valid_gate_flag`

Plain-language groups:

- Chainlink state and freshness
- Exchange returns and realized volatility
- Cross-venue premiums and book quality
- Exchange spread, depth, and imbalance
- Cross-asset leader and breadth signals
- Shock signals from BTC and ETH

### CLOB features

CLOB features mix market microstructure with asset context and fair-value hints.

The full CLOB feature set is:

- `up_mid`
- `up_spread`
- `up_imb1`
- `up_imb3`
- `up_depth3_log`
- `up_depth1_log`
- `up_stale_s`
- `up_mid_chg_5s`
- `up_spread_chg_5s`
- `up_imb3_chg_5s`
- `down_mid`
- `down_spread`
- `down_imb1`
- `down_imb3`
- `down_depth3_log`
- `down_depth1_log`
- `down_stale_s`
- `down_mid_chg_5s`
- `parity_gap`
- `spread_sum`
- `net_imb3`
- `mid_skew`
- `tick_size`
- `min_order_size`
- `neg_risk_flag`
- `book_hash_change`
- `t_to_end_norm`
- `t_from_start_norm`
- `ptb_missing`
- `moneyness_log_cl`
- `moneyness_log_ex`
- `ex_rv_30s`
- `fair_q_up`
- `mispricing_mid`
- `mispricing_ask`
- `mispricing_bid`
- `leader_ret_5s`
- `leader_ret_15s`
- `breadth_pm_parity`
- `breadth_pm_midup`
- `disp_pm_midup`
- `up_down_stale_max`
- `up_down_stale_diff`
- `spread_up_gt_10c`
- `spread_dn_gt_10c`
- `midpoint_vs_displayed_up`
- `midpoint_vs_displayed_dn`
- `pm_live_flag`

Plain-language groups:

- UP and DOWN book midpoints, spreads, depths, and imbalances
- Relative shape between UP and DOWN books
- Market timing within the 5-minute or 15-minute event
- Price-to-beat and moneyness
- Fair-probability and mispricing signals
- Cross-market Polymarket breadth and dispersion
- Staleness and displayed-vs-midpoint diagnostics

### Cross-asset leader logic

Leader signals are not a single hard-coded leader asset. They are weighted cross-asset signals.

Current weights:

- For `btc`: `eth=0.2`, `sol=0.05`, `xrp=0.05`
- For `eth`: `btc=0.6`, `sol=0.1`, `xrp=0.1`
- For `sol`: `btc=0.6`, `eth=0.3`, `xrp=0.1`
- For `xrp`: `btc=0.6`, `eth=0.25`, `sol=0.15`

Shock features are sourced from fixed assets:

- `btc_shock` uses BTC
- `eth_shock` uses ETH

## Preprocessing

The service fits preprocessing on training samples only.

For each feature:

1. compute median
2. compute MAD-based scale:
   `max(1.4826 * MAD, 1e-8)`
3. scale each value:
   `(value - median) / scale`
4. clamp scaled values into `[-10, 10]`

Missing numeric values are treated as `0` before scaling.

The fitted medians, scales, thresholds, class weights, and metrics are stored in remote model metadata.

## Model Architecture

Both heads use a Keras functional TCN-style architecture built in TypeScript and executed remotely by `tensorflow-api`.

Shared structure:

- input tensor shaped `[sequenceLength, featureCount]`
- dense stem
- residual `Conv1D` blocks
- causal dilations
- dropout
- global average pooling
- dense trunk
- two named outputs:
  - `regression`
  - `classification`

Compile choices:

- optimizer: Adam
- regression loss: Huber
- classification loss: categorical cross-entropy from logits

Architecture is keyed separately for:

- each trend asset
- each CLOB `asset/window`

## Training Through `tensorflow-api`

For each training block this service:

1. builds sequences locally
2. builds targets locally
3. fits preprocessing locally
4. scales train and validation sequences locally
5. builds class labels and sample weights locally
6. sends the prepared tensors to `tensorflow-api`
7. waits for the remote training job
8. runs remote validation prediction
9. computes validation metrics locally
10. stores metadata back in the remote model record

Remote model ids:

- trend: `polymarket_model_trend_<asset>`
- CLOB: `polymarket_model_clob_<asset>_<window>`

The remote service is the source of truth for:

- model records
- model artifacts
- model metadata

Local persistence only stores:

- `lastTrainingCycleAt`
- `lastTrainedSnapshotAt`

## Inference Flow

Prediction is live-only. It uses the newest buffered snapshots in memory.

Steps:

1. Build one trend input and one CLOB input from the latest live snapshots.
2. Scale each sequence using the medians and scales stored in the trained artifact metadata.
3. Call remote prediction on the trend model.
4. Call remote prediction on the CLOB model.
5. Decode outputs:
   - trend regression stays in identity space
   - CLOB regression is decoded from logit-probability back to probability
6. Build fusion scores and vetoes locally.

### Trend inference output

Trend returns:

- regression prediction: future log-return
- class probabilities: `up`, `flat`, `down`
- fair UP probability derived from the predicted return

### CLOB inference output

CLOB returns:

- regression prediction: future UP midpoint probability
- class probabilities: `up`, `flat`, `down`
- midpoint edge versus current UP midpoint

### Fusion logic

Fusion compares both heads against executable market conditions.

Inputs include:

- fair trend probability
- predicted UP midpoint
- current UP midpoint
- effective execution prices from order book depth
- spread buffers
- estimated fees
- estimated slippage
- freshness checks
- liquidity checks

The fee estimate uses:

- `feeRate = feeRateBps / 10_000`
- `curve = (p * (1 - p))^2`
- `estimatedFee = executionSize * p * feeRate * curve`

The service can fall back to `clob_only` mode if configured, but the default behavior is still the full fused decision.

## Configuration

Every top-level key exported by `src/config.ts` is listed below.

### Service and HTTP

- `RESPONSE_CONTENT_TYPE`
  default: `application/json`
- `DEFAULT_PORT`
  default: `3200`
- `SERVICE_NAME`
  default: `@sha3/polymarket-model`

### Local runtime state

- `MODEL_STATE_PATH`
  optional explicit state path
- `MODEL_STATE_DIR`
  default: `./var/model-state`
- `MODEL_STATE_TMP_DIR`
  optional temporary directory override

### Collector

- `SNAPSHOT_COLLECTOR_URL`
  default: `http://127.0.0.1:3000`
- `SNAPSHOT_COLLECTOR_CACHE_TTL_MS`
  default: `2000`
- `SNAPSHOT_COLLECTOR_PAGE_LIMIT`
  default: `1000`
- `SNAPSHOT_COLLECTOR_REQUEST_TIMEOUT_MS`
  default: `30000`
- `SNAPSHOT_COLLECTOR_MAX_ATTEMPTS`
  default: `4`
- `SNAPSHOT_COLLECTOR_RETRY_BASE_DELAY_MS`
  default: `250`

### Live snapshots

- `LIVE_SNAPSHOT_INTERVAL_MS`
  default: `500`
- `LIVE_SNAPSHOT_BUFFER_LIMIT`
  default: `1024`

### Supported markets

- `MODEL_SUPPORTED_ASSETS`
  default: `btc,eth,sol,xrp`
- `MODEL_SUPPORTED_WINDOWS`
  default: `5m,15m`

### Training schedule and sample generation

- `MODEL_TRAINING_INTERVAL_MS`
  default: `86400000`
- `MODEL_DECISION_INTERVAL_MS`
  default: `30000`
- `MODEL_PREDICTION_HORIZON_MS`
  default: `30000`
- `MODEL_CHAINLINK_STALE_MS`
  default: `60000`
- `MODEL_POLYMARKET_STALE_MS`
  default: `15000`
- `MODEL_MIN_SAMPLE_COUNT`
  default: `12`
- `MODEL_RESTORE_ON_START`
  default: `true`
- `MODEL_LOG_TRAINING_PROGRESS`
  default: `true`

### Cost and fusion

- `MODEL_FEE_CACHE_TTL_MS`
  default: `30000`
- `MODEL_FEE_REQUEST_TIMEOUT_MS`
  default: `1500`
- `MODEL_FEE_MAX_ATTEMPTS`
  default: `3`
- `MODEL_FEE_RETRY_BASE_DELAY_MS`
  default: `200`
- `MODEL_MAX_SPREAD`
  default: `0.1`
- `MODEL_SPREAD_BUFFER_KAPPA`
  default: `0.75`
- `MODEL_FUSION_ALPHA_0`
  default: `0.2`
- `MODEL_FUSION_ALPHA_1`
  default: `0.6`
- `MODEL_VETO_DOWN_THRESHOLD`
  default: `0.7`
- `MODEL_ENABLE_CLOB_ONLY_FALLBACK`
  default: `true`
- `MODEL_EXECUTION_SIZE`
  default: `25`

### Remote TensorFlow

- `MODEL_TF_EPOCHS`
  default: `25`
- `MODEL_TF_BATCH_SIZE`
  default: `32`
- `MODEL_TF_LEARNING_RATE`
  default: `0.01`
- `TENSORFLOW_API_URL`
  default: `http://127.0.0.1:3100`
- `TENSORFLOW_API_AUTH_TOKEN`
  default: empty
- `TENSORFLOW_API_REQUEST_TIMEOUT_MS`
  default: `30000`
- `TENSORFLOW_API_MAX_ATTEMPTS`
  default: `4`
- `TENSORFLOW_API_RETRY_BASE_DELAY_MS`
  default: `250`
- `TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS`
  default: `2000`
- `TENSORFLOW_API_TRAIN_TIMEOUT_MS`
  default: `1200000`

## Compatibility

Supported runtime model:

- Node/TypeScript service in this repo
- external `tensorflow-api` service
- external snapshot collector

Current market universe:

- assets: `btc`, `eth`, `sol`, `xrp`
- windows: `5m`, `15m`

Expected remote contract from `tensorflow-api`:

- `GET /`
- `GET /api/models`
- `GET /api/models/:modelId`
- `POST /api/models`
- `PATCH /api/models/:modelId/metadata`
- `POST /api/models/:modelId/training-jobs`
- `POST /api/models/:modelId/prediction-jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/result`

## Scripts

- `npm run start`
  start the service directly from TypeScript
- `npm run build`
  compile to `dist`
- `npm run standards:check`
  run standards verification
- `npm run lint`
  run Biome checks
- `npm run format:check`
  run formatting checks
- `npm run typecheck`
  run TypeScript without emit
- `npm run test`
  run the Node test suite
- `npm run check`
  run the full gate
- `npm run fix`
  apply Biome write fixes

## Structure

- `src/app`
  runtime composition and package entrypoint
- `src/http`
  HTTP server
- `src/dashboard`
  operator dashboard HTML
- `src/model`
  features, preprocessing, training orchestration, runtime, and fusion
- `src/tensorflow-api`
  remote TensorFlow transport and model-definition builder
- `src/collector`
  collector client with retry and pagination
- `src/snapshot`
  live snapshot buffering
- `test`
  Node test suite

## Troubleshooting

### Models stay in `training`

Check:

- `GET /models`
- logs from this service
- logs from `tensorflow-api`

Common causes:

- remote model creation delay
- remote training job timeout
- remote TensorFlow runtime error

### Models stay in `error`

Inspect:

- `lastError` in `GET /models`
- `GET /api/jobs/:jobId` on `tensorflow-api`

### `shouldTrade` is always `false`

This is often normal. Check:

- `fusion.vetoes`
- `fusion.reasons`
- `trend.isChainlinkFresh`
- `clob.isOrderBookFresh`
- fee-rate availability
- market liquidity and spread

### `headVersionSkew` is `true`

This means trend and CLOB heads were refreshed at different times. That is expected under independent head training.

### Training is too slow on first boot

Reduce workload temporarily:

```bash
SNAPSHOT_COLLECTOR_PAGE_LIMIT=250 \
MODEL_TF_EPOCHS=5 \
npm run start
```

### `tensorflow-api` contract mismatch

If remote training or metadata update fails, verify that your deployment supports the endpoints listed in the Compatibility section.

## AI Workflow

When changing strategy or runtime behavior:

1. update code
2. update tests for observable behavior
3. update this README so the documented pipeline still matches the code
4. run:

```bash
npm run standards:check
npm run check
```

For upstream debugging of `tensorflow-api`, reproduce with a real local run of this service against the remote collector and remote TensorFlow API, then capture:

- the failing model id
- the failing job id
- the `GET /api/jobs/:jobId` payload
- the `GET /models` payload

That is the fastest way to separate a strategy bug in this repo from a transport or runtime bug in `tensorflow-api`.
