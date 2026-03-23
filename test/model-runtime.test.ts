import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelPredictionPayload, ModelStatus } from "../src/model/model.types.ts";
import { ModelRuntimeService } from "../src/model/model-runtime.service.ts";

test("ModelRuntimeService restores remote crypto artifacts and serves live manual predictions", async () => {
  let persistedStateCount = 0;
  const recentResolvedAt = new Date(Date.now() - 60_000).toISOString();
  const staleResolvedAt = new Date(Date.now() - 10_800_000).toISOString();
  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<[]> {
        return [];
      },
      async readSnapshots(): Promise<[]> {
        return [];
      },
    } as never,
    modelFeatureService: {
      buildFeatureNames() {
        return { cryptoFeatures: ["crypto-1"] };
      },
      buildLivePredictionSnapshots(snapshots: unknown[]) {
        return snapshots as never;
      },
      buildPredictionInput(): {
        asset: "btc";
        cryptoSequence: number[][];
        currentChainlinkPrice: number;
        currentExchangePrice: number;
        decisionTime: number;
        isChainlinkFresh: true;
        latestSnapshotAt: number;
        realizedVolatility30s: number;
      } {
        return {
          asset: "btc",
          cryptoSequence: Array.from({ length: 2 }, () => [0]),
          currentChainlinkPrice: 100_000,
          currentExchangePrice: 100_010,
          decisionTime: Date.parse("2025-01-01T00:10:00.000Z"),
          isChainlinkFresh: true,
          latestSnapshotAt: Date.parse("2025-01-01T00:10:00.000Z"),
          realizedVolatility30s: 0.02,
        };
      },
      buildTrainingSamples(): [] {
        return [];
      },
      getBlockDurationMs(): number {
        return 300_000;
      },
      getPredictionTargetMs(): number {
        return 30_000;
      },
      readReferenceValue(): number {
        return 100_100;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState(): Promise<{
        assets: {
          btc: {
            lastCollectorFromAt: null;
            lastProcessedBlockEndAt: null;
            lastProcessedBlockStartAt: null;
            recentPredictionRecords: Array<{
              actualDirection: null;
              actualReturn: null;
              asset: "btc";
              contextEndAt: string;
              contextStartAt: string;
              downValueAtPrediction: number;
              downValueAtTargetEnd: null;
              errorMessage: null;
              isCorrect: null;
              issuedAt: string;
              predictedDirection: "up";
              predictedProbabilityDown: number;
              predictedProbabilityUp: number;
              predictedReturn: number;
              predictionId: string;
              referenceValueAtPrediction: number;
              referenceValueAtTargetEnd: null;
              resolvedAt: null;
              source: "manual";
              status: "pending";
              targetEndAt: string;
              targetStartAt: string;
              upValueAtPrediction: number;
              upValueAtTargetEnd: null;
            }>;
            rollingPredictionOutcomes: Array<{ isCorrect: boolean; resolvedAt: string }>;
          };
        };
        lastHistoricalBlockCompletedAt: string | null;
        schemaVersion: number;
      }> {
        return {
          assets: {
            btc: {
              lastCollectorFromAt: null,
              lastProcessedBlockEndAt: null,
              lastProcessedBlockStartAt: null,
              recentPredictionRecords: [
                {
                  actualDirection: null,
                  actualReturn: null,
                  asset: "btc",
                  contextEndAt: "2025-01-01T00:09:30.000Z",
                  contextStartAt: "2025-01-01T00:09:00.000Z",
                  downValueAtPrediction: 0.42,
                  downValueAtTargetEnd: null,
                  errorMessage: null,
                  isCorrect: null,
                  issuedAt: "2025-01-01T00:09:30.000Z",
                  predictedDirection: "up",
                  predictedProbabilityDown: 0.42,
                  predictedProbabilityUp: 0.58,
                  predictedReturn: 0.01,
                  predictionId: "persisted-prediction-1",
                  referenceValueAtPrediction: 100_000,
                  referenceValueAtTargetEnd: null,
                  resolvedAt: null,
                  source: "manual",
                  status: "pending",
                  targetEndAt: "2025-01-01T00:10:00.000Z",
                  targetStartAt: "2025-01-01T00:09:30.000Z",
                  upValueAtPrediction: 0.58,
                  upValueAtTargetEnd: null,
                },
              ],
              rollingPredictionOutcomes: [
                { isCorrect: true, resolvedAt: recentResolvedAt },
                { isCorrect: false, resolvedAt: staleResolvedAt },
              ],
            },
          },
          lastHistoricalBlockCompletedAt: null,
          schemaVersion: 2,
        };
      },
      async persistState(): Promise<void> {
        persistedStateCount += 1;
      },
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async predictAsset(): Promise<{ predictedDirection: "flat"; predictedProbability: { down: number; up: number }; predictedReturn: number }> {
        return {
          predictedDirection: "flat",
          predictedProbability: { down: 0.5, up: 0.5 },
          predictedReturn: 0,
        };
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
              classWeights: [1, 1],
              featureMedians: [0],
              featureNames: ["crypto-1"],
              featureScales: [1],
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc",
              logicalModelType: "crypto",
              metrics: {
                directionAccuracy: 0.66,
                directionSupport: { down: 1, up: 2 },
                regressionHuber: 0.01,
                regressionMae: 0.01,
                regressionRmse: 0.02,
                sampleCount: 3,
              },
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_crypto_btc",
            predictionCount: 0,
            status: "ready",
            trainingCount: 3,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
        ];
      },
      async trainAsset(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    processIntervalMs: 60_000,
    rollingHitRateWindowMs: 7_200_000,
    shouldEnableAutomaticPredictions: true,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      getLatestSnapshotAt(): string {
        return "2025-01-01T00:10:00.000Z";
      },
      getLiveSnapshots(): Array<{ generated_at: number }> {
        return [{ generated_at: Date.parse("2025-01-01T00:10:00.000Z") }];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
  });

  await modelRuntimeService.start();
  const assetStatus: ModelStatus = modelRuntimeService.getAssetStatus("btc");
  const restoredPredictionRecords = modelRuntimeService.getPredictionRecords();
  const predictionPayload: ModelPredictionPayload = await modelRuntimeService.predict({ asset: "btc" });
  await modelRuntimeService.stop();

  assert.equal(assetStatus.trainingCount, 3);
  assert.equal(assetStatus.isLiveReady, true);
  assert.equal(assetStatus.rollingPredictionCount, 0);
  assert.equal(assetStatus.rollingCorrectCount, 0);
  assert.equal(assetStatus.rollingHitRate, null);
  assert.equal(restoredPredictionRecords.predictions.length, 0);
  assert.equal(predictionPayload.prediction.asset, "btc");
  assert.equal(predictionPayload.prediction.predictedDirection, "flat");
  assert.equal(predictionPayload.prediction.source, "manual");
  assert.equal(predictionPayload.prediction.status, "pending");
  assert.equal(persistedStateCount > 0, true);
});

