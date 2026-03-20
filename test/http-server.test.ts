import * as assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { AppInfoService } from "../src/app-info/app-info.service.ts";
import { DashboardService } from "../src/dashboard/dashboard.service.ts";
import { HttpServerService } from "../src/http/http-server.service.ts";
import type { ModelPredictionPayload, ModelStatus, ModelStatusPayload } from "../src/model/model.types.ts";
import type { ModelRuntimeService } from "../src/model/model-runtime.service.ts";

const MODEL_STATUS: ModelStatus = {
  modelKey: "btc_5m",
  asset: "btc",
  window: "5m",
  state: "ready",
  modelFamily: "tcn",
  version: 2,
  persistedVersion: 2,
  trendModelKey: "btc",
  trendVersion: 3,
  clobVersion: 2,
  trendSequenceLength: 180,
  clobSequenceLength: 96,
  trendFeatureCount: 39,
  clobFeatureCount: 48,
  headVersionSkew: true,
  featureCountTrend: 39,
  featureCountClob: 48,
  lastTrainingStartedAt: "2025-01-01T00:00:00.000Z",
  lastTrainingCompletedAt: "2025-01-01T00:01:00.000Z",
  lastValidationWindowStart: "2024-12-30T00:00:00.000Z",
  lastValidationWindowEnd: "2025-01-01T00:00:00.000Z",
  lastRestoredAt: "2025-01-01T00:00:00.000Z",
  trainingSampleCount: 48,
  validationSampleCount: 12,
  latestSnapshotAt: "2025-01-01T00:02:00.000Z",
  liveSnapshotCount: 16,
  activeMarket: {
    slug: "btc-up-5m",
    marketStart: "2025-01-01T00:00:00.000Z",
    marketEnd: "2025-01-01T00:05:00.000Z",
    priceToBeat: 100_000,
    upTokenId: "1",
    downTokenId: "2",
  },
  metrics: {
    trendRegressionMae: 0.02,
    trendRegressionRmse: 0.03,
    trendRegressionHuber: 0.01,
    trendDirectionMacroF1: 0.66,
    trendDirectionSupport: { up: 5, flat: 4, down: 3 },
    clobRegressionMae: 0.03,
    clobRegressionRmse: 0.04,
    clobRegressionHuber: 0.02,
    clobDirectionMacroF1: 0.61,
    clobDirectionSupport: { up: 6, flat: 3, down: 3 },
    sampleCount: 12,
  },
  lastError: null,
};

const MODEL_STATUS_PAYLOAD: ModelStatusPayload = {
  isTrainingCycleRunning: false,
  lastTrainingCycleAt: "2025-01-01T00:01:00.000Z",
  models: [MODEL_STATUS],
  liveSnapshotCount: 16,
  latestSnapshotAt: "2025-01-01T00:02:00.000Z",
};

const MODEL_PREDICTION_PAYLOAD: ModelPredictionPayload = {
  modelKey: "btc_5m",
  generatedAt: "2025-01-01T00:02:00.000Z",
  activeMarket: MODEL_STATUS.activeMarket,
  trend: {
    predictedReturn: 0.03,
    fairUpProbability: 0.58,
    probabilities: { up: 0.58, flat: 0.24, down: 0.18 },
    isChainlinkFresh: true,
  },
  clob: {
    currentUpMid: 0.53,
    predictedUpMid: 0.57,
    edge: 0.04,
    probabilities: { up: 0.62, flat: 0.2, down: 0.18 },
    isOrderBookFresh: true,
  },
  fusion: {
    scoreUp: 0.03,
    scoreDown: null,
    selectedScore: 0.03,
    shouldTrade: true,
    suggestedSide: "up",
    mode: "full",
    trendEdgeUp: 0.02,
    trendEdgeDown: null,
    clobEdgeUp: 0.04,
    clobEdgeDown: null,
    feeRateBpsUp: 25,
    feeRateBpsDown: null,
    estimatedFeeUp: 0.004,
    estimatedFeeDown: null,
    estimatedSlippageUp: 0.01,
    estimatedSlippageDown: null,
    spreadBufferUp: 0.015,
    spreadBufferDown: null,
    vetoes: [],
    reasons: ["positive executable edge"],
  },
  liveSnapshotCount: 16,
};

test("HttpServerService serves status and prediction endpoints", async () => {
  const fakeRuntime = {
    getStatusPayload(): ModelStatusPayload {
      return MODEL_STATUS_PAYLOAD;
    },
    getModelStatus(): ModelStatus {
      return MODEL_STATUS;
    },
    async predict(): Promise<ModelPredictionPayload> {
      return MODEL_PREDICTION_PAYLOAD;
    },
  } as unknown as ModelRuntimeService;
  const httpServerService = new HttpServerService({
    appInfoService: new AppInfoService("test-service"),
    dashboardService: DashboardService.createDefault(),
    modelRuntimeService: fakeRuntime,
  });
  const server = httpServerService.buildServer();

  server.listen(0);
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const rootResponse = await fetch(`http://127.0.0.1:${address.port}/`);
  const dashboardResponse = await fetch(`http://127.0.0.1:${address.port}/dashboard`);
  const modelsResponse = await fetch(`http://127.0.0.1:${address.port}/models`);
  const modelResponse = await fetch(`http://127.0.0.1:${address.port}/models/btc/5m`);
  const predictionResponse = await fetch(`http://127.0.0.1:${address.port}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ asset: "btc", window: "5m" }),
  });

  assert.equal(rootResponse.status, 200);
  assert.deepEqual(await rootResponse.json(), { ok: true, serviceName: "test-service" });
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboardResponse.headers.get("content-type"), "text/html; charset=utf-8");
  const dashboardHtml = await dashboardResponse.text();
  assert.equal(dashboardHtml.includes("<title>"), true);
  assert.equal(dashboardHtml.includes('id="asset"'), true);
  assert.equal(dashboardHtml.includes('id="window"'), true);
  assert.equal(dashboardHtml.includes("Predict"), true);
  assert.equal(modelsResponse.status, 200);
  assert.deepEqual(await modelsResponse.json(), MODEL_STATUS_PAYLOAD);
  assert.equal(modelResponse.status, 200);
  assert.deepEqual(await modelResponse.json(), MODEL_STATUS);
  assert.equal(predictionResponse.status, 200);
  assert.deepEqual(await predictionResponse.json(), MODEL_PREDICTION_PAYLOAD);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});
