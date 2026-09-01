import assert from "node:assert/strict";
import { detectCycleStage, CYCLE_STAGES } from "../lib/mainline/cycle-stage-detector.js";

const config = { stage_thresholds: { minimum_active_members: 3, acceleration_expansion: 78 }, second_wave_min_adjustment_days: 5 };
const base = { date: "2026-04-27", _valid_member_count: 8, member_count: 8, limit_up_count: 3, new_first_limit_count: 2, active_member_count: 6, up_count: 6, up_ratio: .75, high_gain_count: 3, large_loss_count: 0, effective_member_count: 3, strong_member_count: 3, same_logic_ratio: 1, dynamic_logic_unified: true, leader_or_frontline_formed: true, breadth_expansion_confirmed: true, relative_strength_score: 2, theme_relative_return: 2, relative_strength_rank: 1, _theme_count: 10, capacity_core_relative_rank: 1, _capacity_core_theme_count: 10, capacity_core_weighted_score: 80, leader_return: 4, theme_amount_change: .2, relative_strength_rank_change: 2, negative_feedback_ratio_change: 0, capacity_core_status: "synchronized_up", capacity_core_response_confirmed: true, capacity_core_return: 1.2, capacity_core_count: 3, capacity_core_up_ratio: .67, capacity_core_startup_confirmed: true, capacity_core_startup_qualified_count: 2, capacity_core_startup_required_count: 2 };
const scores = (x = {}) => ({ expansion_score: 70, core_strength_score: 75, profit_effect_score: 65, contraction_score: 20, repair_score: 70, ...x });
const run = (previous, overrides, sc = scores()) => detectCycleStage([{ ...base, date: "2026-04-26" }, { ...base, ...overrides }], sc, config, previous);

