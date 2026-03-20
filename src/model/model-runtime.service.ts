/**
 * @section imports:internals
 */

import { CollectorClientService } from "../collector/collector-client.service.ts";
import config from "../config.ts";
import logger from "../logger.ts";
import { SnapshotStoreService } from "../snapshot/snapshot-store.service.ts";
import type { TensorflowApiHeadMetadata, TensorflowApiModelRecord } from "../tensorflow-api/tensorflow-api.types.ts";
import type {
  FlatSnapshot,
  ModelAsset,
  ModelClobArtifact,
  ModelClobKey,
  ModelMetrics,
  ModelPredictionInput,
  ModelPredictionPayload,
  ModelPredictionRequest,
  ModelStatus,
  ModelStatusPayload,
  ModelTrendArtifact,
  ModelTrendKey,
  ModelWindow,
} from "./model.types.ts";
import { ModelCostService } from "./model-cost.service.ts";
import { ModelFeatureService } from "./model-feature.service.ts";
import { ModelRuntimeStateService } from "./model-runtime-state.service.ts";
import { ModelTrainingService } from "./model-training.service.ts";

/**
 * @section types
 */

type ModelRuntimeServiceOptions = {
  collectorClientService: CollectorClientService;
  modelCostService: ModelCostService;
  modelFeatureService: ModelFeatureService;
  modelRuntimeStateService: ModelRuntimeStateService;
  modelTrainingService: ModelTrainingService;
  shouldLogTrainingProgress: boolean;
  shouldRestoreOnStart: boolean;
  snapshotStoreService: SnapshotStoreService;
  supportedAssets: ModelAsset[];
  supportedWindows: ModelWindow[];
  trainingIntervalMs: number;
};

const UNIX_EPOCH_ISO = "1970-01-01T00:00:00.000Z";

/**
 * @section class
 */

export class ModelRuntimeService {
  /**
   * @section private:attributes
   */

  private readonly collectorClientService: CollectorClientService;

  private readonly modelCostService: ModelCostService;

  private readonly modelFeatureService: ModelFeatureService;

  private readonly modelRuntimeStateService: ModelRuntimeStateService;

  private readonly modelTrainingService: ModelTrainingService;

  private readonly shouldLogTrainingProgress: boolean;

  private readonly shouldRestoreOnStart: boolean;

  private readonly snapshotStoreService: SnapshotStoreService;

  private readonly supportedAssets: ModelAsset[];

  private readonly supportedWindows: ModelWindow[];

  private readonly trainingIntervalMs: number;

  private readonly clobArtifactRegistry: Map<ModelClobKey, ModelClobArtifact>;

  private readonly statusRegistry: Map<ModelClobKey, ModelStatus>;

  private readonly trendArtifactRegistry: Map<ModelTrendKey, ModelTrendArtifact>;

  private isStarted: boolean;

  private isTrainingCycleRunning: boolean;

  private lastTrainedSnapshotAt: number | null;

  private lastTrainingCycleAt: string | null;

  private trainingTimer: ReturnType<typeof setInterval> | null;

  /**
   * @section constructor
   */

