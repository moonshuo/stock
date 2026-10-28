import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(page, /stock-kline-selection-band/, "日K与量柱必须共享同一个选中状态带");
assert.match(page, /点击K线或量柱查看当日数据/, "界面必须说明量柱也可直接选择当天数据");
assert.match(css, /\.stock-kline-bar\.selected \.stock-kline-volume/, "选中日K时必须显式高亮对应量柱");
assert.match(css, /\.stock-kline-bar\.selected \.stock-kline-selection-band/, "选中状态必须跨越K线区与量能区");
assert.match(page, /const StockKlineContext = createContext\(\{ openKline: null \}\)/, "所有股票名称必须复用统一的日K打开上下文");
assert.match(page, /function StockName\(\{ code, name, interactive = true \}\)/, "股票名称必须通过统一组件提供日K入口");
assert.match(page, /className="stock-kline-name-button"/, "股票名称必须渲染为可点击的日K入口");
assert.match(page, /<StockKlineContext\.Provider value=\{\{ openKline: setKlineStock \}\}>/, "全页面的股票名称都必须可打开同一个日K弹窗");
assert.match(page, /<DailyKlineModal stock=\{klineStock\} endDate=\{dailyScan\?\.date \|\| dailyScanDate\}/, "统一入口必须复用既有日K弹窗");
assert.match(css, /\.stock-kline-name-button:focus-visible/, "股票名称日K入口必须保留键盘焦点样式");

console.log("stock kline UI contract passed");
