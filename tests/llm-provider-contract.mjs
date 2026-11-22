import assert from "node:assert/strict";
import { invokeLlm } from "../lib/llm-provider.js";

const messages = [{ role: "user", content: "Return JSON" }];
const env = { OPENAI_API_KEY: "key", OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_MODEL: "env-model" };
for (const mode of ["default", "responses", "fallback", "explicit"]) {
  const oauth = ["fallback", "explicit"].includes(mode);
  const chat = mode === "default";
  const raw = chat ? { choices: [{ message: { content: '{"ok":true}' } }] } :
    { output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] };
  raw.usage = { total_tokens: 12 };
  const model = mode === "fallback" ? "gpt-4.1-mini" : "env-model";
  const result = await invokeLlm({
    env: mode === "fallback" ? {} : env, messages, responseFormat: "json",
    provider: mode === "explicit" ? "chatgpt_oauth" : undefined,
    apiMode: mode === "responses" ? "responses" : undefined,
    getAccessToken: () => { assert.ok(oauth); return "token"; },
    fetch: async (url, init) => {
      assert.equal(url, (oauth ? "https://api.openai.com/v1" : "https://example.test/v1") +
        (chat ? "/chat/completions" : "/responses"));
      assert.equal(init.method, "POST");
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(init.headers, { Authorization: "Bearer " + (oauth ? "token" : "key"), "Content-Type": "application/json" });
      const format = { type: "json_object" };
      assert.deepEqual(JSON.parse(init.body), chat ? { model, messages, response_format: format } :
        { model, input: messages, store: false, text: { format } });
      return Response.json(raw);
    },
  });
  assert.deepEqual(result, { model, raw, usage: raw.usage, provider: oauth ? "chatgpt_oauth" : "openai",
    text: '{"ok":true}', json: { ok: true } });
}
for (const status of [401, 429]) {
  await assert.rejects(invokeLlm({ env, messages, fetch: async () =>
    Response.json({ error: { message: "upstream error" } }, { status }) }),
    { status, message: "HTTP " + status + ": upstream error" });
}
await assert.rejects(invokeLlm({ env: {}, provider: "openai", messages }), /OPENAI_API_KEY/);
await assert.rejects(invokeLlm({ env: {}, messages, getAccessToken: () => { throw Error("login required"); } }), /login required/);
await assert.rejects(invokeLlm({ env, messages, responseFormat: "json", fetch: async () =>
  Response.json({ choices: [{ message: { content: "invalid" } }] }) }), SyntaxError);
console.log("llm-provider contract passed");
