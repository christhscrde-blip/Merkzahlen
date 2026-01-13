
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

  appTitle: $("#appTitle"),
  appSubtitle: $("#appSubtitle"),
  toneTag: $("#toneTag"),
  setupHint: $("#setupHint"),
  themeSelect: $("#themeSelect"),
  toneSelect: $("#toneSelect"),
  modeSelectUi: $("#modeSelectUi"),
  soundSelect: $("#soundSelect"),
  soundToggle: $("#soundToggle"),
  soundVolume: $("#soundVolume"),

  playCard: $("#playCard"),
  playTitle: $("#playTitle"),
  playHint: $("#playHint"),

  qIndex: $("#qIndex"),
  qScore: $("#qScore"),
  qStreak: $("#qStreak"),
  qLevel: $("#qLevel"),
  qXp: $("#qXp"),
  question: $("#question"),
  answer: $("#answer"),
  streakStatus: $("#streakStatus"),

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

  levelLabel: $("#levelLabel"),
  levelFill: $("#levelFill"),
  levelHint: $("#levelHint"),

  statDue: $("#statDue"),
  statMastered: $("#statMastered"),

  levelUpBanner: $("#levelUpBanner"),
  levelUpText: $("#levelUpText"),
  confettiCanvas: $("#confettiCanvas"),
  ambientAudio: $("#ambientAudio"),

  installBtn: $("#installBtn"),
};

const STORAGE_KEY = "merkzahlen_trainer_v1";
const PROFILE_KEY = "merkzahlen_profile_v1";
const DAY = 24 * 60 * 60 * 1000;
const XP_PER_LEVEL = 120;

// Leitner intervals (box -> ms)
const INTERVALS = [0, 1, 3, 7, 14, 30, 60].map(d => d * DAY);

let DB = null;
let ALL_CARDS = [];
let session = null;
let installPrompt = null;
let profile = null;
let confettiCtx = null;

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

function loadProfile() {
  const fallback = {
    xp: 0,
    tone: "normal",
    theme: "noir",
    mode: "dark",
    soundOn: false,
    sound: "forest",
    volume: 0.35,
    unlockedThemes: ["noir"]
  };
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return { ...fallback, ...(stored || {}) };
  } catch {
    return fallback;
  }
}

function saveProfile(p) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

const THEMES = [
  { id: "noir", label: "Noir (Standard)", unlock: 1 },
  { id: "neon", label: "Neon Mirage", unlock: 3 },
  { id: "solar", label: "Solar Bloom", unlock: 5 },
  { id: "brutal", label: "Brutal Glow", unlock: 7 }
];

const SOUNDS = [
  { id: "forest", label: "Waldrauschen", url: "https://cdn.pixabay.com/audio/2022/10/03/audio_8f68d5b7df.mp3" },
  { id: "ocean", label: "Meeresbrise", url: "https://cdn.pixabay.com/audio/2021/08/04/audio_c3f7a1f4f1.mp3" },
  { id: "ambient", label: "Sanftes Pad", url: "https://cdn.pixabay.com/audio/2022/03/10/audio_7b4f7b41d4.mp3" }
];

const TONES = {
  normal: {
    title: "Merkzahlen Trainer",
    subtitle: "Karteikarten, Quiz, Punkte. Natürlich alles in deinem Kopf.",
    setupHint: "Alles gemischt. Kein Ausweichen.",
    playHints: {
      cards: "Erst denken, dann gucken. Oder andersrum. Menschen halt.",
      mc: "Vier Antworten, eine Wahrheit.",
      type: "Tippen ist wie Denken, nur mit Tippgeräuschen."
    },
    endHint: (score, acc) => `Fertig. Score ${score}. Genauigkeit ${acc}. Dein Gehirn bekommt heute keinen Applaus, aber Respekt.`,
    resetHint: "Reset gemacht. Dramatisch. Aber wir machen weiter.",
    streakOn: "Streaks, die schmerzen: an. 💥",
    streakOff: "Streaks, die schmerzen: aus.",
    levelUp: "Upgrade freigeschaltet."
  },
  ironic: {
    title: "Merkzahlen Trainer: Deluxe Chaos",
    subtitle: "Alles durcheinander. Dein Kopf liebt doch Rätsel.",
    setupHint: "Du wolltest’s gemischt. Du bekommst’s gemischt.",
    playHints: {
      cards: "Flüstere der Geschichte zu. Sie flüstert zurück.",
      mc: "Vier Optionen, ein Drama.",
      type: "Tipp, als würdest du die Zeit anstupsen."
    },
    endHint: (score, acc) => `Session vorbei. Score ${score}, Trefferquote ${acc}. Du bist offiziell ziemlich okay.`,
    resetHint: "Reset gedrückt. Weil Kontrolle super ist.",
    streakOn: "Streaks, die schmerzen: aktiviert. Hot.",
    streakOff: "Streaks, die schmerzen: kaltgestellt.",
    levelUp: "Neues Upgrade freigeschaltet. Glänzend."
  },
  brutal: {
    title: "Merkzahlen Drill",
    subtitle: "Ausreden raus, Fakten rein.",
    setupHint: "Nichts gewählt, alles gelernt. Punkt.",
    playHints: {
      cards: "Erst denken, dann liefern.",
      mc: "Eine Wahrheit. Drei Lügen. Entscheide.",
      type: "Tippen. Kein Zaudern."
    },
    endHint: (score, acc) => `Fertig. Score ${score}. Genauigkeit ${acc}. Besser geht immer.`,
    resetHint: "Reset. Fang neu an. Ohne Drama.",
    streakOn: "Streaks, die schmerzen: läuft. Liefere.",
    streakOff: "Streaks, die schmerzen: aus. Schwach.",
    levelUp: "Upgrade da. Nimm’s."
  }
};

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

