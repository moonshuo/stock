import assert from "node:assert/strict";
import { isLimitUpClose, roundedUpperLimitPrice, selectGreenMainBoardRecentLimitUps } from "../app/lib/greenLimitUpSelection.js";

assert.equal(roundedUpperLimitPrice(10.03, "普通股"), 11.03, "普通主板涨停价必须按分四舍五入");
assert.equal(roundedUpperLimitPrice(10.03, "*ST 测试"), 10.53, "ST 涨停价应使用 5% 限制");
assert.equal(isLimitUpClose({ name: "普通股", preClose: 10, price: 10.98 }), false, "9.8% 并不等于涨停收盘");

const selected = selectGreenMainBoardRecentLimitUps({
  todayStocks: [
    { code: "600001", name: "甲", preClose: 11, price: 10.8, changePct: -1.82 },
    { code: "300001", name: "创业板", preClose: 12, price: 11, changePct: -8.33 },
    { code: "600002", name: "乙", preClose: 10, price: 10, changePct: 0 },
    { code: "600003", name: "*ST 丙", preClose: 11, price: 10, changePct: -9.09 },
  ],
  historicalStocksByDate: new Map([
    ["2026-10-15", [
      { code: "600001", name: "甲", preClose: 10, price: 11 },
      { code: "300001", name: "创业板", preClose: 10, price: 12 },
      { code: "600002", name: "乙", preClose: 10, price: 10.98 },
      { code: "600003", name: "*ST 丙", preClose: 10, price: 10.5 },
    ]],
    ["2026-10-16", [
      { code: "600001", name: "甲", preClose: 11, price: 12.1 },
    ]],
  ]),
});

assert.deepEqual(selected.map(({ code, limit_up_count, limit_up_dates }) => ({ code, limit_up_count, limit_up_dates })), [
  { code: "600001", limit_up_count: 2, limit_up_dates: ["2026-10-15", "2026-10-16"] },
], "仅保留绿盘主板股，且至少一次真实涨停收盘；不能将创业板或 9.8% 涨幅混入");
console.log("green limit-up selection contract passed");