let state = run({ cycle_stage: "unstarted", episode_sequence: 0 }, {}, scores({ profit_effect_score: null }));
assert.equal(state.cycle_stage, "emergence");
assert.equal(state.first_emergence_date, "2026-04-27");
assert.ok(state.positive_evidence.length > 0);
assert.equal(state.profit_effect_status, "insufficient_data");
assert.ok(state.emergence_result.positive_evidence.some((item) => item.includes("集团共振")));
const noLimitButResonant = run({ cycle_stage: "unstarted", episode_sequence: 0 }, { limit_up_count: 0, effective_member_count: 3, high_gain_count: 2 });
assert.equal(noLimitButResonant.cycle_stage, "emergence");
const noCapacitySync = run({ cycle_stage: "unstarted", episode_sequence: 0 }, { capacity_core_status: null, capacity_core_response_confirmed: false, capacity_core_return: null, capacity_core_count: null, capacity_core_up_ratio: null });
assert.equal(noCapacitySync.cycle_stage, "unstarted");
assert.equal(noCapacitySync.emergence_result.quality, "not_emergence");
const insufficientLimits = run({ cycle_stage: "unstarted", episode_sequence: 0 }, { effective_member_count: 2, strong_member_count: 2, limit_up_count: 1 });
assert.equal(insufficientLimits.cycle_stage, "unstarted");
assert.equal(insufficientLimits.emergence_result.groupResonance, false);
const insufficientCoreMajority = run({ cycle_stage: "unstarted", episode_sequence: 0 }, { capacity_core_response_confirmed: false, capacity_core_startup_confirmed: false, capacity_core_startup_qualified_count: 1, capacity_core_startup_required_count: 2 });
assert.equal(insufficientCoreMajority.cycle_stage, "unstarted");
assert.equal(insufficientCoreMajority.emergence_result.startup_rule.capacity_core_passed, false);
const severeCoreDivergence = run({ cycle_stage: "unstarted", episode_sequence: 0 }, { capacity_core_status: "core_severe_breakdown", capacity_core_response_confirmed: false, capacity_core_return: -5, capacity_core_count: 3, capacity_core_up_ratio: 0 });
assert.equal(severeCoreDivergence.cycle_stage, "unstarted");
state = run(state, { date: "2026-05-13", limit_up_count: 0, new_first_limit_count: 0, active_member_count_change: -2, leader_return: 1 }, scores({ expansion_score: 45, contraction_score: 55 }));
assert.notEqual(state.cycle_stage, "emergence");
assert.equal(state.episode_start_date, "2026-04-27");
const repaired = run({ ...state, cycle_stage: "normal_divergence", episode_active: true }, { date: "2026-05-18", active_member_count_change: 2, theme_amount_change: .2, relative_strength_rank_change: 2 });
assert.equal(repaired.cycle_stage, "repair");
const retreat = run({ ...repaired, cycle_stage: "strong_divergence", repair_failed_days: 1 }, { date: "2026-07-07", leader_return: -6, capacity_core_broken: true, capacity_core_status: "core_severe_breakdown", active_member_count: 1, up_count: 1, index_drawdown_pct: -12, index_trend_broken: true, negative_feedback_ratio_change: .2 }, scores({ core_strength_score: 30, contraction_score: 85, negative_feedback_score: 70 }));
assert.equal(retreat.cycle_stage, "retreat_confirmed");
const rebound = run(retreat, { date: "2026-07-08", leader_return: 3, active_member_count: 2, new_first_limit_count: 0 }, scores({ core_strength_score: 50 }));
assert.equal(rebound.cycle_stage, "emergence");
const reboundContinuation = run(rebound, { date: "2026-07-09", leader_return: 4, active_member_count: 4, new_first_limit_count: 0, theme_amount_change: .3 });
assert.ok(["startup_continuation", "fermentation"].includes(reboundContinuation.cycle_stage));
const passiveJuly2 = run({ ...repaired, cycle_stage: "repair", episode_active: true }, { date: "2026-07-02", active_member_count: 20, up_count: 1, large_loss_count: 17, limit_up_count: 0, new_first_limit_count: 0, leader_return: 3.19, index_trend_broken: true, theme_amount_change: -.22, relative_strength_rank_change: -56, negative_feedback_ratio_change: .666 }, scores({ core_strength_score: 58, contraction_score: 82, negative_feedback_score: 67, profit_effect_score: 0 }));
assert.notEqual(passiveJuly2.cycle_stage, "retreat_warning");
const stableCoreDrop = run({ ...state, cycle_stage: "emergence", episode_active: true }, { date: "2026-04-09", active_member_count_change: -13, high_gain_count_change: -21, limit_up_count_change: -4, new_first_limit_count_change: -5, leader_return: 10, relative_strength_rank_change: 7 }, scores({ core_strength_score: 100, contraction_score: 78 }));
assert.equal(stableCoreDrop.cycle_stage, "fermentation");
assert.equal(stableCoreDrop.retreat_factors.coreStructure, false);
assert.equal(stableCoreDrop.strong_divergence_assessment.profit_protected, true);
assert.equal(stableCoreDrop.strong_divergence_assessment.qualifies, false);
const failedReStrengthening = run({ ...repaired, cycle_stage: "repair", episode_active: true }, { date: "2026-07-02", active_member_count: 31, up_count: 10, large_loss_count: 18, limit_up_count: 2, new_first_limit_count: 1, leader_return: 10, theme_amount_change: .056, relative_strength_rank_change: -22, negative_feedback_ratio_change: .285, limit_up_count_change: -2, new_first_limit_count_change: -2, active_member_count_change: -1 }, scores({ core_strength_score: 98, contraction_score: 81, repair_score: 39, profit_effect_score: 11 }));
assert.notEqual(failedReStrengthening.cycle_stage, "retreat_warning");
assert.equal(failedReStrengthening.retreat_factors.highRiskDivergence, false);
const startupContinuation = run({ ...state, cycle_stage: "emergence", episode_active: true }, { date: "2026-05-14", limit_up_count: 2, active_member_count_change: 0, theme_amount_change: 0, relative_strength_rank_change: 0, leader_return: .5, capacity_core_status: "core_participating" }, scores({ contraction_score: 25 }));
assert.equal(startupContinuation.cycle_stage, "startup_continuation");
const noFalseRetreat = run({ ...state, cycle_stage: "strong_divergence", episode_active: true }, { date: "2026-05-15", leader_return: -5, active_member_count: 3, up_count: 3, large_loss_count: 1, capacity_core_status: "core_participating", capacity_core_broken: false, negative_feedback_ratio: .1 }, scores({ core_strength_score: 75, contraction_score: 65 }));
assert.notEqual(noFalseRetreat.cycle_stage, "retreat_confirmed");
const april13 = run({ ...state, cycle_stage: "fermentation", episode_active: true }, { date: "2026-04-13", leader_return: -4.5, leader_structure_broken: true, capacity_core_status: "core_participating", capacity_core_broken: false, active_member_count_change: 2, high_gain_count: 5, large_loss_count: 0, relative_strength_score: 1.2, relative_strength_rank_change: 2, theme_amount_change: .2 }, scores({ core_strength_score: 75, profit_effect_score: 65, contraction_score: 35 }));
assert.equal(april13.cycle_stage, "normal_divergence");
assert.notEqual(april13.cycle_stage, "retreat_warning");
const april14 = run({ ...april13, cycle_stage: "normal_divergence", warning_streak: 2, episode_active: true }, { date: "2026-04-14", leader_return: 1, capacity_core_status: "core_participating", capacity_core_broken: false, active_member_count_change: 3, high_gain_count: 6, large_loss_count: 0, relative_strength_score: 1.5, relative_strength_rank_change: 3, theme_amount_change: .3 }, scores({ core_strength_score: 78, profit_effect_score: 70, contraction_score: 20, repair_score: 75 }));
assert.equal(april14.cycle_stage, "repair");
assert.equal(april14.warning_streak, 0);
const april15 = run({ ...april14, cycle_stage: "repair", episode_active: true }, { date: "2026-04-15", leader_return: -2, capacity_core_status: "core_participating", capacity_core_broken: false, active_member_count_change: -4, high_gain_count: 1, large_loss_count: 4, relative_strength_score: -1.2, relative_strength_rank_change: -3, theme_amount_change: -.15, negative_feedback_ratio: .1, negative_feedback_ratio_change: 0 }, scores({ core_strength_score: 75, profit_effect_score: 50, contraction_score: 70, negative_feedback_score: 10 }));
assert.equal(april15.cycle_stage, "strong_divergence");
assert.notEqual(april15.cycle_stage, "retreat_warning");
const firstPullback = run({ ...state, cycle_stage: "fermentation", episode_active: true }, { date: "2026-04-13", relative_strength_score: -1, relative_strength_rank_change: -3, active_member_count_change: -2, leader_return: -1, capacity_core_return: -1, capacity_core_status: "core_weak_divergence" }, scores({ contraction_score: 35, profit_effect_score: 45 }));
assert.equal(firstPullback.cycle_stage, "normal_divergence");
const secondPullback = run(firstPullback, { date: "2026-04-14", relative_strength_score: -1.2, relative_strength_rank_change: -2, active_member_count_change: -2, leader_return: -1, capacity_core_return: -1, capacity_core_status: "core_weak_divergence" }, scores({ contraction_score: 35, profit_effect_score: 45 }));
assert.equal(secondPullback.cycle_stage, "divergence_continuation");
const thirdPullback = run(secondPullback, { date: "2026-04-15", relative_strength_score: -1.5, relative_strength_rank_change: -2, active_member_count_change: -3, leader_return: -1, capacity_core_return: -1, capacity_core_status: "core_weak_divergence" }, scores({ contraction_score: 35, profit_effect_score: 45 }));
assert.equal(thirdPullback.cycle_stage, "persistent_weakening");
assert.equal(thirdPullback.weakening_continuity.weakening_streak, 3);
const repairedWeakness = run(thirdPullback, { date: "2026-04-16", relative_strength_score: 1, relative_strength_rank_change: 3, active_member_count_change: 4, high_gain_count: 5, large_loss_count: 0, leader_return: 1, capacity_core_return: 1, capacity_core_status: "core_participating", theme_amount_change: .2 }, scores({ contraction_score: 20, profit_effect_score: 70 }));
assert.equal(repairedWeakness.cycle_stage, "repair");
assert.equal(repairedWeakness.weakening_streak, 0);
assert.ok(CYCLE_STAGES.includes("downtrend_continuation"));
assert.ok(CYCLE_STAGES.includes("downtrend_stabilizing"));
assert.ok(!CYCLE_STAGES.includes("second_wave_candidate"));
assert.ok(CYCLE_STAGES.includes("rebound_failed"));
assert.ok(CYCLE_STAGES.includes("weakening_again"));

