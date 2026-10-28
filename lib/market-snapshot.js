export const CHINA_CLOSE_MINUTE = 15 * 60;
// A market-wide A-share quote snapshot must be broad enough to cover the
// listed universe.  This is a data-validity floor, not a trading threshold.
export const MIN_A_SHARE_SNAPSHOT_ROWS = 3000;
const CHINA_OPEN_MINUTE = 9 * 60 + 30;
const CHINA_MORNING_CLOSE_MINUTE = 11 * 60 + 30;
const CHINA_AFTERNOON_OPEN_MINUTE = 13 * 60;
const SNAPSHOT_LAG_TOLERANCE_MINUTES = 5;

export function hasFullMarketCoverage(rows = []) {
  return Array.isArray(rows) && rows.length >= MIN_A_SHARE_SNAPSHOT_ROWS;
}

function clockMinute(value) {
  const match = String(value || "").match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minute) ? minute : null;
}

function chinaMarketClock(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return {
    weekday: parts.weekday,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function expectedLatestQuoteMinute(value = new Date()) {
  const { weekday, minute } = chinaMarketClock(value);
  if (weekday === "Sat" || weekday === "Sun" || minute < CHINA_OPEN_MINUTE) return null;
  if (minute <= CHINA_MORNING_CLOSE_MINUTE) return minute;
  if (minute < CHINA_AFTERNOON_OPEN_MINUTE) return CHINA_MORNING_CLOSE_MINUTE;
  return Math.min(minute, CHINA_CLOSE_MINUTE);
}

// The current trading day remains refreshable through the lunch break. Quote
// providers then expose their 11:30 snapshot, which is newer than an arbitrary
// morning cache and must not be hidden behind the session-open predicate.
export function isChinaMarketRefreshWindow(value = new Date()) {
  const { weekday, minute } = chinaMarketClock(value);
  return weekday !== "Sat" && weekday !== "Sun" && minute >= CHINA_OPEN_MINUTE && minute <= CHINA_CLOSE_MINUTE;
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

export function currentMarketSnapshotFreshness(rows = [], value = new Date()) {
  const snapshot = closingSnapshotStatus(rows);
  const expectedMinute = expectedLatestQuoteMinute(value);
  if (snapshot.latest_quote_minute === null || expectedMinute === null) {
    return { freshness_status: "unknown", lag_minutes: null, stale: false };
  }
  const lagMinutes = Math.max(0, expectedMinute - snapshot.latest_quote_minute);
  const stale = lagMinutes > SNAPSHOT_LAG_TOLERANCE_MINUTES;
  return {
    freshness_status: snapshot.closing_confirmed ? "closing-confirmed" : stale ? "stale" : "current",
    lag_minutes: lagMinutes,
    stale,
  };
}

// A current trading day may have a broad intraday snapshot after the market
// closes, while the provider has not yet exposed its 15:00 quote.  That is a
// data-recovery condition, not a reason to make the user retry manually.
export function needsClosingSnapshotRecovery({ isCurrentMarketDate = false, marketAfterClose = false, rows = [] } = {}) {
  return Boolean(isCurrentMarketDate && marketAfterClose && !closingSnapshotStatus(rows).closing_confirmed);
}
