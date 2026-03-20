/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { CollectorMarketSummary, FlatSnapshot } from "../model/model.types.ts";

/**
 * @section types
 */

type CollectorClientServiceOptions = {
  baseUrl: string;
  cacheTtlMs: number;
  pageLimit: number;
  fetcher: typeof fetch;
};

type CollectorCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

type CollectorSnapshotQuery = {
  fromDate?: string;
  toDate: string;
  limit?: number;
  marketSlug?: string;
};

type CollectorSnapshotPayload = {
  snapshots: FlatSnapshot[];
};

type CollectorMarketPayload = {
  markets: CollectorMarketSummary[];
};

/**
 * @section class
 */

export class CollectorClientService {
  /**
   * @section private:attributes
   */

  private readonly baseUrl: string;

  private readonly cacheTtlMs: number;

  private readonly pageLimit: number;

  private readonly fetcher: typeof fetch;

  private readonly cacheRegistry: Map<string, CollectorCacheEntry>;

  /**
   * @section constructor
   */

  public constructor(options: CollectorClientServiceOptions) {
    this.baseUrl = options.baseUrl;
    this.cacheTtlMs = options.cacheTtlMs;
    this.pageLimit = options.pageLimit;
    this.fetcher = options.fetcher;
    this.cacheRegistry = new Map<string, CollectorCacheEntry>();
  }

  /**
   * @section factory
   */

  public static createDefault(): CollectorClientService {
    return new CollectorClientService({
      baseUrl: config.SNAPSHOT_COLLECTOR_URL,
      cacheTtlMs: config.SNAPSHOT_COLLECTOR_CACHE_TTL_MS,
      pageLimit: config.SNAPSHOT_COLLECTOR_PAGE_LIMIT,
      fetcher: fetch,
    });
  }

  /**
   * @section private:methods
   */

  private buildCacheKey(pathname: string, searchParams: URLSearchParams): string {
    const cacheKey = `${pathname}?${searchParams.toString()}`;
    return cacheKey;
  }

  private buildUrl(pathname: string, searchParams: URLSearchParams): string {
    const endpointUrl = new URL(pathname, this.baseUrl);

    endpointUrl.search = searchParams.toString();

    return endpointUrl.toString();
  }

  private getCachedPayload<TPayload>(cacheKey: string): TPayload | null {
    const cacheEntry = this.cacheRegistry.get(cacheKey) || null;
    const payload = cacheEntry !== null && cacheEntry.expiresAt > Date.now() ? (structuredClone(cacheEntry.payload) as TPayload) : null;

    if (cacheEntry !== null && cacheEntry.expiresAt <= Date.now()) {
      this.cacheRegistry.delete(cacheKey);
    }

    return payload;
  }

