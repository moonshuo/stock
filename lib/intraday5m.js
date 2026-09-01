import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const headers = { Referer: "https://finance.qq.com/", "User-Agent": "Mozilla/5.0" };
const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function tencentSymbol(code) {
  if (code.startsWith("6") || code.startsWith("9")) return `sh${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `bj${code}`;
  return `sz${code}`;
}

function eastmoneySecid(code) {
  return `${code.startsWith("6") || code.startsWith("9") ? "1" : "0"}.${code}`;
}

async function requestJson(url, source) {
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.json();
}

async function fromTencent(code, date) {
  const symbol = tencentSymbol(code);
  const payload = await requestJson(`https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline/mkline?param=${symbol},m5,,,640`, "tencent_proxy");
  const bars = (payload?.data?.[symbol]?.m5 || []).map((row) => {
    const stamp = String(row[0] || "");
    const time = stamp.length >= 12 ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00` : stamp;
    return { time, open: numberOrNull(row[1]), close: numberOrNull(row[2]), high: numberOrNull(row[3]), low: numberOrNull(row[4]), volume: numberOrNull(row[5]), amount: null };
  }).filter((bar) => bar.time.startsWith(date));
  if (bars.length < 30) throw new Error(`tencent_proxy: ${date} only returned ${bars.length} bars`);
  return { source: "tencent_proxy", bars };
}

async function fromSina(code, date) {
  const symbol = tencentSymbol(code);
  const rows = await requestJson(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=5&ma=no&datalen=2048`, "sina");
  const bars = (Array.isArray(rows) ? rows : []).map((row) => ({
    time: String(row.day || ""), open: numberOrNull(row.open), close: numberOrNull(row.close), high: numberOrNull(row.high), low: numberOrNull(row.low), volume: numberOrNull(row.volume), amount: null,
  })).filter((bar) => bar.time.startsWith(date));
  if (bars.length < 30) throw new Error(`sina: ${date} only returned ${bars.length} bars`);
  return { source: "sina", bars };
}

async function fromEastmoney(code, date) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
  [["secid", eastmoneySecid(code)], ["ndays", "5"], ["iscr", "0"], ["iscca", "0"], ["fields1", "f1,f2,f3,f4,f5,f6,f7,f8"], ["fields2", "f51,f52,f53,f54,f55,f56,f57,f58"]]
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await requestJson(url, "eastmoney");
  const bars = (payload?.data?.trends || []).map((line) => {
    const [time, open, close, high, low, volume, amount, average] = line.split(",");
    return { time, open: numberOrNull(open), close: numberOrNull(close), high: numberOrNull(high), low: numberOrNull(low), volume: numberOrNull(volume), amount: numberOrNull(amount), average: numberOrNull(average) };
  }).filter((bar) => bar.time.startsWith(date));
  if (bars.length < 30) throw new Error(`eastmoney: ${date} only returned ${bars.length} bars`);
  return { source: "eastmoney", bars };
}

async function fetchWithFallback(code, date) {
  const failures = [];
  for (const getter of [fromTencent, fromSina, fromEastmoney]) {
    try { return { ...(await getter(code, date)), fallback_failures: failures }; }
    catch (error) { failures.push(error.message); }
  }
  throw new Error(failures.join(" | "));
}

export async function ensureIntraday5m({ date, code, name = "", refresh = false }) {
  const normalizedCode = String(code).padStart(6, "0");
  const outputDir = path.join(ROOT, "data", "intraday_5m", date);
  const file = path.join(outputDir, `${normalizedCode}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (cached?.date === date && cached?.interval === "5m" && Array.isArray(cached.bars) && cached.bars.length >= 30) {
        return { bars: cached.bars, source: cached.source || "cache", cached: true, fallback_failures: cached.fallback_failures || [] };
      }
    } catch { /* Cache miss. */ }
  }
  const result = await fetchWithFallback(normalizedCode, date);
  await mkdir(outputDir, { recursive: true });
  await writeFile(file, `${JSON.stringify({ version: "2.0", source: result.source, fallback_failures: result.fallback_failures, code: normalizedCode, name, date, interval: "5m", bars: result.bars, fetched_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return { ...result, cached: false };
}

export async function ensureIntraday5mBatch({ date, members, concurrency = 4 }) {
  const results = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, members.length) }, async () => {
    while (cursor < members.length) {
      const member = members[cursor++];
      try { results.set(member.code, await ensureIntraday5m({ date, code: member.code, name: member.name })); }
      catch (error) { results.set(member.code, { error: error.message, bars: [] }); }
    }
  }));
  return results;
}

async function dailyTurnoverFromTencent(code, date) {
  const symbol = tencentSymbol(code);
  const payload = await requestJson(`https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline/kline?param=${symbol},day,,,120`, "tencent_daily");
  const row = (payload?.data?.[symbol]?.day || []).find((item) => String(item[0]) === date);
  if (!row) throw new Error(`tencent_daily: no row for ${date}`);
  const [, open, close, high, low, volume] = row;
  const typical = (Number(high) + Number(low) + Number(close)) / 3;
  const lots = Number(volume);
  if (!Number.isFinite(typical) || !Number.isFinite(lots) || typical <= 0 || lots <= 0) throw new Error(`tencent_daily: invalid OHLCV for ${date}`);
  return { source: "tencent_daily", amount: typical * lots * 100, amount_type: "estimated_from_daily_ohlcv" };
}

async function dailyTurnoverFromSohu(code, date) {
  const compact = date.replace(/-/g, "");
  const url = `https://q.stock.sohu.com/hisHq?code=cn_${code}&start=${compact}&end=${compact}&stat=1&order=D&period=d&callback=`;
  const payload = await requestJson(url, "sohu_daily");
  const row = payload?.[0]?.hq?.find((item) => String(item[0]) === date);
  // Sohu returns turnover in 10,000 CNY at index 8.
  const turnoverWan = Number(row?.[8]);
  if (!Number.isFinite(turnoverWan) || turnoverWan <= 0) throw new Error(`sohu_daily: invalid turnover for ${date}`);
  return { source: "sohu_daily", amount: turnoverWan * 10000, amount_type: "reported" };
}

