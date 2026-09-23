// test/translate.test.js — responses/openai translators (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toResponsesInput, toResponsesTools, responsesToAnthropic } from "../src/translators/responses.js";
import { toOpenAiMessages, toOpenAiTools, openAiTurnToAnthropic, decoysToOpenAi } from "../src/translators/openai.js";
import { toToolUseBlock } from "../src/translators/anthropic.js";

const FP = "FINGERPRINT";

describe("toResponsesInput", () => {
  it("prepend fingerprint + giu system", () => {
    const inp = toResponsesInput("sys", [{ role: "user", content: "hi" }], FP);
    assert.equal(inp[0].role, "developer");
    assert.ok(inp[0].content.startsWith("FINGERPRINT\n\nsys"));
    assert.deepEqual(inp[1], { role: "user", content: [{ type: "input_text", text: "hi" }] });
  });
  it("map image + tool_result + assistant history", () => {
    const inp = toResponsesInput(null, [
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] },
      { role: "assistant", content: [{ type: "text", text: "t" }, { type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] },
    ], FP);
    assert.equal(inp[1].content[0].type, "input_image");
    assert.equal(inp[2].content[0].type, "output_text");
    assert.equal(inp[3].type, "function_call");
    assert.equal(inp[4].type, "function_call_output");
  });
});

describe("toResponsesTools", () => {
  it("gop decoys + claude tools", () => {
    const out = toResponsesTools([{ name: "X", description: "d", input_schema: { type: "object" } }], [{ type: "function", name: "bash" }]);
    assert.equal(out.length, 2);
    assert.equal(out[1].parameters.type, "object");
  });
});

describe("responsesToAnthropic", () => {
  it("message + function_call -> text + tool_use, stop tool_use", () => {
    const r = responsesToAnthropic({
      id: "resp_abc", output: [
        { type: "message", content: [{ type: "output_text", text: "hi" }] },
        { type: "function_call", call_id: "c1", name: "bash", arguments: '{"command":"ls"}' },
      ], usage: { input_tokens: 5, output_tokens: 6 },
    }, "m", toToolUseBlock);
    assert.equal(r.stop_reason, "tool_use");
    assert.equal(r.content[0].text, "hi");
    assert.equal(r.content[1].name, "Bash");
    assert.deepEqual(r.usage, { input_tokens: 5, output_tokens: 6 });
  });
  it("rong -> placeholder text", () => {
    const r = responsesToAnthropic({ id: "x", output: [] }, "m", toToolUseBlock);
    assert.equal(r.content[0].type, "text");
  });
});

describe("toOpenAiMessages", () => {
  it("system/user/assistant/tool_result dung dang OpenAI", () => {
    const out = toOpenAiMessages("sys", [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] },
    ]);
    assert.deepEqual(out[0], { role: "system", content: "sys" });
    assert.deepEqual(out[1], { role: "user", content: "hi" });
    assert.equal(out[2].tool_calls[0].function.name, "Bash");
    assert.deepEqual(out[3], { role: "tool", tool_call_id: "u1", content: "ok" });
  });
});

describe("toOpenAiTools", () => {
  it("rong -> undefined", () => assert.equal(toOpenAiTools([]), undefined));
  it("doi input_schema -> parameters", () => {
    const [t] = toOpenAiTools([{ name: "X", description: "d", input_schema: { type: "object" } }]);
    assert.equal(t.function.parameters.type, "object");
  });
});

describe("decoysToOpenAi", () => {
  it("doi dang Responses -> OpenAI, giu nguyen noi dung", () => {
    const [t] = decoysToOpenAi([{ type: "function", name: "bash", description: "d", parameters: { type: "object" } }]);
    assert.deepEqual(t, { type: "function", function: { name: "bash", description: "d", parameters: { type: "object" } } });
  });
  it("rong -> array rong", () => assert.deepEqual(decoysToOpenAi([]), []));
});

describe("openAiTurnToAnthropic", () => {
  it("text + calls + usage", () => {
    const r = openAiTurnToAnthropic({
      content: "hi", calls: [{ id: "c1", name: "get_time", args: "{}" }],
      usage: { prompt_tokens: 3, completion_tokens: 4 }, finish: "tool_calls",
    }, "m");
    assert.equal(r.stop_reason, "tool_use");
    assert.equal(r.content[1].name, "get_time");
    assert.deepEqual(r.usage, { input_tokens: 3, output_tokens: 4 });
  });
});
