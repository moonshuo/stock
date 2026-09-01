import assert from "node:assert/strict";
import { countVisibleNoteCharacters } from "../app/lib/noteMetrics.js";

assert.equal(countVisibleNoteCharacters(""), 0);
assert.equal(countVisibleNoteCharacters("你好 世界\nA股"), 6, "空格和换行不应计入正文可见字数");
assert.equal(countVisibleNoteCharacters("## 市场主线\n观察"), 6, "标题格式井号不应计入字数");
assert.equal(countVisibleNoteCharacters("关注 #贵州茅台# 和 #600519#"), 13, "股票标记的隐藏井号不应计入字数");
assert.equal(countVisibleNoteCharacters("强势😀"), 3, "代理对组成的单个字符不应被重复计数");

console.log("note character count contract passed");
