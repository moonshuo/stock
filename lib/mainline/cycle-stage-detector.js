// A cycle is an episode, not a daily signal.  Keep this vocabulary deliberately
// small so persisted checkpoints and the UI cannot drift into legacy states.
export const CYCLE_STAGES = Object.freeze([
  "unstarted", "emergence", "startup_continuation", "fermentation", "normal_divergence",
  "divergence_continuation", "persistent_weakening", "strong_divergence", "repair", "re_strengthening", "retreat_warning",
  "retreat_confirmed", "downtrend_continuation", "downtrend_stabilizing", "post_retreat_rebound", "rebound_failed", "weakening_again",
]);
const VALID = new Set(CYCLE_STAGES);
const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const num = (v, fallback = 0) => finite(v) ? Number(v) : fallback;
const up = (v) => num(v) > 0;
const down = (v) => num(v) < 0;
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const asState = (value) => typeof value === "string" ? { cycle_stage: value } : (value || {});

function evidence(metrics, scores) {
  const last = metrics.at(-1) || {};
  const prev = metrics.at(-2) || {};
  const positive_evidence = [
    [up(last.active_member_count_change), "活跃成员增加"], [up(last.high_gain_count_change), "高涨成员增加"],
    [num(last.new_first_limit_count) > 0, "新增首板"], [num(last.promotion_count) > 0 || num(last.promotion_rate) > 0, "晋级梯队存在"],
    [up(last.theme_amount_change), "题材成交额提升"], [num(last.leader_return) >= 3 || num(scores.core_strength_score) >= 68, "龙头或容量核心稳定"],
    [up(last.relative_strength_rank_change), "相对强度提升"],
  ].filter(([ok]) => ok).map(([, label]) => label);
  const negative_evidence = [
    [down(last.limit_up_count_change), "涨停数量下降"], [down(last.new_first_limit_count_change), "新增首板下降"],
    [down(last.promotion_rate_change), "晋级率下降"], [up(last.negative_feedback_ratio_change), "负反馈扩大"],
    [down(last.active_member_count_change), "活跃成员减少"], [down(last.relative_strength_rank_change), "相对强度下降"],
    [num(last.leader_return) < 0, "龙头或容量核心走弱"], [finite(scores.profit_effect_score) && scores.profit_effect_score < 42, "赚钱效应恶化"],
  ].filter(([ok]) => ok).map(([, label]) => label);
  const missing_evidence = ["new_first_limit_count", "promotion_rate", "negative_feedback_ratio"].filter((key) => !finite(last[key])).map((key) => ({ new_first_limit_count: "新增首板数据", promotion_rate: "晋级率数据", negative_feedback_ratio: "负反馈数据" }[key]));
  return { last, prev, positive: positive_evidence.length, negative: negative_evidence.length, positive_evidence, negative_evidence, missing_evidence, coverage: Math.round((8 - missing_evidence.length) / 8 * 100) };
}

