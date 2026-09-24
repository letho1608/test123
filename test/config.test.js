// test/config.test.js — hang so + assets (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PORT, HOST, BACKEND, ZEN_BASE, ZEN_MODEL, RESPONSES_MODELS, MODEL_IDS, T_SES, M_MSG, loadAssets, OPENAI_URL, OPENAI_MODEL } from "../src/config.js";

describe("config", () => {
  it("default hop le", () => {
    assert.equal(HOST, "127.0.0.1");
    assert.ok(PORT > 0);
    assert.ok(["zen", "ollama"].includes(BACKEND));
    assert.ok(ZEN_BASE.startsWith("https://"));
    assert.ok(ZEN_MODEL.length > 0);
  });
  it("RESPONSES_MODELS chua muse-spark", () => {
    assert.ok(RESPONSES_MODELS.has("muse-spark-1.3-contributor-free"));
    assert.ok(RESPONSES_MODELS.has("muse-spark-1.2-contributor-free"));
  });
  it("MODEL_IDS chua zen + alias claude", () => {
    assert.ok(MODEL_IDS.includes(ZEN_MODEL));
    assert.ok(MODEL_IDS.includes("claude-sonnet-4-5"));
  });
  it("hang so ID la so", () => {
    assert.ok(Number.isFinite(T_SES) && Number.isFinite(M_MSG));
  });
  it("openai khong mac dinh (bat buoc nhap tay)", () => {
    assert.equal(OPENAI_URL, "");
    assert.equal(OPENAI_MODEL, "");
  });
  it("loadAssets doc du lieu that", () => {
    const a = loadAssets();
    assert.ok(a.agentdev.length > 5000);
    assert.ok(a.decoys.length >= 6);
  });
});
