export const AGENT_CONVERSATION_STORAGE_KEY = "stock-library.agent-conversation.v1";

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARACTERS = 50_000;

export function normalizeAgentMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, MAX_MESSAGE_CHARACTERS),
    }))
    .filter((message) => message.content.trim())
    .slice(-MAX_MESSAGES);
}

export function readStoredAgentConversation(rawValue) {
  if (!rawValue) return [];
  try {
    const payload = JSON.parse(rawValue);
    if (payload?.version !== 1) return [];
    return normalizeAgentMessages(payload.messages);
  } catch {
    return [];
  }
}

export function serializeAgentConversation(messages, updatedAt = new Date().toISOString()) {
  return JSON.stringify({
    version: 1,
    updated_at: updatedAt,
    messages: normalizeAgentMessages(messages),
  });
}
