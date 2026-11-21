import assert from "node:assert/strict";
import { buildSectorLimitLadder, observeLimit } from "../lib/sector-limit-ladder.js";
import { isChinaAShareNonTradingDay } from "../lib/ashare-trading-calendar.js";

const code = "002708";
const member = { code, name: "样本", directions: ["传动 / 轴承", "传动 / 丝杠"] };
const quote = (sealed, fields = {}) => ({
  code, quoteName: "样本", preClose: 10, open: 10, high: sealed ? 11 : 10.5, low: 10,
  price: sealed ? 11 : 10.2, vol: 1000, ...fields,
});
const session = (date, row, final = true) => ({
  date, final, available: true, quotes: row ? [row, row] : [],
});
const dates = [];
for (let day = 1; day <= 11; day++) {
  const date = `2026-11-${String(day).padStart(2, "0")}`;
  if (!(await isChinaAShareNonTradingDay(date))) dates.push(date);
}
assert.deepEqual(dates.slice(-4), ["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"]);
assert.equal(await isChinaAShareNonTradingDay("2026-10-07"), true);
const prior = Array.from({ length: 5 }, (_, i) => session(`2026-09-${21 + i}`, quote(false)));
const pattern = [false, true, false, true, false, true, false, true, false, false, true, true, true];
const window = pattern.map((sealed, i) => session(`2026-10-${10 + i}`, quote(sealed)));
const series = [...prior, ...window];
const run = (sessions) => buildSectorLimitLadder({ sessions, members: [member, member], period: 30 });
const result = run(series);
assert.equal(result.ladder[0].height, 3);
assert.equal(result.ladder[0].rollingCount, 7);
assert.equal(result.current.limitUps, 1);
assert.deepEqual(result.directions.map((row) => row.limitUps), [1, 1]);
assert.equal(result.current.twoToThree, 1);
assert.equal(result.ladder[0].firstSealTime, undefined);

const next = (row, final) => [...series.slice(0, -1), session(window.at(-1).date, row, final)];
const broken = run(next(quote(false)));
assert.equal(broken.transitions[0].previousHeight, 2);
assert.equal(broken.transitions[0].status, "断板");
assert.equal(broken.current.failedSeals, 0);
assert.equal(run(next(quote(false, { high: 11 }))).current.failedSeals, 1);
assert.equal(run(next(quote(true), false)).transitions[0].status, "暂时晋级");
assert.equal(run(next(quote(true), false)).current.promotionRate, null);
const absent = run(next(null));
assert.equal(absent.transitions[0].status, "不可观察");
assert.equal(absent.current.observable, 0);
assert.equal(absent.current.previous, 1);
assert.equal(absent.current.promotionRate, null);
assert.equal(run([...next(null), session("2026-10-23", quote(true))]).ladder[0].heightExact, false);
assert.deepEqual(run([...series, session("2026-10-23", quote(false))]).history.slice(0, -1), result.history);
assert.equal(run(series).current.promotionRate, 1); // Same request after corrected inputs.

const observe = (row, board = "主板", earlier = 5) => observeLimit("2026-11-11", row, board, earlier);
assert.equal(observe(quote(true, { low: 11, open: 11 })).type, "一字板");
assert.equal(observe(quote(true, { open: 11 })).type, "T字板");
assert.equal(observe(quote(true)).type, "换手板");
assert.equal(observe(quote(true, { price: 10.99 })).sealed, false);
assert.equal(observe(quote(true, { open: 10.05, low: 10.05, preClose: 10.05, price: 11.06, high: 11.06 })).sealed, true);
assert.equal(observe(quote(true, { high: 12, price: 12 }), "创业板").sealed, true);
assert.equal(observe(quote(true, { high: 13, price: 13 }), "北交所", 1).sealed, true);
assert.equal(observe(quote(true), "主板", 4).sealed, undefined);
assert.equal(observe(quote(true, { vol: 0 })).sealed, undefined);
assert.equal(observe(quote(true, { quoteName: "N样本" })).sealed, undefined);
assert.equal(observeLimit("2026-06-01", quote(true, { quoteName: "ST样本", price: 10.5, high: 10.5 }), "主板", 5).sealed, true);
console.log("sector limit ladder contract passed");
