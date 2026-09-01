import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const unverifiedText = /尚未逐家核验主营收入与产品|尚待以公司收入与产品进一步验证/;
let removedClassifications = 0;
let removedStocks = 0;
const kept = [];
for (const stock of data.stocks) {
  const unverified = unverifiedText.test(stock.reason || "");
  const classifications = (stock.classifications || []).filter((cls) => {
    const refs = cls.source_refs || [];
    const fromThs = refs.some((ref) => ref.startsWith("同花顺:"));
    const candidateOnly = fromThs || refs.includes("东方财富:概念候选（低相关性）");
    const weakThs = fromThs && Number(cls.relevance_score || 0) <= 0.1;
    const unverifiedCandidate = unverified && candidateOnly;
    if (weakThs || unverifiedCandidate) {
      removedClassifications += 1;
      return false;
    }
    return true;
  });
  if (!classifications.length) {
    removedStocks += 1;
    continue;
  }
  stock.classifications = classifications;
  kept.push(stock);
}
data.stocks = kept;
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ removedClassifications, removedStocks, remainingStocks: data.stocks.length }, null, 2));
