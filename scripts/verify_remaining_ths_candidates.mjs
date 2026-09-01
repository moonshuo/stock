import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const f10Ref = "同花顺F10:经营分析（2026-07-25复核）";
const decoder = new TextDecoder("gb18030");
const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://basic.10jqka.com.cn/" };

function clean(text) {
  return text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function businessEvidence(html) {
  const text = clean(html);
  const start = text.indexOf("主营业务：");
  const end = text.indexOf("经营范围：", Math.max(0, start));
  return text.slice(Math.max(0, start), end > start ? end : start + 1800).slice(0, 1800);
}
async function fetchEvidence(code) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://basic.10jqka.com.cn/${code}/operate.html`, { headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return businessEvidence(decoder.decode(await response.arrayBuffer()));
    } catch (error) {
      if (attempt === 2) return "";
    }
  }
  return "";
}
function setPath(cls, secondary, tertiary) {
  cls.secondary_sector = secondary;
  cls.tertiary_sectors = [tertiary];
}
function assess(cls, evidence) {
  const has = (pattern) => pattern.test(evidence);
  // 已由业务资料人工确认的归属不可被批量规则改写；批量复核仅补充分数和证据。
  const preservePath = (cls.source_refs || []).includes("业务资料核对");
  const mapPath = (secondary, tertiary) => { if (!preservePath) setPath(cls, secondary, tertiary); };
  const weak = () => ({ score: 0.1, note: "公开主营及产品资料未见与该方向直接对应的业务或收入；保留同花顺概念关联，按极低相关性处理。" });
  if (!evidence) return { score: 0.1, note: "同花顺F10经营页未成功取得可核验主营资料；暂保留概念关联，按极低相关性处理。" };
  if (cls.primary_sector === "半导体") {
    if (!has(/集成电路|芯片|半导体|晶圆|存储器|MCU|EDA|IGBT|碳化硅|氮化镓|电子级|光刻胶|封装|测试/)) return weak();
    if (has(/分销|供应链协同|设计链服务/)) mapPath("半导体产业服务", "半导体分销与供应链服务");
    else if (has(/晶圆测试|芯片测试|集成电路测试|封装服务|封装测试/)) mapPath("封装测试", "半导体测试");
    else if (has(/半导体级氢氟酸|电子级化学品|湿电子/)) mapPath("半导体材料", "湿电子化学品");
    else if (has(/电子级硅烷|电子气体|特种气体/)) mapPath("半导体材料", "电子气体");
    else if (has(/存储器|存储芯片|闪存/)) mapPath("芯片设计", "存储芯片");
    else if (has(/碳化硅|氮化镓|IGBT|功率器件|功率芯片/)) mapPath("芯片设计", "功率芯片");
    else if (has(/设备|检测|量测|刻蚀|沉积|清洗/)) mapPath("半导体设备", "检测与量测设备");
    else mapPath("芯片设计", "SoC芯片");
    return { score: 0.7, note: `主营/产品资料出现直接半导体业务：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "AIDC基础设施") {
    if (!has(/数据中心|IDC|算力|云计算|云服务|服务器|机房|交换机|光模块|液冷/)) return weak();
    if (has(/液冷|精密空调|冷却|温控/)) setPath(cls, "温控与液冷", "液冷系统");
    else if (has(/交换机|路由器/)) setPath(cls, "高速网络与光互连", "交换机与路由器");
    else if (has(/光模块|光通信|高速光/)) setPath(cls, "高速网络与光互连", "高速光模块");
    else if (has(/服务器/)) setPath(cls, "服务器与算力硬件", "通用服务器");
    else setPath(cls, "IDC运营与算力服务", "算力租赁与云基础设施");
    return { score: 0.7, note: `主营/产品资料出现数据中心或算力基础设施业务：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "机器人") {
    if (!has(/机器人|自动化|伺服|减速器|工业控制|智能制造/)) return weak();
    if (has(/人形|协作/)) setPath(cls, "机器人本体与整机", "协作与人形机器人");
    else if (has(/伺服|控制器/)) setPath(cls, "运动控制与驱动", "控制器与运动控制");
    else if (has(/减速器/)) setPath(cls, "精密传动与执行部件", "减速器");
    else setPath(cls, "机器人本体与整机", "工业机器人");
    return { score: 0.7, note: `主营/产品资料出现机器人或自动化业务：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "AI应用") {
    if (!has(/人工智能|AI|大模型|智能体|AIGC|机器学习|算法|视觉|语音/)) return weak();
    if (has(/大模型|智能体/)) setPath(cls, "大模型与智能体", "AI智能体");
    else if (has(/视觉|图像|视频/)) setPath(cls, "AI视觉与语音", "计算机视觉应用");
    else if (has(/数据标注|语料|数据治理/)) setPath(cls, "数据与知识服务", "数据治理与标注");
    else setPath(cls, "行业AI应用", "AI工业与制造");
    return { score: 0.6, note: `主营/产品资料出现AI应用或算法产品：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "光伏产业链") {
    if (!has(/光伏|太阳能|硅片|组件|逆变器|电池片/)) return weak();
    if (has(/逆变器/)) setPath(cls, "逆变器与电站", "光伏逆变器");
    else if (has(/硅片|多晶硅/)) setPath(cls, "硅料与硅片", "硅片与拉晶");
    else setPath(cls, "电池与组件", "光伏组件");
    return { score: 0.7, note: `主营/产品资料出现光伏产品或服务：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "储能") {
    if (!has(/储能|电池|PCS|BMS|钠离子|锂离子/)) return weak();
    if (has(/PCS/)) setPath(cls, "储能变流与控制", "PCS");
    else if (has(/BMS/)) setPath(cls, "储能变流与控制", "储能EMS与BMS");
    else if (has(/液冷|消防/)) setPath(cls, "储能温控与安全", "液冷温控");
    else setPath(cls, "储能系统", "大型储能系统");
    return { score: 0.7, note: `主营/产品资料出现储能、电池或储能控制业务：${evidence.slice(0, 240)}。` };
  }
  if (cls.primary_sector === "电子元器件") {
    if (!has(/传感器|红外|MEMS|光学|声学/)) return weak();
    return { score: 0.7, note: `主营/产品资料出现传感器或相关元器件业务：${evidence.slice(0, 240)}。` };
  }
  return weak();
}

const targets = data.stocks.filter((stock) => (stock.classifications || []).some((cls) =>
  (cls.source_refs || []).some((ref) => ref.startsWith("同花顺:")) && !(cls.source_refs || []).includes(f10Ref)
));
const evidenceByCode = new Map();
let cursor = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < targets.length) {
    const stock = targets[cursor++];
    evidenceByCode.set(stock.code, await fetchEvidence(stock.code));
  }
});
await Promise.all(workers);

let reviewed = 0;
let direct = 0;
let weak = 0;
for (const stock of targets) {
  const evidence = evidenceByCode.get(stock.code) || "";
  for (const cls of stock.classifications || []) {
    if (!(cls.source_refs || []).some((ref) => ref.startsWith("同花顺:")) || (cls.source_refs || []).includes(f10Ref)) continue;
    const result = assess(cls, evidence);
    cls.relevance_score = result.score;
    cls.verification_note = result.note;
    cls.source_refs = [...new Set([...(cls.source_refs || []), f10Ref])];
    reviewed += 1;
    if (result.score >= 0.6) direct += 1; else weak += 1;
  }
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ stocks: targets.length, classifications: reviewed, direct, weak }, null, 2));
