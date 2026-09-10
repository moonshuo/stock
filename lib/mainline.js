import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { classificationPrimarySector, isStStockName, normalizeCode } from "../app/lib/sectorSystem.js";
import { buildCycleMetrics, cycleScores } from "./mainline/cycle-metrics.js";
import { detectCycleStage } from "./mainline/cycle-stage-detector.js";

const ROOT = process.cwd();
const CYCLE_CHECKPOINT_PATH = path.join(ROOT, "output", "cycle_state_checkpoints.json");
const CYCLE_CHECKPOINT_VERSION = 12;
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const median = (values) => { const xs = values.filter(Number.isFinite).sort((a, b) => a - b); if (!xs.length) return null; const i = Math.floor(xs.length / 2); return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isLimit = (code, pct) => (String(code).startsWith("300") || String(code).startsWith("301") || String(code).startsWith("688") ? pct >= 19.5 : String(code).startsWith("8") || String(code).startsWith("4") ? pct >= 29 : pct >= 9.8);
const weekdaysTo = (date, count) => { const cursor = new Date(`${date}T12:00:00Z`), result = []; while (result.length < count) { if (![0, 6].includes(cursor.getUTCDay())) result.unshift(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() - 1); } return result; };

async function loadActualTradingDays(date, count, loadDailyMarket) {
  const cursor = new Date(`${date}T12:00:00Z`), days = [], skipped = [];
  for (let attempts = 0; days.length < count && attempts < 50; attempts += 1) {
    const candidate = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay())) {
      const payload = await loadDailyMarket(candidate);
      if (payload?.error) {
        if (payload.status === 404 && payload.source === "non-trading-day") skipped.push({ date: candidate, reason: payload.error });
        else throw new Error("Market data is not verified; refusing to skip this trading date");
      } else days.unshift(payload);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { days, skipped };
}

async function loadTradingDaysInRange(startDate, endDate, loadDailyMarket) {
  const cursor = new Date(`${startDate}T12:00:00Z`), end = new Date(`${endDate}T12:00:00Z`);
  const days = [], skipped = [];
  while (cursor <= end) {
    if (![0, 6].includes(cursor.getUTCDay())) {
      const candidate = cursor.toISOString().slice(0, 10);
      const payload = await loadDailyMarket(candidate);
      if (payload?.error) {
        if (payload.status === 404 && payload.source === "non-trading-day") skipped.push({ date: candidate, reason: payload.error });
        else throw new Error("Market data is not verified; refusing to skip this trading date");
      } else days.push(payload);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { days, skipped };
}

export async function loadMainlineHistory(date, loadDailyMarket, { history_start_date = "", window_days = 10 } = {}) {
  return history_start_date
    ? loadTradingDaysInRange(history_start_date, date, loadDailyMarket)
    : loadActualTradingDays(date, window_days, loadDailyMarket);
}

async function loadPreviousTradingDay(date, loadDailyMarket) {
  const cursor = new Date(`${date}T12:00:00Z`);
  for (let attempts = 0; attempts < 15; attempts += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if ([0, 6].includes(cursor.getUTCDay())) continue;
    const candidate = cursor.toISOString().slice(0, 10);
    const payload = await loadDailyMarket(candidate);
    if (!payload?.error) return payload;
  }
  return null;
}

async function loadConfig() { return JSON.parse(await readFile(path.join(ROOT, "data", "mainline_config.json"), "utf8")); }
async function loadCycleConfig() {
  const [cycle, emergence] = await Promise.all([
    readFile(path.join(ROOT, "data", "cycle_config.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data", "emergence_config.json"), "utf8").then(JSON.parse),
  ]);
  return { ...cycle, emergence };
}
async function loadMembers() {
  const payload = JSON.parse(await readFile(path.join(ROOT, "data", "stock_sector_map.json"), "utf8"));
  const secondaryThemes = new Map();
  const tertiaryThemes = new Map();
  for (const stock of payload.stocks || []) {
    if (isStStockName(stock.name)) continue;
    const code = normalizeCode(stock.code);
    const primaryAffiliations = [...new Set((stock.classifications || [])
      .map((item) => classificationPrimarySector(stock, item))
      .filter(Boolean))];
    for (const item of stock.classifications || []) {
      const primary = classificationPrimarySector(stock, item); const secondary = String(item.secondary_sector || "").trim();
      if (!primary || !secondary || !/^\d{6}$/.test(code)) continue;
      const tertiarySectors = [...new Set((stock.classifications || [])
        .filter((classification) => classificationPrimarySector(stock, classification) === primary && classification.secondary_sector === secondary)
        .flatMap((classification) => classification.tertiary_sectors || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean))];
      const key = `${primary}__${secondary}`;
      if (!secondaryThemes.has(key)) secondaryThemes.set(key, { key, level: "secondary", primary, secondary, name: secondary, members: new Map() });
      secondaryThemes.get(key).members.set(code, { code, name: stock.name || code, primary_affiliations: primaryAffiliations, tertiary_sectors: tertiarySectors });
      for (const tertiary of tertiarySectors) {
        const tertiaryKey = `${primary}__${secondary}__${tertiary}`;
        if (!tertiaryThemes.has(tertiaryKey)) tertiaryThemes.set(tertiaryKey, { key: tertiaryKey, level: "tertiary", primary, secondary, name: tertiary, members: new Map() });
        tertiaryThemes.get(tertiaryKey).members.set(code, { code, name: stock.name || code, primary_affiliations: primaryAffiliations, tertiary_sectors: [tertiary] });
      }
    }
  }
  const finalize = (themes) => [...themes.values()].map((item) => ({ ...item, members: [...item.members.values()] }));
  return { secondaryThemes: finalize(secondaryThemes), tertiaryThemes: finalize(tertiaryThemes) };
}

function independentPrimaryEvidence(themes, latestQuotes) {
  const byPrimary = new Map();
  for (const theme of themes) {
    if (!byPrimary.has(theme.primary)) byPrimary.set(theme.primary, new Map());
    const bucket = byPrimary.get(theme.primary);
    for (const member of theme.members || []) bucket.set(member.code, member);
  }
  const evidence = new Map();
  for (const [primary, membersByCode] of byPrimary.entries()) {
    const members = [...membersByCode.values()];
    evidence.set(primary, { primary, members, membersByCode });
  }
  return evidence;
}

// Long-term classifications remain many-to-many.  For a specific market day,
// however, a stock with multiple primary affiliations may contribute its
// movement to only one primary direction.  The choice is made from the other
// members' independent breadth, never from the cross-affiliated stock itself.
function applyDailyPrimaryAttribution(themes, daily, config) {
  const latestQuotes = new Map((daily.at(-1)?.stocks || []).map((stock) => [stock.code, stock]));
  const primaryEvidence = independentPrimaryEvidence(themes, latestQuotes);
  const supportFor = (primary, excludedCode) => {
    const source = primaryEvidence.get(primary)?.members || [];
    const rows = source
      .filter((member) => member.code !== excludedCode)
      .map((member) => ({ member, quote: latestQuotes.get(member.code) }))
      .filter((item) => Number.isFinite(n(item.quote?.changePct)));
    const returns = rows.map((item) => n(item.quote.changePct));
    const valid = rows.length;
    const up = returns.filter((value) => value > 0).length;
    const high = returns.filter((value) => value >= config.high_gain_pct).length;
    const limits = rows.filter((item) => isLimit(item.member.code, n(item.quote.changePct))).length;
    const medianReturn = median(returns) ?? -100;
    const qualified = valid >= config.minimum_theme_members && (up >= 2 || high >= 1 || limits >= 1);
    const score = !qualified ? 0 : Math.round(clamp(
      22 * Math.min(1, valid / 10)
      + 28 * up / Math.max(1, valid)
      + 24 * high / Math.max(1, valid * 0.25)
      + 16 * limits / Math.max(1, valid * 0.12)
      + 10 * clamp((medianReturn + 2) / 7, 0, 1),
      0, 100));
    return { primary, qualified, score, valid_member_count: valid, up_count: up, high_gain_count: high, limit_up_count: limits, median_return: +medianReturn.toFixed(2) };
  };

  const assignments = new Map();
  const allMembers = new Map();
  for (const theme of themes) for (const member of theme.members || []) allMembers.set(member.code, member);
  for (const member of allMembers.values()) {
    const primaries = [...new Set(member.primary_affiliations || [])];
    if (primaries.length < 2) continue;
    const supports = primaries.map((primary) => supportFor(primary, member.code)).sort((left, right) => right.score - left.score || right.valid_member_count - left.valid_member_count);
    const winner = supports[0], runnerUp = supports[1];
    // A small score lead is ambiguous.  Do not let a cross-affiliated stock
    // manufacture breadth for either primary until one has clear independent
    // confirmation from its other constituents.
    const dominant = winner?.qualified && (!runnerUp?.qualified || winner.score - runnerUp.score >= 8);
    assignments.set(member.code, { assigned_primary: dominant ? winner.primary : null, supports, status: dominant ? "assigned" : "ambiguous_or_insufficient_independent_support" });
  }

  return themes.map((theme) => {
    const excluded = [];
    const assigned = [];
    const members = (theme.members || []).filter((member) => {
      const attribution = assignments.get(member.code);
      if (!attribution) return true;
      if (attribution.assigned_primary === theme.primary) {
        assigned.push(member.code);
        return true;
      }
      excluded.push({
        code: member.code,
        assigned_primary: attribution.assigned_primary,
        status: attribution.status,
        primary_supports: attribution.supports,
      });
      return false;
    });
    return {
      ...theme,
      original_members: theme.members,
      members,
      dynamic_attribution: {
        method: "cross_primary_independent_support",
        original_member_count: (theme.members || []).length,
        attributed_member_count: members.length,
        assigned_cross_primary_codes: assigned,
        excluded_cross_primary_members: excluded,
        primary_independent_support: supportFor(theme.primary, null),
      },
    };
  });
}

async function applyCachedCoreEvidence(date, themes, daily, freshCoreEvidence = {}) {
  await Promise.all(themes.map(async (theme) => {
    if (!theme?.key || !theme.score_details) return;
    const fileKey = `${theme.primary}__${theme.name}.json`;
    const key = `${date}|${theme.primary}|${theme.name}`;
    const capacity = freshCoreEvidence.capacity?.[key] || null;
    const leader = freshCoreEvidence.leader?.[key] || null;
    const capacityRows = capacity?.candidates || [];
    const leaderRows = leader?.candidates || [];
    const qualifiedCapacity = capacityRows.some((stock) => ["confirmed_capacity_core", "capacity_core_candidate"].includes(stock.verdict));
    const confirmedLeader = leaderRows.some((stock) => stock.status === "confirmed_leader");
    const candidateLeader = leaderRows.some((stock) => stock.status === "leader_candidate");
    const heightBonus = Math.min(2, theme.hierarchy?.height_stocks?.length || 0);
    const trendEvidence = capacityTrendEvidence(capacityRows.slice(0, 5), daily);
    theme.capacity_trend_evidence = trendEvidence;
    const trendBonus = trendEvidence.qualified_count ? 3 : 0;
    theme.score_details.core_structure = (confirmedLeader ? 8 : candidateLeader ? 6 : 0) + (qualifiedCapacity ? 7 : 0) + heightBonus + trendBonus;
    theme.core_stocks = {
      emotion_leader: leaderRows.filter((stock) => stock.primary_role === "emotion_leader").slice(0, 1).map((stock) => ({ code: stock.code, name: stock.name })),
      trend_leader: leaderRows.filter((stock) => stock.primary_role === "trend_leader").slice(0, 1).map((stock) => ({ code: stock.code, name: stock.name })),
      capacity_core: capacityRows.filter((stock) => ["confirmed_capacity_core", "capacity_core_candidate"].includes(stock.verdict)).slice(0, 2).map((stock) => ({ code: stock.code, name: stock.name })),
      high_elasticity_stocks: theme.core_stocks?.high_elasticity_stocks || [],
    };
    theme.capacity_core_candidates = capacityRows
      .filter((stock) => ["confirmed_capacity_core", "capacity_core_candidate"].includes(stock.verdict))
      .slice(0, 5)
      .map((stock) => ({ code: stock.code, name: stock.name, role_status: stock.verdict }));
    theme.core_structure_evidence = { leader_status: confirmedLeader ? "confirmed_leader" : candidateLeader ? "leader_candidate" : "no_qualified_leader", capacity_core_available: qualifiedCapacity, capacity_trend_bonus: trendBonus, cache_ready: Boolean(capacity && leader) };
    if (!capacity || !leader) theme.missing_data = [...new Set([...(theme.missing_data || []), "automatic_leader_or_capacity_pending"])];
  }));
}

function capacityTrendEvidence(candidates, daily) {
  const qualified = [];
  for (const candidate of candidates || []) {
    const closes = daily.map((day) => n((day.stocks || []).find((stock) => stock.code === candidate.code)?.price));
    if (closes.length < 10 || closes.some((close) => !Number.isFinite(close) || close <= 0)) continue;
    const ma10 = closes.reduce((sum, close) => sum + close, 0) / closes.length;
    const ma5 = closes.slice(-5).reduce((sum, close) => sum + close, 0) / 5;
    const return10 = closes.at(-1) / closes[0] - 1;
    const upDays = closes.slice(1).filter((close, index) => close >= closes[index]).length;
    const maxDrawdown = Math.min(...closes.map((close, index) => {
      const peak = Math.max(...closes.slice(0, index + 1)); return close / peak - 1;
    }));
    const qualifies = closes.at(-1) >= ma10 && ma5 >= ma10 && return10 > 0 && upDays >= 5 && maxDrawdown >= -0.10;
    if (qualifies) qualified.push({ code: candidate.code, ma10: +ma10.toFixed(2), ma5: +ma5.toFixed(2), return_10d_pct: +(return10 * 100).toFixed(2), up_days: upDays, max_drawdown_pct: +(maxDrawdown * 100).toFixed(2) });
  }
  return { qualified_count: qualified.length, qualified_stocks: qualified, rule: "容量中军候选前五名：收盘价位于10日均线之上、5日均线不低于10日均线、10日收益为正、至少5个上涨日且最大回撤不超过10%" };
}

async function readCycleCheckpoints() {
  try {
    const value = JSON.parse(await readFile(CYCLE_CHECKPOINT_PATH, "utf8"));
    return value?.version === CYCLE_CHECKPOINT_VERSION && value?.scopes ? value : { version: CYCLE_CHECKPOINT_VERSION, scopes: {} };
  } catch { return { version: CYCLE_CHECKPOINT_VERSION, scopes: {} }; }
}

async function applyCycleStages(themes, daily, { replay = false, replay_start_date = null } = {}) {
  const config = await loadCycleConfig();
  // A replay start date defines the state-machine baseline.  Keep a separate
  // checkpoint stream for each baseline so extending 2/3 to 2/4 can reuse the
  // exact 2/3 state, without contaminating a replay that starts on another day.
  const checkpointDocument = await readCycleCheckpoints();
  const checkpointScope = replay_start_date || "__rolling__";
  const checkpoints = checkpointDocument.scopes[checkpointScope] || { themes: {} };
  const eligible = themes.filter((theme) => theme?.key && Array.isArray(theme.members) && theme.members.length);
  const metricsByTheme = buildCycleMetrics(eligible, daily, config);
  for (const theme of eligible) {
    const metrics = metricsByTheme.get(theme.key) || [];
    const firstDate = metrics[0]?.date || "";
    const replayStartDate = replay_start_date;
    const saved = (checkpoints.themes[theme.key] || []).filter((entry) => entry.date < firstDate).sort((a, b) => a.date.localeCompare(b.date));
    const savedByDate = new Map((checkpoints.themes[theme.key] || []).map((entry) => [entry.date, entry]));
    let previousState = saved.at(-1)?.state || { cycle_stage: "unstarted", stage_confidence: 0.35, episode_sequence: 0 };
    const history = [];
    for (let index = 0; index < metrics.length; index += 1) {
      if (replayStartDate && metrics[index].date < replayStartDate) continue;
      const savedEntry = savedByDate.get(metrics[index].date);
      if (savedEntry?.state) {
        previousState = savedEntry.state;
        history.push(savedEntry.state);
        continue;
      }
      const partial = metrics.slice(0, index + 1);
      const scores = cycleScores(partial, config);
      const detected = detectCycleStage(partial, scores, config, previousState);
      previousState = detected;
      history.push({ date: metrics[index].date, ...detected, scores, metrics: metrics[index], daily_strength_score: +recentDailyStrength(metrics[index]).toFixed(1) });
    }
    const merged = new Map((checkpoints.themes[theme.key] || []).map((entry) => [entry.date, entry]));
    // 历史检查点一经确认即不可覆盖；同一历史日期不允许因“截至日”不同
    // 而得到另一条周期轨迹。只有尚未存在的日期才追加。
    history.forEach((entry) => { if (!merged.has(entry.date)) merged.set(entry.date, { date: entry.date, state: entry }); });
    checkpoints.themes[theme.key] = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-260);
    const current = history.at(-1);
    if (!current) continue;
    theme.cycle_stage = {
      name: theme.name,
      cycle_stage: current.cycle_stage,
      confirmation_status: current.confirmation_status,
      confirmed_stage: current.confirmed_stage,
      pending_stage: current.pending_stage,
      stage_confidence: current.stage_confidence,
      daily_condition: current.daily_condition,
      episode_id: current.episode_id,
      episode_active: current.episode_active,
      episode_start_date: current.episode_start_date,
      episode_peak_date: current.episode_peak_date,
      episode_end_date: current.episode_end_date,
      first_emergence_date: current.first_emergence_date,
      episode_status: current.episode_status,
      previous_stage: history.at(-2)?.cycle_stage || null,
      transition: current.transition || null,
      transition_status: current.transition_status || "valid",
      expansion_status: current.expansion_status,
      profit_effect_status: current.profit_effect_status,
      profit_effect: current.metrics?.profit_effect || null,
      core_status: current.core_status,
      emergence_result: current.emergence_result,
      scores: current.scores,
      // 保留逐日状态，让界面能展示题材从启动、发酵到当前阶段的完整轨迹，
      // 而不是只呈现最后一天的结论。
      timeline: [...saved.map((entry) => entry.state), ...history].slice(-260).map((entry) => ({
        date: entry.date,
        stage: entry.cycle_stage,
        confirmed_stage: entry.confirmed_stage,
        pending_stage: entry.pending_stage,
        confirmation_status: entry.confirmation_status,
        confidence: entry.stage_confidence,
        daily_strength_score: entry.daily_strength_score ?? null,
        daily_condition: entry.daily_condition,
        episode_id: entry.episode_id,
        episode_active: entry.episode_active,
        episode_start_date: entry.episode_start_date,
        episode_peak_date: entry.episode_peak_date,
        episode_end_date: entry.episode_end_date,
        first_emergence_date: entry.first_emergence_date,
        episode_status: entry.episode_status,
        transition: entry.transition,
        previous_stage: entry.previous_stage,
        divergence_event_id: entry.divergence_event_id,
        repair_of_event_id: entry.repair_of_event_id,
        repair_outcome: entry.repair_outcome,
        evidence_coverage: entry.evidence_coverage,
        expansion_status: entry.expansion_status,
        profit_effect_status: entry.profit_effect_status,
        weakening_continuity: entry.weakening_continuity || null,
        profit_effect: entry.metrics?.profit_effect || null,
        emergence_result: entry.emergence_result,
        scores: entry.scores,
        metrics: {
          limit_up_count: entry.metrics?.limit_up_count,
          new_first_limit_count: entry.metrics?.new_first_limit_count,
          active_member_count: entry.metrics?.active_member_count,
          strong_member_count: entry.metrics?.strong_member_count,
          same_logic_ratio: entry.metrics?.same_logic_ratio,
          up_ratio: entry.metrics?.up_ratio,
          theme_median_return: entry.metrics?.relative_strength_score,
          active_count_ratio: entry.metrics?.active_count_ratio,
          strong_count_ratio: entry.metrics?.strong_count_ratio,
          up_ratio_change: entry.metrics?.up_ratio_change,
          median_return_change: entry.metrics?.median_return_change,
          theme_relative_return: entry.metrics?.theme_relative_return,
          high_gain_count: entry.metrics?.high_gain_count,
          capacity_core_status: entry.metrics?.capacity_core_status,
          capacity_core_return: entry.metrics?.capacity_core_return,
          capacity_core_count: entry.metrics?.capacity_core_count,
          capacity_core_up_ratio: entry.metrics?.capacity_core_up_ratio,
          primary_capacity_cores: entry.metrics?.primary_capacity_cores || [],
          capacity_core_pool_size: entry.metrics?.capacity_core_pool_size,
          capacity_core_positive_count: entry.metrics?.capacity_core_positive_count,
          capacity_core_positive_count_ratio: entry.metrics?.capacity_core_positive_count_ratio,
          capacity_core_positive_weight: entry.metrics?.capacity_core_positive_weight,
          capacity_core_neutral_weight: entry.metrics?.capacity_core_neutral_weight,
          capacity_core_weak_weight: entry.metrics?.capacity_core_weak_weight,
          capacity_core_weighted_score: entry.metrics?.capacity_core_weighted_score,
          capacity_core_severe_weight: entry.metrics?.capacity_core_severe_weight,
          capacity_core_pool_weighted_return: entry.metrics?.capacity_core_pool_weighted_return,
          core_pool_status: entry.metrics?.core_pool_status,
          capacity_core_rotation: entry.metrics?.capacity_core_rotation,
          leader_status: entry.metrics?.leader_status,
          leader_return: entry.metrics?.leader_return,
          leader_drives_theme: entry.metrics?.leader_drives_theme,
          leader_structure_broken: entry.metrics?.leader_structure_broken,
          previous_leaders: entry.metrics?.previous_leaders || [],
          previous_capacity_cores: entry.metrics?.previous_capacity_cores || [],
          capacity_core_broken: entry.metrics?.capacity_core_broken,
          capacity_core_long_upper_count: entry.metrics?.capacity_core_long_upper_count,
          up_count: entry.metrics?.up_count,
          large_loss_count: entry.metrics?.large_loss_count,
          next_day_median_return: entry.metrics?.next_day_median_return,
          next_day_positive_ratio: entry.metrics?.next_day_positive_ratio,
          frontline_member_count: entry.metrics?.frontline_member_count,
          negative_feedback_ratio: entry.metrics?.negative_feedback_ratio,
          profit_effect: entry.metrics?.profit_effect || null,
        },
        positive_evidence: entry.positive_evidence || [],
        negative_evidence: entry.negative_evidence || [],
        missing_evidence: entry.missing_evidence || [],
      })),
      evidence: {
        limit_up_count_3d: metrics.slice(-3).map((item) => item.limit_up_count),
        new_first_limit_count_3d: metrics.slice(-3).map((item) => item.new_first_limit_count),
        active_member_count_3d: metrics.slice(-3).map((item) => item.active_member_count),
        promotion_rate_3d: metrics.slice(-3).map((item) => item.promotion_rate),
        theme_amount_3d: metrics.slice(-3).map((item) => item.theme_amount),
        next_day_median_return_3d: metrics.slice(-3).map((item) => item.next_day_median_return),
        negative_feedback_ratio_3d: metrics.slice(-3).map((item) => item.negative_feedback_ratio),
        relative_strength_rank_3d: metrics.slice(-3).map((item) => item.relative_strength_rank),
      },
      positive_signals: current.positive_evidence || [],
      warning_signals: current.negative_evidence || [],
      missing_data: ["new_branch_count", "failed_limit_count"],
      reason: `阶段依据最近连续交易日的涨停/大涨扩散、新增首板、活跃成员、成交额、相对强度及历史可得的次日反馈判断；当前扩张状态为${current.expansion_status}，赚钱效应为${current.profit_effect_status}。下一交易日若新增首板、活跃成员和成交额同步改善可上调阶段；若它们持续下降且负反馈上升则下调。`,
      recent_history: history.slice(-10),
    };
  }
  checkpointDocument.scopes[checkpointScope] = checkpoints;
  await mkdir(path.dirname(CYCLE_CHECKPOINT_PATH), { recursive: true });
  // Do not expose a partially written checkpoint to a concurrent request.
  // The old, complete state remains readable until the replacement is ready.
  const temporaryPath = `${CYCLE_CHECKPOINT_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(checkpointDocument, null, 2)}\n`, "utf8");
  await rename(temporaryPath, CYCLE_CHECKPOINT_PATH);
}

function row(theme, daily, config) {
  const byDay = daily.map((day) => new Map((day.stocks || []).map((stock) => [stock.code, stock])));
  const history = byDay.map((quotes, index) => theme.members.map((member) => ({ ...member, quote: quotes.get(member.code) })).filter((x) => Number.isFinite(n(x.quote?.changePct))));
  const recentHistory = history.slice(-5); const current = history.at(-1); const valid = current.length;
  if (valid < config.minimum_theme_members) return { name: theme.name, primary: theme.primary, secondary: theme.secondary, level: theme.level, key: theme.key, members: theme.members, dynamic_attribution: theme.dynamic_attribution, status: "insufficient_data", score: null, rank: null, missing_data: ["valid_theme_members"], breadth: { member_count: theme.members.length, original_member_count: theme.dynamic_attribution?.original_member_count ?? theme.members.length, valid_member_count: valid, breadth_status: "insufficient_members" } };
  const returns = current.map((x) => n(x.quote.changePct)); const amounts = current.map((x) => n(x.quote.amount) || 0);
  const limits = current.filter((x) => isLimit(x.code, n(x.quote.changePct))).length;
  const high = returns.filter((x) => x >= config.high_gain_pct).length, up = returns.filter((x) => x > 0).length, down = returns.filter((x) => x < 0).length, loss = returns.filter((x) => x <= config.large_loss_pct).length;
  const themeAmount = amounts.reduce((a, b) => a + b, 0), previousAmount = history.at(-2).reduce((a, x) => a + (n(x.quote.amount) || 0), 0);
  const breadthScore = Math.round(clamp(7 * limits / Math.max(1, valid / 8) + 5 * high / Math.max(1, valid * .35) + 5 * up / valid - 4 * loss / valid + 3 * Math.min(1, themeAmount / 2e9), 0, 20));
  const ranked = [...current].sort((a,b) => n(b.quote.changePct) - n(a.quote.changePct));
  const height = ranked.filter((x) => isLimit(x.code, n(x.quote.changePct)) || n(x.quote.changePct) >= config.high_gain_pct);
  const coreDrivers = height.length ? height : ranked.slice(0, Math.min(3, ranked.length));
  const tertiaryDrivers = new Map();
  for (const stock of coreDrivers) {
    const recentRows = recentHistory.map((day) => day.find((item) => item.code === stock.code)?.quote).filter(Boolean);
    const recentReturn = (recentRows.reduce((value, quote) => value * (1 + (n(quote.changePct) || 0) / 100), 1) - 1) * 100;
    for (const tertiary of stock.tertiary_sectors || []) {
      const driver = tertiaryDrivers.get(tertiary) || { name: tertiary, core_stock_count: 0, limit_up_count: 0, high_gain_count: 0, recent_return_total_pct: 0, stocks: [] };
      driver.core_stock_count += 1;
      if (isLimit(stock.code, n(stock.quote.changePct))) driver.limit_up_count += 1;
      if (n(stock.quote.changePct) >= config.high_gain_pct) driver.high_gain_count += 1;
      driver.recent_return_total_pct += recentReturn;
      driver.stocks.push({ code: stock.code, name: stock.name, change_pct: n(stock.quote.changePct), recent_return_pct: +recentReturn.toFixed(2) });
      tertiaryDrivers.set(tertiary, driver);
    }
  }
  const coreDrivenTertiaries = [...tertiaryDrivers.values()]
    .map((item) => ({ ...item, recent_return_total_pct: +item.recent_return_total_pct.toFixed(2) }))
    .sort((left, right) => right.limit_up_count - left.limit_up_count || right.high_gain_count - left.high_gain_count || right.recent_return_total_pct - left.recent_return_total_pct || right.core_stock_count - left.core_stock_count)
    .slice(0, 3);
  const newFirst = current.filter((x) => isLimit(x.code, n(x.quote.changePct)) && !history.slice(0, -1).some((d) => isLimit(x.code, n(d.find((v) => v.code === x.code)?.quote?.changePct)))).length;
  const leaders = height.slice(0, 2).map((x) => ({ code: x.code, name: x.name }));
  const hierarchyScore = Math.round(clamp((leaders.length ? 5 : 0) + (height.length >= 2 ? 4 : 0) + (newFirst ? 3 : 0) + (valid >= 5 ? 3 : 0), 0, 15));
  const activeDays = recentHistory.filter((d) => { const rs = d.map((x) => n(x.quote.changePct)); return rs.filter((x) => x > 0).length / Math.max(1, rs.length) >= config.active_up_ratio || rs.filter((x) => x >= config.high_gain_pct).length >= 2; }).length;
  const consecutive = [...recentHistory].reverse().findIndex((d) => { const rs = d.map((x) => n(x.quote.changePct)); return rs.filter((x) => x > 0).length / Math.max(1, rs.length) < config.active_up_ratio; });
  const continuityScore = Math.round(clamp(9 * activeDays / recentHistory.length + 4 * Math.max(0, consecutive) / recentHistory.length + 2 * (history.at(-1).length >= history.at(-2).length ? 1 : 0), 0, 15));
  const dailyMedian = recentHistory.map((d) => median(d.map((x) => n(x.quote.changePct))));
  const divergenceDays = dailyMedian.slice(0, -1).filter((x) => x < 0).length;
  const recovered = divergenceDays && dailyMedian.at(-1) > 0;
  const divergenceScore = divergenceDays ? Math.round(clamp((recovered ? 9 : 2) + 6 * Math.min(1, high / Math.max(1, valid * .25)), 0, 15)) : null;
  const coreScore = Math.round(clamp((leaders.length ? 8 : 0) + (height.length >= 2 ? 5 : 0) + (themeAmount >= 1e9 ? 4 : 0) + (activeDays >= 2 ? 3 : 0), 0, 20));
  return {
    name: theme.name, primary: theme.primary, secondary: theme.secondary, level: theme.level, key: theme.key, members: theme.members, dynamic_attribution: theme.dynamic_attribution, status: "pending_rank", score: null, rank: null,
    score_details: { core_structure: coreScore, breadth: breadthScore, hierarchy: hierarchyScore, continuity: continuityScore, profit_effect: null, divergence_repair: divergenceScore, relative_strength: null },
    core_stocks: { emotion_leader: leaders.slice(0,1), trend_leader: [], capacity_core: [], high_elasticity_stocks: height.filter((x) => /^(300|301|688)/.test(x.code)).map((x) => ({ code:x.code,name:x.name })) }, core_driven_tertiaries: coreDrivenTertiaries,
    breadth: { member_count: theme.members.length, original_member_count: theme.dynamic_attribution?.original_member_count ?? theme.members.length, valid_member_count: valid, limit_up_count: limits, high_gain_count: high, up_count: up, down_count: down, failed_limit_count: null, large_loss_count: loss, up_ratio: +(up/valid).toFixed(3), limit_up_ratio:+(limits/valid).toFixed(3), high_gain_ratio:+(high/valid).toFixed(3), failed_limit_ratio:null, large_loss_ratio:+(loss/valid).toFixed(3), theme_total_amount:themeAmount, theme_amount_change_ratio: previousAmount ? +(themeAmount/previousAmount-1).toFixed(3) : null, top50_amount_member_count:null },
    hierarchy: { emotion_leader: leaders.slice(0,1), height_stocks: height.map((x)=>({code:x.code,name:x.name})), new_first_limit_stocks: newFirst ? height.slice(-1).map((x)=>({code:x.code,name:x.name})) : [], frontline_stocks: ranked.slice(0,Math.min(3, ranked.length)).map((x)=>({code:x.code,name:x.name})), primary_role_rule:"每只股票只归入一个主角色" },
    continuity: { active_days: activeDays, consecutive_active_days: consecutive < 0 ? recentHistory.length : consecutive, active_member_count_by_day: recentHistory.map((d)=>d.length), state: activeDays <= 1 ? "single_day_burst" : activeDays >= 3 ? "continuous_expansion" : "stable_activity" },
    profit_effect: { status:"unavailable_without_future_data", score:null, reason:"当日识别严格不使用次日行情；次日反馈仅可用于独立复盘。" },
    divergence_analysis: { divergence_status: divergenceDays ? (recovered ? "divergence_repair" : "not_repaired") : "not_tested", score: divergenceScore, daily_median_returns: dailyMedian },
    relative_strength: {}, positive_signals: [limits >= 2 && "多股涨停", up / valid >= .6 && "上涨覆盖广", activeDays >= 2 && "多日活跃", recovered && "分歧后修复"].filter(Boolean), negative_signals: [valid < 5 && "成员较少", loss / valid >= .25 && "大跌成员偏多", activeDays <= 1 && "单日爆发"].filter(Boolean), missing_data:["next_day_profit_effect", "cached_leader_or_capacity_core"], conclusion_reason:"仅使用目标日及此前日线行情；未使用未来行情。"
  };
}

function clampScore(value) { return Math.max(0, Math.min(100, value)); }
function averageScore(values, fallback = 0) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : fallback;
}
function recentDailyStrength(metric = {}) {
  const relative = Number(metric.theme_relative_return);
  const upRatio = Number(metric.up_ratio);
  const valid = Math.max(1, Number(metric._valid_member_count || metric.member_count) || 1);
  const limitUps = Number(metric.limit_up_count) || 0;
  const highGains = Number(metric.high_gain_count) || 0;
  const largeLosses = Number(metric.large_loss_count) || 0;
  return clampScore(50
    + (Number.isFinite(relative) ? relative * 7 : 0)
    + (Number.isFinite(upRatio) ? (upRatio - .5) * 35 : 0)
    + Math.min(12, limitUps * 4 + highGains * 1.5)
    - Math.min(15, largeLosses / valid * 30));
}

