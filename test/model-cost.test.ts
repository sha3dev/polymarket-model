import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelFeatureInput } from "../src/model/model.types.ts";
import { ModelCostService } from "../src/model/model-cost.service.ts";

const BUILD_MODEL_FEATURE_INPUT = (): ModelFeatureInput => {
  const modelFeatureInput: ModelFeatureInput = {
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
    trendSequence: Array.from({ length: 128 }, () => Array.from({ length: 48 }, () => 0)),
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
  };
  return modelFeatureInput;
};

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
    BUILD_MODEL_FEATURE_INPUT(),
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
  assert.equal(fusionPayload.scoreUp, null);
});

test("ModelCostService enters clob-only mode when price_to_beat is missing", async () => {
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
  const modelFeatureInput = BUILD_MODEL_FEATURE_INPUT();
  const activeMarket = modelFeatureInput.activeMarket;

  if (activeMarket === null) {
    throw new Error("expected active market in test fixture");
  }

  const fusionPayload = await modelCostService.buildFusionPayload(
    {
      ...modelFeatureInput,
      activeMarket: {
        ...activeMarket,
        priceToBeat: null,
      },
    },
    {
      predictedReturn: 0.01,
      probabilities: { up: 0.5, flat: 0.2, down: 0.3 },
    },
    {
      predictedUpMid: 0.57,
      probabilities: { up: 0.6, flat: 0.2, down: 0.2 },
    },
  );

  assert.equal(fusionPayload.mode, "clob_only");
  assert.equal(fusionPayload.reasons.includes("running clob-only fallback because price_to_beat is missing"), true);
});
