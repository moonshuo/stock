import assert from "node:assert/strict";
import { normalizedRelevanceScore, relevanceAdjustedCoreScore } from "../lib/core-relevance-score.js";

assert.equal(relevanceAdjustedCoreScore(100, .8), 80, "原始100分、关联度0.8时最终分必须为80");
assert.equal(relevanceAdjustedCoreScore(80, .8), 64, "容量中军80分制也必须乘以关联度");
assert.equal(relevanceAdjustedCoreScore(65, 1), 65, "关联度1不得改变原始评分");
assert.equal(relevanceAdjustedCoreScore(null, .8), null, "缺失的原始分必须保持缺失，不能被误算为0分");
assert.equal(relevanceAdjustedCoreScore(Number.NaN, .8), null);
assert.equal(normalizedRelevanceScore(1.2), 1);
assert.equal(normalizedRelevanceScore(-.1), 0);

console.log("core relevance score contract passed");
