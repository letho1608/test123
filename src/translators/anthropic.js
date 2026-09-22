// translators/anthropic.js — helpers lam viec voi block format Anthropic.
// (pure functions, co unit test)
export function textOf(blocks) {
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
}

export function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === "text" ? b.text : JSON.stringify(b))).join("\n");
  }
  return JSON.stringify(content ?? "");
}

// Map goi tool opencode (decoy) -> tool Claude Code tuong duong.
// De model co goi tool opencode thi van chay duoc trong Claude.
const DECOY_MAP = {
  bash: (a) => ({ name: "Bash", input: pick(a, ["command", "timeout"]) }),
  read: (a) => ({ name: "Read", input: rename(a, { filePath: "file_path", offset: "offset", limit: "limit" }) }),
  edit: (a) => ({ name: "Edit", input: rename(a, { filePath: "file_path", oldString: "old_string", newString: "new_string" }) }),
  write: (a) => ({ name: "Write", input: rename(a, { filePath: "file_path", content: "content" }) }),
  glob: (a) => ({ name: "Glob", input: pick(a, ["pattern", "path"]) }),
  grep: (a) => ({ name: "Grep", input: pick(a, ["pattern", "path", "include"]) }),
};
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function rename(obj, map) {
  const out = {};
  for (const [from, to] of Object.entries(map)) {
    if (obj[from] !== undefined) out[to] = obj[from];
  }
  return out;
}
export function mapDecoyToClaude(name, args) {
  try {
    const fn = DECOY_MAP[name];
    if (!fn || !args || typeof args !== "object") return null;
    return fn(args);
  } catch { return null; }
}

// function_call (Responses) / tool_calls (OpenAI) -> block tool_use (Anthropic)
export function toToolUseBlock(callId, name, argsJson) {
  let input = {};
  try { input = JSON.parse(argsJson || "{}"); } catch { input = { _raw: argsJson }; }
  const mapped = mapDecoyToClaude(name, input);
  if (mapped) return { type: "tool_use", id: callId, name: mapped.name, input: mapped.input };
  return { type: "tool_use", id: callId, name, input };
}

export function anthropicMessage(id, model, content, stopReason, usage) {
  if (!content.length) content.push({ type: "text", text: "" });
  return {
    id: id || ("msg_" + Math.random().toString(16).slice(2, 14)),
    type: "message", role: "assistant", model, content,
    stop_reason: stopReason || "end_turn",
    usage: { input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0 },
  };
}
