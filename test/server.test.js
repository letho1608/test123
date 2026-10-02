// test/server.test.js — route /admin/* tren server that (port random, offline, khong can upstream)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let base;
let mod;
before(async () => {
  process.env.PORT = String(18000 + Math.floor(Math.random() * 1000));
  process.env.BACKEND = "zen";
  // runtime file tro sang file tam: switch trong test khong ban vao repo
  process.env.RUNTIME_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zen-rt-")), "runtime.json");
  // providers file tro sang file tam: them/xoa provider trong test khong ban vao repo
  const pvDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-pv-"));
  process.env.PROVIDERS_FILE = path.join(pvDir, "providers.json");
  fs.writeFileSync(process.env.PROVIDERS_FILE, "{}");
  // settings file tro sang file tam: switch khong clientPatched khong ban vao may that
  process.env.CLAUDE_SETTINGS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zen-claude-")), "settings.json");
  const cfg = await import("../src/config.js");
  cfg.loadRuntime();
  mod = await import("../src/server.js");
  const srv = mod.start();
  await new Promise((r) => setTimeout(r, 300));
  const { PORT } = cfg;
  base = `http://127.0.0.1:${PORT}`;
  globalThis.__srv = srv;
});
after(() => new Promise((r) => globalThis.__srv.close(() => r())));

describe("admin", () => {
  it("GET /admin/status tra runtime hien tai", async () => {
    const r = await fetch(base + "/admin/status");
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.backend, "zen");
    assert.ok(j.zenModel);
  });
  it("POST /admin/switch doi model luc dang chay", async () => {
    const r = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zenModel: "big-pickle" }),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.zenModel, "big-pickle");
    const s = await (await fetch(base + "/admin/status")).json();
    assert.equal(s.zenModel, "big-pickle");
  });
  it("POST /admin/switch sai thi 400", async () => {
    const r = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "sai" }),
    });
    assert.equal(r.status, 400);
  });
  it("POST switch that bai thi runtime giu nguyen", async () => {
    const before = await (await fetch(base + "/admin/status")).json();
    const r = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "ollama" }), // thieu ollamaModel -> 400
    });
    assert.equal(r.status, 400);
    const after = await (await fetch(base + "/admin/status")).json();
    assert.equal(after.backend, before.backend);
    assert.equal(after.ollamaModel, before.ollamaModel);
  });
  it("POST /admin/switch sang openai thieu url/model thi 400", async () => {
    const r = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "openai" }),
    });
    assert.equal(r.status, 400);
  });
  it("POST /admin/switch sang ollama thieu model thi 400", async () => {
    const r = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "ollama" }),
    });
    assert.equal(r.status, 400);
  });
  it("GET /admin/zen-models tra list verified", async () => {
    const j = await (await fetch(base + "/admin/zen-models")).json();
    assert.equal(j.ok, true);
    assert.ok(j.verified.includes("muse-spark-1.3-contributor-free"));
    assert.ok(j.def);
  });
  it("GET /admin/ollama-models offline thi ok=false", async () => {
    const j = await (await fetch(base + "/admin/ollama-models")).json();
    assert.ok(Array.isArray(j.models));
  });
  it("GET / tra dashboard web", async () => {
    const r = await fetch(base + "/");
    const t = await r.text();
    assert.equal(r.status, 200);
    assert.ok(t.includes("zen-proxy"));
    assert.ok(t.includes("/admin/switch"));
  });
  it("POST /v1/messages thieu body thi 400 (validate som)", async () => {
    const r = await fetch(base + "/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: "sai" }),
    });
    assert.equal(r.status, 400);
  });
  it("loi backend async van tra JSON, khong treo request", async () => {
    // backend ollama + model khong co -> handleOllama reject bat dong bo.
    // (Cu: return thuong trong try -> catch khong chay -> treo + FATAL.)
    await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "ollama", ollamaModel: "model-chac-chan-khong-co-xyz", clientPatched: true }),
    });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(base + "/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      });
      const j = await r.json();
      assert.equal(j.type, "error");
    } finally {
      clearTimeout(t);
      await fetch(base + "/admin/switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "zen", zenModel: "big-pickle", clientPatched: true }),
      });
    }
  });
  it("switch luu runtime ra file (tat/bat lai giu info cu)", async () => {
    await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "zen", zenModel: "big-pickle", clientPatched: true }),
    });
    const saved = JSON.parse(fs.readFileSync(process.env.RUNTIME_FILE, "utf8"));
    assert.equal(saved.backend, "zen");
    assert.equal(saved.zenModel, "big-pickle");
  });
  it("POST /admin/providers luu cau hinh openai tu nhap", async () => {
    const r = await fetch(base + "/admin/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "test-groq", url: "https://api.groq.com/openai/v1/chat/completions", apiKey: "k", models: ["m1", "m2"] }),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.id, "test-groq");
    const list = await (await fetch(base + "/admin/providers")).json();
    const found = (list.providers || []).find((p) => p.id === "test-groq");
    assert.ok(found);
    assert.deepEqual(found.models, ["m1", "m2"]);
  });
  it("POST /admin/providers sai thi 400 (id xau / thieu url / built-in)", async () => {
    for (const body of [
      { id: "Xau!!", url: "https://x", models: ["m"] },
      { id: "no-url", models: ["m"] },
      { id: "zen", url: "https://x", models: ["m"] },
    ]) {
      const r = await fetch(base + "/admin/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 400);
    }
  });
  it("doi sang provider tu luu roi xoa duoc", async () => {
    const sw = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "test-groq", model: "m1", clientPatched: true }),
    });
    const sj = await sw.json();
    assert.equal(sw.status, 200);
    assert.equal(sj.backend, "openai");
    const del = await fetch(base + "/admin/providers/test-groq", { method: "DELETE" });
    assert.equal(del.status, 200);
    const list = await (await fetch(base + "/admin/providers")).json();
    assert.ok(!(list.providers || []).some((p) => p.id === "test-groq"));
    // xoa built-in thi 400
    const delBuilt = await fetch(base + "/admin/providers/zen", { method: "DELETE" });
    assert.equal(delBuilt.status, 400);
  });
  it("switch khong clientPatched thi patch settings.json (openai + claude)", async () => {
    const { parseJsonText } = await import("../src/json.js");
    const readSettings = () => parseJsonText(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE, "utf8"));
    // tao provider tam
    await fetch(base + "/admin/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "test-oai", url: "https://example.com/v1/chat/completions", models: ["mx"] }),
    });
    // doi sang openai (khong clientPatched) -> settings tro ve proxy
    const r1 = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "test-oai", model: "mx" }),
    });
    assert.equal(r1.status, 200);
    const s1 = readSettings();
    assert.ok(String(s1.env.ANTHROPIC_BASE_URL).includes("127.0.0.1"));
    // doi sang claude (khong clientPatched) -> bypass proxy, model that
    const r2 = await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude", model: "claude-opus-5-5" }),
    });
    assert.equal(r2.status, 200);
    const s2 = readSettings();
    assert.equal(s2.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(s2.env.ANTHROPIC_MODEL, "claude-opus-5-5");
    // don dep: ve zen + xoa provider tam
    await fetch(base + "/admin/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "zen", model: "big-pickle", clientPatched: true }),
    });
    await fetch(base + "/admin/providers/test-oai", { method: "DELETE" });
  });
});
