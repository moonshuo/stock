import assert from "node:assert/strict";
import { compactMainlineResult } from "../lib/mainline-response.js";

const profitEffect = {
  evaluation_date: "2026-08-03",
  source_pool_date: "2026-07-31",
  profit_effect: "normal",
  frontline_next_day_median_return: 1.2,
  frontline_positive_rate: .75,
  active_member_next_day_median_return: .6,
  active_member_positive_rate: .6,
  limit_up_next_day_median_return: .8,
  severe_negative_rate: .1,
  leader_feedback: "positive",
  capacity_core_feedback: "mixed",
  ordinary_member_feedback: "positive",
  raw_pool_rows: Array.from({ length: 100 }, (_, index) => ({ index })),
};
const theme = {
  key: "consumer__education",
  primary: "消费",
  name: "教育服务",
  members: [{ code: "300061" }],
  score_history: [{
    date: "2026-08-03",
    score: { mainline_rank_score: 70.5, recent_strength_score: 75 },
    daily_strength_score: 59.3,
    metrics: {
      up_count: 21,
      limit_up_count: 1,
      high_gain_count: 2,
      large_loss_count: 1,
      theme_relative_return: -.64,
      previous_leaders: [{ code: "300061", name: "传智教育", change_pct: 9.99, internal: "discard" }],
      previous_capacity_cores: [{ code: "300061", name: "传智教育", change_pct: 9.99, internal: "discard" }],
      capacity_core_pool_size: 8,
      capacity_core_positive_weight: .5,
      capacity_core_pool_weighted_return: .45,
      profit_effect: profitEffect,
      raw_daily_rows: Array.from({ length: 100 }, (_, index) => ({ index })),
    },
  }],
};

const result = compactMainlineResult({ themes: [theme], all_themes: [theme], mainline: { ranked: [theme] } });
const entry = result.all_themes[0].score_history[0];

assert.equal(entry.metrics.up_count, 21);
assert.equal(entry.metrics.theme_relative_return, -.64);
assert.deepEqual(entry.metrics.previous_leaders, [{ code: "300061", name: "传智教育", change_pct: 9.99 }]);
assert.equal(entry.metrics.profit_effect.frontline_positive_rate, .75);
assert.equal(entry.metrics.profit_effect.raw_pool_rows, undefined);
assert.equal(entry.metrics.raw_daily_rows, undefined);
console.log("score-history calendar response contract passed");
