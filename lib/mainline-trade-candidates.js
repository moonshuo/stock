const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const median = (values) => {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const index = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[index] : (rows[index - 1] + rows[index]) / 2;
};

export function isMainBoard(stock = {}) {
  const explicit = `${stock.exchange || ""} ${stock.market || ""} ${stock.board || ""}`.toLowerCase();
  if (/(gem|chinext|创业|star|科创|beijing|北交|bj)/.test(explicit)) return false;
  if (/(main|主板|shanghai|shenzhen|沪市|深市)/.test(explicit)) return true;
  return /^(600|601|603|605|000|001|002|003)/.test(String(stock.code || ""));
}

export function isLimitUp(code, changePct) {
  const value = number(changePct);
  if (value == null) return false;
  const normalized = String(code || "");
  return /^(300|301|688)/.test(normalized) ? value >= 19.5 : /^(4|8|920)/.test(normalized) ? value >= 29 : value >= 9.8;
}

function percentileRank(value, values, descending = true) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => descending ? b - a : a - b);
  if (!sorted.length) return 0;
  const index = sorted.findIndex((item) => descending ? value >= item : value <= item);
  return index < 0 ? 0 : sorted.length === 1 ? 1 : 1 - index / (sorted.length - 1);
}

function cumulativeReturn(rows) {
  return rows.reduce((total, row) => total * (1 + (number(row?.changePct) || 0) / 100), 1) - 1;
}

function qualityLabel(score) { return score >= 80 ? "A" : score >= 65 ? "B" : "C"; }

function mainlineStrength(theme) {
  const score = number(theme?.score) ?? 0;
  const rank = number(theme?.rank);
  const scorePart = clamp((score - 50) / 50 * 12, 0, 12);
  const rankPart = rank === 1 ? 8 : rank != null && rank <= 3 ? 6 : rank != null && rank <= 10 ? 4 : 2;
  const confirmedBonus = theme?.status === "confirmed_mainline" || theme?.confirmed === true ? 1 : 0;
  return Math.round(clamp(scorePart + rankPart + confirmedBonus, 0, 20));
}

