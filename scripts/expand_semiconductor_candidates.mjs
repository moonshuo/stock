import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const P = "半导体";
const c = (secondary, ...tertiary) => ({ primary_sector: P, secondary_sector: secondary, tertiary_sectors: tertiary });

// 来自公开半导体概念候选池的逐家产品归类；非核心项目在 reason 中明确标识。
const candidates = [
  ["300480", "光力科技", [c("半导体设备", "检测与量测设备")], ["划片设备", "半导体检测设备", "封装设备"], "半导体封装设备和检测装备为明确业务方向。"],
  ["688146", "中船特气", [c("半导体材料", "电子气体")], ["电子特气", "氟化物", "半导体气体"], "主营电子特种气体，直接服务半导体制造。"],
  ["002388", "新亚制程", [c("半导体材料", "湿电子化学品")], ["电子化学品", "半导体材料", "电子制造服务"], "电子化学材料供应为相关业务，按半导体湿电子化学品相关业务归属。"],
  ["000670", "盈方微", [c("芯片设计", "SoC芯片")], ["SoC", "图像处理芯片", "集成电路设计"], "主营集成电路设计，产品涉及图像处理等SoC。"],
  ["688049", "炬芯科技", [c("芯片设计", "SoC芯片", "AI芯片")], ["智能音频SoC", "AIoT芯片", "蓝牙芯片"], "智能音频和AIoT SoC为核心产品。"],
  ["688484", "南芯科技", [c("芯片设计", "模拟芯片")], ["电源管理芯片", "充电管理芯片", "模拟IC"], "主营电源及充电管理模拟芯片。"],
  ["688593", "新相微", [c("芯片设计", "模拟芯片")], ["显示驱动芯片", "电源管理芯片", "模拟IC"], "主营显示驱动及电源管理芯片。"],
  ["688548", "广钢气体", [c("半导体材料", "电子气体")], ["电子大宗气体", "半导体气体", "现场制气"], "电子大宗气体业务服务半导体等先进制造客户。"],
  ["003043", "华亚智能", [c("半导体产业服务", "半导体设备零部件")], ["精密金属结构件", "半导体设备零部件", "真空腔体配套"], "精密金属结构件应用于半导体设备，按相关业务归属。"],
  ["688209", "英集芯", [c("芯片设计", "模拟芯片")], ["电源管理芯片", "快充芯片", "模拟IC"], "主营电源管理及快充芯片。"],
  ["688549", "中巨芯-U", [c("半导体材料", "湿电子化学品", "电子气体")], ["湿电子化学品", "电子特气", "前驱体"], "主营半导体湿电子化学品、电子特气和前驱体。"],
  ["603893", "瑞芯微", [c("芯片设计", "SoC芯片", "AI芯片")], ["AIoT SoC", "处理器芯片", "NPU"], "主营智能应用处理器及AIoT SoC。"],
  ["688153", "唯捷创芯", [c("芯片设计", "射频芯片")], ["射频前端芯片", "PA", "射频模组"], "主营射频前端芯片。"],
  ["688729", "屹唐股份", [c("半导体设备", "刻蚀设备", "薄膜沉积设备")], ["干法刻蚀", "薄膜沉积", "半导体设备"], "干法刻蚀和薄膜沉积设备为明确业务方向。"],
  ["600877", "电科芯片", [c("芯片设计", "射频芯片", "模拟芯片")], ["射频芯片", "模拟IC", "特种集成电路"], "主营射频、模拟及特种集成电路。"],
  ["688147", "微导纳米", [c("半导体设备", "薄膜沉积设备")], ["ALD设备", "CVD设备", "半导体薄膜设备"], "ALD/CVD设备可用于半导体薄膜制造，按相关业务归属。"],
  ["688661", "和林微纳", [c("半导体产业服务", "半导体设备零部件")], ["探针", "测试治具", "精密零部件"], "探针及精密结构件直接服务半导体测试和设备。"],
  ["300054", "鼎龙股份", [c("半导体材料", "CMP材料")], ["CMP抛光垫", "CMP抛光液", "半导体材料"], "CMP抛光垫及配套材料为核心业务。"],
  ["688458", "美芯晟", [c("芯片设计", "模拟芯片")], ["电源管理芯片", "LED驱动芯片", "模拟IC"], "主营电源管理和LED驱动芯片。"],
  ["603324", "盛剑科技", [c("半导体产业服务", "半导体洁净室与厂务工程")], ["工艺废气处理", "半导体厂务", "洁净工程配套"], "半导体工艺废气治理及厂务配套为明确业务方向。"],
  ["301297", "富乐德", [c("半导体产业服务", "半导体检测服务")], ["晶圆再生", "精密清洗", "半导体服务"], "晶圆再生和精密清洗服务属于半导体制造后段相关服务。"],
  ["688403", "汇成股份", [c("封装测试", "集成电路封装", "先进封装")], ["显示驱动芯片封装", "先进封装", "测试"], "主营显示驱动芯片封装测试。"],
  ["688535", "华海诚科", [c("封装测试", "封装材料与载板")], ["环氧塑封料", "封装材料", "先进封装材料"], "主营集成电路封装用环氧塑封料。"],
  ["688808", "联讯仪器", [c("半导体设备", "检测与量测设备")], ["半导体测试仪器", "量测设备", "测试系统"], "半导体测试和量测仪器为明确业务方向。"]
];
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
for (const [code, name, classifications, tags, reason] of candidates) {
  let stock = byCode.get(code);
  if (!stock) { stock = { code, name, primary_sector: P, classifications: [], product_tags: [], reason }; data.stocks.push(stock); byCode.set(code, stock); }
  stock.name = name; stock.product_tags = [...new Set([...(stock.product_tags || []), ...tags])];
  for (const entry of classifications) {
    let current = stock.classifications.find((x) => (x.primary_sector || stock.primary_sector) === P && x.secondary_sector === entry.secondary_sector);
    if (!current) { current = { primary_sector: P, secondary_sector: entry.secondary_sector, tertiary_sectors: [] }; stock.classifications.push(current); }
    current.tertiary_sectors = [...new Set([...current.tertiary_sectors, ...entry.tertiary_sectors])];
  }
  if (!stock.reason.includes(reason)) stock.reason = `${stock.reason || ""}${stock.reason ? "；" : ""}${reason}`;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`半导体候选池审核后新增/更新 ${candidates.length} 只股票。`);
