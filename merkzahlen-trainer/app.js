
/*
  Merkzahlen Trainer
  - Single-file SPA + PWA
  - localStorage Leitner/Spaced repetition (simple but effective)
  - Modes: cards, multiple choice, typing
*/

const $ = (sel) => document.querySelector(sel);

const els = {
  deckSelect: $("#deckSelect"),
  modeSelect: $("#modeSelect"),
  dirSelect: $("#dirSelect"),
  difficulty: $("#difficulty"),
  sessionSize: $("#sessionSize"),
  startBtn: $("#startBtn"),
  shuffleBtn: $("#shuffleBtn"),
  resetBtn: $("#resetBtn"),

  playCard: $("#playCard"),
  playTitle: $("#playTitle"),
  playHint: $("#playHint"),

  qIndex: $("#qIndex"),
  qScore: $("#qScore"),
  qStreak: $("#qStreak"),
  question: $("#question"),
  answer: $("#answer"),

  mcArea: $("#mcArea"),
  typeArea: $("#typeArea"),
  typeInput: $("#typeInput"),
  checkBtn: $("#checkBtn"),

  revealBtn: $("#revealBtn"),
  goodBtn: $("#goodBtn"),
  badBtn: $("#badBtn"),
  nextBtn: $("#nextBtn"),

  sCorrect: $("#sCorrect"),
  sWrong: $("#sWrong"),
  sAcc: $("#sAcc"),

  statDue: $("#statDue"),
  statMastered: $("#statMastered"),

  installBtn: $("#installBtn"),
};

const STORAGE_KEY = "merkzahlen_trainer_v1";
const DAY = 24 * 60 * 60 * 1000;

// Leitner intervals (box -> ms)
const INTERVALS = [0, 1, 3, 7, 14, 30, 60].map(d => d * DAY);

let DB = null;
let session = null;
let installPrompt = null;

function now() { return Date.now(); }

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replaceAll("–","-")
    .replaceAll("—","-")
    .replace(/[^\p{L}\p{N}\s\-\.\/]/gu,"")
    .replace(/\s+/g," ")
    .trim();
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function ensureCardState(p, cardId) {
  if (!p[cardId]) {
    p[cardId] = { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 };
  }
  return p[cardId];
}

function computeStats(deckCards, p) {
  let due = 0;
  let mastered = 0;
  const t = now();
  for (const c of deckCards) {
    const st = ensureCardState(p, c.id);
    if (st.box >= 5) mastered++;
    if (st.due <= t) due++;
  }
  return { due, mastered, total: deckCards.length };
}

function chooseCards(deckCards, p, difficulty, n) {
  const t = now();
  const arr = deckCards.slice();
  const dueCards = arr.filter(c => ensureCardState(p,c.id).due <= t);
  const newCards = arr.filter(c => ensureCardState(p,c.id).seen === 0);

  let pick = [];
  if (difficulty === "due") {
    pick = dueCards;
  } else if (difficulty === "new") {
    // prioritize new, then due
    pick = [...newCards, ...dueCards.filter(c => !newCards.includes(c))];
  } else {
    // mix: weighted towards due
    pick = [...dueCards, ...arr.filter(c => !dueCards.includes(c))];
  }

  // De-duplicate (just in case)
  const seenIds = new Set();
  pick = pick.filter(c => (seenIds.has(c.id) ? false : (seenIds.add(c.id), true)));

  // If too short, fallback to full deck
  if (pick.length < n) pick = arr;

  shuffle(pick);
  return pick.slice(0, n);
}