function retreatSignals(last, scores, ev, state, config) {
  const thresholds = config.core_thresholds || {};
  const drawdown = num(last.index_drawdown_pct ?? last.theme_index_drawdown_pct ?? last.stage_drawdown_pct);
  const indexBroken = Boolean(last.index_trend_broken ?? last.theme_index_trend_broken ?? last.platform_broken) || drawdown <= -10 || num(last.index_below_ma_count ?? last.below_ma_count) >= 2;
  const leaderBroken = Boolean(last.leader_structure_broken ?? last.leader_invalidated) || last.leader_status === "broken" || num(last.leader_return) <= (thresholds.core_breakdown_return_pct ?? -4);
  const coreBroken = Boolean(last.capacity_core_broken ?? last.capacity_core_invalidated) || last.capacity_core_status === "core_severe_breakdown";
  const coreStructure = leaderBroken || coreBroken;
  const breadthCollapsed = Boolean(last.breadth_collapsed) || num(last.active_member_count) <= 2 || num(last.large_loss_count) >= Math.max(1, num(last._valid_member_count || last.member_count) * .35) || num(last.up_count) < num(last.member_count) * (thresholds.breadth_collapse_up_ratio ?? .35);
  const feedback = Boolean(last.negative_feedback_expanding) || num(last.negative_feedback_ratio) >= (thresholds.negative_feedback_ratio ?? .35) || num(last.negative_feedback_ratio_change) >= .12 || num(scores.negative_feedback_score) >= 55;
  const marketStrong = up(last.active_member_count_change)
    && num(last.relative_strength_score) > 0
    && num(last.high_gain_count) > num(last.large_loss_count)
    && up(last.relative_strength_rank_change);
  const groupRecovery = marketStrong || (up(last.active_member_count_change) && [last.active_member_count_change, last.theme_amount_change, last.relative_strength_rank_change].filter(up).length >= 2
    && num(last.high_gain_count) > num(last.large_loss_count)
    && num(scores.profit_effect_score) >= 50);
  const coreDeteriorating = coreBroken || (leaderBroken && last.capacity_core_status === "core_weak_divergence");
  const boardDeteriorating = breadthCollapsed || (down(last.relative_strength_rank_change) && num(last.high_gain_count) <= num(last.large_loss_count));
  const continuityDeteriorating = feedback || (down(last.active_member_count_change) && down(last.new_first_limit_count_change) && down(last.promotion_rate_change)) || (finite(scores.profit_effect_score) && num(scores.profit_effect_score) < 42);
  const deteriorationLayers = [coreDeteriorating, boardDeteriorating, continuityDeteriorating].filter(Boolean).length;
  const boardAndContinuityDeteriorating = boardDeteriorating && continuityDeteriorating;
  const deterioration_streak = groupRecovery || !boardAndContinuityDeteriorating ? 0 : num(state.deterioration_streak) + 1;
  // A single broad pullback with poor next-day feedback is normal after a
  // startup unless the core breaks too.  Without core damage, require two
  // consecutive deteriorating sessions before issuing a retreat warning.
  const warningEligible = !groupRecovery && (
    (coreDeteriorating && (boardDeteriorating || continuityDeteriorating))
    || (!coreDeteriorating && boardAndContinuityDeteriorating && deterioration_streak >= 2)
  );
  const repairFailed = Boolean(last.repair_failed || last.repair_failure) || (num(state.repair_failed_days) >= 1 && !groupRecovery);
  const score = (coreDeteriorating ? 35 : 0) + (boardDeteriorating ? 25 : 0) + (continuityDeteriorating ? 25 : 0) + (indexBroken ? 15 : 0);
  return { score, leaderBroken, coreBroken, coreStructure, indexBroken, breadthCollapsed, feedback, marketStrong, groupRecovery, coreDeteriorating, boardDeteriorating, continuityDeteriorating, boardAndContinuityDeteriorating, deteriorationLayers, deterioration_streak, warningEligible, repairFailed, highRiskDivergence: warningEligible };
}

function trailingCount(metrics, predicate, maximum = 5) {
  let count = 0;
  for (const item of metrics.slice(-maximum).reverse()) {
    if (!predicate(item)) break;
    count += 1;
  }
  return count;
}

// A divergence is a short interruption, not a label for a prolonged decline.
// Keep the recent observations separate from the persisted streak so replayed
// days are explainable and a new request can still evaluate a full 3-5 day run.
function weakeningContinuity(metrics, scores, state, retreat) {
  const last = metrics.at(-1) || {};
  const medianNegative = num(last.relative_strength_score) < 0;
  const activeDeclining = down(last.active_member_count_change);
  const rankDeclining = down(last.relative_strength_rank_change);
  const coreWeakening = num(last.leader_return) < 0 && num(last.capacity_core_return) < 0;
  const profitWeakening = ["weakening", "deteriorating"].includes(last.profit_effect?.profit_effect)
    || (finite(scores.profit_effect_score) && num(scores.profit_effect_score) < 50);
  const pressureCount = [medianNegative, activeDeclining, rankDeclining, coreWeakening, profitWeakening].filter(Boolean).length;
  const sessionWeakening = !retreat.groupRecovery && medianNegative && pressureCount >= 2;
  const weakening_streak = retreat.groupRecovery ? 0 : sessionWeakening ? num(state.weakening_streak) + 1 : 0;
  return {
    session_weakening: sessionWeakening,
    weakening_streak,
    consecutive_down_days: trailingCount(metrics, (item) => num(item.relative_strength_score) < 0),
    median_negative_days: trailingCount(metrics, (item) => num(item.relative_strength_score) < 0),
    active_member_decline_days: trailingCount(metrics, (item) => down(item.active_member_count_change)),
    relative_strength_decline_days: trailingCount(metrics, (item) => down(item.relative_strength_rank_change)),
    core_weakening_days: trailingCount(metrics, (item) => num(item.leader_return) < 0 && num(item.capacity_core_return) < 0),
    profit_weakening_days: trailingCount(metrics, (item) => ["weakening", "deteriorating"].includes(item.profit_effect?.profit_effect)),
    pressure_count: pressureCount,
    group_recovery: retreat.groupRecovery,
  };
}

