import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
let merged = 0;
for (const stock of data.stocks) {
  const byKey = new Map();
  for (const cls of stock.classifications || []) {
    const key = `${cls.primary_sector}|${cls.secondary_sector}|${(cls.tertiary_sectors || []).join("|")}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, cls);
      continue;
    }
    existing.relevance_score = Math.max(Number(existing.relevance_score || 0), Number(cls.relevance_score || 0));
    existing.source_refs = [...new Set([...(existing.source_refs || []), ...(cls.source_refs || [])])];
    if ((!existing.verification_note || Number(cls.relevance_score || 0) >= Number(existing.relevance_score || 0)) && cls.verification_note) {
      existing.verification_note = cls.verification_note;
    }
    merged += 1;
  }
  stock.classifications = [...byKey.values()];
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`merged ${merged} duplicate classifications`);
