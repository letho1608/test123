// test/sse.test.js — parse SSE + framer (khong can mang)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pumpSSE, anthropicFramer, collectResponses, collectOpenAi, streamOpenAi } from "../src/sse.js";

// body gia lap fetch Response tu cac chunk byte (co the cat doi giua chung)
function fakeBody(chunks) {
  const enc = new TextEncoder();
  const bufs = chunks.map((c) => enc.encode(c));
  let i = 0;
  return {
    body: {
      getReader() {
        return {
          async read() {
            if (i >= bufs.length) return { done: true, value: undefined };
            return { done: false, value: bufs[i++] };
          },
        };
      },
    },
  };
}

describe("pumpSSE", () => {
  it("parse event, bo comment/[DONE]/JSON hong, chiu chunk cat doi", async () => {
    const seen = [];
    await pumpSSE(fakeBody([":keep-alive\n\n", 'event: a\ndata: {"x"', ':1}\n\n', 'data: [DONE]\n\n', "not json\n\n"]), (ev, j) => seen.push([ev, j]));
    assert.deepEqual(seen, [["a", { x: 1 }]]);
  });
});

describe("collectResponses", () => {
  it("gom text + function_call + usage", async () => {
    const frames = [
      'event: response.created\ndata: {"response":{"id":"resp_1"}}\n\n',
      'event: response.output_text.delta\ndata: {"item_id":"t","delta":"hi"}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"f","call_id":"c1","name":"bash","delta":"{}"}\n\n',
      'event: response.output_item.done\ndata: {"item":{"type":"function_call","id":"f","call_id":"c1","name":"bash"}}\n\n',
      'event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":3}}}\n\n',
    ];
    const r = await collectResponses(fakeBody(frames));
    assert.equal(r.id, "resp_1");
    assert.equal(r.output.length, 2);
    assert.equal(r.output[1].type, "function_call");
    assert.deepEqual(r.usage, { input_tokens: 2, output_tokens: 3 });
  });
});

describe("collectOpenAi", () => {
  it("gom content + tool_calls + finish", async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"X","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
    ];
    const r = await collectOpenAi(fakeBody(frames));
    assert.equal(r.content, "he");
    assert.equal(r.calls[0].name, "X");
    assert.equal(r.finish, "tool_calls");
    assert.equal(r.usage.prompt_tokens, 1);
  });
});

describe("anthropicFramer + streamOpenAi", () => {
  it("ra dung trinh tu Anthropic SSE", async () => {
    const out = [];
    const down = { write: (s) => out.push(s) };
    const frames = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","function":{"name":"Bash","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    ];
    await streamOpenAi(fakeBody(frames), down, "m");
    const txt = out.join("");
    for (const ev of ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]) {
      assert.ok(txt.includes(`event: ${ev}`), "thieu " + ev);
    }
    assert.ok(txt.includes('"stop_reason":"tool_use"'));
    assert.ok(txt.includes('"name":"Bash"'));
  });
});
