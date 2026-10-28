import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const readJson = async (name) => JSON.parse(await readFile(path.join(DATA, name), "utf8"));
const writeJson = async (name, value) => writeFile(path.join(DATA, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const PATH = (primary_sector, secondary_sector, tertiary_sector) => ({ primary_sector, secondary_sector, tertiary_sectors: [tertiary_sector] });
const software = "计算机软件";

// This is a reviewed migration register, not a runtime classification rule.
// Each decision is traceable to the stock's existing business note/product tags.
const DECISIONS = new Map([
  ["601698", { action: "move", remove: ["军工装备|航天装备|卫星通信导航与遥感"], add: [PATH("商业航天", "空天应用", "商业卫星运营")], primary: "商业航天", reason: "主营卫星通信运营、地面站和卫星互联网，属于持续商业卫星运营，而非军用航天系统。" }],
  ["688435", { action: "move", remove: ["AIDC基础设施|数据基础软件|数据复制与灾备软件"], add: [PATH(software, "基础软件", "数据复制与灾备")], primary: software, reason: "主营数据复制、容灾、备份和迁移软件；其服务数据中心不改变软件产业属性。" }],
  ["000409", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "行业管理软件")], primary: software, reason: "主营矿山与能源行业工业互联网、生产安全和经营管理软件，AI是功能能力而非核心产品定义。" }],
  ["000555", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "行业管理软件"), PATH(software, "基础软件", "数据库")], primary: software, reason: "主营银行核心系统、金融云、数据治理和分布式数据库；属于金融IT软件，AI不构成其唯一产品核心。" }],
  ["000948", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "行业管理软件")], primary: software, reason: "主营银行IT、金融软件及数字化解决方案；保留数据中心集成分类，不以AI标签替代长期软件主业。" }],
  ["688229", { action: "move", remove: ["AI应用|数据与知识服务|数据分析与决策智能", "AI应用|行业AI应用|AI工业与制造", "AIDC基础设施|IDC运营与算力服务|数据中心运维服务"], add: [PATH(software, "云与数据软件", "数据管理")], primary: software, reason: "主营APM、可观测性和智能运维软件；不是IDC运营商或算力基础设施企业。" }],
  ["688232", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "行业管理软件")], primary: software, reason: "主营智慧政务、公共资源交易和数字建筑业务软件；AI和数据治理是产品能力。" }],
  ["688369", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "办公软件"), PATH(software, "企业软件", "ERP与企业管理软件")], primary: software, reason: "主营协同运营和企业管理平台；AI智能体为嵌入式能力，长期主业为企业软件。" }],
  ["688479", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "行业管理软件")], primary: software, reason: "主营汽车和工程机械行业的营销、经销商管理、售后及云平台软件。" }],
  ["688588", { action: "move", removePrimary: "AI应用", add: [PATH(software, "企业软件", "办公软件")], primary: software, reason: "主营企业软件开发和数字化办公服务；AI应用开发并不改变其软件服务主业。" }],
  ["688561", { action: "move", removePrimary: "AI应用", add: [PATH(software, "网络安全", "网络安全软件"), PATH(software, "网络安全", "数据安全")], primary: software, reason: "主营网络安全产品与服务，大模型安全是网络安全产品线延伸。" }],
  ["688651", { action: "move", removePrimary: "AI应用", add: [PATH(software, "网络安全", "网络安全软件"), PATH(software, "网络安全", "数据安全")], primary: software, reason: "主营网络空间测绘、应用安全和数据安全产品；卫星互联网、低空通信仅为应用场景。" }],
  ["000503", { action: "add", add: [PATH(software, "企业软件", "行业管理软件")], reason: "医保基金管理、医疗数据服务和审核平台为持续行业软件业务；保留AI医疗分类。" }],
  ["688246", { action: "add", add: [PATH(software, "企业软件", "行业管理软件")], reason: "电子病历与医疗数据平台属于医疗行业管理软件；保留AI医疗分类。" }],
  ["688258", { action: "add", add: [PATH(software, "基础软件", "操作系统")], reason: "主营云计算基础软件和软件开发平台；AI开发工具为产品关联，基础软件分类可并存。" }],
  ["688292", { action: "add", add: [PATH(software, "网络安全", "网络安全软件"), PATH(software, "云与数据软件", "数据管理")], reason: "主营网络流量采集、深度报文检测、网络可视化和安全管理平台。" }],
  ["688318", { action: "add", add: [PATH(software, "企业软件", "行业管理软件")], reason: "金融信息服务、投研和量化工具是面向金融行业的软件产品；保留AI金融数据分析分类。" }],
  ["688365", { action: "add", add: [PATH(software, "企业软件", "ERP与企业管理软件")], reason: "电商客服、CRM、订单管理和营销运营SaaS是长期企业软件主业；AI客服作为重要产品线保留。" }],
  ["688777", { action: "add", add: [PATH(software, "工业软件", "MES"), PATH(software, "工业软件", "工业仿真软件")], reason: "流程工业自动化、智能制造和工业软件平台构成持续业务；保留AI工业分类。" }],
]);