  public constructor(options: ModelRuntimeServiceOptions) {
    this.collectorClientService = options.collectorClientService;
    this.modelCostService = options.modelCostService;
    this.modelFeatureService = options.modelFeatureService;
    this.modelRuntimeStateService = options.modelRuntimeStateService;
    this.modelTrainingService = options.modelTrainingService;
    this.shouldLogTrainingProgress = options.shouldLogTrainingProgress;
    this.shouldRestoreOnStart = options.shouldRestoreOnStart;
    this.snapshotStoreService = options.snapshotStoreService;
    this.supportedAssets = options.supportedAssets;
    this.supportedWindows = options.supportedWindows;
    this.trainingIntervalMs = options.trainingIntervalMs;
    this.clobArtifactRegistry = new Map<ModelClobKey, ModelClobArtifact>();
    this.statusRegistry = new Map<ModelClobKey, ModelStatus>();
    this.trendArtifactRegistry = new Map<ModelTrendKey, ModelTrendArtifact>();
    this.isStarted = false;
    this.isTrainingCycleRunning = false;
    this.lastTrainedSnapshotAt = null;
    this.lastTrainingCycleAt = null;
    this.trainingTimer = null;
    this.initializeStatuses();
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelRuntimeService {
    const modelFeatureService = ModelFeatureService.createDefault();
    return new ModelRuntimeService({
      collectorClientService: CollectorClientService.createDefault(),
      modelCostService: ModelCostService.createDefault(),
      modelFeatureService,
      modelRuntimeStateService: ModelRuntimeStateService.createDefault(),
      modelTrainingService: ModelTrainingService.createDefault(modelFeatureService.buildFeatureNames()),
      shouldLogTrainingProgress: config.MODEL_LOG_TRAINING_PROGRESS,
      shouldRestoreOnStart: config.MODEL_RESTORE_ON_START,
      snapshotStoreService: SnapshotStoreService.createDefault(),
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: config.MODEL_SUPPORTED_WINDOWS as ModelWindow[],
      trainingIntervalMs: config.MODEL_TRAINING_INTERVAL_MS,
    });
  }

  /**
   * @section private:methods
   */

  private buildModelKey(asset: ModelAsset, window: ModelWindow): ModelClobKey {
    const modelKey = `${asset}_${window}` as ModelClobKey;
    return modelKey;
  }

  private buildBaseMetrics(): ModelMetrics {
    const metrics: ModelMetrics = {
      clobDirectionMacroF1: null,
      clobDirectionSupport: { down: 0, flat: 0, up: 0 },
      clobRegressionHuber: null,
      clobRegressionMae: null,
      clobRegressionRmse: null,
      sampleCount: 0,
      trendDirectionMacroF1: null,
      trendDirectionSupport: { down: 0, flat: 0, up: 0 },
      trendRegressionHuber: null,
      trendRegressionMae: null,
      trendRegressionRmse: null,
    };
    return metrics;
  }

  private initializeStatuses(): void {
    const featureNames = this.modelFeatureService.buildFeatureNames();
    const trendFeatureCount = featureNames.trendFeatures.length;
    const clobFeatureCount = featureNames.clobFeatures.length;

    this.supportedAssets.forEach((asset) => {
      this.supportedWindows.forEach((window) => {
        const modelKey = this.buildModelKey(asset, window);
        const trendSequenceLength = this.modelFeatureService.getSequenceLength(asset, "trend");
        const clobSequenceLength = this.modelFeatureService.getSequenceLength(modelKey, "clob");
        this.statusRegistry.set(modelKey, {
          activeMarket: null,
          asset,
          clobFeatureCount,
          clobVersion: 0,
          clobSequenceLength,
          headVersionSkew: false,
          lastError: null,
          lastTrainingCompletedAt: null,
          lastTrainingStartedAt: null,
          lastValidationWindowEnd: null,
          lastValidationWindowStart: null,
          latestSnapshotAt: null,
          liveSnapshotCount: 0,
          metrics: this.buildBaseMetrics(),
          modelFamily: "tcn",
          modelKey,
          state: "idle",
          trainingSampleCount: 0,
          trendFeatureCount,
          trendModelKey: asset,
          trendSequenceLength,
          trendVersion: 0,
          validationSampleCount: 0,
          version: 0,
          window,
        });
      });
    });
  }

  private getStatus(modelKey: ModelClobKey): ModelStatus {
    const status = this.statusRegistry.get(modelKey);

    if (status === undefined) {
      throw new Error(`missing status for ${modelKey}`);
    }

    return status;
  }

  private updateStatus(modelKey: ModelClobKey, statusPatch: Partial<ModelStatus>): void {
    this.statusRegistry.set(modelKey, {
      ...this.getStatus(modelKey),
      ...statusPatch,
    });
  }

  private buildCompositeMetrics(asset: ModelAsset, modelKey: ModelClobKey): ModelMetrics {
    const trendArtifact = this.trendArtifactRegistry.get(asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const metrics: ModelMetrics = {
      clobDirectionMacroF1: clobArtifact?.model.metrics.directionMacroF1 || null,
      clobDirectionSupport: clobArtifact?.model.metrics.directionSupport || { down: 0, flat: 0, up: 0 },
      clobRegressionHuber: clobArtifact?.model.metrics.regressionHuber || null,
      clobRegressionMae: clobArtifact?.model.metrics.regressionMae || null,
      clobRegressionRmse: clobArtifact?.model.metrics.regressionRmse || null,
      sampleCount: Math.max(trendArtifact?.model.metrics.sampleCount || 0, clobArtifact?.model.metrics.sampleCount || 0),
      trendDirectionMacroF1: trendArtifact?.model.metrics.directionMacroF1 || null,
      trendDirectionSupport: trendArtifact?.model.metrics.directionSupport || { down: 0, flat: 0, up: 0 },
      trendRegressionHuber: trendArtifact?.model.metrics.regressionHuber || null,
      trendRegressionMae: trendArtifact?.model.metrics.regressionMae || null,
      trendRegressionRmse: trendArtifact?.model.metrics.regressionRmse || null,
    };
    return metrics;
  }

  private refreshModelStatus(modelKey: ModelClobKey): void {
    const currentStatus = this.getStatus(modelKey);
    const trendArtifact = this.trendArtifactRegistry.get(currentStatus.asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const isReady = trendArtifact !== null && clobArtifact !== null;
    const hasHeadVersionSkew =
      trendArtifact !== null && clobArtifact !== null && (trendArtifact.version !== clobArtifact.version || trendArtifact.trainedAt !== clobArtifact.trainedAt);
    this.updateStatus(modelKey, {
      clobVersion: clobArtifact?.version || 0,
      lastError: null,
      lastTrainingCompletedAt: clobArtifact?.trainedAt || trendArtifact?.trainedAt || currentStatus.lastTrainingCompletedAt,
      lastValidationWindowEnd: clobArtifact?.lastValidationWindowEnd || trendArtifact?.lastValidationWindowEnd || null,
      lastValidationWindowStart: clobArtifact?.lastValidationWindowStart || trendArtifact?.lastValidationWindowStart || null,
      headVersionSkew: hasHeadVersionSkew,
      metrics: this.buildCompositeMetrics(currentStatus.asset, modelKey),
      state: isReady ? "ready" : currentStatus.state,
      trainingSampleCount: clobArtifact?.trainingSampleCount || trendArtifact?.trainingSampleCount || 0,
      trendVersion: trendArtifact?.version || 0,
      validationSampleCount: clobArtifact?.validationSampleCount || trendArtifact?.validationSampleCount || 0,
      version: clobArtifact?.version || 0,
    });
  }

  private refreshLiveStatusFields(): void {
    const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
    const latestSnapshotAt = this.snapshotStoreService.getLatestSnapshotAt();
    const contexts = liveSnapshots.length === 0 ? [] : this.modelFeatureService.buildSnapshotContexts(liveSnapshots);
    const latestContext = contexts.at(-1) || null;
    this.statusRegistry.forEach((status, modelKey) => {
      this.updateStatus(modelKey, {
        activeMarket: latestContext?.marketContexts[modelKey].activeMarket || status.activeMarket,
        latestSnapshotAt,
        liveSnapshotCount: liveSnapshots.length,
      });
    });
  }

  private buildHistoricalFromDate(): string {
    const overlapTimestamp =
      this.lastTrainedSnapshotAt === null ? null : Math.max(0, this.lastTrainedSnapshotAt - this.modelFeatureService.getRequiredOverlapMs());
    const historicalFromDate = overlapTimestamp === null ? UNIX_EPOCH_ISO : new Date(overlapTimestamp).toISOString();
    return historicalFromDate;
  }

  private mergeSnapshots(snapshots: FlatSnapshot[]): FlatSnapshot[] {
    const mergedSnapshots = [...snapshots]
      .sort((leftSnapshot, rightSnapshot) => leftSnapshot.generated_at - rightSnapshot.generated_at)
      .reduce<FlatSnapshot[]>((snapshotList, snapshot) => {
        const lastSnapshot = snapshotList.at(-1) || null;

        if (lastSnapshot === null || lastSnapshot.generated_at !== snapshot.generated_at) {
          snapshotList.push(snapshot);
        }

        if (lastSnapshot !== null && lastSnapshot.generated_at === snapshot.generated_at) {
          snapshotList[snapshotList.length - 1] = {
            ...lastSnapshot,
            ...snapshot,
          };
        }

        return snapshotList;
      }, []);
    return mergedSnapshots;
  }

  private buildCarryoverSnapshots(snapshots: FlatSnapshot[]): FlatSnapshot[] {
    const requiredOverlapMs = this.modelFeatureService.getRequiredOverlapMs();
    const latestSnapshotAt = snapshots.at(-1)?.generated_at || null;
    const carryoverSnapshots = latestSnapshotAt === null ? [] : snapshots.filter((snapshot) => snapshot.generated_at >= latestSnapshotAt - requiredOverlapMs);
    return carryoverSnapshots;
  }

  private async runIncrementalTrainingPass(
    historicalSnapshots: FlatSnapshot[],
    carryoverSnapshots: FlatSnapshot[],
  ): Promise<{ clobSampleCount: number; historicalCount: number; trendSampleCount: number }> {
    const mergedSnapshots = this.mergeSnapshots([...carryoverSnapshots, ...historicalSnapshots]);
    const trendSamples = this.modelFeatureService.buildTrendTrainingSamples(mergedSnapshots);
    const clobSamples = this.modelFeatureService.buildClobTrainingSamples(mergedSnapshots);

    for (const asset of this.supportedAssets) {
      const trendResult = await this.modelTrainingService.trainTrend(
        asset,
        trendSamples.filter((sample) => sample.trendKey === asset),
      );

      if (trendResult.artifact !== null) {
        this.replaceTrendArtifact(asset, trendResult.artifact);
        this.logTrainingBlock(asset, trendResult.artifact.version, trendResult.trainingSampleCount, trendResult.validationSampleCount);
      }
    }

    for (const asset of this.supportedAssets) {
      for (const window of this.supportedWindows) {
        const modelKey = this.buildModelKey(asset, window);
        const clobResult = await this.modelTrainingService.trainClob(
          modelKey,
          clobSamples.filter((sample) => sample.modelKey === modelKey),
        );

        if (clobResult.artifact !== null) {
          this.replaceClobArtifact(modelKey, clobResult.artifact);
          this.logTrainingBlock(modelKey, clobResult.artifact.version, clobResult.trainingSampleCount, clobResult.validationSampleCount);
        }
      }
    }

    this.lastTrainingCycleAt = new Date().toISOString();
    this.lastTrainedSnapshotAt = historicalSnapshots.at(-1)?.generated_at || this.lastTrainedSnapshotAt;
    await this.modelRuntimeStateService.persistState(
      this.lastTrainingCycleAt,
      this.lastTrainedSnapshotAt === null ? null : new Date(this.lastTrainedSnapshotAt).toISOString(),
    );
    this.refreshLiveStatusFields();

    return {
      clobSampleCount: clobSamples.length,
      historicalCount: historicalSnapshots.length,
      trendSampleCount: trendSamples.length,
    };
  }

  private async runIncrementalCatchupCycle(): Promise<{
    clobSampleCount: number;
    historicalCount: number;
    passCount: number;
    trendSampleCount: number;
  }> {
    const catchupToDate = new Date().toISOString();
    const pageLimit = config.SNAPSHOT_COLLECTOR_PAGE_LIMIT;
    let carryoverSnapshots: FlatSnapshot[] = [];
    let cursorFromDate = this.buildHistoricalFromDate();
    let clobSampleCount = 0;
    let historicalCount = 0;
    let isCatchingUp = true;
    let passCount = 0;
    let trendSampleCount = 0;

    while (isCatchingUp) {
      const historicalSnapshots = await this.collectorClientService.readSnapshotPage({
        fromDate: cursorFromDate,
        limit: pageLimit,
        toDate: catchupToDate,
      });

      if (historicalSnapshots.length === 0) {
        isCatchingUp = false;
      } else {
        const passSummary = await this.runIncrementalTrainingPass(historicalSnapshots, carryoverSnapshots);
        const latestHistoricalSnapshot = historicalSnapshots.at(-1) || null;

        if (latestHistoricalSnapshot !== null && latestHistoricalSnapshot.generated_at < Date.parse(cursorFromDate)) {
          throw new Error(`collector pagination did not advance cursorFromDate=${cursorFromDate}`);
        }

        carryoverSnapshots = this.buildCarryoverSnapshots(this.mergeSnapshots([...carryoverSnapshots, ...historicalSnapshots]));
        cursorFromDate = latestHistoricalSnapshot === null ? cursorFromDate : new Date(latestHistoricalSnapshot.generated_at + 1).toISOString();
        clobSampleCount = passSummary.clobSampleCount;
        historicalCount += passSummary.historicalCount;
        passCount += 1;
        trendSampleCount = passSummary.trendSampleCount;
        isCatchingUp = historicalSnapshots.length === pageLimit;
      }
    }

    return {
      clobSampleCount,
      historicalCount,
      passCount,
      trendSampleCount,
    };
  }

  private parseHeadMetadata(rawMetadata: Record<string, unknown> | null): TensorflowApiHeadMetadata | null {
    let headMetadata: TensorflowApiHeadMetadata | null = null;

    if (rawMetadata?.logicalKey && rawMetadata.logicalModelType) {
      headMetadata = rawMetadata as unknown as TensorflowApiHeadMetadata;
    }

    return headMetadata;
  }

  private applyRemoteModelRecord(modelRecord: TensorflowApiModelRecord): void {
    const headMetadata = this.parseHeadMetadata(modelRecord.metadata);

    if (modelRecord.status === "ready" && headMetadata !== null) {
      if (headMetadata.logicalModelType === "trend") {
        this.trendArtifactRegistry.set(headMetadata.logicalKey as ModelTrendKey, {
          lastTrainWindowEnd: headMetadata.lastTrainWindowEnd,
          lastTrainWindowStart: headMetadata.lastTrainWindowStart,
          lastValidationWindowEnd: headMetadata.lastValidationWindowEnd,
          lastValidationWindowStart: headMetadata.lastValidationWindowStart,
          model: {
            architecture: headMetadata.architecture,
            classWeights: headMetadata.classWeights,
            directionThreshold: headMetadata.directionThreshold,
            featureMedians: headMetadata.featureMedians,
            featureNames: headMetadata.featureNames,
            featureScales: headMetadata.featureScales,
            metrics: headMetadata.metrics,
            remoteModelId: modelRecord.modelId,
            targetEncoding: headMetadata.targetEncoding,
          },
          remoteModelId: modelRecord.modelId,
          trainedAt: headMetadata.trainedAt,
          trainingSampleCount: headMetadata.trainingSampleCount,
          trendKey: headMetadata.logicalKey as ModelTrendKey,
          validationSampleCount: headMetadata.validationSampleCount,
          version: modelRecord.trainingCount,
        });
      }

      if (headMetadata.logicalModelType === "clob") {
        const [asset, window] = headMetadata.logicalKey.split("_") as [ModelAsset, ModelWindow];
        this.clobArtifactRegistry.set(headMetadata.logicalKey as ModelClobKey, {
          asset,
          lastTrainWindowEnd: headMetadata.lastTrainWindowEnd,
          lastTrainWindowStart: headMetadata.lastTrainWindowStart,
          lastValidationWindowEnd: headMetadata.lastValidationWindowEnd,
          lastValidationWindowStart: headMetadata.lastValidationWindowStart,
          model: {
            architecture: headMetadata.architecture,
            classWeights: headMetadata.classWeights,
            directionThreshold: headMetadata.directionThreshold,
            featureMedians: headMetadata.featureMedians,
            featureNames: headMetadata.featureNames,
            featureScales: headMetadata.featureScales,
            metrics: headMetadata.metrics,
            remoteModelId: modelRecord.modelId,
            targetEncoding: headMetadata.targetEncoding,
          },
          modelKey: headMetadata.logicalKey as ModelClobKey,
          remoteModelId: modelRecord.modelId,
          trainedAt: headMetadata.trainedAt,
          trainingSampleCount: headMetadata.trainingSampleCount,
          validationSampleCount: headMetadata.validationSampleCount,
          version: modelRecord.trainingCount,
          window,
        });
      }
    }
    if (modelRecord.status === "failed" && headMetadata !== null && headMetadata.logicalModelType === "clob") {
      this.updateStatus(headMetadata.logicalKey as ModelClobKey, {
        lastError: `remote model failed modelId=${modelRecord.modelId}`,
        state: "error",
      });
    }
  }

  private async restorePersistedState(): Promise<void> {
    const runtimeStateSnapshot = this.shouldRestoreOnStart
      ? await this.modelRuntimeStateService.loadState()
      : { lastTrainingCycleAt: null, lastTrainedSnapshotAt: null, schemaVersion: 1 };
    this.lastTrainingCycleAt = runtimeStateSnapshot.lastTrainingCycleAt;
    this.lastTrainedSnapshotAt = runtimeStateSnapshot.lastTrainedSnapshotAt === null ? null : Date.parse(runtimeStateSnapshot.lastTrainedSnapshotAt);

    if (this.shouldRestoreOnStart) {
      const remoteModelRecords = await this.modelTrainingService.readRemoteModels();
      remoteModelRecords.forEach((modelRecord) => {
        this.applyRemoteModelRecord(modelRecord);
      });
      this.statusRegistry.forEach((_status, modelKey) => {
        this.refreshModelStatus(modelKey);
      });
    }
  }

  private markTrainingStarted(startedAt: string): void {
    this.isTrainingCycleRunning = true;
    this.statusRegistry.forEach((status, modelKey) => {
      this.updateStatus(modelKey, {
        lastError: null,
        lastTrainingStartedAt: startedAt,
        state: status.version === 0 ? "training" : status.state,
      });
    });
  }

  private markTrainingFailed(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : "training cycle failed";
    this.isTrainingCycleRunning = false;
    logger.error(`training cycle failed error=${errorMessage}`);
    this.statusRegistry.forEach((_status, modelKey) => {
      const hasReadyArtifact = this.clobArtifactRegistry.has(modelKey) && this.trendArtifactRegistry.has(this.getStatus(modelKey).asset);
      this.updateStatus(modelKey, {
        lastError: errorMessage,
        state: hasReadyArtifact ? "ready" : "error",
      });
    });
  }

  private replaceTrendArtifact(asset: ModelTrendKey, artifact: ModelTrendArtifact): void {
    this.trendArtifactRegistry.set(asset, artifact);
    this.supportedWindows.forEach((window) => {
      this.refreshModelStatus(this.buildModelKey(asset, window));
    });
  }

  private replaceClobArtifact(modelKey: ModelClobKey, artifact: ModelClobArtifact): void {
    this.clobArtifactRegistry.set(modelKey, artifact);
    this.refreshModelStatus(modelKey);
  }

  private logTrainingBlock(modelKey: string, version: number, trainingSampleCount: number, validationSampleCount: number): void {
    if (this.shouldLogTrainingProgress) {
      logger.info(`training block completed model=${modelKey} version=${version} train=${trainingSampleCount} valid=${validationSampleCount}`);
    }
  }

  private async runScheduledTrainingCycle(): Promise<void> {
    try {
      await this.runTrainingCycle();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "scheduled training cycle failed";
      logger.error(`scheduled training cycle failed error=${errorMessage}`);
    }
  }

  private buildPredictionPayload(
    input: ModelPredictionInput,
    trendPrediction: { predictedValue: number; probabilities: { down: number; flat: number; up: number } },
    clobPrediction: { predictedValue: number; probabilities: { down: number; flat: number; up: number } },
    fusionPayload: ModelPredictionPayload["fusion"],
  ): ModelPredictionPayload {
    const predictionPayload: ModelPredictionPayload = {
      activeMarket: input.clobInput.activeMarket,
      clob: {
        currentUpMid: input.clobInput.currentUpMid,
        edge: input.clobInput.currentUpMid === null ? null : clobPrediction.predictedValue - input.clobInput.currentUpMid,
        isOrderBookFresh: input.clobInput.isOrderBookFresh,
        predictedUpMid: clobPrediction.predictedValue,
        probabilities: clobPrediction.probabilities,
      },
      fusion: fusionPayload,
      generatedAt: new Date(input.clobInput.decisionTime).toISOString(),
      liveSnapshotCount: this.snapshotStoreService.getLiveSnapshots().length,
      modelKey: input.clobInput.modelKey,
      trend: {
        fairUpProbability: this.modelCostService.readTrendFairProbability(input, trendPrediction.predictedValue),
        isChainlinkFresh: input.trendInput.isChainlinkFresh,
        predictedReturn: trendPrediction.predictedValue,
        probabilities: trendPrediction.probabilities,
      },
    };
    return predictionPayload;
  }

  /**
   * @section public:methods
   */

  public async start(): Promise<void> {
    if (!this.isStarted) {
      await this.modelTrainingService.ensureTensorflowApi();
      await this.restorePersistedState();
      await this.snapshotStoreService.start();
      this.refreshLiveStatusFields();
      this.isStarted = true;
      this.trainingTimer = setInterval(() => {
        void this.runScheduledTrainingCycle();
      }, this.trainingIntervalMs);
      void this.runScheduledTrainingCycle();
    }
  }

  public async stop(): Promise<void> {
    if (this.trainingTimer !== null) {
      clearInterval(this.trainingTimer);
      this.trainingTimer = null;
    }

    if (this.isStarted) {
      await this.snapshotStoreService.stop();
      this.trendArtifactRegistry.clear();
      this.clobArtifactRegistry.clear();
      this.isStarted = false;
    }
  }

  public async runTrainingCycle(): Promise<void> {
    if (!this.isTrainingCycleRunning) {
      this.markTrainingStarted(new Date().toISOString());

      try {
        const cycleStartedAt = Date.now();
        const passSummary = await this.runIncrementalCatchupCycle();
        this.isTrainingCycleRunning = false;
        logger.info(
          `training cycle completed trendModels=${this.trendArtifactRegistry.size} clobModels=${this.clobArtifactRegistry.size} historical=${passSummary.historicalCount} live=${this.snapshotStoreService.getLiveSnapshots().length} trendSamples=${passSummary.trendSampleCount} clobSamples=${passSummary.clobSampleCount} passes=${passSummary.passCount} durationMs=${Date.now() - cycleStartedAt}`,
        );
      } catch (error) {
        logger.error(`training cycle catch error=${error instanceof Error ? error.message : "unknown error"}`);
        this.markTrainingFailed(error);
      }
    }
  }

  public getStatusPayload(): ModelStatusPayload {
    const models = [...this.statusRegistry.values()].sort((leftStatus, rightStatus) => leftStatus.modelKey.localeCompare(rightStatus.modelKey));
    return {
      isTrainingCycleRunning: this.isTrainingCycleRunning,
      lastTrainingCycleAt: this.lastTrainingCycleAt,
      latestSnapshotAt: models.at(0)?.latestSnapshotAt || null,
      liveSnapshotCount: models.at(0)?.liveSnapshotCount || 0,
      models,
    };
  }

  public getModelStatus(asset: ModelAsset, window: ModelWindow): ModelStatus {
    return this.getStatus(this.buildModelKey(asset, window));
  }

  public async predict(request: ModelPredictionRequest): Promise<ModelPredictionPayload> {
    const modelKey = this.buildModelKey(request.asset, request.window);
    const trendArtifact = this.trendArtifactRegistry.get(request.asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const predictionInput = this.modelFeatureService.buildPredictionInput(this.snapshotStoreService.getLiveSnapshots(), request);

    if (trendArtifact === null || clobArtifact === null) {
      throw new Error(`no remote model available for ${modelKey}`);
    }

    if (predictionInput === null) {
      throw new Error(`insufficient live snapshots for ${modelKey}`);
    }

    const trendPrediction = await this.modelTrainingService.predictTrend(trendArtifact, predictionInput.trendInput);
    const clobPrediction = await this.modelTrainingService.predictClob(clobArtifact, predictionInput.clobInput);
    const fusionPayload = await this.modelCostService.buildFusionPayload(
      predictionInput,
      {
        predictedReturn: trendPrediction.predictedValue,
        probabilities: trendPrediction.probabilities,
      },
      {
        predictedUpMid: clobPrediction.predictedValue,
        probabilities: clobPrediction.probabilities,
      },
    );
    return this.buildPredictionPayload(predictionInput, trendPrediction, clobPrediction, fusionPayload);
  }
}
