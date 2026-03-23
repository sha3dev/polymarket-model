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

The realized market outcome is binary:

- `up`
- `down`

The model prediction itself keeps two pieces of information at the same time:

- a continuous forecast called `predictedReturn`
- a direction-confidence split called `predictedProbabilityUp` / `predictedProbabilityDown`

#### How TensorFlow Output Becomes Prediction Confidence

The remote model has two output heads:

1. `regression`
   - one scalar value
   - interpreted as the expected log-return over the target horizon
   - this becomes `predictedReturn`

2. `classification`
   - two raw scores, one for `down` and one for `up`
   - these are logits, not probabilities yet

When `tensorflow-api` returns a prediction, this service decodes it like this:

1. read `outputs.regression[0][0]`
   - this becomes `predictedReturn`
2. read `outputs.classification[0]`
   - this is a two-value vector `[downLogit, upLogit]`
3. apply softmax to those two logits
   - exponentiate both after subtracting the max logit for numerical stability
   - divide each exponential by the sum of both exponentials
4. store the result as:
   - `predictedProbabilityDown`
   - `predictedProbabilityUp`

In plain language:

- if the classification head strongly prefers `up`, `Pred Up` will be close to `1.0`
- if it strongly prefers `down`, `Pred Down` will be close to `1.0`
- if both sides are almost identical, the model is effectively undecided

#### How We Turn Confidence Into `up`, `down`, Or `flat`

The dashboard and prediction record expose a discrete direction in `predictedDirection`.

The rule is:

1. compare `predictedProbabilityUp` vs `predictedProbabilityDown`
2. if the gap is meaningfully positive, choose the larger side:
   - `up` if `predictedProbabilityUp > predictedProbabilityDown`
   - `down` if `predictedProbabilityDown > predictedProbabilityUp`
3. if the gap is effectively zero, mark the prediction as:
   - `flat`

Today, “effectively zero” means the absolute probability gap is at most `0.0005`.

So:

- `up = 0.73`, `down = 0.27` becomes `predictedDirection = "up"`
- `up = 0.41`, `down = 0.59` becomes `predictedDirection = "down"`
- `up = 0.50`, `down = 0.50` becomes `predictedDirection = "flat"`

If for some reason the classification probabilities are missing or malformed, the service falls back to the sign of `predictedReturn`:

- positive return -> `up`
- zero or negative return -> `down`

That fallback is only there as a safety net. Under normal operation, direction comes from the classification probabilities.

#### What `Pred Up` And `Pred Down` Mean In The Dashboard

These values are not market-implied probabilities from an exchange.

They are the model's own directional confidence at the moment the prediction was made.

Examples:

- `Pred = U 0.82`
  - the model assigned about `82%` probability to `up`
- `Pred = D 0.61`
  - the model assigned about `61%` probability to `down`
- `Pred = F 0.50`
  - the model was effectively tied and the discrete prediction is `flat`

#### How Confidence And Return Relate

`predictedReturn` and `predictedDirection` are related, but they are not the same thing:

- `predictedReturn`
  - how large the move is expected to be, in continuous log-return terms
- `predictedDirection`
  - which side the classification head prefers after converting logits to probabilities

This means you should treat:

- `predictedReturn` as the magnitude-style forecast
- `Pred Up / Pred Down` as the confidence-style forecast
- `predictedDirection` as the compact operator-facing label

The service still keeps a probability split:

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

##### Chainlink / reference-price features

- `cl_log_px`
  - natural logarithm of the current Chainlink price
- `cl_stale_s`
  - age of the latest Chainlink update in seconds, capped
- `cl_ret_30s`
  - 30-second Chainlink log-return

##### Exchange vs Chainlink relationship features

- `ex_cl_basis`
  - log difference between aggregated exchange price and Chainlink price
- `ex_cl_basis_chg_5s`
  - how that exchange-vs-Chainlink basis changed over the last 5 seconds

##### Exchange return and momentum features

- `ex_logret_1s`
  - 1-second exchange log-return
- `ex_logret_5s`
  - 5-second exchange log-return
- `ex_logret_15s`
  - 15-second exchange log-return
- `ex_logret_30s`
  - 30-second exchange log-return
- `ex_mom_5s_mean`
  - short momentum-style mean return over the last 5 seconds
- `ex_rv_10s`
  - realized volatility over the last 10 seconds
- `ex_rv_30s`
  - realized volatility over the last 30 seconds
- `ex_ret_accel`
  - simple acceleration term comparing very short return with recent 5-second trend

##### Exchange order-book quality features

- `ex_spread_med`
  - median spread across exchanges
- `ex_spread_wmean`
  - weighted mean spread across exchanges
- `ex_depth3_log`
  - log-transformed aggregated depth near the book
- `ex_imb1_wmean`
  - weighted mean top-level order-book imbalance
- `ex_imb3_wmean`
  - weighted mean 3-level order-book imbalance
- `ex_imb3_chg_5s`
  - how 3-level imbalance changed over the last 5 seconds
- `ex_disp_log`
  - log dispersion across exchange prices
