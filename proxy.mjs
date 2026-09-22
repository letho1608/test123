// zen-claude-proxy: Claude Code (Anthropic /v1/messages, localhost-only)
//   -> backend "zen" (OpenCode Zen free tier, /v1/responses)
//   -> backend "ollama" (Ollama OpenAI-compat, /v1/chat/completions)
// Chay: BACKEND=zen node proxy.mjs [port]   (mac dinh zen, port 8898)
//   Chi dung Node co san (>=18). Khong can opencode binary, khong key.
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8898);
const HOST = process.env.HOST || "127.0.0.1"; // mac dinh local-only; chi doi khi test trong docker
const BACKEND = (process.env.BACKEND || "zen").toLowerCase();

// --- zen ---
const ZEN_BASE = (process.env.ZEN_BASE || "https://opencode.ai/zen/v1").replace(/\/+$/, "");
const ZEN_MODEL = process.env.ZEN_MODEL || "muse-spark-1.3-contributor-free";
// --- ollama ---
const OLLAMA_BASE = (process.env.OLLAMA_BASE || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "";

const UA = "opencode/1.18.21 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14";

// ---------- zen: fingerprint + mint ID (da reverse, khong can binary) ----------
let AGENTDEV = null;
try {
  const t = fs.readFileSync(path.join(HERE, "agentdev.txt"), "utf8");
  if (t.length > 5000) AGENTDEV = t;
} catch {}
if (!AGENTDEV) {
  try {
    const raw = fs.readFileSync(path.join(HERE, "fp.json"), "utf8");
    AGENTDEV = JSON.parse(raw).fingerprint || raw;
  } catch (e) { if (BACKEND === "zen") { console.error("Thieu agentdev.txt/fp.json cho backend zen"); process.exit(1); } }
}
let DECOYS = [];
try {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, "decoy_tools.json"), "utf8"));
  if (Array.isArray(d) && d.length) DECOYS = d;
} catch {}

const T_SES = 1855425871850;
const M_MSG = 1786706395100;
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const randTail = (n) => Array.from(crypto.randomBytes(n), (b) => ABC[b % 62]).join("");
const mintSes = () => "ses_" + ((T_SES - Date.now()) * 4096 + 0xffe).toString(16).padStart(12, "0") + randTail(14);
const mintMsg = () => "msg_" + ((Date.now() - M_MSG) * 4096 + 0x001).toString(16).padStart(12, "0") + randTail(14);

