// backends/ollama.js — Ollama OpenAI-compat (/v1/chat/completions).
// (Ollama >= v0.14 noi native Anthropic, nhung di qua day de dong nhat behavior/log.)
import { OLLAMA_BASE, OLLAMA_MODEL } from "../config.js";
import { ApiError } from "../errors.js";
import { toOpenAiMessages, toOpenAiTools, openAiTurnToAnthropic } from "../translators/openai.js";
import { collectOpenAi, streamOpenAi } from "../sse.js";

function mapToolChoice(c) {
  if (!c || c.type === "auto") return "auto";
  if (c.type === "any") return "required";
  if (c.type === "none") return "none";
  if (c.type === "tool") return { type: "function", function: { name: c.name } };
  return "auto";
}

export async function handleOllama(body, model, res, log) {
  if (!OLLAMA_MODEL) throw ApiError.misconfigured("chua chon model ollama (OLLAMA_MODEL)");
  const payload = {
    model: OLLAMA_MODEL,
    messages: toOpenAiMessages(body.system, body.messages),
    stream: true, // luon stream upstream, gom lai neu client can non-stream
  };
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  const tools = toOpenAiTools(body.tools);
  if (tools) {
    payload.tools = tools;
    payload.tool_choice = mapToolChoice(body.tool_choice);
  }
  let up;
  try {
    up = await fetch(OLLAMA_BASE + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw ApiError.unreachable(`khong noi duoc ollama (${OLLAMA_BASE}): ${String(e).slice(0, 200)}`);
  }
  if (!up.ok) {
    const t = await up.text();
    throw ApiError.upstream(up.status, t.slice(0, 500));
  }
  if (body.stream !== false) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    await streamOpenAi(up, res, model);
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openAiTurnToAnthropic(await collectOpenAi(up), model)));
  }
}
