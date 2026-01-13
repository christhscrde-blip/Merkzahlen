
/*
  Merkzahlen Trainer
  - Single-file SPA + PWA
  - localStorage Leitner/Spaced repetition (simple but effective)
  - Modes: cards, multiple choice, typing
*/

const $ = (sel) => document.querySelector(sel);

const els = {
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
  qLevel: $("#qLevel"),
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

  appTitle: $("#appTitle"),
  appSubtitle: $("#appSubtitle"),
  toneBadge: $("#toneBadge"),
  themeSelect: $("#themeSelect"),
  modeSelectUi: $("#modeSelectUi"),
  toneSelect: $("#toneSelect"),
  soundSelect: $("#soundSelect"),
  soundToggle: $("#soundToggle"),
  soundVolume: $("#soundVolume"),
  previewThemeBtn: $("#previewThemeBtn"),
  resetSettingsBtn: $("#resetSettingsBtn"),
  ambientAudio: $("#ambientAudio"),
  confetti: $("#confetti"),
};

const STORAGE_KEY = "merkzahlen_trainer_v1";
const SETTINGS_KEY = "merkzahlen_settings_v1";
const META_KEY = "merkzahlen_meta_v1";
const DAY = 24 * 60 * 60 * 1000;

// Leitner intervals (box -> ms)
const INTERVALS = [0, 1, 3, 7, 14, 30, 60].map(d => d * DAY);

let DB = null;
let ALL_CARDS = [];
let session = null;
let installPrompt = null;
let settings = null;
let meta = null;

const THEMES = [
  { id: "neon", label: "Neon Core", unlockScore: 0 },
  { id: "aurora", label: "Aurora Drift", unlockScore: 120 },
  { id: "ember", label: "Ember Glow", unlockScore: 260 },
];

const TONES = [
  { id: "normal", label: "Normal", minStreak: 0 },
  { id: "ironisch", label: "Ironisch", minStreak: 10 },
  { id: "brutal", label: "Brutal ehrlich", minStreak: 20 },
];

const SOUNDTRACKS = [
  { id: "forest", label: "Waldrauschen", url: "https://cdn.pixabay.com/audio/2022/03/15/audio_2bde2a89c1.mp3" },
  { id: "night", label: "Nachtwind", url: "https://cdn.pixabay.com/audio/2022/11/10/audio_1a4b8e63a4.mp3" },
  { id: "rain", label: "Regen", url: "https://cdn.pixabay.com/audio/2022/03/10/audio_c6faba5b1d.mp3" },
];

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

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMeta(m) {
  localStorage.setItem(META_KEY, JSON.stringify(m));
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
  const mode = els.modeSelect.value;
  const dir = els.dirSelect.value;
  const diff = els.difficulty.value;
  const n = Math.max(5, Math.min(100, Number(els.sessionSize.value || 20)));

  const progress = loadProgress();
  const chosen = chooseCards(ALL_CARDS, progress, diff, n);

  session = {
    mode, dir,
    cards: chosen,
    idx: 0,
    score: 0,
    streak: 0,
    correct: 0,
    wrong: 0,
    progress
  };

  els.playCard.hidden = false;
  els.playTitle.textContent = "Session: All In";
  els.playHint.textContent = copyFor("start", mode);

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

  els.playHint.textContent = copyFor("end", session.mode, { score: session.score, acc });
  els.revealBtn.hidden = true;
  els.goodBtn.hidden = true;
  els.badBtn.hidden = true;
  els.nextBtn.hidden = true;
  els.mcArea.hidden = true;
  els.typeArea.hidden = true;
  els.answer.hidden = false;
  els.answer.textContent = "Session beendet. Du kannst oben eine neue starten.";
  document.body.classList.remove("streak-pulse");
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
  const totalScore = meta?.totalScore || 0;
  els.qLevel.textContent = `Level: ${Math.max(1, Math.floor(totalScore / 80) + 1)}`;
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
  handleStreakPulse();

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
  const deck = ALL_CARDS;
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

    meta.totalScore = (meta.totalScore || 0) + 10;
    meta.maxStreak = Math.max(meta.maxStreak || 0, session.streak);
    maybeUnlocks();
    if (session.streak > 0 && session.streak % 10 === 0) {
      levelUpFx();
    }
    confettiBurst();
  } else {
    session.score = Math.max(0, session.score - 5);
    session.streak = 0;
    session.wrong += 1;
    st.wrong += 1;

    st.box = Math.max(0, st.box - 1);
    screenShakeFx();
  }

  // next due date based on box
  const interval = INTERVALS[st.box] ?? (60*DAY);
  st.due = now() + interval;

  updateHeaderStats();
  updateMiniStats();
  updateSetupStats();
  handleStreakPulse();
}

