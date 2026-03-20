/**
 * @section imports:internals
 */

import type { ModelClobSample, ModelDirectionClass, ModelDirectionProbability, ModelHeadMetrics, ModelTrendSample } from "./model.types.ts";

/**
 * @section consts
 */

const HUBER_DELTA = 0.01;
const MIN_CLASS_WEIGHT = 0.25;

/**
 * @section types
 */

type ModelSampleWeightPayload = {
  classWeights: [number, number, number];
  labels: ModelDirectionClass[];
  sampleWeights: number[];
  threshold: number;
};

/**
 * @section class
 */

export class ModelPreprocessingService {
  /**
   * @section factory
   */

  public static createDefault(): ModelPreprocessingService {
    const modelPreprocessingService = new ModelPreprocessingService();
    return modelPreprocessingService;
  }

  /**
   * @section private:methods
   */

  private clamp(value: number, minimumValue: number, maximumValue: number): number {
    const clampedValue = Math.min(maximumValue, Math.max(minimumValue, value));
    return clampedValue;
  }

  private readNumericValue(value: number | null | undefined): number {
    const numericValue = value ?? 0;
    return numericValue;
  }

  private buildMedian(values: number[]): number {
    const sortedValues = [...values].sort((leftValue, rightValue) => leftValue - rightValue);
    const middleIndex = Math.floor(sortedValues.length / 2);
    let median = 0;

    if (sortedValues.length > 0) {
      median = sortedValues.length % 2 === 1 ? sortedValues[middleIndex] || 0 : ((sortedValues[middleIndex - 1] || 0) + (sortedValues[middleIndex] || 0)) / 2;
    }

    return median;
  }

  private buildAbsoluteDeviations(values: number[], median: number): number[] {
    const absoluteDeviations = values.map((value) => Math.abs(value - median));
    return absoluteDeviations;
  }

