import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const cwd = process.cwd();
const legacyPath = path.join(cwd, "data", "stock-library.json");
const taxonomyPath = path.join(cwd, "data", "sector_taxonomy.json");
const stockMapPath = path.join(cwd, "data", "stock_sector_map.json");
const reportPath = path.join(cwd, "data", "migration_report.json");

const categoryRules = new Map([
  ["MLCC", { tertiary: "陶瓷电容", tags: ["MLCC"] }],
  ["普通陶瓷电容", { tertiary: "陶瓷电容", tags: ["普通陶瓷电容"] }],
  ["陶瓷电容", { tertiary: "陶瓷电容", tags: [] }],
  ["高可靠陶瓷电容", { tertiary: "高可靠电容", tags: ["高可靠陶瓷电容"] }],
  ["高可靠电容", { tertiary: "高可靠电容", tags: [] }],
  ["薄膜电容", { tertiary: "功率与储能电容", tags: ["薄膜电容"] }],
  ["铝电解电容", { tertiary: "功率与储能电容", tags: ["铝电解电容"] }],
  ["超级电容", { tertiary: "功率与储能电容", tags: ["超级电容"] }],
  ["钽电容", { tertiary: "功率与储能电容", tags: ["钽电容"] }],
  ["片式电感", { tertiary: "电感磁性元件", tags: ["片式电感"] }],
  ["磁性元件", { tertiary: "电感磁性元件", tags: ["磁性元件"] }],
  ["电感", { tertiary: "电感磁性元件", tags: ["电感"] }],
  ["石英晶振", { tertiary: "石英晶振", tags: [] }],
  ["高速连接器", { tertiary: "高速互连", tags: ["高速连接器"] }],
  ["高速铜缆", { tertiary: "高速互连", tags: ["高速铜缆"] }],
  ["高速数据线", { tertiary: "高速互连", tags: ["高速数据线"] }],
  ["通信连接器", { tertiary: "高速互连", tags: ["通信连接器"] }],
  ["线缆组件", { tertiary: "高速互连", tags: ["线缆组件"] }],
  ["精细电子线材", { tertiary: "高速互连", tags: ["精细电子线材"] }],
  ["汽车连接器", { tertiary: "汽车连接器", tags: [] }],
  ["高可靠连接器", { tertiary: "高可靠连接器", tags: [] }],
  ["航空航天连接器", { tertiary: "高可靠连接器", tags: ["航空航天连接器"] }],
  ["工业连接器", { tertiary: "高可靠连接器", tags: ["工业连接器"] }],
  ["轨道交通连接器", { tertiary: "高可靠连接器", tags: ["轨道交通连接器"] }],
  ["消费电子互连", { tertiary: "消费电子互连", tags: [] }],
  ["消费电子连接器", { tertiary: "消费电子互连", tags: ["消费电子连接器"] }],
  ["射频连接器", { tertiary: "消费电子互连", tags: ["射频连接器"] }],
  ["力学传感器", { tertiary: "力学传感器", tags: [] }],
  ["应变式传感器", { tertiary: "力学传感器", tags: ["应变式传感器"] }],
  ["力学测试传感器", { tertiary: "力学传感器", tags: ["力学测试传感器"] }],
  ["视觉传感器", { tertiary: "视觉传感器", tags: [] }],
  ["3D视觉传感器", { tertiary: "视觉传感器", tags: ["3D视觉传感器"] }],
  ["红外传感器", { tertiary: "视觉传感器", tags: ["红外传感器"] }],
  ["汽车传感器", { tertiary: "汽车传感器", tags: [] }],
  ["工业传感器", { tertiary: "工业传感器", tags: [] }],
  ["流量传感器", { tertiary: "工业传感器", tags: ["流量传感器"] }],
  ["气体传感器", { tertiary: "环境传感器", tags: ["气体传感器"] }],
  ["光学镜头", { tertiary: "光学镜头与模组", tags: ["光学镜头"] }],
  ["摄像头模组", { tertiary: "光学镜头与模组", tags: ["摄像头模组"] }],
  ["安防镜头", { tertiary: "光学镜头与模组", tags: ["安防镜头"] }],
  ["高清光学镜头", { tertiary: "光学镜头与模组", tags: ["高清光学镜头"] }],
  ["显微光学", { tertiary: "精密光学元件", tags: ["显微光学"] }],
  ["精密光学", { tertiary: "精密光学元件", tags: ["精密光学"] }],
  ["光学滤光片", { tertiary: "精密光学元件", tags: ["光学滤光片"] }],
  ["精密光学元件", { tertiary: "精密光学元件", tags: [] }],
  ["玻璃非球面透镜", { tertiary: "精密光学元件", tags: ["玻璃非球面透镜"] }],
  ["光学传感组件", { tertiary: "机器视觉光学", tags: ["光学传感组件"] }],
  ["偏光片", { tertiary: "显示光学材料", tags: ["偏光片"] }],
  ["触控显示", { tertiary: "显示光学材料", tags: ["触控显示"] }],
  ["电子玻璃", { tertiary: "显示光学材料", tags: ["电子玻璃"] }],
  ["光电玻璃", { tertiary: "显示光学材料", tags: ["光电玻璃"] }],
  ["精密玻璃", { tertiary: "显示光学材料", tags: ["精密玻璃"] }],
  ["服务器PCB", { tertiary: "AI服务器PCB", tags: ["服务器PCB"] }],
  ["通信PCB", { tertiary: "AI服务器PCB", tags: ["通信PCB"] }],
  ["高多层PCB", { tertiary: "通用多层PCB", tags: ["高多层PCB"] }],
  ["多层PCB", { tertiary: "通用多层PCB", tags: ["多层PCB"] }],
  ["PCB样板", { tertiary: "通用多层PCB", tags: ["PCB样板"] }],
  ["小批量PCB", { tertiary: "通用多层PCB", tags: ["小批量PCB"] }],
  ["高精密PCB", { tertiary: "通用多层PCB", tags: ["高精密PCB"] }],
  ["高密度PCB", { tertiary: "通用多层PCB", tags: ["高密度PCB"] }],
  ["工业控制PCB", { tertiary: "通用多层PCB", tags: ["工业控制PCB"] }],
  ["FPC", { tertiary: "FPC与HDI", tags: ["FPC"] }],
  ["HDI", { tertiary: "FPC与HDI", tags: ["HDI"] }],
  ["刚柔结合板", { tertiary: "FPC与HDI", tags: ["刚柔结合板"] }],
  ["汽车PCB", { tertiary: "汽车PCB", tags: [] }],
  ["高频高速PCB", { tertiary: "高频高速材料", tags: ["高频高速PCB"] }],
  ["覆铜板", { tertiary: "高频高速材料", tags: ["覆铜板"] }],
  ["高频高速覆铜板", { tertiary: "高频高速材料", tags: ["高频高速覆铜板"] }],
  ["微型扬声器", { tertiary: "微型声学器件", tags: ["微型扬声器"] }],
  ["扬声器", { tertiary: "微型声学器件", tags: ["扬声器"] }],
  ["MEMS麦克风", { tertiary: "微型声学器件", tags: ["MEMS麦克风"] }],
  ["耳机ODM", { tertiary: "智能声学终端", tags: ["耳机ODM"] }],
  ["专业音响", { tertiary: "专业电声", tags: ["专业音响"] }],
  ["电磁继电器", { tertiary: "继电器", tags: ["电磁继电器"] }],
  ["高可靠继电器", { tertiary: "继电器", tags: ["高可靠继电器"] }],
  ["继电器", { tertiary: "继电器", tags: [] }],
  ["高压直流继电器", { tertiary: "高压直流继电器", tags: [] }],
  ["电接触材料", { tertiary: "电接触材料", tags: [] }],
  ["电磁屏蔽", { tertiary: "散热与电磁屏蔽", tags: ["电磁屏蔽"] }],
  ["功能性器件", { tertiary: "精密功能件", tags: ["功能性器件"] }],
  ["精密功能性器件", { tertiary: "精密功能件", tags: ["精密功能性器件"] }],
  ["精密功能件", { tertiary: "精密功能件", tags: [] }],
  ["手机结构件", { tertiary: "精密结构件", tags: ["手机结构件"] }],
  ["笔记本结构件", { tertiary: "精密结构件", tags: ["笔记本结构件"] }],
  ["MIM结构件", { tertiary: "精密结构件", tags: ["MIM结构件"] }],
  ["六维力传感器", { tertiary: "力学传感器", tags: ["六维力传感器"] }]
]);

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function taxonomyLookup(taxonomy) {
  const lookup = new Map();
  for (const primary of taxonomy.sectors || []) {
    for (const secondary of primary.secondary_sectors || []) {
      for (const tertiary of secondary.tertiary_sectors || []) {
        lookup.set(`${primary.name}|${secondary.name}|${tertiary}`, true);
      }
    }
  }
  return lookup;
}

