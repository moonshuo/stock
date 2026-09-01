export const TRADE_MAINLINE_LIMIT = 3;

export function isUnstartedTradeTheme(theme = {}) {
  return !Number.isFinite(Number(theme.mainline_rank_score ?? theme.score));
}

function displayScore(theme = {}) {
  return Number.isFinite(Number(theme.mainline_rank_score))
    ? Number(theme.mainline_rank_score)
    : Number(theme.score);
}

function compareThemes(left, right) {
  return displayScore(right) - displayScore(left)
    || (Number(left.rank) || Number.MAX_SAFE_INTEGER) - (Number(right.rank) || Number.MAX_SAFE_INTEGER)
    || String(left.name || left.secondary || "").localeCompare(String(right.name || right.secondary || ""), "zh-CN");
}

// Primary selection is based on the same displayed comprehensive score as the
// primary ranking. A secondary direction's raw score must not choose a primary.
export function selectTradeMainlines(themes = []) {
  const groups = new Map();
  for (const theme of themes) {
    if (!theme?.primary || !(theme?.name || theme?.secondary) || isUnstartedTradeTheme(theme)) continue;
    const group = groups.get(theme.primary) || [];
    group.push(theme);
    groups.set(theme.primary, group);
  }
  const rankedPrimaries = [...groups.entries()]
    .map(([primary, items]) => ({ primary, representative: [...items].sort(compareThemes)[0] }))
    .sort((left, right) => compareThemes(left.representative, right.representative)
      || left.primary.localeCompare(right.primary, "zh-CN"));
  return rankedPrimaries.slice(0, TRADE_MAINLINE_LIMIT)
    .flatMap((group) => themes.filter((theme) => theme.primary === group.primary && !isUnstartedTradeTheme(theme)).sort(compareThemes));
}
