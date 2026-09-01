import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toSecid(code) {
  const value = String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!value) return "";
  if (value.startsWith("8") || value.startsWith("4") || value.startsWith("920")) return `0.${value}`;
  if (value.startsWith("6")) return `1.${value}`;
  return `0.${value}`;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== -100 ? number : null;
}

function toTencentSymbol(code) {
  const value = String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!value) return "";
  return `${value.startsWith("6") ? "sh" : "sz"}${value}`;
}

async function fetchEastmoneyQuotes(secids) {
  const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("fields", "f12,f14,f2,f3,f4,f5,f6");
  url.searchParams.set("secids", secids.join(","));
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) throw new Error(`东方财富行情请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  const quotes = {};
  for (const item of payload?.data?.diff || []) {
    const code = String(item.f12 || "");
    if (!code) continue;
    quotes[code] = {
      code,
      name: item.f14 || "",
      price: cleanNumber(item.f2),
      changePct: cleanNumber(item.f3),
      change: cleanNumber(item.f4),
      volume: cleanNumber(item.f5),
      amount: cleanNumber(item.f6)
    };
  }
  if (!Object.keys(quotes).length) throw new Error("东方财富行情返回为空");
  return quotes;
}

async function fetchTencentQuotes(codes) {
  const symbols = Array.from(new Set(codes.map(toTencentSymbol).filter(Boolean)));
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(",")}`, {
    cache: "no-store",
    headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`腾讯行情请求失败：HTTP ${response.status}`);
  // 腾讯行情为 GB18030 编码；直接按 UTF-8 读取会导致备用源的股票名称乱码。
  const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const quotes = {};
  for (const line of text.split(/;\s*/)) {
    const match = /^v_([a-z]{2})(\d{6})="([\s\S]*)"$/.exec(line.trim());
    if (!match) continue;
    const [, , code, payload] = match;
    const fields = payload.split("~");
    const price = cleanNumber(fields[3]);
    const preClose = cleanNumber(fields[4]);
    if (!Number.isFinite(price) || !Number.isFinite(preClose) || preClose === 0) continue;
    quotes[code] = {
      code,
      name: fields[1] || "",
      price,
      changePct: cleanNumber(fields[32]),
      change: cleanNumber(fields[31]),
      volume: cleanNumber(fields[6]),
      amount: cleanNumber(fields[37])
    };
  }
  if (!Object.keys(quotes).length) throw new Error("腾讯行情返回为空");
  return quotes;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  const secids = Array.from(new Set(codes.map(toSecid).filter(Boolean)));
  if (!secids.length) {
    return NextResponse.json({ quotes: {}, updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
  }

  try {
    const quotes = await fetchEastmoneyQuotes(secids);
    return NextResponse.json({ quotes, source: "eastmoney", updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
  } catch (eastmoneyError) {
    try {
      const quotes = await fetchTencentQuotes(codes);
      return NextResponse.json({ quotes, source: "tencent", updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
    } catch (tencentError) {
    return NextResponse.json(
        { quotes: {}, error: "行情获取失败", detail: { eastmoney: eastmoneyError.message, tencent: tencentError.message }, updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) },
      { status: 502 }
    );
    }
  }
}
