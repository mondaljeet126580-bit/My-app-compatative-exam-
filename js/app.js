/* ==========================================
   SSC Smart Study
   Core App Engine
   Final Version (UI-enhanced)
========================================== */

"use strict";

/* ---------- Global State ---------- */

const APP = {
  dataFolder: "data",
  currentPage: "",
  params: {},
  state: {
    category: null,
    subject: null,
    chapter: null,
  },
  mock: {
    data: null,
    index: 0,
    selected: {},
    timer: null,
    timeLeft: 0,
    startedAt: null,
  },
};

/* ---------- Helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

function escapeHTML(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dataPath(...parts) {
  return [APP.dataFolder, ...parts].filter(Boolean).join("/");
}

function getParams() {
  const url = new URL(window.location.href);
  return Object.fromEntries(url.searchParams.entries());
}

function getPageName() {
  return location.pathname.split("/").pop() || "index.html";
}

/* ---------- UI Enhancement Layer ----------
   Everything in this block is purely presentational:
   injected keyframes/classes, a fade transition for
   setAppHTML, a toast helper, skeleton placeholders,
   and a button ripple. No app logic lives here, and
   nothing here is referenced by the data/scoring code.
------------------------------------------------ */

function injectUIStyles() {
  if ($("#ui-enhancements-style")) return;

  const style = document.createElement("style");
  style.id = "ui-enhancements-style";
  style.textContent = `
    #app { transition: opacity 0.22s ease, transform 0.22s ease; }
    #app.app-fade { opacity: 0; transform: translateY(6px); }
    #app.app-fade-in { opacity: 1; transform: translateY(0); }

    .card, .question-box, .list-item {
      animation: uiFadeInUp 0.35s ease both;
    }
    .card-grid .card:nth-child(1) { animation-delay: 0.02s; }
    .card-grid .card:nth-child(2) { animation-delay: 0.06s; }
    .card-grid .card:nth-child(3) { animation-delay: 0.10s; }
    .card-grid .card:nth-child(4) { animation-delay: 0.14s; }
    .card-grid .card:nth-child(5) { animation-delay: 0.18s; }
    .card-grid .card:nth-child(6) { animation-delay: 0.22s; }

    @keyframes uiFadeInUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .btn {
      position: relative;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:active { transform: scale(0.97); }
    .ui-ripple {
      position: absolute;
      border-radius: 50%;
      transform: scale(0);
      background: rgba(255, 255, 255, 0.55);
      pointer-events: none;
      animation: uiRipple 0.55s ease-out;
    }
    .btn-outline .ui-ripple { background: rgba(11, 61, 145, 0.18); }
    @keyframes uiRipple {
      to { transform: scale(2.6); opacity: 0; }
    }

    .option { transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
    .option:active { transform: scale(0.99); }

    .ui-skeleton {
      background: linear-gradient(90deg, #eceff3 25%, #f6f7f9 37%, #eceff3 63%);
      background-size: 400% 100%;
      animation: uiShimmer 1.3s ease infinite;
      border-radius: 10px;
    }
    @keyframes uiShimmer {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }
    .ui-skeleton-line { height: 14px; margin-bottom: 10px; }
    .ui-skeleton-icon { width: 44px; height: 44px; border-radius: 12px; margin-bottom: 14px; }

    #ui-toast-stack {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      pointer-events: none;
    }
    .ui-toast {
      pointer-events: auto;
      min-width: 180px;
      max-width: 90vw;
      padding: 12px 18px;
      border-radius: 12px;
      background: #101828;
      color: #fff;
      font-size: 0.92rem;
      font-weight: 500;
      box-shadow: 0 10px 24px rgba(16, 24, 40, 0.25);
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .ui-toast.show { opacity: 1; transform: translateY(0); }
    .ui-toast.success { background: #16814f; }
    .ui-toast.error { background: #cf3b3b; }

    @media (prefers-reduced-motion: reduce) {
      #app, .card, .question-box, .list-item, .ui-toast, .ui-ripple, .ui-skeleton {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function showToast(message, type = "") {
  let stack = $("#ui-toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "ui-toast-stack";
    document.body.appendChild(stack);
  }

  const toast = document.createElement("div");
  toast.className = `ui-toast${type ? " " + type : ""}`;
  toast.textContent = message;
  stack.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function skeletonCardsHTML(count = 6) {
  let out = "";
  for (let i = 0; i < count; i++) {
    out += `
      <div class="card">
        <div class="ui-skeleton ui-skeleton-icon"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:70%;"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:90%;"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:40%;height:36px;border-radius:12px;margin-top:6px;"></div>
      </div>
    `;
  }
  return `<section class="section"><div class="card-grid">${out}</div></section>`;
}

function skeletonBlockHTML() {
  return `
    <section class="section">
      <div class="notes-box">
        <div class="ui-skeleton ui-skeleton-line" style="width:50%;height:22px;"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:100%;"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:95%;"></div>
        <div class="ui-skeleton ui-skeleton-line" style="width:80%;"></div>
      </div>
    </section>
  `;
}

function bindRippleEffect() {
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest(".btn");
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "ui-ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${(e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
      ripple.style.top = `${(e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
      btn.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 600);
    },
    true
  );
}

