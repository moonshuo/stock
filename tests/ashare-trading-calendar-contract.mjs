import assert from "node:assert/strict";
import { isChinaAShareNonTradingDay, loadChinaAShareTradingCalendar } from "../lib/ashare-trading-calendar.js";
import { loadDailyMarket } from "../app/api/daily-market/route.js";

const calendar = await loadChinaAShareTradingCalendar(2026);
assert.equal(calendar.cached, true, "committed official calendar must be used before any network request");
assert.equal(await isChinaAShareNonTradingDay("2026-04-06"), true, "Qingming closure must be treated as a non-trading day");
assert.equal(await isChinaAShareNonTradingDay("2026-04-07"), false, "first session after Qingming must remain a trading day");
const holiday = await loadDailyMarket("2026-04-06", { strictTradingDay: true });
assert.deepEqual({ status: holiday.status, source: holiday.source }, { status: 404, source: "non-trading-day" }, "history consumers must skip a known closure instead of reusing 4/3");
console.log("A-share trading calendar contract passed");
