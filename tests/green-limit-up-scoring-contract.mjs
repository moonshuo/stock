import assert from "node:assert/strict";
import { downsideAcceptancePressure, scoreGreenLimitUpCandidates, trendScore, weightedRecentTurnover } from "../app/lib/greenLimitUpScoring.js";

const rising = Array.from({ length: 20 }, (_, index) => 10 + index * .1);
assert.equal(trendScore({ price: 11.45, closes: rising }).score, 100);
assert.ok(trendScore({ price: 11.3, closes: [...rising.slice(0, 18), 11.6, 11.3] }).down_close_streak >= 2, "连续小幅回调仅作为承接分析证据，不能直接删除");
assert.equal(weightedRecentTurnover([1, 1, 1, 1, 11]), 13 / 3, "最近日换手率权重必须最高");
assert.ok(downsideAcceptancePressure({ recentBars: [{ price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 9, preClose: 10 }], turnoverRates: [1, 1, 1, 1, 10] }) > downsideAcceptancePressure({ recentBars: [{ price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 10, preClose: 10 }, { price: 9.8, preClose: 10 }], turnoverRates: [1, 1, 1, 1, 1] }), "跌幅更小且换手更低必须形成更低压力");

const commonBars = Array.from({ length: 20 }, () => ({ price: 10, preClose: 10, vol: 100 }));
const result = scoreGreenLimitUpCandidates([
  { code: "600001", name: "低换手", price: 10, preClose: 10, bars: commonBars, turnover_rates: [1, 1, 1, 1, 1] },
  { code: "600002", name: "高换手", price: 10, preClose: 10, bars: commonBars.map((bar, index) => index === 9 ? { ...bar, price: 9, vol: 500 } : bar), turnover_rates: [1, 1, 1, 1, 11] },
  { code: "600003", name: "缺数据", price: 10, preClose: 10, bars: commonBars, turnover_rates: [1, null, 1, 1, 1] },
]);
assert.equal(result.scored.length, 2, "仅完整换手率样本可以进入总分");
assert.equal(result.scored[0].code, "600001", "低换手且无下跌放量的股票必须得分更高");
assert.deepEqual(result.unavailable, [{ code: "600003", name: "缺数据", missing_data: ["近 5 日真实换手率", "10 日成交量"], turnover_errors: [] }]);
console.log("green limit-up scoring contract passed");
