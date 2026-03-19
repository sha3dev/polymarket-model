/**
 * @section imports:internals
 */

import config from "../config.ts";
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
  fromDate: string;
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
      const response = await this.fetcher(this.buildUrl(pathname, searchParams));

      if (!response.ok) {
        throw new Error(`collector request failed with status ${response.status} for ${pathname}`);
      }

      payload = (await response.json()) as TPayload;
      this.setCachedPayload(cacheKey, payload);
    }

    return structuredClone(payload);
  }

  private buildSnapshotSearchParams(query: CollectorSnapshotQuery, cursorFromDate: string, pageLimit: number): URLSearchParams {
    const searchParams = new URLSearchParams();

    searchParams.set("fromDate", cursorFromDate);
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

  /**
   * @section public:methods
   */

  public async listMarkets(): Promise<CollectorMarketSummary[]> {
    const payload = await this.readJson<CollectorMarketPayload>("/markets", new URLSearchParams());
    const markets = payload.markets;
    return markets;
  }

  public async readSnapshots(query: CollectorSnapshotQuery): Promise<FlatSnapshot[]> {
    let cursorFromDate = query.fromDate;
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
}
