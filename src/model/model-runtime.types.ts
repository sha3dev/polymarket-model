import type {
  ModelClobArtifact,
  ModelClobSample,
  ModelDirectionClass,
  ModelDirectionProbability,
  ModelHeadArtifact,
  ModelHeadMetrics,
  ModelTensorflowArchitecture,
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

export type ModelHeadTrainPayload = {
  architecture: ModelTensorflowArchitecture;
  featureNames: string[];
  featurePath: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastTrainWindowStart: string | null;
  lastTrainWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  version: number;
};

export type ModelPythonHeadArtifact = {
  artifact: ModelHeadArtifact;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastTrainWindowStart: string | null;
  lastTrainWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  trainedAt: string;
};

export type ModelTrendPythonTrainResult = {
  artifact: ModelPythonHeadArtifact;
};

export type ModelClobPythonTrainResult = {
  artifact: ModelPythonHeadArtifact;
};

export type ModelPythonPredictionResult = {
  prediction: ModelHeadPrediction;
};

export type ModelHeadMetricsPair = {
  clobMetrics: ModelHeadMetrics;
  trendMetrics: ModelHeadMetrics;
};
