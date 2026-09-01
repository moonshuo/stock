import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const replacements = new Map([
  ["AI应用|AI软件与平台|行业AI应用", ["AI应用", "行业AI应用", "AI工业与制造"]],
  ["AI应用|AI软件与平台|AI智能体", ["AI应用", "大模型与智能体", "AI智能体"]],
  ["AI应用|AI软件与平台|大模型与多模态", ["AI应用", "大模型与智能体", "通用大模型"]],
  ["AI应用|AI软件与平台|数据语料与标注", ["AI应用", "数据与知识服务", "数据治理与标注"]],
  ["AI应用|AI终端与硬件|AI PC与智能终端", ["AI应用", "AI视觉与语音", "AIoT与边缘智能"]],
  ["AI应用|AI终端与硬件|AI手机与智能终端", ["AI应用", "AI视觉与语音", "AIoT与边缘智能"]],
  ["AI应用|AI软件与平台|视觉AI应用", ["AI应用", "AI内容与营销", "AIGC图文与视频"]],
  ["光伏产业链|光伏组件与电池|光伏组件", ["光伏产业链", "电池与组件", "光伏组件"]],
  ["储能|储能系统|电化学储能系统", ["储能", "储能系统", "大型储能系统"]]
]);
let fixed = 0;
for (const stock of data.stocks) {
  for (const cls of stock.classifications || []) {
    const key = `${cls.primary_sector}|${cls.secondary_sector}|${cls.tertiary_sectors?.[0] || ""}`;
    const replacement = replacements.get(key);
    if (!replacement || !(cls.source_refs || []).some((ref) => ref.startsWith("同花顺:"))) continue;
    [cls.primary_sector, cls.secondary_sector, cls.tertiary_sectors] = [replacement[0], replacement[1], [replacement[2]]];
    fixed += 1;
  }
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`fixed ${fixed} 同花顺分类路径`);
