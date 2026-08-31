const test = require("node:test");
const assert = require("node:assert/strict");
const AppCore = require("../merkzahlen-trainer/app.js");
const data = require("../merkzahlen-trainer/data.json");

const cards = [
  { id: "a", prompt: "1492", answer: "Entdeckung Amerikas", deck: "Klasse 7" },
  { id: "b", prompt: "1834", answer: "Deutscher Zollverein", deck: "Klasse 8" },
  { id: "c", prompt: "1914-1918", answer: "Erster Weltkrieg", deck: "Klasse 9" },
  { id: "d", prompt: "1989", answer: "Friedliche Revolution", deck: "Klasse 10" },
];

test("enthält den vollständigen Datensatz bis 1990", () => {
  const allCards = AppCore.flattenDecks(data);
  assert.equal(allCards.length, 56);
  assert.equal(Math.max(...allCards.map(AppCore.cardEndYear)), 1990);
  assert.equal(new Set(allCards.map((card) => card.id)).size, allCards.length);
});

test("trennt neue und fällige Karten", () => {
  const progress = {
    a: { seen: 0, due: 0 },
    b: { seen: 2, due: 10, correct: 1, wrong: 1 },
  };
  const overview = AppCore.computeOverview(cards, progress, [], 1990, 100);
  assert.equal(overview.newCount, 3);
  assert.equal(overview.due, 1);
});

test("hält einen leeren Fokus wirklich leer", () => {
  assert.deepEqual(AppCore.chooseCards(cards, {}, { focus: "weak", count: 10 }), []);
});

test("filtert Klassen und Jahresgrenze gemeinsam", () => {
  const filtered = AppCore.filterCards(cards, ["Klasse 7", "Klasse 8", "Klasse 9"], 1900);
  assert.deepEqual(filtered.map((card) => card.id), ["a", "b"]);
});

test("begrenzt die Rundengröße", () => {
  assert.equal(AppCore.clampSessionSize(-2), 5);
  assert.equal(AppCore.clampSessionSize(22), 22);
  assert.equal(AppCore.clampSessionSize(500), 60);
});

test("formuliert die Kartenanzahl auch im Singular korrekt", () => {
  assert.equal(AppCore.formatCardCount(0), "0 Karten");
  assert.equal(AppCore.formatCardCount(1), "1 Karte");
  assert.equal(AppCore.formatCardCount(56), "56 Karten");
});

test("prüft Datumsantworten streng", () => {
  assert.equal(AppCore.evaluateTypedAnswer("1939", "1939-1945"), false);
  assert.equal(AppCore.evaluateTypedAnswer("1939-1945", "1939-1945"), true);
});

test("toleriert Schreibvarianten bei Textantworten", () => {
  assert.equal(AppCore.evaluateTypedAnswer("Franzosische Revolution", "Französische Revolution"), true);
  assert.equal(AppCore.evaluateTypedAnswer("irgendwas Revolution", "Französische Revolution"), false);
});

test("aktualisiert Wiederholungsstände", () => {
  const progress = {};
  AppCore.applyGrade(progress, cards[0], true, 1000);
  assert.equal(progress.a.correct, 1);
  assert.equal(progress.a.box, 1);
  assert.ok(progress.a.due > 1000);
});
