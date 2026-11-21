import assert from "node:assert/strict";
import config from "../data/strong_pullback_config.json" with { type: "json" };
import { boundedRatioScore, pullbackPriceScore, scoreStrongPullback, validateStrongPullbackConfig } from "../lib/strong-pullback/scoring.js";

assert.ok(boundedRatioScore(0.8) > boundedRatioScore(2), "缩量回调应明显优于 2 倍放量回调");
assert.ok(boundedRatioScore(0.65) > boundedRatioScore(0.05), "极端缩量不得获得无限或最高加分");
assert.ok(pullbackPriceScore(-1.5) > pullbackPriceScore(-5), "温和回调应优于深跌");
assert.ok(pullbackPriceScore(-1.5) > pullbackPriceScore(4), "回调策略不应把明显上涨日打成最佳回调");
assert.throws(() => validateStrongPullbackConfig({ ...config, weights: { ...config.weights, sector_strength: 31 } }), /合计 100/);

const rows = Array.from({ length: 62 }, (_, index) => {
  const close = 10 + index * 0.08;
  return { date: `d${String(index).padStart(2, "0")}`, open: close - 0.03, high: close + 0.1, low: close - 0.1, close, pre_close: close - 0.08, change_pct: 0.7, volume: 1_000_000 + index * 1_000, turnover_rate: 2 + index * 0.002 };
});
rows[52] = { ...rows[52], change_pct: 9.95, volume: 2_800_000 };
rows[61] = { ...rows[61], close: rows[60].close * 0.985, pre_close: rows[60].close, change_pct: -1.5, volume: 650_000, turnover_rate: 1.3 };
const complete = scoreStrongPullback({ stock: { code: "600001", name: "演示" }, rows, board: { secondary_score: 82, stale: false }, config });
assert.equal(complete.completeness.complete, true);
assert.ok(complete.score > 0 && complete.score <= 100);
assert.equal(complete.dimensions.reduce((sum, item) => sum + item.weight, 0), 100);
assert.ok(complete.selected_initiation_event?.date, "应解释所选择的启动事件");

const missingTurnover = rows.map((row) => ({ ...row, turnover_rate: null }));
const incomplete = scoreStrongPullback({ stock: { code: "600001", name: "演示" }, rows: missingTurnover, board: { secondary_score: 82, stale: false }, config });
assert.equal(incomplete.score, null, "缺失加权数据不得当作 0、最优值或通过重分配权重生成完整分");
assert.equal(incomplete.completeness.ranking_eligible, false);
assert.ok(incomplete.score_range.maximum > incomplete.score_range.minimum);

const intraday = scoreStrongPullback({ stock: { code: "600001" }, rows, board: { secondary_score: 82, stale: false }, config, mode: "intraday" });
assert.ok(intraday.completeness.issues.includes("intraday_same_time_insufficient"));
assert.equal(intraday.score, null, "盘中缺少同刻比较时只能观察，不能进入完整排名");

const comparableRows = rows.map((row, index) => index === rows.length - 1 ? { ...row, raw_volume: 650_000, intraday_same_time_comparable: true, intraday_volume_ratio: 0.72, intraday_turnover_ratio: 0.74, intraday_comparison_days: 6 } : row);
const comparableIntraday = scoreStrongPullback({ stock: { code: "600001" }, rows: comparableRows, board: { secondary_score: 82, stale: false }, config, mode: "intraday" });
assert.equal(comparableIntraday.completeness.complete, true, "历史同刻样本达到下限后应形成盘中观察分");
assert.equal(comparableIntraday.market.intraday_comparison_days, 6);

console.log("strong pullback scoring contract passed");
