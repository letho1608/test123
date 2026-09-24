// test/zen.test.js — isRetryableZen (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/errors.js";
import { isRetryableZen } from "../src/backends/zen.js";

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
