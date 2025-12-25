// app.js (ES Module)
import { quizMeta, passages, questions } from "./data.js";

const STORAGE_KEY = "eng_quiz_state_v4";

// ====== DOM ======
const modeSelect = document.getElementById("modeSelect");
const shuffleToggle = document.getElementById("shuffleToggle");
const timerToggle = document.getElementById("timerToggle");
const timerBox = document.getElementById("timerBox");

const resetBtn = document.getElementById("resetBtn");
const submitBtn = document.getElementById("submitBtn");
const csvBtn = document.getElementById("csvBtn");
const jumpFirstWrongBtn = document.getElementById("jumpFirstWrongBtn");

const studentLine = document.getElementById("studentLine");
const sectionLine = document.getElementById("sectionLine");
const qidLabel = document.getElementById("qidLabel");
const qText = document.getElementById("qText");
const optionsBox = document.getElementById("optionsBox");
const questionNav = document.getElementById("questionNav");
const sideSub = document.getElementById("sideSub");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const afterSubmitBox = document.getElementById("afterSubmitBox");
const scoreBox = document.getElementById("scoreBox");
const explainBox = document.getElementById("explainBox");
const progressLine = document.getElementById("progressLine");

const loginModal = document.getElementById("loginModal");
const nameInput = document.getElementById("nameInput");
const classInput = document.getElementById("classInput");
const loginBtn = document.getElementById("loginBtn");

// ====== Title meta (optional) ======
document.title = quizMeta?.title || document.title;

// ====== State ======
let state = loadState() || makeDefaultState();
let timerHandle = null;

// ====== Init ======
init();

function init() {
  // Login gate
  if (!state.student?.name || !state.student?.className) openLogin();
  else setStudentLine();

  modeSelect.value = state.mode;
  shuffleToggle.checked = state.shuffle;
  timerToggle.checked = state.timerOn;

  sanitizeForMode();
  buildAttemptOrder(); // random A/B/C/D
  renderNav();
  renderCurrent();
  startOrStopTimer();

  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    sanitizeForMode(true);
    buildAttemptOrder(true);
    state.currentIndex = 0;
    state.submitted = false;
    saveState();
    renderNav();
    renderCurrent();
    startOrStopTimer();
  });

  shuffleToggle.addEventListener("change", () => {
    state.shuffle = shuffleToggle.checked;
    buildAttemptOrder(true);
    saveState();
    renderNav();
    renderCurrent();
  });

  timerToggle.addEventListener("change", () => {
    state.timerOn = timerToggle.checked;
    saveState();
    startOrStopTimer();
  });

  prevBtn.addEventListener("click", () => gotoIndex(state.currentIndex - 1));
  nextBtn.addEventListener("click", () => gotoIndex(state.currentIndex + 1));

  resetBtn.addEventListener("click", () => {
    const keepStudent = state.student;
    const keepMode = modeSelect.value;
    const keepShuffle = shuffleToggle.checked;
    const keepTimer = timerToggle.checked;

    state = makeDefaultState();
    state.student = keepStudent;
    state.mode = keepMode;
    state.shuffle = keepShuffle;
    state.timerOn = keepTimer;

    sanitizeForMode(true);
    buildAttemptOrder(true);
    saveState();
    renderNav();
    renderCurrent();
    startOrStopTimer();
  });

  submitBtn.addEventListener("click", () => {
    if (state.submitted) return;
    state.submitted = true;
    saveState();
    renderNav();
    renderCurrent();
  });

  csvBtn.addEventListener("click", exportCSV);

  jumpFirstWrongBtn.addEventListener("click", () => {
    if (!state.submitted) return;
    const ids = getActiveQuestionIds();
    for (let i = 0; i < ids.length; i++) {
      const q = getQuestionById(ids[i]);
      const chosen = state.answers[q.id];
      if (!chosen) continue;
      if (chosen !== q.answer) {
        gotoIndex(i);
        return;
      }
    }
    alert("Không có câu sai (hoặc chưa chọn).");
  });

  loginBtn.addEventListener("click", () => {
    const n = nameInput.value.trim();
    const c = classInput.value.trim();
    if (!n || !c) {
      alert("Nhập đầy đủ Họ tên và Lớp nhé.");
      return;
    }
    state.student = { name: n, className: c };
    saveState();
    closeLogin();
    setStudentLine();
  });
}

