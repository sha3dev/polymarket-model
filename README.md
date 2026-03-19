# @sha3/polymarket-model

## TL;DR

`@sha3/polymarket-model` is a long-running Node service for Polymarket crypto markets. Node owns the public API and market logic, while a managed local Python TensorFlow child runtime handles model training and inference transparently. The service restores durable model state on restart, keeps the training cursor on disk, and serves predictions from a live in-memory snapshot buffer.

## Main Capabilities

- Dual-head runtime:
  - one `trend` TCN per asset for Chainlink 30-second return forecasting;
  - one `clob` TCN per `asset/window` for 30-second-ahead UP midpoint forecasting.
- Managed Python TensorFlow child process started automatically by the Node parent service.
- Canonical 500ms resampling, 30-second decision cadence, and sequence inputs.
- Shared signal reuse so repeated calculations such as `btc momentum_30s` are computed once per snapshot index.
- Cost-aware fusion with fee-rate lookup, slippage, spread buffers, and veto rules.
- Durable split persistence for trend and CLOB artifacts with manifest-based restore.
- Model status and prediction HTTP endpoints.
- Continuous retraining with persisted `lastTrainedSnapshotAt`.

## Why

The goal is operational continuity. The service is meant to run for months, survive restarts, restore the last durable model state, and continue training from the persisted cursor instead of retraining from scratch.

## Setup

The service expects:

- a running `polymarket-snapshot-collector`;
- access to `@sha3/polymarket-snapshot` for live snapshots;
- a writable local disk for `MODEL_STATE_DIR`;
- macOS or Linux when using the managed Python runtime mode.

## Installation

Install dependencies:

```bash
npm install
```

## Running Locally

Start the service:

```bash
SNAPSHOT_COLLECTOR_URL=http://127.0.0.1:3100 npm run start
```

Bootstrap only the managed Python runtime:

```bash
npm run bootstrap:python
```

Run the full gate:

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

Health:

```bash
curl http://127.0.0.1:3000/
```

Model status:

```bash
curl http://127.0.0.1:3000/models
```

Prediction:

```bash
curl \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"asset":"btc","window":"5m"}' \
  http://127.0.0.1:3000/predict
```

## Public API

### `ServiceRuntime`

Primary package entrypoint.

#### `createDefault()`

Builds the default runtime composition.

Behavior:

- wires the collector client;
- wires the live snapshot store;
- wires the feature pipeline;
- wires the managed Python TensorFlow runtime;
- wires the persistence and HTTP layers.

#### `buildServer()`

Returns the HTTP server without binding a port.

Behavior:

- exposes `GET /`;
- exposes `GET /models`;
- exposes `GET /models/:asset/:window`;
- exposes `POST /predict`.

#### `start()`

Starts the runtime without binding the HTTP server.

Behavior:

- provisions Python on first run when necessary;
- creates or reuses the managed virtual environment;
- installs Python dependencies;
- starts the local Python child runtime;
- restores persisted artifacts and status;
- restores `lastTrainingCycleAt` and `lastTrainedSnapshotAt`;
- starts the live snapshot stream;
- runs the initial training cycle;
- schedules recurring retraining.

#### `startServer()`

Starts the runtime and binds the HTTP server.

Behavior:

- calls `start()`;
- binds `DEFAULT_PORT`;
- logs the listening address.

#### `stop()`

Stops the HTTP server and runtime resources.

Behavior:

- clears the training scheduler;
- stops the live snapshot stream;
- unloads trend and CLOB models from the Python child runtime;
- terminates the Python child runtime;
- closes the HTTP server if it is listening.

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

Prediction response for `POST /predict`.

Important fields:

- `trend.predictedReturn`: 30-second Chainlink return forecast.
- `trend.fairUpProbability`: trend-implied fair UP probability.
- `trend.probabilities`: learned direction probabilities from the classification head.
- `clob.predictedUpMid`: predicted 30-second-ahead UP midpoint.
- `clob.probabilities`: learned direction probabilities from the CLOB classification head.
- `fusion.scoreUp` / `fusion.scoreDown`: cost-aware executable scores by side.
- `fusion.shouldTrade`: whether the decision clears all guards.
- `fusion.mode`: `full` or `clob_only`.
- `fusion.vetoes`: explicit veto reasons.

### `ModelStatus`

Per-model runtime status.

