import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const paths = {
  "000021": ["封装测试", "半导体测试"],
  "002049": ["芯片设计", "通用与专用芯片"],
  "002180": ["芯片设计", "通用与专用芯片"],
  "002371": ["半导体设备", "刻蚀设备"],
  "300183": ["芯片设计", "SoC芯片"],
  "300327": ["芯片设计", "模拟芯片"],
  "300458": ["芯片设计", "SoC芯片"],
  "300655": ["半导体材料", "光刻胶及配套材料"],
  "300666": ["半导体材料", "半导体靶材"],
  "300672": ["芯片设计", "AI芯片"],
  "600206": ["半导体材料", "半导体靶材"],
  "600584": ["封装测试", "集成电路封装"],
  "600877": ["芯片设计", "射频芯片"],
  "603068": ["芯片设计", "射频芯片"],
  "603893": ["芯片设计", "SoC芯片"],
  "688008": ["芯片设计", "通用与专用芯片"],
  "688018": ["芯片设计", "SoC芯片"],
  "688045": ["芯片设计", "模拟芯片"],
  "688049": ["芯片设计", "SoC芯片"],
  "688052": ["芯片设计", "模拟芯片"],
  "688099": ["芯片设计", "SoC芯片"],
  "688107": ["芯片设计", "通用与专用芯片"],
  "688120": ["半导体设备", "CMP设备"],
  "688123": ["芯片设计", "存储芯片"],
  "688153": ["芯片设计", "射频芯片"],
  "688173": ["芯片设计", "模拟芯片"],
  "688200": ["半导体设备", "检测与量测设备"],
  "688209": ["芯片设计", "模拟芯片"],
  "688213": ["芯片设计", "通用与专用芯片"],
  "688220": ["芯片设计", "射频芯片"],
  "688249": ["晶圆制造", "晶圆代工"],
  "688362": ["封装测试", "集成电路封装"],
  "688385": ["芯片设计", "通用与专用芯片"],
  "688458": ["芯片设计", "模拟芯片"],
  "688484": ["芯片设计", "模拟芯片"],
  "688521": ["芯片设计", "通用与专用芯片"],
  "688535": ["封装测试", "封装材料与载板"],
  "688593": ["芯片设计", "模拟芯片"],
  "688595": ["芯片设计", "SoC芯片"],
  "688608": ["芯片设计", "SoC芯片"]
};
let changed = 0;
for (const stock of data.stocks) {
  const target = paths[stock.code];
  if (!target) continue;
  for (const cls of stock.classifications || []) {
    if (cls.primary_sector !== "半导体" || cls.secondary_sector !== "芯片设计" || !cls.tertiary_sectors?.includes("SoC芯片")) continue;
    cls.secondary_sector = target[0];
    cls.tertiary_sectors = [target[1]];
    cls.verification_note = `按产品标签及主营说明重分类：${target[1]}。`;
    changed += 1;
  }
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`corrected ${changed} SoC classifications`);
