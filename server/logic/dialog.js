// server/logic/dialog.js
import { chatText } from "../providers/openaiText.js"; // текстовые ответы
import { chatJSON } from "../providers/openai.js";      // строго JSON (для тестов)
import { getRagSnippets } from "./rag.js";

/** Простые эвристики «понимания» */
function updateMastery(prev = 0, userMsg = "") {
  const s = (userMsg || "").toLowerCase();
  let m = prev;
  if (/(понятно|ясно|ок|спасибо|всё понятно|спс)/.test(s)) m += 0.12;
  if (/(не понимаю|непонятно|поясни|объясни|что значит)/.test(s)) m -= 0.08;
  if (/(правильно|получилось|сделал|решил|верно)/.test(s)) m += 0.08;
  return Math.max(0, Math.min(1, m));
}

/** Условие показа мини-теста */
function shouldQuiz({ turn, mastery, userMsg }) {
  if (/тест|проверь|готов к тесту|проверка/i.test(userMsg || "")) return true;
  if ((turn || 1) >= 4 && (mastery || 0) >= 0.35) return true;
  return false;
}

/** Генерация мини-теста (3–5 вопросов) через JSON */
async function generateChecks({ subject, grade, topic, context_stub }) {
  const SYS = `Ты — школьный тьютор. Составь мини-тест по теме строго в JSON-массиве.
Каждый элемент:
{
 "type": "mcq"|"short",
 "question": string,
 "options": string[] (для mcq),
 "answer": string,            // для short — эталон; допускай короткие синонимы через |
 "hint": string,
 "explanation": string
}
Только корректный JSON, без текста вокруг. 3–5 вопросов. Уровень — ${grade} класс. Предмет — ${subject}.`;

  const USR = `Тема: ${topic}
Короткий контекст:
${context_stub || "(нет)"}
Сделай баланс: 2–3 mcq и 1–2 short.`;

  try {
    const arr = await chatJSON({
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: USR }
      ],
      temperature: 0.4,
      max_tokens: 900
    });
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** Грубая зачистка избыточных "вопросов" в тексте, если checks уже есть */
function stripQuizLikeFromText(text = "") {
  if (!text) return text;

  // 1) Удаляем разделы, начинающиеся с "Мини-тест", "Тест" и заголовков с "Вопрос"
  const patterns = [
    /(^|\n)#{1,6}\s*(мини[-\s]?тест|тест)\b[\s\S]*$/i,
    /(^|\n)(мини[-\s]?тест|тест)\s*[:\-–]\s*[\s\S]*$/i,
  ];
  for (const re of patterns) {
    if (re.test(text)) text = text.replace(re, "").trim();
  }

  // 2) Режем блоки списков, похожих на перечень вопросов (номер. текст ... варианты)
  // Находим первую "подозрительную" строку и откусываем всё после неё
  const suspiciousIdx = text.search(
    /(^|\n)\s*((вопрос\s*\d+)|(\d+[\).\s])|([\-*]\s+[A-DА-Д][\).\s]))/i
  );
  if (suspiciousIdx > -1) {
    text = text.slice(0, suspiciousIdx).trim();
  }

  // 3) Если текст пустой — вернём короткий анонс (ниже добавим ещё раз)
  return text.trim();
}

/** Один ход диалога */
export async function dialogTurn({ session, userMessage }) {
  const { subject, grade, style, normalized, history, mastery = 0 } = session;
  const topic = normalized?.topic || "";
  const context_stub = normalized?.context_stub || "";

  const SYSTEM = `Ты — доброжелательный школьный тьютор.
Задачи:
- Объясняй "${topic}" на уровне ${grade} класса, стиль: ${style}.
- Пиши короткими абзацами, по шагам, с мини-вопросами.
- Формулы давай в LaTeX ($E=mc^2$).
- ЕСЛИ ты решаешь выдать мини-тест — НЕ вставляй вопросы в основной текст ответа.
  Вопросы должны идти ТОЛЬКО отдельным JSON-массивом (поле checks), а в тексте сделай короткое объявление: "📋 Я подготовил мини-тест ниже."`;

  // короткая история (последние 10 сообщений)
  const last = (history || []).slice(-10);

  // RAG-подсказки (заглушка)
  const ragHints = await getRagSnippets({ subject, topic, grade });

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "system", content: `Короткие подсказки (RAG):\n${ragHints.join("\n")}` },
    {
      role: "system",
      content:
`Подсказки из материалов (можно использовать, но НЕ цитируй дословно):
${context_stub || "(нет)"}`
    },
    ...last.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userMessage || "") }
  ];

  // — основной ответ: чистый текст —
  let answerText = "";
  try {
    answerText = await chatText({
      messages,
      temperature: 0.4,
      max_tokens: 900
    });
  } catch {
    // фолбэк, если внешний вызов не удался
    answerText = `Давай разберёмся по шагам:
1) Что именно про "${topic}" сложнее всего: определения, примеры или задачи?
2) Напиши 1–2 предложения, что уже понятно — я дополню.`;
  }

  // обновим оценку «понимания»
  const newMastery = updateMastery(mastery, userMessage);

  // решаем, выдавать ли мини-тест
  let checks = [];
  const nextTurn = (session.turn || 1) + 1;
  if (shouldQuiz({ turn: nextTurn, mastery: newMastery, userMsg: userMessage })) {
    checks = await generateChecks({ subject, grade, topic, context_stub });
  }

  // Если есть тест — чистим текст от "вопросов" и добавляем анонс
  if (checks.length) {
    answerText = stripQuizLikeFromText(answerText);
    if (!answerText) {
      answerText = "📋 Я подготовил мини-тест ниже.";
    } else if (!/мини.?тест|📋/i.test(answerText)) {
      answerText += "\n\n📋 Я подготовил мини-тест ниже.";
    }
  }

  return {
    assistant: {
      message: answerText,
      examples: [],
      checks,
      homework: [],
      citations: [],
      tutor_state: {
        mastery: newMastery,
        next_step: checks.length
          ? "Пройди мини-тест. Если что-то не ясно — вернёмся к объяснению."
          : "Задай уточнение или попроси мини-тест."
      }
    }
  };
}
