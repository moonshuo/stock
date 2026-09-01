import { createRequire } from "module";
import { AsyncLocalStorage } from "async_hooks";
import { execFile } from "child_process";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
// The explicit extension keeps this shared loader importable by the scheduled
// Node.js crawler as well as by Next's route runtime.
import { NextResponse } from "next/server.js";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { normalizeCode } from "../../lib/sectorSystem.js";
import { CHINA_CLOSE_MINUTE, closingSnapshotStatus, hasFullMarketCoverage, MIN_A_SHARE_SNAPSHOT_ROWS, needsClosingSnapshotRecovery } from "../../../lib/market-snapshot.js";
import { collectReportedTotalPages } from "../../../lib/reported-total-pagination.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `import.meta.url` is rewritten to the build machine's source path in a
// standalone bundle. Resolve native dependencies from the deployed project
// root instead, where its production node_modules directory lives.
const require = createRequire(path.join(process.cwd(), "package.json"));
const duckdb = require("duckdb");

const DATA_ROOT = process.cwd();
const FIVE_MINUTE_DIR = path.join(DATA_ROOT, "5分钟数据");
const TAXONOMY_PATH = path.join(DATA_ROOT, "data", "sector_taxonomy.json");
const STOCK_MAP_PATH = path.join(DATA_ROOT, "data", "stock_sector_map.json");
const STOCK_NAME_MAP_PATH = path.join(DATA_ROOT, "data", "stock_name_map.json");
const HISTORICAL_QUOTE_CORRECTIONS_DIR = path.join(DATA_ROOT, "data", "historical_quote_corrections");
const GPT_QUESTION_DIR = path.join(DATA_ROOT, "data", "gpt_questions");
const LIVE_SNAPSHOT_TTL_MS = 60 * 1000;
const MIN_CLASSIFIED_UNIVERSE_COVERAGE = 0.98;
const localParquetRowCache = new Map();
const localParquetReadInFlight = new Map();
const closingSnapshotRecoveryInFlight = new Map();
const dailyMarketTaskStorage = new AsyncLocalStorage();

export function runDailyMarketTask(taskFn) {
  return dailyMarketTaskStorage.run(new Map(), taskFn);
}

// Persistent analysis responses are cleared through the cache control.  The
// raw local Parquet files remain the source data, while these memory indexes
// can be discarded safely and rebuilt on the next request.
export function clearDailyMarketMemoryCache() {
  localParquetRowCache.clear();
  localParquetReadInFlight.clear();
}