// Retreat must pass through a finite adjustment chain. A rebound is only a
// short bridge; it cannot persist indefinitely or jump directly to a restart.
const retreatHistory = [-4, -3, -2, -1.5, -1].map((relative_strength_score, index) => ({
  ...base, date: `2026-08-0${index + 1}`, relative_strength_score,
  leader_return: -2 + index * .5, capacity_core_return: -2 + index * .45,
  active_member_count: 3, active_member_count_change: 0,
  negative_feedback_ratio: .5 - index * .05, negative_feedback_ratio_change: -.05,
  theme_relative_return: relative_strength_score, relative_strength_rank_change: 0,
  high_gain_count_change: 0, theme_amount_change: 0, capacity_core_positive_weight: .2,
}));
let postState = detectCycleStage(retreatHistory, scores({ contraction_score: 45 }), { ...config, post_retreat_rebound_max_days: 3 }, { cycle_stage: "downtrend_continuation", episode_active: false, episode_end_date: "2026-07-31", episode_sequence: 1 });
assert.equal(postState.cycle_stage, "downtrend_stabilizing");
const reboundMetrics = [...retreatHistory.slice(1), { ...retreatHistory.at(-1), date: "2026-08-06", relative_strength_score: .8, theme_relative_return: .8, leader_return: 1.5, capacity_core_return: 1, active_member_count: 4, active_member_count_change: 1, high_gain_count_change: 0, theme_amount_change: -.05, relative_strength_rank_change: 0, capacity_core_positive_weight: .35 }];
postState = detectCycleStage(reboundMetrics, scores({ contraction_score: 30 }), config, postState);
assert.equal(postState.cycle_stage, "emergence");
assert.equal(postState.episode_id, "episode_2_2026-08-06");
const candidateMetrics = [...reboundMetrics.slice(1), { ...reboundMetrics.at(-1), date: "2026-08-07", relative_strength_score: 2, theme_relative_return: 2, relative_strength_rank_change: 3, active_member_count: 6, active_member_count_change: 2, up_count: 6, up_ratio: .75, high_gain_count: 3, high_gain_count_change: 2, theme_amount_change: .25, capacity_core_positive_weight: .7, capacity_core_severe_weight: .1, leader_return: 3, capacity_core_return: 2, new_leader_formed: true, effective_member_count: 3 }];
postState = detectCycleStage(candidateMetrics, scores({ expansion_score: 80, contraction_score: 20 }), config, postState);
assert.ok(["startup_continuation", "fermentation"].includes(postState.cycle_stage));
assert.equal(postState.episode_id, "episode_2_2026-08-06");
postState = detectCycleStage([...candidateMetrics.slice(1), { ...candidateMetrics.at(-1), date: "2026-08-08" }], scores({ expansion_score: 80, contraction_score: 20 }), config, postState);
assert.ok(["startup_continuation", "fermentation"].includes(postState.cycle_stage));
assert.equal(postState.episode_id, "episode_2_2026-08-06");
let failedRebound = detectCycleStage(reboundMetrics, scores(), config, { cycle_stage: "post_retreat_rebound", episode_active: false, post_retreat_rebound_days: 1, episode_sequence: 1 });
failedRebound = detectCycleStage([...reboundMetrics.slice(1), { ...reboundMetrics.at(-1), date: "2026-08-08", relative_strength_score: -2, theme_relative_return: -2, leader_return: -2, capacity_core_return: -2, active_member_count_change: -2 }], scores({ contraction_score: 70 }), config, failedRebound);
assert.equal(failedRebound.cycle_stage, "strong_divergence");
assert.ok(CYCLE_STAGES.includes(detectCycleStage([...reboundMetrics.slice(1), { ...reboundMetrics.at(-1), date: "2026-08-09", relative_strength_score: -3, leader_return: -3, capacity_core_return: -3, active_member_count_change: -2 }], scores({ contraction_score: 75 }), config, failedRebound).cycle_stage));
console.log("cycle-stage-test: episode and retreat rules passed");
