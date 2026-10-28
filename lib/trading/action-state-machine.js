const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const nextWeekday = (date) => { const cursor = new Date(`${date}T12:00:00Z`); do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while ([0, 6].includes(cursor.getUTCDay())); return cursor.toISOString().slice(0, 10); };
const stageLabel = (stage) => ({ unstarted: "未启动", emergence: "启动", fermentation: "发酵", acceleration: "加速", normal_divergence: "正常分歧", strong_divergence: "强分歧", repair: "趋势延续，修复", re_strengthening: "重新增强", retreat_warning: "退潮预警", retreat_confirmed: "退潮确认", post_retreat_rebound: "退潮后反弹", second_wave_restart: "二次启动" })[stage] || "未启动";

function score(theme) {
  const cycle = theme.cycle_stage || {}; const breadth = theme.breadth || {}; const core = cycle.core_status || {};
  const mainline = ["confirmed_mainline", "forming_mainline"].includes(theme.status) ? 20 : theme.status === "candidate_mainline" ? 14 : 5;
  const timing = cycle.cycle_stage === "fermentation" ? 20 : cycle.cycle_stage === "repair" ? 18 : cycle.cycle_stage === "emergence" ? 12 : cycle.cycle_stage === "re_strengthening" ? 12 : cycle.cycle_stage === "acceleration" ? 5 : 0;
  const alignment = core.combined === "leader_up_core_up" ? 20 : core.combined === "leader_weak_core_stable" ? 10 : 3;
  const profit = cycle.profit_effect_status === "improving" ? 15 : cycle.profit_effect_status === "healthy" ? 11 : 0;
  const expansion = cycle.expansion_status === "expanding" ? 15 : cycle.expansion_status === "stable" ? 10 : 0;
  const risk = ["fermentation", "repair", "re_strengthening", "emergence"].includes(cycle.cycle_stage) ? 10 : 0;
  const entry = mainline + timing + alignment + profit + expansion + risk;
  const hold = Math.round((mainline + alignment + profit + expansion + (breadth.up_ratio || 0) * 20 + 15) / 1.05);
  const exit = Math.round(Math.max(0, (["retreat_warning", "retreat_confirmed"].includes(cycle.cycle_stage) ? 45 : 0) + (cycle.cycle_stage === "strong_divergence" ? 15 : 0) + (core.combined === "leader_down_core_down" ? 30 : 0) + (cycle.profit_effect_status === "collapsed" ? 55 : 0) + (cycle.expansion_status === "rapidly_shrinking" ? 20 : 0)));
  return { entry_quality: Math.min(100, entry), hold_quality: Math.min(100, hold), exit_risk: Math.min(100, exit) };
}

