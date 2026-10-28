import assert from "node:assert/strict";
import { compactMainlineResult } from "../lib/mainline-response.js";

const stockPayload = { code: "600000", name: "测试股", change_pct: 2.5, raw_analysis: "x".repeat(100_000) };
const theme = {
  key: "测试__方向", primary: "测试", name: "方向", members: [stockPayload],
  cycle_stage: {
    confirmed_stage: "normal_divergence",
    recent_history: [{ metrics: { raw_history: "x".repeat(100_000) } }],
    timeline: [{
      date: "2026-08-03", confirmed_stage: "normal_divergence", episode_id: "episode_1",
      metrics: { up_count: 3, previous_leaders: [stockPayload], previous_capacity_cores: [stockPayload] },
    }],
  },
  score_history: [{
    date: "2026-08-03",
    score: { mainline_rank_score: 72.5 },
    daily_strength_score: 68.2,
    metrics: {
      up_count: 3,
      raw_history: "x".repeat(100_000),
      previous_leaders: [stockPayload],
      previous_capacity_cores: [stockPayload],
    },
  }],
};
const result = compactMainlineResult({ themes: [theme], all_themes: [theme], mainline: { confirmed: [theme] } });
const compact = result.all_themes[0];

assert.equal(compact.member_count, 1);
assert.equal(compact.cycle_stage, undefined, "legacy lifecycle state must not be exposed");
assert.equal(compact.score_history[0].metrics.raw_history, undefined);
assert.deepEqual(compact.score_history[0].metrics.previous_leaders, [{ code: "600000", name: "测试股", change_pct: 2.5 }]);
assert.deepEqual(compact.score_history[0].metrics.previous_capacity_cores, [{ code: "600000", name: "测试股", change_pct: 2.5 }]);
assert.ok(JSON.stringify(result).length < 5_000, "response compaction must remove raw timeline payloads");
console.log("mainline-response-test: compact transport preserves score history evidence");
