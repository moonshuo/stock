import { execFile } from "child_process";
import { readdir } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server.js";
import { loadDailyMarket, runDailyMarketTask } from "../daily-market/route.js";
import { MIN_A_SHARE_SNAPSHOT_ROWS } from "../../../lib/market-snapshot.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKET_INDEXES = [
  { key: "shanghai", label: "沪市", secid: "1.000001" },
  { key: "shenzhen", label: "深市", secid: "0.399001" },
  { key: "beijing", label: "北交所", secid: "0.899050" },
];
const FIVE_MINUTE_DIR = path.join(process.cwd(), "5分钟数据");

function normalizeDate(value = "") {
  const compact = String(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  return { compact, dashed: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` };
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

async function fetchJsonWithPowerShellFallback(url) {
  try {
    const response = await fetch(url, { cache: "no-store", headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (nodeError) {
    // 某些 Windows/代理环境会在该行情域名的 TLS 握手阶段主动断开；
    // 同域名 HTTP 接口返回相同公开行情字段，作为传输层重试而非数据 fallback。
    const transportFallbackUrl = new URL(url);
    transportFallbackUrl.protocol = "http:";
    try {
      const response = await fetch(transportFallbackUrl, { cache: "no-store", headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch { /* PowerShell is the final transport fallback below. */ }
    const requestUrl = JSON.stringify(transportFallbackUrl.toString());
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      "$ErrorActionPreference='Stop'",
      "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
      "$headers=@{Referer='https://quote.eastmoney.com/'; 'User-Agent'='Mozilla/5.0'}",
      `$payload=Invoke-RestMethod -Uri ${requestUrl} -Headers $headers -TimeoutSec 25`,
      "$payload | ConvertTo-Json -Depth 20 -Compress",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { maxBuffer: 5 * 1024 * 1024 });
    try {
      const text = String(stdout || "").replace(/^\uFEFF/, "").trim();
      const start = text.search(/[\[{]/);
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (start >= 0 && end >= start) return JSON.parse(text.slice(start, end + 1));
      throw new Error("PowerShell 未返回 JSON");
    } catch (parseError) {
      throw new Error(`Node fetch=${nodeError.message}；PowerShell=${parseError.message}`);
    }
  }
}

export function parseMarketKlines(payload, market) {
  return (payload?.data?.klines || []).map((line) => {
    const fields = String(line).split(",");
    const amountYuan = Number(fields[6]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[0]) || !Number.isFinite(amountYuan) || amountYuan < 0) return null;
    return { date: fields[0], market, amountYuan };
  }).filter(Boolean);
}

export function aggregateMarketTurnoverSeries(series, days, endDate = "") {
  const byDate = new Map();
  for (const marketRows of series) {
    for (const row of marketRows) {
      const point = byDate.get(row.date) || { date: row.date, amountYuan: 0, markets: {} };
      point.amountYuan += row.amountYuan;
      point.markets[row.market.key] = {
        label: row.market.label,
        amount_yuan: Math.round(row.amountYuan),
        amount_100m_yuan: Number((row.amountYuan / 100_000_000).toFixed(2)),
      };
      byDate.set(row.date, point);
    }
  }
  return [...byDate.values()]
    .filter((point) => !endDate || point.date <= endDate)
    .filter((point) => MARKET_INDEXES.every((market) => point.markets[market.key]))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-days)
    .map((point) => ({
      date: point.date,
      amount_yuan: Math.round(point.amountYuan),
      amount_100m_yuan: Number((point.amountYuan / 100_000_000).toFixed(2)),
      markets: point.markets,
    }));
}

async function fetchMarketHistory(market, endDate, days) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  const params = { secid: market.secid, klt: "101", fqt: "0", lmt: String(days + 10), end: endDate.compact, fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return parseMarketKlines(await fetchJsonWithPowerShellFallback(url), market);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${market.label}成交额抓取失败：${lastError?.message || "未知错误"}`);
}

export function sumFullMarketAmount(payload) {
  const rows = [...(payload?.stocks || []), ...(payload?.excludedStocks || [])];
  if (Number(payload?.rawTotalStocks) < MIN_A_SHARE_SNAPSHOT_ROWS) return null;
  const amountYuan = rows.reduce((total, row) => {
    const amount = Number(row?.amount);
    return total + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
  }, 0);
  return amountYuan > 0 ? Math.round(amountYuan) : null;
}

async function localSnapshotDates(endDate, days) {
  let years;
  try {
    years = await readdir(FIVE_MINUTE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const dates = [];
  for (const year of years) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name) || year.name > endDate.compact.slice(0, 4)) continue;
    const files = await readdir(path.join(FIVE_MINUTE_DIR, year.name), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      const match = /^(\d{8})\.parquet$/.exec(file.name);
      if (file.isFile() && match && match[1] <= endDate.compact) dates.push(match[1]);
    }
  }
  return dates.sort((left, right) => right.localeCompare(left)).slice(0, days).reverse();
}

