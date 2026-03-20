import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ModelPreprocessingService } from "../src/model/model-preprocessing.service.ts";

test("ModelPreprocessingService builds medians scales labels and probabilities deterministically", () => {
  const modelPreprocessingService = ModelPreprocessingService.createDefault();
  const sequences = [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [5, 6],
      [7, 8],
    ],
  ];
  const featureMedians = modelPreprocessingService.buildFeatureMedians(sequences);
  const featureScales = modelPreprocessingService.buildFeatureScales(sequences, featureMedians);
  const scaledSequences = modelPreprocessingService.scaleSequences(sequences, featureMedians, featureScales);
  const labeling = modelPreprocessingService.buildDirectionLabeling([0.02, 0, -0.03], 0.001);
  const probabilities = modelPreprocessingService.buildProbabilities([2, 1, 0]);

  assert.deepEqual(featureMedians, [4, 5]);
  assert.equal(featureScales.length, 2);
  assert.equal(scaledSequences.length, 2);
  assert.deepEqual(labeling.labels, [0, 1, 2]);
  assert.equal(labeling.sampleWeights.length, 3);
  assert.equal(probabilities.up > probabilities.flat, true);
  assert.equal(modelPreprocessingService.decodeRegressionValue(0, "logit_probability"), 0.5);
});
