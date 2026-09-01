import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = (...parts) => path.join(root, "data", ...parts);
const read = (name) => JSON.parse(fs.readFileSync(data(name), "utf8"));
const taxonomy = read("sector_taxonomy.json");
const stockMap = read("stock_sector_map.json");
const before = read("stocks_before.json");
const report = read("transport_migration_report.json");
const candidates = read("transport_candidates.json");
const dailyThemesDir = data("daily_themes");
const dailyThemes = fs.readdirSync(dailyThemesDir)
  .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
  .map((file) => JSON.parse(fs.readFileSync(path.join(dailyThemesDir, file), "utf8")));
const errors = [...validateSectorData(taxonomy, stockMap, dailyThemes).errors];
const transport = taxonomy.sectors.find((sector) => sector.name === "交通运输");
const required = new Map([
  ["公路运输", ["高速公路运营", "道路客货运输"]],
  ["城市交通与出行服务", ["城市交通运营"]],
  ["物流与供应链服务", ["综合物流与供应链管理", "跨境供应链服务", "产业供应链服务"]],
  ["航运与港口物流", ["干散货航运", "集装箱航运", "港口装卸与综合物流"]],
  ["航空运输", ["航空客运", "机场运营"]],
  ["铁路与轨道运输", ["铁路运输", "城市轨道交通运营"]],
]);
if (!transport) errors.push("缺少一级主线：交通运输");
else for (const [secondary, tertiaries] of required) {
  const item = transport.secondary_sectors.find((candidate) => candidate.name === secondary);
  if (!item) errors.push(`交通运输缺少二级：${secondary}`);
  else for (const tertiary of tertiaries) if (!item.tertiary_sectors.includes(tertiary)) errors.push(`交通运输/${secondary} 缺少三级：${tertiary}`);
}
const consumer = taxonomy.sectors.find((sector) => sector.name === "消费");
const movedNames = new Set(["城市交通与出行服务", "物流与供应链服务", "航运与港口物流", "航空运输"]);
for (const name of movedNames) if (consumer?.secondary_sectors.some((item) => item.name === name)) errors.push(`消费下残留已迁移二级：${name}`);
for (const stock of stockMap.stocks) {
  for (const classification of stock.classifications || []) {
    if ((classification.primary_sector || stock.primary_sector) === "消费" && movedNames.has(classification.secondary_sector)) errors.push(`旧路径仍被引用：${stock.code}|${classification.secondary_sector}`);
    if ((classification.primary_sector || stock.primary_sector) === "工业母机" && classification.secondary_sector === "轨道交通装备") continue;
  }
}
for (const daily of dailyThemes) {
  for (const theme of daily.themes || []) {
    if (theme.primary_sector === "消费" && movedNames.has(theme.secondary_sector)) errors.push(`动态题材仍引用旧路径：${daily.date}|${theme.name}`);
  }
}
if (stockMap.stocks.length !== before.stocks.length) errors.push(`股票总数变化：${before.stocks.length} → ${stockMap.stocks.length}`);
const highwayCandidate = candidates.candidates.find((candidate) => candidate.code === "000429");
if (highwayCandidate?.recommended_classification?.primary_sector !== "交通运输" || highwayCandidate?.recommended_classification?.secondary_sector !== "公路运输" || highwayCandidate?.recommended_classification?.tertiary_sectors?.[0] !== "高速公路运营") errors.push("000429 缺少高速公路运营候选路径");
if (report.validation_errors.length) errors.push(...report.validation_errors);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ valid: true, moved_stock_count: report.moved_stock_count, stock_count: stockMap.stocks.length, unresolved_candidates: report.unresolved_candidate_count }, null, 2));
