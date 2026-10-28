import assert from "node:assert/strict";
import { sortByMarketChange } from "../app/lib/marketChangeSorting.js";

const rows = [
  { name: "无行情" },
  { name: "空行情", changePct: null },
  { name: "下跌", changePct: -1.04 },
  { name: "领涨", changePct: 3.27 },
  { name: "平手一", changePct: 0.74 },
  { name: "平手二", changePct: 0.74 },
  { name: "非法行情", changePct: "--" },
];

const sorted = sortByMarketChange(rows, (row) => row.changePct);

assert.deepEqual(
  sorted.map((row) => row.name),
  ["领涨", "平手一", "平手二", "下跌", "无行情", "空行情", "非法行情"],
  "涨幅应从高到低排列；同涨幅保持原顺序；缺失或非法行情放在末尾",
);
assert.deepEqual(rows.map((row) => row.name), ["无行情", "空行情", "下跌", "领涨", "平手一", "平手二", "非法行情"], "排序不得修改原数组");

console.log("market change sorting contract passed");
