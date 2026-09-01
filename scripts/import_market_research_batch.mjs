import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStockMap, validateSectorData } from "../app/lib/sectorSystem.js";

const sourceFile = process.argv[2];
if (!sourceFile) throw new Error("用法：node scripts/import_market_research_batch.mjs <返回JSON文件>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = (...parts) => path.join(root, "data", ...parts);
const read = (name) => JSON.parse(fs.readFileSync(data(name), "utf8"));
const writeAtomic = (name, value) => {
  const target = data(name);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
};
const normalizeCode = (value) => String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);

const input = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const taxonomy = read("sector_taxonomy.json");
const stockMap = read("stock_sector_map.json");
const stockNames = read("stock_name_map.json");
const progress = read("market_research_progress.json");
const stocks = Array.isArray(input.stocks) ? input.stocks : [];
const returnedCodes = [...new Set(stocks.map((stock) => normalizeCode(stock.code)).filter((code) => /^\d{6}$/.test(code)))].sort();
const universeCodes = [...new Set(Object.keys(stockNames.names || {}).map(normalizeCode).filter((code) => /^\d{6}$/.test(code)))];
const expectedCodes = universeCodes.filter((code) => !progress.completed?.[code]).sort().slice(0, 100);
const expectedBatchId = `market-v1:${expectedCodes.join(",")}`;
const validType = input.type === undefined || input.type === "market_stock_research";
if (!validType || returnedCodes.length !== 100 || JSON.stringify(returnedCodes) !== JSON.stringify(expectedCodes) || input.batch_id !== expectedBatchId) {
  throw new Error("文件不是当前待导入的下一批，未写入任何数据");
}

const backupDir = data("backups", `before-market-import-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const name of ["stock_sector_map.json", "market_research_progress.json"]) fs.copyFileSync(data(name), path.join(backupDir, name));

const nextStockMap = structuredClone(stockMap);
for (const item of stocks) {
  const code = normalizeCode(item.code);
  const classifications = Array.isArray(item.classifications) ? item.classifications : [];
  const primary = String(classifications[0]?.primary_sector || "").trim();
  const name = String(item.name || stockNames.names?.[code] || "").trim();
  if (!primary || !name) throw new Error(`股票 ${code} 缺少名称或完整分类`);
  let target = nextStockMap.stocks.find((stock) => stock.code === code);
  if (!target) {
    target = { code, name, primary_sector: primary, classifications: [], product_tags: [], reason: "" };
    nextStockMap.stocks.push(target);
  }
  target.name ||= name;
  target.primary_sector ||= primary;
  target.reason = String(item.reason || "").trim() || target.reason;
  for (const incoming of classifications) {
    const incomingPrimary = String(incoming.primary_sector || target.primary_sector || "").trim();
    const secondary = String(incoming.secondary_sector || "").trim();
    const tertiaries = [...new Set((incoming.tertiary_sectors || []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (!incomingPrimary || !secondary || !tertiaries.length) throw new Error(`股票 ${code} 存在不完整分类`);
    let existing = target.classifications.find((classification) =>
      (classification.primary_sector || target.primary_sector) === incomingPrimary && classification.secondary_sector === secondary,
    );
    if (!existing) {
      existing = { primary_sector: incomingPrimary, secondary_sector: secondary, tertiary_sectors: [] };
      target.classifications.push(existing);
    }
    existing.tertiary_sectors = [...new Set([...(existing.tertiary_sectors || []), ...tertiaries])];
    if (Number.isFinite(Number(incoming.relevance_score))) existing.relevance_score = Math.max(0, Math.min(1, Number(incoming.relevance_score)));
    existing.source_refs = [...new Set([...(existing.source_refs || []), ...(incoming.source_refs || []).map(String).filter(Boolean)])];
  }
}
nextStockMap.stocks.sort((left, right) => left.code.localeCompare(right.code));
const validation = validateSectorData(taxonomy, sanitizeStockMap(nextStockMap));
if (!validation.ok) throw new Error(`分类数据校验失败：${validation.errors.slice(0, 5).join("；")}`);
const completedAt = new Date().toISOString();
for (const code of expectedCodes) progress.completed[code] = { completed_at: completedAt, batch_id: input.batch_id };
writeAtomic("stock_sector_map.json", sanitizeStockMap(nextStockMap));
writeAtomic("market_research_progress.json", progress);
console.log(JSON.stringify({ imported_codes: expectedCodes.length, completed_count: Object.keys(progress.completed).length, backup_dir: backupDir, validation_warnings: validation.warnings.length }, null, 2));