test("ModelRuntimeService scores automatic historical predictions on the first 30 seconds of the block", async () => {
  const blockStartAt = Date.parse("2025-01-01T00:00:00.000Z");
  const blockEndAt = blockStartAt + 300_000;
  const historicalSnapshots = [
    { generated_at: blockStartAt - 30_000 },
    { generated_at: blockStartAt - 500 },
    { generated_at: blockStartAt + 500 },
    { generated_at: blockStartAt + 30_000 },
    { generated_at: blockEndAt },
  ];
  let hasBuiltHistoricalPrediction = false;
  let hasBuiltTrainingSamples = false;
  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<Array<{ generated_at: number }>> {
        return [{ generated_at: blockStartAt }];
      },
      async readSnapshots(): Promise<Array<{ generated_at: number }>> {
        return historicalSnapshots;
      },
    } as never,
    modelFeatureService: {
      buildFeatureNames() {
        return { cryptoFeatures: ["crypto-1"] };
      },
      buildLivePredictionSnapshots(snapshots: unknown[]) {
        return snapshots as never;
      },
      buildPredictionInput(_asset: "btc", snapshots: Array<{ generated_at: number }>) {
        const latestSnapshotAt = snapshots.at(-1)?.generated_at || 0;
        if (latestSnapshotAt < blockStartAt) {
          hasBuiltHistoricalPrediction = snapshots.every((snapshot) => snapshot.generated_at < blockStartAt);
        }
        return {
          asset: "btc" as const,
          cryptoSequence: Array.from({ length: 2 }, () => [0]),
          currentChainlinkPrice: 100_000,
          currentExchangePrice: 100_010,
          decisionTime: latestSnapshotAt,
          isChainlinkFresh: true as const,
          latestSnapshotAt,
          realizedVolatility30s: 0.02,
        };
      },
      buildTrainingSamples(_asset: "btc", snapshots: Array<{ generated_at: number }>): [] {
        hasBuiltTrainingSamples = snapshots.every((snapshot) => snapshot.generated_at >= blockStartAt);
        return [];
      },
      getBlockDurationMs(): number {
        return 300_000;
      },
      getPredictionTargetMs(): number {
        return 30_000;
      },
      readReferenceValue(_asset: "btc", _snapshots: Array<{ generated_at: number }>, targetTime: number): number | null {
        const referenceValue = targetTime === blockStartAt + 30_000 ? 100_100 : null;
        return referenceValue;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState() {
        return {
          assets: {
            btc: {
              lastCollectorFromAt: null,
              lastProcessedBlockEndAt: null,
              lastProcessedBlockStartAt: null,
              recentPredictionRecords: [],
              rollingPredictionOutcomes: [],
            },
          },
          lastHistoricalBlockCompletedAt: null,
          schemaVersion: 2,
        };
      },
      async persistState(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async predictAsset(): Promise<{ predictedDirection: "up"; predictedProbability: { down: number; up: number }; predictedReturn: number }> {
        return {
          predictedDirection: "up",
          predictedProbability: { down: 0.2, up: 0.8 },
          predictedReturn: 0.03,
        };
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
              classWeights: [1, 1],
              featureMedians: [0],
              featureNames: ["crypto-1"],
              featureScales: [1],
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc",
              logicalModelType: "crypto",
              metrics: {
                directionAccuracy: 0.66,
                directionSupport: { down: 1, up: 2 },
                regressionHuber: 0.01,
                regressionMae: 0.01,
                regressionRmse: 0.02,
                sampleCount: 3,
              },
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_crypto_btc",
            predictionCount: 0,
            status: "ready",
            trainingCount: 3,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
        ];
      },
      async trainAsset(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    processIntervalMs: 60_000,
    rollingHitRateWindowMs: 7_200_000,
    shouldEnableAutomaticPredictions: true,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      getLatestSnapshotAt(): string {
        return "2025-01-01T00:10:00.000Z";
      },
      getLiveSnapshots(): Array<{ generated_at: number }> {
        return [];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
  });

  await modelRuntimeService.start();

  for (let attemptIndex = 0; attemptIndex < 40; attemptIndex += 1) {
    if (modelRuntimeService.getPredictionRecords().predictions.length > 0) {
      break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  const automaticPrediction = modelRuntimeService.getPredictionRecords().predictions[0];
  await modelRuntimeService.stop();

  assert.equal(hasBuiltHistoricalPrediction, true);
  assert.equal(hasBuiltTrainingSamples, true);
  assert.equal(automaticPrediction?.source, "automatic");
  assert.equal(automaticPrediction?.issuedAt, "2025-01-01T00:00:00.000Z");
  assert.equal(automaticPrediction?.contextStartAt, "2024-12-31T23:59:30.000Z");
  assert.equal(automaticPrediction?.contextEndAt, "2025-01-01T00:00:00.000Z");
  assert.equal(automaticPrediction?.targetStartAt, "2025-01-01T00:00:00.000Z");
  assert.equal(automaticPrediction?.targetEndAt, "2025-01-01T00:00:30.000Z");
  assert.equal(automaticPrediction?.isCorrect, true);
});

test("ModelRuntimeService excludes resolved flat predictions from rolling hit-rate metrics", async () => {
  const decisionTime = Date.now();
  const targetEndAt = decisionTime + 20;
  const modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<[]> {
        return [];
      },
      async readSnapshots(): Promise<[]> {
        return [];
      },
    } as never,
    modelFeatureService: {
      buildFeatureNames() {
        return { cryptoFeatures: ["crypto-1"] };
      },
      buildLivePredictionSnapshots(snapshots: unknown[]) {
        return snapshots as never;
      },
      buildPredictionInput(): {
        asset: "btc";
        cryptoSequence: number[][];
        currentChainlinkPrice: number;
        currentExchangePrice: number;
        decisionTime: number;
        isChainlinkFresh: true;
        latestSnapshotAt: number;
        realizedVolatility30s: number;
      } {
        return {
          asset: "btc",
          cryptoSequence: Array.from({ length: 2 }, () => [0]),
          currentChainlinkPrice: 100_000,
          currentExchangePrice: 100_000,
          decisionTime,
          isChainlinkFresh: true,
          latestSnapshotAt: decisionTime,
          realizedVolatility30s: 0.01,
        };
      },
      buildTrainingSamples(): [] {
        return [];
      },
      getBlockDurationMs(): number {
        return 300_000;
      },
      getPredictionTargetMs(): number {
        return 20;
      },
      readReferenceValue(_asset: "btc", snapshots: Array<{ generated_at: number }>, targetTime: number): number | null {
        const hasReachedTarget = snapshots.some((snapshot) => snapshot.generated_at >= targetTime);
        const referenceValue = hasReachedTarget ? 100_050 : null;
        return referenceValue;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState() {
        return {
          assets: {
            btc: {
              lastCollectorFromAt: null,
              lastProcessedBlockEndAt: null,
              lastProcessedBlockStartAt: null,
              recentPredictionRecords: [],
              rollingPredictionOutcomes: [],
            },
          },
          lastHistoricalBlockCompletedAt: null,
          schemaVersion: 2,
        };
      },
      async persistState(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async predictAsset(): Promise<{ predictedDirection: "flat"; predictedProbability: { down: number; up: number }; predictedReturn: number }> {
        return {
          predictedDirection: "flat",
          predictedProbability: { down: 0.5, up: 0.5 },
          predictedReturn: 0,
        };
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
              classWeights: [1, 1],
              featureMedians: [0],
              featureNames: ["crypto-1"],
              featureScales: [1],
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc",
              logicalModelType: "crypto",
              metrics: {
                directionAccuracy: 0.66,
                directionSupport: { down: 1, up: 2 },
                regressionHuber: 0.01,
                regressionMae: 0.01,
                regressionRmse: 0.02,
                sampleCount: 3,
              },
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_crypto_btc",
            predictionCount: 0,
            status: "ready",
            trainingCount: 3,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
        ];
      },
      async trainAsset(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    processIntervalMs: 60_000,
    rollingHitRateWindowMs: 7_200_000,
    shouldEnableAutomaticPredictions: true,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      getLatestSnapshotAt(): string {
        return new Date(targetEndAt).toISOString();
      },
      getLiveSnapshots(): Array<{ generated_at: number }> {
        return [{ generated_at: decisionTime }, { generated_at: targetEndAt }];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
  });

  await modelRuntimeService.start();
  await modelRuntimeService.predict({ asset: "btc" });
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

  const assetStatus = modelRuntimeService.getAssetStatus("btc");
  const latestPrediction = modelRuntimeService.getPredictionRecords().predictions.at(-1) || null;

  await modelRuntimeService.stop();

  assert.equal(assetStatus.rollingPredictionCount, 0);
  assert.equal(assetStatus.rollingCorrectCount, 0);
  assert.equal(assetStatus.rollingHitRate, null);
  assert.equal(latestPrediction?.status, "resolved");
  assert.equal(latestPrediction?.predictedDirection, "flat");
  assert.equal(latestPrediction?.isCorrect, null);
});

test("ModelRuntimeService can disable automatic historical predictions while keeping training active", async () => {
  const blockStartAt = Date.parse("2025-01-01T00:00:00.000Z");
  const blockEndAt = blockStartAt + 300_000;
  const historicalSnapshots = [
    { generated_at: blockStartAt - 30_000 },
    { generated_at: blockStartAt - 500 },
    { generated_at: blockStartAt + 500 },
    { generated_at: blockStartAt + 30_000 },
    { generated_at: blockEndAt },
  ];
  let hasBuiltTrainingSamples = false;
  let automaticPredictionCallCount = 0;
  let observedStateDuringTraining: ModelStatus["state"] | null = null;
  let trainingCallCount = 0;
  let releaseTraining: (() => void) | undefined;
  const trainingGatePromise = new Promise<void>((resolve) => {
    releaseTraining = resolve;
  });
  let modelRuntimeService: ModelRuntimeService | null = null;
  modelRuntimeService = new ModelRuntimeService({
    collectorClientService: {
      async readSnapshotPage(): Promise<Array<{ generated_at: number }>> {
        return [{ generated_at: blockStartAt }];
      },
      async readSnapshots(): Promise<Array<{ generated_at: number }>> {
        return historicalSnapshots;
      },
    } as never,
    modelFeatureService: {
      buildFeatureNames() {
        return { cryptoFeatures: ["crypto-1"] };
      },
      buildLivePredictionSnapshots(snapshots: unknown[]) {
        return snapshots as never;
      },
      buildPredictionInput() {
        return {
          asset: "btc" as const,
          cryptoSequence: Array.from({ length: 2 }, () => [0]),
          currentChainlinkPrice: 100_000,
          currentExchangePrice: 100_010,
          decisionTime: blockStartAt - 500,
          isChainlinkFresh: true as const,
          latestSnapshotAt: blockStartAt - 500,
          realizedVolatility30s: 0.02,
        };
      },
      buildTrainingSamples(_asset: "btc", snapshots: Array<{ generated_at: number }>): [] {
        hasBuiltTrainingSamples = snapshots.every((snapshot) => snapshot.generated_at >= blockStartAt);
        return [];
      },
      getBlockDurationMs(): number {
        return 300_000;
      },
      getPredictionTargetMs(): number {
        return 30_000;
      },
      readReferenceValue(): number | null {
        return 100_100;
      },
    } as never,
    modelRuntimeStateService: {
      async loadState() {
        return {
          assets: {
            btc: {
              lastCollectorFromAt: null,
              lastProcessedBlockEndAt: null,
              lastProcessedBlockStartAt: null,
              recentPredictionRecords: [],
              rollingPredictionOutcomes: [],
            },
          },
          lastHistoricalBlockCompletedAt: null,
          schemaVersion: 2,
        };
      },
      async persistState(): Promise<void> {},
    } as never,
    modelTrainingService: {
      async ensureTensorflowApi(): Promise<void> {},
      async predictAsset(): Promise<{ predictedDirection: "up"; predictedProbability: { down: number; up: number }; predictedReturn: number }> {
        automaticPredictionCallCount += 1;
        return {
          predictedDirection: "up",
          predictedProbability: { down: 0.2, up: 0.8 },
          predictedReturn: 0.03,
        };
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
              classWeights: [1, 1],
              featureMedians: [0],
              featureNames: ["crypto-1"],
              featureScales: [1],
              lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
              lastValidationWindowStart: "2024-12-31T12:00:00.000Z",
              logicalKey: "btc",
              logicalModelType: "crypto",
              metrics: {
                directionAccuracy: 0.66,
                directionSupport: { down: 1, up: 2 },
                regressionHuber: 0.01,
                regressionMae: 0.01,
                regressionRmse: 0.02,
                sampleCount: 3,
              },
              trainedAt: "2025-01-01T00:10:00.000Z",
              trainingSampleCount: 10,
              validationSampleCount: 3,
            },
            modelId: "polymarket_model_crypto_btc",
            predictionCount: 0,
            status: "ready",
            trainingCount: 3,
            updatedAt: "2025-01-01T00:10:00.000Z",
          },
        ];
      },
      async trainAsset(): Promise<{ artifact: null; trainingSampleCount: number; validationSampleCount: number }> {
        trainingCallCount += 1;
        observedStateDuringTraining = modelRuntimeService?.getAssetStatus("btc").state || null;
        await trainingGatePromise;
        return { artifact: null, trainingSampleCount: 0, validationSampleCount: 0 };
      },
    } as never,
    processIntervalMs: 60_000,
    rollingHitRateWindowMs: 7_200_000,
    shouldEnableAutomaticPredictions: false,
    shouldLogTrainingProgress: false,
    shouldRestoreOnStart: true,
    snapshotStoreService: {
      getLatestSnapshotAt(): string {
        return "2025-01-01T00:10:00.000Z";
      },
      getLiveSnapshots(): Array<{ generated_at: number }> {
        return [];
      },
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
    } as never,
    supportedAssets: ["btc"],
  });

  await modelRuntimeService.start();

  for (let attemptIndex = 0; attemptIndex < 40; attemptIndex += 1) {
    if (observedStateDuringTraining !== null) {
      break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  if (releaseTraining !== undefined) {
    releaseTraining();
  }

  const predictionRecords = modelRuntimeService.getPredictionRecords().predictions;

  await modelRuntimeService.stop();

  assert.equal(hasBuiltTrainingSamples, true);
  assert.equal(automaticPredictionCallCount, 0);
  assert.equal(trainingCallCount, 1);
  assert.equal(observedStateDuringTraining, "training");
  assert.equal(predictionRecords.length, 0);
});
