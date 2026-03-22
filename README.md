# @sha3/polymarket-model

Crypto-only long-running Node service that:

- reads historical snapshots from the collector in contiguous 5-minute blocks
- uses the 30 seconds immediately before each block to make one automatic prediction
- scores that prediction on the first 30 seconds inside that block
- trains a remote model in `tensorflow-api` with that 5-minute block
- keeps a live in-memory snapshot buffer through `@sha3/polymarket-snapshot`
- exposes a dashboard and HTTP API for live manual predictions

## TL;DR

```bash
npm install
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Open:

```bash
open http://127.0.0.1:3200/dashboard
```

Manual prediction:

```bash
curl -X POST http://127.0.0.1:3200/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc"}'
```

## Why

This service answers a much narrower question than the previous trend+CLOB runtime:

> “Given only the crypto market stream, can we predict whether the price will go up or down over the next 30 seconds?”

The system now ignores Polymarket order books entirely.

It works in two parallel modes:

- historical automatic mode
  - uses closed 5-minute blocks from the collector
  - uses the 30 seconds immediately before the block starts as prediction context
  - checks whether that prediction was right on the first 30 seconds inside the block
  - then trains the model with the full block
- live manual mode
  - keeps the most recent real-time snapshots in memory
  - lets an operator press `Predict` in the dashboard
  - scores that live prediction 30 seconds later

The result is a simple crypto-direction training and evaluation runtime.

## Main Capabilities

- one crypto model per asset: `btc`, `eth`, `sol`, `xrp`
- historical catch-up that resumes from the last persisted collector cursor
- automatic prediction before training on every closed 5-minute block
- live manual prediction from the newest snapshots in memory
- rolling hit-rate over the last 2 hours of resolved predictions per asset
- remote training and inference through `tensorflow-api`
- compact operator dashboard at `GET /dashboard`

### Strategy In Plain Language

Each historical cycle uses a block of 5 minutes of market data.

Inside that block:

1. look at the 30 seconds immediately before the block opens
2. ask the model whether the price is likely to go up or down in the first 30 seconds of the new block
3. compare that guess with what actually happened in those first 30 seconds
4. record correct or incorrect
5. train the model with the full 5-minute block

This makes the automatic prediction genuinely “before training on that block”.

For manual predictions, the same idea is used, but the input comes from the live real-time buffer instead of a closed historical block.

## Setup

The service needs:

1. a snapshot collector with historical `/snapshots`
2. a reachable `tensorflow-api` deployment
3. a writable local directory for runtime state

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

Run the full gate:

```bash
npm run check
```

## Running Locally

```bash
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Default port:

- `http://127.0.0.1:3200`

Useful routes:

- `GET /`
- `GET /dashboard`
- `GET /assets`
- `GET /assets/:asset`
- `GET /predictions`
- `POST /predict`

## Usage

### From Code

```ts
import { ServiceRuntime } from "@sha3/polymarket-model";

const runtime = ServiceRuntime.createDefault();
await runtime.startServer();
```

### From The Dashboard

1. start the service
2. open `/dashboard`
3. wait until an asset row shows `Live Ready`
4. press `Predict` for that asset
5. watch the recent predictions table move from `pending` to `resolved`

## Examples

Read service info:

```bash
curl http://127.0.0.1:3200/
```

Read asset states:

```bash
curl http://127.0.0.1:3200/assets
```

Read one asset:

```bash
curl http://127.0.0.1:3200/assets/btc
```

Read recent predictions:

```bash
curl http://127.0.0.1:3200/predictions
```

Run one manual live prediction:

```bash
curl -X POST http://127.0.0.1:3200/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc"}'
```

## Public API

### `ServiceRuntime`

Primary package entrypoint.

#### `createDefault(): ServiceRuntime`

Builds the default runtime composition.

It wires:

- collector access
- live snapshot buffering
- crypto feature extraction
- remote TensorFlow transport
- runtime-state persistence
- HTTP server

#### `buildServer()`

Builds the HTTP server without binding a port.

#### `start(): Promise<void>`

Starts the runtime without binding the HTTP listener.

It:

- checks `tensorflow-api` reachability
- restores local runtime state
- restores remote crypto models
- starts the live snapshot buffer
- starts the historical processing loop

#### `startServer(): Promise<void>`

Starts the runtime and binds the HTTP server.

#### `stop(): Promise<void>`

Stops the HTTP server and runtime resources.

### `AppInfoPayload`

Returned by `GET /`.

Contains:

- `ok`
- `serviceName`

### `ModelPredictionRequest`

Request body for `POST /predict`.

Fields:

- `asset`: one of `btc`, `eth`, `sol`, `xrp`

### `ModelPredictionRecord`

The canonical record for one prediction, whether automatic or manual.

Important fields:

- `predictionId`
- `asset`
- `source`
- `status`
- `issuedAt`
- `targetStartAt`
- `targetEndAt`
- `predictedDirection`
- `predictedReturn`
- `predictedProbabilityUp`
- `predictedProbabilityDown`
- `actualDirection`
- `actualReturn`
- `isCorrect`
- `upValueAtPrediction`
- `downValueAtPrediction`
- `upValueAtTargetEnd`
- `downValueAtTargetEnd`

