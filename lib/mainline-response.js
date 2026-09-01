const TIMELINE_STOCK_FIELDS = ["code", "name", "change_pct"];
const PROFIT_EFFECT_FIELDS = [
  "evaluation_date", "source_pool_date", "profit_effect",
  "frontline_next_day_median_return", "frontline_positive_rate",
  "active_member_next_day_median_return", "active_member_positive_rate",
  "limit_up_next_day_median_return", "severe_negative_rate",
  "leader_feedback", "capacity_core_feedback", "ordinary_member_feedback",
  "frontline_member_count", "active_member_count", "reason",
];

function compactTimelineStock(stock = {}) {
  return Object.fromEntries(TIMELINE_STOCK_FIELDS
    .filter((key) => stock[key] !== undefined)
    .map((key) => [key, stock[key]]));
}

function compactTimelineMetrics(metrics = {}) {
  // Calendar evidence is intentionally scalar/small-list only.  Do not return
  // raw member, quote, or core-snapshot arrays for every historical day.
  const keys = [
    "member_count", "active_member_count", "up_count", "up_ratio",
    "limit_up_count", "high_gain_count", "large_loss_count",
    "effective_member_count", "strong_member_count",
    "theme_amount", "theme_amount_change", "theme_amount_change_ratio", "market_amount",
    "relative_strength_score", "market_median_return", "theme_relative_return", "relative_strength_rank",
    "leader_status", "leader_return", "leader_group_size", "leader_broken_count", "leader_active_ratio", "leader_drives_theme",
    "capacity_core_return", "capacity_core_count", "capacity_core_up_ratio", "capacity_core_amount_ratio_5d", "capacity_core_status", "capacity_core_long_upper_count",
    "capacity_core_pool_size", "capacity_core_positive_count", "capacity_core_positive_count_ratio",
    "capacity_core_positive_weight", "capacity_core_neutral_weight", "capacity_core_weak_weight", "capacity_core_severe_weight",
    "capacity_core_pool_weighted_return", "core_pool_status",
  ];
  const compact = Object.fromEntries(keys.filter((key) => metrics[key] !== undefined).map((key) => [key, metrics[key]]));
  if (metrics.profit_effect && typeof metrics.profit_effect === "object") {
    compact.profit_effect = Object.fromEntries(PROFIT_EFFECT_FIELDS
      .filter((key) => metrics.profit_effect[key] !== undefined)
      .map((key) => [key, metrics.profit_effect[key]]));
  }
  for (const key of ["previous_leaders", "previous_capacity_cores"]) if (Array.isArray(metrics[key])) compact[key] = metrics[key].map(compactTimelineStock);
  return compact;
}

function compactTheme(theme) {
  if (!theme) return theme;
  const { members, original_members, recent_history, cycle_stage, score_history, ...compact } = theme;
  return {
    ...compact,
    score_history: Array.isArray(score_history) ? score_history.map((entry) => ({
      date: entry.date,
      score: entry.score,
      daily_strength_score: entry.daily_strength_score,
      metrics: compactTimelineMetrics(entry.metrics),
    })) : [],
    member_count: Array.isArray(members) ? members.length : (compact.breadth?.member_count ?? 0),
  };
}

export function compactMainlineResult(result) {
  const byKey = new Map();
  const allThemes = (result.all_themes || result.themes || []).map((theme) => {
    const compact = compactTheme(theme);
    byKey.set(compact.key || `${compact.primary}__${compact.name}`, compact);
    return compact;
  });
  const reference = (theme) => {
    if (!theme) return null;
    return byKey.get(theme.key || `${theme.primary}__${theme.name}`) || compactTheme(theme);
  };
  const mainline = Object.fromEntries(Object.entries(result.mainline || {}).map(([status, themes]) => [
    status,
    Array.isArray(themes) ? themes.map(reference) : themes,
  ]));
  return {
    ...result,
    themes: (result.themes || []).map(reference),
    all_themes: allThemes,
    requested_theme: reference(result.requested_theme),
    mainline,
  };
}
