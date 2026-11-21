import assert from "node:assert/strict";
import { analyzeMainlines } from "../lib/mainline.js";
import { analyzeStrongPullbacks } from "../lib/strong-pullback/service.js";
import { loadDailyMarket, runDailyMarketTask } from "../app/api/daily-market/route.js";

// This is a data-integration regression, not a human-confirmed strategy
// golden case. It protects units, dates, missing-data semantics and wiring.
const result = await runDailyMarketTask(() => analyzeStrongPullbacks({
  date: "2026-10-09",
  code: "002244",
  displayFilterEnabled: false,
  loadDailyMarket,
  analyzeMainlines,
}));

assert.equal(result.date, "2026-10-09");
assert.ok(result.data_scope.history_end <= result.date, "评分不得读取目标日之后行情");
assert.ok(result.data_scope.board_rank_history_covered_dates.every((date) => date <= result.date), "板块排名历史不得包含未来日期");
assert.equal(result.results.length, 1);
const stock = result.results[0];
assert.equal(stock.code, "002244");
assert.equal(stock.completeness.complete, true, "真实缓存字段齐全时应形成完整分");
assert.ok(stock.score > 0 && stock.score <= 100);
const pullback = stock.dimensions.find((item) => item.key === "pullback_quality");
assert.ok(pullback.raw.volume_ratio > 0.65 && pullback.raw.volume_ratio < 0.75, "跨日量比必须使用统一日线成交量口径，不能回退到单位不一致的 Parquet vol");
assert.ok(pullback.raw.turnover_ratio > 0.65 && pullback.raw.turnover_ratio < 0.75);
assert.equal(result.sources.turnover, "data/daily_turnover_rate/YYYY-MM-DD/*.json");
assert.match(result.data_scope.historical_membership_limitation, /没有逐日成分关系版本/, "历史回放必须披露当前成分关系限制");
assert.equal(result.data_scope.historical_replay_eligible, false, "缺少目标日成分快照的事后重算不得冒充严格历史回放");

console.log("strong pullback real-data contract passed");
