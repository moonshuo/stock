import assert from "node:assert/strict";
import { loadLocalStockKline } from "../app/api/stock-kline/route.js";

const result = await loadLocalStockKline({
  code: "002009",
  endDate: "2026-10-26",
  days: 20,
});

assert.equal(result.mode, "local_immediate");
assert.equal(result.bars.length, 20, "应可立即展示本地最近 20 个交易日");
assert.ok(result.bars.every((bar) => bar.data_status === "local_snapshot"));
assert.ok(result.bars.every((bar) => bar.date <= result.end_date), "不得读取未来日线");
assert.deepEqual([...result.bars].map((bar) => bar.date).sort(), result.bars.map((bar) => bar.date), "日K必须按日期升序返回");

console.log(`local K-line contract passed: ${result.bars.length} local bars through ${result.end_date}`);
