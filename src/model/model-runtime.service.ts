/**
 * @section imports:internals
 */

import { CollectorClientService } from "../collector/collector-client.service.ts";
import config from "../config.ts";
import logger from "../logger.ts";
import { SnapshotStoreService } from "../snapshot/snapshot-store.service.ts";
import type {
  FlatSnapshot,
  ModelArtifact,
  ModelAsset,
  ModelFeatureInput,
  ModelKey,
  ModelPredictionPayload,
  ModelPredictionRequest,
  ModelStatus,
  ModelStatusPayload,
  ModelWindow,
} from "./model.types.ts";
import { ModelCostService } from "./model-cost.service.ts";
import { ModelFeatureService } from "./model-feature.service.ts";
import { ModelPersistenceService } from "./model-persistence.service.ts";
import type { ModelLoadedArtifact, ModelTrainResult } from "./model-runtime.types.ts";
import { TensorflowModelService } from "./tensorflow-model.service.ts";

/**
 * @section types
 */

type ModelRuntimeServiceOptions = {
  collectorClientService: CollectorClientService;
  modelCostService: ModelCostService;
  modelFeatureService: ModelFeatureService;
  modelPersistenceService: ModelPersistenceService;
  shouldLogTrainingProgress: boolean;
  shouldRestoreOnStart: boolean;
  snapshotStoreService: SnapshotStoreService;
  supportedAssets: ModelAsset[];
  supportedWindows: ModelWindow[];
  tensorflowModelService: TensorflowModelService;
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

  private readonly shouldLogTrainingProgress: boolean;

  private readonly shouldRestoreOnStart: boolean;

  private readonly snapshotStoreService: SnapshotStoreService;

  private readonly supportedAssets: ModelAsset[];

  private readonly supportedWindows: ModelWindow[];

  private readonly tensorflowModelService: TensorflowModelService;

  private readonly trainingIntervalMs: number;

  private readonly artifactRegistry: Map<ModelKey, { artifact: ModelArtifact; loadedArtifact: ModelLoadedArtifact }>;

  private readonly statusRegistry: Map<ModelKey, ModelStatus>;

  private isStarted: boolean;

  private isTrainingCycleRunning: boolean;

  private lastTrainingCycleAt: string | null;

  private lastTrainedSnapshotAt: number | null;

  private trainingTimer: ReturnType<typeof setInterval> | null;

  /**
   * @section constructor
   */

  public constructor(options: ModelRuntimeServiceOptions) {
    this.collectorClientService = options.collectorClientService;
    this.modelCostService = options.modelCostService;
    this.modelFeatureService = options.modelFeatureService;
    this.modelPersistenceService = options.modelPersistenceService;
    this.shouldLogTrainingProgress = options.shouldLogTrainingProgress;
    this.shouldRestoreOnStart = options.shouldRestoreOnStart;
    this.snapshotStoreService = options.snapshotStoreService;
    this.supportedAssets = options.supportedAssets;
    this.supportedWindows = options.supportedWindows;
    this.tensorflowModelService = options.tensorflowModelService;
    this.trainingIntervalMs = options.trainingIntervalMs;
    this.artifactRegistry = new Map<ModelKey, { artifact: ModelArtifact; loadedArtifact: ModelLoadedArtifact }>();
    this.statusRegistry = new Map<ModelKey, ModelStatus>();
    this.isStarted = false;
    this.isTrainingCycleRunning = false;
    this.lastTrainingCycleAt = null;
    this.lastTrainedSnapshotAt = null;
    this.trainingTimer = null;
    this.initializeStatuses();
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelRuntimeService {
    const modelFeatureService = ModelFeatureService.createDefault();
    const modelRuntimeService = new ModelRuntimeService({
      collectorClientService: CollectorClientService.createDefault(),
      modelCostService: ModelCostService.createDefault(),
      modelFeatureService,
      modelPersistenceService: ModelPersistenceService.createDefault(),
      shouldLogTrainingProgress: config.MODEL_LOG_TRAINING_PROGRESS,
      shouldRestoreOnStart: config.MODEL_RESTORE_ON_START,
      snapshotStoreService: SnapshotStoreService.createDefault(),
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: config.MODEL_SUPPORTED_WINDOWS as ModelWindow[],
      tensorflowModelService: TensorflowModelService.createDefault(modelFeatureService.buildFeatureNames()),
      trainingIntervalMs: config.MODEL_TRAINING_INTERVAL_MS,
    });
    return modelRuntimeService;
  }

  /**
   * @section private:methods
   */

  private buildModelKey(asset: ModelAsset, window: ModelWindow): ModelKey {
    const modelKey = `${asset}_${window}` as ModelKey;
    return modelKey;
  }

  private initializeStatuses(): void {
    this.supportedAssets.forEach((asset) => {
      this.supportedWindows.forEach((window) => {
        const modelKey = this.buildModelKey(asset, window);
        this.statusRegistry.set(modelKey, {
          modelKey,
          asset,
          window,
          state: "idle",
          modelFamily: "tcn",
          version: 0,
          persistedVersion: 0,
          trendSequenceLength: this.modelFeatureService.getSequenceLength(modelKey, "trend"),
          clobSequenceLength: this.modelFeatureService.getSequenceLength(modelKey, "clob"),
          featureCountTrend: this.modelFeatureService.buildFeatureNames().trendFeatures.length,
          featureCountClob: this.modelFeatureService.buildFeatureNames().clobFeatures.length,
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
          metrics: {
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
          },
          lastError: null,
        });
      });
    });
  }

  private buildManifestModels(): Array<{ artifact: ModelArtifact; modelKey: ModelKey; status: ModelStatus }> {
    const manifestModels = [...this.artifactRegistry.entries()].map(([modelKey, registryEntry]) => ({
      artifact: registryEntry.artifact,
      modelKey,
      status: this.getStatus(modelKey),
    }));
    return manifestModels;
  }

  private getStatus(modelKey: ModelKey): ModelStatus {
    const modelStatus = this.statusRegistry.get(modelKey);

    if (modelStatus === undefined) {
      throw new Error(`missing status for ${modelKey}`);
    }

    return modelStatus;
  }

  private updateStatus(modelKey: ModelKey, statusPatch: Partial<ModelStatus>): void {
    const currentStatus = this.getStatus(modelKey);
    this.statusRegistry.set(modelKey, {
      ...currentStatus,
      ...statusPatch,
    });
  }

  private refreshLiveStatusFields(): void {
    const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
    const latestSnapshotAt = this.snapshotStoreService.getLatestSnapshotAt();
    const predictionContexts = liveSnapshots.length === 0 ? [] : this.modelFeatureService.buildSnapshotContexts(liveSnapshots);
    const latestContext = predictionContexts.at(-1) || null;

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

      for (const model of manifestSnapshot.models) {
        try {
          const loadedArtifact = await this.tensorflowModelService.loadArtifact(model.artifact, this.modelPersistenceService.getStateDirectoryPath());
          this.artifactRegistry.set(model.modelKey, {
            artifact: model.artifact,
            loadedArtifact,
          });
          this.statusRegistry.set(model.modelKey, {
            ...model.status,
            lastRestoredAt: new Date().toISOString(),
          });
          logger.info(`model restore completed model=${model.modelKey} version=${model.artifact.version}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "artifact restore failed";
          logger.error(`model restore failed model=${model.modelKey} error=${errorMessage}`);
          this.updateStatus(model.modelKey, {
            lastError: errorMessage,
            state: "error",
          });
        }
      }
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
      this.updateStatus(modelKey, {
        lastError: errorMessage,
        state: this.artifactRegistry.has(modelKey) ? "ready" : "error",
      });
    });
  }

  private logTrainingBlock(modelKey: ModelKey, artifact: ModelArtifact, durationMs: number): void {
    if (this.shouldLogTrainingProgress) {
      logger.info(
        `training block completed model=${modelKey} version=${artifact.version} train=${artifact.trainingSampleCount} valid=${artifact.validationSampleCount} ` +
          `trendMae=${artifact.metrics.trendRegressionMae ?? "null"} clobMae=${artifact.metrics.clobRegressionMae ?? "null"} ` +
          `trendF1=${artifact.metrics.trendDirectionMacroF1 ?? "null"} clobF1=${artifact.metrics.clobDirectionMacroF1 ?? "null"} ` +
          `durationMs=${durationMs} persistedDir=${this.modelPersistenceService.getStateDirectoryPath()}/${artifact.trendModel.modelPath}`,
      );
    }
  }

  private applyPersistedArtifact(
    modelKey: ModelKey,
    trainResult: ModelTrainResult,
    persistedArtifact: ModelArtifact,
    loadedArtifact: ModelLoadedArtifact,
  ): void {
    const currentStatus = this.getStatus(modelKey);
    this.artifactRegistry.set(modelKey, {
      artifact: persistedArtifact,
      loadedArtifact,
    });
    this.updateStatus(modelKey, {
      state: "ready",
      version: persistedArtifact.version,
      persistedVersion: persistedArtifact.version,
      lastTrainingCompletedAt: persistedArtifact.trainedAt,
      lastValidationWindowStart: persistedArtifact.lastValidationWindowStart,
      lastValidationWindowEnd: persistedArtifact.lastValidationWindowEnd,
      metrics: persistedArtifact.metrics,
      trainingSampleCount: trainResult.trainingSampleCount,
      validationSampleCount: trainResult.validationSampleCount,
      lastError: null,
      activeMarket: currentStatus.activeMarket,
    });
  }

  private buildStatusPayload(): ModelStatusPayload {
    const models = [...this.statusRegistry.values()].sort((leftStatus, rightStatus) => leftStatus.modelKey.localeCompare(rightStatus.modelKey));
    const liveSnapshotCount = models.at(0)?.liveSnapshotCount || 0;
    const latestSnapshotAt = models.at(0)?.latestSnapshotAt || null;
    const statusPayload: ModelStatusPayload = {
      isTrainingCycleRunning: this.isTrainingCycleRunning,
      lastTrainingCycleAt: this.lastTrainingCycleAt,
      models,
      liveSnapshotCount,
      latestSnapshotAt,
    };
    return statusPayload;
  }

  private async trainModel(modelKey: ModelKey, samples: ReturnType<ModelFeatureService["buildTrainingSamples"]>): Promise<void> {
    const [asset, window] = modelKey.split("_") as [ModelAsset, ModelWindow];
    const previousVersion = this.artifactRegistry.get(modelKey)?.artifact.version || 0;
    const blockStartedAt = Date.now();
    const trainResult = await this.tensorflowModelService.train(asset, window, samples, previousVersion);

    if (trainResult.artifact !== null) {
      const persistenceResult = await this.modelPersistenceService.persistModelArtifact(modelKey, trainResult.artifact);
      this.applyPersistedArtifact(modelKey, trainResult, persistenceResult.artifact, persistenceResult.loadedArtifact);
      this.logTrainingBlock(modelKey, persistenceResult.artifact, Date.now() - blockStartedAt);
    }
  }

  private buildPredictionPayload(
    modelKey: ModelKey,
    input: ModelFeatureInput,
    predictionResult: ReturnType<TensorflowModelService["predict"]>,
    fusionPayload: ModelPredictionPayload["fusion"],
  ): ModelPredictionPayload {
    const predictionPayload: ModelPredictionPayload = {
      modelKey,
      generatedAt: new Date(input.decisionTime).toISOString(),
      activeMarket: input.activeMarket,
      trend: {
        predictedReturn: predictionResult.trend.predictedValue,
        fairUpProbability: this.modelCostService.readTrendFairProbability(input, predictionResult.trend.predictedValue),
        probabilities: predictionResult.trend.probabilities,
        isChainlinkFresh: input.isChainlinkFresh,
      },
      clob: {
        currentUpMid: input.currentUpMid,
        predictedUpMid: predictionResult.clob.predictedValue,
        edge: input.currentUpMid === null ? null : predictionResult.clob.predictedValue - input.currentUpMid,
        probabilities: predictionResult.clob.probabilities,
        isOrderBookFresh: input.isOrderBookFresh,
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
      this.artifactRegistry.forEach((registryEntry) => {
        this.tensorflowModelService.disposeArtifact(registryEntry.loadedArtifact);
      });
      this.artifactRegistry.clear();
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
        const samples = this.modelFeatureService.buildTrainingSamples(mergedSnapshots);

        for (const asset of this.supportedAssets) {
          for (const window of this.supportedWindows) {
            await this.trainModel(this.buildModelKey(asset, window), samples);
          }
        }

        this.lastTrainingCycleAt = new Date().toISOString();
        this.lastTrainedSnapshotAt = mergedSnapshots.at(-1)?.generated_at || this.lastTrainedSnapshotAt;
        await this.modelPersistenceService.persistManifest(
          this.buildManifestModels(),
          this.lastTrainingCycleAt,
          this.lastTrainedSnapshotAt === null ? null : new Date(this.lastTrainedSnapshotAt).toISOString(),
        );
        this.isTrainingCycleRunning = false;
        this.refreshLiveStatusFields();
        logger.info(
          `training cycle completed models=${this.artifactRegistry.size} historical=${historicalSnapshots.length} live=${liveSnapshots.length} ` +
            `merged=${mergedSnapshots.length} samples=${samples.length} lastTrainedSnapshotAt=${this.lastTrainedSnapshotAt === null ? "null" : new Date(this.lastTrainedSnapshotAt).toISOString()} durationMs=${Date.now() - cycleStartedAt}`,
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
    const registryEntry = this.artifactRegistry.get(modelKey) || null;
    const input = this.modelFeatureService.buildPredictionInput(this.snapshotStoreService.getLiveSnapshots(), request);

    if (registryEntry === null) {
      throw new Error(`no persisted model available for ${modelKey}`);
    }

    if (input === null) {
      throw new Error(`insufficient live snapshots for ${modelKey}`);
    }

    const predictionResult = this.tensorflowModelService.predict(registryEntry.loadedArtifact, input);
    const fusionPayload = await this.modelCostService.buildFusionPayload(
      input,
      {
        predictedReturn: predictionResult.trend.predictedValue,
        probabilities: predictionResult.trend.probabilities,
      },
      {
        predictedUpMid: predictionResult.clob.predictedValue,
        probabilities: predictionResult.clob.probabilities,
      },
    );
    const predictionPayload = this.buildPredictionPayload(modelKey, input, predictionResult, fusionPayload);
    return predictionPayload;
  }
}
