import assert from "node:assert/strict";
import { sortStocksByScopeRelevance } from "../app/lib/relevanceSorting.js";

const scope = { primary: "通信设备", secondary: "通信模组", tertiary: "车载通信模组" };
const stocks = [
  { code: "000001", classifications: [{ primary_sector: "通信设备", secondary_sector: "通信模组", tertiary_sectors: ["车载通信模组"], relevance_score: .6 }] },
  { code: "000002", classifications: [{ primary_sector: "通信设备", secondary_sector: "通信模组", tertiary_sectors: ["车载通信模组"], relevance_score: 1 }] },
  { code: "000003", classifications: [{ primary_sector: "通信设备", secondary_sector: "通信模组", tertiary_sectors: ["物联网模组"], relevance_score: 1 }, { primary_sector: "通信设备", secondary_sector: "通信模组", tertiary_sectors: ["车载通信模组"], relevance_score: .8 }] },
];

assert.deepEqual(
  sortStocksByScopeRelevance(stocks, scope, (stock) => ({ "000001": 12, "000002": 2, "000003": 8 })[stock.code]).map((stock) => stock.code),
  ["000002", "000003", "000001"],
  "三级股票列表必须按当前三级路径的关联度排序，而非涨幅或其他三级归属的关联度",
);
console.log("tertiary relevance sorting contract passed");
