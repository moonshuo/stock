import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

const require = createRequire(import.meta.url);
const duckdb = require("duckdb");
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "5分钟数据");
const MIN_COMPLETE_CODES = 5000;
const CONCURRENCY = 6;

function usage() {
  console.log("用法：npm run backfill:market -- 2026-07-10 [--dry-run]");
  console.log("      npm run backfill:market -- 2026-07 [--dry-run]");
}

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
  return `${code.startsWith("6") ? "1" : code.startsWith("4") || code.startsWith("8") || code.startsWith("92") ? "0" : "0"}.${code}`;
}

function readAll(db, sql) {
  return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function sqlPath(value) {
  return value.replace(/\\/g, "/").replace(/'/g, "''");
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function parquetRows(filePath) {
  return parquetReadObjects({ file: await asyncBufferFromFile(filePath) });
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
  throw new Error("找不到含至少 5000 只股票的完整本地 Parquet，无法确定补全股票池");
}

async function targetFiles(input) {
  if (/^\d{4}-?\d{2}$/.test(input)) {
    const compactMonth = input.replace(/\D/g, "");
    const folder = path.join(DATA_DIR, compactMonth.slice(0, 4));
    return (await fs.readdir(folder)).filter((file) => file.startsWith(compactMonth) && file.endsWith(".parquet"))
      .map((file) => path.join(folder, file)).sort();
  }
  const date = normalizeDate(input);
  if (!date) throw new Error("日期应为 YYYY-MM-DD 或 YYYY-MM");
  return [path.join(DATA_DIR, date.year, `${date.compact}.parquet`)];
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// 只补当天收盘记录即可满足涨幅扫描；原有的 5 分钟记录会完整保留。
async function fetchDailyClose(code, date) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid(code));
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", date.compact);
  url.searchParams.set("end", date.compact);
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  const data = await fetchJson(url);
  const line = data?.data?.klines?.[0];
  if (!line) return null;
  const values = line.split(",");
  const open = Number(values[1]); const close = Number(values[2]); const high = Number(values[3]); const low = Number(values[4]);
  const volume = Number(values[5]); const amount = Number(values[6]); const changePct = Number(values[8]);
  if (![open, close, high, low, changePct].every(Number.isFinite) || close <= 0) return null;
  const preClose = close / (1 + changePct / 100);
  if (!Number.isFinite(preClose) || preClose <= 0) return null;
  return { code: marketCode(code), trade_time: `${date.dashed} 15:00:00`, close, open, high, low, vol: Number.isFinite(volume) ? volume : 0, amount: Number.isFinite(amount) ? amount : 0, date: date.compact, pre_close: preClose, change: close - preClose, pct_chg: changePct };
}

async function mapLimit(items, worker) {
  const results = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { const value = await worker(item); if (value) results.push(value); } catch { /* 单只失败可下次重跑 */ }
    }
  }));
  return results;
}

async function saveMerged(filePath, originalRows, extraRows) {
  const csvPath = `${filePath}.backfill.csv`;
  const tempPath = `${filePath}.backfill.tmp`;
  const header = "code,trade_time,close,open,high,low,vol,amount,date,pre_close,change,pct_chg";
  const lines = [header, ...[...originalRows, ...extraRows].map((row) => [row.code, row.trade_time, row.close, row.open, row.high, row.low, row.vol, row.amount, row.date, row.pre_close, row.change, row.pct_chg].map(csv).join(","))];
  await fs.writeFile(csvPath, `${lines.join("\n")}\n`, "utf8");
  const db = new duckdb.Database(":memory:");
  await readAll(db, `copy (select * from read_csv_auto('${sqlPath(csvPath)}', header=true)) to '${sqlPath(tempPath)}' (format parquet)`);
  await fs.rename(tempPath, filePath);
  await fs.unlink(csvPath).catch(() => {});
}

const [input, ...flags] = process.argv.slice(2);
if (!input || flags.includes("--help")) { usage(); process.exit(input ? 0 : 1); }
const dryRun = flags.includes("--dry-run");
const universe = await findUniverseFile();
console.log(`完整股票池：${path.relative(ROOT, universe.file)}（${universe.codes.size} 只）`);

for (const filePath of await targetFiles(input)) {
  const date = normalizeDate(path.basename(filePath, ".parquet"));
  const rows = await parquetRows(filePath);
  const present = new Set(rows.map((row) => normalizeCode(row.code)));
  const missing = [...universe.codes].filter((code) => !present.has(code));
  console.log(`${date.dashed}：已有 ${present.size} 只，缺少 ${missing.length} 只`);
  if (!missing.length || dryRun) continue;
  let finished = 0;
  const extraRows = await mapLimit(missing, async (code) => {
    try {
      return await fetchDailyClose(code, date);
    } finally {
      finished += 1;
      if (finished % 100 === 0 || finished === missing.length) console.log(`  已请求 ${finished}/${missing.length}`);
    }
  });
  if (!extraRows.length) {
    console.warn(`  未取得剩余缺失股票的有效历史行情；原文件保持不变。`);
    continue;
  }
  if (extraRows.length < missing.length) console.warn(`  本次成功补入 ${extraRows.length} 只，仍有 ${missing.length - extraRows.length} 只缺失；可直接重新运行继续补。`);
  await saveMerged(filePath, rows, extraRows);
  console.log(`  已写回 ${path.relative(ROOT, filePath)}，现有 ${present.size + extraRows.length} 只股票。`);
}
