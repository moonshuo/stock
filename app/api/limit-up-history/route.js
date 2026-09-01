import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toSecid(code) {
  const value = String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (value.startsWith("6")) return `1.${value}`;
  return `0.${value}`;
}

function limitThreshold(code) {
  const value = String(code || "");
  if (value.startsWith("8") || value.startsWith("4")) return 29.5;
  if (value.startsWith("300") || value.startsWith("688")) return 19.5;
  return 9.5;
}

async function scanStock(code, beg, end) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", toSecid(code));
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", beg);
  url.searchParams.set("end", end);
  url.searchParams.set("lmt", "45");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  const response = await fetch(url, { cache: "no-store", headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${code} 日线请求失败`);
  const payload = await response.json();
  const limitUps = (payload?.data?.klines || []).map((row) => row.split(",")).filter((row) => Number(row[8]) >= limitThreshold(code));
  if (!limitUps.length) return null;
  return { count: limitUps.length, lastDate: limitUps.at(-1)[0] };
}

export async function GET(request) {
  const codes = [...new Set((new URL(request.url).searchParams.get("codes") || "").split(",").map((code) => code.trim()).filter((code) => /^\d{6}$/.test(code)))].slice(0, 120);
  if (!codes.length) return NextResponse.json({ records: {} });
  const endDate = new Date();
  const beginDate = new Date(endDate);
  beginDate.setDate(beginDate.getDate() - 45);
  const formatDate = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const records = {};
  for (let start = 0; start < codes.length; start += 6) {
    const batch = codes.slice(start, start + 6);
    const results = await Promise.all(batch.map(async (code) => ({ code, record: await scanStock(code, formatDate(beginDate), formatDate(endDate)).catch(() => null) })));
    for (const { code, record } of results) if (record) records[code] = record;
  }
  return NextResponse.json({ records, scanned: codes.length, period: "近 30 个交易日" });
}
