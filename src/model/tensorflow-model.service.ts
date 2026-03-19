/**
 * @section imports:externals
 */

import * as tf from "@tensorflow/tfjs-node";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  ModelArtifact,
  ModelAsset,
  ModelDirectionClass,
  ModelDirectionProbability,
  ModelFeatureInput,
  ModelFeatureNames,
  ModelKey,
  ModelMetrics,
  ModelSequenceSample,
  ModelTensorflowArchitecture,
  ModelWindow,
} from "./model.types.ts";
import type {
  ModelArtifactCandidate,
  ModelArtifactCandidateHead,
  ModelHeadPrediction,
  ModelLabelingResult,
  ModelLoadedArtifact,
  ModelPredictionResult,
  ModelTrainResult,
  ModelWalkForwardFold,
} from "./model-runtime.types.ts";

/**
 * @section consts
 */

const CLASS_ORDER: readonly ModelDirectionClass[] = [0, 1, 2];
const HUBER_DELTA = 0.01;
const L2_WEIGHT_DECAY = 1e-5;
const MIN_CLASS_WEIGHT = 0.25;

const TREND_ARCHITECTURES: Record<ModelKey, ModelTensorflowArchitecture> = {
  btc_5m: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 48, sequenceLength: 128 },
  btc_15m: { family: "tcn", blockCount: 7, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32, 64], dropout: 0.12, featureCount: 48, sequenceLength: 180 },
  eth_5m: { family: "tcn", blockCount: 6, channelCount: 32, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.1, featureCount: 48, sequenceLength: 128 },
  eth_15m: { family: "tcn", blockCount: 7, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32, 64], dropout: 0.12, featureCount: 48, sequenceLength: 180 },
  sol_5m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 48, sequenceLength: 128 },
  sol_15m: { family: "tcn", blockCount: 7, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32, 64], dropout: 0.15, featureCount: 48, sequenceLength: 180 },
  xrp_5m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 48, sequenceLength: 128 },
  xrp_15m: { family: "tcn", blockCount: 7, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32, 64], dropout: 0.15, featureCount: 48, sequenceLength: 180 },
};

const CLOB_ARCHITECTURES: Record<ModelKey, ModelTensorflowArchitecture> = {
  btc_5m: { family: "tcn", blockCount: 5, channelCount: 32, dilations: [1, 2, 4, 8, 16], dropout: 0.1, featureCount: 48, sequenceLength: 96 },
  btc_15m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 48, sequenceLength: 128 },
  eth_5m: { family: "tcn", blockCount: 5, channelCount: 32, dilations: [1, 2, 4, 8, 16], dropout: 0.1, featureCount: 48, sequenceLength: 96 },
  eth_15m: { family: "tcn", blockCount: 6, channelCount: 48, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.12, featureCount: 48, sequenceLength: 128 },
  sol_5m: { family: "tcn", blockCount: 5, channelCount: 48, dilations: [1, 2, 4, 8, 16], dropout: 0.12, featureCount: 48, sequenceLength: 96 },
  sol_15m: { family: "tcn", blockCount: 6, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.15, featureCount: 48, sequenceLength: 128 },
  xrp_5m: { family: "tcn", blockCount: 5, channelCount: 48, dilations: [1, 2, 4, 8, 16], dropout: 0.12, featureCount: 48, sequenceLength: 96 },
  xrp_15m: { family: "tcn", blockCount: 6, channelCount: 64, dilations: [1, 2, 4, 8, 16, 32], dropout: 0.15, featureCount: 48, sequenceLength: 128 },
};

/**
 * @section types
 */

type TensorflowModelServiceOptions = {
  batchSize: number;
  classificationWeight: number;
  earlyStoppingPatience: number;
  epochs: number;
  featureNames: ModelFeatureNames;
  learningRate: number;
  minSampleCount: number;
  predictionHorizonMs: number;
  trainWindowDays: number;
  validationWindowDays: number;
  embargoMs: number;
};

type HeadDataset = {
  labels: ModelLabelingResult;
  samples: Array<{ input: number[][]; target: number }>;
};

type HeadTrainResult = {
  head: ModelArtifactCandidateHead;
  validationPredictions: ModelHeadPrediction[];
};

type HeadTargetEncoding = "identity" | "logit_probability";

/**
 * @section class
 */

export class TensorflowModelService {
  /**
   * @section private:attributes
   */

  private readonly batchSize: number;