function normalizeDate(value = "") {
  const compact = String(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  return {
    compact,
    dashed: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
    year: compact.slice(0, 4)
  };
}

function limitThreshold(code) {
  const pure = normalizeCode(code);
  if (pure.startsWith("688") || pure.startsWith("300") || pure.startsWith("301")) {
    return { pct: 19.5, board: "20cm" };
  }
  if (pure.startsWith("8") || pure.startsWith("4") || pure.startsWith("920")) {
    return { pct: 29, board: "30cm" };
  }
  return { pct: 9.8, board: "10cm" };
}

function isChinaAShareNonTradingDay(date) {
  const weekday = new Date(`${date.dashed}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function isStStockName(name = "") {
  return /^(\*?ST|S\*ST|SST|退)/i.test(String(name || "").trim());
}

function shouldExcludeByMarketRule(stock) {
  const changePct = Number(stock.changePct);
  return isStStockName(stock.name) || (Number.isFinite(changePct) && Math.abs(changePct) >= 21);
}

function readAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    const connection = db.connect();
    connection.all(sql, params, (error, rows) => {
      connection.close();
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    const connection = db.connect();
    const callback = (error) => {
      connection.close();
      if (error) reject(error);
      else resolve();
    };
    if (params.length) connection.run(sql, params, callback);
    else connection.run(sql, callback);
  });
}

function sqlPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "''");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function saveRowsAsParquet(rows, parquetPath, dateCompact, capturedAt = new Date().toISOString()) {
  if (!rows.length) throw new Error("自动爬取结果为空，无法保存本地行情文件");
  await mkdir(path.dirname(parquetPath), { recursive: true });
  const csvPath = `${parquetPath}.tmp.csv`;
  const lines = [
    "code,trade_time,close,open,high,low,vol,amount,date,pre_close,change,pct_chg,snapshot_at",
    ...rows.map((row) => [
      row.marketCode,
      row.tradeTime,
      row.price,
      row.open ?? row.price,
      row.high ?? row.price,
      row.low ?? row.price,
      row.vol ?? 0,
      row.amount ?? 0,
      dateCompact,
      row.preClose ?? "",
      Number.isFinite(row.price) && Number.isFinite(row.preClose) ? row.price - row.preClose : "",
      row.changePct,
      capturedAt
    ].map(csvCell).join(","))
  ];
  await writeFile(csvPath, `${lines.join("\n")}\n`, "utf8");

  const db = new duckdb.Database(":memory:");
  await runSql(db, `
    copy (
      select
        code::varchar as code,
        trade_time::varchar as trade_time,
        close::float as close,
        open::float as open,
        high::float as high,
        low::float as low,
        vol::float as vol,
        amount::float as amount,
        date::varchar as date,
        pre_close::float as pre_close,
        change::float as change,
        pct_chg::float as pct_chg,
        snapshot_at::varchar as snapshot_at
      from read_csv_auto('${sqlPath(csvPath)}', header=true)
    ) to '${sqlPath(parquetPath)}' (format parquet)
  `);
  await unlink(csvPath).catch(() => {});
}

function numericValue(value) {
  if (typeof value === "bigint") return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readHistoricalQuoteCorrections(date) {
  const directory = path.join(HISTORICAL_QUOTE_CORRECTIONS_DIR, date);
  try {
    const files = (await readdir(directory)).filter((file) => /^\d{6}\.json$/.test(file));
    const records = await Promise.all(files.map(async (file) => {
      try { return JSON.parse(await readFile(path.join(directory, file), "utf8")); } catch { return null; }
    }));
    return new Map(records.filter(Boolean).map((record) => [normalizeCode(record.code), record]));
  } catch { return new Map(); }
}

async function readLocalParquetRows(parquetPath) {
  const fileInfo = await stat(parquetPath);
  const signature = `${fileInfo.size}:${fileInfo.mtimeMs}`;
  const cached = localParquetRowCache.get(parquetPath);
  if (cached?.signature === signature) return cached.rows;
  const running = localParquetReadInFlight.get(parquetPath);
  if (running?.signature === signature) return running.promise;
  const promise = (async () => {
    const file = await asyncBufferFromFile(parquetPath);
    const parquetRows = await parquetReadObjects({ file });
  const byCode = new Map();

  for (const row of parquetRows || []) {
    const code = normalizeCode(row.code);
    if (!/^\d{6}$/.test(code)) continue;
    const close = numericValue(row.close);
    const preClose = numericValue(row.pre_close);
    if (!Number.isFinite(close) || !Number.isFinite(preClose) || preClose <= 0) continue;
    const tradeTime = String(row.trade_time || "");
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, {
        code,
        marketCode: String(row.code || code),
        firstTradeTime: tradeTime,
        lastTradeTime: tradeTime,
        firstPreClose: preClose,
        price: close,
        open: numericValue(row.open) ?? close,
        high: numericValue(row.high) ?? close,
        low: numericValue(row.low) ?? close,
        vol: numericValue(row.vol) ?? 0,
        amount: numericValue(row.amount) ?? 0,
        snapshotAt: String(row.snapshot_at || "")
      });
      continue;
    }
    if (!existing.firstTradeTime || tradeTime < existing.firstTradeTime) {
      existing.firstTradeTime = tradeTime;
      existing.firstPreClose = preClose;
    }
    if (!existing.lastTradeTime || tradeTime >= existing.lastTradeTime) {
      existing.lastTradeTime = tradeTime;
      existing.price = close;
      existing.open = numericValue(row.open) ?? existing.open;
      existing.high = Math.max(existing.high ?? close, numericValue(row.high) ?? close);
      existing.low = Math.min(existing.low ?? close, numericValue(row.low) ?? close);
      existing.vol = numericValue(row.vol) ?? existing.vol;
      existing.amount = numericValue(row.amount) ?? existing.amount;
      existing.snapshotAt = String(row.snapshot_at || existing.snapshotAt || "");
    }
  }

    const rows = Array.from(byCode.values()).map((row) => ({
    code: row.code,
    marketCode: row.marketCode,
    tradeTime: row.lastTradeTime,
    price: row.price,
    preClose: row.firstPreClose,
    open: row.open,
    high: row.high,
    low: row.low,
    vol: row.vol,
    amount: row.amount,
    snapshotAt: row.snapshotAt,
    changePct: (row.price - row.firstPreClose) / row.firstPreClose * 100
    })).sort((a, b) => b.changePct - a.changePct);
    localParquetRowCache.set(parquetPath, { signature, rows });
    return rows;
  })();
  localParquetReadInFlight.set(parquetPath, { signature, promise });
  try {
    return await promise;
  } finally {
    if (localParquetReadInFlight.get(parquetPath)?.promise === promise) localParquetReadInFlight.delete(parquetPath);
  }
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== -100 ? number : null;
}

function normalizedRowCode(row) {
  return normalizeCode(row?.code);
}

function classifiedUniverseCoverage(rows, expectedCodes) {
  if (!expectedCodes.size) return { expected_count: 0, covered_count: 0, ratio: 1 };
  const present = new Set((rows || []).map(normalizedRowCode));
  const covered = [...expectedCodes].filter((code) => present.has(code)).length;
  return { expected_count: expectedCodes.size, covered_count: covered, ratio: covered / expectedCodes.size };
}

function mergeMarketRows(primaryRows, supplementalRows) {
  const byCode = new Map();
  for (const row of [...(supplementalRows || []), ...(primaryRows || [])]) {
    const code = normalizedRowCode(row);
    if (/^\d{6}$/.test(code)) byCode.set(code, row);
  }
  return [...byCode.values()];
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function fetchJsonWithFallback(url) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (nodeError) {
    // Keep the URL inside a quoted PowerShell literal.  Passing it after
    // `-Command` makes query-string ampersands part of the command text,
    // which prevents the Eastmoney fallback from ever running.
    const requestUrl = JSON.stringify(url.toString());
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      "$ErrorActionPreference='Stop'",
      "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
      "$headers=@{Referer='https://quote.eastmoney.com/'; 'User-Agent'='Mozilla/5.0'}",
      `$payload=Invoke-RestMethod -Uri ${requestUrl} -Headers $headers -TimeoutSec 25`,
      "$payload | ConvertTo-Json -Depth 30 -Compress"
    ].join("; ");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    try {
      const text = String(stdout || "").replace(/^\uFEFF/, "").trim();
      const start = text.search(/[\[{]/);
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (start >= 0 && end >= start) return JSON.parse(text.slice(start, end + 1));
      throw new Error("PowerShell 未返回 JSON");
    } catch (parseError) {
      throw new Error(`自动爬取失败：Node fetch=${nodeError.message}；PowerShell返回无法解析（${parseError.message}）`);
    }
  }
}

function todayDashed() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function todayCompact() {
  return todayDashed().replace(/\D/g, "");
}

function chinaMarketClock() {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return { weekday: values.weekday, minute: Number(values.hour) * 60 + Number(values.minute) };
}

function isChinaMarketAfterClose() {
  const { weekday, minute } = chinaMarketClock();
  return weekday !== "Sat" && weekday !== "Sun" && minute >= CHINA_CLOSE_MINUTE;
}

function isChinaMarketOpen() {
  const { weekday, minute } = chinaMarketClock();
  if (weekday === "Sat" || weekday === "Sun") return false;
  return (minute >= 9 * 60 + 30 && minute < 11 * 60 + 30) || (minute >= 13 * 60 && minute <= 15 * 60);
}

function isBeforeChinaMarketOpen() {
  const { weekday, minute } = chinaMarketClock();
  return weekday !== "Sat" && weekday !== "Sun" && minute < 9 * 60 + 30;
}

function mostRecentWeekday(dateInfo) {
  const date = new Date(`${dateInfo.dashed}T12:00:00+08:00`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return normalizeDate(date.toISOString().slice(0, 10));
}

async function findLatestLocalTradingDateOnOrBefore(dateCompact) {
  let yearEntries;
  try {
    yearEntries = await readdir(FIVE_MINUTE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const yearEntry of yearEntries) {
    if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) continue;
    let files;
    try {
      files = await readdir(path.join(FIVE_MINUTE_DIR, yearEntry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      const match = /^(\d{8})\.parquet$/.exec(file.name);
      if (file.isFile() && match && match[1] <= dateCompact) candidates.push(match[1]);
    }
  }
  return candidates.sort((a, b) => b.localeCompare(a));
}

// 历史日期缺文件时，不能拿实时行情冒充目标日。调用补全脚本逐股查询目标日的
// 历史收盘记录：写入了数据说明是数据缺失；脚本正常结束但没有文件才可判为非交易日。
export async function backfillHistoricalDate(date) {
  const scriptPath = path.join(DATA_ROOT, "scripts", "backfill_5minute_parquet_range.mjs");
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [scriptPath, date.dashed, date.dashed],
    { cwd: DATA_ROOT, timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );
  return `${stdout || ""}${stderr || ""}`.trim();
}

// The range backfill writes one verified 15:00 daily bar per stock.  Reusing
// it here turns a delayed real-time provider into an automatic recovery path
// for the current day's final snapshot.  Concurrent UI/API requests share a
// single recovery so they cannot launch thousands of duplicate quote calls.
async function recoverCurrentClosingSnapshot(date, parquetPath) {
  const key = date.compact;
  if (closingSnapshotRecoveryInFlight.has(key)) return closingSnapshotRecoveryInFlight.get(key);
  const pending = (async () => {
    let recoveryError = "";
    try {
      await backfillHistoricalDate(date);
    } catch (error) {
      // The backfill can report a few individual-source failures after it has
      // already written sufficient daily close rows.  Always inspect the
      // resulting file before treating the recovery as unsuccessful.
      recoveryError = error.stderr || error.message || String(error);
    }
    try {
      const rows = await readLocalParquetRows(parquetPath);
      return { rows, snapshot: closingSnapshotStatus(rows), recoveryError };
    } catch (error) {
      return { rows: [], snapshot: closingSnapshotStatus([]), recoveryError: `${recoveryError}${recoveryError ? "；" : ""}${error.message}` };
    }
  })();
  closingSnapshotRecoveryInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (closingSnapshotRecoveryInFlight.get(key) === pending) closingSnapshotRecoveryInFlight.delete(key);
  }
}

async function fetchRealtimeMarketRows() {
  const rows = [];
  const pageSize = 500;
  const fs = [
    "m:0+t:6",
    "m:0+t:80",
    "m:1+t:2",
    "m:1+t:23",
    "m:0+t:81",
    "m:0+t:82"
  ].join(",");

  const { items } = await collectReportedTotalPages(async (page) => {
    const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
    url.searchParams.set("pn", String(page));
    url.searchParams.set("pz", String(pageSize));
    url.searchParams.set("po", "1");
    url.searchParams.set("np", "1");
    url.searchParams.set("fltt", "2");
    url.searchParams.set("invt", "2");
    url.searchParams.set("fid", "f3");
    url.searchParams.set("fs", fs);
    url.searchParams.set("fields", "f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18");

    const payload = await fetchJsonWithFallback(url);
    const diff = payload?.data?.diff || [];
    return {
      items: diff,
      total: payload?.data?.total,
    };
  }, {
    getKey: (item) => normalizeCode(item?.f12),
    maxPages: 100,
  });

  for (const item of items) {
    const code = normalizeCode(item.f12);
    const price = cleanNumber(item.f2);
    const preClose = cleanNumber(item.f18);
    const changePct = cleanNumber(item.f3);
    if (!/^\d{6}$/.test(code) || !Number.isFinite(price) || !Number.isFinite(changePct)) continue;
    rows.push({
      code,
      marketCode: `${item.f12}.${Number(item.f13) === 1 ? "SH" : Number(item.f13) === 0 ? "SZ" : "BJ"}`,
      name: item.f14 || "",
      tradeTime: new Date().toLocaleString("zh-CN", { hour12: false }),
      price,
      preClose,
      open: cleanNumber(item.f17),
      high: cleanNumber(item.f15),
      low: cleanNumber(item.f16),
      vol: cleanNumber(item.f5),
      amount: cleanNumber(item.f6),
      changePct
    });
  }

  return rows;
}

async function fetchSinaMarketRows(normalizedDate) {
  const rows = [];
  const pageSize = 100;

  for (let page = 1; page <= 80; page += 1) {
    const url = new URL("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData");
    url.searchParams.set("page", String(page));
    url.searchParams.set("num", String(pageSize));
    url.searchParams.set("sort", "changepercent");
    url.searchParams.set("asc", "0");
    url.searchParams.set("node", "hs_a");
    url.searchParams.set("symbol", "");
    url.searchParams.set("_s_r_a", "page");

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Referer: "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) throw new Error(`新浪财经自动爬取失败：HTTP ${response.status}`);
    const text = await response.text();
    const items = JSON.parse(text);
    if (!Array.isArray(items) || !items.length) break;

    for (const item of items) {
      const code = normalizeCode(item.code);
      const price = cleanNumber(item.trade);
      const preClose = cleanNumber(item.settlement);
      const changePct = cleanNumber(item.changepercent);
      if (!/^\d{6}$/.test(code) || !Number.isFinite(price) || !Number.isFinite(changePct)) continue;
      const symbol = String(item.symbol || "");
      rows.push({
        code,
        marketCode: `${code}.${symbol.startsWith("sh") ? "SH" : symbol.startsWith("bj") ? "BJ" : "SZ"}`,
        name: item.name || "",
        tradeTime: `${normalizedDate.dashed} ${item.ticktime || "15:00:00"}`,
        price,
        preClose,
        open: cleanNumber(item.open),
        high: cleanNumber(item.high),
        low: cleanNumber(item.low),
        vol: cleanNumber(item.volume),
        amount: cleanNumber(item.amount),
        changePct
      });
    }

    if (items.length < pageSize) break;
  }

  if (!rows.length) throw new Error("新浪财经自动爬取结果为空");
  return rows;
}

function tencentSymbol(code) {
  const normalized = normalizeCode(code);
  if (normalized.startsWith("6") || normalized.startsWith("9")) return `sh${normalized}`;
  if (normalized.startsWith("4") || normalized.startsWith("8")) return `bj${normalized}`;
  return `sz${normalized}`;
}

function tencentTradeTime(value, fallbackDate) {
  const compact = String(value || "").replace(/\D/g, "");
  if (/^\d{14}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)} ${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}`;
  return `${fallbackDate.dashed} 15:00:00`;
}

// Tencent is a per-code supplement, not a replacement for the full-market
// sources.  It fills only classified symbols that a market-wide response did
// not include, so a temporary page omission cannot propagate as "-%".
async function fetchTencentQuoteRows(codes, normalizedDate) {
  const batches = Array.from({ length: Math.ceil(codes.length / 60) }, (_, index) => codes.slice(index * 60, index * 60 + 60));
  const groups = await Promise.all(batches.map(async (batch) => {
    const url = `https://qt.gtimg.cn/q=${batch.map(tencentSymbol).join(",")}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) throw new Error(`腾讯财经自动补数失败：HTTP ${response.status}`);
    const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
    const rows = [];
    for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)";/gi)) {
      const fields = match[2].split("~");
      const code = normalizeCode(fields[2] || match[1].slice(2));
      const price = cleanNumber(fields[3]);
      const preClose = cleanNumber(fields[4]);
      if (!/^\d{6}$/.test(code) || !Number.isFinite(price) || !Number.isFinite(preClose) || preClose <= 0) continue;
      const changePct = cleanNumber(fields[32]) ?? (price - preClose) / preClose * 100;
      rows.push({
        code,
        marketCode: `${code}.${match[1].startsWith("sh") ? "SH" : match[1].startsWith("bj") ? "BJ" : "SZ"}`,
        name: fields[1] || "",
        tradeTime: tencentTradeTime(fields[30], normalizedDate),
        price,
        preClose,
        open: cleanNumber(fields[5]) ?? price,
        high: cleanNumber(fields[33]) ?? price,
        low: cleanNumber(fields[34]) ?? price,
        vol: (cleanNumber(fields[6]) ?? 0) * 100,
        amount: (cleanNumber(fields[37]) ?? 0) * 10000,
        changePct,
      });
    }
    return rows;
  }));
  return groups.flat();
}

async function readStockMap() {
  try {
    const payload = JSON.parse(await readFile(STOCK_MAP_PATH, "utf8"));
    return payload?.stocks || [];
  } catch {
    return [];
  }
}

async function readTaxonomy() {
  try {
    return JSON.parse(await readFile(TAXONOMY_PATH, "utf8"));
  } catch {
    return { sectors: [] };
  }
}

async function readStockNameMap() {
  try {
    return JSON.parse(await readFile(STOCK_NAME_MAP_PATH, "utf8"));
  } catch {
    return { version: "1.0", names: {} };
  }
}

function buildVerbosePrompt({ date, unknownLimitUpStocks, taxonomySummary }) {
  const stockList = unknownLimitUpStocks.map((stock) => ({
    code: stock.code,
    name: stock.name || "",
    change_pct: stock.changePct,
    close: stock.price,
    trade_time: stock.tradeTime,
    limit_type: stock.limitType
  }));
  const directoryReuseInstruction = "【强制目录复用规则】下方已列出完整的现有二级、三级目录。必须优先原样复用其中最贴切的标题；不得因为产品规格、应用场景、客户或终端不同而新建近义目录。举例：已存在“存储芯片”时，严禁新增“消费存储芯片”“车规存储芯片”等三级，相关细分只能写入 product_tags。只有现有目录确实无法覆盖且产业环节明显不同，才允许新增目录。";
  const multiClassificationInstruction = [
    "目录复用规则：必须优先使用“当前已有一级主线和二级目录摘要”中已存在的二级、三级标题。名称相同或只是产品规格、应用场景、客户、终端不同的方向，不得拆成近义新目录；例如已有“存储芯片”时，不得新增“消费存储芯片”“车规存储芯片”等三级，细分信息应写入 product_tags。仅当既有标题确实无法覆盖且产业环节明显不同，才可新增二级或三级。",
    "重要的多重归属规则：同一只股票可以同时属于多个一级、二级和三级目录，不能因为已有一条归属而省略其他长期产业归属。",
    "请把每一种二级归属分别写入 stocks[].classifications；每条 classifications 都必须带 primary_sector，且可在 tertiary_sectors 中包含多个三级方向。",
    "格式示例：{ \"classifications\": [{ \"primary_sector\": \"一级主线名称\", \"secondary_sector\": \"二级产业环节名称\", \"tertiary_sectors\": [\"三级产品方向A\"] }] }。"
  ].join("\n");

  return `${directoryReuseInstruction}

请你作为A股产业链分类研究员，对下面这些「${date} 当日涨停、但尚未进入我的长期产业分类库」的股票进行稳定产业归属判断。

要求：
1. 不局限于主板，要覆盖沪深北交所、创业板、科创板等全市场股票。
2. 判断每只股票应该归入哪个一级主线、二级产业环节、三级产品方向。
3. 一级主线只能从“当前已有一级主线和二级目录摘要”中选择，严禁新增、改名或返回摘要外的一级主线。
4. 在选定的既有一级主线下，二级产业环节和三级产品方向可以按需新增；二级必须是产业环节，三级必须是可形成独立行情的产品方向。
5. 产品、业务细分写入 product_tags，不要随意创建过细三级。
6. 涨停、政策、订单、客户关系、事件催化只能写在 dynamic_themes 或 reason 中，不能作为稳定三级分类。
7. 股票代码必须是6位数字。
8. 只返回严格 JSON，不要 Markdown，不要解释文字，不要代码块。

当前已有一级主线和二级目录摘要：
${JSON.stringify(taxonomySummary, null, 2)}

待分类涨停股票：
${JSON.stringify(stockList, null, 2)}

${multiClassificationInstruction}

请返回如下 JSON：
{
  "version": "1.0",
  "date": "${date}",
  "secondary_sectors": [
    {
      "primary_sector": "一级主线名称",
      "name": "二级产业环节名称",
      "tertiary_sectors": [
        "三级产品方向A"
      ]
    }
  ],
  "stocks": [
    {
      "code": "000000",
      "name": "股票名称",
      "primary_sector": "一级主线名称",
      "classifications": [
        {
          "secondary_sector": "二级产业环节名称",
          "tertiary_sectors": [
            "三级产品方向A"
          ]
        }
      ],
      "product_tags": [
        "更细产品或业务"
      ],
      "reason": "长期产业归属依据，只写主营业务和产品，不写短期炒作原因"
    }
  ],
  "dynamic_themes": [
    {
      "name": "当日炒作主题",
      "primary_sector": "一级主线名称",
      "secondary_sector": "二级产业环节名称",
      "related_tertiary_sectors": [
        "三级产品方向A"
      ],
      "stocks": [
        "000000"
      ],
      "reason": "仅描述 ${date} 当天涨停或炒作原因",
      "source": "gpt"
    }
  ]
}`;
}

function buildPrompt({ date, unknownLimitUpStocks, taxonomySummary }) {
  const directoryText = taxonomySummary.map((primary) => {
    const secondaryText = (primary.secondary_sectors || [])
      .map((secondary) => `${secondary.name}：${(secondary.tertiary_sectors || []).join("、")}`)
      .join("；");
    return `${primary.primary_sector}｜${secondaryText}`;
  }).join("\n");
  const stockList = unknownLimitUpStocks.map((stock) => ({
    code: stock.code,
    name: stock.name || "",
    change_pct: stock.changePct,
  }));

  return [
    `任务：为 ${date} 当日未分类涨停股补充长期产业归属。`,
    "硬规则：",
    "1. 一级主线只能从下方现有目录中选择，禁止新增或改名。",
    "2. 优先原样复用现有二、三级标题；已有“存储芯片”时，不得新建“消费存储芯片”“车规存储芯片”等近义标题，细分写入 product_tags。",
    "3. 同一股票可有多条 classifications；每条必须含 primary_sector、secondary_sector、tertiary_sectors。",
    "4. 只有现有目录确实无法覆盖且产业环节明显不同，才可新增二级或三级；涨停催化只写 dynamic_themes.reason。",
    "5. 只返回严格 JSON，不要 Markdown 或解释；股票代码为 6 位数字。",
    "现有目录（一级｜二级：三级）：",
    directoryText,
    "待分类股票：",
    JSON.stringify(stockList),
    "返回字段：version、date、secondary_sectors（primary_sector/name/tertiary_sectors）、stocks（code/name/primary_sector/classifications/product_tags/reason）、dynamic_themes（name/primary_sector/secondary_sector/related_tertiary_sectors/stocks/reason/source）。",
  ].join("\n");
}

async function loadDailyMarketUncached(dateValue, { localOnly = false } = {}) {
  const normalizedDate = normalizeDate(dateValue);
  if (!normalizedDate) {
    return { error: "日期格式不正确，请使用 YYYY-MM-DD 或 YYYYMMDD", status: 400 };
  }

  // A same-day pre-open request cannot have valid market-wide limit-up data.
  // Do not read an accidentally pre-created parquet, do not fall back to a
  // provider's previous close, and never cache that previous close as today.
  if (normalizedDate.compact === todayCompact() && isBeforeChinaMarketOpen()) {
    return {
      error: `当日 ${normalizedDate.dashed} 尚未开盘，不能扫描涨停或补抓当日完整行情；请在 09:30 后扫描，或选择上一交易日。`,
      status: 409,
      date: normalizedDate.dashed,
      requestedDate: normalizedDate.dashed,
      source: "market-not-open"
    };
  }

  // 周末不会产生行情：先指向上一个工作日，避免周六/周日直接退回到更早的本地文件。
  const requestedNonTradingDay = isChinaAShareNonTradingDay(normalizedDate);
  let effectiveDate = normalizedDate;
  let parquetPath = path.join(FIVE_MINUTE_DIR, effectiveDate.year, `${effectiveDate.compact}.parquet`);
  const [stocks, taxonomy, stockNames] = await Promise.all([readStockMap(), readTaxonomy(), readStockNameMap()]);
  const stockIndex = new Map(stocks.map((stock) => [normalizeCode(stock.code), stock]));
  const expectedClassifiedCodes = new Set(stocks
    .filter((stock) => !isStStockName(stock.name))
    .map((stock) => normalizeCode(stock.code))
    .filter((code) => /^\d{6}$/.test(code)));

  let source = "local";
  let sourceNote = "本地5分钟Parquet";
  let parquetError = "";
  let rows = [];
  let priorLocalRows = [];

  if (requestedNonTradingDay) {
    const localDates = await findLatestLocalTradingDateOnOrBefore(normalizedDate.compact);
    for (const fallbackDate of localDates) {
      const candidate = normalizeDate(fallbackDate);
      if (!candidate || candidate.compact >= normalizedDate.compact) continue;
      try {
        parquetPath = path.join(FIVE_MINUTE_DIR, candidate.year, `${candidate.compact}.parquet`);
        rows = await readLocalParquetRows(parquetPath);
        effectiveDate = candidate;
        source = "previous-trading-day";
        sourceNote = `请求日期 ${normalizedDate.dashed} 为非交易日，已使用上一个交易日 ${candidate.dashed} 的本地 5 分钟行情`;
        break;
      } catch (error) {
        parquetError = error.message;
      }
    }
  }

  const isCurrentMarketDate = effectiveDate.compact === todayCompact();
  const shouldFetchRealtime = isCurrentMarketDate && isChinaMarketOpen();
  const requiresClosingSnapshot = isCurrentMarketDate && isChinaMarketAfterClose();
  // During trading, quote providers expose a full-market snapshot rather than
  // a true delta feed.  Reuse a just-written local snapshot so repeated scans
  // are instant; refresh the snapshot only after its short TTL expires.
  if (!rows.length && (shouldFetchRealtime || requiresClosingSnapshot)) {
    try {
      const fileStat = await stat(parquetPath);
      const localRows = await readLocalParquetRows(parquetPath);
      priorLocalRows = localRows;
      const localStatus = closingSnapshotStatus(localRows);
      const localCoverage = classifiedUniverseCoverage(localRows, expectedClassifiedCodes);
      if (requiresClosingSnapshot && localStatus.closing_confirmed) {
        rows = localRows;
        source = "local-closing-snapshot";
        sourceNote = `已读取收盘确认行情：最后行情时间 ${localStatus.latest_quote_time}`;
      } else if (shouldFetchRealtime && hasFullMarketCoverage(localRows) && localCoverage.ratio >= MIN_CLASSIFIED_UNIVERSE_COVERAGE && Date.now() - fileStat.mtimeMs < LIVE_SNAPSHOT_TTL_MS) {
        rows = localRows;
        if (rows.length) {
          source = "local-live-cache";
          sourceNote = `已复用 ${Math.max(0, Math.round((Date.now() - fileStat.mtimeMs) / 1000))} 秒前的本地全市场快照；到期后自动增量刷新`;
        }
      }
    } catch { /* No live cache yet: fetch the first snapshot below. */ }
  }
  if (!rows.length && (shouldFetchRealtime || requiresClosingSnapshot)) {
    try {
      rows = await fetchSinaMarketRows(effectiveDate);
      if (!hasFullMarketCoverage(rows)) throw new Error(`新浪财经仅返回 ${rows.length} 只股票，低于全市场覆盖下限 ${MIN_A_SHARE_SNAPSHOT_ROWS}`);
      // Quote providers can transiently omit different symbols from otherwise
      // full-market pages.  Preserve same-day local rows as a supplement;
      // freshly fetched rows remain authoritative for duplicate codes.
      if (priorLocalRows.length) rows = mergeMarketRows(rows, priorLocalRows);
      source = "sina";
      sourceNote = "当前开盘时段：已实时读取新浪财经行情并保存到本地 5 分钟 Parquet";
      const sinaCoverage = classifiedUniverseCoverage(rows, expectedClassifiedCodes);
      if (sinaCoverage.ratio < MIN_CLASSIFIED_UNIVERSE_COVERAGE) {
        try {
          const eastmoneyRows = await fetchRealtimeMarketRows();
          rows = mergeMarketRows(rows, eastmoneyRows);
          source = "sina+eastmoney";
          sourceNote = `新浪覆盖分类股票 ${(sinaCoverage.ratio * 100).toFixed(1)}%，已合并东方财富全市场快照后保存到本地`;
        } catch (eastmoneyError) {
          // Keep the complete primary market snapshot available.  The next
          // refresh will retry the supplementary source; do not turn a
          // transient supplemental-provider outage into a blank UI.
          parquetError = `东方财富补集失败：${eastmoneyError.message}`;
          sourceNote = `新浪全市场快照已保存（分类股票覆盖 ${(sinaCoverage.ratio * 100).toFixed(1)}%；东方财富补集暂不可用，将在下次刷新重试）`;
        }
      }
    } catch (sinaError) {
      parquetError = `新浪财经：${sinaError.message}`;
      try {
        rows = await fetchRealtimeMarketRows();
        source = "eastmoney";
        sourceNote = "当前开盘时段：新浪失败后已读取东方财富实时行情并保存到本地 5 分钟 Parquet";
      } catch (eastmoneyError) {
        parquetError = `${parquetError}；东方财富：${eastmoneyError.message}`;
        if (hasFullMarketCoverage(priorLocalRows)) {
          rows = priorLocalRows;
          source = "local-live-cache";
          sourceNote = "实时行情源暂不可用，已保留并使用最近一次完整本地全市场快照；下次刷新会自动重试抓取";
        } else {
          throw eastmoneyError;
        }
      }
    }
    if (!hasFullMarketCoverage(rows)) {
      return {
        error: `当日行情覆盖不足：仅取得 ${rows.length} 只股票（至少需要 ${MIN_A_SHARE_SNAPSHOT_ROWS} 只）。已拒绝写入并将于下次请求重新抓取。`,
        status: 502,
        date: effectiveDate.dashed,
        requestedDate: normalizedDate.dashed,
        source: "realtime-coverage-insufficient",
        snapshot: closingSnapshotStatus(rows),
        fallbackError: parquetError,
      };
    }
    let snapshot = closingSnapshotStatus(rows);
    if (needsClosingSnapshotRecovery({ isCurrentMarketDate, marketAfterClose: requiresClosingSnapshot, rows })) {
      const recovered = await recoverCurrentClosingSnapshot(effectiveDate, parquetPath);
      if (recovered.snapshot.closing_confirmed) {
        rows = recovered.rows;
        snapshot = recovered.snapshot;
        source = `${source}-daily-close-recovery`;
        sourceNote = `实时行情未更新至收盘，已自动补齐日线收盘快照：最后行情时间 ${snapshot.latest_quote_time}`;
      } else {
        snapshot = recovered.snapshot;
        return {
          error: `当日行情尚未形成收盘确认快照（当前最后行情时间：${snapshot.latest_quote_time || "未知"}）。系统已自动尝试补齐当天日线收盘数据，但行情源尚未提供完整收盘记录；将自动在下次请求重试，不会使用盘中涨幅生成主线结论。`,
          status: 409,
          date: effectiveDate.dashed,
          requestedDate: normalizedDate.dashed,
          source: "closing-snapshot-recovery-pending",
          snapshot,
          fallbackError: recovered.recoveryError || undefined,
        };
      }
    }
    if (requiresClosingSnapshot && !snapshot.closing_confirmed) {
      return {
        error: `当日行情尚未形成收盘确认快照（当前最后行情时间：${snapshot.latest_quote_time || "未知"}），将继续重新爬取；不会使用盘中涨幅生成主线结论。`,
        status: 409,
        date: effectiveDate.dashed,
        requestedDate: normalizedDate.dashed,
        source: "closing-snapshot-pending",
        snapshot
      };
    }
    const coverageBeforeTencent = classifiedUniverseCoverage(rows, expectedClassifiedCodes);
    if (coverageBeforeTencent.ratio < MIN_CLASSIFIED_UNIVERSE_COVERAGE) {
      const presentCodes = new Set(rows.map(normalizedRowCode));
      const missingCodes = [...expectedClassifiedCodes].filter((code) => !presentCodes.has(code));
      try {
        const tencentRows = await fetchTencentQuoteRows(missingCodes, effectiveDate);
        rows = mergeMarketRows(rows, tencentRows);
        const coverageAfterTencent = classifiedUniverseCoverage(rows, expectedClassifiedCodes);
        if (tencentRows.length) {
          source = source === "local-live-cache" ? "local+tencent" : `${source}+tencent`;
          sourceNote = `${sourceNote}；腾讯财经已补齐 ${tencentRows.length} 只缺失分类股票（覆盖 ${(coverageAfterTencent.ratio * 100).toFixed(1)}%）`;
        }
      } catch (tencentError) {
        parquetError = `${parquetError ? `${parquetError}；` : ""}腾讯财经：${tencentError.message}`;
      }
    }
    // Never shrink a same-day local universe because one provider refresh
    // omitted a symbol.  New rows win for the codes they contain; prior local
    // rows preserve the last observed value for temporarily absent symbols.
    if (priorLocalRows.length) rows = mergeMarketRows(rows, priorLocalRows);
    await saveRowsAsParquet(rows, parquetPath, effectiveDate.compact);
    if (requiresClosingSnapshot) {
      source = `${source}-closing-confirmed`;
      sourceNote = `已重新爬取并确认收盘行情：最后行情时间 ${snapshot.latest_quote_time}`;
    }
  } else if (!rows.length) {
    try {
      rows = await readLocalParquetRows(parquetPath);
      // Older files may contain a complete universe but only a 14:xx (or
      // earlier) snapshot.  Supplementing missing symbols is insufficient:
      // append the provider's 15:00 daily rows so the reader selects the
      // verified closing record for every code.
      if (effectiveDate.compact < todayCompact() && !localOnly && !closingSnapshotStatus(rows).closing_confirmed) {
        await backfillHistoricalDate(effectiveDate);
        rows = await readLocalParquetRows(parquetPath);
        const refreshedSnapshot = closingSnapshotStatus(rows);
        if (!refreshedSnapshot.closing_confirmed) {
          return {
            error: `${effectiveDate.dashed} 的本地行情不是收盘快照，历史收盘行情补抓后仍未完成；不会使用盘中涨幅。`,
            status: 409,
            date: effectiveDate.dashed,
            requestedDate: normalizedDate.dashed,
            source: "historical-closing-snapshot-pending",
            snapshot: refreshedSnapshot
          };
        }
        source = "historical-closing-backfill";
        sourceNote = `本地盘中快照已补为收盘行情：最后行情时间 ${refreshedSnapshot.latest_quote_time}`;
      }
    } catch (error) {
      parquetError = error.message;
      if (localOnly) {
        return {
          error: `本地没有 ${normalizedDate.dashed} 的 5分钟 Parquet 数据`,
          status: 404,
          date: effectiveDate.dashed,
          requestedDate: normalizedDate.dashed,
          parquetPath: path.relative(DATA_ROOT, parquetPath),
          source: "local-missing",
          fallbackError: parquetError
        };
      }
      // 若最近一个交易日尚未落盘（如周末打开页面时缺少周五文件），行情源会
      // 返回最近收盘价；抓取后立即保存，不能直接跳过到更早的 23 日。
      const newestExpectedDate = mostRecentWeekday(normalizeDate(todayCompact()));
      if (effectiveDate.compact === newestExpectedDate.compact) {
        try {
          rows = await fetchSinaMarketRows(effectiveDate);
          source = "sina";
          sourceNote = `本地缺少 ${effectiveDate.dashed} 数据，已自动抓取最近收盘行情并保存到本地 5 分钟 Parquet`;
          await saveRowsAsParquet(rows, parquetPath, effectiveDate.compact);
        } catch (sinaError) {
          parquetError = `${parquetError}；自动抓取失败：${sinaError.message}`;
          try {
            rows = await fetchRealtimeMarketRows();
            source = "eastmoney";
            sourceNote = `本地缺少 ${effectiveDate.dashed} 数据，已自动抓取最近收盘行情并保存到本地 5 分钟 Parquet`;
            await saveRowsAsParquet(rows, parquetPath, effectiveDate.compact);
          } catch (eastmoneyError) {
            parquetError = `${parquetError}；${eastmoneyError.message}`;
          }
        }
      }
      // 对历史工作日先查询该日历史行情。成功写入表示本地数据缺失；查询不到
      // 才判定为非交易日，绝不能直接以更早交易日的数据替代目标日。
      if (!rows.length && !requestedNonTradingDay) {
        try {
          await backfillHistoricalDate(effectiveDate);
        } catch (historyError) {
          const detail = historyError.stderr || historyError.message;
          return {
            error: `本地没有 ${normalizedDate.dashed} 的 5分钟 Parquet 数据，且自动查询历史行情失败；请稍后重试。`,
            status: 502,
            date: effectiveDate.dashed,
            requestedDate: normalizedDate.dashed,
            parquetPath: path.relative(DATA_ROOT, parquetPath),
            source: "historical-fetch-failed",
            fallbackError: `${parquetError}；${detail}`
          };
        }
        try {
          rows = await readLocalParquetRows(parquetPath);
          source = "historical-backfill";
          sourceNote = `本地缺少 ${effectiveDate.dashed} 数据，已自动查询历史行情并补全到本地 Parquet`;
        } catch {
          // 补全脚本正常结束而未写入文件，表示历史行情源没有该交易日记录。
          rows = [];
        }
      }
      if (!rows.length) {
        return {
          error: `${normalizedDate.dashed} 没有可获取的历史行情，已确认为非交易日。`,
          status: 404,
          date: effectiveDate.dashed,
          requestedDate: normalizedDate.dashed,
          parquetPath: path.relative(DATA_ROOT, parquetPath),
          source: "non-trading-day",
          fallbackError: parquetError
        };
      }
    }
  }

  const historicalCorrections = await readHistoricalQuoteCorrections(effectiveDate.dashed);
  if (historicalCorrections.size) {
    source = `${source}-reconciled`;
    sourceNote = `${sourceNote}；已应用 ${historicalCorrections.size} 条经多源核验的历史日线校正`;
  }
  const allStocks = rows.map((row) => {
    const code = normalizeCode(row.code);
    const existing = stockIndex.get(code);
    const rule = limitThreshold(code);
    const correction = historicalCorrections.get(code);
    const changePct = Number(correction?.change_pct ?? row.changePct);
    return {
      code,
      marketCode: row.marketCode,
      name: stockNames.names?.[code] || existing?.name || row.name || "",
      tradeTime: row.tradeTime,
      price: Number(correction?.close ?? row.price),
      preClose: Number(correction?.pre_close ?? row.preClose),
      open: Number(correction?.open ?? row.open),
      high: Number(correction?.high ?? row.high),
      low: Number(correction?.low ?? row.low),
      changePct: Number.isFinite(changePct) ? Number(changePct.toFixed(2)) : null,
      vol: Number(row.vol),
      amount: Number(row.amount),
      classified: Boolean(existing),
      primary_sector: existing?.primary_sector || "",
      limitType: rule.board,
      isLimitUp: Number.isFinite(changePct) && changePct >= rule.pct
    };
  });

  // 行情行若自带名称，仅在读取当日行情时回写本地代码名称表；不额外发起名称查询。
  // 这会逐步补齐历史 Parquet 或实时行情中已经提供名称的股票。
  const refreshedNames = { ...(stockNames.names || {}) };
  let hasNameUpdate = false;
  for (const row of rows) {
    const code = normalizeCode(row.code);
    const name = String(row.name || "").trim();
    if (/^\d{6}$/.test(code) && name && refreshedNames[code] !== name) {
      refreshedNames[code] = name;
      hasNameUpdate = true;
    }
  }
  if (hasNameUpdate) {
    try {
      await writeFile(
        STOCK_NAME_MAP_PATH,
        `${JSON.stringify({ ...stockNames, version: "1.1", updated_at: new Date().toISOString(), names: refreshedNames }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      // 名称缓存写入失败不应阻断当日行情扫描。
    }
  }

  const filteredStocks = allStocks.filter((stock) => !shouldExcludeByMarketRule(stock));
  const excludedStocks = allStocks.filter((stock) => shouldExcludeByMarketRule(stock));
  const limitUpStocks = filteredStocks.filter((stock) => stock.isLimitUp);
  // ST、*ST、S*ST、SST 及退市整理股票不参与未分类涨停询问，
  // 即使其名称来源或前序过滤发生变化，也在候选入口处再次明确排除。
  const unknownLimitUpStocks = limitUpStocks.filter((stock) => !stock.classified && !isStStockName(stock.name));
  const taxonomySummary = (taxonomy.sectors || []).map((sector) => ({
    primary_sector: sector.name,
    secondary_sectors: (sector.secondary_sectors || []).map((secondary) => ({
      name: secondary.name,
      tertiary_sectors: secondary.tertiary_sectors || []
    }))
  }));
  const gptPrompt = buildPrompt({
    date: effectiveDate.dashed,
    requestedDate: normalizedDate.dashed,
    unknownLimitUpStocks,
    taxonomySummary
  });
  const snapshot = {
    ...closingSnapshotStatus(rows),
    captured_at: rows.map((row) => String(row.snapshotAt || "")).filter(Boolean).sort().at(-1) || null,
    required_for_end_of_day: isCurrentMarketDate && isChinaMarketAfterClose(),
  };
  let snapshotFileVersion = "";
  try {
    const fileInfo = await stat(parquetPath);
    snapshotFileVersion = `${fileInfo.size}:${fileInfo.mtimeMs}`;
  } catch {
    // A provider response is still usable for this request, but it cannot be
    // shared as a durable local snapshot until the parquet write succeeds.
  }
  const snapshotId = `${effectiveDate.dashed}|${snapshotFileVersion || `${rows.length}:${snapshot.captured_at || snapshot.latest_quote_time || "unknown"}`}`;

  return {
    date: effectiveDate.dashed,
    requestedDate: normalizedDate.dashed,
    parquetPath: path.relative(DATA_ROOT, parquetPath),
    source,
    sourceNote,
    snapshot,
    snapshot_id: snapshotId,
    quoteCorrectionsApplied: historicalCorrections.size,
    fallbackError: parquetError,
    totalStocks: filteredStocks.length,
    rawTotalStocks: allStocks.length,
    excludedCount: excludedStocks.length,
    limitUpCount: limitUpStocks.length,
    unknownLimitUpCount: unknownLimitUpStocks.length,
    stocks: filteredStocks,
    excludedStocks,
    limitUpStocks,
    unknownLimitUpStocks,
    gptPrompt,
    generatedAt: new Date().toISOString()
  };
}

export async function loadDailyMarket(dateValue, options = {}) {
  const taskCache = dailyMarketTaskStorage.getStore();
  if (!taskCache) return loadDailyMarketUncached(dateValue, options);
  const key = `${String(dateValue || "")}|${options.localOnly ? "local" : "normal"}`;
  if (taskCache.has(key)) return taskCache.get(key);
  const pending = loadDailyMarketUncached(dateValue, options);
  taskCache.set(key, pending);
  return pending;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    const payload = await loadDailyMarket(searchParams.get("date"), { localOnly: searchParams.get("localOnly") === "1" });
    if (payload.error) return NextResponse.json({ error: payload.error }, { status: payload.status });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: `当日行情扫描失败：${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const payload = await loadDailyMarket(body.date);
    if (payload.error) return NextResponse.json({ error: payload.error }, { status: payload.status });

    await mkdir(GPT_QUESTION_DIR, { recursive: true });
    const filePath = path.join(GPT_QUESTION_DIR, `${payload.date}_limit_up_unclassified.json`);
    const questionFile = {
      version: "1.0",
      type: "limit_up_unclassified_taxonomy_question",
      date: payload.date,
      generated_at: payload.generatedAt,
      source: payload.parquetPath,
      summary: {
        total_stocks: payload.totalStocks,
        limit_up_count: payload.limitUpCount,
        unknown_limit_up_count: payload.unknownLimitUpCount
      },
      unknown_limit_up_stocks: payload.unknownLimitUpStocks,
      gpt_prompt: payload.gptPrompt
    };

    await writeFile(filePath, `${JSON.stringify(questionFile, null, 2)}\n`, "utf8");
    return NextResponse.json({
      ok: true,
      file: path.relative(DATA_ROOT, filePath),
      ...payload
    });
  } catch (error) {
    return NextResponse.json(
      { error: `生成GPT询问文件失败：${error.message}` },
      { status: 500 }
    );
  }
}
