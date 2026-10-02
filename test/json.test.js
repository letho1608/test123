// test/json.test.js — parse JSON chiu BOM (Notepad/PowerShell Windows)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonText } from "../src/json.js";

const BOM = String.fromCharCode(0xfeff);

describe("parseJsonText", () => {
  it("json thuong parse binh thuong", () => {
    assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  });
  it("json co BOM van parse duoc", () => {
    assert.deepEqual(parseJsonText(BOM + '{"a":1}'), { a: 1 });
  });
  it("json hong thi nem loi", () => {
    assert.throws(() => parseJsonText("{hong"), SyntaxError);
  });
});