  private readonly classificationWeight: number;

  private readonly earlyStoppingPatience: number;

  private readonly epochs: number;

  private readonly featureNames: ModelFeatureNames;

  private readonly learningRate: number;

  private readonly minSampleCount: number;

  private readonly predictionHorizonMs: number;

  private readonly trainWindowDays: number;

  private readonly validationWindowDays: number;

  private readonly embargoMs: number;

  /**
   * @section constructor
   */

  public constructor(options: TensorflowModelServiceOptions) {
    this.batchSize = options.batchSize;
    this.classificationWeight = options.classificationWeight;
    this.earlyStoppingPatience = options.earlyStoppingPatience;
    this.epochs = options.epochs;
    this.featureNames = options.featureNames;
    this.learningRate = options.learningRate;
    this.minSampleCount = options.minSampleCount;
    this.predictionHorizonMs = options.predictionHorizonMs;
    this.trainWindowDays = options.trainWindowDays;
    this.validationWindowDays = options.validationWindowDays;
    this.embargoMs = options.embargoMs;
  }

  /**
   * @section factory
   */

  public static createDefault(featureNames: ModelFeatureNames): TensorflowModelService {
    const tensorflowModelService = new TensorflowModelService({
      batchSize: config.MODEL_TF_BATCH_SIZE,
      classificationWeight: config.MODEL_CLASSIFICATION_WEIGHT,
      earlyStoppingPatience: config.MODEL_TF_EARLY_STOPPING_PATIENCE,
      epochs: config.MODEL_TF_EPOCHS,
      featureNames,
      learningRate: config.MODEL_TF_LEARNING_RATE,
      minSampleCount: config.MODEL_MIN_SAMPLE_COUNT,
      predictionHorizonMs: config.MODEL_PREDICTION_HORIZON_MS,
      trainWindowDays: config.MODEL_TRAIN_WINDOW_DAYS,
      validationWindowDays: config.MODEL_VALIDATION_WINDOW_DAYS,
      embargoMs: config.MODEL_EMBARGO_MS,
    });
    return tensorflowModelService;
  }

  /**
   * @section private:methods
   */

  private buildModelKey(asset: ModelAsset, window: ModelWindow): ModelKey {
    const modelKey = `${asset}_${window}` as ModelKey;
    return modelKey;
  }

  private buildFoldSpanStart(sample: ModelSequenceSample): number {
    const maximumLookbackMs = Math.max(sample.trendSequence.length, sample.clobSequence.length) * 500;
    const foldSpanStart = sample.decisionTime - maximumLookbackMs;
    return foldSpanStart;
  }

  private buildFoldSpanEnd(sample: ModelSequenceSample): number {
    const foldSpanEnd = sample.decisionTime + this.predictionHorizonMs;
    return foldSpanEnd;
  }

  private buildModelSamples(asset: ModelAsset, window: ModelWindow, samples: ModelSequenceSample[]): ModelSequenceSample[] {
    const modelKey = this.buildModelKey(asset, window);
    const modelSamples = samples
      .filter((sample) => sample.modelKey === modelKey)
      .sort((leftSample, rightSample) => leftSample.decisionTime - rightSample.decisionTime);
    return modelSamples;
  }

