const CHINEXT_PREFIXES = ["300", "301"];
const STAR_MARKET_PREFIXES = ["688", "689"];
const MAIN_BOARD_PREFIXES = ["000", "001", "002", "003", "600", "601", "603", "605"];
const BEIJING_EXCHANGE_PREFIXES = ["4", "8", "920"];

function normalizedCode(code = "") {
  return String(code).replace(/\D/g, "").padStart(6, "0").slice(-6);
}

export function isMainBoardStock(code = "") {
  const normalized = normalizedCode(code);
  return MAIN_BOARD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function stockBoardLabel(code = "") {
  const normalized = normalizedCode(code);
  if (CHINEXT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "创业板";
  if (STAR_MARKET_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "科创板";
  if (isMainBoardStock(normalized)) return "主板";
  if (BEIJING_EXCHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "北交所";
  return "";
}
