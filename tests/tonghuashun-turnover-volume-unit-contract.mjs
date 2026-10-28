import assert from "node:assert/strict";
import { tonghuashunDailyVolumeToShares } from "../lib/intraday5m.js";
import { metadataFromHistoricalTurnover } from "../lib/backtest-market-metadata.js";

// 2026-09-23 盛视科技：本地行情成交额约 7.92 亿元，与 14,599,300 股 ×
// 54.56 元相符；同花顺日线成交量已经是股，不能再乘 100。
const volume = tonghuashunDailyVolumeToShares(14_599_300);
assert.equal(volume, 14_599_300);
const metadata = metadataFromHistoricalTurnover({ turnoverRate: 10.578, historicalQuote: { close: 54.56, volume } });
assert.ok(Math.abs(metadata.free_float_market_cap / 1e8 - 75.30) < .01, "同花顺成交量不得把真实历史流通市值放大100倍");
console.log("tonghuashun turnover-volume unit contract passed");
