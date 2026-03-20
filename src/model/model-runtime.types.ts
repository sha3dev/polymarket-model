import type {
  ModelClobArtifact,
  ModelClobSample,
  ModelDirectionClass,
  ModelDirectionProbability,
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

export type ModelTrainingSplit<TSample extends ModelClobSample | ModelTrendSample> = {
  trainingSamples: TSample[];
  validationSamples: TSample[];
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
