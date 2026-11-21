export function rankTertiaryThemesByScore(themes = [], scoreField) {
  return themes
    .filter((theme) => theme?.[scoreField] !== null && theme?.[scoreField] !== undefined && theme?.[scoreField] !== "" && Number.isFinite(Number(theme[scoreField])))
    .slice()
    .sort((left, right) => Number(right[scoreField]) - Number(left[scoreField])
      || String(left.primary || "").localeCompare(String(right.primary || ""), "zh-CN")
      || String(left.secondary || "").localeCompare(String(right.secondary || ""), "zh-CN")
      || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));
}

// The daily ranking view must show the same 0-100 daily strength score used
// by its ranking and calendar, never the raw percentage-point market return.
export function tertiaryDailyStrengthScore(theme) {
  const score = Number(theme?.daily_strength_score);
  return Number.isFinite(score) ? score : null;
}