- `ex_disp_chg_5s`
  - 5-second change in exchange-price dispersion
- `ex_best_stale_s`
  - staleness of the freshest exchange source in seconds
- `ex_mean_stale_s`
  - average exchange-source staleness in seconds
- `ex_valid_px_n`
  - number of exchanges contributing a valid price
- `ex_valid_book_n`
  - number of exchanges contributing a valid order book

##### Venue premium features

- `binance_premium`
  - log premium of Binance mid-price vs aggregated exchange price
- `coinbase_premium`
  - log premium of Coinbase mid-price vs aggregated exchange price
- `okx_premium`
  - log premium of OKX mid-price vs aggregated exchange price
- `kraken_premium`
  - log premium of Kraken mid-price vs aggregated exchange price

##### Cross-asset leader and breadth features

- `leader_ret_5s`
  - 5-second return of the configured leader asset for the current asset
- `leader_ret_15s`
  - 15-second return of that leader asset
- `leader_imb3`
  - 3-level book imbalance of that leader asset
- `breadth_ret_5s`
  - average 5-second return across the rest of the supported asset set
- `disp_ret_5s`
  - cross-asset dispersion of recent 5-second returns

##### Shock features

- `btc_shock`
  - normalized short-term BTC move divided by BTC short-term realized volatility
- `eth_shock`
  - normalized short-term ETH move divided by ETH short-term realized volatility

##### Quality and gating flags

- `cl_valid_flag`
  - `1` if Chainlink is currently considered fresh enough, else `0`
- `cl_update_recent_60s`
  - `1` if Chainlink updated within the last 60 seconds, else `0`
- `ex_valid_gate_flag`
  - `1` if at least two exchanges currently contribute valid price data, else `0`

In short, the feature set mixes:

- current reference price state
- recent returns and volatility
- exchange book quality
- exchange-vs-reference dislocations
- cross-asset context
- data quality flags

#### What Is The Target?

For a decision taken at time `T`:

- context uses the 30 seconds immediately before `T`
- target uses the next 30 seconds after `T`

The target return is:

```text
log(price(T + 30s) / price(T))
```

This is a log-return, not a raw USD delta.

That matters because:

- it is unitless
- it scales naturally across assets with very different prices
- it behaves much better numerically than predicting absolute USD moves

Rough intuition:

- a small positive log-return means “price is expected to be a bit higher”
- a small negative log-return means “price is expected to be a bit lower”
- values near zero mean “little expected movement”

Direction label:

- `up` if target return > 0
- `down` otherwise

#### How One Numeric Target Becomes Both Return And Confidence

The important point is:

- the service does **not** convert “we expect +X USD” directly into a probability like `70% up`

Instead, it trains two targets from the same future move:

1. regression target
   - the exact future log-return
   - example: `+0.0018` or `-0.0009`
   - this trains the `regression` head

2. classification target
   - a binary label derived only from the sign of that same log-return
   - `1` for `up`
   - `0` for `down`
   - this trains the `classification` head

So the pipeline is:

1. compute future log-return over the next 30 seconds
2. keep that number as the regression target
3. also collapse its sign into a binary `up/down` label
4. train the model to predict both at the same time

That is why the service can expose:

- `predictedReturn`
  - from the regression head
- `Pred Up` / `Pred Down`
  - from the classification head

Those probabilities are therefore learned directly from many historical examples of:

- feature sequence -> future direction label

They are not produced by taking a USD move and applying an ad hoc formula afterward.

#### What Scale Is Used?

The scale used by the regression target is log-return:

```text
targetReturn = log(price(T + 30s) / price(T))
```

It is **not**:

- raw USD change
- raw percentage string
- z-score

The classification target uses the sign of that same log-return:

- positive -> `up`
- zero or negative -> `down`

#### How `Pred Up` / `Pred Down` Are Learned

During training, the binary direction labels are converted into one-hot vectors:

- `down` -> `[1, 0]`
- `up` -> `[0, 1]`

The classification head outputs two logits:

- one for `down`
- one for `up`

At inference time we apply softmax to those logits, which gives:

- `predictedProbabilityDown`
- `predictedProbabilityUp`

So if the model has seen many past patterns where the same type of feature sequence was followed by upward movement, it learns to push more mass into `Pred Up`.

If it has seen the opposite, it pushes more mass into `Pred Down`.

#### Why Confidence Is Not Expressed In USD

Suppose BTC is at `100,000` and the model predicts a move of `+25 USD`.

That alone does not define a probability, because probability depends on uncertainty, not just expected magnitude.

Two examples can have the same expected move but very different certainty:

- one context may strongly and consistently imply `up`
- another may be noisy, so the model may still think `up` is only slightly more likely than `down`

That is exactly why the service keeps two heads:

- one head for expected move size (`predictedReturn`)
- one head for directional confidence (`Pred Up` / `Pred Down`)

So the answer to “how do we convert expected USD move into confidence?” is:

- we do not
- confidence comes from a separately trained binary classification head
- both heads share the same input features, but they solve different prediction tasks

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