async function dailyTurnoverFromTonghuashun(code, date) {
  const prefix = code.startsWith("6") || code.startsWith("9") ? "hs" : code.startsWith("8") || code.startsWith("4") ? "bj" : "hs";
  const url = `https://d.10jqka.com.cn/v6/line/${prefix}_${code}/01/last.js`;
  const text = await (await fetch(url, { headers, cache: "no-store" })).text();
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("tonghuashun_daily: invalid JSONP response");
  const payload = JSON.parse(text.slice(start + 1, end));
  const row = String(payload?.data || "").split(";").find((item) => item.startsWith(date.replace(/-/g, "")));
  const turnover = Number(row?.split(",")?.[6]);
  if (!Number.isFinite(turnover) || turnover <= 0) throw new Error(`tonghuashun_daily: invalid turnover for ${date}`);
  return { source: "tonghuashun_daily", amount: turnover, amount_type: "reported" };
}

async function dailyTurnoverFromSina(code, date) {
  const symbol = tencentSymbol(code);
  const rows = await requestJson(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=240`, "sina_daily");
  const row = (Array.isArray(rows) ? rows : []).find((item) => String(item.day || "").startsWith(date));
  const typical = (Number(row?.high) + Number(row?.low) + Number(row?.close)) / 3;
  const shares = Number(row?.volume);
  if (!Number.isFinite(typical) || !Number.isFinite(shares) || typical <= 0 || shares <= 0) throw new Error(`sina_daily: invalid OHLCV for ${date}`);
  return { source: "sina_daily", amount: typical * shares, amount_type: "estimated_from_daily_ohlcv" };
}

export async function ensureDailyTurnover({ date, code, refresh = false }) {
  const normalizedCode = String(code).padStart(6, "0");
  const directory = path.join(ROOT, "data", "daily_turnover", date);
  const file = path.join(directory, `${normalizedCode}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (cached?.date === date && cached?.amount_type === "reported" && Number.isFinite(cached?.amount) && cached.amount > 0) return { ...cached, cached: true };
    } catch { /* Cache miss. */ }
  }
  const errors = [];
  for (const getter of [dailyTurnoverFromTonghuashun, dailyTurnoverFromSohu, dailyTurnoverFromTencent, dailyTurnoverFromSina]) {
    try {
      const result = await getter(normalizedCode, date);
      const record = { version: "1.0", date, code: normalizedCode, ...result, fallback_failures: errors, fetched_at: new Date().toISOString() };
      await mkdir(directory, { recursive: true });
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      return { ...record, cached: false };
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors.join(" | "));
}

