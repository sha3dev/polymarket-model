import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelPredictionInput, ModelPredictionPayload, ModelStatus } from "../src/model/model.types.ts";
import { ModelRuntimeService } from "../src/model/model-runtime.service.ts";

const BUILD_PREDICTION_INPUT = (): ModelPredictionInput => ({
  clobInput: {
    activeMarket: {
      downTokenId: "2",
      marketEnd: "2025-01-01T00:05:00.000Z",
      marketStart: "2025-01-01T00:00:00.000Z",
      priceToBeat: 100_000,
      slug: "btc-up-5m",
      upTokenId: "1",
    },
    asset: "btc",
    clobSequence: Array.from({ length: 2 }, () => [0]),
    currentChainlinkPrice: 100_000,
    currentDownAsk: 0.49,
    currentDownBid: 0.47,
    currentDownMid: 0.48,
    currentExchangePrice: 100_010,
    currentUpAsk: 0.53,
    currentUpBid: 0.51,
    currentUpMid: 0.52,
    decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
    downAskLevels: [{ price: 0.49, size: 10 }],
    downBidLevels: [{ price: 0.47, size: 10 }],
    downTokenId: "2",
    isChainlinkFresh: true,
    isOrderBookFresh: true,
    latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
    modelKey: "btc_5m",
    realizedVolatility30s: 0.02,
    upAskLevels: [{ price: 0.53, size: 10 }],
    upBidLevels: [{ price: 0.51, size: 10 }],
    upTokenId: "1",
    window: "5m",
  },
  trendInput: {
    asset: "btc",
    currentChainlinkPrice: 100_000,
    currentExchangePrice: 100_010,
    decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
    isChainlinkFresh: true,
    latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
    realizedVolatility30s: 0.02,
    trendKey: "btc",
    trendSequence: Array.from({ length: 2 }, () => [0]),
  },
});

