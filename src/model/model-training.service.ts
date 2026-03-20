/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { TensorflowApiDecodedPrediction, TensorflowApiHeadMetadata, TensorflowApiModelRecord } from "../tensorflow-api/tensorflow-api.types.ts";
import { TensorflowApiClientService } from "../tensorflow-api/tensorflow-api-client.service.ts";
import { TensorflowApiModelDefinitionService } from "../tensorflow-api/tensorflow-api-model-definition.service.ts";
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
import { ModelPreprocessingService } from "./model-preprocessing.service.ts";
import type { ModelClobTrainResult, ModelHeadPrediction, ModelTrainingSplit, ModelTrendTrainResult } from "./model-runtime.types.ts";

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

const VALIDATION_SAMPLE_RATIO = 0.2;

/**
 * @section types
 */

type ModelTrainingServiceOptions = {
  featureNames: ModelFeatureNames;
  minSampleCount: number;
  modelPreprocessingService: ModelPreprocessingService;
  tensorflowApiClientService: TensorflowApiClientService;
  tensorflowApiModelDefinitionService: TensorflowApiModelDefinitionService;
  trainPollIntervalMs: number;
  trainTimeoutMs: number;
};

/**
 * @section class
 */

export class ModelTrainingService {
  /**
   * @section private:attributes
   */

  private readonly featureNames: ModelFeatureNames;

  private readonly minSampleCount: number;

  private readonly modelPreprocessingService: ModelPreprocessingService;

  private readonly tensorflowApiClientService: TensorflowApiClientService;

  private readonly tensorflowApiModelDefinitionService: TensorflowApiModelDefinitionService;

  private readonly trainPollIntervalMs: number;

  private readonly trainTimeoutMs: number;

  /**
   * @section constructor
   */

  public constructor(options: ModelTrainingServiceOptions) {
    this.featureNames = options.featureNames;
    this.minSampleCount = options.minSampleCount;
    this.modelPreprocessingService = options.modelPreprocessingService;
    this.tensorflowApiClientService = options.tensorflowApiClientService;
    this.tensorflowApiModelDefinitionService = options.tensorflowApiModelDefinitionService;
    this.trainPollIntervalMs = options.trainPollIntervalMs;
    this.trainTimeoutMs = options.trainTimeoutMs;
  }

  /**
   * @section factory
   */

  public static createDefault(featureNames: ModelFeatureNames): ModelTrainingService {
    return new ModelTrainingService({
      featureNames,
      minSampleCount: config.MODEL_MIN_SAMPLE_COUNT,
      modelPreprocessingService: ModelPreprocessingService.createDefault(),
      tensorflowApiClientService: TensorflowApiClientService.createDefault(),
      tensorflowApiModelDefinitionService: TensorflowApiModelDefinitionService.createDefault(),
      trainPollIntervalMs: config.TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS,
      trainTimeoutMs: config.TENSORFLOW_API_TRAIN_TIMEOUT_MS,
    });
  }

  /**
   * @section private:methods
   */

  private buildTrainingSplit<TSample extends ModelClobSample | ModelTrendSample>(samples: TSample[]): ModelTrainingSplit<TSample> | null {
    const validationSampleCount = Math.max(1, Math.floor(samples.length * VALIDATION_SAMPLE_RATIO));
    const trainingCutoffIndex = samples.length - validationSampleCount;
    const trainingSamples = samples.slice(0, trainingCutoffIndex);
    const validationSamples = samples.slice(trainingCutoffIndex);
    let trainingSplit: ModelTrainingSplit<TSample> | null = null;

    if (trainingSamples.length > 0 && validationSamples.length > 0) {
      trainingSplit = {
        trainingSamples,
        validationSamples,
        validationWindowEnd: new Date(validationSamples.at(-1)?.decisionTime || 0).toISOString(),
        validationWindowStart: new Date(validationSamples[0]?.decisionTime || 0).toISOString(),
      };
    }

    return trainingSplit;
  }