  private buildThreshold(targets: number[], minimumThreshold: number): number {
    const absoluteTargets = targets.map((target) => Math.abs(target));
    const threshold = Math.max(minimumThreshold, this.buildMedian(absoluteTargets) * 0.5);
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

  /**
   * @section public:methods
   */

  public buildFeatureMedians(sequences: number[][][]): number[] {
    const featureCount = sequences[0]?.[0]?.length || 0;
    const featureMedians = Array.from({ length: featureCount }, (_unusedValue, featureIndex) => {
      const featureValues = sequences.flatMap((sequence) => sequence.map((row) => this.readNumericValue(row[featureIndex])));
      return this.buildMedian(featureValues);
    });
    return featureMedians;
  }

  public buildFeatureScales(sequences: number[][][], featureMedians: number[]): number[] {
    const featureScales = featureMedians.map((featureMedian, featureIndex) => {
      const featureValues = sequences.flatMap((sequence) => sequence.map((row) => this.readNumericValue(row[featureIndex])));
      const mad = this.buildMedian(this.buildAbsoluteDeviations(featureValues, featureMedian));
      return Math.max(1.4826 * mad, 0.00000001);
    });
    return featureScales;
  }

  public scaleSequences(sequences: number[][][], featureMedians: number[], featureScales: number[]): number[][][] {
    const scaledSequences = sequences.map((sequence) =>
      sequence.map((row) =>
        row.map((featureValue, featureIndex) =>
          this.clamp((this.readNumericValue(featureValue) - (featureMedians[featureIndex] || 0)) / (featureScales[featureIndex] || 1), -10, 10),
        ),
      ),
    );
    return scaledSequences;
  }

  public buildDirectionLabeling(targets: number[], minimumThreshold: number): ModelSampleWeightPayload {
    const threshold = this.buildThreshold(targets, minimumThreshold);
    const labels = targets.map((target) => this.classifyValue(target, threshold));
    const support = [labels.filter((label) => label === 0).length, labels.filter((label) => label === 1).length, labels.filter((label) => label === 2).length];
    const maximumSupport = Math.max(...support, 1);
    const classWeights = support.map((count) => Math.max(MIN_CLASS_WEIGHT, maximumSupport / Math.max(count, 1))) as [number, number, number];
    const sampleWeights = labels.map((label) => classWeights[label] || 1);
    const sampleWeightPayload: ModelSampleWeightPayload = {
      classWeights,
      labels,
      sampleWeights,
      threshold,
    };
    return sampleWeightPayload;
  }

  public buildOneHotTargets(labels: ModelDirectionClass[]): number[][] {
    const oneHotTargets = labels.map((label) => [label === 0 ? 1 : 0, label === 1 ? 1 : 0, label === 2 ? 1 : 0]);
    return oneHotTargets;
  }

  public buildRegressionTargets(targets: number[]): number[][] {
    const regressionTargets = targets.map((target) => [target]);
    return regressionTargets;
  }

  public decodeRegressionValue(value: number, targetEncoding: "identity" | "logit_probability"): number {
    let decodedValue = value;

    if (targetEncoding === "logit_probability") {
      const clippedValue = this.clamp(value, -20, 20);
      decodedValue = 1 / (1 + Math.exp(-clippedValue));
    }

    return decodedValue;
  }

  public buildProbabilities(logits: number[]): ModelDirectionProbability {
    const maximumLogit = Math.max(...logits);
    const exponentials = logits.map((logit) => Math.exp(logit - maximumLogit));
    const denominator = exponentials.reduce((sum, value) => sum + value, 0);
    const probabilities: ModelDirectionProbability =
      denominator > 0
        ? {
            up: (exponentials[0] || 0) / denominator,
            flat: (exponentials[1] || 0) / denominator,
            down: (exponentials[2] || 0) / denominator,
          }
        : { up: 0, flat: 0, down: 0 };
    return probabilities;
  }

  public buildHeadMetrics(
    predictions: Array<{ predictedValue: number; probabilities: ModelDirectionProbability }>,
    targets: number[],
    labels: ModelDirectionClass[],
    threshold: number,
  ): ModelHeadMetrics {
    const errors = predictions.map((prediction, predictionIndex) => prediction.predictedValue - (targets[predictionIndex] || 0));
    const predictedLabels = predictions.map((prediction) => {
      let predictedLabel: ModelDirectionClass = 1;

      if (
        prediction.probabilities.up >= Math.max(prediction.probabilities.flat, prediction.probabilities.down) &&
        prediction.probabilities.up >= Math.min(0.5 + threshold, 0.95)
      ) {
        predictedLabel = 0;
      }

      if (
        prediction.probabilities.down >= Math.max(prediction.probabilities.flat, prediction.probabilities.up) &&
        prediction.probabilities.down >= Math.min(0.5 + threshold, 0.95)
      ) {
        predictedLabel = 2;
      }

      return predictedLabel;
    });
    const macroF1 = [0, 1, 2].reduce((sum, labelClass) => {
      const truePositive = labels.filter((label, index) => label === labelClass && predictedLabels[index] === labelClass).length;
      const falsePositive = labels.filter((label, index) => label !== labelClass && predictedLabels[index] === labelClass).length;
      const falseNegative = labels.filter((label, index) => label === labelClass && predictedLabels[index] !== labelClass).length;
      const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
      const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      return sum + f1 / 3;
    }, 0);
    const sampleCount = targets.length;
    const metrics: ModelHeadMetrics = {
      regressionMae: sampleCount === 0 ? null : errors.reduce((sum, error) => sum + Math.abs(error), 0) / sampleCount,
      regressionRmse: sampleCount === 0 ? null : Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / sampleCount),
      regressionHuber:
        sampleCount === 0
          ? null
          : errors.reduce((sum, error) => {
              const absoluteError = Math.abs(error);
              return sum + (absoluteError <= HUBER_DELTA ? 0.5 * absoluteError * absoluteError : HUBER_DELTA * (absoluteError - 0.5 * HUBER_DELTA));
            }, 0) / sampleCount,
      directionMacroF1: macroF1,
      directionSupport: {
        up: labels.filter((label) => label === 0).length,
        flat: labels.filter((label) => label === 1).length,
        down: labels.filter((label) => label === 2).length,
      },
      sampleCount,
    };
    return metrics;
  }

  public buildTrendSequences(samples: ModelTrendSample[]): number[][][] {
    const trendSequences = samples.map((sample) => sample.trendSequence);
    return trendSequences;
  }

  public buildClobSequences(samples: ModelClobSample[]): number[][][] {
    const clobSequences = samples.map((sample) => sample.clobSequence);
    return clobSequences;
  }
}
