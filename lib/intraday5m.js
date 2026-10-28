import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const headers = { Referer: "https://finance.qq.com/", "User-Agent": "Mozilla/5.0" };
const eastmoneyHeaders = { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" };
const tonghuashunHeaders = { Referer: "https://stock.10jqka.com.cn/", "User-Agent": "Mozilla/5.0" };
const tonghuashunAnnualDailyCache = new Map();
const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

// 同花顺 v6 日线的成交量字段已经是“股”。把它再次按“手”乘以 100 会
// 将反推流通股本和流通市值放大 100 倍，进而错误改变换手率分档评分。
export function tonghuashunDailyVolumeToShares(value) {
  return numberOrNull(value);
}

function tencentSymbol(code) {
  if (code.startsWith("6") || code.startsWith("9")) return `sh${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `bj${code}`;
  return `sz${code}`;
}

function eastmoneySecid(code) {
  return `${code.startsWith("6") || code.startsWith("9") ? "1" : "0"}.${code}`;
}

async function requestJson(url, source, requestHeaders = headers) {
  const response = await fetch(url, { headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.json();
}

export async function readCachedDailyTurnoverRate({ date, code }) {
  const normalizedCode = String(code).padStart(6, "0");
  const file = path.join(ROOT, "data", "daily_turnover_rate", date, `${normalizedCode}.json`);
  const cached = JSON.parse(await readFile(file, "utf8"));
  const historicalQuote = cached?.historical_quote;
  if (cached?.date !== date || cached?.code !== normalizedCode || !Number.isFinite(cached?.turnover_rate)
    || !Number.isFinite(historicalQuote?.close) || historicalQuote.close <= 0
    || !Number.isFinite(historicalQuote?.volume) || historicalQuote.volume <= 0) {
    throw new Error(`daily_turnover_rate cache unavailable for ${date}/${normalizedCode}`);
  }
  return { ...cached, cached: true };
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
  const text = await (await fetch(url, { headers: tonghuashunHeaders, cache: "no-store" })).text();
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("tonghuashun_daily: invalid JSONP response");
  const payload = JSON.parse(text.slice(start + 1, end));
  const row = String(payload?.data || "").split(";").find((item) => item.startsWith(date.replace(/-/g, "")));
  // Daily rows are date, open, high, low, close, volume, amount,
  // turnover_rate, ... .  This loader returns the reported *amount*.
  const turnover = Number(row?.split(",")?.[6]);
  if (!Number.isFinite(turnover) || turnover <= 0) throw new Error(`tonghuashun_daily: invalid turnover for ${date}`);
  return { source: "tonghuashun_daily", amount: turnover, amount_type: "reported" };
}

async function dailyTurnoverRateFromTonghuashun(code, date) {
  const prefix = code.startsWith("6") || code.startsWith("9") ? "hs" : code.startsWith("8") || code.startsWith("4") ? "bj" : "hs";
  const year = String(date).slice(0, 4);
  const cacheKey = `${prefix}_${code}_${year}`;
  if (!tonghuashunAnnualDailyCache.has(cacheKey)) {
    const promise = (async () => {
      const url = `https://d.10jqka.com.cn/v6/line/${prefix}_${code}/01/${year}.js`;
      const text = await (await fetch(url, { headers: tonghuashunHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) })).text();
      const start = text.indexOf("(");
      const end = text.lastIndexOf(")");
      if (start < 0 || end <= start) throw new Error("tonghuashun_daily_turnover_rate: invalid JSONP response");
      const payload = JSON.parse(text.slice(start + 1, end));
      return new Map(String(payload?.data || "").split(";").map((line) => [line.slice(0, 8), line]));
    })();
    tonghuashunAnnualDailyCache.set(cacheKey, promise);
    promise.catch(() => tonghuashunAnnualDailyCache.delete(cacheKey));
  }
  const row = (await tonghuashunAnnualDailyCache.get(cacheKey)).get(date.replace(/-/g, ""));
  const fields = row?.split(",") || [];
  // date, open, high, low, close, volume, amount, turnover_rate, ...
  const close = numberOrNull(fields[4]);
  const volume = tonghuashunDailyVolumeToShares(fields[5]);
  const amount = numberOrNull(fields[6]);
  const turnoverRate = numberOrNull(fields[7]);
  if (!Number.isFinite(turnoverRate) || turnoverRate < 0) throw new Error(`tonghuashun_daily_turnover_rate: no turnover rate for ${date}`);
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0) throw new Error(`tonghuashun_daily_turnover_rate: incomplete daily quote for ${date}`);
  return { source: "tonghuashun_daily_kline", turnover_rate: turnoverRate, historical_quote: { close, volume, amount: Number.isFinite(amount) && amount > 0 ? amount : null } };
}