// ====== Login ======
function openLogin() {
  loginModal.classList.add("show");
  loginModal.setAttribute("aria-hidden", "false");
}
function closeLogin() {
  loginModal.classList.remove("show");
  loginModal.setAttribute("aria-hidden", "true");
}
function setStudentLine() {
  studentLine.textContent = `Học sinh: ${state.student.name} | Lớp: ${state.student.className}`;
}

// ====== State helpers ======
function makeDefaultState() {
  return {
    student: { name: "", className: "" },
    mode: "50", // 50 = 601–650 ; 70 = 601–670
    shuffle: true,
    timerOn: true,
    startAt: Date.now(),
    elapsedSec: 0,
    submitted: false,
    currentIndex: 0,
    answers: {}, // qid -> "A"/"B"/"C"/"D"
    optionOrder: {}, // qid -> ["A","B","C","D"] (shuffled)
    seed: Math.floor(Math.random() * 1e9),
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ====== Question selection by mode ======
function getActiveQuestionIds() {
  const max = state.mode === "50" ? 650 : 670;
  return questions
    .filter((q) => q.id >= 601 && q.id <= max)
    .map((q) => q.id)
    .sort((a, b) => a - b);
}

function getQuestionById(id) {
  return questions.find((q) => q.id === Number(id));
}

function sanitizeForMode(forceReset = false) {
  const ids = getActiveQuestionIds();
  const set = new Set(ids.map(String));

  for (const k of Object.keys(state.answers || {})) {
    if (!set.has(String(k))) delete state.answers[k];
  }
  for (const k of Object.keys(state.optionOrder || {})) {
    if (!set.has(String(k))) delete state.optionOrder[k];
  }

  if (forceReset) {
    state.answers = {};
    state.submitted = false;
    state.startAt = Date.now();
    state.elapsedSec = 0;
  }

  if (state.currentIndex < 0) state.currentIndex = 0;
  if (state.currentIndex >= ids.length) state.currentIndex = ids.length - 1;

  saveState();
}

// ====== Random option order (A/B/C/D) with seed ======
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAttemptOrder(newAttempt = false) {
  const ids = getActiveQuestionIds();

  if (newAttempt) {
    state.seed = Math.floor(Math.random() * 1e9);
    state.optionOrder = {};
  }

  const rng = mulberry32(state.seed);
  const base = ["A", "B", "C", "D"];

  ids.forEach((id) => {
    if (!state.optionOrder[id]) {
      const arr = [...base];
      if (state.shuffle) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      }
      state.optionOrder[id] = arr;
    }
  });

  saveState();
}

// ====== Navigation ======
function gotoIndex(idx) {
  const ids = getActiveQuestionIds();
  if (idx < 0 || idx >= ids.length) return;
  state.currentIndex = idx;
  saveState();
  renderNav();
  renderCurrent();
}

function countAnswered(ids) {
  let n = 0;
  ids.forEach((id) => {
    if (state.answers[id]) n++;
  });
  return n;
}

function renderNav() {
  const ids = getActiveQuestionIds();
  questionNav.innerHTML = "";

  sideSub.textContent = `Tổng: ${ids.length} câu | Đã làm: ${countAnswered(ids)}/${ids.length}`;

  ids.forEach((id, i) => {
    const q = getQuestionById(id);
    const btn = document.createElement("button");
    btn.className = "qnav-btn";
    btn.textContent = id;
    btn.dataset.qid = id;

    if (i === state.currentIndex) btn.classList.add("active");
    if (state.answers[id]) btn.classList.add("answered"); // ✅ câu đã làm -> xanh

    if (state.submitted) {
      const chosen = state.answers[id];
      if (chosen) {
        if (chosen === q.answer) btn.classList.add("right");
        else btn.classList.add("wrong");
      }
    }

    btn.addEventListener("click", () => gotoIndex(i));
    questionNav.appendChild(btn);
  });

  csvBtn.disabled = !state.submitted;
  jumpFirstWrongBtn.disabled = !state.submitted;
}

// ====== Render current question + PASSAGE ======
function renderCurrent() {
  const ids = getActiveQuestionIds();
  const id = ids[state.currentIndex];
  const q = getQuestionById(id);

  sectionLine.textContent = q.section || "";
  qidLabel.textContent = `Câu ${q.id}`;
  qText.textContent = q.prompt || "";

  progressLine.textContent = `Câu ${state.currentIndex + 1}/${ids.length}`;

  // PASSAGE block (if this question belongs to a passage)
  const passageKey = q.passage;
  const passageObj = passageKey ? passages[passageKey] : null;

  // Render passage + question in same screen (đúng kiểu đề đọc hiểu)
  const passageHtml = passageObj
    ? `
      <div class="passage-wrap">
        <div class="passage-title">${escapeHtml(passageObj.title)}</div>
        <div class="passage-box">${escapeHtml(passageObj.text).replace(/\n/g, "<br>")}</div>
      </div>
    `
    : "";

  // Options render
  const order = state.optionOrder[q.id] || ["A", "B", "C", "D"];
  optionsBox.innerHTML = passageHtml + `<div class="options-inner" id="optionsInner"></div>`;

  const optionsInner = document.getElementById("optionsInner");
  optionsInner.innerHTML = "";

  order.forEach((letter) => {
    const row = document.createElement("div");
    row.className = "opt";
    row.dataset.qid = q.id;
    row.dataset.letter = letter;

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = letter;

    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = q.options[letter];

    row.appendChild(tag);
    row.appendChild(txt);

    const chosen = state.answers[q.id];
    if (chosen === letter) row.classList.add("selected");

    if (state.submitted) {
      if (letter === q.answer) row.classList.add("correct");
      if (chosen === letter && chosen !== q.answer) row.classList.add("wrong");
    } else {
      row.addEventListener("click", () => {
        state.answers[q.id] = letter;
        saveState();
        renderNav();     // ✅ update xanh ở sidebar
        renderCurrent(); // highlight selected
      });
    }

    optionsInner.appendChild(row);
  });

  // After submit explanation
  afterSubmitBox.hidden = !state.submitted;
  if (state.submitted) {
    const score = computeScore();
    scoreBox.textContent = `Điểm: ${score.correct}/${score.total} | ${score.percent.toFixed(1)}%`;
    explainBox.textContent = q.explanation ? `Giải thích:\n- ${q.explanation}` : "Giải thích: (chưa có)";
  } else {
    scoreBox.textContent = "";
    explainBox.textContent = "";
  }

  prevBtn.disabled = state.currentIndex === 0;
  nextBtn.disabled = state.currentIndex === ids.length - 1;
}

function computeScore() {
  const ids = getActiveQuestionIds();
  let correct = 0;
  ids.forEach((id) => {
    const q = getQuestionById(id);
    const chosen = state.answers[id];
    if (chosen && chosen === q.answer) correct++;
  });
  const total = ids.length;
  return { correct, total, percent: (correct / total) * 100 };
}

// ====== Timer ======
function startOrStopTimer() {
  if (timerHandle) clearInterval(timerHandle);

  if (!state.timerOn) {
    timerBox.textContent = "—";
    return;
  }

  timerHandle = setInterval(() => {
    const sec = Math.floor((Date.now() - state.startAt) / 1000) + (state.elapsedSec || 0);
    timerBox.textContent = fmtTime(sec);
  }, 500);
}

function fmtTime(s) {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ====== CSV Export ======
function exportCSV() {
  const ids = getActiveQuestionIds();
  const score = computeScore();

  const lines = [];
  lines.push(["Name", "Class", "Mode", "Total", "Correct", "Percent"].join(","));
  lines.push([
    csvEscape(state.student.name),
    csvEscape(state.student.className),
    state.mode,
    score.total,
    score.correct,
    score.percent.toFixed(1),
  ].join(","));

  lines.push("");
  lines.push(["QID", "Section", "YourChoice", "CorrectAnswer", "Result"].join(","));

  ids.forEach((id) => {
    const q = getQuestionById(id);
    const chosen = state.answers[id] || "";
    const result = chosen ? (chosen === q.answer ? "RIGHT" : "WRONG") : "BLANK";
    lines.push([
      id,
      csvEscape(q.section),
      csvEscape(chosen),
      csvEscape(q.answer),
      result
    ].join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `result_${safeName(state.student.name)}_${state.mode}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function csvEscape(s) {
  const str = String(s ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
function safeName(s) {
  return String(s || "student")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]/g, "");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
