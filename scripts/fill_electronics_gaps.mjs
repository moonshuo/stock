import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const P = "电子元器件";
const c = (secondary, ...tertiary) => ({ primary_sector: P, secondary_sector: secondary, tertiary_sectors: tertiary });

const additions = [
  ["605333", "沪光股份", [c("连接器", "汽车连接器")], ["汽车连接器", "高压连接器", "线束"], "主营汽车高低压连接器及线束，是汽车连接器方向直接标的。"],
  ["603633", "徕木股份", [c("连接器", "汽车连接器")], ["汽车连接器", "精密连接器", "汽车电子"], "主营汽车电子连接器和精密结构件，是汽车连接器方向直接标的。"],
  ["688800", "瑞可达", [c("连接器", "汽车连接器", "高速互连")], ["汽车连接器", "高速连接器", "数据中心连接器"], "主营新能源汽车及通信数据中心连接器，属于汽车连接器和高速互连方向。"],
  ["002273", "水晶光电", [c("光学元件", "AR/VR光学")], ["AR光波导", "AR/VR光学", "精密光学"], "在精密光学主营之外，公司布局AR光波导等AR/VR光学业务。"],
  ["002036", "联创电子", [c("光学元件", "AR/VR光学")], ["AR/VR光学", "光学镜头", "显示模组"], "除光学镜头主业外，相关光学产品可用于AR/VR终端，按相关业务补充归属。"],
  ["688127", "蓝特光学", [c("光学元件", "AR/VR光学")], ["AR/VR光学", "光学元件", "棱镜"], "精密光学元件可用于AR/VR光学模组，按相关产品能力补充归属。"],
  ["688686", "奥普特", [c("光学元件", "机器视觉光学")], ["工业镜头", "机器视觉光学", "视觉系统"], "机器视觉系统主营包含工业镜头、光源等光学组件。"],
  ["688003", "天准科技", [c("光学元件", "机器视觉光学")], ["机器视觉光学", "工业镜头", "视觉检测"], "机器视觉与检测装备包含相关光学成像能力，按直接产品补充归属。"],
  ["002463", "沪电股份", [c("PCB", "消费电子PCB")], ["消费电子PCB", "通信PCB", "高多层PCB"], "主营通信和汽车PCB，并存在消费电子PCB业务；消费电子归属为相关业务补充。"],
  ["002938", "鹏鼎控股", [c("PCB", "消费电子PCB")], ["消费电子PCB", "FPC", "HDI"], "消费电子PCB为核心业务，同时覆盖FPC与HDI。"],
  ["603228", "景旺电子", [c("PCB", "消费电子PCB")], ["消费电子PCB", "多层PCB", "HDI"], "除通用多层板外，消费电子PCB为长期应用方向。"],
  ["002916", "深南电路", [c("PCB", "封装基板")], ["封装基板", "IC载板", "PCB"], "IC载板为公司长期布局，属于封装基板方向。"],
  ["002436", "兴森科技", [c("PCB", "封装基板")], ["IC载板", "封装基板", "测试板"], "半导体封装基板和IC载板业务为公司明确布局。"],
  ["688519", "南亚新材", [c("PCB", "封装基板")], ["IC载板材料", "封装基板", "覆铜板"], "IC载板材料是其覆铜板业务的明确应用方向，按相关材料补充归属。"],
  ["600885", "宏发股份", [c("继电器与电接触", "高压直流继电器")], ["高压直流继电器", "新能源汽车继电器", "储能继电器"], "主营继电器，并直接覆盖新能源汽车和储能高压直流继电器。"],
  ["300932", "三友联众", [c("继电器与电接触", "高压直流继电器")], ["高压直流继电器", "新能源汽车继电器", "继电器"], "主营继电器，相关产品覆盖新能源汽车高压直流应用。"],
  ["002600", "领益智造", [c("电子功能件", "新型材料结构件")], ["功能材料", "精密结构件", "新型材料结构件"], "在精密功能件主营外，功能材料及结构件能力覆盖新型材料结构件方向。"],
  ["300602", "飞荣达", [c("电子功能件", "新型材料结构件")], ["导热材料", "电磁屏蔽材料", "复合材料结构件"], "散热和电磁屏蔽主营所使用的复合材料结构件，补充归入该方向。"],
  ["300684", "中石科技", [c("电子功能件", "新型材料结构件")], ["导热材料", "石墨材料", "复合材料"], "导热和复合材料业务具备新型材料结构件属性，按相关业务补充归属。"]
];

const byCode = new Map(data.stocks.map((item) => [item.code, item]));
for (const [code, name, classifications, tags, reason] of additions) {
  let stock = byCode.get(code);
  if (!stock) {
    stock = { code, name, primary_sector: P, classifications: [], product_tags: [], reason };
    data.stocks.push(stock); byCode.set(code, stock);
  }
  stock.name = name;
  stock.product_tags = [...new Set([...(stock.product_tags || []), ...tags])];
  for (const incoming of classifications) {
    let current = stock.classifications.find((item) => (item.primary_sector || stock.primary_sector) === P && item.secondary_sector === incoming.secondary_sector);
    if (!current) { current = { primary_sector: P, secondary_sector: incoming.secondary_sector, tertiary_sectors: [] }; stock.classifications.push(current); }
    current.tertiary_sectors = [...new Set([...current.tertiary_sectors, ...incoming.tertiary_sectors])];
  }
  // 多重归属以独立备注无法表达时，保留原主营依据并附上本次相关业务说明。
  if (!stock.reason.includes(reason)) stock.reason = `${stock.reason || ""}${stock.reason ? "；" : ""}${reason}`;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`已补齐电子元器件空方向并新增/更新 ${additions.length} 只股票。`);
