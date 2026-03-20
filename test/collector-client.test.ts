import * as assert from "node:assert/strict";
import { test } from "node:test";

import { CollectorClientService } from "../src/collector/collector-client.service.ts";

test("CollectorClientService caches repeated requests and paginates snapshots", async () => {
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("/markets")) {
      return new Response(JSON.stringify({ markets: [{ slug: "btc-up-5m" }] }), { status: 200 });
    }

    if (url.includes("fromDate=2025-01-01T00%3A00%3A00.000Z")) {
      return new Response(
        JSON.stringify({
          snapshots: [{ generated_at: Date.parse("2025-01-01T00:00:00.000Z") }, { generated_at: Date.parse("2025-01-01T00:00:01.000Z") }],
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        snapshots: [{ generated_at: Date.parse("2025-01-01T00:00:02.000Z") }],
      }),
      { status: 200 },
    );
  };
  const collectorClientService = new CollectorClientService({
    baseUrl: "http://collector.local",
    cacheTtlMs: 60_000,
    pageLimit: 2,
    fetcher,
  });

  const firstMarkets = await collectorClientService.listMarkets();
  const secondMarkets = await collectorClientService.listMarkets();
  const snapshots = await collectorClientService.readSnapshots({
    fromDate: "2025-01-01T00:00:00.000Z",
    toDate: "2025-01-01T00:00:03.000Z",
  });

  assert.deepEqual(firstMarkets, [{ slug: "btc-up-5m" }]);
  assert.deepEqual(secondMarkets, [{ slug: "btc-up-5m" }]);
  assert.equal(requestedUrls.filter((url) => url.includes("/markets")).length, 1);
  assert.equal(requestedUrls.filter((url) => url.includes("/snapshots")).length, 2);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.generated_at),
    [Date.parse("2025-01-01T00:00:00.000Z"), Date.parse("2025-01-01T00:00:01.000Z"), Date.parse("2025-01-01T00:00:02.000Z")],
  );
});

test("CollectorClientService retries transient snapshot failures", async () => {
  let requestCount = 0;
  const collectorClientService = new CollectorClientService({
    baseUrl: "http://collector.local",
    cacheTtlMs: 60_000,
    pageLimit: 2,
    fetcher: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return new Response(JSON.stringify({ error: "busy" }), { status: 500 });
      }

      return new Response(
        JSON.stringify({
          snapshots: [{ generated_at: Date.parse("2025-01-01T00:00:00.000Z") }],
        }),
        { status: 200 },
      );
    },
  });

  const snapshots = await collectorClientService.readSnapshotPage({
    fromDate: "2025-01-01T00:00:00.000Z",
    toDate: "2025-01-01T00:00:10.000Z",
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(snapshots, [{ generated_at: Date.parse("2025-01-01T00:00:00.000Z") }]);
});
