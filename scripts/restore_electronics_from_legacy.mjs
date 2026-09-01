import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const cwd = process.cwd();
const legacyPath = path.join(cwd, "data", "stock-library.json");
const taxonomyPath = path.join(cwd, "data", "sector_taxonomy.json");
const stockMapPath = path.join(cwd, "data", "stock_sector_map.json");
const reportPath = path.join(cwd, "data", "migration_report_electronics_restore.json");

const ELECTRONICS = "电子元器件";

const standardSecondaries = [
  { name: "被动元件", tertiary_sectors: ["陶瓷电容", "高可靠电容", "功率与储能电容", "电感磁性元件", "石英晶振"] },
  { name: "连接器", tertiary_sectors: ["高速互连", "汽车连接器", "高可靠连接器", "消费电子互连"] },
  { name: "传感器", tertiary_sectors: ["力学传感器", "视觉传感器", "汽车传感器", "工业传感器", "环境传感器"] },
  { name: "光学元件", tertiary_sectors: ["光学镜头与模组", "AR/VR光学", "精密光学元件", "显示光学材料", "机器视觉光学"] },
  { name: "PCB", tertiary_sectors: ["AI服务器PCB", "汽车PCB", "消费电子PCB", "FPC与HDI", "封装基板", "高频高速材料", "通用多层PCB"] },
  { name: "声学器件", tertiary_sectors: ["微型声学器件", "智能声学终端", "专业电声"] },
  { name: "继电器与电接触", tertiary_sectors: ["继电器", "高压直流继电器", "电接触材料"] },
  { name: "电子功能件", tertiary_sectors: ["精密结构件", "散热与电磁屏蔽", "精密功能件", "新型材料结构件"] }
];

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeList(target, values) {
  return unique([...(target || []), ...(values || [])]);
}