function normalizeSecondaryName(name) {
  if (name === "服务器PCB") return "PCB";
  return name;
}

function inferRule(categoryName) {
  if (!categoryName) return null;
  if (categoryRules.has(categoryName)) return categoryRules.get(categoryName);
  if (/MLCC|陶瓷电容/.test(categoryName)) return { tertiary: "陶瓷电容", tags: [categoryName] };
  if (/薄膜|铝电解|超级|钽/.test(categoryName)) return { tertiary: "功率与储能电容", tags: [categoryName] };
  if (/电感|磁性/.test(categoryName)) return { tertiary: "电感磁性元件", tags: [categoryName] };
  if (/晶振|石英/.test(categoryName)) return { tertiary: "石英晶振", tags: [categoryName] };
  if (/六维力|力传感|压力|称重|惯性/.test(categoryName)) return { tertiary: "力学传感器", tags: [categoryName] };
  if (/高速连接|高速铜缆|高速数据/.test(categoryName)) return { tertiary: "高速互连", tags: [categoryName] };
  if (/结构件|MIM|手机|笔记本/.test(categoryName)) return { tertiary: "精密结构件", tags: [categoryName] };
  if (/服务器PCB/.test(categoryName)) return { tertiary: "AI服务器PCB", tags: [categoryName] };
  return null;
}