Important fields:

- `state`;
- `version`;
- `persistedVersion`;
- `trendModelKey`;
- `trendVersion`;
- `clobVersion`;
- `modelFamily`;
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

- `GET /`: service health and package identity.
- `GET /models`: aggregate status for every model.
- `GET /models/:asset/:window`: status for one model key.
- `POST /predict`: live inference using the in-memory buffer.

## Runtime Flow

The runtime follows the strategy described in `deep-research.md`.

1. Load `manifest.json` from `MODEL_STATE_DIR`.
2. Start the managed Python child runtime on `127.0.0.1` and wait for `/health`.
3. Restore persisted trend artifacts by asset and CLOB artifacts by `asset/window`.
3. Restore the latest public status snapshot.
4. Restore `lastTrainingCycleAt` and `lastTrainedSnapshotAt`.
5. Start the live snapshot stream.
6. Fetch historical snapshots from `polymarket-snapshot-collector`.
7. Merge historical and live snapshots.
8. Resample to a canonical 500ms grid and forward-fill stateful fields.
9. Build shared snapshot contexts.
10. Compute shared derived signals once per snapshot index.
11. Build CT48 and CB48 sequence inputs.
12. Train one `trend` TCN per asset in Python TensorFlow.
13. Train one `clob` TCN per `asset/window` in Python TensorFlow.
14. Persist successful artifacts to disk.
15. Rewrite the manifest and advance the training cursor.
16. Serve live predictions from restored or freshly trained artifacts.

Historical and live data are not treated as the same dataset. Reuse means sharing derived computations inside a pass, not reusing historical samples as live inference inputs.

## Configuration

Every top-level key from `src/config.ts` is documented here.

- `RESPONSE_CONTENT_TYPE`: HTTP response content type.
- `DEFAULT_PORT`: port used by `startServer()`.
- `SERVICE_NAME`: value returned by the root health endpoint.
- `MODEL_STATE_PATH`: compatibility alias for the state directory.
- `MODEL_STATE_DIR`: root directory for persisted model state.
- `MODEL_STATE_TMP_DIR`: temporary directory used for atomic writes.
- `SNAPSHOT_COLLECTOR_URL`: base URL for `polymarket-snapshot-collector`.
- `SNAPSHOT_COLLECTOR_CACHE_TTL_MS`: short collector request cache TTL.
- `SNAPSHOT_COLLECTOR_PAGE_LIMIT`: pagination size for historical snapshots.
- `LIVE_SNAPSHOT_INTERVAL_MS`: live snapshot interval.
- `LIVE_SNAPSHOT_BUFFER_LIMIT`: in-memory live buffer limit.
- `MODEL_SUPPORTED_ASSETS`: comma-separated supported assets.
- `MODEL_SUPPORTED_WINDOWS`: comma-separated supported windows.
- `MODEL_HISTORY_LOOKBACK_HOURS`: lower bound for historical fetch lookback.
- `MODEL_TRAINING_INTERVAL_MS`: retraining interval.
- `MODEL_DECISION_INTERVAL_MS`: decision cadence.
- `MODEL_PREDICTION_HORIZON_MS`: prediction horizon.
- `MODEL_EMBARGO_MS`: walk-forward embargo.
- `MODEL_CHAINLINK_STALE_MS`: Chainlink freshness threshold.
- `MODEL_POLYMARKET_STALE_MS`: Polymarket order-book freshness threshold.
- `MODEL_MIN_SAMPLE_COUNT`: minimum head sample count before training.
- `MODEL_ARTIFACT_RETENTION`: retained artifact versions per head.
- `MODEL_RESTORE_ON_START`: restore persisted state on startup.
- `MODEL_LOG_TRAINING_PROGRESS`: emit per-block training logs.
- `MODEL_FEE_CACHE_TTL_MS`: fee-rate cache TTL.
- `MODEL_MAX_SPREAD`: maximum spread allowed before veto.
- `MODEL_SPREAD_BUFFER_KAPPA`: spread buffer multiplier.
- `MODEL_FUSION_ALPHA_0`: base fusion weight.
- `MODEL_FUSION_ALPHA_1`: time-to-expiry fusion slope.
- `MODEL_VETO_DOWN_THRESHOLD`: CLOB down-probability veto threshold.
- `MODEL_ENABLE_CLOB_ONLY_FALLBACK`: allow conservative CLOB-only mode when `price_to_beat` is missing.
- `MODEL_EXECUTION_SIZE`: simulated order size used for book-walk slippage and fee estimation.
- `MODEL_TRAIN_WINDOW_DAYS`: trailing training window used for walk-forward splits.
- `MODEL_VALIDATION_WINDOW_DAYS`: validation window used for walk-forward splits.
- `MODEL_CLASSIFICATION_WEIGHT`: classification loss weight relative to regression.
- `MODEL_TF_EPOCHS`: TensorFlow epoch limit.
- `MODEL_TF_BATCH_SIZE`: TensorFlow batch size.
- `MODEL_TF_LEARNING_RATE`: TensorFlow Adam learning rate.
- `MODEL_TF_EARLY_STOPPING_PATIENCE`: TensorFlow early-stopping patience.
- `PYTHON_RUNTIME_MODE`: Python runtime mode. `managed` is the supported default.
- `PYTHON_VERSION`: Python version requested for managed installation.
- `PYTHON_VENV_DIR`: managed Python virtual environment directory.
- `PYTHON_SERVICE_HOST`: bind host for the local Python child runtime.
- `PYTHON_SERVICE_START_TIMEOUT_MS`: health-check timeout while starting Python.
- `PYTHON_SERVICE_STOP_TIMEOUT_MS`: graceful shutdown timeout before force-kill.
- `PYTHON_REQUIREMENTS_PATH`: optional override for the generated Python requirements file.
- `PYTHON_AUTO_INSTALL`: best-effort system installation when `python3` is missing.
- `PYTHON_INSTALL_STRATEGY`: managed installation strategy. `system-package-manager` is the supported default.

