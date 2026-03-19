import * as assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { LayersModel } from "@tensorflow/tfjs-node";

import type { ModelMetrics, ModelStatus } from "../src/model/model.types.ts";
import { ModelPersistenceService } from "../src/model/model-persistence.service.ts";
import type { ModelArtifactCandidate } from "../src/model/model-runtime.types.ts";

const BUILD_METRICS = (): ModelMetrics => {
  const modelMetrics: ModelMetrics = {
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
  };
  return modelMetrics;
};

const BUILD_SAVEABLE_MODEL = (): LayersModel => {
  const saveableModel = {
    async save(url: string): Promise<void> {
      const directoryPath = url.replace("file://", "");
      await mkdir(directoryPath, { recursive: true });
      await Promise.all([
        writeFile(path.join(directoryPath, "model.json"), JSON.stringify({ format: "layers-model" }), "utf8"),
        writeFile(path.join(directoryPath, "weights.bin"), "weights", "utf8"),
      ]);
    },
    dispose(): void {},
  } as unknown as LayersModel;
  return saveableModel;
};

const BUILD_ARTIFACT_CANDIDATE = (version: number): ModelArtifactCandidate => {
  const artifactCandidate: ModelArtifactCandidate = {
    version,
    trainedAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 100,
    validationSampleCount: 20,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    metrics: BUILD_METRICS(),
    trendModel: {
      architecture: {
        family: "tcn",
        blockCount: 6,
        channelCount: 32,
        dilations: [1, 2, 4, 8, 16, 32],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 128,
      },
      classWeights: [1, 2, 3],
      directionThreshold: 0.01,
      featureMedians: [0],
      featureNames: ["feature-1"],
      featureScales: [1],
      targetEncoding: "identity",
      model: BUILD_SAVEABLE_MODEL(),
    },
    clobModel: {
      architecture: {
        family: "tcn",
        blockCount: 5,
        channelCount: 32,
        dilations: [1, 2, 4, 8, 16],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 96,
      },
      classWeights: [1, 2, 3],
      directionThreshold: 0.02,
      featureMedians: [0],
      featureNames: ["feature-1"],
      featureScales: [1],
      targetEncoding: "logit_probability",
      model: BUILD_SAVEABLE_MODEL(),
    },
  };
  return artifactCandidate;
};

const BUILD_STATUS = (): ModelStatus => {
  const modelStatus: ModelStatus = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    state: "ready",
    modelFamily: "tcn",
    version: 2,
    persistedVersion: 2,
    trendSequenceLength: 128,
    clobSequenceLength: 96,
    featureCountTrend: 48,
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
    metrics: BUILD_METRICS(),
    lastError: null,
  };
  return modelStatus;
};

test("ModelPersistenceService persists versioned tensorflow artifacts and manifests", async () => {
  const stateDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "polymarket-model-state-"));
  const temporaryDirectoryPath = path.join(stateDirectoryPath, "tmp");
  const modelPersistenceService = new ModelPersistenceService({
    stateDirectoryPath,
    temporaryDirectoryPath,
    artifactRetention: 1,
  });

  const firstPersistenceResult = await modelPersistenceService.persistModelArtifact("btc_5m", BUILD_ARTIFACT_CANDIDATE(1));
  const secondPersistenceResult = await modelPersistenceService.persistModelArtifact("btc_5m", BUILD_ARTIFACT_CANDIDATE(2));
  await modelPersistenceService.persistManifest(
    [
      {
        modelKey: "btc_5m",
        artifact: secondPersistenceResult.artifact,
        status: BUILD_STATUS(),
      },
    ],
    "2025-01-01T00:01:00.000Z",
    "2025-01-01T00:02:00.000Z",
  );

  const loadedManifest = await modelPersistenceService.loadManifest();
  const trendModelPath = path.join(stateDirectoryPath, secondPersistenceResult.artifact.trendModel.modelPath, "model.json");
  const firstTrendModelPath = path.join(stateDirectoryPath, firstPersistenceResult.artifact.trendModel.modelPath, "model.json");
  const trendMetadataPath = path.join(stateDirectoryPath, secondPersistenceResult.artifact.trendModel.modelPath, "preprocessing.json");
  const architecturePath = path.join(stateDirectoryPath, secondPersistenceResult.artifact.trendModel.modelPath, "architecture.json");
  const trendMetadata = JSON.parse(await readFile(trendMetadataPath, "utf8")) as Record<string, unknown>;
  const architecture = JSON.parse(await readFile(architecturePath, "utf8")) as Record<string, unknown>;

  assert.equal(loadedManifest?.schemaVersion, 1);
  assert.equal(loadedManifest?.models[0]?.artifact.version, 2);
  assert.equal(await readFile(trendModelPath, "utf8"), JSON.stringify({ format: "layers-model" }));
  assert.deepEqual(trendMetadata, {
    classWeights: [1, 2, 3],
    directionThreshold: 0.01,
    featureMedians: [0],
    featureNames: ["feature-1"],
    featureScales: [1],
    targetEncoding: "identity",
  });
  assert.deepEqual(architecture, {
    family: "tcn",
    blockCount: 6,
    channelCount: 32,
    dilations: [1, 2, 4, 8, 16, 32],
    dropout: 0.1,
    featureCount: 48,
    sequenceLength: 128,
  });
  await assert.rejects(async () => readFile(firstTrendModelPath, "utf8"));
});
