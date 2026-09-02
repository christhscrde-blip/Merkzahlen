const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Core = require("../merkzahlen-trainer/app.js");
const cards = Core.flattenDecks(require("../merkzahlen-trainer/data.json"));

const ids = cards.map((card) => card.id);
const positions = new Map(ids.map((id, index) => [id, index]));
const signature = (session) => session.cards.map((card) => card.id).join("|");

function monotonic(sequence) {
  const indexes = sequence.map((card) => positions.get(card.id));
  return indexes.every((value, index) => index === 0 || value > indexes[index - 1])
    || indexes.every((value, index) => index === 0 || value < indexes[index - 1]);
}

test("200 neue Lernsessions beginnen und verlaufen nicht nach der Katalogreihenfolge", () => {
  const progress = {};
  const starts = new Set();
  const sequences = new Set();
  const included = new Set();

  for (let seed = 1; seed <= 200; seed += 1) {
    const session = Core.createLearningSession(cards, progress, {
      mode: "mix", direction: "year2event", focus: "mixed", count: 10,
      selectedDecks: [], cutoffYear: 1990,
    }, 1000, Core.createSeededRandom(seed));
    starts.add(session.cards[0].id);
    sequences.add(signature(session));
    session.cards.forEach((card) => included.add(card.id));
    assert.equal(session.cards.length, 10);
    assert.equal(new Set(session.cards.map((card) => card.id)).size, 10);
    assert.equal(monotonic(session.cards), false, `Seed ${seed} ist monoton`);
    assert.ok(!session.cards.some((card, index) => index > 0 && card.prompt === session.cards[index - 1].prompt));
  }

  assert.ok(starts.size >= 45, `nur ${starts.size} verschiedene Starts`);
  assert.ok(sequences.size >= 195, `nur ${sequences.size} verschiedene Reihenfolgen`);
  assert.equal(included.size, 56, "nicht alle erlaubten Merkzahlen wurden berücksichtigt");
});

test("schwierige Karten werden häufiger, aber nicht an festen Positionen gezogen", () => {
  const hard = cards[0];
  const progress = Object.fromEntries(cards.map((card) => [card.id, {
    seen: 6, correct: 6, wrong: 0, correctStreak: 6, box: 6, due: 999999,
  }]));
  progress[hard.id] = {
    seen: 6, correct: 1, wrong: 5, correctStreak: 0, box: 0, due: 0, lastWrongAt: 900,
  };
  const counts = new Map(ids.map((id) => [id, 0]));
  const hardPositions = new Map();

  for (let seed = 1; seed <= 1000; seed += 1) {
    const selected = Core.chooseCards(cards, progress, {
      mode: "mix", focus: "mixed", count: 8, selectedDecks: [], cutoffYear: 1990,
    }, 1000, Core.createSeededRandom(seed));
    selected.forEach((card, index) => {
      counts.set(card.id, counts.get(card.id) + 1);
      if (card.id === hard.id) hardPositions.set(index, (hardPositions.get(index) || 0) + 1);
    });
  }

  const hardCount = counts.get(hard.id);
  const averageOther = [...counts].filter(([id]) => id !== hard.id)
    .reduce((sum, [, count]) => sum + count, 0) / 55;
  assert.ok(hardCount > averageOther * 2.5, `${hardCount} gegenüber Ø ${averageOther}`);
  assert.ok(hardPositions.size >= 7, `schwierige Karte erschien nur auf ${hardPositions.size} Positionen`);
  assert.ok(Math.max(...hardPositions.values()) / hardCount < 0.4, "schwierige Karte hat eine zu feste Position");
});

test("Fragevarianten sind zufällig, ausgewogen und ohne starre Dreierrotation", () => {
  const plans = new Set();
  const starts = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const plan = Core.createModePlan("mix", 40, Core.createSeededRandom(seed));
    plans.add(plan.join("|"));
    starts.add(plan[0]);
    assert.deepEqual(new Set(plan), new Set(["cards", "mc", "type"]));
    assert.ok(!plan.some((mode, index) => mode === plan[index + 1] && mode === plan[index + 2]));
  }
  assert.ok(plans.size >= 195);
  assert.equal(starts.size, 3);
});