const NEW_SECTORS = [
  { name: "商业航天", secondary_sectors: [
    { name: "运载火箭", tertiary_sectors: ["商业火箭整机", "火箭发动机", "火箭结构件", "发射与地面保障"], tertiary_descriptions: {} },
    { name: "卫星制造", tertiary_sectors: ["卫星平台", "卫星载荷", "卫星结构件", "卫星电源与太阳翼"], tertiary_descriptions: {} },
    { name: "卫星互联网", tertiary_sectors: ["低轨卫星通信", "星间通信", "卫星通信终端", "地面站与测运控"], tertiary_descriptions: {} },
    { name: "空天应用", tertiary_sectors: ["卫星遥感", "卫星导航", "太空计算", "商业卫星运营"], tertiary_descriptions: {} },
  ] },
  { name: "低空经济", secondary_sectors: [
    { name: "低空飞行器", tertiary_sectors: ["eVTOL", "民用无人机", "通用航空器", "低空特种飞行器"], tertiary_descriptions: {} },
    { name: "飞行器核心部件", tertiary_sectors: ["航空电机与电驱", "航电与飞控", "航空电池", "航空结构件"], tertiary_descriptions: {} },
    { name: "低空基础设施", tertiary_sectors: ["起降设施", "低空通信", "低空导航", "低空监视"], tertiary_descriptions: {} },
    { name: "低空运营", tertiary_sectors: ["低空交通运营", "无人机运营服务", "低空物流", "空域管理"], tertiary_descriptions: {} },
  ] },
  { name: software, secondary_sectors: [
    { name: "基础软件", tertiary_sectors: ["操作系统", "数据库", "中间件", "数据复制与灾备"], tertiary_descriptions: {} },
    { name: "企业软件", tertiary_sectors: ["ERP与企业管理软件", "财税软件", "办公软件", "行业管理软件"], tertiary_descriptions: {} },
    { name: "工业软件", tertiary_sectors: ["CAD/CAE/CAM", "MES", "PLM", "工业仿真软件"], tertiary_descriptions: {} },
    { name: "网络安全", tertiary_sectors: ["网络安全软件", "数据安全", "身份认证", "密码安全"], tertiary_descriptions: {} },
    { name: "云与数据软件", tertiary_sectors: ["云计算软件", "大数据平台", "数据管理", "数据治理"], tertiary_descriptions: {} },
  ] },
];

const pathKey = (item) => `${item.primary_sector}|${item.secondary_sector}|${item.tertiary_sectors.join("|")}`;
const matches = (item, key) => key === `${item.primary_sector}|${item.secondary_sector}|${item.tertiary_sectors.join("|")}`;
const clone = (value) => structuredClone(value);

function isCandidate(stock) {
  const all = stock.classifications || [];
  const text = `${stock.reason || ""} ${(stock.product_tags || []).join(" ")}`.toLowerCase();
  return all.some((c) => (
    (c.primary_sector === "军工装备" && c.secondary_sector === "航天装备") ||
    (c.primary_sector === "通信设备" && c.secondary_sector === "卫星通信") ||
    c.primary_sector === "AI应用" ||
    c.primary_sector === "AIDC基础设施" ||
    (c.primary_sector === "大金融" && /软件|it|信息系统|数字化|数据|安全/.test(text)) ||
    (c.primary_sector === "电力" && c.secondary_sector === "智能电网" && c.tertiary_sectors.includes("电力信息化")) ||
    (c.primary_sector === "机器人" && /无人机|飞行器|低空|evtol/.test(text)) ||
    /无人机|飞行器|低空|evtol/.test(text)
  ));
}

function defaultReason(stock) {
  const primary = [...new Set(stock.classifications.map((c) => c.primary_sector))].join("、");
  return `已检查 ${primary} 相关分类；现有主营说明和产品标签未达到新增主线所要求的主营收入、已交付业务或持续经营证据，因此保持长期分类不变。`;
}

function applyDecision(stock, decision) {
  const next = clone(stock);
  const before = JSON.stringify(next.classifications);
  next.classifications = next.classifications.filter((item) =>
    !(decision.removePrimary && item.primary_sector === decision.removePrimary) &&
    !decision.remove?.some((key) => matches(item, key))
  );
  for (const addition of decision.add || []) {
    if (!next.classifications.some((item) => pathKey(item) === pathKey(addition))) {
      next.classifications.push({ ...addition, relevance_score: 0.9, source_refs: ["目录升级定向迁移"], verification_note: decision.reason });
    }
  }
  if (decision.primary) next.primary_sector = decision.primary;
  if (JSON.stringify(next.classifications) === before) throw new Error(`${stock.code} 迁移没有产生分类变化`);
  return next;
}

