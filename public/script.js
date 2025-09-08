// public/script.js

// ===== Простые утилиты =====
function $(sel, root = document) { return root.querySelector(sel); }
function createEl(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

// Генерация sessionId на клиенте; при первом сообщении сервер может создать/подтвердить
function ensureSessionId(prev) {
  if (prev && typeof prev === "string") return prev;
  return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Вызов API
async function api(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Санитайз (минимальный; в проде используйте библиотеку)
function sanitize(html) {
  const div = document.createElement("div");
  div.textContent = html;
  return div.innerHTML;
}

// Рендер сообщения
function addMessage(role, html, meta = "") {
  const chat = $("#chat");
  const wrap = createEl("div", `msg ${role}`);
  const bubble = createEl("div", "bubble");
  bubble.innerHTML = html; // предполагается, что приходят безопасные теги
  const metaEl = createEl("div", "meta");
  metaEl.textContent = meta;
  wrap.appendChild(bubble);
  if (meta) wrap.appendChild(metaEl);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

// Простейший рендер проверок (если они есть)
function renderInlineChecks(containerEl, checks) {
  if (!Array.isArray(checks) || !checks.length) return;
  const block = createEl("div", "checks");
  checks.forEach((c, i) => {
    const q = createEl("div", "check-q");
    q.textContent = c.q || `Вопрос ${i + 1}`;
    block.appendChild(q);
    if (Array.isArray(c.opts)) {
      c.opts.forEach((opt, j) => {
        const btn = createEl("button", "check-opt");
        btn.textContent = opt;
        btn.addEventListener("click", () => {
          btn.disabled = true;
          const correct = Number(c.answer) === j;
          btn.classList.add(correct ? "ok" : "bad");
        });
        block.appendChild(btn);
      });
    }
  });
  containerEl.appendChild(block);
}

// ===== Состояние =====
const state = {
  sessionId: null,
  conversationTurn: 0,
  awaitingNormalize: false, // <<< ключевое изменение: выключено
  mastery: 0
};

// Поля управления (предполагается, что они есть в index.html)
const subjectEl = $("#subject");
const gradeEl   = $("#grade");
const styleEl   = $("#style");
const levelEl   = $("#level");
const inputEl   = $("#input");
const sendBtn   = $("#send");
const masteryBar = $("#masteryBar");
const nextStep = $("#nextStep");

// Кнопка отправки
sendBtn.addEventListener("click", handleSend);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

async function handleSend() {
  const text = (inputEl.value || "").trim();
  if (!text) return;

  addMessage("user", sanitize(text));
  inputEl.value = "";

  try {
    const firstMessage = !state.sessionId;

    const payload = firstMessage
      ? {
          // первая реплика — сразу в /api/chat
          sessionId: state.sessionId || ensureSessionId(),
          subject: subjectEl?.value || "general",
          grade: Number(gradeEl?.value) || 9,
          style: styleEl?.value || "step_by_step",
          level: levelEl?.value || "standard",
          message: text
        }
      : {
          sessionId: state.sessionId,
          message: text
        };

    const chatRes = await api("/api/chat", payload);

    // Фиксируем/обновляем sessionId/stateId от сервера
    const sid = chatRes?.conversation?.stateId || payload.sessionId;
    state.sessionId = sid;
    state.conversationTurn = chatRes?.conversation?.turn ?? (state.conversationTurn + 1);

    const a = chatRes.assistant || {};
    const html = a.message || "";
    addMessage("assistant", html);

    // Рендерим проверки (если пришли)
    const lastBubble = document.querySelector("#chat .msg.assistant:last-child .bubble");
    if (Array.isArray(a.checks) && a.checks.length && lastBubble) {
      renderInlineChecks(lastBubble, a.checks);
    }

    // Обновляем мастерство
    const mastery = a?.tutor_state?.mastery;
    if (typeof mastery === "number") {
      state.mastery = mastery;
      if (masteryBar) masteryBar.style.width = Math.round(mastery * 100) + "%";
    }
    if (nextStep && a?.tutor_state?.next_step) {
      nextStep.textContent = a.tutor_state.next_step;
    }
  } catch (err) {
    console.error(err);
    addMessage("assistant", `<i>Ошибка: ${sanitize(err.message || String(err))}</i>`);
  }
}

// Небольшой приветственный текст
addMessage(
  "assistant",
  "Привет! Пиши свой вопрос — я отвечу сразу, без дополнительной настройки темы. " +
  "При желании можно выбрать предмет/класс/стиль перед первым сообщением."
);
