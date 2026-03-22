export type ModelAsset = "btc" | "eth" | "sol" | "xrp";

export type ModelWindow = "5m" | "15m";

export type ModelKey = `${ModelAsset}_${ModelWindow}`;

export type ModelState = "error" | "idle" | "waiting" | "predicting" | "training";

export type ModelFamily = "tcn";

export type ModelExchangeVenue = "binance" | "coinbase" | "kraken" | "okx";

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
};

export type ModelDirectionProbability = {
  down: number;
  up: number;
};

export type ModelClassSupport = {
  down: number;
  up: number;
};

export type ModelHeadMetrics = {
  regressionMae: number | null;
  regressionRmse: number | null;
  regressionHuber: number | null;
  directionAccuracy: number | null;
  directionSupport: ModelClassSupport;
  sampleCount: number;
};

export type ModelPredictionSource = "automatic" | "manual";

export type ModelPredictionRecordStatus = "error" | "pending" | "resolved";

export type ModelPredictionRecord = {
  predictionId: string;
  asset: ModelAsset;
  source: ModelPredictionSource;
  status: ModelPredictionRecordStatus;
  issuedAt: string;
  resolvedAt: string | null;
  contextStartAt: string;
  contextEndAt: string;
  targetStartAt: string;
  targetEndAt: string;
  predictedDirection: "down" | "up";
  predictedReturn: number;
  predictedProbabilityUp: number | null;
  predictedProbabilityDown: number | null;
  actualDirection: "down" | "up" | null;
  actualReturn: number | null;
  isCorrect: boolean | null;
  referenceValueAtPrediction: number | null;
  referenceValueAtTargetEnd: number | null;
  upValueAtPrediction: number | null;
  downValueAtPrediction: number | null;
  upValueAtTargetEnd: number | null;
  downValueAtTargetEnd: number | null;
  errorMessage: string | null;
};

export type ModelStatus = {
  asset: ModelAsset;
  state: ModelState;
  modelFamily: ModelFamily;
  currentBlockStartAt: string | null;
  currentBlockEndAt: string | null;
  lastCollectorFromAt: string | null;
  isLiveReady: boolean;
  lastLiveSnapshotAt: string | null;
  trainingCount: number;
  lastTrainingAt: string | null;
  lastTrainingStatus: "failed" | "idle" | "ready" | "training";
  lastPredictionAt: string | null;
  lastPredictionSource: ModelPredictionSource | null;
  lastPredictionWasCorrect: boolean | null;
  rollingHitRate: number | null;
  rollingPredictionCount: number;
  rollingCorrectCount: number;
  latestPrediction: ModelPredictionRecord | null;
  lastError: string | null;
};

export type ModelStatusPayload = {
  isProcessing: boolean;
  lastHistoricalBlockCompletedAt: string | null;
  assets: ModelStatus[];
};

export type ModelPredictionPayload = {
  prediction: ModelPredictionRecord;
  liveSnapshotCount: number;
};

export type ModelPredictionRecordPayload = {
  predictions: ModelPredictionRecord[];
};

export type ModelOrderBookLevel = {
  price: number;
  size: number;
};

export type ModelActiveMarket = {
  slug: string;
  marketStart: string;
  marketEnd: string;
  priceToBeat: number | null;
  upTokenId: string | null;
  downTokenId: string | null;
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
  cryptoFeatures: string[];
};

export type ModelCryptoInput = {
  asset: ModelAsset;
  decisionTime: number;
  latestSnapshotAt: number;
  cryptoSequence: number[][];
  currentChainlinkPrice: number | null;
  currentExchangePrice: number | null;
  realizedVolatility30s: number;
  isChainlinkFresh: boolean;
};

export type ModelCryptoSample = ModelCryptoInput & {
  targetDirection: "down" | "up";
  targetReturn: number;
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

export type ModelHeadArtifact = {
  remoteModelId: string;
  featureNames: string[];
  featureMedians: number[];
  featureScales: number[];
  classWeights: [number, number];
  architecture: ModelTensorflowArchitecture;
  metrics: ModelHeadMetrics;
};

export type ModelArtifact = {
  asset: ModelAsset;
  remoteModelId: string;
  version: number;
  trainedAt: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  lastValidationWindowStart: string | null;
  lastValidationWindowEnd: string | null;
  model: ModelHeadArtifact;
};

export type ModelRuntimeStateAssetSnapshot = {
  lastCollectorFromAt: string | null;
  lastProcessedBlockStartAt: string | null;
  lastProcessedBlockEndAt: string | null;
  recentPredictionRecords: ModelPredictionRecord[];
  rollingPredictionOutcomes: boolean[];
};

export type ModelRuntimeStateSnapshot = {
  schemaVersion: number;
  assets: Record<ModelAsset, ModelRuntimeStateAssetSnapshot>;
  lastHistoricalBlockCompletedAt: string | null;
};