async function loadLocalSnapshotTurnoverHistory(endDate, days) {
  const dates = await localSnapshotDates(endDate, days);
  if (dates.length < 2) throw new Error("本地全市场快照不足 2 个交易日");
  const snapshots = [];
  await runDailyMarketTask(async () => {
    for (const date of dates) snapshots.push(await loadDailyMarket(date, { localOnly: true, strictTradingDay: true }));
  });
  const points = snapshots.map((snapshot) => {
    const amountYuan = sumFullMarketAmount(snapshot);
    if (!amountYuan) return null;
    return {
      date: snapshot.date,
      amount_yuan: amountYuan,
      amount_100m_yuan: Number((amountYuan / 100_000_000).toFixed(2)),
    };
  }).filter(Boolean);
  if (points.length < 2) throw new Error("本地快照未达到全市场覆盖或缺少成交额");
  return points;
}

export async function loadMarketTurnoverHistory(endDateValue, daysValue = 20) {
  const endDate = normalizeDate(endDateValue);
  if (!endDate) return { error: "截止日期格式不正确，请使用 YYYY-MM-DD 或 YYYYMMDD", status: 400 };
  const days = Math.min(60, Math.max(2, Number.parseInt(daysValue, 10) || 20));
  // 行情源对并发的指数历史请求偶尔会主动断开连接。依次抓取三个市场，
  // 缺少任一市场都明确失败，不能用部分市场冒充“全市场成交额”。
  try {
    const series = [];
    for (const market of MARKET_INDEXES) series.push(await fetchMarketHistory(market, endDate, days));
    const points = aggregateMarketTurnoverSeries(series, days, endDate.dashed);
    if (!points.length) return { error: `${endDate.dashed} 及此前暂无可用的沪深北市场成交额`, status: 404 };
    return { end_date: endDate.dashed, days, unit: "yuan", display_unit: "亿元", source: "eastmoney-index-kline", methodology: "直接抓取沪市、深市与北交所市场指数日线成交额，并按交易日合计。", points };
  } catch (directError) {
    // 当直连行情域名被本机网络层切断时，历史全市场快照仍保存了每只股票的
    // 原始成交额。只接受达到既有全市场覆盖下限的日期，且明确返回实际口径。
    try {
      const points = await loadLocalSnapshotTurnoverHistory(endDate, days);
      return { end_date: endDate.dashed, days, unit: "yuan", display_unit: "亿元", source: "local-full-market-snapshots", methodology: "东方财富历史指数接口连接失败；已汇总本地保存的全市场日行情快照中每只股票的原始成交额。", points };
    } catch (localError) {
      throw new Error(`直连行情失败：${directError.message}；本地快照汇总失败：${localError.message}`);
    }
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    const payload = await loadMarketTurnoverHistory(searchParams.get("end_date"), searchParams.get("days"));
    if (payload.error) return NextResponse.json({ error: payload.error }, { status: payload.status });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: `市场成交额抓取失败：${error.message}` }, { status: 502 });
  }
}
