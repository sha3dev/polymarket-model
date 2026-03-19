import * as assert from "node:assert/strict";
import { test } from "node:test";

import type {
  FlatSnapshot,
  ModelArtifact,
  ModelFeatureInput,
  ModelMetrics,
  ModelPersistenceSnapshot,
  ModelPredictionPayload,
  ModelSequenceSample,
  ModelStatus,
} from "../src/model/model.types.ts";
import { ModelRuntimeService } from "../src/model/model-runtime.service.ts";
import type { ModelArtifactCandidate, ModelLoadedArtifact } from "../src/model/model-runtime.types.ts";

const BUILD_METRICS = (): ModelMetrics => {
  const modelMetrics: ModelMetrics = {
    trendRegressionMae: 0.01,
    trendRegressionRmse: 0.02,
    trendRegressionHuber: 0.01,
    trendDirectionMacroF1: 0.61,
    trendDirectionSupport: { up: 4, flat: 3, down: 3 },
    clobRegressionMae: 0.02,
    clobRegressionRmse: 0.03,
    clobRegressionHuber: 0.02,
    clobDirectionMacroF1: 0.58,
    clobDirectionSupport: { up: 5, flat: 2, down: 3 },
    sampleCount: 12,
  };
  return modelMetrics;
};

const BUILD_ARTIFACT = (version: number): ModelArtifact => {
  const modelArtifact: ModelArtifact = {
    version,
    trainedAt: "2025-01-01T00:01:00.000Z",
    trainingSampleCount: 24,
    validationSampleCount: 12,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    metrics: BUILD_METRICS(),
    trendModel: {
      modelPath: `models/btc_5m/trend/v00000${version}`,
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 1, 1],
      directionThreshold: 0.01,
      targetEncoding: "identity",
      architecture: {
        family: "tcn",
        blockCount: 6,
        channelCount: 32,
        dilations: [1, 2, 4, 8, 16, 32],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 128,
      },
    },
    clobModel: {
      modelPath: `models/btc_5m/clob/v00000${version}`,
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 1, 1],
      directionThreshold: 0.02,
      targetEncoding: "logit_probability",
      architecture: {
        family: "tcn",
        blockCount: 5,
        channelCount: 32,
        dilations: [1, 2, 4, 8, 16],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 96,
      },
    },
  };
  return modelArtifact;
};

const BUILD_STATUS = (version: number): ModelStatus => {
  const modelStatus: ModelStatus = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    state: "ready",
    modelFamily: "tcn",
    version,
    persistedVersion: version,
    trendSequenceLength: 128,
    clobSequenceLength: 96,
    featureCountTrend: 48,
    featureCountClob: 48,
    lastTrainingStartedAt: "2025-01-01T00:00:00.000Z",
    lastTrainingCompletedAt: "2025-01-01T00:01:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    lastRestoredAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 24,
    validationSampleCount: 12,
    latestSnapshotAt: "2025-01-01T00:02:00.000Z",
    liveSnapshotCount: 4,
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

const BUILD_LOADED_ARTIFACT = (version: number): ModelLoadedArtifact => {
  const loadedArtifact: ModelLoadedArtifact = {
    ...BUILD_ARTIFACT(version),
    trendModel: {
      metadata: BUILD_ARTIFACT(version).trendModel,
      model: {
        dispose(): void {},
      } as never,
    },
    clobModel: {
      metadata: BUILD_ARTIFACT(version).clobModel,
      model: {
        dispose(): void {},
      } as never,
    },
  };
  return loadedArtifact;
};

const BUILD_ARTIFACT_CANDIDATE = (): ModelArtifactCandidate => {
  const modelArtifactCandidate: ModelArtifactCandidate = {
    version: 2,
    trainedAt: "2025-01-01T00:02:00.000Z",
    trainingSampleCount: 24,
    validationSampleCount: 12,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    metrics: BUILD_METRICS(),
    trendModel: {
      architecture: BUILD_ARTIFACT(2).trendModel.architecture,
      classWeights: [1, 1, 1],
      directionThreshold: 0.01,
      featureMedians: [0],
      featureNames: ["feature-1"],
      featureScales: [1],
      targetEncoding: "identity",
      model: {
        dispose(): void {},
        async save(): Promise<void> {},
      } as never,
    },
    clobModel: {
      architecture: BUILD_ARTIFACT(2).clobModel.architecture,
      classWeights: [1, 1, 1],
      directionThreshold: 0.02,
      featureMedians: [0],
      featureNames: ["feature-1"],
      featureScales: [1],
      targetEncoding: "logit_probability",
      model: {
        dispose(): void {},
        async save(): Promise<void> {},
      } as never,
    },
  };
  return modelArtifactCandidate;
};

const BUILD_TRAINING_SAMPLE = (): ModelSequenceSample => {
  const modelSequenceSample: ModelSequenceSample = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
    latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
    activeMarket: BUILD_STATUS(1).activeMarket,
    trendSequence: Array.from({ length: 128 }, () => Array.from({ length: 48 }, () => 0)),
    clobSequence: Array.from({ length: 96 }, () => Array.from({ length: 48 }, () => 0)),
    currentUpMid: 0.52,
    currentUpBid: 0.51,
    currentUpAsk: 0.53,
    currentDownMid: 0.48,
    currentDownBid: 0.47,
    currentDownAsk: 0.49,
    currentChainlinkPrice: 100_100,
    currentExchangePrice: 100_110,
    realizedVolatility30s: 0.02,
    isChainlinkFresh: true,
    isOrderBookFresh: true,
    upTokenId: "1",
    downTokenId: "2",
    upBidLevels: [{ price: 0.51, size: 100 }],
    upAskLevels: [{ price: 0.53, size: 100 }],
    downBidLevels: [{ price: 0.47, size: 100 }],
    downAskLevels: [{ price: 0.49, size: 100 }],
    trendTarget: 0.01,
    clobTarget: 0.56,
    clobDirectionTarget: 0.04,
  };
  return modelSequenceSample;
};