function next(){
  session.idx += 1;
  renderQuestion();
}

function updateSetupStats(){
  const deckCards = ALL_CARDS || [];
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
    els.playHint.textContent = copyFor("reset", session.mode);
  }
  document.body.classList.remove("streak-pulse");
}

async function boot(){
  const res = await fetch("data.json");
  DB = await res.json();
  ALL_CARDS = Object.values(DB).flat();

  settings = {
    theme: "neon",
    mode: "dark",
    tone: "normal",
    soundOn: false,
    sound: "forest",
    volume: 0.35,
    ...loadSettings()
  };

  meta = {
    totalScore: 0,
    maxStreak: 0,
    ...loadMeta()
  };

  hydrateSettingsUi();
  applySettings();
  maybeUnlocks();

  // Hook events
  els.startBtn.addEventListener("click", startSession);
  els.shuffleBtn.addEventListener("click", () => {
    if (!session) return;
    shuffle(session.cards);
    session.idx = 0;
    renderQuestion();
  });
  els.resetBtn.addEventListener("click", resetAll);

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
  els.themeSelect.addEventListener("change", (e) => {
    settings.theme = e.target.value;
    applySettings();
    saveSettings(settings);
  });
  els.modeSelectUi.addEventListener("change", (e) => {
    settings.mode = e.target.value;
    applySettings();
    saveSettings(settings);
  });
  els.toneSelect.addEventListener("change", (e) => {
    settings.tone = e.target.value;
    updateToneUI();
    saveSettings(settings);
  });
  els.soundSelect.addEventListener("change", (e) => {
    settings.sound = e.target.value;
    applySound();
    saveSettings(settings);
  });
  els.soundToggle.addEventListener("click", () => {
    settings.soundOn = !settings.soundOn;
    applySound();
    saveSettings(settings);
  });
  els.soundVolume.addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    applySound();
    saveSettings(settings);
  });
  els.previewThemeBtn.addEventListener("click", () => {
    levelUpFx();
  });
  els.resetSettingsBtn.addEventListener("click", () => {
    settings = {
      theme: "neon",
      mode: "dark",
      tone: "normal",
      soundOn: false,
      sound: "forest",
      volume: 0.35
    };
    saveSettings(settings);
    hydrateSettingsUi();
    applySettings();
  });

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

function applySettings() {
  document.body.dataset.theme = settings.theme;
  document.body.dataset.mode = settings.mode;
  updateToneUI();
  applySound();
}

function hydrateSettingsUi() {
  els.themeSelect.innerHTML = "";
  THEMES.forEach(theme => {
    const opt = document.createElement("option");
    opt.value = theme.id;
    opt.textContent = theme.label;
    opt.disabled = (meta.totalScore || 0) < theme.unlockScore;
    els.themeSelect.appendChild(opt);
  });
  if (![...els.themeSelect.options].some(opt => opt.value === settings.theme && !opt.disabled)) {
    settings.theme = "neon";
  }
  els.themeSelect.value = settings.theme;
  els.modeSelectUi.value = settings.mode;

  els.toneSelect.innerHTML = "";
  TONES.forEach(tone => {
    const opt = document.createElement("option");
    opt.value = tone.id;
    opt.textContent = tone.label;
    opt.disabled = (meta.maxStreak || 0) < tone.minStreak;
    els.toneSelect.appendChild(opt);
  });
  if (![...els.toneSelect.options].some(opt => opt.value === settings.tone && !opt.disabled)) {
    settings.tone = highestToneUnlocked();
  }
  els.toneSelect.value = settings.tone;

  els.soundSelect.innerHTML = "";
  SOUNDTRACKS.forEach(track => {
    const opt = document.createElement("option");
    opt.value = track.id;
    opt.textContent = track.label;
    els.soundSelect.appendChild(opt);
  });
  els.soundSelect.value = settings.sound;
  els.soundVolume.value = settings.volume;
}

function updateToneUI() {
  const tone = settings.tone;
  const copy = toneCopy(tone);
  els.toneBadge.textContent = `Ton: ${copy.badge}`;
  els.appTitle.textContent = copy.title;
  els.appSubtitle.textContent = copy.subtitle;
}

