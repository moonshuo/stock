import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const [date, primary, secondary, ...flags] = process.argv.slice(2);
const refresh = flags.includes("--refresh");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !primary || !secondary) {
  throw new Error("Usage: node scripts/fetch_eastmoney_intraday.mjs YYYY-MM-DD primary secondary");
}

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
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.json();
}

async function fromTencent(code, targetDate) {
  const symbol = tencentSymbol(code);
  const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline/mkline?param=${symbol},m5,,,640`;
  const payload = await requestJson(url, "tencent_proxy");
  const rows = payload?.data?.[symbol]?.m5 || [];
  const bars = rows.map((row) => {
    const stamp = String(row[0] || "");
    const time = stamp.length >= 12
      ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00`
      : stamp;
    return {
      time,
      open: numberOrNull(row[1]), close: numberOrNull(row[2]), high: numberOrNull(row[3]), low: numberOrNull(row[4]),
      volume: numberOrNull(row[5]), amount: null,
    };
  }).filter((bar) => bar.time.startsWith(targetDate));
  if (bars.length < 30) throw new Error(`tencent_proxy: ${targetDate} only returned ${bars.length} bars`);
  return { source: "tencent_proxy", bars };
}

async function fromSina(code, targetDate) {
  const symbol = tencentSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=5&ma=no&datalen=2048`;
  const rows = await requestJson(url, "sina");
  const bars = (Array.isArray(rows) ? rows : []).map((row) => ({
    time: String(row.day || ""),
    open: numberOrNull(row.open), close: numberOrNull(row.close), high: numberOrNull(row.high), low: numberOrNull(row.low),
    volume: numberOrNull(row.volume), amount: null,
  })).filter((bar) => bar.time.startsWith(targetDate));
  if (bars.length < 30) throw new Error(`sina: ${targetDate} only returned ${bars.length} bars`);
  return { source: "sina", bars };
}

async function fromEastmoney(code, targetDate) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
  [["secid", eastmoneySecid(code)], ["ndays", "5"], ["iscr", "0"], ["iscca", "0"],
    ["fields1", "f1,f2,f3,f4,f5,f6,f7,f8"], ["fields2", "f51,f52,f53,f54,f55,f56,f57,f58"]]
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await requestJson(url, "eastmoney");
  const bars = (payload?.data?.trends || []).map((line) => {
    const [time, open, close, high, low, volume, amount, average] = line.split(",");
    return { time, open: numberOrNull(open), close: numberOrNull(close), high: numberOrNull(high), low: numberOrNull(low), volume: numberOrNull(volume), amount: numberOrNull(amount), average: numberOrNull(average) };
  }).filter((bar) => bar.time.startsWith(targetDate));
  if (bars.length < 30) throw new Error(`eastmoney: ${targetDate} only returned ${bars.length} bars`);
  return { source: "eastmoney", bars };
}

async function fetchWithFallback(code, targetDate) {
  const failures = [];
  for (const getter of [fromTencent, fromSina, fromEastmoney]) {
    try { return { ...(await getter(code, targetDate)), failures }; }
    catch (error) { failures.push(error.message); }
  }
  throw new Error(failures.join(" | "));
}

const stockMap = JSON.parse(await fs.readFile(path.join(ROOT, "data", "stock_sector_map.json"), "utf8"));
const members = stockMap.stocks.filter((stock) => (stock.classifications || []).some((item) =>
  (item.primary_sector || stock.primary_sector) === primary && item.secondary_sector === secondary
));
const outputDir = path.join(ROOT, "data", "intraday_5m", date);
await fs.mkdir(outputDir, { recursive: true });

const failures = [];
const sources = {};
let saved = 0;
let reused = 0;
for (const stock of members) {
  const code = String(stock.code).padStart(6, "0");
  const targetFile = path.join(outputDir, `${code}.json`);
  try {
    if (!refresh) {
      try {
        const cached = JSON.parse(await fs.readFile(targetFile, "utf8"));
        if (cached?.date === date && cached?.interval === "5m" && Array.isArray(cached?.bars) && cached.bars.length >= 30) {
          sources[`cache:${cached.source || "unknown"}`] = (sources[`cache:${cached.source || "unknown"}`] || 0) + 1;
          reused += 1;
          continue;
        }
      } catch { /* Cache miss or incomplete cache: fetch below. */ }
    }
    const result = await fetchWithFallback(code, date);
    await fs.writeFile(targetFile, `${JSON.stringify({
      version: "2.0", source: result.source, fallback_failures: result.failures, code, name: stock.name || "", date,
      interval: "5m", bars: result.bars, fetched_at: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    sources[result.source] = (sources[result.source] || 0) + 1;
    saved += 1;
  } catch (error) {
    failures.push({ code, name: stock.name || "", error: error.message });
  }
}

const report = { date, primary_sector: primary, secondary_sector: secondary, interval: "5m", requested: members.length, saved, reused, refresh, sources, failures, completed_at: new Date().toISOString() };
await fs.writeFile(path.join(outputDir, "_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
