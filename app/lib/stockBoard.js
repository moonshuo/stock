const CHINEXT_PREFIXES = ["300", "301"];
const STAR_MARKET_PREFIXES = ["688", "689"];
const MAIN_BOARD_PREFIXES = ["000", "001", "002", "003", "600", "601", "603", "605"];

export function stockBoardLabel(code = "") {
  const normalized = String(code).replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (CHINEXT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "创业板";
  if (STAR_MARKET_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "科创板";
  if (MAIN_BOARD_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "主板";
  return "";
}
