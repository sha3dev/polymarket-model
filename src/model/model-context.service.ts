/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type {
  FlatSnapshot,
  ModelActiveMarket,
  ModelAsset,
  ModelAssetContext,
  ModelBookContext,
  ModelExchangeVenue,
  ModelExchangeVenueContext,
  ModelKey,
  ModelMarketContext,
  ModelOrderBookLevel,
  ModelSnapshotContext,
  ModelWindow,
} from "./model.types.ts";

/**
 * @section consts
 */

const EXCHANGE_NAMES = ["binance", "coinbase", "kraken", "okx"] as const;
const DEFAULT_MIN_ORDER_SIZE = 1;
const DEFAULT_TICK_SIZE = 0.01;

/**
 * @section types
 */

type ModelContextServiceOptions = {
  supportedAssets: ModelAsset[];
  supportedWindows: ModelWindow[];
  chainlinkStaleMs: number;
  polymarketStaleMs: number;
};

type ParsedOrderBook = {
  asks: ModelOrderBookLevel[];
  bids: ModelOrderBookLevel[];
  bookHash: string | null;
  lastTradePrice: number | null;
  minOrderSize: number;
  negRisk: boolean;
  tickSize: number;
  tokenId: string | null;
};

type VenueAggregation = {
  bestStaleMs: number;
  depth3WeightedSum: number;
  dispersionInputs: number[];
  imbalance1WeightedSum: number;
  imbalance3WeightedSum: number;
  priceWeightedSum: number;
  spreadValues: number[];
  spreadWeightedSum: number;
  staleValues: number[];
  validBookCount: number;
  validPriceCount: number;
  weightSum: number;
};

/**
 * @section class
 */

export class ModelContextService {
  /**
   * @section private:attributes
   */

  private readonly supportedAssets: ModelAsset[];

  private readonly supportedWindows: ModelWindow[];

  private readonly chainlinkStaleMs: number;

  private readonly polymarketStaleMs: number;

  /**
   * @section constructor
   */

