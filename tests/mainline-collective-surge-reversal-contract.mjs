import assert from "node:assert/strict";
import { cachedCapacityCorePool, calculateCollectiveIntradayReversalPenalty, calculateLeaderCapacityConsistencyPenalty, observeCollectiveIntradayReversal, observeLeaderCapacityDivergence, scoreMainline, selectCapacityCorePool, selectMarketCapCapacityCorePool } from "../lib/mainline.js";
import { compactMainlineResult } from "../lib/mainline-response.js";

const metric = ({ coverage = null, reversalWeight = null, deeperWeight = null, turnover = null } = {}) => ({
  collective_intraday_reversal: coverage == null ? null : {
    intraday_data_coverage_ratio: coverage,
    reversal_weight_ratio: reversalWeight,
    deeper_reversal_weight_ratio: deeperWeight,
    capacity_core_pool_size: 3,
  },
  collective_reversal_turnover: turnover,
});

const sameDayReversal = calculateCollectiveIntradayReversalPenalty([
  metric({ coverage: .8, reversalWeight: .7, deeperWeight: .2 }),
]);
assert.equal(sameDayReversal.triggered, true, "当天多数成员冲高后回落必须触发日强度惩罚");
assert.equal(sameDayReversal.base_penalty, 10, "回落覆盖尚未达到加重档时应只扣基础分");
assert.equal(sameDayReversal.penalty, 10, "当天触发不依赖此前交易日的涨幅");

const broadDeepReversal = calculateCollectiveIntradayReversalPenalty([
  metric({ coverage: .9, reversalWeight: .8, deeperWeight: .5 }),
]);
assert.equal(broadDeepReversal.base_penalty, 14, "回落覆盖广且深度回落成员偏多时应加重基础分");

const amplified = calculateCollectiveIntradayReversalPenalty([
  metric({ coverage: .8, reversalWeight: .7, deeperWeight: .2, turnover: { coverage_ratio: .8, accelerated_member_ratio: .75 } }),
]);
assert.equal(amplified.turnover_amplified, true, "当日回落成员换手率相对前5日显著放大时必须加重扣分");
assert.equal(amplified.turnover_penalty, 8, "高覆盖率且多数回落成员放量时应使用加重档");
assert.equal(amplified.penalty, 18, "总扣分必须包含当天回落基础惩罚与换手率加重惩罚");

const closeOnlyDrop = calculateCollectiveIntradayReversalPenalty([
  metric(),
]);
assert.equal(closeOnlyDrop.penalty, 0, "没有当天盘中冲高后回落证据时不得按收盘下跌扣分");

const insufficientIntradayCoverage = calculateCollectiveIntradayReversalPenalty([
  metric({ coverage: .5, reversalWeight: .8, deeperWeight: .6 }),
]);
assert.equal(insufficientIntradayCoverage.penalty, 0, "盘中高低价覆盖不足时不得把局部样本当作板块集体现象");

const theme = { members: Array.from({ length: 10 }, (_, index) => ({ code: String(index + 1).padStart(6, "0") })) };
const leaderCapacityPool = selectCapacityCorePool(theme.members.map(({ code }, index) => ({ code, score: 100 - index })), theme.members, .30);
const weightedLeaders = [{ code: "900001", change_pct: 5, leader_rank: 1 }, { code: "900002", change_pct: 3, leader_rank: 2 }];
const leaderUpCapacityDown = calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: observeLeaderCapacityDivergence({ previous_leaders: weightedLeaders }, [{ date: "2026-01-01", stocks: theme.members.map(({ code }) => ({ code, changePct: 0 })) }, { date: "2026-01-02", stocks: theme.members.map(({ code }, index) => ({ code, changePct: index === 0 ? -3 : index === 1 ? -2 : 0 })) }], 1, { capacity_core_pool: leaderCapacityPool, capacity_core_top_ratio: .30 }) });
assert.equal(leaderUpCapacityDown.penalty, 6.5, "龙头与排名靠前容量中军都必须按加权收益差扣除当日强度分");
assert.equal(leaderUpCapacityDown.triggered, true, "龙头中军背离必须可审计");
const lowerRankCapacityDown = calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: observeLeaderCapacityDivergence({ previous_leaders: weightedLeaders }, [{ date: "2026-01-01", stocks: theme.members.map(({ code }) => ({ code, changePct: 0 })) }, { date: "2026-01-02", stocks: theme.members.map(({ code }, index) => ({ code, changePct: index === 2 ? -3 : 0 })) }], 1, { capacity_core_pool: leaderCapacityPool, capacity_core_top_ratio: .30 }) });
assert.ok(leaderUpCapacityDown.penalty > lowerRankCapacityDown.penalty, "相同跌幅发生在更靠前的容量中军时，背离扣分必须更重");
const weakerLowerRankLeader = calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: observeLeaderCapacityDivergence({ previous_leaders: [{ code: "900001", change_pct: 3, leader_rank: 1 }, { code: "900002", change_pct: 5, leader_rank: 2 }] }, [{ date: "2026-01-01", stocks: theme.members.map(({ code }) => ({ code, changePct: 0 })) }, { date: "2026-01-02", stocks: theme.members.map(({ code }, index) => ({ code, changePct: index === 0 ? -3 : index === 1 ? -2 : 0 })) }], 1, { capacity_core_pool: leaderCapacityPool, capacity_core_top_ratio: .30 }) });
assert.ok(leaderUpCapacityDown.penalty > weakerLowerRankLeader.penalty, "相同龙头池涨幅总和中，排名更靠前的龙头上涨时扣分必须更重");
assert.equal(calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: { weighted_leader_return: -1.1, weighted_capacity_core_return: 2.3, leader_coverage_ratio: 1, capacity_core_coverage_ratio: 1 } }).penalty, 0, "中军上涨而龙头下跌可视为调整，不能额外扣分");
assert.equal(calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: { weighted_leader_return: -1.1, weighted_capacity_core_return: -2.3, leader_coverage_ratio: 1, capacity_core_coverage_ratio: 1 } }).penalty, 0, "龙头和容量中军同时下跌必须维持原有逻辑");
assert.equal(calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: { weighted_leader_return: 3.4, weighted_capacity_core_return: 1.2, leader_coverage_ratio: 1, capacity_core_coverage_ratio: 1 } }).penalty, 2.2, "龙头加权收益高于中军加权收益时必须按收益差扣分");
assert.equal(calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: { weighted_leader_return: 3.4, weighted_capacity_core_return: 3.4, leader_coverage_ratio: 1, capacity_core_coverage_ratio: 1 } }).penalty, 0, "龙头与中军加权收益相同不得扣分");
assert.equal(calculateLeaderCapacityConsistencyPenalty({ leader_capacity_divergence: { weighted_leader_return: 20, weighted_capacity_core_return: -20, leader_coverage_ratio: 1, capacity_core_coverage_ratio: 1 } }).penalty, 15, "龙头中军收益差的惩罚必须封顶15分");