// Historical daily turnover rate is fetched separately from turnover amount.
// It is cached by trading date and never inferred from a later quote.
export async function ensureDailyTurnoverRate({ date, code, refresh = false }) {
  const normalizedCode = String(code).padStart(6, "0");
  const directory = path.join(ROOT, "data", "daily_turnover_rate", date);
  const file = path.join(directory, `${normalizedCode}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (cached?.date === date && cached?.code === normalizedCode && Number.isFinite(cached?.turnover_rate)) return { ...cached, cached: true };
    } catch { /* Cache miss. */ }
  }
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  [["secid", eastmoneySecid(normalizedCode)], ["klt", "101"], ["fqt", "0"], ["lmt", "240"], ["end", date.replace(/-/g, "")], ["fields1", "f1,f2,f3,f4,f5,f6"], ["fields2", "f51,f52,f53,f54,f55,f56,f57,f58"]]
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await requestJson(url, "eastmoney_daily_turnover_rate");
  const row = (payload?.data?.klines || []).map((line) => String(line).split(",")).find((item) => item[0] === date);
  const turnoverRate = numberOrNull(row?.[10]);
  if (!Number.isFinite(turnoverRate)) throw new Error(`eastmoney_daily_turnover_rate: no turnover rate for ${date}`);
  const record = { version: "1.0", date, code: normalizedCode, turnover_rate: turnoverRate, source: "eastmoney_daily_kline", fetched_at: new Date().toISOString() };
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { ...record, cached: false };
}

// Historical share-capital snapshots are not part of the local 5-minute
// files.  For the capacity-core eligibility gate, derive a date-adjusted
// total market cap from the latest reported total market cap / quote price
// (which gives an estimated share count) and the close of the observed day.
// The record deliberately retains its `estimated_from_current_share_capital`
// type so it can never be mistaken for an exchange historical-cap snapshot.
export async function ensureHistoricalMarketCap({ date, code, close, refresh = false }) {
  const normalizedCode = String(code).padStart(6, "0");
  const targetClose = numberOrNull(close);
  if (!Number.isFinite(targetClose) || targetClose <= 0) {
    throw new Error("historical_market_cap: missing observed close");
  }
  const directory = path.join(ROOT, "data", "historical_market_cap", date);
  const file = path.join(directory, `${normalizedCode}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (cached?.date === date && cached?.code === normalizedCode
        && Number.isFinite(cached?.market_cap) && cached.market_cap > 0) {
        return { ...cached, cached: true };
      }
    } catch { /* Cache miss. */ }
  }

  const failures = [];
  let quotePrice = null;
  let quoteTotalCap = null;
  let estimatedTotalShares = null;
  let estimatedFloatShares = null;
  let source = null;

  // Tencent provides current total/float share capital in a lightweight
  // quote response.  It is the primary source because it is accessible on
  // this machine; Eastmoney remains a fallback below.
  try {
    const symbol = tencentSymbol(normalizedCode);
    const response = await fetch(`https://qt.gtimg.cn/q=${symbol}`, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    const openingQuote = raw.indexOf('="');
    const closingQuote = raw.lastIndexOf('"');
    const body = openingQuote >= 0 && closingQuote > openingQuote ? raw.slice(openingQuote + 2, closingQuote) : "";
    const fields = body.split("~");
    quotePrice = numberOrNull(fields[3]);
    // Tencent field 73 is total shares, and field 72 is circulating shares.
    estimatedTotalShares = numberOrNull(fields[73]);
    estimatedFloatShares = numberOrNull(fields[72]);
    quoteTotalCap = numberOrNull(fields[45]);
    if (!Number.isFinite(quotePrice) || quotePrice <= 0 || !Number.isFinite(estimatedTotalShares) || estimatedTotalShares <= 0) {
      throw new Error("invalid total share capital");
    }
    source = "tencent_quote";
    quoteTotalCap *= 100000000; // Tencent quote field 45 is in 亿元.
  } catch (error) {
    failures.push(`tencent_quote: ${error.message}`);
  }

  if (!source) {
    try {
      const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
      [["secid", eastmoneySecid(normalizedCode)], ["fields", "f43,f20,f21"], ["fltt", "2"], ["invt", "2"]]
        .forEach(([key, value]) => url.searchParams.set(key, value));
      const payload = await requestJson(url, "eastmoney_market_cap");
      quotePrice = numberOrNull(payload?.data?.f43);
      quoteTotalCap = numberOrNull(payload?.data?.f20);
      const quoteFloatCap = numberOrNull(payload?.data?.f21);
      if (!Number.isFinite(quotePrice) || quotePrice <= 0 || !Number.isFinite(quoteTotalCap) || quoteTotalCap <= 0) {
        throw new Error("invalid quote market cap");
      }
      estimatedTotalShares = quoteTotalCap / quotePrice;
      estimatedFloatShares = Number.isFinite(quoteFloatCap) && quoteFloatCap > 0 ? quoteFloatCap / quotePrice : null;
      source = "eastmoney_quote";
    } catch (error) {
      failures.push(`eastmoney_quote: ${error.message}`);
    }
  }

  if (!source) throw new Error(failures.join(" | "));
  const record = {
    version: "1.0",
    date,
    code: normalizedCode,
    observed_close: targetClose,
    market_cap: estimatedTotalShares * targetClose,
    free_float_market_cap: Number.isFinite(estimatedFloatShares) ? estimatedFloatShares * targetClose : null,
    market_cap_type: "estimated_from_current_share_capital",
    source,
    quote_price: quotePrice,
    quote_total_market_cap: quoteTotalCap,
    fallback_failures: failures,
    fetched_at: new Date().toISOString(),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { ...record, cached: false };
}
