import assert from "node:assert/strict";
import { stockBoardLabel } from "../app/lib/stockBoard.js";

for (const code of ["300750", "301236"]) {
  assert.equal(stockBoardLabel(code), "创业板", `${code} 必须标识为创业板`);
}

for (const code of ["688981", "689009"]) {
  assert.equal(stockBoardLabel(code), "科创板", `${code} 必须标识为科创板`);
}

for (const code of ["000001", "600519", "601318", "603986", "605499", "002594"]) {
  assert.equal(stockBoardLabel(code), "主板", `${code} 必须标识为主板`);
}

for (const code of ["430014", "830771", "920001"]) {
  assert.equal(stockBoardLabel(code), "", `${code} 不应被误标为主板`);
}

console.log("stock board label contract passed");