// ---------- helpers chung ----------
function textOf(blocks) {
  if (typeof blocks === "string") return blocks;
  return (blocks || []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
}
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === "text" ? b.text : JSON.stringify(b))).join("\n");
  }
  return JSON.stringify(content ?? "");
}
// decoy (opencode) -> Claude Code (de model co goi tool opencode thi van chay trong Claude)
function mapDecoyToClaude(name, args) {
  try {
    switch (name) {
      case "bash": return { name: "Bash", input: { command: args.command, ...(args.timeout !== undefined ? { timeout: args.timeout } : {}) } };
      case "read": return { name: "Read", input: { file_path: args.filePath, ...(args.offset !== undefined ? { offset: args.offset } : {}), ...(args.limit !== undefined ? { limit: args.limit } : {}) } };
      case "edit": return { name: "Edit", input: { file_path: args.filePath, old_string: args.oldString, new_string: args.newString } };
      case "write": return { name: "Write", input: { file_path: args.filePath, content: args.content } };
      case "glob": return { name: "Glob", input: { pattern: args.pattern, ...(args.path !== undefined ? { path: args.path } : {}) } };
      case "grep": return { name: "Grep", input: { pattern: args.pattern, ...(args.path !== undefined ? { path: args.path } : {}), ...(args.include !== undefined ? { include: args.include } : {}) } };
      default: return null;
    }
  } catch { return null; }
}
function toToolUseBlock(callId, name, argsJson) {
  let input = {};
  try { input = JSON.parse(argsJson || "{}"); } catch { input = { _raw: argsJson }; }
  const mapped = mapDecoyToClaude(name, input);
  if (mapped) return { type: "tool_use", id: callId, name: mapped.name, input: mapped.input };
  return { type: "tool_use", id: callId, name, input };
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 50 * 1024 * 1024) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// ---------- zen: Anthropic -> Responses ----------
function zenInput(system, messages) {
  const sysText = textOf(system);
  const dev = sysText ? AGENTDEV + "\n\n" + sysText : AGENTDEV;
  const input = [{ role: "developer", content: dev }];
  for (const m of messages || []) {
    if (m.role === "user") {
      const parts = [];
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === "text") parts.push({ type: "input_text", text: b.text || "" });
        else if (b.type === "image") {
          const s = b.source || {};
          const url = s.type === "url" ? s.url : `data:${s.media_type || "image/png"};base64,${s.data || ""}`;
          parts.push({ type: "input_image", image_url: url });
        } else if (b.type === "tool_result") {
          input.push({ type: "function_call_output", call_id: b.tool_use_id, output: toolResultText(b.content) });
        }
      }
      if (parts.length) input.push({ role: "user", content: parts });
    } else if (m.role === "assistant") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      const texts = blocks.filter((b) => b && b.type === "text" && b.text).map((b) => ({ type: "output_text", text: b.text }));
      if (texts.length) input.push({ role: "assistant", content: texts });
      for (const b of blocks) {
        if (b && b.type === "tool_use") {
          input.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
        }
      }
    }
  }
  return input;
}
function zenTools(claudeTools) {
  const out = [...DECOYS];
  for (const t of claudeTools || []) {
    out.push({ type: "function", name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object" } });
  }
  return out;
}
async function zenCall(payload) {
  const session = mintSes(), req = mintMsg();
  payload.prompt_cache_key = session;
  const res = await fetch(ZEN_BASE + "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "User-Agent": UA,
      "x-opencode-client": "cli",
      "x-opencode-project": "global",
      "x-opencode-request": req,
      "x-opencode-session": session,
    },
    body: JSON.stringify(payload),
  });
  return res;
}
function zenToAnthropic(resp, model) {
  const content = [];
  let stop = "end_turn";
  for (const item of resp.output || []) {
    if (item.type === "message") {
      for (const p of item.content || []) {
        if (p.type === "output_text" && p.text) content.push({ type: "text", text: p.text });
        else if (p.type === "refusal" && p.refusal) content.push({ type: "text", text: p.refusal });
      }
    } else if (item.type === "function_call") {
      content.push(toToolUseBlock(item.call_id || item.id, item.name, item.arguments));
      stop = "tool_use";
    }
  }
  if (!content.length) content.push({ type: "text", text: "" });
  const u = resp.usage || {};
  return {
    id: "msg_" + String(resp.id || "").replace(/^resp_/, "").slice(0, 24) || ("msg_" + crypto.randomBytes(12).toString("hex")),
    type: "message", role: "assistant", model, content, stop_reason: stop,
    usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 },
  };
}

