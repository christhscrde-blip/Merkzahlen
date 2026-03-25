const AppCore = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const STORAGE_KEY = "merkzahlen_progress_v2";
  const PROFILE_KEY = "merkzahlen_profile_v2";
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60].map((days) => days * DAY);

  const MODE_LABELS = {
    mix: "Mix",
    cards: "Karteikarten",
    mc: "Multiple Choice",
    type: "Tippen",
  };

  const FOCUS_LABELS = {
    mixed: "Gemischt priorisiert",
    due: "Nur fällig",
    new: "Nur neu",
    weak: "Nur unsicher",
  };

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[„“"]/g, "")
      .replace(/[^\p{L}\p{N}\s./-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }

  function loadProgress() {
    return loadJson(STORAGE_KEY, {});
  }

  function saveProgress(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function loadProfile() {
    return loadJson(PROFILE_KEY, {
      theme: "atelier-night",
      selectedDecks: [],
      lastSummary: null,
    });
  }

  function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function ensureCardState(progress, cardId) {
    if (!progress[cardId]) {
      progress[cardId] = {
        box: 0,
        due: 0,
        seen: 0,
        correct: 0,
        wrong: 0,
        lastSeen: 0,
        lastWrongAt: 0,
      };
    }
    return progress[cardId];
  }

  function flattenDecks(db) {
    return Object.entries(db).flatMap(([deck, cards]) =>
      cards.map((card) => ({
        ...card,
        deck,
      })),
    );
  }

  function getCardMeta(card, progress, timestamp = Date.now()) {
    const state = ensureCardState(progress, card.id);
    return {
      due: state.due <= timestamp,
      isNew: state.seen === 0,
      isWeak: state.wrong > state.correct || (state.wrong > 0 && timestamp - state.lastWrongAt < 14 * DAY),
      mastered: state.box >= 5,
      state,
    };
  }

  function computeOverview(cards, progress, selectedDecks, timestamp = Date.now()) {
    const active = filterCardsByDeck(cards, selectedDecks);
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

    if (attempts > 0) {
      stats.accuracy = Math.round((correct / attempts) * 100);
    }

    return stats;
  }

  function filterCardsByDeck(cards, selectedDecks) {
    if (!selectedDecks || selectedDecks.length === 0) return cards.slice();
    const allowed = new Set(selectedDecks);
    return cards.filter((card) => allowed.has(card.deck));
  }

  function chooseCards(cards, progress, options, timestamp = Date.now()) {
    const { focus = "mixed", count = 16, selectedDecks = [] } = options;
    const active = filterCardsByDeck(cards, selectedDecks);
    const scored = active.map((card) => {
      const meta = getCardMeta(card, progress, timestamp);
      let weight = 1;
      if (meta.due) weight += 6;
      if (meta.isWeak) weight += 5;
      if (meta.isNew) weight += 4;
      weight += Math.max(0, meta.state.wrong - meta.state.correct);
      return {
        card,
        meta,
        weight,
      };
    });

    let filtered = scored;
    if (focus === "due") filtered = scored.filter((entry) => entry.meta.due);
    if (focus === "new") filtered = scored.filter((entry) => entry.meta.isNew);
    if (focus === "weak") filtered = scored.filter((entry) => entry.meta.isWeak);
    if (filtered.length === 0) filtered = scored;

    const ordered = filtered
      .slice()
      .sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.meta.state.due - b.meta.state.due;
      })
      .map((entry) => entry.card);

    return ordered.slice(0, Math.min(count, ordered.length));
  }

  function directionPair(card, direction) {
    if (direction === "event2year") {
      return { question: card.answer, answer: card.prompt };
    }
    return { question: card.prompt, answer: card.answer };
  }

  function sessionModeForIndex(mode, index) {
    if (mode !== "mix") return mode;
    return ["cards", "mc", "type"][index % 3];
  }

  function buildMcOptions(cards, currentCard, direction) {
    const correct = directionPair(currentCard, direction).answer;
    const options = [correct];
    const candidates = cards
      .filter((card) => card.id !== currentCard.id)
      .map((card) => directionPair(card, direction).answer)
      .filter((answer, index, arr) => arr.indexOf(answer) === index);

    for (let i = 0; i < candidates.length && options.length < 4; i += 1) {
      const candidate = candidates[i];
      if (!options.includes(candidate)) options.push(candidate);
    }

    while (options.length < Math.min(4, cards.length)) {
      options.push(correct);
    }

    return shuffle(options).slice(0, Math.min(4, options.length));
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function evaluateTypedAnswer(input, truth) {
    const normalizedInput = normalizeText(input);
    const normalizedTruth = normalizeText(truth);
    if (!normalizedInput || !normalizedTruth) return false;
    if (normalizedInput === normalizedTruth) return true;
    if (normalizedInput.length >= 4 && normalizedTruth.includes(normalizedInput)) return true;
    if (normalizedTruth.length >= 4 && normalizedInput.includes(normalizedTruth)) return true;

    const truthParts = normalizedTruth.split(" ");
    const inputParts = normalizedInput.split(" ");
    const overlap = inputParts.filter((part) => truthParts.includes(part));
    return overlap.length >= Math.max(2, Math.ceil(truthParts.length / 2));
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
    const recommendation =
      accuracy >= 85
        ? "Sehr stabil. Nächstes Mal fällige Karten oder die Gegenrichtung trainieren."
        : accuracy >= 60
          ? "Ordentlich, aber nicht fest. Wiederhole vor allem die markierten Schwachstellen."
          : "Noch wacklig. Kürzere Session, Fokus auf unsicher und Tippen lohnt sich.";

    const weakCards = session.answered
      .filter((item) => !item.correct)
      .slice(-5)
      .map((item) => `${item.card.prompt} – ${item.card.answer}`);

    return {
      accuracy,
      bestStreak: session.bestStreak,
      total,
      recommendation,
      weakCards,
    };
  }

  return {
    MODE_LABELS,
    FOCUS_LABELS,
    STORAGE_KEY,
    PROFILE_KEY,
    normalizeText,
    loadProgress,
    saveProgress,
    loadProfile,
    saveProfile,
    ensureCardState,
    flattenDecks,
    getCardMeta,
    computeOverview,
    filterCardsByDeck,
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

if (!window.__MERKZAHLEN_TEST__) {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    startBtn: $("#startBtn"),
    installBtn: $("#installBtn"),
    modeSelect: $("#modeSelect"),
    dirSelect: $("#dirSelect"),
    focusSelect: $("#focusSelect"),
    sessionSize: $("#sessionSize"),
    themeSwitch: $("#themeSwitch"),
    deckFilter: $("#deckFilter"),
    toggleAllDecksBtn: $("#toggleAllDecksBtn"),
    resetBtn: $("#resetBtn"),
    sessionHint: $("#sessionHint"),
    deckSummary: $("#deckSummary"),
    heroDue: $("#heroDue"),
    heroFocus: $("#heroFocus"),
    statMastered: $("#statMastered"),
    statWeak: $("#statWeak"),
    statAccuracy: $("#statAccuracy"),
    statDecks: $("#statDecks"),
    quickDue: $("#quickDue"),
    quickNew: $("#quickNew"),
    quickWeak: $("#quickWeak"),
    playCard: $("#playCard"),
    playTitle: $("#playTitle"),
    qIndex: $("#qIndex"),
    qModeLabel: $("#qModeLabel"),
    qStreak: $("#qStreak"),
    qScore: $("#qScore"),
    questionContext: $("#questionContext"),
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
    playHint: $("#playHint"),
    summaryEmpty: $("#summaryEmpty"),
    summaryContent: $("#summaryContent"),
    summaryAccuracy: $("#summaryAccuracy"),
    summaryBestStreak: $("#summaryBestStreak"),
    summaryTotal: $("#summaryTotal"),
    summaryRecommendation: $("#summaryRecommendation"),
    summaryWeakList: $("#summaryWeakList"),
  };

  const state = {
    db: null,
    cards: [],
    progress: AppCore.loadProgress(),
    profile: AppCore.loadProfile(),
    session: null,
    installPrompt: null,
  };

  function updateThemeButtons() {
    $$("#themeSwitch button").forEach((button) => {
      button.classList.toggle("isActive", button.dataset.theme === state.profile.theme);
    });
    document.body.dataset.theme = state.profile.theme;
  }

  function createDeckFilter() {
    const decks = [...new Set(state.cards.map((card) => card.deck))];
    if (!Array.isArray(state.profile.selectedDecks) || state.profile.selectedDecks.length === 0) {
      state.profile.selectedDecks = decks.slice();
    } else {
      state.profile.selectedDecks = state.profile.selectedDecks.filter((deck) => decks.includes(deck));
      if (state.profile.selectedDecks.length === 0) state.profile.selectedDecks = decks.slice();
    }

    els.deckFilter.innerHTML = "";
    decks.forEach((deck) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deckChip";
      button.textContent = deck;
      button.dataset.deck = deck;
      button.addEventListener("click", () => toggleDeck(deck));
      els.deckFilter.appendChild(button);
    });

    updateDeckFilterUi();
  }

  function toggleDeck(deck) {
    const selected = new Set(state.profile.selectedDecks);
    if (selected.has(deck) && selected.size > 1) {
      selected.delete(deck);
    } else if (!selected.has(deck)) {
      selected.add(deck);
    }
    state.profile.selectedDecks = [...selected];
    AppCore.saveProfile(state.profile);
    updateDeckFilterUi();
    updateDashboard();
  }

  function toggleAllDecks() {
    const decks = [...new Set(state.cards.map((card) => card.deck))];
    const allActive = state.profile.selectedDecks.length === decks.length;
    state.profile.selectedDecks = allActive ? [decks[0]] : decks.slice();
    AppCore.saveProfile(state.profile);
    updateDeckFilterUi();
    updateDashboard();
  }

  function updateDeckFilterUi() {
    const selected = new Set(state.profile.selectedDecks);
    $$("#deckFilter .deckChip").forEach((button) => {
      button.classList.toggle("isActive", selected.has(button.dataset.deck));
    });
    els.deckSummary.textContent =
      selected.size === state.cards.reduce((set, card) => set.add(card.deck), new Set()).size
        ? "Alle Klassen aktiv."
        : `${selected.size} Klassen aktiv: ${state.profile.selectedDecks.join(", ")}`;
    els.statDecks.textContent = String(selected.size);
  }

  function updateDashboard() {
    const overview = AppCore.computeOverview(state.cards, state.progress, state.profile.selectedDecks);
    els.heroDue.textContent = `${overview.due} Karten fällig`;
    els.heroFocus.textContent = `Fokus: ${AppCore.FOCUS_LABELS[els.focusSelect.value]}. ${overview.newCount} neue und ${overview.weak} unsichere Karten im aktiven Bereich.`;
    els.statMastered.textContent = String(overview.mastered);
    els.statWeak.textContent = String(overview.weak);
    els.statAccuracy.textContent = overview.accuracy == null ? "-" : `${overview.accuracy}%`;
    els.quickDue.textContent = String(overview.due);
    els.quickNew.textContent = String(overview.newCount);
    els.quickWeak.textContent = String(overview.weak);
    els.sessionHint.textContent = `Modus ${AppCore.MODE_LABELS[els.modeSelect.value]} · ${AppCore.FOCUS_LABELS[els.focusSelect.value]}`;
  }

  function updateMiniStats() {
    if (!state.session) return;
    const total = state.session.correct + state.session.wrong;
    els.qScore.textContent = String(state.session.score);
    els.sCorrect.textContent = String(state.session.correct);
    els.sWrong.textContent = String(state.session.wrong);
    els.sAcc.textContent = total ? `${Math.round((state.session.correct / total) * 100)}%` : "-";
    els.qStreak.textContent = `Serie ${state.session.streak}`;
  }

  function showButtons(mode) {
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
    els.playCard.hidden = false;
    els.playTitle.textContent = `Trainingsrunde · ${session.cards.length} Karten`;
    els.qIndex.textContent = `${session.index + 1}/${session.cards.length}`;
    els.qModeLabel.textContent = AppCore.MODE_LABELS[currentMode];
    els.questionContext.textContent = `${card.deck} · ${meta.isNew ? "Neu" : meta.isWeak ? "Unsicher" : meta.due ? "Fällig" : "Wiederholung"}`;
    els.question.textContent = pair.question;
    els.answer.textContent = pair.answer;
    els.answer.hidden = true;
    els.playHint.textContent = currentMode === "type"
      ? "Tippen ist am strengsten. Nutze es für wirklich wacklige Karten."
      : currentMode === "mc"
        ? "Multiple Choice ist gut zum Einsortieren, aber weniger streng als Tippen."
        : "Karteikarten sind schnell und ehrlich, wenn du vor dem Aufdecken wirklich stoppst.";

    els.mcArea.hidden = true;
    els.mcArea.innerHTML = "";
    els.typeArea.hidden = true;
    els.typeInput.value = "";
    showButtons("reveal");
    updateMiniStats();

    if (currentMode === "mc") {
      renderMc(card, pair);
    }

    if (currentMode === "type") {
      renderType(card, pair);
    }
  }

  function renderMc(card, pair) {
    els.mcArea.hidden = false;
    const options = AppCore.buildMcOptions(state.cards, card, state.session.direction);
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "optionButton";
      button.textContent = option;
      button.addEventListener("click", () => {
        const correct = option === pair.answer;
        [...els.mcArea.querySelectorAll("button")].forEach((node) => {
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

  function renderType(card, pair) {
    els.typeArea.hidden = false;
    const check = () => {
      const correct = AppCore.evaluateTypedAnswer(els.typeInput.value, pair.answer);
      els.answer.hidden = false;
      gradeCurrentCard(correct);
    };
    els.checkBtn.onclick = check;
    els.typeInput.onkeydown = (event) => {
      if (event.key === "Enter") check();
    };
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
      session.score += 12 + Math.min(session.streak, 5);
    } else {
      session.wrong += 1;
      session.streak = 0;
      session.score = Math.max(0, session.score - 4);
    }

    AppCore.saveProgress(state.progress);
    updateMiniStats();
    updateDashboard();
    showButtons("next");
  }

  function nextQuestion() {
    if (!state.session) return;
    state.session.index += 1;
    state.session.graded = false;
    renderCurrentQuestion();
  }

  function startSession() {
    const cards = AppCore.chooseCards(state.cards, state.progress, {
      focus: els.focusSelect.value,
      count: Number(els.sessionSize.value || 16),
      selectedDecks: state.profile.selectedDecks,
    });

    state.session = {
      mode: els.modeSelect.value,
      direction: els.dirSelect.value,
      cards,
      index: 0,
      graded: false,
      correct: 0,
      wrong: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      answered: [],
    };

    renderCurrentQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finishSession() {
    const summary = AppCore.buildSummary(state.session);
    state.profile.lastSummary = summary;
    AppCore.saveProfile(state.profile);

    els.summaryEmpty.hidden = true;
    els.summaryContent.hidden = false;
    els.summaryAccuracy.textContent = `${summary.accuracy}%`;
    els.summaryBestStreak.textContent = String(summary.bestStreak);
    els.summaryTotal.textContent = String(summary.total);
    els.summaryRecommendation.textContent = summary.recommendation;
    els.summaryWeakList.innerHTML = "";

    if (summary.weakCards.length === 0) {
      const item = document.createElement("li");
      item.textContent = "Keine frischen Fehlkarten. Nächster sinnvoller Schritt: Richtung wechseln oder Fokus auf fällig setzen.";
      els.summaryWeakList.appendChild(item);
    } else {
      summary.weakCards.forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = entry;
        els.summaryWeakList.appendChild(item);
      });
    }

    els.playHint.textContent = "Session beendet. Unten siehst du direkt, was als Nächstes sinnvoll ist.";
    showButtons("next");
    els.nextBtn.hidden = true;
    updateDashboard();
  }

  function revealAnswer() {
    els.answer.hidden = false;
    const mode = state.session?.currentMode || "cards";
    if (mode === "cards") {
      showButtons("rate");
    }
  }

  function resetProgress() {
    localStorage.removeItem(AppCore.STORAGE_KEY);
    state.progress = AppCore.loadProgress();
    state.profile.lastSummary = null;
    AppCore.saveProfile(state.profile);
    updateDashboard();
    els.summaryEmpty.hidden = false;
    els.summaryContent.hidden = true;
  }

  function restoreLastSummary() {
    const summary = state.profile.lastSummary;
    if (!summary) return;
    els.summaryEmpty.hidden = true;
    els.summaryContent.hidden = false;
    els.summaryAccuracy.textContent = `${summary.accuracy}%`;
    els.summaryBestStreak.textContent = String(summary.bestStreak);
    els.summaryTotal.textContent = String(summary.total);
    els.summaryRecommendation.textContent = summary.recommendation;
    els.summaryWeakList.innerHTML = "";
    const entries = summary.weakCards.length
      ? summary.weakCards
      : ["Keine frischen Fehlkarten. Nächster sinnvoller Schritt: Richtung wechseln oder Fokus auf fällig setzen."];
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      els.summaryWeakList.appendChild(item);
    });
  }

  function bindEvents() {
    els.startBtn.addEventListener("click", startSession);
    els.toggleAllDecksBtn.addEventListener("click", toggleAllDecks);
    els.resetBtn.addEventListener("click", resetProgress);
    els.modeSelect.addEventListener("change", updateDashboard);
    els.focusSelect.addEventListener("change", updateDashboard);
    els.dirSelect.addEventListener("change", updateDashboard);
    els.revealBtn.addEventListener("click", revealAnswer);
    els.goodBtn.addEventListener("click", () => gradeCurrentCard(true));
    els.badBtn.addEventListener("click", () => gradeCurrentCard(false));
    els.nextBtn.addEventListener("click", nextQuestion);
    $$("#themeSwitch button").forEach((button) => {
      button.addEventListener("click", () => {
        state.profile.theme = button.dataset.theme;
        AppCore.saveProfile(state.profile);
        updateThemeButtons();
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
      try {
        await state.installPrompt.userChoice;
      } catch {}
      state.installPrompt = null;
      els.installBtn.hidden = true;
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("service-worker.js");
    } catch {}
  }

  async function boot() {
    const response = await fetch("data.json");
    state.db = await response.json();
    state.cards = AppCore.flattenDecks(state.db);
    bindEvents();
    updateThemeButtons();
    createDeckFilter();
    updateDashboard();
    restoreLastSummary();
    registerServiceWorker();
  }

  boot();
}

window.AppCore = AppCore;
