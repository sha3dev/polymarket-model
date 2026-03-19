import * as assert from "node:assert/strict";
import { test } from "node:test";

import type {
  FlatSnapshot,
  ModelClobArtifact,
  ModelPredictionInput,
  ModelPredictionPayload,
  ModelStatus,
  ModelTrendArtifact,
} from "../src/model/model.types.ts";
import { ModelRuntimeService } from "../src/model/model-runtime.service.ts";
import type { ModelHeadPrediction } from "../src/model/model-runtime.types.ts";

const BUILD_TREND_ARTIFACT = (version: number): ModelTrendArtifact => {
  const trendArtifact: ModelTrendArtifact = {
    trendKey: "btc",
    version,
    trainedAt: "2025-01-01T00:02:00.000Z",
    trainingSampleCount: 24,
    validationSampleCount: 12,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    model: {
      modelPath: `models/trend/btc/v00000${version}`,
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
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 39,
        sequenceLength: 180,
      },
      metrics: {
        regressionMae: 0.01,
        regressionRmse: 0.02,
        regressionHuber: 0.01,
        directionMacroF1: 0.61,
        directionSupport: { up: 4, flat: 3, down: 3 },
        sampleCount: 12,
      },
    },
  };
  return trendArtifact;
};

const BUILD_CLOB_ARTIFACT = (version: number): ModelClobArtifact => {
  const clobArtifact: ModelClobArtifact = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    version,
    trainedAt: "2025-01-01T00:02:00.000Z",
    trainingSampleCount: 24,
    validationSampleCount: 12,
    lastTrainWindowStart: "2024-12-20T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
    model: {
      modelPath: `models/clob/btc_5m/v00000${version}`,
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
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 96,
      },
      metrics: {
        regressionMae: 0.02,
        regressionRmse: 0.03,
        regressionHuber: 0.02,
        directionMacroF1: 0.58,
        directionSupport: { up: 5, flat: 2, down: 3 },
        sampleCount: 12,
      },
    },
  };
  return clobArtifact;
};

const BUILD_STATUS = (): ModelStatus => {
  const modelStatus: ModelStatus = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    state: "ready",
    modelFamily: "tcn",
    version: 1,
    persistedVersion: 1,
    trendModelKey: "btc",
    trendVersion: 1,
    clobVersion: 1,
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
    metrics: {
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
    },
    lastError: null,
  };
  return modelStatus;
};

const BUILD_PREDICTION_INPUT = (): ModelPredictionInput => {
  const predictionInput: ModelPredictionInput = {
    trendInput: {
      trendKey: "btc",
      asset: "btc",
      decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
      latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
      trendSequence: Array.from({ length: 180 }, () => Array.from({ length: 39 }, () => 0)),
      currentChainlinkPrice: 100_100,
      currentExchangePrice: 100_110,
      realizedVolatility30s: 0.02,
      isChainlinkFresh: true,
    },
    clobInput: {
      modelKey: "btc_5m",
      asset: "btc",
      window: "5m",
      decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
      latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
      activeMarket: BUILD_STATUS().activeMarket,
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
    },
  };
  return predictionInput;
};

