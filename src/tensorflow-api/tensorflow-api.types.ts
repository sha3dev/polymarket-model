/**
 * @section imports:internals
 */

import type { ModelDirectionProbability, ModelHeadArtifact, ModelTensorflowArchitecture } from "../model/model.types.ts";

/**
 * @section types
 */

export type TensorflowApiCompileConfig = {
  loss: Record<string, unknown>;
  metrics: Record<string, unknown>;
  optimizer: Record<string, unknown>;
};

export type TensorflowApiModelDefinition = {
  compileConfig: TensorflowApiCompileConfig;
  format: "keras-functional";
  modelConfig: Record<string, unknown>;
};

export type TensorflowApiCreateModelRequest = {
  definition: TensorflowApiModelDefinition;
  metadata?: Record<string, unknown>;
  modelId: string;
};

export type TensorflowApiUpdateModelMetadataRequest = {
  metadata: Record<string, unknown>;
};

export type TensorflowApiModelRecord = {
  artifactPath?: string | null;
  createdAt: string;
  definitionPath?: string | null;
  lastPredictionAt: string | null;
  lastPredictionJobId: string | null;
  lastTrainingAt: string | null;
  lastTrainingJobId: string | null;
  metadata: Record<string, unknown> | null;
  modelId: string;
  predictionCount: number;
  status: "failed" | "pending" | "ready";
  trainingCount: number;
  updatedAt: string;
};

export type TensorflowApiJobRecord = {
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  jobId: string;
  jobType: "create_model" | "predict_model" | "train_model";
  modelId: string;
  requestPath: string;
  resultPath: string;
  startedAt: string | null;
  status: "failed" | "queued" | "running" | "succeeded";
};

export type TensorflowApiTrainingInput = {
  inputs: number[][][];
  sampleWeights?: number[] | Record<string, number[]>;
  targets: Record<string, number[][]>;
  validationInputs?: number[][][];
  validationSampleWeights?: number[] | Record<string, number[]>;
  validationTargets?: Record<string, number[][]>;
};

export type TensorflowApiTrainingJobRequest = {
  fitConfig: {
    batchSize?: number;
    epochs?: number;
    shuffle?: boolean;
  };
  modelMetadata?: Record<string, unknown>;
  trainingInput: TensorflowApiTrainingInput;
};

export type TensorflowApiTrainingJobResult = {
  history?: Record<string, unknown>;
  modelId: string;
  status: "succeeded";
  trainedAt: string;
};

export type TensorflowApiPredictionJobRequest = {
  predictionInput: {
    inputs: number[][][];
  };
};

export type TensorflowApiPredictionResponse = {
  modelId: string;
  outputs: Record<string, number[][]>;
};

export type TensorflowApiHeadMetadata = {
  architecture: ModelTensorflowArchitecture;
  classWeights: [number, number];
  featureMedians: number[];
  featureNames: string[];
  featureScales: number[];
  lastValidationWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  logicalKey: string;
  logicalModelType: "crypto";
  metrics: ModelHeadArtifact["metrics"];
  trainedAt: string;
  trainingSampleCount: number;
  validationSampleCount: number;
};

export type TensorflowApiDecodedPrediction = {
  predictedReturn: number;
  probabilities: ModelDirectionProbability;
};
