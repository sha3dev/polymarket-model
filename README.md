# @sha3/polymarket-model

Long-running Node service for Polymarket crypto markets. This service owns market data ingestion, feature engineering, walk-forward orchestration, fusion, and the public HTTP API. TensorFlow execution is delegated to a remote `tensorflow-api` service over HTTP.

## TL;DR

```bash
npm install
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

```bash
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/models
curl -X POST http://127.0.0.1:3000/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

## Why

The service is designed for operational continuity:

- restore the latest training cursor after restart;
- rebuild model registries from remote `tensorflow-api` state;
- keep trend models per asset and CLOB models per `asset/window`;
- retrain continuously from historical plus live snapshots;
- expose market-facing prediction and status endpoints without exposing TensorFlow job internals.

## Main Capabilities

- trend head per asset for 30-second Chainlink return forecasting;
- CLOB head per `asset/window` for 30-second-ahead UP midpoint forecasting;
- walk-forward training with embargo;
- local preprocessing and labeling:
  - medians;
  - MAD scaling;
  - direction thresholds;
  - class-balancing sample weights;
- remote TensorFlow training and inference via `tensorflow-api`;
- cost-aware fusion with fees, slippage, spread buffers, and vetoes;
- persistent runtime cursor with `lastTrainingCycleAt` and `lastTrainedSnapshotAt`.

## Setup

The service expects:

- a reachable snapshot collector;
- a reachable `tensorflow-api` deployment;
- access to `@sha3/polymarket-snapshot` for live snapshots;
- a writable directory for `MODEL_STATE_DIR`.

## Installation

```bash
npm install
```

## Running Locally

```bash
SNAPSHOT_COLLECTOR_URL=http://192.168.1.2:3000 \
TENSORFLOW_API_URL=http://192.168.1.2:3100 \
npm run start
```

Run the full verification gate:

```bash
npm run check
```

## Usage

Start the runtime from code:

```ts
import { ServiceRuntime } from "@sha3/polymarket-model";

const runtime = ServiceRuntime.createDefault();
await runtime.startServer();
```

## Examples

Service info:

```bash
curl http://127.0.0.1:3000/
```

Model status:

```bash
curl http://127.0.0.1:3000/models
```

Single-model status:

```bash
curl http://127.0.0.1:3000/models/btc/5m
```

Prediction:

```bash
curl -X POST http://127.0.0.1:3000/predict \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}'
```

## Public API

### `ServiceRuntime`

Primary package entrypoint.

#### `createDefault()`

Builds the default runtime composition.

Behavior:

- wires the collector client;
- wires the live snapshot store;
- wires the feature and preprocessing pipeline;
- wires the remote `tensorflow-api` client;
- wires runtime cursor persistence and the HTTP server.

Returns:

- `ServiceRuntime`

#### `buildServer()`

Builds the HTTP server without binding a TCP port.

Behavior:

- exposes `GET /`;
- exposes `GET /models`;
- exposes `GET /models/:asset/:window`;
- exposes `POST /predict`.

Returns:

- Node server instance compatible with `@hono/node-server`

#### `start()`

Starts the runtime without binding the HTTP listener.

Behavior:

- verifies remote `tensorflow-api` reachability;
- restores the local runtime cursor;
- restores ready remote model registries from `tensorflow-api`;
- starts the live snapshot stream;
- runs the initial training cycle;
- schedules recurring retraining.

Returns:

- `Promise<void>`

#### `startServer()`

Starts the runtime and binds the HTTP server to `config.DEFAULT_PORT`.

Returns:

- server instance returned by `buildServer()`

#### `stop()`

Stops the HTTP listener and runtime resources.

Behavior:

- clears the retraining timer;
- stops the live snapshot stream;
- clears in-memory remote model registries.

Returns:

- `Promise<void>`

### `AppInfoPayload`

Returned by `GET /`.

### `ModelPredictionRequest`

Request body for `POST /predict`.

```ts
type ModelPredictionRequest = {
  asset: "btc" | "eth" | "sol" | "xrp";
  window: "5m" | "15m";
};
```

### `ModelPredictionPayload`

Response body for `POST /predict`.

Important fields:

- `trend.predictedReturn`: 30-second Chainlink return forecast.
- `trend.fairUpProbability`: trend-implied fair UP probability.
- `trend.probabilities`: learned direction probabilities from the trend classification head.
- `clob.predictedUpMid`: predicted 30-second-ahead UP midpoint.
- `clob.probabilities`: learned direction probabilities from the CLOB classification head.
- `fusion.scoreUp` and `fusion.scoreDown`: executable side-aware scores.
- `fusion.shouldTrade`: whether the decision clears all guards.
- `fusion.suggestedSide`: `up`, `down`, or `none`.
- `fusion.mode`: `full` or `clob_only`.
- `fusion.vetoes`: explicit veto reasons.