test("ModelRuntimeService restores split registries and unloads replaced artifacts on retrain", async () => {
  const unloadedTrendKeys: string[] = [];
  const unloadedModelKeys: string[] = [];
  const fakeRuntime = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshots(): Promise<FlatSnapshot[]> {
        return [];
      },
    } as never,
    modelCostService: {
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
          clobEdgeUp: 0.04,
          clobEdgeDown: null,
          feeRateBpsUp: 25,
          feeRateBpsDown: 25,
          estimatedFeeUp: 0.001,
          estimatedFeeDown: 0.001,
          estimatedSlippageUp: 0.01,
          estimatedSlippageDown: 0.01,
          spreadBufferUp: 0.015,
          spreadBufferDown: 0.015,
          vetoes: [],
          reasons: [],
        };
      },
      readTrendFairProbability(): number {
        return 0.58;
      },
    } as never,
    modelFeatureService: {
      buildFeatureNames() {
        return { trendFeatures: ["trend-1"], clobFeatures: ["clob-1"] };
      },
      buildSnapshotContexts() {
        return [];
      },
      buildTrendTrainingSamples(): Array<{ trendKey: "btc"; trendTarget: number }> {
        return [{ trendKey: "btc", trendTarget: 0.01 }] as never;
      },
      buildClobTrainingSamples(): Array<{ modelKey: "btc_5m"; clobTarget: number; clobDirectionTarget: number }> {
        return [{ modelKey: "btc_5m", clobTarget: 0.5, clobDirectionTarget: 0.01 }] as never;
      },
      buildPredictionInput(): ModelPredictionInput {
        return BUILD_PREDICTION_INPUT();
      },
      getRequiredOverlapMs(): number {
        return 0;
      },
      getSequenceLength(_key: string, head: "trend" | "clob"): number {
        return head === "trend" ? 180 : 96;
      },
    } as never,
    modelPersistenceService: {
      getStateDirectoryPath(): string {
        return "/tmp";
      },
      async loadManifest() {
        return {
          schemaVersion: 2,
          lastTrainingCycleAt: "2025-01-01T00:01:00.000Z",
          lastTrainedSnapshotAt: "2025-01-01T00:02:00.000Z",
          trendModels: [{ trendKey: "btc", artifact: BUILD_TREND_ARTIFACT(1) }],
          clobModels: [{ modelKey: "btc_5m", artifact: BUILD_CLOB_ARTIFACT(1), status: BUILD_STATUS() }],
        };
      },
      async persistManifest(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensurePythonRuntime(): Promise<void> {},
      async stop(): Promise<void> {},
      async loadTrend(): Promise<void> {},
      async loadClob(): Promise<void> {},
      async unloadTrend(trendKey: string): Promise<void> {
        unloadedTrendKeys.push(trendKey);
      },
      async unloadClob(modelKey: string): Promise<void> {
        unloadedModelKeys.push(modelKey);
      },
      async trainTrend(): Promise<{ artifact: ModelTrendArtifact; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: BUILD_TREND_ARTIFACT(2), trainingSampleCount: 24, validationSampleCount: 12 };
      },
      async trainClob(): Promise<{ artifact: ModelClobArtifact; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: BUILD_CLOB_ARTIFACT(2), trainingSampleCount: 24, validationSampleCount: 12 };
      },
      async predictTrend(): Promise<ModelHeadPrediction> {
        return { predictedValue: 0.03, probabilities: { up: 0.58, flat: 0.24, down: 0.18 } };
      },
      async predictClob(): Promise<ModelHeadPrediction> {
        return { predictedValue: 0.57, probabilities: { up: 0.62, flat: 0.2, down: 0.18 } };
      },
    } as never,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
      getLiveSnapshots(): FlatSnapshot[] {
        return [{ generated_at: Date.parse("2025-01-01T00:10:00.000Z") }];
      },
      getLatestSnapshotAt(): string {
        return "2025-01-01T00:10:00.000Z";
      },
    } as never,
    supportedAssets: ["btc"],
    supportedWindows: ["5m"],
    trainingIntervalMs: 3_600_000,
  });

  await fakeRuntime.start();
  const predictionPayload = await fakeRuntime.predict({ asset: "btc", window: "5m" });
  const modelStatus = fakeRuntime.getModelStatus("btc", "5m");
  await fakeRuntime.stop();

  assert.equal(predictionPayload.modelKey, "btc_5m");
  assert.equal(modelStatus.trendVersion, 2);
  assert.equal(modelStatus.clobVersion, 2);
  assert.deepEqual(unloadedTrendKeys, ["btc", "btc"]);
  assert.deepEqual(unloadedModelKeys, ["btc_5m", "btc_5m"]);
});
