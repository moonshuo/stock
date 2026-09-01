import assert from "node:assert/strict";
import { relevanceAdjustedAverageChange, relevanceWeightForScope } from "../lib/relevance-adjusted-return.js";

const stocks = [
  { code: "000001", classifications: [{ primary_sector: "光伏产业链", secondary_sector: "多晶硅", tertiary_sectors: ["多晶硅"], relevance_score: .6 }] },
  { code: "000002", classifications: [{ primary_sector: "光伏产业链", secondary_sector: "多晶硅", tertiary_sectors: ["多晶硅"], relevance_score: 1 }] },
  { code: "000003", classifications: [{ primary_sector: "其他方向", secondary_sector: "其他", tertiary_sectors: ["其他"], relevance_score: 1 }] },
];
const quotes = {
  "000001": { changePct: 10 },
  "000002": { changePct: 2 },
  "000003": { changePct: 8 },
};
const scope = { primary: "光伏产业链", secondary: "多晶硅", tertiary: "多晶硅" };

assert.equal(relevanceWeightForScope(stocks[0], scope), .6);
assert.equal(relevanceAdjustedAverageChange(stocks.slice(0, 2), quotes, scope), 4);
assert.equal(relevanceAdjustedAverageChange(stocks, quotes, scope), 4);
assert.equal(relevanceAdjustedAverageChange([stocks[0]], quotes, scope), 6);
console.log("relevance-adjusted return contract passed");