function shuffle(a){
  for (let i=a.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function directionPair(card, dir){
  if (dir === "event2year") {
    return { q: card.answer, a: card.prompt };
  }
  return { q: card.prompt, a: card.answer };
}

function startSession(){
  const deckName = els.deckSelect.value;
  const mode = els.modeSelect.value;
  const dir = els.dirSelect.value;
  const diff = els.difficulty.value;
  const n = Math.max(5, Math.min(100, Number(els.sessionSize.value || 20)));

  const progress = loadProgress();
  const deckCards = DB[deckName];
  const chosen = chooseCards(deckCards, progress, diff, n);

  session = {
    deckName, mode, dir,
    cards: chosen,
    idx: 0,
    score: 0,
    streak: 0,
    correct: 0,
    wrong: 0,
    progress
  };

  els.playCard.hidden = false;
  els.playTitle.textContent = `Session: ${deckName}`;
  els.playHint.textContent = mode === "cards"
    ? "Erst denken, dann gucken. Oder andersrum. Menschen halt."
    : mode === "mc"
    ? "Vier Antworten, eine Wahrheit."
    : "Tippen ist wie Denken, nur mit Tippgeräuschen.";

  renderQuestion();
  updateMiniStats();
  updateSetupStats();
  window.scrollTo({top: 0, behavior:"smooth"});
}

function endSession(){
  // persist
  saveProgress(session.progress);

  const acc = session.correct + session.wrong > 0
    ? Math.round((session.correct/(session.correct+session.wrong))*100) + "%"
    : "–";

  els.playHint.textContent = `Fertig. Score ${session.score}. Genauigkeit ${acc}. Dein Gehirn bekommt heute keinen Applaus, aber Respekt.`;
  els.revealBtn.hidden = true;
  els.goodBtn.hidden = true;
  els.badBtn.hidden = true;
  els.nextBtn.hidden = true;
  els.mcArea.hidden = true;
  els.typeArea.hidden = true;
  els.answer.hidden = false;
  els.answer.textContent = "Session beendet. Du kannst oben eine neue starten.";
}

function updateMiniStats(){
  els.sCorrect.textContent = String(session.correct);
  els.sWrong.textContent = String(session.wrong);
  const total = session.correct + session.wrong;
  els.sAcc.textContent = total ? (Math.round(session.correct/total*100) + "%") : "–";
}

function updateHeaderStats(){
  els.qScore.textContent = `Score: ${session.score}`;
  els.qStreak.textContent = `Streak: ${session.streak}`;
  els.qIndex.textContent = `${session.idx+1}/${session.cards.length}`;
}

function showRevealButtons(){
  els.revealBtn.hidden = false;
  els.goodBtn.hidden = true;
  els.badBtn.hidden = true;
  els.nextBtn.hidden = true;
}

function showRatingButtons(){
  els.revealBtn.hidden = true;
  els.goodBtn.hidden = false;
  els.badBtn.hidden = false;
  els.nextBtn.hidden = true;
}

function showNextOnly(){
  els.revealBtn.hidden = true;
  els.goodBtn.hidden = true;
  els.badBtn.hidden = true;
  els.nextBtn.hidden = false;
}

function renderQuestion(){
  if (!session) return;

  if (session.idx >= session.cards.length){
    endSession();
    updateSetupStats();
    return;
  }

  updateHeaderStats();

  const card = session.cards[session.idx];
  const pair = directionPair(card, session.dir);

  els.question.textContent = pair.q;
  els.answer.textContent = pair.a;
  els.answer.hidden = true;

  // reset mode areas
  els.mcArea.innerHTML = "";
  els.mcArea.hidden = true;
  els.typeArea.hidden = true;
  els.typeInput.value = "";

  if (session.mode === "cards"){
    showRevealButtons();
  } else if (session.mode === "mc"){
    renderMC(card, pair);
  } else {
    renderType(card, pair);
  }

  updateMiniStats();
}

function renderMC(card, pair){
  els.mcArea.hidden = false;
  showRevealButtons();

  // Build options: correct + 3 random from deck
  const deck = DB[session.deckName];
  const options = [pair.a];

  while (options.length < 4){
    const pick = deck[Math.floor(Math.random()*deck.length)];
    const other = directionPair(pick, session.dir).a;
    if (!options.includes(other)) options.push(other);
  }
  shuffle(options);

  for (const opt of options){
    const b = document.createElement("button");
    b.textContent = opt;
    b.addEventListener("click", () => {
      // reveal answer and mark
      els.answer.hidden = false;

      const correct = opt === pair.a;
      if (correct) b.classList.add("correct");
      else b.classList.add("wrong");

      // mark correct option too
      [...els.mcArea.querySelectorAll("button")].forEach(btn=>{
        if (btn.textContent === pair.a) btn.classList.add("correct");
        btn.disabled = true;
      });

      grade(card, correct);
      showNextOnly();
    });
    els.mcArea.appendChild(b);
  }

  // reveal shows answer but no grading yet
  els.revealBtn.onclick = () => {
    els.answer.hidden = false;
  };
}

function renderType(card, pair){
  els.typeArea.hidden = false;
  showRevealButtons();

  els.revealBtn.onclick = () => {
    els.answer.hidden = false;
  };

  function doCheck(){
    const user = normalizeText(els.typeInput.value);
    const truth = normalizeText(pair.a);
    const correct = user.length > 0 && (user === truth || truth.includes(user) || user.includes(truth));
    els.answer.hidden = false;
    grade(card, correct);
    showNextOnly();
  }

  els.checkBtn.onclick = doCheck;
  els.typeInput.onkeydown = (e)=>{ if (e.key === "Enter") doCheck(); };
}

function grade(card, correct){
  const p = session.progress;
  const st = ensureCardState(p, card.id);

  st.seen += 1;

  if (correct){
    session.score += 10 + Math.min(10, session.streak*2);
    session.streak += 1;
    session.correct += 1;
    st.correct += 1;

    st.box = Math.min(6, st.box + 1);
  } else {
    session.score = Math.max(0, session.score - 5);
    session.streak = 0;
    session.wrong += 1;
    st.wrong += 1;

    st.box = Math.max(0, st.box - 1);
  }

  // next due date based on box
  const interval = INTERVALS[st.box] ?? (60*DAY);
  st.due = now() + interval;

  updateHeaderStats();
  updateMiniStats();
  updateSetupStats();
}

function next(){
  session.idx += 1;
  renderQuestion();
}

function updateSetupStats(){
  const deckName = els.deckSelect.value;
  const deckCards = DB?.[deckName] || [];
  const p = loadProgress();
  const st = computeStats(deckCards, p);
  els.statDue.textContent = `Fällig: ${st.due}/${st.total}`;
  els.statMastered.textContent = `Sicher: ${st.mastered}/${st.total}`;
}

function resetAll(){
  localStorage.removeItem(STORAGE_KEY);
  updateSetupStats();
  if (session){
    session.progress = loadProgress();
    els.playHint.textContent = "Reset gemacht. Dramatisch. Aber wir machen weiter.";
  }
}

async function boot(){
  const res = await fetch("data.json");
  DB = await res.json();

  // Fill deck select
  els.deckSelect.innerHTML = "";
  Object.keys(DB).forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.deckSelect.appendChild(opt);
  });

  // Hook events
  els.startBtn.addEventListener("click", startSession);
  els.shuffleBtn.addEventListener("click", () => {
    if (!session) return;
    shuffle(session.cards);
    session.idx = 0;
    renderQuestion();
  });
  els.resetBtn.addEventListener("click", resetAll);

  els.deckSelect.addEventListener("change", updateSetupStats);
  els.modeSelect.addEventListener("change", () => {
    // small UX: if typing/mc, reveal becomes less important, but still there
  });

  els.revealBtn.addEventListener("click", () => {
    if (!session) return;
    els.answer.hidden = false;
    if (session.mode === "cards") showRatingButtons();
  });
  els.goodBtn.addEventListener("click", () => {
    if (!session) return;
    const card = session.cards[session.idx];
    grade(card, true);
    showNextOnly();
  });
  els.badBtn.addEventListener("click", () => {
    if (!session) return;
    const card = session.cards[session.idx];
    grade(card, false);
    showNextOnly();
  });
  els.nextBtn.addEventListener("click", next);

  updateSetupStats();
  registerSW();
  setupInstallUX();
}

function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("service-worker.js"); }
    catch {}
  });
}

// Install prompt handling (Chrome/Edge/Android)
function setupInstallUX(){
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch {}
    installPrompt = null;
    els.installBtn.hidden = true;
  });
}

boot();
