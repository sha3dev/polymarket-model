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
    maxAttempts: 2,
    requestTimeoutMs: 1_000,
    retryBaseDelayMs: 0,
  });

  await tensorflowApiClientService.ensureReachable();
  await tensorflowApiClientService.createModel({
    definition: {
      compileConfig: {
        loss: {},
        metrics: {},
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

test("TensorflowApiClientService retries retryable status codes and preserves auth", async () => {
  let requestCount = 0;
  const capturedAuthorizationValues: string[] = [];
  const tensorflowApiClientService = new TensorflowApiClientService({
    authToken: "retry-token",
    baseUrl: "http://127.0.0.1:3100",
    fetcher: async (_url, init) => {
      requestCount += 1;
      capturedAuthorizationValues.push(String((init?.headers as Record<string, string>).authorization || ""));

      if (requestCount < 3) {
        return new Response(JSON.stringify({ error: "busy" }), { status: 429 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    },
    maxAttempts: 3,
    requestTimeoutMs: 1_000,
    retryBaseDelayMs: 0,
  });

  const modelRecords = await tensorflowApiClientService.readModels();

  assert.deepEqual(modelRecords, []);
  assert.equal(requestCount, 3);
  assert.deepEqual(capturedAuthorizationValues, ["Bearer retry-token", "Bearer retry-token", "Bearer retry-token"]);
});

test("TensorflowApiClientService does not retry non-retryable status codes", async () => {
  let requestCount = 0;
  const tensorflowApiClientService = new TensorflowApiClientService({
    authToken: "",
    baseUrl: "http://127.0.0.1:3100",
    fetcher: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
    },
    maxAttempts: 4,
    requestTimeoutMs: 1_000,
    retryBaseDelayMs: 0,
  });

  await assert.rejects(async () => tensorflowApiClientService.readModels(), /status=404/);
  assert.equal(requestCount, 1);
});

test("TensorflowApiClientService retries thrown network errors until success", async () => {
  let requestCount = 0;
  const tensorflowApiClientService = new TensorflowApiClientService({
    authToken: "",
    baseUrl: "http://127.0.0.1:3100",
    fetcher: async () => {
      requestCount += 1;

      if (requestCount < 2) {
        throw new Error("network socket hang up");
      }

      return new Response(JSON.stringify([]), { status: 200 });
    },
    maxAttempts: 3,
    requestTimeoutMs: 1_000,
    retryBaseDelayMs: 0,
  });

  const modelRecords = await tensorflowApiClientService.readModels();

  assert.deepEqual(modelRecords, []);
  assert.equal(requestCount, 2);
});

test("TensorflowApiClientService throws enriched errors after exhausting attempts", async () => {
  let requestCount = 0;
  const tensorflowApiClientService = new TensorflowApiClientService({
    authToken: "",
    baseUrl: "http://127.0.0.1:3100",
    fetcher: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 500 });
    },
    maxAttempts: 3,
    requestTimeoutMs: 1_000,
    retryBaseDelayMs: 0,
  });

  await assert.rejects(
    async () => tensorflowApiClientService.readModels(),
    /tensorflow-api request exhausted method=GET path=\/api\/models attempts=3 status=500/,
  );
  assert.equal(requestCount, 3);
});
