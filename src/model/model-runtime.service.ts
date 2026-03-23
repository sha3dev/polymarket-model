/**
 * @section imports:externals
 */

import { randomUUID } from "node:crypto";

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
  ModelArtifact,
  ModelAsset,
  ModelDirectionProbability,
  ModelPredictedDirection,
  ModelPredictionPayload,
  ModelPredictionRecord,
  ModelPredictionRecordPayload,
  ModelPredictionRequest,
  ModelRollingPredictionOutcome,
  ModelRuntimeStateAssetSnapshot,
  ModelRuntimeStateSnapshot,
  ModelState,
  ModelStatus,
  ModelStatusPayload,
} from "./model.types.ts";
import { ModelFeatureService } from "./model-feature.service.ts";
import { ModelRuntimeStateService } from "./model-runtime-state.service.ts";
import { ModelTrainingService } from "./model-training.service.ts";

/**
 * @section consts
 */

const UNIX_EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const RECENT_PREDICTION_LIMIT = 50;
const PREDICTION_TIE_EPSILON = 0.0005;

/**
 * @section types
 */

type ModelRuntimeServiceOptions = {
  collectorClientService: CollectorClientService;
  modelFeatureService: ModelFeatureService;
  modelRuntimeStateService: ModelRuntimeStateService;
  modelTrainingService: ModelTrainingService;
  processIntervalMs: number;
  rollingHitRateWindowMs: number;
  shouldEnableAutomaticPredictions: boolean;
  shouldLogTrainingProgress: boolean;
  shouldRestoreOnStart: boolean;
  snapshotStoreService: SnapshotStoreService;
  supportedAssets: ModelAsset[];
};

/**
 * @section class
 */

export class ModelRuntimeService {
  /**
   * @section private:attributes
   */

  private readonly collectorClientService: CollectorClientService;

  private readonly modelFeatureService: ModelFeatureService;

  private readonly modelRuntimeStateService: ModelRuntimeStateService;

  private readonly modelTrainingService: ModelTrainingService;

  private readonly processIntervalMs: number;

  private readonly rollingHitRateWindowMs: number;

  private readonly shouldEnableAutomaticPredictions: boolean;

  private readonly shouldLogTrainingProgress: boolean;

  private readonly shouldRestoreOnStart: boolean;

  private readonly snapshotStoreService: SnapshotStoreService;

  private readonly supportedAssets: ModelAsset[];

  private readonly artifactRegistry: Map<ModelAsset, ModelArtifact>;

  private readonly assetPredictionRegistry: Map<ModelAsset, string[]>;

  private readonly pendingResolutionTimerRegistry: Map<string, ReturnType<typeof setTimeout>>;

  private readonly predictionRegistry: Map<string, ModelPredictionRecord>;

  private readonly rollingOutcomeRegistry: Map<ModelAsset, ModelRollingPredictionOutcome[]>;

  private readonly statusRegistry: Map<ModelAsset, ModelStatus>;

  private isProcessing: boolean;

  private isStarted: boolean;

  private lastHistoricalBlockCompletedAt: string | null;

  private processingTimer: ReturnType<typeof setInterval> | null;

  /**
   * @section constructor
   */

