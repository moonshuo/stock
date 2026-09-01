import assert from "node:assert/strict";
import { selectTradeMainlines } from "../lib/trade-mainline-selection.js";

const themes = [
  { primary: "低分一级", name: "低分二级", mainline_rank_score: 61, rank: 2, status: "confirmed_mainline" },
  // Old callers may still carry this legacy state.  It must no longer affect
  // selection or ordering when the comprehensive score is available.
  { primary: "高分一级", name: "高分二级", mainline_rank_score: 88, rank: 9, status: "unstarted", cycle_stage: { cycle_stage: "unstarted" } },
];

const selected = selectTradeMainlines(themes);
assert.equal(selected[0].primary, "高分一级", "一级方向必须只按综合分排序，不能因旧生命周期状态后置");
assert.equal(selected[0].name, "高分二级");
assert.equal(selected[1].primary, "低分一级");

console.log("score-only mainline selection contract passed");