  public constructor(options: ModelContextServiceOptions) {
    this.supportedAssets = options.supportedAssets;
    this.supportedWindows = options.supportedWindows;
    this.chainlinkStaleMs = options.chainlinkStaleMs;
    this.polymarketStaleMs = options.polymarketStaleMs;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelContextService {
    const modelContextService = new ModelContextService({
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      supportedWindows: config.MODEL_SUPPORTED_WINDOWS as ModelWindow[],
      chainlinkStaleMs: config.MODEL_CHAINLINK_STALE_MS,
      polymarketStaleMs: config.MODEL_POLYMARKET_STALE_MS,
    });
    return modelContextService;
  }

  /**
   * @section private:methods
   */

  private buildModelKey(asset: ModelAsset, window: ModelWindow): ModelKey {
    const modelKey = `${asset}_${window}` as ModelKey;
    return modelKey;
  }

  private buildEmptyParsedOrderBook(): ParsedOrderBook {
    const parsedOrderBook: ParsedOrderBook = {
      asks: [],
      bids: [],
      bookHash: null,
      lastTradePrice: null,
      minOrderSize: DEFAULT_MIN_ORDER_SIZE,
      negRisk: false,
      tickSize: DEFAULT_TICK_SIZE,
      tokenId: null,
    };
    return parsedOrderBook;
  }

  private readNumberField(snapshot: FlatSnapshot, fieldName: string): number | null {
    const rawValue = snapshot[fieldName];
    const fieldValue = typeof rawValue === "number" ? rawValue : null;
    return fieldValue;
  }

  private readStringField(snapshot: FlatSnapshot, fieldName: string): string | null {
    const rawValue = snapshot[fieldName];
    const fieldValue = typeof rawValue === "string" ? rawValue : null;
    return fieldValue;
  }

  private readNumberish(rawValue: unknown): number | null {
    let numericValue: number | null = null;

    if (typeof rawValue === "number") {
      numericValue = rawValue;
    }

    if (typeof rawValue === "string") {
      const parsedValue = Number(rawValue);

      if (!Number.isNaN(parsedValue)) {
        numericValue = parsedValue;
      }
    }

    return numericValue;
  }

  private readStringish(rawValue: unknown): string | null {
    let stringValue: string | null = null;

    if (typeof rawValue === "string" && rawValue.length > 0) {
      stringValue = rawValue;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      stringValue = String(rawValue);
    }

    return stringValue;
  }

  private readBooleanish(rawValue: unknown): boolean {
    let isBooleanValue = false;

    if (typeof rawValue === "boolean") {
      isBooleanValue = rawValue;
    }

    if (typeof rawValue === "string") {
      isBooleanValue = rawValue === "true";
    }

    return isBooleanValue;
  }

  private parseOrderBookLevel(rawLevel: unknown): ModelOrderBookLevel | null {
    let orderBookLevel: ModelOrderBookLevel | null = null;

    if (Array.isArray(rawLevel) && rawLevel.length >= 2) {
      const price = this.readNumberish(rawLevel[0]);
      const size = this.readNumberish(rawLevel[1]);

      if (price !== null && size !== null) {
        orderBookLevel = { price, size };
      }
    }

    if (!Array.isArray(rawLevel) && rawLevel !== null && typeof rawLevel === "object") {
      const rawRecord = rawLevel as Record<string, unknown>;
      const price = this.readNumberish(rawRecord.price);
      const size = this.readNumberish(rawRecord.size);

      if (price !== null && size !== null) {
        orderBookLevel = { price, size };
      }
    }

    return orderBookLevel;
  }

  private parseOrderBookSide(rawSide: unknown): ModelOrderBookLevel[] {
    const rawLevels = Array.isArray(rawSide) ? rawSide : [];
    const orderBookLevels = rawLevels.reduce<ModelOrderBookLevel[]>((levelList, rawLevel) => {
      const orderBookLevel = this.parseOrderBookLevel(rawLevel);

      if (orderBookLevel !== null) {
        levelList.push(orderBookLevel);
      }

      return levelList;
    }, []);
    return orderBookLevels;
  }

  private parseOrderBook(bookJson: string | null): ParsedOrderBook {
    let parsedOrderBook = this.buildEmptyParsedOrderBook();

    if (bookJson !== null) {
      try {
        const rawPayload = JSON.parse(bookJson) as Record<string, unknown>;
        parsedOrderBook = {
          asks: this.parseOrderBookSide(rawPayload.asks),
          bids: this.parseOrderBookSide(rawPayload.bids),
          bookHash: this.readStringish(rawPayload.hash),
          lastTradePrice: this.readNumberish(rawPayload.last_trade_price),
          minOrderSize: this.readNumberish(rawPayload.min_order_size) ?? DEFAULT_MIN_ORDER_SIZE,
          negRisk: this.readBooleanish(rawPayload.neg_risk),
          tickSize: this.readNumberish(rawPayload.tick_size) ?? DEFAULT_TICK_SIZE,
          tokenId:
            this.readStringish(rawPayload.token_id) ??
            this.readStringish(rawPayload.tokenId) ??
            this.readStringish(rawPayload.asset_id) ??
            this.readStringish(rawPayload.assetId),
        };
      } catch (error) {
        logger.warn(`failed to parse order book payload error=${error instanceof Error ? error.message : "unknown error"}`);
        parsedOrderBook = this.buildEmptyParsedOrderBook();
      }
    }

    return parsedOrderBook;
  }

  private computeDepth(levels: ModelOrderBookLevel[], levelCount: number): number {
    const depth = levels.slice(0, levelCount).reduce((depthSum, level) => depthSum + level.size, 0);
    return depth;
  }

  private computeImbalance(bids: ModelOrderBookLevel[], asks: ModelOrderBookLevel[], levelCount: number): number {
    const bidDepth = this.computeDepth(bids, levelCount);
    const askDepth = this.computeDepth(asks, levelCount);
    const denominator = bidDepth + askDepth;
    const imbalance = denominator === 0 ? 0 : (bidDepth - askDepth) / denominator;
    return imbalance;
  }

  private buildBookContext(
    snapshot: FlatSnapshot,
    displayedPriceFieldName: string,
    eventTimestampFieldName: string,
    parsedOrderBook: ParsedOrderBook,
  ): ModelBookContext {
    const bestBid = parsedOrderBook.bids.at(0) || null;
    const bestAsk = parsedOrderBook.asks.at(0) || null;
    const displayedPrice = this.readNumberField(snapshot, displayedPriceFieldName);
    const eventTimestamp = this.readNumberField(snapshot, eventTimestampFieldName);
    const bookContext: ModelBookContext = {
      bid: bestBid?.price || null,
      ask: bestAsk?.price || null,
      bidLevels: [...parsedOrderBook.bids],
      askLevels: [...parsedOrderBook.asks],
      mid: bestBid !== null && bestAsk !== null ? (bestBid.price + bestAsk.price) / 2 : displayedPrice,
      displayedPrice,
      spread: bestBid !== null && bestAsk !== null ? bestAsk.price - bestBid.price : 0,
      depth1: this.computeDepth(parsedOrderBook.bids, 1) + this.computeDepth(parsedOrderBook.asks, 1),
      depth3: this.computeDepth(parsedOrderBook.bids, 3) + this.computeDepth(parsedOrderBook.asks, 3),
      imbalance1: this.computeImbalance(parsedOrderBook.bids, parsedOrderBook.asks, 1),
      imbalance3: this.computeImbalance(parsedOrderBook.bids, parsedOrderBook.asks, 3),
      staleMs: eventTimestamp === null ? Number.POSITIVE_INFINITY : snapshot.generated_at - eventTimestamp,
      tickSize: parsedOrderBook.tickSize,
      minOrderSize: parsedOrderBook.minOrderSize,
      negRisk: parsedOrderBook.negRisk,
      bookHash: parsedOrderBook.bookHash,
      tokenId: parsedOrderBook.tokenId,
      lastTradePrice: parsedOrderBook.lastTradePrice,
      hasBook: parsedOrderBook.bids.length > 0 && parsedOrderBook.asks.length > 0,
    };
    return bookContext;
  }

  private buildExchangeVenueContext(snapshot: FlatSnapshot, asset: ModelAsset, venue: ModelExchangeVenue): ModelExchangeVenueContext {
    const parsedOrderBook = this.parseOrderBook(this.readStringField(snapshot, `${asset}_${venue}_order_book_json`));
    const eventTimestamp = this.readNumberField(snapshot, `${asset}_${venue}_event_ts`);
    const fallbackPrice = this.readNumberField(snapshot, `${asset}_${venue}_price`);
    const bestBid = parsedOrderBook.bids.at(0) || null;
    const bestAsk = parsedOrderBook.asks.at(0) || null;
    const venueContext: ModelExchangeVenueContext = {
      venue,
      bid: bestBid?.price || null,
      ask: bestAsk?.price || null,
      mid: bestBid !== null && bestAsk !== null ? (bestBid.price + bestAsk.price) / 2 : fallbackPrice,
      spread: bestBid !== null && bestAsk !== null ? bestAsk.price - bestBid.price : 0,
      depth1: this.computeDepth(parsedOrderBook.bids, 1) + this.computeDepth(parsedOrderBook.asks, 1),
      depth3: this.computeDepth(parsedOrderBook.bids, 3) + this.computeDepth(parsedOrderBook.asks, 3),
      imbalance1: this.computeImbalance(parsedOrderBook.bids, parsedOrderBook.asks, 1),
      imbalance3: this.computeImbalance(parsedOrderBook.bids, parsedOrderBook.asks, 3),
      staleMs: eventTimestamp === null ? Number.POSITIVE_INFINITY : snapshot.generated_at - eventTimestamp,
      hasPrice: fallbackPrice !== null || (bestBid !== null && bestAsk !== null),
      hasBook: parsedOrderBook.bids.length > 0 && parsedOrderBook.asks.length > 0,
    };
    return venueContext;
  }

  private buildVenueAggregation(venueStates: Record<ModelExchangeVenue, ModelExchangeVenueContext>): VenueAggregation {
    const venueAggregation = Object.values(venueStates).reduce<VenueAggregation>(
      (aggregation, venueState) => {
        const venueWeight = venueState.mid === null ? 0 : 1 / (1 + Math.max(0, venueState.staleMs / 1_000));

        if (venueState.mid !== null) {
          aggregation.priceWeightedSum += venueState.mid * venueWeight;
          aggregation.weightSum += venueWeight;
          aggregation.validPriceCount += 1;
          aggregation.bestStaleMs = Math.min(aggregation.bestStaleMs, venueState.staleMs);
          aggregation.staleValues.push(venueState.staleMs);
          aggregation.dispersionInputs.push(Math.log(venueState.mid));
        }

        if (venueState.hasBook) {
          aggregation.spreadValues.push(venueState.spread);
          aggregation.spreadWeightedSum += venueState.spread * venueWeight;
          aggregation.depth3WeightedSum += venueState.depth3 * venueWeight;
          aggregation.imbalance1WeightedSum += venueState.imbalance1 * venueWeight;
          aggregation.imbalance3WeightedSum += venueState.imbalance3 * venueWeight;
          aggregation.validBookCount += 1;
        }

        return aggregation;
      },
      {
        bestStaleMs: Number.POSITIVE_INFINITY,
        depth3WeightedSum: 0,
        dispersionInputs: [],
        imbalance1WeightedSum: 0,
        imbalance3WeightedSum: 0,
        priceWeightedSum: 0,
        spreadValues: [],
        spreadWeightedSum: 0,
        staleValues: [],
        validBookCount: 0,
        validPriceCount: 0,
        weightSum: 0,
      },
    );
    return venueAggregation;
  }

  private computeMedian(values: number[]): number {
    const sortedValues = [...values].sort((leftValue, rightValue) => leftValue - rightValue);
    const middleIndex = Math.floor(sortedValues.length / 2);
    let medianValue = 0;

    if (sortedValues.length > 0) {
      medianValue =
        sortedValues.length % 2 === 0 ? ((sortedValues[middleIndex - 1] || 0) + (sortedValues[middleIndex] || 0)) / 2 : sortedValues[middleIndex] || 0;
    }

    return medianValue;
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

  private buildAssetContext(snapshot: FlatSnapshot, asset: ModelAsset): ModelAssetContext {
    const venueStates = EXCHANGE_NAMES.reduce<Record<ModelExchangeVenue, ModelExchangeVenueContext>>(
      (registry, venue) => {
        registry[venue] = this.buildExchangeVenueContext(snapshot, asset, venue);
        return registry;
      },
      {} as Record<ModelExchangeVenue, ModelExchangeVenueContext>,
    );
    const venueAggregation = this.buildVenueAggregation(venueStates);
    const assetContext: ModelAssetContext = {
      chainlinkPrice: this.readNumberField(snapshot, `${asset}_chainlink_price`),
      chainlinkStaleMs: this.buildChainlinkStaleMs(snapshot, asset),
      exchangePrice: venueAggregation.weightSum === 0 ? null : venueAggregation.priceWeightedSum / venueAggregation.weightSum,
      exchangeSpreadMedian: this.computeMedian(venueAggregation.spreadValues),
      exchangeSpreadWeightedMean: venueAggregation.weightSum === 0 ? 0 : venueAggregation.spreadWeightedSum / venueAggregation.weightSum,
      exchangeDepth3WeightedMean: venueAggregation.weightSum === 0 ? 0 : venueAggregation.depth3WeightedSum / venueAggregation.weightSum,
      exchangeImbalance1WeightedMean: venueAggregation.weightSum === 0 ? 0 : venueAggregation.imbalance1WeightedSum / venueAggregation.weightSum,
      exchangeImbalance3WeightedMean: venueAggregation.weightSum === 0 ? 0 : venueAggregation.imbalance3WeightedSum / venueAggregation.weightSum,
      exchangeDispersionLog: this.computeStandardDeviation(venueAggregation.dispersionInputs),
      exchangeBestStaleMs: Number.isFinite(venueAggregation.bestStaleMs) ? venueAggregation.bestStaleMs : Number.POSITIVE_INFINITY,
      exchangeMeanStaleMs: this.computeMean(venueAggregation.staleValues),
      exchangeValidPriceCount: venueAggregation.validPriceCount,
      exchangeValidBookCount: venueAggregation.validBookCount,
      venueStates,
    };
    return assetContext;
  }

  private buildChainlinkStaleMs(snapshot: FlatSnapshot, asset: ModelAsset): number {
    const eventTimestamp = this.readNumberField(snapshot, `${asset}_chainlink_event_ts`);
    const chainlinkStaleMs = eventTimestamp === null ? Number.POSITIVE_INFINITY : snapshot.generated_at - eventTimestamp;
    return chainlinkStaleMs;
  }

  private buildActiveMarket(
    snapshot: FlatSnapshot,
    asset: ModelAsset,
    window: ModelWindow,
    upBook: ModelBookContext,
    downBook: ModelBookContext,
  ): ModelActiveMarket | null {
    const slug = this.readStringField(snapshot, `${asset}_${window}_slug`);
    const marketStart = this.readStringField(snapshot, `${asset}_${window}_market_start`);
    const marketEnd = this.readStringField(snapshot, `${asset}_${window}_market_end`);
    const activeMarket =
      slug !== null && marketStart !== null && marketEnd !== null
        ? {
            slug,
            marketStart,
            marketEnd,
            priceToBeat: this.readNumberField(snapshot, `${asset}_${window}_price_to_beat`),
            upTokenId: upBook.tokenId,
            downTokenId: downBook.tokenId,
          }
        : null;
    return activeMarket;
  }

  private buildMarketContext(snapshot: FlatSnapshot, asset: ModelAsset, window: ModelWindow): ModelMarketContext {
    const upParsedOrderBook = this.parseOrderBook(this.readStringField(snapshot, `${asset}_${window}_up_order_book_json`));
    const downParsedOrderBook = this.parseOrderBook(this.readStringField(snapshot, `${asset}_${window}_down_order_book_json`));
    const upBook = this.buildBookContext(snapshot, `${asset}_${window}_up_price`, `${asset}_${window}_up_event_ts`, upParsedOrderBook);
    const downBook = this.buildBookContext(snapshot, `${asset}_${window}_down_price`, `${asset}_${window}_down_event_ts`, downParsedOrderBook);
    const marketContext: ModelMarketContext = {
      modelKey: this.buildModelKey(asset, window),
      asset,
      window,
      activeMarket: this.buildActiveMarket(snapshot, asset, window, upBook, downBook),
      upBook,
      downBook,
      parityGap: (upBook.mid || 0) + (downBook.mid || 0) - 1,
    };
    return marketContext;
  }

  private buildSnapshotContext(snapshot: FlatSnapshot): ModelSnapshotContext {
    const snapshotContext: ModelSnapshotContext = {
      generatedAt: snapshot.generated_at,
      assetContexts: this.supportedAssets.reduce<Record<ModelAsset, ModelAssetContext>>(
        (registry, asset) => {
          registry[asset] = this.buildAssetContext(snapshot, asset);
          return registry;
        },
        {} as Record<ModelAsset, ModelAssetContext>,
      ),
      marketContexts: this.supportedAssets.reduce<Record<ModelKey, ModelMarketContext>>(
        (registry, asset) => {
          this.supportedWindows.forEach((window) => {
            registry[this.buildModelKey(asset, window)] = this.buildMarketContext(snapshot, asset, window);
          });
          return registry;
        },
        {} as Record<ModelKey, ModelMarketContext>,
      ),
    };
    return snapshotContext;
  }

  /**
   * @section public:methods
   */

  public buildSnapshotContexts(snapshots: FlatSnapshot[]): ModelSnapshotContext[] {
    const snapshotContexts = snapshots.map((snapshot) => this.buildSnapshotContext(snapshot));
    return snapshotContexts;
  }

  public isChainlinkFresh(assetContext: ModelAssetContext): boolean {
    const isChainlinkFresh = assetContext.chainlinkStaleMs <= this.chainlinkStaleMs;
    return isChainlinkFresh;
  }

  public isOrderBookFresh(marketContext: ModelMarketContext): boolean {
    const isOrderBookFresh = marketContext.upBook.staleMs <= this.polymarketStaleMs && marketContext.downBook.staleMs <= this.polymarketStaleMs;
    return isOrderBookFresh;
  }
}