function sameDayOpportunity(theme) {
  const cycle = theme.cycle_stage || {};
  const evidence = cycle.evidence || {};
  const breadth = theme.breadth || {};
  const core = cycle.core_status || {};
  const prior = (values) => Array.isArray(values) && values.length > 1 ? values.at(-2) : null;
  const current = (values) => Array.isArray(values) ? values.at(-1) : null;
  const previousStage = cycle.previous_stage || "unknown";
  const previousProfit = prior(evidence.next_day_median_return_3d);
  const previousRelativeRank = prior(evidence.relative_strength_rank_3d);
  const priorProfitScore = Number.isFinite(previousProfit) ? (previousProfit > 0 ? 15 : previousProfit > -2 ? 8 : 0) : 7;
  const priorRelativeScore = Number.isFinite(previousRelativeRank) ? (previousRelativeRank <= 20 ? 10 : previousRelativeRank <= 60 ? 6 : 2) : 5;
  const historicalBase = Math.round(Math.min(100,
    (["emergence", "fermentation", "repair", "acceleration"].includes(previousStage) ? 20 : 8)
    + (theme.core_stocks?.emotion_leader?.length || theme.core_stocks?.trend_leader?.length ? 20 : 6)
    + (theme.core_stocks?.capacity_core?.length ? 20 : 6)
    + priorProfitScore
    + (theme.hierarchy?.height_stocks?.length >= 2 ? 10 : 4)
    + priorRelativeScore
    + (["confirmed_mainline", "forming_mainline", "candidate_mainline"].includes(theme.status) ? 5 : 1)
  ));
  const currentLimits = current(evidence.limit_up_count_3d) ?? breadth.limit_up_count ?? 0;
  const currentFirstBoards = current(evidence.new_first_limit_count_3d) ?? 0;
  const currentRelativeRank = current(evidence.relative_strength_rank_3d);
  const currentNegativeFeedback = current(evidence.negative_feedback_ratio_3d);
  const todayTrigger = Math.round(Math.min(100,
    Math.min(20, Math.round((breadth.up_ratio || 0) * 20))
    + (core.leader === "accelerating" || core.leader === "strengthening" ? 20 : 5)
    + (core.capacity_core === "trend_strengthening" || core.capacity_core === "stable" ? 20 : 5)
    + Math.min(15, currentFirstBoards * 5 + (currentLimits >= 2 ? 5 : 0))
    + (Number.isFinite(currentRelativeRank) ? currentRelativeRank <= 20 ? 15 : currentRelativeRank <= 60 ? 9 : 3 : 7)
    + (Number.isFinite(currentNegativeFeedback) ? currentNegativeFeedback <= 0.15 ? 10 : currentNegativeFeedback <= 0.3 ? 5 : 0 : 6)
  ));
  const riskDefinition = Math.round(Math.min(100,
    35
    + (theme.core_stocks?.emotion_leader?.length || theme.core_stocks?.trend_leader?.length ? 20 : 0)
    + (theme.core_stocks?.capacity_core?.length ? 20 : 0)
    + (["retreat_warning", "retreat_confirmed"].includes(cycle.cycle_stage) ? 0 : 15)
    + (cycle.expansion_status === "rapidly_shrinking" ? 0 : 10)
  ));
  return {
    historical_base_score: historicalBase,
    today_trigger_score: todayTrigger,
    risk_definition_score: riskDefinition,
    same_day_opportunity_score: Math.round(historicalBase * 0.55 + todayTrigger * 0.35 + riskDefinition * 0.10),
    today_snapshot_evidence: { limit_up_count: currentLimits, new_first_limit_count: currentFirstBoards, relative_strength_rank: currentRelativeRank, negative_feedback_ratio: currentNegativeFeedback },
  };
}

function invalidations(cycle) {
  return {
    entry_thesis: ["主线保持连续性", "核心股与板块保持同步", "新增首板和活跃成员未明显收缩"],
    invalidation_conditions: ["题材进入确认退潮", "龙头与容量中军同步走弱", "新增首板消失且负反馈明显上升"],
    theme_invalidation: ["相对强度跌出市场前列", "板块扩张转为持续收缩"],
    stock_invalidation: ["个股失去题材前排地位或跌破其结构性失效位"],
    time_invalidation: ["未来2个交易日未出现进一步发酵或集体修复"],
    do_not_enter_conditions: ["加速高潮追高", "", "确认退潮", "只有旧核心反弹、板块未跟随"],
  };
}

