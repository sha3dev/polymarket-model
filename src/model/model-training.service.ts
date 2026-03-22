/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { TensorflowApiDecodedPrediction, TensorflowApiHeadMetadata, TensorflowApiModelRecord } from "../tensorflow-api/tensorflow-api.types.ts";
import { TensorflowApiClientService } from "../tensorflow-api/tensorflow-api-client.service.ts";
import { TensorflowApiModelDefinitionService } from "../tensorflow-api/tensorflow-api-model-definition.service.ts";
import type { ModelArtifact, ModelAsset, ModelCryptoInput, ModelCryptoSample, ModelFeatureNames, ModelTensorflowArchitecture } from "./model.types.ts";
import { ModelPreprocessingService } from "./model-preprocessing.service.ts";
import type { ModelHeadPrediction, ModelTrainingSplit, ModelTrainResult } from "./model-runtime.types.ts";

/**
 * @section consts
 */

const CRYPTO_ARCHITECTURES: Record<ModelAsset, ModelTensorflowArchitecture> = {
  btc: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  eth: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 0, sequenceLength: 0 },
  sol: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
  xrp: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 0, sequenceLength: 0 },
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
    const modelTrainingService = new ModelTrainingService({
      featureNames,
      minSampleCount: config.MODEL_MIN_SAMPLE_COUNT,
      modelPreprocessingService: ModelPreprocessingService.createDefault(),
      tensorflowApiClientService: TensorflowApiClientService.createDefault(),
      tensorflowApiModelDefinitionService: TensorflowApiModelDefinitionService.createDefault(),
      trainPollIntervalMs: config.TENSORFLOW_API_TRAIN_POLL_INTERVAL_MS,
      trainTimeoutMs: config.TENSORFLOW_API_TRAIN_TIMEOUT_MS,
    });
    return modelTrainingService;
  }

  /**
   * @section private:methods
   */

  private buildTrainingSplit(samples: ModelCryptoSample[]): ModelTrainingSplit<ModelCryptoSample> | null {
    const validationSampleCount = Math.max(1, Math.floor(samples.length * VALIDATION_SAMPLE_RATIO));
    const trainingCutoffIndex = samples.length - validationSampleCount;
    const trainingSamples = samples.slice(0, trainingCutoffIndex);
    const validationSamples = samples.slice(trainingCutoffIndex);
    let trainingSplit: ModelTrainingSplit<ModelCryptoSample> | null = null;

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

  private readArchitecture(asset: ModelAsset, samples: ModelCryptoSample[]): ModelTensorflowArchitecture {
    const architecture: ModelTensorflowArchitecture = {
      ...CRYPTO_ARCHITECTURES[asset],
      featureCount: this.featureNames.cryptoFeatures.length,
      sequenceLength: samples[0]?.cryptoSequence.length || 0,
    };
    return architecture;
  }

  private buildModelId(asset: ModelAsset): string {
    const modelId = `polymarket_model_crypto_${asset}`;
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

  private buildMetadata(
    asset: ModelAsset,
    architecture: ModelTensorflowArchitecture,
    trainedAt: string,
    featureMedians: number[],
    featureScales: number[],
    classWeights: [number, number],
    trainingSampleCount: number,
    validationSampleCount: number,
    lastValidationWindowStart: string | null,
    lastValidationWindowEnd: string | null,
    metrics: ModelArtifact["model"]["metrics"],
  ): TensorflowApiHeadMetadata {
    const metadata: TensorflowApiHeadMetadata = {
      architecture,
      classWeights,
      featureMedians,
      featureNames: this.featureNames.cryptoFeatures,
      featureScales,
      lastValidationWindowEnd,
      lastValidationWindowStart,
      logicalKey: asset,
      logicalModelType: "crypto",
      metrics,
      trainedAt,
      trainingSampleCount,
      validationSampleCount,
    };
    return metadata;
  }

  private buildArtifact(remoteModelRecord: TensorflowApiModelRecord, metadata: TensorflowApiHeadMetadata): ModelArtifact {
    const artifact: ModelArtifact = {
      asset: metadata.logicalKey as ModelAsset,
      lastValidationWindowEnd: metadata.lastValidationWindowEnd,
      lastValidationWindowStart: metadata.lastValidationWindowStart,
      model: {
        architecture: metadata.architecture,
        classWeights: metadata.classWeights,
        featureMedians: metadata.featureMedians,
        featureNames: metadata.featureNames,
        featureScales: metadata.featureScales,
        metrics: metadata.metrics,
        remoteModelId: remoteModelRecord.modelId,
      },
      remoteModelId: remoteModelRecord.modelId,
      trainedAt: metadata.trainedAt,
      trainingSampleCount: metadata.trainingSampleCount,
      validationSampleCount: metadata.validationSampleCount,
      version: remoteModelRecord.trainingCount,
    };
    return artifact;
  }

  private buildDecodedPrediction(predictionResponse: { outputs: Record<string, number[][]> }): TensorflowApiDecodedPrediction {
    const regressionOutput = predictionResponse.outputs.regression?.[0]?.[0] || 0;
    const classificationOutput = predictionResponse.outputs.classification?.[0] || [0, 0];
    const decodedPrediction: TensorflowApiDecodedPrediction = {
      predictedReturn: regressionOutput,
      probabilities: this.modelPreprocessingService.buildProbabilities(classificationOutput),
    };
    return decodedPrediction;
  }

  private async buildValidationPredictions(modelId: string, scaledValidationSequences: number[][][]): Promise<TensorflowApiDecodedPrediction[]> {
    const predictionResponse = await this.tensorflowApiClientService.predict(modelId, {
      predictionInput: {
        inputs: scaledValidationSequences,
      },
    });
    const regressionOutputs = predictionResponse.outputs.regression || [];
    const classificationOutputs = predictionResponse.outputs.classification || [];
    const validationPredictions = scaledValidationSequences.map((_sequence, sequenceIndex) => ({
      predictedReturn: regressionOutputs[sequenceIndex]?.[0] || 0,
      probabilities: this.modelPreprocessingService.buildProbabilities(classificationOutputs[sequenceIndex] || [0, 0]),
    }));
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

  public async predictAsset(artifact: ModelArtifact, input: ModelCryptoInput): Promise<ModelHeadPrediction> {
    const scaledInput = this.modelPreprocessingService.scaleSequences([input.cryptoSequence], artifact.model.featureMedians, artifact.model.featureScales);
    const predictionResponse = await this.tensorflowApiClientService.predict(artifact.remoteModelId, {
      predictionInput: {
        inputs: scaledInput,
      },
    });
    const decodedPrediction = this.buildDecodedPrediction(predictionResponse);
    const modelHeadPrediction: ModelHeadPrediction = {
      predictedDirection: decodedPrediction.predictedReturn > 0 ? "up" : "down",
      predictedProbability: decodedPrediction.probabilities,
      predictedReturn: decodedPrediction.predictedReturn,
    };
    return modelHeadPrediction;
  }

  public async trainAsset(asset: ModelAsset, samples: ModelCryptoSample[]): Promise<ModelTrainResult> {
    const validSamples = [...samples].sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    const trainingSplit = this.buildTrainingSplit(validSamples);
    let trainResult: ModelTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (trainingSplit !== null && trainingSplit.trainingSamples.length >= this.minSampleCount && trainingSplit.validationSamples.length > 0) {
      const architecture = this.readArchitecture(asset, validSamples);
      const modelId = this.buildModelId(asset);
      const trainingSequences = this.modelPreprocessingService.buildCryptoSequences(trainingSplit.trainingSamples);
      const validationSequences = this.modelPreprocessingService.buildCryptoSequences(trainingSplit.validationSamples);
      const featureMedians = this.modelPreprocessingService.buildFeatureMedians(trainingSequences);
      const featureScales = this.modelPreprocessingService.buildFeatureScales(trainingSequences, featureMedians);
      const scaledTrainingSequences = this.modelPreprocessingService.scaleSequences(trainingSequences, featureMedians, featureScales);
      const scaledValidationSequences = this.modelPreprocessingService.scaleSequences(validationSequences, featureMedians, featureScales);
      const trainingTargets = trainingSplit.trainingSamples.map((sample) => sample.targetReturn);
      const validationTargets = trainingSplit.validationSamples.map((sample) => sample.targetReturn);
      const labeling = this.modelPreprocessingService.buildDirectionLabeling(trainingTargets);
      const validationLabeling = this.modelPreprocessingService.buildDirectionLabeling(validationTargets);

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
            regression: trainingTargets.map(() => 1),
          },
          targets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(labeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(trainingTargets),
          },
          validationInputs: scaledValidationSequences,
          validationSampleWeights: {
            classification: validationTargets.map(() => 1),
            regression: validationTargets.map(() => 1),
          },
          validationTargets: {
            classification: this.modelPreprocessingService.buildOneHotTargets(validationLabeling.labels),
            regression: this.modelPreprocessingService.buildRegressionTargets(validationTargets),
          },
        },
      });

      await this.waitForTrainingCompletion(trainingJob.jobId);
      const trainingJobResult = await this.tensorflowApiClientService.readJobResult(trainingJob.jobId);
      const validationPredictions = await this.buildValidationPredictions(modelId, scaledValidationSequences);
      const metrics = this.modelPreprocessingService.buildHeadMetrics(validationPredictions, validationTargets, validationLabeling.labels);
      const metadata = this.buildMetadata(
        asset,
        architecture,
        trainingJobResult.trainedAt,
        featureMedians,
        featureScales,
        labeling.classWeights,
        trainingSplit.trainingSamples.length,
        trainingSplit.validationSamples.length,
        trainingSplit.validationWindowStart,
        trainingSplit.validationWindowEnd,
        metrics,
      );
      const remoteModelRecord = await this.tensorflowApiClientService.updateModelMetadata(modelId, {
        metadata,
      });
      trainResult = {
        artifact: this.buildArtifact(remoteModelRecord, metadata),
        trainingSampleCount: trainingSplit.trainingSamples.length,
        validationSampleCount: trainingSplit.validationSamples.length,
      };
    }

    return trainResult;
  }
}
