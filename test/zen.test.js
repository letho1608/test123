// test/zen.test.js — isRetryableZen + pickFreeModels (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/errors.js";
import { isRetryableZen } from "../src/backends/zen.js";
import { pickFreeModels } from "../src/zen-refresh.js";
import { mergeCatalog } from "../src/zen-refresh.js";
import { promoteVerifiedModel } from "../src/zen-refresh.js";
import { pingZenModel } from "../src/zen-refresh.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("isRetryableZen", () => {
  it("mang/het-quota/gate/5xx thi doi model duoc", () => {
    assert.equal(isRetryableZen(ApiError.unreachable("x")), true);
    assert.equal(isRetryableZen(ApiError.freetier("x")), true);
    assert.equal(isRetryableZen(ApiError.upstream(401, "Model is not supported")), true);
    assert.equal(isRetryableZen(ApiError.upstream(403, "gate")), true);
    assert.equal(isRetryableZen(ApiError.upstream(429, "limit")), true);
    assert.equal(isRetryableZen(ApiError.upstream(500, "boom")), true);
  });
  it("400 thuong + loi code thi dung ngay, khong failover", () => {
    assert.equal(isRetryableZen(ApiError.badRequest("messages phai la array")), false);
    assert.equal(isRetryableZen(ApiError.upstream(400, "invalid")), false);
    assert.equal(isRetryableZen(ApiError.upstream(404, "nope")), false);
    assert.equal(isRetryableZen(new Error("boom")), false);
  });
});

describe("pickFreeModels", () => {
  it("chi lay model cost input+output = 0", () => {
    const api = { opencode: { models: {
      "free-a": { cost: { input: 0, output: 0 } },
      "paid": { cost: { input: 1, output: 2 } },
      "half": { cost: { input: 0, output: 1 } },
      "no-cost": {},
    } } };
    assert.deepEqual(pickFreeModels(api), ["free-a"]);
  });
  it("thieu field thi tra rong, khong nem", () => {
    assert.deepEqual(pickFreeModels({}), []);
    assert.deepEqual(pickFreeModels(null), []);
  });
});

describe("mergeCatalog", () => {
  it("giu verified cu, khong tu them free moi vao verified", () => {
    const prev = { zen: { default: "a", verified: ["a", "b"], free: ["a", "b"], responsesModels: ["a"] } };
    const r = mergeCatalog(prev, ["a", "b", "c-moi"]);
    assert.deepEqual(r.catalog.verified, ["a", "b"]);
    assert.deepEqual(r.catalog.free, ["a", "b", "c-moi"]);
    assert.deepEqual(r.added, ["c-moi"]);
    assert.deepEqual(r.removed, []);
    assert.equal(r.catalog.default, "a");
    assert.deepEqual(r.catalog.responsesModels, ["a"]);
  });
  it("loai verified nao het free, doi default neu mat", () => {
    const prev = { zen: { default: "chet", verified: ["chet", "song"], free: ["chet", "song"] } };
    const r = mergeCatalog(prev, ["song"]);
    assert.deepEqual(r.catalog.verified, ["song"]);
    assert.deepEqual(r.removed, ["chet"]);
    assert.ok(["song"].includes(r.catalog.default));
  });
  it("file hong/trong thi khong nem", () => {
    assert.deepEqual(mergeCatalog(null, ["x"]).catalog.free, ["x"]);
    assert.deepEqual(mergeCatalog(null, ["x"]).catalog.verified, []);
    assert.deepEqual(mergeCatalog({}, []).catalog.free, []);
  });
});

describe("promoteVerifiedModel", () => {
  it("them model vao verified + providers (dung thu muc tam)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-promote-"));
    const pvDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-promote-pv-"));
    process.env.PROVIDERS_FILE = path.join(pvDir, "providers.json");
    fs.writeFileSync(process.env.PROVIDERS_FILE, "{}");
    fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify({ zen: { verified: ["a"], free: ["a", "b"] } }));
    const verified = await promoteVerifiedModel("b", dir);
    assert.deepEqual(verified, ["a", "b"]);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf8"));
    assert.deepEqual(saved.zen.verified, ["a", "b"]);
    const { loadProviders } = await import("../src/providers/registry.js");
    assert.deepEqual(loadProviders().zen.config.models, ["a", "b"]);
    delete process.env.PROVIDERS_FILE;
  });
});

describe("pingZenModel", () => {
  it("mang hong thi tra ok:false, khong nem", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("down"));
    try {
      const r = await pingZenModel("model-nao-do");
      assert.equal(r.ok, false);
      assert.equal(r.model, "model-nao-do");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("upstream 200 thi ok:true, chi ping dung model do (khong failover)", async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    const enc = new TextEncoder();
    const sse = 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    globalThis.fetch = (url) => {
      seen.push(String(url));
      const chunks = [enc.encode(sse)];
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let i = 0;
            return {
              read: async () => (i < chunks.length
                ? { done: false, value: chunks[i++] }
                : { done: true, value: undefined }),
            };
          },
        },
      });
    };
    try {
      const r = await pingZenModel("ping-test-model");
      assert.equal(r.ok, true);
      assert.equal(r.model, "ping-test-model");
      assert.equal(seen.length, 1);
      assert.ok(seen[0].endsWith("/chat/completions"));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