  private buildWalkForwardFolds(samples: ModelSequenceSample[]): ModelWalkForwardFold[] {
    const foldWindowMs = this.validationWindowDays * 24 * 60 * 60 * 1_000;
    const trainWindowMs = this.trainWindowDays * 24 * 60 * 60 * 1_000;
    const folds: ModelWalkForwardFold[] = [];
    const latestDecisionTime = samples.at(-1)?.decisionTime || 0;
    let validationWindowEnd = latestDecisionTime;

    while (validationWindowEnd > 0) {
      const validationWindowStart = validationWindowEnd - foldWindowMs;
      const trainingWindowStart = validationWindowStart - trainWindowMs;
      const validationSamples = samples.filter((sample) => sample.decisionTime > validationWindowStart && sample.decisionTime <= validationWindowEnd);
      const trainingSamples = samples.filter((sample) => {
        const isInsideTrainingWindow = sample.decisionTime > trainingWindowStart && sample.decisionTime <= validationWindowStart - this.embargoMs;
        const overlapsValidationWindow =
          this.buildFoldSpanEnd(sample) >= validationWindowStart && this.buildFoldSpanStart(sample) <= validationWindowEnd + this.embargoMs;
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

  private buildThreshold(targets: number[], minimumThreshold: number): number {
    const sortedTargets = [...targets].map((target) => Math.abs(target)).sort((leftTarget, rightTarget) => leftTarget - rightTarget);
    const middleIndex = Math.floor(sortedTargets.length / 2);
    const medianTarget =
      sortedTargets.length === 0
        ? minimumThreshold
        : sortedTargets.length % 2 === 0
          ? ((sortedTargets[middleIndex - 1] || minimumThreshold) + (sortedTargets[middleIndex] || minimumThreshold)) / 2
          : sortedTargets[middleIndex] || minimumThreshold;
    const threshold = Math.max(minimumThreshold, medianTarget * 0.5);
    return threshold;
  }

  private classifyValue(value: number, threshold: number): ModelDirectionClass {
    let directionClass: ModelDirectionClass = 1;

    if (value > threshold) {
      directionClass = 0;
    }

    if (value < -threshold) {
      directionClass = 2;
    }

    return directionClass;
  }

  private buildLabels(targets: number[], minimumThreshold: number): ModelLabelingResult {
    const threshold = this.buildThreshold(targets, minimumThreshold);
    const labels = targets.map((target) => this.classifyValue(target, threshold));
    const counts = labels.reduce<[number, number, number]>(
      (labelCounts, label) => {
        labelCounts[label] += 1;
        return labelCounts;
      },
      [0, 0, 0],
    );
    const maxCount = Math.max(...counts, 1);
    const classWeights = counts.map((count) => Math.max(MIN_CLASS_WEIGHT, maxCount / Math.max(count, 1))) as [number, number, number];
    const labelingResult: ModelLabelingResult = {
      classWeights,
      labels,
      threshold,
    };
    return labelingResult;
  }

  private readTargetEncoding(head: "trend" | "clob"): HeadTargetEncoding {
    const targetEncoding = head === "trend" ? "identity" : "logit_probability";
    return targetEncoding;
  }

  private decodeRegressionValue(value: number, targetEncoding: HeadTargetEncoding): number {
    const decodedValue = targetEncoding === "logit_probability" ? 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value)))) : value;
    return decodedValue;
  }

  private decodeRegressionTargets(targets: number[], targetEncoding: HeadTargetEncoding): number[] {
    const decodedTargets = targets.map((target) => this.decodeRegressionValue(target, targetEncoding));
    return decodedTargets;
  }

  private buildHeadTrainingDataset(samples: ModelSequenceSample[], head: "trend" | "clob"): HeadDataset {
    const validSamples = samples.filter((sample) => (head === "trend" ? sample.trendTarget !== null : sample.clobTarget !== null));
    const regressionTargets = validSamples.map((sample) => (head === "trend" ? sample.trendTarget || 0 : sample.clobTarget || 0));
    const classificationTargets = validSamples.map((sample) => (head === "trend" ? sample.trendTarget || 0 : sample.clobDirectionTarget || 0));
    const labels = this.buildLabels(classificationTargets, head === "trend" ? 0.0001 : 0.0025);
    const dataset: HeadDataset = {
      labels,
      samples: validSamples.map((sample, sampleIndex) => ({
        input: head === "trend" ? sample.trendSequence : sample.clobSequence,
        target: regressionTargets[sampleIndex] || 0,
      })),
    };
    return dataset;
  }

  private buildHeadValidationDataset(samples: ModelSequenceSample[], head: "trend" | "clob"): HeadDataset {
    const dataset = this.buildHeadTrainingDataset(samples, head);
    return dataset;
  }

  private buildFeatureMedians(sequences: number[][][]): number[] {
    const featureCount = sequences[0]?.[0]?.length || 0;
    const featureMedians = Array.from({ length: featureCount }, (_, featureIndex) => {
      const values = sequences.flatMap((sequence) => sequence.map((row) => row[featureIndex] || 0)).sort((leftValue, rightValue) => leftValue - rightValue);
      const middleIndex = Math.floor(values.length / 2);
      const median =
        values.length === 0 ? 0 : values.length % 2 === 0 ? ((values[middleIndex - 1] || 0) + (values[middleIndex] || 0)) / 2 : values[middleIndex] || 0;
      return median;
    });
    return featureMedians;
  }

