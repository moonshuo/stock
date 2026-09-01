import assert from "node:assert/strict";
import { closingSnapshotStatus, hasFullMarketCoverage, MIN_A_SHARE_SNAPSHOT_ROWS, needsClosingSnapshotRecovery } from "../lib/market-snapshot.js";

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

console.log("closing snapshot contract passed");

function intradayRows() {
  return Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 14:13:43" }));
}

function closingRows() {
  return Array.from({ length: 5164 }, () => ({ tradeTime: "2026-08-14 15:00:00" }));
}