function levelInfo(xp) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const nextXp = level * XP_PER_LEVEL;
  const currentXp = xp - (level - 1) * XP_PER_LEVEL;
  return { level, currentXp, nextXp, pct: Math.min(100, Math.round((currentXp / XP_PER_LEVEL) * 100)) };
}

function applyTone(tone) {
  const copy = TONES[tone] || TONES.normal;
  els.appTitle.textContent = copy.title;
  els.appSubtitle.textContent = copy.subtitle;
  els.toneTag.textContent = `Ton: ${tone === "normal" ? "normal" : tone === "ironic" ? "ironisch" : "brutal ehrlich"}`;
  els.setupHint.textContent = copy.setupHint;
  if (!session) {
    els.playHint.textContent = copy.playHints.cards;
  } else {
    els.playHint.textContent = copy.playHints[session.mode];
    els.streakStatus.textContent = session.streak >= 10 ? copy.streakOn : copy.streakOff;
  }
}

function applyTheme(themeId, mode) {
  document.body.dataset.theme = themeId;
  document.body.dataset.mode = mode;
}

function renderThemeOptions() {
  const info = levelInfo(profile.xp);
  els.themeSelect.innerHTML = "";
  THEMES.forEach(theme => {
    const opt = document.createElement("option");
    opt.value = theme.id;
    opt.textContent = theme.label;
    opt.disabled = info.level < theme.unlock;
    if (info.level < theme.unlock) {
      opt.textContent += ` (ab Level ${theme.unlock})`;
    }
    els.themeSelect.appendChild(opt);
  });
  els.themeSelect.value = profile.theme;
}

function updateLevelUI() {
  const info = levelInfo(profile.xp);
  els.qLevel.textContent = `Level: ${info.level}`;
  els.qXp.textContent = `XP: ${info.currentXp}/${XP_PER_LEVEL}`;
  els.levelLabel.textContent = String(info.level);
  els.levelFill.style.width = `${info.pct}%`;
  els.levelHint.textContent = `Noch ${info.nextXp - profile.xp} XP bis zum nächsten Upgrade.`;
}

function showLevelUp(message) {
  els.levelUpText.textContent = message;
  els.levelUpBanner.hidden = false;
  setTimeout(() => {
    els.levelUpBanner.hidden = true;
  }, 2200);
}

function triggerEffect(effectClass) {
  document.body.classList.remove("pulse", "shake");
  void document.body.offsetWidth;
  document.body.classList.add(effectClass);
  setTimeout(() => document.body.classList.remove(effectClass), 600);
}

function setupConfetti() {
  const canvas = els.confettiCanvas;
  confettiCtx = canvas.getContext("2d");
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);
}

function fireConfetti() {
  if (!confettiCtx) return;
  const canvas = els.confettiCanvas;
  const particles = Array.from({ length: 120 }).map(() => ({
    x: canvas.width / 2,
    y: canvas.height / 3,
    vx: (Math.random() - 0.5) * 8,
    vy: (Math.random() - 0.8) * 10,
    size: Math.random() * 6 + 3,
    color: `hsl(${Math.random() * 360}, 90%, 60%)`,
    life: Math.random() * 40 + 40
  }));

  let frame = 0;
  function tick() {
    frame += 1;
    confettiCtx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 1;
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(p.x, p.y, p.size, p.size);
    });
    if (frame < 90) requestAnimationFrame(tick);
    else confettiCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}

function updateSoundUI() {
  els.soundToggle.textContent = profile.soundOn ? "Sound: An" : "Sound: Aus";
  els.soundVolume.value = profile.volume;
}

function applySound() {
  const selected = SOUNDS.find(s => s.id === profile.sound) || SOUNDS[0];
  if (selected?.url && els.ambientAudio.src !== selected.url) {
    els.ambientAudio.src = selected.url;
  }
  els.ambientAudio.volume = profile.volume;
  if (profile.soundOn) {
    els.ambientAudio.play().catch(() => {});
  } else {
    els.ambientAudio.pause();
  }
}

