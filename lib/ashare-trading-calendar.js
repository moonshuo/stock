import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "data", "ashare_trading_calendar");
const SSE_CLOSED_NOTICE_LIST = "https://www.sse.com.cn/disclosure/dealinstruc/closed/list/";
const loadedYears = new Map();

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datesInRange(year, startMonth, startDay, endMonth, endDay) {
  const result = [];
  const cursor = new Date(Date.UTC(year, startMonth - 1, startDay));
  const end = new Date(Date.UTC(year, endMonth - 1, endDay));
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function closedDatesFromNotice(html, year) {
  const text = String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const dates = new Set();
  const range = /(\d{1,2})月(\d{1,2})日[^。；]{0,80}?至[^。；]{0,80}?(\d{1,2})月(\d{1,2})日[^。；]{0,80}?休市/g;
  for (const match of text.matchAll(range)) {
    for (const date of datesInRange(year, ...match.slice(1).map(Number))) dates.add(date);
  }
  return [...dates].sort();
}

async function fetchOfficialYear(year) {
  const headers = { Referer: "https://www.sse.com.cn/", "User-Agent": "Mozilla/5.0" };
  const list = await fetch(SSE_CLOSED_NOTICE_LIST, { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!list.ok) throw new Error(`SSE calendar list: HTTP ${list.status}`);
  const listHtml = await list.text();
  const anchors = [...listHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const anchor = anchors.find((item) => new RegExp(`${year}年.*休市`).test(item[2].replace(/<[^>]+>/g, "")));
  if (!anchor) throw new Error(`SSE calendar notice for ${year} was not found`);
  const sourceUrl = new URL(anchor[1], SSE_CLOSED_NOTICE_LIST).href;
  const response = await fetch(sourceUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`SSE calendar notice: HTTP ${response.status}`);
  const closedDates = closedDatesFromNotice(await response.text(), year);
  if (!closedDates.length) throw new Error(`SSE calendar notice for ${year} contained no parseable closure dates`);
  return { version: "1.0", market: "沪深北A股", year, source: "上海证券交易所休市安排", source_url: sourceUrl, fetched_at: new Date().toISOString(), closed_dates: closedDates };
}

export async function loadChinaAShareTradingCalendar(year) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 1990 || numericYear > 2100) throw new Error("invalid calendar year");
  if (!loadedYears.has(numericYear)) {
    const pending = (async () => {
      const file = path.join(CACHE_DIR, `${numericYear}.json`);
      try {
        const cached = JSON.parse(await readFile(file, "utf8"));
        if (cached?.year === numericYear && Array.isArray(cached.closed_dates)) return { ...cached, cached: true };
      } catch { /* Cache miss: obtain the official notice below. */ }
      const fetched = await fetchOfficialYear(numericYear);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, `${JSON.stringify(fetched, null, 2)}\n`, "utf8");
      return { ...fetched, cached: false };
    })();
    loadedYears.set(numericYear, pending);
    pending.catch(() => loadedYears.delete(numericYear));
  }
  return loadedYears.get(numericYear);
}

export async function isChinaAShareNonTradingDay(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  const calendar = await loadChinaAShareTradingCalendar(Number(match[1]));
  return calendar.closed_dates.includes(date);
}
