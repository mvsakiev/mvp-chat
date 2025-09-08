export function ensureSessionId(sid) {
  if (sid && sid.length >= 6) return sid;
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "sid_" + Math.random().toString(36).slice(2, 10);
}
export const EMPTY_CHAT_PAYLOAD = {
  assistant: { message: "", examples: [], checks: [], homework: [], citations: [], tutor_state: { mastery: 0, next_step: "" } },
  conversation: { stateId: "", turn: 1 }
};