/* ---------- End UI Enhancement Layer ---------- */

function setAppHTML(html) {
  let root = $("#app");
  if (!root) {
    root = document.createElement("section");
    root.id = "app";
    document.body.appendChild(root);
  }

  // Visual-only fade transition; content is still assigned synchronously
  // below so any code that queries the DOM right after calling this
  // function keeps working exactly as before.
  root.classList.add("app-fade");
  root.innerHTML = html;
  requestAnimationFrame(() => {
    root.classList.add("app-fade-in");
  });
  window.setTimeout(() => {
    root.classList.remove("app-fade", "app-fade-in");
  }, 260);
}

async function loadJSON(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load: ${path}`);
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

function makeLink(page, params = {}) {
  const url = new URL(page, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.pathname.split("/").pop() + url.search;
}

function formatTitle(text) {
  return String(text || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function saveResult(result) {
  localStorage.setItem("ssc-smart-study:last-result", JSON.stringify(result));
}

function getLastResult() {
  try {
    return JSON.parse(localStorage.getItem("ssc-smart-study:last-result")) || null;
  } catch {
    return null;
  }
}

function saveProgress(key, value) {
  localStorage.setItem(`ssc-smart-study:${key}`, JSON.stringify(value));
}

function getProgress(key, fallback = null) {
  try {
    const data = localStorage.getItem(`ssc-smart-study:${key}`);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Navigation ---------- */

function goTo(page, params = {}) {
  window.location.href = makeLink(page, params);
}

window.goTo = goTo;

/* ---------- Home ---------- */

async function renderHome() {
  setAppHTML(skeletonCardsHTML(6));

  const menu = await loadJSON(dataPath("menu.json"));
  if (!Array.isArray(menu)) {
    setAppHTML(`
      <div class="card">
        <h3>Menu not found</h3>
        <p>Please create <b>data/menu.json</b>.</p>
      </div>
    `);
    return;
  }

  const cards = menu
    .map(
      (item) => `
      <div class="card">
        <div class="icon">${escapeHTML(item.icon || "📁")}</div>
        <h3>${escapeHTML(item.name || item.title || "Item")}</h3>
        <p>${escapeHTML(item.description || "Open section")}</p>
        <button class="btn mt-16" onclick="goTo('study.html', { category: '${escapeHTML(
          item.folder || item.slug || ""
        )}' })">Open</button>
      </div>
    `
    )
    .join("");

  setAppHTML(`
    <section class="section">
      <h2 class="page-title">Select Category</h2>
      <div class="card-grid">
        ${cards}
      </div>
    </section>
  `);
}

/* ---------- Study Navigator ---------- */

async function renderStudyPage() {
  const { category, subject, chapter } = APP.params;

  // Top level: show categories
  if (!category) {
    await renderHome();
    return;
  }

  // Level 1: category items
  if (category && !subject) {
    setAppHTML(skeletonCardsHTML(6));
    const items = await loadJSON(dataPath(category, "items.json"));

    if (!Array.isArray(items)) {
      setAppHTML(`
        <div class="card">
          <h3>Coming Soon</h3>
          <p>No items found for <b>${escapeHTML(formatTitle(category))}</b>.</p>
        </div>
      `);
      return;
    }

    const html = items
      .map(
        (item) => `
        <div class="card">
          <div class="icon">${escapeHTML(item.icon || "📄")}</div>
          <h3>${escapeHTML(item.title || item.name || "Item")}</h3>
          <p>${escapeHTML(item.note || "Open next level")}</p>
          <button class="btn mt-16" onclick="goTo('study.html', {
            category: '${escapeHTML(category)}',
            subject: '${escapeHTML(item.folder || item.slug || "")}'
          })">Open</button>
        </div>
      `
      )
      .join("");

    setAppHTML(`
      <section class="section">
        <h2 class="page-title">${escapeHTML(formatTitle(category))}</h2>
        <div class="card-grid">${html}</div>
      </section>
    `);
    return;
  }

  // Level 2: subject items
  if (category && subject && !chapter) {
    setAppHTML(skeletonCardsHTML(6));
    const items = await loadJSON(dataPath(category, subject, "items.json"));

    if (!Array.isArray(items)) {
      setAppHTML(`
        <div class="card">
          <h3>Coming Soon</h3>
          <p>No chapters found for <b>${escapeHTML(formatTitle(subject))}</b>.</p>
        </div>
      `);
      return;
    }

    const html = items
      .map(
        (item) => `
        <div class="card">
          <div class="icon">${escapeHTML(item.icon || "📚")}</div>
          <h3>${escapeHTML(item.title || item.name || "Chapter")}</h3>
          <p>${escapeHTML(item.note || "Open chapter")}</p>
          <button class="btn mt-16" onclick="goTo('study.html', {
            category: '${escapeHTML(category)}',
            subject: '${escapeHTML(subject)}',
            chapter: '${escapeHTML(item.folder || item.slug || "")}'
          })">Open</button>
        </div>
      `
      )
      .join("");

    setAppHTML(`
      <section class="section">
        <h2 class="page-title">${escapeHTML(formatTitle(subject))}</h2>
        <div class="card-grid">${html}</div>
      </section>
    `);
    return;
  }

  // Level 3: chapter actions
  if (category && subject && chapter) {
    setAppHTML(`
      <section class="section">
        <h2 class="page-title">${escapeHTML(formatTitle(chapter))}</h2>
        <div class="card-grid">
          <div class="card">
            <div class="icon">📖</div>
            <h3>Notes</h3>
            <p>Read chapter notes</p>
            <button class="btn mt-16" onclick="goTo('notes.html', { category: '${escapeHTML(category)}', subject: '${escapeHTML(subject)}', chapter: '${escapeHTML(chapter)}' })">Open</button>
          </div>

          <div class="card">
            <div class="icon">📝</div>
            <h3>MCQ Practice</h3>
            <p>Practice questions</p>
            <button class="btn mt-16" onclick="goTo('mcq.html', { category: '${escapeHTML(category)}', subject: '${escapeHTML(subject)}', chapter: '${escapeHTML(chapter)}' })">Open</button>
          </div>

          <div class="card">
            <div class="icon">🎯</div>
            <h3>Mock Test</h3>
            <p>Chapter test with timer</p>
            <button class="btn mt-16" onclick="goTo('mock-test.html', { category: '${escapeHTML(category)}', subject: '${escapeHTML(subject)}', chapter: '${escapeHTML(chapter)}' })">Open</button>
          </div>

          <div class="card">
            <div class="icon">📄</div>
            <h3>Previous Year</h3>
            <p>Previous year questions</p>
            <button class="btn mt-16" onclick="goTo('previous-year.html', { category: '${escapeHTML(category)}', subject: '${escapeHTML(subject)}', chapter: '${escapeHTML(chapter)}' })">Open</button>
          </div>
        </div>
      </section>
    `);
  }
}

/* ---------- Notes ---------- */

async function renderNotesPage() {
  const { category, subject, chapter } = APP.params;
  setAppHTML(skeletonBlockHTML());

  const path = dataPath(category, subject, chapter, "notes.json");
  const data = await loadJSON(path);

  if (!data) {
    setAppHTML(`<div class="card"><h3>Notes Not Available</h3><p>${escapeHTML(path)}</p></div>`);
    return;
  }

  let content = "";

  if (Array.isArray(data.sections)) {
    content = data.sections
      .map(
        (sec) => `
        <h3>${escapeHTML(sec.heading || "")}</h3>
        <p>${escapeHTML(sec.content || "")}</p>
      `
      )
      .join("");
  } else if (data.content) {
    content = `<p>${escapeHTML(data.content)}</p>`;
  } else {
    content = `<p>No notes content found.</p>`;
  }

  setAppHTML(`
    <section class="section">
      <h2 class="page-title">${escapeHTML(data.title || formatTitle(chapter) || "Notes")}</h2>
      <div class="notes-box">
        ${content}
      </div>
      <div class="mt-20">
        <button class="btn btn-outline" onclick="history.back()">Back</button>
      </div>
    </section>
  `);
}

/* ---------- MCQ Practice ---------- */

async function renderMCQPage() {
  const { category, subject, chapter } = APP.params;
  setAppHTML(skeletonBlockHTML());

  const path = dataPath(category, subject, chapter, "mcq.json");
  const data = await loadJSON(path);

  const questions = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : [];
  if (!questions.length) {
    setAppHTML(`<div class="card"><h3>MCQ Not Available</h3><p>${escapeHTML(path)}</p></div>`);
    return;
  }

  const html = questions
    .map((q, i) => {
      const opts = (q.options || [])
        .map(
          (opt, idx) => `
          <label class="option">
            <input type="radio" name="q_${i}" value="${idx}" />
            ${escapeHTML(opt)}
          </label>
        `
        )
        .join("");

      return `
        <div class="question-box">
          <h3>${i + 1}. ${escapeHTML(q.question || "")}</h3>
          <div class="option-list">${opts}</div>
          <p class="mt-16 hidden" id="mcq-result-${i}"></p>
        </div>
      `;
    })
    .join("");

  setAppHTML(`
    <section class="section">
      <h2 class="page-title">${escapeHTML(data.title || formatTitle(chapter) || "MCQ Practice")}</h2>
      ${html}
      <div class="mt-20">
        <button class="btn" onclick="checkMCQ()">Submit Practice</button>
        <button class="btn btn-outline" onclick="history.back()">Back</button>
      </div>
    </section>
  `);

  window.checkMCQ = function () {
    questions.forEach((q, i) => {
      const selected = document.querySelector(`input[name="q_${i}"]:checked`);
      const result = document.getElementById(`mcq-result-${i}`);
      if (!selected) {
        result.textContent = "Not answered.";
        result.className = "mt-16 wrong";
        result.classList.remove("hidden");
        return;
      }

      const answer = Number(selected.value) === Number(q.answer);
      result.textContent = answer
        ? `Correct: ${q.explanation || "Good job!"}`
        : `Wrong. Correct answer: ${(q.options || [])[q.answer] || "N/A"}${q.explanation ? ` | ${q.explanation}` : ""}`;
      result.className = answer ? "mt-16 correct" : "mt-16 wrong";
      result.classList.remove("hidden");
    });
  };
}

/* ---------- Mock Test ---------- */

function getMockDefaults(settings = {}) {
  return {
    time: Number(settings.time ?? 0),
    questionsPerPage: Number(settings.questionsPerPage ?? 1),
    negativeMarking: Boolean(settings.negativeMarking ?? false),
    negativeMarks: Number(settings.negativeMarks ?? 0),
    shuffleQuestions: Boolean(settings.shuffleQuestions ?? false),
    shuffleOptions: Boolean(settings.shuffleOptions ?? false),
    showExplanation: Boolean(settings.showExplanation ?? true),
    showResult: Boolean(settings.showResult ?? true),
    showReview: Boolean(settings.showReview ?? true),
    showQuestionPalette: Boolean(settings.showQuestionPalette ?? true),
    allowPrevious: Boolean(settings.allowPrevious ?? true),
    autoSubmit: Boolean(settings.autoSubmit ?? true),
    passPercentage: Number(settings.passPercentage ?? 40),
  };
}

function shuffleArray(arr = []) {
  return [...arr].sort(() => Math.random() - 0.5);
}

async function renderMockTestPage() {
  const { category, subject, chapter } = APP.params;
  setAppHTML(skeletonBlockHTML());

  const path = dataPath(category, subject, chapter, "mock-test.json");
  const data = await loadJSON(path);

  if (!data) {
    setAppHTML(`<div class="card"><h3>Mock Test Not Available</h3><p>${escapeHTML(path)}</p></div>`);
    return;
  }

  const settings = getMockDefaults(data.settings || data);
  let questions = Array.isArray(data) ? data : Array.isArray(data.questions) ? data.questions : [];

  if (!questions.length) {
    setAppHTML(`<div class="card"><h3>No Questions</h3><p>Add questions in mock-test.json</p></div>`);
    return;
  }

  if (settings.shuffleQuestions) questions = shuffleArray(questions);
  if (settings.shuffleOptions) {
    questions = questions.map((q) => {
      const options = [...(q.options || [])];
      const map = options.map((opt, idx) => ({ opt, idx }));
      const shuffled = shuffleArray(map);
      const answerText = options[q.answer];
      return {
        ...q,
        options: shuffled.map((x) => x.opt),
        answer: shuffled.findIndex((x) => x.opt === answerText),
      };
    });
  }

  APP.mock.data = { settings, questions, title: data.title || formatTitle(chapter) };
  APP.mock.index = 0;
  APP.mock.selected = {};
  APP.mock.timeLeft = settings.time ? settings.time * 60 : 0;
  APP.mock.startedAt = Date.now();

  const saved = getProgress(`mock:${category}:${subject}:${chapter}`);
  if (saved && saved.questions) {
    APP.mock = {
      ...APP.mock,
      ...saved,
      data: APP.mock.data,
    };
  }

  const render = () => {
    const q = APP.mock.data.questions[APP.mock.index];
    const total = APP.mock.data.questions.length;
    const progress = total ? ((APP.mock.index + 1) / total) * 100 : 0;

    const timerHTML = settings.time
      ? `<div class="timer">Time Left: <span id="timerValue">${formatTime(APP.mock.timeLeft)}</span></div>`
      : "";

    const paletteHTML = settings.showQuestionPalette
      ? `<div class="card" style="margin-bottom:16px;">
           <strong>Question Palette</strong>
           <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
             ${APP.mock.data.questions
               .map(
                 (_, idx) => `
                 <button class="btn ${idx === APP.mock.index ? "" : "btn-outline"}" style="min-width:44px;padding:10px 12px;" onclick="goMockQuestion(${idx})">${idx + 1}</button>
               `
               )
               .join("")}
           </div>
         </div>`
      : "";

    const optionsHTML = (q.options || [])
      .map(
        (opt, idx) => `
        <label class="option ${APP.mock.selected[APP.mock.index] === idx ? "selected" : ""}">
          <input type="radio" name="mock-option" value="${idx}" ${APP.mock.selected[APP.mock.index] === idx ? "checked" : ""}/>
          ${escapeHTML(opt)}
        </label>
      `
      )
      .join("");

    setAppHTML(`
      <section class="section">
        <h2 class="page-title">${escapeHTML(APP.mock.data.title)}</h2>
        ${timerHTML}
        <div class="progress-wrap"><div class="progress-bar" style="width:${progress}%"></div></div>
        ${paletteHTML}
        <div class="question-box">
          <h3>Question ${APP.mock.index + 1} of ${total}</h3>
          <h3>${escapeHTML(q.question || "")}</h3>
          <div class="option-list" id="mockOptions">${optionsHTML}</div>
        </div>
        <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
          <button class="btn btn-outline" ${APP.mock.index === 0 || !settings.allowPrevious ? "disabled" : ""} onclick="goMockPrev()">Previous</button>
          <button class="btn btn-outline" onclick="goMockSave()">Save</button>
          ${APP.mock.index < total - 1 ? `<button class="btn" onclick="goMockNext()">Next</button>` : `<button class="btn btn-success" onclick="goMockSubmit()">Submit</button>`}
        </div>
      </section>
    `);

    // Visual-only: keep the learner oriented at the top of the question
    // when moving between questions in this single-page view.
    window.scrollTo({ top: 0, behavior: "smooth" });

    document.querySelectorAll('input[name="mock-option"]').forEach((el) => {
      el.addEventListener("change", () => {
        APP.mock.selected[APP.mock.index] = Number(el.value);
        saveProgress(`mock:${category}:${subject}:${chapter}`, {
          index: APP.mock.index,
          selected: APP.mock.selected,
          timeLeft: APP.mock.timeLeft,
          questions: APP.mock.data.questions,
        });
      });
    });

    if (settings.time && !APP.mock.timer) {
      APP.mock.timer = setInterval(() => {
        APP.mock.timeLeft -= 1;
        const timerEl = $("#timerValue");
        if (timerEl) timerEl.textContent = formatTime(APP.mock.timeLeft);

        if (APP.mock.timeLeft <= 0) {
          clearInterval(APP.mock.timer);
          APP.mock.timer = null;
          goMockSubmit(true);
        }
      }, 1000);
    }
  };

  window.goMockQuestion = (idx) => {
    APP.mock.index = idx;
    render();
  };

  window.goMockPrev = () => {
    if (APP.mock.index > 0) {
      APP.mock.index -= 1;
      render();
    }
  };

  window.goMockNext = () => {
    if (APP.mock.index < APP.mock.data.questions.length - 1) {
      APP.mock.index += 1;
      render();
    }
  };

  window.goMockSave = () => {
    saveProgress(`mock:${category}:${subject}:${chapter}`, {
      index: APP.mock.index,
      selected: APP.mock.selected,
      timeLeft: APP.mock.timeLeft,
      questions: APP.mock.data.questions,
    });
    showToast("Progress saved", "success");
  };

  window.goMockSubmit = (auto = false) => {
    if (APP.mock.timer) {
      clearInterval(APP.mock.timer);
      APP.mock.timer = null;
    }

    const summary = evaluateMockTest(APP.mock.data.questions, APP.mock.selected, settings);
    const result = {
      ...summary,
      title: APP.mock.data.title,
      category,
      subject,
      chapter,
      timeTaken: settings.time ? settings.time * 60 - APP.mock.timeLeft : Math.floor((Date.now() - APP.mock.startedAt) / 1000),
      auto,
      questions: APP.mock.data.questions,
      selected: APP.mock.selected,
    };

    saveResult(result);
    localStorage.removeItem(`ssc-smart-study:mock:${category}:${subject}:${chapter}`);
    goTo("result.html", { category, subject, chapter });
  };

  render();
}

function evaluateMockTest(questions, selected, settings) {
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  const review = questions.map((q, idx) => {
    const chosen = selected[idx];
    const isAnswered = chosen !== undefined && chosen !== null;
    const isCorrect = isAnswered && Number(chosen) === Number(q.answer);

    if (!isAnswered) unanswered += 1;
    else if (isCorrect) correct += 1;
    else wrong += 1;

    return {
      question: q.question,
      options: q.options || [],
      answer: q.answer,
      chosen,
      explanation: q.explanation || "",
      correct: isCorrect,
    };
  });

  const total = questions.length;
  const negative = settings.negativeMarking ? wrong * Number(settings.negativeMarks || 0) : 0;
  const score = Math.max(0, correct - negative);
  const percentage = total ? ((score / total) * 100).toFixed(2) : "0.00";

  return {
    total,
    correct,
    wrong,
    unanswered,
    score,
    negative,
    percentage,
    review,
    passPercentage: settings.passPercentage || 40,
    passed: Number(percentage) >= Number(settings.passPercentage || 40),
  };
}

function formatTime(sec) {
  const s = Math.max(0, Number(sec || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ---------- Result ---------- */

function renderResultPage() {
  const result = getLastResult();

  if (!result) {
    setAppHTML(`
      <div class="card">
        <h3>No Result Found</h3>
        <p>Take a mock test first.</p>
      </div>
    `);
    return;
  }

  const reviewHTML = (result.review || [])
    .map(
      (r, idx) => `
      <div class="question-box">
        <h3>Q${idx + 1}. ${escapeHTML(r.question || "")}</h3>
        <p class="${r.correct ? "correct" : "wrong"}">
          ${r.correct ? "Correct" : "Wrong"}
        </p>
        <p><b>Your Answer:</b> ${escapeHTML(r.options[r.chosen] || "Not Answered")}</p>
        <p><b>Correct Answer:</b> ${escapeHTML(r.options[r.answer] || "N/A")}</p>
        ${r.explanation ? `<p class="mt-10"><b>Explanation:</b> ${escapeHTML(r.explanation)}</p>` : ""}
      </div>
    `
    )
    .join("");

  setAppHTML(`
    <section class="section">
      <h2 class="page-title">Mock Test Result</h2>

      <div class="result-card">
        <div class="result-grid">
          <div class="result-item"><span>Total</span><strong>${result.total}</strong></div>
          <div class="result-item"><span>Correct</span><strong class="correct">${result.correct}</strong></div>
          <div class="result-item"><span>Wrong</span><strong class="wrong">${result.wrong}</strong></div>
          <div class="result-item"><span>Unanswered</span><strong>${result.unanswered}</strong></div>
          <div class="result-item"><span>Score</span><strong>${result.score}</strong></div>
          <div class="result-item"><span>Percentage</span><strong>${result.percentage}%</strong></div>
          <div class="result-item"><span>Time Taken</span><strong>${formatTime(result.timeTaken || 0)}</strong></div>
          <div class="result-item"><span>Status</span><strong class="${result.passed ? "correct" : "wrong"}">${result.passed ? "Passed" : "Failed"}</strong></div>
        </div>

        <div class="card-grid mt-20">
          <button class="btn btn-outline" onclick="history.back()">Back</button>
          <button class="btn" onclick="location.reload()">Review Again</button>
        </div>
      </div>

      <div class="mt-20">
        <h2 class="page-title">Review Answers</h2>
        ${reviewHTML}
      </div>
    </section>
  `);
}

/* ---------- Boot ---------- */

async function boot() {
  injectUIStyles();
  bindRippleEffect();

  APP.currentPage = getPageName();
  APP.params = getParams();
  APP.state.category = APP.params.category || null;
  APP.state.subject = APP.params.subject || null;
  APP.state.chapter = APP.params.chapter || null;

  if (APP.currentPage === "index.html" || APP.currentPage === "") {
    await renderHome();
    return;
  }

  if (APP.currentPage === "study.html") {
    await renderStudyPage();
    return;
  }

  if (APP.currentPage === "notes.html") {
    await renderNotesPage();
    return;
  }

  if (APP.currentPage === "mcq.html") {
    await renderMCQPage();
    return;
  }

  if (APP.currentPage === "mock-test.html") {
    await renderMockTestPage();
    return;
  }

  if (APP.currentPage === "result.html") {
    renderResultPage();
    return;
  }

  // Fallback
  await renderHome();
}

document.addEventListener("DOMContentLoaded", boot);
