import assert from "node:assert/strict";
import { GET } from "../app/api/stock-kline/route.js";
import { getMarketData } from "../lib/market-data.js";

const response = await GET(new Request("http://localhost/api/stock-kline?code=003006&end_date=2026-09-24&days=10"));
const payload = await response.json();

assert.equal(response.status, 200, `日K接口失败：${payload.error || "unknown error"}`);
assert.equal(payload.code, "003006");
assert.equal(payload.end_date, "2026-09-24");
assert.equal(payload.bars.length, 10, "本地归档完整时必须返回请求的10个交易日");
assert.equal(payload.bars.at(-1).date, "2026-09-24", "日K终点不得越过请求日期");
assert.ok(payload.bars.every((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close) && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close)), "每根日K必须具有一致的OHLC数据");
assert.equal(payload.bars.at(-1).turnover_rate, 6.371, "换手率必须读取同一交易日的真实日线记录");
assert.ok(payload.bars.at(-1).free_float_market_cap > 0, "流通市值必须由同日真实日线成交量、收盘价和换手率反推");
assert.ok(payload.bars.every((bar) => bar.volume_source === "historical_daily_turnover_rate" && bar.volume > 0 && bar.amount > 0), "日K页面不得使用单位可能不一致的分钟量额；每根K线必须补齐真实日线量额");

const volumeResponse = await GET(new Request("http://localhost/api/stock-kline?code=603156&end_date=2026-09-24&days=10"));
const volumePayload = await volumeResponse.json();
assert.equal(volumeResponse.status, 200, `养元饮品日K接口失败：${volumePayload.error || "unknown error"}`);
assert.equal(volumePayload.bars.at(-1).volume, 4_744_223, "量柱必须优先使用同日真实日线成交量，而不是单位可能不一致的5分钟归档");
assert.equal(volumePayload.bars.at(-1).volume_source, "historical_daily_turnover_rate");

// 永冠新材早期本地分钟归档曾有近零量柱；日K页面必须补抓同日完整日线，
// 不能因为OHLC存在就把不完整的分钟成交量当作有效成交量展示。
const completeResponse = await GET(new Request("http://localhost/api/stock-kline?code=603681&end_date=2026-09-24&days=60"));
const completePayload = await completeResponse.json();
assert.equal(completeResponse.status, 200, `永冠新材日K接口失败：${completePayload.error || "unknown error"}`);
assert.equal(completePayload.bars.length, 60, "完整日K必须覆盖请求的60个交易日");
assert.ok(completePayload.bars.every((bar) => bar.volume_source === "historical_daily_turnover_rate" && bar.volume > 0 && bar.amount > 0), "早期量柱缺失时必须经全局市场数据入口补齐，不得回退为分钟归档量额");
assert.ok(completePayload.bars[0].volume > 1_000_000, "早期量柱不应以分钟归档的近零数值展示");

// 盾安环境的本地分钟归档曾使早期日K开盘价错误。每根蜡烛必须采用
// 双源核验的同日 OHLC，而不是仅校验量、额后继续沿用分钟聚合价格。
const ohlcResponse = await GET(new Request("http://localhost/api/stock-kline?code=002011&end_date=2026-09-26&days=60"));
const ohlcPayload = await ohlcResponse.json();
assert.equal(ohlcResponse.status, 200, `盾安环境日K接口失败：${ohlcPayload.error || "unknown error"}`);
assert.equal(ohlcPayload.bars.length, 60);
assert.ok(ohlcPayload.bars.every((bar) => bar.price_source === "two_source_verified_daily_quote"), "日K价格必须来自双源核验日线");
for (const bar of ohlcPayload.bars) {
  const verified = await getMarketData({ kind: "daily_quote", date: bar.date, code: "002011" });
  for (const field of ["open", "high", "low", "close", "pre_close"]) assert.ok(Math.abs(Number(bar[field]) - Number(verified[field])) <= .000001, `${bar.date} 的${field}必须与双源核验日线一致`);
}

const badResponse = await GET(new Request("http://localhost/api/stock-kline?code=3006&end_date=2026-09-24&days=10"));
assert.equal(badResponse.status, 400, "日K接口必须校验股票代码");
console.log("stock kline contract passed");