function decideTheme(theme, result, config, context = {}) {
  const cycle = theme.cycle_stage || {}; const core = cycle.core_status || {}; const scores = score(theme);
  const opportunity = sameDayOpportunity(theme);
  const validMembers = theme.breadth?.valid_member_count ?? 0;
  const coreStocks = theme.core_stocks || {}; const leaders = [...(coreStocks.emotion_leader || []), ...(coreStocks.trend_leader || [])]; const capacities = coreStocks.capacity_core || [];
  const missing = [];
  const qualificationGaps = [];
  if (!result.mainline_eligible) missing.push("full_market_data");
  if (validMembers < config.eligibility.minimum_theme_members) missing.push("theme_members");
  // cache_ready distinguishes “尚未计算” from “已计算但没有股票通过资格线”。
  // 后者不能再次被误写为结果缺失。
  if (!theme.core_structure_evidence?.cache_ready) {
    missing.push("leader_or_capacity_analysis_pending");
  } else {
    if (!leaders.length) qualificationGaps.push("no_qualified_leader");
    if (!capacities.length) qualificationGaps.push("no_qualified_capacity_core");
  }
  const hardNoTrade = missing.length || qualificationGaps.length || theme.status === "insufficient_data";
  const key = theme.key || `${theme.primary}/${theme.name}`;
  const held = Boolean(context.held_theme_keys?.includes(key));
  let action = "no_trade";
  if (!hardNoTrade) {
    const repairEntry = ["normal_divergence", "strong_divergence"].includes(cycle.previous_stage) && cycle.cycle_stage === "repair" && core.combined === "leader_up_core_up" && cycle.expansion_status === "expanding";
    const fermentationEntry = ["confirmed_mainline", "forming_mainline"].includes(theme.status) && cycle.cycle_stage === "fermentation" && ["healthy", "improving"].includes(cycle.profit_effect_status) && ["expanding", "stable"].includes(cycle.expansion_status) && core.combined === "leader_up_core_up";
    if (scores.exit_risk >= config.exit_risk.exit) action = "exit";
    else if (["strong_divergence", "retreat_warning"].includes(cycle.cycle_stage) || scores.exit_risk >= config.exit_risk.reduce) action = "reduce";
    else if (cycle.cycle_stage === "acceleration") action = scores.hold_quality >= config.hold_quality.hold ? "hold" : "reduce";
    else if (repairEntry && held && scores.entry_quality >= config.entry_quality.entry_candidate) action = "add_candidate";
    else if (repairEntry && scores.entry_quality >= config.entry_quality.entry_candidate) action = "entry_candidate";
    else if (fermentationEntry && scores.entry_quality >= config.entry_quality.entry_candidate) action = "entry_candidate";
    // 首次爆发但尚无可用赚钱效应时，只能观察；不能把当日强度当作次日跟随确认。
    else if (cycle.cycle_stage === "emergence" && cycle.profit_effect_status === "unavailable") action = "watch";
    else if (cycle.cycle_stage === "emergence" && theme.status !== "strong_branch" && leaders.length && capacities.length) action = scores.entry_quality >= config.entry_quality.probe_candidate ? "probe_candidate" : "watch";
    else if (["normal_divergence", "strong_divergence", "retreat_warning", "post_retreat_rebound", "unstarted"].includes(cycle.cycle_stage) || cycle.cycle_stage === "unknown") action = "watch";
    else if (scores.hold_quality >= config.hold_quality.hold) action = "hold";
    else if (scores.hold_quality >= config.hold_quality.warning) action = "watch";
  }
  const prior = context.previous_actions?.[key] || null;
  // Yesterday's action is evaluation history, never a gate on today's
  // independently observable signal.  A fresh snapshot or completed daily
  // bar may promote a theme directly when today's rules are met.
  const transitionBlocked = false;
  const confidence = action === "no_trade" || action === "watch" || action === "probe_candidate" ? "low" : cycle.stage_confidence === "high" && !missing.length ? "medium" : "low";
  const eligible = [];
  const roles = [[leaders[0], "leader"], [capacities[0], "capacity_core"], ...(coreStocks.high_elasticity_stocks || []).slice(0, 1).map((stock) => [stock, "high_elasticity"])]
    .filter(([stock]) => stock?.code);
  for (const [stock, role] of roles) {
    let stockAction = ["entry_candidate", "probe_candidate", "add_candidate"].includes(action) ? action : action === "hold" ? "hold" : ["reduce", "exit"].includes(action) ? action : "watch";
    const roleFailed = (role === "leader" && core.leader === "weakening") || (role === "capacity_core" && core.capacity_core === "breaking_down");
    if (roleFailed && !["no_trade", "watch"].includes(action)) stockAction = action === "exit" || core.combined === "leader_down_core_down" ? "exit" : "reduce";
    eligible.push({ code: stock.code, name: stock.name || stock.code, role, stock_action: stockAction, action_confidence: confidence, ...invalidations(cycle), exit_signals: roleFailed ? [role === "leader" ? "龙头角色失效" : "容量中军趋势破坏"] : action === "exit" ? ["题材或角色失效"] : [], missing_data: [], reason: `${role === "leader" ? "题材龙头" : role === "capacity_core" ? "容量中军" : "高弹性核心"}随题材状态机给出研究动作，不构成自动下单指令。` });
  }
  const transitionReason = null;
  const qualificationText = qualificationGaps.map((gap) => gap === "no_qualified_leader" ? "未识别出合格题材龙头" : "未识别出通过资格线的容量中军").join("；");
  const missingText = missing.map((gap) => ({ full_market_data: "全市场完整数据", theme_members: "有效题材成员", leader_or_capacity_analysis_pending: "龙头或容量中军自动分析" })[gap] || gap).join("、");
  return { theme: `${theme.primary} / ${theme.name}`, theme_key: key, primary: theme.primary, secondary: theme.name, mainline_status: theme.status, cycle_stage: cycle.cycle_stage || "unknown", previous_cycle_stage: cycle.previous_stage || "unknown", current_inferred_stage: cycle.cycle_stage || "unknown", previous_theme_action: prior, state_transition: prior ? `${prior}->${action}` : "initial_observation", theme_action: action, action_confidence: confidence, core_status: core, scores: { ...scores, ...opportunity }, evidence: { mainline_score: finite(theme.score), breadth: theme.breadth || null, cycle: cycle || null, leader_candidates: leaders.length, capacity_candidates: capacities.length, uses_future_data: false }, eligible_stocks: eligible, positive_signals: cycle.positive_signals || [], warning_signals: cycle.warning_signals || [], missing_data: missing, qualification_gaps: qualificationGaps, transition_reason: transitionReason, next_day_confirmation_conditions: ["仅用于评估当前信号的后续表现，不作为本次候选触发条件", "新增首板继续出现", "核心股保持题材前排"], next_day_downgrade_conditions: ["新增首板消失", "后排负反馈上升", "龙头与中军同步走弱"], reason: transitionReason || (action === "no_trade" ? `不交易：${missing.length ? `等待自动补齐：${missingText}` : qualificationText || "风险收益边界不允许"}。` : `基于历史基础与当日已发生的市场数据生成研究动作；次日反馈仅用于评估本次信号，不作为候选前提。`), ...(["entry_candidate", "probe_candidate", "add_candidate"].includes(action) ? invalidations(cycle) : {}) };
}

