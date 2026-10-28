import assert from "node:assert/strict";
import { scoreMainline } from "../lib/mainline.js";

// recentDailyStrength yields 0, 50 and 100 for these three observations.
// Any earlier observation must not affect the three-day recent-strength score.
const dailyStrength = (themeRelativeReturn) => ({ metrics: { theme_relative_return: themeRelativeReturn } });
const latestThree = [dailyStrength(-10), dailyStrength(0), dailyStrength(10)];
const withOlderHistory = { score_history: [dailyStrength(10), dailyStrength(10), ...latestThree] };
const result = scoreMainline(withOlderHistory);

assert.equal(result.raw_recent_strength_score, 67.5, "近3日强度必须按由远及近 15% / 35% / 50% 加权，且忽略更早交易日");
assert.equal(result.recent_strength_score, 67.5, "无风险扣分时，审计后的近3日强度必须与原始近3日强度一致");

const twoDays = scoreMainline({ score_history: [dailyStrength(-10), dailyStrength(10)] });
assert.equal(twoDays.raw_recent_strength_score, 58.8, "不足3个交易日时必须以 35% / 50% 的相对权重归一化，不能补零或使用更早日");

const stableLatestThree = Array.from({ length: 3 }, () => ({ metrics: { theme_relative_return: 0, theme_amount_change_ratio: .1, theme_amount: 1, market_amount: 1, capacity_core_positive_weight: .5, capacity_core_return: 1, capacity_core_severe_weight: 0, negative_feedback_ratio: .1, active_member_count: 6 } }));
const weakEarlyCapital = scoreMainline({ score_history: [{ metrics: { ...stableLatestThree[0].metrics, theme_amount_change_ratio: -1 } }, { metrics: { ...stableLatestThree[0].metrics, theme_amount_change_ratio: -1 } }, ...stableLatestThree] });
const strongEarlyCapital = scoreMainline({ score_history: [{ metrics: { ...stableLatestThree[0].metrics, theme_amount_change_ratio: 1 } }, { metrics: { ...stableLatestThree[0].metrics, theme_amount_change_ratio: 1 } }, ...stableLatestThree] });
assert.equal(weakEarlyCapital.raw_recent_strength_score, strongEarlyCapital.raw_recent_strength_score, "早于近3日的行情不得影响日强度分项");
assert.notEqual(weakEarlyCapital.capital_persistence_score, strongEarlyCapital.capital_persistence_score, "资金持续认可度必须继续保留原有近5日窗口，不能随日强度窗口缩短");

console.log("mainline recent-strength window contract passed");