const selectedCapacityCores = selectCapacityCorePool(theme.members.map(({ code }, index) => ({ code, score: 100 - index })), theme.members, .30);
assert.deepEqual(selectedCapacityCores.map((item) => item.code), ["000001", "000002", "000003"], "容量中军模块的排序结果必须只取前30%，不能再依赖历史流通市值池");
assert.equal(selectCapacityCorePool(theme.members.map(({ code }, index) => ({ code, score: 100 - index })), theme.members, .50).length, 5, "三级方向必须从容量中军排序中取前50%");

const marketCapPool = selectMarketCapCapacityCorePool(theme.members.map(({ code }, index) => ({ code, free_float_market_cap: (index + 1) * 1e8 })), theme.members, .30);
assert.deepEqual(marketCapPool.map((item) => item.code), ["000010", "000009", "000008"], "容量评分尚未生成时必须按已验证历史流通市值降序取前30%");
assert.ok(marketCapPool.every((item) => item.role_status === "provisional_market_cap_core" && item.capacity_core_score === null), "市值临时池不得伪装成已有容量中军评分");

const provisionalDate = "2099-01-02";
const provisionalPool = await cachedCapacityCorePool(provisionalDate, { ...theme, primary: "临时池测试", secondary: "市值排序", name: "市值排序" }, {
  priorDate: "2098-12-31",
  readFileImpl: async () => { throw new Error("容量中军文件尚未落盘"); },
  loadHistoricalMarketCapImpl: async (_date, code) => Number(code) * 1e8,
});
assert.deepEqual(provisionalPool.members.map((item) => item.code), ["000010", "000009", "000008"], "正式容量中军缺失时必须使用上一交易日历史流通市值临时池");
assert.equal(provisionalPool.source, "historical_free_float_market_cap", "临时池必须暴露可审计的数据来源");
assert.equal(provisionalPool.provisional, true, "市值排序结果必须显式标记为临时结果");
assert.equal(provisionalPool.observed_date, "2098-12-31", "临时池只能使用上一交易日市值，不能泄漏目标日或未来数据");

const compactProvisional = compactMainlineResult({ themes: [{ key: "测试__临时", primary: "测试", name: "临时", members: theme.members, score_history: [{ date: provisionalDate, metrics: { collective_intraday_reversal: { capacity_core_pool_size: 3, capacity_core_pool_source: provisionalPool.source, capacity_core_pool_provisional: provisionalPool.provisional, capacity_core_observed_date: provisionalPool.observed_date } } }] }], all_themes: [] });
assert.equal(compactProvisional.themes[0].score_history[0].metrics.collective_intraday_reversal.capacity_core_pool_source, "historical_free_float_market_cap", "接口压缩结果必须保留临时容量池来源");
assert.equal(compactProvisional.themes[0].score_history[0].metrics.collective_intraday_reversal.capacity_core_observed_date, "2098-12-31", "接口必须向前端保留市值观察日以便审计时间边界");

