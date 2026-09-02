const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const trainer = path.join(root, "merkzahlen-trainer");
const html = fs.readFileSync(path.join(trainer, "index.html"), "utf8");
const app = fs.readFileSync(path.join(trainer, "app.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(trainer, "service-worker.js"), "utf8");

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
  assert.match(html, /id="qProgress"[^>]+aria-label="Fortschritt: 0 von 10 beantwortet"/);
  assert.match(app, /qProgress\.value = total/);
  assert.match(app, /qProgress\.setAttribute\("aria-label", `Fortschritt:/);
});

test("lädt online frische PWA-Dateien und nutzt den Cache nur als Offline-Fallback", () => {
  const networkRead = serviceWorker.indexOf("fetch(event.request)");
  const cacheFallback = serviceWorker.indexOf("const cached = await caches.match(event.request)");
  assert.ok(networkRead >= 0, "Netzwerkabruf fehlt");
  assert.ok(cacheFallback > networkRead, "Cache darf den Netzwerkabruf online nicht überholen");
  assert.match(serviceWorker, /const CACHE = "merkzahlen-v5"/);
});
