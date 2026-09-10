import { readFile, writeFile } from "fs/promises";

const filePath = new URL("../data/stock_sector_map.json", import.meta.url);
const stockMap = JSON.parse(await readFile(filePath, "utf8"));

const primarySector = "厄尔尼诺影响";
const secondarySector = "农业种业";
const tertiarySector = "农作物种子";
const sourceRefs = ["用户提供的公司业务说明（2026-09-08）"];

const stocks = [
  {
    code: "300087",
    product_tags: ["杂交水稻种子", "杂交玉米种子", "小麦种子", "棉花种子", "油菜种子", "瓜菜种子"],
    reason: "公司主要从事优良水稻、玉米、小麦等主要农作物种子的研发、繁育、推广和服务，产品覆盖多个主要粮食作物。",
    source_ref: "证券之星：https://stock.stockstar.com/notice/SN2026042500004840.shtml"
  },
  {
    code: "000713",
    product_tags: ["杂交水稻种子", "杂交玉米种子", "常规水稻种子", "小麦种子", "瓜菜种子", "油菜种子"],
    reason: "公司种子业务覆盖杂交水稻、杂交玉米、常规水稻、小麦、瓜菜和油菜等产品，是A股综合农作物种子企业。",
    source_ref: "巨潮资讯网：https://static.cninfo.com.cn/finalpage/2025-05-12/1223513752.PDF"
  },
  {
    code: "600354",
    product_tags: ["玉米种子", "棉花种子", "瓜菜种子", "农作物种子研发", "种子生产加工"],
    reason: "公司长期从事各类农作物种子的研发、生产、加工和销售，属于西北地区具有代表性的综合种业上市公司。",
    source_ref: "巨潮资讯网：https://static.cninfo.com.cn/finalpage/2025-05-12/1223513752.PDF"
  },
  {
    code: "300189",
    product_tags: ["杂交水稻种子", "玉米种子", "油料作物种子", "蔬菜种子", "种子生产销售"],
    reason: "公司以杂交水稻种子选育、制种和销售为核心，并覆盖水稻、玉米、油料、蔬菜等农作物种子业务。",
    source_ref: "新浪财经VIP：https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=12178654&utm_source=chatgpt.com"
  },
  {
    code: "002385",
    product_tags: ["玉米种子", "生物育种", "转基因玉米种子", "农作物育种"],
    reason: "公司长期布局种业业务，覆盖玉米等农作物育种及种子产品，并具备生物育种产业链布局，属于A股种业产业链代表公司。",
    source_ref: "新浪财经：https://finance.sina.com.cn/roll/2026-02-09/doc-inhmexfp9360695.shtml"
  },
  {
    code: "600359",
    product_tags: ["棉花种子", "棉花育种", "农作物种子", "新疆农业"],
    reason: "公司农业业务覆盖棉花等农作物，并拥有种子相关业务，属于农作物种植及种业产业链上市公司。",
    source_ref: "新浪财经：https://finance.sina.com.cn/roll/2026-02-09/doc-inhmexfp9360695.shtml"
  },
  {
    code: "601952",
    product_tags: ["水稻种子", "小麦种子", "农作物良种", "种子繁育"],
    reason: "公司农业产业链覆盖种业和规模化种植，具备水稻、小麦等农作物良种繁育及种子业务，属于农作物种业产业链的延伸型上市公司。",
    source_ref: "财富号：https://caifuhao.eastmoney.com/news/20260819095857798320730"
  }
];

let added = 0;
for (const incoming of stocks) {
  const stock = stockMap.stocks.find((item) => item.code === incoming.code);
  if (!stock) throw new Error(`股票不存在于当前库：${incoming.code}`);

  stock.product_tags = [...new Set([...(stock.product_tags || []), ...incoming.product_tags])];
  stock.reason = incoming.reason;
  const classification = (stock.classifications || []).find((item) =>
    item.primary_sector === primarySector && item.secondary_sector === secondarySector,
  );
  if (classification) {
    classification.tertiary_sectors = [...new Set([...(classification.tertiary_sectors || []), tertiarySector])];
    classification.source_refs = [...new Set([...(classification.source_refs || []), ...sourceRefs, incoming.source_ref])];
    continue;
  }
  stock.classifications.push({
    primary_sector: primarySector,
    secondary_sector: secondarySector,
    tertiary_sectors: [tertiarySector],
    relevance_score: 1,
    source_refs: [...sourceRefs, incoming.source_ref]
  });
  added += 1;
}

await writeFile(filePath, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8");
console.log(`厄尔尼诺影响/农业种业/农作物种子：新增 ${added} 条股票归属，更新 ${stocks.length} 只股票的产品标签和依据。`);
