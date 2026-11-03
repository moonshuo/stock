import assert from "node:assert/strict";
import { buildSecondaryRankings, buildSectorCatalog, loadMainlineSnapshotForTertiaryScores } from "../app/api/green-limit-up-selection/route.js";

let calculationCalls = 0;
const recomputed = { date: "2026-06-05", tertiary_themes: [{ key: "正式__重算" }] };
const fromCalculation = await loadMainlineSnapshotForTertiaryScores("2026-06-05", {
  calculateSnapshot: async (date) => { calculationCalls += 1; assert.equal(date, "2026-06-05"); return recomputed; },
});
assert.equal(fromCalculation, recomputed, "选股调用必须返回本次重新计算的主线结果");
assert.equal(calculationCalls, 1, "选股不能读取先前的主线磁盘结果");

const nextRun = await loadMainlineSnapshotForTertiaryScores("2026-06-05", {
  calculateSnapshot: async () => { calculationCalls += 1; return { date: "2026-06-05", tertiary_themes: [] }; },
});
assert.deepEqual(nextRun.tertiary_themes, [], "第二次选股也必须重新执行，而非返回第一次结果");
assert.equal(calculationCalls, 2, "每次选股调用都应重算主线");

const catalog = buildSectorCatalog([
  { code: "600001", total_rank: 1, scores: { total: 80 }, sector_paths: [{ primary: "工业", secondary: "专用装备", tertiary: "液压系统" }] },
  { code: "600002", total_rank: 2, scores: { total: 70 }, sector_paths: [{ primary: "工业", secondary: "专用装备", tertiary: "液压系统" }] },
  { code: "600003", total_rank: 3, scores: { total: 60 }, sector_paths: [{ primary: "能源", secondary: "储能电池", tertiary: "储能材料" }] },
]);
assert.equal(catalog.find((primary) => primary.primary === "工业").secondaries[0].rank, 1, "二级主线必须按候选股票平均总分获得全局排名");
assert.deepEqual(catalog.find((primary) => primary.primary === "工业").secondaries[0].tertiaries[0].candidate_codes, ["600001", "600002"], "API 必须随完整评分候选返回可直接渲染的二级/三级目录");
assert.deepEqual(buildSecondaryRankings([
  { code: "1", scores: { total: 80 }, sector_paths: [{ primary: "甲", secondary: "甲二级" }] },
  { code: "2", scores: { total: 70 }, sector_paths: [{ primary: "乙", secondary: "乙二级" }] },
]), [{ primary: "甲", secondary: "甲二级", candidate_count: 1, average_total_score: 80, highest_total_score: 80, rank: 1 }, { primary: "乙", secondary: "乙二级", candidate_count: 1, average_total_score: 70, highest_total_score: 70, rank: 2 }], "二级总榜必须按平均总分降序，并显式标注排名");

console.log("green-limit-up mainline cache contract passed");
