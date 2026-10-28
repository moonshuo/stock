export function formatQuoteClock(value = "") {
  const match = String(value || "").match(/(?:^|T|\s)(\d{1,2}:\d{2}(?::\d{2})?)/);
  return match?.[1] || "";
}

function formatCapturedAt(value = "") {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return String(value);
  return parsed.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function buildDailyQuoteMeta(payload = {}) {
  const snapshot = payload.snapshot || {};
  const quoteClock = formatQuoteClock(snapshot.latest_quote_time);
  const stale = snapshot.stale === true;
  const lagMinutes = Number(snapshot.lag_minutes);
  const status = snapshot.closing_confirmed
    ? "closing"
    : stale
      ? "stale"
      : snapshot.freshness_status === "historical"
        ? "historical"
        : "current";
  const labelParts = [quoteClock ? `截至 ${quoteClock}` : "行情时间未知"];
  if (stale && Number.isFinite(lagMinutes)) labelParts.push(`滞后 ${lagMinutes} 分钟`);
  const detailParts = [payload.sourceNote || payload.source || "行情来源未知"];
  if (snapshot.latest_quote_time) detailParts.push(`行情时间 ${snapshot.latest_quote_time}`);
  if (snapshot.captured_at) detailParts.push(`抓取时间 ${formatCapturedAt(snapshot.captured_at)}`);
  return { label: labelParts.join(" · "), status, title: detailParts.join("；") };
}

export function buildLiveQuoteMeta(payload = {}) {
  const quoteClock = formatQuoteClock(payload.quoteTime);
  const fetchedAt = formatCapturedAt(payload.fetchedAt);
  return {
    label: quoteClock ? `截至 ${quoteClock}` : `读取于 ${formatQuoteClock(payload.updatedAt) || "时间未知"}`,
    status: quoteClock ? "current" : "unknown",
    title: [`来源 ${payload.source || "未知"}`, payload.quoteTime ? `行情时间 ${payload.quoteTime}` : "行情时间未知", fetchedAt ? `抓取时间 ${fetchedAt}` : ""].filter(Boolean).join("；"),
  };
}
