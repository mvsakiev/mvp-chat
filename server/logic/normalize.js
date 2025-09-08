// server/logic/normalize.js
import fs from "node:fs";
import path from "node:path";
import { chatJSON } from "../providers/openai.js";
import { SUBJECTS, STYLES } from "../shared/constants.js";

function safeReadTopics(subject) {
  try {
    const p = path.join(process.cwd(), "server", "data", "topics", `${subject}.json`);
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    // ожидаем формат массива объектов { title, summary, key_facts, formulas, keywords[] }
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function pickContextStub({ query, subject }) {
  const items = safeReadTopics(subject);
  if (!items.length) return "";

  const q = (query || "").toLowerCase();
  const scored = items.map((it) => {
    const hay = [
      it.title || "",
      ...(it.keywords || []),
      it.summary || ""
    ].join(" ").toLowerCase();
    const score = hay.includes(q) ? 3
      : (q && q.split(/\s+/).some(w => w.length > 3 && hay.includes(w)) ? 1 : 0);
    return { it, score };
  }).sort((a,b) => b.score - a.score);

  const top = scored.slice(0, 3).map(s => s.it);
  const chunks = top.map(t => {
    const facts = Array.isArray(t.key_facts) ? t.key_facts.slice(0,3).join("; ") : "";
    const formulas = Array.isArray(t.formulas) ? t.formulas.slice(0,2).join(" | ") : "";
    return [
      t.title ? `• ${t.title}` : null,
      t.summary ? `  – ${t.summary}` : null,
      facts ? `  – факты: ${facts}` : null,
      formulas ? `  – формулы: ${formulas}` : null
    ].filter(Boolean).join("\n");
  });

  return chunks.filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = `Ты — педагогический ассистент, который нормализует запрос ученика.
На входе: предмет, класс (grade), стиль объяснений и формулировка запроса.
Твоя задача — СТРОГО в JSON (без лишнего текста) вернуть:
{
  "topic": string,                         // нормализованная тема урока
  "goals": string[],                       // 2-5 учебных целей
  "constraints": string[]                  // важные условия (уровень, стиль, возраст и т.п.)
}
Только корректный JSON. Никакого текста вокруг.`;

export async function normalizeRequest({ subject, grade, style, level, query }) {
  // 1) Собираем context_stub из topics (RAG-стаб)
  const context_stub = pickContextStub({ subject, query });

  // 2) Готовим сообщения для LLM
  const userMsg =
`subject: ${subject}
grade: ${grade}
style: ${style}
level: ${level || "standard"}
query: ${query}

(Подсказки из материалов):
${context_stub || "(нет)"}  
`;

  // 3) Вызываем модель
  let normalized = { topic: "", goals: [], constraints: [] };
  try {
    normalized = await chatJSON({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg }
      ],
      temperature: 0.2,
      max_tokens: 500
    });
  } catch (e) {
    // fallback на минимально рабочие поля
    normalized = {
      topic: query || "",
      goals: [],
      constraints: [`grade:${grade}`, `style:${style}`]
    };
  }

  // 4) Возвращаем объект + наш context_stub
  return {
    normalized: {
      topic: normalized?.topic || (query || ""),
      goals: Array.isArray(normalized?.goals) ? normalized.goals : [],
      constraints: Array.isArray(normalized?.constraints) ? normalized.constraints : [],
      context_stub
    }
  };
}