  private readTrendArchitecture(trendKey: ModelTrendKey, samples: ModelTrendSample[]): ModelTensorflowArchitecture {
    const trendArchitecture: ModelTensorflowArchitecture = {
      ...TREND_ARCHITECTURES[trendKey],
      featureCount: this.featureNames.trendFeatures.length,
      sequenceLength: samples[0]?.trendSequence.length || 0,
    };
    return trendArchitecture;
  }

  private readClobArchitecture(modelKey: ModelClobKey, samples: ModelClobSample[]): ModelTensorflowArchitecture {
    const clobArchitecture: ModelTensorflowArchitecture = {
      ...CLOB_ARCHITECTURES[modelKey],
      featureCount: this.featureNames.clobFeatures.length,
      sequenceLength: samples[0]?.clobSequence.length || 0,
    };
    return clobArchitecture;
  }

  private buildTrendModelId(trendKey: ModelTrendKey): string {
    const modelId = `polymarket_model_trend_${trendKey}`;
    return modelId;
  }

  private buildClobModelId(modelKey: ModelClobKey): string {
    const modelId = `polymarket_model_clob_${modelKey}`;
    return modelId;
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private async ensureRemoteModelExists(modelId: string, architecture: ModelTensorflowArchitecture): Promise<void> {
    try {
      await this.waitForModelReady(modelId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown tensorflow-api error";
      logger.warn(`tensorflow-api readModel failed modelId=${modelId} error=${errorMessage}`);

      if (!errorMessage.includes("status=404")) {
        throw error;
      }

      logger.info(`creating remote tensorflow-api model modelId=${modelId}`);
      await this.tensorflowApiClientService.createModel(this.tensorflowApiModelDefinitionService.buildCreateModelRequest(modelId, architecture));
      await this.waitForModelReady(modelId);
    }
  }

  private async waitForModelReady(modelId: string): Promise<void> {
    const startedAt = Date.now();
    let isReady = false;

    while (!isReady) {
      const modelRecord = await this.tensorflowApiClientService.readModel(modelId);

      if (modelRecord.status === "failed") {
        throw new Error(`tensorflow-api model failed modelId=${modelId}`);
      }

      if (modelRecord.status === "ready") {
        isReady = true;
      }

      if (!isReady && Date.now() - startedAt >= this.trainTimeoutMs) {
        throw new Error(`tensorflow-api model readiness timed out modelId=${modelId} timeoutMs=${this.trainTimeoutMs}`);
      }

      if (!isReady) {
        await this.sleep(this.trainPollIntervalMs);
      }
    }
  }

  private async waitForTrainingCompletion(jobId: string): Promise<void> {
    const startedAt = Date.now();
    let shouldContinuePolling = true;

    while (shouldContinuePolling) {
      const jobRecord = await this.tensorflowApiClientService.readJob(jobId);

      if (jobRecord.status === "failed") {
        throw new Error(`tensorflow-api training job failed model=${jobRecord.modelId} jobId=${jobId} error=${jobRecord.errorMessage || "unknown error"}`);
      }

      if (jobRecord.status === "succeeded") {
        shouldContinuePolling = false;
      }

      if (shouldContinuePolling && Date.now() - startedAt >= this.trainTimeoutMs) {
        throw new Error(`tensorflow-api training job timed out jobId=${jobId} timeoutMs=${this.trainTimeoutMs}`);
      }

      if (shouldContinuePolling) {
        await this.sleep(this.trainPollIntervalMs);
      }
    }
  }

  private readPredictionOutputValue(outputRows: number[][] | undefined): number {
    const outputValue = outputRows?.[0]?.[0] || 0;
    return outputValue;
  }

  private readPredictionOutputVector(outputRows: number[][] | undefined): number[] {
    const outputVector = outputRows?.[0] || [0, 0, 0];
    return outputVector;
  }

  private decodePrediction(outputValue: number, outputVector: number[], targetEncoding: "identity" | "logit_probability"): TensorflowApiDecodedPrediction {
    const decodedPrediction: TensorflowApiDecodedPrediction = {
      predictedValue: this.modelPreprocessingService.decodeRegressionValue(outputValue, targetEncoding),
      probabilities: this.modelPreprocessingService.buildProbabilities(outputVector),
    };
    return decodedPrediction;
  }

  private buildTrendMetadata(
    trendKey: ModelTrendKey,
    architecture: ModelTensorflowArchitecture,
    trainedAt: string,
    featureMedians: number[],
    featureScales: number[],
    classWeights: [number, number, number],
    directionThreshold: number,
    trainingSampleCount: number,
    validationSampleCount: number,
    lastTrainWindowStart: string | null,
    lastTrainWindowEnd: string | null,
    lastValidationWindowStart: string | null,
    lastValidationWindowEnd: string | null,
    metrics: ModelTrendArtifact["model"]["metrics"],
  ): TensorflowApiHeadMetadata {
    const trendMetadata: TensorflowApiHeadMetadata = {
      architecture,
      classWeights,
      directionThreshold,
      featureMedians,
      featureNames: this.featureNames.trendFeatures,
      featureScales,
      lastTrainWindowEnd,
      lastTrainWindowStart,
      lastValidationWindowEnd,
      lastValidationWindowStart,
      logicalKey: trendKey,
      logicalModelType: "trend",
      metrics,
      targetEncoding: "identity",
      trainedAt,
      trainingSampleCount,
      validationSampleCount,
    };
    return trendMetadata;
  }

  private buildClobMetadata(
    modelKey: ModelClobKey,
    architecture: ModelTensorflowArchitecture,
    trainedAt: string,
    featureMedians: number[],
    featureScales: number[],
    classWeights: [number, number, number],
    directionThreshold: number,
    trainingSampleCount: number,
    validationSampleCount: number,
    lastTrainWindowStart: string | null,
    lastTrainWindowEnd: string | null,
    lastValidationWindowStart: string | null,
    lastValidationWindowEnd: string | null,
    metrics: ModelClobArtifact["model"]["metrics"],
  ): TensorflowApiHeadMetadata {
    const clobMetadata: TensorflowApiHeadMetadata = {
      architecture,
      classWeights,
      directionThreshold,
      featureMedians,
      featureNames: this.featureNames.clobFeatures,
      featureScales,
      lastTrainWindowEnd,
      lastTrainWindowStart,
      lastValidationWindowEnd,
      lastValidationWindowStart,
      logicalKey: modelKey,
      logicalModelType: "clob",
      metrics,
      targetEncoding: "logit_probability",
      trainedAt,
      trainingSampleCount,
      validationSampleCount,
    };
    return clobMetadata;
  }

  private buildTrendArtifact(remoteModelRecord: TensorflowApiModelRecord, metadata: TensorflowApiHeadMetadata): ModelTrendArtifact {
    const trendArtifact: ModelTrendArtifact = {
      lastTrainWindowEnd: metadata.lastTrainWindowEnd,
      lastTrainWindowStart: metadata.lastTrainWindowStart,
      lastValidationWindowEnd: metadata.lastValidationWindowEnd,
      lastValidationWindowStart: metadata.lastValidationWindowStart,
      model: {
        architecture: metadata.architecture,
        classWeights: metadata.classWeights,
        directionThreshold: metadata.directionThreshold,
        featureMedians: metadata.featureMedians,
        featureNames: metadata.featureNames,
        featureScales: metadata.featureScales,
        metrics: metadata.metrics,
        remoteModelId: remoteModelRecord.modelId,
        targetEncoding: metadata.targetEncoding,
      },
      remoteModelId: remoteModelRecord.modelId,
      trainedAt: metadata.trainedAt,
      trainingSampleCount: metadata.trainingSampleCount,
      trendKey: metadata.logicalKey as ModelTrendKey,
      validationSampleCount: metadata.validationSampleCount,
      version: remoteModelRecord.trainingCount,
    };
    return trendArtifact;
  }

  private buildClobArtifact(remoteModelRecord: TensorflowApiModelRecord, metadata: TensorflowApiHeadMetadata): ModelClobArtifact {
    const [asset, window] = metadata.logicalKey.split("_") as [ModelTrendKey, "5m" | "15m"];
    const clobArtifact: ModelClobArtifact = {
      asset,
      lastTrainWindowEnd: metadata.lastTrainWindowEnd,
      lastTrainWindowStart: metadata.lastTrainWindowStart,
      lastValidationWindowEnd: metadata.lastValidationWindowEnd,
      lastValidationWindowStart: metadata.lastValidationWindowStart,
      model: {
        architecture: metadata.architecture,
        classWeights: metadata.classWeights,
        directionThreshold: metadata.directionThreshold,
        featureMedians: metadata.featureMedians,
        featureNames: metadata.featureNames,
        featureScales: metadata.featureScales,
        metrics: metadata.metrics,
        remoteModelId: remoteModelRecord.modelId,
        targetEncoding: metadata.targetEncoding,
      },
      modelKey: metadata.logicalKey as ModelClobKey,
      remoteModelId: remoteModelRecord.modelId,
      trainedAt: metadata.trainedAt,
      trainingSampleCount: metadata.trainingSampleCount,
      validationSampleCount: metadata.validationSampleCount,
      version: remoteModelRecord.trainingCount,
      window,
    };
    return clobArtifact;
  }

  private async buildValidationPredictions(
    modelId: string,
    scaledValidationSequences: number[][][],
    targetEncoding: "identity" | "logit_probability",
  ): Promise<TensorflowApiDecodedPrediction[]> {
    const predictionResponse = await this.tensorflowApiClientService.predict(modelId, {
      predictionInput: {
        inputs: scaledValidationSequences,
      },
    });
    const regressionOutputs = predictionResponse.outputs.regression || [];
    const classificationOutputs = predictionResponse.outputs.classification || [];
    const validationPredictions = scaledValidationSequences.map((_sequence, sequenceIndex) =>
      this.decodePrediction(regressionOutputs[sequenceIndex]?.[0] || 0, classificationOutputs[sequenceIndex] || [0, 0, 0], targetEncoding),
    );
    return validationPredictions;
  }

  /**
   * @section public:methods
   */

  public async ensureTensorflowApi(): Promise<void> {
    await this.tensorflowApiClientService.ensureReachable();
  }

  public async readRemoteModels(): Promise<TensorflowApiModelRecord[]> {
    const remoteModelRecords = await this.tensorflowApiClientService.readModels();
    return remoteModelRecords;
  }

  public async predictTrend(artifact: ModelTrendArtifact, input: ModelTrendInput): Promise<ModelHeadPrediction> {
    const scaledInput = this.modelPreprocessingService.scaleSequences([input.trendSequence], artifact.model.featureMedians, artifact.model.featureScales);
    const predictionResponse = await this.tensorflowApiClientService.predict(artifact.remoteModelId, {
      predictionInput: {
        inputs: scaledInput,
      },
    });
    const prediction = this.decodePrediction(
      this.readPredictionOutputValue(predictionResponse.outputs.regression),
      this.readPredictionOutputVector(predictionResponse.outputs.classification),
      artifact.model.targetEncoding,
    );
    return prediction;
  }

  public async predictClob(artifact: ModelClobArtifact, input: ModelClobInput): Promise<ModelHeadPrediction> {
    const scaledInput = this.modelPreprocessingService.scaleSequences([input.clobSequence], artifact.model.featureMedians, artifact.model.featureScales);
    const predictionResponse = await this.tensorflowApiClientService.predict(artifact.remoteModelId, {
      predictionInput: {
        inputs: scaledInput,
      },
    });
    const prediction = this.decodePrediction(
      this.readPredictionOutputValue(predictionResponse.outputs.regression),
      this.readPredictionOutputVector(predictionResponse.outputs.classification),
      artifact.model.targetEncoding,
    );
    return prediction;
  }

  public async trainTrend(trendKey: ModelTrendKey, samples: ModelTrendSample[]): Promise<ModelTrendTrainResult> {
    const validSamples = samples
      .filter((sample) => sample.trendTarget !== null)
      .sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    const latestFold = this.buildTrainingSplit(validSamples);
    let trainResult: ModelTrendTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (latestFold !== null && latestFold.trainingSamples.length >= this.minSampleCount && latestFold.validationSamples.length > 0) {
      const architecture = this.readTrendArchitecture(trendKey, latestFold.trainingSamples);
      const modelId = this.buildTrendModelId(trendKey);
      const trainingSequences = this.modelPreprocessingService.buildTrendSequences(latestFold.trainingSamples);
      const validationSequences = this.modelPreprocessingService.buildTrendSequences(latestFold.validationSamples);
      const featureMedians = this.modelPreprocessingService.buildFeatureMedians(trainingSequences);
      const featureScales = this.modelPreprocessingService.buildFeatureScales(trainingSequences, featureMedians);
      const scaledTrainingSequences = this.modelPreprocessingService.scaleSequences(trainingSequences, featureMedians, featureScales);
      const scaledValidationSequences = this.modelPreprocessingService.scaleSequences(validationSequences, featureMedians, featureScales);
      const trendTargets = latestFold.trainingSamples.map((sample) => sample.trendTarget || 0);
      const validationTrendTargets = latestFold.validationSamples.map((sample) => sample.trendTarget || 0);
      const labeling = this.modelPreprocessingService.buildDirectionLabeling(trendTargets, 0.0001);
      const validationLabeling = this.modelPreprocessingService.buildDirectionLabeling(validationTrendTargets, 0.0001);

      await this.ensureRemoteModelExists(modelId, architecture);
      const trainingJob = await this.tensorflowApiClientService.queueTrainingJob(modelId, {
        fitConfig: {
          batchSize: config.MODEL_TF_BATCH_SIZE,
          epochs: config.MODEL_TF_EPOCHS,
          shuffle: true,
        },
        trainingInput: {
          inputs: scaledTrainingSequences,
          sampleWeights: {
            classification: labeling.sampleWeights,
            regression: trendTargets.map(() => 1),
          },
          targets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(labeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(trendTargets),
          },
          validationInputs: scaledValidationSequences,
          validationSampleWeights: {
            classification: validationTrendTargets.map(() => 1),
            regression: validationTrendTargets.map(() => 1),
          },
          validationTargets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(validationLabeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(validationTrendTargets),
          },
        },
      });

      await this.waitForTrainingCompletion(trainingJob.jobId);
      const trainingJobResult = await this.tensorflowApiClientService.readJobResult(trainingJob.jobId);
      const validationPredictions = await this.buildValidationPredictions(modelId, scaledValidationSequences, "identity");
      const metrics = this.modelPreprocessingService.buildHeadMetrics(
        validationPredictions,
        validationTrendTargets,
        validationLabeling.labels,
        labeling.threshold,
      );
      const metadata = this.buildTrendMetadata(
        trendKey,
        architecture,
        trainingJobResult.trainedAt,
        featureMedians,
        featureScales,
        labeling.classWeights,
        labeling.threshold,
        latestFold.trainingSamples.length,
        latestFold.validationSamples.length,
        new Date(latestFold.trainingSamples[0]?.decisionTime || 0).toISOString(),
        new Date(latestFold.trainingSamples.at(-1)?.decisionTime || 0).toISOString(),
        latestFold.validationWindowStart,
        latestFold.validationWindowEnd,
        metrics,
      );
      const remoteModelRecord = await this.tensorflowApiClientService.updateModelMetadata(modelId, { metadata });
      trainResult = {
        artifact: this.buildTrendArtifact(remoteModelRecord, metadata),
        trainingSampleCount: latestFold.trainingSamples.length,
        validationSampleCount: latestFold.validationSamples.length,
      };
    }

    return trainResult;
  }

  public async trainClob(modelKey: ModelClobKey, samples: ModelClobSample[]): Promise<ModelClobTrainResult> {
    const validSamples = samples
      .filter((sample) => sample.clobTarget !== null && sample.clobDirectionTarget !== null)
      .sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    const latestFold = this.buildTrainingSplit(validSamples);
    let trainResult: ModelClobTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (latestFold !== null && latestFold.trainingSamples.length >= this.minSampleCount && latestFold.validationSamples.length > 0) {
      const architecture = this.readClobArchitecture(modelKey, latestFold.trainingSamples);
      const modelId = this.buildClobModelId(modelKey);
      const trainingSequences = this.modelPreprocessingService.buildClobSequences(latestFold.trainingSamples);
      const validationSequences = this.modelPreprocessingService.buildClobSequences(latestFold.validationSamples);
      const featureMedians = this.modelPreprocessingService.buildFeatureMedians(trainingSequences);
      const featureScales = this.modelPreprocessingService.buildFeatureScales(trainingSequences, featureMedians);
      const scaledTrainingSequences = this.modelPreprocessingService.scaleSequences(trainingSequences, featureMedians, featureScales);
      const scaledValidationSequences = this.modelPreprocessingService.scaleSequences(validationSequences, featureMedians, featureScales);
      const clobTargets = latestFold.trainingSamples.map((sample) => sample.clobTarget || 0);
      const validationClobTargets = latestFold.validationSamples.map((sample) => sample.clobTarget || 0);
      const directionTargets = latestFold.trainingSamples.map((sample) => sample.clobDirectionTarget || 0);
      const validationDirectionTargets = latestFold.validationSamples.map((sample) => sample.clobDirectionTarget || 0);
      const labeling = this.modelPreprocessingService.buildDirectionLabeling(directionTargets, 0.0025);
      const validationLabeling = this.modelPreprocessingService.buildDirectionLabeling(validationDirectionTargets, 0.0025);

      await this.ensureRemoteModelExists(modelId, architecture);
      const trainingJob = await this.tensorflowApiClientService.queueTrainingJob(modelId, {
        fitConfig: {
          batchSize: config.MODEL_TF_BATCH_SIZE,
          epochs: config.MODEL_TF_EPOCHS,
          shuffle: true,
        },
        trainingInput: {
          inputs: scaledTrainingSequences,
          sampleWeights: {
            classification: labeling.sampleWeights,
            regression: clobTargets.map(() => 1),
          },
          targets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(labeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(clobTargets),
          },
          validationInputs: scaledValidationSequences,
          validationSampleWeights: {
            classification: validationDirectionTargets.map(() => 1),
            regression: validationDirectionTargets.map(() => 1),
          },
          validationTargets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(validationLabeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(validationClobTargets),
          },
        },
      });

      await this.waitForTrainingCompletion(trainingJob.jobId);
      const trainingJobResult = await this.tensorflowApiClientService.readJobResult(trainingJob.jobId);
      const validationPredictions = await this.buildValidationPredictions(modelId, scaledValidationSequences, "logit_probability");
      const decodedValidationTargets = validationClobTargets.map((target) => this.modelPreprocessingService.decodeRegressionValue(target, "logit_probability"));
      const metrics = this.modelPreprocessingService.buildHeadMetrics(
        validationPredictions,
        decodedValidationTargets,
        validationLabeling.labels,
        labeling.threshold,
      );
      const metadata = this.buildClobMetadata(
        modelKey,
        architecture,
        trainingJobResult.trainedAt,
        featureMedians,
        featureScales,
        labeling.classWeights,
        labeling.threshold,
        latestFold.trainingSamples.length,
        latestFold.validationSamples.length,
        new Date(latestFold.trainingSamples[0]?.decisionTime || 0).toISOString(),
        new Date(latestFold.trainingSamples.at(-1)?.decisionTime || 0).toISOString(),
        latestFold.validationWindowStart,
        latestFold.validationWindowEnd,
        metrics,
      );
      const remoteModelRecord = await this.tensorflowApiClientService.updateModelMetadata(modelId, { metadata });
      trainResult = {
        artifact: this.buildClobArtifact(remoteModelRecord, metadata),
        trainingSampleCount: latestFold.trainingSamples.length,
        validationSampleCount: latestFold.validationSamples.length,
      };
    }

    return trainResult;
  }
}
