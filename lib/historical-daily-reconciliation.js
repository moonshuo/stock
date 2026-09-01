import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const headers = { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" };
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const normalizeCode = (value) => String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
const compactDate = (value) => String(value || "").replace(/\D/g, "");
const dashedDate = (value) => `${compactDate(value).slice(0, 4)}-${compactDate(value).slice(4, 6)}-${compactDate(value).slice(6, 8)}`;
const secid = (code) => `${code.startsWith("6") || code.startsWith("9") ? "1" : "0"}.${code}`;
const tencentSymbol = (code) => code.startsWith("6") || code.startsWith("9") ? `sh${code}` : code.startsWith("8") || code.startsWith("4") ? `bj${code}` : `sz${code}`;

async function getJson(url, source) {
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.json();
}

function record({ source, date, open, close, high, low, previousClose, changePct }) {
  const normalized = { source, date, open: number(open), close: number(close), high: number(high), low: number(low), pre_close: number(previousClose), change_pct: number(changePct) };
  if (!Number.isFinite(normalized.close) || !Number.isFinite(normalized.pre_close) || normalized.pre_close <= 0) throw new Error(`${source}: incomplete daily quote`);
  if (!Number.isFinite(normalized.change_pct)) normalized.change_pct = (normalized.close / normalized.pre_close - 1) * 100;
  return normalized;
}

async function fromEastmoney(code, date) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  [["secid", secid(code)], ["klt", "101"], ["fqt", "0"], ["beg", "19900101"], ["end", compactDate(date)], ["lmt", "8"], ["fields1", "f1,f2,f3,f4,f5,f6"], ["fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"]].forEach(([key, value]) => url.searchParams.set(key, value));
  const rows = (await getJson(url, "eastmoney_daily"))?.data?.klines || [];
  const parsed = rows.map((line) => String(line).split(","));
  const index = parsed.findIndex((row) => row[0] === dashedDate(date));
  if (index < 1) throw new Error("eastmoney_daily: target or previous day missing");
  const row = parsed[index], previous = parsed[index - 1];
  return record({ source: "eastmoney_daily_unadjusted", date: row[0], open: row[1], close: row[2], high: row[3], low: row[4], previousClose: previous[2], changePct: row[8] });
}

async function fromTencent(code, date) {
  const symbol = tencentSymbol(code);
  const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline/kline?param=${symbol},day,,,120`;
  const rows = (await getJson(url, "tencent_daily"))?.data?.[symbol]?.day || [];
  const index = rows.findIndex((row) => String(row[0]) === dashedDate(date));
  if (index < 1) throw new Error("tencent_daily: target or previous day missing");
  const row = rows[index], previous = rows[index - 1];
  return record({ source: "tencent_daily", date: row[0], open: row[1], close: row[2], high: row[3], low: row[4], previousClose: previous[2] });
}

async function fromSina(code, date) {
  const symbol = tencentSymbol(code);
  const rows = await getJson(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=240`, "sina_daily");
  const index = (Array.isArray(rows) ? rows : []).findIndex((row) => String(row.day || "").startsWith(dashedDate(date)));
  if (index < 1) throw new Error("sina_daily: target or previous day missing");
  const row = rows[index], previous = rows[index - 1];
  return record({ source: "sina_daily", date: String(row.day).slice(0, 10), open: row.open, close: row.close, high: row.high, low: row.low, previousClose: previous.close });
}

function agrees(left, right) {
  return Math.abs(left.close - right.close) <= 0.011 && Math.abs(left.pre_close - right.pre_close) <= 0.011;
}

export async function auditHistoricalDailyQuote({ code, date, refresh = false } = {}) {
  const normalizedCode = normalizeCode(code), normalizedDate = dashedDate(date);
  if (!/^\d{6}$/.test(normalizedCode) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) throw new Error("code and date are required");
  const file = path.join(ROOT, "data", "historical_quote_audits", normalizedDate, `${normalizedCode}.json`);
  if (!refresh) {
    try { return { ...(JSON.parse(await readFile(file, "utf8"))), cached: true }; } catch { /* Cache miss. */ }
  }
  const outcomes = await Promise.allSettled([fromEastmoney(normalizedCode, normalizedDate), fromTencent(normalizedCode, normalizedDate), fromSina(normalizedCode, normalizedDate)]);
  const quotes = outcomes.filter((outcome) => outcome.status === "fulfilled").map((outcome) => outcome.value);
  const failures = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason?.message || "unknown source failure");
  const consensus = quotes.find((quote, index) => quotes.some((other, otherIndex) => otherIndex !== index && agrees(quote, other))) || null;
  const result = { version: "1.0", code: normalizedCode, date: normalizedDate, quotes, failures, consensus, consensus_status: consensus ? "two_source_agreement" : quotes.length ? "unresolved" : "unavailable", fetched_at: new Date().toISOString() };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { ...result, cached: false };
}