// Fewer fresh limit-ups or fewer active names than yesterday indicate slower
// expansion, not necessarily a strong divergence.  Require visible current-day
// damage before using the stronger label.
function strongDivergenceAssessment(last, scores, retreat) {
  const memberCount = Math.max(1, num(last._valid_member_count || last.member_count));
  const upRatio = finite(last.up_ratio) ? num(last.up_ratio) : num(last.up_count) / memberCount;
  const largeLossRatio = num(last.large_loss_count) / memberCount;
  const lossHeavy = num(last.large_loss_count) >= Math.max(2, Math.ceil(memberCount * .25))
    && num(last.large_loss_count) >= num(last.high_gain_count);
  const breadthWeak = num(last.relative_strength_score) < 0
    || upRatio < .5
    || largeLossRatio >= .25
    || lossHeavy;
  const profitDeteriorating = ["weakening", "deteriorating"].includes(last.profit_effect?.profit_effect)
    || (finite(scores.profit_effect_score) && num(scores.profit_effect_score) < 42)
    || num(last.negative_feedback_ratio) >= .2
    || num(last.negative_feedback_ratio_change) >= .08;
  const coreUnderPressure = (num(last.leader_return) <= -2 && num(last.capacity_core_return) <= -2)
    || last.capacity_core_status === "core_severe_breakdown"
    || (finite(last.capacity_core_positive_weight) && num(last.capacity_core_positive_weight) < .35);
  const profitProtected = !profitDeteriorating
    && (last.profit_effect?.profit_effect === "strong" || num(scores.profit_effect_score) >= 60)
    && upRatio >= .6
    && largeLossRatio < .15
    && !coreUnderPressure;
  const qualifies = !retreat.groupRecovery
    && !profitProtected
    && breadthWeak
    && (profitDeteriorating || coreUnderPressure || lossHeavy);
  return { qualifies, breadth_weak: breadthWeak, loss_heavy: lossHeavy, profit_deteriorating: profitDeteriorating, core_under_pressure: coreUnderPressure, profit_protected: profitProtected, up_ratio: upRatio, large_loss_ratio: largeLossRatio };
}

function resonance(last, scores, ev) {
  const breadth = Boolean(last.multi_stock_resonance || last.resonance || (num(last.active_member_count) >= 3 && num(last.new_first_limit_count) > 0 && ev.positive >= 3));
  const leader = Boolean(last.new_leader_formed || last.leader_reformed);
  const capacity = Boolean(last.capacity_core_breakout || last.capacity_core_rebreakout);
  const relative = Boolean(last.breadth_recovered || last.relative_strength_recovered) || (up(last.relative_strength_rank_change) && up(last.active_member_count_change));
  return { breadth, leader, capacity, relative, valid: breadth && leader && capacity && relative };
}