### `ModelPredictionRecordPayload`

Returned by `GET /predictions`.

Contains:

- `predictions`: newest-first recent prediction records

### `ModelPredictionPayload`

Returned by `POST /predict`.

Contains:

- `prediction`: the created manual prediction record
- `liveSnapshotCount`: how many live snapshots were currently buffered

### `ModelStatus`

Per-asset runtime status returned by `GET /assets` and `GET /assets/:asset`.

Important fields:

- `asset`
- `state`
- `currentBlockStartAt`
- `currentBlockEndAt`
- `lastCollectorFromAt`
- `isLiveReady`
- `lastLiveSnapshotAt`
- `trainingCount`
- `lastTrainingAt`
- `lastTrainingStatus`
- `lastPredictionAt`
- `lastPredictionSource`
- `lastPredictionWasCorrect`
- `rollingHitRate`
- `rollingPredictionCount`
- `rollingCorrectCount`
- `latestPrediction`
- `lastError`

### `ModelStatusPayload`

Returned by `GET /assets`.

Contains:

- `isProcessing`
- `lastHistoricalBlockCompletedAt`
- `assets`

## HTTP API

### `GET /`

Returns the basic service info payload.

### `GET /dashboard`

Returns the built-in HTML dashboard.

### `GET /assets`

Returns global runtime state:

- whether the service is currently processing historical work
- last completed historical block
- per-asset status

### `GET /assets/:asset`

Returns one asset status.

### `GET /predictions`

Returns recent prediction records across all assets.

The response is capped to the latest 50 predictions, newest first.

### `POST /predict`

Runs a manual live prediction using the latest real-time snapshots already buffered in memory.

Error cases:

- asset is invalid
- no trained model exists for that asset yet
- live buffer does not contain enough recent context yet

## Runtime Flow

### Historical Automatic Flow

For each asset:

1. read the persisted collector cursor `lastCollectorFromAt`
2. define the next closed 5-minute block
3. request that block from the collector together with the 30 seconds immediately before it
4. use those previous 30 seconds to build one prediction context
5. run one automatic prediction for the first 30 seconds of the block
6. score that prediction on that first 30-second slice
7. append the result to the rolling hit-rate buffer
8. build training samples from the full 5-minute block
9. send only that block to `tensorflow-api`
10. persist the next collector cursor

### Live Manual Flow

In parallel, the service keeps a real-time buffer through `@sha3/polymarket-snapshot`.

When you press `Predict`:

1. the latest live snapshots are trimmed to the required context window
2. the current asset model runs on that live context
3. a `manual` prediction record is created with status `pending`
4. after 30 seconds, the service checks the realized outcome
5. the record becomes `resolved` or `error`

### What A Prediction Means

The prediction is binary:

- `up`
- `down`

The service still keeps a continuous predicted return and a probability split:

- `Pred Up`
- `Pred Down`

The final realized outcome is shown as:

- `Final Up = 1`, `Final Down = 0` if the market went up
- `Final Up = 0`, `Final Down = 1` if the market went down

### Training Data, Features, And Targets

#### What Is One Training Example?

One training example is:

- a sequence of recent crypto market features
- plus the realized future return 30 seconds later

It is not a single raw snapshot.

#### How Snapshots Become Features

Raw collector snapshots are first resampled to `500ms` buckets.

Then the crypto feature builder creates a fixed-length sequence from the recent context window.

Current crypto features used:

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

#### What Is The Target?

For a decision taken at time `T`:

- context uses the 30 seconds immediately before `T`
- target uses the next 30 seconds after `T`

The target return is:

```text
log(price(T + 30s) / price(T))
```

Direction label:

- `up` if target return > 0
- `down` otherwise

#### Which Price Is Used?

The runtime prefers fresh Chainlink price when available.
If Chainlink is stale, it falls back to the aggregated exchange price built from the exchange order books inside the snapshot.

#### How Many Examples Come From One 5-Minute Block?

The block is not turned into exactly one training sample.

Inside the 5-minute block, the feature service can create multiple decision points spaced by the prediction context interval.

So one block can produce several training examples, each one still meaning:

- recent sequence
- future 30-second outcome

#### Validation

Within the block payload sent to training:

- the earlier samples become the training split
- the last fraction becomes the validation split

Validation is used to compute:

- regression MAE
- regression RMSE
- regression Huber
- binary direction accuracy

## Configuration

Every top-level config key exported by `src/config.ts`:

- `RESPONSE_CONTENT_TYPE`
  - HTTP JSON content type
- `DEFAULT_PORT`
  - listener port
- `SERVICE_NAME`
  - service label shown in API and dashboard
- `MODEL_STATE_PATH`
  - optional legacy alias for runtime state location
- `MODEL_STATE_DIR`
  - base directory for persisted runtime state
- `MODEL_STATE_TMP_DIR`
  - temp directory for atomic runtime-state writes
- `SNAPSHOT_COLLECTOR_URL`
  - collector base URL
