import assert from "node:assert/strict";
import { buildCycleMetrics } from "../lib/mainline/cycle-metrics.js";

const theme = {
  key: "test__previous-day-capacity-pool",
  members: ["A", "B", "C", "D"].map((code) => ({ code, name: code })),
  capacity_core_candidates: [],
};
const day = (date, changes) => ({
  date,
  stocks: Object.entries(changes).map(([code, changePct], index) => ({
    code, changePct, price: 10 + index, open: 10 + index,
    high: 10.5 + index, low: 9.5 + index, amount: 100 - index * 10,
  })),
});
const config = {
  active_change_pct: 2, high_gain_pct: 5, large_loss_pct: -5,
  core_thresholds: { capacity_core_ratio: .5 }, expansion_weights: {},
};

// There is deliberately no historical-market-cap fixture.  On T, the pool
// must assess the roles selected at T-1 instead of being erased by a missing
// same-day market-cap cache.
const rows = buildCycleMetrics([theme], [
  day("2026-04-08", { A: 1, B: 2, C: -1, D: 0 }),
  day("2026-04-09", { A: 2, B: -1, C: 3, D: 1 }),
], config).get(theme.key);

assert.equal(rows[1].capacity_core_pool_source, "previous_trading_day");
assert.deepEqual(rows[1].primary_capacity_cores.map((row) => row.code), ["A", "B"]);
assert.equal(rows[1].capacity_core_pool_size, 2);
console.log("previous-day-capacity-core-pool-test passed");