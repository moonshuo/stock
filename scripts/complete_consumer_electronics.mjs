import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const taxonomyPath = resolve(root, "data", "sector_taxonomy.json");
const stocksPath = resolve(root, "data", "stock_sector_map.json");
const primaryName = "消费电子";

const secondarySectors = [
  {
    name: "智能终端与代工",
    tertiary_sectors: ["智能手机与ODM", "平板与PC终端", "EMS与终端代工"],
    tertiary_descriptions: {
      "智能手机与ODM": "智能手机品牌、整机设计与原始设计制造。",
      "平板与PC终端": "平板电脑、笔记本电脑及其整机终端。",
      "EMS与终端代工": "消费电子产品的电子制造服务与组装代工。",
    },
  },
  {
    name: "精密零部件",
    tertiary_sectors: ["精密结构件与功能件", "天线与无线充电", "连接器与线束"],
    tertiary_descriptions: {
      "精密结构件与功能件": "消费电子的金属、玻璃、复合材料结构件及功能件。",
      "天线与无线充电": "手机及可穿戴设备的天线、射频连接与无线充电部件。",
      "连接器与线束": "终端内部连接器、线缆、线束和高速互连部件。",
    },
  },
  {
    name: "光学影像",
    tertiary_sectors: ["摄像头模组", "手机镜头与光学元件", "AR/VR光学"],
    tertiary_descriptions: {
      "摄像头模组": "手机、平板与智能终端摄像头模组及核心部件。",
      "手机镜头与光学元件": "手机镜头、滤光片、棱镜等精密光学元件。",
      "AR/VR光学": "AR、VR、MR终端的镜头、光波导和显示光学方案。",
    },
  },
  {
    name: "声学与可穿戴",
    tertiary_sectors: ["TWS耳机与智能音频", "微型扬声器与MEMS麦克风", "智能手表与XR终端"],
    tertiary_descriptions: {
      "TWS耳机与智能音频": "真无线耳机、蓝牙音频及智能音箱等终端。",
      "微型扬声器与MEMS麦克风": "微型扬声器、受话器、MEMS麦克风和声学器件。",
      "智能手表与XR终端": "智能手表、智能眼镜、AR/VR/MR等可穿戴终端。",
    },
  },
  {
    name: "显示与交互",
    tertiary_sectors: ["OLED与柔性显示", "MiniLED与背光模组", "触控与显示模组"],
    tertiary_descriptions: {
      "OLED与柔性显示": "OLED、柔性屏及折叠屏显示产业链。",
      "MiniLED与背光模组": "MiniLED、背光源及相关显示模组。",
      "触控与显示模组": "触摸屏、盖板玻璃、指纹识别及显示模组。",
    },
  },
  {
    name: "电源与存储",
    tertiary_sectors: ["消费电池与充电管理", "消费级存储", "快充与电源管理"],
    tertiary_descriptions: {
      "消费电池与充电管理": "手机、笔记本和可穿戴设备使用的电池及充电管理方案。",
      "消费级存储": "面向智能终端的嵌入式存储、内存及存储模组。",
      "快充与电源管理": "充电器、快充协议、电源适配器及电源管理部件。",
    },
  },
];

