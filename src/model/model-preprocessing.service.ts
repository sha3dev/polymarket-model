/**
 * @section imports:internals
 */

import type { ModelCryptoSample, ModelDirectionProbability, ModelHeadMetrics } from "./model.types.ts";

/**
 * @section consts
 */

const HUBER_DELTA = 0.01;
const MIN_CLASS_WEIGHT = 0.25;

/**
 * @section types
 */

type ModelSampleWeightPayload = {
  classWeights: [number, number];
  labels: Array<0 | 1>;
  sampleWeights: number[];
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

  private buildDirectionLabel(target: number): 0 | 1 {
    const directionLabel: 0 | 1 = target > 0 ? 1 : 0;
    return directionLabel;
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

  public buildDirectionLabeling(targets: number[]): ModelSampleWeightPayload {
    const labels = targets.map((target) => this.buildDirectionLabel(target));
    const support: [number, number] = [labels.filter((label) => label === 0).length, labels.filter((label) => label === 1).length];
    const maximumSupport = Math.max(...support, 1);
    const classWeights = support.map((count) => Math.max(MIN_CLASS_WEIGHT, maximumSupport / Math.max(count, 1))) as [number, number];
    const sampleWeights = labels.map((label) => classWeights[label] || 1);
    const sampleWeightPayload: ModelSampleWeightPayload = {
      classWeights,
      labels,
      sampleWeights,
    };
    return sampleWeightPayload;
  }

  public buildOneHotTargets(labels: Array<0 | 1>): number[][] {
    const oneHotTargets = labels.map((label) => [label === 0 ? 1 : 0, label === 1 ? 1 : 0]);
    return oneHotTargets;
  }

  public buildRegressionTargets(targets: number[]): number[][] {
    const regressionTargets = targets.map((target) => [target]);
    return regressionTargets;
  }

  public buildProbabilities(logits: number[]): ModelDirectionProbability {
    const maximumLogit = Math.max(...logits);
    const exponentials = logits.map((logit) => Math.exp(logit - maximumLogit));
    const denominator = exponentials.reduce((sum, value) => sum + value, 0);
    const probabilities: ModelDirectionProbability =
      denominator > 0
        ? {
            down: (exponentials[0] || 0) / denominator,
            up: (exponentials[1] || 0) / denominator,
          }
        : { down: 0, up: 0 };
    return probabilities;
  }

  public buildHeadMetrics(
    predictions: Array<{ predictedReturn: number; probabilities: ModelDirectionProbability }>,
    targets: number[],
    labels: Array<0 | 1>,
  ): ModelHeadMetrics {
    const errors = predictions.map((prediction, predictionIndex) => prediction.predictedReturn - (targets[predictionIndex] || 0));
    const predictedLabels = predictions.map((prediction) => (prediction.probabilities.up >= prediction.probabilities.down ? 1 : 0));
    const correctCount = labels.filter((label, predictionIndex) => label === predictedLabels[predictionIndex]).length;
    const sampleCount = targets.length;
    const metrics: ModelHeadMetrics = {
      directionAccuracy: sampleCount === 0 ? null : correctCount / sampleCount,
      directionSupport: {
        down: labels.filter((label) => label === 0).length,
        up: labels.filter((label) => label === 1).length,
      },
      regressionHuber:
        sampleCount === 0
          ? null
          : errors.reduce((sum, error) => {
              const absoluteError = Math.abs(error);
              return sum + (absoluteError <= HUBER_DELTA ? 0.5 * absoluteError * absoluteError : HUBER_DELTA * (absoluteError - 0.5 * HUBER_DELTA));
            }, 0) / sampleCount,
      regressionMae: sampleCount === 0 ? null : errors.reduce((sum, error) => sum + Math.abs(error), 0) / sampleCount,
      regressionRmse: sampleCount === 0 ? null : Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / sampleCount),
      sampleCount,
    };
    return metrics;
  }

  public buildCryptoSequences(samples: ModelCryptoSample[]): number[][][] {
    const cryptoSequences = samples.map((sample) => sample.cryptoSequence);
    return cryptoSequences;
  }
}