let capacityReadAttempts = 0;
const retryTheme = { ...theme, primary: "缓存回归测试", secondary: "读取重试", name: "读取重试" };
const retryDate = "2099-01-01";
const retryReader = async () => {
  capacityReadAttempts += 1;
  if (capacityReadAttempts === 1) throw new Error("容量中军文件尚未落盘");
  return JSON.stringify({ candidates: theme.members.map(({ code }, index) => ({ code, score: 100 - index })) });
};
assert.equal((await cachedCapacityCorePool(retryDate, retryTheme, { readFileImpl: retryReader })).members.length, 0, "首次读取失败时可以暂时返回空池");
const retriedFormalPool = await cachedCapacityCorePool(retryDate, retryTheme, { readFileImpl: retryReader });
assert.equal(retriedFormalPool.members.length, 3, "首次读取失败不能永久缓存空池，文件落盘后必须自动重试");
assert.equal(retriedFormalPool.source, "capacity_core_score", "正式容量评分落盘后必须覆盖临时市值口径");
assert.equal(retriedFormalPool.provisional, false, "正式容量评分池不得继续标记为临时结果");
assert.equal(capacityReadAttempts, 2, "容量中军缓存读取失败后应在下一次计算重新读取");
const daily = [
  { date: "2026-01-01", stocks: theme.members.map(({ code }) => ({ code, price: 10 })) },
  { date: "2026-01-02", stocks: theme.members.map(({ code }, index) => ({ code, price: index < 2 ? 9.3 : 10, high: index < 2 ? 10.1 : 10 })) },
];
const observed = observeCollectiveIntradayReversal(theme, daily, 1, { capacity_core_pool: selectedCapacityCores, capacity_core_top_ratio: .30 });
assert.ok(Math.abs(observed.reversal_weight_ratio - 5 / 6) < 1e-12, "最高仅涨 1%、收盘跌 7% 时，前两名市值中军应按排名权重计入回落");
assert.equal(observed.intraday_data_coverage_ratio, 1, "完整 OHLC 数据应计为完整覆盖");
assert.equal(observed.capacity_core_pool_size, 3, "回落观察池必须只使用市值中军前30%而非全部成员");
assert.equal(observed.capacity_core_top_ratio, .30, "二级板块审计信息必须保留容量中军前30%的观察口径");
const tertiaryObserved = observeCollectiveIntradayReversal({ ...theme, level: "tertiary" }, daily, 1, { capacity_core_pool: selectCapacityCorePool(theme.members.map(({ code }, index) => ({ code, score: 100 - index })), theme.members, .50), capacity_core_top_ratio: .50 });
assert.equal(tertiaryObserved.capacity_core_pool_size, 5, "三级方向必须使用本方向容量中军评分前50%作为观察池");
assert.equal(tertiaryObserved.capacity_core_top_ratio, .50, "三级方向审计信息必须保留容量中军前50%的观察口径");
const nonCoreReversal = observeCollectiveIntradayReversal(theme, [{ date: "2026-01-01", stocks: theme.members.map(({ code }) => ({ code, price: 10 })) }, { date: "2026-01-02", stocks: theme.members.map(({ code }, index) => ({ code, price: index >= 3 ? 9 : 10, high: index >= 3 ? 10.5 : 10 })) }], 1, { capacity_core_pool: theme.members.slice(0, 3) });
assert.equal(nonCoreReversal.reversal_weight_ratio, 0, "池外股票即使集体冲高回落，也不得影响中军回落惩罚");

const neutralMetrics = { relative_strength_score: 1, up_ratio: .6, _valid_member_count: 10, theme_amount_change_ratio: .1, market_amount: 1, theme_amount: 1, capacity_core_positive_weight: .5, capacity_core_return: 1, capacity_core_severe_weight: 0, negative_feedback_ratio: .1, active_member_count: 6 };
const compositeWithoutPenalty = scoreMainline({ score_history: [{ metrics: neutralMetrics }, { metrics: neutralMetrics }, { metrics: neutralMetrics }] });
const compositeWithPenalty = scoreMainline({ score_history: [{ metrics: neutralMetrics }, { metrics: neutralMetrics }, { metrics: { ...neutralMetrics, collective_intraday_reversal: observed } }] });
assert.ok(compositeWithPenalty.mainline_rank_score < compositeWithoutPenalty.mainline_rank_score, "冲高回落惩罚必须通过近3日强度进入综合分");
assert.ok(compositeWithPenalty.recent_strength_score < compositeWithPenalty.raw_recent_strength_score, "近3日强度必须保留罚分前后的审计差异");
assert.equal(compositeWithPenalty.collective_intraday_reversal_penalty, 14, "综合分审计字段必须展示与当天日强度一致的中军回落惩罚");
const compositeWithLeaderCapacityDivergence = scoreMainline({ score_history: [{ metrics: neutralMetrics }, { metrics: neutralMetrics }, { metrics: { ...neutralMetrics, leader_capacity_divergence: leaderUpCapacityDown } }] });
assert.ok(compositeWithLeaderCapacityDivergence.mainline_rank_score < compositeWithoutPenalty.mainline_rank_score, "龙头中军收益差惩罚必须通过近3日强度进入综合分");
assert.equal(compositeWithLeaderCapacityDivergence.leader_capacity_consistency_penalty, 6.5, "综合分审计字段必须保留龙头中军收益差扣分");

console.log("mainline collective intraday-reversal contract passed");
