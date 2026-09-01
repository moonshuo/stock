"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, ChevronRight, ChevronDown, Layers3, Building2, Download,
  Check, X, Trash2, FolderTree, PanelLeftClose, PanelLeftOpen, AlertTriangle,
  ClipboardPaste, Copy, Tag, StickyNote, LockKeyhole, Flame, Eye, GripVertical, BarChart3
} from "lucide-react";
import {
  buildRuntimeIndexes,
  buildTaxonomyLookups,
  classificationPrimarySector,
  indexList,
  isThirdBoardStockCode,
  sanitizeStockMap,
  stockPrimarySectors,
  uniqueByCode
} from "./lib/sectorSystem";
import { isUsableMarketResearchBatch, marketResearchBatchId, pendingMarketResearchBatch, pendingMarketResearchCount, mergeMarketResearchUniverse } from "./lib/marketResearchBatch";
import { stockBoardLabel } from "./lib/stockBoard";
import { countVisibleNoteCharacters } from "./lib/noteMetrics";
import { selectTradeMainlines, TRADE_MAINLINE_LIMIT } from "../lib/trade-mainline-selection";
import { relevanceAdjustedAverageChange } from "../lib/relevance-adjusted-return";

const emptyTaxonomy = { version: "1.0", sectors: [] };
const emptyStockMap = { version: "1.0", stocks: [] };
const emptyCollections = { version: "1.0", collections: [] };
const MARKET_RESEARCH_ACTIVE_BATCH_KEY = "stock-library.market-research-active-batch";
const palette = ["#4778c7", "#e85d3f", "#6f7d3c", "#9867a8", "#c28a2e", "#287f78"];

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeCode(value = "") {
  return String(value).replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function StockName({ code, name }) {
  const boardLabel = stockBoardLabel(code);
  return <>{name || code}{boardLabel && <span className="stock-board-badge">{boardLabel}</span>}</>;
}

function averageChange(stocks, quotes, scope) {
  return relevanceAdjustedAverageChange(stocks, quotes, scope, isExcludedByMarketRule);
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeMarketEnvironment(stocks = [], date = "", indexes) {
  const changes = stocks.map((stock) => Number(stock.changePct)).filter(Number.isFinite);
  if (!changes.length) return null;
  const up = changes.filter((value) => value > 0);
  const down = changes.filter((value) => value < 0);
  const medianChange = median(changes);
  const upMedianChange = median(up);
  const changeByCode = new Map(stocks.map((stock) => [normalizeCode(stock.code), Number(stock.changePct)]));
  const quotesByCode = Object.fromEntries(stocks.map((stock) => [normalizeCode(stock.code), stock]));
  const topSecondaries = Array.from(indexes?.secondarySectorIndex || []).map(([key, members]) => {
    // 排名只接受至少拥有 8 只归类股票的二级方向，避免极小样本主导市场环境提示。
    if (members.size < 8) return null;
    const [primary, secondary] = key.split("|");
    const values = Array.from(members.values())
      .map((stock) => changeByCode.get(normalizeCode(stock.code)))
      .filter(Number.isFinite);
    if (!values.length) return null;
    return {
      primary,
      secondary,
      stockCount: members.size,
      validStockCount: values.length,
      changePct: averageChange(Array.from(members.values()), quotesByCode, { primary, secondary })
    };
  }).filter(Boolean).sort((left, right) => right.changePct - left.changePct || right.stockCount - left.stockCount || left.secondary.localeCompare(right.secondary, "zh-CN")).slice(0, 3);
  const tone = medianChange > 0 && up.length > down.length ? "strong" : medianChange < 0 && down.length > up.length ? "weak" : "neutral";
  return {
    date,
    total: changes.length,
    upCount: up.length,
    downCount: down.length,
    flatCount: changes.length - up.length - down.length,
    medianChange,
    upMedianChange,
    topSecondaries,
    tone
  };
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function marketClass(value) {
  if (!Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function isStStockName(name = "") {
  return /^(\*?ST|S\*ST|SST|閫€)/i.test(String(name || "").trim());
}

function isExcludedByMarketRule(stock, quotes = {}) {
  const quote = quotes?.[stock.code] || {};
  const changePct = Number(quote.changePct ?? stock.changePct);
  const name = quote.name || stock.name || "";
  return isStStockName(name) || (Number.isFinite(changePct) && Math.abs(changePct) >= 21);
}

function filterTradableStocks(stocks, quotes = {}) {
  return stocks.filter((stock) => !isExcludedByMarketRule(stock, quotes));
}

function applyLocalStockNames(stockMap, stockNames = {}) {
  return {
    ...stockMap,
    stocks: (stockMap?.stocks || []).map((stock) => ({
      ...stock,
      name: String(stockNames[stock.code] || stock.name || "")
    }))
  };
}

function previousWeekdays(dateValue, count = 2) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ""));
  if (!matched) return [];
  const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12));
  const result = [];
  while (result.length < count) {
    date.setUTCDate(date.getUTCDate() - 1);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

function isLimitUpChange(code, changePct) {
  const value = Number(changePct);
  if (!Number.isFinite(value)) return false;
  const normalized = String(code || "");
  if (normalized.startsWith("8") || normalized.startsWith("4")) return value >= 29.5;
  if (normalized.startsWith("300") || normalized.startsWith("688")) return value >= 19.5;
  return value >= 9.5;
}

function buildMainlineAnalysis(taxonomy, indexes, quotes, historySnapshots = []) {
  const rows = [];
  for (const primary of taxonomy?.sectors || []) {
    for (const secondary of primary.secondary_sectors || []) {
      for (const tertiary of secondary.tertiary_sectors || []) {
        const stocks = filterTradableStocks(indexList(indexes.tertiarySectorIndex, `${primary.name}|${secondary.name}|${tertiary}`), quotes);
        const changePct = averageChange(stocks, quotes, { primary: primary.name, secondary: secondary.name, tertiary });
        if (!Number.isFinite(changePct)) continue;
        const stockCodes = uniqueByCode(stocks).map((stock) => stock.code).sort();
        rows.push({
          primary: primary.name,
          secondary: secondary.name,
          tertiary,
          stockCount: stocks.length,
          changePct,
          stockCodes,
          stockSetKey: stockCodes.join(",")
        });
      }
    }
  }
  rows.sort((a, b) => b.changePct - a.changePct || b.stockCount - a.stockCount || a.tertiary.localeCompare(b.tertiary, "zh-CN"));
  rows.forEach((row, index) => { row.rank = index + 1; });

  const secondaryRows = [];
  for (const primary of taxonomy?.sectors || []) {
    for (const secondary of primary.secondary_sectors || []) {
      const stocks = filterTradableStocks(indexList(indexes.secondarySectorIndex, `${primary.name}|${secondary.name}`), quotes);
      const changePct = averageChange(stocks, quotes, { primary: primary.name, secondary: secondary.name });
      if (!Number.isFinite(changePct)) continue;
      secondaryRows.push({ primary: primary.name, secondary: secondary.name, stockCount: stocks.length, changePct });
    }
  }
  secondaryRows.sort((a, b) => b.changePct - a.changePct || b.stockCount - a.stockCount || a.secondary.localeCompare(b.secondary, "zh-CN"));
  secondaryRows.forEach((row, index) => { row.rank = index + 1; });

  // 同一批股票可能被模型归到不同三级目录。仅当股票集合完全相同，
  // 才合并为一个候选，并优先保留二级扩散更充分的目录。
  const withMainlineSignals = rows
    .filter((row) => row.stockCount >= 3)
    .map((row) => {
      const siblingTertiaries = rows.filter((item) => item.primary === row.primary && item.secondary === row.secondary && item.tertiary !== row.tertiary && item.rank <= 30);
      const siblingSecondaries = secondaryRows.filter((item) => item.primary === row.primary && item.secondary !== row.secondary && item.rank <= 15);
      return { ...row, siblingTertiaries, siblingSecondaries };
    });
  const deduplicatedByStockSet = new Map();
  for (const row of withMainlineSignals) {
    const existing = deduplicatedByStockSet.get(row.stockSetKey);
    if (!existing) {
      deduplicatedByStockSet.set(row.stockSetKey, { ...row, duplicatePaths: [] });
      continue;
    }
    const currentScore = [row.siblingSecondaries.length, row.siblingTertiaries.length, row.changePct, -row.rank];
    const existingScore = [existing.siblingSecondaries.length, existing.siblingTertiaries.length, existing.changePct, -existing.rank];
    const firstDifference = currentScore.findIndex((value, index) => value !== existingScore[index]);
    const shouldReplace = firstDifference >= 0 && currentScore[firstDifference] > existingScore[firstDifference];
    const existingPath = `${existing.primary} / ${existing.secondary} / ${existing.tertiary}`;
    const currentPath = `${row.primary} / ${row.secondary} / ${row.tertiary}`;
    if (shouldReplace) {
      deduplicatedByStockSet.set(row.stockSetKey, { ...row, duplicatePaths: [...existing.duplicatePaths, existingPath] });
    } else {
      existing.duplicatePaths.push(currentPath);
    }
  }

  // 主线由一级板块承载；同一一级下多个二级、三级方向同时走强时，
  // 合并为同一条主线，仅以涨幅最高的三级作为主触发。
  const seenMainlineGroups = new Set();
  const candidates = [...deduplicatedByStockSet.values()]
    .sort((a, b) => a.rank - b.rank)
    .filter((row) => {
      const key = row.primary;
      if (seenMainlineGroups.has(key)) return false;
      seenMainlineGroups.add(key);
      return true;
    })
    .slice(0, 3)
    .map((row) => {
    const { siblingTertiaries, siblingSecondaries } = row;
    const isSmallMainline = siblingTertiaries.length > 0;
    const isBigMainline = isSmallMainline && siblingSecondaries.length > 0;
    const duplicateHint = row.duplicatePaths.length ? `已合并 ${row.duplicatePaths.length} 个股票集合完全相同的三级目录。` : "";
    const primaryConfig = (taxonomy?.sectors || []).find((primary) => primary.name === row.primary);
    const history = historySnapshots.map((snapshot) => ({
      date: snapshot.date,
      quotes: snapshot.quotes,
      secondaries: (primaryConfig?.secondary_sectors || []).map((secondary) => {
        const secondaryStocks = filterTradableStocks(indexList(indexes.secondarySectorIndex, `${row.primary}|${secondary.name}`), snapshot.quotes);
        return {
          name: secondary.name,
          changePct: averageChange(secondaryStocks, snapshot.quotes, { primary: row.primary, secondary: secondary.name }),
          stockCount: secondaryStocks.filter((stock) => Number.isFinite(snapshot.quotes?.[stock.code]?.changePct)).length,
          tertiaries: (secondary.tertiary_sectors || []).map((tertiary) => {
            const tertiaryStocks = filterTradableStocks(indexList(indexes.tertiarySectorIndex, `${row.primary}|${secondary.name}|${tertiary}`), snapshot.quotes);
            return {
              name: tertiary,
              changePct: averageChange(tertiaryStocks, snapshot.quotes, { primary: row.primary, secondary: secondary.name, tertiary }),
              stockCount: tertiaryStocks.filter((stock) => Number.isFinite(snapshot.quotes?.[stock.code]?.changePct)).length
            };
          }).filter((tertiary) => tertiary.stockCount > 0)
        };
      }).filter((secondary) => secondary.stockCount > 0)
    }));
    return {
      ...row,
      siblingTertiaries,
      siblingSecondaries,
      history,
      status: isBigMainline ? "大主线" : isSmallMainline ? "小主线" : "未确认",
      description: isBigMainline
        ? `同二级有 ${siblingTertiaries.length} 个三级方向进入前30，且同一级有 ${siblingSecondaries.length} 个其他二级方向进入前15。${duplicateHint}`
        : isSmallMainline
          ? `同二级有 ${siblingTertiaries.length} 个其他三级方向进入全市场前30。${duplicateHint}`
          : `暂未发现同二级的其他三级方向进入全市场前30。${duplicateHint}`
    };
  });
  return { candidates, tertiaryCount: rows.length, secondaryCount: secondaryRows.length };
}

function normalizeCollections(value) {
  return {
    version: value?.version || "1.0",
    collections: (value?.collections || []).map((item) => ({
      name: String(item.name || "").trim(),
      description: String(item.description || ""),
      primary_sectors: Array.from(new Set((item.primary_sectors || item.primarySectors || []).map((name) => String(name || "").trim()).filter(Boolean)))
    })).filter((item) => item.name)
  };
}

function parseTags(value) {
  return Array.from(new Set(String(value || "").split(/[,锛屻€乗s]+/).map((item) => item.trim()).filter(Boolean)));
}

function parseJsonLoose(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const repaired = clean
    .replace(/^\uFEFF/, "")
    .replace(/(^|[\r\n]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":');
  try {
    return JSON.parse(repaired);
  } catch (error) {
    const start = repaired.indexOf("{");
    const end = repaired.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(repaired.slice(start, end + 1));
    throw new Error("娌℃湁璇嗗埆鍒版湁鏁?JSON");
  }
}

function stockHasTertiary(stock, primaryName, secondaryName, tertiaryName) {
  return (stock.classifications || []).some((item) =>
    classificationPrimarySector(stock, item) === primaryName && item.secondary_sector === secondaryName && (item.tertiary_sectors || []).includes(tertiaryName)
  );
}

function tertiaryDetail(value) {
  if (value && typeof value === "object") {
    return { name: String(value.name || value.tertiary_sector || "").trim(), description: String(value.description || value.meaning || "").trim() };
  }
  return { name: String(value || "").trim(), description: "" };
}

function stockHasPrimary(stock, primaryName) {
  return stockPrimarySectors(stock).includes(primaryName);
}

function removeStockPrimary(stock, primaryName) {
  const classifications = (stock.classifications || [])
    .filter((item) => classificationPrimarySector(stock, item) !== primaryName)
    .map((item) => ({
      ...item,
      // 删除一级后不再依赖股票上的旧默认一级，避免遗留无效引用。
      primary_sector: classificationPrimarySector(stock, item)
    }));
  if (!classifications.length) return null;
  const nextPrimary = classifications[0].primary_sector;
  return { ...stock, primary_sector: nextPrimary, classifications };
}
function refreshDailyScanClassification(scan, stockMap) {
  if (!scan?.stocks) return scan;
  const stockIndex = new Map((stockMap?.stocks || []).map((stock) => [normalizeCode(stock.code), stock]));
  const refreshOne = (item) => {
    const existing = stockIndex.get(normalizeCode(item.code));
    return {
      ...item,
      name: existing?.name || item.name || "",
      classified: Boolean(existing),
      primary_sector: existing?.primary_sector || item.primary_sector || ""
    };
  };
  const stocks = scan.stocks.map(refreshOne).filter((stock) => !isExcludedByMarketRule(stock));
  const limitUpStocks = stocks.filter((stock) => stock.isLimitUp);
  const unknownLimitUpStocks = limitUpStocks.filter((stock) => !stock.classified);
  return {
    ...scan,
    stocks,
    limitUpStocks,
    unknownLimitUpStocks,
    unknownLimitUpCount: unknownLimitUpStocks.length
  };
}

function isRelevancePendingReview(classification) {
  return (classification?.source_refs || []).includes("historical assignment: relevance pending business review");
}

function marketResearchTask(stock) {
  const classifications = stock?.classifications || [];
  if (!classifications.length) return "classify_and_score";
  const relevanceComplete = classifications.every((classification) =>
    Number.isFinite(Number(classification.relevance_score)) && !isRelevancePendingReview(classification),
  );
  return relevanceComplete ? "confirm" : "score_only";
}

function buildMarketResearchBatch(stockUniverse, stockMap, completed) {
  const classificationsByCode = new Map((stockMap?.stocks || []).map((stock) => [stock.code, stock]));
  return Array.from(new Map((stockUniverse || []).map((stock) => [normalizeCode(stock.code), stock])).values())
    .filter((stock) => /^\d{6}$/.test(normalizeCode(stock.code)) && !isThirdBoardStockCode(stock.code) && !completed?.[normalizeCode(stock.code)])
    .sort((left, right) => normalizeCode(left.code).localeCompare(normalizeCode(right.code)))
    .map((stock) => {
      const code = normalizeCode(stock.code);
      const mapped = classificationsByCode.get(code);
      return {
        code,
        name: stock.name || mapped?.name || "",
        task: marketResearchTask(mapped),
        classifications: mapped?.classifications || [],
        reason: mapped?.reason || "",
      };
    })
    .slice(0, 100);
}

export default function Home() {
  const [taxonomy, setTaxonomy] = useState(emptyTaxonomy);
  const [stockMap, setStockMap] = useState(emptyStockMap);
  const [collections, setCollections] = useState(emptyCollections);
  const [dailyThemes, setDailyThemes] = useState([]);
  const [notes, setNotes] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [stockUniverse, setStockUniverse] = useState([]);
  const [marketResearchProgress, setMarketResearchProgress] = useState({ completed: {} });
  const [activeMarketResearchBatch, setActiveMarketResearchBatch] = useState([]);
  const [workspaceView, setWorkspaceView] = useState("library");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [validation, setValidation] = useState({ ok: true, errors: [], warnings: [] });
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(true);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [sidebarLevel, setSidebarLevel] = useState("collections");
  const [selectedPrimary, setSelectedPrimary] = useState("");
  const [selectedSecondary, setSelectedSecondary] = useState("");
  const [selectedTertiary, setSelectedTertiary] = useState("全部");
  const [openPrimaryNames, setOpenPrimaryNames] = useState([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quotes, setQuotes] = useState({});
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState("");
  const [quoteMode, setQuoteMode] = useState("live");
  const [dailyScanDate, setDailyScanDate] = useState(todayInputValue);
  const [cycleReplayStartDate, setCycleReplayStartDate] = useState(todayInputValue);
  const [dailyScan, setDailyScan] = useState(null);
  const [dailyScanLoading, setDailyScanLoading] = useState(false);
  const [dailyScanProgress, setDailyScanProgress] = useState("");
  const [dailyScanProgressValue, setDailyScanProgressValue] = useState(0);
  const [marketEnvironment, setMarketEnvironment] = useState(null);
  const [marketEnvironmentStatus, setMarketEnvironmentStatus] = useState("loading");
  const dailyScanRequestRef = useRef(0);
  const [mainlineHistory, setMainlineHistory] = useState([]);
  const [mainlineHistoryLoading, setMainlineHistoryLoading] = useState(false);
  const [systemMainline, setSystemMainline] = useState(null);
  const [mainlineReplayScores, setMainlineReplayScores] = useState(null);
  const [systemMainlineLoading, setSystemMainlineLoading] = useState(false);
  const [analysisCacheClearing, setAnalysisCacheClearing] = useState(false);
  const [capacityCoreResults, setCapacityCoreResults] = useState({});
  const [capacityCoreLoading, setCapacityCoreLoading] = useState({});
  const [leaderResults, setLeaderResults] = useState({});
  const [leaderLoading, setLeaderLoading] = useState({});
  const [limitUpFilter, setLimitUpFilter] = useState({ key: "", loading: false, records: null, scanned: 0 });
  const [saveRevision, setSaveRevision] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const modalType = typeof modal === "string" ? modal : modal?.type;

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    const savedView = window.localStorage.getItem("stock-library.workspace-view");
    const savedNoteId = window.localStorage.getItem("stock-library.selected-note-id");
    if (savedView === "notes" || savedView === "library" || savedView === "watchlist") setWorkspaceView(savedView);
    if (savedNoteId) setSelectedNoteId(savedNoteId);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("stock-library.workspace-view", workspaceView);
  }, [workspaceView]);

  useEffect(() => {
    if (selectedNoteId) window.localStorage.setItem("stock-library.selected-note-id", selectedNoteId);
    else window.localStorage.removeItem("stock-library.selected-note-id");
  }, [selectedNoteId]);

  const markDirty = () => setSaveRevision((value) => value + 1);

  const saveNotes = async (nextNotes, successMessage = "") => {
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: nextNotes })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存笔记失败");
      setNotes(payload.notes || nextNotes);
      if (successMessage) notify(successMessage);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  };

  const createNote = async () => {
    const now = new Date().toISOString();
    const note = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, title: "未命名笔记", content: "", createdAt: now, updatedAt: now };
    if (await saveNotes([note, ...notes], "已新建笔记")) setSelectedNoteId(note.id);
  };

  const updateNote = async (id, values) => {
    return saveNotes(notes.map((note) => note.id === id ? { ...note, ...values, updatedAt: new Date().toISOString() } : note));
  };

  const deleteNote = async (id) => {
    const nextNotes = notes.filter((note) => note.id !== id);
    if (await saveNotes(nextNotes, "笔记已删除")) setSelectedNoteId(nextNotes[0]?.id || "");
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/library", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "读取产业分类 JSON 失败");
        if (cancelled) return;
        const nextTaxonomy = payload.taxonomy || emptyTaxonomy;
        const nextCollections = normalizeCollections(payload.collections || emptyCollections);
        setTaxonomy(nextTaxonomy);
        setCollections(nextCollections);
        setStockMap(sanitizeStockMap(applyLocalStockNames(payload.stockMap || emptyStockMap, payload.stockNames?.names || {})));
        // The local name map is loaded with the library and provides an
        // immediate full-market fallback. The live stock-universe request can
        // replace it later, but the GPT review button must not stay disabled
        // while that request is pending.
        const cachedUniverse = Object.entries(payload.stockNames?.names || {})
          .map(([code, name]) => ({ code: normalizeCode(code), name: String(name || "").trim() }))
          .filter((stock) => /^\d{6}$/.test(stock.code) && stock.name && !isThirdBoardStockCode(stock.code));
        if (cachedUniverse.length) setStockUniverse((current) => mergeMarketResearchUniverse(current, cachedUniverse));
        setDailyThemes(payload.dailyThemes || []);
        setValidation(payload.validation || { ok: true, errors: [], warnings: [] });
        setWritable(true);
        const firstCollection = nextCollections.collections?.[0];
        const firstSectorName = firstCollection?.primary_sectors?.find((name) => nextTaxonomy.sectors?.some((sector) => sector.name === name)) || nextTaxonomy.sectors?.[0]?.name || "";
        const firstSector = nextTaxonomy.sectors?.find((sector) => sector.name === firstSectorName) || nextTaxonomy.sectors?.[0];
        setSelectedCollection(firstCollection?.name || "");
        setSelectedPrimary(firstSector?.name || "");
        setSelectedSecondary(firstSector?.secondary_sectors?.[0]?.name || "");
        setOpenPrimaryNames(firstSector?.name ? [firstSector.name] : []);
        setReady(true);
      } catch (error) {
        notify(error.message);
        setWritable(false);
        setReady(true);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (workspaceView !== "notes") return;
    fetch("/api/notes", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!Array.isArray(payload.notes)) throw new Error(payload.error || "读取笔记失败");
        setNotes(payload.notes);
        setSelectedNoteId((current) => current || payload.notes[0]?.id || "");
      })
      .catch((error) => notify(error.message));
  }, [workspaceView]);

  useEffect(() => {
    fetch("/api/watchlist", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!Array.isArray(payload.stocks)) throw new Error(payload.error || "读取观察池失败");
        setWatchlist(payload.stocks);
      })
      .catch((error) => notify(error.message));
  }, []);

  useEffect(() => {
    fetch("/api/stock-universe", { cache: "force-cache" })
      .then((response) => response.json())
      .then((payload) => {
        if (Array.isArray(payload.stocks) && payload.stocks.length) {
          setStockUniverse((current) => mergeMarketResearchUniverse(current, payload.stocks));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/market-research", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload?.completed || typeof payload.completed !== "object") throw new Error(payload.error || "读取全市场核验进度失败");
        setMarketResearchProgress(payload);
      })
      .catch((error) => notify(error.message));
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY) || "[]");
      const isValidBatch = isUsableMarketResearchBatch(saved);
      // 批次一旦复制会被锁定，防止在导入前随行情刷新而变化。升级股票池规则后，
      // 旧锁定批次可能仍包含三板代码；必须整体废弃并从过滤后的股票池重新生成，
      // 不能只删掉其中几只，否则会改变原批次的导入完整性约束。
      if (Array.isArray(saved) && saved.some((stock) => isThirdBoardStockCode(stock.code))) {
        window.localStorage.removeItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY);
      } else if (isValidBatch) {
        setActiveMarketResearchBatch(saved);
      } else {
        window.localStorage.removeItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY);
      }
    } catch {
      window.localStorage.removeItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY);
    }
  }, []);

  useEffect(() => {
    if (!ready || !writable || saveRevision === 0) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taxonomy, stockMap: sanitizeStockMap(stockMap), collections, dailyThemes })
        });
        const payload = await response.json();
        if (!response.ok) {
          const detail = payload.validation?.errors?.[0];
          throw new Error(detail ? `${payload.error || "数据校验失败"}：${detail}` : (payload.error || "保存产业分类 JSON 失败"));
        }
        setValidation(payload.validation || { ok: true, errors: [], warnings: [] });
        if (payload.taxonomy) setTaxonomy(payload.taxonomy);
      } catch (error) {
        notify(error.message);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [saveRevision, taxonomy, stockMap, collections, dailyThemes, ready, writable]);

  useEffect(() => {
    setDailyScan((current) => refreshDailyScanClassification(current, stockMap));
  }, [stockMap.stocks]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMove = (event) => {
      setSidebarWidth(Math.min(460, Math.max(280, event.clientX)));
    };
    const onUp = () => setIsResizingSidebar(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.classList.add("resizing-sidebar");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-sidebar");
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!actionMenu) return;
    const closeMenu = (event) => {
      if (event.target.closest?.("[data-action-menu-root]")) return;
      setActionMenu(null);
    };
    const closeByEsc = (event) => {
      if (event.key === "Escape") setActionMenu(null);
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeByEsc);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeByEsc);
    };
  }, [actionMenu]);

  const indexes = useMemo(() => buildRuntimeIndexes(taxonomy, stockMap), [taxonomy, stockMap]);
  const lookups = useMemo(() => buildTaxonomyLookups(taxonomy), [taxonomy]);
  const mainlineAnalysis = useMemo(() => buildMainlineAnalysis(taxonomy, indexes, quotes, mainlineHistory), [taxonomy, indexes, quotes, mainlineHistory]);
  const collection = collections.collections.find((item) => item.name === selectedCollection) || collections.collections[0];
  const collectionPrimarySet = useMemo(() => new Set(collection?.primary_sectors || []), [collection]);
  const visibleSectors = useMemo(() => {
    if (!collection) return taxonomy.sectors || [];
    const filtered = (taxonomy.sectors || []).filter((sector) => collectionPrimarySet.has(sector.name));
    return filtered.length ? filtered : [];
  }, [taxonomy.sectors, collection, collectionPrimarySet]);
  const currentCollectionStocks = useMemo(
    () => uniqueByCode(visibleSectors.flatMap((sector) => indexList(indexes.primarySectorIndex, sector.name))),
    [indexes.primarySectorIndex, visibleSectors]
  );
  const primary = visibleSectors.find((sector) => sector.name === selectedPrimary) || visibleSectors[0] || (!collection ? taxonomy.sectors[0] : null);
  const secondary = primary?.secondary_sectors?.find((item) => item.name === selectedSecondary) || primary?.secondary_sectors?.[0];
  const secondaryStocks = primary && secondary ? indexList(indexes.secondarySectorIndex, `${primary.name}|${secondary.name}`) : [];
  const visibleStocks = useMemo(() => {
    if (!primary || !secondary) return [];
    let stocks;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      stocks = filterTradableStocks(stockMap.stocks, quotes).filter((stock) => [
        stock.code,
        stock.name,
        stock.primary_sector,
        stock.reason,
        ...(stock.product_tags || []),
        ...(stock.classifications || []).flatMap((item) => [item.secondary_sector, ...(item.tertiary_sectors || [])])
      ].some((value) => String(value || "").toLowerCase().includes(q)));
    } else if (selectedTertiary === "全部") {
      stocks = filterTradableStocks(secondaryStocks, quotes);
    } else {
      stocks = filterTradableStocks(indexList(indexes.tertiarySectorIndex, `${primary.name}|${secondary.name}|${selectedTertiary}`), quotes);
    }
    return limitUpFilter.records ? stocks.filter((stock) => limitUpFilter.records[stock.code]) : stocks;
  }, [indexes, limitUpFilter.records, primary, query, secondary, secondaryStocks, selectedTertiary, stockMap.stocks, quotes]);

  const scanSelectedTertiaryLimitUps = async () => {
    if (!primary || !secondary || selectedTertiary === "全部") return;
    if (limitUpFilter.records) {
      setLimitUpFilter({ key: "", loading: false, records: null, scanned: 0 });
      return;
    }
    const stocks = indexList(indexes.tertiarySectorIndex, `${primary.name}|${secondary.name}|${selectedTertiary}`);
    setLimitUpFilter({ key: `${primary.name}|${secondary.name}|${selectedTertiary}`, loading: true, records: null, scanned: stocks.length });
    try {
      const response = await fetch(`/api/limit-up-history?codes=${encodeURIComponent(stocks.map((stock) => stock.code).join(","))}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "近月涨停数据读取失败");
      const records = { ...(payload.records || {}) };
      for (const stock of stocks) {
        if (!isLimitUpChange(stock.code, quotes[stock.code]?.changePct)) continue;
        records[stock.code] ||= { count: 1, lastDate: todayInputValue() };
      }
      setLimitUpFilter({ key: `${primary.name}|${secondary.name}|${selectedTertiary}`, loading: false, records, scanned: payload.scanned || stocks.length });
    } catch (error) {
      setLimitUpFilter({ key: "", loading: false, records: null, scanned: 0 });
      notify(error.message);
    }
  };

  useEffect(() => {
    setLimitUpFilter({ key: "", loading: false, records: null, scanned: 0 });
  }, [selectedPrimary, selectedSecondary, selectedTertiary]);

  const globalSearchStocks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    const normalizedKeyword = normalizeCode(keyword);
    return stockMap.stocks.filter((stock) => {
      const classifications = (stock.classifications || []).flatMap((item) => [
        classificationPrimarySector(stock, item),
        item.secondary_sector,
        ...(item.tertiary_sectors || [])
      ]);
      return [stock.code, stock.name, stock.primary_sector, stock.reason, ...(stock.product_tags || []), ...classifications]
        .some((value) => String(value || "").toLowerCase().includes(keyword))
        || (/^\d{1,6}$/.test(keyword) && stock.code === normalizedKeyword);
    });
  }, [query, stockMap.stocks]);

  // The stock-universe request may still be loading or may be temporarily
  // unavailable. A completed daily scan already contains the full market for
  // that trading date, so use it as the safe local fallback rather than
  // disabling the all-market review workflow.
  const marketResearchUniverse = useMemo(
    () => stockUniverse.length ? stockUniverse : (dailyScan?.stocks || []),
    [dailyScan?.stocks, stockUniverse],
  );
  const marketResearchBatch = useMemo(
    () => buildMarketResearchBatch(marketResearchUniverse, stockMap, marketResearchProgress.completed),
    [marketResearchProgress.completed, marketResearchUniverse, stockMap],
  );
  const currentMarketResearchBatch = pendingMarketResearchBatch(activeMarketResearchBatch, marketResearchBatch);
  const marketResearchCompletedCount = Object.keys(marketResearchProgress.completed || {}).length;
  const marketResearchPendingCount = pendingMarketResearchCount(marketResearchUniverse, marketResearchProgress.completed);

  const setPendingMarketResearchBatch = (batch) => {
    setActiveMarketResearchBatch(batch);
    if (batch.length) window.localStorage.setItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY, JSON.stringify(batch));
    else window.localStorage.removeItem(MARKET_RESEARCH_ACTIVE_BATCH_KEY);
  };

  useEffect(() => {
    if (!activeMarketResearchBatch.length) return;
    const completed = marketResearchProgress.completed || {};
    if (activeMarketResearchBatch.every((stock) => completed[normalizeCode(stock.code)])) {
      setPendingMarketResearchBatch([]);
    }
  }, [activeMarketResearchBatch, marketResearchProgress.completed]);

  const allCodes = useMemo(() => Array.from(new Set([
    ...stockMap.stocks.map((stock) => stock.code),
    ...watchlist.map((stock) => stock.code),
    ...watchlist.flatMap((stock) => (stock.relatedStocks || []).map((related) => related.code))
  ])), [stockMap, watchlist]);

  const saveWatchlist = async (stocks) => {
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存观察池失败");
      setWatchlist(payload.stocks || stocks);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  };

  const addWatchStock = async (rawInput) => {
    const input = String(rawInput || "").trim();
    let code = input.replace(/\D/g, "");
    let matchedStock = null;
    if (!/^\d{6}$/.test(code)) {
      const candidates = Array.from(new Map([
        ...stockUniverse.map((stock) => [stock.code, stock]),
        ...stockMap.stocks.map((stock) => [stock.code, stock])
      ]).values());
      const exactMatches = candidates.filter((stock) => String(stock.name || "").trim() === input);
      const partialMatches = candidates.filter((stock) => String(stock.name || "").trim().includes(input));
      const matches = exactMatches.length ? exactMatches : partialMatches;
      if (matches.length === 1) {
        matchedStock = matches[0];
        code = matchedStock.code;
      } else if (matches.length > 1) {
        notify(`找到 ${matches.length} 只匹配股票，请输入更完整的名称或 6 位代码`);
        return false;
      } else {
        notify("未识别该股票名称，请输入完整名称或 6 位股票代码");
        return false;
      }
    }
    if (watchlist.some((stock) => stock.code === code)) {
      notify("该股票已在观察池中");
      return false;
    }
    let name = matchedStock?.name || stockUniverse.find((stock) => stock.code === code)?.name || stockMap.stocks.find((stock) => stock.code === code)?.name || "";
    try {
      const response = await fetch(`/api/quotes?codes=${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = await response.json();
      const quote = payload.quotes?.[code];
      name = quote?.name || name;
      if (quote) setQuotes((current) => ({ ...current, [code]: quote }));
    } catch {
      // 行情服务暂不可用时仍保存代码，稍后自动刷新名称与行情。
    }
    const saved = await saveWatchlist([{ code, name: name || `股票${code}`, addedAt: new Date().toISOString() }, ...watchlist]);
    if (saved) notify(`已将 ${name || code} 加入观察池`);
    return saved;
  };

  const removeWatchStock = async (code) => {
    const saved = await saveWatchlist(watchlist.filter((stock) => stock.code !== code));
    if (saved) notify("已移出观察池");
  };

  const reorderWatchStocks = async (sourceCode, targetCode) => {
    if (!sourceCode || sourceCode === targetCode) return;
    const nextStocks = [...watchlist];
    const sourceIndex = nextStocks.findIndex((stock) => stock.code === sourceCode);
    const targetIndex = nextStocks.findIndex((stock) => stock.code === targetCode);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = nextStocks.splice(sourceIndex, 1);
    nextStocks.splice(targetIndex, 0, moved);
    const saved = await saveWatchlist(nextStocks);
    if (saved) notify("观察池顺序已更新");
  };

  const addWatchRelation = async (sourceCode, rawInput) => {
    const input = String(rawInput || "").trim();
    let code = input.replace(/\D/g, "");
    let matched = null;
    if (!/^\d{6}$/.test(code)) {
      const candidates = Array.from(new Map([
        ...stockUniverse.map((stock) => [stock.code, stock]),
        ...stockMap.stocks.map((stock) => [stock.code, stock])
      ]).values());
      const exact = candidates.filter((stock) => String(stock.name || "").trim() === input);
      const partial = candidates.filter((stock) => String(stock.name || "").trim().includes(input));
      const matches = exact.length ? exact : partial;
      if (matches.length !== 1) {
        notify(matches.length ? `找到 ${matches.length} 只匹配股票，请输入更完整的名称或代码` : "未识别该股票名称，请输入完整名称或 6 位代码");
        return false;
      }
      matched = matches[0];
      code = matched.code;
    }
    if (code === sourceCode) {
      notify("不能将股票自身添加为联动股票");
      return false;
    }
    const source = watchlist.find((stock) => stock.code === sourceCode);
    if (!source || source.relatedStocks?.some((stock) => stock.code === code)) {
      notify("该股票已在此联动列表中");
      return false;
    }
    let name = matched?.name || stockUniverse.find((stock) => stock.code === code)?.name || stockMap.stocks.find((stock) => stock.code === code)?.name || "";
    try {
      const response = await fetch(`/api/quotes?codes=${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = await response.json();
      const quote = payload.quotes?.[code];
      name = quote?.name || name;
      if (quote) setQuotes((current) => ({ ...current, [code]: quote }));
    } catch {}
    const saved = await saveWatchlist(watchlist.map((stock) => stock.code === sourceCode ? {
      ...stock,
      relatedStocks: [...(stock.relatedStocks || []), { code, name: name || `股票${code}` }]
    } : stock));
    if (saved) notify(`已添加联动股票 ${name || code}`);
    return saved;
  };

  const removeWatchRelation = async (sourceCode, relatedCode) => {
    const saved = await saveWatchlist(watchlist.map((stock) => stock.code === sourceCode ? {
      ...stock,
      relatedStocks: (stock.relatedStocks || []).filter((related) => related.code !== relatedCode)
    } : stock));
    if (saved) notify("已移出联动列表");
  };

  const updateWatchRelationNote = async (sourceCode, relatedCode, note) => {
    const saved = await saveWatchlist(watchlist.map((stock) => stock.code === sourceCode ? {
      ...stock,
      relatedStocks: (stock.relatedStocks || []).map((related) => related.code === relatedCode ? { ...related, note: String(note || "").slice(0, 200) } : related)
    } : stock));
    if (saved) notify("联动备注已保存");
  };

  useEffect(() => {
    if (!ready || !visibleSectors.length) return;
    if (visibleSectors.some((sector) => sector.name === selectedPrimary)) return;
    const nextPrimary = visibleSectors[0];
    setSelectedPrimary(nextPrimary.name);
    setSelectedSecondary(nextPrimary.secondary_sectors?.[0]?.name || "");
    setSelectedTertiary("全部");
    setOpenPrimaryNames(nextPrimary.name ? [nextPrimary.name] : []);
  }, [ready, selectedPrimary, visibleSectors]);
  useEffect(() => {
    if (!ready || allCodes.length === 0 || quoteMode !== "live") return;
    let cancelled = false;
    const loadQuotes = async () => {
      try {
        const response = await fetch(`/api/quotes?codes=${encodeURIComponent(allCodes.join(","))}`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && payload.quotes) {
          setQuotes(payload.quotes);
          setQuoteUpdatedAt(payload.updatedAt || new Date().toLocaleTimeString());
        }
      } catch {
        if (!cancelled) setQuoteUpdatedAt("");
      }
    };
    loadQuotes();
    const timer = window.setInterval(loadQuotes, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [allCodes, ready, quoteMode]);

  useEffect(() => {
    if (!ready || !dailyScanDate) return;
    const controller = new AbortController();
    setMarketEnvironmentStatus("loading");
    fetch(`/api/daily-market?date=${encodeURIComponent(dailyScanDate)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "市场行情读取失败");
        return payload;
      })
      .then((payload) => {
        setMarketEnvironment(summarizeMarketEnvironment(payload.stocks, payload.date, indexes));
        setMarketEnvironmentStatus("ready");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setMarketEnvironment(null);
        setMarketEnvironmentStatus("error");
      });
    return () => controller.abort();
  }, [dailyScanDate, indexes, ready]);

  useEffect(() => {
    if (!ready || quoteMode !== "daily" || !dailyScan || dailyScan.source === "local" || allCodes.length === 0) return;
    let cancelled = false;
    fetch(`/api/quotes?codes=${encodeURIComponent(allCodes.join(","))}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && payload.quotes) {
          setQuotes((current) => ({ ...current, ...payload.quotes }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allCodes, dailyScan?.source, quoteMode, ready]);

  useEffect(() => {
    // Local intraday files can be incomplete while the market is open.  Once
    // a current-day scan is on screen, keep its missing classified stocks in
    // sync with the resilient live quote endpoint without altering history.
    if (!ready || quoteMode !== "daily" || dailyScan?.source !== "local" || dailyScan.date !== todayInputValue() || allCodes.length === 0) return;
    const missingCodes = allCodes.filter((code) => !quotes[code]);
    if (!missingCodes.length) return;
    let cancelled = false;
    const fillMissingCurrentQuotes = async () => {
      const batches = Array.from({ length: Math.ceil(missingCodes.length / 100) }, (_, index) => missingCodes.slice(index * 100, index * 100 + 100));
      const results = await Promise.all(batches.map(async (batch) => {
        const response = await fetch(`/api/quotes?codes=${encodeURIComponent(batch.join(","))}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "实时行情补数失败");
        return payload.quotes || {};
      }));
      if (!cancelled) setQuotes((current) => ({ ...current, ...Object.assign({}, ...results) }));
    };
    fillMissingCurrentQuotes().catch(() => {});
    return () => { cancelled = true; };
  }, [allCodes, dailyScan?.date, dailyScan?.source, quoteMode, quotes, ready]);

  const selectPrimary = (name) => {
    setWorkspaceView("library");
    const nextPrimary = taxonomy.sectors.find((sector) => sector.name === name);
    setSelectedPrimary(name);
    setSelectedSecondary(nextPrimary?.secondary_sectors?.[0]?.name || "");
    setSelectedTertiary("全部");
    setQuery("");
  };

  const selectCollection = (name) => {
    setWorkspaceView("library");
    const nextCollection = collections.collections.find((item) => item.name === name);
    setSelectedCollection(name);
    setActionMenu(null);
    const nextPrimaryName = nextCollection?.primary_sectors?.find((item) => taxonomy.sectors.some((sector) => sector.name === item)) || "";
    const nextPrimary = taxonomy.sectors.find((sector) => sector.name === nextPrimaryName);
    setSelectedPrimary(nextPrimary?.name || "");
    setSelectedSecondary(nextPrimary?.secondary_sectors?.[0]?.name || "");
    setSelectedTertiary("全部");
    setOpenPrimaryNames(nextPrimary?.name ? [nextPrimary.name] : []);
    setQuery("");
  };

  const enterCollection = (name) => {
    selectCollection(name);
    setOpenPrimaryNames([]);
    setSidebarLevel("primaries");
  };

  const backToCollections = () => {
    setWorkspaceView("library");
    setSidebarLevel("collections");
    setActionMenu(null);
  };

  const togglePrimary = (name) => {
    setOpenPrimaryNames((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]);
  };

  const selectSecondary = (name) => {
    setWorkspaceView("library");
    setSelectedSecondary(name);
    setSelectedTertiary("全部");
    setQuery("");
  };

  const toggleActionMenu = (level, name) => {
    setActionMenu((current) =>
      current?.level === level && current?.name === name ? null : { level, name }
    );
  };

  const addPrimary = ({ name }) => {
    const primaryName = name.trim();
    if (!primaryName) return;
    if (taxonomy.sectors.some((sector) => sector.name === primaryName)) {
      const alreadyInCurrentCollection = collection?.name === selectedCollection && (collection.primary_sectors || []).includes(primaryName);
      if (!selectedCollection || alreadyInCurrentCollection) {
        notify("该一级主线已存在");
        return;
      }
      setCollections((current) => ({
        ...current,
        collections: current.collections.map((item) => item.name !== selectedCollection ? item : {
          ...item,
          primary_sectors: Array.from(new Set([...(item.primary_sectors || []), primaryName]))
        })
      }));
      const existingPrimary = taxonomy.sectors.find((sector) => sector.name === primaryName);
      setSelectedPrimary(primaryName);
      setSelectedSecondary(existingPrimary?.secondary_sectors?.[0]?.name || "");
      setSelectedTertiary("全部");
      setOpenPrimaryNames((items) => items.includes(primaryName) ? items : [...items, primaryName]);
      markDirty();
      notify(`已将已有一级主线「${primaryName}」加入当前产业书页`);
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: [
        ...current.sectors,
        {
          name: primaryName,
          secondary_sectors: []
        }
      ]
    }));
    if (selectedCollection) {
      setCollections((current) => ({
        ...current,
        collections: current.collections.map((item) => item.name !== selectedCollection ? item : {
          ...item,
          primary_sectors: Array.from(new Set([...(item.primary_sectors || []), primaryName]))
        })
      }));
    }
    setSelectedPrimary(primaryName);
    setSelectedSecondary("");
    setSelectedTertiary("全部");
    setOpenPrimaryNames((items) => [...items, primaryName]);
    markDirty();
    notify(`已新增一级主线「${primaryName}」`);
  };

  const addCollection = ({ name, description }) => {
    const collectionName = name.trim();
    if (!collectionName) return;
    if (collections.collections.some((item) => item.name === collectionName)) {
      notify("该产业书页已存在");
      return;
    }
    setCollections((current) => ({
      ...current,
      collections: [...current.collections, { name: collectionName, description: description.trim(), primary_sectors: [] }]
    }));
    setSelectedCollection(collectionName);
    setSelectedPrimary("");
    setSelectedSecondary("");
    setSelectedTertiary("全部");
    setOpenPrimaryNames([]);
    markDirty();
    notify(`已新增产业书页「${collectionName}」`);
  };

  const renameCollection = ({ name }) => {
    const oldName = modal?.name;
    const nextName = name.trim();
    if (!oldName || !nextName || oldName === nextName) return;
    if (collections.collections.some((item) => item.name === nextName)) {
      notify("该产业书页名称已存在");
      return;
    }
    setCollections((current) => ({
      ...current,
      collections: current.collections.map((item) => item.name === oldName ? { ...item, name: nextName } : item)
    }));
    setSelectedCollection((current) => current === oldName ? nextName : current);
    markDirty();
    notify(`已将产业书页「${oldName}」更名为「${nextName}」`);
  };

  const deleteCollection = (name) => {
    const target = collections.collections.find((item) => item.name === name);
    if (!target) return;
    const existingPrimaryNames = new Set((target.primary_sectors || []).filter((primaryName) =>
      taxonomy.sectors.some((sector) => sector.name === primaryName)
    ));
    setDeleteConfirmation({ name, primaryNames: [...existingPrimaryNames] });
    setActionMenu(null);
  };

  const confirmDeleteCollection = () => {
    const name = deleteConfirmation?.name;
    if (!name) return;
    const target = collections.collections.find((item) => item.name === name);
    if (!target) {
      setDeleteConfirmation(null);
      return;
    }
    const primaryNames = new Set(deleteConfirmation.primaryNames || []);
    const stockCount = stockMap.stocks.filter((stock) => [...primaryNames].some((primaryName) => stockHasPrimary(stock, primaryName))).length;

    const nextCollections = collections.collections.filter((item) => item.name !== name);
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.filter((sector) => !primaryNames.has(sector.name))
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => {
        for (const primaryName of primaryNames) {
          if (stockHasPrimary(stock, primaryName)) stock = removeStockPrimary(stock, primaryName);
          if (!stock) return null;
        }
        return stock;
      }).filter(Boolean)
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).filter((theme) => !primaryNames.has(theme.primary_sector))
    })));
    setCollections((current) => ({
      ...current,
      collections: current.collections
        .filter((item) => item.name !== name)
        .map((item) => ({
          ...item,
          primary_sectors: (item.primary_sectors || []).filter((primaryName) => !primaryNames.has(primaryName))
        }))
    }));
    const nextCollection = nextCollections[0];
    setSelectedCollection((current) => current === name ? nextCollection?.name || "" : current);
    setSelectedPrimary("");
    setSelectedSecondary("");
    setSelectedTertiary("全部");
    setOpenPrimaryNames([]);
    setSidebarLevel("collections");
    setActionMenu(null);
    setDeleteConfirmation(null);
    markDirty();
    notify(primaryNames.size
      ? `已删除产业书页「${name}」及其 ${primaryNames.size} 条一级主线`
      : `已删除产业书页「${name}」`
    );
  };

  const deletePrimary = (name) => {
    const target = taxonomy.sectors.find((sector) => sector.name === name);
    if (!target) return;
    const stockCount = stockMap.stocks.filter((stock) => stockHasPrimary(stock, name)).length;
    const message = stockCount
      ? `删除一级主线「${name}」？其中 ${stockCount} 只股票的长期归属也会一起移除。`
      : `删除一级主线「${name}」？`;
    if (!confirm(message)) return;

    const nextSectors = taxonomy.sectors.filter((sector) => sector.name !== name);
    setTaxonomy((current) => ({ ...current, sectors: nextSectors }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => removeStockPrimary(stock, name) || null).filter(Boolean)
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).filter((theme) => theme.primary_sector !== name)
    })));
    setCollections((current) => ({
      ...current,
      collections: current.collections.map((item) => ({
        ...item,
        primary_sectors: (item.primary_sectors || []).filter((primaryName) => primaryName !== name)
      }))
    }));
    setOpenPrimaryNames((items) => items.filter((item) => item !== name));

    if (selectedPrimary === name) {
      const nextPrimary = nextSectors[0];
      setSelectedPrimary(nextPrimary?.name || "");
      setSelectedSecondary(nextPrimary?.secondary_sectors?.[0]?.name || "");
      setSelectedTertiary("全部");
      setOpenPrimaryNames(nextPrimary?.name ? [nextPrimary.name] : []);
    }
    markDirty();
    notify(`已删除一级主线「${name}」`);
  };

  const renamePrimary = ({ name }) => {
    const nextName = name.trim();
    const oldName = modal?.name;
    if (!oldName || !nextName || oldName === nextName) return;
    if (taxonomy.sectors.some((sector) => sector.name === nextName)) {
      notify("目标一级主线已存在，请使用合并功能");
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name === oldName ? { ...sector, name: nextName } : sector)
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => ({
        ...stock,
        primary_sector: stock.primary_sector === oldName ? nextName : stock.primary_sector,
        classifications: (stock.classifications || []).map((item) =>
          classificationPrimarySector(stock, item) === oldName ? { ...item, primary_sector: nextName } : item
        )
      }))
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) => theme.primary_sector === oldName ? { ...theme, primary_sector: nextName } : theme)
    })));
    setCollections((current) => ({
      ...current,
      collections: current.collections.map((item) => ({
        ...item,
        primary_sectors: (item.primary_sectors || []).map((primaryName) => primaryName === oldName ? nextName : primaryName)
      }))
    }));
    setSelectedPrimary((value) => value === oldName ? nextName : value);
    setOpenPrimaryNames((items) => items.map((item) => item === oldName ? nextName : item));
    markDirty();
    notify(`已重命名一级主线「${oldName}」为「${nextName}」`);
  };

  const mergePrimary = ({ target }) => {
    const sourceName = modal?.name;
    const targetName = target.trim();
    if (!sourceName || !targetName || sourceName === targetName) return;
    const sourceSector = taxonomy.sectors.find((sector) => sector.name === sourceName);
    const targetSector = taxonomy.sectors.find((sector) => sector.name === targetName);
    if (!sourceSector || !targetSector) return;

    setTaxonomy((current) => {
      const next = structuredClone(current);
      const source = next.sectors.find((sector) => sector.name === sourceName);
      const destination = next.sectors.find((sector) => sector.name === targetName);
      for (const secondary of source.secondary_sectors || []) {
        let targetSecondary = destination.secondary_sectors.find((item) => item.name === secondary.name);
        if (!targetSecondary) {
          destination.secondary_sectors.push(structuredClone(secondary));
        } else {
          targetSecondary.tertiary_sectors = Array.from(new Set([
            ...(targetSecondary.tertiary_sectors || []),
            ...(secondary.tertiary_sectors || [])
          ]));
        }
      }
      next.sectors = next.sectors.filter((sector) => sector.name !== sourceName);
      return next;
    });
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => ({
        ...stock,
        primary_sector: stock.primary_sector === sourceName ? targetName : stock.primary_sector,
        classifications: (stock.classifications || []).map((item) =>
          classificationPrimarySector(stock, item) === sourceName ? { ...item, primary_sector: targetName } : item
        )
      }))
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) => theme.primary_sector === sourceName ? { ...theme, primary_sector: targetName } : theme)
    })));
    setCollections((current) => ({
      ...current,
      collections: current.collections.map((item) => ({
        ...item,
        primary_sectors: Array.from(new Set((item.primary_sectors || []).map((primaryName) => primaryName === sourceName ? targetName : primaryName)))
      }))
    }));
    setSelectedPrimary(targetName);
    setSelectedSecondary(targetSector.secondary_sectors?.[0]?.name || sourceSector.secondary_sectors?.[0]?.name || "");
    setSelectedTertiary("全部");
    setOpenPrimaryNames((items) => Array.from(new Set([...items.filter((item) => item !== sourceName), targetName])));
    markDirty();
    notify(`已合并一级主线「${sourceName}」到「${targetName}」`);
  };

  const movePrimaryToCollection = ({ target }) => {
    const primaryName = modal?.name;
    const sourceCollectionName = modal?.sourceCollection || collection?.name;
    const targetCollectionName = target?.trim();
    if (!primaryName || !sourceCollectionName || !targetCollectionName || sourceCollectionName === targetCollectionName) return;
    if (!collections.collections.some((item) => item.name === targetCollectionName)) {
      notify("目标产业书页不存在");
      return;
    }
    setCollections((current) => ({
      ...current,
      collections: current.collections.map((item) => {
        if (item.name === sourceCollectionName) {
          return { ...item, primary_sectors: (item.primary_sectors || []).filter((name) => name !== primaryName) };
        }
        if (item.name === targetCollectionName) {
          return { ...item, primary_sectors: Array.from(new Set([...(item.primary_sectors || []), primaryName])) };
        }
        return item;
      })
    }));
    if (selectedPrimary === primaryName && collection?.name === sourceCollectionName) {
      const nextPrimary = visibleSectors.find((sector) => sector.name !== primaryName);
      setSelectedPrimary(nextPrimary?.name || "");
      setSelectedSecondary(nextPrimary?.secondary_sectors?.[0]?.name || "");
      setSelectedTertiary("全部");
      setOpenPrimaryNames((items) => items.filter((name) => name !== primaryName));
    }
    markDirty();
    notify(`已将一级主线「${primaryName}」移动到「${targetCollectionName}」`);
  };

  const addSecondary = ({ name, tertiaryName }) => {
    if (!primary) return;
    const secondaryName = name.trim();
    const firstTertiary = tertiaryName.trim();
    if (!secondaryName) return;
    if (primary.secondary_sectors.some((item) => item.name === secondaryName)) {
      notify("该二级主线已存在");
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: [
          ...sector.secondary_sectors,
          {
            name: secondaryName,
            tertiary_sectors: firstTertiary ? [firstTertiary] : []
          }
        ]
      })
    }));
    setSelectedSecondary(secondaryName);
    setSelectedTertiary("全部");
    markDirty();
    notify(`已新增二级主线「${secondaryName}」`);
  };

  const renameSecondary = ({ name }) => {
    if (!primary) return;
    const oldName = modal?.name;
    const nextName = name.trim();
    if (!oldName || !nextName || oldName === nextName) return;
    if (primary.secondary_sectors.some((item) => item.name === nextName)) {
      notify("目标二级主线已存在，请使用合并功能");
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.map((item) => item.name === oldName ? { ...item, name: nextName } : item)
      })
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => !stockHasPrimary(stock, primary.name) ? stock : {
        ...stock,
        classifications: (stock.classifications || []).map((item) =>
          classificationPrimarySector(stock, item) === primary.name && item.secondary_sector === oldName ? { ...item, secondary_sector: nextName } : item
        )
      })
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) =>
        theme.primary_sector === primary.name && theme.secondary_sector === oldName ? { ...theme, secondary_sector: nextName } : theme
      )
    })));
    setSelectedSecondary((value) => value === oldName ? nextName : value);
    markDirty();
    notify(`已重命名二级主线「${oldName}」为「${nextName}」`);
  };

  const mergeSecondary = ({ target }) => {
    if (!primary) return;
    const sourceName = modal?.name;
    const targetName = target.trim();
    if (!sourceName || !targetName || sourceName === targetName) return;
    const sourceSecondary = primary.secondary_sectors.find((item) => item.name === sourceName);
    if (!sourceSecondary || !primary.secondary_sectors.some((item) => item.name === targetName)) return;

    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => {
        if (sector.name !== primary.name) return sector;
        const source = sector.secondary_sectors.find((item) => item.name === sourceName);
        return {
          ...sector,
          secondary_sectors: sector.secondary_sectors
            .filter((item) => item.name !== sourceName)
            .map((item) => item.name !== targetName ? item : {
              ...item,
              tertiary_sectors: Array.from(new Set([...(item.tertiary_sectors || []), ...(source?.tertiary_sectors || [])]))
            })
        };
      })
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => !stockHasPrimary(stock, primary.name) ? stock : {
        ...stock,
        classifications: (stock.classifications || []).reduce((items, item) => {
          const nextItem = classificationPrimarySector(stock, item) === primary.name && item.secondary_sector === sourceName ? { ...item, secondary_sector: targetName } : item;
          const existing = items.find((entry) => classificationPrimarySector(stock, entry) === classificationPrimarySector(stock, nextItem) && entry.secondary_sector === nextItem.secondary_sector);
          if (existing) {
            existing.tertiary_sectors = Array.from(new Set([...(existing.tertiary_sectors || []), ...(nextItem.tertiary_sectors || [])]));
          } else {
            items.push(structuredClone(nextItem));
          }
          return items;
        }, [])
      })
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) =>
        theme.primary_sector === primary.name && theme.secondary_sector === sourceName ? { ...theme, secondary_sector: targetName } : theme
      )
    })));
    setSelectedSecondary(targetName);
    setSelectedTertiary("全部");
    markDirty();
    notify(`已合并二级主线「${sourceName}」到「${targetName}」`);
  };

  const deleteSecondary = (name) => {
    if (!primary) return;
    const stockCount = indexList(indexes.secondarySectorIndex, `${primary.name}|${name}`).length;
    if (!confirm(`删除二级主线「${name}」？${stockCount ? `\n\n将移除 ${stockCount} 只股票在「${primary.name} / ${name}」下的归属；其余一级、二级归属会保留。` : ""}`)) return;

    const nextSecondaries = primary.secondary_sectors.filter((item) => item.name !== name);
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.filter((item) => item.name !== name)
      })
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => {
        const classifications = (stock.classifications || [])
          .filter((item) => !(classificationPrimarySector(stock, item) === primary.name && item.secondary_sector === name))
          .map((item) => ({ ...item, primary_sector: classificationPrimarySector(stock, item) }));
        return classifications.length ? { ...stock, primary_sector: classifications[0].primary_sector, classifications } : null;
      }).filter(Boolean)
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).filter((theme) => !(theme.primary_sector === primary.name && theme.secondary_sector === name))
    })));
    if (selectedSecondary === name) {
      setSelectedSecondary(nextSecondaries[0]?.name || "");
      setSelectedTertiary("全部");
    }
    setActionMenu(null);
    markDirty();
    notify(`已删除二级主线「${name}」`);
  };

  const addTertiary = ({ name }) => {
    if (!primary || !secondary || !name.trim()) return;
    const exists = secondary.tertiary_sectors.includes(name.trim());
    if (exists) {
      notify("该三级方向已存在");
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.map((item) => item.name !== secondary.name ? item : {
          ...item,
          tertiary_sectors: [...item.tertiary_sectors, name.trim()]
        })
      })
    }));
    setSelectedTertiary(name.trim());
    markDirty();
    notify(`已新增三级方向「${name.trim()}」`);
  };

  const deleteTertiary = (name) => {
    if (!primary || !secondary) return;
    const hasStocks = stockMap.stocks.some((stock) => stockHasTertiary(stock, primary.name, secondary.name, name));
    if (hasStocks) {
      notify("该三级方向已有股票归属，先调整股票后再删除");
      return;
    }
    if (!confirm(`删除三级方向「${name}」？`)) return;
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.map((item) => item.name !== secondary.name ? item : {
          ...item,
          tertiary_sectors: item.tertiary_sectors.filter((tertiary) => tertiary !== name)
        })
      })
    }));
    setSelectedTertiary("全部");
    markDirty();
  };

  const renameTertiary = ({ name }) => {
    if (!primary || !secondary) return;
    const oldName = modal?.name;
    const nextName = name.trim();
    if (!oldName || !nextName || oldName === nextName) return;
    if (secondary.tertiary_sectors.includes(nextName)) {
      notify("目标三级主线已存在，请使用合并功能");
      return;
    }
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.map((item) => item.name !== secondary.name ? item : {
          ...item,
          tertiary_sectors: item.tertiary_sectors.map((tertiary) => tertiary === oldName ? nextName : tertiary)
        })
      })
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => !stockHasPrimary(stock, primary.name) ? stock : {
        ...stock,
        classifications: (stock.classifications || []).map((item) => classificationPrimarySector(stock, item) !== primary.name || item.secondary_sector !== secondary.name ? item : {
          ...item,
          tertiary_sectors: Array.from(new Set((item.tertiary_sectors || []).map((tertiary) => tertiary === oldName ? nextName : tertiary)))
        })
      })
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) =>
        theme.primary_sector === primary.name && theme.secondary_sector === secondary.name ? {
          ...theme,
          related_tertiary_sectors: (theme.related_tertiary_sectors || []).map((tertiary) => tertiary === oldName ? nextName : tertiary)
        } : theme
      )
    })));
    setSelectedTertiary((value) => value === oldName ? nextName : value);
    markDirty();
    notify(`已重命名三级主线「${oldName}」为「${nextName}」`);
  };

  const mergeTertiary = ({ target }) => {
    if (!primary || !secondary) return;
    const sourceName = modal?.name;
    const targetName = target.trim();
    if (!sourceName || !targetName || sourceName === targetName) return;
    if (!secondary.tertiary_sectors.includes(targetName)) return;
    setTaxonomy((current) => ({
      ...current,
      sectors: current.sectors.map((sector) => sector.name !== primary.name ? sector : {
        ...sector,
        secondary_sectors: sector.secondary_sectors.map((item) => item.name !== secondary.name ? item : {
          ...item,
          tertiary_sectors: item.tertiary_sectors.filter((tertiary) => tertiary !== sourceName)
        })
      })
    }));
    setStockMap((current) => ({
      ...current,
      stocks: current.stocks.map((stock) => !stockHasPrimary(stock, primary.name) ? stock : {
        ...stock,
        classifications: (stock.classifications || []).map((item) => classificationPrimarySector(stock, item) !== primary.name || item.secondary_sector !== secondary.name ? item : {
          ...item,
          tertiary_sectors: Array.from(new Set((item.tertiary_sectors || []).map((tertiary) => tertiary === sourceName ? targetName : tertiary)))
        })
      })
    }));
    setDailyThemes((current) => current.map((daily) => ({
      ...daily,
      themes: (daily.themes || []).map((theme) =>
        theme.primary_sector === primary.name && theme.secondary_sector === secondary.name ? {
          ...theme,
          related_tertiary_sectors: Array.from(new Set((theme.related_tertiary_sectors || []).map((tertiary) => tertiary === sourceName ? targetName : tertiary)))
        } : theme
      )
    })));
    setSelectedTertiary(targetName);
    markDirty();
    notify(`已合并三级主线「${sourceName}」到「${targetName}」`);
  };

  const addStocks = async ({ codes, tertiary, relevanceScore }) => {
    if (!primary || !secondary || !tertiary) return;
    const allowed = lookups.tertiary.has(`${primary.name}|${secondary.name}|${tertiary}`);
    const normalizedCodes = Array.from(new Set(
      String(codes || "").split(/[\s,，;；]+/).map((code) => code.replace(/\D/g, "")).filter((code) => /^\d{6}$/.test(code))
    ));
    if (!normalizedCodes.length || !allowed || !Number.isFinite(Number(relevanceScore)) || Number(relevanceScore) < 0 || Number(relevanceScore) > 1) {
      notify("请输入至少一个 6 位股票代码，并选择有效的三级方向");
      return false;
    }

    const existingNames = new Map(stockMap.stocks.map((stock) => [stock.code, stock.name]));
    const missingCodes = normalizedCodes.filter((code) => !existingNames.get(code));
    let quoteNames = {};
    if (missingCodes.length) {
      try {
        const response = await fetch(`/api/quotes?codes=${encodeURIComponent(missingCodes.join(","))}`, { cache: "no-store" });
        const payload = await response.json();
        quoteNames = Object.fromEntries(Object.entries(payload.quotes || {}).map(([code, quote]) => [code, quote.name]));
      } catch {
        // 行情服务不可用时，仍会建立代码记录，名称可在后续行情刷新时补齐。
      }
    }

    setStockMap((current) => {
      const next = structuredClone(current);
      for (const code of normalizedCodes) {
        let stock = next.stocks.find((item) => item.code === code);
        if (!stock) {
          stock = {
            code,
            name: quoteNames[code] || `股票${code}`,
            primary_sector: primary.name,
            classifications: [],
            product_tags: [],
            reason: "由批量代码添加，待后续补充业务资料"
          };
          next.stocks.push(stock);
        }
        stock.name = stock.name || quoteNames[code] || `股票${code}`;
        stock.primary_sector = stock.primary_sector || primary.name;
        let classification = stock.classifications.find((item) =>
          classificationPrimarySector(stock, item) === primary.name && item.secondary_sector === secondary.name
        );
        if (!classification) {
          classification = { primary_sector: primary.name, secondary_sector: secondary.name, tertiary_sectors: [] };
          stock.classifications.push(classification);
        }
        classification.tertiary_sectors = Array.from(new Set([...(classification.tertiary_sectors || []), tertiary]));
        classification.relevance_score = Number(relevanceScore);
      }
      next.stocks.sort((a, b) => a.code.localeCompare(b.code));
      return next;
    });
    markDirty();
    notify(`已添加 ${normalizedCodes.length} 只股票到「${tertiary}」`);
    return true;
  };

  const addCrawledIndustryStocks = ({ industries, target }) => {
    if (!target?.primary || !target?.secondary || !target?.tertiary || !industries?.length) return false;
    const allowed = lookups.tertiary.has(`${target.primary}|${target.secondary}|${target.tertiary}`);
    if (!allowed) {
      notify("目标三级目录已变化，请重新选择后再抓取");
      return false;
    }
    const industryByStock = new Map();
    for (const industry of industries) {
      for (const stock of industry.stocks || []) {
        if (!industryByStock.has(stock.code)) industryByStock.set(stock.code, { stock, industries: [] });
        industryByStock.get(stock.code).industries.push(industry);
      }
    }
    if (!industryByStock.size) {
      notify("本次没有抓取到可添加的股票");
      return false;
    }

    let addedAssignments = 0;
    setStockMap((current) => {
      const next = structuredClone(current);
      for (const [code, record] of industryByStock) {
        const industryNames = Array.from(new Set(record.industries.map((item) => item.name)));
        let stock = next.stocks.find((item) => item.code === code);
        if (!stock) {
          stock = {
            code,
            name: record.stock.name || `股票${code}`,
            primary_sector: target.primary,
            classifications: [],
            product_tags: [],
            reason: `同花顺细分行业「${industryNames.join("、")}」成分股自动补入，待后续人工复核。`
          };
          next.stocks.push(stock);
        }
        stock.name = stock.name || record.stock.name || `股票${code}`;
        stock.primary_sector = stock.primary_sector || target.primary;
        stock.classifications ||= [];
        let classification = stock.classifications.find((item) =>
          classificationPrimarySector(stock, item) === target.primary
          && item.secondary_sector === target.secondary
        );
        if (!classification) {
          classification = {
            primary_sector: target.primary,
            secondary_sector: target.secondary,
            tertiary_sectors: [],
            relevance_score: 0.85,
            source_refs: []
          };
          stock.classifications.push(classification);
        }
        if (!(classification.tertiary_sectors || []).includes(target.tertiary)) {
          classification.tertiary_sectors = [...(classification.tertiary_sectors || []), target.tertiary];
          addedAssignments += 1;
        }
        classification.source_refs = Array.from(new Set([
          ...(classification.source_refs || []),
          ...record.industries.map((item) => `同花顺细分行业：${item.name}（${item.code}）`)
        ]));
      }
      next.stocks.sort((a, b) => a.code.localeCompare(b.code));
      return next;
    });
    markDirty();
    notify(`已将 ${industryByStock.size} 只股票补入「${target.tertiary}」，新增 ${addedAssignments} 条归属`);
    return true;
  };

  const classifyDailyStock = ({ stock: dailyStock, primaryName, secondaryName, tertiaryName, classifications, reason }) => {
    const targets = Array.isArray(classifications)
      ? classifications.flatMap((item) => (item.tertiaryNames || []).map((name) => ({ secondaryName: item.secondaryName, tertiaryName: name, relevanceScore: Number(item.relevanceScore) })))
      : [{ secondaryName, tertiaryName }];
    if (!dailyStock || !primaryName || !targets.length || targets.some((item) => !item.secondaryName || !item.tertiaryName || !Number.isFinite(item.relevanceScore) || item.relevanceScore < 0 || item.relevanceScore > 1)) return false;
    if (targets.some((item) => !lookups.tertiary.has(`${primaryName}|${item.secondaryName}|${item.tertiaryName}`))) {
      notify("选择的分类不在当前目录中");
      return false;
    }
    const code = normalizeCode(dailyStock.code);
    if (!/^\d{6}$/.test(code)) {
      notify("股票代码不正确，无法归类");
      return false;
    }

    setStockMap((current) => {
      const next = structuredClone(current);
      let target = next.stocks.find((item) => item.code === code);
      if (!target) {
        target = {
          code,
          name: String(dailyStock.name || code).trim(),
          primary_sector: primaryName,
          classifications: [],
          product_tags: [],
          reason: ""
        };
        next.stocks.push(target);
      }
      target.name = target.name || String(dailyStock.name || "").trim();
      target.primary_sector = target.primary_sector || primaryName;
      target.reason = String(reason || "").trim() || target.reason || "当日涨停扫描归类";

      for (const { secondaryName: targetSecondary, tertiaryName: targetTertiary, relevanceScore } of targets) {
        let classification = target.classifications.find((item) =>
          classificationPrimarySector(target, item) === primaryName && item.secondary_sector === targetSecondary
        );
        if (!classification) {
          classification = { primary_sector: primaryName, secondary_sector: targetSecondary, tertiary_sectors: [] };
          target.classifications.push(classification);
        }
        classification.tertiary_sectors = Array.from(new Set([...(classification.tertiary_sectors || []), targetTertiary]));
        classification.relevance_score = relevanceScore;
      }
      next.stocks.sort((a, b) => a.code.localeCompare(b.code));
      return next;
    });
    markDirty();
    notify(`已添加 ${targets.length} 条归属：${code}${dailyStock.name ? ` ${dailyStock.name}` : ""}`);
    return true;
  };

  const importDirectoryReorganization = async (payload, scopePrimary = "") => {
    const primaryName = String(payload.primary_sector || payload.primarySector || "").trim();
    if (!primaryName || (scopePrimary && primaryName !== scopePrimary)) {
      notify("整理 JSON 的一级主线与当前页面不一致");
      return false;
    }
    const targetPrimary = taxonomy.sectors.find((sector) => sector.name === primaryName);
    if (!targetPrimary) {
      notify("找不到要整理的一级主线");
      return false;
    }
    const rawSecondaries = Array.isArray(payload.secondary_sectors) ? payload.secondary_sectors : [];
    const nextSecondaries = rawSecondaries.map((item) => {
      const name = String(item.name || item.secondary_sector || "").trim();
      const tertiaryDescriptions = {};
      const tertiarySectors = Array.from(new Set((item.tertiary_sectors || []).map((item) => {
        const detail = tertiaryDetail(item);
        if (detail.description) tertiaryDescriptions[detail.name] = detail.description;
        return detail.name;
      }).filter(Boolean)));
      return { name, tertiary_sectors: tertiarySectors, ...(Object.keys(tertiaryDescriptions).length ? { tertiary_descriptions: tertiaryDescriptions } : {}) };
    }).filter((item) => item.name && item.tertiary_sectors.length);
    if (!nextSecondaries.length || new Set(nextSecondaries.map((item) => item.name)).size !== nextSecondaries.length) {
      notify("整理 JSON 缺少有效且不重复的二级、三级目录");
      return false;
    }
    const validPaths = new Set(nextSecondaries.flatMap((item) => item.tertiary_sectors.map((tertiary) => `${item.name}|${tertiary}`)));
    const targetsByTertiary = new Map();
    for (const path of validPaths) {
      const [secondary, tertiary] = path.split("|");
      if (!targetsByTertiary.has(tertiary)) targetsByTertiary.set(tertiary, []);
      targetsByTertiary.get(tertiary).push({ secondary, tertiary });
    }
    const rules = new Map();
    for (const rule of payload.reclassification_rules || payload.migrations || []) {
      const from = rule.from || {};
      const to = rule.to || {};
      const fromSecondary = String(from.secondary_sector || from.secondary || rule.from_secondary_sector || "").trim();
      const fromTertiary = String(from.tertiary_sector || from.tertiary || rule.from_tertiary_sector || "").trim();
      const toSecondary = String(to.secondary_sector || to.secondary || rule.to_secondary_sector || "").trim();
      const toTertiary = String(to.tertiary_sector || to.tertiary || rule.to_tertiary_sector || "").trim();
      if (fromSecondary && fromTertiary && validPaths.has(`${toSecondary}|${toTertiary}`)) rules.set(`${fromSecondary}|${fromTertiary}`, { secondary: toSecondary, tertiary: toTertiary });
    }
    const translate = (secondaryName, tertiaryName) => {
      if (validPaths.has(`${secondaryName}|${tertiaryName}`)) return { secondary: secondaryName, tertiary: tertiaryName };
      const ruleTarget = rules.get(`${secondaryName}|${tertiaryName}`);
      if (ruleTarget) return ruleTarget;
      const sameNameTargets = targetsByTertiary.get(tertiaryName) || [];
      return sameNameTargets.length === 1 ? sameNameTargets[0] : null;
    };
    const missingPaths = new Set();
    const remapClassifications = (classifications, stock) => {
      const grouped = new Map();
      for (const classification of classifications || []) {
        if (classificationPrimarySector(stock, classification) !== primaryName) {
          const key = `${classificationPrimarySector(stock, classification)}|${classification.secondary_sector}`;
          if (!grouped.has(key)) grouped.set(key, { ...classification, primary_sector: classificationPrimarySector(stock, classification), tertiary_sectors: [...(classification.tertiary_sectors || [])] });
          continue;
        }
        for (const tertiary of classification.tertiary_sectors || []) {
          const target = translate(classification.secondary_sector, tertiary);
          if (!target) {
            missingPaths.add(`${classification.secondary_sector} / ${tertiary}`);
            continue;
          }
          const key = `${primaryName}|${target.secondary}`;
          if (!grouped.has(key)) grouped.set(key, { primary_sector: primaryName, secondary_sector: target.secondary, tertiary_sectors: [] });
          grouped.get(key).tertiary_sectors = Array.from(new Set([...grouped.get(key).tertiary_sectors, target.tertiary]));
        }
      }
      return Array.from(grouped.values());
    };
    const nextStockMap = structuredClone(stockMap);
    nextStockMap.stocks = nextStockMap.stocks.map((stock) => {
      const classifications = remapClassifications(stock.classifications, stock);
      return classifications.length ? { ...stock, primary_sector: classifications[0].primary_sector, classifications } : null;
    }).filter(Boolean);
    if (missingPaths.size) {
      notify(`整理规则未覆盖已使用路径：${Array.from(missingPaths).slice(0, 3).join("、")}${missingPaths.size > 3 ? " 等" : ""}`);
      return false;
    }
    let archivedThemePathCount = 0;
    const nextDailyThemes = structuredClone(dailyThemes).map((daily) => ({
      ...daily,
      themes: (daily.themes || []).flatMap((theme) => {
        if (theme.primary_sector !== primaryName) return [theme];
        const grouped = new Map();
        const unmappedPaths = [];
        for (const tertiary of theme.related_tertiary_sectors || []) {
          const target = translate(theme.secondary_sector, tertiary);
          if (!target) { unmappedPaths.push(`${theme.secondary_sector} / ${tertiary}`); continue; }
          if (!grouped.has(target.secondary)) grouped.set(target.secondary, []);
          grouped.get(target.secondary).push(target.tertiary);
        }
        const migratedThemes = Array.from(grouped.entries()).map(([secondary_sector, related_tertiary_sectors]) => ({ ...theme, secondary_sector, related_tertiary_sectors: Array.from(new Set(related_tertiary_sectors)), unmapped_paths: undefined }));
        if (unmappedPaths.length) {
          archivedThemePathCount += unmappedPaths.length;
          migratedThemes.push({ ...theme, secondary_sector: "", related_tertiary_sectors: [], unmapped_paths: unmappedPaths });
        }
        return migratedThemes;
      })
    }));
    const nextTaxonomy = structuredClone(taxonomy);
    nextTaxonomy.sectors = nextTaxonomy.sectors.map((sector) => sector.name === primaryName ? { ...sector, secondary_sectors: nextSecondaries } : sector);
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxonomy: nextTaxonomy, stockMap: sanitizeStockMap(nextStockMap), collections, dailyThemes: nextDailyThemes }) });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.validation?.errors?.[0] || saved.error || "目录整理保存失败");
      setValidation(saved.validation || { ok: true, errors: [], warnings: [] });
    } catch (error) {
      notify(error.message);
      return false;
    }
    setTaxonomy(nextTaxonomy);
    setStockMap(nextStockMap);
    setDailyThemes(nextDailyThemes);
    setSelectedSecondary(nextSecondaries[0]?.name || "");
    setSelectedTertiary("全部");
    notify(`已整理「${primaryName}」的二级、三级目录${archivedThemePathCount ? `；${archivedThemePathCount} 条历史题材路径已保留为未关联记录` : ""}`);
    return true;
  };

  const importGPTJson = async (text, scopePrimary = "") => {
    let payload;
    try {
      payload = parseJsonLoose(text);
    } catch (error) {
      notify(error.message || "JSON 瑙ｆ瀽澶辫触");
      return false;
    }
    if (payload.type === "taxonomy_reorganization") return importDirectoryReorganization(payload, scopePrimary);

    const sectorPayloads = Array.isArray(payload.sectors)
      ? payload.sectors
      : Array.isArray(payload.taxonomy?.sectors)
        ? payload.taxonomy.sectors
        : Array.isArray(payload.sector_taxonomy?.sectors)
          ? payload.sector_taxonomy.sectors
          : [];
    const restrictedPrimary = String(scopePrimary || "").trim();
    const fallbackPrimary = restrictedPrimary || String(payload.primary_sector || payload.primarySector || payload.name || primary?.name || "").trim();
    const rawSecondaryItems = Array.isArray(payload.secondary_sectors)
      ? payload.secondary_sectors
      : Array.isArray(payload.secondarySectors)
        ? payload.secondarySectors
        : Array.isArray(payload.secondary)
          ? payload.secondary
          : [];
    const sectorSecondaryItems = sectorPayloads.flatMap((sector) =>
      (sector.secondary_sectors || sector.secondarySectors || []).map((secondary) => ({
        ...secondary,
        primary_sector: secondary.primary_sector || secondary.primarySector || sector.name || sector.primary_sector || sector.primarySector
      }))
    );
    const rawStockItems = [
      ...(Array.isArray(payload.stocks) ? payload.stocks : []),
      ...(Array.isArray(payload.stock_sector_map?.stocks) ? payload.stock_sector_map.stocks : []),
      ...sectorPayloads.flatMap((sector) =>
        (sector.stocks || []).map((stock) => ({
          ...stock,
          primary_sector: stock.primary_sector || stock.primarySector || sector.name || sector.primary_sector || sector.primarySector
        }))
      )
    ];
    const dynamicThemes = (Array.isArray(payload.dynamic_themes)
      ? payload.dynamic_themes
      : Array.isArray(payload.themes)
        ? payload.themes
        : []).filter((theme) => !restrictedPrimary || theme.primary_sector === restrictedPrimary);
    const allSecondaryItems = [...rawSecondaryItems, ...sectorSecondaryItems];
    // 新格式允许一只股票跨多个一级、二级及三级目录。一级归属以每条
    // classification.primary_sector 为准；为兼容更简写的回答，也接受 primary_sectors。
    const classificationEntries = (item) => {
      const itemPrimary = String(item.primary_sector || item.primarySector || fallbackPrimary || "").trim();
      const itemPrimaries = Array.isArray(item.primary_sectors || item.primarySectors)
        ? (item.primary_sectors || item.primarySectors).map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      return (item.classifications || []).flatMap((classification) => {
        const classificationPrimary = String(classification.primary_sector || classification.primarySector || itemPrimary || "").trim();
        const primaries = classificationPrimary ? [classificationPrimary] : itemPrimaries;
        return primaries
          .filter((primaryName) => !restrictedPrimary || primaryName === restrictedPrimary)
          .map((primaryName) => ({ primaryName, classification }));
      });
    };

    if (!allSecondaryItems.length && !rawStockItems.length && !dynamicThemes.length) {
      notify("JSON 中没有二级分类、股票数据或动态题材");
      return false;
    }

    const taxonomyPlan = new Map();
    const tertiaryDescriptionPlan = new Map();
    const ensurePlan = (primaryName, secondaryName) => {
      const cleanPrimary = String(primaryName || fallbackPrimary || "").trim();
      const cleanSecondary = String(secondaryName || "").trim();
      if (!cleanPrimary || !cleanSecondary) return null;
      if (!taxonomyPlan.has(cleanPrimary)) taxonomyPlan.set(cleanPrimary, new Map());
      const secondaries = taxonomyPlan.get(cleanPrimary);
      if (!secondaries.has(cleanSecondary)) secondaries.set(cleanSecondary, new Set());
      return secondaries.get(cleanSecondary);
    };

    for (const secondary of allSecondaryItems) {
      const secondaryName = secondary.name || secondary.secondary_sector || secondary.secondarySector;
      const primaryName = String(secondary.primary_sector || secondary.primarySector || fallbackPrimary || "").trim();
      if (restrictedPrimary && primaryName !== restrictedPrimary) continue;
      const tertiarySet = ensurePlan(primaryName, secondaryName);
      if (!tertiarySet) continue;
      for (const tertiary of secondary.tertiary_sectors || secondary.tertiarySectors || secondary.tertiaries || []) {
        const { name: tertiaryName, description } = tertiaryDetail(tertiary);
        if (tertiaryName) {
          tertiarySet.add(tertiaryName);
          if (description) tertiaryDescriptionPlan.set(`${primaryName}|${secondaryName}|${tertiaryName}`, description);
        }
      }
    }

    for (const stock of rawStockItems) {
      for (const { primaryName, classification } of classificationEntries(stock)) {
        const tertiarySet = ensurePlan(primaryName, classification.secondary_sector || classification.secondarySector || classification.name);
        if (!tertiarySet) continue;
        for (const tertiary of classification.tertiary_sectors || classification.tertiarySectors || []) {
          const tertiaryName = String(tertiary || "").trim();
          if (tertiaryName) tertiarySet.add(tertiaryName);
        }
      }
    }

    for (const theme of dynamicThemes) {
      if (restrictedPrimary && theme.primary_sector !== restrictedPrimary) continue;
      const tertiarySet = ensurePlan(theme.primary_sector, theme.secondary_sector);
      if (!tertiarySet) continue;
      for (const tertiary of theme.related_tertiary_sectors || []) {
        const tertiaryName = String(tertiary || "").trim();
        if (tertiaryName) tertiarySet.add(tertiaryName);
      }
    }

    if (!taxonomyPlan.size && rawStockItems.length) {
      notify("JSON 缂哄皯鍙敤鐨?primary_sector / secondary_sector / tertiary_sectors");
      return false;
    }

    // 同一一级主线内，三级标题只能归属一个二级目录。若 GPT 给出了一个
    // 已存在于其他二级下的三级标题，自动复用既有路径，而不是拒绝整份导入。
    const existingTertiaryOwners = new Map();
    for (const sector of taxonomy.sectors || []) {
      for (const secondary of sector.secondary_sectors || []) {
        for (const tertiary of secondary.tertiary_sectors || []) {
          existingTertiaryOwners.set(`${sector.name}|${tertiary}`, secondary.name);
        }
      }
    }
    const remappedTertiaries = [];
    const normalizedPlan = new Map();
    for (const [primaryName, secondaries] of taxonomyPlan.entries()) {
      for (const [secondaryName, tertiarySet] of secondaries.entries()) {
        for (const tertiaryName of tertiarySet) {
          const existingSecondary = existingTertiaryOwners.get(`${primaryName}|${tertiaryName}`);
          const resolvedSecondary = existingSecondary || secondaryName;
          if (!normalizedPlan.has(primaryName)) normalizedPlan.set(primaryName, new Map());
          const normalizedSecondaries = normalizedPlan.get(primaryName);
          if (!normalizedSecondaries.has(resolvedSecondary)) normalizedSecondaries.set(resolvedSecondary, new Set());
          normalizedSecondaries.get(resolvedSecondary).add(tertiaryName);
          if (existingSecondary && existingSecondary !== secondaryName) {
            remappedTertiaries.push({ primaryName, tertiaryName, from: secondaryName, to: existingSecondary });
            const description = tertiaryDescriptionPlan.get(`${primaryName}|${secondaryName}|${tertiaryName}`);
            if (description) tertiaryDescriptionPlan.set(`${primaryName}|${existingSecondary}|${tertiaryName}`, description);
          }
        }
      }
    }
    taxonomyPlan.clear();
    for (const [primaryName, secondaries] of normalizedPlan.entries()) taxonomyPlan.set(primaryName, secondaries);
    const resolveSecondary = (primaryName, secondaryName, tertiaryName) =>
      existingTertiaryOwners.get(`${primaryName}|${tertiaryName}`) || secondaryName;

    const nextTaxonomy = structuredClone(taxonomy);
    for (const [primaryName, secondaries] of taxonomyPlan.entries()) {
      let targetPrimary = nextTaxonomy.sectors.find((sector) => sector.name === primaryName);
      if (!targetPrimary) {
        targetPrimary = { name: primaryName, secondary_sectors: [] };
        nextTaxonomy.sectors.push(targetPrimary);
      }

      for (const [secondaryName, tertiarySet] of secondaries.entries()) {
        let targetSecondary = targetPrimary.secondary_sectors.find((item) => item.name === secondaryName);
        if (!targetSecondary) {
          targetSecondary = { name: secondaryName, tertiary_sectors: [] };
          targetPrimary.secondary_sectors.push(targetSecondary);
        }
        targetSecondary.tertiary_sectors = Array.from(new Set([
          ...(targetSecondary.tertiary_sectors || []),
          ...Array.from(tertiarySet)
        ]));
        const descriptions = { ...(targetSecondary.tertiary_descriptions || {}) };
        for (const tertiaryName of targetSecondary.tertiary_sectors) {
          const description = tertiaryDescriptionPlan.get(`${primaryName}|${secondaryName}|${tertiaryName}`);
          if (description) descriptions[tertiaryName] = description;
        }
        if (Object.keys(descriptions).length) targetSecondary.tertiary_descriptions = descriptions;
      }
    }

    const nextStockMap = structuredClone(stockMap);
    for (const item of rawStockItems) {
        const code = normalizeCode(item.code);
        const name = String(item.name || "").trim();
        const entries = classificationEntries(item);
        if (restrictedPrimary && !entries.length) continue;
        const stockPrimary = entries[0]?.primaryName || String(item.primary_sector || item.primarySector || fallbackPrimary || "").trim();
        if (!/^\d{6}$/.test(code) || !name || !stockPrimary) continue;

        let target = nextStockMap.stocks.find((stock) => stock.code === code);
        if (!target) {
          target = {
            code,
            name,
            primary_sector: stockPrimary,
            classifications: [],
            product_tags: [],
            reason: ""
          };
          nextStockMap.stocks.push(target);
        }

        target.name = target.name || name;
        target.primary_sector = target.primary_sector || stockPrimary;
        target.product_tags = Array.from(new Set([
          ...(target.product_tags || []),
          ...(item.product_tags || []).map((tag) => String(tag || "").trim()).filter(Boolean)
        ]));
        target.reason = String(item.reason || "").trim() || target.reason;

        for (const { primaryName, classification } of entries) {
          const secondaryName = String(classification.secondary_sector || classification.secondarySector || classification.name || "").trim();
          if (!secondaryName) continue;
          const tertiaryGroups = new Map();
          for (const tertiary of classification.tertiary_sectors || classification.tertiarySectors || []) {
            const tertiaryName = String(tertiary || "").trim();
            if (!tertiaryName) continue;
            const resolvedSecondary = resolveSecondary(primaryName, secondaryName, tertiaryName);
            if (!tertiaryGroups.has(resolvedSecondary)) tertiaryGroups.set(resolvedSecondary, []);
            tertiaryGroups.get(resolvedSecondary).push(tertiaryName);
          }
          for (const [resolvedSecondary, tertiaryNames] of tertiaryGroups.entries()) {
            let targetClassification = target.classifications.find((entry) =>
              classificationPrimarySector(target, entry) === primaryName && entry.secondary_sector === resolvedSecondary
            );
            if (!targetClassification) {
              targetClassification = { primary_sector: primaryName, secondary_sector: resolvedSecondary, tertiary_sectors: [] };
              target.classifications.push(targetClassification);
            }
            targetClassification.tertiary_sectors = Array.from(new Set([
              ...(targetClassification.tertiary_sectors || []),
              ...tertiaryNames
            ]));
            if (Number.isFinite(Number(classification.relevance_score))) {
              targetClassification.relevance_score = Math.max(0, Math.min(1, Number(classification.relevance_score)));
            }
            targetClassification.source_refs = Array.from(new Set([
              ...(targetClassification.source_refs || []),
              ...(classification.source_refs || []).map(String).filter(Boolean)
            ]));
          }
        }
    }
    // 同一股票的同一“一级/二级”归属可能来自历史拆分记录，或 GPT 的
    // 完整核验结果。保存前归并为一条，保证三级路径在该股票内唯一。
    for (const stock of nextStockMap.stocks) {
      const grouped = new Map();
      for (const classification of stock.classifications || []) {
        const primaryName = classificationPrimarySector(stock, classification);
        const groupKey = `${primaryName}|${classification.secondary_sector}`;
        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            ...classification,
            primary_sector: primaryName,
            tertiary_sectors: [],
            source_refs: []
          });
        }
        const targetClassification = grouped.get(groupKey);
        targetClassification.tertiary_sectors = Array.from(new Set([
          ...targetClassification.tertiary_sectors,
          ...(classification.tertiary_sectors || [])
        ]));
        targetClassification.source_refs = Array.from(new Set([
          ...targetClassification.source_refs,
          ...(classification.source_refs || []).map(String).filter(Boolean)
        ]));
        if (Number(classification.relevance_score) > Number(targetClassification.relevance_score)) {
          targetClassification.relevance_score = Number(classification.relevance_score);
        }
      }
      stock.classifications = Array.from(grouped.values());
    }
    nextStockMap.stocks.sort((a, b) => a.code.localeCompare(b.code));

    let nextDailyThemes = dailyThemes;
    const normalizedDynamicThemes = dynamicThemes.flatMap((theme) => {
      const secondaryName = String(theme.secondary_sector || "").trim();
      const grouped = new Map();
      for (const tertiary of theme.related_tertiary_sectors || []) {
        const tertiaryName = String(tertiary || "").trim();
        if (!tertiaryName) continue;
        const resolvedSecondary = resolveSecondary(theme.primary_sector, secondaryName, tertiaryName);
        if (!grouped.has(resolvedSecondary)) grouped.set(resolvedSecondary, []);
        grouped.get(resolvedSecondary).push(tertiaryName);
      }
      if (!grouped.size) return [theme];
      return Array.from(grouped.entries()).map(([resolvedSecondary, tertiaryNames]) => ({
        ...theme,
        secondary_sector: resolvedSecondary,
        related_tertiary_sectors: Array.from(new Set(tertiaryNames))
      }));
    });
    if (normalizedDynamicThemes.length) {
      const themeDate = String(payload.date || new Date().toISOString().slice(0, 10));
      nextDailyThemes = structuredClone(dailyThemes);
        let daily = nextDailyThemes.find((item) => item.date === themeDate);
        if (!daily) {
          daily = { date: themeDate, themes: [] };
          nextDailyThemes.push(daily);
        }
        daily.themes = [...(daily.themes || []), ...normalizedDynamicThemes];
    }

    const importedPrimaryNames = Array.from(taxonomyPlan.keys());
    // 已存在的一级主线有明确的书页归属，导入每日涨停结果不能把它们重复挂到当前书页；
    // 仅把本次真正新建的一级主线归入当前书页。
    const newPrimaryNames = importedPrimaryNames.filter((name) => !taxonomy.sectors.some((sector) => sector.name === name));
    const firstClassification = classificationEntries(rawStockItems[0] || {})[0];
    const firstPrimary = restrictedPrimary || firstClassification?.primaryName || rawStockItems[0]?.primary_sector || allSecondaryItems[0]?.primary_sector || fallbackPrimary || importedPrimaryNames[0] || "";
    const firstSecondary = firstClassification?.classification?.secondary_sector || rawStockItems[0]?.classifications?.[0]?.secondary_sector || allSecondaryItems[0]?.name || allSecondaryItems[0]?.secondary_sector || "";
    const nextCollections = selectedCollection && newPrimaryNames.length ? {
      ...collections,
      collections: collections.collections.map((item) => item.name !== selectedCollection ? item : {
        ...item,
        primary_sectors: Array.from(new Set([...(item.primary_sectors || []), ...newPrimaryNames]))
      })
    } : collections;

    let savedPayload;
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxonomy: nextTaxonomy, stockMap: sanitizeStockMap(nextStockMap), collections: nextCollections, dailyThemes: nextDailyThemes })
      });
      savedPayload = await response.json();
      if (!response.ok) {
        const detail = savedPayload.validation?.errors?.[0];
        throw new Error(detail ? `${savedPayload.error || "数据校验失败"}：${detail}` : (savedPayload.error || "保存产业分类 JSON 失败"));
      }
      setValidation(savedPayload.validation || { ok: true, errors: [], warnings: [] });
    } catch (error) {
      notify(error.message);
      return false;
    }

    setTaxonomy(savedPayload?.taxonomy || nextTaxonomy);
    setStockMap(nextStockMap);
    setCollections(nextCollections);
    setDailyThemes(savedPayload?.dailyThemes || nextDailyThemes);

    const selectedBook = nextCollections.collections.find((item) => item.name === selectedCollection);
    const navigablePrimary = selectedBook?.primary_sectors?.includes(firstPrimary)
      ? firstPrimary
      : selectedBook?.primary_sectors?.find((name) => nextTaxonomy.sectors.some((sector) => sector.name === name)) || firstPrimary;
    const navigableSector = nextTaxonomy.sectors.find((sector) => sector.name === navigablePrimary);
    setSelectedPrimary(navigablePrimary);
    setSelectedSecondary(navigablePrimary === firstPrimary ? firstSecondary : navigableSector?.secondary_sectors?.[0]?.name || "");
    setSelectedTertiary("全部");
    setOpenPrimaryNames((items) => navigablePrimary && !items.includes(navigablePrimary) ? [...items, navigablePrimary] : items);
    notify(`已导入并保存 GPT JSON：${taxonomyPlan.size} 个一级，${rawStockItems.length} 只股票，${dynamicThemes.length} 个动态题材${remappedTertiaries.length ? `；已自动复用 ${remappedTertiaries.length} 个既有三级路径` : ""}`);
    return true;
  };

  const copyMarketResearchPrompt = async () => {
    if (!currentMarketResearchBatch.length) {
      notify(marketResearchUniverse.length ? "全市场股票已全部完成 GPT 核验" : "请先读取当日涨幅或等待全市场股票池加载完成");
      return;
    }
    if (!activeMarketResearchBatch.length) setPendingMarketResearchBatch(currentMarketResearchBatch);
    const batchId = marketResearchBatchId(currentMarketResearchBatch);
    const taskDescription = {
      classify_and_score: "当前没有长期产业分类：必须给出应归属的一级、二级、三级路径，并逐条给出二级主线关联度。",
      score_only: "已有分类，但关联度缺失或待复核：保留/必要时修正分类，并逐条给出关联度。",
      confirm: "已有分类和关联度：请逐条核验；除确认或修正现有归属外，还必须检查整个现有目录，补充所有业务相关的其他二级主线归属、关联度及依据。",
    };
    const prompt = [
      "你是 A 股产业链分类研究员。请核验下方 100 只全市场股票。关联度是股票对每条二级主线的业务关联度，不是行情热度。",
      "关联度标准：1.00=主营/核心业务；0.80=直接业务或核心产品；0.60=明确产业链或产品关联；0.40=布局/间接关联；0.20=弱概念关联。一个股票属于多个二级主线时，必须逐条独立判断。",
      "对 task=classify_and_score：补全分类和关联度；对 task=score_only：补全或校准关联度；对 task=confirm：先确认或修正已有信息，再逐一比对现有目录中的其他二级主线，补充应新增的归属。返回的 classifications 必须是该股票全部确认归属的完整集合，包含保留、修正和新增项；不能只返回原有归属或仅返回新增项。每只股票都必须返回，不能省略。",
      "只能使用下方现有目录；确实无法归入时，将 classifications 返回为空数组，并在 reason 说明原因，不得编造目录。",
      `batch_id: ${batchId}`,
      `任务说明：${JSON.stringify(taskDescription)}`,
      `现有产业目录：${JSON.stringify(taxonomy.sectors || [])}`,
      `待核验股票：${JSON.stringify(currentMarketResearchBatch, null, 2)}`,
      "只返回严格 JSON，不要 Markdown 或解释文字。返回格式：",
      JSON.stringify({
        type: "market_stock_research",
        batch_id: batchId,
        stocks: [{
          code: "000000",
          name: "股票名称",
          classifications: [{ primary_sector: "一级主线", secondary_sector: "二级主线", tertiary_sectors: ["三级方向"], relevance_score: 0.8, source_refs: ["年报主营业务/公司公告"] }],
          reason: "分类与关联度依据"
        }]
      }, null, 2),
    ].join("\n\n");
    await navigator.clipboard.writeText(prompt);
    notify(`已复制并锁定全市场核验第 ${Math.floor(marketResearchCompletedCount / 100) + 1} 批（${currentMarketResearchBatch.length} 只）；成功导入前不会切换下一批`);
  };

  const importMarketResearchJson = async (text, expectedBatch) => {
    let payload;
    try {
      payload = parseJsonLoose(text);
    } catch (error) {
      notify(error.message || "JSON 解析失败");
      return false;
    }
    const expectedCodes = (expectedBatch || []).map((stock) => stock.code).sort();
    const expectedBatchId = marketResearchBatchId(expectedBatch);
    const returnedCodes = Array.from(new Set((payload?.stocks || []).map((stock) => normalizeCode(stock.code)).filter((code) => /^\d{6}$/.test(code)))).sort();
    const validType = payload?.type === undefined || payload?.type === "market_stock_research";
    if (!validType || payload?.batch_id !== expectedBatchId || !expectedCodes.length || returnedCodes.length !== expectedCodes.length || returnedCodes.some((code, index) => code !== expectedCodes[index])) {
      notify("返回 JSON 必须包含本批全部且仅包含本批的 100 只股票；本批不会被标记完成");
      return false;
    }
    const saved = await importGPTJson(JSON.stringify(payload), "");
    if (!saved) return false;
    try {
      const response = await fetch("/api/market-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: expectedCodes, batch_id: payload.batch_id || "" }),
      });
      const progress = await response.json();
      if (!response.ok) throw new Error(progress.error || "保存全市场核验进度失败");
      setMarketResearchProgress(progress);
      setPendingMarketResearchBatch([]);
      notify(`已导入并完成本批 ${expectedCodes.length} 只股票；后续批次不会再出现它们`);
      return true;
    } catch (error) {
      notify(`分类已保存，但核验进度未保存：${error.message}`);
      return false;
    }
  };

  const removeStock = (code) => {
    if (!confirm("从长期产业归属中删除 " + code + "？")) return;
    setStockMap((current) => ({ ...current, stocks: current.stocks.filter((stock) => stock.code !== code) }));
    markDirty();
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ taxonomy, stockMap, dailyThemes }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `产业分类数据-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyTaxonomyPrompt = async () => {
    const primaryName = primary?.name || "请填写一级主线";
    const prompt = [
      `请你作为A股产业链分类研究员，围绕一级主线「${primaryName}」建立二级产业环节、三级产品方向和代表股票清单。`,
      "分类规则：",
      "1. 必须按 A 股市场的产业链、板块联动和可形成独立行情的题材来划分；不要按科研教材、学科门类或纯技术分类来拆分目录。",
      "2. 二级必须是产业环节，不要写短期题材。",
      "3. 三级必须是可形成独立行情的产品方向，不要写涨价、订单、政策、客户关系等动态事件。",
      "4. 每个三级方向必须返回 description，简洁解释该目录覆盖的产品范围和产业环节；更细的公司业务写入 product_tags，不要自动创建为三级分类。",
      "5. 优先复用下方“当前已有目录”中的二级、三级标题。名称相同或仅是产品规格、应用场景、客户、终端不同的方向必须归入既有标题，不得拆出近义新目录；例如已有“存储芯片”时，不要另建“消费存储芯片”“车规存储芯片”等三级，细分信息写入 product_tags。只有产业环节确实不同、且现有标题无法覆盖时才可新增。",
      "6. 股票代码必须为6位数字。",
      `7. 本次仅研究「${primaryName}」：不得新增、返回或归入任何其他一级主线。股票可同时属于本一级下多个二级和三级目录，但每条 classifications 的 primary_sector 必须固定为「${primaryName}」。`,
       "8. 每一条 classifications 必须同时给出 relevance_score（0 至 1，表示该股票对该二级主线的业务关联度，而非市场热度）：1.00=主营/核心业务，0.80=直接业务或核心产品，0.60=明确产业链或产品关联，0.40=布局/间接关联，0.20=弱概念关联。股票属于多个二级主线时，必须逐条独立判断，不能复用同一分数。",
       `当前已有目录（优先原样复用）：\n${JSON.stringify(primary?.secondary_sectors || [], null, 2)}`,
      "请只返回严格 JSON，不要 Markdown，不要解释文字。格式如下：",
      JSON.stringify({
        primary_sector: primaryName,
        secondary_sectors: [{ name: "二级产业环节名称", tertiary_sectors: [{ name: "三级产品方向A", description: "该方向覆盖的产品范围与产业环节" }] }],
        stocks: [{
          code: "000000",
          name: "股票名称",
          primary_sector: primaryName,
          classifications: [{ primary_sector: primaryName, secondary_sector: "二级产业环节名称", tertiary_sectors: ["三级产品方向A"], relevance_score: 0.8, source_refs: ["年报主营业务/公司公告"] }],
          product_tags: ["更细产品或业务标签"],
          reason: "长期产业归属依据，只写主营业务和产品"
        }]
      }, null, 2)
    ].join("\n");

    await navigator.clipboard.writeText(prompt);
    notify(`已复制「${primaryName}」分类 JSON 提问`);
  };

  const copyReorganizationPrompt = async () => {
    if (!primary) return;
    const directory = primary.secondary_sectors.map((secondaryItem) => ({
      name: secondaryItem.name,
      tertiary_sectors: (secondaryItem.tertiary_sectors || []).map((name) => ({ name, description: secondaryItem.tertiary_descriptions?.[name] || "" }))
    }));
    const usedPaths = Array.from(new Set(indexList(indexes.primarySectorIndex, primary.name).flatMap((stock) =>
      (stock.classifications || [])
        .filter((classification) => classificationPrimarySector(stock, classification) === primary.name)
        .flatMap((classification) => (classification.tertiary_sectors || []).map((tertiary) => `${classification.secondary_sector} / ${tertiary}`))
    )));
    const dynamicPaths = Array.from(new Set(dailyThemes.flatMap((daily) => (daily.themes || [])
      .filter((theme) => theme.primary_sector === primary.name)
      .flatMap((theme) => (theme.related_tertiary_sectors || []).map((tertiary) => `${theme.secondary_sector} / ${tertiary}`))
    )));
    const prompt = [
      `请作为产业链分类编辑，整理一级主线「${primary.name}」下过多、重叠或边界不清的二级和三级目录。目标是减少重复、合并同义或高度重叠的方向，但保留有明确产业差异的环节。`,
      "目录必须按 A 股市场的产业链结构、板块联动和可形成独立行情的题材来组织；不要套用科研教材、学科门类或纯技术分类体系。",
      "只处理本一级主线，禁止新增或返回其他一级主线。请输出最终精简目录，并为每一条会被删除或改名的、且已被股票使用的旧三级路径提供迁移规则。未变化的路径无需写迁移规则。",
      "迁移规则必须覆盖下方“已使用路径”中所有不再出现在最终目录的路径；target 必须是最终目录中存在的二级和三级路径。",
      "只返回严格 JSON，不要 Markdown、解释或引用。格式如下：",
      JSON.stringify({
        type: "taxonomy_reorganization",
        primary_sector: primary.name,
        secondary_sectors: [{ name: "最终二级名称", tertiary_sectors: [{ name: "最终三级名称", description: "该方向覆盖的产品范围与产业环节" }] }],
        reclassification_rules: [{ from: { secondary_sector: "旧二级名称", tertiary_sector: "旧三级名称" }, to: { secondary_sector: "最终二级名称", tertiary_sector: "最终三级名称" } }]
      }, null, 2),
      `当前目录：\n${JSON.stringify(directory, null, 2)}`,
      `股票已使用路径：\n${JSON.stringify(usedPaths, null, 2)}`,
      `历史动态题材路径（也请尽量提供迁移规则）：\n${JSON.stringify(dynamicPaths, null, 2)}`
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    notify(`已复制「${primary.name}」目录整理 JSON 询问`);
  };

  const copySecondaryPrompt = async () => {
    if (!primary) return;
    const existingDirectory = primary.secondary_sectors.map((item) => ({
      name: item.name,
      tertiary_sectors: (item.tertiary_sectors || []).map((name) => ({ name, description: item.tertiary_descriptions?.[name] || "" }))
    }));
    const prompt = [
      `请为一级主线「${primary.name}」补全代表 A 股股票。以下二级、三级目录已由我预先设定：必须原样保留这些名称，并为每个三级方向补充应归属的股票；如确有缺漏，可追加新的目录，但不要更名或删除既有目录。`,
      `股票代码必须为 6 位数字。本次仅补全「${primary.name}」，不得返回其他一级主线；同一股票可归入本一级下多个二级和三级目录，每条 classifications 的 primary_sector 都必须是「${primary.name}」。请只返回严格 JSON：`,
      JSON.stringify({
        primary_sector: primary.name,
        secondary_sectors: existingDirectory,
        stocks: [{ code: "000000", name: "股票名称", primary_sector: primary.name, classifications: [{ primary_sector: primary.name, secondary_sector: "已有二级名称", tertiary_sectors: ["已有三级名称"] }], product_tags: ["产品标签"], reason: "长期产业归属依据" }]
      }, null, 2)
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    notify(`已复制「${primary.name}」目录与股票 GPT 询问`);
  };

  const copyTertiaryPrompt = async () => {
    if (!primary || !secondary) return;
    const existingTertiaries = (secondary.tertiary_sectors || []).map((name) => ({ name, description: secondary.tertiary_descriptions?.[name] || "" }));
    const prompt = [
      `请为「${primary.name}」一级主线下的二级主线「${secondary.name}」补全代表 A 股股票。以下三级标题已由我预先设定：必须原样保留，并将股票归入这些三级标题；如确有缺漏，可追加新的三级，但不要更名或删除既有三级。`,
      "如需新增三级，必须按 A 股市场的产业链、板块联动和可形成独立行情的题材来命名；不要依据科研教材、学科门类或纯技术分类创建目录。",
      `股票代码必须为 6 位数字。本次仅补全「${primary.name} / ${secondary.name}」，不得返回其他一级或二级目录；同一股票可归入该二级下多个三级方向，每条 classifications 的 primary_sector 都必须是「${primary.name}」。请只返回严格 JSON：`,
      JSON.stringify({
        primary_sector: primary.name,
        secondary_sectors: [{ name: secondary.name, tertiary_sectors: existingTertiaries }],
        stocks: [{ code: "000000", name: "股票名称", primary_sector: primary.name, classifications: [{ primary_sector: primary.name, secondary_sector: secondary.name, tertiary_sectors: ["已有三级名称"] }], product_tags: ["产品标签"], reason: "长期产业归属依据" }]
      }, null, 2)
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    notify(`已复制「${secondary.name}」三级目录 GPT 询问`);
  };

  const copyStockPrompt = async () => {
    if (!primary || !secondary || selectedTertiary === "全部") return;
    const prompt = [
      `请列出「${primary.name} / ${secondary.name} / ${selectedTertiary}」应包含的代表 A 股股票及长期归属依据。本次仅返回该三级方向的归属，不得新增或返回其他一级、二级、三级目录。请只返回严格 JSON：`,
      "判断归属时以 A 股市场的产业链和板块行情逻辑为准，不要使用科研教材或学科门类式的分类标准。",
      JSON.stringify({
        primary_sector: primary.name,
        stocks: [{ code: "000000", name: "股票名称", primary_sector: primary.name, classifications: [{ primary_sector: primary.name, secondary_sector: secondary.name, tertiary_sectors: [selectedTertiary] }], product_tags: ["产品标签"], reason: "长期产业归属依据" }]
      }, null, 2)
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    notify(`已复制「${selectedTertiary}」股票 GPT 询问`);
  };

  const loadMainlineHistory = async (date) => {
    const requestedDates = previousWeekdays(date, 2);
    if (!requestedDates.length) return;
    setMainlineHistoryLoading(true);
    try {
      const results = await Promise.all(requestedDates.map(async (requestedDate) => {
        try {
          const response = await fetch(`/api/daily-market?date=${encodeURIComponent(requestedDate)}&localOnly=1`, { cache: "no-store" });
          const payload = await response.json();
          if (!response.ok) return { date: requestedDate, quotes: null };
          return {
            date: payload.date,
            quotes: Object.fromEntries((payload.stocks || []).map((stock) => [stock.code, { changePct: stock.changePct }]))
          };
        } catch {
          return { date: requestedDate, quotes: null };
        }
      }));
      const snapshots = Array.from(new Map(results.map((item) => [item.date, item])).values()).sort((a, b) => b.date.localeCompare(a.date));
      setMainlineHistory(snapshots);
    } catch {
      // 当日扫描仍可正常使用；历史行情不可用时仅不显示趋势区。
      setMainlineHistory([]);
    } finally {
      setMainlineHistoryLoading(false);
    }
  };

  const loadSystemMainline = async (date, cycleStartDate = "", snapshotId = "", requestId = null) => {
    setSystemMainlineLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (cycleStartDate) params.set("cycle_start_date", cycleStartDate);
      if (snapshotId) params.set("snapshot_id", snapshotId);
      // Phase 1 returns the ranking without waiting for hundreds of core-module
      // calculations. Phase 2 starts immediately after the ranking is visible.
      params.set("include_core_modules", "0");
      const response = await fetch(`/api/mainline?${params}`, { cache: "no-store" });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch { throw new Error(`主线接口未返回 JSON（HTTP ${response.status}），请点击“读取当日涨幅”重试`); }
      if (!response.ok) throw new Error(payload.error || "主线识别失败");
      if (requestId && dailyScanRequestRef.current !== requestId) return null;
      setSystemMainline(payload);
      const automatic = payload.automatic_modules || {};
      if (automatic.capacity) setCapacityCoreResults((current) => ({ ...current, ...automatic.capacity }));
      if (automatic.leader) setLeaderResults((current) => ({ ...current, ...automatic.leader }));
      const automaticParams = new URLSearchParams(params);
      automaticParams.set("include_core_modules", "1");
      void fetch(`/api/mainline?${automaticParams}`, { cache: "no-store" })
        .then(async (automaticResponse) => {
          const automaticPayload = await automaticResponse.json();
          if (!automaticResponse.ok) throw new Error(automaticPayload.error || "核心模块自动分析失败");
          if (requestId && dailyScanRequestRef.current !== requestId) return;
          const modules = automaticPayload.automatic_modules || {};
          if (modules.capacity) setCapacityCoreResults((current) => ({ ...current, ...modules.capacity }));
          if (modules.leader) setLeaderResults((current) => ({ ...current, ...modules.leader }));
          if (modules.failures?.length) notify(`核心模块自动分析完成，但有 ${modules.failures.length} 个方向数据不足，可稍后重新读取。`);
        })
        .catch((error) => {
          if (!requestId || dailyScanRequestRef.current === requestId) notify(error.message);
        });
      return payload;
    } catch (error) {
      setSystemMainline({ error: error.message });
    } finally {
      setSystemMainlineLoading(false);
    }
  };

  const clearAnalysisCache = async () => {
    if (!window.confirm("将清除已保存的分析缓存。下次查询会重新计算，是否继续？")) return;
    setAnalysisCacheClearing(true);
    try {
      const response = await fetch("/api/analysis-cache", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "清除缓存失败");
      setSystemMainline(null);
      setMainlineReplayScores(null);
      setCapacityCoreResults({});
      setLeaderResults({});
      notify(`已清除 ${payload.removed_response_cache_files || 0} 份分析缓存；下次查询将重新计算。`);
    } catch (error) {
      notify(error.message);
    } finally {
      setAnalysisCacheClearing(false);
    }
  };

  const loadMainlineReplayScores = async (startDate, endDate, finalPayload, onProgress) => {
    if (!startDate || !endDate || startDate > endDate) return;
    const dates = [];
    const cursor = new Date(`${startDate}T12:00:00Z`), end = new Date(`${endDate}T12:00:00Z`);
    while (cursor <= end) {
      if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const reusable = mainlineReplayScores?.start_date === startDate
      && mainlineReplayScores?.end_date < endDate;
    const themeTotals = { ...(reusable ? mainlineReplayScores.theme_totals : {}) };
    const primaryTotals = { ...(reusable ? mainlineReplayScores.primary_totals : {}) };
    const primaryDaily = Object.fromEntries(Object.entries(reusable ? mainlineReplayScores.primary_daily || {} : {})
      .map(([primary, rows]) => [primary, [...rows]]));
    const themeScoringDays = { ...(reusable ? mainlineReplayScores.theme_scoring_days : {}) };
    const primaryScoringDays = { ...(reusable ? mainlineReplayScores.primary_scoring_days : {}) };
    const themeActivationDates = { ...(reusable ? mainlineReplayScores.theme_activation_dates : {}) };
    let replayedDays = reusable ? Number(mainlineReplayScores.trading_days) || 0 : 0;
    let lastPayload = null;
    const publishDailyPayload = (payload) => {
      if (!payload) return;
      setSystemMainline(payload);
      const automatic = payload.automatic_modules || {};
      if (automatic.capacity) setCapacityCoreResults((current) => ({ ...current, ...automatic.capacity }));
      if (automatic.leader) setLeaderResults((current) => ({ ...current, ...automatic.leader }));
    };
    const aggregatePayload = (payload) => {
      if (!payload) return;
      replayedDays += 1;
      lastPayload = payload;
      const scoreableThemes = [];
      for (const theme of payload.themes || []) {
        const key = theme.key || `${theme.primary}__${theme.name}`;
        const cycle = theme.cycle_stage || {};
        const stage = cycle.confirmed_stage || cycle.cycle_stage || "unstarted";
        // A theme earns interval points only after its own confirmed launch.
        // Earlier observations remain available in the cycle calendar, but are
        // intentionally excluded from both theme and primary scoring.
        const activationDate = themeActivationDates[key]
          || cycle.episode_start_date
          || cycle.first_emergence_date
          || (stage !== "unstarted" ? payload.date : null);
        if (!activationDate || payload.date < activationDate) continue;
        themeActivationDates[key] = activationDate;
        scoreableThemes.push(theme);
      }
      const byPrimary = new Map();
      for (const theme of scoreableThemes) {
        const bucket = byPrimary.get(theme.primary) || [];
        bucket.push(theme);
        byPrimary.set(theme.primary, bucket);
      }
      for (const [primary, themes] of byPrimary.entries()) {
        const leaders = themes
          .map((theme) => ({ theme, returnPct: Number(theme.divergence_analysis?.daily_median_returns?.slice(-1)[0]) }))
          .filter((item) => Number.isFinite(item.returnPct))
          .sort((left, right) => (right.theme.score ?? -Infinity) - (left.theme.score ?? -Infinity))
          .slice(0, 3);
        const primaryReturn = leaders.length ? leaders.reduce((sum, item) => sum + item.returnPct, 0) / leaders.length : null;
        (primaryDaily[primary] ||= []).push({
          date: payload.date,
          primary_return_pct: primaryReturn,
          market_return_pct: Number(payload.market_summary?.benchmark?.median_return_pct),
          stages: themes.map((theme) => ({ key: theme.key || `${theme.primary}__${theme.name}`, stage: theme.cycle_stage?.confirmed_stage || theme.cycle_stage?.cycle_stage || "unstarted", return_pct: Number(theme.divergence_analysis?.daily_median_returns?.slice(-1)[0]) })),
        });
      }
      for (const theme of scoreableThemes) {
        const score = Number(theme.score);
        if (!Number.isFinite(score)) continue;
        const key = theme.key || `${theme.primary}__${theme.name}`;
        themeTotals[key] = (themeTotals[key] || 0) + score;
        themeScoringDays[key] = (themeScoringDays[key] || 0) + 1;
        primaryTotals[theme.primary] = (primaryTotals[theme.primary] || 0) + score;
      }
      for (const primary of byPrimary.keys()) primaryScoringDays[primary] = (primaryScoringDays[primary] || 0) + 1;
    };
    const pendingDates = reusable ? dates.filter((dateValue) => dateValue > mainlineReplayScores.end_date) : dates;
    for (let index = 0; index < pendingDates.length; index += 1) {
      const dateValue = pendingDates[index];
      onProgress?.({ date: dateValue, completed: index, total: pendingDates.length, remaining: pendingDates.length - index, reused: reusable ? dates.length - pendingDates.length : 0 });
      if (dateValue === endDate && finalPayload) {
        publishDailyPayload(finalPayload);
        aggregatePayload(finalPayload);
        onProgress?.({ date: dateValue, completed: index + 1, total: pendingDates.length, remaining: pendingDates.length - index - 1, done: true, reused: reusable ? dates.length - pendingDates.length : 0 });
        continue;
      }
      try {
        const response = await fetch(`/api/mainline?date=${encodeURIComponent(dateValue)}&cycle_start_date=${encodeURIComponent(startDate)}&include_core_modules=0`, { cache: "no-store" });
        if (response.ok) {
          const payload = await response.json();
          publishDailyPayload(payload);
          aggregatePayload(payload);
          onProgress?.({ date: dateValue, completed: index + 1, total: pendingDates.length, remaining: pendingDates.length - index - 1, done: true, reused: reusable ? dates.length - pendingDates.length : 0 });
        }
      } catch { /* Keep available days; one missing day must not hide the final result. */ }
    }
    const totals = {
      start_date: startDate,
      end_date: endDate,
      trading_days: replayedDays,
      theme_totals: themeTotals,
      primary_totals: primaryTotals,
      primary_daily: primaryDaily,
      theme_scoring_days: themeScoringDays,
      primary_scoring_days: primaryScoringDays,
      theme_activation_dates: themeActivationDates,
      reused_trading_days: reusable ? dates.length - pendingDates.length : 0,
      scoring_rule: "每个二级方向从确认启动日（含）起累计至截止日；启动前仅展示、不计分"
    };
    setMainlineReplayScores(totals);
    setSystemMainline((current) => current ? { ...current, mainline_replay_scores: totals } : current);
    return lastPayload;
  };

  const scanDailyMarket = async ({ saveQuestion = false } = {}) => {
    if (!dailyScanDate) {
      notify("请先选择日期");
      return null;
    }
    if (cycleReplayStartDate && cycleReplayStartDate > dailyScanDate) {
      notify("周期起始日期不能晚于截止日期");
      return null;
    }
    const requestDate = dailyScanDate;
    const requestId = ++dailyScanRequestRef.current;
    const isCurrentRequest = () => dailyScanRequestRef.current === requestId;
    setDailyScanLoading(true);
    setMainlineHistory([]);
    // A newly requested market snapshot must never be displayed together with
    // the previous scan's mainline calculation while the fresh computation is
    // in progress.  That stale combination was the source of visible "-%"
    // values after the local snapshot had already been refreshed.
    setSystemMainline(null);
    setCapacityCoreResults({});
    setLeaderResults({});
    setDailyScanProgress(`正在读取 ${requestDate} 的本地 5 分钟行情...`);
    setDailyScanProgressValue(5);
    try {
      const response = await fetch(saveQuestion ? "/api/daily-market" : `/api/daily-market?date=${encodeURIComponent(requestDate)}`, {
        method: saveQuestion ? "POST" : "GET",
        headers: saveQuestion ? { "Content-Type": "application/json" } : undefined,
        body: saveQuestion ? JSON.stringify({ date: requestDate }) : undefined,
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "璇诲彇鏈湴5鍒嗛挓鏁版嵁澶辫触");
      if (!isCurrentRequest()) return null;
      setDailyScanProgress(payload.source === "local" ? `${payload.date} 行情读取完成，正在统计 ${payload.totalStocks} 只股票的涨停与板块样本...` : `${payload.date} 历史行情已补全，正在统计 ${payload.totalStocks} 只股票的涨停与板块样本...`);
      setDailyScanProgressValue(35);
      setDailyScan(payload);
      setDailyScanProgress(`正在计算截至 ${payload.date} 的主线、容量中军和题材龙头...`);
      setDailyScanProgressValue(55);
      // A same-day start/end selection is the normal daily view, not an
      // isolated history reset. Let the server use prior cached cycle states
      // and historical evidence unless the user has explicitly cleared cache.
      const effectiveCycleStartDate = cycleReplayStartDate === payload.date ? "" : cycleReplayStartDate;
      const historyTask = loadMainlineHistory(payload.date);
      // The server now receives the selected start date and computes one
      // forward-only series.  Do not re-request every date: that previously
      // re-ran overlapping 10-day windows and still discarded the early days.
      const finalMainline = await loadSystemMainline(payload.date, effectiveCycleStartDate, payload.snapshot_id || "", requestId);
      if (effectiveCycleStartDate && finalMainline && isCurrentRequest()) {
        const totals = {
          start_date: effectiveCycleStartDate,
          end_date: payload.date,
          trading_days: finalMainline.history_trading_days || 0,
          scoring_rule: "从所选起始日至截止日逐交易日计算；每个日期只使用当日及此前行情。",
        };
        setMainlineReplayScores(totals);
        setSystemMainline((current) => current ? { ...current, mainline_replay_scores: totals } : current);
      }
      setDailyScanProgress(`已完成 ${effectiveCycleStartDate ? `${effectiveCycleStartDate} 至 ` : ""}${payload.date} 的主线评分计算。`);
      setDailyScanProgressValue(98);
      await historyTask;
      if (!isCurrentRequest()) return null;
      setDailyScanProgress("全部二级方向自动分析完成：已生成主线、容量中军和题材龙头结果。");
      setDailyScanProgressValue(100);
      const nextQuotes = {};
      for (const stock of payload.stocks || []) {
        nextQuotes[stock.code] = {
          code: stock.code,
          name: stock.name,
          price: stock.price,
          changePct: stock.changePct,
          change: Number.isFinite(stock.price) && Number.isFinite(stock.preClose) ? stock.price - stock.preClose : null,
          volume: stock.vol,
          amount: stock.amount
        };
      }
      const fillQuoteGaps = async (missingCodes) => {
        const batches = Array.from({ length: Math.ceil(missingCodes.length / 100) }, (_, index) => missingCodes.slice(index * 100, index * 100 + 100));
        const results = await Promise.all(batches.map(async (batch) => {
          const response = await fetch(`/api/quotes?codes=${encodeURIComponent(batch.join(","))}`, { cache: "no-store" });
          const quotePayload = await response.json();
          if (!response.ok) throw new Error(quotePayload.error || "实时行情补数失败");
          return quotePayload.quotes || {};
        }));
        const supplementalQuotes = Object.assign({}, ...results);
        if (!isCurrentRequest()) return;
        if (Object.keys(supplementalQuotes).length) setQuotes((current) => ({ ...current, ...supplementalQuotes }));
        const unresolved = missingCodes.filter((code) => !supplementalQuotes[code]);
        if (unresolved.length) notify(`有 ${unresolved.length} 只股票未能补齐实时行情，已保留为“行情暂缺”，请稍后重新读取当日涨幅。`);
      };
      if (payload.source !== "local") {
        setQuotes((current) => ({ ...current, ...nextQuotes }));
        const missingCodes = allCodes.filter((code) => !nextQuotes[code]);
        if (missingCodes.length) fillQuoteGaps(missingCodes).catch((error) => {
          if (isCurrentRequest()) notify(`实时行情补数失败：${error.message}`);
        });
      } else {
        setQuotes(nextQuotes);
        // A local intraday snapshot can omit a normally traded symbol.  For
        // the current session only, fill those holes from the live quote
        // endpoint; never use a live quote to overwrite a historical date.
        if (payload.date === todayInputValue()) {
          const missingCodes = allCodes.filter((code) => !nextQuotes[code]);
          if (missingCodes.length) {
            fillQuoteGaps(missingCodes).catch((error) => {
              if (isCurrentRequest()) notify(`实时行情补数失败：${error.message}`);
            });
          }
        }
      }
      setQuoteMode("daily");
      setQuoteUpdatedAt(`${payload.date} ${payload.source === "local" ? "本地5分钟" : "自动爬取"}`);
      notify(saveQuestion ? `已生成询问文件：${payload.file}` : `已扫描 ${payload.date}：${payload.limitUpCount} 只涨停`);
      return payload;
    } catch (error) {
      if (isCurrentRequest()) {
        setDailyScanProgress(`失败：${error.message}`);
        setDailyScanProgressValue(0);
        notify(error.message);
      }
      return null;
    } finally {
      if (isCurrentRequest()) setDailyScanLoading(false);
    }
  };

  const copyDailyMarketPrompt = async () => {
    const payload = dailyScan?.requestedDate === dailyScanDate ? dailyScan : await scanDailyMarket();
    if (!payload?.gptPrompt) return;
    await navigator.clipboard.writeText(payload.gptPrompt);
    notify("已复制带完整一二三级目录的 GPT 询问");
  };

  const loadCapacityCore = async (item, analysisDate = dailyScan?.date || dailyScanDate) => {
    const key = `${analysisDate}|${item.primary}|${item.secondary}`;
    if (capacityCoreLoading[key]) return;
    setCapacityCoreLoading((current) => ({ ...current, [key]: true }));
    try {
      const params = new URLSearchParams({ date: analysisDate, primary: item.primary, secondary: item.secondary });
      const response = await fetch(`/api/capacity-core?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "容量中军分析失败");
      setCapacityCoreResults((current) => ({ ...current, [key]: payload }));
    } catch (error) {
      notify(error.message);
    } finally {
      setCapacityCoreLoading((current) => ({ ...current, [key]: false }));
    }
  };

  const loadLeader = async (item, analysisDate = dailyScan?.date || dailyScanDate) => {
    const key = `${analysisDate}|${item.primary}|${item.secondary}`;
    if (leaderLoading[key]) return;
    setLeaderLoading((current) => ({ ...current, [key]: true }));
    try {
      const params = new URLSearchParams({ date: analysisDate, primary: item.primary, secondary: item.secondary });
      const response = await fetch(`/api/leader?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "龙头识别失败");
      setLeaderResults((current) => ({ ...current, [key]: payload.leader_analysis }));
    } catch (error) {
      notify(error.message);
    } finally {
      setLeaderLoading((current) => ({ ...current, [key]: false }));
    }
  };

  if (!ready) return <main className="loading-screen">正在读取产业分类 JSON...</main>;

  return (
    <main className="app-shell">
      <aside
        className={`sidebar ${sidebarOpen ? "" : "collapsed"} ${sidebarLevel !== "collections" ? "in-taxonomy" : ""}`}
        style={sidebarOpen ? { width: sidebarWidth, flexBasis: sidebarWidth } : undefined}
      >
        <div className="brand">
          <div className="brand-mark"><FolderTree size={20} /></div>
          {sidebarOpen && (
            <div>
              <strong>{sidebarLevel === "collections" ? "产业分类库" : (collection?.name || "产业书页")}</strong>
              <span>{sidebarLevel === "collections" ? "JSON ATLAS" : `${visibleSectors.length} 条一级 · ${filterTradableStocks(currentCollectionStocks, quotes).length} 只股票`}</span>
            </div>
          )}
        </div>
        {sidebarOpen && (
          <>
            <div className="side-label">产业书页</div>
            <nav className="collection-nav">
              {collections.collections.map((item, index) => {
                const linkedSectors = (taxonomy.sectors || []).filter((sector) => (item.primary_sectors || []).includes(sector.name));
                const stocks = uniqueByCode(linkedSectors.flatMap((sector) => indexList(indexes.primarySectorIndex, sector.name)));
                const avg = averageChange(stocks, quotes, { primaries: linkedSectors.map((sector) => sector.name) });
                const isActive = item.name === collection?.name;
                return (
                  <div key={item.name} data-action-menu-root>
                    <button
                      className={`collection-page ${isActive ? "active" : ""}`}
                      onClick={() => selectCollection(item.name)}
                      onDoubleClick={() => enterCollection(item.name)}
                      title="双击进入该产业书页"
                    >
                      <i
                        title="双击编号可更改或删除书页"
                        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleActionMenu("collection", item.name); }}
                      >{String(index + 1).padStart(2, "0")}</i>
                      <span><strong>{item.name}</strong><small>{linkedSectors.length} 条一级 · {filterTradableStocks(stocks, quotes).length} 只股票</small></span>
                      <em className={marketClass(avg)}>{formatPct(avg)}</em>
                    </button>
                    {actionMenu?.level === "collection" && actionMenu.name === item.name && (
                      <InlineActionMenu
                        collection
                        onRename={() => { setModal({ type: "renameCollection", name: item.name }); setActionMenu(null); }}
                        onDelete={() => deleteCollection(item.name)}
                        deleteLabel="删除书页"
                      />
                    )}
                  </div>
                );
              })}
              <button className="add-collection" onClick={() => setModal("collection")}><Plus size={13} /> 添加产业书页</button>
            </nav>
            <button className="add-sector compact-action" onClick={exportData}><Download size={16} /> 导出整包 JSON</button>
            {sidebarLevel !== "collections" && (
              <div className="sidebar-taxonomy-pane">
                <button className="sidebar-back" onClick={backToCollections}>← 产业书页</button>
                <div className="side-label primary-label">一级主线</div>
                <nav className="sector-nav sidebar-level-nav">
                  <div className="sector-tree">
                    {visibleSectors.map((sector, index) => {
                      const stocks = indexList(indexes.primarySectorIndex, sector.name);
                      const tradableStocks = filterTradableStocks(stocks, quotes);
                      const avg = averageChange(stocks, quotes, { primary: sector.name });
                      const isActivePrimary = sector.name === primary?.name;
                      return (
                        <div key={sector.name} data-action-menu-root>
                          <div className={`sector-row taxonomy-row ${isActivePrimary ? "active" : ""}`}>
                            <button
                              className="sector-item"
                              onClick={() => selectPrimary(sector.name)}
                              onDoubleClick={(event) => { event.stopPropagation(); toggleActionMenu("primary", sector.name); }}
                            >
                              <i style={{ background: palette[index % palette.length] }} />
                              <span>{sector.name}<small>{tradableStocks.length} 只股票 · {sector.secondary_sectors?.length || 0} 个二级</small></span>
                              <small className={`sector-change ${marketClass(avg)}`}>{formatPct(avg)}</small>
                            </button>
                            <button className="nav-toggle" onClick={() => togglePrimary(sector.name)}>
                              {openPrimaryNames.includes(sector.name) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <button className="nav-delete" title="删除一级主线" onClick={() => deletePrimary(sector.name)}><Trash2 size={13} /></button>
                          </div>
                          {actionMenu?.level === "primary" && actionMenu.name === sector.name && (
                            <InlineActionMenu
                              onRename={() => { setModal({ type: "renamePrimary", name: sector.name }); setActionMenu(null); }}
                              onMerge={() => { setModal({ type: "mergePrimary", name: sector.name }); setActionMenu(null); }}
                              onMove={() => { setModal({ type: "movePrimary", name: sector.name, sourceCollection: collection?.name }); setActionMenu(null); }}
                            />
                          )}
                          {openPrimaryNames.includes(sector.name) && (
                            <div className="group-tree">
                              {(sector.secondary_sectors || []).map((item) => {
                                const secondaryStocksForRow = indexList(indexes.secondarySectorIndex, `${sector.name}|${item.name}`);
                                const secondaryAvg = averageChange(secondaryStocksForRow, quotes, { primary: sector.name, secondary: item.name });
                                const active = sector.name === primary?.name && item.name === secondary?.name;
                                return (
                                  <div key={item.name} data-action-menu-root>
                                    <div className={`group-row ${active ? "active" : ""}`}>
                                      <button
                                        className="group-link"
                                        onClick={() => {
                                          setWorkspaceView("library");
                                          setSelectedPrimary(sector.name);
                                          setSelectedSecondary(item.name);
                                          setSelectedTertiary("全部");
                                          setQuery("");
                                        }}
                                        onDoubleClick={(event) => { event.stopPropagation(); toggleActionMenu("secondary", item.name); }}
                                      >
                                        <span>{item.name}</span>
                                        <small className={marketClass(secondaryAvg)}>{formatPct(secondaryAvg)}</small>
                                      </button>
                                    </div>
                                    {actionMenu?.level === "secondary" && actionMenu.name === item.name && (
                                      <InlineActionMenu
                                        nested
                                        onRename={() => { setModal({ type: "renameSecondary", name: item.name }); setActionMenu(null); }}
                                        onMerge={() => { setModal({ type: "mergeSecondary", name: item.name }); setActionMenu(null); }}
                                        onDelete={() => deleteSecondary(item.name)}
                                        deleteLabel="删除二级"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                              <button className="add-group-inline" onClick={() => { setSelectedPrimary(sector.name); setModal("secondary"); }}><Plus size={13} /> 添加二级主线</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="add-sector compact-action" onClick={() => setModal("primary")}><Plus size={16} /> 添加一级主线</button>
                </nav>

                {primary && (
                  <>
                    <div className="side-label primary-label">浜岀骇涓荤嚎 / {primary.name}</div>
                    <div className="group-tree sidebar-subtree">
                      {primary.secondary_sectors.map((item) => {
                        const stocks = indexList(indexes.secondarySectorIndex, `${primary.name}|${item.name}`);
                        const avg = averageChange(stocks, quotes, { primary: primary.name, secondary: item.name });
                        const active = item.name === secondary?.name;
                        return (
                          <div key={item.name} data-action-menu-root>
                            <div className={`group-row ${active ? "active" : ""}`}>
                              <button
                                className="group-link"
                                onClick={() => { selectSecondary(item.name); setSidebarLevel("tertiaries"); }}
                                onDoubleClick={(event) => { event.stopPropagation(); toggleActionMenu("secondary", item.name); }}
                              >
                                <span>{item.name}</span>
                                <small className={marketClass(avg)}>{formatPct(avg)}</small>
                              </button>
                            </div>
                            {actionMenu?.level === "secondary" && actionMenu.name === item.name && (
                              <InlineActionMenu
                                nested
                                onRename={() => { setModal({ type: "renameSecondary", name: item.name }); setActionMenu(null); }}
                                onMerge={() => { setModal({ type: "mergeSecondary", name: item.name }); setActionMenu(null); }}
                                onDelete={() => deleteSecondary(item.name)}
                                deleteLabel="删除二级"
                              />
                            )}
                          </div>
                        );
                      })}
                      <button className="add-group-inline" onClick={() => setModal("secondary")}><Plus size={13} /> 添加二级主线</button>
                    </div>
                  </>
                )}
                <button className="add-sector compact-action sidebar-export-action" onClick={exportData}><Download size={16} /> 导出整包 JSON</button>
              </div>
            )}
            <div className="side-footer json-status">
              <span>{writable ? "JSON 自动保存中" : "JSON 保存已暂停"}</span>
              <span>{validation.ok ? "校验通过" : `${validation.errors.length} 个错误`}</span>
            </div>
          </>
        )}
        <button className="collapse-btn" onClick={() => setSidebarOpen((value) => !value)}>
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        {sidebarOpen && <div className="sidebar-resizer" onMouseDown={() => setIsResizingSidebar(true)} title="拖拽调整侧边栏宽度" />}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-controls">
            <div className="search">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="全局搜索：股票代码、名称、一级/二级/三级、产品标签..." />
              {query && <button onClick={() => setQuery("")}><X size={16} /></button>}
            </div>
            <label className="daily-date-picker" title="周期回放起始日期"><span>周期起始</span><input type="date" value={cycleReplayStartDate} max={dailyScanDate || undefined} onChange={(event) => { dailyScanRequestRef.current += 1; setCycleReplayStartDate(event.target.value); setMainlineReplayScores(null); setSystemMainline(null); setDailyScanProgress(""); }} /></label>
            <label className="daily-date-picker" title="选择扫描截止日期"><span>截止日期</span><input type="date" value={dailyScanDate} min={cycleReplayStartDate || undefined} onChange={(event) => { dailyScanRequestRef.current += 1; setDailyScanDate(event.target.value); setMainlineReplayScores(null); setDailyScan(null); setSystemMainline(null); setDailyScanProgress(""); setDailyScanLoading(false); }} /></label>
          </div>
          <div className={`market-environment ${marketEnvironment?.tone || marketEnvironmentStatus}`} tabIndex={0} aria-describedby="market-environment-detail">
            <BarChart3 size={15} aria-hidden="true" />
            <span>市场环境</span>
            <b>{marketEnvironmentStatus === "loading" ? "读取中" : marketEnvironment ? (marketEnvironment.tone === "strong" ? "偏强" : marketEnvironment.tone === "weak" ? "偏弱" : "平衡") : "暂无数据"}</b>
            <div className="market-environment-tooltip" id="market-environment-detail" role="tooltip">
              {marketEnvironment ? <>
                <strong>{marketEnvironment.date} 全市场</strong>
                <span><em className="up">上涨</em><b>{marketEnvironment.upCount}</b> 家</span>
                <span><em className="down">下跌</em><b>{marketEnvironment.downCount}</b> 家</span>
                <span>整体中位数 <b className={marketClass(marketEnvironment.medianChange)}>{formatPct(marketEnvironment.medianChange)}</b></span>
                <span>上涨中位数 <b className="up">{formatPct(marketEnvironment.upMedianChange)}</b></span>
                {marketEnvironment.topSecondaries.length > 0 && <div className="market-environment-secondary">
                  <strong>涨幅前 3 的二级方向</strong>
                  {marketEnvironment.topSecondaries.map((item, index) => <span key={`${item.primary}-${item.secondary}`}><em>#{index + 1} {item.primary} · {item.secondary}（{item.stockCount} 只）</em><b className={marketClass(item.changePct)}>{formatPct(item.changePct)}</b></span>)}
                </div>}
                {marketEnvironment.flatCount > 0 && <small>另有 {marketEnvironment.flatCount} 家平盘，共计 {marketEnvironment.total} 家；已沿用当日行情扫描的市场排除规则。</small>}
              </> : <span>{marketEnvironmentStatus === "loading" ? "正在读取全市场行情…" : "该日期暂无可用的全市场行情。"}</span>}
            </div>
          </div>
          <div className="top-stats">
            <span><b>{collections.collections.length}</b> 产业书页</span>
            <span><b>{visibleSectors.length}</b> 当前一级</span>
            <span><b>{primary?.secondary_sectors?.length || 0}</b> 二级方向</span>
            <span><b>{stockMap.stocks.length}</b> 股票</span>
            <span><b>{dailyThemes.length}</b> 动态题材日</span>
            <span><b>{quoteMode === "daily" ? "定" : "实"}</b> {quoteUpdatedAt || "行情"}</span>
            <button className={`notes-toggle ${workspaceView === "watchlist" ? "active" : ""}`} onClick={() => setWorkspaceView((view) => view === "watchlist" ? "library" : "watchlist")}><Eye size={15} /> 观察池</button>
            <button className={`notes-toggle ${workspaceView === "notes" ? "active" : ""}`} onClick={() => setWorkspaceView((view) => view === "notes" ? "library" : "notes")}><LockKeyhole size={15} /> 笔记</button>
          </div>
        </header>

        <div className="content taxonomy-content">
          {workspaceView === "watchlist" ? (
            <WatchlistPanel stocks={watchlist} stockUniverse={stockUniverse} stockMap={stockMap} quotes={quotes} onAdd={addWatchStock} onRemove={removeWatchStock} onReorder={reorderWatchStocks} onAddRelation={addWatchRelation} onRemoveRelation={removeWatchRelation} onUpdateRelationNote={updateWatchRelationNote} />
          ) : workspaceView === "notes" ? (
            <NotesPanel
              notes={notes}
              taxonomy={taxonomy}
              stocks={stockUniverse.length ? stockUniverse : stockMap.stocks}
              selectedNoteId={selectedNoteId}
              onSelect={setSelectedNoteId}
              onCreate={createNote}
              onSave={updateNote}
              onDelete={deleteNote}
            />
          ) : query.trim() ? (
            <GlobalSearchPanel
              keyword={query}
              stocks={globalSearchStocks}
              quotes={quotes}
              onViewAffiliations={(stock) => setModal({ type: "stockAffiliations", stock })}
            />
          ) : sidebarLevel === "collections" ? (
            <DailyMarketPanel
              date={dailyScan?.date || dailyScanDate}
              cycleReplayStartDate={cycleReplayStartDate}
              scan={dailyScan}
              loading={dailyScanLoading}
              progress={dailyScanProgress}
              progressValue={dailyScanProgressValue}
              onScan={() => scanDailyMarket()}
              onCopyPrompt={copyDailyMarketPrompt}
              onSaveQuestion={() => scanDailyMarket({ saveQuestion: true })}
              onImportJson={() => setModal({ type: "importJson", scopePrimary: "" })}
              onImportFile={() => setModal({ type: "importJson", scopePrimary: "", initialFile: true })}
              onClassifyStock={(stock) => setModal({ type: "classifyDailyStock", stock })}
              onCopyMarketResearch={copyMarketResearchPrompt}
              onImportMarketResearch={() => setModal({ type: "marketResearchImport", batch: currentMarketResearchBatch })}
              marketResearchPendingCount={marketResearchPendingCount}
              marketResearchBatchCount={currentMarketResearchBatch.length}
              stockUniverse={stockUniverse}
              systemMainline={systemMainline}
              mainlineReplayScores={mainlineReplayScores}
              systemMainlineLoading={systemMainlineLoading}
              analysisCacheClearing={analysisCacheClearing}
              onClearAnalysisCache={clearAnalysisCache}
              primarySectors={taxonomy.sectors || []}
              mainlineHistoryLoading={mainlineHistoryLoading}
              capacityCoreResults={capacityCoreResults}
              capacityCoreLoading={capacityCoreLoading}
              onLoadCapacityCore={loadCapacityCore}
              leaderResults={leaderResults}
              leaderLoading={leaderLoading}
              onLoadLeader={loadLeader}
            />
          ) : !primary ? (
            <div className="empty"><div><Layers3 size={24} /></div><h3>还没有一级主线</h3><p>可以直接添加，也可以编辑 data/sector_taxonomy.json。</p><button onClick={() => setModal("primary")}><Plus size={16} /> 添加一级主线</button></div>
          ) : (
            <>
              {!validation.ok && <ValidationPanel validation={validation} />}

              <section className="tertiary-panel standalone">
                {secondary ? (
                  <>
                    <div className="section-heading primary-inquiry-heading">
                      <div><div className="eyebrow">一级主线</div><h2>{primary.name}</h2><p>询问该一级应包含的二级、三级目录及代表股票。</p></div>
                      <div className="heading-actions"><button onClick={copyTaxonomyPrompt}><Copy size={16} /> 询问一级目录与股票</button><button onClick={copyReorganizationPrompt}><Layers3 size={16} /> 整理二三级目录</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name, initialFile: true })}><Download size={16} /> 导入 JSON 文件</button><button className="primary" onClick={() => setModal({ type: "importJson", scopePrimary: primary.name })}><ClipboardPaste size={16} /> 粘贴返回 JSON</button></div>
                    </div>
                    <div className="section-heading tertiary-heading">
                      <div><h2>三级主线目录</h2><p>{selectedTertiary === "全部" ? `${secondary.name} 下可形成独立行情的产品方向` : (secondary.tertiary_descriptions?.[selectedTertiary] || `${selectedTertiary} 是 ${secondary.name} 下可形成独立行情的产品方向`)}</p></div>
                      <div className="heading-actions"><button onClick={copyTertiaryPrompt}><Copy size={16} /> 询问二级目录与股票</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name, initialFile: true })}><Download size={16} /> 导入 JSON 文件</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name })}><ClipboardPaste size={16} /> 粘贴返回 JSON</button><button className="primary" onClick={() => setModal("tertiary")}><Plus size={16} /> 新增三级主线</button></div>
                    </div>

                    <div className="tertiary-workspace">
                      <div className="tertiary-list">
                        <button className={`tertiary-card ${selectedTertiary === "全部" ? "active" : ""}`} onClick={() => setSelectedTertiary("全部")}>
                          <span><strong>全部</strong><small>{filterTradableStocks(secondaryStocks, quotes).length} 只股票</small></span>
                          <em className={marketClass(averageChange(secondaryStocks, quotes, { primary: primary.name, secondary: secondary.name }))}>{formatPct(averageChange(secondaryStocks, quotes, { primary: primary.name, secondary: secondary.name }))}</em>
                          <ChevronRight size={16} />
                        </button>
                        {secondary.tertiary_sectors.map((name) => {
                          const stocks = indexList(indexes.tertiarySectorIndex, `${primary.name}|${secondary.name}|${name}`);
                          const tradableStocks = filterTradableStocks(stocks, quotes);
                          const avg = averageChange(stocks, quotes, { primary: primary.name, secondary: secondary.name, tertiary: name });
                          return (
                            <Fragment key={name}>
                            <div data-action-menu-root>
                            <button className={`tertiary-card ${selectedTertiary === name ? "active" : ""}`} onClick={() => setSelectedTertiary(name)} onDoubleClick={() => toggleActionMenu("tertiary", `${primary.name}|${secondary.name}|${name}`)}>
                          <span><strong>{name}</strong><small>{tradableStocks.length} 只股票</small></span>
                              <em className={marketClass(avg)}>{formatPct(avg)}</em>
                              <i title="删除三级主线" onClick={(event) => { event.stopPropagation(); deleteTertiary(name); }}><Trash2 size={13} /></i>
                              <ChevronRight size={16} />
                            </button>
                            {actionMenu?.level === "tertiary" && actionMenu.name === `${primary.name}|${secondary.name}|${name}` && (
                              <InlineActionMenu
                                light
                                onRename={() => { setModal({ type: "renameTertiary", name }); setActionMenu(null); }}
                                onMerge={() => { setModal({ type: "mergeTertiary", name }); setActionMenu(null); }}
                              />
                            )}
                            </div>
                            </Fragment>
                          );
                        })}
                      </div>

                      <section className="stock-panel">
                        <div className="section-heading detail-heading">
                          <div>
                            <div className="eyebrow">股票列表</div>
                            <h2>{query ? `“${query}”的搜索结果` : selectedTertiary}</h2>
                            <p>同一股票多三级归属时，一级和二级统计只计算一次。</p>
                          </div>
                          <div className="heading-actions">{selectedTertiary !== "全部" && <><button className={`limit-up-filter ${limitUpFilter.records ? "active" : ""}`} disabled={limitUpFilter.loading} onClick={scanSelectedTertiaryLimitUps}><Flame size={16} /> {limitUpFilter.loading ? `扫描 ${limitUpFilter.scanned} 只股票…` : (limitUpFilter.records ? `显示全部（近月涨停 ${Object.keys(limitUpFilter.records).length} 只）` : "筛选近月涨停")}</button><button className="industry-crawl-button" onClick={() => setModal({ type: "crawlIndustry", target: { primary: primary.name, secondary: secondary.name, tertiary: selectedTertiary } })}><Download size={16} /> 抓取细分行业</button><button onClick={copyStockPrompt}><Copy size={16} /> 询问三级包含哪些股票</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name, initialFile: true })}><Download size={16} /> 导入 JSON 文件</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name })}><ClipboardPaste size={16} /> 粘贴返回 JSON</button></>}<button onClick={() => setModal("stock")}><Plus size={16} /> 新增股票</button></div>
                        </div>
                        <StockTable stocks={visibleStocks} quotes={quotes} limitUpRecords={limitUpFilter.records} onDelete={removeStock} onViewAffiliations={(stock) => setModal({ type: "stockAffiliations", stock })} />
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="empty"><div><FolderTree size={24} /></div><h3>还没有二级主线</h3><p>可以单独添加二级主线，也可以询问 GPT 补全目录和代表股票。</p><div className="empty-actions"><button onClick={copyTaxonomyPrompt}><Copy size={16} /> 询问一级目录与股票</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name, initialFile: true })}><Download size={16} /> 导入 JSON 文件</button><button onClick={() => setModal({ type: "importJson", scopePrimary: primary.name })}><ClipboardPaste size={16} /> 粘贴返回 JSON</button><button onClick={() => setModal("secondary")}><Plus size={16} /> 添加二级主线</button></div></div>
                )}
              </section>
            </>
          )}
        </div>
      </section>

      {modalType === "collection" && <CollectionModal onClose={() => setModal(null)} onSubmit={addCollection} />}
      {modalType === "renameCollection" && <RenameModal title="更改产业书页名称" subtitle="仅修改书页名称，不会影响其下的一级主线和股票归属。" currentName={modal.name} onClose={() => setModal(null)} onSubmit={renameCollection} />}
      {modalType === "primary" && <PrimaryModal onClose={() => setModal(null)} onSubmit={addPrimary} />}
      {modalType === "secondary" && primary && <SecondaryModal primary={primary} onClose={() => setModal(null)} onSubmit={addSecondary} />}
      {modalType === "tertiary" && <SimpleModal title={`为「${secondary?.name}」新增三级主线`} subtitle="三级主线必须是可形成独立行情的产品方向，不要写涨价、订单、政策等动态事件。" onClose={() => setModal(null)} onSubmit={addTertiary} />}
      {modalType === "renamePrimary" && <RenameModal title="重命名一级主线" currentName={modal.name} onClose={() => setModal(null)} onSubmit={renamePrimary} />}
      {modalType === "mergePrimary" && <MergeModal title="合并一级主线" sourceName={modal.name} options={taxonomy.sectors.map((item) => item.name).filter((name) => name !== modal.name)} onClose={() => setModal(null)} onSubmit={mergePrimary} />}
      {modalType === "movePrimary" && <MovePrimaryModal primaryName={modal.name} sourceCollection={modal.sourceCollection} collections={collections.collections} onClose={() => setModal(null)} onSubmit={movePrimaryToCollection} />}
      {modalType === "renameSecondary" && <RenameModal title="重命名二级主线" currentName={modal.name} onClose={() => setModal(null)} onSubmit={renameSecondary} />}
      {modalType === "mergeSecondary" && primary && <MergeModal title="合并二级主线" sourceName={modal.name} options={primary.secondary_sectors.map((item) => item.name).filter((name) => name !== modal.name)} onClose={() => setModal(null)} onSubmit={mergeSecondary} />}
      {modalType === "renameTertiary" && <RenameModal title="重命名三级主线" currentName={modal.name} onClose={() => setModal(null)} onSubmit={renameTertiary} />}
      {modalType === "mergeTertiary" && secondary && <MergeModal title="合并三级主线" sourceName={modal.name} options={secondary.tertiary_sectors.filter((name) => name !== modal.name)} onClose={() => setModal(null)} onSubmit={mergeTertiary} />}
      {modalType === "importJson" && <ImportJsonModal initialFile={modal?.initialFile} onClose={() => setModal(null)} onSubmit={(text) => importGPTJson(text, modal?.scopePrimary)} />}
      {modalType === "marketResearchImport" && <ImportJsonModal title="粘贴全市场 GPT 核验 JSON" onClose={() => setModal(null)} onSubmit={(text) => importMarketResearchJson(text, modal.batch)} />}
      {modalType === "stock" && primary && secondary && (
        <StockModal primary={primary} secondary={secondary} selectedTertiary={selectedTertiary} onClose={() => setModal(null)} onSubmit={addStocks} />
      )}
      {modalType === "classifyDailyStock" && (
        <DailyStockClassifyModal
          stock={modal.stock}
          taxonomy={taxonomy}
          onClose={() => setModal(null)}
          onSubmit={(values) => { if (classifyDailyStock(values)) setModal(null); }}
        />
      )}
      {modalType === "addStockAffiliation" && (
        <DailyStockClassifyModal
          stock={modal.stock}
          taxonomy={taxonomy}
          title="添加到其他主线"
          subtitle="为该股票追加一条长期产业归属；已有归属会完整保留。"
          submitLabel="确认添加归属"
          onClose={() => setModal(null)}
          onSubmit={(values) => { if (classifyDailyStock(values)) setModal(null); }}
        />
      )}
      {modalType === "stockAffiliations" && <StockAffiliationsModal stock={modal.stock} onClose={() => setModal(null)} onAdd={() => setModal({ type: "addStockAffiliation", stock: modal.stock })} />}
      {modalType === "crawlIndustry" && (
        <IndustryCrawlModal
          target={modal.target}
          onClose={() => setModal(null)}
          onSubmit={(values) => {
            const saved = addCrawledIndustryStocks(values);
            if (saved) setModal(null);
          }}
        />
      )}
      {deleteConfirmation && (
        <DeleteCollectionConfirm
          name={deleteConfirmation.name}
          primaryCount={deleteConfirmation.primaryNames.length}
          stockCount={stockMap.stocks.filter((stock) => deleteConfirmation.primaryNames.some((primaryName) => stockHasPrimary(stock, primaryName))).length}
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={confirmDeleteCollection}
        />
      )}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}

function NotesPanel({ notes, taxonomy, stocks, selectedNoteId, onSelect, onCreate, onSave, onDelete }) {
  const selectedNote = notes.find((note) => note.id === selectedNoteId) || notes[0];
  const [noteQuery, setNoteQuery] = useState("");
  const filteredNotes = useMemo(() => {
    const keyword = noteQuery.trim().toLowerCase();
    if (!keyword) return notes;
    return notes.filter((note) => `${note.title}\n${note.content}`.toLowerCase().includes(keyword));
  }, [noteQuery, notes]);
  const mainlineTokens = useMemo(() => {
    const tokens = new Map();
    const register = (name, level, path) => {
      const value = String(name || "").trim();
      if (value.length < 2) return;
      const current = tokens.get(value);
      if (!current || level > current.level) tokens.set(value, { level, path });
    };
    for (const primary of taxonomy?.sectors || []) {
      register(primary.name, 1, primary.name);
      for (const secondary of primary.secondary_sectors || []) {
        register(secondary.name, 2, `${primary.name} / ${secondary.name}`);
        for (const tertiary of secondary.tertiary_sectors || []) {
          const detail = tertiaryDetail(tertiary);
          register(detail.name, 3, `${primary.name} / ${secondary.name} / ${detail.name}`);
        }
      }
    }
    return [...tokens.entries()].sort(([left], [right]) => right.length - left.length);
  }, [taxonomy]);
  const stockNameTokens = useMemo(() => {
    const byName = new Map();
    for (const stock of stocks || []) {
      const name = String(stock.name || "").trim();
      if (name.length < 2 || name.length > 4 || !/^[A-Za-z*\u4e00-\u9fff]+$/.test(name)) continue;
      if (!byName.has(name)) byName.set(name, stock);
    }
    return [...byName.entries()].sort(([left], [right]) => right.length - left.length);
  }, [stocks]);
  const stockNamesByLength = useMemo(() => {
    const names = new Map();
    for (const [name, stock] of stockNameTokens) names.set(name, stock);
    return names;
  }, [stockNameTokens]);
  const stockCodes = useMemo(() => {
    const codes = new Map();
    for (const stock of stocks || []) {
      const code = String(stock.code || "").trim();
      if (/^\d{6}$/.test(code) && !codes.has(code)) codes.set(code, stock);
    }
    return codes;
  }, [stocks]);
  const notesByDate = useMemo(() => {
    const years = new Map();
    for (const note of filteredNotes) {
      const date = new Date(note.createdAt);
      const validDate = Number.isNaN(date.getTime()) ? new Date(note.updatedAt) : date;
      const year = String(validDate.getFullYear());
      const month = String(validDate.getMonth() + 1).padStart(2, "0");
      const day = String(validDate.getDate()).padStart(2, "0");
      if (!years.has(year)) years.set(year, new Map());
      const months = years.get(year);
      if (!months.has(month)) months.set(month, new Map());
      const days = months.get(month);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(note);
    }
    return [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, months]) => ({
      year,
      months: [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => ({
        month,
        days: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, dayNotes]) => ({ day, notes: dayNotes }))
      }))
    }));
  }, [filteredNotes]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [openYears, setOpenYears] = useState({});
  const [openMonths, setOpenMonths] = useState({});
  const lastSavedRef = useRef("");
  const ignoreNextAutoSaveRef = useRef(false);
  const noteEditorRef = useRef(null);
  const contentHistoryRef = useRef({ entries: [], index: -1 });

  const escapeNoteHtml = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const renderNoteInlineHtml = (line) => String(line || "")
    .split(/(#(?:\d{6}|[A-Za-z*\u4e00-\u9fff]+)#)/g)
    .map((part) => {
      const renderMainlines = (text) => {
        if (!mainlineTokens.length) return escapeNoteHtml(text);
        const pattern = new RegExp(`(${mainlineTokens.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
        return text.split(pattern).map((fragment) => {
          const match = mainlineTokens.find(([name]) => name === fragment);
          if (!match) return escapeNoteHtml(fragment);
          const [, mainline] = match;
          return `<mark class="note-mainline-token note-mainline-level-${mainline.level}" title="${escapeNoteHtml(`${mainline.level}级主线 · ${mainline.path}`)}">${escapeNoteHtml(fragment)}</mark>`;
        }).join("");
      };
      const renderStocks = (text) => {
        if (!stockNamesByLength.size && !stockCodes.size) return renderMainlines(text);
        const fragments = [];
        let plainText = "";
        let index = 0;
        const flushPlainText = () => {
          if (plainText) fragments.push(renderMainlines(plainText));
          plainText = "";
        };
        while (index < text.length) {
          let matchedName = "";
          let stock = null;
          const codeCandidate = text.slice(index, index + 6);
          const before = index > 0 ? text[index - 1] : "";
          const after = text[index + 6] || "";
          if (/^\d{6}$/.test(codeCandidate) && !/\d/.test(before) && !/\d/.test(after)) {
            stock = stockCodes.get(codeCandidate) || null;
            if (stock) matchedName = codeCandidate;
          }
          for (let length = 4; length >= 2; length -= 1) {
            if (stock) break;
            const candidate = text.slice(index, index + length);
            const candidateStock = stockNamesByLength.get(candidate);
            if (candidateStock) {
              matchedName = candidate;
              stock = candidateStock;
              break;
            }
          }
          if (!stock) {
            plainText += text[index];
            index += 1;
            continue;
          }
          flushPlainText();
          fragments.push(`<mark class="stock-note-token" title="${escapeNoteHtml(`${stock.name} · ${stock.code}`)}">${escapeNoteHtml(matchedName)}</mark>`);
          index += matchedName.length;
        }
        flushPlainText();
        return fragments.join("");
      };
      if (!part.startsWith("#") || !part.endsWith("#")) return renderStocks(part);
      const token = escapeNoteHtml(part.slice(1, -1));
      return `<span class="stock-note-delimiter" contenteditable="false">#</span><mark class="stock-note-token">${token}</mark><span class="stock-note-delimiter" contenteditable="false">#</span>`;
    })
    .join("");
  const noteEditorHtml = (value) => String(value || "").split("\n").map((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (!heading) return `<div class="note-line">${renderNoteInlineHtml(line) || "\u200b"}</div>`;
    const level = heading[1].length;
    const headingContent = heading[2] ? renderNoteInlineHtml(heading[2]) : `<span class="note-heading-caret" data-placeholder="${level}级标题">\u200b</span>`;
    return `<div id="note-heading-${index}" class="note-heading note-heading-level-${level}" data-note-heading="${level}">${headingContent}</div>`;
  }).join("");

  const editorNodeValue = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeName === "BR") return "";
    // Do not use innerText here. Browsers expose an empty rich-text line and
    // a regular space as different visual DOM shapes (<br>, NBSP, etc.), and
    // innerText can add another newline before editorContentValue joins lines.
    // Each top-level note block must map to exactly one logical text line.
    const plainText = () => (node.textContent || "").replace(/\u200b/g, "").replace(/\u00a0/g, " ");
    if (node.classList?.contains("note-heading")) return `${"#".repeat(Number(node.dataset.noteHeading || 1))} ${plainText()}`;
    if (node.classList?.contains("note-line")) return plainText();
    return node.textContent || "";
  };

  const editorContentValue = (editor) => Array.from(editor.childNodes).map(editorNodeValue).join("\n");

  const replaceStockCodes = (value) => String(value || "").replace(/\b\d{6}\b/g, (code) => {
    const stock = stockCodes.get(code);
    return stock?.name || code;
  });

  useEffect(() => {
    const snapshot = selectedNote ? JSON.stringify({ title: selectedNote.title, content: selectedNote.content }) : "";
    lastSavedRef.current = snapshot;
    ignoreNextAutoSaveRef.current = true;
    setTitle(selectedNote?.title || "");
    setContent(selectedNote?.content || "");
    contentHistoryRef.current = { entries: [{ content: selectedNote?.content || "", caret: 0 }], index: 0 };
    setSaveState("");
    if (noteEditorRef.current) noteEditorRef.current.innerHTML = noteEditorHtml(selectedNote?.content || "");
  }, [selectedNote?.id]);

  useEffect(() => {
    const storedContent = selectedNote?.content || "";
    if (noteEditorRef.current && storedContent && document.activeElement !== noteEditorRef.current) {
      noteEditorRef.current.innerHTML = noteEditorHtml(storedContent);
    }
  }, [stockNameTokens, stockCodes, selectedNote?.id]);

  const save = async (automatic = false) => {
    if (!selectedNote) return;
    const snapshot = JSON.stringify({ title: title.trim() || "未命名笔记", content });
    if (snapshot === lastSavedRef.current) {
      if (!automatic) setSaveState("已保存");
      return;
    }
    setSaving(true);
    setSaveState(automatic ? "自动保存中…" : "保存中…");
    const saved = await onSave(selectedNote.id, { title: title.trim() || "未命名笔记", content });
    setSaving(false);
    if (saved) {
      lastSavedRef.current = snapshot;
      setSaveState(automatic ? "已自动保存" : "已保存");
    } else {
      setSaveState("保存失败");
    }
  };

  useEffect(() => {
    if (!selectedNote) return undefined;
    if (ignoreNextAutoSaveRef.current) {
      ignoreNextAutoSaveRef.current = false;
      return undefined;
    }
    const snapshot = JSON.stringify({ title: title.trim() || "未命名笔记", content });
    if (snapshot === lastSavedRef.current) return undefined;
    setSaveState("等待自动保存…");
    const timer = window.setTimeout(() => save(true), 800);
    return () => window.clearTimeout(timer);
  }, [title, content, selectedNote?.id]);

  const restoreCaret = (editor, offset) => {
    const children = Array.from(editor.childNodes);
    let remaining = offset;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const textLength = editorNodeValue(child).replace(/^#{1,6}\s+/, "").length;
      if (remaining <= textLength) {
        const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let localOffset = remaining;
        while (node) {
          const nodeLength = node.nodeValue.replace(/\u200b/g, "").length;
          if (localOffset <= nodeLength) {
            const range = document.createRange();
            range.setStart(node, Math.min(node.nodeValue.length, Math.max(0, localOffset)));
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return;
          }
          localOffset -= nodeLength;
          node = walker.nextNode();
        }
      }
      remaining -= textLength;
      if (index < children.length - 1) remaining -= 1;
    }
    editor.focus();
  };

  const recordContentHistory = (nextContent, caret) => {
    const history = contentHistoryRef.current;
    const current = history.entries[history.index];
    if (current?.content === nextContent) {
      current.caret = caret;
      return;
    }
    const entries = [...history.entries.slice(0, history.index + 1), { content: nextContent, caret }].slice(-120);
    contentHistoryRef.current = { entries, index: entries.length - 1 };
  };

  const syncRichNoteContent = (event) => {
    const editor = event.currentTarget;
    const selection = window.getSelection();
    let caretOffset = editor.innerText.length;
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      caretOffset = range.toString().length;
    }
    const rawContent = editorContentValue(editor).replace(/\r/g, "");
    const nextContent = replaceStockCodes(rawContent);
    const nextCaret = replaceStockCodes(rawContent.slice(0, caretOffset)).length;
    if (nextContent !== rawContent) {
      editor.innerHTML = noteEditorHtml(nextContent);
      restoreCaret(editor, nextCaret);
    }
    recordContentHistory(nextContent, nextCaret);
    setContent(nextContent);
  };

  const normalizeNoteEditor = (event) => {
    const editor = event.currentTarget;
    const nextContent = replaceStockCodes(editorContentValue(editor).replace(/\r/g, ""));
    if (editor.innerHTML !== noteEditorHtml(nextContent)) editor.innerHTML = noteEditorHtml(nextContent);
  };

  const insertNoteLineBreak = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const editor = event.currentTarget;
    // A <br> inside a rendered note line is not part of editorContentValue(),
    // so the first Enter could be lost during normalization.  Update the
    // canonical newline representation directly, then rebuild once and place
    // the selection at the newly created line.
    const rawContent = editorContentValue(editor).replace(/\r/g, "");
    const caret = rawCaretOffset(editor);
    const caretMarker = "\uE000";
    const nextContent = `${rawContent.slice(0, caret)}\n${rawContent.slice(caret)}`;
    const nextCaret = caret + 1;
    recordContentHistory(nextContent, nextCaret);
    setContent(nextContent);
    editor.innerHTML = noteEditorHtml(`${rawContent.slice(0, caret)}\n${caretMarker}${rawContent.slice(caret)}`);
    editor.focus();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let caretNode = walker.nextNode();
    while (caretNode && !caretNode.nodeValue.includes(caretMarker)) caretNode = walker.nextNode();
    if (!caretNode) {
      restoreCaret(editor, nextCaret);
      return;
    }
    const markerOffset = caretNode.nodeValue.indexOf(caretMarker);
    caretNode.nodeValue = caretNode.nodeValue.replace(caretMarker, "");
    const range = document.createRange();
    range.setStart(caretNode, markerOffset);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const rawCaretOffset = (editor) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editorContentValue(editor).length;
    const children = Array.from(editor.childNodes);
    const directOffset = selection.anchorNode === editor ? selection.anchorOffset : -1;
    const rowIndex = directOffset >= 0 ? Math.min(directOffset, children.length - 1) : children.findIndex((child) => child === selection.anchorNode || child.contains(selection.anchorNode));
    if (rowIndex < 0) return editorContentValue(editor).length;
    const before = children.slice(0, rowIndex).map(editorNodeValue).join("\n");
    const beforeLength = before.length + (rowIndex ? 1 : 0);
    if (directOffset >= 0) return directOffset >= children.length ? editorContentValue(editor).length : beforeLength;
    const row = children[rowIndex];
    const range = document.createRange();
    range.selectNodeContents(row);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    const headingPrefix = row.classList?.contains("note-heading") ? Number(row.dataset.noteHeading || 1) + 1 : 0;
    return beforeLength + headingPrefix + range.toString().replace(/\u00a0/g, " ").length;
  };

  const formatNoteHeading = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !/^[1-6]$/.test(event.key)) return;
    event.preventDefault();
    const editor = event.currentTarget;
    const rawContent = editorContentValue(editor).replace(/\r/g, "");
    const caret = rawCaretOffset(editor);
    const lineStart = rawContent.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const lineEnd = rawContent.indexOf("\n", caret);
    const end = lineEnd === -1 ? rawContent.length : lineEnd;
    const currentLine = rawContent.slice(lineStart, end);
    const oldMarker = currentLine.match(/^#{1,6}\s+/)?.[0] || "";
    const headingLevel = Number(event.key);
    const headingMarker = oldMarker.length === headingLevel + 1 ? "" : `${"#".repeat(headingLevel)} `;
    const nextLine = `${headingMarker}${currentLine.slice(oldMarker.length)}`;
    const beforeCurrentLine = currentLine ? rawContent.slice(0, lineStart) : rawContent.slice(0, lineStart).replace(/\n+$/, "");
    const lineSeparator = !currentLine && beforeCurrentLine ? "\n" : "";
    const nextContent = `${beforeCurrentLine}${lineSeparator}${nextLine}${rawContent.slice(end)}`;
    const textPosition = currentLine ? Math.max(0, caret - lineStart - oldMarker.length) : 0;
    const nextRawCaret = beforeCurrentLine.length + lineSeparator.length + headingMarker.length + textPosition;
    const nextCaret = nextContent.slice(0, nextRawCaret).replace(/^#{1,6}\s+/gm, "").length;
    recordContentHistory(nextContent, nextCaret);
    setContent(nextContent);
    editor.innerHTML = noteEditorHtml(nextContent);
    restoreCaret(editor, nextCaret);
  };

  const moveContentHistory = (editor, direction) => {
    const history = contentHistoryRef.current;
    const nextIndex = Math.min(history.entries.length - 1, Math.max(0, history.index + direction));
    if (nextIndex === history.index) return;
    const entry = history.entries[nextIndex];
    contentHistoryRef.current = { ...history, index: nextIndex };
    setContent(entry.content);
    editor.innerHTML = noteEditorHtml(entry.content);
    restoreCaret(editor, entry.caret);
  };

  const deleteNoteCharacter = (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return false;
    const selection = window.getSelection();
    if (!selection?.isCollapsed) return false;
    event.preventDefault();
    const editor = event.currentTarget;
    const rawContent = editorContentValue(editor).replace(/\r/g, "");
    const caret = rawCaretOffset(editor);
    const start = event.key === "Backspace" ? Math.max(0, caret - 1) : caret;
    const end = event.key === "Backspace" ? caret : Math.min(rawContent.length, caret + 1);
    if (start === end) return true;
    const nextContent = `${rawContent.slice(0, start)}${rawContent.slice(end)}`;
    const nextCaret = nextContent.slice(0, start).replace(/^#{1,6}\s+/gm, "").length;
    recordContentHistory(nextContent, nextCaret);
    setContent(nextContent);
    editor.innerHTML = noteEditorHtml(nextContent);
    restoreCaret(editor, nextCaret);
    return true;
  };

  const handleNoteKeyDown = (event) => {
    const shortcut = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (shortcut && key === "s") {
      event.preventDefault();
      save();
      return;
    }
    if (shortcut && key === "z") {
      event.preventDefault();
      moveContentHistory(event.currentTarget, event.shiftKey ? 1 : -1);
      return;
    }
    if (shortcut && key === "y") {
      event.preventDefault();
      moveContentHistory(event.currentTarget, 1);
      return;
    }
    if (deleteNoteCharacter(event)) return;
    insertNoteLineBreak(event);
    formatNoteHeading(event);
  };

  const noteOutline = useMemo(() => String(content || "").split("\n").map((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    return heading ? { level: heading[1].length, text: heading[2], index } : null;
  }).filter(Boolean), [content]);
  const noteCharacterCount = useMemo(() => countVisibleNoteCharacters(content), [content]);

  return (
    <section className="notes-panel">
      <aside className="notes-list">
        <div className="notes-list-heading"><div><div className="eyebrow">MY NOTES</div><h2>笔记</h2></div><button className="primary" onClick={onCreate}><Plus size={15} /> 新建</button></div>
        <div className="note-search"><Search size={15} /><input value={noteQuery} onChange={(event) => setNoteQuery(event.target.value)} placeholder="搜索笔记标题或正文" aria-label="搜索笔记" />{noteQuery && <button onClick={() => setNoteQuery("")} aria-label="清除搜索"><X size={14} /></button>}</div>
        <div className="notes-date-tree">
          {notesByDate.map(({ year, months }) => <section className="note-year" key={year}>
            <button className="note-tree-toggle year-toggle" onClick={() => setOpenYears((current) => ({ ...current, [year]: !current[year] }))}>{openYears[year] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<b>{year} 年</b></button>
            {openYears[year] && months.map(({ month, days }) => {
              const monthKey = `${year}-${month}`;
              return <div className="note-month" key={month}>
                <button className="note-tree-toggle month-toggle" onClick={() => setOpenMonths((current) => ({ ...current, [monthKey]: !current[monthKey] }))}>{openMonths[monthKey] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<b>{Number(month)} 月</b></button>
                {openMonths[monthKey] && days.map(({ day, notes: dayNotes }) => <div className="note-day" key={day}>
                  {dayNotes.map((note, index) => <button key={note.id} className={`note-list-item ${note.id === selectedNote?.id ? "active" : ""}`} onClick={() => onSelect(note.id)}><b>{index === 0 ? `${Number(day)} 日` : ""}</b><strong>{note.title}</strong></button>)}
                </div>)}
              </div>;
            })}
          </section>)}
        </div>
        {!notes.length ? <div className="notes-empty">还没有笔记。点击“新建”记录你的研究想法。</div> : !filteredNotes.length && <div className="notes-empty">没有匹配的笔记，换个关键词试试。</div>}
      </aside>
      <article className="note-editor">
        {selectedNote ? <>
          <div className="note-editor-actions"><div className="note-editor-status"><span>{saveState || `最后修改：${new Date(selectedNote.updatedAt).toLocaleString("zh-CN")}`}</span><span className="note-character-count" aria-label={`正文共 ${noteCharacterCount.toLocaleString("zh-CN")} 字`} title="正文可见字数，不含空格、换行和格式标记">{noteCharacterCount.toLocaleString("zh-CN")} 字</span></div><div><button onClick={() => { if (confirm(`删除笔记「${selectedNote.title}」？`)) onDelete(selectedNote.id); }}><Trash2 size={15} /> 删除</button><button className="primary" disabled={saving} onClick={() => save()}>{saving ? "保存中…" : "立即保存"}</button></div></div>
          <input className="note-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="笔记标题" />
          <div className="note-stock-hint">股票名称会从全量股票库自动识别；也可输入 <b>#股票代码#</b> 或 <b>#股票名称#</b> 强制标记并隐藏井号。<span className="note-mark-legend"><i className="stock-mark" />股票 <i className="mainline-mark" />三级主线</span><span className="note-shortcut">Ctrl + 1–6 标题 · Ctrl + Z 撤销 · Ctrl + Y 重做 · Ctrl + S 保存</span></div>
          {noteOutline.length > 0 && <nav className="note-outline" aria-label="文章目录"><strong>目录</strong>{noteOutline.map((item) => <button className={`note-outline-level-${item.level}`} key={item.index} onClick={() => document.getElementById(`note-heading-${item.index}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>{item.text}</button>)}</nav>}
          <div className="note-content-shell">
          <div ref={noteEditorRef} className="note-content note-content-rich" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="笔记正文；输入六位股票代码会自动转换为股票名称，也可使用 #股票代码 或 #股票名称 标记重点股票" data-placeholder="写下你的研究、观察或待办事项…" onInput={syncRichNoteContent} onBlur={normalizeNoteEditor} onKeyDown={handleNoteKeyDown} />
          </div>
        </> : <div className="empty"><div><StickyNote size={24} /></div><h3>选择或新建一篇笔记</h3><p>笔记会保存到本地 data/notes.json。</p><button className="primary" onClick={onCreate}><Plus size={16} /> 新建笔记</button></div>}
      </article>
    </section>
  );
}

function WatchlistPanel({ stocks, stockUniverse, stockMap, quotes, onAdd, onRemove, onReorder, onAddRelation, onRemoveRelation, onUpdateRelationNote }) {
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedCode, setExpandedCode] = useState("");
  const [relatedInput, setRelatedInput] = useState("");
  const [relatedAdding, setRelatedAdding] = useState(false);
  const [draggedCode, setDraggedCode] = useState("");
  const categoryPathsByCode = useMemo(() => new Map((stockMap.stocks || []).map((stock) => {
    const paths = (stock.classifications || []).flatMap((classification) => (classification.tertiary_sectors || []).map((tertiary) => [
      classificationPrimarySector(stock, classification),
      classification.secondary_sector,
      tertiary
    ].filter(Boolean).join(" / ")));
    return [stock.code, Array.from(new Set(paths))];
  })), [stockMap]);
  const submit = async (event) => {
    event.preventDefault();
    setAdding(true);
    const saved = await onAdd(code);
    if (saved) setCode("");
    setAdding(false);
  };
  const addRelated = async (sourceCode) => {
    setRelatedAdding(true);
    const saved = await onAddRelation(sourceCode, relatedInput);
    if (saved) setRelatedInput("");
    setRelatedAdding(false);
  };
  return (
    <section className="watchlist-panel">
      <div className="watchlist-heading">
        <div>
          <h2>股票观察池</h2>
          <p>输入股票代码或完整名称即可加入，联动股票由你在每只股票内手动维护。</p>
        </div>
        <div className="watchlist-tools"><strong>{stocks.length} 只</strong></div>
      </div>
      <form className="watchlist-form" onSubmit={submit}>
        <label htmlFor="watchlist-code">股票代码或名称</label>
        <input id="watchlist-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="例如：600519 或 贵州茅台" autoComplete="off" />
        <button className="primary" type="submit" disabled={adding || !code.trim()}>{adding ? "查询中…" : <><Plus size={16} /> 加入观察池</>}</button>
      </form>
      {stocks.length ? <div className="watchlist-list">
        {stocks.map((stock) => {
          const quote = quotes[stock.code] || {};
          const expanded = expandedCode === stock.code;
          const categoryPaths = categoryPathsByCode.get(stock.code) || [];
          return <article className={`watchlist-row ${expanded ? "expanded" : ""} ${draggedCode === stock.code ? "dragging" : ""}`} key={stock.code} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onReorder(draggedCode, stock.code); setDraggedCode(""); }}>
            <div><span className="code">{stock.code}</span><strong><StockName code={stock.code} name={quote.name || stock.name} /></strong></div>
            <div className="watchlist-categories">{categoryPaths.length ? categoryPaths.map((path) => <span key={path}>{path}</span>) : <span className="unclassified">未归类</span>}</div>
            <span className={`change ${marketClass(quote.changePct)}`}>{formatPct(quote.changePct)}</span>
            <span className="price"><small>现价</small>{formatPrice(quote.price)}</span>
            <button className="watchlist-drag" type="button" draggable onDragStart={(event) => { setDraggedCode(stock.code); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedCode("")} title="拖动调整顺序" aria-label={`拖动 ${stock.name} 调整顺序`}><GripVertical size={17} /></button>
            <button className="watchlist-expand" type="button" onClick={() => setExpandedCode((current) => current === stock.code ? "" : stock.code)} aria-expanded={expanded} title={expanded ? "收起联动股票" : "展开联动股票"}>{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>
            <button className="row-delete" type="button" title="移出观察池" onClick={() => onRemove(stock.code)}><X size={16} /></button>
            {expanded && <div className="watchlist-detail">
              <div className="manual-links-heading"><div><h3>联动股票</h3><p>手动添加你认为与该股走势或题材相关的股票。</p></div><strong>{stock.relatedStocks?.length || 0} 只</strong></div>
              <div className="manual-links-form"><input value={relatedInput} onChange={(event) => setRelatedInput(event.target.value)} placeholder="输入股票代码或名称" aria-label={`为 ${stock.name} 添加联动股票`} /><button type="button" className="primary" disabled={relatedAdding || !relatedInput.trim()} onClick={() => addRelated(stock.code)}>{relatedAdding ? "添加中…" : <><Plus size={14} /> 添加</>}</button></div>
              {stock.relatedStocks?.length ? <div className="manual-links-list">{stock.relatedStocks.map((related) => <div key={related.code}><span className="code">{related.code}</span><strong><StockName code={related.code} name={quotes[related.code]?.name || related.name} /></strong><span className={`change ${marketClass(quotes[related.code]?.changePct)}`}>{formatPct(quotes[related.code]?.changePct)}</span><span className="price"><small>现价</small>{formatPrice(quotes[related.code]?.price)}</span><input className="relation-note" defaultValue={related.note || ""} placeholder="添加备注，例如：同题材补涨" aria-label={`${related.name} 的联动备注`} onBlur={(event) => { if (event.target.value !== (related.note || "")) onUpdateRelationNote(stock.code, related.code, event.target.value); }} /><button type="button" className="row-delete" title="移出联动列表" onClick={() => onRemoveRelation(stock.code, related.code)}><X size={15} /></button></div>)}</div> : <p className="manual-links-empty">还没有手动添加联动股票。</p>}
            </div>}
          </article>;
        })}
      </div> : <div className="empty watchlist-empty"><div><Eye size={24} /></div><h3>观察池还是空的</h3><p>输入股票代码或名称，开始跟踪它的最新行情。</p></div>}
    </section>
  );
}

function GlobalSearchPanel({ keyword, stocks, quotes, onViewAffiliations }) {
  return (
    <section className="global-search-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">GLOBAL SEARCH</div>
          <h2>“{keyword}” 的全库搜索结果</h2>
          <p>匹配股票代码、名称、一级/二级/三级方向、产品标签及长期归属理由。</p>
        </div>
        <strong>{stocks.length} 只股票</strong>
      </div>
      <StockTable stocks={stocks} quotes={quotes} onViewAffiliations={onViewAffiliations} />
      {!stocks.length && <div className="mainline-empty">没有找到匹配股票；可尝试输入完整或部分 6 位股票代码、名称或产业方向。</div>}
    </section>
  );
}

function TaskProgress({ label, value = null, className = "" }) {
  const determinate = Number.isFinite(value);
  return <div className={`task-progress ${determinate ? "determinate" : "indeterminate"} ${className}`} role="status" aria-live="polite">
    <div className="task-progress-track" aria-label={determinate ? `处理进度 ${value}%` : "正在处理中"}><div className="task-progress-fill" style={determinate ? { "--task-progress": value / 100 } : undefined} /></div>
    <div className="task-progress-copy"><span>{label}</span>{determinate && <b>{value}%</b>}</div>
  </div>;
}

function isTradeMainline(theme) {
  // 交易选股不再做一次主线确认。只要上游在当前交易日已经产出
  // 这个方向，就把它作为已确认输入交给选股模块。成员明细在主线
  // 响应中会被压缩，后端会根据现有股票分类恢复，不作为禁用条件。
  return selectTradeMainlines([theme]).length > 0;
}

function DailyMarketPanel({ date, cycleReplayStartDate, scan, loading, progress, progressValue = 0, onScan, onCopyPrompt, onSaveQuestion, onImportJson, onImportFile, onClassifyStock, onCopyMarketResearch, onImportMarketResearch, marketResearchPendingCount = 0, marketResearchBatchCount = 0, stockUniverse = [], primarySectors = [], capacityCoreResults, capacityCoreLoading, onLoadCapacityCore, leaderResults, leaderLoading, onLoadLeader, systemMainline, mainlineReplayScores, systemMainlineLoading, analysisCacheClearing, onClearAnalysisCache }) {
  const topUnknown = scan?.unknownLimitUpStocks?.slice(0, 8) || [];
  // The date input may be a weekend.  Subsequent analysis must use the same
  // effective trading date as the completed scan, not the raw input value.
  const analysisDate = systemMainline?.date || scan?.date || date;
  // SystemMainlinePanel renders all_themes when present; trade selection must
  // use that same current-date source rather than the narrower themes list.
  const availableTradeThemes = systemMainline?.all_themes || systemMainline?.themes || [];
  const namesByCode = new Map(stockUniverse.map((stock) => [stock.code, stock.name]));
  const [tradeCandidates, setTradeCandidates] = useState(null);
  const [tradeCandidatesLoading, setTradeCandidatesLoading] = useState(false);
  const [tradeCandidatesOpen, setTradeCandidatesOpen] = useState(false);
  useEffect(() => {
    setTradeCandidates(null);
    setTradeCandidatesOpen(false);
  }, [date]);
  const loadTradeCandidates = async () => {
    const tradeMainlines = selectTradeMainlines(availableTradeThemes);
    if (!tradeMainlines.length) return;
    setTradeCandidatesLoading(true);
    try {
      const response = await fetch("/api/mainline-trade-candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: analysisDate, confirmed_mainlines: tradeMainlines, stocks: stockUniverse }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "可交易股票分析失败");
      setTradeCandidates(payload);
    } catch (error) { setTradeCandidates({ error: error.message }); }
    finally { setTradeCandidatesLoading(false); }
  };
  const openTradeCandidates = async () => {
    setTradeCandidatesOpen(true);
    if (!tradeCandidatesLoading) await loadTradeCandidates();
  };
  return (
    <section className="daily-market-panel">
      <div>
        <div className="eyebrow">LOCAL 5MIN DATA</div>
        <h2>当日涨停扫描</h2>
        <p>选择固定日期，优先读取本地 5 分钟 Parquet 数据，统计全市场当日涨幅和涨停股；未分类涨停股会生成带完整一二三级目录的 GPT 询问。</p>
      </div>
      <div className="daily-market-controls">
        <button onClick={onScan} disabled={loading}>{loading ? "扫描中..." : "读取当日涨幅"}</button>
        <button onClick={onCopyPrompt} disabled={loading}><Copy size={15} /> 复制 GPT 询问</button>
        <button onClick={onSaveQuestion} disabled={loading}><Download size={15} /> 生成询问文件</button>
        <button onClick={onImportFile} disabled={loading}><Download size={15} /> 导入 JSON 文件</button>
        <button className="primary" onClick={onImportJson}><ClipboardPaste size={15} /> 粘贴返回 JSON</button>
        <button type="button" onClick={onCopyMarketResearch} disabled={loading || !marketResearchBatchCount}><Copy size={15} /> 全市场 GPT 核验（{marketResearchPendingCount} 待处理）</button>
        <button type="button" className="primary" onClick={onImportMarketResearch} disabled={!marketResearchBatchCount}><ClipboardPaste size={15} /> 粘贴全市场核验 JSON</button>
        <button type="button" className="secondary" onClick={onClearAnalysisCache} disabled={loading || analysisCacheClearing}><Trash2 size={15} /> {analysisCacheClearing ? "正在清除缓存…" : "清除分析缓存"}</button>
        <button type="button" className="primary" onClick={openTradeCandidates} disabled={!availableTradeThemes.some(isTradeMainline) || tradeCandidatesLoading} title={availableTradeThemes.some(isTradeMainline) ? "使用当前日期已经完成的方向与股票行情进行选股" : "请先完成当日主线分析"}>主线交易选择</button>
      </div>
      {(loading || progress) && (progress?.startsWith("失败") ? <div className="daily-market-progress error" aria-live="polite">{progress}</div> : <TaskProgress className="daily-market-progress" label={progress || "正在准备扫描..."} value={loading ? progressValue : 100} />)}
      {scan && (
        <div className="daily-market-result">
          <div><b>{scan.totalStocks}</b><span>全市场股票</span></div>
          <div><b>{scan.limitUpCount}</b><span>涨停候选</span></div>
          <div><b>{scan.unknownLimitUpCount}</b><span>未分类涨停</span></div>
          <div><b>{scan.date}</b><span>{scan.sourceNote || scan.parquetPath}</span></div>
        </div>
      )}
      {!!topUnknown.length && (
        <div className="unknown-limit-list">
          <strong>未分类涨停样例</strong>
          <div>
            {topUnknown.map((stock) => {
              const name = stock.name || namesByCode.get(stock.code) || "";
              return <button key={stock.code} type="button" onClick={() => onClassifyStock({ ...stock, name })} title="点击归入产业分类">{stock.code}{name ? ` ${name}` : ""} <em>{formatPct(stock.changePct)}</em></button>;
            })}
          </div>
        </div>
      )}
      {scan && <SystemMainlinePanel result={systemMainline} loading={systemMainlineLoading} date={analysisDate} scan={scan} stockUniverse={stockUniverse} primarySectors={primarySectors} capacityCoreResults={capacityCoreResults} capacityCoreLoading={capacityCoreLoading} onLoadCapacityCore={onLoadCapacityCore} leaderResults={leaderResults} leaderLoading={leaderLoading} onLoadLeader={onLoadLeader} />}
      {tradeCandidatesOpen && <MainlineTradeCandidatesPanel result={tradeCandidates} loading={tradeCandidatesLoading} onClose={() => setTradeCandidatesOpen(false)} />}
    </section>
  );
}

function MainlineTradeCandidatesPanel({ result, loading, onClose }) {
  const [activeGrade, setActiveGrade] = useState("A");
  const groups = result?.mainline_trade_candidates || { A: [], B: [], C: [], rejected: [] };
  const roleText = { leader_reference: "龙头参考", capacity_core: "容量中军", frontline_core: "前排核心", trend_core: "趋势核心", follower: "普通跟随", weak_follower: "后排补涨" };
  const statusText = { buy_candidate: "可以买入观察", wait: "等待位置", avoid: "不建议" };
  const rows = (items) => [...items].sort((left, right) => (right.trade_priority_score ?? right.stock_quality_score ?? -Infinity) - (left.trade_priority_score ?? left.stock_quality_score ?? -Infinity) || (right.stock_quality_score ?? -Infinity) - (left.stock_quality_score ?? -Infinity) || String(left.code).localeCompare(String(right.code))).map((stock) => {
    const scoreItems = [
      ["主线地位", stock.role_score, 30],
      ["资金认可", stock.capital_score, 25],
      ["相对强度", stock.relative_strength_score, 15],
      ["抗分歧", stock.divergence_score, 15],
      ["修复能力", stock.repair_score, 15],
      ["所属主线强度", stock.mainline_strength_score, 20],
    ];
    return <div className="trade-candidate-row" key={stock.code}><div><strong><StockName code={stock.code} name={stock.name} /></strong><small>{stock.code} · {roleText[stock.role] || stock.role}</small><em>所属主线：{stock.mainlines?.join(" / ") || "--"}</em></div><b className={`quality-${stock.stock_quality}`}>{stock.stock_quality} {stock.stock_quality_score}</b><span className={`entry-${stock.entry_status}`}>{statusText[stock.entry_status] || stock.entry_status}</span><p>{stock.reasons?.[0] || stock.risks?.[0] || "主线内普通跟随"}</p><details className="trade-score-breakdown"><summary>查看评分构成 <small>质量 {stock.stock_quality_score} / 100 · 交易优先 {stock.trade_priority_score} / 100</small></summary><dl>{scoreItems.map(([label, value, max]) => <div key={label}><dt>{label}</dt><dd><span style={{ "--score-progress": `${Math.max(0, Math.min(100, (Number(value) || 0) / max * 100))}%` }} /><b>{Number(value) || 0}</b><small>/ {max}</small></dd></div>)}</dl><p className="trade-mainline-strength-note">主线强度：{stock.mainline_strength_mainline || "--"}（主线综合分 {stock.mainline_strength_theme_score ?? "-"}，排名 {stock.mainline_strength_theme_rank ?? "-"}）</p></details></div>;
  });
  const currentBuy = [...groups.A, ...groups.B].filter((stock) => stock.entry_status === "buy_candidate").length;
  const waiting = [...groups.A, ...groups.B].filter((stock) => stock.entry_status === "wait").length;
  const tradeThemes = result?.trade_mainlines || result?.confirmed_mainlines || [];
  const confirmedNames = tradeThemes.map((theme) => [theme.primary, theme.name].filter(Boolean).join(" · ")) || [];
  const hasDivergenceCandidate = tradeThemes.some((theme) => theme.selection_basis === "high_strength_divergence_candidate");
  const gradeMeta = { A: { title: "核心交易观察", description: "主线核心质量最高；仍须看“今日状态”，等待位置时不追入。" }, B: { title: "重点观察", description: "质量尚可，继续跟踪资金与位置，不作为主动推荐。" }, C: { title: "普通跟随", description: "普通跟随或弱跟随，仅展示，不作为推荐。" } };
  const selectedGrade = gradeMeta[activeGrade];
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal mainline-trade-modal" role="dialog" aria-modal="true" aria-labelledby="mainline-trade-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" type="button" aria-label="关闭主线交易选择" onClick={onClose}><X size={18} /></button>
    <h2 id="mainline-trade-title">主线可交易股票选择</h2><p className="mainline-trade-subtitle">在已确认主线及高强度分歧候选中筛选；涨停龙头只作方向参考，推荐关注仍可交易且具备资金地位的主板股票。</p>
    {loading && <TaskProgress label="正在建立参考核心池、可交易池并计算质量评分…" />}
    {result?.error && <div className="mainline-empty">可交易股票分析暂不可用：{result.error}</div>}
    {result?.status === "no_suitable_main_board_stock" && <div className="mainline-empty">no_suitable_main_board_stock：确认主线中暂无符合条件的A股主板可交易股票。</div>}
    {result && !result.error && <><div className="trade-candidate-context"><div><span>本次交易一级主线</span><strong>{(result.selected_primary_mainlines || []).join("、") || "--"}</strong><small>按一级主线综合评分，仅取前 {result.selected_mainline_limit ?? TRADE_MAINLINE_LIMIT} 条一级主线进行选股</small>{hasDivergenceCandidate && <small>含高强度分歧候选，尚未伪装为确认修复</small>}</div><div><span>今日可交易观察</span><strong>{currentBuy} 只</strong><small>质量等级不等于买点</small></div><div><span>等待位置</span><strong>{waiting} 只</strong><small>A档也可能需要等待</small></div></div><div className="trade-grade-tabs" role="tablist" aria-label="按股票质量等级筛选">{["A", "B", "C"].map((grade) => <button type="button" key={grade} role="tab" aria-selected={activeGrade === grade} className={activeGrade === grade ? "active" : ""} onClick={() => setActiveGrade(grade)}><b>{grade}档</b><span>{grade === "A" ? "核心质量" : grade === "B" ? "重点观察" : "普通跟随"}</span><small>{groups[grade].length} 只</small></button>)}</div><p className="trade-grade-hint">请以每只股票右侧的“今日状态”为实际操作依据；A档也可能显示“等待位置”。</p><div className="trade-candidate-grid">
      <div className={`trade-candidate-section grade-${activeGrade.toLowerCase()}`}><h3>{selectedGrade.title} <small>{activeGrade}档 · {groups[activeGrade].length} 只</small></h3><p className="trade-section-note">{selectedGrade.description}</p>{groups[activeGrade].length ? rows(groups[activeGrade]) : <p>暂无{activeGrade}档股票。</p>}</div>
      <details className="trade-candidate-section reference"><summary>主线龙头参考 <small>{result.reference_pool?.length || 0} 只 · 不参与实际买入</small></summary>{rows(result.reference_pool || []) || <p>暂无不可交易龙头参考。</p>}</details>
      <details className="trade-candidate-section rejected"><summary>淘汰股票 <small>{groups.rejected.length} 只 · 后排补涨、资金不足、非主板或不可交易</small></summary>{groups.rejected.length ? rows(groups.rejected) : <p>无淘汰股票。</p>}</details>
    </div></>}
  </div></div>;
}

function buildPrimaryPreviewGroups(scan, stockUniverse, primarySectors) {
  const quotes = new Map((scan?.stocks || []).map((stock) => [stock.code, stock]));
  const limitUpCodes = new Set((scan?.limitUpStocks || []).map((stock) => stock.code));
  const rows = new Map((primarySectors || []).map((sector) => [sector.name, { primary: sector.name, stockCodes: new Set(), changes: [], limitUpCount: 0 }]));
  for (const stock of stockUniverse || []) {
    const primaries = new Set((stock.classifications || []).map((item) => classificationPrimarySector(stock, item)).filter(Boolean));
    if (!primaries.size && stock.primary_sector) primaries.add(stock.primary_sector);
    for (const primary of primaries) {
      if (!rows.has(primary)) rows.set(primary, { primary, stockCodes: new Set(), changes: [], limitUpCount: 0 });
      const row = rows.get(primary), quote = quotes.get(stock.code);
      row.stockCodes.add(stock.code);
      if (Number.isFinite(Number(quote?.changePct))) row.changes.push(Number(quote.changePct));
      if (limitUpCodes.has(stock.code)) row.limitUpCount += 1;
    }
  }
  return [...rows.values()].map((row) => {
    const valid = row.changes.length, up = row.changes.filter((value) => value > 0).length;
    const average = valid ? row.changes.reduce((total, value) => total + value, 0) / valid : null;
    const likelihood = row.limitUpCount * 100 + up / Math.max(1, valid) * 20 + Math.max(0, average || 0) * 4;
    return { ...row, validMemberCount: valid, upCount: up, averageChange: average, likelihood };
  }).sort((left, right) => right.likelihood - left.likelihood || right.limitUpCount - left.limitUpCount || right.validMemberCount - left.validMemberCount || left.primary.localeCompare(right.primary, "zh-CN"));
}

function SystemMainlinePanel({ result, loading, date, scan, stockUniverse = [], primarySectors = [], capacityCoreResults = {}, capacityCoreLoading = {}, onLoadCapacityCore, leaderResults = {}, leaderLoading = {}, onLoadLeader }) {
  const [selectedPrimary, setSelectedPrimary] = useState(null);
  if (!result && !loading) return null;
  const tradePlanMode = null;
  const setTradePlanMode = () => {};
  const intradayAvailable = { available: false, reason: "" };
  const moduleThemes = result?.all_themes || result?.themes || [];
  const displayScore = (item) => Number.isFinite(item.mainline_rank_score) ? item.mainline_rank_score : item.score;
  const rankTheme = (left, right) => displayScore(right) - displayScore(left)
    || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name, "zh-CN");
  const rankGroupThemes = (items) => [...items].sort(rankTheme);
  const primaryGroups = Array.from(moduleThemes.reduce((groups, item) => {
    const group = groups.get(item.primary) || { primary: item.primary, items: [] };
    group.items.push(item);
    groups.set(item.primary, group);
    return groups;
  }, new Map()).values()).map((group) => ({ ...group, items: rankGroupThemes(group.items) }));
  const primaryRepresentative = (group) => group.items[0] || { name: group.primary, score: -Infinity };
  const rankPrimaryGroup = (left, right) => rankTheme(primaryRepresentative(left), primaryRepresentative(right))
    || left.primary.localeCompare(right.primary, "zh-CN");
  const rankedPrimaryGroups = [...primaryGroups].sort(rankPrimaryGroup);
  const orderedPrimaryGroups = rankedPrimaryGroups;
  return <section className="mainline-panel core-analysis-panel">
    <div className="mainline-heading"><div><div className="eyebrow">CORE STOCK ANALYSIS</div><h3>容量中军与题材龙头</h3><p>一级、二级方向均按既有综合评分降序排列；不再使用生命周期状态或启动门槛。</p></div></div>
    {loading && <TaskProgress className="mainline-empty" label="正在计算容量中军和题材龙头…" />}
    {result?.error && <div className="mainline-empty">核心识别暂不可用：{result.error}</div>}
    {!loading && !result?.error && <div className="primary-core-list">{orderedPrimaryGroups.map((group) => {
      const primarySector = primarySectors.find((sector) => sector.name === group.primary);
      const secondaryCount = primarySector?.secondary_sectors?.length || group.items.length;
      const representative = primaryRepresentative(group);
      const score = displayScore(representative);
      return <button type="button" className="primary-core-card" key={group.primary} onClick={() => setSelectedPrimary(group)}><span className="primary-core-card-copy"><strong>{group.primary}</strong><small>{secondaryCount} 个二级方向，已分析 {group.items.length} 个</small></span>{Number.isFinite(score) && <span className="primary-core-score"><small>综合分</small><b>{score.toFixed(1)}</b><em>/100</em></span>}<span className="primary-core-card-action">查看二级方向 <ChevronRight size={16} /></span></button>;
    })}</div>}
    {selectedPrimary && <PrimaryCoreAnalysisModal group={selectedPrimary} primarySector={primarySectors.find((sector) => sector.name === selectedPrimary.primary)} date={date} capacityCoreResults={capacityCoreResults} capacityCoreLoading={capacityCoreLoading} onLoadCapacityCore={onLoadCapacityCore} leaderResults={leaderResults} leaderLoading={leaderLoading} onLoadLeader={onLoadLeader} onClose={() => setSelectedPrimary(null)} />}
  </section>;
  /* Former cycle and trade-plan rendering below is retired and unreachable. */
  const labels = { started_theme: "已启动", mainline_candidate: "主线候选", confirmed_mainline: "确认主线", active_branch: "活跃分支", failed_emergence: "启动失效", unstarted: "未启动", candidate_mainline: "候选主线", forming_mainline: "正在形成", strong_branch: "强支线", core_stock_cluster: "核心驱动，广度不足", one_day_theme: "一日游题材", insufficient_data: "数据不足" };
  const allThemes = result?.themes || [];
  const replayScores = result?.mainline_replay_scores;
  const scoreForTheme = (item) => replayScores?.theme_totals?.[item.key || `${item.primary}__${item.name}`] ?? item.score;
  const allGroups = allThemes.reduce((all, item) => {
    (all[item.primary] ||= []).push({ ...item, replay_total_score: scoreForTheme(item) }); return all;
  }, {});
  const primaryRankingScore = (items) => {
    const ranked = items
      .map((item) => {
        const key = item.key || `${item.primary}__${item.name}`;
        const scoringDays = Math.max(1, replayScores?.theme_scoring_days?.[key] || 1);
        return { ...item, intervalScore: Number.isFinite(item.replay_total_score) ? item.replay_total_score / scoringDays : item.score };
      })
      .filter((item) => Number.isFinite(item.intervalScore))
      .sort((left, right) => right.intervalScore - left.intervalScore);
    if (!ranked.length) return null;
    const top = ranked.slice(0, 3), primary = items[0]?.primary;
    const topAverage = top.reduce((sum, item) => sum + item.intervalScore, 0) / top.length;
    const series = (replayScores?.primary_daily?.[primary] || []).filter((day) => Number.isFinite(day.primary_return_pct) && Number.isFinite(day.market_return_pct));
    const downDays = series.filter((day) => day.market_return_pct < 0);
    const upDays = series.filter((day) => day.market_return_pct > 0);
    const resilience = downDays.length ? downDays.filter((day) => day.primary_return_pct >= day.market_return_pct).length / downDays.length : 0.5;
    const leadership = upDays.length ? upDays.filter((day) => day.primary_return_pct >= day.market_return_pct + 0.3).length / upDays.length : 0.5;
    const stability = series.length ? series.filter((day) => day.primary_return_pct >= 0 || day.primary_return_pct >= day.market_return_pct).length / series.length : 0;
    const previousStages = new Map(), pendingRecoveries = new Map();
    let divergenceEvents = 0, recoveredEvents = 0;
    for (const day of series) for (const item of day.stages || []) {
      const previousStage = previousStages.get(item.key);
      if (["normal_divergence", "strong_divergence"].includes(item.stage) && !["normal_divergence", "strong_divergence"].includes(previousStage)) {
        divergenceEvents += 1;
        pendingRecoveries.set(item.key, true);
      }
      if (pendingRecoveries.get(item.key) && ["repair", "re_strengthening", "acceleration"].includes(item.stage)) {
        recoveredEvents += 1;
        pendingRecoveries.set(item.key, false);
      }
      previousStages.set(item.key, item.stage);
    }
    const recovery = divergenceEvents ? recoveredEvents / divergenceEvents : 0.5;
    const currentRetreat = series.at(-1)?.stages?.every((item) => ["retreat_warning", "retreat_confirmed", "downtrend_continuation", "downtrend_stabilizing", "post_retreat_rebound", "rebound_failed", "weakening_again"].includes(item.stage));
    const trendScore = recovery * 35 + resilience * 25 + leadership * 25 + stability * 15;
    return {
      score: series.length >= 2 ? trendScore * (currentRetreat ? 0.45 : 1) : topAverage * 0.4,
      resilience,
      leadership,
      recovery,
      stability,
      topAverage,
      validatedDays: series.length,
    };
  };
  const themeTrendScore = (item) => {
    const series = (replayScores?.primary_daily?.[item.primary] || []).map((day) => {
      const observation = (day.stages || []).find((entry) => entry.key === item.key);
      return { ...observation, market_return_pct: day.market_return_pct };
    }).filter((day) => Number.isFinite(day?.return_pct) && Number.isFinite(day.market_return_pct));
    const key = item.key || `${item.primary}__${item.name}`;
    const scoringDays = Math.max(1, replayScores?.theme_scoring_days?.[key] || 1);
    const fallback = Number.isFinite(item.replay_total_score) ? item.replay_total_score / scoringDays * 0.4 : item.score ?? 0;
    if (series.length < 2) return { score: fallback, validatedDays: series.length };
    const downDays = series.filter((day) => day.market_return_pct < 0);
    const upDays = series.filter((day) => day.market_return_pct > 0);
    const resilience = downDays.length ? downDays.filter((day) => day.return_pct >= day.market_return_pct).length / downDays.length : 0.5;
    const leadership = upDays.length ? upDays.filter((day) => day.return_pct >= day.market_return_pct + 0.3).length / upDays.length : 0.5;
    const stability = series.filter((day) => day.return_pct >= 0 || day.return_pct >= day.market_return_pct).length / series.length;
    let divergenceEvents = 0, recoveredEvents = 0, awaitingRecovery = false, previousStage = "";
    for (const day of series) {
      if (["normal_divergence", "strong_divergence"].includes(day.stage) && !["normal_divergence", "strong_divergence"].includes(previousStage)) { divergenceEvents += 1; awaitingRecovery = true; }
      if (awaitingRecovery && ["repair", "re_strengthening", "acceleration"].includes(day.stage)) { recoveredEvents += 1; awaitingRecovery = false; }
      previousStage = day.stage;
    }
    const recovery = divergenceEvents ? recoveredEvents / divergenceEvents : 0.5;
    const retreating = ["retreat_warning", "retreat_confirmed", "downtrend_continuation", "downtrend_stabilizing", "post_retreat_rebound", "rebound_failed", "weakening_again"].includes(series.at(-1)?.stage);
    return { score: (recovery * 35 + resilience * 25 + leadership * 25 + stability * 15) * (retreating ? 0.45 : 1), recovery, resilience, leadership, stability, validatedDays: series.length };
  };
  const groups = previews.map((preview) => {
    const items = (allGroups[preview.primary] || []).map((item) => ({ ...item, trend_validation: themeTrendScore(item) })).sort((left, right) => right.trend_validation.score - left.trend_validation.score || (right.replay_total_score ?? -Infinity) - (left.replay_total_score ?? -Infinity) || (right.score ?? -Infinity) - (left.score ?? -Infinity)).map((item, index) => ({ ...item, rank: index + 1 }));
    return { preview: { ...preview, mainlineLeadership: primaryRankingScore(items) }, items };
  })
    .sort((left, right) => {
      const leftScore = primaryRankingScore(left.items), rightScore = primaryRankingScore(right.items);
      if (Number.isFinite(leftScore?.score) && Number.isFinite(rightScore?.score)) return rightScore.score - leftScore.score || right.preview.likelihood - left.preview.likelihood;
      if (Number.isFinite(leftScore?.score)) return -1;
      if (Number.isFinite(rightScore?.score)) return 1;
      return right.preview.likelihood - left.preview.likelihood;
    });
  return <section className="mainline-panel">
    <div className="mainline-heading"><div><div className="eyebrow">FORWARD-ONLY MAINLINE</div><h3>主线识别系统</h3><p>仅使用 {result?.date || date} 及此前行情；次日赚钱效应不参与当天评分，因此不会使用未来函数。</p></div><div className="mainline-plan-actions"><button type="button" className="mainline-history-button" disabled={!intradayAvailable.available} title={intradayAvailable.reason} onClick={() => setTradePlanMode(intradayAvailable.mode)}><BarChart3 size={14} /> 今天可买入计划</button><button type="button" className="mainline-history-button" onClick={() => setTradePlanMode("end_of_day")}><BarChart3 size={14} /> 明日计划</button></div></div>
    {loading && <TaskProgress className="mainline-empty" label="一级主线已按当日涨停、上涨广度和平均涨幅排好顺序；正在后台补全日线评分、容量中军和题材龙头…" />}
    {result?.error && <div className="mainline-empty">主线深度计算暂不可用：{result.error}。下方仍保留当日快照排序，稍后可重新读取当日涨幅。</div>}
    {result && !result.error && !result.mainline_eligible && <div className="mainline-empty">{result.market_summary?.valid_stock_count != null ? "全市场有效股票数不足 3,000，结果仅供观察，不进行正式市场排名。" : (result.warnings?.[0] || "历史行情数据不足，暂不进行正式市场排名。")}</div>}
    {result?.cycle_replay && <div className="mainline-empty">周期回放：{result.cycle_replay.start_date} 至 {result.cycle_replay.end_date}，已按 {result.cycle_replay.trading_days} 个交易日逐日推演；当前卡片展示截止日结论。</div>}
    {result?.market_summary?.quote_snapshot && <div className="mainline-quote-timestamp">行情时间：{result.market_summary.quote_snapshot.latest_quote_time || "未知"} · 抓取时间：{result.market_summary.quote_snapshot.captured_at ? new Date(result.market_summary.quote_snapshot.captured_at).toLocaleString("zh-CN", { hour12: false }) : "历史文件未记录"} · {result.market_summary.quote_snapshot.closing_confirmed ? "已确认收盘" : "未确认收盘"}</div>}
    <div className="mainline-list">{groups.map(({ preview, items }) => <PrimaryMainlineGroup key={preview.primary} preview={preview} items={items} labels={labels} date={date} loading={loading} capacityCoreResults={capacityCoreResults} capacityCoreLoading={capacityCoreLoading} onLoadCapacityCore={onLoadCapacityCore} leaderResults={leaderResults} leaderLoading={leaderLoading} onLoadLeader={onLoadLeader} />)}</div>
    {tradePlanMode && <TradePlanModal date={date} mode={tradePlanMode} onClose={() => setTradePlanMode(null)} />}
  </section>;
}

function canGenerateIntradayPlan(date) {
  const now = new Date();
  const current = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const marketDay = ![0, 6].includes(now.getDay());
  if (date > current) return { available: false, mode: null, reason: "尚未到该日期，不能生成当日计划。" };
  if (date < current) return { available: true, mode: "intraday", reason: "该历史交易日已结束，将使用该日完整收盘数据生成复盘版当日计划。" };
  if (!marketDay) return { available: false, mode: null, reason: "今日不是交易日，无法生成当日可买入计划。" };
  if (minuteOfDay < 570) return { available: false, mode: null, reason: "今日尚未开盘，暂时没有当日盘中数据可供判断。" };
  return { available: true, mode: "intraday", reason: minuteOfDay >= 900 ? "收盘后将直接使用今日完整收盘行情生成复盘版结果。" : "仅使用截至当前时点的已发生行情生成。" };
}

function TradePlanModal({ date, mode, onClose }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
      const params = new URLSearchParams({ date });
      if (mode === "intraday") params.set("mode", mode);
    fetch(`/api/trade-plan?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "交易计划生成失败");
        return payload;
      })
      .then((payload) => { if (!cancelled) setPlan(payload); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, mode]);
  const actionLabels = { watch: "观察", probe_candidate: "试仓候选", entry_candidate: "进场候选", hold: "持有", add_candidate: "加仓候选", reduce: "减仓", exit: "退出", no_trade: "不交易" };
  const actionOrder = ["entry_candidate", "probe_candidate", "hold", "add_candidate", "reduce", "exit", "watch"];
  const allThemes = plan ? actionOrder.flatMap((action) => plan.themes.filter((theme) => theme.theme_action === action)) : [];
  const visibleThemes = actionFilter === "all" ? allThemes : allThemes.filter((theme) => theme.theme_action === actionFilter);
  const counts = Object.fromEntries(actionOrder.map((action) => [action, plan?.themes?.filter((theme) => theme.theme_action === action).length || 0]));
  const intraday = mode === "intraday";
  const preopen = mode === "preopen";
  const closingReview = intraday && plan?.snapshot_type === "closing";
  const title = intraday || preopen ? "当日可买入研究计划" : "下一交易日研究计划";
  const description = intraday
    ? (closingReview ? `使用 ${date} 的完整收盘行情生成当日复盘版结果；仅作研究结论，不构成自动下单指令。` : `仅使用截至当前快照的盘中已发生行情，计划用于 ${plan?.action_for_date || date} 的剩余交易时段；仅作研究结论，不构成自动下单指令。`)
    : preopen
      ? `仅使用 ${plan?.available_data_end_date || "前一交易日"} 收盘及更早数据，为 ${date} 开盘前生成研究计划；不使用 ${date} 当天及之后行情。`
    : `基于 ${date} 收盘及以前数据生成，计划用于 ${plan?.action_for_date || "下一交易日"}；仅作研究结论，不构成自动下单指令。`;
  const filterHint = actionFilter === "all" ? "点击上方状态，只显示对应题材。" : `当前仅显示“${actionLabels[actionFilter]}”；再次点击该状态可显示全部。`;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal trade-plan-modal" role="dialog" aria-modal="true" aria-labelledby="trade-plan-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭交易计划" onClick={onClose}><X size={18} /></button><h2 id="trade-plan-title">{title}</h2><p className="modal-sub">{description}</p>{loading ? <TaskProgress className="trade-plan-loading" label={intraday ? "正在读取今日实时行情、主线、周期、龙头和容量中军结果，并生成今日可买入计划…" : preopen ? "正在读取前一交易日及更早数据，生成当日开盘前计划…" : "正在读取主线、周期、龙头和容量中军结果，并生成下一交易日研究计划…"} /> : error ? <div className="trade-plan-error">交易计划暂不可用：{error}</div> : <><div className="trade-plan-meta"><span>{intraday ? (closingReview ? "收盘数据" : "快照截至") : preopen ? "数据截至" : "数据截至"} <b>{plan.available_data_end || plan.available_data_end_date}</b></span><span>{intraday ? (closingReview ? "结果类型" : "适用时段") : preopen ? "适用日期" : "计划日期"} <b>{intraday ? (closingReview ? "收盘后复盘版" : "当日剩余交易时段") : plan.action_for_date}</b></span><span>仓位 <b>需用户配置</b></span></div><div className="trade-plan-summary" aria-label="按交易状态筛选">{actionOrder.map((action) => <button type="button" key={action} className={`trade-plan-count ${action} ${actionFilter === action ? "active" : ""}`} aria-pressed={actionFilter === action} title={actionFilter === action ? "再次点击显示全部状态" : `只显示${actionLabels[action]}`} onClick={() => setActionFilter((current) => current === action ? "all" : action)}><b>{counts[action]}</b><span>{actionLabels[action]}</span></button>)}</div><p className="trade-plan-filter-hint" aria-live="polite">{filterHint}</p>{visibleThemes.length ? <div className="trade-plan-list">{visibleThemes.map((theme) => <article className={`trade-plan-row ${theme.theme_action}`} key={theme.theme_key || theme.theme}><div><span className="trade-plan-action">{actionLabels[theme.theme_action]}</span><h3>{theme.theme}</h3><p>周期：{cycleStageText(theme.cycle_stage)} · 入场质量 {theme.scores?.entry_quality ?? "-"} · 持有质量 {theme.scores?.hold_quality ?? "-"} · 退出风险 {theme.scores?.exit_risk ?? "-"}</p>{theme.eligible_stocks?.length > 0 && <small>{theme.eligible_stocks.slice(0, 3).map((stock, index) => <Fragment key={stock.code}>{index > 0 && "、"}{stock.code || "------"} <StockName code={stock.code} name={stock.name} />（{stock.role === "leader" ? "龙头" : stock.role === "capacity_core" ? "容量中军" : "高弹性"}）</Fragment>)}</small>}</div><p className="trade-plan-reason">{theme.reason}</p></article>)}</div> : <div className="trade-plan-empty"><strong>{actionFilter === "all" ? (intraday || preopen ? "当前没有合格的当日买入机会" : "今天没有合格交易机会") : `没有“${actionLabels[actionFilter]}”状态的题材`}</strong><p>{actionFilter === "all" ? "没有题材满足进场、试仓、持有、加仓、减仓或退出的完整条件。当前不强行输出股票候选。" : "可点击其他状态查看，或再次点击当前状态恢复显示全部。"}</p>{actionFilter === "all" && plan.next_day_plan?.no_trade_reasons?.slice(0, 4).map((item) => <small key={item.theme}>{item.theme}：{item.reason}</small>)}</div>}</>}</div></div>;
}

function cycleStageText(stage) {
  return ({ unstarted: "未启动", emergence: "启动", startup_continuation: "启动延续", fermentation: "发酵", normal_divergence: "正常分歧", divergence_continuation: "分歧延续", persistent_weakening: "持续转弱", strong_divergence: "强分歧", repair: "分歧修复", re_strengthening: "重新增强", retreat_warning: "退潮预警", retreat_confirmed: "退潮确认", downtrend_continuation: "下跌延续", downtrend_stabilizing: "跌势趋稳", post_retreat_rebound: "退潮后反弹", rebound_failed: "反弹失败", weakening_again: "再次走弱" })[stage] || "-";
}

function dailyConditionText(condition) {
  return cycleStageText(condition);
}

function profitEffectText(status) {
  return ({ strong: "强", normal: "正常", weakening: "弱化", deteriorating: "恶化", insufficient_data: "数据不足" })[status] || "数据不足";
}

function cycleTransitionText(transition) {
  if (!transition) return "";
  const [from, to] = transition.split("->");
  return `${cycleStageText(from)} → ${cycleStageText(to)}`;
}

function CycleTimeline({ cycle = {}, scoreContext = null }) {
  const timeline = cycle.timeline || [];
  const confirmationText = { confirmed: "已确认", provisional: "候选中", pending: "已计算，未满足条件", insufficient_new_evidence: "起始日缺少前一交易日基线", invalid_transition: "非法转换已拦截" };
  if (!timeline.length) return <div className="cycle-timeline-empty">暂无可用的逐日周期记录；重新分析后会生成最近交易日的启动与发酵轨迹。</div>;
  const firstStage = (stage) => timeline.find((entry) => entry.confirmation_status === "confirmed" && entry.confirmed_stage === stage);
  const firstStart = firstStage("emergence");
  const firstFermentation = firstStart ? firstStage("fermentation") : null;
  const current = timeline.at(-1);
  const [selectedDate, setSelectedDate] = useState(current?.date || timeline[0]?.date);
  const selected = timeline.find((entry) => entry.date === selectedDate) || current;
  const dailyScoreText = (entry) => Number.isFinite(Number(entry?.daily_strength_score)) ? `${Math.round(Number(entry.daily_strength_score))}分` : "评分待计算";
  const mainlineScore = Number(scoreContext?.mainline_rank_score);
  const mainlineParts = [
    ["近5日强度", 50, scoreContext?.recent_strength_score],
    ["资金持续", 20, scoreContext?.capital_persistence_score],
    ["抗分歧修复", 20, scoreContext?.resilience_repair_score],
    ["持续活跃", 10, scoreContext?.continuity_score],
  ].map(([label, weight, score]) => ({ label, weight, score: Number(score), contribution: Number.isFinite(Number(score)) ? Number(score) * weight / 100 : null }));
  const calendarRef = useRef(null);
  const [visibleCalendarMonth, setVisibleCalendarMonth] = useState(() => timeline[0]?.date?.slice(0, 7) || "");
  const handleCalendarScroll = (event) => {
    const calendar = event.currentTarget;
    const top = calendar.getBoundingClientRect().top;
    const firstVisibleDay = [...calendar.querySelectorAll(".cycle-calendar-day")]
      .find((day) => day.getBoundingClientRect().bottom > top + 36);
    const month = firstVisibleDay?.title?.slice(0, 7);
    if (month) setVisibleCalendarMonth((currentMonth) => currentMonth === month ? currentMonth : month);
  };
  const entries = new Map(timeline.map((entry) => [entry.date, entry]));
  const timelineDates = [...entries.keys()].filter(Boolean).sort();
  const firstCalendarDay = new Date(`${timelineDates[0]}T12:00:00Z`);
  const lastCalendarDay = new Date(`${timelineDates.at(-1)}T12:00:00Z`);
  firstCalendarDay.setUTCDate(firstCalendarDay.getUTCDate() - ((firstCalendarDay.getUTCDay() + 6) % 7));
  lastCalendarDay.setUTCDate(lastCalendarDay.getUTCDate() + ((5 - ((lastCalendarDay.getUTCDay() + 6) % 7) + 7) % 7));
  const cells = [];
  for (const day = new Date(firstCalendarDay); day <= lastCalendarDay; day.setUTCDate(day.getUTCDate() + 1)) {
    if ([0, 6].includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10);
    cells.push({ date, entry: entries.get(date) || { stage: "calendar_placeholder", confidence: 0 } });
  }
  const months = [{ month: "", cells }];
  return <section className="cycle-timeline" aria-label="题材周期轨迹">
    <header>
      <div><h3>板块周期</h3><p>按交易日逐日展示。每一天均以昨日识别的龙头和容量中军，结合当日板块广度与赚钱效应判定。</p></div>
      <span>当前：<b className={`cycle-stage-tag ${current?.stage || "unstarted"}`}>{cycleStageText(current?.confirmed_stage || current?.stage || current?.cycle_stage)}</b></span>
    </header>
    <div className="cycle-milestones">
      <span><small>首次启动（已确认）</small><b>{firstStart?.date || "尚未确认"}</b></span>
      <span><small>首次发酵（已确认）</small><b>{firstFermentation?.date || (firstStart ? "尚未确认发酵" : "无合法启动，不显示")}</b></span>
      <span><small>当前确认状态</small><b>{confirmationText[current?.confirmation_status] || "-"} · 当日 {dailyScoreText(current)}</b></span>
    </div>
    <div className="cycle-calendar" ref={calendarRef} onScroll={handleCalendarScroll} aria-label="按月查看交易日周期；鼠标滚轮上下可翻月">
      <div className="cycle-calendar-month-label">{visibleCalendarMonth ? visibleCalendarMonth.replace("-", "年") + "月" : ""}</div>
      {months.map(({ month, cells }) => <section className="cycle-calendar-month" key={month} aria-label="交易日周期"><h4>{month}</h4><div className="cycle-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五"].map((day) => <span key={day}>周{day}</span>)}</div><div className="cycle-calendar-grid">{cells.map(({ date, entry }) => entry ? <button type="button" key={date} className={`cycle-calendar-day ${entry.stage || "unstarted"} ${selected?.date === date ? "selected" : ""}`} aria-pressed={selected?.date === date} title={`${date}：${cycleStageText(entry.stage)}`} onClick={() => setSelectedDate(date)}><time>{date.slice(8)}</time><strong>{cycleStageText(entry.confirmed_stage || entry.stage)}</strong><small>{dailyScoreText(entry)}</small></button> : <span className="cycle-calendar-empty" key={date} aria-label={`${date} 非交易日`} />)}</div></section>)}</div>
    <div className={`cycle-evidence ${selected?.stage || "unstarted"}`} aria-live="polite"><div className="cycle-evidence-heading"><b>{selected?.date}</b><span className={`cycle-stage-tag ${selected?.stage || "unstarted"}`}>{cycleStageText(selected?.confirmed_stage || selected?.stage)}</span><small>{confirmationText[selected?.confirmation_status] || selected?.confirmation_status} · 当日 {dailyScoreText(selected)}</small></div><b>龙头：{selected?.metrics?.previous_leaders?.length ? `${selected.metrics.previous_leaders.map((stock) => `${stock.name || stock.code} ${stock.change_pct ?? "-"}%`).join("、")}；${selected.metrics.leader_status || "-"}${selected.metrics.leader_drives_theme ? "，仍在带动板块" : ""}` : "前一日龙头数据不足"}</b><b>容量中军：{selected?.metrics?.previous_capacity_cores?.length ? `${selected.metrics.previous_capacity_cores.map((stock) => `${stock.name || stock.code} ${stock.change_pct ?? "-"}%`).join("、")}；${selected.metrics.capacity_core_status || "-"}${selected.metrics.capacity_core_long_upper_count ? `，长上影 ${selected.metrics.capacity_core_long_upper_count} 只` : ""}` : "前一日容量中军数据不足"}</b><b>板块整体：上涨 {selected?.metrics?.up_count ?? "-"} 只，涨停 {selected?.metrics?.limit_up_count ?? "-"} 只，大涨 {selected?.metrics?.high_gain_count ?? "-"} 只，大跌 {selected?.metrics?.large_loss_count ?? "-"} 只</b><b>连续性：连续走弱 {selected?.weakening_continuity?.weakening_streak ?? 0} 日；收益中位数连续为负 {selected?.weakening_continuity?.median_negative_days ?? 0} 日；活跃成员连续减少 {selected?.weakening_continuity?.active_member_decline_days ?? 0} 日；相对强度连续下降 {selected?.weakening_continuity?.relative_strength_decline_days ?? 0} 日；核心同步走弱 {selected?.weakening_continuity?.core_weakening_days ?? 0} 日</b><b>赚钱效应：{profitEffectText(selected?.metrics?.profit_effect?.profit_effect)}；前排中位收益 {selected?.metrics?.profit_effect?.frontline_next_day_median_return ?? "-"}%、上涨占比 {selected?.metrics?.profit_effect?.frontline_positive_rate != null ? `${Math.round(selected.metrics.profit_effect.frontline_positive_rate * 100)}%` : "-"}；活跃成员中位收益 {selected?.metrics?.profit_effect?.active_member_next_day_median_return ?? "-"}%、上涨占比 {selected?.metrics?.profit_effect?.active_member_positive_rate != null ? `${Math.round(selected.metrics.profit_effect.active_member_positive_rate * 100)}%` : "-"}；昨日涨停中位收益 {selected?.metrics?.profit_effect?.limit_up_next_day_median_return ?? "-"}%；严重负反馈 {selected?.metrics?.profit_effect?.severe_negative_rate != null ? `${Math.round(selected.metrics.profit_effect.severe_negative_rate * 100)}%` : "-"}</b><b>核心反馈：龙头 {selected?.metrics?.profit_effect?.leader_feedback || "数据不足"}；中军 {selected?.metrics?.profit_effect?.capacity_core_feedback || "数据不足"}；普通成员 {selected?.metrics?.profit_effect?.ordinary_member_feedback || "数据不足"}</b><b>正式启动门槛：涨停辨识度 {selected?.emergence_result?.has_limit_up_recognition ? "通过" : "未通过"}；板块涨幅前列 {selected?.emergence_result?.theme_return_leading ? "通过" : "未通过"}；中军涨幅前列 {selected?.emergence_result?.capacity_return_leading ? "通过" : "未通过"}</b><b>判定依据：{[...(selected?.positive_evidence || []), ...(selected?.negative_evidence || []), ...(selected?.emergence_result?.positive_evidence || []), ...(selected?.emergence_result?.negative_evidence || [])].join("、") || "证据不足，保留前一状态"}</b><b>缺失数据：{selected?.missing_evidence?.join("、") || "无"}</b></div>
    {Number.isFinite(mainlineScore) && <section className="cycle-score-detail" aria-label="主线评分构成"><header><b>主线评分构成</b><strong>{Math.round(mainlineScore)}/100</strong></header><p>{selected?.date === current?.date ? "当前日的主线分按以下固定权重计算。" : "当前主线分按以下固定权重计算；所选历史日的分数见日历。"}</p><div>{mainlineParts.map((part) => <span key={part.label}><small>{part.label} · 权重 {part.weight}%</small><b>{Number.isFinite(part.score) ? Math.round(part.score) : "-"}</b><em>{part.contribution != null ? `贡献 ${part.contribution.toFixed(1)} 分` : "数据不足"}</em></span>)}</div></section>}
    <p className="cycle-core-pool-summary">中军池汇总：有效池 {selected?.metrics?.capacity_core_pool_size ?? "-"} 只；正向 {selected?.metrics?.capacity_core_positive_count ?? "-"} 只（{selected?.metrics?.capacity_core_positive_count_ratio != null ? `${Math.round(selected.metrics.capacity_core_positive_count_ratio * 100)}%` : "-"}），正向权重 {selected?.metrics?.capacity_core_positive_weight != null ? `${Math.round(selected.metrics.capacity_core_positive_weight * 100)}%` : "-"}；中性权重 {selected?.metrics?.capacity_core_neutral_weight != null ? `${Math.round(selected.metrics.capacity_core_neutral_weight * 100)}%` : "-"}；弱响应权重 {selected?.metrics?.capacity_core_weak_weight != null ? `${Math.round(selected.metrics.capacity_core_weak_weight * 100)}%` : "-"}；严重破位权重 {selected?.metrics?.capacity_core_severe_weight != null ? `${Math.round(selected.metrics.capacity_core_severe_weight * 100)}%` : "-"}；池加权收益 {selected?.metrics?.capacity_core_pool_weighted_return?.toFixed?.(2) ?? "-"}%；状态 {selected?.metrics?.core_pool_status || "数据不足"}</p>
    <p className="cycle-timeline-note">说明：阶段由当日及此前数据推断；它用于回看题材何时出现启动、发酵或转弱证据，不代表未来走势。</p>
  </section>;
}

function PrimaryMainlineGroup({ preview, items, labels, date, loading, capacityCoreResults, capacityCoreLoading, onLoadCapacityCore, leaderResults, leaderLoading, onLoadLeader }) {
  const [open, setOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState("all");
  const confirmed = items.filter((item) => item.status === "confirmed_mainline").length;
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const pending = items.filter((item) => (item.breadth?.valid_member_count || 0) >= 3)
      .map((item) => ({ item, key: date + "|" + item.primary + "|" + item.name }))
      .filter(({ key }) => !capacityCoreResults[key] || !leaderResults[key]);
    const run = async () => {
      const queue = [...pending];
      const worker = async () => {
        while (!cancelled && queue.length) {
          const next = queue.shift();
          if (!next) return;
          const target = { primary: next.item.primary, secondary: next.item.name };
          await Promise.all([
            !capacityCoreResults[next.key] && !capacityCoreLoading[next.key] ? onLoadCapacityCore(target) : Promise.resolve(),
            !leaderResults[next.key] && !leaderLoading[next.key] ? onLoadLeader(target) : Promise.resolve(),
          ]);
        }
      };
      await Promise.all([worker(), worker()]);
    };
    run();
    return () => { cancelled = true; };
  }, [open, date]);
  const stages = [["all", "全部阶段"], ["unstarted", "未启动"], ["emergence", "启动"], ["fermentation", "发酵"], ["acceleration", "加速"], ["normal_divergence", "正常分歧"], ["divergence_continuation", "分歧延续"], ["persistent_weakening", "持续转弱"], ["strong_divergence", "趋势未被破坏，强分歧"], ["repair", "趋势延续，修复"], ["re_strengthening", "重新增强"], ["retreat_warning", "退潮预警"], ["retreat_confirmed", "退潮确认"], ["downtrend_continuation", "下跌延续"], ["downtrend_stabilizing", "跌势趋稳"], ["post_retreat_rebound", "退潮后反弹"], ["rebound_failed", "反弹失败"], ["weakening_again", "再次走弱"]];
  const getStage = (item) => item.cycle_stage?.cycle_stage || "unknown";
  const countForStage = (stage) => stage === "all" ? items.length : items.filter((item) => getStage(item) === stage).length;
  const visibleItems = stageFilter === "all" ? items : items.filter((item) => getStage(item) === stageFilter);
  const primaryName = preview.primary;
  const leadership = preview.mainlineLeadership;
  const headline = items.length ? (leadership?.validatedDays >= 2 ? `趋势主线验证 ${Math.round(leadership.score)}/100 · 抗跌 ${Math.round(leadership.resilience * 100)}% · 领涨 ${Math.round(leadership.leadership * 100)}% · 修复 ${Math.round(leadership.recovery * 100)}%` : `趋势验证天数不足，暂按当日强度排序 · 最高 ${items[0].score ?? "-"}/100`) : loading ? "正在计算日线评分" : "暂无可评分二级方向";
  return <section className="primary-mainline-group"><header><div><strong>{primaryName}</strong><small>{items.length ? `${items.length} 个已计算二级方向 · ${headline}` : `${preview.limitUpCount} 只涨停 · ${preview.validMemberCount} 只有效行情 · ${headline}`}</small></div><button type="button" className="mainline-history-button" disabled={!items.length} title={items.length ? "查看该一级主线下全部已计算二级方向" : (loading ? "后台计算完成后可查看二级方向" : "该一级主线没有满足数据条件的二级方向")} onClick={() => { setStageFilter("all"); setOpen(true); }}>查看二级方向</button></header>{open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><div className="modal primary-directions-modal" role="dialog" aria-modal="true" aria-labelledby={`primary-${primaryName}`} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭二级方向" onClick={() => setOpen(false)}><X size={18} /></button><div className="modal-kicker">一级主线</div><h2 id={`primary-${primaryName}`}>{primaryName}</h2><p className="modal-sub">{items.length} 个已计算二级方向，按主线综合评分排序；包括未进入首页重点列表的方向。选择周期阶段可快速筛选查看。</p><div className="stage-filter-bar" aria-label="按周期阶段筛选">{stages.map(([stage, label]) => { const count = countForStage(stage); return <button type="button" key={stage} className={stageFilter === stage ? "active" : ""} disabled={!count} onClick={() => setStageFilter(stage)}>{label}<b>{count}</b></button>; })}</div><div className="primary-mainline-directions">{visibleItems.map((item) => <SystemThemeCard key={item.key} item={item} labels={labels} date={date} capacityCoreResults={capacityCoreResults} capacityCoreLoading={capacityCoreLoading} onLoadCapacityCore={onLoadCapacityCore} leaderResults={leaderResults} leaderLoading={leaderLoading} onLoadLeader={onLoadLeader} />)}</div></div></div>}</section>;
}

function SystemThemeCard({ item, labels, date, capacityCoreResults, capacityCoreLoading, onLoadCapacityCore, leaderResults, leaderLoading, onLoadLeader }) {
  const [showTimeline, setShowTimeline] = useState(false);
  const target = { primary: item.primary, secondary: item.name, showTertiaryDrivers: item.status === "core_stock_cluster", tertiaryDrivers: item.core_driven_tertiaries || [], trendValidation: item.trend_validation || null }, key = `${date}|${item.primary}|${item.name}`;
  const capacity = capacityCoreResults[key], leader = leaderResults[key];
  const cycleLabels = { unstarted: "未启动", emergence: "启动", fermentation: "发酵", acceleration: "加速", normal_divergence: "正常分歧", divergence_continuation: "分歧延续", persistent_weakening: "持续转弱", strong_divergence: "趋势未被破坏，强分歧", repair: "趋势延续，修复", re_strengthening: "重新增强", retreat_warning: "退潮预警", retreat_confirmed: "退潮确认", downtrend_continuation: "下跌延续", downtrend_stabilizing: "跌势趋稳", post_retreat_rebound: "退潮后反弹", rebound_failed: "反弹失败", weakening_again: "再次走弱" };
  const expansionLabels = { expanding: "扩张中", stable: "平稳", shrinking: "收缩中", rapidly_shrinking: "快速收缩" };
  const profitLabels = { improving: "次日改善", healthy: "次日健康", deteriorating: "次日恶化", collapsed: "次日崩塌", unavailable: "暂无次日反馈" };
  const cycle = item.cycle_stage || {};
  return <article className="mainline-card pending"><div className="mainline-rank">#{item.rank ?? "-"}</div><div className="mainline-core"><div className="mainline-path">{item.name}</div><h4>{labels[item.status] || item.status}</h4><p>综合分 <b>{Number.isFinite(item.score) ? `${item.score}/100` : "数据不足"}</b> · 周期 <b>{cycleLabels[cycle.confirmed_stage || cycle.cycle_stage] || "-"}</b>{cycle.daily_condition ? ` · 当日${dailyConditionText(cycle.daily_condition)}` : ""}{cycle.confirmation_status ? `（${cycle.confirmation_status} · ${Math.round((cycle.stage_confidence || 0) * 100)}%）` : ""}</p><small>核心结构 {item.score_details?.core_structure ?? "-"}/20 · 广度 {item.score_details?.breadth ?? "-"}/25 · 梯队 {item.score_details?.hierarchy ?? "-"}/15 · 持续性 {item.score_details?.continuity ?? "-"}/15 · 相对强度 {item.score_details?.relative_strength ?? "-"}/10 · 分歧修复 {item.score_details?.divergence_repair ?? "待检验"}/15</small><small>涨停 {item.breadth?.limit_up_count ?? "-"} · 大涨 {item.breadth?.high_gain_count ?? "-"} · 上涨占比 {item.breadth?.up_ratio != null ? `${Math.round(item.breadth.up_ratio * 100)}%` : "-"} · 扩张 {expansionLabels[cycle.expansion_status] || "待判断"} · 赚钱效应 {profitLabels[cycle.profit_effect_status] || "待判断"}</small><div className="mainline-card-actions"><button type="button" className="mainline-history-button" onClick={() => setShowTimeline(true)}><BarChart3 size={13} /> 查看周期轨迹</button></div><MainlineCoreModules target={target} capacity={capacity} leader={leader} loadingCapacity={capacityCoreLoading[key]} loadingLeader={leaderLoading[key]} onLoadCapacityCore={onLoadCapacityCore} onLoadLeader={onLoadLeader} />{showTimeline && <div className="modal-backdrop" onMouseDown={() => setShowTimeline(false)}><div className="modal cycle-timeline-modal" role="dialog" aria-modal="true" aria-labelledby={`cycle-${item.key}`} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭周期轨迹" onClick={() => setShowTimeline(false)}><X size={18} /></button><h2 id={`cycle-${item.key}`}>{item.primary} · {item.name}</h2><p className="modal-sub">主周期保持连续；当天整理、分歧和修复会单独标注，不会把活跃题材误写为未启动。</p><CycleTimeline cycle={cycle} scoreContext={item} /></div></div>}</div><div className="mainline-status">{labels[item.status] || item.status}</div></article>;
}

function MainlineCoreModules({ target, capacity, leader, loadingCapacity, loadingLeader, onLoadCapacityCore, onLoadLeader }) {
  const [activeModule, setActiveModule] = useState(null);
  const openModule = async (type) => {
    const result = type === "capacity" ? capacity : leader;
    const loading = type === "capacity" ? loadingCapacity : loadingLeader;
    if (!result && !loading) await (type === "capacity" ? onLoadCapacityCore(target) : onLoadLeader(target));
    setActiveModule(type);
  };
  return <div className="mainline-core-modules">
    <section className="capacity-core collapsible"><div className="capacity-core-heading"><button type="button" className="module-toggle" disabled={loadingCapacity} onClick={() => openModule("capacity")}><span>容量中军</span><small>{loadingCapacity ? "正在分析…" : capacity ? "已自动完成" : "等待自动分析"}</small></button></div>{loadingCapacity && <TaskProgress className="module-task-progress" label="正在统计成交额、持续活跃度和市值门槛…" />}</section>
    <section className="capacity-core collapsible"><div className="capacity-core-heading"><button type="button" className="module-toggle" disabled={loadingLeader} onClick={() => openModule("leader")}><span>动态题材龙头</span><small>{loadingLeader ? "正在分析…" : leader ? "已自动完成" : "等待自动分析"}</small></button></div>{loadingLeader && <TaskProgress className="module-task-progress" label="正在识别题材龙头…" />}</section>
    {activeModule && <MainlineModuleModal type={activeModule} target={target} result={activeModule === "capacity" ? capacity : leader} onClose={() => setActiveModule(null)} />}
  </div>;
}

function PrimaryCoreAnalysisModal({ group, primarySector, date, capacityCoreResults, capacityCoreLoading, onLoadCapacityCore, leaderResults, leaderLoading, onLoadLeader, onClose }) {
  const [historyItem, setHistoryItem] = useState(null);
  const analyzedBySecondary = new Map(group.items.map((item) => [item.name, item]));
  const secondaryNames = Array.from(new Set([
    ...group.items.map((item) => item.name),
    ...(primarySector?.secondary_sectors || []).map((sector) => sector.name)
  ])).filter(Boolean).sort((left, right) => {
    const leftScore = Number(analyzedBySecondary.get(left)?.mainline_rank_score ?? analyzedBySecondary.get(left)?.score);
    const rightScore = Number(analyzedBySecondary.get(right)?.mainline_rank_score ?? analyzedBySecondary.get(right)?.score);
    return (Number.isFinite(rightScore) ? rightScore : -Infinity) - (Number.isFinite(leftScore) ? leftScore : -Infinity)
      || left.localeCompare(right, "zh-CN");
  });
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal primary-core-modal" role="dialog" aria-modal="true" aria-labelledby="primary-core-modal-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" aria-label="关闭二级方向" onClick={onClose}><X size={18} /></button>
      <div className="modal-kicker">一级主线</div>
      <h2 id="primary-core-modal-title">{group.primary}</h2>
      <p className="modal-sub">完整展示 {secondaryNames.length} 个二级方向，按既有综合评分从高到低排列。</p>
      <div className="primary-core-secondary-list">
        {secondaryNames.map((secondary) => {
          const item = analyzedBySecondary.get(secondary);
          const target = { primary: group.primary, secondary };
          const key = `${date}|${group.primary}|${secondary}`;
          const score = Number(item?.mainline_rank_score ?? item?.score);
          const scoreParts = [
            ["近5日强度", item?.recent_strength_score, 50],
            ["资金持续", item?.capital_persistence_score, 20],
            ["抗分歧修复", item?.resilience_repair_score, 20],
            ["持续活跃", item?.continuity_score, 10]
          ];
          return <article className="primary-core-secondary" key={item?.key || key}>
            <div className="primary-core-secondary-heading"><h3>{secondary}</h3>{Number.isFinite(score) && <span className="secondary-score-trigger"><button type="button" className="secondary-score" aria-label={`查看${secondary}的综合评分结构`}>{score.toFixed(1)}</button><span className="score-breakdown" role="tooltip"><span className="score-breakdown-heading"><strong>综合评分结构</strong><span>{score.toFixed(1)}</span></span><span className="score-breakdown-items">{scoreParts.map(([label, value, weight]) => <span key={label}><span>{label}</span><b>{Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-"}</b><small>权重 {weight}%</small></span>)}</span></span></span>}<button type="button" className="secondary-cycle-link" disabled={!item?.score_history?.length} onClick={() => setHistoryItem(item)}>查看历史表现</button></div>
            <MainlineCoreModules target={target} capacity={capacityCoreResults[key]} leader={leaderResults[key]} loadingCapacity={capacityCoreLoading[key]} loadingLeader={leaderLoading[key]} onLoadCapacityCore={onLoadCapacityCore} onLoadLeader={onLoadLeader} />
          </article>;
        })}
      </div>
    </div>
    {historyItem && <div className="modal-backdrop" onMouseDown={() => setHistoryItem(null)}><div className="modal cycle-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="score-history-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭历史表现" onClick={() => setHistoryItem(null)}><X size={18} /></button><h2 id="score-history-title">{group.primary} · {historyItem.name}</h2><ScoreHistoryCalendar item={historyItem} /></div></div>}
  </div>;
}

function ScoreHistoryCalendar({ item }) {
  const history = item?.score_history || [];
  const current = history.at(-1);
  const [selectedDate, setSelectedDate] = useState(current?.date || history[0]?.date);
  const selected = history.find((entry) => entry.date === selectedDate) || current;
  const entries = new Map(history.map((entry) => [entry.date, entry]));
  const dates = [...entries.keys()].sort();
  const calendarRef = useRef(null);
  const [visibleCalendarMonth, setVisibleCalendarMonth] = useState(() => dates[0]?.slice(0, 7) || "");
  if (!dates.length) return <div className="cycle-timeline-empty">暂无可用的历史评分记录。</div>;
  const first = new Date(`${dates[0]}T12:00:00Z`), last = new Date(`${dates.at(-1)}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  last.setUTCDate(last.getUTCDate() + ((5 - ((last.getUTCDay() + 6) % 7) + 7) % 7));
  const cells = [];
  for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    if ([0, 6].includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10); cells.push({ date, entry: entries.get(date) });
  }
  const handleCalendarScroll = (event) => {
    const calendar = event.currentTarget;
    const top = calendar.getBoundingClientRect().top;
    const firstVisibleDay = [...calendar.querySelectorAll(".cycle-calendar-day")]
      .find((day) => day.getBoundingClientRect().bottom > top + 36);
    const month = firstVisibleDay?.title?.slice(0, 7);
    if (month) setVisibleCalendarMonth((currentMonth) => currentMonth === month ? currentMonth : month);
  };
  const scoreParts = [["近5日强度", 50, selected?.score?.recent_strength_score], ["资金持续", 20, selected?.score?.capital_persistence_score], ["抗分歧修复", 20, selected?.score?.resilience_repair_score], ["持续活跃", 10, selected?.score?.continuity_score]];
  const profit = selected?.metrics?.profit_effect || {};
  return <section className="cycle-timeline" aria-label="历史综合评分"><header><div><h3>历史综合评分</h3><p>逐交易日保留评分、日强度、板块广度、龙头与容量中军表现；不再作生命周期状态判断。</p></div><span>{history.length} 个交易日</span></header><div className="cycle-calendar" ref={calendarRef} onScroll={handleCalendarScroll} aria-label="按月查看历史综合评分；鼠标滚轮上下可翻月"><div className="cycle-calendar-month-label">{visibleCalendarMonth ? visibleCalendarMonth.replace("-", "年") + "月" : ""}</div><section className="cycle-calendar-month" aria-label="交易日历史评分"><h4></h4><div className="cycle-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五"].map((day) => <span key={day}>周{day}</span>)}</div><div className="cycle-calendar-grid">{cells.map(({ date, entry }) => entry ? <button type="button" className={`cycle-calendar-day ${selected?.date === date ? "selected" : ""}`} key={date} aria-pressed={selected?.date === date} title={`${date}：综合分 ${Number(entry.score?.mainline_rank_score).toFixed(1)}，日强度 ${Number(entry.daily_strength_score).toFixed(1)}`} onClick={() => setSelectedDate(date)}><time>{date.slice(8)}</time><strong>{Number(entry.score?.mainline_rank_score).toFixed(1)} 分</strong><small>日强度 {Number(entry.daily_strength_score).toFixed(1)}</small></button> : <span className="cycle-calendar-empty" key={date} aria-label={`${date} 无行情`} />)}</div></section></div><div className="cycle-evidence" aria-live="polite"><div className="cycle-evidence-heading"><b>{selected?.date}</b><small>综合分 {Number(selected?.score?.mainline_rank_score).toFixed(1)} · 日强度 {Number(selected?.daily_strength_score).toFixed(1)}</small></div><b>板块整体：上涨 {selected?.metrics?.up_count ?? "-"} 只，涨停 {selected?.metrics?.limit_up_count ?? "-"} 只，大涨 {selected?.metrics?.high_gain_count ?? "-"} 只，大跌 {selected?.metrics?.large_loss_count ?? "-"} 只；相对收益 {selected?.metrics?.theme_relative_return?.toFixed?.(2) ?? "-"}%</b><b>龙头：{selected?.metrics?.previous_leaders?.length ? `${selected.metrics.previous_leaders.map((stock) => `${stock.name || stock.code} ${stock.change_pct ?? "-"}%`).join("、")}；${selected.metrics.leader_status || "-"}${selected.metrics.leader_drives_theme ? "，仍在带动板块" : ""}` : "前一日龙头数据不足"}</b><b>容量中军：{selected?.metrics?.previous_capacity_cores?.length ? `${selected.metrics.previous_capacity_cores.map((stock) => `${stock.name || stock.code} ${stock.change_pct ?? "-"}%`).join("、")}；${selected.metrics.capacity_core_status || "-"}${selected.metrics.capacity_core_long_upper_count ? `，长上影 ${selected.metrics.capacity_core_long_upper_count} 只` : ""}` : "前一日容量中军数据不足"}</b><b>赚钱效应：{profit.profit_effect || "数据不足"}；前排中位收益 {profit.frontline_next_day_median_return ?? "-"}%、上涨占比 {profit.frontline_positive_rate != null ? `${Math.round(profit.frontline_positive_rate * 100)}%` : "-"}；活跃成员中位收益 {profit.active_member_next_day_median_return ?? "-"}%、上涨占比 {profit.active_member_positive_rate != null ? `${Math.round(profit.active_member_positive_rate * 100)}%` : "-"}；昨日涨停中位收益 {profit.limit_up_next_day_median_return ?? "-"}%；严重负反馈 {profit.severe_negative_rate != null ? `${Math.round(profit.severe_negative_rate * 100)}%` : "-"}</b><b>核心反馈：龙头 {profit.leader_feedback || "数据不足"}；中军 {profit.capacity_core_feedback || "数据不足"}；普通成员 {profit.ordinary_member_feedback || "数据不足"}</b><b>中军池汇总：有效池 {selected?.metrics?.capacity_core_pool_size ?? "-"} 只；正向 {selected?.metrics?.capacity_core_positive_count ?? "-"} 只（{selected?.metrics?.capacity_core_positive_count_ratio != null ? `${Math.round(selected.metrics.capacity_core_positive_count_ratio * 100)}%` : "-"}），正向权重 {selected?.metrics?.capacity_core_positive_weight != null ? `${Math.round(selected.metrics.capacity_core_positive_weight * 100)}%` : "-"}；池加权收益 {selected?.metrics?.capacity_core_pool_weighted_return?.toFixed?.(2) ?? "-"}%；{selected?.metrics?.core_pool_status || "数据不足"}</b></div><section className="cycle-score-detail" aria-label="当日评分构成"><header><b>当日评分构成</b><strong>{Number(selected?.score?.mainline_rank_score).toFixed(1)}/100</strong></header><p>评分权重保持原规则。</p><div>{scoreParts.map(([label, weight, value]) => <span key={label}><small>{label} · 权重 {weight}%</small><b>{Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-"}</b><em>{Number.isFinite(Number(value)) ? `贡献 ${(Number(value) * weight / 100).toFixed(1)} 分` : "数据不足"}</em></span>)}</div></section></section>;
}

function MainlineModuleModal({ type, target, result, onClose }) {
  const title = type === "capacity" ? "容量中军" : "动态题材龙头";
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal mainline-module-modal" role="dialog" aria-modal="true" aria-labelledby="mainline-module-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭详情" onClick={onClose}><X size={18} /></button><div className="modal-kicker">{target.primary} / {target.secondary}</div><h2 id="mainline-module-title">{title}</h2>{result ? (type === "capacity" ? <CapacityCoreResult result={result} /> : <LeaderResult result={result} />) : <p className="capacity-core-empty">该方向尚未完成自动分析，请在行情扫描完成后查看。</p>}</div></div>;
}

function CapacityCoreResult({ result }) {
  const [showAll, setShowAll] = useState(false);
  const allRows = result.candidates || [];
  const rows = showAll ? allRows : allRows.slice(0, 3);
  const qualifiedRows = allRows.filter((stock) => ["confirmed_capacity_core", "capacity_core_candidate"].includes(stock.verdict));
  const scoreEligibleRows = allRows.filter((stock) => Number(stock.score) >= 65);
  const marketCapPendingRows = scoreEligibleRows.filter((stock) => (stock.missing_data || []).includes("historical_market_cap"));
  const marketCapRejectedRows = scoreEligibleRows.filter((stock) => stock.verdict === "not_capacity_core" && Number.isFinite(stock.market_cap));
  if (!rows.length) return <p className="capacity-core-empty">近三日没有足够的成交额数据，暂不判断。</p>;
  return <div className="capacity-core-result">
    <p className="capacity-core-empty">候选池滚动 PK：确认龙头 <StockName code={result.confirmed_leader?.code} name={result.confirmed_leader?.name || "暂无"} />；暂定龙头 <StockName code={result.provisional_leader?.code} name={result.provisional_leader?.name || "暂无"} />；仅连续领先、分歧抗跌并修复后才会确认。</p>
    {rows.map((stock, index) => <div className="capacity-core-row" key={stock.code}>
      <span className="capacity-core-rank">{index + 1}</span>
      <div><b><StockName code={stock.code} name={stock.name} /></b><small>{stock.code} · 近三日题材内成交额排名</small></div>
      <strong>{Number.isFinite(stock.score) ? stock.score : "-"}<small>/80</small></strong>
      <p>资金容量 {stock.score_details.capital_capacity ?? stock.score_details.amount_prominence ?? "-"}/50 · 持续活跃 {stock.score_details.continued_activity ?? stock.score_details.sustained_activity ?? "-"}/30（按近三日题材内成交额排名百分位累计）</p>
      <p>关联度调整：原始 {Number.isFinite(stock.raw_score) ? stock.raw_score : "-"} × {Number.isFinite(stock.relevance_score) ? stock.relevance_score.toFixed(2) : "-"} = {Number.isFinite(stock.score) ? stock.score : "-"}</p>
    </div>)}
    {allRows.length > 3 && <button type="button" className="mainline-history-button" onClick={() => setShowAll((current) => !current)}>{showAll ? "收起列表" : `查看全部 ${allRows.length} 只股票`}</button>}
    {!qualifiedRows.length && <p className="capacity-core-empty">{
      marketCapPendingRows.length
        ? `已有 ${marketCapPendingRows.length} 只股票评分达到候选线（65分），但市值数据尚未获取成功；完成“总市值≥100亿元”校验后会自动复判。`
        : marketCapRejectedRows.length
          ? `已有 ${marketCapRejectedRows.length} 只股票评分达到候选线，但总市值未达到100亿元，因此不列入容量中军候选。`
          : scoreEligibleRows.length
            ? "评分达到候选线的股票尚未通过容量中军必要资格校验。"
            : "近三日成交额已读取，但最高评分未达到容量中军候选线（65分）。"
    }</p>}
  </div>;
}

function LeaderResult({ result }) {
  const rows = (result.candidates || []).slice(0, 5);
  const roleLabels = { emotion_leader: "情绪龙头", trend_leader: "趋势龙头", high_elasticity_leader: "高弹性龙头", independent_high_stock: "独立高位股", frontline_member: "前排成员" };
  const statusLabels = { confirmed_leader: "确认龙头", provisional_leader: "暂定龙头", high_confidence_candidate: "高置信候选", leader_candidate: "龙头候选", late_follower: "后排补涨", frontline_core: "前排核心", follow_up_or_normal_member: "跟随/普通成员", independent_high_stock: "独立高位股" };
  if (!rows.length) return <p className="capacity-core-empty">{result.status === "insufficient_data" ? "历史行情数据不足，暂不机械指定龙头。" : "没有可用于评分的题材成员。"}</p>;
  return <div className="capacity-core-result">
    {rows.map((stock, index) => <div className="capacity-core-row" key={stock.code}>
      <span className="capacity-core-rank">{index + 1}</span>
      <div><b><StockName code={stock.code} name={stock.name} /></b><small>{stock.code} · {roleLabels[stock.primary_role] || stock.primary_role} · {statusLabels[stock.status] || stock.status}</small></div>
      <strong>{stock.score}<small>/100</small></strong>
      <p>滚动候选池排名 #{stock.leader_rank || index + 1} · 连续前排 {stock.evidence?.leading_streak_days ?? 0} 日 · 强势日 {stock.evidence?.strong_days ?? 0} 日 · 后排补涨 {stock.evidence?.late_follower ? "是" : "否"}</p>
      <p>新版六维：启动 {stock.score_details.initiation}/15 · 高度 {stock.score_details.height}/20 · 持续前排 {stock.score_details.continued_strength}/20 · 板块带动 {stock.score_details.theme_leadership}/20 · 抗分歧 {stock.score_details.divergence_survival}/15 · 修复 {stock.score_details.repair ?? 0}/10</p>
      <p>关联度调整：原始 {Number.isFinite(stock.raw_score) ? stock.raw_score : "-"} × {Number.isFinite(stock.relevance_score) ? stock.relevance_score.toFixed(2) : "-"} = {Number.isFinite(stock.score) ? stock.score : "-"}</p>
    </div>)}
    {!!result.rejected_candidates?.length && <p className="capacity-core-empty">已排除 {result.rejected_candidates.length} 只不满足候选资格或缺少题材联动的股票。</p>}
  </div>;
}

function MainlineHistoryModal({ item, onClose }) {
  const days = item.history.filter((day) => day.quotes).slice(0, 2);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal mainline-history-modal" role="dialog" aria-modal="true" aria-labelledby="mainline-history-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" aria-label="关闭前两交易日行情" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">MAINLINE HISTORY</div>
        <h2 id="mainline-history-title">{item.primary} · 前两交易日行情</h2>
        <p className="modal-sub">{item.secondary} / {item.tertiary} 的关联二级主线与三级方向表现。</p>
        <div className="mainline-history-modal-days">
          {days.map((day) => (
            <section key={day.date} className="mainline-history-modal-day">
              <header><time>{day.date}</time><span>{day.secondaries.length} 个二级主线</span></header>
              <div className="mainline-history-modal-groups">
                {day.secondaries.map((secondary) => (
                  <section key={secondary.name}>
                    <header><strong>{secondary.name}</strong><b className={marketClass(secondary.changePct)}>{formatPct(secondary.changePct)}</b><small>{secondary.stockCount} 只样本</small></header>
                    <div>{secondary.tertiaries.map((tertiary) => <span key={tertiary.name}>{tertiary.name}<b className={marketClass(tertiary.changePct)}>{formatPct(tertiary.changePct)}</b><small>{tertiary.stockCount} 只</small></span>)}</div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValidationPanel({ validation }) {
  return (
    <div className="validation-panel">
      <strong>启动校验发现问题</strong>
      {validation.errors.slice(0, 5).map((error) => <p key={error}>{error}</p>)}
      {validation.errors.length > 5 && <p>还有 {validation.errors.length - 5} 个错误，请运行 `npm.cmd run validate:data` 查看完整日志。</p>}
    </div>
  );
}

function InlineActionMenu({ onRename, onMerge, onMove, onDelete, deleteLabel = "删除", nested = false, light = false, collection = false }) {
  return (
    <div className={`inline-action-menu ${nested ? "nested" : ""} ${light ? "light" : ""} ${collection ? "collection-actions" : ""}`}>
      <button onClick={onRename}>更改名称</button>
      {onMerge && <button onClick={onMerge}>合并到...</button>}
      {onMove && <button onClick={onMove}>移动到书页...</button>}
      {onDelete && <button className="danger" onClick={onDelete}>{deleteLabel}</button>}
    </div>
  );
}

function DeleteCollectionConfirm({ name, primaryCount, stockCount, onCancel, onConfirm }) {
  return (
    <aside className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title">
      <div className="delete-confirmation-icon"><AlertTriangle size={19} /></div>
      <div className="delete-confirmation-copy">
        <strong id="delete-confirmation-title">删除产业书页？</strong>
        <p>即将删除「{name}」。</p>
        {primaryCount > 0
          ? <small>同时删除 {primaryCount} 条一级主线{stockCount > 0 ? ` 和 ${stockCount} 只股票归属` : ""}，此操作不可撤销。</small>
          : <small>该书页没有有效的一级主线，仅删除书页本身。</small>
        }
      </div>
      <div className="delete-confirmation-actions">
        <button onClick={onCancel}>取消</button>
        <button className="danger" onClick={onConfirm}>确认删除</button>
      </div>
    </aside>
  );
}

function StockTable({ stocks, quotes, limitUpRecords, onDelete, onViewAffiliations }) {
  return (
    <div className="taxonomy-stock-list">
      {stocks.map((stock) => (
        <article className="stock-card-row" key={stock.code}>
          <div className="stock-main">
            <span className="code">{stock.code}</span>
            <span className="stock-name"><button className="stock-affiliations" title="查看全部产业归属" onClick={() => onViewAffiliations(stock)}><Building2 size={15} /></button> <StockName code={stock.code} name={stock.name} /></span>
            <span className={`change ${marketClass(quotes[stock.code]?.changePct)}`}>{formatPct(quotes[stock.code]?.changePct)}</span>
            <span className="price">{formatPrice(quotes[stock.code]?.price)}</span>
            <span className="tag-list">{limitUpRecords?.[stock.code] && <i className="limit-up-badge"><Flame size={10} />近月 {limitUpRecords[stock.code].count} 次 · {limitUpRecords[stock.code].lastDate}</i>}{(stock.product_tags || []).map((tag) => <i key={tag}><Tag size={10} />{tag}</i>)}</span>
          </div>
          <p>{stock.reason || "鏆傛棤闀挎湡褰掑睘鐞嗙敱"}</p>
          <button className="row-delete" title="删除股票" onClick={() => onDelete(stock.code)}><X size={15} /></button>
        </article>
      ))}
      {!stocks.length && <div className="no-stocks">当前筛选下还没有股票</div>}
    </div>
  );
}

function SimpleModal({ title, subtitle, onClose, onSubmit }) {
  const [name, setName] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">taxonomy</div>
        <h2>{title}</h2>
        <p className="modal-sub">{subtitle}</p>
        <label className="field">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="输入名称" /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!name.trim()} onClick={() => { onSubmit({ name }); onClose(); }}>确认添加</button>
        </div>
      </div>
    </div>
  );
}

function StockAffiliationsModal({ stock, onClose, onAdd }) {
  const groups = new Map();
  for (const classification of stock.classifications || []) {
    const primaryName = classificationPrimarySector(stock, classification) || "未设置一级主线";
    if (!groups.has(primaryName)) groups.set(primaryName, []);
    groups.get(primaryName).push(classification);
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small stock-affiliations-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">all affiliations</div>
        <h2>{stock.code} <StockName code={stock.code} name={stock.name} /></h2>
        <p className="modal-sub">该股票的全部长期产业归属；当前页面之外的一级、二级和三级方向也会在这里显示。</p>
        <div className="affiliation-list">
          {Array.from(groups.entries()).map(([primaryName, classifications]) => (
            <section className="affiliation-primary" key={primaryName}>
              <strong>{primaryName}</strong>
              {classifications.map((classification) => (
                <div className="affiliation-secondary" key={`${classification.secondary_sector}-${(classification.tertiary_sectors || []).join("|")}`}>
                  <span>{classification.secondary_sector || "未设置二级主线"} · 关联度 {Number.isFinite(Number(classification.relevance_score)) ? `${Math.round(Number(classification.relevance_score) * 100)}%` : "待补充"}</span>
                  <div>{(classification.tertiary_sectors || []).map((tertiary) => <i key={tertiary}>{tertiary}</i>)}</div>
                </div>
              ))}
            </section>
          ))}
        </div>
        {stock.reason && <div className="affiliation-reason"><b>长期归属理由</b><p>{stock.reason}</p></div>}
        <div className="modal-actions"><button onClick={onAdd}><Plus size={15} /> 添加到其他主线</button><button className="primary" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}
function PrimaryModal({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">primary line</div>
        <h2>添加一级主线</h2>
        <p className="modal-sub">这里只创建一级主线。当前已进入产业书页时，会自动归入当前书页。</p>
        <label className="field">一级主线名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 机器人" /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!name.trim()} onClick={() => { onSubmit({ name }); onClose(); }}>确认添加</button>
        </div>
      </div>
    </div>
  );
}

function CollectionModal({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">industry book</div>
        <h2>添加产业书页</h2>
        <p className="modal-sub">产业书页是一级主线之上的大目录。</p>
        <label className="field">书页名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 信息科技产业链" /></label>
        <label className="field">说明<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!name.trim()} onClick={() => { onSubmit({ name, description }); onClose(); }}>确认添加</button>
        </div>
      </div>
    </div>
  );
}

function RenameModal({ title, currentName, onClose, onSubmit, subtitle = "会同步更新 taxonomy、股票归属和动态题材里的对应名称。" }) {
  const [name, setName] = useState(currentName || "");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">rename</div>
        <h2>{title}</h2>
        <p className="modal-sub">{subtitle}</p>
        <label className="field">新名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!name.trim() || name.trim() === currentName} onClick={() => { onSubmit({ name }); onClose(); }}>确认重命名</button>
        </div>
      </div>
    </div>
  );
}

function MergeModal({ title, sourceName, options, onClose, onSubmit }) {
  const [target, setTarget] = useState(options[0] || "");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">merge</div>
        <h2>{title}</h2>
        <p className="modal-sub">将「{sourceName}」合并到目标方向，目录和股票归属会同步迁移并去重。</p>
        <label className="field">合并到<select autoFocus value={target} onChange={(event) => setTarget(event.target.value)}>{options.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!target} onClick={() => { onSubmit({ target }); onClose(); }}>确认合并</button>
        </div>
      </div>
    </div>
  );
}

function ImportJsonModal({ initialFile = false, onClose, onSubmit, title = "导入 GPT 返回的 JSON" }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const fileInputRef = useRef(null);
  useEffect(() => {
    if (initialFile) fileInputRef.current?.click();
  }, [initialFile]);
  const readClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setText(value);
      setStatus("已读取剪贴板");
    } catch {
      setStatus("无法读取剪贴板，请手动粘贴");
    }
  };
  const readJsonFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(json|txt)$/i.test(file.name) && !/json/i.test(file.type)) {
      setStatus("请选择 JSON 文件");
      return;
    }
    try {
      const value = await file.text();
      setText(value);
      setStatus(`已读取文件：${file.name}`);
    } catch {
      setStatus("文件读取失败，请重新选择");
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal import-json" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">GPT JSON</div>
        <h2>{title}</h2>
        <p className="modal-sub">可直接选择 GPT 保存的 JSON 文件，或粘贴内容；会合并到当前 taxonomy 和 stock map，不会覆盖已有分类。</p>
        <label className="field">JSON 内容<textarea className="json-input" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="请粘贴 JSON" /></label>
        {status && <div className="parse-status">{status}</div>}
        <div className="modal-actions">
          <button onClick={readClipboard}><ClipboardPaste size={15} /> 读取剪贴板</button>
          <label className="file-import-button"><Download size={15} /> 选择 JSON 文件<input ref={fileInputRef} type="file" accept=".json,application/json,text/plain" onChange={readJsonFile} /></label>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!text.trim()} onClick={async () => { if (await onSubmit(text)) onClose(); }}>导入 JSON</button>
        </div>
      </div>
    </div>
  );
}

function SecondaryModal({ primary, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [tertiaryName, setTertiaryName] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">secondary line</div>
        <h2>添加二级主线</h2>
        <p className="modal-sub">添加到「{primary.name}」下。三级主线可稍后单独添加。</p>
        <label className="field">二级主线名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 电机" /></label>
        <label className="field">首个三级主线（可选）<input value={tertiaryName} onChange={(event) => setTertiaryName(event.target.value)} placeholder="例如 空心杯电机" /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!name.trim()} onClick={() => { onSubmit({ name, tertiaryName }); onClose(); }}>确认添加</button>
        </div>
      </div>
    </div>
  );
}

function MovePrimaryModal({ primaryName, sourceCollection, collections, onClose, onSubmit }) {
  const options = collections.filter((item) => item.name !== sourceCollection);
  const [target, setTarget] = useState(options[0]?.name || "");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">move primary</div>
        <h2>移动一级主线</h2>
        <p className="modal-sub">将「{primaryName}」从「{sourceCollection}」移至目标产业书页。一级主线下的二级、三级目录和股票归属不会改变。</p>
        <label className="field">目标产业书页<select value={target} onChange={(event) => setTarget(event.target.value)}>{options.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
        {!options.length && <div className="parse-status">还没有其他产业书页可移动，请先创建一个产业书页。</div>}
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!target} onClick={() => { onSubmit({ target }); onClose(); }}>确认移动</button>
        </div>
      </div>
    </div>
  );
}

function DailyStockClassifyModal({ stock, taxonomy, onClose, onSubmit, title = "归类未分类涨停股", subtitle, submitLabel = "确认归类" }) {
  const [primaryName, setPrimaryName] = useState(taxonomy.sectors[0]?.name || "");
  const primary = taxonomy.sectors.find((item) => item.name === primaryName);
  const [secondaryNames, setSecondaryNames] = useState([]);
  const [tertiariesBySecondary, setTertiariesBySecondary] = useState({});
  const [relevanceBySecondary, setRelevanceBySecondary] = useState({});
  const [reason, setReason] = useState("");
  const choosePrimary = (value) => {
    setPrimaryName(value);
    setSecondaryNames([]);
    setTertiariesBySecondary({});
    setRelevanceBySecondary({});
  };
  const toggleSecondary = (name) => {
    setSecondaryNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
    setTertiariesBySecondary((current) => ({ ...current, [name]: current[name] || [] }));
    setRelevanceBySecondary((current) => ({ ...current, [name]: current[name] ?? 0.6 }));
  };
  const toggleTertiary = (secondaryName, name) => setTertiariesBySecondary((current) => {
    const selected = current[secondaryName] || [];
    return { ...current, [secondaryName]: selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name] };
  });
  const classifications = secondaryNames.map((secondaryName) => ({ secondaryName, tertiaryNames: tertiariesBySecondary[secondaryName] || [], relevanceScore: relevanceBySecondary[secondaryName] ?? 0.6 })).filter((item) => item.tertiaryNames.length);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal classification-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">limit-up classify</div>
        <h2>{title}</h2>
        <p className="modal-sub">{subtitle || `${stock.code}${stock.name ? ` · ${stock.name}` : ""}。选择其长期产业归属后，会从未分类涨停列表中移除。`}</p>
        <label className="field">一级主线<select value={primaryName} onChange={(event) => choosePrimary(event.target.value)}>{taxonomy.sectors.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
        <div className="field"><span>二级主线（可多选）</span><div className="classification-choice-tags">{(primary?.secondary_sectors || []).map((item) => <button type="button" key={item.name} className={secondaryNames.includes(item.name) ? "selected" : ""} onClick={() => toggleSecondary(item.name)}>{item.name}</button>)}</div></div>
        {secondaryNames.map((secondaryName) => {
          const secondary = primary?.secondary_sectors?.find((item) => item.name === secondaryName);
          return <Fragment key={secondaryName}><div className="field"><span>{secondaryName} 的三级方向（可多选）</span><div className="classification-choice-tags tertiary-tags">{(secondary?.tertiary_sectors || []).map((item) => <button type="button" key={item} className={(tertiariesBySecondary[secondaryName] || []).includes(item) ? "selected" : ""} onClick={() => toggleTertiary(secondaryName, item)}>{item}</button>)}</div></div><label className="field">{secondaryName} 的二级主线关联度<select value={relevanceBySecondary[secondaryName] ?? 0.6} onChange={(event) => setRelevanceBySecondary((current) => ({ ...current, [secondaryName]: Number(event.target.value) }))}><option value={1}>100% · 主营/核心业务</option><option value={0.8}>80% · 直接业务/核心产品</option><option value={0.6}>60% · 明确产业链关联</option><option value={0.4}>40% · 布局/间接关联</option><option value={0.2}>20% · 弱概念关联</option></select></label></Fragment>;
        })}
        <label className="field">归类备注 / 识别依据（可选）<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：主营产品、公告业务、产业链位置等，便于后续复核" /></label>
        {!secondaryNames.length && <div className="parse-status">请至少选择一个二级主线，并为其选择三级方向。</div>}
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!primaryName || !classifications.length} onClick={() => onSubmit({ stock, primaryName, classifications, reason })}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}

function IndustryCrawlModal({ target, onClose, onSubmit }) {
  const [industryNames, setIndustryNames] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const crawl = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ths-industry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industryNames })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "抓取失败");
      setResult(payload);
      if (!payload.industries?.length) setError("没有抓取到可添加的行业成分股");
    } catch (crawlError) {
      setError(crawlError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={loading ? undefined : onClose}>
      <div className="modal industry-crawl-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" disabled={loading} onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">THS INDUSTRY IMPORT</div>
        <h2>抓取细分行业成分股</h2>
        <p className="modal-sub">
          输入同花顺细分行业名称，预览后统一追加到
          「{target.primary} / {target.secondary} / {target.tertiary}」。
          已有分类完整保留，重复归属不会再次添加。
        </p>
        <label className="field">
          细分行业名称（一次最多 10 个）
          <textarea
            autoFocus
            value={industryNames}
            disabled={loading}
            onChange={(event) => {
              setIndustryNames(event.target.value);
              setResult(null);
              setError("");
            }}
            placeholder={"例如：\n区域性住宅开发\n产业地产\n\n支持逗号或换行分隔"}
          />
        </label>
        {loading && <TaskProgress className="industry-crawl-loading" label="正在读取同花顺行业代码，并抓取全部分页成分股…" />}
        {error && <div className="parse-status error">{error}</div>}
        {result && (
          <div className="industry-crawl-preview">
            <div className="industry-crawl-summary">
              <strong>抓取预览</strong>
              <span>{result.industries.length} 个行业 · 去重后 {result.stock_count} 只股票</span>
            </div>
            <div className="industry-crawl-results">
              {result.industries.map((industry) => (
                <div key={industry.code}>
                  <span><b>{industry.name}</b><small>{industry.code}</small></span>
                  <em>{industry.stocks.length} 只</em>
                </div>
              ))}
              {(result.errors || []).map((item) => (
                <div className="failed" key={`${item.requested_name}-${item.code || ""}`}>
                  <span><b>{item.requested_name}</b><small>{item.code || "未匹配"}</small></span>
                  <em>{item.error}</em>
                </div>
              ))}
            </div>
            <p>确认后只会向当前三级目录追加股票，不会删除或改写股票的其他产业归属。</p>
          </div>
        )}
        <div className="modal-actions">
          <button disabled={loading} onClick={onClose}>取消</button>
          {!result?.industries?.length ? (
            <button className="primary" disabled={loading || !industryNames.trim()} onClick={crawl}>
              {loading ? "正在抓取…" : "开始抓取并预览"}
            </button>
          ) : (
            <>
              <button disabled={loading} onClick={crawl}>重新抓取</button>
              <button className="primary" disabled={loading} onClick={() => onSubmit({ industries: result.industries, target })}>
                确认添加 {result.stock_count} 只股票
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StockModal({ primary, secondary, selectedTertiary, onClose, onSubmit }) {
  const [codes, setCodes] = useState("");
  const [tertiary, setTertiary] = useState(selectedTertiary === "全部" ? secondary.tertiary_sectors[0] || "" : selectedTertiary);
  const [relevanceScore, setRelevanceScore] = useState(0.6);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    const saved = await onSubmit({ codes, tertiary, relevanceScore });
    setSubmitting(false);
    if (saved) onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker">stock map</div>
        <h2>批量添加股票归属</h2>
        <p className="modal-sub">{primary.name} / {secondary.name}。输入股票代码后将自动查询名称；已有股票会直接追加本次归属。</p>
        <label className="field">股票代码（可批量）<textarea autoFocus value={codes} onChange={(event) => setCodes(event.target.value)} placeholder="例如：601328 600036 601398&#10;支持空格、换行、逗号分隔" /></label>
        <label className="field">三级方向<select value={tertiary} onChange={(event) => setTertiary(event.target.value)}>{secondary.tertiary_sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field">与「{secondary.name}」的关联度<select value={relevanceScore} onChange={(event) => setRelevanceScore(Number(event.target.value))}><option value={1}>100% · 主营/核心业务</option><option value={0.8}>80% · 直接业务/核心产品</option><option value={0.6}>60% · 明确产业链关联</option><option value={0.4}>40% · 布局/间接关联</option><option value={0.2}>20% · 弱概念关联</option></select></label>
        <div className="modal-actions">
          <button disabled={submitting} onClick={onClose}>取消</button>
          <button className="primary" disabled={submitting || !codes.trim() || !tertiary} onClick={submit}>{submitting ? "正在添加…" : "确认批量添加"}</button>
        </div>
      </div>
    </div>
  );
}