// Scoring still needs a forward-only time series of market measurements, but
// it must not turn that series into lifecycle states such as “启动/发酵”.
// Keep the existing metric inputs and score weights; only remove the state
// transition, episode and eligibility layer.
async function attachScoreHistory(themes, daily) {
  const metricsConfig = await loadCycleConfig();
  const metricsByTheme = buildCycleMetrics(themes.filter((theme) => theme?.key && theme.members?.length), daily, metricsConfig);
  for (const theme of themes) {
    theme.score_history = (metricsByTheme.get(theme.key) || []).map((metrics) => ({ date: metrics.date, metrics }));
    theme.score_history.forEach((entry, index) => {
      const score = scoreMainline({ score_history: theme.score_history.slice(0, index + 1) });
      entry.score = score;
      entry.daily_strength_score = +recentDailyStrength(entry.metrics).toFixed(1);
    });
  }
}

function scoreMainline(theme) {
  const history = (theme.score_history || []).filter((entry) => entry?.metrics).slice(-10);
  const activeHistory = history;
  const recent = activeHistory.slice(-5);
  const weights = [0.35, 0.25, 0.18, 0.12, 0.10].slice(0, recent.length).reverse();
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const recentStrengthScore = recent.reduce((sum, entry, index) => sum + recentDailyStrength(entry.metrics) * weights[index], 0) / weightTotal;
  const capitalParts = recent.map((entry) => {
    const m = entry.metrics || {};
    const amountRetention = clampScore(50 + (Number(m.theme_amount_change_ratio ?? m.theme_amount_change) || 0) * 45);
    const marketShare = Number(m.theme_amount) > 0 && Number(m.market_amount) > 0
      ? clampScore(25 + Math.min(75, Number(m.theme_amount) / Number(m.market_amount) * 700)) : 50;
    const coreResponse = clampScore(45
      + (Number(m.capacity_core_positive_weight) || 0) * 35
      + (Number(m.capacity_core_return) || 0) * 4
      - (Number(m.capacity_core_severe_weight) || 0) * 35);
    const volumeQuality = (Number(m.theme_amount_change_ratio ?? m.theme_amount_change) || 0) >= 0 && (Number(m.relative_strength_score) || 0) > 0 ? 85
      : (Number(m.theme_amount_change_ratio ?? m.theme_amount_change) || 0) > 0 ? 35 : 55;
    return amountRetention * .35 + marketShare * .20 + coreResponse * .30 + volumeQuality * .15;
  });
  const capitalPersistenceScore = averageScore(capitalParts, 50);
  const resilienceParts = recent.map((entry, index) => {
    const m = entry.metrics || {};
    const divergenceDay = Number(m.market_median_return) < 0;
    const relativeResistance = divergenceDay ? clampScore(50 + (Number(m.theme_relative_return) || 0) * 10) : 55;
    const medianReturn = clampScore(50 + (Number(m.relative_strength_score) || 0) * 8);
    const coreResistance = clampScore(50 + (Number(m.capacity_core_return) || 0) * 8 - (Number(m.capacity_core_severe_weight) || 0) * 35);
    const feedback = clampScore(80 - (Number(m.negative_feedback_ratio) || 0) * 100);
    const recovered = index > 0 && (Number(m.active_member_count_change) || 0) > 0 && (Number(m.up_ratio_change) || 0) >= 0 && (Number(m.theme_relative_return) || 0) > 0 ? 85 : 50;
    return relativeResistance * .28 + medianReturn * .22 + coreResistance * .22 + feedback * .18 + recovered * .10;
  });
  const resilienceRepairScore = averageScore(resilienceParts, 50);
  const activeDays = activeHistory.length;
  const activeQuality = averageScore(recent.map((entry) => {
    const m = entry.metrics || {};
    const valid = Math.max(1, Number(m._valid_member_count || m.member_count) || 1);
    return clampScore((Number(m.active_member_count) || 0) / valid * 100);
  }), 0);
  const continuityScore = Math.min(100, Math.min(1, activeDays / 10) * 70 + activeQuality * .30);
  const rawMainlineRankScore = clampScore(recentStrengthScore * .50 + capitalPersistenceScore * .20 + resilienceRepairScore * .20 + continuityScore * .10);
  // A one- or two-day burst has not passed a divergence/recovery test.  Keep
  // it below the confirmed-mainline gate even when today's signal is extreme.
  const mainlineRankScore = activeDays <= 2 ? Math.min(rawMainlineRankScore, 64.9) : rawMainlineRankScore;
  return {
    active_days: activeDays,
    recent_strength_score: +recentStrengthScore.toFixed(1),
    capital_persistence_score: +capitalPersistenceScore.toFixed(1),
    resilience_repair_score: +resilienceRepairScore.toFixed(1),
    continuity_score: +continuityScore.toFixed(1),
    mainline_rank_score: +mainlineRankScore.toFixed(1),
  };
}

