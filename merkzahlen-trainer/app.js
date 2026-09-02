const AppCore = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const STORAGE_KEY = "merkzahlen_progress_v3";
  const PROFILE_KEY = "merkzahlen_profile_v3";
  const LEGACY_STORAGE_KEY = "merkzahlen_progress_v2";
  const LEGACY_PROFILE_KEY = "merkzahlen_profile_v2";
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60].map((days) => days * DAY);

  const MODE_LABELS = {
    mix: "Mix",
    cards: "Karteikarten",
    mc: "Multiple Choice",
    type: "Tippen",
  };

  const FOCUS_LABELS = {
    mixed: "Priorisiert",
    due: "Nur fällig",
    new: "Nur neu",
    weak: "Nur unsicher",
  };

  const PROFILE_DEFAULTS = {
    theme: "ink",
    selectedDecks: [],
    mode: "mix",
    direction: "year2event",
    focus: "mixed",
    sessionSize: 10,
    cutoffYear: 1990,
    lastSummary: null,
  };

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[„“\"]/g, "")
      .replace(/[^\p{L}\p{N}\s./-]/gu, " ")
      .replace(/\s*([./-])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isDateLikeAnswer(value) {
    const remainder = normalizeText(value)
      .replace(/um|jh|januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember/g, "")
      .replace(/[\d./\s-]/g, "");
    return /\d/.test(String(value)) && remainder.length === 0;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      const isObject = parsed && typeof parsed === "object" && !Array.isArray(parsed);
      return isObject ? { ...fallback, ...parsed } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }

  function loadProgress() {
    const current = loadJson(STORAGE_KEY, {});
    if (Object.keys(current).length > 0) return current;
    return loadJson(LEGACY_STORAGE_KEY, {});
  }

  function saveProgress(progress) {
    return saveJson(STORAGE_KEY, progress);
  }

  function loadProfile() {
    const current = loadJson(PROFILE_KEY, {});
    const source = Object.keys(current).length > 0 ? current : loadJson(LEGACY_PROFILE_KEY, {});
    const theme = ["ink", "paper", "sage"].includes(source.theme)
      ? source.theme
      : source.theme === "paper-sun"
        ? "paper"
        : source.theme === "oxide-pulse"
          ? "sage"
          : "ink";
    return { ...PROFILE_DEFAULTS, ...source, theme };
  }

  function saveProfile(profile) {
    return saveJson(PROFILE_KEY, profile);
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function ensureCardState(progress, cardId) {
    const fallback = {
      box: 0,
      due: 0,
      seen: 0,
      correct: 0,
      wrong: 0,
      lastSeen: 0,
      lastWrongAt: 0,
    };
    progress[cardId] = { ...fallback, ...(progress[cardId] || {}) };
    const state = progress[cardId];
    // Older backups did not record consecutive answers. Preserve their counters,
    // but infer only what the last answer and the old box actually establish.
    if (!Number.isFinite(state.correctStreak)) {
      state.correctStreak = state.wrong === 0 ? state.box
        : state.lastWrongAt >= state.lastSeen ? 0 : Math.min(2, state.box);
    }
    // Repair the former `0 || 60 days` scheduling bug for legacy failures.
    if (state.seen > 0 && state.wrong > 0 && state.correctStreak === 0) {
      state.box = 0;
      state.due = Math.min(state.due, state.lastSeen);
    }
    return progress[cardId];
  }

  function flattenDecks(db) {
    return Object.entries(db).flatMap(([deck, cards]) =>
      cards.map((card) => ({ ...card, deck })),
    );
  }

  function cardEndYear(card) {
    const prompt = String(card.prompt);
    const years = prompt.match(/\d{4}/g)?.map(Number) || [];
    const shortenedRange = prompt.match(/(\d{4})\s*[-–—/]\s*(\d{2})(?!\d)/);
    if (shortenedRange) {
      const start = Number(shortenedRange[1]);
      let end = Math.floor(start / 100) * 100 + Number(shortenedRange[2]);
      if (end < start) end += 100;
      years.push(end);
    }
    if (years.length > 0) return Math.max(...years);
    const century = prompt.match(/(\d{1,2})\.\s*Jh\./i);
    return century ? Number(century[1]) * 100 : 0;
  }

  function filterCards(cards, selectedDecks = [], cutoffYear = Infinity) {
    const allowed = new Set(selectedDecks);
    return cards.filter((card) => {
      const deckMatches = allowed.size === 0 || allowed.has(card.deck);
      return deckMatches && cardEndYear(card) <= Number(cutoffYear || Infinity);
    });
  }

  function filterCardsByDeck(cards, selectedDecks) {
    return filterCards(cards, selectedDecks, Infinity);
  }

  function getCardMeta(card, progress, timestamp = Date.now()) {
    const state = ensureCardState(progress, card.id);
    const isNew = state.seen === 0;
    const isWeak = !isNew && state.wrong > 0 && state.correctStreak < 2;
    const mastered = !isNew && !isWeak && state.box >= 5;
    return {
      due: !isNew && state.due <= timestamp,
      isNew,
      isWeak,
      mastered,
      learning: !isNew && !isWeak && !mastered,
      state,
    };
  }

  function computeOverview(cards, progress, selectedDecks, cutoffYear = Infinity, timestamp = Date.now()) {
    const active = filterCards(cards, selectedDecks, cutoffYear);
    const stats = {
      total: active.length,
      due: 0,
      newCount: 0,
      weak: 0,
      learning: 0,
      mastered: 0,
      correct: 0,
      wrong: 0,
      accuracy: null,
    };
    let correct = 0;
    let attempts = 0;

    active.forEach((card) => {
      const meta = getCardMeta(card, progress, timestamp);
      if (meta.due) stats.due += 1;
      if (meta.isNew) stats.newCount += 1;
      if (meta.isWeak) stats.weak += 1;
      if (meta.mastered) stats.mastered += 1;
      if (meta.learning) stats.learning += 1;
      correct += meta.state.correct;
      attempts += meta.state.correct + meta.state.wrong;
    });

    if (attempts > 0) stats.accuracy = Math.round((correct / attempts) * 100);
    stats.correct = correct;
    stats.wrong = attempts - correct;
    return stats;
  }

  function clampSessionSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(60, Math.max(5, parsed));
  }

  function formatCardCount(count) {
    return `${count} ${count === 1 ? "Karte" : "Karten"}`;
  }

  function chooseCards(cards, progress, options, timestamp = Date.now()) {
    const {
      focus = "mixed",
      count = 16,
      selectedDecks = [],
      cutoffYear = Infinity,
    } = options;
    const active = filterCards(cards, selectedDecks, cutoffYear);
    const scored = active.map((card) => {
      const meta = getCardMeta(card, progress, timestamp);
      let weight = 1;
      if (meta.due) weight += 6;
      if (meta.isWeak) weight += 5;
      if (meta.isNew) weight += 4;
      weight += Math.max(0, meta.state.wrong - meta.state.correct);
      return { card, meta, weight, tie: Math.random() };
    });

    let filtered = scored;
    if (focus === "due") filtered = scored.filter((entry) => entry.meta.due);
    if (focus === "new") filtered = scored.filter((entry) => entry.meta.isNew);
    if (focus === "weak") filtered = scored.filter((entry) => entry.meta.isWeak);

    return filtered
      .slice()
      .sort((a, b) => b.weight - a.weight || a.meta.state.due - b.meta.state.due || a.tie - b.tie)
      .slice(0, Math.min(clampSessionSize(count), filtered.length))
      .map((entry) => entry.card);
  }

  function directionPair(card, direction, cards = [card]) {
    if (direction === "event2year") {
      return { question: card.answer, answer: card.prompt, answerCount: 1 };
    }

    const matchingAnswers = cards
      .filter((candidate) => candidate.deck === card.deck && candidate.prompt === card.prompt)
      .map((candidate) => candidate.answer)
      .filter((answer, index, answers) => answers.indexOf(answer) === index);
    const answers = matchingAnswers.length > 0 ? matchingAnswers : [card.answer];
    return {
      question: card.prompt,
      answer: answers.join("; "),
      answerCount: answers.length,
    };
  }

  function sessionModeForIndex(mode, index) {
    return mode === "mix" ? ["cards", "mc", "type"][index % 3] : mode;
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildMcOptions(cards, currentCard, direction) {
    const correct = directionPair(currentCard, direction, cards).answer;
    const candidates = shuffle(
      cards
        .filter((card) => card.id !== currentCard.id)
        .map((card) => directionPair(card, direction, cards).answer)
        .filter((answer, index, values) => answer !== correct && values.indexOf(answer) === index),
    );
    return shuffle([correct, ...candidates.slice(0, 3)]);
  }

  function evaluateTypedAnswer(input, truth, allowExtraWords = false) {
    const normalizedInput = normalizeText(input);
    const normalizedTruth = normalizeText(truth);
    if (!normalizedInput || !normalizedTruth) return false;
    if (normalizedInput === normalizedTruth) return true;
    if (isDateLikeAnswer(truth)) {
      return canonicalDate(input) === canonicalDate(truth);
    }

    // Every event of a shared year must be present, not just 70% of the combined text.
    if (truth.includes(";") && !truth.split(";").every((part) => evaluateTypedAnswer(input, part, true))) return false;
    if (/\b(nicht|kein|keine|keinen|keiner|keines)\b/.test(normalizedInput)) return false;

    const stopwords = new Set(["der", "die", "das", "den", "dem", "des", "und", "von", "im", "in", "zu", "zur", "zum"]);
    const wordForm = (value) => value.replace(/[./-]/g, " ").replace(/\s+/g, " ").trim();
    const truthParts = wordForm(normalizedTruth).split(" ").filter((part) => part.length > 1 && !stopwords.has(part));
    const inputParts = new Set(wordForm(normalizedInput).split(" ").filter((part) => part.length > 1 && !stopwords.has(part)));
    const overlap = truthParts.filter((part) => inputParts.has(part)).length;
    const uniqueTruth = new Set(truthParts);
    const precision = [...inputParts].filter((part) => uniqueTruth.has(part)).length / inputParts.size;
    const identifiers = (value) => wordForm(value).split(" ").filter((part) => /^\d+$|^(ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi)$/.test(part));
    if (!identifiers(normalizedTruth).every((part) => identifiers(normalizedInput).includes(part))) return false;
    return truthParts.length > 0 && overlap >= Math.ceil(truthParts.length * 0.7) && (allowExtraWords || precision >= 0.6);
  }

  function canonicalDate(value) {
    const months = ["januar", "februar", "marz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
    let date = normalizeText(value);
    months.forEach((month, index) => {
      date = date.replace(new RegExp(month, "g"), `${index + 1}.`);
    });
    return date.replace(/\s/g, "").replace(/\d+/g, (number) => String(Number(number)));
  }

  function applyGrade(progress, card, correct, timestamp = Date.now()) {
    const state = ensureCardState(progress, card.id);
    state.seen += 1;
    state.lastSeen = timestamp;

    if (correct) {
      state.correct += 1;
      state.correctStreak += 1;
      state.box = Math.min(6, state.box + 1);
    } else {
      state.wrong += 1;
      state.lastWrongAt = timestamp;
      state.correctStreak = 0;
      state.box = 0;
    }

    state.due = timestamp + (INTERVALS[state.box] ?? 60 * DAY);
    return state;
  }

  function createSession(cards, options, contextCards = cards) {
    return {
      cards: cards.slice(), contextCards: contextCards.slice(),
      mode: options.mode, direction: options.direction,
      index: 0, graded: false, correct: 0, wrong: 0, streak: 0, bestStreak: 0, answered: [],
    };
  }

  function gradeSession(progress, session, correct, response = {}, timestamp = Date.now()) {
    if (!session || session.graded || !session.cards[session.index] || typeof correct !== "boolean") return null;
    const card = session.cards[session.index];
    const pair = directionPair(card, session.direction, session.contextCards);
    const result = {
      card: { ...card }, question: pair.question, expectedAnswer: pair.answer,
      submittedAnswer: String(response.answer ?? ""),
      source: response.source || "self", mode: sessionModeForIndex(session.mode, session.index),
      direction: session.direction, correct, answeredAt: timestamp,
    };
    applyGrade(progress, card, correct, timestamp);
    session.answered.push(result);
    session.graded = true;
    session.correct += correct ? 1 : 0;
    session.wrong += correct ? 0 : 1;
    session.streak = correct ? session.streak + 1 : 0;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    return result;
  }

  function retryCards(summary, cards) {
    const ids = new Set((summary?.results || []).filter((item) => !item.correct).map((item) => item.card.id));
    return cards.filter((card) => ids.has(card.id));
  }

  function buildSummary(session) {
    // The answer log is the sole source of truth, also after reload or filter changes.
    const results = session.answered.map((item) => ({ ...item, card: { ...item.card } }));
    const total = results.length;
    const correct = results.filter((item) => item.correct).length;
    const wrong = total - correct;
    let streak = 0;
    let bestStreak = 0;
    results.forEach((item) => {
      streak = item.correct ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
    });
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    const recommendation = accuracy >= 85
      ? "Sehr stabil. Als Nächstes lohnt sich die Gegenrichtung."
      : accuracy >= 60
        ? "Solide Basis. Wiederhole vor allem die markierten Schwachstellen."
        : "Nimm eine kürzere Runde und trainiere die unsicheren Karten noch einmal.";
    const weakCards = results
      .filter((item) => !item.correct)
      .map((item) => `${item.card.prompt} – ${item.card.answer}`);
    return { schemaVersion: 2, accuracy, correct, wrong, bestStreak, total, recommendation, weakCards,
      mode: session.mode, direction: session.direction, completedAt: Date.now(), results };
  }

  return {
    MODE_LABELS,
    FOCUS_LABELS,
    STORAGE_KEY,
    PROFILE_KEY,
    PROFILE_DEFAULTS,
    normalizeText,
    loadProgress,
    saveProgress,
    loadProfile,
    saveProfile,
    ensureCardState,
    flattenDecks,
    cardEndYear,
    filterCards,
    filterCardsByDeck,
    getCardMeta,
    computeOverview,
    clampSessionSize,
    formatCardCount,
    chooseCards,
    directionPair,
    sessionModeForIndex,
    buildMcOptions,
    shuffle,
    evaluateTypedAnswer,
    applyGrade,
    createSession,
    gradeSession,
    retryCards,
    buildSummary,
  };
})();

if (typeof window !== "undefined" && !window.__MERKZAHLEN_TEST__) {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    startBtn: $("#startBtn"), installBtn: $("#installBtn"), modeSelect: $("#modeSelect"),
    dirSelect: $("#dirSelect"), focusSelect: $("#focusSelect"), sessionSize: $("#sessionSize"),
    cutoffSelect: $("#cutoffSelect"), themeSwitch: $("#themeSwitch"), deckFilter: $("#deckFilter"),
    toggleAllDecksBtn: $("#toggleAllDecksBtn"), resetBtn: $("#resetBtn"), sessionHint: $("#sessionHint"),
    deckSummary: $("#deckSummary"), statDue: $("#statDue"), statNew: $("#statNew"),
    statWeak: $("#statWeak"), statMastered: $("#statMastered"), statAccuracy: $("#statAccuracy"),
    welcomeCard: $("#welcomeCard"), emptyTraining: $("#emptyTraining"), emptyTrainingText: $("#emptyTrainingText"),
    playCard: $("#playCard"), playTitle: $("#playTitle"), qIndex: $("#qIndex"),
    qModeLabel: $("#qModeLabel"), qStreak: $("#qStreak"), qProgress: $("#qProgress"),
    questionContext: $("#questionContext"), question: $("#question"), answer: $("#answer"),
    mcArea: $("#mcArea"), typeArea: $("#typeArea"), typeInput: $("#typeInput"),
    checkBtn: $("#checkBtn"), revealBtn: $("#revealBtn"), goodBtn: $("#goodBtn"),
    badBtn: $("#badBtn"), nextBtn: $("#nextBtn"), sCorrect: $("#sCorrect"),
    sWrong: $("#sWrong"), sAcc: $("#sAcc"), summaryCard: $("#summaryCard"),
    summaryAccuracy: $("#summaryAccuracy"), summaryBestStreak: $("#summaryBestStreak"),
    summaryTotal: $("#summaryTotal"), summaryRecommendation: $("#summaryRecommendation"),
    summaryResults: $("#summaryResults"), resetDialog: $("#resetDialog"),
    cancelResetBtn: $("#cancelResetBtn"), confirmResetBtn: $("#confirmResetBtn"),
    exportBtn: $("#exportBtn"), importBtn: $("#importBtn"), importInput: $("#importInput"),
    dataStatus: $("#dataStatus"), bootError: $("#bootError"),
    statLearning: $("#statLearning"), catalogProgress: $("#catalogProgress"),
    masteryTrack: $("#masteryTrack"), lastAnswer: $("#lastAnswer"), saveWarning: $("#saveWarning"),
    answerTrack: $("#answerTrack"), roundLabel: $("#roundLabel"), modeHint: $("#modeHint"),
    answerFeedback: $("#answerFeedback"), feedbackTitle: $("#feedbackTitle"), feedbackDetail: $("#feedbackDetail"),
    summaryTitle: $("#summaryTitle"), summaryCounts: $("#summaryCounts"), summaryEmpty: $("#summaryEmpty"),
    summaryContext: $("#summaryContext"),
    onlyMistakes: $("#onlyMistakes"), retryBtn: $("#retryBtn"), anotherRoundBtn: $("#anotherRoundBtn"),
    quickStartBtn: $("#quickStartBtn"),
    finishBtn: $("#finishBtn"),
  };

  const state = {
    cards: [],
    progress: AppCore.loadProgress(),
    profile: AppCore.loadProfile(),
    session: null,
    installPrompt: null,
    displayedSummary: null,
  };

  function persist() {
    const progressSaved = AppCore.saveProgress(state.progress);
    const profileSaved = AppCore.saveProfile(state.profile);
    els.saveWarning.hidden = progressSaved && profileSaved;
  }

  function setPracticeActive(active) {
    document.body.classList.toggle("isPracticing", active);
    [els.modeSelect, els.dirSelect, els.focusSelect, els.sessionSize, els.cutoffSelect,
      els.toggleAllDecksBtn, els.startBtn, ...$$("#deckFilter .deckChip")].forEach((control) => {
      control.disabled = active;
    });
  }

  function updateTheme() {
    document.body.dataset.theme = state.profile.theme;
    $$("#themeSwitch button").forEach((button) => {
      const active = button.dataset.theme === state.profile.theme;
      button.classList.toggle("isActive", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function restoreControls() {
    els.modeSelect.value = state.profile.mode;
    els.dirSelect.value = state.profile.direction;
    els.focusSelect.value = state.profile.focus;
    els.sessionSize.value = String(AppCore.clampSessionSize(state.profile.sessionSize));
    els.cutoffSelect.value = String(state.profile.cutoffYear);
  }

  function saveControls() {
    state.profile.mode = els.modeSelect.value;
    state.profile.direction = els.dirSelect.value;
    state.profile.focus = els.focusSelect.value;
    state.profile.sessionSize = AppCore.clampSessionSize(els.sessionSize.value);
    state.profile.cutoffYear = Number(els.cutoffSelect.value);
    els.sessionSize.value = String(state.profile.sessionSize);
    AppCore.saveProfile(state.profile);
  }

  function createDeckFilter() {
    const decks = [...new Set(state.cards.map((card) => card.deck))];
    const selected = Array.isArray(state.profile.selectedDecks) ? state.profile.selectedDecks : [];
    state.profile.selectedDecks = selected.filter((deck) => decks.includes(deck));
    if (state.profile.selectedDecks.length === 0) state.profile.selectedDecks = decks.slice();
    els.deckFilter.innerHTML = "";
    decks.forEach((deck) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deckChip";
      button.textContent = deck.replace("Klasse ", "Kl. ");
      button.dataset.deck = deck;
      button.addEventListener("click", () => toggleDeck(deck));
      els.deckFilter.appendChild(button);
    });
    updateDeckFilterUi();
  }

  function toggleDeck(deck) {
    const selected = new Set(state.profile.selectedDecks);
    if (selected.has(deck) && selected.size > 1) selected.delete(deck);
    else selected.add(deck);
    state.profile.selectedDecks = [...selected];
    AppCore.saveProfile(state.profile);
    updateDeckFilterUi();
    updateDashboard();
  }

  function toggleAllDecks() {
    const decks = [...new Set(state.cards.map((card) => card.deck))];
    state.profile.selectedDecks = state.profile.selectedDecks.length === decks.length ? [decks[0]] : decks;
    AppCore.saveProfile(state.profile);
    updateDeckFilterUi();
    updateDashboard();
  }

  function updateDeckFilterUi() {
    const selected = new Set(state.profile.selectedDecks);
    $$("#deckFilter .deckChip").forEach((button) => {
      const active = selected.has(button.dataset.deck);
      button.classList.toggle("isActive", active);
      button.setAttribute("aria-pressed", String(active));
    });
    els.deckSummary.textContent = `${selected.size} von 4 Klassen aktiv`;
  }

  function updateDashboard() {
    const overview = AppCore.computeOverview(
      state.cards,
      state.progress,
      state.profile.selectedDecks,
      Number(els.cutoffSelect.value),
    );
    els.statDue.textContent = String(overview.due);
    els.statNew.textContent = String(overview.newCount);
    els.statWeak.textContent = String(overview.weak);
    els.statLearning.textContent = String(overview.learning);
    els.statMastered.textContent = String(overview.mastered);
    els.catalogProgress.textContent = `${overview.mastered} von ${overview.total} Merkzahlen beherrscht`;
    els.statAccuracy.textContent = overview.accuracy == null ? "Noch keine bewerteten Antworten"
      : `Gesamt: ${overview.correct} richtig · ${overview.wrong} falsch · ${overview.accuracy}% Trefferquote`;
    els.masteryTrack.innerHTML = "";
    [["new", overview.newCount], ["learning", overview.learning], ["weak", overview.weak], ["mastered", overview.mastered]].forEach(([kind, count]) => {
      const segment = document.createElement("span");
      segment.className = `masterySegment ${kind}`;
      segment.style.flexGrow = String(count);
      els.masteryTrack.appendChild(segment);
    });
    els.sessionHint.textContent = `${AppCore.formatCardCount(overview.total)} · ${AppCore.MODE_LABELS[els.modeSelect.value]} · ${AppCore.FOCUS_LABELS[els.focusSelect.value]}`;
  }

  function updateSessionStats() {
    if (!state.session) return;
    const total = state.session.correct + state.session.wrong;
    els.sCorrect.textContent = String(state.session.correct);
    els.sWrong.textContent = String(state.session.wrong);
    els.sAcc.textContent = total ? `${Math.round((state.session.correct / total) * 100)}%` : "–";
    els.qStreak.textContent = `Serie ${state.session.streak}`;
    els.qStreak.classList.toggle("isHot", state.session.streak >= 3);
    els.qProgress.value = total;
    els.qProgress.max = state.session.cards.length;
    els.qProgress.textContent = `${total} von ${state.session.cards.length} beantwortet`;
    els.qProgress.setAttribute("aria-label", `Fortschritt: ${total} von ${state.session.cards.length} beantwortet, ${state.session.correct} richtig, ${state.session.wrong} falsch`);
    els.roundLabel.textContent = els.qProgress.textContent;
    els.answerTrack.innerHTML = "";
    state.session.cards.forEach((_, index) => {
      const result = state.session.answered[index];
      const segment = document.createElement("span");
      segment.className = `answerSegment ${result ? result.correct ? "isCorrect" : "isWrong" : ""}`;
      segment.textContent = result ? result.correct ? "✓" : "×" : "";
      els.answerTrack.appendChild(segment);
    });
  }

  function setActionMode(mode) {
    els.revealBtn.hidden = mode !== "reveal";
    els.goodBtn.hidden = mode !== "rate";
    els.badBtn.hidden = mode !== "rate";
    els.nextBtn.hidden = mode !== "next";
  }

  function renderCurrentQuestion() {
    const session = state.session;
    if (!session) return;
    if (session.index >= session.cards.length) {
      finishSession();
      return;
    }
    const card = session.cards[session.index];
    const pair = AppCore.directionPair(card, session.direction, session.contextCards);
    const currentMode = AppCore.sessionModeForIndex(session.mode, session.index);
    const meta = AppCore.getCardMeta(card, state.progress);
    session.currentMode = currentMode;

    els.welcomeCard.hidden = true;
    els.emptyTraining.hidden = true;
    els.playCard.hidden = false;
    els.playTitle.textContent = session.isRetry ? "Deine zweite Chance" : "Schritt für Schritt.";
    els.qIndex.textContent = `${session.index + 1} / ${session.cards.length}`;
    els.qModeLabel.textContent = AppCore.MODE_LABELS[currentMode];
    const learningState = meta.isNew ? "Neu" : meta.isWeak ? "Unsicher" : meta.due ? "Fällig" : "Wiederholung";
    const multipleAnswers = pair.answerCount > 1 ? ` · ${pair.answerCount} Ereignisse` : "";
    els.questionContext.textContent = `${card.deck} · ${learningState}${multipleAnswers}`;
    els.question.textContent = pair.question;
    els.question.classList.toggle("isLong", pair.question.length > 28);
    els.answer.textContent = pair.answer;
    els.answer.hidden = true;
    els.answerFeedback.hidden = true;
    els.typeInput.removeAttribute("aria-invalid");
    els.modeHint.textContent = currentMode === "cards" ? "Erst selbst erinnern, dann aufdecken und ehrlich bewerten."
      : currentMode === "type" ? `${pair.answerCount > 1 ? "Nenne beide Ereignisse. " : ""}Tippe deine Antwort. „Nicht gewusst“ zählt als falsch.`
      : "Wähle die passende Antwort. Eine Auswahl zählt sofort.";
    els.mcArea.hidden = true;
    els.mcArea.innerHTML = "";
    els.typeArea.hidden = true;
    els.typeInput.value = "";
    els.typeInput.disabled = false;
    els.checkBtn.disabled = false;
    els.revealBtn.textContent = currentMode === "cards" ? "Antwort zeigen" : "Nicht gewusst · Lösung zeigen";
    els.nextBtn.textContent = session.index === session.cards.length - 1 ? "Auswertung ansehen" : "Weiter";
    setActionMode("reveal");
    updateSessionStats();
    if (currentMode === "mc") renderMc(card, pair);
    if (currentMode === "type") renderType(pair);
  }

  function renderMc(card, pair) {
    els.mcArea.hidden = false;
    const activeCards = state.session.contextCards;
    AppCore.buildMcOptions(activeCards, card, state.session.direction).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "optionButton";
      button.textContent = option;
      button.addEventListener("click", () => {
        const correct = option === pair.answer;
        $$("#mcArea button").forEach((node) => {
          node.disabled = true;
          if (node.textContent === pair.answer) node.classList.add("isCorrect");
        });
        if (!correct) button.classList.add("isWrong");
        els.answer.hidden = false;
        gradeCurrentCard(correct, { answer: option, source: "choice" });
      });
      els.mcArea.appendChild(button);
    });
  }

  function renderType(pair) {
    els.typeArea.hidden = false;
    const check = () => {
      if (state.session?.graded) return;
      if (!els.typeInput.value.trim()) {
        els.typeInput.setAttribute("aria-invalid", "true");
        els.modeHint.textContent = "Bitte tippe eine Antwort ein oder wähle „Nicht gewusst“.";
        els.typeInput.focus();
        return;
      }
      els.answer.hidden = false;
      const correct = AppCore.evaluateTypedAnswer(els.typeInput.value, pair.answer);
      els.typeInput.setAttribute("aria-invalid", String(!correct));
      gradeCurrentCard(correct, { answer: els.typeInput.value.trim(), source: "typed" });
    };
    els.checkBtn.onclick = check;
    els.typeInput.onkeydown = (event) => {
      if (event.key === "Enter") { event.preventDefault(); check(); }
    };
    window.setTimeout(() => els.typeInput.focus(), 100);
  }

  function gradeCurrentCard(correct, response) {
    const session = state.session;
    if (!session || session.graded) return;
    const card = session.cards[session.index];
    const result = AppCore.gradeSession(state.progress, session, correct, response);
    if (!result) return;
    if (session.currentMode === "mc") {
      $$("#mcArea button").forEach((button) => {
        button.disabled = true;
        if (button.textContent === els.answer.textContent) button.classList.add("isCorrect");
      });
    }
    els.typeInput.disabled = true;
    els.checkBtn.disabled = true;
    persist();
    updateSessionStats();
    updateDashboard();
    setActionMode("next");
    const meta = AppCore.getCardMeta(card, state.progress);
    const label = meta.isWeak ? "Unsicher" : meta.mastered ? "Beherrscht" : "Im Aufbau";
    els.lastAnswer.textContent = `${correct ? "✓ Richtig" : "✕ Falsch"} · ${card.prompt} · ${label} · ${meta.state.correct}× richtig / ${meta.state.wrong}× falsch`;
    els.lastAnswer.dataset.result = correct ? "correct" : "wrong";
    els.answerFeedback.dataset.result = correct ? "correct" : "wrong";
    els.feedbackTitle.textContent = correct
      ? session.streak >= 3 ? `✓ Richtig! ${session.streak} in Folge.` : "✓ Richtig!"
      : result.source === "reveal" ? "✕ Als nicht gewusst gespeichert" : "✕ Noch nicht richtig";
    const nextDays = Math.round((meta.state.due - meta.state.lastSeen) / 86400000);
    els.feedbackDetail.textContent = correct
      ? `${label} · ${Math.min(5, meta.state.box)}/5 Lernstufen${meta.isWeak ? " · Noch einmal richtig, dann nicht mehr unsicher." : ` · Wiederholung in ${nextDays} ${nextDays === 1 ? "Tag" : "Tagen"}.`}`
      : "Als falsch gespeichert. Diese Karte ist jetzt fällig und kommt in deine Fehler-Runde.";
    els.answerFeedback.hidden = false;
    els.nextBtn.focus();
  }

  function startSession(retry = false) {
    saveControls();
    els.summaryCard.hidden = true;
    const cards = retry ? AppCore.retryCards(state.displayedSummary, state.cards) : AppCore.chooseCards(state.cards, state.progress, {
      focus: state.profile.focus,
      count: state.profile.sessionSize,
      selectedDecks: state.profile.selectedDecks,
      cutoffYear: state.profile.cutoffYear,
    });
    if (cards.length === 0) {
      state.session = null;
      setPracticeActive(false);
      els.welcomeCard.hidden = true;
      els.playCard.hidden = true;
      els.emptyTraining.hidden = false;
      const label = AppCore.FOCUS_LABELS[state.profile.focus].toLowerCase();
      els.emptyTrainingText.textContent = `Im gewählten Zeitraum gibt es gerade keine Karten für „${label}“. Wähle einen anderen Fokus oder erweitere den Zeitraum.`;
      return;
    }
    const options = retry ? state.displayedSummary : state.profile;
    // Freeze the question context: changing filters must never change an active answer.
    const context = retry ? state.cards : AppCore.filterCards(state.cards, state.profile.selectedDecks, state.profile.cutoffYear);
    state.session = AppCore.createSession(cards, options, context);
    state.session.isRetry = retry;
    setPracticeActive(true);
    renderCurrentQuestion();
    els.playCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function nextQuestion() {
    if (!state.session || !state.session.graded) return;
    state.session.index += 1;
    state.session.graded = false;
    renderCurrentQuestion();
  }

  function finishSession() {
    if (!state.session) return;
    const summary = AppCore.buildSummary(state.session);
    state.profile.lastSummary = summary;
    persist();
    renderSummary(summary);
    els.playCard.hidden = true;
    els.summaryCard.hidden = false;
    setPracticeActive(false);
    state.session = null;
    els.summaryCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    updateDashboard();
    els.summaryTitle.focus({ preventScroll: true });
  }

  function renderSummary(summary, restored = false) {
    state.displayedSummary = summary;
    els.summaryContext.textContent = `${restored ? "Letzte abgeschlossene Runde" : "Runde beendet"} · ${AppCore.MODE_LABELS[summary.mode]}`;
    els.onlyMistakes.checked = false;
    els.summaryTitle.textContent = summary.total === 0 ? "Noch keine Antwort bewertet."
      : summary.wrong === 0 ? "Alles richtig. Stark!" : "Runde geschafft.";
    els.summaryAccuracy.textContent = `${summary.accuracy}%`;
    els.summaryBestStreak.textContent = String(summary.bestStreak);
    els.summaryTotal.textContent = String(summary.total);
    els.summaryCounts.textContent = `${summary.correct} richtig · ${summary.wrong} falsch · ${summary.total} beantwortet`;
    els.summaryRecommendation.textContent = summary.total === 0 ? "Starte eine neue Runde, wenn du bereit bist." : summary.recommendation;
    const retryCount = AppCore.retryCards(summary, state.cards).length;
    els.retryBtn.hidden = retryCount === 0;
    els.retryBtn.textContent = `${retryCount} ${retryCount === 1 ? "Fehlerkarte" : "Fehlerkarten"} üben`;
    renderResults();
  }

  function renderResults() {
    els.summaryResults.innerHTML = "";
    const results = state.displayedSummary?.results || [];
    let visible = 0;
    results.forEach((result, index) => {
      if (els.onlyMistakes.checked && result.correct) return;
      visible += 1;
      const item = document.createElement("li");
      item.className = `resultItem ${result.correct ? "isCorrect" : "isWrong"}`;
      item.value = index + 1;
      const heading = document.createElement("strong");
      heading.textContent = `${result.correct ? "✓ Richtig" : "✕ Falsch"} · ${result.card.deck} · ${AppCore.MODE_LABELS[result.mode]}`;
      const question = document.createElement("p");
      question.className = "resultQuestion";
      question.textContent = result.question;
      const submitted = document.createElement("p");
      submitted.textContent = result.source === "self" ? `Selbst bewertet: ${result.correct ? "richtig gewusst" : "nicht gewusst"}`
        : result.source === "reveal" ? `Lösung aufgedeckt${result.submittedAnswer ? ` · Eingabe: ${result.submittedAnswer}` : " · nicht gewusst"}`
        : `Deine Antwort: ${result.submittedAnswer}`;
      const expected = document.createElement("p");
      expected.textContent = `Lösung: ${result.expectedAnswer}`;
      item.appendChild(heading);
      item.appendChild(question);
      item.appendChild(submitted);
      item.appendChild(expected);
      els.summaryResults.appendChild(item);
    });
    els.summaryEmpty.hidden = visible > 0;
    els.summaryEmpty.textContent = results.length === 0 ? "In dieser Runde wurden keine Antworten bewertet."
      : "Keine Fehler in dieser Runde. Stark!";
  }

  function restoreLastSummary() {
    // Legacy summaries contain no question/input log and cannot be reconstructed honestly.
    if (state.profile.lastSummary?.schemaVersion !== 2 || !Array.isArray(state.profile.lastSummary.results)) return;
    renderSummary(state.profile.lastSummary, true);
    els.welcomeCard.hidden = true;
    els.summaryCard.hidden = false;
  }

  function revealAnswer() {
    if (!state.session || state.session.graded) return;
    els.answer.hidden = false;
    if (state.session.currentMode === "cards") {
      setActionMode("rate");
      els.modeHint.textContent = "War deine gedachte Antwort richtig? Wähle eine Bewertung – erst dann zählt sie.";
      els.goodBtn.focus();
    } else gradeCurrentCard(false, { answer: els.typeInput.value.trim(), source: "reveal" });
  }

  function resetProgress() {
    localStorage.removeItem(AppCore.STORAGE_KEY);
    localStorage.removeItem("merkzahlen_progress_v2");
    state.progress = {};
    state.profile.lastSummary = null;
    AppCore.saveProfile(state.profile);
    state.session = null;
    setPracticeActive(false);
    state.displayedSummary = null;
    els.lastAnswer.textContent = "Jede bewertete Antwort zählt – in allen Lernmodi.";
    delete els.lastAnswer.dataset.result;
    els.playCard.hidden = true;
    els.emptyTraining.hidden = true;
    els.summaryCard.hidden = true;
    els.welcomeCard.hidden = false;
    updateDashboard();
    showDataStatus("Fortschritt gelöscht.");
  }

  function showDataStatus(message, isError = false) {
    els.dataStatus.textContent = message;
    els.dataStatus.classList.toggle("isError", isError);
  }

  function exportProgress() {
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      progress: state.progress,
      profile: state.profile,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `merkzahlen-fortschritt-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showDataStatus("Sicherung erstellt.");
  }

  async function importProgress(file) {
    try {
      const payload = JSON.parse(await file.text());
      const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
      if (!payload || !isRecord(payload.progress) || !isRecord(payload.profile)) {
        throw new Error("Ungültiges Format");
      }
      state.progress = payload.progress;
      state.profile = { ...AppCore.PROFILE_DEFAULTS, ...payload.profile };
      state.session = null;
      setPracticeActive(false);
      els.playCard.hidden = true;
      els.emptyTraining.hidden = true;
      els.welcomeCard.hidden = false;
      els.summaryCard.hidden = true;
      state.displayedSummary = null;
      els.lastAnswer.textContent = "Sicherung geladen. Starte eine neue Runde.";
      delete els.lastAnswer.dataset.result;
      persist();
      restoreControls();
      updateTheme();
      createDeckFilter();
      updateDashboard();
      restoreLastSummary();
      showDataStatus("Sicherung geladen.");
    } catch {
      showDataStatus("Diese Datei konnte nicht geladen werden.", true);
    } finally {
      els.importInput.value = "";
    }
  }

  function bindEvents() {
    els.startBtn.addEventListener("click", () => startSession());
    els.anotherRoundBtn.addEventListener("click", () => startSession());
    els.quickStartBtn.addEventListener("click", () => { els.sessionSize.value = "10"; startSession(); });
    els.retryBtn.addEventListener("click", () => startSession(true));
    els.onlyMistakes.addEventListener("change", renderResults);
    els.toggleAllDecksBtn.addEventListener("click", toggleAllDecks);
    els.modeSelect.addEventListener("change", () => { saveControls(); updateDashboard(); });
    els.focusSelect.addEventListener("change", () => { saveControls(); updateDashboard(); });
    els.dirSelect.addEventListener("change", saveControls);
    els.cutoffSelect.addEventListener("change", () => { saveControls(); updateDashboard(); });
    els.sessionSize.addEventListener("change", () => { saveControls(); updateDashboard(); });
    els.revealBtn.addEventListener("click", revealAnswer);
    els.goodBtn.addEventListener("click", () => gradeCurrentCard(true));
    els.badBtn.addEventListener("click", () => gradeCurrentCard(false));
    els.nextBtn.addEventListener("click", nextQuestion);
    els.finishBtn.addEventListener("click", finishSession);
    els.resetBtn.addEventListener("click", () => els.resetDialog.showModal());
    els.cancelResetBtn.addEventListener("click", () => els.resetDialog.close());
    els.confirmResetBtn.addEventListener("click", () => { resetProgress(); els.resetDialog.close(); });
    els.exportBtn.addEventListener("click", exportProgress);
    els.importBtn.addEventListener("click", () => els.importInput.click());
    els.importInput.addEventListener("change", () => {
      if (els.importInput.files[0]) importProgress(els.importInput.files[0]);
    });
    $$("#themeSwitch button").forEach((button) => {
      button.addEventListener("click", () => {
        state.profile.theme = button.dataset.theme;
        AppCore.saveProfile(state.profile);
        updateTheme();
      });
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      els.installBtn.hidden = false;
    });
    els.installBtn.addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      try { await state.installPrompt.userChoice; } catch {}
      state.installPrompt = null;
      els.installBtn.hidden = true;
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try { await navigator.serviceWorker.register("service-worker.js"); } catch {}
  }

  async function boot() {
    try {
      const response = await fetch("data.json");
      if (!response.ok) throw new Error("Daten nicht erreichbar");
      state.cards = AppCore.flattenDecks(await response.json());
      if (state.cards.length === 0) throw new Error("Keine Karten gefunden");
      restoreControls();
      bindEvents();
      updateTheme();
      createDeckFilter();
      updateDashboard();
      restoreLastSummary();
      registerServiceWorker();
    } catch {
      els.bootError.hidden = false;
      els.startBtn.disabled = true;
    }
  }

  boot();
}

if (typeof window !== "undefined") window.AppCore = AppCore;
if (typeof module !== "undefined" && module.exports) module.exports = AppCore;
