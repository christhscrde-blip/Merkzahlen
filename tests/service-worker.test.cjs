const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(require.resolve("../merkzahlen-trainer/service-worker.js"), "utf8");
const base = "https://example.test/merkzahlen-trainer/";

function worker(online = true) {
  const handlers = {};
  const cached = new Map();
  const removed = [];
  const writes = [];
  let precached;
  let networkOptions;
  class RequestStub {
    constructor(url, options) { this.url = new URL(url, base).href; this.cache = options.cache; }
  }
  const scope = {
    self: { location: { origin: new URL(base).origin }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, Response, Request: RequestStub,
    caches: {
      open: async () => ({
        addAll: async (assets) => { precached = assets; },
        put: async (request, response) => { writes.push(request.url); cached.set(request.url, response); },
      }),
      keys: async () => ["merkzahlen-v4", "merkzahlen-v8", "another-app"],
      delete: async (name) => { removed.push(name); },
      match: async (request) => cached.get(typeof request === "string" ? request : request.url),
    },
    fetch: async (_request, options) => { networkOptions = options; if (!online) throw new Error("offline"); return new Response("fresh"); },
  };
  vm.runInNewContext(source, scope);
  async function trigger(name, request) {
    const pending = [];
    let response;
    handlers[name]({ request, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => { response = promise; } });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { trigger, cached, removed, writes, get precached() { return precached; }, get networkOptions() { return networkOptions; } };
}

test("PWA installiert zusammenpassende versionierte Dateien mit frischem HTTP-Abruf", async () => {
  const sw = worker();
  await sw.trigger("install");
  for (const path of ["app.js?v=8", "styles.css?v=8", "data.json"]) assert.ok(sw.precached.some((request) => request.url === base + path));
  assert.ok(sw.precached.every((request) => request.cache === "reload"));
});

test("PWA räumt nur eigene ältere Caches auf", async () => {
  const sw = worker();
  await sw.trigger("activate");
  assert.deepEqual(sw.removed, ["merkzahlen-v4"]);
});

test("PWA bevorzugt neue Online-Antworten und aktualisiert den Offline-Cache", async () => {
  const sw = worker();
  const request = { url: base + "app.js?v=8", method: "GET", mode: "cors" };
  sw.cached.set(request.url, new Response("old"));
  const response = await sw.trigger("fetch", request);
  assert.equal(await response.text(), "fresh");
  assert.equal(sw.networkOptions.cache, "no-cache");
  assert.deepEqual(sw.writes, [request.url]);
  assert.equal(await sw.cached.get(request.url).text(), "fresh");
});

test("PWA liefert offline versionierte Dateien und den Navigation-Fallback", async () => {
  const sw = worker(false);
  const request = { url: base + "app.js?v=8", method: "GET", mode: "cors" };
  sw.cached.set(request.url, new Response("offline app"));
  sw.cached.set("./index.html", new Response("offline page"));
  assert.equal(await (await sw.trigger("fetch", request)).text(), "offline app");
  assert.equal(await (await sw.trigger("fetch", { ...request, url: base + "?start", mode: "navigate" })).text(), "offline page");
  assert.equal((await sw.trigger("fetch", { ...request, url: base + "unknown.js" })).type, "error");
});

test("PWA greift weder fremde Ursprünge noch schreibende Requests ab", async () => {
  const sw = worker();
  assert.equal(await sw.trigger("fetch", { url: "https://other.test/", method: "GET" }), undefined);
  assert.equal(await sw.trigger("fetch", { url: base, method: "POST" }), undefined);
  assert.equal(sw.writes.length, 0);
});
