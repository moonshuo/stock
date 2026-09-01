import { readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const taxonomyFile = path.join(root, "data", "sector_taxonomy.json");
const stocksFile = path.join(root, "data", "stock_sector_map.json");
const taxonomy = JSON.parse(await readFile(taxonomyFile, "utf8"));
const data = JSON.parse(await readFile(stocksFile, "utf8"));
const secondarySectors = [
  ["种业", ["粮食种子", "蔬菜与特色种子", "生物育种"]],
  ["种植业", ["粮食种植", "糖料与经济作物", "橡胶与林业"]],
  ["农资", ["化肥", "农药", "农膜与农资流通"]],
  ["饲料", ["水产饲料", "畜禽饲料"]],
  ["畜禽养殖", ["生猪养殖", "禽类养殖"]],
  ["水产养殖与动保", ["水产养殖", "动物疫苗与兽药"]],
  ["农业机械", ["农机整机", "农机零部件与智能农机"]],
  ["农产品加工与流通", ["粮油加工", "肉制品与农产品流通"]]
];
const rows = [];
const add = (code, name, secondary, tertiary, tags, reason) => rows.push({ code, name, secondary, tertiary, tags, reason });

add("000998","隆平高科","种业",["粮食种子","生物育种"],["杂交水稻种子","玉米种子"],"主营杂交水稻、玉米等农作物种子及生物育种业务。");
add("600313","农发种业","种业",["粮食种子"],["小麦种子","玉米种子"],"主营农作物种子和农资贸易业务。");
add("002041","登海种业","种业",["粮食种子"],["玉米种子"],"主营玉米种子研发、生产和销售。");
add("000713","丰乐种业","种业",["蔬菜与特色种子"],["蔬菜种子","玉米种子"],"主营种子业务，覆盖玉米、蔬菜等品种。");
add("300189","神农种业","种业",["蔬菜与特色种子"],["油料种子","水稻种子"],"主营农作物种子选育、繁育和销售。");
add("600598","北大荒","种植业",["粮食种植"],["水稻","大豆","玉米"],"主营粮食作物种植及土地承包经营。");
add("600354","敦煌种业","种植业",["粮食种植"],["棉花","粮食种植"],"主营种子、棉花及农产品业务。");
add("600737","中粮糖业","种植业",["糖料与经济作物"],["食糖","甜菜糖"],"主营食糖生产、贸易及相关农产品业务。");
add("000911","广农糖业","种植业",["糖料与经济作物"],["甘蔗糖","食糖"],"主营制糖及糖料产业链业务。");
add("601118","海南橡胶","种植业",["橡胶与林业"],["天然橡胶","橡胶种植"],"主营天然橡胶种植、加工和销售。");
add("600096","云天化","农资",["化肥"],["磷肥","复合肥"],"主营磷肥、复合肥及磷化工产品。");
add("000422","湖北宜化","农资",["化肥"],["尿素","磷肥"],"主营尿素、磷酸二铵等化肥产品。");
add("600470","六国化工","农资",["化肥"],["磷肥","复合肥"],"主营磷肥、复合肥等农用化肥。");
add("600486","扬农化工","农资",["农药"],["农药","除草剂"],"主营农药原药和制剂。");
add("002258","利尔化学","农资",["农药"],["草铵膦","农药"],"主营农药原药和制剂，核心产品包括草铵膦。");
add("000553","安道麦A","农资",["农药"],["农药","植保"],"主营农药和植保解决方案。");
add("000860","顺鑫农业","农资",["农膜与农资流通"],["农资流通","农产品"],"经营农资流通及农产品相关业务。");
add("002311","海大集团","饲料",["水产饲料","畜禽饲料"],["水产饲料","畜禽饲料"],"主营水产和畜禽饲料，并布局养殖服务。");
add("000876","新希望","饲料",["畜禽饲料"],["饲料","畜禽养殖"],"主营饲料生产销售及畜禽养殖。");
add("002567","唐人神","饲料",["畜禽饲料"],["饲料","生猪养殖"],"主营饲料、肉制品和生猪养殖。");
add("002714","牧原股份","畜禽养殖",["生猪养殖"],["生猪养殖","生猪屠宰"],"主营生猪养殖和生猪屠宰。");
add("002157","正邦科技","畜禽养殖",["生猪养殖"],["生猪养殖","饲料"],"主营生猪养殖和饲料业务。");
add("300498","温氏股份","畜禽养殖",["生猪养殖","禽类养殖"],["生猪","肉鸡"],"主营肉猪、肉鸡养殖。");
add("002299","圣农发展","畜禽养殖",["禽类养殖"],["肉鸡","禽肉"],"主营白羽肉鸡养殖、屠宰和食品加工。");
add("002458","益生股份","畜禽养殖",["禽类养殖"],["种鸡","肉鸡"],"主营祖代、父母代肉种鸡及商品代雏鸡。");
add("002069","獐子岛","水产养殖与动保",["水产养殖"],["海珍品","水产养殖"],"主营海珍品养殖、加工和销售。");
add("002086","东方海洋","水产养殖与动保",["水产养殖"],["海水养殖","水产品"],"主营海水养殖及水产品业务。");
add("600201","生物股份","水产养殖与动保",["动物疫苗与兽药"],["动物疫苗","兽药"],"主营兽用生物制品和动物疫苗。");
add("300119","瑞普生物","水产养殖与动保",["动物疫苗与兽药"],["兽药","动物疫苗"],"主营兽药制剂和动物疫苗。");
add("603566","普莱柯","水产养殖与动保",["动物疫苗与兽药"],["动物疫苗","兽药"],"主营动物疫苗、兽药及技术服务。");
add("601038","一拖股份","农业机械",["农机整机"],["拖拉机","农机"],"主营拖拉机、收获机械等农机整机。");
add("300022","吉峰科技","农业机械",["农机整机"],["农机销售","农机服务"],"主营农机销售、服务和农机流通。");
add("300159","新研股份","农业机械",["农机零部件与智能农机"],["农机","智能农机"],"主营农牧机械和相关农机装备。");
add("000895","双汇发展","农产品加工与流通",["肉制品与农产品流通"],["肉制品","生鲜肉"],"主营肉制品加工、屠宰和冷链流通。");
add("600598","北大荒","农产品加工与流通",["粮油加工"],["粮食","农产品"],"经营粮食作物种植及农产品相关业务。");
add("000930","中粮科技","农产品加工与流通",["粮油加工"],["玉米深加工","燃料乙醇"],"主营玉米深加工及粮油食品相关产品。");

const replacement = { name: "农业", secondary_sectors: secondarySectors.map(([name, tertiary]) => ({ name, tertiary_sectors: tertiary })) };
const index = taxonomy.sectors.findIndex((sector) => sector.name === "农业");
if (index >= 0) taxonomy.sectors[index] = replacement; else taxonomy.sectors.push(replacement);
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
let added = 0;
for (const row of rows) {
  let stock = byCode.get(row.code);
  if (!stock) { stock = { code: row.code, name: row.name, primary_sector: "农业", classifications: [], product_tags: [], reason: row.reason }; data.stocks.push(stock); byCode.set(row.code, stock); }
  stock.name = row.name;
  stock.product_tags = [...new Set([...(stock.product_tags || []), ...row.tags])];
  let cls = stock.classifications.find((item) => item.primary_sector === "农业" && item.secondary_sector === row.secondary);
  if (!cls) { cls = { primary_sector: "农业", secondary_sector: row.secondary, tertiary_sectors: [], relevance_score: 1, source_refs: ["业务资料核对"] }; stock.classifications.push(cls); }
  cls.tertiary_sectors = [...new Set([...(cls.tertiary_sectors || []), ...row.tertiary])];
  cls.relevance_score = 1;
  cls.source_refs = [...new Set([...(cls.source_refs || []), "业务资料核对"])];
  if (!stock.reason || stock.reason === "相关产业链业务") stock.reason = row.reason;
  added += 1;
}
data.stocks.sort((a, b) => a.code.localeCompare(b.code));
await writeFile(taxonomyFile, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
await writeFile(stocksFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ classifications: added, agricultureStocks: new Set(rows.map((row) => row.code)).size, totalStocks: data.stocks.length }, null, 2));
