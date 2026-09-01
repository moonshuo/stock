import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { sanitizeStockMap, validateSectorData } from "../app/lib/sectorSystem.js";

const cwd = process.cwd();
const dataDir = path.join(cwd, "data");
const sourcePath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!sourcePath) throw new Error("用法: node scripts/import_market_research_file.mjs <market_stock_research.json> [--dry-run]");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const writeJson = async (filePath, value) => {
  const temporaryPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
};
const unique = (values) => Array.from(new Set(values.filter(Boolean)));
const primaryOf = (stock, classification) => String(classification?.primary_sector || stock?.primary_sector || "").trim();

const [source, taxonomy, stockMap, progress] = await Promise.all([
  readJson(sourcePath),
  readJson(path.join(dataDir, "sector_taxonomy.json")),
  readJson(path.join(dataDir, "stock_sector_map.json")),
  readJson(path.join(dataDir, "market_research_progress.json")),
]);

if (source?.type !== "market_stock_research" || !Array.isArray(source.stocks) || !source.stocks.length || source.stocks.length > 100) {
  throw new Error("文件不是有效的全市场 GPT 核验批次（须包含 1~100 只 stocks）");
}
const codes = source.stocks.map((stock) => String(stock.code || "").trim());
if (new Set(codes).size !== codes.length || codes.some((code) => !/^\d{6}$/.test(code))) {
  throw new Error("导入文件存在重复或非六位股票代码");
}

const nextTaxonomy = structuredClone(taxonomy);
const nextStockMap = structuredClone(stockMap);
const taxonomySecondary = new Map();
const tertiaryOwner = new Map();
for (const primary of nextTaxonomy.sectors || []) {
  for (const secondary of primary.secondary_sectors || []) {
    taxonomySecondary.set(`${primary.name}|${secondary.name}`, secondary);
    for (const tertiary of secondary.tertiary_sectors || []) tertiaryOwner.set(`${primary.name}|${tertiary}`, secondary.name);
  }
}
const ensurePath = (primaryName, secondaryName, tertiaryName) => {
  let primary = nextTaxonomy.sectors.find((item) => item.name === primaryName);
  if (!primary) {
    primary = { name: primaryName, secondary_sectors: [] };
    nextTaxonomy.sectors.push(primary);
  }
  const owner = tertiaryOwner.get(`${primaryName}|${tertiaryName}`);
  const resolvedSecondary = owner || secondaryName;
  let secondary = taxonomySecondary.get(`${primaryName}|${resolvedSecondary}`);
  if (!secondary) {
    secondary = { name: resolvedSecondary, tertiary_sectors: [] };
    primary.secondary_sectors.push(secondary);
    taxonomySecondary.set(`${primaryName}|${resolvedSecondary}`, secondary);
  }
  if (!secondary.tertiary_sectors.includes(tertiaryName)) secondary.tertiary_sectors.push(tertiaryName);
  tertiaryOwner.set(`${primaryName}|${tertiaryName}`, resolvedSecondary);
  return resolvedSecondary;
};

let addedPaths = 0;
let deduplicatedPaths = 0;
for (const incoming of source.stocks) {
  const code = String(incoming.code).trim();
  const name = String(incoming.name || "").trim();
  const entries = incoming.classifications || [];
  if (!name || !entries.length) throw new Error(`${code} 缺少名称或 classifications`);
  let target = nextStockMap.stocks.find((stock) => stock.code === code);
  if (!target) {
    target = { code, name, primary_sector: "", classifications: [], product_tags: [], reason: "" };
    nextStockMap.stocks.push(target);
  }
  for (const incomingClassification of entries) {
    const primaryName = primaryOf(incoming, incomingClassification);
    const secondaryName = String(incomingClassification.secondary_sector || "").trim();
    const tertiaryNames = unique((incomingClassification.tertiary_sectors || []).map((item) => String(item || "").trim()));
    if (!primaryName || !secondaryName || !tertiaryNames.length) throw new Error(`${code} 存在不完整分类路径`);
    for (const tertiaryName of tertiaryNames) {
      const resolvedSecondary = ensurePath(primaryName, secondaryName, tertiaryName);
      let targetClassification = target.classifications.find((item) => primaryOf(target, item) === primaryName && item.secondary_sector === resolvedSecondary);
      if (!targetClassification) {
        targetClassification = { primary_sector: primaryName, secondary_sector: resolvedSecondary, tertiary_sectors: [], relevance_score: 0 };
        target.classifications.push(targetClassification);
      }
      if (targetClassification.tertiary_sectors.includes(tertiaryName)) {
        deduplicatedPaths += 1;
      } else {
        targetClassification.tertiary_sectors.push(tertiaryName);
        addedPaths += 1;
      }
      targetClassification.relevance_score = Number(incomingClassification.relevance_score);
      targetClassification.source_refs = unique([...(targetClassification.source_refs || []), ...(incomingClassification.source_refs || []).map(String)]);
    }
  }
  target.name = name;
  target.primary_sector ||= primaryOf(incoming, entries[0]);
  target.reason = String(incoming.reason || "").trim() || target.reason;
}

const cleanedStockMap = sanitizeStockMap(nextStockMap);
// 历史库可能把同一个“一级/二级”拆为多条记录。全市场核验返回的是
// 完整集合，落盘前必须先压成一条，避免同一三级跨记录重复。
for (const stock of cleanedStockMap.stocks) {
  const grouped = new Map();
  for (const classification of stock.classifications || []) {
    const primaryName = primaryOf(stock, classification);
    const key = `${primaryName}|${classification.secondary_sector}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ...classification, primary_sector: primaryName, tertiary_sectors: [], source_refs: [] });
    }
    const target = grouped.get(key);
    target.tertiary_sectors = unique([...target.tertiary_sectors, ...(classification.tertiary_sectors || [])]);
    target.source_refs = unique([...target.source_refs, ...(classification.source_refs || [])]);
    if (Number(classification.relevance_score) > Number(target.relevance_score)) target.relevance_score = Number(classification.relevance_score);
  }
  stock.classifications = Array.from(grouped.values());
}
cleanedStockMap.stocks.sort((left, right) => left.code.localeCompare(right.code));
const validation = validateSectorData(nextTaxonomy, cleanedStockMap, []);
if (!validation.ok) throw new Error(`合并后校验失败:\n${validation.errors.join("\n")}`);

if (!dryRun) {
  const completedAt = new Date().toISOString();
  const nextProgress = { version: "1.0", completed: { ...(progress.completed || {}) } };
  for (const code of codes) nextProgress.completed[code] = { completed_at: completedAt, batch_id: String(source.batch_id || "") };
  await Promise.all([
    writeJson(path.join(dataDir, "sector_taxonomy.json"), nextTaxonomy),
    writeJson(path.join(dataDir, "stock_sector_map.json"), cleanedStockMap),
    writeJson(path.join(dataDir, "market_research_progress.json"), nextProgress),
  ]);
}

console.log(JSON.stringify({ dryRun, stocks: codes.length, addedPaths, deduplicatedPaths, completedAfterImport: Object.keys({ ...(progress.completed || {}), ...Object.fromEntries(codes.map((code) => [code, true])) }).length, warnings: validation.warnings.length }, null, 2));
