import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/capacity-core/route.js", import.meta.url), "utf8");
assert.match(source, /kind: "daily_turnover_rate"/, "容量中军必须复用统一的真实历史换手率数据入口");
assert.match(source, /metadataFromHistoricalTurnover/, "容量中军必须用同日成交量、换手率和收盘价反推流通市值");
assert.doesNotMatch(source, /kind: "historical_market_cap"/, "容量中军不得调用当前股本估算的历史市值入口");
assert.doesNotMatch(source, /MIN_TOTAL_MARKET_CAP/, "真实历史总市值不可得时不得伪造100亿元总市值门槛");
console.log("capacity core real market-data contract passed");
