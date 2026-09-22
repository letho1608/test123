// sse.js — doc SSE upstream + khung SSE Anthropic ra downstream.
// Dung chung cho ca 2 backend (truoc day zenStream/oaiStream viet rieng, trung nhau).
import crypto from "node:crypto";
import { toToolUseBlock } from "./translators/anthropic.js";

// Pump SSE frames: onEvent(ev, data). Bo qua keep-alive/comment/[DONE].
export async function pumpSSE(upstreamRes, onEvent) {
  const reader = upstreamRes.body.getReader();
  const dec = new TextDecoder();
  let tail = "";
  const flush = (chunk, done) => {
    tail += dec.decode(chunk, { stream: !done });
    let p;
    while ((p = tail.indexOf("\n\n")) >= 0) {
      const raw = tail.slice(0, p); tail = tail.slice(p + 2);
      let ev = "message", data = "";
      for (const ln of raw.split("\n")) {
        if (ln.startsWith(":")) continue; // comment/keep-alive
        if (ln.startsWith("event:")) ev = ln.slice(6).trim();
        else if (ln.startsWith("data:")) data += ln.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      onEvent(ev, j);
    }
  };
  try {
    for (;;) { const { done, value } = await reader.read(); if (value) flush(value, done); if (done) break; }
  } catch { /* upstream cut giua chung */ }
}

// Khung message Anthropic SSE: tang dan index, gom text theo block, tool emit tron lan.
export function anthropicFramer(down, model) {
  const send = (ev, data) => {
    down.write(`event: ${ev}\n`);
    down.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const msgId = "msg_" + crypto.randomBytes(12).toString("hex");
  send("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let idx = -1, textOpen = false;
  return {
    textDelta(t) {
      if (!textOpen) {
        idx++; textOpen = true;
        send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } });
      }
      send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: t } });
    },
    tool(block) {
      if (textOpen) { send("content_block_stop", { type: "content_block_stop", index: idx }); textOpen = false; }
      idx++;
      send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      send("content_block_stop", { type: "content_block_stop", index: idx });
    },
    done(stopReason, usage) {
      if (textOpen) { send("content_block_stop", { type: "content_block_stop", index: idx }); textOpen = false; }
      const u = usage || {};
      send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: u.input_tokens ?? u.prompt_tokens ?? 0, output_tokens: u.output_tokens ?? u.completion_tokens ?? 0 } });
      send("message_stop", { type: "message_stop" });
    },
  };
}

// Gom Responses SSE -> object { id, output[], usage, status } (cho client stream:false)
export async function collectResponses(upstreamRes) {
  let id = "resp_proxy", output = [], usage = {}, status = "completed";
  const texts = new Map(), fns = new Map(), order = [];
  await pumpSSE(upstreamRes, (ev, j) => {
    if (ev === "response.created" && j.response) id = j.response.id || id;
    else if (ev === "response.output_text.delta") {
      const k = j.item_id || "t0";
      if (!texts.has(k)) { texts.set(k, ""); order.push({ kind: "text", key: k }); }
      texts.set(k, texts.get(k) + (j.delta || ""));
    }
    else if (ev === "response.function_call_arguments.delta") {
      const k = j.item_id || "f0";
      if (!fns.has(k)) { fns.set(k, { call_id: j.call_id || k, name: j.name || "tool", args: "" }); order.push({ kind: "fn", key: k }); }
      const f = fns.get(k);
      if (j.call_id) f.call_id = j.call_id;
      if (j.name) f.name = j.name;
      f.args += j.delta || "";
    }
    else if (ev === "response.output_item.added" && j.item && j.item.type === "function_call") {
      const k = j.item.id;
      if (!fns.has(k)) { fns.set(k, { call_id: j.item.call_id || k, name: j.item.name || "tool", args: "" }); order.push({ kind: "fn", key: k }); }
    }
    else if (ev === "response.completed" || ev === "response.incomplete") {
      const r = j.response || {};
      usage = r.usage || usage; status = r.status || status;
    }
    else if (ev === "response.failed") status = "failed";
  });
  for (const o of order) {
    if (o.kind === "text") output.push({ type: "message", content: [{ type: "output_text", text: texts.get(o.key) }] });
    else { const f = fns.get(o.key); output.push({ type: "function_call", call_id: f.call_id, name: f.name, arguments: f.args }); }
  }
  return { id, output, usage, status };
}

// OpenAI-chat SSE -> Anthropic SSE (dung chung cho ollama + zen-chat).
export async function streamOpenAi(up, down, model) {
  const framer = anthropicFramer(down, model);
  let stopReason = "end_turn", usage = null;
  const calls = new Map();
  await pumpSSE(up, (ev, j) => {
    if (ev !== "message") return;
    const ch = (j.choices && j.choices[0]) || {};
    if (j.usage) usage = j.usage;
    const d = ch.delta || {};
    if (typeof d.content === "string" && d.content) framer.textDelta(d.content);
    for (const tc of d.tool_calls || []) {
      const k = tc.index ?? 0;
      if (!calls.has(k)) calls.set(k, { id: tc.id || ("call_" + k), name: "", args: "" });
      const c = calls.get(k);
      if (tc.id) c.id = tc.id;
      if (tc.function) { if (tc.function.name) c.name = tc.function.name; if (tc.function.arguments) c.args += tc.function.arguments; }
    }
    if (ch.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (ch.finish_reason === "length") stopReason = "max_tokens";
    else if (ch.finish_reason === "stop" && stopReason !== "tool_use") stopReason = "end_turn";
  });
  for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    framer.tool(toToolUseBlock(c.id, c.name, c.args));
    stopReason = "tool_use";
  }
  framer.done(stopReason, usage);
}

// Gom OpenAI SSE -> { content, calls[{id,name,args}], usage, finish } (cho client stream:false)
export async function collectOpenAi(upstreamRes) {
  let content = "", calls = new Map(), usage = {}, finish = null;
  await pumpSSE(upstreamRes, (ev, j) => {
    if (ev !== "message") return;
    const ch = (j.choices && j.choices[0]) || {};
    if (j.usage) usage = j.usage;
    const d = ch.delta || {};
    if (typeof d.content === "string") content += d.content;
    for (const tc of d.tool_calls || []) {
      const k = tc.index ?? 0;
      if (!calls.has(k)) calls.set(k, { id: tc.id || ("call_" + k), name: "", args: "" });
      const c = calls.get(k);
      if (tc.id) c.id = tc.id;
      if (tc.function) { if (tc.function.name) c.name = tc.function.name; if (tc.function.arguments) c.args += tc.function.arguments; }
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  });
  return { content, calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c), usage, finish };
}
