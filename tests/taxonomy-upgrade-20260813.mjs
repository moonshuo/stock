import { readFile } from "fs/promises";
import path from "path";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const root = process.cwd();
const read = (name) => readFile(path.join(root, "data", name), "utf8").then(JSON.parse);
const [before, taxonomy, after, candidates, report] = await Promise.all([
  read("stock_sector_map.json"), read("taxonomy_after.json"), read("stocks_after.json"), read("migration_candidates.json"), read("migration_report.json"),
]);
const validation = validateSectorData(taxonomy, after, []);
if (!validation.ok) throw new Error(validation.errors.join("\n"));
if (before.stocks.length !== after.stocks.length) throw new Error("股票数量发生变化");
for (const name of ["商业航天", "低空经济", "计算机软件"]) if (!taxonomy.sectors.some((item) => item.name === name)) throw new Error(`缺少一级主线：${name}`);
const byCode = new Map(after.stocks.map((stock) => [stock.code, stock]));
const yingfang = byCode.get("688435");
if (!yingfang.classifications.some((item) => item.primary_sector === "计算机软件" && item.secondary_sector === "基础软件" && item.tertiary_sectors.includes("数据复制与灾备"))) throw new Error("英方软件未迁移到基础软件/数据复制与灾备");
if (yingfang.classifications.some((item) => item.primary_sector === "AIDC基础设施" && item.secondary_sector === "数据基础软件")) throw new Error("英方软件仍保留错误的 AIDC 软件分类");
if (taxonomy.sectors.find((item) => item.name === "AIDC基础设施").secondary_sectors.some((item) => item.name === "数据基础软件")) throw new Error("空的 AIDC 数据基础软件目录未删除");
const satcom = byCode.get("601698");
if (satcom.primary_sector !== "商业航天" || !satcom.classifications.some((item) => item.secondary_sector === "空天应用" && item.tertiary_sectors.includes("商业卫星运营"))) throw new Error("中国卫通未迁移至商业卫星运营");
if (!candidates.length || !report.changes.length || report.validation_errors.length) throw new Error("迁移审查产物不完整");
for (let index = 0; index < before.stocks.length; index += 1) {
  const oldStock = before.stocks[index], newStock = after.stocks[index];
  if (oldStock.code !== newStock.code || oldStock.name !== newStock.name || JSON.stringify(oldStock.product_tags) !== JSON.stringify(newStock.product_tags) || oldStock.reason !== newStock.reason) throw new Error(`非分类字段被修改：${oldStock.code}`);
}
console.log(`taxonomy upgrade test passed: ${after.stocks.length} stocks, ${candidates.length} candidates, ${report.changes.length} changes`);
