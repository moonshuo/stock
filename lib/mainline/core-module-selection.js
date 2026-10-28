// Dedicated capacity-core and leader analysis is only worthwhile when the
// target-day theme has enough observed members and an actual active signal.
// Keep this predicate aligned with the mainline's daily qualification rule.
export function isDailyCoreModuleEligible(theme, minimumMembers = 3) {
  const breadth = theme?.breadth || {};
  const validMembers = Number(breadth.valid_member_count) || 0;
  const upCount = Number(breadth.up_count) || 0;
  const highGainCount = Number(breadth.high_gain_count) || 0;
  const limitUpCount = Number(breadth.limit_up_count) || 0;
  return Array.isArray(theme?.members)
    && theme.members.length > 0
    && validMembers >= minimumMembers
    && (upCount >= 2 || highGainCount >= 1 || limitUpCount >= 1);
}

export function coreModuleSignalScore(theme) {
  const breadth = theme?.breadth || {};
  return (Number(breadth.limit_up_count) || 0) * 20
    + (Number(breadth.high_gain_count) || 0) * 8
    + (Number(breadth.up_ratio) || 0) * 10
    + (Number(breadth.theme_amount_change_ratio) > 0 ? 5 : 0);
}

export function selectDailyCoreModuleTargets(themes, minimumMembers = 3) {
  return (themes || [])
    .filter((theme) => isDailyCoreModuleEligible(theme, minimumMembers))
    .map((theme) => ({ theme, signal: coreModuleSignalScore(theme) }))
    .sort((left, right) => right.signal - left.signal
      || left.theme.primary.localeCompare(right.theme.primary, "zh-CN")
      || left.theme.name.localeCompare(right.theme.name, "zh-CN"))
    .map((item) => item.theme);
}

export function isRankedCoreModuleEligible(theme, minimumMembers = 3) {
  const breadth = theme?.breadth || {};
  const memberCount = Array.isArray(theme?.members) ? theme.members.length : Number(theme?.member_count) || 0;
  return memberCount > 0 && (Number(breadth.valid_member_count) || 0) >= minimumMembers;
}

// Once mainline scores and ranks exist, every direction with a sufficient
// observed sample receives core analysis. Rank order controls the queue only;
// it never changes eligibility or the resulting capacity/leader formulas.
export function selectRankedCoreModuleTargets(themes, minimumMembers = 3) {
  return (themes || [])
    .filter((theme) => isRankedCoreModuleEligible(theme, minimumMembers))
    .sort((left, right) => (Number(left.rank) || Infinity) - (Number(right.rank) || Infinity)
      || (Number(right.mainline_rank_score ?? right.score) || -Infinity) - (Number(left.mainline_rank_score ?? left.score) || -Infinity)
      || left.primary.localeCompare(right.primary, "zh-CN")
      || left.name.localeCompare(right.name, "zh-CN"));
}