function postRetreatAssessment(metrics, state) {
  const last = metrics.at(-1) || {};
  const window = metrics.slice(-5);
  const prior = window.slice(0, -1);
  const average = (field) => {
    const values = prior.map((item) => finite(item[field]) ? Number(item[field]) : null).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const medianReturn = num(last.relative_strength_score);
  const noFreshLows = !prior.length || medianReturn >= Math.min(...prior.map((item) => num(item.relative_strength_score)));
  const medianNoLongerNegative = window.slice(-3).filter((item) => num(item.relative_strength_score) < 0).length <= 1 || medianReturn >= 0;
  const feedbackEasing = !finite(last.negative_feedback_ratio) || average("negative_feedback_ratio") == null || num(last.negative_feedback_ratio) <= average("negative_feedback_ratio") || num(last.negative_feedback_ratio_change) <= 0;
  const activityStable = window.slice(-3).filter((item) => num(item.active_member_count_change) >= 0).length >= 2 || num(last.active_member_count) >= (average("active_member_count") ?? -Infinity);
  const coresStable = !prior.length || (num(last.leader_return) >= Math.min(...prior.map((item) => num(item.leader_return))) && num(last.capacity_core_return) >= Math.min(...prior.map((item) => num(item.capacity_core_return))));
  const lowFlatOrHigher = !prior.length || medianReturn >= average("relative_strength_score");
  const stabilizationSignals = [noFreshLows, medianNoLongerNegative, feedbackEasing, activityStable, coresStable, lowFlatOrHigher].filter(Boolean).length;
  const stabilizing = stabilizationSignals >= 4;
  const priceRebound = medianReturn > 0 || num(last.leader_return) > 0 || num(last.capacity_core_return) > 0;
  const reboundFailed = !priceRebound || (num(last.relative_strength_score) < 0 && down(last.active_member_count_change));
  return { stabilization_signals: stabilizationSignals, stabilizing, price_rebound: priceRebound, rebound_failed: reboundFailed };
}

function emergenceAssessment(last, scores, ev, config) {
  const thresholds = config.emergence?.thresholds || {};
  const startupRule = {
    minimum_effective_member_count: thresholds.minimum_effective_member_count ?? 3,
    capacity_core_count: num(last.capacity_core_count),
    qualified_core_count: num(last.capacity_core_startup_qualified_count),
    required_core_count: num(last.capacity_core_startup_required_count),
    limit_up_count: num(last.limit_up_count),
    capacity_core_passed: last.capacity_core_response_confirmed !== false
      && (last.capacity_core_response_confirmed === true || last.capacity_core_status === "synchronized_up"),
  };
  const capacityCoreSynchronized = last.capacity_core_response_confirmed !== false && ((last.capacity_core_response_confirmed === true
      && ["core_participating", "core_strengthening", "core_breakout_attempt", "core_breakout_confirmed"].includes(last.capacity_core_status))
    || (last.capacity_core_status === "synchronized_up"
      && num(last.capacity_core_count) >= 2
      && num(last.capacity_core_up_ratio) >= 0.5
      && num(last.capacity_core_return) > 0));
  // Formal emergence needs an explicit effective-member count.  Falling back to
  // headline counts here would let a few unrelated movers masquerade as resonance.
  const effectiveMembers = num(last.effective_member_count);
  const dynamicLogicUnified = last.dynamic_logic_unified !== false && num(last.independent_event_count) === 0;
  const minimumStrong = Math.max(3, Math.ceil(num(last._valid_member_count) * .1));
  const groupResonance = num(last.strong_member_count) >= minimumStrong && num(last.same_logic_ratio) >= .7 && (num(last.up_ratio) >= .6 || num(last.relative_strength_score) >= 1.5);
  const breadth = last.breadth_expansion_confirmed === true;
  const leader = last.leader_or_frontline_formed === true;
  const trendLed = leader;
  const minimumLimitUps = 1;
  const relativeStrengthAvailable = finite(last.theme_relative_return) && finite(last.relative_strength_rank) && finite(last._theme_count);
  const relativeStrength = relativeStrengthAvailable
    ? (num(last.theme_relative_return) >= 1.5 && num(last.relative_strength_rank) <= Math.ceil(num(last._theme_count) * .2)) || num(last.relative_strength_rank_change) >= num(last._theme_count) * .2
    : null;
  const hasLimitUpRecognition = num(last.limit_up_count) > 0;
  const themeReturnLeading = relativeStrength;
  const capacityReturnLeading = capacityCoreSynchronized;
  const competitiveStrength = relativeStrength;
  const dimensionCount = [breadth, leader, relativeStrength].filter(Boolean).length;
  const coreScore = capacityCoreSynchronized ? 25 : last.capacity_core_status === "core_neutral" && last.capacity_core_structure_preserved === true && last.capacity_core_capital_activity_confirmed === true ? 15 : 0;
  const score = Math.round((groupResonance ? 25 : 0) + coreScore + dimensionCount * 15 + (hasLimitUpRecognition ? 10 : 0) + (competitiveStrength ? 10 : 0) + (last.capacity_core_status === "core_strengthening" ? 5 : 0));
  const validMemberCount = Math.max(1, num(last._valid_member_count));
  const upRatio = finite(last.up_ratio) ? num(last.up_ratio) : num(last.up_count) / validMemberCount;
  // A broad, independently resonant surge must not be discarded merely because
  // the selected capacity-core pool has not yet caught up.  Core response is a
  // quality/confirmation signal, not an absolute veto on first emergence.
  const broadBreakout = groupResonance
    && leader
    && hasLimitUpRecognition
    && upRatio >= .75
    && num(last.high_gain_count) >= Math.max(5, Math.ceil(validMemberCount * .15))
    && num(last.negative_feedback_ratio) <= .1;
  // A formal launch still requires a recognisable funding anchor.  A board
  // with no limit-up can be strong, but remains an observation/candidate until
  // it gains that recognition on a following trading day.
  const baseStartup = groupResonance && breadth && capacityCoreSynchronized && leader && hasLimitUpRecognition;
  let quality = baseStartup ? (num(last.strong_member_count) >= 5 && num(last.capacity_core_weighted_score) >= 75 && relativeStrength === true ? "strong_emergence" : "normal_emergence")
    : groupResonance && breadth && num(last.capacity_core_weighted_score) >= 45 && num(last.capacity_core_weighted_score) < 60 && num(last.capacity_core_severe_weight) < .5 ? "emergence_candidate" : "not_emergence";
  const groupProtection = num(last.up_ratio) >= .75 && num(last.high_gain_count) >= Math.max(5, num(last._valid_member_count) * .2)
    && num(last.relative_strength_score) >= 2 && num(last.limit_up_count) >= 1 && num(last.negative_feedback_ratio) <= .1
    && capacityCoreSynchronized && leader;
  if (groupProtection && quality !== "strong_emergence") quality = "normal_emergence";
  if (broadBreakout && quality === "not_emergence") quality = "normal_emergence";
  const isEmergence = baseStartup || groupProtection || broadBreakout;
  const positive_evidence = [
    [groupResonance, `集团共振成立：${effectiveMembers} 只有效成员共同走强`],
    [capacityCoreSynchronized, "容量中军资金与价格响应有效"],
    [hasLimitUpRecognition, `出现至少 ${minimumLimitUps} 只涨停股，具备资金辨识度`],
    [themeReturnLeading, "板块相对强度满足严格提升条件"],
    [capacityReturnLeading, "容量中军整体响应通过"],
    [groupProtection, "板块集团增强保护条件成立"],
    [broadBreakout, "广度爆发启动：涨停辨识度、强势成员和上涨广度同步满足"],
    [breadth, "板块广度较近期扩张"],
    [leader, "已形成龙头或前排核心"],
    [relativeStrength, "相对强度提升"],
  ].filter(([ok]) => ok).map(([, label]) => label);
  const negative_evidence = [
    [effectiveMembers < (thresholds.minimum_effective_member_count ?? 3), "有效成员不足 3 只"],
    [!dynamicLogicUnified, "存在独立事件驱动的成员，不能视为统一交易逻辑"],
    [!startupRule.capacity_core_passed || !capacityCoreSynchronized, "容量中军未形成有效响应"],
    [!hasLimitUpRecognition, "缺少涨停股，资金辨识度不足"],
    [!themeReturnLeading, "相对强度未满足提升条件"],
    [!capacityReturnLeading, "主要中军整体响应不足"],
    [dimensionCount < 2, "广度、前排、相对强度三项中不足两项成立"],
  ].filter(([ok]) => ok).map(([, label]) => label);
  return { isEmergence, score, quality, type: trendLed ? "trend_led" : capacityCoreSynchronized ? "balanced" : "small_cap_emotion_led", groupResonance, effective_member_count: effectiveMembers, dynamic_logic_unified: dynamicLogicUnified, breadth, leader, relativeStrength, dimension_count: dimensionCount, capacityCoreSynchronized, has_limit_up_recognition: hasLimitUpRecognition, broad_breakout: broadBreakout, theme_return_leading: themeReturnLeading, capacity_return_leading: capacityReturnLeading, competitive_strength: competitiveStrength, startup_rule: startupRule, positive_evidence, negative_evidence };
}

export function detectCycleStage(metrics, scores = {}, config = {}, previous = { cycle_stage: "unstarted" }) {
  const state = asState(previous);
  // Legacy persisted values are intentionally treated as unstarted; they are not
  // emitted again and therefore cannot leak into output or page state.
  const legacyStage = { second_wave_candidate: "post_retreat_rebound", second_wave_restart: "emergence" }[state.cycle_stage];
  const previous_stage = VALID.has(state.cycle_stage) ? state.cycle_stage : (legacyStage || "unstarted");
  const ev = evidence(metrics, scores);
  const last = ev.last;
  if (!finite(last.capacity_core_return)) {
    ev.missing_evidence.push("容量中军同步涨幅数据");
    ev.negative_evidence.push("容量中军同步上涨未确认");
  }
  const date = last.date || null;
  const enough = Boolean(last.date && ev.prev.date && num(last._valid_member_count) >= num(config.stage_thresholds?.minimum_active_members, 3));
  const retreat = retreatSignals(last, scores, ev, state, config);
  const weakness = weakeningContinuity(metrics, scores, state, retreat);
  const strongDivergence = strongDivergenceAssessment(last, scores, retreat);
  const postRetreat = postRetreatAssessment(metrics, state);
  const emergence = emergenceAssessment(last, scores, ev, config);
  let stage = previous_stage;
  let episode_active = Boolean(state.episode_active || (previous_stage !== "unstarted" && !["retreat_confirmed", "downtrend_continuation", "downtrend_stabilizing", "post_retreat_rebound", "rebound_failed", "weakening_again"].includes(previous_stage)));
  let episode_start_date = state.episode_start_date || null;
  let episode_peak_date = state.episode_peak_date || null;
  let episode_end_date = state.episode_end_date || null;
  let first_emergence_date = state.first_emergence_date || (previous_stage === "emergence" ? state.episode_start_date : null);
  let episode_sequence = state.episode_sequence || (state.episode_id ? 1 : 0);
  let confirmation_status = enough ? "provisional" : "insufficient_new_evidence";
  let reason = enough ? "Retained the episode stage pending stronger evidence." : "Insufficient comparable daily evidence; retained the previous stage.";

  if (enough) {
    if (previous_stage === "unstarted" && !state.episode_active) {
      if (emergence.isEmergence) {
        stage = "emergence"; episode_active = true; episode_start_date = date; episode_peak_date = date;
        episode_end_date = null; first_emergence_date = date; episode_sequence += 1; confirmation_status = "confirmed";
        reason = "Multi-stock resonance confirmed the first emergence of a new episode.";
      } else {
        // A direction that misses formal emergence remains explicitly
        // unstarted.  It is not a provisional stage candidate merely because
        // the comparison data is complete.
        stage = "unstarted"; episode_active = false; confirmation_status = "pending";
        reason = "Formal emergence conditions were not met; the direction remains unstarted.";
      }
    } else if (["retreat_confirmed", "downtrend_continuation", "downtrend_stabilizing", "post_retreat_rebound", "rebound_failed", "weakening_again"].includes(previous_stage) && emergence.isEmergence) {
      stage = "emergence"; episode_active = true; episode_sequence += 1; episode_start_date = date; episode_peak_date = date; episode_end_date = null; first_emergence_date = date; confirmation_status = "confirmed";
      reason = "Post-retreat strength again meets the formal startup conditions; a new episode starts directly without a second-wave label.";
    } else if (previous_stage === "retreat_confirmed") {
      stage = "downtrend_continuation"; episode_active = false; confirmation_status = "confirmed";
      reason = "Retreat confirmation is followed by decline continuation; a single rebound cannot skip the adjustment phase.";
    } else if (previous_stage === "downtrend_continuation" || previous_stage === "weakening_again") {
      episode_active = false;
      if (postRetreat.stabilizing) {
        stage = "downtrend_stabilizing"; confirmation_status = "confirmed";
        reason = "Decline stopped making fresh lows and feedback, activity and core structure stabilized.";
      } else {
        stage = previous_stage === "weakening_again" ? "weakening_again" : "downtrend_continuation"; confirmation_status = "confirmed";
        reason = "The post-retreat decline is still continuing; stabilization evidence is insufficient.";
      }
    } else if (previous_stage === "downtrend_stabilizing") {
      episode_active = false;
      if (postRetreat.price_rebound) {
        stage = "post_retreat_rebound"; confirmation_status = "confirmed";
        reason = "Price is rebounding, but it has not yet met the formal startup conditions.";
      } else if (!postRetreat.stabilizing) {
        stage = "downtrend_continuation"; confirmation_status = "confirmed";
        reason = "Stabilization failed and the decline resumed.";
      }
    } else if (previous_stage === "post_retreat_rebound") {
      episode_active = false;
      const reboundDays = num(state.post_retreat_rebound_days) + 1;
      if (postRetreat.rebound_failed) {
        stage = "rebound_failed"; confirmation_status = "confirmed";
        reason = "The rebound failed: price and participation weakened again before structural recovery formed.";
      } else if (reboundDays > (config.post_retreat_rebound_max_days ?? 3)) {
        stage = "downtrend_stabilizing"; confirmation_status = "confirmed";
        reason = "The rebound did not broaden within the transition window; retained as stabilization rather than an indefinite rebound.";
      } else {
        stage = "post_retreat_rebound"; confirmation_status = "confirmed";
        reason = "Only a short price rebound is present; breadth, funding and core structure remain insufficient.";
      }
    } else if (previous_stage === "rebound_failed") {
      stage = "weakening_again"; episode_active = false; confirmation_status = "confirmed";
      reason = "The failed rebound has rolled back into renewed weakness.";
    } else if (retreat.leaderBroken && retreat.coreBroken && retreat.breadthCollapsed && retreat.feedback && !retreat.groupRecovery) {
      stage = "retreat_confirmed"; episode_end_date = date; episode_active = false; confirmation_status = "confirmed";
      reason = "龙头与容量中军同步破坏，板块广度收缩且负反馈扩大，确认退潮。";
    } else if ((previous_stage === "normal_divergence" || previous_stage === "divergence_continuation" || previous_stage === "persistent_weakening" || previous_stage === "strong_divergence" || previous_stage === "retreat_warning")
      && !retreat.coreBroken
      && retreat.groupRecovery) {
      stage = "repair"; confirmation_status = "confirmed"; reason = "分歧后广度、资金或相对强度出现集团性恢复，核心结构未破坏。";
    } else if (previous_stage === "repair"
      && (ev.positive >= 3 || num(scores.repair_score) >= 60)
      && ev.negative < 4
      && num(scores.contraction_score) < 60
      && retreat.score < 45
      && (up(last.active_member_count_change) || up(last.relative_strength_rank_change))) {
      stage = "re_strengthening"; episode_peak_date = date; confirmation_status = "confirmed"; reason = "Repair held and expansion resumed; re-strengthening confirmed.";
    } else if (retreat.warningEligible) {
      stage = "retreat_warning"; confirmation_status = "confirmed";
      reason = retreat.coreDeteriorating
        ? "核心层已恶化，且板块整体或持续性同步走弱，未出现集团性修复。"
        : `核心尚未明确破坏，但板块与持续性恶化已连续 ${retreat.deterioration_streak} 日。`;
    } else if ((previous_stage === "emergence" || previous_stage === "startup_continuation") && ev.positive >= 3 && !retreat.coreStructure && !strongDivergence.qualifies) {
      stage = "fermentation"; confirmation_status = "confirmed"; reason = "The active episode expanded beyond its first emergence.";
    } else if (previous_stage === "emergence" && !retreat.coreStructure && !strongDivergence.qualifies) {
      stage = "startup_continuation"; confirmation_status = "confirmed"; reason = "启动后的龙头和容量中军未破坏，板块活跃度仍高于启动前。";
    } else if (strongDivergence.qualifies && weakness.weakening_streak <= 1) {
      stage = "strong_divergence"; confirmation_status = "confirmed"; reason = "Broad weakness was observed without confirmed core and index failure.";
    } else if (weakness.session_weakening) {
      if (weakness.weakening_streak >= 3) {
        stage = "persistent_weakening";
        confirmation_status = "confirmed";
        reason = `连续 ${weakness.weakening_streak} 日出现负收益中位数及多项走弱证据，尚未出现集团性修复。`;
      } else if (weakness.weakening_streak >= 2) {
        stage = "divergence_continuation";
        confirmation_status = "confirmed";
        reason = "分歧后的第二日继续走弱，核心和板块结构尚未全面破坏。";
      } else {
        stage = "normal_divergence";
        confirmation_status = "confirmed";
        reason = "首次出现短暂回落，核心结构尚未破坏。";
      }
    } else if (ev.negative >= 1) {
      if (["normal_divergence", "divergence_continuation", "persistent_weakening"].includes(previous_stage) && !retreat.groupRecovery) {
        stage = previous_stage;
        confirmation_status = "provisional";
        reason = "当日未出现足够的集团性修复证据，保留前一分歧状态。";
      } else {
        stage = "normal_divergence"; confirmation_status = "confirmed"; reason = "A contained pullback was observed while core structure remained intact.";
      }
    }
  }

  // Emergence is a one-time event within an active episode.
  if (episode_active && first_emergence_date && stage === "emergence" && previous_stage !== "unstarted" && first_emergence_date !== date) stage = previous_stage;
  if (!episode_start_date && episode_active) episode_start_date = state.episode_start_date || date;
  const episode_id = episode_active && episode_start_date ? `episode_${episode_sequence}_${episode_start_date}` : (state.episode_id || null);
  const transition = stage === previous_stage ? null : `${previous_stage}->${stage}`;
  if (stage === "strong_divergence" && !retreat.coreStructure && !retreat.indexBroken) {
    ev.positive_evidence.push("龙头、中军与指数趋势未破坏");
    reason = "板块出现强分歧，但龙头、中军与指数趋势未确认破坏。";
  }
  const signalDensity = Math.min(0.22, (ev.positive + ev.negative) * 0.025);
  const confidence = confirmation_status === "confirmed"
    ? +clamp(0.58 + ev.coverage / 250 + signalDensity, .58, .96).toFixed(2)
    : stage === "unstarted"
      ? +clamp(0.18 + ev.coverage / 700, .2, .35).toFixed(2)
      : +clamp(0.35 + ev.coverage / 400, .25, .7).toFixed(2);
  const strongRepairDay = retreat.groupRecovery && ["repair", "re_strengthening"].includes(stage);
  const warning_streak = strongRepairDay ? 0 : stage === "retreat_warning" ? num(state.warning_streak) + 1 : 0;
  const repair_failed_days = retreat.repairFailed ? num(state.repair_failed_days) + 1 : 0;
  const retreatEvidence = [
    [retreat.coreStructure, "核心结构破坏（35分）"], [retreat.indexBroken, "板块指数趋势破坏（25分）"],
    [retreat.breadthCollapsed, "板块广度崩塌（20分）"], [retreat.feedback, "负反馈持续扩大（10分）"], [retreat.repairFailed, "修复失败（10分）"],
  ].filter(([ok]) => ok).map(([, label]) => label);
  return {
    cycle_stage: stage, confirmed_stage: stage, pending_stage: null, confirmation_status,
    stage_confidence: confidence, daily_condition: stage, previous_stage, previous_confidence: state.stage_confidence ?? null,
    previous_transition: state.transition ?? null, transition, transition_status: "valid", proposed_stage: null, retained_stage: null,
    reason, episode_id, episode_active, episode_start_date, episode_peak_date, episode_end_date, first_emergence_date,
    episode_status: episode_active ? "active" : (stage === "retreat_confirmed" ? "ended" : "inactive"), episode_sequence,
    cooldown_days: state.cooldown_days || 0, post_retreat_rebound_days: stage === "post_retreat_rebound" ? num(state.post_retreat_rebound_days) + 1 : 0, warning_streak, deterioration_streak: retreat.deterioration_streak, weakening_streak: weakness.weakening_streak, weakening_continuity: weakness, repair_failed_days, current_episode_id: episode_id,
    evidence_coverage: ev.coverage, positive_evidence: ev.positive_evidence, negative_evidence: [...ev.negative_evidence, ...retreatEvidence], missing_evidence: ev.missing_evidence,
    retreat_score: retreat.score, retreat_factors: retreat, strong_divergence_assessment: strongDivergence, post_retreat_assessment: postRetreat, startup_eligible: emergence.isEmergence,
    emergence_result: emergence,
    expansion_status: ev.positive >= 3 ? "expanding" : "stable", profit_effect_status: last.profit_effect?.profit_effect || "insufficient_data",
    core_status: { combined: retreat.coreStructure ? "core_damaged" : "core_stable" },
  };
}
