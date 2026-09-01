import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const additions = {
  "688037": [
    ["光刻及涂胶显影设备", "主营前道涂胶显影设备，产品包括涂胶显影设备与相关单片式工艺设备。"],
    ["清洗设备", "主营前道化学清洗、物理清洗等半导体清洗设备。"]
  ],
  "688630": [["光刻及涂胶显影设备", "主营泛半导体直写光刻设备及高端直接成像设备。"]],
  "002371": [
    ["薄膜沉积设备", "前道设备平台覆盖薄膜沉积设备。"],
    ["清洗设备", "前道设备平台覆盖清洗工艺设备。"],
    ["离子注入设备", "前道设备平台覆盖离子注入设备。"]
  ],
  "688072": [["薄膜沉积设备", "主营PECVD、ALD、SACVD、HDPCVD等薄膜沉积设备。"]],
  "688012": [["薄膜沉积设备", "主营薄膜设备与MOCVD设备。"]],
  "688147": [["薄膜沉积设备", "主营原子层沉积及化学气相沉积等微纳薄膜沉积设备。"]],
  "688082": [
    ["光刻及涂胶显影设备", "产品包括涂胶显影Track设备及光刻胶固化设备。"],
    ["薄膜沉积设备", "产品包括PECVD等薄膜沉积设备。"],
    ["清洗设备", "主营清洗设备，为前道半导体工艺核心设备之一。"]
  ],
  "600641": [["离子注入设备", "半导体设备业务产品包括iStellar系列离子注入机。"]]
};
let added = 0;
for (const stock of data.stocks) {
  for (const [tertiary, note] of additions[stock.code] || []) {
    const exists = (stock.classifications || []).some((cls) => cls.primary_sector === "半导体" && cls.secondary_sector === "半导体设备" && (cls.tertiary_sectors || []).includes(tertiary));
    if (exists) continue;
    stock.classifications.push({
      primary_sector: "半导体",
      secondary_sector: "半导体设备",
      tertiary_sectors: [tertiary],
      relevance_score: 1,
      source_refs: ["业务资料核对"],
      verification_note: note
    });
    added += 1;
  }
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`added ${added} direct equipment classifications`);
