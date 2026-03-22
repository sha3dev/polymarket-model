import * as assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { ModelRuntimeStateService } from "../src/model/model-runtime-state.service.ts";

test("ModelRuntimeStateService persists and restores per-asset cursors and prediction history", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-runtime-state-"));
  const modelRuntimeStateService = new ModelRuntimeStateService({
    stateDirectoryPath,
    supportedAssets: ["btc", "eth"],
    temporaryDirectoryPath: path.join(stateDirectoryPath, "tmp"),
  });

  await modelRuntimeStateService.persistState({
    assets: {
      btc: {
        lastCollectorFromAt: "2025-01-01T00:05:00.000Z",
        lastProcessedBlockEndAt: "2025-01-01T00:05:00.000Z",
        lastProcessedBlockStartAt: "2025-01-01T00:00:00.000Z",
        recentPredictionRecords: [],
        rollingPredictionOutcomes: [true, false],
      },
      eth: {
        lastCollectorFromAt: null,
        lastProcessedBlockEndAt: null,
        lastProcessedBlockStartAt: null,
        recentPredictionRecords: [],
        rollingPredictionOutcomes: [],
      },
      sol: {
        lastCollectorFromAt: null,
        lastProcessedBlockEndAt: null,
        lastProcessedBlockStartAt: null,
        recentPredictionRecords: [],
        rollingPredictionOutcomes: [],
      },
      xrp: {
        lastCollectorFromAt: null,
        lastProcessedBlockEndAt: null,
        lastProcessedBlockStartAt: null,
        recentPredictionRecords: [],
        rollingPredictionOutcomes: [],
      },
    },
    lastHistoricalBlockCompletedAt: "2025-01-01T00:05:00.000Z",
    schemaVersion: 2,
  });
  const runtimeStateSnapshot = await modelRuntimeStateService.loadState();

  assert.equal(runtimeStateSnapshot.schemaVersion, 2);
  assert.equal(runtimeStateSnapshot.assets.btc.lastCollectorFromAt, "2025-01-01T00:05:00.000Z");
  assert.deepEqual(runtimeStateSnapshot.assets.btc.rollingPredictionOutcomes, [true, false]);
});

test("ModelRuntimeStateService restores an empty crypto state from legacy manifest", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-runtime-state-"));
  const modelRuntimeStateService = new ModelRuntimeStateService({
    stateDirectoryPath,
    supportedAssets: ["btc", "eth"],
    temporaryDirectoryPath: path.join(stateDirectoryPath, "tmp"),
  });

  await writeFile(
    path.join(stateDirectoryPath, "manifest.json"),
    JSON.stringify(
      {
        clobModels: [],
        lastTrainedSnapshotAt: "2025-01-01T00:02:00.000Z",
        lastTrainingCycleAt: "2025-01-01T00:01:00.000Z",
        schemaVersion: 2,
        trendModels: [],
      },
      null,
      2,
    ),
    "utf8",
  );

  const runtimeStateSnapshot = await modelRuntimeStateService.loadState();

  assert.equal(runtimeStateSnapshot.assets.btc.lastCollectorFromAt, null);
  assert.equal(runtimeStateSnapshot.assets.eth.lastCollectorFromAt, null);
});
