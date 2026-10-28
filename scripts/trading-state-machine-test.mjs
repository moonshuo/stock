import assert from "node:assert/strict";
import config from "../data/trading_config.json" with { type: "json" };
import { buildTradePlan } from "../lib/trading/action-state-machine.js";

const stocks = {
  emotion_leader: [{ code: "000001", name: "测试龙头" }],
  trend_leader: [],
  capacity_core: [{ code: "000002", name: "测试中军" }],
  high_elasticity_stocks: [{ code: "300001", name: "测试弹性" }],
};
const theme = (overrides = {}) => ({
  primary: "测试一级题材", name: "测试二级方向", status: "confirmed_mainline",
  breadth: { valid_member_count: 8, up_ratio: 0.72 }, core_stocks: stocks,
  core_structure_evidence: { cache_ready: true },
  cycle_stage: {
    cycle_stage: "fermentation", previous_stage: "emergence", stage_confidence: "medium",
    expansion_status: "expanding", profit_effect_status: "improving",
    core_status: { combined: "leader_up_core_up" }, positive_signals: ["持续扩散"], warning_signals: [],
  },
  ...overrides,
});
const planFor = (row, mainlineEligible = true) => buildTradePlan({ date: "2026-01-19", mainline_eligible: mainlineEligible, themes: [row] }, config).themes[0];

// 启动期在尚无赚钱效应验证时，严格只观察。
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "emergence", previous_stage: "unknown", stage_confidence: "low", expansion_status: "expanding", profit_effect_status: "unavailable", core_status: { combined: "leader_up_core_up" } } })).theme_action, "watch");
assert.equal(planFor(theme()).theme_action, "entry_candidate");
assert.equal(buildTradePlan({ date: "2026-01-19", mainline_eligible: true, themes: [theme()] }, config, { previous_actions: { "测试一级题材/测试二级方向": "no_trade" } }).themes[0].theme_action, "entry_candidate");
assert.notEqual(planFor(theme({ cycle_stage: { cycle_stage: "fermentation", previous_stage: "emergence", stage_confidence: "medium", expansion_status: "expanding", profit_effect_status: "improving", core_status: { combined: "leader_weak_core_stable" } } })).theme_action, "entry_candidate");
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "acceleration", previous_stage: "fermentation", stage_confidence: "medium", expansion_status: "expanding", profit_effect_status: "improving", core_status: { combined: "leader_up_core_up" } } })).theme_action, "hold");
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "strong_divergence", previous_stage: "normal_divergence", stage_confidence: "medium", expansion_status: "shrinking", profit_effect_status: "deteriorating", core_status: { combined: "leader_weak_core_stable" } } })).theme_action, "reduce");
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "retreat_confirmed", previous_stage: "strong_divergence", stage_confidence: "medium", expansion_status: "rapidly_shrinking", profit_effect_status: "collapsed", core_status: { leader: "weakening", capacity_core: "breaking_down", combined: "leader_down_core_down" } } })).theme_action, "exit");
assert.equal(planFor(theme(), false).theme_action, "no_trade");
assert.equal(planFor(theme({ core_stocks: { ...stocks, emotion_leader: [], trend_leader: [] } })).theme_action, "no_trade");
// 龙头强但中军走弱：不准生成主买入候选。
assert.notEqual(planFor(theme({ cycle_stage: { cycle_stage: "fermentation", previous_stage: "emergence", stage_confidence: "medium", expansion_status: "stable", profit_effect_status: "healthy", core_status: { leader: "strengthening", capacity_core: "breaking_down", combined: "leader_up_core_weak" } } })).theme_action, "entry_candidate");
// 后排赚钱效应崩塌时，不能把发酵误判成健康持有。
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "fermentation", previous_stage: "emergence", stage_confidence: "medium", expansion_status: "stable", profit_effect_status: "collapsed", core_status: { leader: "strengthening", capacity_core: "stable", combined: "leader_up_core_weak" } } })).theme_action, "reduce");
// 首次良性分歧后的集体修复；无持仓为进场候选，有持仓才允许加仓候选。
const repair = theme({ cycle_stage: { cycle_stage: "repair", previous_stage: "normal_divergence", stage_confidence: "medium", expansion_status: "expanding", profit_effect_status: "improving", core_status: { leader: "strengthening", capacity_core: "trend_strengthening", combined: "leader_up_core_up" } } });
assert.equal(planFor(repair).theme_action, "entry_candidate");
assert.equal(buildTradePlan({ date: "2026-01-19", mainline_eligible: true, themes: [repair] }, config, { held_theme_keys: ["测试一级题材/测试二级方向"] }).themes[0].theme_action, "add_candidate");
// 只有旧龙头反包而没有集体修复时只观察。
assert.equal(planFor(theme({ cycle_stage: { cycle_stage: "normal_divergence", previous_stage: "acceleration", stage_confidence: "medium", expansion_status: "stable", profit_effect_status: "healthy", core_status: { leader: "strengthening", capacity_core: "stable", combined: "leader_up_core_weak" } } })).theme_action, "watch");
// 中军跌破角色结构时，角色级输出必须降级或退出。
const brokenCore = planFor(theme({ cycle_stage: { cycle_stage: "strong_divergence", previous_stage: "normal_divergence", stage_confidence: "medium", expansion_status: "shrinking", profit_effect_status: "deteriorating", core_status: { leader: "strengthening", capacity_core: "breaking_down", combined: "leader_up_core_weak" } } }));
assert.equal(brokenCore.eligible_stocks.find((stock) => stock.role === "capacity_core").stock_action, "reduce");
const generated = buildTradePlan({ date: "2026-01-19", mainline_eligible: true, themes: [theme()] }, config);
assert.equal(generated.available_data_end_date, "2026-01-19");
assert.equal(generated.action_for_date, "2026-01-20");
assert.equal(generated.mode, "end_of_day");
assert.equal(generated.action_for, "next_trading_day");
assert.ok(generated.themes[0].scores.same_day_opportunity_score >= 0);
assert.ok(generated.themes[0].scores.historical_base_score >= 0);
assert.equal(generated.position_size_status, "user_configuration_required");
assert.ok(generated.themes[0].eligible_stocks.every((stock) => stock.invalidation_conditions.length > 0));
console.log("trading-state-machine-test: 17 scenarios passed");
