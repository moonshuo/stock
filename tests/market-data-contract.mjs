import assert from "node:assert/strict";
import { ensureMarketData, getMarketData, getMarketDataBatch, hasLocalMarketData, MARKET_DATA_KINDS, MARKET_DATA_SOURCES, registerMarketDataType } from "../lib/market-data.js";

assert.ok(MARKET_DATA_KINDS.includes("daily_turnover_rate"));
assert.ok(!MARKET_DATA_KINDS.includes("historical_market_cap"), "不得保留以当前股本估算历史市值的数据入口");
assert.deepEqual(MARKET_DATA_SOURCES.daily_turnover_rate, ["tonghuashun", "eastmoney", "sohu"]);
await assert.rejects(getMarketData({ kind: "unknown", date: "2026-02-09", code: "1" }), /Unsupported/);
await assert.rejects(getMarketData({ kind: "daily_turnover", date: "2026-02-09", code: "not-a-code" }), /valid A-share code/);
let calls = 0;
const adapters = {
  daily_turnover: async ({ code, date }) => { calls += 1; return { code, date, amount: 100, source: "test_source", cached: false }; },
};
const item = await getMarketData({ kind: "daily_turnover", date: "2026-02-09", code: 1, adapters });
assert.deepEqual(item, { code: "000001", date: "2026-02-09", amount: 100, source: "test_source", cached: false, cache_status: "miss" });
const batch = await getMarketDataBatch({ kind: "daily_turnover", date: "2026-02-09", members: [{ code: "000001" }, { code: "600000" }], adapters, concurrency: 1 });
assert.equal(calls, 3);
assert.equal(batch.get("600000").source, "test_source");
await assert.rejects(getMarketData({ kind: "daily_turnover", date: "1900-01-01", code: "000001", localOnly: true, adapters }), /local cache unavailable/);
assert.equal(calls, 3, "localOnly cache miss must not invoke any source adapter");
let duplicatedCalls = 0;
const dedupeAdapters = { daily_turnover: async ({ code, date }) => { duplicatedCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { code, date, amount: 1, source: "test_source" }; } };
await Promise.all(Array.from({ length: 8 }, () => getMarketData({ kind: "daily_turnover", date: "2026-02-10", code: "000001", adapters: dedupeAdapters })));
assert.equal(duplicatedCalls, 1, "identical concurrent cache misses must share one provider request");
let localRecord = null;
registerMarketDataType("test_dataset", {
  readLocal: async () => localRecord,
  fetchAndCache: async ({ code }) => { localRecord = { code, value: 1 }; return localRecord; },
});
assert.equal(await hasLocalMarketData({ kind: "test_dataset", code: "000001" }), false);
assert.equal((await ensureMarketData({ kind: "test_dataset", key: "test|000001", code: "000001" })).cache_status, "miss");
assert.equal(await hasLocalMarketData({ kind: "test_dataset", code: "000001" }), true);
console.log("market data contract passed");
