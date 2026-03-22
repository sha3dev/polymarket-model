import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCryptoSample, ModelFeatureNames } from "../src/model/model.types.ts";
import { ModelPreprocessingService } from "../src/model/model-preprocessing.service.ts";
import { ModelTrainingService } from "../src/model/model-training.service.ts";
import type { TensorflowApiModelDefinition, TensorflowApiModelRecord } from "../src/tensorflow-api/tensorflow-api.types.ts";

const FEATURE_NAMES: ModelFeatureNames = {
  cryptoFeatures: ["crypto-1"],
};

const BUILD_SAMPLE = (decisionTime: number, targetReturn: number): ModelCryptoSample => ({
  asset: "btc",
  cryptoSequence: Array.from({ length: 2 }, (_unusedValue, rowIndex) => [targetReturn + rowIndex]),
  currentChainlinkPrice: 100_000,
  currentExchangePrice: 100_010,
  decisionTime,
  isChainlinkFresh: true,
  latestSnapshotAt: decisionTime,
  realizedVolatility30s: 0.02,
  targetDirection: targetReturn > 0 ? "up" : "down",
  targetReturn,
});

test("ModelTrainingService creates remote models, queues binary-weighted training, and returns remote-backed artifacts", async () => {
  const createdModelIds: string[] = [];
  const queuedTrainingRequests: Array<Record<string, unknown>> = [];
  const updatedMetadataPayloads: Record<string, unknown>[] = [];
  let hasCreatedModel = false;
  const tensorflowApiClientService = {
    async createModel(request: { definition: TensorflowApiModelDefinition; modelId: string }): Promise<TensorflowApiModelRecord> {
      createdModelIds.push(request.modelId);
      hasCreatedModel = true;
      return {
        createdAt: "2025-01-01T00:00:00.000Z",
        lastPredictionAt: null,
        lastPredictionJobId: null,
        lastTrainingAt: null,
        lastTrainingJobId: null,
        metadata: null,
        modelId: request.modelId,
        predictionCount: 0,
        status: "pending",
        trainingCount: 0,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
    },
    async ensureReachable(): Promise<void> {},
    async predict(): Promise<{ modelId: string; outputs: Record<string, number[][]> }> {
      return {
        modelId: "polymarket_model_crypto_btc",
        outputs: {
          classification: [[0.2, 1.5]],
          regression: [[0.03]],
        },
      };
    },
    async queueTrainingJob(modelId: string, request: Record<string, unknown>): Promise<{ jobId: string }> {
      queuedTrainingRequests.push({ modelId, ...request });
      return { jobId: "job-1" };
    },
    async readJob(): Promise<{ errorMessage: null; modelId: string; status: "succeeded" }> {
      return { errorMessage: null, modelId: "polymarket_model_crypto_btc", status: "succeeded" };
    },
    async readJobResult(): Promise<{ modelId: string; status: "succeeded"; trainedAt: string }> {
      return { modelId: "polymarket_model_crypto_btc", status: "succeeded", trainedAt: "2025-01-01T00:10:00.000Z" };
    },
    async readModel(): Promise<TensorflowApiModelRecord> {
      if (!hasCreatedModel) {
        throw new Error("tensorflow-api request failed path=/api/models/polymarket_model_crypto_btc status=404 body=not found");
      }

      return {
        createdAt: "2025-01-01T00:00:00.000Z",
        lastPredictionAt: null,
        lastPredictionJobId: null,
        lastTrainingAt: null,
        lastTrainingJobId: null,
        metadata: null,
        modelId: "polymarket_model_crypto_btc",
        predictionCount: 0,
        status: "ready",
        trainingCount: 0,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
    },
    async readModels(): Promise<TensorflowApiModelRecord[]> {
      return [];
    },
    async updateModelMetadata(_modelId: string, request: { metadata: Record<string, unknown> }): Promise<TensorflowApiModelRecord> {
      updatedMetadataPayloads.push(request.metadata);
      return {
        createdAt: "2025-01-01T00:00:00.000Z",
        lastPredictionAt: null,
        lastPredictionJobId: null,
        lastTrainingAt: "2025-01-01T00:10:00.000Z",
        lastTrainingJobId: "job-1",
        metadata: request.metadata,
        modelId: "polymarket_model_crypto_btc",
        predictionCount: 0,
        status: "ready",
        trainingCount: 4,
        updatedAt: "2025-01-01T00:10:00.000Z",
      };
    },
  };
  const modelTrainingService = new ModelTrainingService({
    featureNames: FEATURE_NAMES,
    minSampleCount: 1,
    modelPreprocessingService: ModelPreprocessingService.createDefault(),
    tensorflowApiClientService: tensorflowApiClientService as never,
    tensorflowApiModelDefinitionService: {
      buildCreateModelRequest(modelId: string): { definition: TensorflowApiModelDefinition; modelId: string } {
        return {
          definition: {
            compileConfig: { loss: {}, metrics: {}, optimizer: {} },
            format: "keras-functional",
            modelConfig: {},
          },
          modelId,
        };
      },
    } as never,
    trainPollIntervalMs: 1,
    trainTimeoutMs: 1_000,
  });

  const trainResult = await modelTrainingService.trainAsset("btc", [
    BUILD_SAMPLE(10_000, 0.02),
    BUILD_SAMPLE(100_000, -0.01),
    BUILD_SAMPLE(180_000, 0.01),
    BUILD_SAMPLE(200_000, 0.03),
  ]);

  assert.deepEqual(createdModelIds, ["polymarket_model_crypto_btc"]);
  assert.equal(queuedTrainingRequests.length, 1);
  assert.equal((queuedTrainingRequests[0]?.trainingInput as Record<string, unknown>).sampleWeights !== undefined, true);
  assert.equal(updatedMetadataPayloads.length, 1);
  assert.equal(trainResult.artifact?.remoteModelId, "polymarket_model_crypto_btc");
  assert.equal(trainResult.artifact?.version, 4);
});
