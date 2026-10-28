import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const AUTH_ORIGIN = "https://auth.openai.com";
const API_RESOURCE = "https://api.openai.com/v1";
const PRIVATE_DIR = path.join(process.cwd(), "output", "agent-private");
const HOST_PATH = path.join(PRIVATE_DIR, "host.json");
const CREDENTIAL_PATH = path.join(PRIVATE_DIR, "credentials.json");
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";
const APP_NAME = "A股量化研判助手";
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

const transactions = globalThis.__stockAgentAuthTransactions
  || (globalThis.__stockAgentAuthTransactions = new Map());
let jwksCache = globalThis.__stockAgentJwksCache || null;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function scopes(value) {
  return String(value || "").split(/\s+/).filter(Boolean);
}

async function writePrivateJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function getHostId() {
  const saved = await readJson(HOST_PATH);
  if (saved?.ext_agent_host_id) return saved.ext_agent_host_id;
  const extAgentHostId = `urn:uuid:${randomUUID()}`;
  await writePrivateJson(HOST_PATH, { ext_agent_host_id: extAgentHostId, created_at: new Date().toISOString() });
  return extAgentHostId;
}

function assertLoopback(requestUrl) {
  const url = new URL(requestUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("ChatGPT 套餐登录仅允许从本机 127.0.0.1 或 localhost 启动");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `http://127.0.0.1:${port}/api/agent/auth/callback`;
}

export function createPkce() {
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function beginChatGptAuthorization(requestUrl) {
  const redirectUri = assertLoopback(requestUrl);
  const saved = await readJson(CREDENTIAL_PATH);
  const extAgentHostId = await getHostId();
  const state = base64Url(randomBytes(32));
  const nonce = base64Url(randomBytes(32));
  const { verifier, challenge } = createPkce();
  const clientId = saved?.client_id || "dynamic_agent_client";
  const createdAt = Date.now();
  transactions.set(state, { state, nonce, verifier, redirectUri, clientId, createdAt });
  for (const [key, transaction] of transactions) {
    if (createdAt - transaction.createdAt > TRANSACTION_TTL_MS) transactions.delete(key);
  }

  const url = new URL("/api/accounts/authorize", AUTH_ORIGIN);
  const params = {
    client_id: clientId,
    ext_agent_host_id: extAgentHostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: API_RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
  };
  if (clientId === "dynamic_agent_client") params.agent_name_hint = APP_NAME;
  else {
    if (saved?.id_token) params.id_token_hint = saved.id_token;
    if (saved?.profile?.email) params.login_hint = saved.profile.email;
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function loadJwks() {
  if (jwksCache && Date.now() - jwksCache.loadedAt < 60 * 60 * 1000) return jwksCache.keys;
  const response = await fetch(`${AUTH_ORIGIN}/.well-known/jwks.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取 OpenAI 登录公钥：HTTP ${response.status}`);
  const payload = await response.json();
  jwksCache = { keys: payload.keys || [], loadedAt: Date.now() };
  globalThis.__stockAgentJwksCache = jwksCache;
  return jwksCache.keys;
}

async function verifyIdToken(token, expectedClientId, expectedNonce) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("OpenAI ID token 格式无效");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  const key = (await loadJwks()).find((item) => item.kid === header.kid && (!item.alg || item.alg === header.alg));
  if (!key) throw new Error("找不到用于验证 OpenAI ID token 的公钥");
  const algorithms = { RS256: "RSA-SHA256", ES256: "sha256" };
  const algorithm = algorithms[header.alg];
  if (!algorithm) throw new Error(`不支持的 ID token 签名算法：${header.alg}`);
  const signature = Buffer.from(encodedSignature, "base64url");
  const publicKey = createPublicKey({ key, format: "jwk" });
  const verificationKey = header.alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey;
  const valid = verify(algorithm, Buffer.from(`${encodedHeader}.${encodedPayload}`), verificationKey, signature);
  if (!valid) throw new Error("OpenAI ID token 签名验证失败");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== AUTH_ORIGIN) throw new Error("OpenAI ID token 签发方不匹配");
  if (!audience.includes(expectedClientId)) throw new Error("OpenAI ID token audience 不匹配");
  if (!payload.exp || payload.exp <= now) throw new Error("OpenAI ID token 已过期");
  if (payload.nonce !== expectedNonce) throw new Error("OpenAI ID token nonce 不匹配");
  if (!payload.sub) throw new Error("OpenAI ID token 缺少用户标识");
  return payload;
}

async function exchangeToken(body) {
  const response = await fetch(`${AUTH_ORIGIN}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error_description: text }; }
  if (!response.ok) throw new Error(payload.error_description || payload.error || `OpenAI token 交换失败：HTTP ${response.status}`);
  return payload;
}

export async function completeChatGptAuthorization(callbackUrl) {
  const url = new URL(callbackUrl);
  const state = url.searchParams.get("state") || "";
  const transaction = transactions.get(state);
  if (!transaction || Date.now() - transaction.createdAt > TRANSACTION_TTL_MS) {
    throw new Error("登录请求已失效，请重新开始登录");
  }
  transactions.delete(state);
  if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "用户取消了 ChatGPT 授权");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("ChatGPT 登录回调缺少授权码");
  const returnedClientId = url.searchParams.get("client_id");
  const clientId = transaction.clientId === "dynamic_agent_client" ? returnedClientId : transaction.clientId;
  if (!clientId || clientId === "dynamic_agent_client") throw new Error("ChatGPT 动态客户端注册未完成");
  if (transaction.clientId !== "dynamic_agent_client" && returnedClientId && returnedClientId !== transaction.clientId) {
    throw new Error("ChatGPT 登录回调返回了不匹配的客户端标识");
  }
  const token = await exchangeToken({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: transaction.verifier,
    redirect_uri: transaction.redirectUri,
    resource: API_RESOURCE,
  });
  const identity = await verifyIdToken(token.id_token, clientId, transaction.nonce);
  const grantedScopes = scopes(token.scope);
  const credential = {
    client_id: clientId,
    ext_agent_host_id: await getHostId(),
    id_token: token.id_token,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type || "Bearer",
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
    earliest_refresh_at: token.earliest_refresh_at || null,
    scopes: grantedScopes,
    profile: {
      subject: identity.sub,
      email: identity.email || "",
      name: identity.name || identity.preferred_username || identity.email || "ChatGPT 用户",
      picture: identity.picture || "",
    },
    updated_at: new Date().toISOString(),
  };
  await writePrivateJson(CREDENTIAL_PATH, credential);
  return publicSession(credential);
}

function publicSession(credential) {
  if (!credential) return { authenticated: false, plan_usage_enabled: false };
  return {
    authenticated: true,
    plan_usage_enabled: credential.scopes?.includes(REQUIRED_SCOPE) || false,
    profile: credential.profile || null,
    expires_at: credential.expires_at || null,
  };
}

export async function getChatGptSession() {
  return publicSession(await readJson(CREDENTIAL_PATH));
}

async function refreshCredential(credential) {
  if (!credential?.refresh_token || !credential?.client_id) throw new Error("ChatGPT 登录已过期，请重新登录");
  const token = await exchangeToken({
    grant_type: "refresh_token",
    client_id: credential.client_id,
    refresh_token: credential.refresh_token,
    resource: API_RESOURCE,
  });
  const updated = {
    ...credential,
    access_token: token.access_token,
    refresh_token: token.refresh_token || credential.refresh_token,
    id_token: token.id_token || credential.id_token,
    token_type: token.token_type || credential.token_type || "Bearer",
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
    earliest_refresh_at: token.earliest_refresh_at || null,
    scopes: token.scope ? scopes(token.scope) : credential.scopes,
    updated_at: new Date().toISOString(),
  };
  await writePrivateJson(CREDENTIAL_PATH, updated);
  return updated;
}

export async function getChatGptAccessToken() {
  let credential = await readJson(CREDENTIAL_PATH);
  if (!credential) throw new Error("请先使用 ChatGPT 登录");
  if (!credential.scopes?.includes(REQUIRED_SCOPE)) throw new Error("当前登录没有授权使用 ChatGPT 套餐进行推理");
  if (!credential.access_token || Number(credential.expires_at || 0) < Date.now() + 2 * 60 * 1000) {
    credential = await refreshCredential(credential);
  }
  return credential.access_token;
}
