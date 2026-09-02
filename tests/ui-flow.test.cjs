// Run the real browser event handlers against an isolated, dependency-free DOM double.
// This complements (and does not replace) visual verification in a real browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Core = require("../merkzahlen-trainer/app.js");
const data = require("../merkzahlen-trainer/data.json");
const cards = Core.flattenDecks(data);
const html = fs.readFileSync(require.resolve("../merkzahlen-trainer/index.html"), "utf8");
const source = fs.readFileSync(require.resolve("../merkzahlen-trainer/app.js"), "utf8");

async function mount(storage = new Map(), failSaving = false) {
  const nodes = new Map();
  let focused;
  class Element {
    constructor(tag = "div") {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
      this.events = {}; this.attributes = {}; this.hidden = false; this.disabled = false;
      this.value = ""; this.textContent = ""; this.className = "";
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(" "), ...names])].join(" "); },
        remove: (...names) => { this.className = this.className.split(" ").filter((name) => !names.includes(name)).join(" "); },
        toggle: (name, active) => active ? this.classList.add(name) : this.classList.remove(name),
        contains: (name) => this.className.split(" ").includes(name),
      };
    }
    set innerHTML(value) { assert.equal(value, ""); this.children = []; }
    appendChild(node) { this.children.push(node); return node; }
    addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { focused = this; }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    click() { if (!this.disabled) this.fire("click"); }
    fire(name, extra = {}) {
      const event = { target: this, preventDefault() {}, ...extra };
      this[`on${name}`]?.(event);
      (this.events[name] || []).forEach((listener) => listener(event));
    }
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Element(match[1]);
    node.hidden = /\bhidden\b/.test(match[2]);
    node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || "";
    node.className = match[2].match(/\bclass="([^"]*)"/)?.[1] || "";
    nodes.set(match[3], node);
  }
  for (const match of html.matchAll(/<select id="([^"]+)">([\s\S]*?)<\/select>/g)) {
    const options = [...match[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];
    nodes.get(match[1]).value = (options.find((option) => option[2].includes("selected")) || options[0])[1];
  }
  const themeButtons = ["ink", "paper", "sage"].map((theme) => {
    const button = new Element("button"); button.dataset.theme = theme; return button;
  });
  const body = new Element("body");
  const document = {
    body,
    querySelector: (selector) => { assert.ok(nodes.has(selector.slice(1)), `missing ${selector}`); return nodes.get(selector.slice(1)); },
    querySelectorAll: (selector) => {
      if (selector === "#themeSwitch button") return themeButtons;
      if (selector === "#deckFilter .deckChip") return nodes.get("deckFilter").children;
      if (selector === "#mcArea button") return nodes.get("mcArea").children;
      throw new Error(`Unhandled selector ${selector}`);
    },
    createElement: (tag) => new Element(tag),
  };
  const sandbox = {
    document, window: { setTimeout: (callback) => callback(), addEventListener() {} }, navigator: {},
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { if (failSaving) throw new Error("QuotaExceededError"); storage.set(key, value); },
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => ({ ok: true, json: async () => structuredClone(data) }),
    Blob, URL, console,
  };
  vm.runInNewContext(source, sandbox);
  await new Promise(setImmediate);
  assert.equal(nodes.get("bootError").hidden, true);
  return { nodes, storage, body, get focused() { return focused; } };
}

for (const mode of ["cards", "mc", "type", "mix"]) {
  for (const direction of ["year2event", "event2year"]) {
    test(`echte UI-Handler: 56 Aufgaben ${mode}/${direction}, Zähler, Auswertung, Neuladen und Fehler-Runde`, async () => {
      const app = await mount();
      const el = (id) => app.nodes.get(id);
      el("modeSelect").value = mode;
      el("dirSelect").value = direction;
      el("sessionSize").value = "56";
      el("startBtn").click();
      assert.equal(el("qProgress").value, 0);
      let right = 0;
      let wrong = 0;
      const observed = [];
      for (let index = 0; index < 56; index++) {
        const question = el("question").textContent;
        const deck = el("questionContext").textContent.split(" · ")[0];
        const current = cards.find((card) => card.deck === deck && (direction === "year2event" ? card.prompt : card.answer) === question);
        assert.ok(current, question);
        const pair = Core.directionPair(current, direction, cards);
        const correct = index % 3 !== 0;
        const currentMode = Core.sessionModeForIndex(mode, index);
        let submitted = "";
        if (currentMode === "cards") {
          el("revealBtn").click();
          assert.equal(el("qProgress").value, index, "Aufdecken allein darf nicht zählen");
          el(correct ? "goodBtn" : "badBtn").click();
        } else if (currentMode === "type") {
          submitted = correct ? pair.answer : `Testfehler ${index}`;
          el("typeInput").value = submitted;
          el("typeInput").fire("keydown", { key: "Enter" });
          el("checkBtn").click(); // repeated click must never grade twice
        } else {
          const option = el("mcArea").children.find((node) => correct ? node.textContent === pair.answer : node.textContent !== pair.answer);
          submitted = option.textContent;
          option.click();
          option.click();
        }
        correct ? right++ : wrong++;
        observed.push({ question, expectedAnswer: pair.answer, submittedAnswer: submitted, correct });
        assert.equal(el("sCorrect").textContent, String(right));
        assert.equal(el("sWrong").textContent, String(wrong));
        assert.equal(el("qProgress").value, index + 1);
        assert.match(el("statAccuracy").textContent, new RegExp(`${right} richtig · ${wrong} falsch`));
        assert.equal(el("answerFeedback").hidden, false);
        assert.equal(el("answerFeedback").dataset.result, correct ? "correct" : "wrong");
        assert.equal(el("answerTrack").children[index].classList.contains(correct ? "isCorrect" : "isWrong"), true);
        el("nextBtn").click();
      }
      assert.equal(el("summaryCard").hidden, false);
      assert.equal(el("summaryCounts").textContent, "37 richtig · 19 falsch · 56 beantwortet");
      assert.equal(el("summaryResults").children.length, 56);
      const summary = JSON.parse(app.storage.get(Core.PROFILE_KEY)).lastSummary;
      assert.equal(new Set(summary.results.map((item) => item.card.id)).size, 56);
      assert.deepEqual(summary.results.map(({ question, expectedAnswer, submittedAnswer, correct }) => ({ question, expectedAnswer, submittedAnswer, correct })), observed);
      el("onlyMistakes").checked = true;
      el("onlyMistakes").fire("change");
      assert.equal(el("summaryResults").children.length, 19);
      assert.ok(el("summaryResults").children.every((node) => node.classList.contains("isWrong")));
      const reload = await mount(app.storage);
      assert.match(reload.nodes.get("summaryContext").textContent, /Letzte abgeschlossene Runde/);
      assert.equal(reload.nodes.get("summaryCounts").textContent, el("summaryCounts").textContent);
      assert.equal(reload.nodes.get("summaryResults").children.length, 56);
      reload.nodes.get("retryBtn").click();
      assert.equal(reload.nodes.get("qProgress").max, 19);
      assert.equal(reload.nodes.get("qProgress").value, 0);
      assert.equal(reload.nodes.get("playTitle").textContent, "Deine zweite Chance");
    });
  }
}

