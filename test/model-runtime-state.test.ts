import * as assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { ModelRuntimeStateService } from "../src/model/model-runtime-state.service.ts";

test("ModelRuntimeStateService persists and restores runtime cursor state", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-runtime-state-"));
  const modelRuntimeStateService = new ModelRuntimeStateService({
    stateDirectoryPath,
    temporaryDirectoryPath: path.join(stateDirectoryPath, "tmp"),
  });

  await modelRuntimeStateService.persistState("2025-01-01T00:01:00.000Z", "2025-01-01T00:02:00.000Z");
  const runtimeStateSnapshot = await modelRuntimeStateService.loadState();

  assert.equal(runtimeStateSnapshot.schemaVersion, 1);
  assert.equal(runtimeStateSnapshot.lastTrainingCycleAt, "2025-01-01T00:01:00.000Z");
  assert.equal(runtimeStateSnapshot.lastTrainedSnapshotAt, "2025-01-01T00:02:00.000Z");
});

test("ModelRuntimeStateService restores cursor fields from legacy manifest without model inventory", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-runtime-state-"));
  const modelRuntimeStateService = new ModelRuntimeStateService({
    stateDirectoryPath,
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

  assert.equal(runtimeStateSnapshot.lastTrainingCycleAt, "2025-01-01T00:01:00.000Z");
  assert.equal(runtimeStateSnapshot.lastTrainedSnapshotAt, "2025-01-01T00:02:00.000Z");
});