test("Multiple-Choice-Lösungen sind über alle vier Positionen gleichmäßig verteilt", () => {
  const positionCounts = [0, 0, 0, 0];
  const rng = Core.createSeededRandom(20260902);
  for (let index = 0; index < 4000; index += 1) {
    const card = cards[index % cards.length];
    const direction = index % 2 ? "year2event" : "event2year";
    const correct = Core.directionPair(card, direction, cards).answer;
    const options = Core.buildMcOptions(cards, card, direction, rng);
    positionCounts[options.indexOf(correct)] += 1;
  }
  positionCounts.forEach((count) => assert.ok(count >= 900 && count <= 1100, positionCounts.join(", ")));
});

test("Fehler kehren mit wechselndem Abstand von drei bis sieben Aufgaben zurück", () => {
  const gaps = new Set();
  for (let seed = 1; seed <= 300; seed += 1) {
    const session = Core.createSession(cards.slice(0, 20), {
      mode: "mix", direction: "year2event", scheduleReviews: true,
    }, cards, Core.createSeededRandom(seed));
    const originalLength = session.cards.length;
    const result = Core.gradeSession({}, session, false, { answer: "falsch", source: "typed" }, 1000);
    assert.equal(session.cards.length, originalLength + 1);
    assert.ok(result.reviewAfter >= 3 && result.reviewAfter <= 7);
    assert.equal(session.cards[result.reviewAfter + 1].id, session.cards[0].id);
    gaps.add(result.reviewAfter);
  }
  assert.deepEqual(gaps, new Set([3, 4, 5, 6, 7]));
});

test("120 vollständige Prüfungen sind zufällig, lückenlos und nicht adaptiv", () => {
  const progress = Object.fromEntries(cards.map((card, index) => [card.id, {
    seen: 10, correct: index + 1, wrong: index % 4, correctStreak: index % 3,
    box: index % 7, due: index % 2 ? 0 : 999999,
  }]));
  const sequences = new Set();
  const starts = new Set();

  for (let seed = 1; seed <= 120; seed += 1) {
    const session = Core.createLearningSession(cards, progress, {
      mode: "exam", direction: "event2year", focus: "weak", count: 5,
      selectedDecks: [], cutoffYear: 1990,
    }, 1000, Core.createSeededRandom(seed));
    sequences.add(signature(session));
    starts.add(session.cards[0].id);
    assert.equal(session.cards.length, 56);
    assert.equal(new Set(session.cards.map((card) => card.id)).size, 56);
    assert.deepEqual(new Set(session.cards.map((card) => card.id)), new Set(ids));
    assert.equal(monotonic(session.cards), false);
    assert.ok(!session.cards.some((card, index) => index > 0 && card.prompt === session.cards[index - 1].prompt));

    while (session.index < session.cards.length) {
      const before = session.cards.length;
      const result = Core.gradeSession({}, session, true, { answer: "gewusst", source: "self" }, 1000 + session.index);
      assert.ok(result);
      assert.equal(session.cards.length, before, "Prüfung darf Fehlerhistorie nicht in den Plan einmischen");
      session.index += 1;
      session.graded = false;
    }
    const summary = Core.buildSummary(session);
    assert.equal(summary.total, 56);
    assert.equal(summary.correct, 56);
  }

  assert.ok(sequences.size >= 118);
  assert.ok(starts.size >= 40);
});

test("Neustart erzeugt einen neuen Plan statt eine gespeicherte Reihenfolge wiederzuverwenden", () => {
  const options = { mode: "mix", direction: "year2event", focus: "mixed", count: 40, cutoffYear: 1990 };
  const beforeReload = Core.createLearningSession(cards, {}, options, 1000, Core.createSeededRandom(7001));
  const afterReload = Core.createLearningSession(cards, {}, options, 1000, Core.createSeededRandom(7002));
  assert.notEqual(signature(beforeReload), signature(afterReload));
  assert.notDeepEqual(beforeReload.questionModes, afterReload.questionModes);
});

test("alte Ursachen fester Reihenfolgen bleiben aus dem Produktionspfad entfernt", () => {
  const source = fs.readFileSync(require.resolve("../merkzahlen-trainer/app.js"), "utf8");
  assert.doesNotMatch(source, /\["cards", "mc", "type"\]\[index % 3\]/);
  assert.doesNotMatch(source, /sort\(\(a, b\) => b\.weight/);
  assert.match(source, /createLearningSession/);
  assert.match(source, /weightedRandomOrder/);
});
