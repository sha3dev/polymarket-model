/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { FlatSnapshot, ModelAsset, ModelCryptoInput, ModelCryptoSample, ModelFeatureNames, ModelSnapshotContext } from "./model.types.ts";
import { ModelContextService } from "./model-context.service.ts";
import { ModelSignalCacheService } from "./model-signal-cache.service.ts";

/**
 * @section consts
 */

const SNAPSHOT_STEP_MS = 500;
const BTC_SHOCK_SOURCE_ASSET: ModelAsset = "btc";
const ETH_SHOCK_SOURCE_ASSET: ModelAsset = "eth";

const CRYPTO_FEATURE_NAMES = [
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

/**
 * @section types
 */

type ModelFeatureServiceOptions = {
  blockDurationMs: number;
  chainlinkStaleMs: number;
  contextService: ModelContextService;
  predictionContextMs: number;
  predictionTargetMs: number;
  signalCacheService: ModelSignalCacheService;
  supportedAssets: ModelAsset[];
};

/**
 * @section class
 */

export class ModelFeatureService {
  /**
   * @section private:attributes
   */

  private readonly blockDurationMs: number;

  private readonly chainlinkStaleMs: number;

  private readonly contextService: ModelContextService;

  private readonly predictionContextMs: number;

  private readonly predictionTargetMs: number;

  private readonly signalCacheService: ModelSignalCacheService;

  private readonly supportedAssets: ModelAsset[];

  /**
   * @section constructor
   */

  public constructor(options: ModelFeatureServiceOptions) {
    this.blockDurationMs = options.blockDurationMs;
    this.chainlinkStaleMs = options.chainlinkStaleMs;
    this.contextService = options.contextService;
    this.predictionContextMs = options.predictionContextMs;
    this.predictionTargetMs = options.predictionTargetMs;
    this.signalCacheService = options.signalCacheService;
    this.supportedAssets = options.supportedAssets;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelFeatureService {
    const contextService = new ModelContextService({
      chainlinkStaleMs: config.MODEL_CHAINLINK_STALE_MS,
      polymarketStaleMs: 15_000,
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: [],
    });
    const modelFeatureService = new ModelFeatureService({
      blockDurationMs: config.MODEL_BLOCK_DURATION_MS,
      chainlinkStaleMs: config.MODEL_CHAINLINK_STALE_MS,
      contextService,
      predictionContextMs: config.MODEL_PREDICTION_CONTEXT_MS,
      predictionTargetMs: config.MODEL_PREDICTION_TARGET_MS,
      signalCacheService: new ModelSignalCacheService({
        supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      }),
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
    });
    return modelFeatureService;
  }

  /**
   * @section private:methods
   */

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

  private computeShock(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number {
    const realizedVolatility = this.signalCacheService.readRealizedVolatility(contexts, index, asset, 10_000);
    const exchangeReturn = Math.abs(this.signalCacheService.readExchangeReturn(contexts, index, asset, 5_000));
    const shock = realizedVolatility === 0 ? 0 : exchangeReturn / realizedVolatility;
    return shock;
  }

  private buildCryptoFeatureVector(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number[] {
    const currentContext = this.readContext(contexts, index);
    const assetContext = currentContext.assetContexts[asset];
    const previous5Context = this.readContextAtOffset(contexts, index, 5_000);
    const exchangePrice = assetContext.exchangePrice;
    const cryptoFeatureVector = [
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
    return cryptoFeatureVector;
  }

  private buildCryptoInput(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): ModelCryptoInput | null {
    const sequenceLength = this.getSequenceLength();
    const currentContext = this.readContext(contexts, index);
    const assetContext = currentContext.assetContexts[asset];
    const canBuildInput = index >= sequenceLength - 1;
    let cryptoInput: ModelCryptoInput | null = null;

    if (canBuildInput) {
      const startIndex = index - sequenceLength + 1;
      cryptoInput = {
        asset,
        cryptoSequence: contexts
          .slice(startIndex, index + 1)
          .map((_context, sequenceIndex) => this.buildCryptoFeatureVector(contexts, startIndex + sequenceIndex, asset)),
        currentChainlinkPrice: assetContext.chainlinkPrice,
        currentExchangePrice: assetContext.exchangePrice,
        decisionTime: currentContext.generatedAt,
        isChainlinkFresh: this.contextService.isChainlinkFresh(assetContext),
        latestSnapshotAt: currentContext.generatedAt,
        realizedVolatility30s: this.signalCacheService.readRealizedVolatility(contexts, index, asset, 30_000),
      };
    }

    return cryptoInput;
  }

  private buildDecisionIndexes(contexts: ModelSnapshotContext[]): number[] {
    const sequenceLength = this.getSequenceLength();
    const predictionTargetMs = this.predictionTargetMs;
    const blockEndAt = contexts.at(-1)?.generatedAt || 0;
    const decisionIndexes = contexts.reduce<number[]>((indexList, context, contextIndex) => {
      const blockOffset = context.generatedAt - (contexts[0]?.generatedAt || context.generatedAt);
      const canUseContext = contextIndex >= sequenceLength - 1;
      const isDecisionBoundary = blockOffset >= this.predictionContextMs && blockOffset % this.predictionContextMs === 0;
      const hasTargetInsideBlock = context.generatedAt + predictionTargetMs <= blockEndAt;

      if (canUseContext && isDecisionBoundary && hasTargetInsideBlock) {
        indexList.push(contextIndex);
      }

      return indexList;
    }, []);
    return decisionIndexes;
  }

  private readReferencePrice(context: ModelSnapshotContext, asset: ModelAsset): number | null {
    const assetContext = context.assetContexts[asset];
    const referencePrice = this.contextService.isChainlinkFresh(assetContext) ? assetContext.chainlinkPrice : assetContext.exchangePrice;
    return referencePrice;
  }

  private buildCryptoSample(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): ModelCryptoSample | null {
    const cryptoInput = this.buildCryptoInput(contexts, index, asset);
    const currentContext = this.readContext(contexts, index);
    const targetIndex = this.findContextIndexAtOrAfter(contexts, currentContext.generatedAt + this.predictionTargetMs);
    const targetContext = targetIndex === -1 ? null : this.readContext(contexts, targetIndex);
    const currentPrice = this.readReferencePrice(currentContext, asset);
    const targetPrice = targetContext === null ? null : this.readReferencePrice(targetContext, asset);
    let cryptoSample: ModelCryptoSample | null = null;

    if (cryptoInput !== null && currentPrice !== null && targetPrice !== null && currentPrice > 0 && targetPrice > 0) {
      const targetReturn = Math.log(targetPrice / currentPrice);
      cryptoSample = {
        ...cryptoInput,
        targetDirection: targetReturn > 0 ? "up" : "down",
        targetReturn,
      };
    }

    return cryptoSample;
  }

  /**
   * @section public:methods
   */

  public buildFeatureNames(): ModelFeatureNames {
    const featureNames: ModelFeatureNames = {
      cryptoFeatures: [...CRYPTO_FEATURE_NAMES],
    };
    return featureNames;
  }

  public getSequenceLength(): number {
    const sequenceLength = Math.floor(this.predictionContextMs / SNAPSHOT_STEP_MS);
    return sequenceLength;
  }

  public getRequiredLiveContextMs(): number {
    const requiredLiveContextMs = this.predictionContextMs;
    return requiredLiveContextMs;
  }

  public getBlockDurationMs(): number {
    const blockDurationMs = this.blockDurationMs;
    return blockDurationMs;
  }

  public getPredictionTargetMs(): number {
    const predictionTargetMs = this.predictionTargetMs;
    return predictionTargetMs;
  }

  public readShockSourceAsset(label: "btc_shock" | "eth_shock"): ModelAsset {
    const shockSourceAsset = label === "btc_shock" ? BTC_SHOCK_SOURCE_ASSET : ETH_SHOCK_SOURCE_ASSET;
    return shockSourceAsset;
  }

  public buildSnapshotContexts(snapshots: FlatSnapshot[]): ModelSnapshotContext[] {
    const snapshotContexts = this.contextService.buildSnapshotContexts(this.buildResampledSnapshots(snapshots));
    return snapshotContexts;
  }

  public buildTrainingSamples(asset: ModelAsset, snapshots: FlatSnapshot[]): ModelCryptoSample[] {
    const contexts = this.buildSnapshotContexts(snapshots);
    const trainingSamples = this.buildDecisionIndexes(contexts).reduce<ModelCryptoSample[]>((sampleList, contextIndex) => {
      const cryptoSample = this.buildCryptoSample(contexts, contextIndex, asset);

      if (cryptoSample !== null) {
        sampleList.push(cryptoSample);
      }

      return sampleList;
    }, []);
    return trainingSamples;
  }

  public buildPredictionInput(asset: ModelAsset, snapshots: FlatSnapshot[]): ModelCryptoInput | null {
    const contexts = this.buildSnapshotContexts(snapshots);
    const latestIndex = contexts.length - 1;
    const predictionInput = latestIndex < 0 ? null : this.buildCryptoInput(contexts, latestIndex, asset);
    return predictionInput;
  }

  public readReferenceValue(asset: ModelAsset, snapshots: FlatSnapshot[], targetTime: number): number | null {
    const contexts = this.buildSnapshotContexts(snapshots);
    const targetIndex = this.findContextIndexAtOrAfter(contexts, targetTime);
    const targetContext = targetIndex === -1 ? null : this.readContext(contexts, targetIndex);
    const referenceValue = targetContext === null ? null : this.readReferencePrice(targetContext, asset);
    return referenceValue;
  }

  public buildLivePredictionSnapshots(snapshots: FlatSnapshot[]): FlatSnapshot[] {
    const cutoffTimestamp = (snapshots.at(-1)?.generated_at || 0) - this.getRequiredLiveContextMs();
    const livePredictionSnapshots = snapshots.filter((snapshot) => snapshot.generated_at >= cutoffTimestamp);
    return livePredictionSnapshots;
  }

  public listSupportedAssets(): ModelAsset[] {
    const supportedAssets = [...this.supportedAssets];
    return supportedAssets;
  }
}
