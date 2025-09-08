document.addEventListener('DOMContentLoaded', () => {
  // === Базовое состояние ===
  const state = {
    sessionId: null,
    conversationTurn: 0,
    mastery: 0,
    awaitingNormalize: true,
    sidebarOpen: false,
  };

  // === DOM ссылки ===
  const $ = (sel) => document.querySelector(sel);
  const chat = $('#chat');
  const input = $('#input');
  const sendBtn = $('#send');
  const sidebar = $('#sidebar');
  const overlay = $('#overlay');
  const toggleSidebarBtn = $('#toggleSidebar');

  const subjectEl = $('#subject');
  const gradeEl = $('#grade');
  const styleEl = $('#style');
  const levelEl = $('#level');
  const masteryBar = $('#masteryBar');
  const nextStep = $('#nextStep');

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    setTimeout(() => t.hidden = true, 2500);
  }

  function ensureSessionId() {
    if (state.sessionId) return state.sessionId;
    state.sessionId = (crypto?.randomUUID?.() || ('sid_' + Math.random().toString(36).slice(2,10)));
    return state.sessionId;
  }

  // ===== Markdown + sanitize =====
  const ALLOWED_TAGS = new Set(["p","strong","em","ul","ol","li","h1","h2","h3","h4","h5","h6","code","pre","blockquote","br","hr","a","span","sup","sub"]);
  const ALLOWED_ATTR = { "a": new Set(["href","title","target","rel"]) };

  function sanitizeHTML(dirty) {
    const template = document.createElement('template');
    template.innerHTML = dirty;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
    const toRemove = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) { toRemove.push(el); continue; }
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!(ALLOWED_ATTR[tag]?.has(name))) el.removeAttribute(attr.name);
      });
      if (tag === "a") {
        const href = el.getAttribute("href") || "";
        if (!/^https?:/i.test(href)) el.removeAttribute("href");
        el.setAttribute("target","_blank");
        el.setAttribute("rel","noopener noreferrer");
      }
    }
    toRemove.forEach(n => n.replaceWith(...n.childNodes));
    return template.innerHTML;
  }

  function renderMarkdown(mdText = "") {
    const raw = (window.marked ? marked.parse(mdText) : mdText);
    return sanitizeHTML(raw);
  }

  function addMessage(role, html, meta = '') {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (role === 'assistant') {
      bubble.innerHTML = renderMarkdown(html);
    } else {
      bubble.innerHTML = escapeHtml(html);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = meta;
    wrap.appendChild(bubble);
    if (meta) wrap.appendChild(metaEl);
    chat.appendChild(wrap);
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
    rerenderMath();
    return bubble;
  }

  function setMastery(val, hint = '') {
    const pct = Math.round((val || 0) * 100);
    masteryBar.style.width = pct + '%';
    nextStep.textContent = hint || '';
  }

  async function api(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('API error ' + res.status);
    return await res.json();
  }

  function getInputPayload(message) {
    return {
      subject: subjectEl.value,
      grade: Number(gradeEl.value),
      style: styleEl.value,
      level: levelEl.value,
      query: message,
      sessionId: ensureSessionId(),
    };
  }

  /** Клиентская зачистка "похожего на тест" текста, если пришёл checks */
  function stripQuizLikeFromTextClient(text = "") {
    if (!text) return text;
    // заголовки "Мини-тест", "Тест"
    text = text.replace(/(^|\n)#{1,6}\s*(мини[-\s]?тест|тест)\b[\s\S]*$/i, "").trim();
    text = text.replace(/(^|\n)(мини[-\s]?тест|тест)\s*[:\-–]\s*[\s\S]*$/i, "").trim();
    // перечни вопросов/опций
    const susp = text.search(/(^|\n)\s*((вопрос\s*\d+)|(\d+[\).\s])|([\-*]\s+[A-DА-Д][\).\s]))/i);
    if (susp > -1) text = text.slice(0, susp).trim();
    return text;
  }

  /** Рендер встроенного теста внутри переданного контейнера (bubble) */
  function renderInlineChecks(container, checks) {
    if (!checks || !checks.length || !container) return;

    const block = document.createElement('div');
    block.className = 'inline-quiz';

    const header = document.createElement('div');
    header.className = 'inline-quiz__header';

    const title = document.createElement('div');
    title.className = 'inline-quiz__title';
    title.textContent = 'Мини-тест';

    const actions = document.createElement('div');
    actions.className = 'inline-quiz__actions';
    const btnCheck = document.createElement('button');
    btnCheck.className = 'inline-quiz__btn';
    btnCheck.textContent = 'Проверить';
    const btnHide = document.createElement('button');
    btnHide.className = 'inline-quiz__btn';
    btnHide.textContent = 'Скрыть';
    actions.appendChild(btnCheck);
    actions.appendChild(btnHide);

    header.appendChild(title);
    header.appendChild(actions);

    const list = document.createElement('div');
    const result = document.createElement('div');
    result.className = 'inline-quiz__result';

    checks.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'check';

      const h3 = document.createElement('h3');
      h3.textContent = `Вопрос ${idx+1}`;

      const body = document.createElement('div');
      if (q.type === 'mcq') {
        const name = `q${idx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const opts = (q.options || []).map((opt) =>
          `<label><input type="radio" name="${name}" value="${escapeHtml(opt)}"/> ${escapeHtml(opt)}</label>`
        ).join('');
        body.innerHTML = `<div>${escapeHtml(q.question)}</div><div class="options">${opts}</div>`;
      } else {
        body.innerHTML = `<div>${escapeHtml(q.question)}</div><input class="short" placeholder="Твой ответ"/>`;
      }

      // мета
      card.dataset.answer = (q.answer || '').toString();
      card.dataset.hint = q.hint || '';
      card.dataset.explanation = q.explanation || '';

      // фидбек
      const fb = document.createElement('div');
      fb.className = 'feedback';
      fb.innerHTML = '';

      card.appendChild(h3);
      card.appendChild(body);
      card.appendChild(fb);

      list.appendChild(card);
    });

    block.appendChild(header);
    block.appendChild(list);
    block.appendChild(result);
    container.appendChild(block);

    // обработчики
    btnHide.addEventListener('click', () => {
      block.remove();
    });

    btnCheck.addEventListener('click', () => {
      const cards = Array.from(list.querySelectorAll('.check'));
      let correct = 0;

      cards.forEach((card) => {
        let userAns = '';
        const radios = card.querySelectorAll('input[type=radio]');
        if (radios.length) {
          const cho = Array.from(radios).find(r => r.checked);
          userAns = cho ? cho.value : '';
        } else {
          const inp = card.querySelector('input.short');
          userAns = inp ? inp.value : '';
        }
        const right = (card.dataset.answer || '').trim().toLowerCase();
        const mine  = (userAns || '').trim().toLowerCase();

        const isOpen = right === 'open';
        let ok = false;

        card.classList.remove('correct','incorrect');
        if (!isOpen) {
          ok = right && (mine === right || right.split('|').some(x => x.trim() === mine));
          card.classList.add(ok ? 'correct' : 'incorrect');
          if (ok) correct++;
        }

        const fb = card.querySelector('.feedback');
        const hint = card.dataset.hint || '';
        const expl = card.dataset.explanation || '';
        const head = isOpen ? "ℹ️ **Самопроверка.** Сравни свой ответ с эталоном."
                            : (ok ? "✅ **Верно.**" : "❌ **Неверно.**");

        fb.innerHTML = renderMarkdown(
          `${head}` +
          (userAns ? ` Твой ответ: \`${escapeMdInline(userAns)}\`.` : "") +
          (!isOpen && right ? `\n\n**Эталон:** ${right}` : "") +
          (hint ? `\n\n**Подсказка:** ${hint}` : "") +
          (expl ? `\n\n**Пояснение:** ${expl}` : "")
        );
      });

      const total = cards.length || 0;
      const score = total ? Math.round((correct/total)*100) : 0;
      result.textContent = `Результат: ${correct}/${total} (${score}%)`;
    });

    // прокрутка к тесту
    block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(s='') { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
  function escapeMdInline(s='') { return s.replace(/([_*`~])/g, '\\$1'); }

  function rerenderMath() {
    if (window.MathJax?.typesetPromise) {
      MathJax.typesetPromise();
    }
  }

  function setLoading(is) {
    sendBtn.disabled = is; input.disabled = is;
    sendBtn.textContent = is ? '…' : 'Отправить';
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';

    try {
      setLoading(true);
      if (state.awaitingNormalize) {
        const payload = getInputPayload(text);
        const norm = await api('/api/normalize', payload);
        state.awaitingNormalize = false;
        state.conversationTurn = norm?.conversation?.turn || 1;
        addMessage('assistant', `**Тема:** ${norm?.normalized?.topic || ''}\n\n**Цели:** ${(norm?.normalized?.goals||[]).join(', ')}`);
      } else {
        const chatRes = await api('/api/chat', { sessionId: state.sessionId, message: text });
        state.conversationTurn = chatRes?.conversation?.turn || (state.conversationTurn+1);
        const a = chatRes.assistant || {};

        // если пришли checks — подчистим текст, чтобы не было "второго" теста в тексте
        const cleanedMessage = (Array.isArray(a.checks) && a.checks.length)
          ? stripQuizLikeFromTextClient(a.message || '')
          : (a.message || '');

        const bubble = addMessage('assistant', cleanedMessage);
        setMastery(a?.tutor_state?.mastery ?? state.mastery, a?.tutor_state?.next_step ?? '');

        if (Array.isArray(a.checks) && a.checks.length) {
          renderInlineChecks(bubble, a.checks);
        }
      }
    } catch (e) {
      console.error(e);
      toast('Ошибка запроса. Проверь сервер.');
    } finally {
      setLoading(false);
    }
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // === Мобильное меню ===
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.hidden = false;
    state.sidebarOpen = true;
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.hidden = true;
    state.sidebarOpen = false;
  }
  toggleSidebarBtn?.addEventListener('click', () => {
    state.sidebarOpen ? closeSidebar() : openSidebar();
  });
  overlay?.addEventListener('click', closeSidebar);
  window.matchMedia('(max-width: 960px)').addEventListener('change', (e) => { if (!e.matches) closeSidebar(); });

  // Приветствие
  addMessage('assistant', 'Привет! Я помогу с учебой. Выбери параметры и напиши тему. Например: _Структура ядра клетки_ или _Квадратные уравнения_.');
});
