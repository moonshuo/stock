import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "output");
const STOCK_MAP_PATH = path.join(process.cwd(), "data", "stock_sector_map.json");
const TAXONOMY_PATH = path.join(process.cwd(), "data", "sector_taxonomy.json");
const DATASET_KEYS = ["market_overview", "mainline_rankings", "sector_details", "limit_up_stocks", "selected_stocks"];

function cleanDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期必须为 YYYY-MM-DD");
  return date;
}

function cleanCodes(values) {
  return [...new Set((values || []).flatMap((value) => String(value).split(/[\s,，;；]+/))
    .map((value) => value.replace(/\D/g, "")).filter((value) => /^\d{6}$/.test(value)))].slice(0, 20);
}

function searchAliases(value) {
  const normalized = String(value || "").toLowerCase().replace(/[\s·•_—–\-/]+/g, "").trim();
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  for (const suffix of ["产业链", "板块", "材料", "产业", "方向", "概念"]) {
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 2) {
      aliases.add(normalized.slice(0, -suffix.length));
    }
  }
  return [...aliases];
}

export function resolveQuestionSectorKeys(themes = [], questionText = "", selectedSectors = [], taxonomyAliases = new Map()) {
  const resolved = [...new Set((selectedSectors || []).map((value) => String(value).trim()).filter(Boolean))];
  const normalizedQuestion = String(questionText || "").toLowerCase().replace(/[\s·•_—–\-/]+/g, "");
  if (!normalizedQuestion) return resolved.slice(0, 5);
  for (const theme of themes) {
    if (resolved.length >= 5) break;
    const key = theme.key || `${theme.primary}__${theme.name}`;
    if (resolved.includes(key) || resolved.includes(theme.name)) continue;
    const candidates = [
      theme.name,
      ...(taxonomyAliases.get(key) || []),
      ...(theme.core_driven_tertiaries || []).map((item) => item?.name),
    ].flatMap(searchAliases).filter((alias) => alias.length >= 2);
    if (candidates.some((alias) => normalizedQuestion.includes(alias))) resolved.push(key);
  }
  return resolved.slice(0, 5);
}

export function buildAgentQuestionText(question = "", history = []) {
  const recentUserQuestions = (history || []).filter((message) => message?.role === "user")
    .slice(-4).map((message) => String(message.content || "").slice(0, 1000));
  return [...recentUserQuestions, String(question || "").slice(0, 1000)].join("\n");
}

async function loadTaxonomyAliases() {
  const payload = JSON.parse(await readFile(TAXONOMY_PATH, "utf8"));
  const aliases = new Map();
  for (const primary of payload.sectors || []) {
    for (const secondary of primary.secondary_sectors || []) {
      aliases.set(`${primary.name}__${secondary.name}`, [secondary.name, ...(secondary.tertiary_sectors || [])]);
    }
  }
  return aliases;
}

