import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INDUSTRY_CATALOG_PATH = path.join(process.cwd(), "data", "ths_fine_industry_catalog.json");
const JINA_PREFIX = "https://r.jina.ai/http://q.10jqka.com.cn";

function normalizeIndustryName(value) {
  return String(value || "")
    .trim()
    .replace(/[ⅠⅡⅢIVX]+$/gi, "")
    .replace(/(行业|板块|产业链)$/g, "")
    .replace(/[（）()、，,\s/·\-—]/g, "");
}

function parseRequestedNames(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[\n,，、;；]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

async function loadIndustryCatalog() {
  const payload = JSON.parse(await readFile(INDUSTRY_CATALOG_PATH, "utf8"));
  const rows = payload.industries || [];
  if (!rows.length) throw new Error("没有读取到同花顺细分行业代码表");
  return rows;
}

function resolveIndustry(name, catalog) {
  const normalized = normalizeIndustryName(name);
  const exact = catalog.filter((item) => normalizeIndustryName(item.name) === normalized);
  if (exact.length === 1) return exact[0];
  const included = catalog.filter((item) => {
    const candidate = normalizeIndustryName(item.name);
    return normalized.length >= 2 && candidate.length >= 2
      && (candidate.includes(normalized) || normalized.includes(candidate));
  });
  return included.length === 1 ? included[0] : null;
}

function parseStocks(markdown) {
  const stocks = [];
  const pattern = /^\|\s*\d+\s*\|\s*\[(\d{6})\]\([^)]*\)\s*\|\s*\[([^\]]+)\]/gm;
  for (const match of markdown.matchAll(pattern)) {
    stocks.push({ code: match[1], name: match[2].trim() });
  }
  return stocks;
}

async function fetchMarkdown(sourceUrl) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://r.jina.ai/${sourceUrl}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchIndustry(industry) {
  const stocksByCode = new Map();
  let pages = 0;
  for (let page = 1; page <= 30; page += 1) {
    const sourceUrl = page === 1
      ? `http://q.10jqka.com.cn/thshy/detail/code/${industry.code}/`
      : `http://q.10jqka.com.cn/thshy/detail/field/199112/order/desc/page/${page}/ajax/1/code/${industry.code}`;
    const rows = parseStocks(await fetchMarkdown(sourceUrl));
    if (!rows.length) break;
    pages += 1;
    const previousSize = stocksByCode.size;
    rows.forEach((stock) => stocksByCode.set(stock.code, stock));
    if (rows.length < 20 || stocksByCode.size === previousSize) break;
  }
  return {
    ...industry,
    pages,
    source_url: `http://q.10jqka.com.cn/thshy/detail/code/${industry.code}/`,
    stocks: Array.from(stocksByCode.values()),
  };
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const requestedNames = parseRequestedNames(payload.industryNames);
    if (!requestedNames.length) {
      return NextResponse.json({ error: "请至少输入一个细分行业名称" }, { status: 400 });
    }
    if (requestedNames.length > 10) {
      return NextResponse.json({ error: "一次最多抓取 10 个细分行业" }, { status: 400 });
    }

    const catalog = await loadIndustryCatalog();
    const resolved = [];
    const unresolved = [];
    for (const requestedName of requestedNames) {
      const industry = resolveIndustry(requestedName, catalog);
      if (industry) resolved.push({ ...industry, requested_name: requestedName });
      else unresolved.push({ requested_name: requestedName, error: "没有唯一匹配到同花顺 884 细分行业" });
    }

    const settled = await Promise.allSettled(resolved.map(fetchIndustry));
    const industries = [];
    const errors = [...unresolved];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") industries.push(result.value);
      else errors.push({
        requested_name: resolved[index].requested_name,
        code: resolved[index].code,
        error: result.reason?.message || "抓取失败",
      });
    });

    return NextResponse.json({
      ok: industries.length > 0,
      industries,
      errors,
      stock_count: new Set(industries.flatMap((item) => item.stocks.map((stock) => stock.code))).size,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `抓取同花顺细分行业失败：${error.message}` },
      { status: 500 },
    );
  }
}
