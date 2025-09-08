// server/server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";
dotenv.config();

import { validateOrThrow } from "./shared/validator.js";
import { ensureSessionId } from "./shared/utils.js";
import { chatTurn } from "./logic/dialog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Память процесса для сессий (упрощённо для MVP)
const sessions = new Map();

// --- Статика SPA ---
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// ====== API ======

// Нормализацию оставляем как была (если фронт когда-то её вызовет).
// Но для варианта А она не используется.
app.post("/api/normalize", async (req, res) => {
  try {
    validateOrThrow("TutorInput", req.body);
    const { subject, grade, style, level = "standard", query } = req.body;

    const sessionId = ensureSessionId(req.body.sessionId);
    // Минимальная инициализация, чтобы совместимо жить с вариантом A:
    const normalized = {
      topic: String(query || ""),
      goals: [],
      constraints: [`grade:${grade}`, `style:${style}`],
      context_stub: "",
    };

    // Создаём/обновляем сессию
    sessions.set(sessionId, {
      subject: subject || "general",
      grade: Number.isFinite(+grade) ? +grade : 9,
      style: style || "step_by_step",
      level,
      normalized,
      history: [],
      turn: 0,
      mastery: 0,
    });

    return res.json({
      sessionId,
      normalized,
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: String(err?.message || err) });
  }
});

// >>> Главное изменение: /api/chat сам создаёт сессию, если её нет <<<
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, subject, grade, style, level } = req.body || {};

    // Получаем существующую сессию (если есть)
    let sid = sessionId;
    let s = sid && sessions.get(sid);

    // Если сессии нет — создаём её на лету из присланных полей или дефолтов
    if (!s) {
      sid = ensureSessionId(sid);
      const subj = subject || "general";
      const grd = Number.isFinite(+grade) ? +grade : 9;
      const stl = style || "step_by_step";
      const lvl = level || "standard";

      s = {
        subject: subj,
        grade: grd,
        style: stl,
        level: lvl,
        normalized: {
          topic: String(message || ""), // В качестве темы берём первое сообщение пользователя
          goals: [],
          constraints: [],
          context_stub: "",
        },
        history: [],
        turn: 0,
        mastery: 0,
      };
      sessions.set(sid, s);
    }

    // Базовая валидация тела /api/chat (если у вас есть схема — можно включить здесь)
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Field `message` is required" });
    }

    // Выполняем один ход диалога
    const result = await chatTurn({
      session: s,
      message,
    });

    // Обновляем внутреннее состояние (если chatTurn вернул обновления)
    if (result?._sessionPatch) {
      Object.assign(s, result._sessionPatch);
    }
    s.turn = (s.turn || 0) + 1;

    // Отправляем ответ клиенту
    return res.json({
      assistant: result.assistant || {
        message: "Пустой ответ",
        examples: [],
        checks: [],
        homework: [],
        citations: [],
        tutor_state: { mastery: s.mastery || 0, next_step: "" },
      },
      conversation: {
        stateId: sid,
        turn: s.turn,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

