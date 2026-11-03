import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const annualSources = new Map();
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const codeOf = (value) => String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
const thsPrefix = (code) => code.startsWith("6") || code.startsWith("9") ? "hs" : code.startsWith("4") || code.startsWith("8") ? "bj" : "hs";
const txSymbol = (code) => code.startsWith("6") || code.startsWith("9") ? `sh${code}` : code.startsWith("4") || code.startsWith("8") ? `bj${code}` : `sz${code}`;

function quote(date, open, high, low, close, volume, source) {
  const row = { date, open: n(open), high: n(high), low: n(low), close: n(close), volume: n(volume), source };
  if (![row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0)
    || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) return null;
  return row;
}

async function annualQfqQuotes(code, year) {
  const key = `${code}|${year}`;
  if (!annualSources.has(key)) annualSources.set(key, Promise.all([
    fetch(`https://d.10jqka.com.cn/v6/line/${thsPrefix(code)}_${code}/01/${year}.js`, { headers: { Referer: "https://stock.10jqka.com.cn/", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) })
      .then(async (response) => { if (!response.ok) throw new Error(`tonghuashun HTTP ${response.status}`); return response.text(); })
      .then((text) => {
        const payload = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
        return new Map(String(payload?.data || "").split(";").map((line) => {
          const [compact, open, high, low, close, volume] = line.split(",");
          return [`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`, quote(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`, open, high, low, close, volume, "tonghuashun_qfq")];
        }));
      }),
    // `proxy.finance.qq.com` responds 501 for the qfq-kline route, causing
    // every otherwise valid 60-day window to fail.  Query Tencent's public
    // endpoint directly; the response schema remains the same and is still
    // reconciled against Tonghuashun before any bar is persisted.
    fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txSymbol(code)},day,${year}-01-01,${year}-12-31,320,qfq`, { headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) })
      .then(async (response) => { if (!response.ok) throw new Error(`tencent HTTP ${response.status}`); return response.json(); })
      .then((payload) => new Map((payload?.data?.[txSymbol(code)]?.qfqday || []).map(([date, open, close, high, low, volume]) => [date, quote(date, open, high, low, close, Number(volume) * 100, "tencent_qfq")])))
  ]));
  try { return await annualSources.get(key); }
  catch (error) { annualSources.delete(key); throw error; }
}

function agrees(left, right) {
  return ["open", "high", "low", "close"].every((field) => Math.abs(left[field] - right[field]) <= .011);
}

function auditedRecord(code, date, ths, tencent) {
  const left = ths.get(date), right = tencent.get(date);
  if (!left || !right || !agrees(left, right)) throw new Error(`qfq_daily_quote: two-source disagreement for ${date}/${code}`);
  // Although the providers return a year of data in one response, an audit
  // record uses only the requested bar and the immediately preceding bar.
  // No later observation is written into, or available to, the scorer.
  const previousDate = [...ths.keys()].filter((item) => item < date).sort().at(-1);
  const previousThs = previousDate && ths.get(previousDate), previousTencent = previousDate && tencent.get(previousDate);
  if (!previousThs || !previousTencent || Math.abs(previousThs.close - previousTencent.close) > .011) throw new Error(`qfq_daily_quote: previous-close disagreement for ${date}/${code}`);
  const consensus = { date, open: left.open, high: left.high, low: left.low, close: left.close, pre_close: previousThs.close, source: "tonghuashun_qfq+tencent_qfq" };
  return { version: "1.0", code, date, quotes: [left, right], consensus, verification: "two_source_qfq_ohlc_agreement", fetched_at: new Date().toISOString() };
}

async function writeAudit(record) {
  const file = path.join(ROOT, "data", "historical_qfq_quote_audits", record.date, `${record.code}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  // Readers must never observe a half-written audit while a selection job is
  // populating the cache in the background.
  const pending = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(pending, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(pending, file);
}

export async function readCachedQfqDailyQuote({ date, code }) {
  const normalized = codeOf(code);
  const record = JSON.parse(await readFile(path.join(ROOT, "data", "historical_qfq_quote_audits", date, `${normalized}.json`), "utf8"));
  if (record?.version !== "1.0" || record?.date !== date || record?.code !== normalized || record?.verification !== "two_source_qfq_ohlc_agreement" || !record?.consensus) throw new Error("invalid qfq daily quote cache");
  return { ...record.consensus, source: record.consensus.source, verification: record.verification, cached: true };
}

export async function ensureQfqDailyQuote({ date, code, refresh = false }) {
  const normalized = codeOf(code);
  if (!refresh) try { return await readCachedQfqDailyQuote({ date, code: normalized }); } catch { /* cache miss */ }
  const [ths, tencent] = await annualQfqQuotes(normalized, date.slice(0, 4));
  const record = auditedRecord(normalized, date, ths, tencent);
  await writeAudit(record);
  return { ...record.consensus, verification: record.verification, cached: false };
}

/** Populate one stock's complete as-of window from one dual-source fetch.
 *
 * This is intentionally a cache-preparation operation, not a scoring
 * fallback: every persisted row still has to pass the same two-source OHLC
 * and previous-close checks as an on-demand request.
 */
export async function ensureQfqDailyQuoteWindow({ dates, code, onDate } = {}) {
  const normalized = codeOf(code);
  const orderedDates = [...new Set(dates || [])].sort();
  if (!normalized || !orderedDates.length || orderedDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error("qfq_daily_quote: valid code and dates are required");
  const cached = await Promise.all(orderedDates.map(async (date) => {
    try { await readCachedQfqDailyQuote({ date, code: normalized }); return { date, ok: true, cached: true }; }
    catch { return null; }
  }));
  if (cached.every(Boolean)) {
    for (const value of cached) onDate?.(value);
    return cached;
  }
  const groups = new Map();
  for (const date of orderedDates) {
    const year = date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(date);
  }
  const results = [];
  for (const [year, yearDates] of groups) {
    const [ths, tencent] = await annualQfqQuotes(normalized, year);
    for (const date of yearDates) {
      try {
        const record = auditedRecord(normalized, date, ths, tencent);
        await writeAudit(record);
        const value = { date, ok: true };
        results.push(value); onDate?.(value);
      } catch (error) {
        const value = { date, ok: false, error: error.message };
        results.push(value); onDate?.(value);
      }
    }
  }
  return results;
}