function highestToneUnlocked() {
  const max = meta.maxStreak || 0;
  const unlocked = TONES.filter(t => max >= t.minStreak);
  return unlocked[unlocked.length - 1]?.id ?? "normal";
}

function maybeUnlocks() {
  const newTone = highestToneUnlocked();
  if (settings.tone !== newTone && TONES.find(t => t.id === newTone)?.minStreak >= 10) {
    settings.tone = newTone;
    levelUpFx();
  }
  hydrateSettingsUi();
  saveSettings(settings);
  saveMeta(meta);
}

function applySound() {
  const track = SOUNDTRACKS.find(t => t.id === settings.sound) || SOUNDTRACKS[0];
  if (els.ambientAudio.src !== track.url) {
    els.ambientAudio.src = track.url;
  }
  els.ambientAudio.volume = settings.volume;
  if (settings.soundOn) {
    els.ambientAudio.play().catch(() => {});
    els.soundToggle.textContent = "Sound an";
  } else {
    els.ambientAudio.pause();
    els.soundToggle.textContent = "Sound aus";
  }
}

function copyFor(key, mode, data = {}) {
  const tone = settings?.tone || "normal";
  const c = toneCopy(tone);
  if (key === "start") {
    if (mode === "cards") return c.startCards;
    if (mode === "mc") return c.startMc;
    return c.startType;
  }
  if (key === "end") {
    return c.end.replace("{score}", data.score).replace("{acc}", data.acc);
  }
  if (key === "reset") {
    return c.reset;
  }
  return c.startCards;
}

function toneCopy(tone) {
  if (tone === "ironisch") {
    return {
      badge: "Ironisch",
      title: "Merkzahlen Glitchclub",
      subtitle: "Du lernst. Die Geschichte so: 😏",
      startCards: "Erst denken, dann gucken. Oder andersrum. Menschen halt.",
      startMc: "Vier Antworten, eine Wahrheit. Und drei Ausreden.",
      startType: "Tippen ist wie Denken, nur mit Tippgeräuschen.",
      end: "Fertig. Score {score}. Genauigkeit {acc}. Du hast es geschafft. Irgendwie.",
      reset: "Reset gedrückt. Gehirn kurz rebooten."
    };
  }
  if (tone === "brutal") {
    return {
      badge: "Brutal ehrlich",
      title: "Merkzahlen Dojo",
      subtitle: "Du willst alles? Dann bekommst du alles.",
      startCards: "Denk. Dann deck auf. Keine Ausreden.",
      startMc: "Vier Optionen, eine Realität. Rate klug.",
      startType: "Tippen. Jetzt. Beweise, dass du’s kannst.",
      end: "Fertig. Score {score}. Genauigkeit {acc}. Noch nicht gut genug? Weiter.",
      reset: "Reset. Du weißt, was das bedeutet: wieder von vorn."
    };
  }
  return {
    badge: "Normal",
    title: "Merkzahlen Arena",
    subtitle: "Alle Zahlen, ein Gehirn. Keine Ausreden.",
    startCards: "Erst denken, dann gucken. Oder andersrum. Menschen halt.",
    startMc: "Vier Antworten, eine Wahrheit.",
    startType: "Tippen ist wie Denken, nur mit Tippgeräuschen.",
    end: "Fertig. Score {score}. Genauigkeit {acc}. Dein Gehirn bekommt heute keinen Applaus, aber Respekt.",
    reset: "Reset gemacht. Dramatisch. Aber wir machen weiter."
  };
}

function levelUpFx() {
  document.body.classList.add("level-up");
  setTimeout(() => document.body.classList.remove("level-up"), 900);
}

function screenShakeFx() {
  document.body.classList.add("screen-shake");
  setTimeout(() => document.body.classList.remove("screen-shake"), 600);
}

function confettiBurst() {
  const colors = ["#7b9bff", "#58ffbb", "#ffd86d", "#ff7ba5", "#a67bff"];
  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const start = Math.random() * window.innerWidth;
    const drift = (Math.random() * 240 - 120).toFixed(0) + "px";
    piece.style.left = `${start}px`;
    piece.style.setProperty("--x", drift);
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.opacity = String(0.6 + Math.random() * 0.4);
    els.confetti.appendChild(piece);
    setTimeout(() => piece.remove(), 1700);
  }
}

function handleStreakPulse() {
  if (!session) return;
  if (session.streak >= 10) {
    document.body.classList.add("streak-pulse");
  } else {
    document.body.classList.remove("streak-pulse");
  }
}