export async function analyzeMainlines(date, loadDailyMarket, options = {}) {
  const config = await loadConfig();
  const historyStartDate = String(options.history_start_date || "");
  const history = await loadMainlineHistory(date, loadDailyMarket, {
    history_start_date: historyStartDate,
    window_days: config.window_days,
  });
  const daily = history.days, dates = daily.map((day) => day.date);
  const minimumRequiredDays = historyStartDate ? 1 : config.window_days;
  if (daily.length < minimumRequiredDays) return { version:config.version,date,data_scope:"partial_market",mainline_eligible:false,themes:[],warnings:[`仅取得 ${daily.length}/${minimumRequiredDays} 个有效交易日`],requested_history_start_date:historyStartDate || null,history_start_date:daily[0]?.date || null,skipped_non_trading_dates:history.skipped };
  const full = daily.at(-1).totalStocks >= 3000;
  // 细分题材的涨停、广度和周期必须与分类库中的实际成员完全一致。
  // 跨一级板块归因仅适用于一级汇总，不能在这里剔除同时属于其他一级的股票，
  // 否则会出现页面显示两只涨停、周期引擎却只统计一只的口径冲突。
  const { secondaryThemes, tertiaryThemes } = await loadMembers();
  const themes = secondaryThemes.map((theme) => row(theme, daily, config));
  const tertiaryThemeRows = tertiaryThemes.map((theme) => row(theme, daily, config));
  await applyCachedCoreEvidence(date, themes, daily, options.core_evidence || {});
  await attachScoreHistory(themes, daily);
  const valid = themes.filter((x)=>Number.isFinite(x.score_details?.breadth));
  // The final 5 breadth points measure whether strength has spread from one
  // secondary direction to peer secondary directions under the same primary.
  // A primary with only one valid secondary receives no automatic expansion.
  const byPrimary = new Map();
  for (const theme of valid) {
    if (!byPrimary.has(theme.primary)) byPrimary.set(theme.primary, []);
    byPrimary.get(theme.primary).push(theme);
  }
  for (const siblings of byPrimary.values()) {
    const ranked = [...siblings].sort((a, b) => (b.score_details.breadth ?? 0) - (a.score_details.breadth ?? 0));
    ranked.forEach((theme, index) => {
      const expansion = ranked.length < 2 ? 0 : Math.round(5 * (1 - index / (ranked.length - 1)));
      theme.score_details.breadth += expansion;
      theme.breadth.same_primary_secondary_rank = index + 1;
      theme.breadth.same_primary_secondary_count = ranked.length;
      theme.breadth.sibling_expansion_score = expansion;
    });
  }
  for (const key of ["breadth","continuity"]) { const ranked=[...valid].sort((a,b)=>(b.score_details[key]??-1)-(a.score_details[key]??-1)); ranked.forEach((x,i)=>x.relative_strength[`_${key}_rank`]=i+1); }
  const scoreable = valid.map((x)=> { const ranks=Object.values(x.relative_strength).filter(Number.isFinite); const relative=Math.round(10*(1-(Math.min(...ranks)-1)/Math.max(1,valid.length-1))); x.score_details.relative_strength=relative; x.relative_strength={relative_strength_score:relative,relative_strength_rank:Math.min(...ranks),distance_from_rank_1:Math.min(...ranks)-1}; x.score=x.score_details.core_structure+x.score_details.breadth+x.score_details.hierarchy+x.score_details.continuity+relative+(x.score_details.divergence_repair??0); return x; });
  // Daily strength is a snapshot; mainline strength is a separate, short
  // window assessment of persistence, capital and resilience.
  scoreable.forEach((x) => {
    // 日强度只使用目标交易日的横截面数据，不混入启动以来的累计或均值。
    const latestMetrics = x.score_history?.at(-1)?.metrics || {};
    x.daily_strength_score = +recentDailyStrength(latestMetrics).toFixed(1);
    Object.assign(x, scoreMainline(x));
  });
  [...scoreable].sort((a, b) => (b.daily_strength_score ?? -Infinity) - (a.daily_strength_score ?? -Infinity))
    .forEach((theme, index) => { theme.daily_strength_rank = index + 1; });
  scoreable.forEach((theme) => {
    theme.mainline_status = full ? "scored" : "insufficient_data";
    theme.status = theme.mainline_status;
  });
  scoreable.sort((left, right) => (right.mainline_rank_score ?? -Infinity) - (left.mainline_rank_score ?? -Infinity)
    || left.name.localeCompare(right.name, "zh-CN"));
  scoreable.forEach((theme, index) => { theme.mainline_rank = index + 1; theme.rank = index + 1; });
  // Keep the response schema stable for directions that cannot yet be scored
  // (for example, because their membership set is still incomplete).
  themes.filter((theme) => !scoreable.includes(theme)).forEach((theme) => {
    Object.assign(theme, {
      daily_strength_rank: null,
      mainline_rank: null,
      daily_strength_score: null,
      mainline_rank_score: null,
      recent_strength_score: null,
      capital_persistence_score: null,
      resilience_repair_score: null,
      continuity_score: null,
      mainline_status: "insufficient_data",
      status: "insufficient_data",
    });
  });
  const requestedTheme = options.requested_theme
    ? themes.find((theme) => theme.primary === options.requested_theme.primary && theme.name === options.requested_theme.secondary) || null
    : null;
  // 三级方向只与同一二级板块内的兄弟方向比较；不参加一级之间的二级 PK。
  await attachScoreHistory(tertiaryThemeRows, daily);
  const tertiaryBySecondary = new Map();
  for (const theme of tertiaryThemeRows.filter((item) => Number.isFinite(item.score_details?.breadth))) {
    const scope = `${theme.primary}__${theme.secondary}`;
    if (!tertiaryBySecondary.has(scope)) tertiaryBySecondary.set(scope, []);
    tertiaryBySecondary.get(scope).push(theme);
  }
  const rankedTertiaryThemes = [];
  for (const siblings of tertiaryBySecondary.values()) {
    const byBreadth = [...siblings].sort((left, right) => (right.score_details.breadth ?? 0) - (left.score_details.breadth ?? 0));
    byBreadth.forEach((theme, index) => {
      const expansion = byBreadth.length < 2 ? 0 : Math.round(5 * (1 - index / (byBreadth.length - 1)));
      theme.score_details.breadth += expansion;
      theme.breadth.same_primary_secondary_tertiary_rank = index + 1;
      theme.breadth.same_primary_secondary_tertiary_count = byBreadth.length;
      theme.breadth.sibling_expansion_score = expansion;
    });
    for (const key of ["breadth", "continuity"]) {
      [...siblings].sort((left, right) => (right.score_details[key] ?? -1) - (left.score_details[key] ?? -1))
        .forEach((theme, index) => { theme.relative_strength[`_${key}_rank`] = index + 1; });
    }
    const scoreableTertiaries = siblings.map((theme) => {
      const ranks = Object.values(theme.relative_strength).filter(Number.isFinite);
      const relative = Math.round(10 * (1 - (Math.min(...ranks) - 1) / Math.max(1, siblings.length - 1)));
      theme.score_details.relative_strength = relative;
      theme.relative_strength = { relative_strength_score: relative, relative_strength_rank: Math.min(...ranks), distance_from_rank_1: Math.min(...ranks) - 1 };
      theme.score = theme.score_details.core_structure + theme.score_details.breadth + theme.score_details.hierarchy + theme.score_details.continuity + relative + (theme.score_details.divergence_repair ?? 0);
      const latestMetrics = theme.score_history?.at(-1)?.metrics || {};
      theme.daily_strength_score = +recentDailyStrength(latestMetrics).toFixed(1);
      Object.assign(theme, scoreMainline(theme));
      theme.mainline_status = full ? "scored" : "insufficient_data";
      theme.status = theme.mainline_status;
      return theme;
    }).sort((left, right) => (right.mainline_rank_score ?? -Infinity) - (left.mainline_rank_score ?? -Infinity) || left.name.localeCompare(right.name, "zh-CN"));
    scoreableTertiaries.forEach((theme, index) => { theme.mainline_rank = index + 1; theme.rank = index + 1; });
    rankedTertiaryThemes.push(...scoreableTertiaries);
  }
  return { version:config.version,date,data_scope:full?"full_market":"partial_market",mainline_eligible:full,market_summary:{valid_stock_count:daily.at(-1).totalStocks,history_dates:dates,uses_future_data:false},daily_core_module_eligibility:{minimum_valid_members:config.minimum_theme_members,active_signal_rule:"至少两只上涨，或至少一只大涨/涨停"},themes:scoreable,all_themes:themes,tertiary_themes:rankedTertiaryThemes,requested_theme:requestedTheme,mainline:{ranked:scoreable},ranking_definition:{daily_strength_rank:"仅按目标交易日的板块横截面表现排序",mainline_rank:"最近5日加权强度50%、资金持续认可度20%、抗分歧与修复能力20%、持续活跃能力10%；三级方向仅在同一一级/二级范围内按该分数互相排名"},requested_history_start_date:historyStartDate || null,history_start_date:daily[0]?.date || null,history_end_date:daily.at(-1)?.date || null,history_trading_days:daily.length,warnings:[...(history.skipped.length ? [`已跳过 ${history.skipped.length} 个无行情日期`] : []),"评分仅使用目标日及此前行情；不再计算或使用生命周期状态。"],skipped_non_trading_dates:history.skipped };
}
