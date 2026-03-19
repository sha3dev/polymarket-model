export type ModelAsset = "btc" | "eth" | "sol" | "xrp";

export type ModelWindow = "5m" | "15m";

export type ModelKey = `${ModelAsset}_${ModelWindow}`;

export type ModelState = "idle" | "training" | "ready" | "error";

export type ModelFamily = "tcn";

export type ModelExchangeVenue = "binance" | "coinbase" | "kraken" | "okx";

export type ModelBookSide = "up" | "down";

export type ModelDirectionClass = 0 | 1 | 2;

export type FlatSnapshotValue = boolean | number | string | null;

export type FlatSnapshot = { generated_at: number } & Record<string, FlatSnapshotValue>;

export type CollectorMarketSummary = {
  slug: string;
  asset: ModelAsset;
  window: ModelWindow;
  priceToBeat: number | null;
  marketStart: string;
  marketEnd: string;
};

export type ModelPredictionRequest = {
  asset: ModelAsset;
  window: ModelWindow;
};

export type ModelDirectionProbability = {
  up: number;
  flat: number;
  down: number;
};

export type ModelClassSupport = {
  up: number;
  flat: number;
  down: number;
};

export type ModelMetrics = {
  trendRegressionMae: number | null;
  trendRegressionRmse: number | null;
  trendRegressionHuber: number | null;
  trendDirectionMacroF1: number | null;
  trendDirectionSupport: ModelClassSupport;
  clobRegressionMae: number | null;
  clobRegressionRmse: number | null;
  clobRegressionHuber: number | null;
  clobDirectionMacroF1: number | null;
  clobDirectionSupport: ModelClassSupport;
  sampleCount: number;
};

export type ModelActiveMarket = {
  slug: string;
  marketStart: string;
  marketEnd: string;
  priceToBeat: number | null;
  upTokenId: string | null;
  downTokenId: string | null;
};

export type ModelStatus = {
  modelKey: ModelKey;
  asset: ModelAsset;
  window: ModelWindow;
  state: ModelState;
  modelFamily: ModelFamily;
  version: number;
  persistedVersion: number;
  trendSequenceLength: number;
  clobSequenceLength: number;
  featureCountTrend: number;
  featureCountClob: number;
  lastTrainingStartedAt: string | null;
  lastTrainingCompletedAt: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  lastRestoredAt: string | null;
  trainingSampleCount: number;
  validationSampleCount: number;
  latestSnapshotAt: string | null;
  liveSnapshotCount: number;
  activeMarket: ModelActiveMarket | null;
  metrics: ModelMetrics;
  lastError: string | null;
};

export type ModelStatusPayload = {
  isTrainingCycleRunning: boolean;
  lastTrainingCycleAt: string | null;
  models: ModelStatus[];
  liveSnapshotCount: number;
  latestSnapshotAt: string | null;
};

export type ModelPredictionPayload = {
  modelKey: ModelKey;
  generatedAt: string;
  activeMarket: ModelActiveMarket | null;
  trend: {
    predictedReturn: number;
    fairUpProbability: number | null;
    probabilities: ModelDirectionProbability;
    isChainlinkFresh: boolean;
  };
  clob: {
    currentUpMid: number | null;
    predictedUpMid: number;
    edge: number | null;
    probabilities: ModelDirectionProbability;
    isOrderBookFresh: boolean;
  };
  fusion: {
    scoreUp: number | null;
    scoreDown: number | null;
    selectedScore: number | null;
    shouldTrade: boolean;
    suggestedSide: "up" | "down" | "none";
    mode: "full" | "clob_only";
    trendEdgeUp: number | null;
    trendEdgeDown: number | null;
    clobEdgeUp: number | null;
    clobEdgeDown: number | null;
    feeRateBpsUp: number | null;
    feeRateBpsDown: number | null;
    estimatedFeeUp: number | null;
    estimatedFeeDown: number | null;
    estimatedSlippageUp: number | null;
    estimatedSlippageDown: number | null;
    spreadBufferUp: number | null;
    spreadBufferDown: number | null;
    vetoes: string[];
    reasons: string[];
  };
  liveSnapshotCount: number;
};

export type ModelOrderBookLevel = {
  price: number;
  size: number;
};

