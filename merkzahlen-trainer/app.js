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
    sessionSize: 16,
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
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
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
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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
    return progress[cardId];
  }

  function flattenDecks(db) {
    return Object.entries(db).flatMap(([deck, cards]) =>
      cards.map((card) => ({ ...card, deck })),
    );
  }

  function cardEndYear(card) {
    const years = String(card.prompt).match(/\b\d{4}\b/g)?.map(Number) || [];
    if (years.length > 0) return Math.max(...years);
    const century = String(card.prompt).match(/(\d{1,2})\.\s*Jh\./i);
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
    return {
      due: !isNew && state.due <= timestamp,
      isNew,
      isWeak: state.wrong > state.correct || (state.wrong > 0 && timestamp - state.lastWrongAt < 14 * DAY),
      mastered: state.box >= 5,
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
      mastered: 0,
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
      correct += meta.state.correct;
      attempts += meta.state.correct + meta.state.wrong;
    });

    if (attempts > 0) stats.accuracy = Math.round((correct / attempts) * 100);
    return stats;
  }

  function clampSessionSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 16;
    return Math.min(60, Math.max(5, parsed));
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

  function directionPair(card, direction) {
    return direction === "event2year"
      ? { question: card.answer, answer: card.prompt }
      : { question: card.prompt, answer: card.answer };
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
    const correct = directionPair(currentCard, direction).answer;
    const candidates = shuffle(
      cards
        .filter((card) => card.id !== currentCard.id)
        .map((card) => directionPair(card, direction).answer)
        .filter((answer, index, values) => answer !== correct && values.indexOf(answer) === index),
    );
    return shuffle([correct, ...candidates.slice(0, 3)]);
  }

  function evaluateTypedAnswer(input, truth) {
    const normalizedInput = normalizeText(input);
    const normalizedTruth = normalizeText(truth);
    if (!normalizedInput || !normalizedTruth) return false;
    if (normalizedInput === normalizedTruth) return true;
    if (/\d/.test(normalizedTruth)) return false;

    const stopwords = new Set(["der", "die", "das", "den", "dem", "des", "und", "von", "im", "in", "zu", "zur", "zum"]);
    const truthParts = normalizedTruth.split(" ").filter((part) => part.length > 1 && !stopwords.has(part));
    const inputParts = new Set(normalizedInput.split(" ").filter((part) => part.length > 1 && !stopwords.has(part)));
    const overlap = truthParts.filter((part) => inputParts.has(part)).length;
    return truthParts.length > 0 && overlap >= Math.ceil(truthParts.length * 0.7);
  }

  function applyGrade(progress, card, correct, timestamp = Date.now()) {
    const state = ensureCardState(progress, card.id);
    state.seen += 1;
    state.lastSeen = timestamp;

    if (correct) {
      state.correct += 1;
      state.box = Math.min(6, state.box + 1);
    } else {
      state.wrong += 1;
      state.lastWrongAt = timestamp;
      state.box = Math.max(0, state.box - 1);
    }

    state.due = timestamp + (INTERVALS[state.box] || 60 * DAY);
    return state;
  }

  function buildSummary(session) {
    const total = session.correct + session.wrong;
    const accuracy = total ? Math.round((session.correct / total) * 100) : 0;
    const recommendation = accuracy >= 85
      ? "Sehr stabil. Als Nächstes lohnt sich die Gegenrichtung."
      : accuracy >= 60
        ? "Solide Basis. Wiederhole vor allem die markierten Schwachstellen."
        : "Nimm eine kürzere Runde und trainiere die unsicheren Karten noch einmal.";
    const weakCards = session.answered
      .filter((item) => !item.correct)
      .slice(-5)
      .map((item) => `${item.card.prompt} – ${item.card.answer}`);
    return { accuracy, bestStreak: session.bestStreak, total, recommendation, weakCards };
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
    chooseCards,
    directionPair,
    sessionModeForIndex,
    buildMcOptions,
    shuffle,
    evaluateTypedAnswer,
    applyGrade,
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
    summaryWeakList: $("#summaryWeakList"), resetDialog: $("#resetDialog"),
    cancelResetBtn: $("#cancelResetBtn"), confirmResetBtn: $("#confirmResetBtn"),
    exportBtn: $("#exportBtn"), importBtn: $("#importBtn"), importInput: $("#importInput"),
    dataStatus: $("#dataStatus"), bootError: $("#bootError"),
  };

  const state = {
    cards: [],
    progress: AppCore.loadProgress(),
    profile: AppCore.loadProfile(),
    session: null,
    installPrompt: null,
  };

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
    els.statMastered.textContent = String(overview.mastered);
    els.statAccuracy.textContent = overview.accuracy == null ? "Noch keine Antworten" : `${overview.accuracy}% Trefferquote`;
    els.sessionHint.textContent = `${overview.total} Karten · ${AppCore.MODE_LABELS[els.modeSelect.value]} · ${AppCore.FOCUS_LABELS[els.focusSelect.value]}`;
  }

  function updateSessionStats() {
    if (!state.session) return;
    const total = state.session.correct + state.session.wrong;
    els.sCorrect.textContent = String(state.session.correct);
    els.sWrong.textContent = String(state.session.wrong);
    els.sAcc.textContent = total ? `${Math.round((state.session.correct / total) * 100)}%` : "–";
    els.qStreak.textContent = `Serie ${state.session.streak}`;
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
    const pair = AppCore.directionPair(card, session.direction);
    const currentMode = AppCore.sessionModeForIndex(session.mode, session.index);
    const meta = AppCore.getCardMeta(card, state.progress);
    session.currentMode = currentMode;

    els.welcomeCard.hidden = true;
    els.emptyTraining.hidden = true;
    els.playCard.hidden = false;
    els.playTitle.textContent = `Lernrunde mit ${session.cards.length} Karten`;
    els.qIndex.textContent = `${session.index + 1} / ${session.cards.length}`;
    els.qModeLabel.textContent = AppCore.MODE_LABELS[currentMode];
    els.qProgress.value = session.index + 1;
    els.qProgress.max = session.cards.length;
    els.questionContext.textContent = `${card.deck} · ${meta.isNew ? "Neu" : meta.isWeak ? "Unsicher" : meta.due ? "Fällig" : "Wiederholung"}`;
    els.question.textContent = pair.question;
    els.answer.textContent = pair.answer;
    els.answer.hidden = true;
    els.mcArea.hidden = true;
    els.mcArea.innerHTML = "";
    els.typeArea.hidden = true;
    els.typeInput.value = "";
    els.typeInput.disabled = false;
    els.checkBtn.disabled = false;
    els.revealBtn.textContent = currentMode === "cards" ? "Antwort zeigen" : "Lösung anzeigen";
    setActionMode("reveal");
    updateSessionStats();
    if (currentMode === "mc") renderMc(card, pair);
    if (currentMode === "type") renderType(pair);
  }

  function renderMc(card, pair) {
    els.mcArea.hidden = false;
    const activeCards = AppCore.filterCards(state.cards, state.profile.selectedDecks, state.profile.cutoffYear);
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
        gradeCurrentCard(correct);
      });
      els.mcArea.appendChild(button);
    });
  }

  function renderType(pair) {
    els.typeArea.hidden = false;
    const check = () => {
      if (state.session?.graded) return;
      els.answer.hidden = false;
      gradeCurrentCard(AppCore.evaluateTypedAnswer(els.typeInput.value, pair.answer));
    };
    els.checkBtn.onclick = check;
    els.typeInput.onkeydown = (event) => {
      if (event.key === "Enter") check();
    };
    window.setTimeout(() => els.typeInput.focus(), 100);
  }

  function gradeCurrentCard(correct) {
    const session = state.session;
    if (!session || session.graded) return;
    const card = session.cards[session.index];
    AppCore.applyGrade(state.progress, card, correct);
    session.graded = true;
    session.answered.push({ card, correct });
    if (correct) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else {
      session.wrong += 1;
      session.streak = 0;
    }
    if (session.currentMode === "mc") {
      $$("#mcArea button").forEach((button) => {
        button.disabled = true;
        if (button.textContent === els.answer.textContent) button.classList.add("isCorrect");
      });
    }
    els.typeInput.disabled = true;
    els.checkBtn.disabled = true;
    AppCore.saveProgress(state.progress);
    updateSessionStats();
    updateDashboard();
    setActionMode("next");
  }

  function startSession() {
    saveControls();
    els.summaryCard.hidden = true;
    const cards = AppCore.chooseCards(state.cards, state.progress, {
      focus: state.profile.focus,
      count: state.profile.sessionSize,
      selectedDecks: state.profile.selectedDecks,
      cutoffYear: state.profile.cutoffYear,
    });
    if (cards.length === 0) {
      els.welcomeCard.hidden = true;
      els.playCard.hidden = true;
      els.emptyTraining.hidden = false;
      const label = AppCore.FOCUS_LABELS[state.profile.focus].toLowerCase();
      els.emptyTrainingText.textContent = `Im gewählten Zeitraum gibt es gerade keine Karten für „${label}“. Wähle einen anderen Fokus oder erweitere den Zeitraum.`;
      return;
    }
    state.session = {
      mode: state.profile.mode,
      direction: state.profile.direction,
      cards,
      index: 0,
      graded: false,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      answered: [],
    };
    renderCurrentQuestion();
  }

  function nextQuestion() {
    if (!state.session) return;
    state.session.index += 1;
    state.session.graded = false;
    renderCurrentQuestion();
  }

  function finishSession() {
    const summary = AppCore.buildSummary(state.session);
    state.profile.lastSummary = summary;
    AppCore.saveProfile(state.profile);
    renderSummary(summary);
    els.playCard.hidden = true;
    els.summaryCard.hidden = false;
    els.summaryCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    updateDashboard();
  }

  function renderSummary(summary) {
    els.summaryAccuracy.textContent = `${summary.accuracy}%`;
    els.summaryBestStreak.textContent = String(summary.bestStreak);
    els.summaryTotal.textContent = String(summary.total);
    els.summaryRecommendation.textContent = summary.recommendation;
    els.summaryWeakList.innerHTML = "";
    const entries = summary.weakCards.length ? summary.weakCards : ["Keine Fehlkarten in dieser Runde."];
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      els.summaryWeakList.appendChild(item);
    });
  }

  function restoreLastSummary() {
    if (!state.profile.lastSummary) return;
    renderSummary(state.profile.lastSummary);
    els.summaryCard.hidden = false;
  }

  function revealAnswer() {
    if (!state.session || state.session.graded) return;
    els.answer.hidden = false;
    if (state.session.currentMode === "cards") setActionMode("rate");
    else gradeCurrentCard(false);
  }

  function resetProgress() {
    localStorage.removeItem(AppCore.STORAGE_KEY);
    localStorage.removeItem("merkzahlen_progress_v2");
    state.progress = {};
    state.profile.lastSummary = null;
    AppCore.saveProfile(state.profile);
    state.session = null;
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
      if (!payload || typeof payload.progress !== "object" || typeof payload.profile !== "object") {
        throw new Error("Ungültiges Format");
      }
      state.progress = payload.progress;
      state.profile = { ...AppCore.PROFILE_DEFAULTS, ...payload.profile };
      AppCore.saveProgress(state.progress);
      AppCore.saveProfile(state.profile);
      restoreControls();
      updateTheme();
      createDeckFilter();
      updateDashboard();
      els.summaryCard.hidden = !state.profile.lastSummary;
      restoreLastSummary();
      showDataStatus("Sicherung geladen.");
    } catch {
      showDataStatus("Diese Datei konnte nicht geladen werden.", true);
    } finally {
      els.importInput.value = "";
    }
  }

  function bindEvents() {
    els.startBtn.addEventListener("click", startSession);
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
