// server/logic/rag.js

/**
 * Заглушка RAG: вернёт короткие подсказки по теме.
 * Позже сюда подключим векторный поиск/базу конспектов.
 */
export async function getRagSnippets({ subject, topic, grade }) {
  const hints = [
    `Тема: ${topic} (предмет: ${subject}, класс: ${grade}).`,
    `Объясняй по шагам, с простыми примерами и мини-вопросами.`,
    `Если присутствуют формулы — пиши в LaTeX ($...$).`,
  ];
  return hints;
}
