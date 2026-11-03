import assert from "node:assert/strict";
import { finalizeQfqHydrationJob, selectCandidatesByUptrendScore, trendAsOfDate, upperShadowTurnoverDates } from "../app/api/green-limit-up-selection/route.js";

const candidates = [
  { code: "600667", name: "太极实业" },
  { code: "600001", name: "恰好六十分" },
  { code: "600002", name: "缺失评分" },
];
const scores = [
  { code: "600667", trend_score: 76.6, ma_score: 25, structure_score: 20, persistence_score: 19.6, stability_score: 10, volume_score: 2, reason: "持续上涨", evidence: { ma: { ma5: 16, ma10: 14.292, ma20: 13.4 } } },
  { code: "600001", trend_score: 60, missing_data: [] },
  { code: "600002", trend_score: null, missing_data: ["volume"] },
];
const result = selectCandidatesByUptrendScore(candidates, scores);

assert.deepEqual(result.candidates.map((candidate) => candidate.code), ["600667"], "只有上涨趋势分严格大于 60 的股票可以通过初筛");
assert.equal(result.candidates[0].uptrend.score, 76.6, "后续综合评分必须接收新趋势分，而不是旧 MA10 偏离分");
assert.equal(result.candidates[0].uptrend.ma10, 14.292, "页面审计信息必须保留新评分的均线证据");
assert.deepEqual(result.unavailable, [{ code: "600002", name: "缺失评分", missing_data: ["volume"] }], "缺失关键数据必须被显式报告，不能回退到旧评分");
assert.deepEqual(upperShadowTurnoverDates(["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15"]), ["2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15"], "上影线近三日的每一天只能使用此前五个交易日换手率，不能读取未来数据");
assert.equal(finalizeQfqHydrationJob({ total: 2 }, [{ ok: true }, { ok: true }]).state, "complete", "全部候选完成双源核验才可标记为完成");
assert.equal(finalizeQfqHydrationJob({ total: 2 }, [{ ok: true }, { ok: false }]).state, "partial", "部分候选缺少完整前复权窗口时必须显式标记为部分完成");
assert.equal(finalizeQfqHydrationJob({ total: 2 }, [{ ok: false }, { ok: false }]).state, "failed", "没有任何完整前复权窗口时不能伪装为趋势评分为零");
assert.equal(trendAsOfDate({ date: "2026-11-02", snapshot: { closing_confirmed: false } }, ["2026-10-30", "2026-11-02"]), "2026-10-30", "盘中趋势只能使用上一交易日的确认收盘，绿盘条件仍可使用实时价");
assert.equal(trendAsOfDate({ date: "2026-11-02", snapshot: { closing_confirmed: true } }, ["2026-10-30", "2026-11-02"]), "2026-11-02", "收盘确认后趋势可纳入当日K线");

console.log("green-limit-up uptrend contract passed");