function mapLegacyCategory(groupName, categoryName = "") {
  if (groupName === "服务器PCB") return { secondary: "PCB", tertiary: "AI服务器PCB", tags: ["服务器PCB"] };

  if (groupName === "被动元件") {
    if (["MLCC", "陶瓷电容"].includes(categoryName)) return { secondary: groupName, tertiary: "陶瓷电容", tags: categoryName === "MLCC" ? ["MLCC"] : [categoryName] };
    if (categoryName.includes("高可靠")) return { secondary: groupName, tertiary: "高可靠电容", tags: [categoryName] };
    if (["钽电容", "铝电解电容", "薄膜电容", "超级电容"].includes(categoryName)) return { secondary: groupName, tertiary: "功率与储能电容", tags: [categoryName] };
    if (categoryName.includes("电感") || categoryName.includes("磁性")) return { secondary: groupName, tertiary: "电感磁性元件", tags: [categoryName] };
    if (categoryName.includes("晶振")) return { secondary: groupName, tertiary: "石英晶振", tags: [categoryName] };
  }

  if (groupName === "连接器") {
    if (categoryName.includes("高速") || categoryName.includes("通信") || categoryName.includes("射频") || categoryName.includes("线缆") || categoryName.includes("线材")) return { secondary: groupName, tertiary: "高速互连", tags: [categoryName] };
    if (categoryName.includes("汽车")) return { secondary: groupName, tertiary: "汽车连接器", tags: [categoryName] };
    if (categoryName.includes("消费")) return { secondary: groupName, tertiary: "消费电子互连", tags: [categoryName] };
    return { secondary: groupName, tertiary: "高可靠连接器", tags: [categoryName] };
  }

  if (groupName === "传感器") {
    if (categoryName.includes("力学") || categoryName.includes("应变") || categoryName.includes("压力")) return { secondary: groupName, tertiary: "力学传感器", tags: [categoryName] };
    if (categoryName.includes("视觉") || categoryName.includes("红外") || categoryName.includes("3D")) return { secondary: groupName, tertiary: "视觉传感器", tags: [categoryName] };
    if (categoryName.includes("汽车")) return { secondary: groupName, tertiary: "汽车传感器", tags: [categoryName] };
    if (categoryName.includes("流量")) return { secondary: groupName, tertiary: "工业传感器", tags: [categoryName] };
    return { secondary: groupName, tertiary: "环境传感器", tags: [categoryName] };
  }

  if (groupName === "光学元件") {
    if (categoryName.includes("镜头") || categoryName.includes("摄像头") || categoryName.includes("模组")) return { secondary: groupName, tertiary: "光学镜头与模组", tags: [categoryName] };
    if (categoryName.includes("显示") || categoryName.includes("偏光") || categoryName.includes("触控") || categoryName.includes("玻璃")) return { secondary: groupName, tertiary: "显示光学材料", tags: [categoryName] };
    if (categoryName.includes("传感")) return { secondary: groupName, tertiary: "机器视觉光学", tags: [categoryName] };
    return { secondary: groupName, tertiary: "精密光学元件", tags: [categoryName] };
  }

  if (groupName === "PCB") {
    if (categoryName.includes("服务器") || categoryName.includes("通信")) return { secondary: groupName, tertiary: "AI服务器PCB", tags: [categoryName] };
    if (categoryName.includes("汽车")) return { secondary: groupName, tertiary: "汽车PCB", tags: [categoryName] };
    if (categoryName.includes("FPC") || categoryName.includes("HDI") || categoryName.includes("刚柔")) return { secondary: groupName, tertiary: "FPC与HDI", tags: [categoryName] };
    if (categoryName.includes("高频") || categoryName.includes("覆铜")) return { secondary: groupName, tertiary: "高频高速材料", tags: [categoryName] };
    return { secondary: groupName, tertiary: "通用多层PCB", tags: [categoryName] };
  }

  if (groupName === "声学器件") {
    if (categoryName.includes("扬声器") || categoryName.includes("麦克风")) return { secondary: groupName, tertiary: "微型声学器件", tags: [categoryName] };
    if (categoryName.includes("耳机")) return { secondary: groupName, tertiary: "智能声学终端", tags: [categoryName] };
    return { secondary: groupName, tertiary: "专业电声", tags: [categoryName] };
  }

  if (groupName === "继电器与电接触") {
    if (categoryName.includes("接触")) return { secondary: groupName, tertiary: "电接触材料", tags: [categoryName] };
    if (categoryName.includes("高压直流")) return { secondary: groupName, tertiary: "高压直流继电器", tags: [categoryName] };
    return { secondary: groupName, tertiary: "继电器", tags: [categoryName] };
  }

  if (groupName === "电子功能件") {
    if (categoryName.includes("屏蔽") || categoryName.includes("散热")) return { secondary: groupName, tertiary: "散热与电磁屏蔽", tags: [categoryName] };
    if (categoryName.includes("结构件") || categoryName.includes("MIM") || categoryName.includes("手机") || categoryName.includes("笔记本")) return { secondary: groupName, tertiary: "精密结构件", tags: [categoryName] };
    return { secondary: groupName, tertiary: "精密功能件", tags: [categoryName] };
  }

  return null;
}

function ensureElectronicsTaxonomy(taxonomy) {
  let sector = taxonomy.sectors.find((item) => item.name === ELECTRONICS);
  if (!sector) {
    sector = { name: ELECTRONICS, secondary_sectors: [] };
    taxonomy.sectors.push(sector);
  }

  for (const standard of standardSecondaries) {
    let secondary = sector.secondary_sectors.find((item) => item.name === standard.name);
    if (!secondary) {
      secondary = { name: standard.name, tertiary_sectors: [] };
      sector.secondary_sectors.push(secondary);
    }
    secondary.tertiary_sectors = mergeList(secondary.tertiary_sectors, standard.tertiary_sectors);
  }
}

