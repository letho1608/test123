// test/ids.test.js — format + thu tu thoi gian cua ses_/msg_ (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mintSes, mintMsg, isValidIdFormat } from "../src/ids.js";

describe("ids", () => {
  it("mintSes dung format ses_ + 12 hex + 14 base62", () => {
    const id = mintSes(1790010729000);
    assert.match(id, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    assert.ok(isValidIdFormat(id, "ses_"));
  });
  it("mintMsg dung format msg_ + 12 hex + 14 base62", () => {
    const id = mintMsg(1790010729000);
    assert.match(id, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    assert.ok(isValidIdFormat(id, "msg_"));
  });
  it("ses giam dan theo thoi gian (dao nguoc), msg tang dan (thuan)", () => {
    const t0 = 1790010729000; // timestamp that (ms epoch)
    assert.ok(mintSes(t0) > mintSes(t0 + 5000), "ses moi hon phai nho hon");
    assert.ok(mintMsg(t0) < mintMsg(t0 + 5000), "msg moi hon phai lon hon");
  });
  it("marker cuoi: ses=ffe, msg=001", () => {
    assert.ok(mintSes(1790010729000).slice(4, 16).endsWith("ffe"));
    assert.ok(mintMsg(1790010729000).slice(4, 16).endsWith("001"));
  });
  it("isValidIdFormat tu choi sai dinh dang", () => {
    assert.equal(isValidIdFormat("ses_f3b4FAKE000", "ses_"), false);
    assert.equal(isValidIdFormat("msg_xxx", "msg_"), false);
    assert.equal(isValidIdFormat(null, "ses_"), false);
  });
});
