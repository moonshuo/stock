import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

const require = createRequire(import.meta.url);
const duckdb = require("duckdb");
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "5分钟数据");
const MIN_COMPLETE_CODES = 5000;
const CONCURRENCY = 16;

function normalizeDate(value = "") {
  const compact = String(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  return { compact, dashed: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`, year: compact.slice(0, 4) };
}

function normalizeCode(value = "") {
  return String(value).replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function marketCode(code) {
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("92")) return `${code}.BJ`;
  return `${code}.SZ`;
}

function secid(code) {
  return `${code.startsWith("6") ? "1" : "0"}.${code}`;
}

function tencentSymbol(code) {
  if (code.startsWith("6")) return `sh${code}`;
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("92")) return `bj${code}`;
  return `sz${code}`;
}

function sqlPath(value) {
  return value.replace(/\\/g, "/").replace(/'/g, "''");
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readAll(db, sql) {
  return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function parquetRows(filePath) {
  return parquetReadObjects({ file: await asyncBufferFromFile(filePath) });
}

function hasClosingSnapshot(rows = []) {
  const latestMinute = rows.reduce((latest, row) => {
    const match = String(row.trade_time || "").match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
    const minute = match ? Number(match[1]) * 60 + Number(match[2]) : -1;
    return Math.max(latest, Number.isFinite(minute) ? minute : -1);
  }, -1);
  return rows.length >= MIN_COMPLETE_CODES && latestMinute >= 15 * 60;
}

async function findUniverseFile() {
  const years = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const candidates = [];
  for (const year of years.filter((item) => item.isDirectory())) {
    for (const file of await fs.readdir(path.join(DATA_DIR, year.name))) {
      if (/^\d{8}\.parquet$/.test(file)) candidates.push(path.join(DATA_DIR, year.name, file));
    }
  }
  candidates.sort((a, b) => b.localeCompare(a));
  for (const candidate of candidates) {
    const codes = new Set((await parquetRows(candidate)).map((row) => normalizeCode(row.code)));
    if (codes.size >= MIN_COMPLETE_CODES) return { file: candidate, codes };
  }
  throw new Error("找不到包含至少 5000 只股票的完整本地 Parquet，无法确定补全股票池");
}

function weekdaysBetween(start, end) {
  const result = [];
  const current = new Date(`${start.dashed}T00:00:00Z`);
  const endTime = new Date(`${end.dashed}T00:00:00Z`).getTime();
  while (current.getTime() <= endTime) {
    const weekday = current.getUTCDay();
    if (weekday !== 0 && weekday !== 6) result.push(current.toISOString().slice(0, 10).replace(/-/g, ""));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchDailyHistory(code, start, end) {
  // Tencent's daily endpoint often publishes the current trading day later
  // than Eastmoney.  For a post-close recovery, an empty Tencent response
  // made the whole automatic path look unavailable even though Eastmoney had
  // already published the official daily bar.
  try {
    const rows = await fetchEastmoneyDailyHistory(code, start, end);
    if (rows.size) return rows;
  } catch { /* Tencent remains a fallback for a transient Eastmoney outage. */ }
  return fetchTencentDailyHistory(code, start, end);
}

function daysBefore(date, days) {
  const value = new Date(`${date.dashed}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return normalizeDate(value.toISOString().slice(0, 10));
}

async function fetchTencentDailyHistory(code, start, end) {
  const symbol = tencentSymbol(code);
  const lookback = daysBefore(start, 20);
  const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
  url.searchParams.set("param", `${symbol},day,${lookback.dashed},${end.dashed},240,qfq`);
  const response = await fetch(url, { headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`腾讯财经 HTTP ${response.status}`);
  const payload = await response.json();
  // Market scanning uses the actual daily close and pre-close.  Prefer the
  // unadjusted series; qfq prices would silently distort current-day returns
  // around corporate-action adjustment dates.
  const series = payload?.data?.[symbol]?.day || payload?.data?.[symbol]?.qfqday || [];
  const rows = new Map();
  for (let index = 1; index < series.length; index += 1) {
    const values = series[index];
    const date = normalizeDate(values[0]);
    if (!date || date.compact < start.compact || date.compact > end.compact) continue;
    const open = Number(values[1]); const close = Number(values[2]); const high = Number(values[3]); const low = Number(values[4]); const volume = Number(values[5]);
    const preClose = Number(series[index - 1]?.[2]);
    if (![open, close, high, low, preClose].every(Number.isFinite) || close <= 0 || preClose <= 0) continue;
    const changePct = (close - preClose) / preClose * 100;
    rows.set(date.compact, { code: marketCode(code), trade_time: `${date.dashed} 15:00:00`, close, open, high, low, vol: Number.isFinite(volume) ? volume : 0, amount: 0, date: date.compact, pre_close: preClose, change: close - preClose, pct_chg: changePct });
  }
  return rows;
}

async function fetchEastmoneyDailyHistory(code, start, end) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid(code));
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", start.compact);
  url.searchParams.set("end", end.compact);
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  const data = await fetchJson(url);
  const rows = new Map();
  for (const line of data?.data?.klines || []) {
    const values = line.split(",");
    const date = normalizeDate(values[0]);
    const open = Number(values[1]); const close = Number(values[2]); const high = Number(values[3]); const low = Number(values[4]);
    const volume = Number(values[5]); const amount = Number(values[6]); const changePct = Number(values[8]);
    if (!date || ![open, close, high, low, changePct].every(Number.isFinite) || close <= 0) continue;
    const preClose = close / (1 + changePct / 100);
    if (!Number.isFinite(preClose) || preClose <= 0) continue;
    rows.set(date.compact, { code: marketCode(code), trade_time: `${date.dashed} 15:00:00`, close, open, high, low, vol: Number.isFinite(volume) ? volume : 0, amount: Number.isFinite(amount) ? amount : 0, date: date.compact, pre_close: preClose, change: close - preClose, pct_chg: changePct });
  }
  return rows;
}

async function mapLimit(items, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  }));
}

