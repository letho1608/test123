// test/local.test.js — backend opencode CLI local (offline, khong can opencode that)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLocalPrompt, localToAnthropic, runOpencode, opencodeTarget, parseRunJson } from "../src/backends/local.js";

describe("local prompt", () => {
  it("gop system + history co nhan role", () => {
    const p = buildLocalPrompt({
      system: "ban la dev",
      messages: [
        { role: "user", content: [{ type: "text", text: "sua file a" }] },
        { role: "assistant", content: [{ type: "text", text: "xong" }] },
        { role: "user", content: "tiep file b" },
      ],
    });
    assert.ok(p.includes("[system]\nban la dev"));
    assert.ok(p.includes("[user]\nsua file a"));
    assert.ok(p.includes("[assistant]\nxong"));
    assert.ok(p.includes("[user]\ntiep file b"));
  });
  it("tool_result thanh text, khong mat", () => {
    const p = buildLocalPrompt({
      messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "OK 42" }] }],
    });
    assert.ok(p.includes("t1") && p.includes("OK 42"));
  });
  it("body rong van co prompt", () => {
    assert.equal(typeof buildLocalPrompt({}), "string");
  });
});

describe("local response", () => {
  it("goi text ve dang Anthropic end_turn", () => {
    const m = localToAnthropic("hello", "local-model");
    assert.equal(m.type, "message");
    assert.equal(m.role, "assistant");
    assert.equal(m.stop_reason, "end_turn");
    assert.deepEqual(m.content, [{ type: "text", text: "hello" }]);
  });
});

describe("parse run json", () => {
  // Dong that lay tu `opencode run --format json` (v2.0.29).
  const STEP = '{"type":"step_start","timestamp":1792004145452,"sessionID":"ses_ec43ac3dfffegARTMrV02O4zn6","part":{"id":"prt_1","sessionID":"ses_ec43ac3dfffegARTMrV02O4zn6","messageID":"msg_1","type":"step-start","snapshot":"abc"}}';
  const ERR = '{"type":"error","timestamp":1792004224696,"sessionID":"ses_ec43ac3dfffegARTMrV02O4zn6","error":{"type":"provider.transport","message":"ConnectionRefused: Unable to connect. Is the computer able to access the url?"}}';
  it("lay sessionID tu step, bo qua dong rac", () => {
    const p = parseRunJson("not json\n" + STEP + "\n   \n");
    assert.equal(p.sessionID, "ses_ec43ac3dfffegARTMrV02O4zn6");
    assert.equal(p.error, "");
    assert.ok(p.events.includes("step_start"));
  });
  it("error event lay message that", () => {
    const p = parseRunJson(STEP + "\n" + ERR);
    assert.ok(p.error.includes("ConnectionRefused"));
    assert.equal(p.sessionID, "ses_ec43ac3dfffegARTMrV02O4zn6");
  });
  it("gop text tu cac dang event", () => {
    const p = parseRunJson(
      '{"type":"text","part":{"type":"text","text":"hello "}}\n' +
      '{"type":"message","text":"world"}\n' +
      '{"type":"delta","delta":"!"}'
    );
    assert.equal(p.text, "hello world!");
  });
});
describe("local spawn", () => {
  it("resolve target co file + shell", () => {
    const t = opencodeTarget();
    assert.ok(t && typeof t.file === "string" && t.file.length > 0);
    assert.equal(typeof t.shell, "boolean");
  });
  it("binary khong co thi unreachable (khong treo)", async () => {
    await assert.rejects(
      runOpencode("hi", { bin: "binary-chac-chan-khong-co-xyz", timeoutMs: 10000 }),
      (e) => e && e.code === "upstream_unreachable"
    );
  });
});
