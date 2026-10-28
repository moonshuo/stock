import assert from "node:assert/strict";
import { rankTertiaryThemesByScore } from "../app/lib/tertiaryRanking.js";

const themes = [
  { primary: "电子", secondary: "元件", name: "PCB", mainline_rank_score: 72.5, daily_strength_score: 41 },
  { primary: "电子", secondary: "半导体", name: "设备", mainline_rank_score: 68, daily_strength_score: 83 },
  { primary: "通信", secondary: "光模块", name: "高速", mainline_rank_score: 72.5, daily_strength_score: 56 },
  { primary: "电子", secondary: "元件", name: "无数据", mainline_rank_score: null, daily_strength_score: null },
];

assert.deepEqual(
  rankTertiaryThemesByScore(themes, "mainline_rank_score").map((theme) => theme.name),
  ["PCB", "高速", "设备"],
  "三级综合排序必须使用既有综合分，分数相同按产业路径稳定排序",
);
assert.deepEqual(
  rankTertiaryThemesByScore(themes, "daily_strength_score").map((theme) => theme.name),
  ["设备", "高速", "PCB"],
  "三级当日排序必须只使用当日评分，且不把无评分方向混入榜单",
);

console.log("tertiary rankings contract passed");
