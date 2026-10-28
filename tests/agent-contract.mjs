import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPkce } from "../lib/agent-auth.js";
import { buildResponsesRequest, parseSseFrames } from "../lib/agent-chat.js";
import { buildAgentQuestionText, compactThemeForAgent, normalizeAgentSelection, resolveQuestionSectorKeys } from "../lib/agent-context.js";
import { assertLocalAgentRequest } from "../lib/agent-request.js";
import { readStoredAgentConversation, serializeAgentConversation } from "../app/lib/agentConversation.js";

const selection = normalizeAgentSelection({
  date: "2026-10-14",
  datasets: ["market_overview", "invalid", "market_overview"],
  sectors: Array.from({ length: 8 }, (_, index) => `板块${index}`),
  stock_codes: ["600519", "000858, 300750", "bad"],
});
assert.deepEqual(selection.datasets, ["market_overview"], "只允许已声明的数据包，且必须去重");
assert.equal(selection.sectors.length, 5, "板块选择必须有明确上限");
assert.deepEqual(selection.stock_codes, ["600519", "000858", "300750"], "股票代码必须标准化并过滤无效输入");
assert.throws(() => normalizeAgentSelection({ date: "20261014" }), /YYYY-MM-DD/, "非法日期不能进入数据读取路径");

const compactTheme = compactThemeForAgent({
  key: "半导体__半导体设备",
  primary: "半导体",
  name: "半导体设备",
  mainline_rank: 1,
  mainline_rank_score: 88.2,
  score_history: [{ date: "future-or-large-data" }],
  members: Array.from({ length: 1000 }, () => ({ code: "000001" })),
  breadth: { member_count: 10, up_count: 7, up_ratio: .7, unknown: "drop" },
});
assert.equal(compactTheme.mainline_rank, 1);
assert.equal("score_history" in compactTheme, false, "Agent 上下文不能把完整历史数组无界发送");
assert.equal("members" in compactTheme, false, "Agent 上下文不能把完整成员数组无界发送");
assert.equal("unknown" in compactTheme.breadth, false, "板块明细必须使用显式字段白名单");

const pcbTheme = {
  key: "电子元器件__PCB",
  primary: "电子元器件",
  name: "PCB",
  core_driven_tertiaries: [{
    name: "覆铜板材料",
    core_stock_count: 2,
    limit_up_count: 2,
    high_gain_count: 2,
    recent_return_total_pct: 8.61,
    stocks: [{ code: "000823", name: "超声电子", change_pct: 9.99, recent_return_pct: 5.44 }],
  }],
};
const resolvedPcb = resolveQuestionSectorKeys(
  [pcbTheme],
  "今天 PCB 板块里的覆铜板表现怎么样？",
  [],
  new Map([["电子元器件__PCB", ["PCB", "覆铜板材料"]]]),
);
assert.deepEqual(resolvedPcb, ["电子元器件__PCB"], "问题中的二级或三级板块名称必须映射到本地主线板块");
const compactPcb = compactThemeForAgent(pcbTheme);
assert.equal(compactPcb.core_driven_tertiaries[0].name, "覆铜板材料", "板块上下文必须保留三级方向明细");
assert.equal(compactPcb.core_driven_tertiaries[0].stocks[0].change_pct, 9.99, "三级方向必须保留成分股当日表现");
const followUpEvidenceText = buildAgentQuestionText("现在能看到对应的信息了吗？", [
  { role: "user", content: "今天 PCB 板块的覆铜板表现怎么样？" },
  { role: "assistant", content: "此前没有收到板块明细。" },
]);
assert.match(followUpEvidenceText, /PCB.*覆铜板/s, "追问必须继承最近用户问题中的板块名称，不能只解析当前短句");

const storedConversation = readStoredAgentConversation(serializeAgentConversation([
  { role: "user", content: "分析 PCB" },
  { role: "assistant", content: "这是本地数据研判结果" },
], "2026-10-14T00:00:00.000Z"));
assert.deepEqual(storedConversation, [
  { role: "user", content: "分析 PCB" },
  { role: "assistant", content: "这是本地数据研判结果" },
], "关闭并重新打开研判弹窗后必须能够恢复本机对话");
assert.deepEqual(readStoredAgentConversation("{bad-json"), [], "损坏的本机记录不能阻塞研判弹窗打开");