  public constructor(options: ModelRuntimeServiceOptions) {
    this.collectorClientService = options.collectorClientService;
    this.modelFeatureService = options.modelFeatureService;
    this.modelRuntimeStateService = options.modelRuntimeStateService;
    this.modelTrainingService = options.modelTrainingService;
    this.processIntervalMs = options.processIntervalMs;
    this.rollingHitRateWindowMs = options.rollingHitRateWindowMs;
    this.shouldEnableAutomaticPredictions = options.shouldEnableAutomaticPredictions;
    this.shouldLogTrainingProgress = options.shouldLogTrainingProgress;
    this.shouldRestoreOnStart = options.shouldRestoreOnStart;
    this.snapshotStoreService = options.snapshotStoreService;
    this.supportedAssets = options.supportedAssets;
    this.artifactRegistry = new Map<ModelAsset, ModelArtifact>();
    this.assetPredictionRegistry = new Map<ModelAsset, string[]>();
    this.pendingResolutionTimerRegistry = new Map<string, ReturnType<typeof setTimeout>>();
    this.predictionRegistry = new Map<string, ModelPredictionRecord>();
    this.rollingOutcomeRegistry = new Map<ModelAsset, ModelRollingPredictionOutcome[]>();
    this.statusRegistry = new Map<ModelAsset, ModelStatus>();
    this.isProcessing = false;
    this.isStarted = false;
    this.lastHistoricalBlockCompletedAt = null;
    this.processingTimer = null;
    this.initializeRegistries();
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelRuntimeService {
    const modelFeatureService = ModelFeatureService.createDefault();
    const modelRuntimeService = new ModelRuntimeService({
      collectorClientService: CollectorClientService.createDefault(),
      modelFeatureService,
      modelRuntimeStateService: ModelRuntimeStateService.createDefault(),
      modelTrainingService: ModelTrainingService.createDefault(modelFeatureService.buildFeatureNames()),
      processIntervalMs: config.MODEL_PROCESS_INTERVAL_MS,
      rollingHitRateWindowMs: config.MODEL_ROLLING_HIT_RATE_WINDOW_MS,
      shouldEnableAutomaticPredictions: config.MODEL_AUTOMATIC_PREDICTIONS_ENABLED,
      shouldLogTrainingProgress: config.MODEL_LOG_TRAINING_PROGRESS,
      shouldRestoreOnStart: config.MODEL_RESTORE_ON_START,
      snapshotStoreService: SnapshotStoreService.createDefault(),
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
    });
    return modelRuntimeService;
  }

  /**
   * @section private:methods
   */

  private initializeRegistries(): void {
    this.supportedAssets.forEach((asset) => {
      this.assetPredictionRegistry.set(asset, []);
      this.rollingOutcomeRegistry.set(asset, []);
      this.statusRegistry.set(asset, this.buildBaseStatus(asset));
    });
  }

  private buildBaseStatus(asset: ModelAsset): ModelStatus {
    const modelStatus: ModelStatus = {
      asset,
      currentBlockEndAt: null,
      currentBlockStartAt: null,
      isLiveReady: false,
      lastCollectorFromAt: null,
      lastError: null,
      lastLiveSnapshotAt: null,
      lastPredictionAt: null,
      lastPredictionSource: null,
      lastPredictionWasCorrect: null,
      lastTrainingAt: null,
      lastTrainingStatus: "idle",
      latestPrediction: null,
      modelFamily: "tcn",
      rollingCorrectCount: 0,
      rollingHitRate: null,
      rollingPredictionCount: 0,
      state: "idle",
      trainingCount: 0,
    };
    return modelStatus;
  }

  private getStatus(asset: ModelAsset): ModelStatus {
    const status = this.statusRegistry.get(asset);

    if (status === undefined) {
      throw new Error(`missing status for ${asset}`);
    }

    return status;
  }

  private updateStatus(asset: ModelAsset, statusPatch: Partial<ModelStatus>): void {
    this.statusRegistry.set(asset, {
      ...this.getStatus(asset),
      ...statusPatch,
    });
  }

  private buildRollingWindowStartAt(referenceTime: number): number {
    const rollingWindowStartAt = referenceTime - this.rollingHitRateWindowMs;
    return rollingWindowStartAt;
  }

  private pruneRollingOutcomes(asset: ModelAsset, referenceTime: number): void {
    const rollingWindowStartAt = this.buildRollingWindowStartAt(referenceTime);
    const rollingPredictionOutcomes = (this.rollingOutcomeRegistry.get(asset) || []).filter(
      (outcome) => Date.parse(outcome.resolvedAt) >= rollingWindowStartAt,
    );
    this.rollingOutcomeRegistry.set(asset, rollingPredictionOutcomes);
  }

  private buildRuntimeStateAssetSnapshot(asset: ModelAsset): ModelRuntimeStateAssetSnapshot {
    const assetStateSnapshot: ModelRuntimeStateAssetSnapshot = {
      lastCollectorFromAt: this.getStatus(asset).lastCollectorFromAt,
      lastProcessedBlockEndAt: this.getStatus(asset).currentBlockEndAt,
      lastProcessedBlockStartAt: this.getStatus(asset).currentBlockStartAt,
      recentPredictionRecords: this.listAssetPredictions(asset),
      rollingPredictionOutcomes: [...(this.rollingOutcomeRegistry.get(asset) || [])],
    };
    return assetStateSnapshot;
  }

  private buildRuntimeStateSnapshot(): ModelRuntimeStateSnapshot {
    const assets = this.supportedAssets.reduce<Record<ModelAsset, ModelRuntimeStateAssetSnapshot>>(
      (assetMap, asset) => {
        assetMap[asset] = this.buildRuntimeStateAssetSnapshot(asset);
        return assetMap;
      },
      {} as Record<ModelAsset, ModelRuntimeStateAssetSnapshot>,
    );
    const runtimeStateSnapshot: ModelRuntimeStateSnapshot = {
      assets,
      lastHistoricalBlockCompletedAt: this.lastHistoricalBlockCompletedAt,
      schemaVersion: 2,
    };
    return runtimeStateSnapshot;
  }

  private async persistRuntimeState(): Promise<void> {
    await this.modelRuntimeStateService.persistState(this.buildRuntimeStateSnapshot());
  }

  private parseHeadMetadata(rawMetadata: Record<string, unknown> | null): TensorflowApiHeadMetadata | null {
    let headMetadata: TensorflowApiHeadMetadata | null = null;

    if (rawMetadata?.logicalKey && rawMetadata.logicalModelType === "crypto") {
      headMetadata = rawMetadata as unknown as TensorflowApiHeadMetadata;
    }

    return headMetadata;
  }

  private applyRemoteModelRecord(modelRecord: TensorflowApiModelRecord): void {
    const headMetadata = this.parseHeadMetadata(modelRecord.metadata);

    if (modelRecord.status === "ready" && headMetadata !== null) {
      this.artifactRegistry.set(headMetadata.logicalKey as ModelAsset, {
        asset: headMetadata.logicalKey as ModelAsset,
        lastValidationWindowEnd: headMetadata.lastValidationWindowEnd,
        lastValidationWindowStart: headMetadata.lastValidationWindowStart,
        model: {
          architecture: headMetadata.architecture,
          classWeights: headMetadata.classWeights,
          featureMedians: headMetadata.featureMedians,
          featureNames: headMetadata.featureNames,
          featureScales: headMetadata.featureScales,
          metrics: headMetadata.metrics,
          remoteModelId: modelRecord.modelId,
        },
        remoteModelId: modelRecord.modelId,
        trainedAt: headMetadata.trainedAt,
        trainingSampleCount: headMetadata.trainingSampleCount,
        validationSampleCount: headMetadata.validationSampleCount,
        version: modelRecord.trainingCount,
      });
      this.updateStatus(headMetadata.logicalKey as ModelAsset, {
        lastTrainingAt: headMetadata.trainedAt,
        lastTrainingStatus: "ready",
        trainingCount: modelRecord.trainingCount,
      });
    }
  }

  private async restorePersistedState(): Promise<void> {
    const runtimeStateSnapshot = this.shouldRestoreOnStart ? await this.modelRuntimeStateService.loadState() : this.buildRuntimeStateSnapshot();
    this.lastHistoricalBlockCompletedAt = runtimeStateSnapshot.lastHistoricalBlockCompletedAt;
    this.supportedAssets.forEach((asset) => {
      const assetState = runtimeStateSnapshot.assets[asset];
      const recentPredictionRecords = assetState?.recentPredictionRecords || [];
      const predictionIds = recentPredictionRecords.map((predictionRecord) => predictionRecord.predictionId);
      recentPredictionRecords.forEach((predictionRecord) => {
        this.predictionRegistry.set(predictionRecord.predictionId, predictionRecord);
      });
      this.assetPredictionRegistry.set(asset, predictionIds);
      this.rollingOutcomeRegistry.set(asset, [...(assetState?.rollingPredictionOutcomes || [])]);
      this.pruneRollingOutcomes(asset, Date.now());
      this.updateStatus(asset, {
        currentBlockEndAt: assetState?.lastProcessedBlockEndAt || null,
        currentBlockStartAt: assetState?.lastProcessedBlockStartAt || null,
        lastCollectorFromAt: assetState?.lastCollectorFromAt || null,
      });
      this.refreshPredictionStatusFields(asset);
    });

    if (this.shouldRestoreOnStart) {
      const remoteModelRecords = await this.modelTrainingService.readRemoteModels();
      remoteModelRecords.forEach((modelRecord) => {
        this.applyRemoteModelRecord(modelRecord);
      });
    }
  }

  private buildPredictionDirection(predictedReturn: number, predictedProbability: ModelDirectionProbability): ModelPredictedDirection {
    const probabilityGap = Math.abs(predictedProbability.up - predictedProbability.down);
    let predictedDirection: ModelPredictedDirection = "flat";

    if (probabilityGap > PREDICTION_TIE_EPSILON) {
      predictedDirection = predictedProbability.up > predictedProbability.down ? "up" : "down";
    }

    if (!Number.isFinite(predictedProbability.up) || !Number.isFinite(predictedProbability.down)) {
      predictedDirection = predictedReturn > 0 ? "up" : "down";
    }

    return predictedDirection;
  }

  private buildProbabilityDown(predictedProbability: ModelDirectionProbability): number | null {
    const predictedProbabilityDown = Number.isFinite(predictedProbability.down) ? predictedProbability.down : null;
    return predictedProbabilityDown;
  }

  private buildProbabilityUp(predictedProbability: ModelDirectionProbability): number | null {
    const predictedProbabilityUp = Number.isFinite(predictedProbability.up) ? predictedProbability.up : null;
    return predictedProbabilityUp;
  }

  private listAssetPredictions(asset: ModelAsset): ModelPredictionRecord[] {
    const predictionIds = this.assetPredictionRegistry.get(asset) || [];
    const predictionRecords = predictionIds
      .map((predictionId) => this.predictionRegistry.get(predictionId) || null)
      .filter((predictionRecord) => predictionRecord !== null);
    return predictionRecords;
  }

  private refreshPredictionStatusFields(asset: ModelAsset): void {
    const predictionRecords = this.listAssetPredictions(asset);
    const latestPrediction = predictionRecords.at(-1) || null;
    this.pruneRollingOutcomes(asset, Date.now());
    const rollingPredictionOutcomes = this.rollingOutcomeRegistry.get(asset) || [];
    const rollingCorrectCount = rollingPredictionOutcomes.filter((outcome) => outcome.isCorrect).length;
    this.updateStatus(asset, {
      lastPredictionAt: latestPrediction?.issuedAt || null,
      lastPredictionSource: latestPrediction?.source || null,
      lastPredictionWasCorrect: latestPrediction?.isCorrect ?? null,
      latestPrediction,
      rollingCorrectCount,
      rollingHitRate: rollingPredictionOutcomes.length === 0 ? null : rollingCorrectCount / rollingPredictionOutcomes.length,
      rollingPredictionCount: rollingPredictionOutcomes.length,
    });
  }

  private registerPrediction(predictionRecord: ModelPredictionRecord): void {
    const existingPredictionIds = this.assetPredictionRegistry.get(predictionRecord.asset) || [];
    const nextPredictionIds = [...existingPredictionIds, predictionRecord.predictionId];
    const removedPredictionIds = nextPredictionIds.slice(0, Math.max(nextPredictionIds.length - RECENT_PREDICTION_LIMIT, 0));
    const predictionIds = nextPredictionIds.slice(-RECENT_PREDICTION_LIMIT);

    removedPredictionIds.forEach((removedPredictionId) => {
      this.predictionRegistry.delete(removedPredictionId);
    });

    this.predictionRegistry.set(predictionRecord.predictionId, predictionRecord);
    this.assetPredictionRegistry.set(predictionRecord.asset, predictionIds);
    this.refreshPredictionStatusFields(predictionRecord.asset);
  }

  private updatePrediction(predictionRecord: ModelPredictionRecord): void {
    this.predictionRegistry.set(predictionRecord.predictionId, predictionRecord);
    this.refreshPredictionStatusFields(predictionRecord.asset);
  }

  private appendResolvedOutcome(asset: ModelAsset, isCorrect: boolean): void {
    const rollingPredictionOutcomes = [
      ...(this.rollingOutcomeRegistry.get(asset) || []),
      {
        isCorrect,
        resolvedAt: new Date().toISOString(),
      },
    ];
    this.rollingOutcomeRegistry.set(asset, rollingPredictionOutcomes);
    this.pruneRollingOutcomes(asset, Date.now());
    this.refreshPredictionStatusFields(asset);
  }

  private buildPredictionRecord(
    asset: ModelAsset,
    source: "automatic" | "manual",
    issuedAt: number,
    contextStartAt: number,
    contextEndAt: number,
    referenceValueAtPrediction: number | null,
    predictedReturn: number,
    predictedProbability: ModelDirectionProbability,
  ): ModelPredictionRecord {
    const predictedDirection = this.buildPredictionDirection(predictedReturn, predictedProbability);
    const predictionRecord: ModelPredictionRecord = {
      actualDirection: null,
      actualReturn: null,
      asset,
      contextEndAt: new Date(contextEndAt).toISOString(),
      contextStartAt: new Date(contextStartAt).toISOString(),
      downValueAtPrediction: this.buildProbabilityDown(predictedProbability),
      downValueAtTargetEnd: null,
      errorMessage: null,
      issuedAt: new Date(issuedAt).toISOString(),
      predictedDirection,
      predictedProbabilityDown: this.buildProbabilityDown(predictedProbability),
      predictedProbabilityUp: this.buildProbabilityUp(predictedProbability),
      predictedReturn,
      predictionId: randomUUID(),
      referenceValueAtPrediction,
      referenceValueAtTargetEnd: null,
      resolvedAt: null,
      source,
      status: "pending",
      targetEndAt: new Date(issuedAt + this.modelFeatureService.getPredictionTargetMs()).toISOString(),
      targetStartAt: new Date(issuedAt).toISOString(),
      upValueAtPrediction: this.buildProbabilityUp(predictedProbability),
      upValueAtTargetEnd: null,
      isCorrect: null,
    };
    return predictionRecord;
  }

  private resolvePredictionRecord(predictionRecord: ModelPredictionRecord, referenceValueAtTargetEnd: number): ModelPredictionRecord {
    const referenceValueAtPrediction = predictionRecord.referenceValueAtPrediction || referenceValueAtTargetEnd;
    const actualReturn = referenceValueAtPrediction > 0 ? Math.log(referenceValueAtTargetEnd / referenceValueAtPrediction) : 0;
    const actualDirection = actualReturn > 0 ? "up" : "down";
    const isCorrect = predictionRecord.predictedDirection === "flat" ? null : predictionRecord.predictedDirection === actualDirection;
    const resolvedPredictionRecord: ModelPredictionRecord = {
      ...predictionRecord,
      actualDirection,
      actualReturn,
      downValueAtTargetEnd: actualDirection === "down" ? 1 : 0,
      referenceValueAtTargetEnd,
      resolvedAt: new Date().toISOString(),
      status: "resolved",
      upValueAtTargetEnd: actualDirection === "up" ? 1 : 0,
      isCorrect,
    };
    return resolvedPredictionRecord;
  }

  private buildErrorPredictionRecord(predictionRecord: ModelPredictionRecord, errorMessage: string): ModelPredictionRecord {
    const erroredPredictionRecord: ModelPredictionRecord = {
      ...predictionRecord,
      errorMessage,
      resolvedAt: new Date().toISOString(),
      status: "error",
    };
    return erroredPredictionRecord;
  }

  private refreshLiveStatusFields(): void {
    const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
    const latestSnapshotAt = this.snapshotStoreService.getLatestSnapshotAt();
    this.supportedAssets.forEach((asset) => {
      const predictionSnapshots = this.modelFeatureService.buildLivePredictionSnapshots(liveSnapshots);
      const predictionInput = this.modelFeatureService.buildPredictionInput(asset, predictionSnapshots);
      this.updateStatus(asset, {
        isLiveReady: predictionInput !== null,
        lastLiveSnapshotAt: latestSnapshotAt,
      });
    });
  }

  private buildAlignedBlockStart(timestamp: number): number {
    const blockDurationMs = this.modelFeatureService.getBlockDurationMs();
    const alignedBlockStart = Math.floor(timestamp / blockDurationMs) * blockDurationMs;
    return alignedBlockStart;
  }

  private async readInitialBlockStart(): Promise<number | null> {
    const firstSnapshots = await this.collectorClientService.readSnapshotPage({
      fromDate: UNIX_EPOCH_ISO,
      limit: 1,
      toDate: new Date().toISOString(),
    });
    const initialBlockStart = firstSnapshots.length === 0 ? null : this.buildAlignedBlockStart(firstSnapshots[0]?.generated_at || 0);
    return initialBlockStart;
  }

  private async readNextBlockStart(asset: ModelAsset): Promise<number | null> {
    const status = this.getStatus(asset);
    const nextBlockStart = status.lastCollectorFromAt === null ? await this.readInitialBlockStart() : Date.parse(status.lastCollectorFromAt);
    return nextBlockStart;
  }

  private async readHistoricalBlock(blockStartAt: number, blockEndAt: number): Promise<FlatSnapshot[]> {
    const historicalFromAt = blockStartAt - config.MODEL_PREDICTION_CONTEXT_MS;
    const historicalSnapshots = await this.collectorClientService.readSnapshots({
      fromDate: new Date(historicalFromAt).toISOString(),
      toDate: new Date(blockEndAt).toISOString(),
    });
    return historicalSnapshots;
  }

  private readBlockContextSnapshots(snapshots: FlatSnapshot[], blockStartAt: number): FlatSnapshot[] {
    const contextStartAt = blockStartAt - config.MODEL_PREDICTION_CONTEXT_MS;
    const blockContextSnapshots = snapshots.filter((snapshot) => snapshot.generated_at >= contextStartAt && snapshot.generated_at < blockStartAt);
    return blockContextSnapshots;
  }

  private readBlockTrainingSnapshots(snapshots: FlatSnapshot[], blockStartAt: number, blockEndAt: number): FlatSnapshot[] {
    const blockTrainingSnapshots = snapshots.filter((snapshot) => snapshot.generated_at >= blockStartAt && snapshot.generated_at <= blockEndAt);
    return blockTrainingSnapshots;
  }

  private async runAutomaticPrediction(asset: ModelAsset, blockSnapshots: FlatSnapshot[], blockStartAt: number): Promise<void> {
    const artifact = this.artifactRegistry.get(asset) || null;

    if (artifact !== null) {
      const predictionSnapshots = this.readBlockContextSnapshots(blockSnapshots, blockStartAt);
      const predictionInput = this.modelFeatureService.buildPredictionInput(asset, predictionSnapshots);

      if (predictionInput !== null) {
        const prediction = await this.modelTrainingService.predictAsset(artifact, predictionInput);
        const predictionRecord = this.buildPredictionRecord(
          asset,
          "automatic",
          blockStartAt,
          blockStartAt - config.MODEL_PREDICTION_CONTEXT_MS,
          blockStartAt,
          predictionInput.currentChainlinkPrice || predictionInput.currentExchangePrice,
          prediction.predictedReturn,
          prediction.predictedProbability,
        );
        const referenceValueAtTargetEnd = this.modelFeatureService.readReferenceValue(asset, blockSnapshots, blockStartAt + config.MODEL_PREDICTION_TARGET_MS);

        if (referenceValueAtTargetEnd !== null) {
          const resolvedPredictionRecord = this.resolvePredictionRecord(predictionRecord, referenceValueAtTargetEnd);
          this.registerPrediction(resolvedPredictionRecord);

          if (resolvedPredictionRecord.isCorrect !== null) {
            this.appendResolvedOutcome(asset, resolvedPredictionRecord.isCorrect);
          }
        } else {
          this.registerPrediction(this.buildErrorPredictionRecord(predictionRecord, "unable to resolve automatic prediction outcome"));
        }
      }
    }
  }

  private async trainAssetBlock(asset: ModelAsset, blockSnapshots: FlatSnapshot[], blockStartAt: number, blockEndAt: number): Promise<void> {
    const trainingSnapshots = this.readBlockTrainingSnapshots(blockSnapshots, blockStartAt, blockEndAt);
    const trainingSamples = this.modelFeatureService.buildTrainingSamples(asset, trainingSnapshots);
    const trainingResult = await this.modelTrainingService.trainAsset(asset, trainingSamples);

    if (trainingResult.artifact !== null) {
      this.artifactRegistry.set(asset, trainingResult.artifact);
      this.updateStatus(asset, {
        lastError: null,
        lastTrainingAt: trainingResult.artifact.trainedAt,
        lastTrainingStatus: "ready",
        trainingCount: trainingResult.artifact.version,
      });

      if (this.shouldLogTrainingProgress) {
        logger.info(
          `training block completed asset=${asset} version=${trainingResult.artifact.version} train=${trainingResult.trainingSampleCount} valid=${trainingResult.validationSampleCount}`,
        );
      }
    }
  }

  private buildHistoricalProcessingState(): ModelState {
    // Keep the dashboard aligned with the actual work being executed.
    const historicalProcessingState: ModelState = this.shouldEnableAutomaticPredictions ? "predicting" : "training";
    return historicalProcessingState;
  }

  private async processHistoricalAsset(asset: ModelAsset): Promise<void> {
    const blockStartAt = await this.readNextBlockStart(asset);

    if (blockStartAt === null) {
      this.updateStatus(asset, {
        state: "waiting",
      });
    } else {
      const blockEndAt = blockStartAt + this.modelFeatureService.getBlockDurationMs();

      if (blockEndAt > Date.now()) {
        this.updateStatus(asset, {
          currentBlockEndAt: new Date(blockEndAt).toISOString(),
          currentBlockStartAt: new Date(blockStartAt).toISOString(),
          state: "waiting",
        });
      } else {
        this.updateStatus(asset, {
          currentBlockEndAt: new Date(blockEndAt).toISOString(),
          currentBlockStartAt: new Date(blockStartAt).toISOString(),
          lastError: null,
          state: this.buildHistoricalProcessingState(),
        });

        try {
          const blockSnapshots = await this.readHistoricalBlock(blockStartAt, blockEndAt);

          if (blockSnapshots.length === 0) {
            throw new Error("collector returned no snapshots for closed block");
          }

          if (this.shouldEnableAutomaticPredictions) {
            await this.runAutomaticPrediction(asset, blockSnapshots, blockStartAt);
          }
          this.updateStatus(asset, {
            state: "training",
          });
          await this.trainAssetBlock(asset, blockSnapshots, blockStartAt, blockEndAt);
          this.updateStatus(asset, {
            lastCollectorFromAt: new Date(blockEndAt).toISOString(),
            state: "idle",
          });
          this.lastHistoricalBlockCompletedAt = new Date(blockEndAt).toISOString();
          await this.persistRuntimeState();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "historical asset processing failed";
          logger.error(`historical asset processing failed asset=${asset} error=${errorMessage}`);
          this.updateStatus(asset, {
            lastError: errorMessage,
            state: "error",
          });
        }
      }
    }
  }

  private schedulePendingResolution(predictionId: string): void {
    const timeoutId = setTimeout(() => {
      void this.resolveManualPrediction(predictionId);
    }, this.modelFeatureService.getPredictionTargetMs());
    this.pendingResolutionTimerRegistry.set(predictionId, timeoutId);
  }

  private clearPendingResolution(predictionId: string): void {
    const timeoutId = this.pendingResolutionTimerRegistry.get(predictionId) || null;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      this.pendingResolutionTimerRegistry.delete(predictionId);
    }
  }