function paths(stock) {
  return stock.classifications.flatMap((item) => item.tertiary_sectors.map((tertiary) => PATH(item.primary_sector, item.secondary_sector, tertiary)));
}

function upgradeTaxonomy(taxonomy) {
  const after = clone(taxonomy);
  for (const sector of NEW_SECTORS) {
    if (after.sectors.some((item) => item.name === sector.name)) throw new Error(`目录已存在一级主线：${sector.name}`);
    after.sectors.push(sector);
  }
  after.version = `${taxonomy.version || "1.0"}-20260813-taxonomy-upgrade`;
  return after;
}

function removeEmptyMigratedCategories(taxonomy, stockMap) {
  const target = { primary: "AIDC基础设施", secondary: "数据基础软件" };
  const stillUsed = stockMap.stocks.some((stock) => stock.classifications.some((item) =>
    item.primary_sector === target.primary && item.secondary_sector === target.secondary
  ));
  if (stillUsed) return [];
  const primary = taxonomy.sectors.find((item) => item.name === target.primary);
  if (!primary) throw new Error(`缺少待清理一级目录：${target.primary}`);
  const before = primary.secondary_sectors.length;
  primary.secondary_sectors = primary.secondary_sectors.filter((item) => item.name !== target.secondary);
  if (before === primary.secondary_sectors.length) throw new Error(`缺少待清理二级目录：${target.primary} → ${target.secondary}`);
  return [`${target.primary} → ${target.secondary}`];
}

async function main() {
  const [taxonomy, stockMap] = await Promise.all([readJson("sector_taxonomy.json"), readJson("stock_sector_map.json")]);
  const taxonomyAfter = upgradeTaxonomy(taxonomy);
  const stocksAfter = clone(stockMap);
  const candidates = [];
  const changes = [];
  let addedClassificationCount = 0;

  for (let index = 0; index < stockMap.stocks.length; index += 1) {
    const stock = stockMap.stocks[index];
    if (!isCandidate(stock)) continue;
    const decision = DECISIONS.get(stock.code);
    const after = decision ? applyDecision(stock, decision) : clone(stock);
    if (decision) {
      stocksAfter.stocks[index] = after;
      const oldPaths = paths(stock).map(pathKey);
      const newPaths = paths(after).map(pathKey);
      addedClassificationCount += newPaths.filter((key) => !oldPaths.includes(key)).length;
      changes.push({ code: stock.code, name: stock.name, action: decision.action, old_classifications: paths(stock), new_classifications: paths(after), reason: decision.reason });
    }
    candidates.push({ code: stock.code, name: stock.name, old_classifications: paths(stock), suggested_classifications: paths(after), action: decision?.action || "keep", reason: decision?.reason || defaultReason(stock) });
  }

  const deletedEmptyCategories = removeEmptyMigratedCategories(taxonomyAfter, stocksAfter);

  const validation = validateSectorData(taxonomyAfter, stocksAfter, []);
  const unchanged = stockMap.stocks.filter((stock, index) => !DECISIONS.has(stock.code) && JSON.stringify(stock) !== JSON.stringify(stocksAfter.stocks[index]));
  if (unchanged.length) validation.errors.push(`非定向迁移股票发生变化：${unchanged.map((stock) => stock.code).join(",")}`);
  if (stockMap.stocks.length !== stocksAfter.stocks.length) validation.errors.push("迁移前后股票数量不一致");
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));

  const report = {
    new_primary_sectors: NEW_SECTORS.map((sector) => sector.name),
    moved_stock_count: changes.filter((item) => item.action === "move").length,
    added_classification_count: addedClassificationCount,
    kept_stock_count: candidates.filter((item) => item.action === "keep").length,
    deleted_empty_categories: deletedEmptyCategories,
    new_secondary_sectors: NEW_SECTORS.flatMap((sector) => sector.secondary_sectors.map((item) => `${sector.name} → ${item.name}`)),
    new_tertiary_sectors: NEW_SECTORS.flatMap((sector) => sector.secondary_sectors.flatMap((second) => second.tertiary_sectors.map((third) => `${sector.name} → ${second.name} → ${third}`))),
    validation_errors: [],
    candidate_stock_count: candidates.length,
    changes,
  };
  await Promise.all([
    writeJson("taxonomy_after.json", taxonomyAfter),
    writeJson("migration_candidates.json", candidates),
    writeJson("stocks_after.json", stocksAfter),
    writeJson("migration_report.json", report),
  ]);
  console.log(`升级完成：${candidates.length} 个候选，${report.moved_stock_count} 个 move，新增 ${addedClassificationCount} 条分类。`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
