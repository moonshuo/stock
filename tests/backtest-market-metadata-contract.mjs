import assert from "node:assert/strict";
import { loadBacktestMarketMetadata, metadataFromHistoricalTurnover, persistBacktestMarketMetadata } from "../lib/backtest-market-metadata.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const actual = metadataFromHistoricalTurnover({ turnoverRate: 5, historicalQuote: { close: 10, volume: 5_000 } });
assert.deepEqual(actual, { free_float_shares: 100_000, free_float_market_cap: 1_000_000, source: "historical_daily_turnover_rate", turnover_rate: 5, historical_quote_source: "provider_daily_kline", estimated: false });
assert.equal(metadataFromHistoricalTurnover({ turnoverRate: 5, historicalQuote: { close: 10 } }), null, "历史日线缺少成交量时不得以本地或当前数据估算流通股本");
assert.equal(metadataFromHistoricalTurnover({ turnoverRate: 0, historicalQuote: { close: 10, volume: 5_000 } }), null, "零换手率不能反推流通股本");
const northRareEarth = metadataFromHistoricalTurnover({ turnoverRate: 10.78, historicalQuote: { close: 56.11, volume: 3_896_265 * 100 } });
assert.ok(Math.abs(northRareEarth.free_float_market_cap / 1e8 - 2028.01) < .1, "搜狐/东财日线成交量必须先由手转换为股，再按真实换手率反推流通市值");

const resolved = await loadBacktestMarketMetadata({
  date: "2026-02-09",
  stocks: [{ code: "000001" }, { code: "600000" }, { code: "300001" }],
  market: { stocks: [{ code: "000001", price: 10, vol: 5_000 }, { code: "600000", price: 20, vol: 1_000 }] },
  loadTurnoverRate: async ({ code }) => code === "000001"
    ? { turnover_rate: 5, historical_quote: { close: 10, volume: 5_000 } }
    : { turnover_rate: 5 },
});
assert.equal(resolved.entries["000001"].estimated, false, "目标日真实日线应反推流通股本");
assert.equal(resolved.entries["600000"], undefined, "真实日线不完整时不得回退到估算市值或当前股本");
assert.deepEqual(resolved.summary, { requested: 2, historical_turnover_rate: 1, missing: 1 });

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "backtest-metadata-"));
try {
  const persisted = await persistBacktestMarketMetadata({ date: "2026-02-09", root: temporaryRoot, entries: resolved.entries });
  assert.equal(persisted, 1, "仅真实历史日线元数据可以写入缓存");
  const record = JSON.parse(await readFile(path.join(temporaryRoot, "data", "historical_market_cap", "2026-02-09", "000001.json"), "utf8"));
  assert.equal(record.estimated, false);
  assert.equal(record.market_cap_type, "historical_daily_turnover_rate");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("backtest market metadata contract passed");