  private async resolveManualPrediction(predictionId: string): Promise<void> {
    const predictionRecord = this.predictionRegistry.get(predictionId) || null;

    if (predictionRecord !== null && predictionRecord.status === "pending") {
      const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
      const targetEndAt = Date.parse(predictionRecord.targetEndAt);
      const latestLiveSnapshotAt = liveSnapshots.at(-1)?.generated_at || 0;

      if (latestLiveSnapshotAt < targetEndAt) {
        this.clearPendingResolution(predictionId);
        this.schedulePendingResolution(predictionId);
      } else {
        const referenceValueAtTargetEnd = this.modelFeatureService.readReferenceValue(predictionRecord.asset, liveSnapshots, targetEndAt);

        if (referenceValueAtTargetEnd === null) {
          this.updatePrediction(this.buildErrorPredictionRecord(predictionRecord, "unable to resolve manual prediction outcome"));
        } else {
          const resolvedPredictionRecord = this.resolvePredictionRecord(predictionRecord, referenceValueAtTargetEnd);
          this.updatePrediction(resolvedPredictionRecord);

          if (resolvedPredictionRecord.isCorrect !== null) {
            this.appendResolvedOutcome(predictionRecord.asset, resolvedPredictionRecord.isCorrect);
          }
        }

        this.clearPendingResolution(predictionId);
        await this.persistRuntimeState();
      }
    }
  }

