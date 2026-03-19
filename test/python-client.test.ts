import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelClobArtifact, ModelTrendArtifact } from "../src/model/model.types.ts";
import { PythonClientService } from "../src/python/python-client.service.ts";
import type { PythonRuntimeService } from "../src/python/python-runtime.service.ts";

const BUILD_TREND_ARTIFACT = (): ModelTrendArtifact => {
  const trendArtifact: ModelTrendArtifact = {
    trendKey: "btc",
    version: 1,
    trainedAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 10,
    validationSampleCount: 2,
    lastTrainWindowStart: "2024-12-31T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2025-01-01T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-02T00:00:00.000Z",
    model: {
      modelPath: "models/trend/btc/v000001",
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 1, 1],
      directionThreshold: 0.01,
      architecture: {
        family: "tcn",
        blockCount: 6,
        channelCount: 32,
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 39,
        sequenceLength: 180,
      },
      targetEncoding: "identity",
      metrics: {
        regressionMae: 0.01,
        regressionRmse: 0.02,
        regressionHuber: 0.01,
        directionMacroF1: 0.6,
        directionSupport: { up: 3, flat: 3, down: 4 },
        sampleCount: 10,
      },
    },
  };
  return trendArtifact;
};

const BUILD_CLOB_ARTIFACT = (): ModelClobArtifact => {
  const clobArtifact: ModelClobArtifact = {
    modelKey: "btc_5m",
    asset: "btc",
    window: "5m",
    version: 1,
    trainedAt: "2025-01-01T00:00:00.000Z",
    trainingSampleCount: 10,
    validationSampleCount: 2,
    lastTrainWindowStart: "2024-12-31T00:00:00.000Z",
    lastTrainWindowEnd: "2025-01-01T00:00:00.000Z",
    lastValidationWindowStart: "2025-01-01T00:00:00.000Z",
    lastValidationWindowEnd: "2025-01-02T00:00:00.000Z",
    model: {
      modelPath: "models/clob/btc_5m/v000001",
      featureNames: ["feature-1"],
      featureMedians: [0],
      featureScales: [1],
      classWeights: [1, 1, 1],
      directionThreshold: 0.02,
      architecture: {
        family: "tcn",
        blockCount: 5,
        channelCount: 32,
        dilations: [1, 2, 4],
        dropout: 0.1,
        featureCount: 48,
        sequenceLength: 96,
      },
      targetEncoding: "logit_probability",
      metrics: {
        regressionMae: 0.02,
        regressionRmse: 0.03,
        regressionHuber: 0.02,
        directionMacroF1: 0.58,
        directionSupport: { up: 4, flat: 2, down: 4 },
        sampleCount: 10,
      },
    },
  };
  return clobArtifact;
};

test("PythonClientService posts auth headers and payloads to the local child runtime", async () => {
  const capturedRequests: Array<{ body: string; headers: HeadersInit; url: string }> = [];
  const pythonClientService = new PythonClientService({
    fetcher: async (url, init) => {
      capturedRequests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers || {},
        url: String(url),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    pythonRuntimeService: {
      async ensureStarted() {
        return {
          authToken: "token-1",
          baseUrl: "http://127.0.0.1:4010",
          processId: 123,
        };
      },
      async stop(): Promise<void> {},
    } as unknown as PythonRuntimeService,
    stateDirectoryPath: "/tmp/model-state",
  });

  await pythonClientService.loadTrend(BUILD_TREND_ARTIFACT());
  await pythonClientService.loadClob(BUILD_CLOB_ARTIFACT());

  assert.equal(capturedRequests[0]?.url, "http://127.0.0.1:4010/models/trend/load");
  assert.equal(capturedRequests[1]?.url, "http://127.0.0.1:4010/models/clob/load");
  assert.deepEqual(
    capturedRequests.map((request) => (request.headers as Record<string, string>)["x-model-auth-token"]),
    ["token-1", "token-1"],
  );
  assert.equal(capturedRequests[0]?.body.includes("/tmp/model-state"), true);
});
