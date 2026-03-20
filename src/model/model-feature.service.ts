/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  FlatSnapshot,
  ModelAsset,
  ModelClobInput,
  ModelClobSample,
  ModelFeatureNames,
  ModelKey,
  ModelPredictionInput,
  ModelSnapshotContext,
  ModelTrendInput,
  ModelTrendSample,
  ModelWindow,
} from "./model.types.ts";
import { ModelContextService } from "./model-context.service.ts";
import { ModelSignalCacheService } from "./model-signal-cache.service.ts";

/**
 * @section consts
 */

const SNAPSHOT_STEP_MS = 500;
const BTC_SHOCK_SOURCE_ASSET: ModelAsset = "btc";
const ETH_SHOCK_SOURCE_ASSET: ModelAsset = "eth";
const PROBABILITY_EPSILON = 1e-4;

const TREND_FEATURE_NAMES = [
  "cl_log_px",
  "cl_stale_s",
  "cl_ret_30s",
  "ex_cl_basis",
  "ex_cl_basis_chg_5s",
  "ex_logret_1s",
  "ex_logret_5s",
  "ex_logret_15s",
  "ex_logret_30s",
  "ex_mom_5s_mean",
  "ex_rv_10s",
  "ex_rv_30s",
  "ex_ret_accel",
  "ex_spread_med",
  "ex_spread_wmean",
  "ex_depth3_log",
  "ex_imb1_wmean",
  "ex_imb3_wmean",
  "ex_imb3_chg_5s",
  "ex_disp_log",
  "ex_disp_chg_5s",
  "ex_best_stale_s",
  "ex_mean_stale_s",
  "ex_valid_px_n",
  "ex_valid_book_n",
  "binance_premium",
  "coinbase_premium",
  "okx_premium",
  "kraken_premium",
  "leader_ret_5s",
  "leader_ret_15s",
  "leader_imb3",
  "breadth_ret_5s",
  "disp_ret_5s",
  "btc_shock",
  "eth_shock",
  "cl_valid_flag",
  "cl_update_recent_60s",
  "ex_valid_gate_flag",
] as const;

const CLOB_FEATURE_NAMES = [
  "up_mid",
  "up_spread",
  "up_imb1",
  "up_imb3",
  "up_depth3_log",
  "up_depth1_log",
  "up_stale_s",
  "up_mid_chg_5s",
  "up_spread_chg_5s",
  "up_imb3_chg_5s",
  "down_mid",
  "down_spread",
  "down_imb1",
  "down_imb3",
  "down_depth3_log",
  "down_depth1_log",
  "down_stale_s",
  "down_mid_chg_5s",
  "parity_gap",
  "spread_sum",
  "net_imb3",
  "mid_skew",
  "tick_size",
  "min_order_size",
  "neg_risk_flag",
  "book_hash_change",
  "t_to_end_norm",
  "t_from_start_norm",
  "ptb_missing",
  "moneyness_log_cl",
  "moneyness_log_ex",
  "ex_rv_30s",
  "fair_q_up",
  "mispricing_mid",
  "mispricing_ask",
  "mispricing_bid",
  "leader_ret_5s",
  "leader_ret_15s",
  "breadth_pm_parity",
  "breadth_pm_midup",
  "disp_pm_midup",
  "up_down_stale_max",
  "up_down_stale_diff",
  "spread_up_gt_10c",
  "spread_dn_gt_10c",
  "midpoint_vs_displayed_up",
  "midpoint_vs_displayed_dn",
  "pm_live_flag",
] as const;

const TREND_SEQUENCE_LENGTHS: Record<ModelAsset, number> = {
  btc: 180,
  eth: 180,
  sol: 180,
  xrp: 180,
};

const CLOB_SEQUENCE_LENGTHS: Record<ModelKey, number> = {
  btc_5m: 96,
  btc_15m: 128,
  eth_5m: 96,
  eth_15m: 128,
  sol_5m: 96,
  sol_15m: 128,
  xrp_5m: 96,
  xrp_15m: 128,
};

/**
 * @section types
 */

type ModelFeatureServiceOptions = {
  supportedAssets: ModelAsset[];
  supportedWindows: ModelWindow[];
  chainlinkStaleMs: number;
  contextService: ModelContextService;
  decisionIntervalMs: number;
  predictionHorizonMs: number;
  signalCacheService: ModelSignalCacheService;
};

/**
 * @section class
 */

