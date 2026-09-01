import assert from "node:assert/strict";
import { loadMainlineHistory } from "../lib/mainline.js";

const requested = [];
const loadDailyMarket = async (date) => {
  requested.push(date);
  return date === "2026-08-10" ? { error: "missing" } : { date, totalStocks: 5000, stocks: [] };
};

const history = await loadMainlineHistory("2026-08-14", loadDailyMarket, {
  history_start_date: "2026-08-01",
  window_days: 10,
});

assert.deepEqual(requested, ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
assert.deepEqual(history.days.map((day) => day.date), ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
assert.deepEqual(history.skipped, [{ date: "2026-08-10", reason: "missing" }]);
console.log("mainline history range contract passed");
