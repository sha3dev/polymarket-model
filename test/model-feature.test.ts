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
      eth_chainlink_price: 3_000 + snapshotIndex,
      eth_chainlink_event_ts: generatedAt,
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

test("ModelFeatureService builds trend samples by asset and clob samples by market", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();
  const snapshots = BUILD_SNAPSHOTS();
  const trendSamples = modelFeatureService.buildTrendTrainingSamples(snapshots);
  const clobSamples = modelFeatureService.buildClobTrainingSamples(snapshots);
  const firstTrendSample = trendSamples[0];
  const firstClobSample = clobSamples[0];

  assert.notEqual(firstTrendSample, undefined);
  assert.notEqual(firstClobSample, undefined);
  assert.equal(firstTrendSample?.trendKey, "btc");
  assert.equal(firstClobSample?.modelKey, "btc_5m");
  assert.equal(firstTrendSample?.trendSequence[0]?.length, modelFeatureService.buildFeatureNames().trendFeatures.length);
  assert.equal(firstClobSample?.clobSequence[0]?.length, modelFeatureService.buildFeatureNames().clobFeatures.length);
  assert.ok(Math.abs((firstClobSample?.clobDirectionTarget || 0) - 0.04) < 1e-9);
  assert.ok(Math.abs((firstClobSample?.clobTarget || 0) - Math.log(0.56 / 0.44)) < 1e-9);
});

test("ModelFeatureService keeps trend samples when no active market exists and drops stale clob horizons", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();
  const snapshots = BUILD_SNAPSHOTS((snapshot, snapshotIndex) => {
    let updatedSnapshot = snapshot;

    if (snapshotIndex < 220) {
      updatedSnapshot = {
        ...updatedSnapshot,
        btc_5m_slug: null,
        btc_5m_market_start: null,
        btc_5m_market_end: null,
        btc_5m_price_to_beat: null,
      };
    }

    if (snapshotIndex === 239) {
      updatedSnapshot = {
        ...updatedSnapshot,
        btc_5m_up_event_ts: snapshot.generated_at - 20_000,
      };
    }

    return updatedSnapshot;
  });
  const trendSamples = modelFeatureService.buildTrendTrainingSamples(snapshots);
  const clobSamples = modelFeatureService.buildClobTrainingSamples(snapshots);

  assert.equal(trendSamples.length > 0, true);
  assert.equal(clobSamples.length, 0);
});

test("ModelFeatureService exposes explicit shock-source mapping", () => {
  const modelFeatureService = BUILD_MODEL_FEATURE_SERVICE();

  assert.equal(modelFeatureService.readShockSourceAsset("btc_shock"), "btc");
  assert.equal(modelFeatureService.readShockSourceAsset("eth_shock"), "eth");
});

test("ModelSignalCacheService exposes explicit leader-return weights", () => {
  const modelSignalCacheService = new ModelSignalCacheService({
    supportedAssets: ["btc", "eth", "sol", "xrp"],
  });

  assert.deepEqual(modelSignalCacheService.readLeaderWeightProfile("btc"), { btc: 0, eth: 0.2, sol: 0.05, xrp: 0.05 });
  assert.deepEqual(modelSignalCacheService.readLeaderWeightProfile("eth"), { btc: 0.6, eth: 0, sol: 0.1, xrp: 0.1 });
  assert.deepEqual(modelSignalCacheService.readLeaderWeightProfile("sol"), { btc: 0.6, eth: 0.3, sol: 0, xrp: 0.1 });
  assert.deepEqual(modelSignalCacheService.readLeaderWeightProfile("xrp"), { btc: 0.6, eth: 0.25, sol: 0.15, xrp: 0 });
});