export class ModelFeatureService {
  /**
   * @section private:attributes
   */

  private readonly supportedAssets: ModelAsset[];

  private readonly supportedWindows: ModelWindow[];

  private readonly chainlinkStaleMs: number;

  private readonly contextService: ModelContextService;

  private readonly decisionIntervalMs: number;

  private readonly predictionHorizonMs: number;

  private readonly signalCacheService: ModelSignalCacheService;

  /**
   * @section constructor
   */

  public constructor(options: ModelFeatureServiceOptions) {
    this.supportedAssets = options.supportedAssets;
    this.supportedWindows = options.supportedWindows;
    this.chainlinkStaleMs = options.chainlinkStaleMs;
    this.contextService = options.contextService;
    this.decisionIntervalMs = options.decisionIntervalMs;
    this.predictionHorizonMs = options.predictionHorizonMs;
    this.signalCacheService = options.signalCacheService;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelFeatureService {
    const contextService = ModelContextService.createDefault();
    const modelFeatureService = new ModelFeatureService({
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: config.MODEL_SUPPORTED_WINDOWS as ModelWindow[],
      chainlinkStaleMs: config.MODEL_CHAINLINK_STALE_MS,
      contextService,
      decisionIntervalMs: config.MODEL_DECISION_INTERVAL_MS,
      predictionHorizonMs: config.MODEL_PREDICTION_HORIZON_MS,
      signalCacheService: new ModelSignalCacheService({
        supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      }),
    });
    return modelFeatureService;
  }

  /**
   * @section private:methods
   */

  private buildModelKey(asset: ModelAsset, window: ModelWindow): ModelKey {
    const modelKey = `${asset}_${window}` as ModelKey;
    return modelKey;
  }

  private readContext(contexts: ModelSnapshotContext[], index: number): ModelSnapshotContext {
    const context = contexts[index];

    if (context === undefined) {
      throw new Error(`missing snapshot context at index ${index}`);
    }

    return context;
  }

  private findContextIndexAtOrBefore(contexts: ModelSnapshotContext[], targetTime: number, maxIndex: number): number {
    let lowIndex = 0;
    let highIndex = maxIndex;
    let matchedIndex = -1;

    while (lowIndex <= highIndex) {
      const middleIndex = Math.floor((lowIndex + highIndex) / 2);
      const middleContext = contexts[middleIndex];

      if (middleContext !== undefined && middleContext.generatedAt <= targetTime) {
        matchedIndex = middleIndex;
        lowIndex = middleIndex + 1;
      } else {
        highIndex = middleIndex - 1;
      }
    }

    return matchedIndex;
  }

  private findContextIndexAtOrAfter(contexts: ModelSnapshotContext[], targetTime: number): number {
    let lowIndex = 0;
    let highIndex = contexts.length - 1;
    let matchedIndex = -1;

    while (lowIndex <= highIndex) {
      const middleIndex = Math.floor((lowIndex + highIndex) / 2);
      const middleContext = contexts[middleIndex];

      if (middleContext !== undefined && middleContext.generatedAt >= targetTime) {
        matchedIndex = middleIndex;
        highIndex = middleIndex - 1;
      } else {
        lowIndex = middleIndex + 1;
      }
    }

    return matchedIndex;
  }

  private readContextAtOffset(contexts: ModelSnapshotContext[], index: number, lookbackMs: number): ModelSnapshotContext | null {
    const currentContext = this.readContext(contexts, index);
    const previousIndex = this.findContextIndexAtOrBefore(contexts, currentContext.generatedAt - lookbackMs, index);
    const previousContext = previousIndex === -1 ? null : this.readContext(contexts, previousIndex);
    return previousContext;
  }

  private safeLogRatio(numerator: number | null, denominator: number | null): number {
    const ratio = numerator !== null && denominator !== null && numerator > 0 && denominator > 0 ? Math.log(numerator / denominator) : 0;
    return ratio;
  }

  private safeDifference(currentValue: number | null, previousValue: number | null): number {
    const difference = currentValue !== null && previousValue !== null ? currentValue - previousValue : 0;
    return difference;
  }

  private encodeLogitProbability(probability: number | null): number | null {
    const clippedProbability = probability === null ? null : Math.min(1 - PROBABILITY_EPSILON, Math.max(PROBABILITY_EPSILON, probability));
    const encodedProbability = clippedProbability === null ? null : Math.log(clippedProbability / (1 - clippedProbability));
    return encodedProbability;
  }

  private normalizeTime(window: ModelWindow, durationSeconds: number | null): number {
    const windowSeconds = window === "5m" ? 300 : 900;
    const normalizedTime = durationSeconds === null ? 0 : Math.min(windowSeconds, Math.max(0, durationSeconds)) / windowSeconds;
    return normalizedTime;
  }

  private computeShock(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number {
    const realizedVolatility = this.signalCacheService.readRealizedVolatility(contexts, index, asset, 10_000);
    const exchangeReturn = Math.abs(this.signalCacheService.readExchangeReturn(contexts, index, asset, 5_000));
    const shock = realizedVolatility === 0 ? 0 : exchangeReturn / realizedVolatility;
    return shock;
  }

  private buildBucketSnapshots(snapshots: FlatSnapshot[]): Map<number, FlatSnapshot> {
    const bucketSnapshots = [...snapshots]
      .sort((leftSnapshot, rightSnapshot) => leftSnapshot.generated_at - rightSnapshot.generated_at)
      .reduce<Map<number, FlatSnapshot>>((bucketMap, snapshot) => {
        const bucketTimestamp = Math.floor(snapshot.generated_at / SNAPSHOT_STEP_MS) * SNAPSHOT_STEP_MS;
        bucketMap.set(bucketTimestamp, {
          ...snapshot,
          generated_at: bucketTimestamp,
        });
        return bucketMap;
      }, new Map<number, FlatSnapshot>());
    return bucketSnapshots;
  }

  private buildResampledSnapshots(snapshots: FlatSnapshot[]): FlatSnapshot[] {
    const bucketSnapshots = this.buildBucketSnapshots(snapshots);
    const sortedBucketTimestamps = [...bucketSnapshots.keys()].sort((leftTimestamp, rightTimestamp) => leftTimestamp - rightTimestamp);
    let currentTimestamp = sortedBucketTimestamps[0] || 0;
    const lastTimestamp = sortedBucketTimestamps.at(-1) || 0;
    let previousSnapshot: FlatSnapshot | null = null;
    const resampledSnapshots: FlatSnapshot[] = [];

    while (currentTimestamp <= lastTimestamp && currentTimestamp !== 0) {
      const sourceSnapshot = bucketSnapshots.get(currentTimestamp) || null;
      let materializedSnapshot: FlatSnapshot | null = null;

      if (sourceSnapshot !== null) {
        materializedSnapshot =
          previousSnapshot === null
            ? ({
                ...sourceSnapshot,
                generated_at: currentTimestamp,
              } as FlatSnapshot)
            : (Object.assign({}, previousSnapshot, sourceSnapshot, {
                generated_at: currentTimestamp,
              }) as FlatSnapshot);
      }

      if (sourceSnapshot === null && previousSnapshot !== null) {
        materializedSnapshot = Object.assign({}, previousSnapshot, {
          generated_at: currentTimestamp,
        }) as FlatSnapshot;
      }

      if (materializedSnapshot !== null) {
        resampledSnapshots.push(materializedSnapshot);
        previousSnapshot = materializedSnapshot;
      }

      currentTimestamp += SNAPSHOT_STEP_MS;
    }

    return resampledSnapshots;
  }

  private collectDecisionIndexes(contexts: ModelSnapshotContext[]): number[] {
    let lastDecisionTime = Number.NEGATIVE_INFINITY;
    const minimumIndex = this.getMaximumSequenceLength() - 1;
    const decisionIndexes = contexts.reduce<number[]>((indexList, context, contextIndex) => {
      if (contextIndex >= minimumIndex && context.generatedAt - lastDecisionTime >= this.decisionIntervalMs) {
        indexList.push(contextIndex);
        lastDecisionTime = context.generatedAt;
      }

      return indexList;
    }, []);
    return decisionIndexes;
  }

  private buildTrendFeatureVector(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number[] {
    const currentContext = this.readContext(contexts, index);
    const assetContext = currentContext.assetContexts[asset];
    const previous5Context = this.readContextAtOffset(contexts, index, 5_000);
    const exchangePrice = assetContext.exchangePrice;
    const trendFeatureVector = [
      assetContext.chainlinkPrice === null || assetContext.chainlinkPrice <= 0 ? 0 : Math.log(assetContext.chainlinkPrice),
      Math.min(300, assetContext.chainlinkStaleMs / 1_000),
      this.signalCacheService.readChainlinkReturn(contexts, index, asset, 30_000),
      this.signalCacheService.readBasis(contexts, index, asset),
      this.signalCacheService.readBasis(contexts, index, asset) -
        (previous5Context === null
          ? 0
          : this.safeLogRatio(previous5Context.assetContexts[asset].exchangePrice, previous5Context.assetContexts[asset].chainlinkPrice)),
      this.signalCacheService.readExchangeReturn(contexts, index, asset, 1_000),
      this.signalCacheService.readExchangeReturn(contexts, index, asset, 5_000),
      this.signalCacheService.readExchangeReturn(contexts, index, asset, 15_000),
      this.signalCacheService.readExchangeReturn(contexts, index, asset, 30_000),
      this.signalCacheService.readMomentumMean(contexts, index, asset, 5_000),
      this.signalCacheService.readRealizedVolatility(contexts, index, asset, 10_000),
      this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000),
      this.signalCacheService.readExchangeReturn(contexts, index, asset, 1_000) - this.signalCacheService.readExchangeReturn(contexts, index, asset, 5_000) / 5,
      assetContext.exchangeSpreadMedian,
      assetContext.exchangeSpreadWeightedMean,
      Math.log(1 + assetContext.exchangeDepth3WeightedMean),
      assetContext.exchangeImbalance1WeightedMean,
      assetContext.exchangeImbalance3WeightedMean,
      assetContext.exchangeImbalance3WeightedMean - (previous5Context?.assetContexts[asset].exchangeImbalance3WeightedMean || 0),
      assetContext.exchangeDispersionLog,
      assetContext.exchangeDispersionLog - (previous5Context?.assetContexts[asset].exchangeDispersionLog || 0),
      Math.min(30, assetContext.exchangeBestStaleMs / 1_000),
      Math.min(30, assetContext.exchangeMeanStaleMs / 1_000),
      assetContext.exchangeValidPriceCount,
      assetContext.exchangeValidBookCount,
      this.safeLogRatio(assetContext.venueStates.binance.mid, exchangePrice),
      this.safeLogRatio(assetContext.venueStates.coinbase.mid, exchangePrice),
      this.safeLogRatio(assetContext.venueStates.okx.mid, exchangePrice),
      this.safeLogRatio(assetContext.venueStates.kraken.mid, exchangePrice),
      this.signalCacheService.readLeaderReturn(contexts, index, asset, 5_000),
      this.signalCacheService.readLeaderReturn(contexts, index, asset, 15_000),
      this.signalCacheService.readLeaderImbalance3(contexts, index, asset),
      this.signalCacheService.readBreadthReturnMean(contexts, index, asset, 5_000),
      this.signalCacheService.readBreadthReturnStd(contexts, index, asset, 5_000),
      this.computeShock(contexts, index, BTC_SHOCK_SOURCE_ASSET),
      this.computeShock(contexts, index, ETH_SHOCK_SOURCE_ASSET),
      this.contextService.isChainlinkFresh(assetContext) ? 1 : 0,
      assetContext.chainlinkStaleMs <= 60_000 ? 1 : 0,
      assetContext.exchangeValidPriceCount >= 2 ? 1 : 0,
    ];
    return trendFeatureVector;
  }

  private buildClobFeatureVector(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number[] {
    const currentContext = this.readContext(contexts, index);
    const modelKey = this.buildModelKey(asset, window);
    const marketContext = currentContext.marketContexts[modelKey];
    const previous5Context = this.readContextAtOffset(contexts, index, 5_000);
    const previousMarketContext = previous5Context === null ? null : previous5Context.marketContexts[modelKey];
    const priceToBeat = marketContext.activeMarket?.priceToBeat || null;
    const fairProbability = this.signalCacheService.readFairProbability(contexts, index, asset, marketContext);
    const timeToEndSeconds =
      marketContext.activeMarket === null ? null : (Date.parse(marketContext.activeMarket.marketEnd) - currentContext.generatedAt) / 1_000;
    const timeFromStartSeconds =
      marketContext.activeMarket === null ? null : (currentContext.generatedAt - Date.parse(marketContext.activeMarket.marketStart)) / 1_000;
    const clobFeatureVector = [
      marketContext.upBook.mid || 0,
      marketContext.upBook.spread,
      marketContext.upBook.imbalance1,
      marketContext.upBook.imbalance3,
      Math.log(1 + marketContext.upBook.depth3),
      Math.log(1 + marketContext.upBook.depth1),
      Math.min(30, marketContext.upBook.staleMs / 1_000),
      this.safeDifference(marketContext.upBook.mid, previousMarketContext?.upBook.mid || null),
      marketContext.upBook.spread - (previousMarketContext?.upBook.spread || 0),
      marketContext.upBook.imbalance3 - (previousMarketContext?.upBook.imbalance3 || 0),
      marketContext.downBook.mid || 0,
      marketContext.downBook.spread,
      marketContext.downBook.imbalance1,
      marketContext.downBook.imbalance3,
      Math.log(1 + marketContext.downBook.depth3),
      Math.log(1 + marketContext.downBook.depth1),
      Math.min(30, marketContext.downBook.staleMs / 1_000),
      this.safeDifference(marketContext.downBook.mid, previousMarketContext?.downBook.mid || null),
      marketContext.parityGap,
      marketContext.upBook.spread + marketContext.downBook.spread,
      marketContext.upBook.imbalance3 - marketContext.downBook.imbalance3,
      (marketContext.upBook.mid || 0) - (marketContext.downBook.mid || 0),
      marketContext.upBook.tickSize,
      marketContext.upBook.minOrderSize,
      marketContext.upBook.negRisk ? 1 : 0,
      this.signalCacheService.readBookHashChange(contexts, index, modelKey),
      this.normalizeTime(window, timeToEndSeconds),
      this.normalizeTime(window, timeFromStartSeconds),
      priceToBeat === null ? 1 : 0,
      this.safeLogRatio(currentContext.assetContexts[asset].chainlinkPrice, priceToBeat),
      this.safeLogRatio(currentContext.assetContexts[asset].exchangePrice, priceToBeat),
      this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000),
      fairProbability,
      fairProbability - (marketContext.upBook.mid || 0),
      fairProbability - (marketContext.upBook.ask || 0),
      fairProbability - (marketContext.upBook.bid || 0),
      this.signalCacheService.readLeaderReturn(contexts, index, asset, 5_000),
      this.signalCacheService.readLeaderReturn(contexts, index, asset, 15_000),
      this.signalCacheService.readBreadthParity(contexts, index, asset, window),
      this.signalCacheService.readBreadthUpMidMean(contexts, index, asset, window),
      this.signalCacheService.readMarketUpMidStd(contexts, index, asset, window),
      Math.min(30, Math.max(marketContext.upBook.staleMs, marketContext.downBook.staleMs) / 1_000),
      Math.min(30, (marketContext.upBook.staleMs - marketContext.downBook.staleMs) / 1_000),
      marketContext.upBook.spread > 0.1 ? 1 : 0,
      marketContext.downBook.spread > 0.1 ? 1 : 0,
      (marketContext.upBook.mid || 0) - (marketContext.upBook.displayedPrice || marketContext.upBook.mid || 0),
      (marketContext.downBook.mid || 0) - (marketContext.downBook.displayedPrice || marketContext.downBook.mid || 0),
      marketContext.activeMarket === null ? 0 : 1,
    ];
    return clobFeatureVector;
  }

  private buildTrendSequence(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number[][] {
    const sequenceLength = TREND_SEQUENCE_LENGTHS[asset];
    const startIndex = index - sequenceLength + 1;
    const trendSequence = contexts.slice(startIndex, index + 1).map((_, sequenceIndex) => {
      return this.buildTrendFeatureVector(contexts, startIndex + sequenceIndex, asset);
    });
    return trendSequence;
  }

  private buildClobSequence(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number[][] {
    const modelKey = this.buildModelKey(asset, window);
    const sequenceLength = CLOB_SEQUENCE_LENGTHS[modelKey];
    const startIndex = index - sequenceLength + 1;
    const clobSequence = contexts.slice(startIndex, index + 1).map((_, sequenceIndex) => {
      return this.buildClobFeatureVector(contexts, startIndex + sequenceIndex, asset, window);
    });
    return clobSequence;
  }

  private buildTrendInput(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): ModelTrendInput | null {
    const currentContext = this.readContext(contexts, index);
    const assetContext = currentContext.assetContexts[asset];
    const canBuildTrendInput = index >= TREND_SEQUENCE_LENGTHS[asset] - 1;
    let trendInput: ModelTrendInput | null = null;

    if (canBuildTrendInput) {
      trendInput = {
        trendKey: asset,
        asset,
        decisionTime: currentContext.generatedAt,
        latestSnapshotAt: currentContext.generatedAt,
        trendSequence: this.buildTrendSequence(contexts, index, asset),
        currentChainlinkPrice: assetContext.chainlinkPrice,
        currentExchangePrice: assetContext.exchangePrice,
        realizedVolatility30s: this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000),
        isChainlinkFresh: this.contextService.isChainlinkFresh(assetContext),
      };
    }

    return trendInput;
  }

  private buildClobInput(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): ModelClobInput | null {
    const modelKey = this.buildModelKey(asset, window);
    const currentContext = this.readContext(contexts, index);
    const marketContext = currentContext.marketContexts[modelKey];
    const assetContext = currentContext.assetContexts[asset];
    const canBuildClobInput = index >= CLOB_SEQUENCE_LENGTHS[modelKey] - 1;
    let clobInput: ModelClobInput | null = null;

    if (canBuildClobInput && marketContext.activeMarket !== null) {
      clobInput = {
        modelKey,
        asset,
        window,
        decisionTime: currentContext.generatedAt,
        latestSnapshotAt: currentContext.generatedAt,
        activeMarket: marketContext.activeMarket,
        clobSequence: this.buildClobSequence(contexts, index, asset, window),
        currentUpMid: marketContext.upBook.mid,
        currentUpBid: marketContext.upBook.bid,
        currentUpAsk: marketContext.upBook.ask,
        currentDownMid: marketContext.downBook.mid,
        currentDownBid: marketContext.downBook.bid,
        currentDownAsk: marketContext.downBook.ask,
        currentChainlinkPrice: assetContext.chainlinkPrice,
        currentExchangePrice: assetContext.exchangePrice,
        realizedVolatility30s: this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000),
        isChainlinkFresh: this.contextService.isChainlinkFresh(assetContext),
        isOrderBookFresh: this.contextService.isOrderBookFresh(marketContext),
        upTokenId: marketContext.upBook.tokenId,
        downTokenId: marketContext.downBook.tokenId,
        upBidLevels: marketContext.upBook.bidLevels,
        upAskLevels: marketContext.upBook.askLevels,
        downBidLevels: marketContext.downBook.bidLevels,
        downAskLevels: marketContext.downBook.askLevels,
      };
    }

    return clobInput;
  }

  private buildTrendSample(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): ModelTrendSample | null {
    const trendInput = this.buildTrendInput(contexts, index, asset);
    const currentContext = this.readContext(contexts, index);
    const targetIndex = this.findContextIndexAtOrAfter(contexts, currentContext.generatedAt + this.predictionHorizonMs);
    const targetContext = targetIndex === -1 ? null : this.readContext(contexts, targetIndex);
    const currentAssetContext = currentContext.assetContexts[asset];
    const targetAssetContext = targetContext === null ? null : targetContext.assetContexts[asset];
    let trendSample: ModelTrendSample | null = null;

    if (trendInput !== null) {
      trendSample = {
        ...trendInput,
        trendTarget:
          targetAssetContext !== null &&
          this.contextService.isChainlinkFresh(currentAssetContext) &&
          this.contextService.isChainlinkFresh(targetAssetContext) &&
          currentAssetContext.chainlinkPrice !== null &&
          targetAssetContext.chainlinkPrice !== null &&
          currentAssetContext.chainlinkPrice > 0 &&
          targetAssetContext.chainlinkPrice > 0
            ? Math.log(targetAssetContext.chainlinkPrice / currentAssetContext.chainlinkPrice)
            : null,
      };
    }

    return trendSample;
  }

  private buildClobSample(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): ModelClobSample | null {
    const clobInput = this.buildClobInput(contexts, index, asset, window);
    const currentContext = this.readContext(contexts, index);
    const targetIndex = this.findContextIndexAtOrAfter(contexts, currentContext.generatedAt + this.predictionHorizonMs);
    const targetContext = targetIndex === -1 ? null : this.readContext(contexts, targetIndex);
    const modelKey = this.buildModelKey(asset, window);
    const targetMarketContext = targetContext === null ? null : targetContext.marketContexts[modelKey];
    const isValidClobTarget =
      clobInput !== null &&
      targetContext !== null &&
      targetMarketContext !== null &&
      clobInput.activeMarket !== null &&
      targetMarketContext.activeMarket !== null &&
      clobInput.currentUpMid !== null &&
      targetMarketContext.upBook.mid !== null &&
      this.contextService.isOrderBookFresh(targetMarketContext);
    let clobSample: ModelClobSample | null = null;

    if (clobInput !== null) {
      clobSample = {
        ...clobInput,
        clobTarget: isValidClobTarget ? this.encodeLogitProbability(targetMarketContext.upBook.mid) : null,
        clobDirectionTarget:
          isValidClobTarget && clobInput.currentUpMid !== null && targetMarketContext.upBook.mid !== null
            ? targetMarketContext.upBook.mid - clobInput.currentUpMid
            : null,
      };
    }

    return clobSample;
  }

  /**
   * @section public:methods
   */

  public buildFeatureNames(): ModelFeatureNames {
    const featureNames: ModelFeatureNames = {
      trendFeatures: [...TREND_FEATURE_NAMES],
      clobFeatures: [...CLOB_FEATURE_NAMES],
    };
    return featureNames;
  }

  public getSequenceLength(key: ModelAsset | ModelKey, head: "trend" | "clob"): number {
    const sequenceLength = head === "trend" ? TREND_SEQUENCE_LENGTHS[key as ModelAsset] : CLOB_SEQUENCE_LENGTHS[key as ModelKey];
    return sequenceLength;
  }

  public getMaximumSequenceLength(): number {
    const maximumSequenceLength = Math.max(...Object.values(TREND_SEQUENCE_LENGTHS), ...Object.values(CLOB_SEQUENCE_LENGTHS));
    return maximumSequenceLength;
  }

  public getRequiredOverlapMs(): number {
    const requiredOverlapMs = this.getMaximumSequenceLength() * SNAPSHOT_STEP_MS + this.predictionHorizonMs + this.decisionIntervalMs;
    return requiredOverlapMs;
  }

  public readShockSourceAsset(label: "btc_shock" | "eth_shock"): ModelAsset {
    const shockSourceAsset = label === "btc_shock" ? BTC_SHOCK_SOURCE_ASSET : ETH_SHOCK_SOURCE_ASSET;
    return shockSourceAsset;
  }

  public buildSnapshotContexts(snapshots: FlatSnapshot[]): ModelSnapshotContext[] {
    const snapshotContexts = this.contextService.buildSnapshotContexts(this.buildResampledSnapshots(snapshots));
    return snapshotContexts;
  }

  public buildTrendTrainingSamples(snapshots: FlatSnapshot[]): ModelTrendSample[] {
    const contexts = this.buildSnapshotContexts(snapshots);
    const trendSamples = this.collectDecisionIndexes(contexts).reduce<ModelTrendSample[]>((sampleList, index) => {
      this.supportedAssets.forEach((asset) => {
        const trendSample = this.buildTrendSample(contexts, index, asset);

        if (trendSample !== null && trendSample.trendTarget !== null) {
          sampleList.push(trendSample);
        }
      });
      return sampleList;
    }, []);
    return trendSamples;
  }

  public buildClobTrainingSamples(snapshots: FlatSnapshot[]): ModelClobSample[] {
    const contexts = this.buildSnapshotContexts(snapshots);
    const clobSamples = this.collectDecisionIndexes(contexts).reduce<ModelClobSample[]>((sampleList, index) => {
      this.supportedAssets.forEach((asset) => {
        this.supportedWindows.forEach((window) => {
          const clobSample = this.buildClobSample(contexts, index, asset, window);

          if (clobSample !== null && clobSample.clobTarget !== null && clobSample.clobDirectionTarget !== null) {
            sampleList.push(clobSample);
          }
        });
      });
      return sampleList;
    }, []);
    return clobSamples;
  }

  public buildPredictionInput(snapshots: FlatSnapshot[], request: { asset: ModelAsset; window: ModelWindow }): ModelPredictionInput | null {
    const contexts = this.buildSnapshotContexts(snapshots);
    const latestIndex = contexts.length - 1;
    const trendInput = latestIndex < 0 ? null : this.buildTrendInput(contexts, latestIndex, request.asset);
    const clobInput = latestIndex < 0 ? null : this.buildClobInput(contexts, latestIndex, request.asset, request.window);
    const predictionInput = trendInput !== null && clobInput !== null ? { trendInput, clobInput } : null;
    return predictionInput;
  }
}
