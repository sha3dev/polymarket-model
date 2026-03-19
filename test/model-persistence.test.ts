import * as assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { ModelClobArtifact, ModelStatus, ModelTrendArtifact } from "../src/model/model.types.ts";
import { ModelPersistenceService } from "../src/model/model-persistence.service.ts";

const BUILD_STATUS = (): ModelStatus => {
  const modelStatus: ModelStatus = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    state: "ready",
    modelFamily: "tcn",
    version: 2,
    persistedVersion: 2,
    trendModelKey: "btc",
    trendVersion: 3,
    clobVersion: 2,
    trendSequenceLength: 180,
    clobSequenceLength: 96,
    trendFeatureCount: 39,
    clobFeatureCount: 48,
    featureCountTrend: 39,
    featureCountClob: 48,
    lastTrainingStartedAt: "2025-01-01T00:00:00.000Z",
    lastTrainingCompletedAt: "2025-01-01T00:01:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    lastRestoredAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 100,
    validationSampleCount: 20,
    latestSnapshotAt: "2025-01-01T00:02:00.000Z",
    liveSnapshotCount: 10,
    activeMarket: {
      slug: "btc-up-5m",
      marketStart: "2025-01-01T00:00:00.000Z",
      marketEnd: "2025-01-01T00:05:00.000Z",
      priceToBeat: 100_000,
      upTokenId: "1",
      downTokenId: "2",
    },
    metrics: {
      trendRegressionMae: 0.01,
      trendRegressionRmse: 0.02,
      trendRegressionHuber: 0.01,
      trendDirectionMacroF1: 0.6,
      trendDirectionSupport: { up: 4, flat: 3, down: 3 },
      clobRegressionMae: 0.02,
      clobRegressionRmse: 0.03,
      clobRegressionHuber: 0.02,
      clobDirectionMacroF1: 0.55,
      clobDirectionSupport: { up: 5, flat: 2, down: 3 },
      sampleCount: 10,
    },
    lastError: null,
  };
  return modelStatus;
};

const BUILD_TREND_ARTIFACT = (): ModelTrendArtifact => {
  const trendArtifact: ModelTrendArtifact = {
    trendKey: "btc",
    version: 3,
    trainedAt: "2025-01-01T00:01:00.000Z",
    trainingSampleCount: 100,
    validationSampleCount: 20,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    model: {
      modelPath: "models/trend/btc/v000003",
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 2, 3],
      directionThreshold: 0.01,
      targetEncoding: "identity",
      architecture: {
        family: "tcn",
        blockCount: 6,
        channelCount: 32,
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 39,
        sequenceLength: 180,
      },
      metrics: {
        regressionMae: 0.01,
        regressionRmse: 0.02,
        regressionHuber: 0.01,
        directionMacroF1: 0.6,
        directionSupport: { up: 4, flat: 3, down: 3 },
        sampleCount: 20,
      },
    },
  };
  return trendArtifact;
};

const BUILD_CLOB_ARTIFACT = (): ModelClobArtifact => {
  const clobArtifact: ModelClobArtifact = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    version: 2,
    trainedAt: "2025-01-01T00:01:00.000Z",
    trainingSampleCount: 100,
    validationSampleCount: 20,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    model: {
      modelPath: "models/clob/btc_5m/v000002",
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 2, 3],
      directionThreshold: 0.02,
      targetEncoding: "logit_probability",
      architecture: {
        family: "tcn",
        blockCount: 5,
        channelCount: 32,
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 96,
      },
      metrics: {
        regressionMae: 0.02,
        regressionRmse: 0.03,
        regressionHuber: 0.02,
        directionMacroF1: 0.55,
        directionSupport: { up: 5, flat: 2, down: 3 },
        sampleCount: 20,
      },
    },
  };
  return clobArtifact;
};

test("ModelPersistenceService persists split trend and clob manifests", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-model-state-"));
  const temporaryDirectoryPath = path.join(stateDirectoryPath, "tmp");
  const modelPersistenceService = new ModelPersistenceService({
    stateDirectoryPath,
    temporaryDirectoryPath,
  });

  await modelPersistenceService.persistManifest(
    [{ trendKey: "btc", artifact: BUILD_TREND_ARTIFACT() }],
    [{ modelKey: "btc_5m", artifact: BUILD_CLOB_ARTIFACT(), status: BUILD_STATUS() }],
    "2025-01-01T00:01:00.000Z",
    "2025-01-01T00:02:00.000Z",
  );

  const loadedManifest = await modelPersistenceService.loadManifest();
  const manifestJson = JSON.parse(await readFile(path.join(stateDirectoryPath, "manifest.json"), "utf8")) as Record<string, unknown>;

  assert.equal(loadedManifest?.schemaVersion, 2);
  assert.equal(loadedManifest?.trendModels[0]?.artifact.trendKey, "btc");
  assert.equal(loadedManifest?.clobModels[0]?.artifact.modelKey, "btc_5m");
  assert.equal(manifestJson.schemaVersion, 2);
});
