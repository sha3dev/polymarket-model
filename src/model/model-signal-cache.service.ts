/**
 * @section imports:internals
 */

import type { ModelAsset, ModelKey, ModelMarketContext, ModelSnapshotContext, ModelWindow } from "./model.types.ts";

/**
 * @section consts
 */

const LEADER_WEIGHTS: Record<ModelAsset, Record<ModelAsset, number>> = {
  btc: { btc: 0, eth: 0.2, sol: 0.05, xrp: 0.05 },
  eth: { btc: 0.6, eth: 0, sol: 0.1, xrp: 0.1 },
  sol: { btc: 0.6, eth: 0.3, sol: 0, xrp: 0.1 },
  xrp: { btc: 0.6, eth: 0.25, sol: 0.15, xrp: 0 },
};

const EPSILON = 1e-8;

/**
 * @section types
 */

type ModelSignalCacheServiceOptions = {
  supportedAssets: ModelAsset[];
};

type ModelSignalRegistry = {
  basis: Map<string, number>;
  breadthParity: Map<string, number>;
  breadthReturnMean: Map<string, number>;
  breadthReturnStd: Map<string, number>;
  breadthUpMidMean: Map<string, number>;
  bookHashChange: Map<string, number>;
  chainlinkReturn: Map<string, number>;
  exchangeReturn: Map<string, number>;
  fairProbability: Map<string, number>;
  leaderImbalance3: Map<string, number>;
  leaderReturn: Map<string, number>;
  marketUpMidStd: Map<string, number>;
  momentumMean: Map<string, number>;
  realizedVolatility: Map<string, number>;
};

/**
 * @section class
 */

export class ModelSignalCacheService {
  /**
   * @section private:attributes
   */

  private readonly supportedAssets: ModelAsset[];

  private readonly signalRegistry: WeakMap<ModelSnapshotContext[], ModelSignalRegistry>;

  /**
   * @section constructor
   */

  public constructor(options: ModelSignalCacheServiceOptions) {
    this.supportedAssets = options.supportedAssets;
    this.signalRegistry = new WeakMap<ModelSnapshotContext[], ModelSignalRegistry>();
  }

  /**
   * @section private:methods
   */

  private buildSignalRegistry(contexts: ModelSnapshotContext[]): ModelSignalRegistry {
    let signalRegistry = this.signalRegistry.get(contexts);

    if (signalRegistry === undefined) {
      signalRegistry = {
        basis: new Map<string, number>(),
        breadthParity: new Map<string, number>(),
        breadthReturnMean: new Map<string, number>(),
        breadthReturnStd: new Map<string, number>(),
        breadthUpMidMean: new Map<string, number>(),
        bookHashChange: new Map<string, number>(),
        chainlinkReturn: new Map<string, number>(),
        exchangeReturn: new Map<string, number>(),
        fairProbability: new Map<string, number>(),
        leaderImbalance3: new Map<string, number>(),
        leaderReturn: new Map<string, number>(),
        marketUpMidStd: new Map<string, number>(),
        momentumMean: new Map<string, number>(),
        realizedVolatility: new Map<string, number>(),
      };
      this.signalRegistry.set(contexts, signalRegistry);
    }

    return signalRegistry;
  }

  private buildSignalKey(prefix: string, index: number, suffix: string): string {
    const signalKey = `${prefix}:${index}:${suffix}`;
    return signalKey;
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

  private readCachedValue(signalMap: Map<string, number>, signalKey: string): number | null {
    const cachedValue = signalMap.get(signalKey);
    const signalValue = cachedValue === undefined ? null : cachedValue;
    return signalValue;
  }

  private setCachedValue(signalMap: Map<string, number>, signalKey: string, signalValue: number): number {
    signalMap.set(signalKey, signalValue);
    return signalValue;
  }

  private safeLogRatio(numerator: number | null, denominator: number | null): number {
    const ratio = numerator !== null && denominator !== null && numerator > 0 && denominator > 0 ? Math.log(numerator / denominator) : 0;
    return ratio;
  }

  private computeMean(values: number[]): number {
    const meanValue = values.length === 0 ? 0 : values.reduce((valueSum, value) => valueSum + value, 0) / values.length;
    return meanValue;
  }

  private computeStandardDeviation(values: number[]): number {
    const meanValue = this.computeMean(values);
    const variance = values.length === 0 ? 0 : values.reduce((varianceSum, value) => varianceSum + (value - meanValue) ** 2, 0) / values.length;
    const standardDeviation = Math.sqrt(Math.max(variance, 0));
    return standardDeviation;
  }

  private buildOtherAssets(asset: ModelAsset): ModelAsset[] {
    const otherAssets = this.supportedAssets.filter((supportedAsset) => supportedAsset !== asset);
    return otherAssets;
  }

  private readWeightedLeaderValue(values: Array<{ asset: ModelAsset; value: number }>, asset: ModelAsset): number {
    const weightedPairs = values.filter((value) => value.asset !== asset);
    const weightSum = weightedPairs.reduce((valueSum, pair) => valueSum + LEADER_WEIGHTS[asset][pair.asset], 0);
    const weightedLeaderValue =
      weightSum === 0 ? 0 : weightedPairs.reduce((valueSum, pair) => valueSum + LEADER_WEIGHTS[asset][pair.asset] * pair.value, 0) / weightSum;
    return weightedLeaderValue;
  }

  private readTimeToExpirySeconds(context: ModelSnapshotContext, marketContext: ModelMarketContext): number {
    const timeToExpirySeconds =
      marketContext.activeMarket === null ? 30 : Math.max(30, (Date.parse(marketContext.activeMarket.marketEnd) - context.generatedAt) / 1_000);
    return timeToExpirySeconds;
  }

  private approximateNormalCdf(value: number): number {
    const sign = value < 0 ? -1 : 1;
    const absoluteValue = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * absoluteValue);
    const polynomial = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    const erfValue = sign * (1 - polynomial * Math.exp(-(absoluteValue * absoluteValue)));
    const normalCdf = 0.5 * (1 + erfValue);
    return normalCdf;
  }