  private buildFeatureScales(sequences: number[][][], featureMedians: number[]): number[] {
    const featureScales = featureMedians.map((featureMedian, featureIndex) => {
      const deviations = sequences
        .flatMap((sequence) => sequence.map((row) => Math.abs((row[featureIndex] || 0) - featureMedian)))
        .sort((leftValue, rightValue) => leftValue - rightValue);
      const middleIndex = Math.floor(deviations.length / 2);
      const mad =
        deviations.length === 0
          ? 0
          : deviations.length % 2 === 0
            ? ((deviations[middleIndex - 1] || 0) + (deviations[middleIndex] || 0)) / 2
            : deviations[middleIndex] || 0;
      return Math.max(1.4826 * mad, 1e-8);
    });
    return featureScales;
  }

  private scaleSequences(sequences: number[][][], featureMedians: number[], featureScales: number[]): number[][][] {
    const scaledSequences = sequences.map((sequence) => {
      return sequence.map((row) => {
        return row.map((featureValue, featureIndex) => {
          return Math.max(-10, Math.min(10, (featureValue - (featureMedians[featureIndex] || 0)) / (featureScales[featureIndex] || 1)));
        });
      });
    });
    return scaledSequences;
  }

  private buildWeightedCrossEntropyLoss(classWeights: [number, number, number]): (labels: tf.Tensor, predictions: tf.Tensor) => tf.Tensor {
    const weightedCrossEntropyLoss = (labels: tf.Tensor, predictions: tf.Tensor): tf.Tensor => {
      const weightTensor = tf.tensor1d(classWeights);
      const perRowWeights = labels.mul(weightTensor).sum(-1);
      const perRowLosses = tf.losses.softmaxCrossEntropy(labels, predictions);
      const weightedLoss = perRowLosses.mul(perRowWeights).mul(this.classificationWeight);
      const reducedLoss = weightedLoss.mean();
      weightTensor.dispose();
      return reducedLoss;
    };
    return weightedCrossEntropyLoss;
  }

