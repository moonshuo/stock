import assert from "node:assert/strict";
import { closingSnapshotStatus, currentMarketSnapshotFreshness, hasFullMarketCoverage, isChinaMarketRefreshWindow, MIN_A_SHARE_SNAPSHOT_ROWS, needsClosingSnapshotRecovery } from "../lib/market-snapshot.js";

const intraday = closingSnapshotStatus(Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 14:13:43" })));
assert.equal(intraday.closing_confirmed, false, "14:13 行情不能被当作收盘快照");
assert.equal(intraday.latest_quote_time, "2026-08-14 14:13:43");

const closing = closingSnapshotStatus(Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 15:00:00" })));
assert.equal(closing.closing_confirmed, true, "全市场 15:00 行情应被确认为收盘快照");

const undersized = closingSnapshotStatus(Array.from({ length: 20 }, () => ({ tradeTime: "2026-08-14 15:00:00" })));
assert.equal(undersized.closing_confirmed, false, "不完整市场快照不能被确认收盘");
assert.equal(hasFullMarketCoverage(Array.from({ length: MIN_A_SHARE_SNAPSHOT_ROWS - 1 }, () => ({}))), false, "覆盖不足的盘中快照必须拒绝复用");
assert.equal(hasFullMarketCoverage(Array.from({ length: MIN_A_SHARE_SNAPSHOT_ROWS }, () => ({}))), true, "达到全市场覆盖下限的快照可以复用");
assert.equal(needsClosingSnapshotRecovery({ isCurrentMarketDate: true, marketAfterClose: true, rows: intradayRows() }), true, "收盘后遇到完整但未到15:00的快照必须自动触发补数");
assert.equal(needsClosingSnapshotRecovery({ isCurrentMarketDate: false, marketAfterClose: true, rows: intradayRows() }), false, "历史日期不应改写为当前日的自动补数路径");
assert.equal(needsClosingSnapshotRecovery({ isCurrentMarketDate: true, marketAfterClose: true, rows: closingRows() }), false, "已经确认收盘的快照不应重复补数");

assert.equal(isChinaMarketRefreshWindow(new Date("2026-08-14T09:29:00+08:00")), false, "开盘前不能抓取当日行情");
assert.equal(isChinaMarketRefreshWindow(new Date("2026-08-14T09:30:00+08:00")), true, "09:30 起应刷新当日行情");
assert.equal(isChinaMarketRefreshWindow(new Date("2026-08-14T12:07:00+08:00")), true, "午间休市仍应刷新至 11:30 快照");
assert.equal(isChinaMarketRefreshWindow(new Date("2026-08-14T15:01:00+08:00")), false, "15:00 后应进入收盘确认路径");

const staleLunchSnapshot = currentMarketSnapshotFreshness(
  Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 10:12:52" })),
  new Date("2026-08-14T12:07:00+08:00"),
);
assert.equal(staleLunchSnapshot.stale, true, "午间读取到 10:12 快照必须标记为滞后");
assert.equal(staleLunchSnapshot.lag_minutes, 78);

const currentLunchSnapshot = currentMarketSnapshotFreshness(
  Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 11:30:00" })),
  new Date("2026-08-14T12:07:00+08:00"),
);
assert.equal(currentLunchSnapshot.freshness_status, "current", "午休期间 11:30 快照应视为当前有效行情");

console.log("closing snapshot contract passed");

function intradayRows() {
  return Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 14:13:43" }));
}

function closingRows() {
  return Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 15:00:00" }));
}