function startSession(){
  const mode = els.modeSelect.value;
  const dir = els.dirSelect.value;
  const diff = els.difficulty.value;
  const n = Math.max(5, Math.min(100, Number(els.sessionSize.value || 20)));

  const progress = loadProgress();
  const chosen = chooseCards(ALL_CARDS, progress, diff, n);

  session = {
    deckName: "Alles",
    mode,
    dir,
    cards: chosen,
    idx: 0,
    score: 0,
    streak: 0,
    correct: 0,
    wrong: 0,
    progress
  };

  els.playCard.hidden = false;
  els.playTitle.textContent = "Session: Alles gemischt";
  const copy = TONES[profile.tone] || TONES.normal;
  els.playHint.textContent = copy.playHints[mode];

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

  const copy = TONES[profile.tone] || TONES.normal;
  els.playHint.textContent = copy.endHint(session.score, acc);
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
  const streakLabel = session.streak >= 10 ? `Streak: ${session.streak} 🔥🔥🔥` : `Streak: ${session.streak}`;
  els.qStreak.textContent = streakLabel;
  els.qIndex.textContent = `${session.idx+1}/${session.cards.length}`;
  updateLevelUI();
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
  els.streakStatus.textContent = session.streak >= 10 ? (TONES[profile.tone] || TONES.normal).streakOn : (TONES[profile.tone] || TONES.normal).streakOff;

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
  const beforeLevel = levelInfo(profile.xp).level;

  st.seen += 1;

  if (correct){
    session.score += 10 + Math.min(10, session.streak*2);
    session.streak += 1;
    session.correct += 1;
    st.correct += 1;

    st.box = Math.min(6, st.box + 1);
    profile.xp += 12;
    if (session.streak >= 10) {
      triggerEffect("pulse");
      fireConfetti();
    }
  } else {
    session.score = Math.max(0, session.score - 5);
    session.streak = 0;
    session.wrong += 1;
    st.wrong += 1;

    st.box = Math.max(0, st.box - 1);
    triggerEffect("shake");
  }

  // next due date based on box
  const interval = INTERVALS[st.box] ?? (60*DAY);
  st.due = now() + interval;

  const afterLevel = levelInfo(profile.xp).level;
  if (afterLevel > beforeLevel) {
    renderThemeOptions();
    showLevelUp((TONES[profile.tone] || TONES.normal).levelUp);
    fireConfetti();
  }

  saveProfile(profile);

  updateHeaderStats();
  updateMiniStats();
  updateSetupStats();
}

function next(){
  session.idx += 1;
  renderQuestion();
}

function updateSetupStats(){
  const deckCards = ALL_CARDS;
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
    els.playHint.textContent = (TONES[profile.tone] || TONES.normal).resetHint;
  }
}

async function boot(){
  const res = await fetch("data.json");
  DB = await res.json();
  ALL_CARDS = Object.values(DB).flat();
  profile = loadProfile();

  renderThemeOptions();
  els.toneSelect.value = profile.tone;
  els.modeSelectUi.value = profile.mode;
  els.themeSelect.value = profile.theme;

  els.soundSelect.innerHTML = "";
  SOUNDS.forEach(sound => {
    const opt = document.createElement("option");
    opt.value = sound.id;
    opt.textContent = sound.label;
    els.soundSelect.appendChild(opt);
  });
  els.soundSelect.value = profile.sound;

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
    if (session) {
      session.mode = els.modeSelect.value;
      renderQuestion();
    }
  });
  els.themeSelect.addEventListener("change", () => {
    const choice = els.themeSelect.value;
    const allowed = !els.themeSelect.selectedOptions[0].disabled;
    if (!allowed) {
      els.themeSelect.value = profile.theme;
      return;
    }
    profile.theme = choice;
    applyTheme(profile.theme, profile.mode);
    saveProfile(profile);
  });
  els.toneSelect.addEventListener("change", () => {
    profile.tone = els.toneSelect.value;
    applyTone(profile.tone);
    saveProfile(profile);
  });
  els.modeSelectUi.addEventListener("change", () => {
    profile.mode = els.modeSelectUi.value;
    applyTheme(profile.theme, profile.mode);
    saveProfile(profile);
  });
  els.soundSelect.addEventListener("change", () => {
    profile.sound = els.soundSelect.value;
    applySound();
    saveProfile(profile);
  });
  els.soundToggle.addEventListener("click", () => {
    profile.soundOn = !profile.soundOn;
    updateSoundUI();
    applySound();
    saveProfile(profile);
  });
  els.soundVolume.addEventListener("input", () => {
    profile.volume = Number(els.soundVolume.value);
    applySound();
    saveProfile(profile);
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

  applyTheme(profile.theme, profile.mode);
  applyTone(profile.tone);
  updateSoundUI();
  applySound();
  setupConfetti();
  updateSetupStats();
  updateLevelUI();
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
