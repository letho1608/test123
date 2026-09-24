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
      body: JSON.stringify({ backend: "ollama", ollamaModel: "model-chac-chan-khong-co-xyz" }),
    });
    assert.equal(r.status, 502); // ollama cp that bai
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
});
