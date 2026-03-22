import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { FlatSnapshot } from "../src/model/model.types.ts";
import { ModelContextService } from "../src/model/model-context.service.ts";
import { ModelFeatureService } from "../src/model/model-feature.service.ts";
import { ModelSignalCacheService } from "../src/model/model-signal-cache.service.ts";

const BUILD_ORDER_BOOK_JSON = (midPrice: number): string => {
  const bookJson = JSON.stringify({
    asks: [{ price: Number((midPrice + 0.01).toFixed(2)), size: 100 }],
    bids: [{ price: Number((midPrice - 0.01).toFixed(2)), size: 100 }],
    token_id: "token-1",
    tick_size: 0.01,
    min_order_size: 1,
    neg_risk: false,
  });
  return bookJson;
};

const BUILD_SNAPSHOTS = (): FlatSnapshot[] => {
  const snapshotCount = 610;
  const baseTimestamp = Date.parse("2025-01-01T00:00:00.000Z");
  const snapshots = Array.from({ length: snapshotCount }, (_unusedValue, snapshotIndex) => {
    const generatedAt = baseTimestamp + snapshotIndex * 500;
    const btcMidPrice = 100_000 + snapshotIndex * 2;
    const ethMidPrice = 3_000 + snapshotIndex;
    const snapshot: FlatSnapshot = {
      generated_at: generatedAt,
      btc_chainlink_event_ts: generatedAt,
      btc_chainlink_price: btcMidPrice,
      btc_binance_order_book_json: BUILD_ORDER_BOOK_JSON(btcMidPrice),
      btc_coinbase_order_book_json: BUILD_ORDER_BOOK_JSON(btcMidPrice + 1),
      btc_kraken_order_book_json: BUILD_ORDER_BOOK_JSON(btcMidPrice + 2),
      btc_okx_order_book_json: BUILD_ORDER_BOOK_JSON(btcMidPrice + 3),
      eth_chainlink_event_ts: generatedAt,
      eth_chainlink_price: ethMidPrice,
      eth_binance_order_book_json: BUILD_ORDER_BOOK_JSON(ethMidPrice),
      eth_coinbase_order_book_json: BUILD_ORDER_BOOK_JSON(ethMidPrice + 1),
      eth_kraken_order_book_json: BUILD_ORDER_BOOK_JSON(ethMidPrice + 2),
      eth_okx_order_book_json: BUILD_ORDER_BOOK_JSON(ethMidPrice + 3),
    };
    return snapshot;
  });
  return snapshots;
};

const BUILD_MODEL_FEATURE_SERVICE = (): ModelFeatureService => {
  const modelFeatureService = new ModelFeatureService({
    blockDurationMs: 300_000,
    chainlinkStaleMs: 60_000,
    contextService: new ModelContextService({
      chainlinkStaleMs: 60_000,
      polymarketStaleMs: 15_000,
      supportedAssets: ["btc", "eth"],
      supportedWindows: [],
    }),
    predictionContextMs: 30_000,
    predictionTargetMs: 30_000,
    signalCacheService: new ModelSignalCacheService({
      supportedAssets: ["btc", "eth"],
    }),
    supportedAssets: ["btc", "eth"],
  });
  return modelFeatureService;
};

test("ModelFeatureService builds crypto training samples and live prediction inputs", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();
  const snapshots = BUILD_SNAPSHOTS();
  const trainingSamples = modelFeatureService.buildTrainingSamples("btc", snapshots);
  const liveSnapshots = modelFeatureService.buildLivePredictionSnapshots(snapshots);
  const predictionInput = modelFeatureService.buildPredictionInput("btc", liveSnapshots);

  assert.equal(trainingSamples.length > 0, true);
  assert.equal(trainingSamples[0]?.asset, "btc");
  assert.equal(trainingSamples[0]?.cryptoSequence[0]?.length, modelFeatureService.buildFeatureNames().cryptoFeatures.length);
  assert.equal(predictionInput?.asset, "btc");
  assert.equal(predictionInput?.cryptoSequence.length, modelFeatureService.getSequenceLength());
});

test("ModelFeatureService exposes explicit shock-source mapping", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();

  assert.equal(modelFeatureService.readShockSourceAsset("btc_shock"), "btc");
  assert.equal(modelFeatureService.readShockSourceAsset("eth_shock"), "eth");
});
