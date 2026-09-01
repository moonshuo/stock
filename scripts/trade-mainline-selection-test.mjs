import assert from "node:assert/strict";
import { selectTradeMainlines } from "../lib/trade-mainline-selection.js";

const started = (primary, name, mainline_rank_score, score) => ({
  primary, name, mainline_rank_score, score, status: "confirmed_mainline",
  cycle_stage: { confirmed_stage: "fermentation" },
});
const themes = [
  started("医药医疗", "医药研发与流通", 69.3, 63),
  started("半导体", "半导体材料", 65.7, 43),
  started("通信设备", "光通信", 65.2, 72),
  // This raw score would have incorrectly selected 新材料 before 半导体.
  started("新材料", "电子与光学材料", 65.1, 59),
  { ...started("半导体", "晶圆制造", 80, 90), cycle_stage: { confirmed_stage: "unstarted" } },
];

const selected = selectTradeMainlines(themes);
assert.deepEqual([...new Set(selected.map((theme) => theme.primary))], ["医药医疗", "半导体", "通信设备"]);
assert.deepEqual(selected.filter((theme) => theme.primary === "半导体").map((theme) => theme.name), ["半导体材料"]);
console.log("trade-mainline-selection-test: primary ranking and started-secondary scope passed");