// ---------- ollama: Anthropic -> OpenAI chat ----------
function oaiMessages(system, messages) {
  const out = [];
  const sys = textOf(system);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of messages || []) {
    if (m.role === "user") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      const parts = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === "text") parts.push({ type: "text", text: b.text || "" });
        else if (b.type === "image") {
          const s = b.source || {};
          const url = s.type === "url" ? s.url : `data:${s.media_type || "image/png"};base64,${s.data || ""}`;
          parts.push({ type: "image_url", image_url: { url } });
        } else if (b.type === "tool_result") {
          out.push({ role: "tool", tool_call_id: b.tool_use_id, content: toolResultText(b.content) });
        }
      }
      // gom text blocks thanh string (ollama chuan); giu array neu co image
      if (parts.some((p) => p.type === "image_url")) out.push({ role: "user", content: parts });
      else if (parts.length) out.push({ role: "user", content: parts.map((p) => p.text || "").join("") });
    } else if (m.role === "assistant") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      const texts = blocks.filter((b) => b && b.type === "text" && b.text).map((b) => b.text).join("");
      const calls = blocks.filter((b) => b && b.type === "tool_use").map((b) => ({
        id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const msg = { role: "assistant", content: texts || null };
      if (calls.length) msg.tool_calls = calls;
      if (texts || calls.length) out.push(msg);
    }
  }
  return out;
}
function oaiTools(claudeTools) {
  if (!claudeTools || !claudeTools.length) return undefined;
  return claudeTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object" } },
  }));
}
function oaiToAnthropic(resp, model) {
  const ch = (resp.choices && resp.choices[0]) || {};
  const msg = ch.message || {};
  const content = [];
  if (msg.content) content.push({ type: "text", text: msg.content });
  for (const c of msg.tool_calls || []) {
    if (c.type !== "function") continue;
    let input = {};
    try { input = JSON.parse(c.function.arguments || "{}"); } catch { input = { _raw: c.function.arguments }; }
    content.push({ type: "tool_use", id: c.id, name: c.function.name, input });
  }
  if (!content.length) content.push({ type: "text", text: "" });
  const stop = (msg.tool_calls && msg.tool_calls.length) ? "tool_use"
    : ch.finish_reason === "length" ? "max_tokens" : "end_turn";
  const u = resp.usage || {};
  return {
    id: "msg_" + crypto.randomBytes(12).toString("hex"),
    type: "message", role: "assistant", model, content, stop_reason: stop,
    usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0 },
  };
}
async function oaiCall(payload) {
  const res = await fetch(OLLAMA_BASE + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}

// ---------- SSE parsers ----------
function sseReader(upstreamRes, onEvent) {
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
        if (ln.startsWith("event:")) ev = ln.slice(6).trim();
        else if (ln.startsWith("data:")) data += ln.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      onEvent(ev, j);
    }
  };
  return (async () => {
    try {
      for (;;) { const { done, value } = await reader.read(); if (value) flush(value, done); if (done) break; }
    } catch { /* upstream cut */ }
  })();
}

// zen SSE -> Anthropic SSE
async function zenStream(upstreamRes, down, model) {
  const send = (ev, data) => { down.write(`event: ${ev}\n`); down.write(`data: ${JSON.stringify(data)}\n\n`); };
  const msgId = "msg_" + crypto.randomBytes(12).toString("hex");
  send("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let idx = -1, cur = null, stopReason = "end_turn", usage = null;
  const fnArgs = new Map();
  const stopBlock = () => { if (cur) { send("content_block_stop", { type: "content_block_stop", index: idx }); cur = null; } };
  const startText = () => { if (!cur || cur.kind !== "text") { stopBlock(); idx++; cur = { kind: "text" }; send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } }); } };
  const emitTool = (callId, name, argsJson) => {
    stopBlock(); idx++;
    const b = toToolUseBlock(callId, name, argsJson);
    send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
    send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    send("content_block_stop", { type: "content_block_stop", index: idx });
  };
  await sseReader(upstreamRes, (ev, j) => {
    if (ev === "response.output_text.delta") { startText(); send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: j.delta || "" } }); }
    else if (ev === "response.function_call_arguments.delta") {
      const k = j.item_id || "f0";
      if (!fnArgs.has(k)) fnArgs.set(k, { call_id: j.call_id || k, name: j.name || "tool", args: "" });
      const f = fnArgs.get(k);
      if (j.call_id) f.call_id = j.call_id;
      if (j.name) f.name = j.name;
      f.args += j.delta || "";
    }
    else if (ev === "response.output_item.added" && j.item && j.item.type === "function_call") {
      const k = j.item.id;
      if (!fnArgs.has(k)) fnArgs.set(k, { call_id: j.item.call_id || k, name: j.item.name || "tool", args: "" });
    }
    else if (ev === "response.output_item.done") {
      if (j.item && j.item.type === "function_call") {
        const k = j.item.id;
        const f = fnArgs.get(k) || { call_id: j.item.call_id || k, name: j.item.name, args: j.item.arguments || "" };
        if (j.item.arguments && !fnArgs.has(k)) f.args = j.item.arguments;
        stopReason = "tool_use";
        emitTool(f.call_id, f.name, f.args);
        fnArgs.delete(k);
      } else if (j.item && j.item.type === "message") stopBlock();
    }
    else if (ev === "response.completed" || ev === "response.incomplete") {
      const r = j.response || {};
      usage = r.usage || usage;
      if ((r.output || []).some((i) => i.type === "function_call")) stopReason = "tool_use";
    }
    else if (ev === "response.failed") stopBlock();
  });
  const u = usage || {};
  send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 } });
  send("message_stop", { type: "message_stop" });
}

