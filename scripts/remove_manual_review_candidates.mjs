import { readFile, writeFile } from "fs/promises";
import path from "path";

const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
let removedClassifications = 0;
let removedStocks = 0;
data.stocks = data.stocks.flatMap((stock) => {
  const classifications = (stock.classifications || []).filter((cls) => {
    const pending = (cls.source_refs || []).some((ref) => String(ref).includes("业务人工核对"))
      || String(cls.verification_note || "").includes("人工核对")
      || String(stock.reason || "").includes("业务人工核对");
    if (pending) removedClassifications += 1;
    return !pending;
  });
  if (!classifications.length) {
    removedStocks += 1;
    return [];
  }
  stock.classifications = classifications;
  return [stock];
});
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ removedClassifications, removedStocks, remainingStocks: data.stocks.length }, null, 2));
