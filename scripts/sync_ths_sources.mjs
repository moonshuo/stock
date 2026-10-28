import { readFile, writeFile } from "fs/promises";
import path from "path";

const cwd = process.cwd();
const stockFile = path.join(cwd, "data", "stock_sector_map.json");
const candidateFile = path.join(cwd, "data", "source_candidates_ths.json");
const stocksData = JSON.parse(await readFile(stockFile, "utf8"));

// 只选择本库已经建立一级主线的同花顺公开概念。defaultClassification 是
// 概念成分股尚未逐家核验主营前的临时、低相关性归属，后续人工复核会覆盖它。
const themes = [
  { code: "301085", name: "芯片概念", primary: "半导体", secondary: "半导体产业服务", tertiary: "半导体设备零部件" },
  { code: "308700", name: "第三代半导体", primary: "半导体", secondary: "半导体材料", tertiary: "硅片材料" },
  { code: "307940", name: "存储芯片", primary: "半导体", secondary: "芯片设计", tertiary: "存储芯片" },
  { code: "308300", name: "MCU芯片", primary: "半导体", secondary: "芯片设计", tertiary: "SoC芯片" },
  { code: "308725", name: "汽车芯片", primary: "半导体", secondary: "芯片设计", tertiary: "SoC芯片" },
  { code: "301016", name: "传感器", primary: "电子元器件", secondary: "传感器", tertiary: "工业传感器" },
  { code: "308642", name: "数据中心(AIDC)", primary: "AIDC基础设施", secondary: "IDC运营与算力服务", tertiary: "第三方IDC" },
  { code: "308828", name: "东数西算(算力)", primary: "AIDC基础设施", secondary: "IDC运营与算力服务", tertiary: "算力租赁与云基础设施" },
  { code: "309068", name: "算力租赁", primary: "AIDC基础设施", secondary: "IDC运营与算力服务", tertiary: "算力租赁与云基础设施" },
  { code: "300816", name: "机器人概念", primary: "机器人", secondary: "机器人本体与整机", tertiary: "工业机器人" },
  { code: "309119", name: "人形机器人", primary: "机器人", secondary: "机器人本体与整机", tertiary: "协作与人形机器人" },
  { code: "309264", name: "AI应用", primary: "AI应用", secondary: "行业AI应用", tertiary: "AI工业与制造" },
  { code: "309183", name: "AI智能体", primary: "AI应用", secondary: "大模型与智能体", tertiary: "AI智能体" },
  { code: "309104", name: "多模态AI", primary: "AI应用", secondary: "大模型与智能体", tertiary: "通用大模型" },
  { code: "309126", name: "AI语料", primary: "AI应用", secondary: "数据与知识服务", tertiary: "数据治理与标注" },
  { code: "309121", name: "AI PC", primary: "AI应用", secondary: "AI视觉与语音", tertiary: "AIoT与边缘智能" },
  { code: "309120", name: "AI手机", primary: "AI应用", secondary: "AI视觉与语音", tertiary: "AIoT与边缘智能" },
  { code: "309118", name: "AI视频", primary: "AI应用", secondary: "AI内容与营销", tertiary: "AIGC图文与视频" },
  { code: "309187", name: "中国AI 50", primary: "AI应用", secondary: "行业AI应用", tertiary: "AI工业与制造" },
  { code: "301079", name: "光伏概念", primary: "光伏产业链", secondary: "电池与组件", tertiary: "光伏组件" },
  { code: "306380", name: "储能", primary: "储能", secondary: "储能系统", tertiary: "大型储能系统" }
];