### `ModelStatus`

Per-market runtime status.

Important fields:

- `state`;
- `version`;
- `persistedVersion`;
- `trendModelKey`;
- `trendVersion`;
- `clobVersion`;
- `trendSequenceLength`;
- `clobSequenceLength`;
- `trendFeatureCount`;
- `clobFeatureCount`;
- `lastTrainingStartedAt`;
- `lastTrainingCompletedAt`;
- `lastValidationWindowStart`;
- `lastValidationWindowEnd`;
- `lastRestoredAt`;
- `trainingSampleCount`;
- `validationSampleCount`;
- `metrics`;
- `lastError`.

### `ModelStatusPayload`

Aggregate response for `GET /models`.

## HTTP API

- `GET /`: service metadata.
- `GET /models`: aggregate market status.
- `GET /models/:asset/:window`: one market status.
- `POST /predict`: live prediction using the in-memory snapshot buffer.

## Runtime Flow

1. Verify `tensorflow-api` is reachable.
2. Load `runtime-state.json` from `MODEL_STATE_DIR`, or fall back to the legacy manifest cursor when present.
3. Restore ready trend and CLOB model registries from `tensorflow-api`.
4. Start the live snapshot stream.
5. Fetch historical snapshots from the snapshot collector.
6. Merge historical and live snapshots.
7. Resample to a canonical 500ms grid and derive snapshot contexts.
8. Build trend samples by asset and CLOB samples by market.
9. Fit preprocessing on training folds only.
10. Queue remote training jobs in `tensorflow-api`.
11. Poll remote jobs to completion.
12. Update remote model metadata and refresh local in-memory registries.
13. Persist only the runtime cursor locally.
14. Serve live predictions using restored or freshly trained remote models.

## Configuration

