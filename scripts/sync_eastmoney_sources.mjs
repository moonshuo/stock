import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const candidateFile = path.join(process.cwd(), "data", "source_candidates_eastmoney.json");
const data = JSON.parse(await readFile(file, "utf8"));
const themes = [
  { id: "BK0917", label: "东方财富:半导体概念", primary: "半导体" },
  { id: "BK0952", label: "东方财富:第三代半导体", primary: "半导体" },
  { id: "BK0905", label: "东方财富:传感器", primary: "电子元器件" }
];
const headers = { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" };
const members = new Map();
const memberNames = new Map();
const candidates = [];
for (const theme of themes) {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.searchParams.set("pn", "1"); url.searchParams.set("pz", "1000"); url.searchParams.set("po", "1");
  url.searchParams.set("np", "1"); url.searchParams.set("fltt", "2"); url.searchParams.set("fid", "f3");
  url.searchParams.set("fs", `b:${theme.id}`); url.searchParams.set("fields", "f12,f14");
  const payload = await (await fetch(url, { headers })).json();
  for (const item of payload?.data?.diff || []) {
    const code = String(item.f12 || "").padStart(6, "0");
    if (!members.has(code)) members.set(code, []);
    members.get(code).push(theme);
    memberNames.set(code, String(item.f14 || ""));
  }
}
for (const stock of data.stocks || []) {
  const sources = members.get(stock.code) || [];
  if (!sources.length) continue;
  for (const cls of stock.classifications || []) {
    const primary = cls.primary_sector || stock.primary_sector;
    const matched = sources.filter((source) => source.primary === primary);
    if (!matched.length) continue;
    cls.source_refs = Array.from(new Set([...(cls.source_refs || []), ...matched.map((source) => source.label)]));
    // 单一公开概念源只能证明市场关联：最低提高至 0.60，不覆盖已由主营判断得到的更高分。
    cls.relevance_score = Math.max(Number(cls.relevance_score || 0), 0.6);
  }
}
for (const [code, sources] of members) {
  if (!data.stocks.some((stock) => stock.code === code)) candidates.push({ code, name: memberNames.get(code) || "", themes: sources.map((source) => source.label) });
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(candidateFile, `${JSON.stringify({ generated_at: new Date().toISOString(), source: "东方财富公开概念板块", candidates }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ syncedThemes: themes.map((theme) => theme.label), matchedStocks: data.stocks.filter((stock) => members.has(stock.code)).length, unclassifiedCandidates: candidates.length, candidates }, null, 2));