test("ModelRuntimeService restores remote artifacts and serves predictions", async () => {
  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<[]> {
        return [];
      },
      async readSnapshots(): Promise<[]> {
        return [];
      },
    } as never,
    modelCostService: {
      async buildFusionPayload(): Promise<ModelPredictionPayload["fusion"]> {
        return {
          clobEdgeDown: null,
          clobEdgeUp: 0.04,
          estimatedFeeDown: null,
          estimatedFeeUp: 0.001,
          estimatedSlippageDown: null,
          estimatedSlippageUp: 0.01,
          feeRateBpsDown: null,
          feeRateBpsUp: 25,
          mode: "full",
          reasons: ["positive executable edge"],
          scoreDown: null,
          scoreUp: 0.03,
          selectedScore: 0.03,
          shouldTrade: true,
          spreadBufferDown: null,
          spreadBufferUp: 0.015,
          suggestedSide: "up",
          trendEdgeDown: null,
          trendEdgeUp: 0.02,
          vetoes: [],
        };
      },
      readTrendFairProbability(): number {
        return 0.58;
      },
    } as never,
    modelFeatureService: {
      buildClobTrainingSamples(): [] {
        return [];
      },
      buildFeatureNames() {
        return { clobFeatures: ["clob-1"], trendFeatures: ["trend-1"] };
      },
      buildPredictionInput(): ModelPredictionInput {
        return BUILD_PREDICTION_INPUT();
      },
      buildSnapshotContexts(): [] {
        return [];
      },
      buildTrendTrainingSamples(): [] {
        return [];
      },
      getRequiredOverlapMs(): number {
        return 0;
      },
      getSequenceLength(_key: string, head: "trend" | "clob"): number {
        return head === "trend" ? 2 : 2;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState(): Promise<{ lastTrainedSnapshotAt: string; lastTrainingCycleAt: string; schemaVersion: number }> {
        return {
          lastTrainedSnapshotAt: "2025-01-01T00:02:00.000Z",
          lastTrainingCycleAt: "2025-01-01T00:01:00.000Z",
          schemaVersion: 1,
        };
      },
      async persistState(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async predictClob(): Promise<{ predictedValue: number; probabilities: { down: number; flat: number; up: number } }> {
        return { predictedValue: 0.57, probabilities: { down: 0.18, flat: 0.2, up: 0.62 } };
      },
      async predictTrend(): Promise<{ predictedValue: number; probabilities: { down: number; flat: number; up: number } }> {
        return { predictedValue: 0.03, probabilities: { down: 0.18, flat: 0.24, up: 0.58 } };
      },
      async readRemoteModels(): Promise<
        Array<{
          createdAt: string;
          lastPredictionAt: null;
          lastPredictionJobId: null;
          lastTrainingAt: string;
          lastTrainingJobId: string;
          metadata: Record<string, unknown>;
          modelId: string;
          predictionCount: number;
          status: "ready";
          trainingCount: number;
          updatedAt: string;
        }>
      > {
        return [
          {
            createdAt: "2025-01-01T00:00:00.000Z",
            lastPredictionAt: null,
            lastPredictionJobId: null,
            lastTrainingAt: "2025-01-01T00:10:00.000Z",
            lastTrainingJobId: "job-1",
            metadata: {
              architecture: { blockCount: 6, channelCount: 32, dilations: [1, 2], dropout: 0.1, family: "tcn", featureCount: 1, sequenceLength: 2 },
              classWeights: [1, 1, 1],
              directionThreshold: 0.01,
              featureMedians: [0],
              featureNames: ["trend-1"],
              featureScales: [1],
              lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
              lastTrainWindowStart: "2024-12-31T00:00:00.000Z",
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc",
              logicalModelType: "trend",
              metrics: {
                directionMacroF1: 0.6,
                directionSupport: { down: 1, flat: 1, up: 1 },
                regressionHuber: 0.01,
                regressionMae: 0.01,
                regressionRmse: 0.02,
                sampleCount: 3,
              },
              targetEncoding: "identity",
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_trend_btc",
            predictionCount: 0,
            status: "ready",
            trainingCount: 3,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
          {
            createdAt: "2025-01-01T00:00:00.000Z",
            lastPredictionAt: null,
            lastPredictionJobId: null,
            lastTrainingAt: "2025-01-01T00:10:00.000Z",
            lastTrainingJobId: "job-2",
            metadata: {
              architecture: { blockCount: 5, channelCount: 32, dilations: [1, 2], dropout: 0.1, family: "tcn", featureCount: 1, sequenceLength: 2 },
              classWeights: [1, 1, 1],
              directionThreshold: 0.02,
              featureMedians: [0],
              featureNames: ["clob-1"],
              featureScales: [1],
              lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
              lastTrainWindowStart: "2024-12-31T00:00:00.000Z",
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc_5m",
              logicalModelType: "clob",
              metrics: {
                directionMacroF1: 0.55,
                directionSupport: { down: 1, flat: 1, up: 1 },
                regressionHuber: 0.02,
                regressionMae: 0.02,
                regressionRmse: 0.03,
                sampleCount: 3,
              },
              targetEncoding: "logit_probability",
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_clob_btc_5m",
            predictionCount: 0,
            status: "ready",
            trainingCount: 2,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
        ];
      },
      async trainClob(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
      async trainTrend(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      getLatestSnapshotAt(): string {
        return "2025-01-01T00:10:00.000Z";
      },
      getLiveSnapshots(): [] {
        return [];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
    supportedWindows: ["5m"],
    trainingIntervalMs: 60_000,
  });

  await modelRuntimeService.start();
  const modelStatus: ModelStatus = modelRuntimeService.getModelStatus("btc", "5m");
  const predictionPayload = await modelRuntimeService.predict({ asset: "btc", window: "5m" });
  await modelRuntimeService.stop();

  assert.equal(modelStatus.trendVersion, 3);
  assert.equal(modelStatus.clobVersion, 2);
  assert.equal(modelStatus.headVersionSkew, true);
  assert.equal(predictionPayload.trend.predictedReturn, 0.03);
  assert.equal(predictionPayload.clob.predictedUpMid, 0.57);
  assert.equal(predictionPayload.fusion.suggestedSide, "up");
});

test("ModelRuntimeService scheduled wrapper does not leak unexpected cycle failures", async () => {
  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<[]> {
        return [];
      },
      async readSnapshots(): Promise<[]> {
        return [];
      },
    } as never,
    modelCostService: {
      async buildFusionPayload(): Promise<ModelPredictionPayload["fusion"]> {
        throw new Error("not used");
      },
      readTrendFairProbability(): number {
        return 0;
      },
    } as never,
    modelFeatureService: {
      buildClobTrainingSamples(): [] {
        return [];
      },
      buildFeatureNames() {
        return { clobFeatures: ["clob-1"], trendFeatures: ["trend-1"] };
      },
      buildPredictionInput(): ModelPredictionInput {
        return BUILD_PREDICTION_INPUT();
      },
      buildSnapshotContexts(): [] {
        return [];
      },
      buildTrendTrainingSamples(): [] {
        return [];
      },
      getRequiredOverlapMs(): number {
        return 0;
      },
      getSequenceLength(_key: string, _head: "trend" | "clob"): number {
        return 2;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState(): Promise<{ lastTrainedSnapshotAt: string | null; lastTrainingCycleAt: string | null; schemaVersion: number }> {
        return { lastTrainedSnapshotAt: null, lastTrainingCycleAt: null, schemaVersion: 1 };
      },
      async persistState(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async readRemoteModels(): Promise<[]> {
        return [];
      },
      async trainClob(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
      async trainTrend(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: false,
    snapshotStoreService: {
      getLatestSnapshotAt(): null {
        return null;
      },
      getLiveSnapshots(): [] {
        return [];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
    supportedWindows: ["5m"],
    trainingIntervalMs: 60_000,
  });
  const runtimeRecord = modelRuntimeService as unknown as Record<string, unknown>;
  Object.defineProperty(runtimeRecord, "runTrainingCycle", {
    configurable: true,
    value: async (): Promise<void> => {
      throw new Error("outer scheduler failure");
    },
  });
  const scheduledTrainingMethod = runtimeRecord.runScheduledTrainingCycle as (() => Promise<void>) | undefined;

  assert.notEqual(scheduledTrainingMethod, undefined);
  await assert.doesNotReject(async () => scheduledTrainingMethod?.call(runtimeRecord));
});
