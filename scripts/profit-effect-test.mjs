import assert from "node:assert/strict";
import { buildCycleMetrics } from "../lib/mainline/cycle-metrics.js";

const theme = {
  key: "test__theme",
  members: ["A", "B", "C", "D"].map((code) => ({ code, name: code })),
  capacity_core_candidates: [],
};
const day = (date, changes) => ({
  date,
  stocks: Object.entries(changes).map(([code, changePct], index) => ({
    code, changePct, price: 10 + index, open: 10 + index, high: 10.2 + index, low: 9.8 + index, amount: 100 + index * 10,
  })),
});
const config = {
  active_change_pct: 2,
  high_gain_pct: 5,
  large_loss_pct: -5,
  core_thresholds: { leader_count: 1, capacity_core_count: 2 },
  expansion_weights: {},
};
const metrics = buildCycleMetrics([theme], [
  day("2026-04-08", { A: 10, B: 6, C: 3, D: 2 }),
  day("2026-04-09", { A: 2, B: 1, C: 1, D: .5 }),
], config).get(theme.key);
const effect = metrics[1].profit_effect;

assert.equal(metrics[0].profit_effect.profit_effect, "insufficient_data");
assert.deepEqual(Object.keys(effect).filter((key) => ["evaluation_date", "source_pool_date", "profit_effect", "frontline_next_day_median_return", "frontline_positive_rate", "active_member_next_day_median_return", "active_member_positive_rate", "limit_up_next_day_median_return", "severe_negative_rate", "leader_feedback", "capacity_core_feedback", "ordinary_member_feedback", "positive_evidence", "negative_evidence", "reason"].includes(key)).length, 15);
assert.equal(effect.evaluation_date, "2026-04-09");
assert.equal(effect.source_pool_date, "2026-04-08");
assert.equal(effect.profit_effect, "strong");
assert.equal(effect.frontline_positive_rate, 1);
assert.equal(effect.active_member_positive_rate, 1);
assert.equal(effect.severe_negative_rate, 0);
assert.equal(effect.leader_feedback, "positive");
assert.match(effect.reason, /2026-04-08/);
console.log("profit-effect-test: prior-day pools and feedback output passed");