function extractProductTags(categoryName, note) {
  const tags = [];
  const text = `${categoryName || ""} ${note || ""}`;
  const candidates = [
    "MLCC", "陶瓷电容", "高可靠陶瓷电容", "薄膜电容", "铝电解电容", "超级电容", "钽电容",
    "片式电感", "磁性元件", "石英晶振", "高速连接器", "高速铜缆", "高速数据线",
    "六维力传感器", "手机结构件", "笔记本结构件", "MIM结构件"
  ];
  for (const item of candidates) {
    if (text.includes(item)) tags.push(item);
  }
  return unique(tags);
}

async function main() {
  const [legacy, taxonomy] = await Promise.all([
    readFile(legacyPath, "utf8").then(JSON.parse),
    readFile(taxonomyPath, "utf8").then(JSON.parse)
  ]);
  const allowed = taxonomyLookup(taxonomy);
  const stocksByCode = new Map();
  const report = {
    generated_at: new Date().toISOString(),
    unmapped_legacy_categories: [],
    duplicate_stocks: [],
    invalid_stock_codes: [],
    invalid_tertiary_sectors: [],
    name_code_conflicts: []
  };

  for (const sector of legacy.sectors || []) {
    const primary = sector.name;
    for (const group of sector.groups || []) {
      const secondary = normalizeSecondaryName(group.name);
      const categoryById = new Map((group.categories || []).map((item) => [item.id, item]));

      for (const stock of group.stocks || []) {
        const code = normalizeCode(stock.code);
        if (!/^\d{6}$/.test(code)) {
          report.invalid_stock_codes.push({ code: stock.code, name: stock.name, primary, secondary });
          continue;
        }

        const category = categoryById.get(stock.categoryId);
        const categoryName = category?.name || "";
        const rule = inferRule(categoryName) || (group.name === "服务器PCB" ? { tertiary: "AI服务器PCB", tags: ["服务器PCB"] } : null);
        if (!rule) {
          report.unmapped_legacy_categories.push({ primary, secondary, category: categoryName || "待细分", code, name: stock.name });
          continue;
        }

        const tertiary = rule.tertiary;
        if (!allowed.has(`${primary}|${secondary}|${tertiary}`)) {
          report.invalid_tertiary_sectors.push({ primary, secondary, tertiary, source_category: categoryName, code, name: stock.name });
          continue;
        }

        if (!stocksByCode.has(code)) {
          stocksByCode.set(code, {
            code,
            name: stock.name || "",
            primary_sector: primary,
            classifications: [],
            product_tags: [],
            reason: stock.note || ""
          });
        }

        const target = stocksByCode.get(code);
        if (target.name && stock.name && target.name !== stock.name) {
          report.name_code_conflicts.push({ code, names: unique([target.name, stock.name]) });
        }
        if (target.primary_sector !== primary) {
          report.duplicate_stocks.push({ code, name: stock.name, primary_sectors: unique([target.primary_sector, primary]) });
        }

        if (!target.name || target.name === secondary || target.name === primary || target.name === categoryName) {
          target.name = stock.name || target.name || "";
        }
        target.reason = target.reason || stock.note || "";
        target.product_tags = unique([
          ...target.product_tags,
          ...rule.tags,
          ...extractProductTags(categoryName, stock.note)
        ]);

        let classification = target.classifications.find((item) => item.secondary_sector === secondary);
        if (!classification) {
          classification = { secondary_sector: secondary, tertiary_sectors: [] };
          target.classifications.push(classification);
        }
        if (classification.tertiary_sectors.includes(tertiary)) {
          report.duplicate_stocks.push({ code, name: stock.name, duplicate_classification: `${secondary}/${tertiary}` });
        }
        classification.tertiary_sectors = unique([...classification.tertiary_sectors, tertiary]);
      }
    }
  }

  const stockMap = {
    version: "1.0",
    stocks: Array.from(stocksByCode.values()).sort((a, b) => a.code.localeCompare(b.code))
  };

  report.unmapped_legacy_categories = unique(report.unmapped_legacy_categories.map(JSON.stringify)).map(JSON.parse);
  report.duplicate_stocks = unique(report.duplicate_stocks.map(JSON.stringify)).map(JSON.parse);
  report.invalid_stock_codes = unique(report.invalid_stock_codes.map(JSON.stringify)).map(JSON.parse);
  report.invalid_tertiary_sectors = unique(report.invalid_tertiary_sectors.map(JSON.stringify)).map(JSON.parse);
  report.name_code_conflicts = unique(report.name_code_conflicts.map(JSON.stringify)).map(JSON.parse);

  await mkdir(path.dirname(stockMapPath), { recursive: true });
  await writeFile(stockMapPath, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`converted ${stockMap.stocks.length} stocks`);
  console.log(`report ${path.relative(cwd, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
