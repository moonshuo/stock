import assert from "node:assert/strict";
import { GREEN_LIMIT_UP_SCORE_WEIGHTS, scoreGreenLimitUpCandidates, trendScore } from "../app/lib/greenLimitUpScoring.js";

const rising = Array.from({ length: 20 }, (_, index) => 10 + index * .1);
assert.equal(trendScore({ price: 11.45, closes: rising }).score, 100);
assert.ok(trendScore({ price: 11.3, closes: [...rising.slice(0, 18), 11.6, 11.3] }).down_close_streak >= 2, "连续小幅回调仅作为承接分析证据，不能直接删除");

const path = { primary: "测试一级", secondary: "测试二级", tertiary: "测试三级" };
const result = scoreGreenLimitUpCandidates([
  { code: "600001", name: "三级更强", uptrend: { score: 70 }, tertiary_score: { score: 90, ...path }, sector_paths: [path] },
  { code: "600002", name: "趋势更强", uptrend: { score: 90 }, tertiary_score: { score: 0, ...path } },
  { code: "600003", name: "缺三级数据", uptrend: { score: 80 } },
]);
assert.deepEqual(GREEN_LIMIT_UP_SCORE_WEIGHTS, { trend: .8, tertiary: .2 }, "综合分必须为趋势 80%、近 5 日三级评分 20%");
assert.equal(result.scored.length, 2, "只有趋势和完整三级评分都存在时才能计算总分");
assert.equal(result.scored[0].code, "600001", "三级评分只能占 20%，但应参与总分排序");
for (const stock of result.scored) assert.equal(stock.scores.total, stock.scores.trend.score * .8 + stock.scores.tertiary.score * .2, "综合分必须使用 80/20 权重");
assert.deepEqual(result.scored.find((stock) => stock.code === "600001").sector_paths, [path], "候选输出必须保留二级/三级路径，供目录筛选使用");
assert.deepEqual(result.unavailable, [{ code: "600003", name: "缺三级数据", missing_data: ["近 5 日三级板块综合评分"] }]);
console.log("green limit-up scoring contract passed");
