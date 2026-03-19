import type { LayersModel } from "@tensorflow/tfjs-node";

import type {
  ModelArtifact,
  ModelDirectionClass,
  ModelDirectionProbability,
  ModelFeatureInput,
  ModelMetrics,
  ModelSequenceSample,
  ModelTensorflowArchitecture,
  ModelTensorflowHeadArtifact,
} from "./model.types.ts";

export type ModelLoadedHead = {
  metadata: ModelTensorflowHeadArtifact;
  model: LayersModel;
};

export type ModelLoadedArtifact = {
  version: number;
  trainedAt: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastTrainWindowStart: string | null;
  lastTrainWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  metrics: ModelMetrics;
  trendModel: ModelLoadedHead;
  clobModel: ModelLoadedHead;
};

export type ModelArtifactCandidateHead = {
  architecture: ModelTensorflowArchitecture;
  classWeights: [number, number, number];
  directionThreshold: number;
  featureMedians: number[];
  featureNames: string[];
  featureScales: number[];
  model: LayersModel;
  targetEncoding: "identity" | "logit_probability";
};

export type ModelArtifactCandidate = {
  version: number;
  trainedAt: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastTrainWindowStart: string | null;
  lastTrainWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  metrics: ModelMetrics;
  trendModel: ModelArtifactCandidateHead;
  clobModel: ModelArtifactCandidateHead;
};

export type ModelPersistenceResult = {
  artifact: ModelArtifact;
  loadedArtifact: ModelLoadedArtifact;
};

export type ModelHeadPrediction = {
  predictedValue: number;
  probabilities: ModelDirectionProbability;
};

export type ModelPredictionResult = {
  clob: ModelHeadPrediction;
  trend: ModelHeadPrediction;
};

export type ModelLabelingResult = {
  classWeights: [number, number, number];
  labels: ModelDirectionClass[];
  threshold: number;
};

export type ModelWalkForwardFold = {
  trainingSamples: ModelSequenceSample[];
  validationSamples: ModelSequenceSample[];
  validationWindowEnd: string | null;
  validationWindowStart: string | null;
};

export type ModelTrainResult = {
  artifact: ModelArtifactCandidate | null;
  trainingSampleCount: number;
  validationSampleCount: number;
};

export type ModelHeadTrainPayload = {
  featureInput: Pick<ModelFeatureInput, "clobSequence" | "trendSequence">;
  regressionTarget: number;
};
