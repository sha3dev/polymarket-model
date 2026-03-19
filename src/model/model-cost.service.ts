/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ModelDirectionProbability, ModelOrderBookLevel, ModelPredictionInput, ModelPredictionPayload } from "./model.types.ts";

/**
 * @section consts
 */

const CLOB_BASE_URL = "https://clob.polymarket.com";
const EPSILON = 1e-8;
const PROBABILITY_EPSILON = 1e-4;

/**
 * @section types
 */

type ModelCostServiceOptions = {
  clobBaseUrl: string;
  executionSize: number;
  isClobOnlyFallbackEnabled: boolean;
  feeCacheTtlMs: number;
  fetcher: typeof fetch;
  fusionAlpha0: number;
  fusionAlpha1: number;
  maxSpread: number;
  spreadBufferKappa: number;
  vetoDownThreshold: number;
};

type FeeCacheEntry = {
  expiresAt: number;
  feeRateBps: number | null;
};

/**
 * @section class
 */

export class ModelCostService {
  /**
   * @section private:attributes
   */

  private readonly clobBaseUrl: string;

  private readonly executionSize: number;

  private readonly isClobOnlyFallbackEnabled: boolean;

  private readonly feeCacheRegistry: Map<string, FeeCacheEntry>;

  private readonly feeCacheTtlMs: number;

  private readonly fetcher: typeof fetch;

  private readonly fusionAlpha0: number;

  private readonly fusionAlpha1: number;

  private readonly maxSpread: number;

  private readonly spreadBufferKappa: number;

  private readonly vetoDownThreshold: number;

  /**
   * @section constructor
   */

