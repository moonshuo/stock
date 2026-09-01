export const CHINA_CLOSE_MINUTE = 15 * 60;
// A market-wide A-share quote snapshot must be broad enough to cover the
// listed universe.  This is a data-validity floor, not a trading threshold.
export const MIN_A_SHARE_SNAPSHOT_ROWS = 3000;

export function hasFullMarketCoverage(rows = []) {
  return Array.isArray(rows) && rows.length >= MIN_A_SHARE_SNAPSHOT_ROWS;
}

function clockMinute(value) {
  const match = String(value || "").match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minute) ? minute : null;
}

// File mtime is not evidence of a close: a 14:13 snapshot copied at 17:42 is
// still an intraday snapshot.  The provider's latest quote time must reach
// the 15:00 close, and the result must cover the full A-share universe.
export function closingSnapshotStatus(rows = []) {
  const quoteMinutes = rows.map((row) => clockMinute(row.tradeTime)).filter(Number.isFinite);
  const latestQuoteMinute = quoteMinutes.length ? Math.max(...quoteMinutes) : null;
  return {
    row_count: rows.length,
    latest_quote_time: rows.reduce((latest, row) => String(row.tradeTime || "") > latest ? String(row.tradeTime || "") : latest, ""),
    latest_quote_minute: latestQuoteMinute,
    closing_confirmed: hasFullMarketCoverage(rows) && latestQuoteMinute !== null && latestQuoteMinute >= CHINA_CLOSE_MINUTE,
  };
}

// A current trading day may have a broad intraday snapshot after the market
// closes, while the provider has not yet exposed its 15:00 quote.  That is a
// data-recovery condition, not a reason to make the user retry manually.
export function needsClosingSnapshotRecovery({ isCurrentMarketDate = false, marketAfterClose = false, rows = [] } = {}) {
  return Boolean(isCurrentMarketDate && marketAfterClose && !closingSnapshotStatus(rows).closing_confirmed);
}
