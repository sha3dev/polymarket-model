/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  FlatSnapshot,
  ModelAsset,
  ModelFeatureInput,
  ModelFeatureNames,
  ModelKey,
  ModelSequenceSample,
  ModelSnapshotContext,
  ModelWindow,
} from "./model.types.ts";
import { ModelContextService } from "./model-context.service.ts";
import { ModelSignalCacheService } from "./model-signal-cache.service.ts";

/**
 * @section consts
 */

const SNAPSHOT_STEP_MS = 500;
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
  "pm_live_flag",
  "t_to_end_norm",
  "t_from_start_norm",
  "ptb_missing",
  "moneyness_log",
  "moneyness_volnorm",
  "moneyness_chg_30s",
  "ptb_basis_ex",
  "ptb_basis_ex_chg_5s",
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

const TREND_SEQUENCE_LENGTHS: Record<ModelKey, number> = {
  btc_5m: 128,
  btc_15m: 180,
  eth_5m: 128,
  eth_15m: 180,
  sol_5m: 128,
  sol_15m: 180,
  xrp_5m: 128,
  xrp_15m: 180,
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

  private buildTrendFeatureVector(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number[] {
    const currentContext = this.readContext(contexts, index);
    const modelKey = this.buildModelKey(asset, window);
    const assetContext = currentContext.assetContexts[asset];
    const marketContext = currentContext.marketContexts[modelKey];
    const previous5Context = this.readContextAtOffset(contexts, index, 5_000);
    const previous30Context = this.readContextAtOffset(contexts, index, 30_000);
    const priceToBeat = marketContext.activeMarket?.priceToBeat || null;
    const moneynessLog = this.safeLogRatio(assetContext.chainlinkPrice, priceToBeat);
    const timeToEndSeconds =
      marketContext.activeMarket === null ? null : (Date.parse(marketContext.activeMarket.marketEnd) - currentContext.generatedAt) / 1_000;
    const timeFromStartSeconds =
      marketContext.activeMarket === null ? null : (currentContext.generatedAt - Date.parse(marketContext.activeMarket.marketStart)) / 1_000;
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
      this.computeShock(contexts, index, "btc"),
      this.computeShock(contexts, index, "eth"),
      marketContext.activeMarket === null ? 0 : 1,
      this.normalizeTime(window, timeToEndSeconds),
      this.normalizeTime(window, timeFromStartSeconds),
      priceToBeat === null ? 1 : 0,
      moneynessLog,
      moneynessLog / Math.max(this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000), 1e-8),
      moneynessLog -
        (previous30Context === null
          ? 0
          : this.safeLogRatio(
              previous30Context.assetContexts[asset].chainlinkPrice,
              previous30Context.marketContexts[modelKey].activeMarket?.priceToBeat || null,
            )),
      this.safeLogRatio(exchangePrice, priceToBeat),
      this.safeLogRatio(exchangePrice, priceToBeat) -
        (previous5Context === null
          ? 0
          : this.safeLogRatio(
              previous5Context.assetContexts[asset].exchangePrice,
              previous5Context.marketContexts[modelKey].activeMarket?.priceToBeat || null,
            )),
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

  private buildSequence(
    contexts: ModelSnapshotContext[],
    index: number,
    asset: ModelAsset,
    window: ModelWindow,
    sequenceLength: number,
    featureBuilder: (contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow) => number[],
  ): number[][] {
    const startIndex = index - sequenceLength + 1;
    const sequence = contexts.slice(startIndex, index + 1).map((_, sequenceIndex) => {
      return featureBuilder(contexts, startIndex + sequenceIndex, asset, window);
    });
    return sequence;
  }

  private buildFeatureInput(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): ModelFeatureInput | null {
    const modelKey = this.buildModelKey(asset, window);
    const trendSequenceLength = TREND_SEQUENCE_LENGTHS[modelKey];
    const clobSequenceLength = CLOB_SEQUENCE_LENGTHS[modelKey];
    const currentContext = this.readContext(contexts, index);
    const marketContext = currentContext.marketContexts[modelKey];
    const assetContext = currentContext.assetContexts[asset];
    const canBuildSequence = index >= trendSequenceLength - 1 && index >= clobSequenceLength - 1;
    let featureInput: ModelFeatureInput | null = null;

    if (canBuildSequence && marketContext.activeMarket !== null) {
      featureInput = {
        modelKey,
        asset,
        window,
        decisionTime: currentContext.generatedAt,
        latestSnapshotAt: currentContext.generatedAt,
        activeMarket: marketContext.activeMarket,
        trendSequence: this.buildSequence(
          contexts,
          index,
          asset,
          window,
          trendSequenceLength,
          (sequenceContexts, sequenceIndex, sequenceAsset, sequenceWindow) => {
            return this.buildTrendFeatureVector(sequenceContexts, sequenceIndex, sequenceAsset, sequenceWindow);
          },
        ),
        clobSequence: this.buildSequence(
          contexts,
          index,
          asset,
          window,
          clobSequenceLength,
          (sequenceContexts, sequenceIndex, sequenceAsset, sequenceWindow) => {
            return this.buildClobFeatureVector(sequenceContexts, sequenceIndex, sequenceAsset, sequenceWindow);
          },
        ),
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

    return featureInput;
  }

  private buildTrainingSample(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): ModelSequenceSample | null {
    const featureInput = this.buildFeatureInput(contexts, index, asset, window);
    const currentContext = this.readContext(contexts, index);
    const targetIndex = this.findContextIndexAtOrAfter(contexts, currentContext.generatedAt + this.predictionHorizonMs);
    const targetContext = targetIndex === -1 ? null : this.readContext(contexts, targetIndex);
    const modelKey = this.buildModelKey(asset, window);
    const currentAssetContext = currentContext.assetContexts[asset];
    const targetAssetContext = targetContext === null ? null : targetContext.assetContexts[asset];
    const targetMarketContext = targetContext === null ? null : targetContext.marketContexts[modelKey];
    const isValidClobTarget =
      featureInput !== null &&
      targetContext !== null &&
      targetMarketContext !== null &&
      featureInput.activeMarket !== null &&
      targetMarketContext.activeMarket !== null &&
      featureInput.currentUpMid !== null &&
      targetMarketContext.upBook.mid !== null &&
      this.contextService.isOrderBookFresh(targetMarketContext);
    let trainingSample: ModelSequenceSample | null = null;

    if (featureInput !== null) {
      trainingSample = {
        ...featureInput,
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
        clobTarget: isValidClobTarget ? this.encodeLogitProbability(targetMarketContext.upBook.mid) : null,
        clobDirectionTarget:
          isValidClobTarget && featureInput.currentUpMid !== null && targetMarketContext.upBook.mid !== null
            ? targetMarketContext.upBook.mid - featureInput.currentUpMid
            : null,
      };
    }

    return trainingSample;
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

  public getSequenceLength(modelKey: ModelKey, head: "trend" | "clob"): number {
    const sequenceLength = head === "trend" ? TREND_SEQUENCE_LENGTHS[modelKey] : CLOB_SEQUENCE_LENGTHS[modelKey];
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

  public buildSnapshotContexts(snapshots: FlatSnapshot[]): ModelSnapshotContext[] {
    const snapshotContexts = this.contextService.buildSnapshotContexts(this.buildResampledSnapshots(snapshots));
    return snapshotContexts;
  }

  public buildTrainingSamples(snapshots: FlatSnapshot[]): ModelSequenceSample[] {
    const contexts = this.buildSnapshotContexts(snapshots);
    const trainingSamples = this.collectDecisionIndexes(contexts).reduce<ModelSequenceSample[]>((sampleList, index) => {
      this.supportedAssets.forEach((asset) => {
        this.supportedWindows.forEach((window) => {
          const trainingSample = this.buildTrainingSample(contexts, index, asset, window);

          if (trainingSample !== null && (trainingSample.trendTarget !== null || trainingSample.clobTarget !== null)) {
            sampleList.push(trainingSample);
          }
        });
      });
      return sampleList;
    }, []);
    return trainingSamples;
  }

  public buildPredictionInput(snapshots: FlatSnapshot[], request: { asset: ModelAsset; window: ModelWindow }): ModelFeatureInput | null {
    const contexts = this.buildSnapshotContexts(snapshots);
    const predictionInput = contexts.length === 0 ? null : this.buildFeatureInput(contexts, contexts.length - 1, request.asset, request.window);
    return predictionInput;
  }
}