function addClassification(stock, secondary, tertiary) {
  let item = stock.classifications.find((entry) => entry.secondary_sector === secondary);
  if (!item) {
    item = { secondary_sector: secondary, tertiary_sectors: [] };
    stock.classifications.push(item);
  }
  item.tertiary_sectors = mergeList(item.tertiary_sectors, [tertiary]);
}

function electronicsSecondarySet(taxonomy) {
  const sector = taxonomy.sectors.find((item) => item.name === ELECTRONICS);
  return new Set((sector?.secondary_sectors || []).map((item) => item.name));
}

async function main() {
  const [legacy, taxonomy, stockMap] = await Promise.all([
    readFile(legacyPath, "utf8").then(JSON.parse),
    readFile(taxonomyPath, "utf8").then(JSON.parse),
    readFile(stockMapPath, "utf8").then(JSON.parse)
  ]);

  ensureElectronicsTaxonomy(taxonomy);
  const allowedElectronicsSecondaries = electronicsSecondarySet(taxonomy);

  const legacyElectronics = (legacy.sectors || []).find((item) => item.name === ELECTRONICS);
  if (!legacyElectronics) throw new Error("legacy stock-library.json 中找不到电子元器件");

  const stocksByCode = new Map((stockMap.stocks || []).map((stock) => [normalizeCode(stock.code), stock]));
  for (const stock of stocksByCode.values()) {
    if (stock.primary_sector === ELECTRONICS) {
      stock.classifications = (stock.classifications || []).filter((item) => allowedElectronicsSecondaries.has(item.secondary_sector));
    }
  }
  const report = {
    generated_at: new Date().toISOString(),
    restored_from: "data/stock-library.json",
    primary_sector: ELECTRONICS,
    restored_or_merged: 0,
    added_new_stocks: 0,
    existing_stocks_moved_to_electronics: [],
    unmapped: []
  };

  for (const group of legacyElectronics.groups || []) {
    const categoryById = new Map((group.categories || []).map((category) => [category.id, category]));
    for (const legacyStock of group.stocks || []) {
      const code = normalizeCode(legacyStock.code);
      const category = categoryById.get(legacyStock.categoryId);
      const categoryName = category?.name || group.name;
      const mapped = mapLegacyCategory(group.name, categoryName);
      if (!mapped) {
        report.unmapped.push({ code, name: legacyStock.name, group: group.name, category: categoryName });
        continue;
      }

      let stock = stocksByCode.get(code);
      if (!stock) {
        stock = {
          code,
          name: legacyStock.name || "",
          primary_sector: ELECTRONICS,
          classifications: [],
          product_tags: [],
          reason: ""
        };
        stocksByCode.set(code, stock);
        report.added_new_stocks += 1;
      } else if (stock.primary_sector !== ELECTRONICS) {
        report.existing_stocks_moved_to_electronics.push({
          code,
          name: stock.name || legacyStock.name,
          from: stock.primary_sector,
          to: ELECTRONICS
        });
        stock.primary_sector = ELECTRONICS;
        stock.classifications = [];
      }

      stock.name = stock.name || legacyStock.name || "";
      stock.reason = stock.reason || legacyStock.note || "";
      stock.product_tags = mergeList(stock.product_tags, mapped.tags);
      addClassification(stock, mapped.secondary, mapped.tertiary);
      report.restored_or_merged += 1;
    }
  }

  stockMap.stocks = Array.from(stocksByCode.values()).sort((a, b) => a.code.localeCompare(b.code));

  await mkdir(path.dirname(reportPath), { recursive: true });
  await Promise.all([
    writeFile(taxonomyPath, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8"),
    writeFile(stockMapPath, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8"),
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  ]);

  const electronicCount = stockMap.stocks.filter((stock) => stock.primary_sector === ELECTRONICS).length;
  console.log(`electronics stocks: ${electronicCount}`);
  console.log(`added new stocks: ${report.added_new_stocks}`);
  console.log(`moved existing stocks: ${report.existing_stocks_moved_to_electronics.length}`);
  console.log(`report: ${path.relative(cwd, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