export type ModelExchangeVenueContext = {
  venue: ModelExchangeVenue;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number;
  depth1: number;
  depth3: number;
  imbalance1: number;
  imbalance3: number;
  staleMs: number;
  hasPrice: boolean;
  hasBook: boolean;
};

export type ModelAssetContext = {
  chainlinkPrice: number | null;
  chainlinkStaleMs: number;
  exchangePrice: number | null;
  exchangeSpreadMedian: number;
  exchangeSpreadWeightedMean: number;
  exchangeDepth3WeightedMean: number;
  exchangeImbalance1WeightedMean: number;
  exchangeImbalance3WeightedMean: number;
  exchangeDispersionLog: number;
  exchangeBestStaleMs: number;
  exchangeMeanStaleMs: number;
  exchangeValidPriceCount: number;
  exchangeValidBookCount: number;
  venueStates: Record<ModelExchangeVenue, ModelExchangeVenueContext>;
};

export type ModelBookContext = {
  bid: number | null;
  ask: number | null;
  bidLevels: ModelOrderBookLevel[];
  askLevels: ModelOrderBookLevel[];
  mid: number | null;
  displayedPrice: number | null;
  spread: number;
  depth1: number;
  depth3: number;
  imbalance1: number;
  imbalance3: number;
  staleMs: number;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  bookHash: string | null;
  tokenId: string | null;
  lastTradePrice: number | null;
  hasBook: boolean;
};

export type ModelMarketContext = {
  modelKey: ModelKey;
  asset: ModelAsset;
  window: ModelWindow;
  activeMarket: ModelActiveMarket | null;
  upBook: ModelBookContext;
  downBook: ModelBookContext;
  parityGap: number;
};

export type ModelSnapshotContext = {
  generatedAt: number;
  assetContexts: Record<ModelAsset, ModelAssetContext>;
  marketContexts: Record<ModelKey, ModelMarketContext>;
};

export type ModelFeatureNames = {
  trendFeatures: string[];
  clobFeatures: string[];
};

export type ModelFeatureInput = {
  modelKey: ModelKey;
  asset: ModelAsset;
  window: ModelWindow;
  decisionTime: number;
  latestSnapshotAt: number;
  activeMarket: ModelActiveMarket | null;
  trendSequence: number[][];
  clobSequence: number[][];
  currentUpMid: number | null;
  currentUpBid: number | null;
  currentUpAsk: number | null;
  currentDownMid: number | null;
  currentDownBid: number | null;
  currentDownAsk: number | null;
  currentChainlinkPrice: number | null;
  currentExchangePrice: number | null;
  realizedVolatility30s: number;
  isChainlinkFresh: boolean;
  isOrderBookFresh: boolean;
  upTokenId: string | null;
  downTokenId: string | null;
  upBidLevels: ModelOrderBookLevel[];
  upAskLevels: ModelOrderBookLevel[];
  downBidLevels: ModelOrderBookLevel[];
  downAskLevels: ModelOrderBookLevel[];
};

export type ModelSequenceSample = ModelFeatureInput & {
  trendTarget: number | null;
  clobTarget: number | null;
  clobDirectionTarget: number | null;
};

export type ModelTensorflowArchitecture = {
  family: ModelFamily;
  blockCount: number;
  channelCount: number;
  dilations: number[];
  dropout: number;
  featureCount: number;
  sequenceLength: number;
};

export type ModelTensorflowHeadArtifact = {
  modelPath: string;
  featureNames: string[];
  featureMedians: number[];
  featureScales: number[];
  classWeights: [number, number, number];
  directionThreshold: number;
  architecture: ModelTensorflowArchitecture;
  targetEncoding: "identity" | "logit_probability";
};

export type ModelArtifact = {
  version: number;
  trainedAt: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastTrainWindowStart: string | null;
  lastTrainWindowEnd: string | null;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  metrics: ModelMetrics;
  trendModel: ModelTensorflowHeadArtifact;
  clobModel: ModelTensorflowHeadArtifact;
};

export type ModelPersistenceModel = {
  modelKey: ModelKey;
  artifact: ModelArtifact;
  status: ModelStatus;
};

export type ModelPersistenceSnapshot = {
  schemaVersion: number;
  lastTrainingCycleAt: string | null;
  lastTrainedSnapshotAt: string | null;
  models: ModelPersistenceModel[];
};
