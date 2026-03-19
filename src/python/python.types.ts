import type {
  ModelClobArtifact,
  ModelClobInput,
  ModelClobSample,
  ModelHeadArtifact,
  ModelTensorflowArchitecture,
  ModelTrendArtifact,
  ModelTrendInput,
  ModelTrendSample,
} from "../model/model.types.ts";
import type { ModelClobPythonTrainResult, ModelPythonPredictionResult, ModelTrendPythonTrainResult } from "../model/model-runtime.types.ts";

export type PythonRuntimeHandle = {
  authToken: string;
  baseUrl: string;
  processId: number;
};

export type PythonRuntimeStatus = {
  isHealthy: boolean;
  loadedClobModelCount: number;
  loadedTrendModelCount: number;
};

export type PythonTrendTrainRequest = {
  architecture: ModelTensorflowArchitecture;
  artifactDirectoryPath: string;
  featureNames: string[];
  targetEncoding: "identity" | "logit_probability";
  trainingSamples: ModelTrendSample[];
  validationSamples: ModelTrendSample[];
  version: number;
};

export type PythonClobTrainRequest = {
  architecture: ModelTensorflowArchitecture;
  artifactDirectoryPath: string;
  featureNames: string[];
  targetEncoding: "identity" | "logit_probability";
  trainingSamples: ModelClobSample[];
  validationSamples: ModelClobSample[];
  version: number;
};

export type PythonTrendLoadRequest = {
  artifact: ModelTrendArtifact;
  stateDirectoryPath: string;
};

export type PythonClobLoadRequest = {
  artifact: ModelClobArtifact;
  stateDirectoryPath: string;
};

export type PythonTrendUnloadRequest = {
  trendKey: string;
};

export type PythonClobUnloadRequest = {
  modelKey: string;
};

export type PythonTrendPredictRequest = {
  artifact: ModelHeadArtifact;
  input: ModelTrendInput;
  stateDirectoryPath: string;
  trendKey: string;
};

export type PythonClobPredictRequest = {
  artifact: ModelHeadArtifact;
  input: ModelClobInput;
  modelKey: string;
  stateDirectoryPath: string;
};

export type PythonTrendTrainResponse = ModelTrendPythonTrainResult;

export type PythonClobTrainResponse = ModelClobPythonTrainResult;

export type PythonPredictResponse = ModelPythonPredictionResult;
