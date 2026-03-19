import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as tf from "@tensorflow/tfjs-node";
import type { ModelFeatureInput, ModelFeatureNames, ModelSequenceSample } from "../src/model/model.types.ts";
import type { ModelLoadedArtifact } from "../src/model/model-runtime.types.ts";
import { TensorflowModelService } from "../src/model/tensorflow-model.service.ts";

const BUILD_FEATURE_NAMES = (): ModelFeatureNames => {
  const modelFeatureNames: ModelFeatureNames = {
    trendFeatures: Array.from({ length: 48 }, (_, index) => `trend-${index}`),
    clobFeatures: Array.from({ length: 48 }, (_, index) => `clob-${index}`),
  };
  return modelFeatureNames;
};

const BUILD_SEQUENCE_SAMPLE = (dayOffset: number): ModelSequenceSample => {
  const decisionTime = Date.parse("2025-01-01T00:00:00.000Z") + dayOffset * 24 * 60 * 60 * 1_000;
  const upMidPrice = 0.52 + dayOffset * 0.005;
  const modelSequenceSample: ModelSequenceSample = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    decisionTime,
    latestSnapshotAt: decisionTime,
    activeMarket: {
      slug: "btc-up-5m",
      marketStart: "2025-01-01T00:00:00.000Z",
      marketEnd: "2025-01-01T00:05:00.000Z",
      priceToBeat: 100_000,
      upTokenId: "1",
      downTokenId: "2",
    },
    trendSequence: Array.from({ length: 128 }, () => Array.from({ length: 48 }, () => 0.01)),
    clobSequence: Array.from({ length: 96 }, () => Array.from({ length: 48 }, () => 0.02)),
    currentUpMid: upMidPrice,
    currentUpBid: upMidPrice - 0.01,
    currentUpAsk: upMidPrice + 0.01,
    currentDownMid: 1 - upMidPrice,
    currentDownBid: 1 - upMidPrice - 0.01,
    currentDownAsk: 1 - upMidPrice + 0.01,
    currentChainlinkPrice: 100_000 + dayOffset * 10,
    currentExchangePrice: 100_005 + dayOffset * 10,
    realizedVolatility30s: 0.02,
    isChainlinkFresh: true,
    isOrderBookFresh: true,
    upTokenId: "1",
    downTokenId: "2",
    upBidLevels: [{ price: upMidPrice - 0.01, size: 100 }],
    upAskLevels: [{ price: upMidPrice + 0.01, size: 100 }],
    downBidLevels: [{ price: 1 - upMidPrice - 0.01, size: 100 }],
    downAskLevels: [{ price: 1 - upMidPrice + 0.01, size: 100 }],
    trendTarget: 0.001 * (dayOffset + 1),
    clobTarget: Math.log((upMidPrice + 0.01) / (1 - (upMidPrice + 0.01))),
    clobDirectionTarget: 0.01,
  };
  return modelSequenceSample;
};

const BUILD_PREDICTION_INPUT = (): ModelFeatureInput => {
  const sample = BUILD_SEQUENCE_SAMPLE(0);
  const modelFeatureInput: ModelFeatureInput = {
    ...sample,
  };
  return modelFeatureInput;
};