  public constructor(options: ModelCostServiceOptions) {
    this.clobBaseUrl = options.clobBaseUrl;
    this.executionSize = options.executionSize;
    this.isClobOnlyFallbackEnabled = options.isClobOnlyFallbackEnabled;
    this.feeCacheRegistry = new Map<string, FeeCacheEntry>();
    this.feeCacheTtlMs = options.feeCacheTtlMs;
    this.fetcher = options.fetcher;
    this.fusionAlpha0 = options.fusionAlpha0;
    this.fusionAlpha1 = options.fusionAlpha1;
    this.maxSpread = options.maxSpread;
    this.spreadBufferKappa = options.spreadBufferKappa;
    this.vetoDownThreshold = options.vetoDownThreshold;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelCostService {
    const modelCostService = new ModelCostService({
      clobBaseUrl: CLOB_BASE_URL,
      executionSize: config.MODEL_EXECUTION_SIZE,
      isClobOnlyFallbackEnabled: config.MODEL_ENABLE_CLOB_ONLY_FALLBACK,
      feeCacheTtlMs: config.MODEL_FEE_CACHE_TTL_MS,
      fetcher: fetch,
      fusionAlpha0: config.MODEL_FUSION_ALPHA_0,
      fusionAlpha1: config.MODEL_FUSION_ALPHA_1,
      maxSpread: config.MODEL_MAX_SPREAD,
      spreadBufferKappa: config.MODEL_SPREAD_BUFFER_KAPPA,
      vetoDownThreshold: config.MODEL_VETO_DOWN_THRESHOLD,
    });
    return modelCostService;
  }

  /**
   * @section private:methods
   */

  private buildFeeRateUrl(tokenId: string): string {
    const feeRateUrl = new URL("/fee-rate", this.clobBaseUrl);
    feeRateUrl.searchParams.set("token_id", tokenId);
    return feeRateUrl.toString();
  }

  private readCachedFeeRate(tokenId: string): number | null | undefined {
    const cachedEntry = this.feeCacheRegistry.get(tokenId);
    let feeRateBps: number | null | undefined;

    if (cachedEntry !== undefined) {
      feeRateBps = cachedEntry.expiresAt > Date.now() ? cachedEntry.feeRateBps : undefined;

      if (cachedEntry.expiresAt <= Date.now()) {
        this.feeCacheRegistry.delete(tokenId);
      }
    }

    return feeRateBps;
  }

  private setCachedFeeRate(tokenId: string, feeRateBps: number | null): void {
    this.feeCacheRegistry.set(tokenId, {
      expiresAt: Date.now() + this.feeCacheTtlMs,
      feeRateBps,
    });
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

  private clamp(value: number, minimumValue: number, maximumValue: number): number {
    const clampedValue = Math.min(maximumValue, Math.max(minimumValue, value));
    return clampedValue;
  }

  private buildTrendFairProbability(input: ModelPredictionInput, predictedReturn: number): number | null {
    const priceToBeat = input.clobInput.activeMarket?.priceToBeat || null;
    const marketEnd = input.clobInput.activeMarket === null ? null : Date.parse(input.clobInput.activeMarket.marketEnd);
    const timeToExpirySeconds = marketEnd === null ? 30 : Math.max(30, (marketEnd - input.trendInput.decisionTime) / 1_000);
    const fairProbability =
      input.trendInput.currentChainlinkPrice !== null && input.trendInput.currentChainlinkPrice > 0 && priceToBeat !== null && priceToBeat > 0
        ? this.approximateNormalCdf(
            Math.log((input.trendInput.currentChainlinkPrice * Math.exp(predictedReturn)) / priceToBeat) /
              (input.trendInput.realizedVolatility30s * Math.sqrt(timeToExpirySeconds / 30) + EPSILON),
          )
        : null;
    return fairProbability;
  }

  private buildEstimatedFee(feeRateBps: number | null, executionPrice: number | null): number | null {
    const feeRate = feeRateBps === null ? null : feeRateBps / 10_000;
    const estimatedFee =
      feeRate !== null && executionPrice !== null
        ? this.executionSize * executionPrice * feeRate * (executionPrice * Math.max(1 - executionPrice, 0)) ** 2
        : null;
    return estimatedFee;
  }

  private buildEffectiveExecutionPrice(askLevels: ModelOrderBookLevel[]): number | null {
    let remainingSize = this.executionSize;
    let notional = 0;

    for (const askLevel of askLevels) {
      const executedSize = Math.min(remainingSize, askLevel.size);
      notional += executedSize * askLevel.price;
      remainingSize -= executedSize;

      if (remainingSize <= 0) {
        break;
      }
    }

    const effectiveExecutionPrice = remainingSize > 0 ? null : notional / this.executionSize;
    return effectiveExecutionPrice;
  }

  private buildEstimatedSlippage(executionPrice: number | null, currentMid: number | null): number | null {
    const estimatedSlippage = executionPrice !== null && currentMid !== null ? Math.max(0, executionPrice - currentMid) : null;
    return estimatedSlippage;
  }

  private buildSpreadBuffer(askPrice: number | null, bidPrice: number | null): number | null {
    const spreadBuffer = askPrice !== null && bidPrice !== null ? this.spreadBufferKappa * (askPrice - bidPrice) : null;
    return spreadBuffer;
  }

  private buildTimeWeight(input: ModelPredictionInput): number {
    const marketEnd = input.clobInput.activeMarket === null ? null : Date.parse(input.clobInput.activeMarket.marketEnd);
    const marketStart = input.clobInput.activeMarket === null ? null : Date.parse(input.clobInput.activeMarket.marketStart);
    const totalWindow = marketEnd !== null && marketStart !== null ? Math.max(1, marketEnd - marketStart) : 1;
    const timeToEnd = marketEnd === null ? 0 : Math.max(0, marketEnd - input.clobInput.decisionTime);
    const normalizedTime = timeToEnd / totalWindow;
    const timeWeight = this.clamp(this.fusionAlpha0 + this.fusionAlpha1 * normalizedTime, 0, 1);
    return timeWeight;
  }

  private buildSuggestedSide(scoreUp: number | null, scoreDown: number | null, shouldTrade: boolean): "up" | "down" | "none" {
    const suggestedSide =
      shouldTrade && scoreUp !== null && scoreDown !== null
        ? scoreUp >= scoreDown
          ? "up"
          : "down"
        : shouldTrade && scoreUp !== null
          ? "up"
          : shouldTrade && scoreDown !== null
            ? "down"
            : "none";
    return suggestedSide;
  }

  private buildSelectedScore(scoreUp: number | null, scoreDown: number | null): number | null {
    const selectedScore = scoreUp !== null && scoreDown !== null ? Math.max(scoreUp, scoreDown) : scoreUp !== null ? scoreUp : scoreDown;
    return selectedScore;
  }

  private buildHeadScore(
    input: ModelPredictionInput,
    trendEdge: number | null,
    clobEdge: number | null,
    estimatedFee: number | null,
    estimatedSlippage: number | null,
    spreadBuffer: number | null,
  ): number | null {
    const score =
      trendEdge !== null && clobEdge !== null
        ? this.buildTimeWeight(input) * (trendEdge / Math.max((estimatedFee || 0) + (estimatedSlippage || 0) + (spreadBuffer || 0), 0.001)) +
          (1 - this.buildTimeWeight(input)) * (clobEdge / Math.max(input.clobInput.realizedVolatility30s, 0.001))
        : clobEdge === null
          ? null
          : clobEdge / Math.max(input.clobInput.realizedVolatility30s, 0.001);
    return score;
  }

  /**
   * @section public:methods
   */

  public async readFeeRateBps(tokenId: string | null): Promise<number | null> {
    const cachedFeeRate = tokenId === null ? null : this.readCachedFeeRate(tokenId);
    let feeRateBps = cachedFeeRate === undefined ? null : cachedFeeRate;

    if (tokenId !== null && cachedFeeRate === undefined) {
      const response = await this.fetcher(this.buildFeeRateUrl(tokenId));

      if (response.ok) {
        const payload = (await response.json()) as { base_fee?: number };
        feeRateBps = typeof payload.base_fee === "number" ? payload.base_fee : null;
        this.setCachedFeeRate(tokenId, feeRateBps);
      } else {
        this.setCachedFeeRate(tokenId, null);
      }
    }

    return feeRateBps;
  }

  public async buildFusionPayload(
    input: ModelPredictionInput,
    trendPrediction: { predictedReturn: number; probabilities: ModelDirectionProbability },
    clobPrediction: { predictedUpMid: number; probabilities: ModelDirectionProbability },
  ): Promise<ModelPredictionPayload["fusion"]> {
    const vetoes: string[] = [];
    const reasons: string[] = [];
    let hasGlobalVeto = false;
    const fairProbabilityUp = this.buildTrendFairProbability(input, trendPrediction.predictedReturn);
    const fairProbabilityDown = fairProbabilityUp === null ? null : 1 - fairProbabilityUp;
    const predictedDownMid = this.clamp(1 - clobPrediction.predictedUpMid, PROBABILITY_EPSILON, 1 - PROBABILITY_EPSILON);
    const feeRateBpsUp = await this.readFeeRateBps(input.clobInput.upTokenId);
    const feeRateBpsDown = await this.readFeeRateBps(input.clobInput.downTokenId);
    const executionPriceUp = this.buildEffectiveExecutionPrice(input.clobInput.upAskLevels);
    const executionPriceDown = this.buildEffectiveExecutionPrice(input.clobInput.downAskLevels);
    const estimatedFeeUp = this.buildEstimatedFee(feeRateBpsUp, executionPriceUp);
    const estimatedFeeDown = this.buildEstimatedFee(feeRateBpsDown, executionPriceDown);
    const estimatedSlippageUp = this.buildEstimatedSlippage(executionPriceUp, input.clobInput.currentUpMid);
    const estimatedSlippageDown = this.buildEstimatedSlippage(executionPriceDown, input.clobInput.currentDownMid);
    const spreadBufferUp = this.buildSpreadBuffer(input.clobInput.currentUpAsk, input.clobInput.currentUpBid);
    const spreadBufferDown = this.buildSpreadBuffer(input.clobInput.currentDownAsk, input.clobInput.currentDownBid);
    const trendEdgeUp =
      fairProbabilityUp !== null && executionPriceUp !== null && estimatedFeeUp !== null && estimatedSlippageUp !== null && spreadBufferUp !== null
        ? fairProbabilityUp - executionPriceUp - estimatedFeeUp - estimatedSlippageUp - spreadBufferUp
        : null;
    const trendEdgeDown =
      fairProbabilityDown !== null && executionPriceDown !== null && estimatedFeeDown !== null && estimatedSlippageDown !== null && spreadBufferDown !== null
        ? fairProbabilityDown - executionPriceDown - estimatedFeeDown - estimatedSlippageDown - spreadBufferDown
        : null;
    let clobEdgeUp = input.clobInput.currentUpMid === null ? null : clobPrediction.predictedUpMid - input.clobInput.currentUpMid;
    let clobEdgeDown = input.clobInput.currentDownMid === null ? null : predictedDownMid - input.clobInput.currentDownMid;
    const mode = fairProbabilityUp === null && this.isClobOnlyFallbackEnabled ? "clob_only" : "full";
    let scoreUp = this.buildHeadScore(input, trendEdgeUp, clobEdgeUp, estimatedFeeUp, estimatedSlippageUp, spreadBufferUp);
    let scoreDown = this.buildHeadScore(input, trendEdgeDown, clobEdgeDown, estimatedFeeDown, estimatedSlippageDown, spreadBufferDown);

    if (!input.trendInput.isChainlinkFresh) {
      vetoes.push("chainlink_stale");
      hasGlobalVeto = true;
    }

    if (!input.clobInput.isOrderBookFresh) {
      vetoes.push("order_book_stale");
      hasGlobalVeto = true;
    }

    if (
      input.clobInput.currentUpAsk !== null &&
      input.clobInput.currentUpBid !== null &&
      input.clobInput.currentUpAsk - input.clobInput.currentUpBid > this.maxSpread
    ) {
      vetoes.push("spread_too_wide_up");
      scoreUp = null;
    }

    if (
      input.clobInput.currentDownAsk !== null &&
      input.clobInput.currentDownBid !== null &&
      input.clobInput.currentDownAsk - input.clobInput.currentDownBid > this.maxSpread
    ) {
      vetoes.push("spread_too_wide_down");
      scoreDown = null;
    }

    if (executionPriceUp === null) {
      vetoes.push("insufficient_up_liquidity");
      scoreUp = null;
    }

    if (executionPriceDown === null) {
      vetoes.push("insufficient_down_liquidity");
      scoreDown = null;
    }

    if (trendEdgeUp !== null && trendEdgeUp <= 0) {
      vetoes.push("trend_edge_non_positive_up");
      scoreUp = null;
    }

    if (trendEdgeDown !== null && trendEdgeDown <= 0) {
      vetoes.push("trend_edge_non_positive_down");
      scoreDown = null;
    }

    if (clobPrediction.probabilities.down > this.vetoDownThreshold) {
      vetoes.push("clob_down_probability_veto_up");
      scoreUp = null;
    }

    if (clobPrediction.probabilities.up > this.vetoDownThreshold) {
      vetoes.push("clob_up_probability_veto_down");
      scoreDown = null;
    }

    if (input.clobInput.activeMarket?.priceToBeat === null && !this.isClobOnlyFallbackEnabled) {
      vetoes.push("price_to_beat_missing");
      scoreUp = null;
      scoreDown = null;
      hasGlobalVeto = true;
    }

    if (input.clobInput.activeMarket?.priceToBeat === null && this.isClobOnlyFallbackEnabled) {
      reasons.push("running clob-only fallback because price_to_beat is missing");
      clobEdgeUp = input.clobInput.currentUpMid === null ? null : clobPrediction.predictedUpMid - input.clobInput.currentUpMid;
      clobEdgeDown = input.clobInput.currentDownMid === null ? null : predictedDownMid - input.clobInput.currentDownMid;
    }

    if (feeRateBpsUp === null) {
      vetoes.push("fee_rate_unavailable_up");
      scoreUp = null;
    }

    if (feeRateBpsDown === null) {
      vetoes.push("fee_rate_unavailable_down");
      scoreDown = null;
    }

    if (feeRateBpsUp === null || feeRateBpsDown === null) {
      reasons.push("fee-rate lookup failed, trade vetoed");
    }

    if (scoreUp === null && scoreDown === null) {
      reasons.push("insufficient live inputs for a cost-aware score");
    }

    let selectedScore = this.buildSelectedScore(scoreUp, scoreDown);

    if (selectedScore !== null && selectedScore <= 0) {
      reasons.push("net executable edge is not positive");
    }

    if (hasGlobalVeto) {
      selectedScore = null;
    }

    const shouldTrade = selectedScore !== null && selectedScore > 0 && !hasGlobalVeto;
    const fusionPayload: ModelPredictionPayload["fusion"] = {
      scoreUp,
      scoreDown,
      selectedScore,
      shouldTrade,
      suggestedSide: this.buildSuggestedSide(scoreUp, scoreDown, shouldTrade),
      mode,
      trendEdgeUp,
      trendEdgeDown,
      clobEdgeUp,
      clobEdgeDown,
      feeRateBpsUp,
      feeRateBpsDown,
      estimatedFeeUp,
      estimatedFeeDown,
      estimatedSlippageUp,
      estimatedSlippageDown,
      spreadBufferUp,
      spreadBufferDown,
      vetoes,
      reasons,
    };
    return fusionPayload;
  }

  public readTrendFairProbability(input: ModelPredictionInput, predictedReturn: number): number | null {
    const fairProbability = this.buildTrendFairProbability(input, predictedReturn);
    return fairProbability;
  }
}
