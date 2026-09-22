// translators/openai.js — Anthropic <-> OpenAI Chat Completions (ollama + zen-chat).
// (pure functions, co unit test)
import { textOf, toolResultText, toToolUseBlock } from "./anthropic.js";

export function toOpenAiMessages(system, messages) {
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

export function toOpenAiTools(claudeTools) {
  if (!claudeTools || !claudeTools.length) return undefined;
  return claudeTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object" } },
  }));
}

// accumulated OpenAI tool calls -> Anthropic content blocks (dung chung stream/non-stream)
export function openAiCallsToBlocks(calls, toToolUse) {
  return calls.map((c) => toToolUse(c.id, c.name, c.args));
}

// accumulated OpenAI turn { content, calls[], usage, finish } -> Anthropic message
export function openAiTurnToAnthropic(a, model) {
  const content = [];
  if (a.content) content.push({ type: "text", text: a.content });
  for (const c of a.calls) content.push(toToolUseBlock(c.id, c.name, c.args));
  if (!content.length) content.push({ type: "text", text: "" });
  const stop = a.calls.length ? "tool_use" : a.finish === "length" ? "max_tokens" : "end_turn";
  return {
    id: "msg_" + Math.random().toString(16).slice(2, 14),
    type: "message", role: "assistant", model, content, stop_reason: stop,
    usage: { input_tokens: a.usage.prompt_tokens ?? 0, output_tokens: a.usage.completion_tokens ?? 0 },
  };
}
