import * as assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { AppInfoService } from "../src/app-info/app-info.service.ts";
import { DashboardService } from "../src/dashboard/dashboard.service.ts";
import { HttpServerService } from "../src/http/http-server.service.ts";
import type { ModelPredictionPayload, ModelPredictionRecordPayload, ModelStatus, ModelStatusPayload } from "../src/model/model.types.ts";
import type { ModelRuntimeService } from "../src/model/model-runtime.service.ts";

const ASSET_STATUS: ModelStatus = {
  asset: "btc",
  currentBlockEndAt: "2025-01-01T00:05:00.000Z",
  currentBlockStartAt: "2025-01-01T00:00:00.000Z",
  isLiveReady: true,
  lastCollectorFromAt: "2025-01-01T00:05:00.000Z",
  lastError: null,
  lastLiveSnapshotAt: "2025-01-01T00:02:00.000Z",
  lastPredictionAt: "2025-01-01T00:02:00.000Z",
  lastPredictionSource: "manual",
  lastPredictionWasCorrect: null,
  lastTrainingAt: "2025-01-01T00:01:00.000Z",
  lastTrainingStatus: "ready",
  latestPrediction: null,
  modelFamily: "tcn",
  rollingCorrectCount: 7,
  rollingHitRate: 0.7,
  rollingPredictionCount: 10,
  state: "idle",
  trainingCount: 2,
};

const STATUS_PAYLOAD: ModelStatusPayload = {
  assets: [ASSET_STATUS],
  isProcessing: false,
  lastHistoricalBlockCompletedAt: "2025-01-01T00:05:00.000Z",
};

const PREDICTION_PAYLOAD: ModelPredictionPayload = {
  liveSnapshotCount: 16,
  prediction: {
    actualDirection: null,
    actualReturn: null,
    asset: "btc",
    contextEndAt: "2025-01-01T00:02:00.000Z",
    contextStartAt: "2025-01-01T00:01:30.000Z",
    downValueAtPrediction: 0.42,
    downValueAtTargetEnd: null,
    errorMessage: null,
    issuedAt: "2025-01-01T00:02:00.000Z",
    predictedDirection: "up",
    predictedProbabilityDown: 0.42,
    predictedProbabilityUp: 0.58,
    predictedReturn: 0.03,
    predictionId: "prediction-1",
    referenceValueAtPrediction: 100_000,
    referenceValueAtTargetEnd: null,
    resolvedAt: null,
    source: "manual",
    status: "pending",
    targetEndAt: "2025-01-01T00:02:30.000Z",
    targetStartAt: "2025-01-01T00:02:00.000Z",
    upValueAtPrediction: 0.58,
    upValueAtTargetEnd: null,
    isCorrect: null,
  },
};

const PREDICTION_RECORD_PAYLOAD: ModelPredictionRecordPayload = {
  predictions: [PREDICTION_PAYLOAD.prediction],
};

test("HttpServerService serves crypto asset, prediction, and dashboard endpoints", async () => {
  const fakeRuntime = {
    getStatusPayload(): ModelStatusPayload {
      return STATUS_PAYLOAD;
    },
    getAssetStatus(): ModelStatus {
      return ASSET_STATUS;
    },
    getPredictionRecords(): ModelPredictionRecordPayload {
      return PREDICTION_RECORD_PAYLOAD;
    },
    async predict(): Promise<ModelPredictionPayload> {
      return PREDICTION_PAYLOAD;
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
  const assetsResponse = await fetch(`http://127.0.0.1:${address.port}/assets`);
  const assetResponse = await fetch(`http://127.0.0.1:${address.port}/assets/btc`);
  const predictionsResponse = await fetch(`http://127.0.0.1:${address.port}/predictions`);
  const predictionResponse = await fetch(`http://127.0.0.1:${address.port}/predict`, {
    body: JSON.stringify({ asset: "btc" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  assert.equal(rootResponse.status, 200);
  assert.deepEqual(await rootResponse.json(), { ok: true, serviceName: "test-service" });
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboardResponse.headers.get("content-type"), "text/html; charset=utf-8");
  const dashboardHtml = await dashboardResponse.text();
  assert.equal(dashboardHtml.includes("Recent Predictions"), true);
  assert.equal(dashboardHtml.includes("Predict"), true);
  assert.equal(dashboardHtml.includes('prediction.predictedDirection === "flat" && prediction.status === "resolved"'), true);
  assert.equal(dashboardHtml.includes('prediction.isCorrect === false && prediction.predictedDirection !== "flat"'), true);
  assert.equal(assetsResponse.status, 200);
  assert.deepEqual(await assetsResponse.json(), STATUS_PAYLOAD);
  assert.equal(assetResponse.status, 200);
  assert.deepEqual(await assetResponse.json(), ASSET_STATUS);
  assert.equal(predictionsResponse.status, 200);
  assert.deepEqual(await predictionsResponse.json(), PREDICTION_RECORD_PAYLOAD);
  assert.equal(predictionResponse.status, 200);
  assert.deepEqual(await predictionResponse.json(), PREDICTION_PAYLOAD);

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
