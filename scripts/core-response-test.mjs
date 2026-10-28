import assert from "node:assert/strict";
import { buildCycleMetrics } from "../lib/mainline/cycle-metrics.js";

const config = {
  active_change_pct: 2,
  high_gain_pct: 5,
  large_loss_pct: -5,
  emergence: { thresholds: { capital_activity_ratio: 1.1, capital_strengthening_ratio: 1.4, severe_breakdown_return_pct: -4 } },
};
const theme = {
  key: "test", members: [{ code: "000001" }, { code: "000002" }, { code: "000003" }],
  capacity_core_candidates: [{ code: "000001" }, { code: "000002" }],
};
const history = (finalReturns, finalAmount = 150) => Array.from({ length: 6 }, (_, index) => ({
  date: `2026-01-0${index + 1}`,
  stocks: [
    { code: "000001", changePct: index === 5 ? finalReturns[0] : 0.5, amount: index === 5 ? finalAmount : 100 },
    { code: "000002", changePct: index === 5 ? finalReturns[1] : 0.4, amount: index === 5 ? finalAmount : 100 },
    { code: "000003", changePct: index === 5 ? 5 : 0.3, amount: 80 },
  ],
}));

let last = buildCycleMetrics([theme], history([2, 3]), config).get("test").at(-1);
assert.equal(last.capacity_core_status, "core_strengthening");
assert.equal(last.capacity_core_response_confirmed, true);
assert.equal(last.capacity_core_capital_activity_confirmed, true);
assert.equal(last.capacity_core_price_response_positive, true);

last = buildCycleMetrics([theme], history([-5, -6], 160), config).get("test").at(-1);
assert.equal(last.capacity_core_status, "core_severe_breakdown");
assert.equal(last.capacity_core_response_confirmed, false);
console.log("core-response-test: capital, price and severe-divergence rules passed");
