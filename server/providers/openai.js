// server/providers/openai.js
const API_URL = "https://api.openai.com/v1/chat/completions";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function extractJson(text) {
  // 1) пробуем как есть
  try { return JSON.parse(text); } catch {}
  // 2) ищем блок ```json ... ```
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  // 3) пытаемся выдрать подстроку с {...}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  throw new Error("Failed to parse JSON from model output");
}

/**
 * Вызывает Chat Completions и возвращает подразумеваемый JSON-объект.
 * messages: [{role:"system"|"user"|"assistant", content:"..."}]
 */
export async function chatJSON({ messages, temperature = 0.2, max_tokens = 800 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      max_tokens
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("OpenAI returned empty content");

  return extractJson(text);
}
