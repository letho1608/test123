// translators/responses.js — Anthropic -> OpenAI Responses API (opencode zen).
// (pure functions, co unit test)
import { textOf } from "./anthropic.js";

export function toResponsesInput(system, messages, fingerprint) {
  const sysText = textOf(system);
  const dev = sysText ? fingerprint + "\n\n" + sysText : fingerprint;
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
          const out = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          input.push({ type: "function_call_output", call_id: b.tool_use_id, output: out });
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

// tool Anthropic -> Responses function (giuu nguyen, gate khong check ky phan nay)
export function toResponsesTools(claudeTools, decoys) {
  const out = [...(decoys || [])];
  for (const t of claudeTools || []) {
    out.push({ type: "function", name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object" } });
  }
  return out;
}

// object Responses hoan chinh -> message Anthropic
export function responsesToAnthropic(resp, model, toToolUse) {
  const content = [];
  let stop = "end_turn";
  for (const item of resp.output || []) {
    if (item.type === "message") {
      for (const p of item.content || []) {
        if (p.type === "output_text" && p.text) content.push({ type: "text", text: p.text });
        else if (p.type === "refusal" && p.refusal) content.push({ type: "text", text: p.refusal });
      }
    } else if (item.type === "function_call") {
      content.push(toToolUse(item.call_id || item.id, item.name, item.arguments));
      stop = "tool_use";
    }
  }
  if (!content.length) content.push({ type: "text", text: "" });
  const u = resp.usage || {};
  return {
    id: "msg_" + String(resp.id || "").replace(/^resp_/, "").slice(0, 24),
    type: "message", role: "assistant", model, content, stop_reason: stop,
    usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 },
  };
}