test("TensorflowModelService tracks train and validation windows separately", async () => {
  const tensorflowModelService = new TensorflowModelService({
    batchSize: 2,
    classificationWeight: 0.5,
    earlyStoppingPatience: 1,
    epochs: 1,
    featureNames: BUILD_FEATURE_NAMES(),
    learningRate: 0.01,
    minSampleCount: 1,
    predictionHorizonMs: 30_000,
    trainWindowDays: 4,
    validationWindowDays: 1,
    embargoMs: 0,
  });
  const samples = [0, 1, 2, 3, 4].map((dayOffset) => BUILD_SEQUENCE_SAMPLE(dayOffset));
  const trainResult = await tensorflowModelService.train("btc", "5m", samples, 0);

  assert.notEqual(trainResult.artifact, null);
  assert.equal(trainResult.artifact?.trainingSampleCount, trainResult.trainingSampleCount);
  assert.equal(trainResult.artifact?.validationSampleCount, trainResult.validationSampleCount);
  assert.equal(trainResult.artifact?.trendModel.targetEncoding, "identity");
  assert.equal(trainResult.artifact?.clobModel.targetEncoding, "logit_probability");

  if (trainResult.artifact !== null) {
    tensorflowModelService.disposeArtifact({
      ...trainResult.artifact,
      trendModel: { metadata: trainResult.artifact.trendModel, model: trainResult.artifact.trendModel.model },
      clobModel: { metadata: trainResult.artifact.clobModel, model: trainResult.artifact.clobModel.model },
    } as unknown as ModelLoadedArtifact);
  }
});

test("TensorflowModelService decodes clob logits to probabilities on predict", () => {
  const tensorflowModelService = new TensorflowModelService({
    batchSize: 2,
    classificationWeight: 0.5,
    earlyStoppingPatience: 1,
    epochs: 1,
    featureNames: BUILD_FEATURE_NAMES(),
    learningRate: 0.01,
    minSampleCount: 1,
    predictionHorizonMs: 30_000,
    trainWindowDays: 4,
    validationWindowDays: 1,
    embargoMs: 0,
  });
  const fakeModel = {
    predict(): tf.Tensor[] {
      return [tf.tensor2d([[0]]), tf.tensor2d([[0.1, 0.2, 0.3]])];
    },
    dispose(): void {},
  };
  const artifact = {
    version: 1,
    trainedAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 4,
    validationSampleCount: 1,
    lastTrainWindowStart: "2025-01-01T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-04T00:00:00.000Z",
    lastValidationWindowStart: "2025-01-04T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-05T00:00:00.000Z",
    metrics: {
      trendRegressionMae: 0,
      trendRegressionRmse: 0,
      trendRegressionHuber: 0,
      trendDirectionMacroF1: 0,
      trendDirectionSupport: { up: 0, flat: 0, down: 0 },
      clobRegressionMae: 0,
      clobRegressionRmse: 0,
      clobRegressionHuber: 0,
      clobDirectionMacroF1: 0,
      clobDirectionSupport: { up: 0, flat: 0, down: 0 },
      sampleCount: 0,
    },
    trendModel: {
      metadata: {
        modelPath: "trend",
        featureNames: BUILD_FEATURE_NAMES().trendFeatures,
        featureMedians: Array.from({ length: 48 }, () => 0),
        featureScales: Array.from({ length: 48 }, () => 1),
        classWeights: [1, 1, 1] as [number, number, number],
        directionThreshold: 0.01,
        architecture: {
          family: "tcn" as const,
          blockCount: 6,
          channelCount: 32,
          dilations: [1, 2, 4, 8, 16, 32],
          dropout: 0.1,
          featureCount: 48,
          sequenceLength: 128,
        },
        targetEncoding: "identity" as const,
      },
      model: fakeModel as never,
    },
    clobModel: {
      metadata: {
        modelPath: "clob",
        featureNames: BUILD_FEATURE_NAMES().clobFeatures,
        featureMedians: Array.from({ length: 48 }, () => 0),
        featureScales: Array.from({ length: 48 }, () => 1),
        classWeights: [1, 1, 1] as [number, number, number],
        directionThreshold: 0.01,
        architecture: {
          family: "tcn" as const,
          blockCount: 5,
          channelCount: 32,
          dilations: [1, 2, 4, 8, 16],
          dropout: 0.1,
          featureCount: 48,
          sequenceLength: 96,
        },
        targetEncoding: "logit_probability" as const,
      },
      model: fakeModel as never,
    },
  } as ModelLoadedArtifact;

  const prediction = tensorflowModelService.predict(artifact, BUILD_PREDICTION_INPUT());

  assert.ok(Math.abs(prediction.clob.predictedValue - 0.5) < 1e-9);
});
