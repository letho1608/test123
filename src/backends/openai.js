// backends/openai.js — bat ky endpoint OpenAI Chat Completions nao
// (Ollama /v1/chat/completions, Pollinations /openai, Groq, Cerebras, NVIDIA...).
// Dung chung 1 translator, khac nhau chi base URL + key + model.
import { ApiError } from "../errors.js";
import { toOpenAiMessages, toOpenAiTools, openAiTurnToAnthropic, mapToolChoice } from "../translators/openai.js";
import { collectOpenAi, streamOpenAi } from "../sse.js";

export async function handleOpenAi(body, model, res, log, opts) {
  const { url, apiKey, model: upstreamModel } = opts;
  if (!url) throw ApiError.misconfigured("thieu chat-completions URL");
  if (!upstreamModel) throw ApiError.misconfigured("chua chon model (doi qua /admin/switch hoac env)");
  const payload = {
    model: upstreamModel,
    messages: toOpenAiMessages(body.system, body.messages),
    stream: true, // luon stream upstream, gom lai neu client can non-stream
  };
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  const tools = toOpenAiTools(body.tools);
  if (tools) {
    payload.tools = tools;
    payload.tool_choice = mapToolChoice(body.tool_choice);
  }
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let up;
  try {
    up = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (e) {
    throw ApiError.unreachable(`khong noi duoc ${new URL(url).host}: ${String(e).slice(0, 200)}`);
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
