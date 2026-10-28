import assert from "node:assert/strict";
import { access, readFile } from "fs/promises";

const missing = async (path) => {
  await assert.rejects(access(new URL(path, import.meta.url)), "已移除的功能不得保留可访问的 API 路由");
};

await Promise.all([
  missing("../app/api/sector-priority-stock-selection/route.js"),
  missing("../app/api/stock-strength-rankings/route.js"),
  missing("../app/api/stock-score-history/route.js"),
  missing("../app/api/strategy-backtest/route.js"),
  missing("../lib/sector-priority-stock-selection.js"),
  missing("../lib/stock-strength-rankings.js"),
  missing("../lib/strategy-exit.js"),
]);

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
assert.doesNotMatch(page, /setWorkspaceView\(\(view\) => view === "backtest"/, "策略回测入口必须从工作区移除");
assert.doesNotMatch(page, /onClick=\{\(\) => \{ setSectorPriorityOpen\(true\)/, "板块优先选股入口必须从当日扫描页移除");
assert.doesNotMatch(page, /onClick=\{\(\) => \{ setStrengthRankingsOpen\(true\)/, "5日强势发现入口必须从当日扫描页移除");
assert.doesNotMatch(page, /onClick=\{\(\) => setScoreHistoryOpen\(true\)/, "个股评分历史入口必须从当日扫描页移除");

console.log("retired selection features contract passed");
