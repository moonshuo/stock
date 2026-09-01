import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const root = process.cwd();
const scanFile = path.join(root, "data", "limit_up_scans", "limit_ups_2025_2026.json");
const stockFile = path.join(root, "data", "stock_sector_map.json");
const auditFile = path.join(root, "data", "limit_up_scans", "limit_up_business_audit_2025_2026.json");
const scan = JSON.parse(await readFile(scanFile, "utf8"));
const data = JSON.parse(await readFile(stockFile, "utf8"));
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
const decoder = new TextDecoder("gb18030");
const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://basic.10jqka.com.cn/" };
const source = "2025-2026涨停扫描；同花顺F10主营业务核验";

function clean(text) { return text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
function extract(html) {
  const text = clean(html);
  const title = text.match(/^\s*([^\(\s]+)\(\d{6}\)/)?.[1] || "";
  const start = text.indexOf("主营业务："); const end = text.indexOf("经营范围：", Math.max(0, start));
  return { name: title, business: text.slice(Math.max(start, 0), end > start ? end : start + 1800).slice(0, 1600) };
}
async function fetchBusiness(code) {
  try {
    const response = await fetch(`https://basic.10jqka.com.cn/${code}/operate.html`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    return extract(decoder.decode(await response.arrayBuffer()));
  } catch { return null; }
}
const r = (pattern, text) => pattern.test(text);
function classify(text) {
  // 仅保留能直接从主营/产品文字确认的长期产品方向；未命中即跳过。
  if (r(/(EEPROM|NOR Flash|NAND|DRAM|存储芯片|存储器)/i, text)) return ["半导体", "芯片设计", "存储芯片"];
  if (r(/(射频前端|射频芯片|Wi-?Fi芯片|蓝牙芯片)/i, text)) return ["半导体", "芯片设计", "射频芯片"];
  if (r(/(电源管理芯片|模拟芯片|信号链芯片)/i, text)) return ["半导体", "芯片设计", "模拟芯片"];
  if (r(/(IGBT|MOSFET|碳化硅功率|功率半导体|功率芯片)/i, text)) return ["半导体", "芯片设计", "功率芯片"];
  if (r(/(光刻机|涂胶显影)/i, text)) return ["半导体", "半导体设备", "光刻及涂胶显影设备"];
  if (r(/(刻蚀设备)/i, text)) return ["半导体", "半导体设备", "刻蚀设备"];
  // CVD 也用于金刚石、锂电和光伏等行业；只有同时出现半导体语境才可归为半导体沉积设备。
  if (r(/(PECVD|ALD|CVD|薄膜沉积设备)/i, text) && r(/(半导体|晶圆|集成电路|芯片)/i, text)) return ["半导体", "半导体设备", "薄膜沉积设备"];
  if (r(/(晶圆清洗|半导体清洗设备)/i, text)) return ["半导体", "半导体设备", "清洗设备"];
  if (r(/(集成电路封装测试|芯片封装测试)/i, text)) return ["半导体", "封装测试", "集成电路封装"];
  if (r(/(光伏逆变器)/i, text)) return ["光伏产业链", "逆变器与电站", "光伏逆变器"];
  if (r(/(光伏组件)/i, text)) return ["光伏产业链", "电池与组件", "光伏组件"];
  if (r(/(风力发电机组|风电整机)/i, text)) return ["风电产业链", "风电整机", "陆上风机"];
  if (r(/(锂矿|碳酸锂|氢氧化锂)/i, text)) return ["锂电产业链", "锂资源", "锂矿与锂盐"];
  if (r(/(动力电池|锂离子电池)/i, text)) return ["锂电产业链", "动力电池", "动力电池"];
  if (r(/(储能系统|储能电站)/i, text)) return ["储能", "储能系统", "大型储能系统"];
  if (r(/(电解水制氢|电解槽)/i, text)) return ["氢能源", "制氢", "电解水制氢"];
  if (r(/(煤炭开采|煤炭采选)/i, text)) return ["煤炭", "煤炭资源开采", "动力煤"];
  if (r(/(原油.*开采|油气勘探开发)/i, text)) return ["石油天然气", "油气勘探开发", "原油与天然气开采"];
  if (r(/(黄金.*采选|金矿)/i, text)) return ["有色金属", "黄金与贵金属", "黄金"];
  if (r(/(铜矿|铜冶炼|阴极铜)/i, text)) return ["有色金属", "铜", "铜矿与冶炼"];
  if (r(/(电解铝|氧化铝)/i, text)) return ["有色金属", "铝", "氧化铝与电解铝"];
  if (r(/(稀土.*(冶炼|分离|氧化物)|稀土矿)/i, text)) return ["有色金属", "稀土与小金属", "稀土"];
  if (r(/(钢铁冶炼|钢材.*轧制)/i, text)) return ["钢铁", "普钢", "板材"];
  if (r(/(水泥|熟料)/i, text)) return ["建材", "水泥", "区域水泥"];
  if (r(/(玻璃纤维|玻纤纱)/i, text)) return ["建材", "玻纤与复合材料", "玻璃纤维"];
  if (r(/(纯碱)/i, text)) return ["化工", "基础化工", "纯碱与无机化工"];
  if (r(/(氯碱|烧碱|PVC)/i, text)) return ["化工", "基础化工", "盐化工与氯碱"];
  if (r(/(农药.*(原药|制剂)|除草剂|杀虫剂)/i, text)) return ["化工", "农化与精细化工", "农药"];
  if (r(/(航空发动机)/i, text)) return ["航空航天", "航空发动机", "航空发动机整机"];
  if (r(/(卫星通信|卫星互联网)/i, text)) return ["航空航天", "卫星制造与应用", "卫星通信与互联网"];
  if (r(/(农作物种子|玉米种子|水稻种子)/i, text)) return ["农业", "种业", "粮食种子"];
  if (r(/(生猪养殖)/i, text)) return ["农业", "畜禽养殖", "生猪养殖"];
  if (r(/(动物疫苗|兽用疫苗)/i, text)) return ["农业", "水产养殖与动保", "动物疫苗与兽药"];
  if (r(/(创新药|抗体药物)/i, text)) return ["医药医疗", "化学制药", "创新药"];
  if (r(/(体外诊断|分子诊断)/i, text)) return ["医药医疗", "医疗器械", "体外诊断"];
  if (r(/(医疗器械.*(影像|监护)|医学影像)/i, text)) return ["医药医疗", "医疗器械", "医疗影像与生命信息"];
  if (r(/(白酒)/i, text)) return ["消费", "白酒与酒类", "高端白酒"];
  if (r(/(乳制品)/i, text)) return ["消费", "食品饮料", "乳制品"];
  if (r(/(化妆品|护肤品)/i, text)) return ["消费", "美妆与个护", "化妆品"];
  if (r(/(工业机器人|协作机器人)/i, text)) return ["机器人", "机器人本体与整机", "工业机器人"];
  if (r(/(数据中心.*(运营|IDC)|互联网数据中心)/i, text)) return ["AIDC基础设施", "IDC运营与算力服务", "第三方IDC"];
  if (r(/(液冷.*(数据中心|服务器)|数据中心液冷)/i, text)) return ["AIDC基础设施", "温控与液冷", "液冷系统"];
  return null;
}

const targets = scan.stocks.filter((item) => !byCode.has(item.code));
const audits = []; const additions = [];
let cursor = 0;
const workers = Array.from({ length: 8 }, async () => {
  while (cursor < targets.length) {
    const item = targets[cursor++];
    const info = await fetchBusiness(item.code);
    if (!info?.business || !info.name) { audits.push({ ...item, status: "skipped", reason: "未取得可用公开主营资料" }); continue; }
    const match = classify(info.business);
    if (!match) { audits.push({ ...item, name: info.name, status: "skipped", reason: "主营资料无法精确映射至现有三级目录" }); continue; }
    additions.push({ ...item, name: info.name, business: info.business, match });
    audits.push({ ...item, name: info.name, status: "classified", classification: match });
  }
});
await Promise.all(workers);
for (const item of additions) {
  const [primary, secondary, tertiary] = item.match;
  if (byCode.has(item.code)) continue;
  data.stocks.push({
    code: item.code, name: item.name, primary_sector: primary,
    classifications: [{ primary_sector: primary, secondary_sector: secondary, tertiary_sectors: [tertiary], relevance_score: 0.8, source_refs: [source], verification_note: `2025-2026 年出现 ${item.limit_up_days} 个收盘涨停日；主营资料：${item.business.slice(0, 280)}。` }],
    product_tags: [tertiary, "2025-2026涨停扫描"],
    reason: item.business.slice(0, 520)
  });
  byCode.set(item.code, data.stocks.at(-1));
}
data.stocks.sort((a, b) => a.code.localeCompare(b.code));
await mkdir(path.dirname(auditFile), { recursive: true });
await writeFile(stockFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(auditFile, `${JSON.stringify({ generated_at: new Date().toISOString(), scanned_unique_stocks: scan.unique_stocks, existing_before_scan: scan.unique_stocks - targets.length, additions: additions.length, skipped: audits.length - additions.length, audits }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ targets: targets.length, additions: additions.length, skipped: audits.length - additions.length, totalStocks: data.stocks.length }, null, 2));
