import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
assert.match(page, /isMainBoardStock/, "股票列表必须使用统一的主板识别规则");
assert.match(page, /mainBoardOnly/, "股票列表必须保存主板筛选状态");
assert.match(page, /仅主板/, "股票列表必须提供仅主板筛选入口");
assert.match(page, /主板筛选后暂无股票/, "主板筛选为空时必须说明原因");
console.log("stock board filter UI contract passed");