test("ModelRuntimeService restores persisted progress, advances the cursor, and serves predictions", async () => {
  const persistedManifestSnapshots: Array<{
    lastTrainingCycleAt: string | null;
    lastTrainedSnapshotAt: string | null;
    models: ModelPersistenceSnapshot["models"];
  }> = [];
  const capturedFromDates: string[] = [];
  const predictionInput: ModelFeatureInput = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
    latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
    activeMarket: BUILD_STATUS(1).activeMarket,
    trendSequence: Array.from({ length: 128 }, () => Array.from({ length: 48 }, () => 0)),
    clobSequence: Array.from({ length: 96 }, () => Array.from({ length: 48 }, () => 0)),
    currentUpMid: 0.52,
    currentUpBid: 0.51,
    currentUpAsk: 0.53,
    currentDownMid: 0.48,
    currentDownBid: 0.47,
    currentDownAsk: 0.49,
    currentChainlinkPrice: 100_100,
    currentExchangePrice: 100_110,
    realizedVolatility30s: 0.02,
    isChainlinkFresh: true,
    isOrderBookFresh: true,
    upTokenId: "1",
    downTokenId: "2",
    upBidLevels: [{ price: 0.51, size: 100 }],
    upAskLevels: [{ price: 0.53, size: 100 }],
    downBidLevels: [{ price: 0.47, size: 100 }],
    downAskLevels: [{ price: 0.49, size: 100 }],
  };
  const fakeSnapshotStoreService = {
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    getLiveSnapshots(): FlatSnapshot[] {
      return [{ generated_at: Date.parse("2025-01-01T00:10:00.000Z") }];
    },
    getLatestSnapshotAt(): string | null {
      return "2025-01-01T00:10:00.000Z";
    },
  };
  const fakeFeatureService = {
    buildFeatureNames() {
      return {
        trendFeatures: Array.from({ length: 48 }, (_, index) => `ct-${index}`),
        clobFeatures: Array.from({ length: 48 }, (_, index) => `cb-${index}`),
      };
    },
    getSequenceLength(): number {
      return 128;
    },
    getRequiredOverlapMs(): number {
      return 180_000;
    },
    buildSnapshotContexts() {
      return [
        {
          generatedAt: Date.parse("2025-01-01T00:10:00.000Z"),
          assetContexts: {
            btc: {} as never,
            eth: {} as never,
            sol: {} as never,
            xrp: {} as never,
          },
          marketContexts: {
            btc_5m: { activeMarket: BUILD_STATUS(1).activeMarket },
            btc_15m: { activeMarket: null },
            eth_5m: { activeMarket: null },
            eth_15m: { activeMarket: null },
            sol_5m: { activeMarket: null },
            sol_15m: { activeMarket: null },
            xrp_5m: { activeMarket: null },
            xrp_15m: { activeMarket: null },
          },
        },
      ];
    },
    buildTrainingSamples(): ModelSequenceSample[] {
      return [BUILD_TRAINING_SAMPLE()];
    },
    buildPredictionInput(): ModelFeatureInput {
      return predictionInput;
    },
  };
  const fakeTensorflowModelService = {
    async loadArtifact(): Promise<ModelLoadedArtifact> {
      return BUILD_LOADED_ARTIFACT(1);
    },
    disposeArtifact(): void {},
    async train(): Promise<{ artifact: ModelArtifactCandidate; trainingSampleCount: number; validationSampleCount: number }> {
      return {
        artifact: BUILD_ARTIFACT_CANDIDATE(),
        trainingSampleCount: 24,
        validationSampleCount: 12,
      };
    },
    predict(): {
      trend: { predictedValue: number; probabilities: ModelPredictionPayload["trend"]["probabilities"] };
      clob: { predictedValue: number; probabilities: ModelPredictionPayload["clob"]["probabilities"] };
    } {
      return {
        trend: {
          predictedValue: 0.02,
          probabilities: { up: 0.6, flat: 0.25, down: 0.15 },
        },
        clob: {
          predictedValue: 0.57,
          probabilities: { up: 0.62, flat: 0.2, down: 0.18 },
        },
      };
    },
  };
  const fakeCollectorClientService = {
    async readSnapshots(options: { fromDate: string }): Promise<FlatSnapshot[]> {
      capturedFromDates.push(options.fromDate);
      return [{ generated_at: Date.parse("2025-01-01T00:09:55.000Z") }];
    },
  };
  const fakePersistenceService = {
    async loadManifest(): Promise<ModelPersistenceSnapshot> {
      return {
        schemaVersion: 1,
        lastTrainingCycleAt: "2025-01-01T00:01:00.000Z",
        lastTrainedSnapshotAt: "2025-01-01T00:08:30.000Z",
        models: [
          {
            modelKey: "btc_5m",
            artifact: BUILD_ARTIFACT(1),
            status: BUILD_STATUS(1),
          },
        ],
      };
    },
    async persistModelArtifact(): Promise<{ artifact: ModelArtifact; loadedArtifact: ModelLoadedArtifact }> {
      return {
        artifact: BUILD_ARTIFACT(2),
        loadedArtifact: BUILD_LOADED_ARTIFACT(2),
      };
    },
    async persistManifest(models: ModelPersistenceSnapshot["models"], lastTrainingCycleAt: string | null, lastTrainedSnapshotAt: string | null): Promise<void> {
      persistedManifestSnapshots.push({
        lastTrainingCycleAt,
        lastTrainedSnapshotAt,
        models,
      });
    },
    getStateDirectoryPath(): string {
      return "/tmp/model-state";
    },
  };
  const fakeCostService = {
    async buildFusionPayload(): Promise<ModelPredictionPayload["fusion"]> {
      return {
        scoreUp: 0.03,
        scoreDown: null,
        selectedScore: 0.03,
        shouldTrade: true,
        suggestedSide: "up",
        mode: "full",
        trendEdgeUp: 0.02,
        trendEdgeDown: null,
        clobEdgeUp: 0.05,
        clobEdgeDown: null,
        feeRateBpsUp: 25,
        feeRateBpsDown: null,
        estimatedFeeUp: 0.004,
        estimatedFeeDown: null,
        estimatedSlippageUp: 0.01,
        estimatedSlippageDown: null,
        spreadBufferUp: 0.015,
        spreadBufferDown: null,
        vetoes: [],
        reasons: ["positive executable edge"],
      };
    },
    readTrendFairProbability(): number {
      return 0.58;
    },
  };

  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: fakeCollectorClientService as never,
    modelCostService: fakeCostService as never,
    modelFeatureService: fakeFeatureService as never,
    modelPersistenceService: fakePersistenceService as never,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: fakeSnapshotStoreService as never,
    supportedAssets: ["btc"],
    supportedWindows: ["5m"],
    tensorflowModelService: fakeTensorflowModelService as never,
    trainingIntervalMs: 60_000,
  });

  await modelRuntimeService.start();
  const predictionPayload = await modelRuntimeService.predict({ asset: "btc", window: "5m" });
  const modelStatus = modelRuntimeService.getModelStatus("btc", "5m");
  await modelRuntimeService.stop();

  assert.equal(capturedFromDates.length, 1);
  assert.equal(modelStatus.version, 2);
  assert.equal(predictionPayload.fusion.shouldTrade, true);
  assert.equal(predictionPayload.trend.fairUpProbability, 0.58);
  assert.equal(persistedManifestSnapshots.length, 1);
  assert.equal(persistedManifestSnapshots[0]?.models[0]?.artifact.version, 2);
  assert.equal(persistedManifestSnapshots[0]?.lastTrainedSnapshotAt, "2025-01-01T00:10:00.000Z");
});