  private async runScheduledProcessingCycle(): Promise<void> {
    if (!this.isProcessing) {
      this.isProcessing = true;
      this.refreshLiveStatusFields();

      try {
        for (const asset of this.supportedAssets) {
          await this.processHistoricalAsset(asset);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "scheduled processing cycle failed";
        logger.error(`scheduled processing cycle failed error=${errorMessage}`);
      } finally {
        this.isProcessing = false;
      }
    }
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
      this.processingTimer = setInterval(() => {
        void this.runScheduledProcessingCycle();
      }, this.processIntervalMs);
      this.isStarted = true;
      void this.runScheduledProcessingCycle();
    }
  }

  public async stop(): Promise<void> {
    if (this.processingTimer !== null) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    [...this.pendingResolutionTimerRegistry.keys()].forEach((predictionId) => {
      this.clearPendingResolution(predictionId);
    });

    await this.snapshotStoreService.stop();
    this.isStarted = false;
  }

  public getStatusPayload(): ModelStatusPayload {
    const modelStatusPayload: ModelStatusPayload = {
      assets: [...this.statusRegistry.values()],
      isProcessing: this.isProcessing,
      lastHistoricalBlockCompletedAt: this.lastHistoricalBlockCompletedAt,
    };
    return modelStatusPayload;
  }

