// test/server.test.js — route /admin/* tren server that (port random, offline, khong can upstream)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

let base;
let mod;
before(async () => {
  process.env.PORT = String(18000 + Math.floor(Math.random() * 1000));
  process.env.BACKEND = "zen";
  mod = await import("../src/server.js");
  const srv = mod.start();
  await new Promise((r) => setTimeout(r, 300));
  const { PORT } = await import("../src/config.js");
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
  it("POST /v1/messages thieu body thi 400 (validate som)", async () => {
    const r = await fetch(base + "/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: "sai" }),
    });
    assert.equal(r.status, 400);
  });
});
