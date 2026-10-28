import assert from "node:assert/strict";
import { buildDailyQuoteMeta, buildLiveQuoteMeta, formatQuoteClock } from "../app/lib/quoteTime.js";

assert.equal(formatQuoteClock("2026-10-13 10:12:52"), "10:12:52");
assert.equal(formatQuoteClock("2026-10-13T10:12:52.000+08:00"), "10:12:52");
assert.equal(formatQuoteClock("10:12:52"), "10:12:52");
assert.equal(formatQuoteClock(""), "");

const stale = buildDailyQuoteMeta({
  date: "2026-10-13",
  sourceNote: "本地5分钟Parquet",
  snapshot: { latest_quote_time: "2026-10-13 10:12:52", captured_at: "2026-10-13T10:13:05+08:00", stale: true, lag_minutes: 78 },
});
assert.equal(stale.label, "截至 10:12:52 · 滞后 78 分钟");
assert.equal(stale.status, "stale");
assert.match(stale.title, /行情时间 2026-10-13 10:12:52/);
assert.match(stale.title, /抓取时间/);

const closing = buildDailyQuoteMeta({
  date: "2026-10-13",
  snapshot: { latest_quote_time: "2026-10-13 15:00:00", closing_confirmed: true },
});
assert.equal(closing.status, "closing");

const live = buildLiveQuoteMeta({ source: "eastmoney", quoteTime: "2026-10-13 13:08:21", fetchedAt: "2026-10-13T05:08:22.000Z" });
assert.equal(live.label, "截至 13:08:21");
assert.match(live.title, /行情时间/);
assert.match(live.title, /抓取时间/);

console.log("quote time contract passed");