  public getAssetStatus(asset: ModelAsset): ModelStatus {
    const modelStatus = this.getStatus(asset);
    return modelStatus;
  }

  public getPredictionRecords(): ModelPredictionRecordPayload {
    const predictions = [...this.predictionRegistry.values()]
      .sort((leftPrediction, rightPrediction) => Date.parse(rightPrediction.issuedAt) - Date.parse(leftPrediction.issuedAt))
      .slice(0, RECENT_PREDICTION_LIMIT);
    const modelPredictionRecordPayload: ModelPredictionRecordPayload = {
      predictions,
    };
    return modelPredictionRecordPayload;
  }

  public async predict(request: ModelPredictionRequest): Promise<ModelPredictionPayload> {
    const asset = request.asset;
    const artifact = this.artifactRegistry.get(asset) || null;
    const liveSnapshots = this.snapshotStoreService.getLiveSnapshots();
    const predictionSnapshots = this.modelFeatureService.buildLivePredictionSnapshots(liveSnapshots);
    const predictionInput = this.modelFeatureService.buildPredictionInput(asset, predictionSnapshots);
    if (artifact === null) {
      throw new Error(`no trained model available for ${asset}`);
    }

    if (predictionInput === null) {
      throw new Error(`insufficient live context for ${asset}`);
    }

    const prediction = await this.modelTrainingService.predictAsset(artifact, predictionInput);
    const issuedAt = predictionInput.decisionTime;
    const predictionRecord = this.buildPredictionRecord(
      asset,
      "manual",
      issuedAt,
      issuedAt - config.MODEL_PREDICTION_CONTEXT_MS,
      issuedAt,
      predictionInput.currentChainlinkPrice || predictionInput.currentExchangePrice,
      prediction.predictedReturn,
      prediction.predictedProbability,
    );
    this.registerPrediction(predictionRecord);
    this.schedulePendingResolution(predictionRecord.predictionId);
    await this.persistRuntimeState();
    const modelPredictionPayload: ModelPredictionPayload = {
      liveSnapshotCount: liveSnapshots.length,
      prediction: predictionRecord,
    };

    return modelPredictionPayload;
  }
}
