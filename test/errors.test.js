// test/errors.test.js — contract loi + validate input (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError, Codes, validateMessagesBody } from "../src/errors.js";

describe("ApiError", () => {
  it("toJSON dung shape Anthropic", () => {
    const e = ApiError.badRequest("thieu messages");
    assert.equal(e.status, 400);
    assert.deepEqual(e.toJSON(), {
      type: "error",
      error: { type: "invalid_request_error", message: "thieu messages" },
    });
    assert.equal(e.code, Codes.BAD_REQUEST);
  });
  it("cac factory co status/code dung", () => {
    assert.equal(ApiError.unreachable("x").status, 502);
    assert.equal(ApiError.freetier("x").status, 400);
    assert.equal(ApiError.misconfigured("x").status, 500);
    assert.equal(ApiError.notFound("x").status, 404);
    assert.equal(ApiError.upstream(503, "x").status, 503);
  });
});

describe("validateMessagesBody", () => {
  it("body hop le thi khong nem", () => {
    validateMessagesBody({ model: "m", messages: [{ role: "user", content: "hi" }] });
    validateMessagesBody({});
  });
  it("body sai thi nem 400 co code", () => {
    for (const bad of [null, [], "x", { messages: "hi" }, { messages: [{ role: "x" }] },
      { tools: {} }, { max_tokens: -1 }]) {
      assert.throws(() => validateMessagesBody(bad), (e) => e.code === Codes.BAD_REQUEST && e.status === 400);
    }
  });
});
