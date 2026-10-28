import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
let backfilled = 0;

for (const stock of data.stocks || []) {
  for (const classification of stock.classifications || []) {
    if (Number.isFinite(Number(classification.relevance_score))) continue;
    // Historical assignments without per-assignment evidence must not be
    // presented as core business.  0.60 means the existing assignment is
    // usable for grouping but still needs a business-source review.
    classification.relevance_score = 0.6;
    classification.source_refs = Array.from(new Set([
      ...(classification.source_refs || []),
      "historical assignment: relevance pending business review"
    ]));
    backfilled += 1;
  }
}

await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Backfilled ${backfilled} historical secondary assignments at 60% pending review.`);
