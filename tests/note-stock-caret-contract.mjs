import assert from "node:assert/strict";
import { canonicalNoteCaretOffset, visibleNoteCaretOffset } from "../app/lib/noteCaret.js";

const replaceStockCodes = (value) => value.replace(/\b600519\b/g, "贵州茅台");

const rows = ["第一行", "600519"];
const rawContent = rows.join("\n");
const caretAfterCode = canonicalNoteCaretOffset(rows, 1, 6);
const caretAfterName = replaceStockCodes(rawContent.slice(0, caretAfterCode)).length;

assert.equal(caretAfterCode, rawContent.length, "第二行末尾的光标偏移必须包含行间换行");
assert.equal(caretAfterName, replaceStockCodes(rawContent).length, "股票代码替换后光标应位于股票名称末尾");

const headingRows = ["观察", "## 600519"];
const headingContent = headingRows.join("\n");
const headingCaretAfterCode = canonicalNoteCaretOffset(headingRows, 1, 6, 2);
assert.equal(
  headingCaretAfterCode,
  headingContent.length,
  "标题行光标偏移必须包含隐藏的 Markdown 标题前缀",
);
assert.equal(
  visibleNoteCaretOffset(replaceStockCodes(headingContent.slice(0, headingCaretAfterCode))),
  "观察\n贵州茅台".length,
  "恢复 DOM 光标前必须移除标题行的隐藏 Markdown 前缀",
);

console.log("note stock caret contract passed");