  private buildStepLookbacks(currentContext: ModelSnapshotContext, lookbackMs: number): number[] {
    const stepLookbacks: number[] = [];
    let cursorTime = currentContext.generatedAt - 500;

    while (cursorTime >= currentContext.generatedAt - lookbackMs) {
      stepLookbacks.push(currentContext.generatedAt - cursorTime);
      cursorTime -= 500;
    }

    return stepLookbacks;
  }

  /**
   * @section public:methods
   */

  public readExchangeReturn(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `exchange-return:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.exchangeReturn, signalKey);
    const currentContext = this.readContext(contexts, index);
    const previousIndex = this.findContextIndexAtOrBefore(contexts, currentContext.generatedAt - lookbackMs, index);
    const previousContext = previousIndex === -1 ? null : this.readContext(contexts, previousIndex);
    const computedValue = this.safeLogRatio(currentContext.assetContexts[asset].exchangePrice, previousContext?.assetContexts[asset].exchangePrice || null);
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.exchangeReturn, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readChainlinkReturn(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `chainlink-return:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.chainlinkReturn, signalKey);
    const currentContext = this.readContext(contexts, index);
    const previousIndex = this.findContextIndexAtOrBefore(contexts, currentContext.generatedAt - lookbackMs, index);
    const previousContext = previousIndex === -1 ? null : this.readContext(contexts, previousIndex);
    const computedValue = this.safeLogRatio(currentContext.assetContexts[asset].chainlinkPrice, previousContext?.assetContexts[asset].chainlinkPrice || null);
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.chainlinkReturn, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBasis(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, "basis");
    const cachedValue = this.readCachedValue(signalRegistry.basis, signalKey);
    const currentContext = this.readContext(contexts, index);
    const computedValue = this.safeLogRatio(currentContext.assetContexts[asset].exchangePrice, currentContext.assetContexts[asset].chainlinkPrice);
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.basis, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readMomentumMean(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `momentum-mean:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.momentumMean, signalKey);
    const currentContext = this.readContext(contexts, index);
    const lookbackValues = this.buildStepLookbacks(currentContext, lookbackMs).map((stepLookback) => {
      return this.readExchangeReturn(contexts, index, asset, stepLookback);
    });
    const computedValue = this.computeMean(lookbackValues);
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.momentumMean, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readRealizedVolatility(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `rv:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.realizedVolatility, signalKey);
    const currentContext = this.readContext(contexts, index);
    const returnSquares = this.buildStepLookbacks(currentContext, lookbackMs).map((stepLookback) => {
      return this.readExchangeReturn(contexts, index, asset, stepLookback) ** 2;
    });
    const computedValue = Math.sqrt(returnSquares.reduce((valueSum, value) => valueSum + value, 0));
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.realizedVolatility, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readLeaderReturn(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `leader-return:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.leaderReturn, signalKey);
    const computedValue = this.readWeightedLeaderValue(
      this.supportedAssets.map((sourceAsset) => ({
        asset: sourceAsset,
        value: this.readExchangeReturn(contexts, index, sourceAsset, lookbackMs),
      })),
      asset,
    );
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.leaderReturn, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readLeaderImbalance3(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, "leader-imbalance-3");
    const cachedValue = this.readCachedValue(signalRegistry.leaderImbalance3, signalKey);
    const currentContext = this.readContext(contexts, index);
    const computedValue = this.readWeightedLeaderValue(
      this.supportedAssets.map((sourceAsset) => ({
        asset: sourceAsset,
        value: currentContext.assetContexts[sourceAsset].exchangeImbalance3WeightedMean,
      })),
      asset,
    );
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.leaderImbalance3, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBreadthReturnMean(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `breadth-return-mean:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.breadthReturnMean, signalKey);
    const otherAssets = this.buildOtherAssets(asset);
    const computedValue = this.computeMean(otherAssets.map((sourceAsset) => this.readExchangeReturn(contexts, index, sourceAsset, lookbackMs)));
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.breadthReturnMean, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBreadthReturnStd(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, lookbackMs: number): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `breadth-return-std:${lookbackMs}`);
    const cachedValue = this.readCachedValue(signalRegistry.breadthReturnStd, signalKey);
    const otherAssets = this.buildOtherAssets(asset);
    const computedValue = this.computeStandardDeviation(otherAssets.map((sourceAsset) => this.readExchangeReturn(contexts, index, sourceAsset, lookbackMs)));
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.breadthReturnStd, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readFairProbability(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, marketContext: ModelMarketContext): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `fair-probability:${marketContext.modelKey}`);
    const cachedValue = this.readCachedValue(signalRegistry.fairProbability, signalKey);
    const currentContext = this.readContext(contexts, index);
    const chainlinkPrice = currentContext.assetContexts[asset].chainlinkPrice;
    const priceToBeat = marketContext.activeMarket?.priceToBeat || null;
    const realizedVolatility = this.readRealizedVolatility(contexts, index, asset, 30_000);
    const timeToExpirySeconds = this.readTimeToExpirySeconds(currentContext, marketContext);
    const denominator = Math.max(realizedVolatility * Math.sqrt(timeToExpirySeconds / 30), EPSILON);
    const computedValue =
      chainlinkPrice !== null && priceToBeat !== null && chainlinkPrice > 0 && priceToBeat > 0
        ? this.approximateNormalCdf(Math.log(chainlinkPrice / priceToBeat) / denominator)
        : 0.5;
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.fairProbability, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBreadthParity(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `breadth-parity:${window}`);
    const cachedValue = this.readCachedValue(signalRegistry.breadthParity, signalKey);
    const currentContext = this.readContext(contexts, index);
    const computedValue = this.computeMean(
      this.buildOtherAssets(asset).map((sourceAsset) => currentContext.marketContexts[`${sourceAsset}_${window}` as ModelKey].parityGap),
    );
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.breadthParity, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBreadthUpMidMean(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `breadth-up-mid-mean:${window}`);
    const cachedValue = this.readCachedValue(signalRegistry.breadthUpMidMean, signalKey);
    const currentContext = this.readContext(contexts, index);
    const computedValue = this.computeMean(
      this.buildOtherAssets(asset).map((sourceAsset) => currentContext.marketContexts[`${sourceAsset}_${window}` as ModelKey].upBook.mid || 0),
    );
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.breadthUpMidMean, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readMarketUpMidStd(contexts: ModelSnapshotContext[], index: number, asset: ModelAsset, window: ModelWindow): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(asset, index, `market-up-mid-std:${window}`);
    const cachedValue = this.readCachedValue(signalRegistry.marketUpMidStd, signalKey);
    const currentContext = this.readContext(contexts, index);
    const computedValue = this.computeStandardDeviation(
      this.buildOtherAssets(asset).map((sourceAsset) => currentContext.marketContexts[`${sourceAsset}_${window}` as ModelKey].upBook.mid || 0),
    );
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.marketUpMidStd, signalKey, computedValue) : cachedValue;
    return signalValue;
  }

  public readBookHashChange(contexts: ModelSnapshotContext[], index: number, modelKey: ModelKey): number {
    const signalRegistry = this.buildSignalRegistry(contexts);
    const signalKey = this.buildSignalKey(modelKey, index, "book-hash-change");
    const cachedValue = this.readCachedValue(signalRegistry.bookHashChange, signalKey);
    const currentContext = this.readContext(contexts, index);
    const previousIndex = this.findContextIndexAtOrBefore(contexts, currentContext.generatedAt - 500, index);
    const previousContext = previousIndex === -1 ? null : this.readContext(contexts, previousIndex);
    const computedValue =
      previousContext === null || previousContext.marketContexts[modelKey].upBook.bookHash === currentContext.marketContexts[modelKey].upBook.bookHash ? 0 : 1;
    const signalValue = cachedValue === null ? this.setCachedValue(signalRegistry.bookHashChange, signalKey, computedValue) : cachedValue;
    return signalValue;
  }
}