export function buildTradePlan(result, config, context = {}) {
  const themes = (result.themes || []).map((theme) => decideTheme(theme, result, config, context));
  const mode = context.mode === "intraday_snapshot" ? "intraday_snapshot" : context.mode === "preopen_plan" ? "preopen_plan" : "end_of_day";
  const signalTime = mode === "intraday_snapshot" ? (context.signal_time || null) : mode === "preopen_plan" ? "09:25:00" : "15:00:00";
  const actionForDate = mode === "intraday_snapshot" ? result.date : mode === "preopen_plan" ? (context.action_for_date || nextWeekday(result.date)) : nextWeekday(result.date);
  const selected = (action) => themes.filter((theme) => theme.theme_action === action).flatMap((theme) => theme.eligible_stocks.map((stock) => ({ ...stock, theme: theme.theme })));
  return {
    version: config.version,
    mode,
    signal_date: result.date,
    signal_time: signalTime,
    signal_generated_at: mode === "intraday_snapshot" ? `${result.date} ${signalTime || "snapshot"}` : mode === "preopen_plan" ? `${result.date} close (pre-open plan)` : `${result.date} close`,
    action_for: mode === "intraday_snapshot" ? "current_trading_session" : mode === "preopen_plan" ? "selected_trading_day_before_open" : "next_trading_day",
    action_for_date: actionForDate,
    available_data_end: mode === "intraday_snapshot" ? `${result.date} ${signalTime || "snapshot"}` : `${result.date} close`,
    available_data_end_date: result.date,
    is_partial_day: mode === "intraday_snapshot",
    position_size_status: "user_configuration_required",
    risk_configuration: config.risk,
    disclaimer: "研究规则结论，不构成收益承诺、自动下单指令或个性化投资建议。",
    themes,
    next_day_plan: {
      date: result.date,
      action_for_date: actionForDate,
      watchlist: selected("watch"),
      probe_candidates: selected("probe_candidate"),
      entry_candidates: selected("entry_candidate"),
      hold_candidates: selected("hold"),
      reduce_candidates: selected("reduce"),
      exit_candidates: selected("exit"),
      no_trade_reasons: themes.filter((theme) => theme.theme_action === "no_trade").map((theme) => ({ theme: theme.theme, reason: theme.reason }))
    }
  };
}
