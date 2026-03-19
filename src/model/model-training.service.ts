/**
 * @section imports:internals
 */

import config from "../config.ts";
import { PythonClientService } from "../python/python-client.service.ts";
import type {
  ModelClobArtifact,
  ModelClobInput,
  ModelClobKey,
  ModelClobSample,
  ModelFeatureNames,
  ModelTensorflowArchitecture,
  ModelTrendArtifact,
  ModelTrendInput,
  ModelTrendKey,
  ModelTrendSample,
} from "./model.types.ts";
import type { ModelPersistenceService } from "./model-persistence.service.ts";
import type {
  ModelClobTrainResult,
  ModelClobWalkForwardFold,
  ModelHeadPrediction,
  ModelTrendTrainResult,
  ModelTrendWalkForwardFold,
} from "./model-runtime.types.ts";

/**
 * @section consts
 */

const TREND_ARCHITECTURES: Record<ModelTrendKey, ModelTensorflowArchitecture> = {
  btc: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  eth: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  sol: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  xrp: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
};

const CLOB_ARCHITECTURES: Record<ModelClobKey, ModelTensorflowArchitecture> = {
  btc_5m: { family: "tcn", blockCount: 5, channelCount: 32, dilations: [1, 2, 4, 8, 16], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  btc_15m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  eth_5m: { family: "tcn", blockCount: 5, channelCount: 32, dilations: [1, 2, 4, 8, 16], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  eth_15m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  sol_5m: { family: "tcn", blockCount: 5, channelCount: 48, dilations: [1, 2, 4, 8, 16], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  sol_15m: { family: "tcn", blockCount: 6, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.15, featureCount: 0, sequenceLength: 0 },
  xrp_5m: { family: "tcn", blockCount: 5, channelCount: 48, dilations: [1, 2, 4, 8, 16], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  xrp_15m: { family: "tcn", blockCount: 6, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.15, featureCount: 0, sequenceLength: 0 },
};

/**
 * @section types
 */

type ModelTrainingServiceOptions = {
  embargoMs: number;
  featureNames: ModelFeatureNames;
  minSampleCount: number;
  modelPersistenceService: ModelPersistenceService;
  predictionHorizonMs: number;
  pythonClientService: PythonClientService;
  trainWindowDays: number;
  validationWindowDays: number;
};

/**
 * @section class
 */

export class ModelTrainingService {
  /**
   * @section private:attributes
   */

  private readonly embargoMs: number;

  private readonly featureNames: ModelFeatureNames;

  private readonly minSampleCount: number;

  private readonly modelPersistenceService: ModelPersistenceService;

  private readonly predictionHorizonMs: number;

  private readonly pythonClientService: PythonClientService;

  private readonly trainWindowDays: number;

  private readonly validationWindowDays: number;

  /**
   * @section constructor
   */

  public constructor(options: ModelTrainingServiceOptions) {
    this.embargoMs = options.embargoMs;
    this.featureNames = options.featureNames;
    this.minSampleCount = options.minSampleCount;
    this.modelPersistenceService = options.modelPersistenceService;
    this.predictionHorizonMs = options.predictionHorizonMs;
    this.pythonClientService = options.pythonClientService;
    this.trainWindowDays = options.trainWindowDays;
    this.validationWindowDays = options.validationWindowDays;
  }

  /**
   * @section factory
   */

  public static createDefault(featureNames: ModelFeatureNames, modelPersistenceService: ModelPersistenceService): ModelTrainingService {
    const modelTrainingService = new ModelTrainingService({
      embargoMs: config.MODEL_EMBARGO_MS,
      featureNames,
      minSampleCount: config.MODEL_MIN_SAMPLE_COUNT,
      modelPersistenceService,
      predictionHorizonMs: config.MODEL_PREDICTION_HORIZON_MS,
      pythonClientService: PythonClientService.createDefault(),
      trainWindowDays: config.MODEL_TRAIN_WINDOW_DAYS,
      validationWindowDays: config.MODEL_VALIDATION_WINDOW_DAYS,
    });
    return modelTrainingService;
  }

  /**
   * @section private:methods
   */

  private buildTrendSpanStart(sample: ModelTrendSample): number {
    const trendSpanStart = sample.decisionTime - sample.trendSequence.length * 500;
    return trendSpanStart;
  }

  private buildClobSpanStart(sample: ModelClobSample): number {
    const clobSpanStart = sample.decisionTime - sample.clobSequence.length * 500;
    return clobSpanStart;
  }

  private buildSpanEnd(decisionTime: number): number {
    const spanEnd = decisionTime + this.predictionHorizonMs;
    return spanEnd;
  }

  private buildTrendFolds(samples: ModelTrendSample[]): ModelTrendWalkForwardFold[] {
    const foldWindowMs = this.validationWindowDays * 24 * 60 * 60 * 1_000;
    const trainWindowMs = this.trainWindowDays * 24 * 60 * 60 * 1_000;
    const latestDecisionTime = samples.at(-1)?.decisionTime || 0;
    let validationWindowEnd = latestDecisionTime;
    const folds: ModelTrendWalkForwardFold[] = [];

    while (validationWindowEnd > 0) {
      const validationWindowStart = validationWindowEnd - foldWindowMs;
      const trainingWindowStart = validationWindowStart - trainWindowMs;
      const validationSamples = samples.filter((sample) => sample.decisionTime > validationWindowStart && sample.decisionTime <= validationWindowEnd);
      const trainingSamples = samples.filter((sample) => {
        const isInsideTrainingWindow = sample.decisionTime > trainingWindowStart && sample.decisionTime <= validationWindowStart - this.embargoMs;
        const overlapsValidationWindow =
          this.buildSpanEnd(sample.decisionTime) >= validationWindowStart && this.buildTrendSpanStart(sample) <= validationWindowEnd + this.embargoMs;
        return isInsideTrainingWindow && !overlapsValidationWindow;
      });

      if (trainingSamples.length > 0 && validationSamples.length > 0) {
        folds.unshift({
          trainingSamples,
          validationSamples,
          validationWindowEnd: new Date(validationWindowEnd).toISOString(),
          validationWindowStart: new Date(validationWindowStart).toISOString(),
        });
      }

      validationWindowEnd = validationWindowStart - this.predictionHorizonMs;
    }

    return folds;
  }

  private buildClobFolds(samples: ModelClobSample[]): ModelClobWalkForwardFold[] {
    const foldWindowMs = this.validationWindowDays * 24 * 60 * 60 * 1_000;
    const trainWindowMs = this.trainWindowDays * 24 * 60 * 60 * 1_000;
    const latestDecisionTime = samples.at(-1)?.decisionTime || 0;
    let validationWindowEnd = latestDecisionTime;
    const folds: ModelClobWalkForwardFold[] = [];

    while (validationWindowEnd > 0) {
      const validationWindowStart = validationWindowEnd - foldWindowMs;
      const trainingWindowStart = validationWindowStart - trainWindowMs;
      const validationSamples = samples.filter((sample) => sample.decisionTime > validationWindowStart && sample.decisionTime <= validationWindowEnd);
      const trainingSamples = samples.filter((sample) => {
        const isInsideTrainingWindow = sample.decisionTime > trainingWindowStart && sample.decisionTime <= validationWindowStart - this.embargoMs;
        const overlapsValidationWindow =
          this.buildSpanEnd(sample.decisionTime) >= validationWindowStart && this.buildClobSpanStart(sample) <= validationWindowEnd + this.embargoMs;
        return isInsideTrainingWindow && !overlapsValidationWindow;
      });

      if (trainingSamples.length > 0 && validationSamples.length > 0) {
        folds.unshift({
          trainingSamples,
          validationSamples,
          validationWindowEnd: new Date(validationWindowEnd).toISOString(),
          validationWindowStart: new Date(validationWindowStart).toISOString(),
        });
      }

      validationWindowEnd = validationWindowStart - this.predictionHorizonMs;
    }

    return folds;
  }

  private readTrendArchitecture(trendKey: ModelTrendKey, samples: ModelTrendSample[]): ModelTensorflowArchitecture {
    const baseArchitecture = TREND_ARCHITECTURES[trendKey];
    const trendArchitecture: ModelTensorflowArchitecture = {
      ...baseArchitecture,
      featureCount: this.featureNames.trendFeatures.length,
      sequenceLength: samples[0]?.trendSequence.length || 0,
    };
    return trendArchitecture;
  }

  private readClobArchitecture(modelKey: ModelClobKey, samples: ModelClobSample[]): ModelTensorflowArchitecture {
    const baseArchitecture = CLOB_ARCHITECTURES[modelKey];
    const clobArchitecture: ModelTensorflowArchitecture = {
      ...baseArchitecture,
      featureCount: this.featureNames.clobFeatures.length,
      sequenceLength: samples[0]?.clobSequence.length || 0,
    };
    return clobArchitecture;
  }

  /**
   * @section public:methods
   */

  public async ensurePythonRuntime(): Promise<void> {
    await this.pythonClientService.ensureStarted();
  }

  public async stop(): Promise<void> {
    await this.pythonClientService.stop();
  }

  public async loadTrend(artifact: ModelTrendArtifact): Promise<void> {
    await this.pythonClientService.loadTrend(artifact);
  }

  public async loadClob(artifact: ModelClobArtifact): Promise<void> {
    await this.pythonClientService.loadClob(artifact);
  }

  public async unloadTrend(trendKey: string): Promise<void> {
    await this.pythonClientService.unloadTrend(trendKey);
  }

  public async unloadClob(modelKey: string): Promise<void> {
    await this.pythonClientService.unloadClob(modelKey);
  }

  public async predictTrend(artifact: ModelTrendArtifact, input: ModelTrendInput): Promise<ModelHeadPrediction> {
    const predictionResult = await this.pythonClientService.predictTrend(artifact.trendKey, artifact.model, input);
    return predictionResult.prediction;
  }

  public async predictClob(artifact: ModelClobArtifact, input: ModelClobInput): Promise<ModelHeadPrediction> {
    const predictionResult = await this.pythonClientService.predictClob(artifact.modelKey, artifact.model, input);
    return predictionResult.prediction;
  }

  public async trainTrend(trendKey: ModelTrendKey, samples: ModelTrendSample[], previousVersion: number): Promise<ModelTrendTrainResult> {
    const validSamples = samples
      .filter((sample) => sample.trendTarget !== null)
      .sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    const folds = this.buildTrendFolds(validSamples);
    const latestFold = folds.at(-1) || null;
    let trainResult: ModelTrendTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (latestFold !== null && latestFold.trainingSamples.length >= this.minSampleCount && latestFold.validationSamples.length > 0) {
      const nextVersion = previousVersion + 1;
      const artifactPathPair = this.modelPersistenceService.buildTrendArtifactPaths(trendKey, nextVersion);
      const pythonTrainResult = await this.pythonClientService.trainTrend({
        architecture: this.readTrendArchitecture(trendKey, latestFold.trainingSamples),
        artifactDirectoryPath: artifactPathPair.absoluteDirectoryPath,
        featureNames: this.featureNames.trendFeatures,
        targetEncoding: "identity",
        trainingSamples: latestFold.trainingSamples,
        validationSamples: latestFold.validationSamples,
        version: nextVersion,
      });
      const trendArtifact: ModelTrendArtifact = this.modelPersistenceService.withRelativeTrendArtifactPath(
        {
          trendKey,
          version: nextVersion,
          trainedAt: pythonTrainResult.artifact.trainedAt,
          trainingSampleCount: latestFold.trainingSamples.length,
          validationSampleCount: latestFold.validationSamples.length,
          lastTrainWindowStart: new Date(latestFold.trainingSamples[0]?.decisionTime || 0).toISOString(),
          lastTrainWindowEnd: new Date(latestFold.trainingSamples.at(-1)?.decisionTime || 0).toISOString(),
          lastValidationWindowStart: latestFold.validationWindowStart,
          lastValidationWindowEnd: latestFold.validationWindowEnd,
          model: pythonTrainResult.artifact.artifact,
        },
        artifactPathPair.relativeDirectoryPath,
      );
      trainResult = {
        artifact: trendArtifact,
        trainingSampleCount: latestFold.trainingSamples.length,
        validationSampleCount: latestFold.validationSamples.length,
      };
    }

    return trainResult;
  }

  public async trainClob(modelKey: ModelClobKey, samples: ModelClobSample[], previousVersion: number): Promise<ModelClobTrainResult> {
    const validSamples = samples
      .filter((sample) => sample.clobTarget !== null && sample.clobDirectionTarget !== null)
      .sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    const latestFold = this.buildClobFolds(validSamples).at(-1) || null;
    let trainResult: ModelClobTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (latestFold !== null && latestFold.trainingSamples.length >= this.minSampleCount && latestFold.validationSamples.length > 0) {
      const nextVersion = previousVersion + 1;
      const artifactPathPair = this.modelPersistenceService.buildClobArtifactPaths(modelKey, nextVersion);
      const pythonTrainResult = await this.pythonClientService.trainClob({
        architecture: this.readClobArchitecture(modelKey, latestFold.trainingSamples),
        artifactDirectoryPath: artifactPathPair.absoluteDirectoryPath,
        featureNames: this.featureNames.clobFeatures,
        targetEncoding: "logit_probability",
        trainingSamples: latestFold.trainingSamples,
        validationSamples: latestFold.validationSamples,
        version: nextVersion,
      });
      const [asset, window] = modelKey.split("_") as [ModelTrendKey, "5m" | "15m"];
      const clobArtifact: ModelClobArtifact = this.modelPersistenceService.withRelativeClobArtifactPath(
        {
          modelKey,
          asset,
          window,
          version: nextVersion,
          trainedAt: pythonTrainResult.artifact.trainedAt,
          trainingSampleCount: latestFold.trainingSamples.length,
          validationSampleCount: latestFold.validationSamples.length,
          lastTrainWindowStart: new Date(latestFold.trainingSamples[0]?.decisionTime || 0).toISOString(),
          lastTrainWindowEnd: new Date(latestFold.trainingSamples.at(-1)?.decisionTime || 0).toISOString(),
          lastValidationWindowStart: latestFold.validationWindowStart,
          lastValidationWindowEnd: latestFold.validationWindowEnd,
          model: pythonTrainResult.artifact.artifact,
        },
        artifactPathPair.relativeDirectoryPath,
      );
      trainResult = {
        artifact: clobArtifact,
        trainingSampleCount: latestFold.trainingSamples.length,
        validationSampleCount: latestFold.validationSamples.length,
      };
    }

    return trainResult;
  }
}
