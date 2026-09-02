const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../merkzahlen-trainer/app.js");
const cards = Core.flattenDecks(require("../merkzahlen-trainer/data.json"));
const card = cards[0];
const DAY = 86400000;

test("falsche Antworten sind sofort fällig – auch nach Beherrschung", () => {
  for (const box of [0, 1, 4, 5, 6]) {
    const progress = { [card.id]: { box, seen: box, correct: box, correctStreak: box } };
    Core.applyGrade(progress, card, false, 1000);
    assert.equal(progress[card.id].due, 1000);
    assert.equal(progress[card.id].box, 0);
    const meta = Core.getCardMeta(card, progress, 1000);
    assert.equal(meta.due, true);
    assert.equal(meta.isWeak, true);
    assert.equal(meta.mastered, false);
  }
});

test("Unsicher erholt sich nach zwei richtigen Antworten, nicht nach Ablauf von 14 Tagen", () => {
  const progress = {};
  Core.applyGrade(progress, card, false, 1000);
  assert.equal(Core.getCardMeta(card, progress, 1000 + 90 * DAY).isWeak, true);
  Core.applyGrade(progress, card, true, 2000);
  assert.equal(Core.getCardMeta(card, progress, 2000).isWeak, true);
  Core.applyGrade(progress, card, true, 3000);
  const meta = Core.getCardMeta(card, progress, 3000);
  assert.equal(meta.isWeak, false);
  assert.equal(meta.learning, true);
  assert.equal(meta.state.correct, 2);
  assert.equal(meta.state.wrong, 1);
});

test("Lernstand-Gruppen sind vollständig und überschneiden sich nicht", () => {
  const progress = {};
  for (let round = 0; round < 7; round++) {
    cards.forEach((entry, index) => Core.applyGrade(progress, entry, index % 3 !== 0, 1000 + round));
    const overview = Core.computeOverview(cards, progress, [], 1990, 2000);
    assert.equal(overview.newCount + overview.learning + overview.weak + overview.mastered, 56);
    assert.equal(overview.correct + overview.wrong, (round + 1) * 56);
  }
});

test("alte 60-Tage-Fehlerstände werden ohne Verlust der Antwortzähler repariert", () => {
  const progress = { [card.id]: { seen: 1, correct: 0, wrong: 1, box: 0, lastSeen: 1000, lastWrongAt: 1000, due: 1000 + 60 * DAY } };
  const meta = Core.getCardMeta(card, progress, 2000);
  assert.equal(meta.due, true);
  assert.equal(meta.state.wrong, 1);
  assert.equal(meta.state.seen, 1);
});

test("gleiche Tagesdaten sind formatunabhängig, fehlende Datumsteile bleiben falsch", () => {
  assert.equal(Core.evaluateTypedAnswer("05.03.1953", "5.März1953"), true);
  assert.equal(Core.evaluateTypedAnswer("13.8.1961", "13. August 1961"), true);
  assert.equal(Core.evaluateTypedAnswer("1961", "13. August 1961"), false);
  assert.equal(Core.evaluateTypedAnswer("14.8.1961", "13. August 1961"), false);
  assert.equal(Core.evaluateTypedAnswer("1945", "Juni 1945"), false);
  assert.equal(Core.evaluateTypedAnswer("nicht Martin Luther", "Martin Luther"), false);
});

test("beide Ereignisse von 1919 und 1955 werden unabhängig geprüft", () => {
  for (const prompt of ["1919", "1955"]) {
    const current = cards.find((entry) => entry.prompt === prompt);
    const pair = Core.directionPair(current, "year2event", cards);
    for (const partial of pair.answer.split(";")) {
      assert.equal(Core.evaluateTypedAnswer(partial, pair.answer), false, partial);
    }
    assert.equal(Core.evaluateTypedAnswer(pair.answer.split(";").reverse().join(" und "), pair.answer), true);
  }
});

test("eine andere Kataloglösung wird nicht wegen gemeinsamer Wörter als richtig markiert", () => {
  for (const direction of ["year2event", "event2year"]) {
    for (const card of cards) for (const other of cards) {
      const expected = Core.directionPair(card, direction, cards).answer;
      const submitted = Core.directionPair(other, direction, cards).answer;
      if (expected !== submitted) assert.equal(Core.evaluateTypedAnswer(submitted, expected), false, `${submitted} ist nicht ${expected}`);
    }
  }
  assert.equal(Core.evaluateTypedAnswer("Ludwig XVI König von Frankreich", "Ludwig der XIV. – König von Frankreich"), false);
});

for (const mode of ["cards", "mc", "type", "mix"]) {
  for (const direction of ["year2event", "event2year"]) {
    test(`vollständiges Antwortprotokoll: 56 Karten, ${mode}, ${direction}`, () => {
      const progress = {};
      const session = Core.createSession(cards, { mode, direction }, cards);
      const expectedWrong = [];
      for (let index = 0; index < cards.length; index++) {
        const correct = index % 3 !== 0;
        const pair = Core.directionPair(cards[index], direction, cards);
        const answer = correct ? pair.answer : `Testfehler ${index}`;
        if (!correct) expectedWrong.push(cards[index].id);
        const result = Core.gradeSession(progress, session, correct, { answer, source: "typed" }, 1000 + index);
        assert.equal(result.question, pair.question);
        assert.equal(result.expectedAnswer, pair.answer);
        assert.equal(result.submittedAnswer, answer);
        assert.equal(result.correct, correct);
        assert.equal(Core.gradeSession(progress, session, !correct), null, "Doppelbewertung muss ignoriert werden");
        session.index++;
        session.graded = false;
      }
      const summary = Core.buildSummary(session);
      assert.equal(summary.total, 56);
      assert.equal(summary.correct, 37);
      assert.equal(summary.wrong, 19);
      assert.equal(summary.results.length, 56);
      assert.equal(summary.weakCards.length, 19, "keine Beschränkung auf fünf Fehler");
      assert.equal(summary.bestStreak, 2);
      assert.equal(Object.values(progress).reduce((sum, entry) => sum + entry.seen, 0), 56);
      const restored = JSON.parse(JSON.stringify(summary));
      assert.deepEqual(Core.retryCards(restored, cards).map((entry) => entry.id), expectedWrong);
      assert.equal(Core.gradeSession(progress, session, true), null);
      // Summary is independent of stale counters and later changes to the round.
      session.correct = 999;
      session.wrong = 999;
      assert.equal(Core.buildSummary(session).correct, 37);
      session.answered[0].card.prompt = "mutated";
      assert.notEqual(summary.results[0].card.prompt, "mutated");
    });
  }
}

test("Fehler-Wiederholung enthält nur tatsächlich falsch beantwortete Katalogkarten", () => {
  const session = Core.createSession(cards, { mode: "type", direction: "event2year" }, cards);
  const progress = {};
  Core.gradeSession(progress, session, false, { answer: "9999", source: "typed" });
  const summary = Core.buildSummary(session);
  assert.deepEqual(Core.retryCards(summary, cards), [card]);
  assert.deepEqual(Core.retryCards({ results: [{ card: { id: "unbekannt" }, correct: false }] }, cards), []);
});