- `SNAPSHOT_COLLECTOR_CACHE_TTL_MS`
  - cache TTL for collector requests
- `SNAPSHOT_COLLECTOR_PAGE_LIMIT`
  - maximum collector page size
- `SNAPSHOT_COLLECTOR_REQUEST_TIMEOUT_MS`
  - per-attempt collector timeout
- `SNAPSHOT_COLLECTOR_MAX_ATTEMPTS`
  - max collector retry attempts
- `SNAPSHOT_COLLECTOR_RETRY_BASE_DELAY_MS`
  - base backoff for collector retries
- `LIVE_SNAPSHOT_INTERVAL_MS`
  - polling cadence used by `polymarket-snapshot`
- `LIVE_SNAPSHOT_BUFFER_LIMIT`
  - max live snapshots kept in memory
- `MODEL_SUPPORTED_ASSETS`
  - supported crypto assets
- `MODEL_PROCESS_INTERVAL_MS`
  - cadence for the historical processing loop
- `MODEL_BLOCK_DURATION_MS`
  - historical block length, default 5 minutes
- `MODEL_PREDICTION_CONTEXT_MS`
  - size of the context window used for prediction
- `MODEL_PREDICTION_TARGET_MS`
  - future horizon used for scoring and target construction
- `MODEL_PREDICTION_HORIZON_MS`
  - compatibility alias used by some internal feature utilities
- `MODEL_DECISION_INTERVAL_MS`
  - compatibility alias aligned with the context interval
- `MODEL_ROLLING_HIT_RATE_WINDOW_MS`
  - time span of the rolling resolved-prediction window, default 2 hours
- `MODEL_CHAINLINK_STALE_MS`
  - maximum age for Chainlink values to be treated as fresh
- `MODEL_MIN_SAMPLE_COUNT`
  - minimum number of training samples required to train a block
- `MODEL_RESTORE_ON_START`
  - whether runtime state and remote model metadata should be restored on boot
- `MODEL_LOG_TRAINING_PROGRESS`
  - whether to log training completion lines
- `MODEL_TF_EPOCHS`
  - epochs per remote training job
- `MODEL_TF_BATCH_SIZE`
  - batch size per remote training job
- `MODEL_TF_LEARNING_RATE`
  - learning rate for remote model creation
- `TENSORFLOW_API_URL`
  - remote TensorFlow service base URL
- `TENSORFLOW_API_AUTH_TOKEN`
  - optional bearer token
- `TENSORFLOW_API_REQUEST_TIMEOUT_MS`
  - per-attempt `tensorflow-api` timeout
- `TENSORFLOW_API_MAX_ATTEMPTS`
  - max retry attempts for `tensorflow-api`
- `TENSORFLOW_API_RETRY_BASE_DELAY_MS`
  - base retry backoff for `tensorflow-api`
- `TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS`
  - interval used to poll remote training job status
- `TENSORFLOW_API_TRAIN_TIMEOUT_MS`
  - maximum training-job wait time

## Compatibility

This is a breaking refactor from the old trend+CLOB/fusion service.

What changed:

- `window` is gone from public prediction requests
- `/models` and `/models/:asset/:window` are replaced by `/assets` and `/assets/:asset`
- `fusion` payloads are gone
- CLOB training, CLOB prediction, and Polymarket execution logic are gone

What stayed:

- remote `tensorflow-api` training and prediction
- local runtime-state persistence
- built-in dashboard
- `ServiceRuntime` as the public package entrypoint

## Scripts

- `npm run standards:check`
  - project structure and standards verification
- `npm run lint`
  - biome linting
- `npm run format`
  - biome formatting
- `npm run typecheck`
  - TypeScript compile check
- `npm test`
  - node:test suite
- `npm run check`
  - final blocking gate

## Structure

Main folders:

- `src/app`
  - runtime bootstrap
- `src/http`
  - HTTP routes
- `src/dashboard`
  - operator dashboard HTML
- `src/collector`
  - collector client
- `src/snapshot`
  - live real-time snapshot buffer
- `src/model`
  - crypto feature extraction, runtime orchestration, training, and persistence
- `src/tensorflow-api`
  - remote TensorFlow transport and model definition builder
- `test`
  - node:test coverage

## Troubleshooting

### `no trained model available for <asset>`

The service has not completed a successful remote training cycle for that asset yet.

### `insufficient live context for <asset>`

The live buffer does not yet contain enough recent snapshots to build the prediction context window.

### Asset stuck in `waiting`

The next historical 5-minute block is not closed yet, or the collector has not made it available yet.

### Asset in `error`

Check:

- collector availability
- `tensorflow-api` availability
- remote training job errors
- malformed snapshot payloads

### Dashboard shows `pending` predictions for too long

That means the target 30-second window has not yet been fully observed or enough live snapshots are not yet available to resolve it.

## AI Workflow

When changing this repo:

1. read `AGENTS.md`
2. run `npm run standards:check`
3. implement the change
4. run `npm run typecheck`
5. run `npm test`
6. run `npm run check`

When changing runtime behavior, update:

- tests under `test/`
- the dashboard help text
- the `Runtime Flow` and `Configuration` sections in this README
