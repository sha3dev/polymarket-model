import type {
  ModelClobArtifact,
  ModelClobSample,
  ModelDirectionClass,
  ModelDirectionProbability,
  ModelHeadMetrics,
  ModelTrendArtifact,
  ModelTrendSample,
} from "./model.types.ts";

export type ModelHeadPrediction = {
  predictedValue: number;
  probabilities: ModelDirectionProbability;
};

export type ModelLabelingResult = {
  classWeights: [number, number, number];
  labels: ModelDirectionClass[];
  threshold: number;
};

export type ModelTrendWalkForwardFold = {
  trainingSamples: ModelTrendSample[];
  validationSamples: ModelTrendSample[];
  validationWindowEnd: string | null;
  validationWindowStart: string | null;
};

export type ModelClobWalkForwardFold = {
  trainingSamples: ModelClobSample[];
  validationSamples: ModelClobSample[];
  validationWindowEnd: string | null;
  validationWindowStart: string | null;
};

export type ModelTrendTrainResult = {
  artifact: ModelTrendArtifact | null;
  trainingSampleCount: number;
  validationSampleCount: number;
};

export type ModelClobTrainResult = {
  artifact: ModelClobArtifact | null;
  trainingSampleCount: number;
  validationSampleCount: number;
};

export type ModelHeadMetricsPair = {
  clobMetrics: ModelHeadMetrics;
  trendMetrics: ModelHeadMetrics;
};
