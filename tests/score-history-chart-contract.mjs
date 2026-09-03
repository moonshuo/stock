import assert from "node:assert/strict";
import { buildScoreHistoryChart, scoreHistoryLineSegments } from "../app/lib/scoreHistoryChart.js";

const chart = buildScoreHistoryChart([
  { date: "2026-08-05", score: { mainline_rank_score: 54 }, daily_strength_score: 49.2 },
  { date: "2026-08-03", score: { mainline_rank_score: 64.9 }, daily_strength_score: 83.9 },
  { date: "2026-08-04", score: { mainline_rank_score: null }, daily_strength_score: 47.9 },
]);

assert.deepEqual(chart.points.map((point) => point.date), ["2026-08-03", "2026-08-04", "2026-08-05"], "图表必须按交易日排序");
assert.equal(chart.points[1].score, null, "缺失综合分不能被转换为 0 分");
assert.equal(chart.points[1].dailyStrength, 47.9, "另一条有效序列应继续保留");
assert.equal(scoreHistoryLineSegments(chart.points, "scoreY").length, 2, "缺失交易日必须断开折线，不能伪造连续变化");
assert.equal(scoreHistoryLineSegments(chart.points, "dailyStrengthY").length, 1, "完整序列应保持连续");
assert.ok(chart.points[0].x < chart.points[1].x && chart.points[1].x < chart.points[2].x, "横轴必须随交易日递增");

console.log("score history chart contract passed");