// zen SSE -> object (client stream:false)
async function zenAccumulate(upstreamRes) {
  let id = "resp_proxy", output = [], usage = {}, status = "completed";
  const texts = new Map(), fns = new Map(), order = [];
  await sseReader(upstreamRes, (ev, j) => {
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

// ollama(OpenAI) SSE -> Anthropic SSE
async function oaiStream(upstreamRes, down, model) {
  const send = (ev, data) => { down.write(`event: ${ev}\n`); down.write(`data: ${JSON.stringify(data)}\n\n`); };
  const msgId = "msg_" + crypto.randomBytes(12).toString("hex");
  send("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let idx = -1, curText = false, stopReason = "end_turn", usage = null;
  const calls = new Map(); // index -> {id, name, args}
  const stopText = () => { if (curText) { send("content_block_stop", { type: "content_block_stop", index: idx }); curText = false; } };
  await sseReader(upstreamRes, (ev, j) => {
    if (ev !== "message") return;
    const ch = (j.choices && j.choices[0]) || {};
    if (j.usage) usage = j.usage;
    const d = ch.delta || {};
    if (typeof d.content === "string" && d.content) {
      if (!curText) { stopText(); idx++; curText = true; send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } }); }
      send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: d.content } });
    }
    for (const tc of d.tool_calls || []) {
      const k = tc.index ?? 0;
      if (!calls.has(k)) calls.set(k, { id: tc.id || ("call_" + k), name: "", args: "" });
      const c = calls.get(k);
      if (tc.id) c.id = tc.id;
      if (tc.function) { if (tc.function.name) c.name = tc.function.name; if (tc.function.arguments) c.args += tc.function.arguments; }
    }
    if (ch.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (ch.finish_reason === "length") stopReason = "max_tokens";
    else if (ch.finish_reason === "stop") stopReason = stopReason === "tool_use" ? "tool_use" : "end_turn";
  });
  stopText();
  for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let input = {};
    try { input = JSON.parse(c.args || "{}"); } catch { input = { _raw: c.args }; }
    idx++;
    send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "tool_use", id: c.id, name: c.name, input: {} } });
    send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
    send("content_block_stop", { type: "content_block_stop", index: idx });
    stopReason = "tool_use";
  }
  const u = usage || {};
  send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0 } });
  send("message_stop", { type: "message_stop" });
}

// ollama SSE -> object (client stream:false)
async function oaiAccumulate(upstreamRes) {
  let content = "", calls = new Map(), usage = {}, finish = null;
  await sseReader(upstreamRes, (ev, j) => {
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

// ---------- handlers ----------
async function handleZen(body, model, res) {
  const payload = {
    model: ZEN_MODEL,
    input: zenInput(body.system, body.messages),
    max_output_tokens: body.max_tokens || 4096,
    store: false,
    include: ["reasoning.encrypted_content"],
    reasoning: { effort: "minimal", summary: "auto" },
    stream: true, // free tier bat buoc streaming
    tools: zenTools(body.tools),
    tool_choice: "auto", // upstream chi ho tro auto
  };
  const up = await zenCall(payload);
  if (!up.ok) {
    const t = await up.text();
    if (t.includes("FreeTierError")) {
      const retry = await zenCall({ ...payload });
      if (retry.ok) return finishZen(retry, body, model, res);
      const rt = await retry.text();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: rt.slice(0, 500) } }));
      return;
    }
    res.writeHead(up.status === 403 ? 400 : up.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: t.slice(0, 500) } }));
    return;
  }
  return finishZen(up, body, model, res);
}
async function finishZen(up, body, model, res) {
  if (body.stream !== false) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    await zenStream(up, res, model);
    res.end();
  } else {
    const j = await zenAccumulate(up);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(zenToAnthropic(j, model)));
  }
}
async function handleOllama(body, model, res) {
  const payload = {
    model: OLLAMA_MODEL,
    messages: oaiMessages(body.system, body.messages),
    stream: true, // luon stream upstream, gom lai neu client can non-stream
  };
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  const tools = oaiTools(body.tools);
  if (tools) {
    payload.tools = tools;
    if (body.tool_choice && body.tool_choice.type === "none") payload.tool_choice = "none";
    else if (body.tool_choice && body.tool_choice.type === "any") payload.tool_choice = "required";
    else if (body.tool_choice && body.tool_choice.type === "tool") {
      payload.tool_choice = { type: "function", function: { name: body.tool_choice.name } };
    } else payload.tool_choice = "auto";
  }
  let up;
  try {
    up = await oaiCall(payload);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "khong noi duoc ollama (" + OLLAMA_BASE + "): " + String(e).slice(0, 200) } }));
    return;
  }
  if (!up.ok) {
    const t = await up.text();
    res.writeHead(up.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: t.slice(0, 500) } }));
    return;
  }
  if (body.stream !== false) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    await oaiStream(up, res, model);
    res.end();
  } else {
    const a = await oaiAccumulate(up);
    const content = [];
    if (a.content) content.push({ type: "text", text: a.content });
    for (const c of a.calls) {
      let input = {};
      try { input = JSON.parse(c.args || "{}"); } catch { input = { _raw: c.args }; }
      content.push({ type: "tool_use", id: c.id, name: c.name, input });
    }
    if (!content.length) content.push({ type: "text", text: "" });
    const stop = a.calls.length ? "tool_use" : a.finish === "length" ? "max_tokens" : "end_turn";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_" + crypto.randomBytes(12).toString("hex"),
      type: "message", role: "assistant", model, content, stop_reason: stop,
      usage: { input_tokens: (a.usage.prompt_tokens ?? 0), output_tokens: (a.usage.completion_tokens ?? 0) },
    }));
  }
}