Every top-level key from [`src/config.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/config.ts) is documented here.

- `RESPONSE_CONTENT_TYPE`: response `content-type` used by the HTTP API.
- `DEFAULT_PORT`: port used by `startServer()`.
- `SERVICE_NAME`: service name returned by `GET /`.
- `MODEL_STATE_PATH`: optional legacy alias for the model state path.
- `MODEL_STATE_DIR`: directory used for runtime cursor persistence.
- `MODEL_STATE_TMP_DIR`: optional override for temporary writes under the state directory.
- `SNAPSHOT_COLLECTOR_URL`: base URL of the snapshot collector.
- `SNAPSHOT_COLLECTOR_CACHE_TTL_MS`: collector client cache TTL for repeated requests.
- `SNAPSHOT_COLLECTOR_PAGE_LIMIT`: page size used while paging historical snapshots.
- `LIVE_SNAPSHOT_INTERVAL_MS`: polling cadence for the live snapshot feed.
- `LIVE_SNAPSHOT_BUFFER_LIMIT`: maximum number of live snapshots kept in memory.
- `MODEL_SUPPORTED_ASSETS`: supported assets, comma-separated in env and parsed into an array.
- `MODEL_SUPPORTED_WINDOWS`: supported market windows, comma-separated in env and parsed into an array.
- `MODEL_HISTORY_LOOKBACK_HOURS`: maximum historical lookback requested from the collector for retraining.
- `MODEL_TRAINING_INTERVAL_MS`: interval between retraining cycles.
- `MODEL_DECISION_INTERVAL_MS`: decision cadence used by the feature pipeline.
- `MODEL_PREDICTION_HORIZON_MS`: forward horizon for targets and overlap logic.
- `MODEL_EMBARGO_MS`: embargo around validation windows.
- `MODEL_CHAINLINK_STALE_MS`: maximum accepted Chainlink staleness.
- `MODEL_POLYMARKET_STALE_MS`: maximum accepted Polymarket book staleness.
- `MODEL_MIN_SAMPLE_COUNT`: minimum training sample count required per head.
- `MODEL_ARTIFACT_RETENTION`: retained for compatibility, currently not used for local artifact storage.
- `MODEL_RESTORE_ON_START`: whether to restore runtime cursor and remote-ready model registries on startup.
- `MODEL_LOG_TRAINING_PROGRESS`: whether to log each completed training block.
- `MODEL_FEE_CACHE_TTL_MS`: TTL for cached fee-rate lookups.
- `MODEL_MAX_SPREAD`: maximum tolerated market spread before veto.
- `MODEL_SPREAD_BUFFER_KAPPA`: spread-buffer multiplier used by fusion.
- `MODEL_FUSION_ALPHA_0`: fusion intercept term.
- `MODEL_FUSION_ALPHA_1`: fusion coefficient for CLOB edge.
- `MODEL_VETO_DOWN_THRESHOLD`: veto threshold for opposite-side direction probability.
- `MODEL_ENABLE_CLOB_ONLY_FALLBACK`: enables `clob_only` mode when fair-value inputs are unavailable.
- `MODEL_TRAIN_WINDOW_DAYS`: walk-forward training window length.
- `MODEL_VALIDATION_WINDOW_DAYS`: walk-forward validation window length.
- `MODEL_CLASSIFICATION_WEIGHT`: retained compatibility knob for model training policy.
- `MODEL_TF_EPOCHS`: epochs sent to remote TensorFlow training.
- `MODEL_TF_BATCH_SIZE`: batch size sent to remote TensorFlow training.
- `MODEL_TF_LEARNING_RATE`: learning rate used in generated remote model definitions.
- `MODEL_TF_EARLY_STOPPING_PATIENCE`: retained compatibility knob for training policy.
- `MODEL_EXECUTION_SIZE`: execution size used for slippage estimation.
- `TENSORFLOW_API_URL`: base URL of the remote `tensorflow-api` service.
- `TENSORFLOW_API_AUTH_TOKEN`: optional bearer token sent to `tensorflow-api`.
- `TENSORFLOW_API_REQUEST_TIMEOUT_MS`: request timeout for remote TensorFlow API calls.
- `TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS`: polling interval for queued remote training jobs.
- `TENSORFLOW_API_TRAIN_TIMEOUT_MS`: hard timeout for remote training job completion.

## Compatibility

- Node.js 20+
- ESM runtime
- remote `tensorflow-api` deployment with:
  - persisted model metadata support;
  - multi-output sample-weight support for training;
  - named multi-output prediction responses

## Scripts

- `npm run start`: start the service with `tsx`
- `npm run build`: compile TypeScript to `dist/`
- `npm run standards:check`: run contract verification
- `npm run lint`: run Biome checks
- `npm run format:check`: verify formatting
- `npm run typecheck`: run TypeScript checks
- `npm run test`: run the Node test suite
- `npm run check`: run the full verification gate

## Structure

- [`src/app/service-runtime.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/app/service-runtime.service.ts): top-level runtime lifecycle
- [`src/http/http-server.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/http/http-server.service.ts): HTTP transport
- [`src/model/model-runtime.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-runtime.service.ts): training/prediction orchestration
- [`src/model/model-training.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-training.service.ts): remote TensorFlow training and prediction client logic
- [`src/model/model-feature.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-feature.service.ts): feature construction and sample building
- [`src/model/model-preprocessing.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-preprocessing.service.ts): local preprocessing, labeling, and validation metrics
- [`src/model/model-runtime-state.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/model/model-runtime-state.service.ts): runtime cursor persistence
- [`src/tensorflow-api/tensorflow-api-client.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/tensorflow-api/tensorflow-api-client.service.ts): remote `tensorflow-api` transport
- [`src/tensorflow-api/tensorflow-api-model-definition.service.ts`](/Users/jc/Documents/GitHub/polymarket-model/src/tensorflow-api/tensorflow-api-model-definition.service.ts): declarative Keras model definition builder

## Troubleshooting

### `tensorflow-api` is unreachable

Check the configured URL:

```bash
curl "$TENSORFLOW_API_URL/"
```

If the service is up but protected, set `TENSORFLOW_API_AUTH_TOKEN`.

### Training jobs time out

Increase `TENSORFLOW_API_TRAIN_TIMEOUT_MS` or inspect the remote service logs and job records.

### Restore finds no ready models

Check `GET /api/models` on `tensorflow-api` and ensure the remote service returns ready models with persisted metadata for:

- `polymarket-model.trend.<asset>`
- `polymarket-model.clob.<asset_window>`

### First training cycle is slow

Reduce:

- `MODEL_HISTORY_LOOKBACK_HOURS`
- `MODEL_TRAIN_WINDOW_DAYS`
- `MODEL_VALIDATION_WINDOW_DAYS`

for local smoke runs.

### Predictions fail with missing model errors

The runtime requires both:

- one ready trend model for the requested asset;
- one ready CLOB model for the requested `asset/window`.

If either is absent, force a training cycle or inspect remote model state.

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the relevant `ai/<assistant>.md` before changing behavior.
- Keep managed files read-only unless the task is explicitly a standards update.
- Update tests, README examples, exported types, and HTTP docs in the same pass as behavior changes.
- Run `npm run standards:check` and `npm run check` before finishing work.
