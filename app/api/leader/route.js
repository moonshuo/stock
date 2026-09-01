import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { loadDailyMarket } from "../daily-market/route";
import { classificationPrimarySector, isStStockName, normalizeCode } from "../../lib/sectorSystem";
import { postSurgeCollapseEvidence } from "../../lib/leaderCandidateRules";
import { normalizedRelevanceScore, relevanceAdjustedCoreScore } from "../../../lib/core-relevance-score.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = process.cwd();
const STOCK_MAP = path.join(ROOT, "data", "stock_sector_map.json");
const CONFIG = path.join(ROOT, "data", "leader_config.json");
const CACHE_ROOT = path.join(ROOT, "data", "leader-v5");
function cachePath(date, primary, secondary) {
  const key = `${primary}__${secondary}`.replace(/[<>:"/\\|?*]/g, "_");
  return path.join(CACHE_ROOT, date, `${key}.json`);
}
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const median = (values) => {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b), i = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2;
};
const isLimit = (code, value) => (code.startsWith("300") || code.startsWith("301") || code.startsWith("688") ? value >= 19.5 : code.startsWith("8") || code.startsWith("4") ? value >= 29 : value >= 9.8);

function datesTo(date, count = 6) {
  const cursor = new Date(`${date}T12:00:00Z`), result = [];
  while (result.length < count) {
    if (![0, 6].includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return result.reverse();
}

async function tradingDaysTo(date, count = 6) {
  const cursor = new Date(`${date}T12:00:00Z`), days = [];
  for (let attempts = 0; days.length < count && attempts < 50; attempts += 1) {
    if (![0, 6].includes(cursor.getUTCDay())) {
      const payload = await loadDailyMarket(cursor.toISOString().slice(0, 10));
      if (!payload?.error) days.unshift(payload);
      // The daily loader may report a holiday as 404 or as a failed history
      // backfill (502).  Neither is a tradable session, so skip it and keep
      // searching rather than aborting the whole theme-leader analysis.
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

function pctRank(value, values) {
  const sorted = [...values].sort((a, b) => b - a), index = sorted.indexOf(value);
  return sorted.length <= 1 ? 1 : 1 - index / (sorted.length - 1);
}

async function membersFor(primary, secondary) {
  const map = JSON.parse(await readFile(STOCK_MAP, "utf8"));
  return (map.stocks || []).filter((stock) => !isStStockName(stock.name) && (stock.classifications || []).some((item) => classificationPrimarySector(stock, item) === primary && item.secondary_sector === secondary))
    .map((stock) => {
      const matches = (stock.classifications || []).filter((item) => classificationPrimarySector(stock, item) === primary && item.secondary_sector === secondary);
      const confidence = Math.max(...matches.map((item) => num(item.relevance_score) ?? num(item.theme_mapping_confidence) ?? 0));
      return { code: normalizeCode(stock.code), name: String(stock.name || ""), mapping_confidence: confidence, relevance_score: normalizedRelevanceScore(confidence) };
    });
}

function cumulativeReturn(history) {
  return history.reduce((value, row) => value * (1 + (row.return_pct || 0) / 100), 1) - 1;
}

function longestLimits(history, code) {
  let best = 0, current = 0;
  for (const row of history) { current = isLimit(code, row.return_pct) ? current + 1 : 0; best = Math.max(best, current); }
  return best;
}

function trailingLeadingDays(history) {
  let count = 0;
  for (const row of [...history].reverse()) { if (!row.top20pct) break; count += 1; }
  return count;
}

function buildCandidatePool(stocks, config) {
  const size = Math.min(config.candidate.pool_maximum ?? 10, Math.max(config.candidate.pool_minimum ?? 5, Math.ceil(stocks.length * (config.candidate.pool_ratio ?? .3))));
  const evaluated = [...stocks].map((stock) => {
    const strongDays = stock.history.filter((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(stock.code, row.return_pct)).length;
    const frontlineDays = stock.history.filter((row) => row.top20pct).length;
    const firstStrong = stock.history.findIndex((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(stock.code, row.return_pct));
    const rawCandidateEvidence = strongDays * 5 + frontlineDays * 4 + (firstStrong >= 0 ? Math.max(0, 5 - firstStrong) : 0);
    return {
      ...stock,
      _candidate_evidence_raw: rawCandidateEvidence,
      _candidate_evidence: relevanceAdjustedCoreScore(rawCandidateEvidence, stock.relevance_score),
      _collapse_evidence: postSurgeCollapseEvidence(stock.code, stock.history),
    };
  }).filter((stock) => stock._candidate_evidence > 0);
  const rank = (left, right) => right._candidate_evidence - left._candidate_evidence || cumulativeReturn(right.history) - cumulativeReturn(left.history);
  return {
    pool: evaluated.filter((stock) => !stock._collapse_evidence.collapsed).sort(rank).slice(0, size),
    rejected: evaluated.filter((stock) => stock._collapse_evidence.collapsed).sort(rank),
  };
}

function leaderScore(stock, theme, config) {
  const returns = stock.history.map((row) => row.return_pct);
  const cumulative = cumulativeReturn(stock.history) * 100;
  const recent3 = cumulativeReturn(stock.history.slice(-3)) * 100;
  const activeIndex = stock.history.findIndex((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(stock.code, row.return_pct));
  const firstActive = stock._first_active_context_date || (activeIndex < 0 ? null : stock.history[activeIndex].date);
  const activeContextIndex = stock._first_active_context_index ?? activeIndex;
  const firstThemeActive = Math.min(...theme.stocks.map((item) => {
    const index = item._first_active_context_index ?? item.history.findIndex((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(item.code, row.return_pct));
    return index >= 0 ? index : Infinity;
  }));
  const initiation = activeContextIndex == null || activeContextIndex < 0 ? 0 : activeContextIndex === firstThemeActive ? 15 : activeContextIndex <= firstThemeActive + 1 ? 11 : activeContextIndex <= firstThemeActive + 2 ? 6 : 1;
  const allCumulative = theme.stocks.map((item) => cumulativeReturn(item.history) * 100);
  const limitDays = longestLimits(stock.history, stock.code);
  const height = Math.min(20, Math.round(12 * pctRank(cumulative, allCumulative) + Math.min(8, limitDays * 2)));
  const frontlineDays = stock.history.filter((row) => row.top20pct).length;
  const strongDays = stock.history.filter((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(stock.code, row.return_pct)).length;
  const continued = Math.min(20, Math.round(10 * frontlineDays / stock.history.length + 6 * strongDays / stock.history.length + 4 * pctRank(recent3, theme.stocks.map((item) => cumulativeReturn(item.history.slice(-3)) * 100))));
  const startIndex = activeIndex < 0 ? stock.history.length : activeIndex;
  const followingDays = stock.history.slice(startIndex + 1);
  const followCount = followingDays.filter((row) => row.theme_up_ratio >= .55 || row.theme_limit_count > row.previous_theme_limit_count || row.theme_median_return > 0).length;
  const followRate = followingDays.length ? followCount / followingDays.length : 0;
  const leadership = followingDays.length ? Math.min(20, Math.round(20 * followRate)) : 0;
  const divergence = stock.history.filter((row) => row.theme_median_return < 0);
  const divergenceRelative = divergence.map((row) => row.return_pct - row.theme_median_return);
  const survival = !divergence.length ? 0 : Math.min(15, Math.round(10 * divergenceRelative.filter((value) => value > 0).length / divergence.length + 5 * pctRank(median(divergenceRelative), theme.divergenceRelativeValues)));
  const repairDays = stock.history.filter((row, index) => index > 0 && stock.history[index - 1].theme_median_return < 0 && row.return_pct > row.theme_median_return && row.return_pct > 0).length;
  const repair = !divergence.length ? 0 : Math.min(10, Math.round(10 * repairDays / divergence.length));
  const rawScore = initiation + height + continued + leadership + survival + repair;
  const relevanceScore = normalizedRelevanceScore(stock.relevance_score ?? stock.mapping_confidence);
  const score = relevanceAdjustedCoreScore(rawScore, relevanceScore);
  const independent = limitDays >= 2 && leadership <= 5;
  const lateFollower = activeIndex > firstThemeActive + 2 && frontlineDays < Math.ceil(stock.history.length * .4) && leadership < 10;
  const consecutiveLeading = trailingLeadingDays(stock.history);
  const status = independent ? "independent_high_stock" : lateFollower ? "late_follower" : score >= config.thresholds.confirmed_leader && consecutiveLeading >= 2 && survival >= 8 && repair >= 5 ? "confirmed_leader" : score >= config.thresholds.confirmed_leader && consecutiveLeading >= 2 ? "provisional_leader" : score >= config.thresholds.leader_candidate ? "high_confidence_candidate" : score >= config.thresholds.frontline_core ? "leader_candidate" : "follow_up_or_normal_member";
  const roleAttributes = [];
  if (limitDays >= 2) roleAttributes.push("emotion_leader");
  if (continued >= 14 && limitDays < 2) roleAttributes.push("trend_leader");
  if ((stock.code.startsWith("300") || stock.code.startsWith("688")) && cumulative >= 20 && continued >= 12) roleAttributes.push("high_elasticity_leader");
  stock._leader_memory = {
    frontline_days: frontlineDays,
    strong_days: strongDays,
    leading_streak_days: consecutiveLeading,
    following_rate: +followRate.toFixed(2),
    repair_score: repair,
    late_follower: lateFollower,
  };
  return { ...stock, raw_score: rawScore, relevance_score: relevanceScore, score, status, primary_role: roleAttributes[0] || (status === "independent_high_stock" ? "independent_high_stock" : "frontline_member"), role_attributes: roleAttributes, score_details: { initiation, height, continued_strength: continued, theme_leadership: leadership, divergence_survival: survival, raw_total: rawScore, relevance_score: relevanceScore, relevance_adjusted_total: score }, evidence: { first_active_date: firstActive, days_leading_theme: activeIndex < 0 ? null : Math.max(0, stock.history.length - activeIndex), consecutive_limit_days: limitDays, return_since_theme_start: +cumulative.toFixed(2), return_3d: +recent3.toFixed(2), return_5d: +(cumulativeReturn(stock.history.slice(-5)) * 100).toFixed(2), relative_strength_positive_days_5d: stock.history.slice(-5).filter((row) => row.return_pct > row.theme_median_return).length, theme_new_limit_up_count: followingDays.reduce((sum, row) => sum + Math.max(0, row.theme_limit_count - row.previous_theme_limit_count), 0), theme_next_day_median_return: followingDays[0]?.theme_median_return ?? null, divergence_relative_strength: divergenceRelative.length ? +median(divergenceRelative).toFixed(2) : null }, positive_signals: [initiation >= 15 && "early_initiation", height >= 15 && "theme_height", continued >= 12 && "sustained_relative_strength", leadership >= 10 && "theme_following_evidence", survival >= 8 && "divergence_resilience"].filter(Boolean), negative_signals: [independent && "no_theme_following", activeIndex < 0 && "no_active_start", survival === 0 && "no_divergence_evidence"].filter(Boolean), reason: independent ? "个股高度存在，但题材未出现跟随证据，归为独立高位股。" : `原始六维分乘以 ${(relevanceScore * 100).toFixed(0)}% 关联度得到最终分；最终排名和龙头门槛均使用调整后分数。` };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = String(searchParams.get("date") || ""), primary = String(searchParams.get("primary") || "").trim(), secondary = String(searchParams.get("secondary") || "").trim();
  const force = searchParams.get("force") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !primary || !secondary) return NextResponse.json({ error: "date、primary、secondary 为必填参数" }, { status: 400 });
  if (!force) {
    try { return NextResponse.json({ ...(JSON.parse(await readFile(cachePath(date, primary, secondary), "utf8"))), source: "cache" }); }
    catch { /* First calculation, or a cache that has been cleared. */ }
  }
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  const members = await membersFor(primary, secondary);
  if (members.length < config.candidate.minimum_members) return NextResponse.json({ leader_analysis: { status: "insufficient_data", candidates: [], missing_data: ["theme_member_count"] } });
  const historyDays = config.candidate.history_days ?? 10;
  const contextDays = Math.max(historyDays, config.candidate.initiation_context_days ?? historyDays);
  const days = await tradingDaysTo(date, contextDays);
  if (days.length < historyDays) return NextResponse.json({ leader_analysis: { status: "insufficient_data", candidates: [], missing_data: ["daily_market_history"] } });
  const stocks = members.map((member) => ({ ...member, history: [] }));
  for (const day of days) {
    const quotes = new Map((day.stocks || []).map((item) => [item.code, item]));
    const themeReturns = stocks.map((item) => num(quotes.get(item.code)?.changePct)).filter(Number.isFinite);
    const themeMedian = median(themeReturns), themeUpRatio = themeReturns.filter((value) => value > 0).length / Math.max(1, themeReturns.length), themeLimitCount = stocks.filter((item) => isLimit(item.code, num(quotes.get(item.code)?.changePct) ?? -Infinity)).length;
    const rankedCodes = [...stocks].sort((left, right) => (num(quotes.get(right.code)?.changePct) ?? -Infinity) - (num(quotes.get(left.code)?.changePct) ?? -Infinity)).map((item) => item.code);
    const topCount = Math.max(1, Math.ceil(stocks.length * (config.candidate.top_percentile ?? .2)));
    for (const stock of stocks) stock.history.push({ date: day.date, return_pct: num(quotes.get(stock.code)?.changePct) ?? null, amount: num(quotes.get(stock.code)?.amount), top20pct: rankedCodes.indexOf(stock.code) < topCount, theme_median_return: themeMedian, theme_up_ratio: themeUpRatio, theme_limit_count: themeLimitCount, previous_theme_limit_count: 0 });
  }
  for (const stock of stocks) {
    stock.history.forEach((row, index) => { row.previous_theme_limit_count = index ? stock.history[index - 1].theme_limit_count : 0; });
    const firstActiveContextIndex = stock.history.findIndex((row) => row.return_pct >= config.candidate.active_return_pct || isLimit(stock.code, row.return_pct));
    stock._first_active_context_index = firstActiveContextIndex;
    stock._first_active_context_date = firstActiveContextIndex < 0 ? null : stock.history[firstActiveContextIndex].date;
    stock.history = stock.history.slice(-historyDays);
  }
  const validStocks = stocks.filter((stock) => stock.history.every((row) => Number.isFinite(row.return_pct)));
  if (validStocks.length < config.candidate.minimum_members) return NextResponse.json({ leader_analysis: { status: "insufficient_data", candidates: [], missing_data: ["complete_member_return_history"] } });
  const theme = { stocks: validStocks, divergenceRelativeValues: [] };
  for (const stock of validStocks) for (const row of stock.history) if (row.theme_median_return < 0) theme.divergenceRelativeValues.push(row.return_pct - row.theme_median_return);
  // Membership remains manually maintained, so relevance is a score
  // multiplier rather than a hard membership gate. A weak relationship can
  // stay visible for review, but it cannot keep an unadjusted leader score.
  const candidatePool = buildCandidatePool(validStocks, config);
  const leaderCandidatePool = candidatePool.pool;
  const previousStocks = validStocks.map((stock) => {
    const previous = { ...stock, history: stock.history.slice(0, -1) };
    // Previous-rank comparison must not treat an activation on T as evidence
    // that was already available on T-1.
    if (previous._first_active_context_index >= days.length - 1) {
      previous._first_active_context_index = -1;
      previous._first_active_context_date = null;
    }
    return previous;
  }).filter((stock) => stock.history.length >= 3);
  const previousTheme = { stocks: previousStocks, divergenceRelativeValues: [] };
  for (const stock of previousStocks) for (const row of stock.history) if (row.theme_median_return < 0) previousTheme.divergenceRelativeValues.push(row.return_pct - row.theme_median_return);
  const previousCandidates = buildCandidatePool(previousStocks, config).pool.map((stock) => leaderScore(stock, previousTheme, config)).sort((a, b) => b.score - a.score);
  const previousRanks = new Map(previousCandidates.map((stock, index) => [stock.code, index + 1]));
  const candidates = leaderCandidatePool.map((stock) => leaderScore(stock, theme, config)).sort((a, b) => b.score - a.score).map((stock, index) => {
    const { _leader_memory: memory = {}, ...candidate } = stock;
    return {
      ...candidate,
      score: Math.round(candidate.score),
      leader_status: candidate.status,
      leader_rank: index + 1,
      previous_leader_rank: previousRanks.get(candidate.code) ?? null,
      leader_rank_change: previousRanks.has(candidate.code) ? previousRanks.get(candidate.code) - (index + 1) : null,
      score_details: { ...candidate.score_details, repair: memory.repair_score ?? 0 },
      evidence: { ...candidate.evidence, ...memory },
    };
  });
  const rejected = [
    ...candidates.filter((stock) => stock.status === "independent_high_stock").map((stock) => ({ code: stock.code, name: stock.name, reason: "个股高度存在但没有题材跟随证据，已排除题材龙头身份。" })),
    ...candidatePool.rejected.map((stock) => ({ code: stock.code, name: stock.name, reason: `近三日累计 ${stock._collapse_evidence.recent3ReturnPct}%、连续跌停 ${stock._collapse_evidence.trailingLimitDownDays} 日，已退出当日龙头候选池。` })),
  ];
  const confirmed = candidates.filter((stock) => stock.status === "confirmed_leader");
  const provisional = candidates.filter((stock) => stock.status === "provisional_leader");
  const highConfidence = candidates.filter((stock) => stock.status === "high_confidence_candidate");
  const challengers = candidates.filter((stock) => ["leader_candidate", "high_confidence_candidate"].includes(stock.status));
  const previousLeader = previousCandidates[0] || null;
  const currentLeader = candidates[0] || null;
  const replacementEligible = Boolean(currentLeader && previousLeader && currentLeader.code !== previousLeader.code && currentLeader.score >= previousLeader.score + 8 && (currentLeader.evidence?.leading_streak_days ?? 0) >= 2 && !currentLeader.evidence?.late_follower);
  const replacement = {
    previous_leader: previousLeader ? { code: previousLeader.code, name: previousLeader.name, score: Math.round(previousLeader.score) } : null,
    challenger: currentLeader ? { code: currentLeader.code, name: currentLeader.name, score: currentLeader.score } : null,
    eligible: replacementEligible,
    reason: replacementEligible ? "two_day_superiority_and_evidence_met" : "one_day_move_or_insufficient_leadership_evidence",
  };
  const payload = { leader_analysis: { status: confirmed.length ? "confirmed" : provisional.length ? "provisional" : highConfidence.length ? "candidate" : "no_qualified_candidate", confirmed_leader: confirmed[0] || null, provisional_leader: provisional[0] || null, high_confidence_candidates: highConfidence, challengers, leader_candidate_pool: leaderCandidatePool.map((stock) => ({ code: stock.code, name: stock.name, candidate_evidence_raw: stock._candidate_evidence_raw, relevance_score: stock.relevance_score, candidate_evidence: stock._candidate_evidence })), replacement, emotion_leader: candidates.filter((stock) => stock.role_attributes.includes("emotion_leader")), trend_leader: candidates.filter((stock) => stock.role_attributes.includes("trend_leader")), high_elasticity_leader: candidates.filter((stock) => stock.role_attributes.includes("high_elasticity_leader")), branch_leaders: [], capacity_core: [], candidates, rejected_candidates: rejected, missing_data: validStocks.length === stocks.length ? [] : ["partial_member_return_history_excluded"], methodology: { ...config, candidate_pool: "broad_pool_then_multi_day_rolling_pk", replacement_rule: "challenger needs two consecutive rolling advantages, at least 8 points of adjusted-score lead, and no late-follower label", relevance_score_rule: "candidate evidence and final leader score are multiplied by the strongest matching primary/secondary relevance_score; thresholds and ranks use adjusted scores" } } };
  await mkdir(path.dirname(cachePath(date, primary, secondary)), { recursive: true });
  await writeFile(cachePath(date, primary, secondary), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return NextResponse.json({ ...payload, source: "computed" });
}