const assignments = [
  ["002475", "立讯精密", "精密零部件", ["连接器与线束"], ["消费电子连接器", "高速连接器", "铜缆互连"], "消费电子连接器与线束龙头，覆盖智能终端和可穿戴产品。"],
  ["002241", "歌尔股份", "声学与可穿戴", ["TWS耳机与智能音频", "智能手表与XR终端"], ["微型扬声器", "TWS耳机", "VR/AR"], "深度参与TWS耳机、VR/AR等智能硬件制造。"],
  ["300136", "信维通信", "精密零部件", ["天线与无线充电"], ["通信天线", "射频连接器", "无线充电"], "智能终端天线、射频连接和无线充电部件供应商。"],
  ["002456", "欧菲光", "光学影像", ["摄像头模组"], ["摄像头模组", "指纹识别", "触控模组"], "手机摄像头模组与触控模组重要供应商。"],
  ["002036", "联创电子", "光学影像", ["摄像头模组", "手机镜头与光学元件", "AR/VR光学"], ["光学镜头", "AR/VR光学", "显示模组"], "布局手机镜头、车载镜头及AR/VR光学。"],
  ["002273", "水晶光电", "光学影像", ["手机镜头与光学元件", "AR/VR光学"], ["光学滤光片", "AR光波导", "精密光学"], "消费电子精密光学元件与AR光波导供应商。"],
  ["688127", "蓝特光学", "光学影像", ["手机镜头与光学元件", "AR/VR光学"], ["棱镜", "玻璃晶圆", "AR/VR光学"], "为智能终端提供棱镜、玻璃晶圆等精密光学元件。"],
  ["002045", "国光电器", "声学与可穿戴", ["TWS耳机与智能音频", "微型扬声器与MEMS麦克风"], ["扬声器", "音箱", "智能音频"], "扬声器、音箱及智能音频产品制造商。"],
  ["002655", "共达电声", "声学与可穿戴", ["微型扬声器与MEMS麦克风"], ["微型扬声器", "MEMS麦克风", "声学器件"], "微型电声器件和MEMS麦克风供应商。"],
  ["002600", "领益智造", "精密零部件", ["精密结构件与功能件"], ["精密功能件", "结构件", "消费电子"], "消费电子精密功能件、结构件及模组供应商。"],
  ["603626", "科森科技", "精密零部件", ["精密结构件与功能件"], ["精密结构件", "金属结构件", "消费电子"], "消费电子精密金属结构件制造商。"],
  ["300684", "中石科技", "精密零部件", ["精密结构件与功能件"], ["导热材料", "热管理", "消费电子"], "服务智能终端的导热材料与热管理解决方案供应商。"],
  ["688525", "佰维存储", "电源与存储", ["消费级存储"], ["嵌入式存储", "存储模组", "消费电子"], "面向手机、可穿戴等终端提供嵌入式存储和存储模组。"],
  ["688036", "传音控股", "智能终端与代工", ["智能手机与ODM"], ["智能手机", "智能终端", "品牌手机"], "以智能手机为核心的消费电子终端品牌商。"],
  ["300433", "蓝思科技", "精密零部件", ["精密结构件与功能件"], ["玻璃盖板", "精密结构件", "智能终端"], "智能终端玻璃盖板与精密结构件龙头。"],
  ["300115", "长盈精密", "精密零部件", ["精密结构件与功能件", "连接器与线束"], ["精密结构件", "连接器", "消费电子"], "为消费电子提供精密结构件和连接器等零部件。"],
  ["300207", "欣旺达", "电源与存储", ["消费电池与充电管理"], ["锂离子电池", "手机电池", "消费电子"], "手机、笔记本等消费电子锂离子电池供应商。"],
  ["300256", "星星科技", "显示与交互", ["触控与显示模组"], ["触控显示", "盖板玻璃", "消费电子"], "智能终端触控显示模组与盖板玻璃供应商。"],
  ["002681", "奋达科技", "声学与可穿戴", ["TWS耳机与智能音频", "智能手表与XR终端"], ["智能音频", "智能穿戴", "耳机"], "布局智能音频及智能穿戴终端产品。"],
  ["300735", "光弘科技", "智能终端与代工", ["EMS与终端代工"], ["电子制造服务", "智能终端", "消费电子"], "提供智能终端等产品的电子制造服务。"],
];

const [taxonomy, stockMap] = await Promise.all([
  readFile(taxonomyPath, "utf8").then(JSON.parse),
  readFile(stocksPath, "utf8").then(JSON.parse),
]);

const primary = { name: primaryName, secondary_sectors: secondarySectors };
const primaryIndex = taxonomy.sectors.findIndex((sector) => sector.name === primaryName);
if (primaryIndex >= 0) taxonomy.sectors[primaryIndex] = primary;
else taxonomy.sectors.push(primary);

for (const [code, name, secondary, tertiaryNames, tags, reason] of assignments) {
  let stock = stockMap.stocks.find((item) => item.code === code);
  if (!stock) {
    stock = { code, name, classifications: [], tags: [], reason };
    stockMap.stocks.push(stock);
  }
  stock.name ||= name;
  stock.tags = [...new Set([...(stock.tags || []), ...tags])];
  stock.reason ||= reason;

  // 与项目现有的多归属字段保持一致；每条归属自身携带一级主线。
  stock.classifications = (stock.classifications || []).filter(
    (item) => !(item.primary === primaryName && item.secondary === secondary),
  );
  let classification = stock.classifications.find(
    (item) => item.primary_sector === primaryName && item.secondary_sector === secondary,
  );
  if (!classification) {
    classification = {
      primary_sector: primaryName,
      secondary_sector: secondary,
      tertiary_sectors: [],
      relevance_score: 0.9,
      source_refs: ["消费电子产业链人工归类"],
      verification_note: reason,
    };
    stock.classifications.push(classification);
  }
  classification.tertiary_sectors = [...new Set([...(classification.tertiary_sectors || []), ...tertiaryNames])];
}

await Promise.all([
  writeFile(taxonomyPath, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8"),
  writeFile(stocksPath, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8"),
]);

console.log(`已完善${primaryName}：${secondarySectors.length}个二级方向，${assignments.length}只代表性股票。`);
