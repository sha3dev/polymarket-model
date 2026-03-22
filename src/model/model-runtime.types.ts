import type {
  ModelDirectionProbability,
  ModelPredictedDirection,
  ModelPredictionRecord,
  ModelPredictionSource,
  ModelRollingPredictionOutcome,
} from "./model.types.ts";

export type ModelHeadPrediction = {
  predictedDirection: ModelPredictedDirection;
  predictedProbability: ModelDirectionProbability;
  predictedReturn: number;
};

export type ModelTrainingSplit<TSample> = {
  trainingSamples: TSample[];
  validationSamples: TSample[];
  validationWindowEnd: string | null;
  validationWindowStart: string | null;
};

export type ModelTrainResult = {
  artifact: import("./model.types.ts").ModelArtifact | null;
  trainingSampleCount: number;
  validationSampleCount: number;
};

export type ModelPendingPrediction = {
  asset: import("./model.types.ts").ModelAsset;
  predictionId: string;
  source: ModelPredictionSource;
  targetEndAt: number;
};

export type ModelPredictionResolution = {
  actualDirection: "down" | "up";
  actualReturn: number;
  downValueAtTargetEnd: number;
  isCorrect: boolean;
  referenceValueAtTargetEnd: number;
  resolvedAt: string;
  upValueAtTargetEnd: number;
};

export type ModelPredictionHistorySnapshot = {
  predictions: ModelPredictionRecord[];
  rollingPredictionOutcomes: ModelRollingPredictionOutcome[];
};