// This evaluator deliberately receives confirmed mainlines rather than any
// market-wide theme list. It never scores whether a direction is a mainline.
export function buildMainlineTradeCandidates({ confirmed_mainlines = [], stocks = [], daily_history = [], leader_candidates = [], capacity_candidates = [], mainline_frontline_codes = [] } = {}) {
  const stockByCode = new Map(stocks.map((stock) => [String(stock.code), stock]));
  const mainlinesByCode = new Map();
  for (const theme of confirmed_mainlines) {
    const label = [theme.primary, theme.name || theme.secondary].filter(Boolean).join(" · ");
    for (const member of theme.members || []) {
      const code = String(member.code || member);
      if (!mainlinesByCode.has(code)) mainlinesByCode.set(code, []);
      if (label && !mainlinesByCode.get(code).includes(label)) mainlinesByCode.get(code).push(label);
    }
  }
  const mainlineStrengthByCode = new Map();
  for (const theme of confirmed_mainlines) {
    const strength = mainlineStrength(theme);
    const label = [theme.primary, theme.name || theme.secondary].filter(Boolean).join(" · ");
    for (const member of theme.members || []) {
      const code = String(member.code || member);
      const current = mainlineStrengthByCode.get(code);
      if (!current || strength > current.score) mainlineStrengthByCode.set(code, { score: strength, label, theme_score: number(theme.score), theme_rank: number(theme.rank) });
    }
  }
  const leaderByCode = new Map(leader_candidates.map((item) => [String(item.code), item]));
  const capacityByCode = new Map(capacity_candidates.map((item) => [String(item.code), item]));
  const mainlineFrontlineCodes = new Set(mainline_frontline_codes.map(String));
  const memberCodes = new Set(confirmed_mainlines.flatMap((theme) => (theme.members || []).map((member) => String(member.code || member))));
  const days = daily_history.slice(-20);
  const today = days.at(-1) || { stocks: [] };
  const todayByCode = new Map((today.stocks || []).map((stock) => [String(stock.code), stock]));
  const daysByDate = new Map(days.map((day) => [String(day.date || ""), day]));
  const divergenceContexts = confirmed_mainlines.map((theme) => {
    const episodeId = theme?.cycle_stage?.episode_id;
    const episodeStartDate = theme?.cycle_stage?.episode_start_date;
    const dates = new Set((theme?.cycle_stage?.timeline || [])
      .filter((row) => {
        const stage = row?.confirmed_stage || row?.stage || row?.cycle_stage;
        const inCurrentEpisode = !episodeId || !row?.episode_id || row.episode_id === episodeId;
        return inCurrentEpisode && (!episodeStartDate || String(row?.date || "") >= episodeStartDate)
          && ["normal_divergence", "strong_divergence"].includes(stage);
      })
      .map((row) => String(row.date || ""))
      .filter(Boolean));
    return {
      label: [theme.primary, theme.name || theme.secondary].filter(Boolean).join(" · "),
      members: new Set((theme.members || []).map((member) => String(member.code || member))),
      dates,
    };
  });
  const histories = new Map([...memberCodes].map((code) => [code, []]));
  for (const day of days) {
    const quotes = new Map((day.stocks || []).map((stock) => [String(stock.code), stock]));
    const themeMedian = median([...memberCodes].map((code) => number(quotes.get(code)?.changePct)));
    for (const code of memberCodes) histories.get(code).push({ ...(quotes.get(code) || {}), themeMedian, date: day.date });
  }
  const currentRows = [...memberCodes].map((code) => ({ code, stock: stockByCode.get(code) || {}, quote: todayByCode.get(code) || {}, history: histories.get(code) || [] }));
  const returns = currentRows.map((row) => number(row.quote.changePct));
  const amounts = currentRows.map((row) => number(row.quote.amount));
  const caps = currentRows.map((row) => number(capacityByCode.get(row.code)?.free_float_market_cap || capacityByCode.get(row.code)?.market_cap));
  const candidates = currentRows.map(({ code, stock, quote, history }) => {
    const changes5 = history.slice(-5);
    const return5 = cumulativeReturn(changes5) * 100;
    const themeReturn5 = cumulativeReturn(changes5.map((row) => ({ changePct: row.themeMedian }))) * 100;
    const relative = return5 - themeReturn5;
    const previous5 = history.slice(-6, -1).map((row) => number(row.amount)).filter(Number.isFinite);
    const previousVolumes = history.slice(-6, -1).map((row) => number(row.vol)).filter(Number.isFinite);
    const amountRatio = number(quote.amount) && previous5.length ? number(quote.amount) / (previous5.reduce((a, b) => a + b, 0) / previous5.length) : null;
    const volumeRatio = number(quote.vol) && previousVolumes.length ? number(quote.vol) / (previousVolumes.reduce((a, b) => a + b, 0) / previousVolumes.length) : null;
    // Anti-divergence must use the stock's own theme and its confirmed
    // normal/strong-divergence sessions in the current episode.  A broad
    // cross-theme red day or a pre-episode decline is not valid evidence.
    const divergenceEvidence = divergenceContexts
      .filter((context) => context.members.has(code))
      .flatMap((context) => [...context.dates].map((date) => {
        const day = daysByDate.get(date);
        const quotes = new Map((day?.stocks || []).map((item) => [String(item.code), item]));
        const themeMedian = median([...context.members].map((memberCode) => number(quotes.get(memberCode)?.changePct)));
        const stockChange = number(quotes.get(code)?.changePct);
        if (!Number.isFinite(themeMedian) || !Number.isFinite(stockChange)) return null;
        return { date, mainline: context.label, stock_change_pct: stockChange, theme_median_pct: themeMedian, relative_pct: stockChange - themeMedian };
      }).filter(Boolean));
    const divergenceRelative = divergenceEvidence.map((row) => row.relative_pct);
    const divergence = divergenceRelative.length ? median(divergenceRelative) : null;
    const leader = leaderByCode.get(code);
    const capacity = capacityByCode.get(code);
    const isLimit = isLimitUp(code, quote.changePct);
    const leaderReference = Boolean(leader && ["confirmed_leader", "leader_candidate", "independent_high_stock"].includes(leader.status));
    const amountTop = percentileRank(number(quote.amount), amounts) >= .7;
    const capTop = percentileRank(number(capacity?.free_float_market_cap || capacity?.market_cap), caps) >= .7;
    const sustainedLead = history.slice(-5).filter((row) => (number(row.changePct) ?? -99) > (number(row.themeMedian) ?? 99)).length >= 3;
    const frontlineByMainline = mainlineFrontlineCodes.has(code);
    const frontline = !leaderReference && (frontlineByMainline || (percentileRank(number(quote.changePct), returns) >= .8 && amountTop && sustainedLead));
    const trend = !isLimit && !leaderReference && sustainedLead && relative > 0 && (divergence == null || divergence >= 0);
    const capacityCore = !leaderReference && (capacity?.verdict === "confirmed_capacity_core" || (capTop && amountTop && (amountRatio || 0) >= 1.2));
    const lateWeak = !leaderReference && !capacityCore && !frontline && relative < 0 && Number(quote.changePct) > (median(returns) || 0) && (amountRatio || 0) < 1.15;
    const role = leaderReference ? "leader_reference" : capacityCore ? "capacity_core" : frontline ? "frontline_core" : trend ? "trend_core" : lateWeak ? "weak_follower" : "follower";
    const roleScore = { leader_reference: 30, capacity_core: 28, frontline_core: 25, trend_core: 22, follower: 8, weak_follower: 3 }[role];
    const capitalScore = Math.round(clamp((amountRatio || 0) >= 1.2 ? 14 : (amountRatio || 0) * 10) + clamp(percentileRank(number(quote.amount), amounts) * 8) + clamp((volumeRatio || 0) >= 1.1 ? 3 : 0) - (number(quote.changePct) < 0 && (amountRatio || 0) >= 1.2 ? 5 : 0));
    const relativeScore = Math.round(clamp((relative + 5) * 1.5, 0, 15));
    const divergenceScore = divergence == null ? 7 : Math.round(clamp((divergence + 3) * 2.5, 0, 15));
    const repairScore = Math.round(clamp((sustainedLead ? 7 : 0) + ((amountRatio || 0) >= 1.2 ? 4 : 0) + (number(quote.changePct) > 0 && divergenceEvidence.length ? 4 : 0), 0, 15));
    const score = Math.round(clamp(roleScore + capitalScore + relativeScore + divergenceScore + repairScore));
    const mainlineStrength = mainlineStrengthByCode.get(code) || { score: 0, label: "--", theme_score: null, theme_rank: null };
    const tradePriorityScore = Math.round(clamp(score * .8 + mainlineStrength.score));
    const mainBoard = isMainBoard({ ...stock, ...quote });
    const st = /^(\*?ST|S\*ST|SST|退)/i.test(String(stock.name || quote.name || ""));
    const suspended = quote.suspended === true || quote.isSuspended === true || quote.tradeStatus === "suspended";
    const oneWord = isLimit && number(quote.open) === number(quote.high) && number(quote.high) === number(quote.low);
    const liquid = number(quote.amount) > 0 && number(quote.vol) > 0;
    const tradable = !isLimit && !oneWord && !st && !suspended && liquid && mainBoard && role !== "leader_reference";
    const extended = number(quote.changePct) >= 8 || history.slice(-3).filter((row) => (number(row.changePct) || 0) > 0).length === 3;
    const entry = !tradable || lateWeak ? "avoid" : extended || (divergence != null && divergence < 0 && number(quote.changePct) < 0) ? "wait" : "buy_candidate";
    const reasons = [role === "capacity_core" && "成交额与市值位于主线前列，具备资金承载能力", role === "frontline_core" && (frontlineByMainline ? "主线引擎已确认前排核心；龙头模块数据不足时仍保留该前排证据" : "涨幅、成交额与持续领先均位于主线前排"), role === "trend_core" && "持续跑赢板块，分歧期相对抗跌", amountRatio >= 1.2 && "当日成交额较近5日均值放大", relative > 0 && "近5日相对主线收益为正"].filter(Boolean);
    const risks = [isLimit && "涨停股票仅作龙头方向参考，不参与买入推荐", !mainBoard && "非A股主板，已排除推荐", lateWeak && "后排补涨：此前弱于主线且成交未持续改善", extended && "涨幅或连续加速偏大，等待位置修复", !liquid && "流动性不足"].filter(Boolean);
    return { code, name: stock.name || quote.name || code, market: quote.market || quote.marketCode || stock.market || "", mainlines: mainlinesByCode.get(code) || [], is_main_board: mainBoard, role, role_score: roleScore, stock_quality_score: score, stock_quality: qualityLabel(score), mainline_strength_score: mainlineStrength.score, mainline_strength_mainline: mainlineStrength.label, mainline_strength_theme_score: mainlineStrength.theme_score, mainline_strength_theme_rank: mainlineStrength.theme_rank, trade_priority_score: tradePriorityScore, entry_status: entry, is_limit_up: isLimit, capital_score: capitalScore, relative_strength_score: relativeScore, divergence_score: divergenceScore, repair_score: repairScore, divergence_evidence: divergenceEvidence, reasons, risks, _reference: leaderReference || isLimit || oneWord || !liquid || suspended, _tradable: tradable, _rejected: !tradable || lateWeak, amount_ratio: amountRatio, volume_ratio: volumeRatio };
  });
  const reference_pool = candidates.filter((row) => row._reference);
  const eligible = candidates.filter((row) => row._tradable && !row._rejected);
  const comparePriority = (left, right) => right.trade_priority_score - left.trade_priority_score || right.stock_quality_score - left.stock_quality_score || String(left.code).localeCompare(String(right.code));
  const a_grade = eligible.filter((row) => row.stock_quality_score >= 80 && ["capacity_core", "frontline_core", "trend_core"].includes(row.role)).sort(comparePriority).slice(0, 3);
  const b_grade = eligible.filter((row) => row.stock_quality_score >= 65 && !a_grade.some((item) => item.code === row.code)).sort(comparePriority).slice(0, 5);
  const publicRow = ({ _reference, _tradable, _rejected, ...row }) => row;
  // C 档是可交易池中未进入 A/B 的其余股票。此前直接从全候选池
  // 取 C，会把涨停参考股等不可交易股票重复放进 C，导致任何按等级回测
  // 的样本都不是真实可执行的尾盘买入。
  const c_grade = eligible.filter((row) => !a_grade.some((item) => item.code === row.code) && !b_grade.some((item) => item.code === row.code)).sort(comparePriority);
  return { reference_pool: reference_pool.map(publicRow), tradable_pool: eligible.map(publicRow), mainline_trade_candidates: { A: a_grade.map(publicRow), B: b_grade.map(publicRow), C: c_grade.map(publicRow), rejected: candidates.filter((row) => row._rejected).map(publicRow) }, status: eligible.length ? "ok" : "no_suitable_main_board_stock", analyzed_stock_count: candidates.length };
}