## Compatibility

The runtime is designed for:

- Node.js with filesystem access;
- a local Python 3.11-compatible runtime or a supported system package manager;
- live access to `@sha3/polymarket-snapshot`;
- historical access to `polymarket-snapshot-collector`;
- local persistence under `MODEL_STATE_DIR`.

`MODEL_STATE_PATH` remains supported as a compatibility alias for the state directory setting.

## Scripts

- `npm run start`: starts the service.
- `npm run bootstrap:python`: provisions and health-checks the managed Python runtime.
- `npm run build`: builds `dist/`.
- `npm run standards:check`: runs the standards verifier.
- `npm run lint`: runs Biome checks.
- `npm run format:check`: checks formatting.
- `npm run format:write`: writes formatted files.
- `npm run typecheck`: runs TypeScript without emitting files.
- `npm run test`: runs the Node test suite.
- `npm run check`: runs the full blocking gate.

## Structure

- `src/app/`: top-level runtime composition.
- `src/http/`: HTTP server wiring.
- `src/collector/`: historical snapshot client with short caching.
- `src/snapshot/`: live in-memory snapshot buffer.
- `src/model/`: feature extraction, training orchestration, cost model, persistence, and market runtime orchestration.
- `src/python/`: managed Python runtime bootstrap, local HTTP client, and generated Python TensorFlow service templates.
- `test/`: observable behavior tests.

## Troubleshooting

- `409` from `POST /predict`: the model is not restored yet, the live buffer is too short, or the model has not produced a durable artifact.
- Empty or vetoed predictions: inspect `fusion.vetoes` and verify `MODEL_CHAINLINK_STALE_MS` and `MODEL_POLYMARKET_STALE_MS`.
- Missing fee information: the runtime fails closed and returns a no-trade decision when the fee-rate lookup fails.
- Lost restart progress: verify `MODEL_STATE_DIR` is writable and that `manifest.json` is present.
- Repeated collector traffic: confirm `SNAPSHOT_COLLECTOR_CACHE_TTL_MS` is set appropriately.
- Python bootstrap failure on macOS: install Homebrew or provide `python3` manually.
- Python bootstrap failure on Linux: ensure `apt-get`, `dnf`, `yum`, or `apk` is available and the process has install permissions.
- Python child health timeout: inspect startup logs and rerun `npm run bootstrap:python`.

## AI Workflow

This repository is governed by:

- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `prompts/init-contract.md`
- `prompts/refactor-contract.md`

When changing behavior:

1. read the active contract files first;
2. keep managed files read-only unless the task is a standards update;
3. add or update observable tests;
4. run `npm run check` before finishing.
