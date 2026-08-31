const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const trainer = path.join(root, "merkzahlen-trainer");
const html = fs.readFileSync(path.join(trainer, "index.html"), "utf8");
const app = fs.readFileSync(path.join(trainer, "app.js"), "utf8");

test("stellt alle von der App benötigten Bedienelemente bereit", () => {
  const requiredIds = [
    "startBtn", "modeSelect", "dirSelect", "focusSelect", "sessionSize", "cutoffSelect",
    "deckFilter", "playCard", "question", "answer", "mcArea", "typeArea", "typeInput",
    "checkBtn", "revealBtn", "goodBtn", "badBtn", "nextBtn", "summaryCard",
    "resetDialog", "exportBtn", "importBtn", "importInput",
  ];
  requiredIds.forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`), `#${id} fehlt`);
  });
});

test("referenziert vorhandene PWA-Dateien", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(trainer, "manifest.json"), "utf8"));
  manifest.icons.forEach((icon) => {
    assert.equal(fs.existsSync(path.join(trainer, icon.src)), true, `${icon.src} fehlt`);
  });
  ["index.html", "styles.css", "app.js", "data.json", "manifest.json"].forEach((file) => {
    assert.equal(fs.existsSync(path.join(trainer, file)), true, `${file} fehlt`);
  });
});

test("aktualisiert den zugänglichen Rundenzähler dynamisch", () => {
  assert.match(html, /id="qProgress"[^>]+aria-label="Fortschritt: 1 von 16"/);
  assert.match(app, /qProgress\.textContent = `\$\{session\.index \+ 1\} von \$\{session\.cards\.length\}`/);
  assert.match(app, /qProgress\.setAttribute\("aria-label", `Fortschritt:/);
});
