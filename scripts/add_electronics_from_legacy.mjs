import { readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const taxonomyFile = path.join(root, "data", "sector_taxonomy.json");
const stockFile = path.join(root, "data", "stock_sector_map.json");
const legacyFile = path.join(root, "data", "stock-library.json");
const P = "电子元器件";
const normalize = (value) => String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
const unique = (items) => [...new Set(items.filter(Boolean))];

const secondary = [
  { name: "被动元件", tertiary_sectors: ["陶瓷电容", "高可靠电容", "功率与储能电容", "电感磁性元件", "石英晶振"], tertiary_descriptions: { "陶瓷电容": "覆盖MLCC、陶瓷电容及相关材料。", "高可靠电容": "覆盖军工、航空航天等高可靠电容。", "功率与储能电容": "覆盖钽电容、铝电解、薄膜等电容。", "电感磁性元件": "覆盖片式电感、功率电感、变压器及磁性元件。", "石英晶振": "覆盖石英晶体谐振器、振荡器等频率器件。" } },
  { name: "连接器", tertiary_sectors: ["高速互连", "汽车连接器", "高可靠连接器", "消费电子互连"], tertiary_descriptions: { "高速互连": "覆盖通信、数据中心高速连接器及线缆。", "汽车连接器": "覆盖新能源汽车和智能汽车连接器。", "高可靠连接器": "覆盖航空航天、军工、工业高可靠连接器。", "消费电子互连": "覆盖消费电子精密连接器与组件。" } },
  { name: "传感器", tertiary_sectors: ["力学传感器", "视觉传感器", "汽车传感器", "工业传感器", "环境传感器"], tertiary_descriptions: { "力学传感器": "覆盖压力、力、称重、应变等传感器。", "视觉传感器": "覆盖图像、红外、3D等视觉感知器件。", "汽车传感器": "覆盖汽车电子和智能驾驶传感器。", "工业传感器": "覆盖工业控制用位移、流量等传感器。", "环境传感器": "覆盖气体、温湿度等环境感知器件。" } },
  { name: "光学元件", tertiary_sectors: ["光学镜头与模组", "AR/VR光学", "精密光学元件", "显示光学材料", "机器视觉光学"], tertiary_descriptions: { "光学镜头与模组": "覆盖摄像头镜头、模组及相关光学组件。", "AR/VR光学": "覆盖AR/VR光波导、透镜和模组。", "精密光学元件": "覆盖晶体、滤光片、棱镜及精密光学组件。", "显示光学材料": "覆盖偏光片、触控、显示玻璃等材料。", "机器视觉光学": "覆盖工业镜头、光源和视觉光学组件。" } },
  { name: "PCB", tertiary_sectors: ["AI服务器PCB", "汽车PCB", "消费电子PCB", "FPC与HDI", "封装基板", "高频高速材料", "通用多层PCB"], tertiary_descriptions: { "AI服务器PCB": "覆盖AI服务器、交换机等高多层高速PCB。", "汽车PCB": "覆盖汽车电子和新能源车PCB。", "消费电子PCB": "覆盖手机、PC、可穿戴等消费电子PCB。", "FPC与HDI": "覆盖柔性板、HDI及刚挠结合板。", "封装基板": "覆盖IC载板和先进封装基板。", "高频高速材料": "覆盖覆铜板、高频高速基材等PCB材料。", "通用多层PCB": "覆盖通用刚性多层印制电路板。" } },
  { name: "声学器件", tertiary_sectors: ["微型声学器件", "智能声学终端", "专业电声"], tertiary_descriptions: { "微型声学器件": "覆盖扬声器、麦克风、受话器等微型器件。", "智能声学终端": "覆盖TWS耳机、智能音箱等终端。", "专业电声": "覆盖专业音响、汽车音响等产品。" } },
  { name: "继电器与电接触", tertiary_sectors: ["继电器", "高压直流继电器", "电接触材料"], tertiary_descriptions: { "继电器": "覆盖通用信号、功率继电器。", "高压直流继电器": "覆盖新能源汽车和储能高压直流继电器。", "电接触材料": "覆盖继电器、电气开关用触点及材料。" } },
  { name: "电子功能件", tertiary_sectors: ["精密结构件", "散热与电磁屏蔽", "精密功能件", "新型材料结构件"], tertiary_descriptions: { "精密结构件": "覆盖消费电子及汽车精密结构件。", "散热与电磁屏蔽": "覆盖导热、散热、电磁屏蔽组件。", "精密功能件": "覆盖模切、胶粘、功能性器件。", "新型材料结构件": "覆盖新型复合材料及功能结构件。" } }
];

function map(group, category = "") {
  if (group === "服务器PCB") return ["PCB", "AI服务器PCB"];
  if (group === "被动元件") {
    if (["MLCC", "陶瓷电容"].includes(category)) return [group, "陶瓷电容"];
    if (category.includes("高可靠")) return [group, "高可靠电容"];
    if (/钽电容|铝电解电容|薄膜电容|超级电容/.test(category)) return [group, "功率与储能电容"];
    if (/电感|磁性|变压器/.test(category)) return [group, "电感磁性元件"];
    return [group, "石英晶振"];
  }
  if (group === "连接器") {
    if (/高速|通信|射频|线缆|线材/.test(category)) return [group, "高速互连"];
    if (category.includes("汽车")) return [group, "汽车连接器"];
    if (category.includes("消费")) return [group, "消费电子互连"];
    return [group, "高可靠连接器"];
  }
  if (group === "传感器") {
    if (/力学|应变|压力|称重/.test(category)) return [group, "力学传感器"];
    if (/视觉|红外|3D|图像/.test(category)) return [group, "视觉传感器"];
    if (category.includes("汽车")) return [group, "汽车传感器"];
    if (/流量|位移|工业/.test(category)) return [group, "工业传感器"];
    return [group, "环境传感器"];
  }
  if (group === "光学元件") {
    if (/镜头|摄像头|模组/.test(category)) return [group, "光学镜头与模组"];
    if (/AR|VR|光波导/.test(category)) return [group, "AR/VR光学"];
    if (/显示|偏光|触控|玻璃/.test(category)) return [group, "显示光学材料"];
    if (/机器视觉|工业镜头/.test(category)) return [group, "机器视觉光学"];
    return [group, "精密光学元件"];
  }
  if (group === "PCB") {
    if (/服务器|通信|高速/.test(category)) return [group, "AI服务器PCB"];
    if (category.includes("汽车")) return [group, "汽车PCB"];
    if (/FPC|HDI|刚柔/.test(category)) return [group, "FPC与HDI"];
    if (/封装|载板/.test(category)) return [group, "封装基板"];
    if (/高频|覆铜|材料/.test(category)) return [group, "高频高速材料"];
    if (category.includes("消费")) return [group, "消费电子PCB"];
    return [group, "通用多层PCB"];
  }
  if (group === "声学器件") {
    if (/扬声器|麦克风|受话器/.test(category)) return [group, "微型声学器件"];
    if (/耳机|音箱|智能/.test(category)) return [group, "智能声学终端"];
    return [group, "专业电声"];
  }
  if (group === "继电器与电接触") {
    if (category.includes("接触")) return [group, "电接触材料"];
    if (/高压直流|新能源/.test(category)) return [group, "高压直流继电器"];
    return [group, "继电器"];
  }
  if (group === "电子功能件") {
    if (/屏蔽|散热/.test(category)) return [group, "散热与电磁屏蔽"];
    if (/结构件|MIM|手机|笔记本/.test(category)) return [group, "精密结构件"];
    if (/材料/.test(category)) return [group, "新型材料结构件"];
    return [group, "精密功能件"];
  }
  return null;
}

const [taxonomy, stockMap, legacy] = await Promise.all([taxonomyFile, stockFile, legacyFile].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
const target = { name: P, secondary_sectors: secondary };
const sectorIndex = taxonomy.sectors.findIndex((item) => item.name === P);
if (sectorIndex >= 0) taxonomy.sectors[sectorIndex] = target; else taxonomy.sectors.push(target);
const legacySector = legacy.sectors.find((item) => item.name === P);
if (!legacySector) throw new Error("未找到电子元器件历史股票库");
const byCode = new Map(stockMap.stocks.map((item) => [item.code, item]));
let imported = 0;
for (const group of legacySector.groups || []) {
  const categories = new Map((group.categories || []).map((item) => [item.id, item.name]));
  for (const old of group.stocks || []) {
    const code = normalize(old.code); const category = categories.get(old.categoryId) || group.name; const hit = map(group.name, category);
    if (!hit) continue;
    const [secondaryName, tertiary] = hit;
    let stock = byCode.get(code);
    if (!stock) { stock = { code, name: old.name || "", primary_sector: P, classifications: [], product_tags: [], reason: old.note || "" }; stockMap.stocks.push(stock); byCode.set(code, stock); }
    stock.name = stock.name || old.name || "";
    stock.product_tags = unique([...(stock.product_tags || []), category]);
    if (!stock.reason) stock.reason = old.note || "";
    let classification = stock.classifications.find((item) => (item.primary_sector || stock.primary_sector) === P && item.secondary_sector === secondaryName);
    if (!classification) { classification = { primary_sector: P, secondary_sector: secondaryName, tertiary_sectors: [] }; stock.classifications.push(classification); }
    classification.tertiary_sectors = unique([...classification.tertiary_sectors, tertiary]);
    imported += 1;
  }
}
await writeFile(taxonomyFile, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
await writeFile(stockFile, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8");
console.log(`电子元器件目录已写入：${secondary.length} 个二级、导入 ${imported} 条主营归属。`);
