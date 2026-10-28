import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const P = "机器人";
const additions = [
  {
    code: "002747", name: "埃斯顿", secondary: "机器人本体与整机", tertiary: "协作与人形机器人",
    tags: ["协作机器人", "人形机器人布局"],
    note: "除工业机器人主营外，公司已布局协作机器人及人形机器人相关产品；该项为相关业务归属。"
  },
  {
    code: "003021", name: "兆威机电", secondary: "末端执行与工艺装备", tertiary: "夹爪与末端执行器",
    tags: ["灵巧手", "末端执行器", "微型传动"],
    note: "公司微型传动系统可用于人形机器人灵巧手等末端执行机构；该项为相关产品归属。"
  },
  {
    code: "300024", name: "机器人", secondary: "机器人本体与整机", tertiary: "协作与人形机器人",
    tags: ["协作机器人", "机器人本体"],
    note: "公司在工业机器人主营基础上具备协作机器人相关产品布局；该项为相关业务归属。"
  },
  {
    code: "688218", name: "江苏北人", secondary: "末端执行与工艺装备", tertiary: "夹爪与末端执行器",
    tags: ["末端执行器", "焊接工作站", "机器人夹具"],
    note: "机器人焊接系统集成包含夹具、工装等末端执行配套；该项为系统集成相关归属。"
  }
];
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
for (const item of additions) {
  const stock = byCode.get(item.code);
  if (!stock) throw new Error(`缺少股票：${item.code}`);
  stock.name = item.name;
  stock.product_tags = [...new Set([...(stock.product_tags || []), ...item.tags])];
  let cls = stock.classifications.find((entry) => (entry.primary_sector || stock.primary_sector) === P && entry.secondary_sector === item.secondary);
  if (!cls) { cls = { primary_sector: P, secondary_sector: item.secondary, tertiary_sectors: [] }; stock.classifications.push(cls); }
  cls.tertiary_sectors = [...new Set([...cls.tertiary_sectors, item.tertiary])];
  if (!stock.reason.includes(item.note)) stock.reason = `${stock.reason || ""}${stock.reason ? "；" : ""}${item.note}`;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`全库空项补齐：更新 ${additions.length} 条相关业务归属。`);
