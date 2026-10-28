import assert from "node:assert/strict";
import { isThirdBoardStockCode } from "../app/lib/sectorSystem.js";
import { isUsableMarketResearchBatch } from "../app/lib/marketResearchBatch.js";

for (const code of ["400002", "420079", "430014", "830771", "871135"]) {
  assert.equal(isThirdBoardStockCode(code), true, `${code} 必须从全市场股票询问中排除`);
}

for (const code of ["000001", "300750", "600519", "688981", "920001"]) {
  assert.equal(isThirdBoardStockCode(code), false, `${code} 不应被当作三板股票排除`);
}

assert.equal(
  isUsableMarketResearchBatch([{ code: "400002" }, { code: "000001" }]),
  false,
  "含三板股票的历史锁定批次必须整体作废",
);
assert.equal(isUsableMarketResearchBatch([{ code: "000001" }]), true);

console.log("stock universe third-board exclusion contract passed");
