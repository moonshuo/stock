import assert from "node:assert/strict";
import { evaluateNextDayMainlineConfirmation } from "../lib/mainline.js";

const firstDay = {
  date: "2026-10-12",
  limit_up_count: 2,
  new_first_limit_count: 2,
  theme_relative_return: 3.1,
  up_ratio: .75,
};
const nextDay = {
  date: "2026-10-13",
  profit_effect: {
    capacity_core_feedback: "mixed",
    limit_up_next_day_opening_premium_median_pct: 2.3,
    limit_up_next_day_positive_opening_rate: .75,
    limit_up_next_day_opening_sample_count: 2,
  },
};

const confirmed = evaluateNextDayMainlineConfirmation([{ metrics: firstDay }, { metrics: nextDay }]);
assert.equal(confirmed.confirmed, true, "首日相对强势、有新增首板，且次日中军无负反馈和首板多数高开时必须确认主线");
assert.equal(confirmed.status, "confirmed_mainline");

const noLimitUp = evaluateNextDayMainlineConfirmation([{ metrics: { ...firstDay, limit_up_count: 0, new_first_limit_count: 0 } }, { metrics: nextDay }]);
assert.equal(noLimitUp.confirmed, false, "首日板块内没有涨停必须直接排除确认主线");
assert.equal(noLimitUp.evidence.first_day_has_limit_up, false);

const negativeCore = evaluateNextDayMainlineConfirmation([{ metrics: firstDay }, { metrics: { ...nextDay, profit_effect: { ...nextDay.profit_effect, capacity_core_feedback: "negative" } } }]);
assert.equal(negativeCore.confirmed, false, "次日市值中军负反馈不能确认主线");

const flatOpening = evaluateNextDayMainlineConfirmation([{ metrics: firstDay }, { metrics: { ...nextDay, profit_effect: { ...nextDay.profit_effect, limit_up_next_day_opening_premium_median_pct: 0, limit_up_next_day_positive_opening_rate: .5 } } }]);
assert.equal(flatOpening.confirmed, false, "首板未获得多数高开溢价不能确认主线");
