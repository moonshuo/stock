import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataPath = (...parts) => resolve(root, "data", ...parts);
const oldName = "航空航天";
const primaryName = "军工装备";

const secondarySectors = [
  { name: "航空装备", tertiary_sectors: ["军用固定翼飞机", "直升机与军用无人机", "航空发动机", "航电飞控与机载系统"] },
  { name: "航天装备", tertiary_sectors: ["运载火箭与航天动力", "导弹武器与制导控制", "卫星制造与载荷", "卫星通信导航与遥感"] },
  { name: "海军装备", tertiary_sectors: ["舰船整机与船舶制造", "舰载武器与电子系统", "水下装备与海洋探测"] },
  { name: "地面兵装", tertiary_sectors: ["装甲车辆与地面平台", "火炮与地面导弹", "弹药与军工化工"] },
  { name: "军工电子", tertiary_sectors: ["雷达与电子对抗", "军用通信与数据链", "军用连接器与元器件"] },
  { name: "军工材料与制造", tertiary_sectors: ["航空复合材料", "高温合金与钛合金", "军工结构件与锻件", "增材制造与特种加工"] },
  { name: "维修保障与后勤", tertiary_sectors: ["航空维修与改装", "军用地面保障设备", "仿真训练与检测"] },
];

const migrate = {
  "航空整机|军用固定翼飞机": ["航空装备", "军用固定翼飞机"],
  "航空整机|直升机与旋翼机": ["航空装备", "直升机与军用无人机"],
  "航空发动机|航空发动机整机": ["航空装备", "航空发动机"],
  "航空发动机|发动机控制与核心部件": ["航空装备", "航空发动机"],
  "机载系统与航电|航电与机载电子": ["航空装备", "航电飞控与机载系统"],
  "机载系统与航电|飞控、起落与机电系统": ["航空装备", "航电飞控与机载系统"],
  "航空结构与材料|航空复合材料": ["军工材料与制造", "航空复合材料"],
  "航空结构与材料|航空钛合金与高温合金": ["军工材料与制造", "高温合金与钛合金"],
  "航空结构与材料|航空结构件与锻件": ["军工材料与制造", "军工结构件与锻件"],
  "航空维修与保障|航空维修与改装": ["维修保障与后勤", "航空维修与改装"],
  "航空维修与保障|机场地面设备": ["维修保障与后勤", "军用地面保障设备"],
  "航天运载与控制|运载火箭与航天动力": ["航天装备", "运载火箭与航天动力"],
  "航天运载与控制|导弹与制导控制": ["航天装备", "导弹武器与制导控制"],
  "卫星制造与应用|卫星制造": ["航天装备", "卫星制造与载荷"],
  "卫星制造与应用|卫星通信与互联网": ["航天装备", "卫星通信导航与遥感"],
  "卫星制造与应用|卫星导航与遥感应用": ["航天装备", "卫星通信导航与遥感"],
};

const additions = [
  ["600150", "中国船舶", "海军装备", "舰船整机与船舶制造", "大型军民用船舶总装建造企业。"],
  ["601989", "中国重工", "海军装备", "舰船整机与船舶制造", "覆盖舰船建造及海洋防务装备。"],
  ["600685", "中船防务", "海军装备", "舰船整机与船舶制造", "军民用舰船及海洋工程装备制造商。"],
  ["600764", "中国海防", "海军装备", "水下装备与海洋探测", "布局水声、电子信息及海洋防务装备。"],
  ["600967", "内蒙一机", "地面兵装", "装甲车辆与地面平台", "装甲车辆与地面武器装备制造商。"],
  ["000519", "中兵红箭", "地面兵装", "弹药与军工化工", "弹药、超硬材料及相关军工业务平台。"],
  ["600435", "北方导航", "地面兵装", "火炮与地面导弹", "导弹控制、导航与地面兵装相关业务。"],
  ["600990", "四创电子", "军工电子", "雷达与电子对抗", "雷达电子及相关军工电子系统供应商。"],
  ["300474", "景嘉微", "军工电子", "军用通信与数据链", "军工图形显示与电子信息产品供应商。"],
];

const [taxonomy, stockMap, collections] = await Promise.all([
  readFile(dataPath("sector_taxonomy.json"), "utf8").then(JSON.parse),
  readFile(dataPath("stock_sector_map.json"), "utf8").then(JSON.parse),
  readFile(dataPath("sector_collections.json"), "utf8").then(JSON.parse),
]);

const index = taxonomy.sectors.findIndex((sector) => sector.name === oldName || sector.name === primaryName);
const primary = { name: primaryName, secondary_sectors: secondarySectors };
if (index >= 0) taxonomy.sectors[index] = primary;
else taxonomy.sectors.push(primary);

for (const stock of stockMap.stocks) {
  if (stock.primary_sector === oldName) stock.primary_sector = primaryName;
  for (const classification of stock.classifications || []) {
    if (classification.primary_sector !== oldName) continue;
    const mapped = migrate[`${classification.secondary_sector}|${classification.tertiary_sectors?.[0]}`];
    if (!mapped) continue;
    classification.primary_sector = primaryName;
    classification.secondary_sector = mapped[0];
    classification.tertiary_sectors = [mapped[1]];
  }
}

for (const [code, name, secondarySector, tertiarySector, note] of additions) {
  let stock = stockMap.stocks.find((item) => item.code === code);
  if (!stock) {
    stock = { code, name, primary_sector: primaryName, classifications: [], product_tags: [], reason: note };
    stockMap.stocks.push(stock);
  }
  stock.name ||= name;
  stock.primary_sector ||= primaryName;
  if (!stock.classifications.some((item) => item.primary_sector === primaryName && item.secondary_sector === secondarySector && item.tertiary_sectors?.includes(tertiarySector))) {
    stock.classifications.push({ primary_sector: primaryName, secondary_sector: secondarySector, tertiary_sectors: [tertiarySector], relevance_score: 0.9, source_refs: ["军工装备产业链人工归类"], verification_note: note });
  }
}

for (const collection of collections.collections || []) {
  collection.primary_sectors = (collection.primary_sectors || []).map((name) => name === oldName ? primaryName : name);
}

const dailyThemesDir = dataPath("daily_themes");
const dailyFiles = (await readdir(dailyThemesDir)).filter((file) => file.endsWith(".json"));
const dailyThemes = await Promise.all(dailyFiles.map(async (file) => {
  const item = JSON.parse(await readFile(join(dailyThemesDir, file), "utf8"));
  for (const theme of item.themes || []) if (theme.primary_sector === oldName) theme.primary_sector = primaryName;
  return [file, item];
}));

await Promise.all([
  writeFile(dataPath("sector_taxonomy.json"), `${JSON.stringify(taxonomy, null, 2)}\n`),
  writeFile(dataPath("stock_sector_map.json"), `${JSON.stringify(stockMap, null, 2)}\n`),
  writeFile(dataPath("sector_collections.json"), `${JSON.stringify(collections, null, 2)}\n`),
  ...dailyThemes.map(([file, content]) => writeFile(join(dailyThemesDir, file), `${JSON.stringify(content, null, 2)}\n`)),
]);

console.log(`已将${oldName}重构为${primaryName}，迁移并补充${stockMap.stocks.filter((stock) => stock.classifications?.some((item) => item.primary_sector === primaryName)).length}只股票。`);