  private setCachedPayload(cacheKey: string, payload: unknown): void {
    this.cacheRegistry.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      payload: structuredClone(payload),
    });
  }

  private async readJson<TPayload>(pathname: string, searchParams: URLSearchParams): Promise<TPayload> {
    const cacheKey = this.buildCacheKey(pathname, searchParams);
    const cachedPayload = this.getCachedPayload<TPayload>(cacheKey);
    let payload = cachedPayload;

    if (payload === null) {
      let attempt = 1;
      let hasResolved = false;
      let lastError: Error | null = null;

      while (!hasResolved && attempt <= config.SNAPSHOT_COLLECTOR_MAX_ATTEMPTS) {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, config.SNAPSHOT_COLLECTOR_REQUEST_TIMEOUT_MS);

        try {
          const response = await this.fetcher(this.buildUrl(pathname, searchParams), {
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`collector request failed with status ${response.status} for ${pathname}`);
          }

          payload = (await response.json()) as TPayload;
          this.setCachedPayload(cacheKey, payload);
          hasResolved = true;
        } catch (error) {
          const normalizedError = error instanceof Error ? error : new Error(`collector request failed for ${pathname}`);
          const canRetry = this.isRetryableError(normalizedError) && attempt < config.SNAPSHOT_COLLECTOR_MAX_ATTEMPTS;
          lastError = normalizedError;
          logger.warn(
            `collector request issue path=${pathname} attempt=${attempt} maxAttempts=${config.SNAPSHOT_COLLECTOR_MAX_ATTEMPTS} error=${normalizedError.message}`,
          );

          if (canRetry) {
            await this.sleep(this.buildRetryDelay(attempt));
          } else {
            hasResolved = true;
          }
        } finally {
          clearTimeout(timeoutId);
        }

        attempt += 1;
      }

      if (payload === null && lastError !== null) {
        throw lastError;
      }
    }

    if (payload === null) {
      throw new Error(`collector request produced no payload for ${pathname}`);
    }

    return structuredClone(payload);
  }

  private buildSnapshotSearchParams(query: CollectorSnapshotQuery, cursorFromDate: string | null, pageLimit: number): URLSearchParams {
    const searchParams = new URLSearchParams();

    if (cursorFromDate !== null) {
      searchParams.set("fromDate", cursorFromDate);
    }

    searchParams.set("toDate", query.toDate);
    searchParams.set("limit", String(pageLimit));

    if (query.marketSlug !== undefined) {
      searchParams.set("marketSlug", query.marketSlug);
    }

    return searchParams;
  }

  private shouldContinuePaging(query: CollectorSnapshotQuery, pageLimit: number, pageSnapshots: FlatSnapshot[], lastSnapshot: FlatSnapshot | null): boolean {
    const shouldContinue =
      query.limit === undefined && pageSnapshots.length === pageLimit && lastSnapshot !== null && lastSnapshot.generated_at < new Date(query.toDate).getTime();
    return shouldContinue;
  }

  private buildRetryDelay(attempt: number): number {
    const retryDelay = config.SNAPSHOT_COLLECTOR_RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0) + Math.floor(Math.random() * 100);
    return retryDelay;
  }

  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message;
    const isRetryableStatus =
      errorMessage.includes("status 429") ||
      errorMessage.includes("status 500") ||
      errorMessage.includes("status 502") ||
      errorMessage.includes("status 503") ||
      errorMessage.includes("status 504");
    const isRetryableNetworkError = errorMessage.includes("AbortError") || errorMessage.includes("fetch") || errorMessage.includes("network");
    const isRetryableError = isRetryableStatus || isRetryableNetworkError;
    return isRetryableError;
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  /**
   * @section public:methods
   */

  public async listMarkets(): Promise<CollectorMarketSummary[]> {
    const payload = await this.readJson<CollectorMarketPayload>("/markets", new URLSearchParams());
    const markets = payload.markets;
    return markets;
  }

  public async readSnapshots(query: CollectorSnapshotQuery): Promise<FlatSnapshot[]> {
    let cursorFromDate = query.fromDate || null;
    let snapshots: FlatSnapshot[] = [];
    let isPaging = true;

    while (isPaging) {
      const pageLimit = query.limit === undefined ? this.pageLimit : Math.min(query.limit, this.pageLimit);
      const payload = await this.readJson<CollectorSnapshotPayload>("/snapshots", this.buildSnapshotSearchParams(query, cursorFromDate, pageLimit));
      const pageSnapshots = payload.snapshots;
      const lastSnapshot = pageSnapshots.at(-1) || null;

      snapshots = [...snapshots, ...pageSnapshots];
      isPaging = this.shouldContinuePaging(query, pageLimit, pageSnapshots, lastSnapshot);

      if (lastSnapshot !== null) {
        cursorFromDate = new Date(lastSnapshot.generated_at + 1).toISOString();
      }
    }

    return snapshots;
  }

  public async readSnapshotPage(query: CollectorSnapshotQuery): Promise<FlatSnapshot[]> {
    const pageLimit = query.limit === undefined ? this.pageLimit : Math.min(query.limit, this.pageLimit);
    const payload = await this.readJson<CollectorSnapshotPayload>("/snapshots", this.buildSnapshotSearchParams(query, query.fromDate || null, pageLimit));
    const snapshots = payload.snapshots;
    return snapshots;
  }
}
