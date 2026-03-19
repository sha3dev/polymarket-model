/**
 * @section imports:internals
 */

import { CollectorClientService } from "../collector/collector-client.service.ts";
import config from "../config.ts";
import logger from "../logger.ts";
import { SnapshotStoreService } from "../snapshot/snapshot-store.service.ts";
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
import { ModelPersistenceService } from "./model-persistence.service.ts";
import { ModelTrainingService } from "./model-training.service.ts";

/**
 * @section types
 */

type ModelRuntimeServiceOptions = {
  collectorClientService: CollectorClientService;
  modelCostService: ModelCostService;
  modelFeatureService: ModelFeatureService;
  modelPersistenceService: ModelPersistenceService;
  modelTrainingService: ModelTrainingService;
  shouldLogTrainingProgress: boolean;
  shouldRestoreOnStart: boolean;
  snapshotStoreService: SnapshotStoreService;
  supportedAssets: ModelAsset[];
  supportedWindows: ModelWindow[];
  trainingIntervalMs: number;
};

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

  private readonly modelPersistenceService: ModelPersistenceService;

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
    this.modelPersistenceService = options.modelPersistenceService;
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
    const modelPersistenceService = ModelPersistenceService.createDefault();
    const modelRuntimeService = new ModelRuntimeService({
      collectorClientService: CollectorClientService.createDefault(),
      modelCostService: ModelCostService.createDefault(),
      modelFeatureService,
      modelPersistenceService,
      modelTrainingService: ModelTrainingService.createDefault(modelFeatureService.buildFeatureNames(), modelPersistenceService),
      shouldLogTrainingProgress: config.MODEL_LOG_TRAINING_PROGRESS,
      shouldRestoreOnStart: config.MODEL_RESTORE_ON_START,
      snapshotStoreService: SnapshotStoreService.createDefault(),
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: config.MODEL_SUPPORTED_WINDOWS as ModelWindow[],
      trainingIntervalMs: config.MODEL_TRAINING_INTERVAL_MS,
    });
    return modelRuntimeService;
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
      trendRegressionMae: null,
      trendRegressionRmse: null,
      trendRegressionHuber: null,
      trendDirectionMacroF1: null,
      trendDirectionSupport: { up: 0, flat: 0, down: 0 },
      clobRegressionMae: null,
      clobRegressionRmse: null,
      clobRegressionHuber: null,
      clobDirectionMacroF1: null,
      clobDirectionSupport: { up: 0, flat: 0, down: 0 },
      sampleCount: 0,
    };
    return metrics;
  }

  private initializeStatuses(): void {
    this.supportedAssets.forEach((asset) => {
      this.supportedWindows.forEach((window) => {
        const modelKey = this.buildModelKey(asset, window);
        const trendSequenceLength = this.modelFeatureService.getSequenceLength(asset, "trend");
        const clobSequenceLength = this.modelFeatureService.getSequenceLength(modelKey, "clob");
        const trendFeatureCount = this.modelFeatureService.buildFeatureNames().trendFeatures.length;
        const clobFeatureCount = this.modelFeatureService.buildFeatureNames().clobFeatures.length;
        this.statusRegistry.set(modelKey, {
          modelKey,
          asset,
          window,
          state: "idle",
          modelFamily: "tcn",
          version: 0,
          persistedVersion: 0,
          trendModelKey: asset,
          trendVersion: 0,
          clobVersion: 0,
          trendSequenceLength,
          clobSequenceLength,
          trendFeatureCount,
          clobFeatureCount,
          featureCountTrend: trendFeatureCount,
          featureCountClob: clobFeatureCount,
          lastTrainingStartedAt: null,
          lastTrainingCompletedAt: null,
          lastValidationWindowStart: null,
          lastValidationWindowEnd: null,
          lastRestoredAt: null,
          trainingSampleCount: 0,
          validationSampleCount: 0,
          latestSnapshotAt: null,
          liveSnapshotCount: 0,
          activeMarket: null,
          metrics: this.buildBaseMetrics(),
          lastError: null,
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
    const currentStatus = this.getStatus(modelKey);
    this.statusRegistry.set(modelKey, {
      ...currentStatus,
      ...statusPatch,
    });
  }

  private buildCompositeMetrics(asset: ModelAsset, modelKey: ModelClobKey): ModelMetrics {
    const trendArtifact = this.trendArtifactRegistry.get(asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const metrics: ModelMetrics = {
      trendRegressionMae: trendArtifact?.model.metrics.regressionMae || null,
      trendRegressionRmse: trendArtifact?.model.metrics.regressionRmse || null,
      trendRegressionHuber: trendArtifact?.model.metrics.regressionHuber || null,
      trendDirectionMacroF1: trendArtifact?.model.metrics.directionMacroF1 || null,
      trendDirectionSupport: trendArtifact?.model.metrics.directionSupport || { up: 0, flat: 0, down: 0 },
      clobRegressionMae: clobArtifact?.model.metrics.regressionMae || null,
      clobRegressionRmse: clobArtifact?.model.metrics.regressionRmse || null,
      clobRegressionHuber: clobArtifact?.model.metrics.regressionHuber || null,
      clobDirectionMacroF1: clobArtifact?.model.metrics.directionMacroF1 || null,
      clobDirectionSupport: clobArtifact?.model.metrics.directionSupport || { up: 0, flat: 0, down: 0 },
      sampleCount: Math.max(trendArtifact?.model.metrics.sampleCount || 0, clobArtifact?.model.metrics.sampleCount || 0),
    };
    return metrics;
  }

  private refreshModelStatus(modelKey: ModelClobKey): void {
    const currentStatus = this.getStatus(modelKey);
    const trendArtifact = this.trendArtifactRegistry.get(currentStatus.asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const isReady = trendArtifact !== null && clobArtifact !== null;
    const version = clobArtifact?.version || 0;
    const lastCompletedAt = clobArtifact?.trainedAt || trendArtifact?.trainedAt || currentStatus.lastTrainingCompletedAt;
    const validationWindowStart = clobArtifact?.lastValidationWindowStart || trendArtifact?.lastValidationWindowStart || null;
    const validationWindowEnd = clobArtifact?.lastValidationWindowEnd || trendArtifact?.lastValidationWindowEnd || null;
    const trainingSampleCount = clobArtifact?.trainingSampleCount || trendArtifact?.trainingSampleCount || 0;
    const validationSampleCount = clobArtifact?.validationSampleCount || trendArtifact?.validationSampleCount || 0;
    this.updateStatus(modelKey, {
      state: isReady ? "ready" : currentStatus.state,
      version,
      persistedVersion: version,
      trendVersion: trendArtifact?.version || 0,
      clobVersion: clobArtifact?.version || 0,
      lastTrainingCompletedAt: lastCompletedAt,
      lastValidationWindowStart: validationWindowStart,
      lastValidationWindowEnd: validationWindowEnd,
      trainingSampleCount,
      validationSampleCount,
      metrics: this.buildCompositeMetrics(currentStatus.asset, modelKey),
      lastError: null,
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

  private buildOverlapStartTimestamp(): number {
    const overlapStartTimestamp = Date.now() - config.MODEL_HISTORY_LOOKBACK_HOURS * 60 * 60 * 1_000;
    return overlapStartTimestamp;
  }

  private buildHistoricalFromDate(): string {
    const overlapTimestamp = this.lastTrainedSnapshotAt === null ? null : this.lastTrainedSnapshotAt - this.modelFeatureService.getRequiredOverlapMs();
    const historicalFromTimestamp =
      overlapTimestamp === null ? this.buildOverlapStartTimestamp() : Math.max(this.buildOverlapStartTimestamp(), overlapTimestamp);
    const historicalFromDate = new Date(historicalFromTimestamp).toISOString();
    return historicalFromDate;
  }

  private mergeSnapshots(historicalSnapshots: FlatSnapshot[], liveSnapshots: FlatSnapshot[]): FlatSnapshot[] {
    const mergedSnapshots = [...historicalSnapshots, ...liveSnapshots]
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

  private async restorePersistedState(): Promise<void> {
    const manifestSnapshot = this.shouldRestoreOnStart ? await this.modelPersistenceService.loadManifest() : null;

    if (manifestSnapshot !== null) {
      this.lastTrainingCycleAt = manifestSnapshot.lastTrainingCycleAt;
      this.lastTrainedSnapshotAt = manifestSnapshot.lastTrainedSnapshotAt === null ? null : Date.parse(manifestSnapshot.lastTrainedSnapshotAt);

      for (const trendModel of manifestSnapshot.trendModels) {
        this.trendArtifactRegistry.set(trendModel.trendKey, trendModel.artifact);
        await this.modelTrainingService.loadTrend(trendModel.artifact);
      }

      for (const clobModel of manifestSnapshot.clobModels) {
        this.clobArtifactRegistry.set(clobModel.modelKey, clobModel.artifact);
        this.statusRegistry.set(clobModel.modelKey, {
          ...clobModel.status,
          lastRestoredAt: new Date().toISOString(),
        });
        await this.modelTrainingService.loadClob(clobModel.artifact);
      }

      this.statusRegistry.forEach((_status, modelKey) => {
        this.refreshModelStatus(modelKey);
      });
    }
  }

  private markTrainingStarted(startedAt: string): void {
    this.isTrainingCycleRunning = true;
    this.statusRegistry.forEach((status, modelKey) => {
      this.updateStatus(modelKey, {
        lastTrainingStartedAt: startedAt,
        lastError: null,
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

  private async replaceTrendArtifact(asset: ModelTrendKey, artifact: ModelTrendArtifact): Promise<void> {
    const previousArtifact = this.trendArtifactRegistry.get(asset) || null;
    this.trendArtifactRegistry.set(asset, artifact);
    await this.modelTrainingService.loadTrend(artifact);

    if (previousArtifact !== null) {
      await this.modelTrainingService.unloadTrend(previousArtifact.trendKey);
    }

    this.supportedWindows.forEach((window) => {
      this.refreshModelStatus(this.buildModelKey(asset, window));
    });
  }

  private async replaceClobArtifact(modelKey: ModelClobKey, artifact: ModelClobArtifact): Promise<void> {
    const previousArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    this.clobArtifactRegistry.set(modelKey, artifact);
    await this.modelTrainingService.loadClob(artifact);

    if (previousArtifact !== null) {
      await this.modelTrainingService.unloadClob(previousArtifact.modelKey);
    }

    this.refreshModelStatus(modelKey);
  }

  private buildManifestTrendModels(): Array<{ artifact: ModelTrendArtifact; trendKey: ModelTrendKey }> {
    const trendModels = [...this.trendArtifactRegistry.entries()].map(([trendKey, artifact]) => ({
      artifact,
      trendKey,
    }));
    return trendModels;
  }

  private buildManifestClobModels(): Array<{ artifact: ModelClobArtifact; modelKey: ModelClobKey; status: ModelStatus }> {
    const clobModels = [...this.clobArtifactRegistry.entries()].map(([modelKey, artifact]) => ({
      artifact,
      modelKey,
      status: this.getStatus(modelKey),
    }));
    return clobModels;
  }

  private logTrainingBlock(modelKey: string, version: number, trainingSampleCount: number, validationSampleCount: number): void {
    if (this.shouldLogTrainingProgress) {
      logger.info(`training block completed model=${modelKey} version=${version} train=${trainingSampleCount} valid=${validationSampleCount}`);
    }
  }

  private buildStatusPayload(): ModelStatusPayload {
    const models = [...this.statusRegistry.values()].sort((leftStatus, rightStatus) => leftStatus.modelKey.localeCompare(rightStatus.modelKey));
    const statusPayload: ModelStatusPayload = {
      isTrainingCycleRunning: this.isTrainingCycleRunning,
      lastTrainingCycleAt: this.lastTrainingCycleAt,
      models,
      liveSnapshotCount: models.at(0)?.liveSnapshotCount || 0,
      latestSnapshotAt: models.at(0)?.latestSnapshotAt || null,
    };
    return statusPayload;
  }

  private buildPredictionPayload(
    input: ModelPredictionInput,
    trendPrediction: { predictedValue: number; probabilities: { down: number; flat: number; up: number } },
    clobPrediction: { predictedValue: number; probabilities: { down: number; flat: number; up: number } },
    fusionPayload: ModelPredictionPayload["fusion"],
  ): ModelPredictionPayload {
    const predictionPayload: ModelPredictionPayload = {
      modelKey: input.clobInput.modelKey,
      generatedAt: new Date(input.clobInput.decisionTime).toISOString(),
      activeMarket: input.clobInput.activeMarket,
      trend: {
        predictedReturn: trendPrediction.predictedValue,
        fairUpProbability: this.modelCostService.readTrendFairProbability(input, trendPrediction.predictedValue),
        probabilities: trendPrediction.probabilities,
        isChainlinkFresh: input.trendInput.isChainlinkFresh,
      },
      clob: {
        currentUpMid: input.clobInput.currentUpMid,
        predictedUpMid: clobPrediction.predictedValue,
        edge: input.clobInput.currentUpMid === null ? null : clobPrediction.predictedValue - input.clobInput.currentUpMid,
        probabilities: clobPrediction.probabilities,
        isOrderBookFresh: input.clobInput.isOrderBookFresh,
      },
      fusion: fusionPayload,
      liveSnapshotCount: this.snapshotStoreService.getLiveSnapshots().length,
    };
    return predictionPayload;
  }

  /**
   * @section public:methods
   */

  public async start(): Promise<void> {
    if (!this.isStarted) {
      await this.modelTrainingService.ensurePythonRuntime();
      await this.restorePersistedState();
      await this.snapshotStoreService.start();
      this.refreshLiveStatusFields();
      await this.runTrainingCycle();
      this.trainingTimer = setInterval(async () => {
        await this.runTrainingCycle();
      }, this.trainingIntervalMs);
      this.isStarted = true;
    }
  }

  public async stop(): Promise<void> {
    if (this.trainingTimer !== null) {
      clearInterval(this.trainingTimer);
      this.trainingTimer = null;
    }

    if (this.isStarted) {
      await this.snapshotStoreService.stop();

      for (const trendKey of this.trendArtifactRegistry.keys()) {
        await this.modelTrainingService.unloadTrend(trendKey);
      }

      for (const modelKey of this.clobArtifactRegistry.keys()) {
        await this.modelTrainingService.unloadClob(modelKey);
      }

      await this.modelTrainingService.stop();
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
        const historicalSnapshots = await this.collectorClientService.readSnapshots({
          fromDate: this.buildHistoricalFromDate(),
          toDate: new Date().toISOString(),
        });
        const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
        const mergedSnapshots = this.mergeSnapshots(historicalSnapshots, liveSnapshots);
        const trendSamples = this.modelFeatureService.buildTrendTrainingSamples(mergedSnapshots);
        const clobSamples = this.modelFeatureService.buildClobTrainingSamples(mergedSnapshots);

        for (const asset of this.supportedAssets) {
          const trendArtifact = await this.modelTrainingService.trainTrend(
            asset,
            trendSamples.filter((sample) => sample.trendKey === asset),
            this.trendArtifactRegistry.get(asset)?.version || 0,
          );

          if (trendArtifact.artifact !== null) {
            await this.replaceTrendArtifact(asset, trendArtifact.artifact);
            this.logTrainingBlock(asset, trendArtifact.artifact.version, trendArtifact.trainingSampleCount, trendArtifact.validationSampleCount);
          }
        }

        for (const asset of this.supportedAssets) {
          for (const window of this.supportedWindows) {
            const modelKey = this.buildModelKey(asset, window);
            const clobArtifact = await this.modelTrainingService.trainClob(
              modelKey,
              clobSamples.filter((sample) => sample.modelKey === modelKey),
              this.clobArtifactRegistry.get(modelKey)?.version || 0,
            );

            if (clobArtifact.artifact !== null) {
              await this.replaceClobArtifact(modelKey, clobArtifact.artifact);
              this.logTrainingBlock(modelKey, clobArtifact.artifact.version, clobArtifact.trainingSampleCount, clobArtifact.validationSampleCount);
            }
          }
        }

        this.lastTrainingCycleAt = new Date().toISOString();
        this.lastTrainedSnapshotAt = mergedSnapshots.at(-1)?.generated_at || this.lastTrainedSnapshotAt;
        await this.modelPersistenceService.persistManifest(
          this.buildManifestTrendModels(),
          this.buildManifestClobModels(),
          this.lastTrainingCycleAt,
          this.lastTrainedSnapshotAt === null ? null : new Date(this.lastTrainedSnapshotAt).toISOString(),
        );
        this.isTrainingCycleRunning = false;
        this.refreshLiveStatusFields();
        logger.info(
          `training cycle completed trendModels=${this.trendArtifactRegistry.size} clobModels=${this.clobArtifactRegistry.size} historical=${historicalSnapshots.length} live=${liveSnapshots.length} trendSamples=${trendSamples.length} clobSamples=${clobSamples.length} durationMs=${Date.now() - cycleStartedAt}`,
        );
      } catch (error) {
        logger.error(`training cycle catch error=${error instanceof Error ? error.message : "unknown error"}`);
        this.markTrainingFailed(error);
      }
    }
  }

  public getStatusPayload(): ModelStatusPayload {
    const statusPayload = this.buildStatusPayload();
    return statusPayload;
  }

  public getModelStatus(asset: ModelAsset, window: ModelWindow): ModelStatus {
    const modelStatus = this.getStatus(this.buildModelKey(asset, window));
    return modelStatus;
  }

  public async predict(request: ModelPredictionRequest): Promise<ModelPredictionPayload> {
    const modelKey = this.buildModelKey(request.asset, request.window);
    const trendArtifact = this.trendArtifactRegistry.get(request.asset) || null;
    const clobArtifact = this.clobArtifactRegistry.get(modelKey) || null;
    const predictionInput = this.modelFeatureService.buildPredictionInput(this.snapshotStoreService.getLiveSnapshots(), request);

    if (trendArtifact === null || clobArtifact === null) {
      throw new Error(`no persisted model available for ${modelKey}`);
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
    const predictionPayload = this.buildPredictionPayload(predictionInput, trendPrediction, clobPrediction, fusionPayload);
    return predictionPayload;
  }
}