export function normalizeAgentSelection(input = {}) {
  const datasets = [...new Set((input.datasets || []).filter((key) => DATASET_KEYS.includes(key)))];
  return {
    date: cleanDate(input.date),
    datasets: datasets.length ? datasets : ["market_overview", "mainline_rankings"],
    sectors: [...new Set((input.sectors || []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 5),
    stock_codes: cleanCodes(input.stock_codes),
  };
}

async function readMainline(date) {
  const filePath = path.join(OUTPUT_DIR, `mainline_${date}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function stockRef(stock = {}) {
  return {
    code: String(stock.code || ""),
    name: String(stock.name || ""),
    change_pct: Number.isFinite(Number(stock.changePct ?? stock.change_pct)) ? Number(stock.changePct ?? stock.change_pct) : null,
    price: Number.isFinite(Number(stock.price)) ? Number(stock.price) : null,
    amount: Number.isFinite(Number(stock.amount)) ? Number(stock.amount) : null,
    is_limit_up: Boolean(stock.isLimitUp ?? stock.is_limit_up),
  };
}

export function compactThemeForAgent(theme = {}) {
  const history = theme.score_history_summary;
  return {
    key: theme.key,
    primary: theme.primary,
    name: theme.name,
    mainline_rank: theme.mainline_rank ?? theme.rank ?? null,
    mainline_rank_score: theme.mainline_rank_score ?? null,
    daily_strength_rank: theme.daily_strength_rank ?? null,
    daily_strength_score: theme.daily_strength_score ?? null,
    recent_strength_score: theme.recent_strength_score ?? null,
    capital_persistence_score: theme.capital_persistence_score ?? null,
    resilience_repair_score: theme.resilience_repair_score ?? null,
    continuity_score: theme.continuity_score ?? null,
    status: theme.mainline_status || theme.status || null,
    breadth: theme.breadth ? {
      member_count: theme.breadth.member_count,
      valid_member_count: theme.breadth.valid_member_count,
      up_count: theme.breadth.up_count,
      up_ratio: theme.breadth.up_ratio,
      limit_up_count: theme.breadth.limit_up_count,
      high_gain_count: theme.breadth.high_gain_count,
      large_loss_count: theme.breadth.large_loss_count,
      theme_amount_change_ratio: theme.breadth.theme_amount_change_ratio,
    } : null,
    positive_signals: (theme.positive_signals || []).slice(0, 12),
    negative_signals: (theme.negative_signals || []).slice(0, 12),
    missing_data: (theme.missing_data || []).slice(0, 12),
    conclusion_reason: theme.conclusion_reason || null,
    divergence_analysis: theme.divergence_analysis || null,
    core_stocks: theme.core_stocks || null,
    capacity_core_candidates: (theme.capacity_core_candidates || []).slice(0, 10),
    core_driven_tertiaries: (theme.core_driven_tertiaries || []).slice(0, 12).map((item) => ({
      name: item.name,
      core_stock_count: item.core_stock_count,
      limit_up_count: item.limit_up_count,
      high_gain_count: item.high_gain_count,
      recent_return_total_pct: item.recent_return_total_pct,
      stocks: (item.stocks || []).slice(0, 12).map((stock) => ({
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        change_pct: Number.isFinite(Number(stock.change_pct)) ? Number(stock.change_pct) : null,
        recent_return_pct: Number.isFinite(Number(stock.recent_return_pct)) ? Number(stock.recent_return_pct) : null,
      })),
    })),
    score_history_summary: history ? {
      points: history.points,
      first_date: history.first_date,
      last_date: history.last_date,
      latest: history.latest ? {
        date: history.latest.date,
        daily_strength_score: history.latest.daily_strength_score,
        score: history.latest.score,
      } : null,
    } : null,
  };
}

async function availableDates() {
  try {
    const files = await readdir(OUTPUT_DIR);
    return files.map((name) => name.match(/^mainline_(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter(Boolean).sort().reverse().slice(0, 60);
  } catch {
    return [];
  }
}

export async function getAgentCatalog(dateValue) {
  const dates = await availableDates();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || "")) ? String(dateValue) : dates[0] || "";
  const mainline = date ? await readMainline(date) : null;
  const sectors = (mainline?.themes || []).map((theme) => ({
    key: theme.key || `${theme.primary}__${theme.name}`,
    primary: theme.primary,
    name: theme.name,
    rank: theme.mainline_rank ?? theme.rank ?? null,
    score: theme.mainline_rank_score ?? null,
  })).sort((left, right) => (left.rank ?? 9999) - (right.rank ?? 9999));
  return { dates, selected_date: date, sectors, has_mainline_snapshot: Boolean(mainline) };
}

async function loadStockMap() {
  const payload = JSON.parse(await readFile(STOCK_MAP_PATH, "utf8"));
  return new Map((payload.stocks || []).map((stock) => [String(stock.code), stock]));
}

function marketOverview(market) {
  const changes = (market.stocks || []).map((stock) => Number(stock.changePct)).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(changes.length / 2);
  const median = changes.length ? (changes.length % 2 ? changes[middle] : (changes[middle - 1] + changes[middle]) / 2) : null;
  return {
    date: market.date,
    requested_date: market.requestedDate,
    source: market.source,
    snapshot: market.snapshot,
    total_stocks: market.totalStocks,
    excluded_count: market.excludedCount,
    limit_up_count: market.limitUpCount,
    up_count: changes.filter((value) => value > 0).length,
    down_count: changes.filter((value) => value < 0).length,
    median_return_pct: Number.isFinite(median) ? +median.toFixed(2) : null,
    generated_at: market.generatedAt,
  };
}

function loopbackOrigin(value) {
  const url = new URL(value || "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Agent 数据读取只允许调用本机量化服务");
  return url.origin;
}

export async function collectAgentContext(rawSelection, options = {}) {
  const selection = normalizeAgentSelection(rawSelection);
  const warnings = [];
  const context = { as_of_date: selection.date, datasets: {}, evidence_policy: "仅包含目标日及此前由本系统生成的数据" };
  const needsMarket = selection.datasets.some((key) => ["market_overview", "limit_up_stocks", "selected_stocks"].includes(key));
  const needsMainline = selection.datasets.some((key) => ["mainline_rankings", "sector_details"].includes(key));
  let market = null;
  let mainline = null;

  if (needsMarket) {
    const origin = loopbackOrigin(options.origin);
    const response = await fetch(`${origin}/api/daily-market?date=${encodeURIComponent(selection.date)}&localOnly=1`, { cache: "no-store" });
    market = await response.json().catch(() => ({}));
    if (!response.ok || market?.error) throw new Error(market?.error || `本地行情读取失败：HTTP ${response.status}`);
  }
  if (needsMainline) {
    mainline = await readMainline(selection.date);
    if (!mainline) warnings.push(`未找到 ${selection.date} 的已生成主线快照，未临时重算算法结果`);
  }
  if (selection.datasets.includes("market_overview") && market) context.datasets.market_overview = marketOverview(market);
  if (selection.datasets.includes("limit_up_stocks") && market) {
    context.datasets.limit_up_stocks = (market.limitUpStocks || []).slice(0, 80).map(stockRef);
  }
  if (selection.datasets.includes("mainline_rankings") && mainline) {
    context.datasets.mainline_rankings = {
      data_scope: mainline.data_scope,
      eligible: mainline.mainline_eligible,
      history_start_date: mainline.history_start_date,
      history_end_date: mainline.history_end_date,
      history_trading_days: mainline.history_trading_days,
      ranking_definition: mainline.ranking_definition,
      warnings: mainline.warnings || [],
      top_themes: (mainline.themes || []).map(compactThemeForAgent)
        .sort((a, b) => (a.mainline_rank ?? 9999) - (b.mainline_rank ?? 9999)).slice(0, 15),
    };
  }
  if (selection.datasets.includes("sector_details") && mainline) {
    const resolvedSectors = resolveQuestionSectorKeys(
      mainline.themes || [],
      options.questionText || "",
      selection.sectors,
      await loadTaxonomyAliases(),
    );
    const requested = new Set(resolvedSectors);
    context.datasets.sector_details = (mainline.themes || [])
      .filter((theme) => requested.has(theme.key) || requested.has(`${theme.primary}__${theme.name}`) || requested.has(theme.name))
      .slice(0, 5).map(compactThemeForAgent);
    const inferredSectors = resolvedSectors.filter((key) => !selection.sectors.includes(key));
    context.sector_resolution = {
      explicitly_selected: selection.sectors,
      inferred_from_question: inferredSectors,
    };
    if (resolvedSectors.length && !context.datasets.sector_details.length) warnings.push("所选或问题中识别出的板块未出现在该日主线快照中");
    if (!resolvedSectors.length) warnings.push("已选择板块明细，但未手工选择板块，问题中也没有识别出本地板块名称");
  }
  if (selection.datasets.includes("selected_stocks")) {
    const stockMap = await loadStockMap();
    const marketByCode = new Map((market?.stocks || []).map((stock) => [String(stock.code), stock]));
    context.datasets.selected_stocks = selection.stock_codes.map((code) => {
      const classification = stockMap.get(code);
      return {
        ...stockRef(marketByCode.get(code) || { code, name: classification?.name }),
        primary_sector: classification?.primary_sector || null,
        classifications: (classification?.classifications || []).slice(0, 8).map((item) => ({
          primary_sector: item.primary_sector,
          secondary_sector: item.secondary_sector,
          tertiary_sectors: item.tertiary_sectors,
          relevance_score: item.relevance_score,
        })),
        product_tags: (classification?.product_tags || []).slice(0, 12),
        classification_reason: classification?.reason || null,
      };
    });
    if (!selection.stock_codes.length) warnings.push("已选择个股数据，但尚未填写股票代码");
  }
  context.warnings = warnings;
  const serialized = JSON.stringify(context);
  if (serialized.length > 220_000) throw new Error("所选数据超过第一版上下文上限，请减少板块或股票数量");
  return { selection, context, character_count: serialized.length, warnings };
}
