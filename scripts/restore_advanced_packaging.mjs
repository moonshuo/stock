import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const restored = {
  "002156": { score: 1, note: "具备FC、SiP、高性能计算及GPU等先进封装能力；保留原半导体测试归属，同时新增先进封装归属。" },
  "002185": { score: 1, note: "产品覆盖FC、SiP、WLP、TSV、Bumping、FO、PLP及2.5D/3D封装；保留原半导体测试归属，同时新增先进封装归属。" },
  "600584": { score: 1, note: "产品覆盖晶圆级、SiP、FC、2.5D/3D及Chiplet封装；按先进封装核心企业归属。" },
  "603005": { score: 0.9, note: "主营晶圆级、Fan-out芯片级、TSV及MEMS封装，属于特色先进封装。" },
  "688362": { score: 0.9, note: "提供FC、SiP、Bumping、WLP等中高端集成电路封装测试解决方案。" },
  "688403": { score: 0.9, note: "主营显示驱动芯片先进封装测试服务。" }
};
let added = 0;
for (const stock of data.stocks) {
  const entry = restored[stock.code];
  if (!entry) continue;
  const exists = (stock.classifications || []).some((cls) => cls.primary_sector === "半导体" && cls.secondary_sector === "封装测试" && (cls.tertiary_sectors || []).includes("先进封装"));
  if (exists) continue;
  stock.classifications.push({
    primary_sector: "半导体",
    secondary_sector: "封装测试",
    tertiary_sectors: ["先进封装"],
    relevance_score: entry.score,
    source_refs: ["业务资料核对", "先进封装产品资料核对"],
    verification_note: entry.note
  });
  added += 1;
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`restored ${added} advanced-packaging classifications`);