async function dailyTurnoverRateFromEastmoney(code, date) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  [["secid", eastmoneySecid(code)], ["klt", "101"], ["fqt", "0"], ["lmt", "240"], ["end", date.replace(/-/g, "")], ["fields1", "f1,f2,f3,f4,f5,f6"], ["fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"]]
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await requestJson(url, "eastmoney_daily_turnover_rate", eastmoneyHeaders);
  const row = (payload?.data?.klines || []).map((line) => String(line).split(",")).find((item) => item[0] === date);
  const turnoverRate = numberOrNull(row?.[10]);
  const close = numberOrNull(row?.[2]);
  const volumeInLots = numberOrNull(row?.[5]);
  const amount = numberOrNull(row?.[6]);
  if (!Number.isFinite(turnoverRate) || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volumeInLots) || volumeInLots <= 0) {
    throw new Error(`eastmoney_daily_turnover_rate: incomplete daily row for ${date}`);
  }
  // 东财 f55 日线成交量单位同样为手；与 f61 换手率配套使用时转换为股。
  return { source: "eastmoney_daily_kline", turnover_rate: turnoverRate, historical_quote: { close, volume: volumeInLots * 100, amount: Number.isFinite(amount) && amount > 0 ? amount : null } };
}

async function dailyTurnoverRateFromSohu(code, date) {
  const compact = date.replace(/-/g, "");
  const url = `https://q.stock.sohu.com/hisHq?code=cn_${code}&start=${compact}&end=${compact}&stat=1&order=D&period=d&callback=`;
  const payload = await requestJson(url, "sohu_daily_turnover_rate");
  // 日期、开盘、收盘、涨跌、涨跌幅、最低、最高、成交量(手)、成交额(万元)、换手率。
  const row = payload?.[0]?.hq?.find((item) => String(item?.[0]) === date);
  const close = numberOrNull(row?.[2]);
  const volumeInLots = numberOrNull(row?.[7]);
  const amountWan = numberOrNull(row?.[8]);
  const turnoverRate = numberOrNull(String(row?.[9] ?? "").replace("%", ""));
  if (!Number.isFinite(turnoverRate) || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volumeInLots) || volumeInLots <= 0) {
    throw new Error(`sohu_daily_turnover_rate: incomplete daily row for ${date}`);
  }
  return { source: "sohu_daily_kline", turnover_rate: turnoverRate, historical_quote: { close, volume: volumeInLots * 100, amount: Number.isFinite(amountWan) && amountWan > 0 ? amountWan * 10_000 : null } };
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
    try { return await readCachedDailyTurnoverRate({ date, code: normalizedCode }); } catch { /* Cache miss. */ }
  }
  const failures = [];
  // Same-year daily rows from Tonghuashun provide rate, volume and close in
  // one response. Eastmoney remains an independent fallback when it is not
  // available, rather than delaying every candidate behind an EM timeout.
  for (const getter of [dailyTurnoverRateFromTonghuashun, dailyTurnoverRateFromEastmoney, dailyTurnoverRateFromSohu]) {
    try {
      const result = await getter(normalizedCode, date);
      const record = { version: "1.0", date, code: normalizedCode, ...result, fallback_failures: failures, fetched_at: new Date().toISOString() };
      await mkdir(directory, { recursive: true });
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      return { ...record, cached: false };
    } catch (error) { failures.push(error.message); }
  }
  throw new Error(failures.join(" | "));
}