test("leere Eingabe zählt nicht; Lösung aufdecken zählt als genau ein Fehler", async () => {
  const app = await mount();
  const el = (id) => app.nodes.get(id);
  el("modeSelect").value = "type";
  el("startBtn").click();
  el("checkBtn").click();
  assert.equal(el("qProgress").value, 0);
  assert.equal(el("typeInput").attributes["aria-invalid"], "true");
  el("revealBtn").click();
  el("revealBtn").click();
  assert.equal(el("qProgress").value, 1);
  assert.equal(el("sWrong").textContent, "1");
  assert.equal(el("statDue").textContent, "1");
});

test("Speicherfehler blockiert weder Feedback noch nächste Frage", async () => {
  const app = await mount(new Map(), true);
  const el = (id) => app.nodes.get(id);
  el("startBtn").click();
  el("revealBtn").click();
  el("goodBtn").click();
  assert.equal(el("saveWarning").hidden, false);
  assert.equal(el("answerFeedback").dataset.result, "correct");
  el("nextBtn").click();
  assert.equal(el("qIndex").textContent, "2 / 10");
});

test("alte unvollständige Auswertungen werden nicht als neue Antwortprotokolle ausgegeben", async () => {
  const storage = new Map([[Core.PROFILE_KEY, JSON.stringify({ lastSummary: { total: 56, weakCards: ["willkürlich"] } })]]);
  const app = await mount(storage);
  assert.equal(app.nodes.get("summaryCard").hidden, true);
});

test("vorzeitig beendete Runden werten ausschließlich bewertete Aufgaben aus", async () => {
  const app = await mount();
  const el = (id) => app.nodes.get(id);
  el("startBtn").click();
  assert.equal(el("modeSelect").disabled, true);
  el("revealBtn").click();
  el("badBtn").click();
  el("nextBtn").click();
  el("finishBtn").click();
  assert.equal(el("summaryCounts").textContent, "0 richtig · 1 falsch · 1 beantwortet");
  assert.equal(el("summaryResults").children.length, 1);
  assert.equal(el("modeSelect").disabled, false);
  el("retryBtn").click();
  assert.equal(el("qProgress").max, 1);
  el("revealBtn").click();
  el("goodBtn").click();
  el("nextBtn").click();
  assert.equal(el("summaryCounts").textContent, "1 richtig · 0 falsch · 1 beantwortet");
  assert.equal(el("retryBtn").hidden, true);
  el("anotherRoundBtn").click();
  el("finishBtn").click();
  assert.equal(el("summaryCounts").textContent, "0 richtig · 0 falsch · 0 beantwortet");
  assert.equal(el("summaryTitle").textContent, "Noch keine Antwort bewertet.");
});

test("Unsicher-Anzeige erholt sich auch über UI-Bewertungen und Neuladen", async () => {
  const app = await mount();
  const el = (id) => app.nodes.get(id);
  el("startBtn").click();
  el("revealBtn").click();
  el("badBtn").click();
  assert.equal(el("statWeak").textContent, "1");
  assert.equal(el("statDue").textContent, "1");
  el("finishBtn").click();
  el("retryBtn").click();
  el("revealBtn").click();
  el("goodBtn").click();
  assert.equal(el("statWeak").textContent, "1");
  el("nextBtn").click();
  el("focusSelect").value = "weak";
  el("startBtn").click();
  el("revealBtn").click();
  el("goodBtn").click();
  assert.equal(el("statWeak").textContent, "0");
  assert.equal(el("statLearning").textContent, "1");
  const reload = await mount(app.storage);
  assert.equal(reload.nodes.get("statWeak").textContent, "0");
  assert.equal(reload.nodes.get("statLearning").textContent, "1");
});