const MODEL_IDS = [ZEN_MODEL, "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"];
const server = http.createServer(async (req, res) => {
  const log = (m) => { try { fs.appendFileSync(path.join(HERE, "proxy.log"), new Date().toISOString() + " " + m + "\n"); } catch {} };
  let pathname = req.url || "/";
  try { pathname = new URL(req.url, "http://127.0.0.1").pathname; } catch {}
  try {
    if (req.method === "HEAD") { res.writeHead(200); res.end(); return; }
    if (req.method === "GET" && pathname === "/") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>zen-claude-proxy</title></head><body style="font-family:sans-serif;max-width:640px;margin:40px auto">`
        + `<h2>zen-claude-proxy dang chay</h2>`
        + `<p>backend: <b>${BACKEND}</b> (${BACKEND === "ollama" ? OLLAMA_MODEL + " @ " + OLLAMA_BASE : ZEN_MODEL + " @ " + ZEN_BASE})</p>`
        + `<p>Day la API cho Claude Code (<code>POST /v1/messages</code>), khong phai trang web.</p>`
        + `<p>Chay Claude Code terminal khac voi:<br><code>ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=claude-sonnet-4-5</code></p>`
        + `</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      const ids = BACKEND === "ollama" && OLLAMA_MODEL ? [OLLAMA_MODEL, ...MODEL_IDS] : MODEL_IDS;
      const now = Date.now();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [...new Set(ids)].map((id) => ({ id, object: "model", created: now, owned_by: BACKEND })) }));
      return;
    }
    if (req.method !== "POST" || (pathname !== "/v1/messages" && pathname !== "/messages")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found", message: "use POST /v1/messages" } }));
      return;
    }
    const body = await readJson(req);
    const model = body.model || (BACKEND === "ollama" ? OLLAMA_MODEL : ZEN_MODEL);
    log(`HIT ${BACKEND} model=${model} stream=${body.stream !== false} tools=${(body.tools || []).length}`);
    if (BACKEND === "ollama") {
      if (!OLLAMA_MODEL) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "chua chon model ollama (OLLAMA_MODEL)" } }));
        return;
      }
      return handleOllama(body, model, res);
    }
    return handleZen(body, model, res);
  } catch (e) {
    try { fs.appendFileSync(path.join(HERE, "proxy.log"), new Date().toISOString() + " HANDLER ERR " + String(e).slice(0, 300) + "\n"); } catch {}
    try { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(e).slice(0, 300) } })); } catch { /* noop */ }
  }
});

server.listen(PORT, HOST, () => console.log(`proxy [${BACKEND}] on http://${HOST}:${PORT}`));
