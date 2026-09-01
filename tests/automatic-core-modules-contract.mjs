import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
const start = source.indexOf("const loadSystemMainline = async");
const end = source.indexOf("const clearAnalysisCache = async", start);
assert.ok(start >= 0 && end > start, "必须找到主线排名请求实现");
const rankingRequest = source.slice(start, end);
assert.match(rankingRequest, /params\.set\("include_core_modules",\s*"0"\)/, "首次请求必须先返回主线排名，不能被核心模块批量计算阻塞");
const rankingVisible = rankingRequest.indexOf("setSystemMainline(payload)");
const automaticRequest = rankingRequest.indexOf('automaticParams.set("include_core_modules", "1")');
assert.ok(rankingVisible >= 0 && automaticRequest > rankingVisible, "容量中军和题材龙头必须在排名展示后自动触发");
assert.match(rankingRequest, /setCapacityCoreResults[\s\S]*setLeaderResults/, "自动批量结果必须写回容量中军和题材龙头状态");
const automaticPayloadReady = rankingRequest.indexOf("const automaticPayload = await automaticResponse.json()");
const staleRequestGuard = rankingRequest.indexOf("dailyScanRequestRef.current !== requestId", automaticPayloadReady);
const enrichedMainlineVisible = rankingRequest.indexOf("setSystemMainline(automaticPayload)", automaticPayloadReady);
assert.ok(
  automaticPayloadReady >= 0 && staleRequestGuard > automaticPayloadReady && enrichedMainlineVisible > staleRequestGuard,
  "核心模块完成后必须在旧请求保护之后回写完整主线结果，避免中军池汇总停留在基础阶段的 0 值",
);

console.log("automatic core modules contract passed");
