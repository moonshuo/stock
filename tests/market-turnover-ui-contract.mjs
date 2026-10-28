import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, css] = await Promise.all([
  readFile(new URL("../app/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

assert.match(page, /api\/market-turnover-history\?end_date=/, "市场环境必须读取全市场成交额历史接口");
assert.match(page, /function MarketTurnoverChart/, "市场环境必须包含成交额折线图组件");
assert.match(page, /function MarketEnvironmentModal/, "市场环境必须改为可停留查看的弹窗");
assert.match(page, /aria-haspopup="dialog"/, "市场环境入口必须明确为点击打开弹窗的按钮");
assert.match(page, /全市场成交额/, "图表必须明确标注成交额口径");
assert.match(page, /亿元/, "成交额必须按亿元展示");
assert.match(page, /topTertiaries/, "市场环境必须计算三级板块涨幅排名");
assert.match(page, /tertiarySectorIndex/, "三级板块排名必须来自三级分类索引");
assert.match(page, /slice\(0, 5\)/, "三级板块必须展示涨幅前 5 名");
assert.match(page, /二级板块/, "市场环境必须提供二级板块选择");
assert.match(page, /三级板块/, "市场环境必须提供三级板块选择");
assert.match(page, /查看三级板块排序/, "当日涨幅计算完成后必须提供三级综合排序入口");
assert.match(page, /查看当天排序/, "当日涨幅计算完成后必须提供三级当日排序入口");
assert.match(page, /function TertiaryRankingModal/, "三级排序必须以弹窗展示");
assert.match(page, /tertiary-ranking-history-link/, "三级排序中的方向必须提供评分日历入口");
assert.match(page, /ScoreHistoryCalendar item=\{historyItem\}/, "三级排序日历必须复用既有历史评分数据");
assert.match(page, /role="img"/, "折线图必须提供可访问图像语义");
assert.match(css, /\.market-turnover-chart/, "成交额折线图必须使用现有市场环境的视觉体系");
assert.match(css, /\.market-environment-modal/, "市场环境弹窗必须有桌面与窄屏布局");
assert.match(css, /\.market-environment-rank-toggle/, "板块层级选择控件必须使用现有市场环境视觉体系");
assert.match(css, /\.tertiary-ranking-modal/, "三级排序弹窗必须适配现有市场环境视觉体系");
assert.match(css, /\.tertiary-ranking-history-link/, "三级排序的日历入口必须有可访问的交互样式");

console.log("market turnover UI contract passed");
