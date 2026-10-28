export function assertLocalAgentRequest(request, { json = false } = {}) {
  const requestUrl = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(requestUrl.hostname)) {
    throw new Error("Agent 只接受来自本机的请求");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new Error("已拒绝跨站调用本机 Agent");
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== requestUrl.origin) {
    throw new Error("请求来源与本机 Agent 地址不一致");
  }
  if (json && !String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new Error("Agent 接口只接受 application/json 请求");
  }
}

