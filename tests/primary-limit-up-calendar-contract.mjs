import assert from "node:assert/strict";
import { buildPrimaryLimitUpCalendar } from "../app/lib/primaryLimitUpCalendar.js";

const calendar = buildPrimaryLimitUpCalendar([
  { score_history: [{ date: "2026-10-20", metrics: { limit_up_stocks: [{ code: "600001", name: "甲", change_pct: 10 }] } }, { date: "2026-10-21", metrics: { limit_up_stocks: [{ code: "600002", name: "乙", change_pct: 9.99 }] } }] },
  { score_history: [{ date: "2026-10-20", metrics: { limit_up_stocks: [{ code: "600001", name: "甲", change_pct: 10 }, { code: "600003", name: "丙", change_pct: 20 }] } }] },
]);

assert.deepEqual(calendar, [
  { date: "2026-10-20", limit_up_stocks: [{ code: "600003", name: "丙", change_pct: 20 }, { code: "600001", name: "甲", change_pct: 10 }] },
  { date: "2026-10-21", limit_up_stocks: [{ code: "600002", name: "乙", change_pct: 9.99 }] },
], "一级日历必须按日期汇总二级方向，并对交叉归属股票去重");
console.log("primary limit-up calendar contract passed");
