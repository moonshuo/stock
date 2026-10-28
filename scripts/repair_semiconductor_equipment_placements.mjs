import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const corrections = {
  "003043": [["半导体产业服务", "半导体设备零部件", "真空腔体等精密金属结构件配套半导体设备。"]],
  "300054": [["半导体材料", "CMP材料", "主营CMP抛光垫、抛光液等CMP材料。"]],
  "600641": [["半导体设备", "离子注入设备", "凯世通业务提供离子注入机。"]],
  "688012": [
    ["半导体设备", "刻蚀设备", "主营干法刻蚀设备。"],
    ["半导体设备", "薄膜沉积设备", "主营MOCVD等薄膜沉积设备。"]
  ],
  "688729": [
    ["半导体设备", "刻蚀设备", "主营干法刻蚀设备。"],
    ["半导体设备", "薄膜沉积设备", "主营薄膜沉积设备。"]
  ]
};
const wrongDetection = new Set(["003043", "300054", "600641", "688012", "688037", "688072", "688082", "688147", "688630", "688729"]);
let added = 0;
let removed = 0;
for (const stock of data.stocks) {
  for (const [secondary, tertiary, note] of corrections[stock.code] || []) {
    const exists = (stock.classifications || []).some((cls) => cls.primary_sector === "半导体" && cls.secondary_sector === secondary && (cls.tertiary_sectors || []).includes(tertiary));
    if (exists) continue;
    stock.classifications.push({
      primary_sector: "半导体",
      secondary_sector: secondary,
      tertiary_sectors: [tertiary],
      relevance_score: 1,
      source_refs: ["业务资料核对"],
      verification_note: note
    });
    added += 1;
  }
  if (!wrongDetection.has(stock.code)) continue;
  const before = stock.classifications.length;
  stock.classifications = stock.classifications.filter((cls) => !(cls.primary_sector === "半导体" && cls.secondary_sector === "半导体设备" && (cls.tertiary_sectors || []).includes("检测与量测设备")));
  removed += before - stock.classifications.length;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ addedCorrectClassifications: added, removedWrongClassifications: removed }, null, 2));
