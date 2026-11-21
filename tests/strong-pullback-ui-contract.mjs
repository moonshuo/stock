import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

await access(new URL("../app/api/strong-pullback/route.js", import.meta.url));
const [page, css] = await Promise.all([
  readFile(new URL("../app/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

assert.match(page, /强势股缩量回调评分/);
assert.doesNotMatch(page, /disabled=\{!scan \|\| strongPullbackLoading\}/, "缩量回调评分不应依赖当日涨停扫描");
assert.match(page, /disabled=\{strongPullbackLoading\}/, "评分执行期间仍应阻止重复提交");
const pullbackPanelIndex = page.indexOf("{strongPullbackOpen && <StrongPullbackPanel");
const mainlinePanelIndex = page.indexOf("{scan && <SystemMainlinePanel");
assert.equal(pullbackPanelIndex, -1, "缩量回调评分不应继续以内嵌面板占用主页面纵向空间");
assert.ok(mainlinePanelIndex >= 0);
assert.match(page, /className="strong-pullback-popup-layer"/);
assert.match(page, /className="modal strong-pullback-modal" role="dialog" aria-modal="false"/);
assert.match(page, /<X size=\{15\} \/> 收起评分/);
assert.match(page, /event\.key === "Escape"/);
assert.match(page, /保存每日快照/);
assert.match(page, /查询原因/);
assert.match(page, /option value="sector_strength"/);
assert.match(page, /green_filter/);
assert.match(page, /完整度/);
assert.match(page, /主要加分/);
assert.match(page, /主要扣分/);
assert.match(css, /\.strong-pullback-table/);
assert.match(css, /@media \(max-width: 720px\)/);

console.log("strong pullback UI contract passed");
