import assert from "node:assert/strict";
import { normalizeNumericHeadingPrefixes } from "../app/lib/noteHeadingSyntax.js";

assert.equal(normalizeNumericHeadingPrefixes("#1"), "# ", "行首 #1 必须立即转换为一级标题前缀");
assert.equal(normalizeNumericHeadingPrefixes("#3 市场行情"), "### 市场行情", "#3 必须转换为三级标题");
assert.equal(normalizeNumericHeadingPrefixes("#6 风险\n普通文本"), "###### 风险\n普通文本", "多行内容只转换行首数字标题语法");
assert.equal(normalizeNumericHeadingPrefixes("#12 不是标题\n文本 #2"), "#12 不是标题\n文本 #2", "非 #1 到 #6 的行首完整前缀不能误转换");

console.log("note heading syntax contract passed");
