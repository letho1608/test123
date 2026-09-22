// test/anthropic.test.js — blocks + map decoy (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textOf, toolResultText, mapDecoyToClaude, toToolUseBlock } from "../src/translators/anthropic.js";

describe("textOf", () => {
  it("string tra thang", () => assert.equal(textOf("hi"), "hi"));
  it("array chi lay text", () => assert.equal(textOf([{ type: "text", text: "a" }, { type: "image" }, null]), "a"));
  it("sai kieu tra rong", () => { assert.equal(textOf(null), ""); assert.equal(textOf(42), ""); });
});

describe("toolResultText", () => {
  it("string giu nguyen", () => assert.equal(toolResultText("ok"), "ok"));
  it("array tron text + json", () => {
    assert.equal(toolResultText([{ type: "text", text: "a" }, { type: "x", y: 1 }]), 'a\n{"type":"x","y":1}');
  });
});

describe("mapDecoyToClaude", () => {
  it("bash/read/edit/write/glob/grep doi key dung", () => {
    assert.deepEqual(mapDecoyToClaude("bash", { command: "ls", timeout: 5, workdir: "/x" }),
      { name: "Bash", input: { command: "ls", timeout: 5 } });
    assert.deepEqual(mapDecoyToClaude("read", { filePath: "/f", offset: 1 }),
      { name: "Read", input: { file_path: "/f", offset: 1 } });
    assert.deepEqual(mapDecoyToClaude("edit", { filePath: "/f", oldString: "a", newString: "b" }),
      { name: "Edit", input: { file_path: "/f", old_string: "a", new_string: "b" } });
    assert.deepEqual(mapDecoyToClaude("write", { filePath: "/f", content: "c" }),
      { name: "Write", input: { file_path: "/f", content: "c" } });
    assert.deepEqual(mapDecoyToClaude("glob", { pattern: "*.js" }),
      { name: "Glob", input: { pattern: "*.js" } });
    assert.deepEqual(mapDecoyToClaude("grep", { pattern: "p", include: "*.ts" }),
      { name: "Grep", input: { pattern: "p", include: "*.ts" } });
  });
  it("ten la tra null", () => {
    assert.equal(mapDecoyToClaude("nope", {}), null);
    assert.equal(mapDecoyToClaude("bash", null), null);
  });
});

describe("toToolUseBlock", () => {
  it("parse args JSON + map decoy", () => {
    assert.deepEqual(toToolUseBlock("c1", "bash", '{"command":"ls"}'),
      { type: "tool_use", id: "c1", name: "Bash", input: { command: "ls" } });
  });
  it("args hong -> _raw, ten giu nguyen", () => {
    assert.deepEqual(toToolUseBlock("c2", "mytool", "not-json"),
      { type: "tool_use", id: "c2", name: "mytool", input: { _raw: "not-json" } });
  });
});
