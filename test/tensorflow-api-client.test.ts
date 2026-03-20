import * as assert from "node:assert/strict";
import { test } from "node:test";

import { TensorflowApiClientService } from "../src/tensorflow-api/tensorflow-api-client.service.ts";

test("TensorflowApiClientService sends remote requests with optional bearer auth", async () => {
  const capturedRequests: Array<{ body: string; headers: HeadersInit; method: string; url: string }> = [];
  const tensorflowApiClientService = new TensorflowApiClientService({
    authToken: "token-1",
    baseUrl: "http://127.0.0.1:3100",
    fetcher: async (url, init) => {
      capturedRequests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers || {},
        method: String(init?.method || "GET"),
        url: String(url),
      });
      return new Response(
        JSON.stringify({ modelId: "demo-model", outputs: { classification: [[1, 0, 0]], regression: [[0.1]] }, status: "ready", trainingCount: 3 }),
        {
          status: 200,
        },
      );
    },
    requestTimeoutMs: 1_000,
  });

  await tensorflowApiClientService.ensureReachable();
  await tensorflowApiClientService.createModel({
    definition: {
      compileConfig: {
        loss: {},
        metrics: [],
        optimizer: {},
      },
      format: "keras-functional",
      modelConfig: {},
    },
    metadata: { logicalKey: "btc" },
    modelId: "demo-model",
  });
  await tensorflowApiClientService.updateModelMetadata("demo-model", { metadata: { trainedAt: "2025-01-01T00:00:00.000Z" } });
  await tensorflowApiClientService.predict("demo-model", { predictionInput: { inputs: [[[0]]] } });

  assert.equal(capturedRequests[0]?.url, "http://127.0.0.1:3100/");
  assert.equal(capturedRequests[1]?.method, "POST");
  assert.equal(capturedRequests[1]?.url, "http://127.0.0.1:3100/api/models");
  assert.equal(capturedRequests[2]?.method, "PATCH");
  assert.equal(capturedRequests[2]?.url, "http://127.0.0.1:3100/api/models/demo-model/metadata");
  assert.equal(capturedRequests[3]?.url, "http://127.0.0.1:3100/api/models/demo-model/prediction-jobs");
  assert.equal((capturedRequests[1]?.headers as Record<string, string>).authorization, "Bearer token-1");
});
