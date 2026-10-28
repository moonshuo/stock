import assert from "node:assert/strict";
import { selectDailyCoreModuleTargets, selectRankedCoreModuleTargets } from "../lib/mainline/core-module-selection.js";

const active = {
  primary: "测试", name: "活跃题材", members: [{ code: "000001" }, { code: "000002" }, { code: "000003" }],
  breadth: { valid_member_count: 3, up_count: 2, high_gain_count: 0, limit_up_count: 0, up_ratio: .67 },
};
const inactive = {
  primary: "测试", name: "无当日信号", members: [{ code: "000004" }, { code: "000005" }, { code: "000006" }],
  breadth: { valid_member_count: 3, up_count: 1, high_gain_count: 0, limit_up_count: 0, up_ratio: .33 },
};
const incomplete = {
  primary: "测试", name: "行情不完整", members: [{ code: "000007" }, { code: "000008" }, { code: "000009" }],
  breadth: { valid_member_count: 2, up_count: 2, high_gain_count: 1, limit_up_count: 0, up_ratio: 1 },
};

assert.deepEqual(selectDailyCoreModuleTargets([inactive, incomplete, active]).map((theme) => theme.name), ["活跃题材"]);
assert.deepEqual(
  selectRankedCoreModuleTargets([
    { ...inactive, rank: 2 },
    { ...incomplete, rank: 1 },
    { ...active, rank: 1 },
  ]).map((theme) => theme.name),
  ["活跃题材", "无当日信号"],
  "排名完成后，所有样本完整的已排名方向都必须自动计算；不能再要求用户点击无当日信号的方向",
);
console.log("core-module-selection contract passed");
