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

const BUILD_SNAPSHOTS = (targetSnapshotMutator?: (snapshot: FlatSnapshot, snapshotIndex: number) => FlatSnapshot): FlatSnapshot[] => {
  const snapshotCount = 260;
  const baseTimestamp = Date.parse("2025-01-01T00:00:00.000Z");
  const snapshots = Array.from({ length: snapshotCount }, (_, snapshotIndex) => {
    const generatedAt = baseTimestamp + snapshotIndex * 500;
    const upMidPrice = snapshotIndex >= 239 ? 0.56 : 0.52;
    const downMidPrice = 1 - upMidPrice;
    const baseSnapshot: FlatSnapshot = {
      generated_at: generatedAt,
      btc_chainlink_price: 100_000 + snapshotIndex,
      btc_chainlink_event_ts: generatedAt,
      btc_5m_slug: "btc-up-5m",
      btc_5m_market_start: "2025-01-01T00:00:00.000Z",
      btc_5m_market_end: "2025-01-01T00:05:00.000Z",
      btc_5m_price_to_beat: 100_500,
      btc_5m_up_price: upMidPrice,
      btc_5m_up_event_ts: generatedAt,
      btc_5m_up_order_book_json: BUILD_ORDER_BOOK_JSON(upMidPrice),
      btc_5m_down_price: downMidPrice,
      btc_5m_down_event_ts: generatedAt,
      btc_5m_down_order_book_json: BUILD_ORDER_BOOK_JSON(downMidPrice),
    };
    const snapshot = targetSnapshotMutator === undefined ? baseSnapshot : targetSnapshotMutator(baseSnapshot, snapshotIndex);
    return snapshot;
  });
  return snapshots;
};

const BUILD_MODEL_FEATURE_SERVICE = (): ModelFeatureService => {
  const modelFeatureService = new ModelFeatureService({
    supportedAssets: ["btc", "eth"],
    supportedWindows: ["5m"],
    chainlinkStaleMs: 60_000,
    contextService: new ModelContextService({
      supportedAssets: ["btc", "eth"],
      supportedWindows: ["5m"],
      chainlinkStaleMs: 60_000,
      polymarketStaleMs: 15_000,
    }),
    decisionIntervalMs: 30_000,
    predictionHorizonMs: 30_000,
    signalCacheService: new ModelSignalCacheService({
      supportedAssets: ["btc", "eth"],
    }),
  });
  return modelFeatureService;
};

test("ModelFeatureService builds fresh chainlink and encoded clob targets", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();
  const trainingSamples = modelFeatureService.buildTrainingSamples(BUILD_SNAPSHOTS());
  const firstSample = trainingSamples[0];

  assert.notEqual(firstSample, undefined);
  assert.equal(firstSample?.trendTarget !== null, true);
  assert.ok(Math.abs((firstSample?.clobDirectionTarget || 0) - 0.04) < 1e-9);
  assert.ok(Math.abs((firstSample?.clobTarget || 0) - Math.log(0.56 / 0.44)) < 1e-9);
});

test("ModelFeatureService drops clob targets when the horizon book is stale", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();
  const trainingSamples = modelFeatureService.buildTrainingSamples(
    BUILD_SNAPSHOTS((snapshot, snapshotIndex) => {
      const updatedSnapshot =
        snapshotIndex === 239
          ? {
              ...snapshot,
              btc_5m_up_event_ts: snapshot.generated_at - 20_000,
            }
          : snapshot;
      return updatedSnapshot;
    }),
  );
  const firstSample = trainingSamples[0];

  assert.notEqual(firstSample, undefined);
  assert.equal(firstSample?.clobTarget, null);
  assert.equal(firstSample?.clobDirectionTarget, null);
  assert.equal(firstSample?.trendTarget !== null, true);
});
