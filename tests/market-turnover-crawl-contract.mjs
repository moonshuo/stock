import assert from "node:assert/strict";
import { aggregateMarketTurnoverSeries, parseMarketKlines, sumFullMarketAmount } from "../app/api/market-turnover-history/route.js";

const market = (key, label, amount14, amount15) => parseMarketKlines({ data: { klines: [
  `2026-10-14,1,1,1,1,400000000,${amount14},0,0,0,0`,
  `2026-10-15,1,1,1,1,430000000,${amount15},0,0,0,0`,
  `2026-10-16,1,1,1,1,430000000,999999999999,0,0,0,0`,
] } }, { key, label });
const result = aggregateMarketTurnoverSeries([
  market("shanghai", "沪市", 600_000_000_000, 650_000_000_000),
  market("shenzhen", "深市", 700_000_000_000, 740_000_000_000),
  market("beijing", "北交所", 12_000_000_000, 11_000_000_000),
], 20, "2026-10-15");

assert.equal(result.length, 2);
assert.equal(result[1].date, "2026-10-15");
assert.equal(result[1].amount_yuan, 1_401_000_000_000);
assert.equal(result[1].amount_100m_yuan, 14_010, "全市场成交额必须以亿元展示，例如 14010 亿元");
assert.ok(result.every((point) => point.date <= "2026-10-15"), "截止日成交额不得使用未来行情");
assert.deepEqual(Object.keys(result[1].markets), ["shanghai", "shenzhen", "beijing"]);
assert.ok(result.every((point, index, rows) => !index || rows[index - 1].date < point.date), "成交额序列必须按日期升序");
assert.equal(sumFullMarketAmount({
  rawTotalStocks: 3_000,
  stocks: [{ amount: 600_000_000_000 }, { amount: 700_000_000_000 }],
  excludedStocks: [{ amount: 12_000_000_000 }],
}), 1_312_000_000_000, "本地全市场快照回退必须计入被市场统计排除的股票成交额");
assert.equal(sumFullMarketAmount({ rawTotalStocks: 2_999, stocks: [{ amount: 1 }], excludedStocks: [] }), null, "覆盖不足的本地快照不得冒充全市场成交额");

console.log("market turnover crawl contract passed");
