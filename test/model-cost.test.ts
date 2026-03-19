import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelPredictionInput } from "../src/model/model.types.ts";
import { ModelCostService } from "../src/model/model-cost.service.ts";

const BUILD_MODEL_PREDICTION_INPUT = (): ModelPredictionInput => {
  const predictionInput: ModelPredictionInput = {
    trendInput: {
      trendKey: "btc",
      asset: "btc",
      decisionTime: Date.parse("2025-01-01T00:01:00.000Z"),
      latestSnapshotAt: Date.parse("2025-01-01T00:01:00.000Z"),
      trendSequence: Array.from({ length: 180 }, () => Array.from({ length: 39 }, () => 0)),
      currentChainlinkPrice: 100_100,
      currentExchangePrice: 100_110,
      realizedVolatility30s: 0.02,
      isChainlinkFresh: true,
    },
    clobInput: {
      modelKey: "btc_5m",
      asset: "btc",
      window: "5m",
      decisionTime: Date.parse("2025-01-01T00:01:00.000Z"),
      latestSnapshotAt: Date.parse("2025-01-01T00:01:00.000Z"),
      activeMarket: {
        slug: "btc-up-5m",
        marketStart: "2025-01-01T00:00:00.000Z",
        marketEnd: "2025-01-01T00:05:00.000Z",
        priceToBeat: 100_000,
        upTokenId: "1",
        downTokenId: "2",
      },
      clobSequence: Array.from({ length: 96 }, () => Array.from({ length: 48 }, () => 0)),
      currentUpMid: 0.52,
      currentUpBid: 0.51,
      currentUpAsk: 0.53,
      currentDownMid: 0.48,
      currentDownBid: 0.47,
      currentDownAsk: 0.49,
      currentChainlinkPrice: 100_100,
      currentExchangePrice: 100_110,
      realizedVolatility30s: 0.02,
      isChainlinkFresh: true,
      isOrderBookFresh: true,
      upTokenId: "1",
      downTokenId: "2",
      upBidLevels: [{ price: 0.51, size: 100 }],
      upAskLevels: [{ price: 0.53, size: 100 }],
      downBidLevels: [{ price: 0.47, size: 100 }],
      downAskLevels: [{ price: 0.49, size: 100 }],
    },
  };
  return predictionInput;
};

test("ModelCostService applies the exponent-2 fee curve", async () => {
  const modelCostService = new ModelCostService({
    clobBaseUrl: "https://clob.polymarket.com",
    executionSize: 25,
    isClobOnlyFallbackEnabled: true,
    feeCacheTtlMs: 60_000,
    fetcher: async () => new Response(JSON.stringify({ base_fee: 25 }), { status: 200 }),
    fusionAlpha0: 0.2,
    fusionAlpha1: 0.6,
    maxSpread: 0.1,
    spreadBufferKappa: 0.75,
    vetoDownThreshold: 0.7,
  });
  const predictionInput = BUILD_MODEL_PREDICTION_INPUT();
  const fusionPayload = await modelCostService.buildFusionPayload(
    predictionInput,
    {
      predictedReturn: 0.03,
      probabilities: { up: 0.6, flat: 0.2, down: 0.2 },
    },
    {
      predictedUpMid: 0.57,
      probabilities: { up: 0.62, flat: 0.2, down: 0.18 },
    },
  );
  const expectedFee = 25 * 0.53 * 0.0025 * (0.53 * 0.47) ** 2;

  assert.ok(Math.abs((fusionPayload.estimatedFeeUp || 0) - expectedFee) < 1e-12);
});

test("ModelCostService selects the down side when down edge dominates", async () => {
  const modelCostService = new ModelCostService({
    clobBaseUrl: "https://clob.polymarket.com",
    executionSize: 25,
    isClobOnlyFallbackEnabled: true,
    feeCacheTtlMs: 60_000,
    fetcher: async () => new Response(JSON.stringify({ base_fee: 25 }), { status: 200 }),
    fusionAlpha0: 0.2,
    fusionAlpha1: 0.6,
    maxSpread: 0.1,
    spreadBufferKappa: 0.75,
    vetoDownThreshold: 0.7,
  });

  const fusionPayload = await modelCostService.buildFusionPayload(
    BUILD_MODEL_PREDICTION_INPUT(),
    {
      predictedReturn: -0.03,
      probabilities: { up: 0.2, flat: 0.2, down: 0.6 },
    },
    {
      predictedUpMid: 0.4,
      probabilities: { up: 0.2, flat: 0.2, down: 0.6 },
    },
  );

  assert.equal(fusionPayload.suggestedSide, "down");
  assert.equal(fusionPayload.shouldTrade, true);
  assert.equal(fusionPayload.scoreDown !== null && fusionPayload.scoreDown > 0, true);
});
