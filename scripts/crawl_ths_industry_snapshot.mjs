import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "data", "imports", "ths_industry_snapshot.json");
let hexinToken = "";
try {
  const tokenSource = await readFile(resolve(root, ".ths-py312", "Lib", "site-packages", "qstock", "data", "ths.js"), "utf8");
  hexinToken = Function(`${tokenSource}; return v();`)();
} catch {
  // 无 qstock 环境时仍可尝试普通公开页请求。
}
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  Referer: "https://q.10jqka.com.cn/thshy/",
  ...(hexinToken ? { Cookie: `v=${hexinToken}`, "hexin-v": hexinToken } : {}),
};

const decodeHtml = async (response) => new TextDecoder("gbk").decode(await response.arrayBuffer());
const cleanText = (value) => value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

let nextRequestAt = 0;
async function paceRequest() {
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(nextRequestAt, Date.now()) + 250;
  if (wait) await new Promise((resolveDelay) => setTimeout(resolveDelay, wait));
}

async function fetchHtml(url, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await paceRequest();
      const response = await fetch(url, { headers });
      if (!response.ok) {
        if (response.status === 401 || response.status === 429) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000 * (attempt + 1)));
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return await decodeHtml(response);
    } catch (error) {
      if (attempt === retries) {
        console.warn(`跳过 ${url}: ${error.message}`);
        return "";
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 700 * (attempt + 1)));
    }
  }
  return "";
}

function parseIndustryLinks(html) {
  const result = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["'][^"']*\/thshy\/detail\/code\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = cleanText(match[2]);
    if (name && /^881\d{3}$/.test(match[1])) result.set(match[1], { code: match[1], name });
  }
  return [...result.values()];
}

function parseIndustryName(html) {
  const title = cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const name = title.split("行业详情")[0].trim();
  return name && !/^(同花顺|行情中心)/.test(name) ? name : "";
}

function parseConstituents(html) {
  const rows = new Map();
  const pattern = /stockpage\.10jqka\.com\.cn\/(\d{6})\/?["'][^>]*>\1<\/a>\s*<\/td>\s*<td>\s*<a\b[^>]*>([^<]+)<\/a>/gi;
  for (const match of html.matchAll(pattern)) rows.set(match[1], { code: match[1], name: cleanText(match[2]) });
  return [...rows.values()];
}

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

const overviewHtml = await fetchHtml("https://q.10jqka.com.cn/thshy/");
const broadIndustries = parseIndustryLinks(overviewHtml);
console.log(`发现 ${broadIndustries.length} 个同花顺行业板块，正在读取成分股样本…`);

const broadWithStocks = await mapLimit(broadIndustries, 2, async (industry, index) => {
  const html = await fetchHtml(`https://q.10jqka.com.cn/thshy/detail/code/${industry.code}/`);
  if ((index + 1) % 15 === 0) console.log(`一级行业 ${index + 1}/${broadIndustries.length}`);
  return { ...industry, constituents: parseConstituents(html) };
});

const candidateCodes = Array.from({ length: 500 }, (_, index) => String(884000 + index));
console.log("正在扫描同花顺细分行业代码 884000-884499…");
const scanned = await mapLimit(candidateCodes, 3, async (code, index) => {
  const html = await fetchHtml(`https://q.10jqka.com.cn/thshy/detail/code/${code}/`);
  const name = parseIndustryName(html);
  if ((index + 1) % 50 === 0) console.log(`细分行业 ${index + 1}/${candidateCodes.length}`);
  if (!name) return null;
  return { code, name, constituents: parseConstituents(html) };
});

const fineIndustries = scanned.filter(Boolean);
for (const fine of fineIndustries) {
  const fineCodes = new Set(fine.constituents.map((stock) => stock.code));
  const rankedParents = broadWithStocks
    .map((broad) => ({
      code: broad.code,
      name: broad.name,
      overlap: broad.constituents.filter((stock) => fineCodes.has(stock.code)).length,
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.name.localeCompare(b.name, "zh-CN"));
  fine.parent = rankedParents[0]?.name || "";
  fine.parent_code = rankedParents[0]?.code || "";
  fine.parent_overlap = rankedParents[0]?.overlap || 0;
  fine.parent_ambiguous = Boolean(rankedParents[1] && rankedParents[1].overlap === rankedParents[0].overlap);
}

const snapshot = {
  source: "同花顺行业板块公开行情页",
  source_url: "https://q.10jqka.com.cn/thshy/",
  fetched_at: new Date().toISOString(),
  broad_industries: broadWithStocks,
  fine_industries: fineIndustries,
};
await mkdir(resolve(root, "data", "imports"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`抓取完成：${broadWithStocks.length} 个行业、${fineIndustries.length} 个细分行业。`);
console.log(`父行业识别：${fineIndustries.filter((item) => item.parent && !item.parent_ambiguous).length} 个明确，${fineIndustries.filter((item) => !item.parent || item.parent_ambiguous).length} 个待复核。`);
console.log(outputPath);
