import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const root = process.cwd();
const [taxonomy, stockMap] = await Promise.all([
  readFile(path.join(root, "data", "sector_taxonomy.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "stock_sector_map.json"), "utf8").then(JSON.parse)
]);

const complete = validateSectorData(taxonomy, stockMap, []);
assert.equal(complete.ok, true, complete.errors.join("\n"));

const missingScore = structuredClone(stockMap);
delete missingScore.stocks[0].classifications[0].relevance_score;
const missingScoreValidation = validateSectorData(taxonomy, missingScore, []);
assert.equal(
  missingScoreValidation.errors.some((error) => error.includes("缺少 relevance_score")),
  true,
  "a secondary assignment without relevance_score must be rejected",
);

console.log(`relevance contract passed: ${stockMap.stocks.length} stocks`);
