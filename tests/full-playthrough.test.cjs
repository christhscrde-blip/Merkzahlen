const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const AppCore = require("../merkzahlen-trainer/app.js");
const data = require("../merkzahlen-trainer/data.json");

const cards = AppCore.flattenDecks(data);
const directions = ["year2event", "event2year"];

test("jede Katalogzeile ist vollständig und in beiden Richtungen spielbar", () => {
  assert.equal(cards.length, 56);

  for (const card of cards) {
    assert.match(card.id, /^k(?:7|8|9|10)-/);
    assert.ok(card.prompt.trim(), `${card.id}: Merkzahl fehlt`);
    assert.ok(card.answer.trim(), `${card.id}: Ereignis fehlt`);

    for (const direction of directions) {
      const pair = AppCore.directionPair(card, direction, cards);
      assert.ok(pair.question.trim(), `${card.id}/${direction}: Frage fehlt`);
      assert.ok(pair.answer.trim(), `${card.id}/${direction}: Antwort fehlt`);
      assert.equal(
        AppCore.evaluateTypedAnswer(pair.answer, pair.answer),
        true,
        `${card.id}/${direction}: exakte Eingabe wird nicht akzeptiert`,
      );
    }
  }

  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.answer)).size, cards.length);
  const duplicatePrompts = [...cards.reduce((counts, card) => {
    counts.set(card.prompt, (counts.get(card.prompt) || 0) + 1);
    return counts;
  }, new Map())].filter(([, count]) => count > 1);
  assert.deepEqual(duplicatePrompts, [["1919", 2], ["1955", 2]]);
});

test("entspricht ausschließlich dem Merkzahlenkatalog 2025/26", () => {
  const catalogHash = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  assert.equal(catalogHash, "e2d19ab23e593ba42d7b454bd2cc1aaf1c7fe40d75260db4b82903cf8420d43b");
});

test("fasst doppelte Merkzahlen zu eindeutigen Jahresfragen zusammen", () => {
  const pairs = new Map([
    ["1919", "Versailler Vertrag; Gründung des Völkerbundes"],
    ["1955", "Pariser Verträge (Beitritt der BRD zur NATO); Beitritt der DDR zum Warschauer Pakt"],
  ]);

  for (const [prompt, answer] of pairs) {
    const card = cards.find((entry) => entry.prompt === prompt);
    const pair = AppCore.directionPair(card, "year2event", cards);
    assert.equal(pair.answer, answer);
    assert.equal(pair.answerCount, 2);
  }
});

test("Multiple Choice bietet bei jeder Merkzahl und Richtung genau eine richtige Lösung", () => {
  for (const card of cards) {
    for (const direction of directions) {
      const correct = AppCore.directionPair(card, direction, cards).answer;
      const options = AppCore.buildMcOptions(cards, card, direction);
      assert.equal(options.length, 4, `${card.id}/${direction}: nicht vier Optionen`);
      assert.equal(new Set(options).size, 4, `${card.id}/${direction}: doppelte Optionen`);
      assert.equal(
        options.filter((option) => option === correct).length,
        1,
        `${card.id}/${direction}: richtige Lösung fehlt oder ist doppelt`,
      );
    }
  }
});

test("Mix-Modus wechselt für den ganzen Datensatz lückenlos durch alle Fragetypen", () => {
  const modes = cards.map((_, index) => AppCore.sessionModeForIndex("mix", index));
  assert.deepEqual(modes.slice(0, 6), ["cards", "mc", "type", "cards", "mc", "type"]);
  assert.equal(modes.filter((mode) => mode === "cards").length, 19);
  assert.equal(modes.filter((mode) => mode === "mc").length, 19);
  assert.equal(modes.filter((mode) => mode === "type").length, 18);
});

test("eine komplette fehlerfreie Runde verarbeitet alle 56 Merkzahlen", () => {
  const timestamp = Date.UTC(2026, 7, 31);
  const progress = {};
  const session = {
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    answered: [],
  };

  for (const card of cards) {
    const answer = AppCore.directionPair(card, "event2year").answer;
    const correct = AppCore.evaluateTypedAnswer(answer, card.prompt);
    assert.equal(correct, true, `${card.id}: richtige Merkzahl nicht erkannt`);
    AppCore.applyGrade(progress, card, correct, timestamp);
    session.correct += 1;
    session.streak += 1;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    session.answered.push({ card, correct });
  }

  const summary = AppCore.buildSummary(session);
  assert.deepEqual(
    { accuracy: summary.accuracy, total: summary.total, bestStreak: summary.bestStreak, weakCards: summary.weakCards },
    { accuracy: 100, total: 56, bestStreak: 56, weakCards: [] },
  );
  assert.equal(Object.keys(progress).length, 56);
  assert.ok(Object.values(progress).every((entry) => entry.seen === 1 && entry.correct === 1));
});

test("alle angebotenen Zeitgrenzen liefern den erwarteten vollständigen Umfang", () => {
  const expected = new Map([
    [1918, 19],
    [1933, 30],
    [1945, 41],
    [1949, 48],
    [1961, 53],
    [1990, 56],
  ]);

  for (const [year, count] of expected) {
    const filtered = AppCore.filterCards(cards, [], year);
    assert.equal(filtered.length, count, `Zeitgrenze ${year}`);
    assert.ok(filtered.every((card) => AppCore.cardEndYear(card) <= year));
  }
});

test("jede Klasse bleibt als vollständiger, auswählbarer Stapel erhalten", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(data).map(([deck, entries]) => [deck, entries.length])),
    { "Klasse 7": 11, "Klasse 8": 4, "Klasse 9": 24, "Klasse 10": 17 },
  );

  for (const [deck, entries] of Object.entries(data)) {
    const filtered = AppCore.filterCards(cards, [deck], 1990);
    assert.deepEqual(filtered.map((card) => card.id), entries.map((card) => card.id));
  }
});