async function saveMerged(filePath, originalRows, extraRows) {
  const csvPath = `${filePath}.backfill.csv`;
  const tempPath = `${filePath}.backfill.tmp`;
  const header = "code,trade_time,close,open,high,low,vol,amount,date,pre_close,change,pct_chg";
  const lines = [header, ...[...originalRows, ...extraRows].map((row) => [row.code, row.trade_time, row.close, row.open, row.high, row.low, row.vol, row.amount, row.date, row.pre_close, row.change, row.pct_chg].map(csv).join(","))];
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(csvPath, `${lines.join("\n")}\n`, "utf8");
  const db = new duckdb.Database(":memory:");
  await readAll(db, `copy (select * from read_csv_auto('${sqlPath(csvPath)}', header=true)) to '${sqlPath(tempPath)}' (format parquet)`);
  await fs.rename(tempPath, filePath);
  await fs.unlink(csvPath).catch(() => {});
}

const [startValue, endValue, ...flags] = process.argv.slice(2);
const start = normalizeDate(startValue);
const end = normalizeDate(endValue);
if (!start || !end || start.compact > end.compact || flags.includes("--help")) {
  console.log("用法：npm run backfill:market:range -- 2026-05-01 2026-07-22 [--dry-run]");
  process.exit(startValue || endValue ? 1 : 0);
}

const dryRun = flags.includes("--dry-run");
const universe = await findUniverseFile();
const targets = new Map();
for (const compact of weekdaysBetween(start, end)) {
  const date = normalizeDate(compact);
  targets.set(compact, { date, filePath: path.join(DATA_DIR, date.year, `${date.compact}.parquet`), present: new Set(), existing: false, extra: [] });
}

for (const target of targets.values()) {
  try {
    const rows = await parquetRows(target.filePath);
    target.present = new Set(rows.map((row) => normalizeCode(row.code)));
    target.closingConfirmed = hasClosingSnapshot(rows);
    target.existing = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const incomplete = [...targets.values()].filter((target) => target.present.size < MIN_COMPLETE_CODES || !target.closingConfirmed);
const neededCodes = new Set(incomplete.flatMap((target) => target.closingConfirmed
  ? [...universe.codes].filter((code) => !target.present.has(code))
  : [...universe.codes]));
console.log(`完整股票池：${path.relative(ROOT, universe.file)}（${universe.codes.size} 只）`);
console.log(`目标交易日：${targets.size} 个；待补文件：${incomplete.length} 个；需查询股票：${neededCodes.size} 只`);
for (const target of incomplete) console.log(`  ${target.date.dashed}：已有 ${target.present.size}，收盘确认=${target.closingConfirmed ? "是" : "否"}`);
if (dryRun || !incomplete.length) process.exit(0);

let finished = 0;
let requestFailures = 0;
const failureSamples = [];
await mapLimit([...neededCodes], async (code) => {
  try {
    const history = await fetchDailyHistory(code, start, end);
    
    for (const [compact, row] of history) {
      const target = targets.get(compact);
      if (target && (target.present.size < MIN_COMPLETE_CODES || !target.closingConfirmed) && (!target.present.has(code) || !target.closingConfirmed)) target.extra.push(row);
    }
  } catch (error) {
    requestFailures += 1;
    if (failureSamples.length < 3) failureSamples.push(`${code}: ${error.message}`);
  } finally {
    finished += 1;
    if (finished % 100 === 0 || finished === neededCodes.size) console.log(`历史行情已查询 ${finished}/${neededCodes.size}`);
  }
});

const totalExtraRows = incomplete.reduce((sum, target) => sum + target.extra.length, 0);
if (!totalExtraRows) {
  throw new Error(`历史行情源未返回任何目标日期数据；${requestFailures}/${neededCodes.size} 个请求失败。${failureSamples.join("；")}`);
}

for (const target of incomplete) {
  if (!target.extra.length) {
    console.log(`${target.date.dashed}：无可写入数据（节假日或本轮请求未返回）`);
    continue;
  }
  const originalRows = target.existing ? await parquetRows(target.filePath) : [];
  await saveMerged(target.filePath, originalRows, target.extra);
  console.log(`${target.date.dashed}：已补入 ${target.extra.length}，现有 ${target.present.size + target.extra.length} 只`);
}

if (requestFailures) {
  console.warn(`补全已写入可用数据，但仍有 ${requestFailures}/${neededCodes.size} 个请求失败；可稍后重跑继续补齐。${failureSamples.join("；")}`);
  process.exitCode = 1;
}
