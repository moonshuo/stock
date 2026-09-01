import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const f10 = "同花顺F10:经营分析（2026-07-25复核）";
const verified = {
  "000333": { score: 0.1, reason: "主营智能家居、工业技术、楼宇科技、机器人与自动化等；本目录的MCU归属仅来自同花顺概念，未见芯片设计或销售构成，保留为极低相关概念股。" },
  "000651": { score: 0.1, reason: "主营消费电器及配件；同花顺将其列入第三代半导体及MCU概念，但公开主营资料未显示相关产品或收入，保留为极低相关概念股。", secondary: "芯片设计", tertiary: "SoC芯片" },
  "001229": { score: 0.1, reason: "主营分布式视听和多模态AI视觉解决方案；芯片概念未见自研或销售芯片主营证据，保留为极低相关概念股。", secondary: "芯片设计", tertiary: "SoC芯片" },
  "001287": { score: 0.8, reason: "主营电子元器件分销、设计链服务与供应链协同，覆盖存储器、处理器、模拟器件及射频无线连接；按半导体分销与供应链服务归属。", secondary: "半导体产业服务", tertiary: "半导体分销与供应链服务" },
  "002023": { score: 0.8, reason: "主营含高性能第二代/第三代集成电路设计与制造，属于直接半导体业务；按功率芯片方向归属。", secondary: "芯片设计", tertiary: "功率芯片" },
  "002077": { score: 0.8, reason: "主营集成电路测试及相关服务，公开运营数据披露芯片及晶圆测试销量；按半导体测试归属。", secondary: "封装测试", tertiary: "半导体测试" },
  "002180": { score: 0.8, reason: "主营集成电路芯片及打印耗材，产品包括工控安全、消费级、新能源和汽车电子芯片；按SoC芯片归属。", secondary: "芯片设计", tertiary: "SoC芯片" },
  "002277": { score: 0.1, reason: "主营百货零售；第三代半导体概念未见主营产品或收入依据，保留为极低相关概念股。", secondary: "芯片设计", tertiary: "功率芯片" },
  "002407": { score: 0.8, reason: "主营电子信息材料，产品包含半导体级氢氟酸、电子级硅烷及其他电子级化学品；按湿电子化学品归属。", secondary: "半导体材料", tertiary: "湿电子化学品" },
  "300183": { score: 0.9, reason: "主营物联网芯片、软件、终端与系统，产品包含多系列MCU、BMS MCU、射频前端及模拟前端芯片；按SoC芯片归属。", secondary: "芯片设计", tertiary: "SoC芯片" }
};
let count = 0;
for (const stock of data.stocks) {
  const rule = verified[stock.code];
  if (!rule) continue;
  for (const cls of stock.classifications || []) {
    if (cls.primary_sector !== "半导体") continue;
    cls.secondary_sector = rule.secondary || cls.secondary_sector;
    cls.tertiary_sectors = [rule.tertiary || cls.tertiary_sectors[0]];
    cls.relevance_score = rule.score;
    cls.source_refs = [...new Set([...(cls.source_refs || []), f10])];
    count += 1;
  }
  stock.reason = rule.reason;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`verified ${count} classifications`);
