import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const rows = [
  ["煤炭","601225","陕西煤业","煤炭洗选与贸易","煤炭洗选","煤炭开采洗选和销售为主营。",["煤炭洗选"]],
  ["煤炭","600546","山煤国际","煤炭洗选与贸易","煤炭贸易与物流","主营煤炭贸易、煤炭销售及相关供应链业务。",["煤炭贸易","煤炭物流"]],
  ["石油天然气","600339","中油工程","油气储运","油气管网与储运","主营油气田地面工程、管道工程及储运设施建设。",["油气管道","油气工程"]],
  ["有色金属","000426","兴业银锡","黄金与贵金属","白银与铂族金属","主营银、锡、锌等有色金属矿采选，白银资源属性明确。",["白银","锡"]],
  ["有色金属","002203","海亮股份","铜","铜加工","主营铜管、铜棒等铜加工产品。",["铜管","铜加工"]],
  ["有色金属","002160","常铝股份","铝","铝加工","主营铝板带箔及铝加工产品。",["铝板带箔","铝加工"]],
  ["有色金属","000960","锡业股份","铅锌锡","锡与其他有色金属","主营锡、铜、锌等有色金属采选冶炼，锡业务居前。",["锡","有色冶炼"]],
  ["钢铁","000655","金岭矿业","铁矿资源","铁精粉与选矿","主营铁矿石采选及铁精粉生产。",["铁精粉","铁矿选矿"]],
  ["钢铁","600019","宝钢股份","不锈钢与硅钢","电工钢与硅钢","产品覆盖高牌号无取向电工钢等硅钢产品。",["电工钢","硅钢"]],
  ["钢铁","601686","友发集团","钢材加工与贸易","钢管与钢结构","主营焊接钢管及相关钢管产品。",["焊接钢管","钢管"]],
  ["钢铁","603878","武进不锈","钢材加工与贸易","钢材加工配送","主营不锈钢无缝管及钢材加工销售。",["不锈钢管","钢材加工"]],
  ["化工","601058","赛轮轮胎","高分子材料","橡胶与弹性体","主营轮胎及橡胶制品，属于橡胶材料应用产业链。",["橡胶","轮胎"]],
  ["化工","600352","浙江龙盛","农化与精细化工","染料与精细化学品","主营染料、助剂及中间体等精细化学品。",["染料","精细化学品"]],
  ["化工","002440","闰土股份","农化与精细化工","染料与精细化学品","主营染料、助剂及中间体等精细化工产品。",["染料","化工助剂"]]
];
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
let added = 0;
for (const [primary, code, name, secondary, tertiary, reason, tags] of rows) {
  let stock = byCode.get(code);
  if (!stock) {
    stock = { code, name, primary_sector: primary, classifications: [], product_tags: tags, reason };
    data.stocks.push(stock);
    byCode.set(code, stock);
  } else {
    stock.name = name;
    stock.product_tags = [...new Set([...(stock.product_tags || []), ...tags])];
  }
  const exists = stock.classifications.some((cls) => cls.primary_sector === primary && cls.secondary_sector === secondary && (cls.tertiary_sectors || []).includes(tertiary));
  if (exists) continue;
  stock.classifications.push({ primary_sector: primary, secondary_sector: secondary, tertiary_sectors: [tertiary], relevance_score: 1, source_refs: ["业务资料核对"], verification_note: reason });
  added += 1;
}
data.stocks.sort((a, b) => a.code.localeCompare(b.code));
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`added ${added} classifications to fill empty resource-cycle directions`);
