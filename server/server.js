// server/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

// утилиты / схемы / логика
import { validateOrThrow } from "./shared/validator.js";
import { ensureSessionId } from "./shared/utils.js";
import { normalizeRequest } from "./logic/normalize.js";
import { dialogTurn } from "./logic/dialog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/**
 * Важно: сначала отдаем статику БЕЗ лимитера.
 * Иначе браузерные запросы к styles.css / script.js могут ловить 429.
 */
app.use(express.static(path.join(__dirname, "..", "public")));

/**
 * Лимит и обрезка длины — применяем ТОЛЬКО к /api/*
 */
const apiLimiter = (req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
    req.socket.remoteAddress ||
    "ip";
  const now = Date.now();
  apiLimiter._lastHit ??= new Map();
  const prev = apiLimiter._lastHit.get(ip) || 0;
  if (now - prev < 800) {
    return res
      .status(429)
      .json({ error: "Too many requests. Try again shortly." });
  }
  apiLimiter._lastHit.set(ip, now);
  next();
};

const trimLongMessage = (req, _res, next) => {
  if (
    req.body?.message &&
    typeof req.body.message === "string" &&
    req.body.message.length > 4000
  ) {
    req.body.message = req.body.message.slice(0, 4000);
  }
  next();
};

// Применяем ТОЛЬКО на /api/*
app.use("/api", apiLimiter, trimLongMessage);

// ===== In-memory сессии (MVP) =====
const sessions = new Map(); // sessionId -> { subject, grade, style, level, normalized, history[], turn, mastery }

// ===== /api/normalize =====
app.post("/api/normalize", async (req, res) => {
  try {
    validateOrThrow("TutorInput", req.body);
    const { subject, grade, style, level = "standard", query } = req.body;
    const sessionId = ensureSessionId(req.body.sessionId);

    // нормализация + контекст из topics
    const { normalized } = await normalizeRequest({
      subject,
      grade,
      style,
      level,
      query,
    });

    // создаём/обновляем сессию
    sessions.set(sessionId, {
      subject,
      grade,
      style,
      level,
      normalized,
      history: [{ role: "user", content: String(query || "") }],
      turn: 1,
      mastery: 0,
    });

    const payload = {
      normalized,
      conversation: { stateId: sessionId, turn: 1 },
    };
    validateOrThrow("NormalizeResponse", payload);

    res.json(payload);
  } catch (err) {
    console.error("normalize error:", err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ===== /api/chat — «живой» диалог =====
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !sessions.has(sessionId)) {
      return res
        .status(400)
        .json({ error: "Unknown sessionId. Call /api/normalize first." });
    }

    const s = sessions.get(sessionId);
    const userMsg = String(message || "");

    // пишем пользователя в историю
    s.history.push({ role: "user", content: userMsg });

    // ход диалога через модель
    const { assistant } = await dialogTurn({ session: s, userMessage: userMsg });

    // обновляем состояние
    s.history.push({ role: "assistant", content: assistant.message });
    s.turn = (s.turn || 1) + 1;
    s.mastery = assistant?.tutor_state?.mastery ?? s.mastery;

    const payload = {
      assistant,
      conversation: { stateId: sessionId, turn: s.turn },
    };
    // при желании включай строгую проверку:
    // validateOrThrow("ChatResponse", payload);

    res.json(payload);
  } catch (err) {
    console.error("chat error:", err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ===== SPA fallback =====
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));

export { sessions };