  private buildModel(architecture: ModelTensorflowArchitecture, classWeights: [number, number, number]): tf.LayersModel {
    const input = tf.input({ shape: [architecture.sequenceLength, architecture.featureCount] });
    let currentTensor = tf.layers
      .dense({
        units: architecture.channelCount,
        activation: "gelu",
        kernelRegularizer: tf.regularizers.l2({ l2: L2_WEIGHT_DECAY }),
      })
      .apply(input) as tf.SymbolicTensor;

    architecture.dilations.slice(0, architecture.blockCount).forEach((dilation) => {
      const residual = currentTensor;
      let blockTensor = tf.layers.layerNormalization().apply(currentTensor) as tf.SymbolicTensor;
      // tfjs-node cannot backpropagate conv gradients with dilation > 1 in this runtime.
      blockTensor = tf.layers
        .conv1d({
          filters: architecture.channelCount,
          kernelSize: 3,
          dilationRate: dilation > 1 ? 1 : dilation,
          padding: "same",
          activation: "gelu",
          kernelRegularizer: tf.regularizers.l2({ l2: L2_WEIGHT_DECAY }),
        })
        .apply(blockTensor) as tf.SymbolicTensor;
      blockTensor = tf.layers.dropout({ rate: architecture.dropout }).apply(blockTensor) as tf.SymbolicTensor;
      blockTensor = tf.layers
        .conv1d({
          filters: architecture.channelCount,
          kernelSize: 1,
          padding: "same",
          kernelRegularizer: tf.regularizers.l2({ l2: L2_WEIGHT_DECAY }),
        })
        .apply(blockTensor) as tf.SymbolicTensor;
      currentTensor = tf.layers.add().apply([residual, blockTensor]) as tf.SymbolicTensor;
    });

    let trunkTensor = tf.layers.globalAveragePooling1d().apply(currentTensor) as tf.SymbolicTensor;
    trunkTensor = tf.layers
      .dense({
        units: 128,
        activation: "gelu",
        kernelRegularizer: tf.regularizers.l2({ l2: L2_WEIGHT_DECAY }),
      })
      .apply(trunkTensor) as tf.SymbolicTensor;
    trunkTensor = tf.layers.dropout({ rate: architecture.dropout }).apply(trunkTensor) as tf.SymbolicTensor;
    trunkTensor = tf.layers
      .dense({
        units: 64,
        activation: "gelu",
        kernelRegularizer: tf.regularizers.l2({ l2: L2_WEIGHT_DECAY }),
      })
      .apply(trunkTensor) as tf.SymbolicTensor;
    const regressionOutput = tf.layers.dense({ units: 1, name: "regression" }).apply(trunkTensor) as tf.SymbolicTensor;
    const classificationOutput = tf.layers.dense({ units: 3, name: "classification" }).apply(trunkTensor) as tf.SymbolicTensor;
    const model = tf.model({
      inputs: input,
      outputs: [regressionOutput, classificationOutput],
    });
    model.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: {
        regression: tf.losses.huberLoss,
        classification: this.buildWeightedCrossEntropyLoss(classWeights),
      },
    });
    return model;
  }

  private async fitModel(
    model: tf.LayersModel,
    sequences: number[][][],
    regressionTargets: number[],
    labels: ModelLabelingResult,
    architecture: ModelTensorflowArchitecture,
  ): Promise<void> {
    const sequenceTensor = tf.tensor3d(sequences, [sequences.length, architecture.sequenceLength, architecture.featureCount]);
    const regressionTensor = tf.tensor2d(regressionTargets, [regressionTargets.length, 1]);
    const classificationTensor = tf.oneHot(tf.tensor1d(labels.labels, "int32"), 3);

    try {
      await model.fit(
        sequenceTensor,
        { regression: regressionTensor, classification: classificationTensor },
        {
          batchSize: Math.min(this.batchSize, Math.max(1, sequences.length)),
          callbacks: [tf.callbacks.earlyStopping({ monitor: "loss", patience: this.earlyStoppingPatience })],
          epochs: this.epochs,
          shuffle: true,
          verbose: 0,
        },
      );
    } finally {
      sequenceTensor.dispose();
      regressionTensor.dispose();
      classificationTensor.dispose();
    }
  }

  private buildHeadProbabilities(logits: number[]): ModelDirectionProbability {
    const exponentials = logits.map((logit) => Math.exp(logit - Math.max(...logits)));
    const sum = exponentials.reduce((valueSum, value) => valueSum + value, 0);
    const probabilities: ModelDirectionProbability = {
      up: sum === 0 ? 0 : (exponentials[0] || 0) / sum,
      flat: sum === 0 ? 0 : (exponentials[1] || 0) / sum,
      down: sum === 0 ? 0 : (exponentials[2] || 0) / sum,
    };
    return probabilities;
  }

  private async predictHeadRows(
    model: tf.LayersModel,
    sequences: number[][][],
    architecture: ModelTensorflowArchitecture,
    targetEncoding: HeadTargetEncoding,
  ): Promise<ModelHeadPrediction[]> {
    const sequenceTensor = tf.tensor3d(sequences, [sequences.length, architecture.sequenceLength, architecture.featureCount]);
    const modelOutputs = model.predict(sequenceTensor) as tf.Tensor[];
    let predictions: ModelHeadPrediction[] = [];

    try {
      const regressionTensor = modelOutputs[0];
      const classificationTensor = modelOutputs[1];
      const regressionValues = regressionTensor === undefined ? [] : Array.from(await regressionTensor.data());
      const classificationValues = classificationTensor === undefined ? [] : Array.from(await classificationTensor.data());
      predictions = regressionValues.map((predictedValue, index) => {
        const logits = classificationValues.slice(index * 3, index * 3 + 3);
        return {
          predictedValue: this.decodeRegressionValue(predictedValue, targetEncoding),
          probabilities: this.buildHeadProbabilities(logits),
        };
      });
    } finally {
      sequenceTensor.dispose();
      modelOutputs.forEach((output) => {
        output.dispose();
      });
    }

    return predictions;
  }

  private buildHeadMetrics(
    predictions: ModelHeadPrediction[],
    targets: number[],
    labels: ModelDirectionClass[],
    labelThreshold: number,
    head: "trend" | "clob",
  ): Pick<
    ModelMetrics,
    | "trendRegressionMae"
    | "trendRegressionRmse"
    | "trendRegressionHuber"
    | "trendDirectionMacroF1"
    | "trendDirectionSupport"
    | "clobRegressionMae"
    | "clobRegressionRmse"
    | "clobRegressionHuber"
    | "clobDirectionMacroF1"
    | "clobDirectionSupport"
  > {
    const errors = predictions.map((prediction, index) => prediction.predictedValue - (targets[index] || 0));
    const mae = errors.length === 0 ? null : errors.reduce((valueSum, value) => valueSum + Math.abs(value), 0) / errors.length;
    const rmse = errors.length === 0 ? null : Math.sqrt(errors.reduce((valueSum, value) => valueSum + value * value, 0) / errors.length);
    const huber =
      errors.length === 0
        ? null
        : errors.reduce((valueSum, value) => {
            const absoluteValue = Math.abs(value);
            return valueSum + (absoluteValue <= HUBER_DELTA ? 0.5 * absoluteValue * absoluteValue : HUBER_DELTA * (absoluteValue - 0.5 * HUBER_DELTA));
          }, 0) / errors.length;
    const predictedLabels = predictions.map((prediction) => this.classifyProbability(prediction.probabilities, labelThreshold));
    const support = labels.reduce<[number, number, number]>(
      (counts, label) => {
        counts[label] += 1;
        return counts;
      },
      [0, 0, 0],
    );
    const macroF1 =
      CLASS_ORDER.reduce<number>((scoreSum, labelClass) => {
        const truePositive = labels.filter((label, index) => label === labelClass && predictedLabels[index] === labelClass).length;
        const falsePositive = labels.filter((label, index) => label !== labelClass && predictedLabels[index] === labelClass).length;
        const falseNegative = labels.filter((label, index) => label === labelClass && predictedLabels[index] !== labelClass).length;
        const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
        const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
        const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
        return scoreSum + f1;
      }, 0) / CLASS_ORDER.length;
    const metricPayload =
      head === "trend"
        ? {
            trendRegressionMae: mae,
            trendRegressionRmse: rmse,
            trendRegressionHuber: huber,
            trendDirectionMacroF1: macroF1,
            trendDirectionSupport: {
              up: support[0],
              flat: support[1],
              down: support[2],
            },
            clobRegressionMae: null,
            clobRegressionRmse: null,
            clobRegressionHuber: null,
            clobDirectionMacroF1: null,
            clobDirectionSupport: {
              up: 0,
              flat: 0,
              down: 0,
            },
          }
        : {
            trendRegressionMae: null,
            trendRegressionRmse: null,
            trendRegressionHuber: null,
            trendDirectionMacroF1: null,
            trendDirectionSupport: {
              up: 0,
              flat: 0,
              down: 0,
            },
            clobRegressionMae: mae,
            clobRegressionRmse: rmse,
            clobRegressionHuber: huber,
            clobDirectionMacroF1: macroF1,
            clobDirectionSupport: {
              up: support[0],
              flat: support[1],
              down: support[2],
            },
          };
    return metricPayload;
  }

  private classifyProbability(probabilities: ModelDirectionProbability, threshold: number): ModelDirectionClass {
    let label: ModelDirectionClass = 1;

    if (probabilities.up >= Math.max(probabilities.flat, probabilities.down) && probabilities.up >= Math.min(0.5 + threshold, 0.95)) {
      label = 0;
    }

    if (probabilities.down >= Math.max(probabilities.flat, probabilities.up) && probabilities.down >= Math.min(0.5 + threshold, 0.95)) {
      label = 2;
    }

    return label;
  }

  private buildCompositeMetrics(
    trendMetrics: ReturnType<TensorflowModelService["buildHeadMetrics"]>,
    clobMetrics: ReturnType<TensorflowModelService["buildHeadMetrics"]>,
    sampleCount: number,
  ): ModelMetrics {
    const modelMetrics: ModelMetrics = {
      trendRegressionMae: trendMetrics.trendRegressionMae,
      trendRegressionRmse: trendMetrics.trendRegressionRmse,
      trendRegressionHuber: trendMetrics.trendRegressionHuber,
      trendDirectionMacroF1: trendMetrics.trendDirectionMacroF1,
      trendDirectionSupport: trendMetrics.trendDirectionSupport,
      clobRegressionMae: clobMetrics.clobRegressionMae,
      clobRegressionRmse: clobMetrics.clobRegressionRmse,
      clobRegressionHuber: clobMetrics.clobRegressionHuber,
      clobDirectionMacroF1: clobMetrics.clobDirectionMacroF1,
      clobDirectionSupport: clobMetrics.clobDirectionSupport,
      sampleCount,
    };
    return modelMetrics;
  }

  private async trainHead(
    trainingSamples: ModelSequenceSample[],
    validationSamples: ModelSequenceSample[],
    architecture: ModelTensorflowArchitecture,
    head: "trend" | "clob",
  ): Promise<HeadTrainResult | null> {
    const trainingDataset = this.buildHeadTrainingDataset(trainingSamples, head);
    const validationDataset = this.buildHeadValidationDataset(validationSamples, head);
    const sequenceCount = trainingDataset.samples.length;
    let headTrainResult: HeadTrainResult | null = null;

    if (sequenceCount >= this.minSampleCount && validationDataset.samples.length > 0) {
      const trainingSequences = trainingDataset.samples.map((sample) => sample.input);
      const trainingTargets = trainingDataset.samples.map((sample) => sample.target);
      const featureMedians = this.buildFeatureMedians(trainingSequences);
      const featureScales = this.buildFeatureScales(trainingSequences, featureMedians);
      const scaledTrainingSequences = this.scaleSequences(trainingSequences, featureMedians, featureScales);
      const scaledValidationSequences = this.scaleSequences(
        validationDataset.samples.map((sample) => sample.input),
        featureMedians,
        featureScales,
      );
      const model = this.buildModel(architecture, trainingDataset.labels.classWeights);
      await this.fitModel(model, scaledTrainingSequences, trainingTargets, trainingDataset.labels, architecture);
      const validationPredictions = await this.predictHeadRows(model, scaledValidationSequences, architecture, this.readTargetEncoding(head));
      headTrainResult = {
        head: {
          architecture,
          classWeights: trainingDataset.labels.classWeights,
          directionThreshold: trainingDataset.labels.threshold,
          featureMedians,
          featureNames: head === "trend" ? this.featureNames.trendFeatures : this.featureNames.clobFeatures,
          featureScales,
          model,
          targetEncoding: this.readTargetEncoding(head),
        },
        validationPredictions,
      };
    }

    return headTrainResult;
  }

  private buildArtifactCandidate(
    _modelKey: ModelKey,
    previousVersion: number,
    trendHead: HeadTrainResult,
    clobHead: HeadTrainResult,
    trainingSamples: ModelSequenceSample[],
    validationSamples: ModelSequenceSample[],
    validationWindowStart: string | null,
    validationWindowEnd: string | null,
  ): ModelArtifactCandidate {
    const trendValidationDataset = this.buildHeadValidationDataset(validationSamples, "trend");
    const clobValidationDataset = this.buildHeadValidationDataset(validationSamples, "clob");
    const trendMetrics = this.buildHeadMetrics(
      trendHead.validationPredictions,
      this.decodeRegressionTargets(
        trendValidationDataset.samples.map((sample) => sample.target),
        trendHead.head.targetEncoding,
      ),
      trendValidationDataset.labels.labels,
      trendHead.head.directionThreshold,
      "trend",
    );
    const clobMetrics = this.buildHeadMetrics(
      clobHead.validationPredictions,
      this.decodeRegressionTargets(
        clobValidationDataset.samples.map((sample) => sample.target),
        clobHead.head.targetEncoding,
      ),
      clobValidationDataset.labels.labels,
      clobHead.head.directionThreshold,
      "clob",
    );
    const artifactCandidate: ModelArtifactCandidate = {
      version: previousVersion + 1,
      trainedAt: new Date().toISOString(),
      trainingSampleCount: trainingSamples.length,
      validationSampleCount: validationSamples.length,
      lastTrainWindowStart: trainingSamples.at(0) === undefined ? null : new Date(trainingSamples[0]?.decisionTime || 0).toISOString(),
      lastTrainWindowEnd: trainingSamples.at(-1) === undefined ? null : new Date(trainingSamples.at(-1)?.decisionTime || 0).toISOString(),
      lastValidationWindowStart: validationWindowStart,
      lastValidationWindowEnd: validationWindowEnd,
      metrics: this.buildCompositeMetrics(trendMetrics, clobMetrics, validationSamples.length),
      trendModel: trendHead.head,
      clobModel: clobHead.head,
    };
    return artifactCandidate;
  }

  private buildLoadedArtifact(artifact: ModelLoadedArtifact): ModelLoadedArtifact {
    const loadedArtifact: ModelLoadedArtifact = {
      ...artifact,
      trendModel: {
        ...artifact.trendModel,
        metadata: {
          ...artifact.trendModel.metadata,
          targetEncoding: artifact.trendModel.metadata.targetEncoding || "identity",
        },
      },
      clobModel: {
        ...artifact.clobModel,
        metadata: {
          ...artifact.clobModel.metadata,
          targetEncoding: artifact.clobModel.metadata.targetEncoding || "identity",
        },
      },
    };
    return loadedArtifact;
  }

  private scaleSingleSequence(sequence: number[][], featureMedians: number[], featureScales: number[]): number[][] {
    const scaledSequence = this.scaleSequences([sequence], featureMedians, featureScales)[0] || [];
    return scaledSequence;
  }

  private predictLoadedHead(artifactHead: ModelLoadedArtifact["trendModel"], inputSequence: number[][]): ModelHeadPrediction {
    const architecture = artifactHead.metadata.architecture;
    const scaledSequence = this.scaleSingleSequence(inputSequence, artifactHead.metadata.featureMedians, artifactHead.metadata.featureScales);
    const sequenceTensor = tf.tensor3d([scaledSequence], [1, architecture.sequenceLength, architecture.featureCount]);
    const modelOutputs = artifactHead.model.predict(sequenceTensor) as tf.Tensor[];
    let headPrediction: ModelHeadPrediction = {
      predictedValue: 0,
      probabilities: { up: 0, flat: 1, down: 0 },
    };

    try {
      const regressionTensor = modelOutputs[0];
      const classificationTensor = modelOutputs[1];
      const regressionValues = regressionTensor === undefined ? [] : Array.from(regressionTensor.dataSync());
      const classificationValues = classificationTensor === undefined ? [] : Array.from(classificationTensor.dataSync());
      headPrediction = {
        predictedValue: this.decodeRegressionValue(regressionValues[0] || 0, artifactHead.metadata.targetEncoding || "identity"),
        probabilities: this.buildHeadProbabilities(classificationValues.slice(0, 3)),
      };
    } finally {
      sequenceTensor.dispose();
      modelOutputs.forEach((output) => {
        output.dispose();
      });
    }

    return headPrediction;
  }

  /**
   * @section public:methods
   */

  public async loadArtifact(artifact: ModelArtifact, stateDirectoryPath: string): Promise<ModelLoadedArtifact> {
    const trendModel = await tf.loadLayersModel(`file://${stateDirectoryPath}/${artifact.trendModel.modelPath}/model.json`);
    const clobModel = await tf.loadLayersModel(`file://${stateDirectoryPath}/${artifact.clobModel.modelPath}/model.json`);
    const loadedArtifact: ModelLoadedArtifact = this.buildLoadedArtifact({
      ...artifact,
      trendModel: {
        metadata: artifact.trendModel,
        model: trendModel,
      },
      clobModel: {
        metadata: artifact.clobModel,
        model: clobModel,
      },
    });
    return loadedArtifact;
  }

  public disposeArtifact(artifact: ModelLoadedArtifact): void {
    artifact.trendModel.model.dispose();
    artifact.clobModel.model.dispose();
  }

  public async train(asset: ModelAsset, window: ModelWindow, samples: ModelSequenceSample[], previousVersion: number): Promise<ModelTrainResult> {
    const modelSamples = this.buildModelSamples(asset, window, samples);
    const folds = this.buildWalkForwardFolds(modelSamples);
    const modelKey = this.buildModelKey(asset, window);
    const latestFold = folds.at(-1) || null;
    let trainResult: ModelTrainResult = {
      artifact: null,
      trainingSampleCount: 0,
      validationSampleCount: 0,
    };

    if (latestFold !== null) {
      const trendHead = await this.trainHead(latestFold.trainingSamples, latestFold.validationSamples, TREND_ARCHITECTURES[modelKey], "trend");
      const clobHead = await this.trainHead(latestFold.trainingSamples, latestFold.validationSamples, CLOB_ARCHITECTURES[modelKey], "clob");

      if (trendHead !== null && clobHead !== null) {
        trainResult = {
          artifact: this.buildArtifactCandidate(
            modelKey,
            previousVersion,
            trendHead,
            clobHead,
            latestFold.trainingSamples,
            latestFold.validationSamples,
            latestFold.validationWindowStart,
            latestFold.validationWindowEnd,
          ),
          trainingSampleCount: latestFold.trainingSamples.length,
          validationSampleCount: latestFold.validationSamples.length,
        };
      }
    }

    return trainResult;
  }

  public predict(artifact: ModelLoadedArtifact, input: ModelFeatureInput): ModelPredictionResult {
    const modelPredictionResult: ModelPredictionResult = {
      trend: this.predictLoadedHead(artifact.trendModel, input.trendSequence),
      clob: this.predictLoadedHead(artifact.clobModel, input.clobSequence),
    };
    return modelPredictionResult;
  }
}