const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index}` }));
const request = buildResponsesRequest({ model: "gpt-test", question: "请判断", history, context: { as_of_date: "2026-10-14" } });
assert.deepEqual(Object.keys(request).sort(), ["input", "instructions", "model", "store", "stream"], "套餐推理请求不能混入预览阶段不支持的字段");
assert.equal(request.store, false);
assert.equal(request.stream, true);
assert.equal(request.input.length, 13, "只发送最近 12 条历史消息和本轮问题");
assert.match(request.instructions, /不得引入未来数据/, "研判指令必须明确禁止未来数据泄漏");
assert.match(request.input.at(-1).content, /2026-10-14/, "本轮必须携带所选系统证据");

const parsed = parseSseFrames("event: delta\r\ndata: {\"delta\":\"A\"}\r\n\r\nevent: del");
assert.equal(parsed.frames.length, 1);
assert.equal(parsed.rest, "event: del", "不完整的 SSE 帧必须留到下一块继续解析");

const pkce = createPkce();
assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(pkce.verifier, createPkce().verifier, "每次授权必须生成新的 PKCE verifier");

const localRequest = new Request("http://127.0.0.1:3000/api/agent/chat", {
  method: "POST",
  headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "sec-fetch-site": "same-origin" },
});
assert.doesNotThrow(() => assertLocalAgentRequest(localRequest, { json: true }));
assert.throws(() => assertLocalAgentRequest(new Request("http://127.0.0.1:3000/api/agent/chat", {
  method: "POST",
  headers: { origin: "https://malicious.example", "content-type": "text/plain", "sec-fetch-site": "cross-site" },
}), { json: true }), /跨站/, "本机 Agent 必须拒绝来自其他网页的调用");

const mainPageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
assert.match(mainPageSource, /className="agent-entry collection-agent-entry" onClick=\{\(\) => setAgentOpen\(true\)\}/, "主系统侧栏必须通过对话框打开 Agent");
assert.match(mainPageSource, /className="notes-toggle agent-topbar" onClick=\{\(\) => setAgentOpen\(true\)\}/, "宽屏顶部工具栏必须通过对话框打开 Agent");
assert.match(mainPageSource, /<AgentWorkspace embedded/, "Agent 工作区必须嵌入主页面对话框");
assert.doesNotMatch(mainPageSource, /href="\/agent"/, "主页面不能再跳转到独立 Agent 页面");
const agentWorkspaceSource = readFileSync(new URL("../app/components/AgentWorkspace.js", import.meta.url), "utf8");
assert.match(agentWorkspaceSource, /messagesViewportRef\.current/, "长回答只能滚动对话区域，不能滚动整个弹窗");
assert.doesNotMatch(agentWorkspaceSource, /scrollIntoView/, "对话自动滚动不能继续推动外层页面");
assert.match(agentWorkspaceSource, /AGENT_CONVERSATION_STORAGE_KEY/, "研判对话必须保存在本机浏览器");
const agentWorkspaceStyles = readFileSync(new URL("../app/components/AgentWorkspace.module.css", import.meta.url), "utf8");
assert.match(agentWorkspaceStyles, /\.messages \{ grid-row: 3;/, "消息列表必须固定在可滚动的网格行，不能把输入框挤出弹窗");
assert.match(agentWorkspaceStyles, /\.composerArea \{ grid-row: 4;/, "输入框必须固定在弹窗底部的独立网格行");
assert.match(agentWorkspaceStyles, /scrollbar-color:/, "长回答必须显示明确的滚动条");
const callbackSource = readFileSync(new URL("../app/api/agent/auth/callback/route.js", import.meta.url), "utf8");
assert.match(callbackSource, /searchParams\.set\("agent", "1"\)/, "ChatGPT 授权完成后必须回到主页面并重新打开研判对话框");

console.log("agent contract passed");