const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://q.10jqka.com.cn/gn/" };
const source = (theme) => `同花顺:${theme.name}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractMembers(html) {
  const matches = html.matchAll(/stockpage\.10jqka\.com\.cn\/(\d{6})\/[^>]*>\1<\/a><\/td>\s*<td><a[^>]*>([^<]+)<\/a>/g);
  return [...matches].map((match) => ({ code: match[1], name: match[2].trim() }));
}

async function fetchTheme(theme) {
  const base = `https://q.10jqka.com.cn/gn/detail/code/${theme.code}/`;
  const readHtml = async (url) => {
    const response = await fetch(url, { headers });
    // 同花顺概念页使用 GBK/GB18030；Response.text() 会按 UTF-8 解码并损坏中文名称。
    return new TextDecoder("gb18030").decode(await response.arrayBuffer());
  };
  const first = await readHtml(base);
  const pages = Number(first.match(/page_info">\s*1\/(\d+)/)?.[1] || 1);
  const members = new Map(extractMembers(first).map((row) => [row.code, row]));
  for (let page = 2; page <= pages; page += 1) {
    await delay(180);
    const url = `${base}field/199112/order/desc/page/${page}/`;
    const html = await readHtml(url);
    const rows = extractMembers(html);
    // 页面展示的总页数可能是过期缓存；空页即为实际末页，避免无效请求。
    if (!rows.length) break;
    for (const row of rows) members.set(row.code, row);
  }
  console.log(`${theme.name}: ${members.size} stocks / ${pages} pages`);
  return [...members.values()];
}

const memberships = new Map();
for (const theme of themes) {
  for (const member of await fetchTheme(theme)) {
    if (!memberships.has(member.code)) memberships.set(member.code, { name: member.name, themes: [] });
    memberships.get(member.code).themes.push(theme);
  }
}

const byCode = new Map(stocksData.stocks.map((stock) => [stock.code, stock]));
const candidates = [];
let matched = 0;
let added = 0;
for (const [code, membership] of memberships) {
  const refs = membership.themes.map(source);
  const stock = byCode.get(code);
  if (stock) {
    matched += 1;
    if (stock.name.includes("�") && membership.name) stock.name = membership.name;
    for (const cls of stock.classifications || []) {
      const applicable = membership.themes.filter((theme) => theme.primary === cls.primary_sector);
      if (!applicable.length) continue;
      cls.source_refs = [...new Set([...(cls.source_refs || []), ...applicable.map(source)])];
      // 双源/同花顺公开概念仅证明市场关联，不能覆盖既有业务核验的高低分判断。
      cls.relevance_score = Math.max(Number(cls.relevance_score || 0), 0.3);
    }
    continue;
  }
  // 一只股票可能同时命中多个概念；按每个一级主线保留一条低相关候选归属。
  const classifications = [];
  for (const theme of membership.themes) {
    if (classifications.some((cls) => cls.primary_sector === theme.primary)) continue;
    classifications.push({
      primary_sector: theme.primary,
      secondary_sector: theme.secondary,
      tertiary_sectors: [theme.tertiary],
      relevance_score: 0.3,
      source_refs: membership.themes.filter((item) => item.primary === theme.primary).map(source)
    });
  }
  const first = classifications[0];
  stocksData.stocks.push({
    code,
    name: membership.name,
    primary_sector: first.primary_sector,
    classifications,
    product_tags: ["同花顺概念成分股"],
    reason: `同花顺公开概念成分股：${refs.join("、")}。该归属为市场概念关联的低相关性候选，尚未逐家核验主营收入与产品，后续以业务资料复核为准。`
  });
  added += 1;
  candidates.push({ code, name: membership.name, themes: refs, relevance_score: 0.3, status: "已低相关性入库，待业务复核" });
}

stocksData.stocks.sort((a, b) => a.code.localeCompare(b.code));
await writeFile(stockFile, `${JSON.stringify(stocksData, null, 2)}\n`, "utf8");
await writeFile(candidateFile, `${JSON.stringify({ generated_at: new Date().toISOString(), source: "同花顺公开概念板块", themes: themes.map(({ code, name }) => ({ code, name })), candidates }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ themes: themes.length, uniqueMembers: memberships.size, matched, added, totalStocks: stocksData.stocks.length }, null, 2));
