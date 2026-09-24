// backends/zen.js — OpenCode Zen free tier (Responses API + /chat/completions).
// Gate free tier (reverse-engineered): Bearer public + UA opencode + x-opencode-*
// (ID time-ordered tu mint) + stream:true + tool_choice auto + body dang opencode
// (prompt agent + tools opencode; model responses di /responses, con lai di /chat).
import { ZEN_BASE, ZEN_UA, ZEN_TIMEOUT_MS, RESPONSES_MODELS, ZEN_VERIFIED, runtime } from "../config.js";
import { logger } from "../logger.js";
import { ApiError, Codes } from "../errors.js";
import { mintSes, mintMsg } from "../ids.js";
import { textOf, toToolUseBlock } from "../translators/anthropic.js";
import { toResponsesInput, toResponsesTools, responsesToAnthropic } from "../translators/responses.js";
import { toOpenAiMessages, toOpenAiTools, openAiTurnToAnthropic, decoysToOpenAi } from "../translators/openai.js";
import { pumpSSE, anthropicFramer, collectResponses, collectOpenAi, streamOpenAi } from "../sse.js";

export function buildZenPayloads(body, assets, modelId = runtime.zenModel) {
  return {
    // model responses (muse-spark): Responses API
    responses: {
      model: modelId,
      input: toResponsesInput(body.system, body.messages, assets.agentdev),
      max_output_tokens: body.max_tokens || 4096,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "minimal", summary: "auto" },
      stream: true, // free tier bat buoc streaming
      tools: toResponsesTools(body.tools, assets.decoys),
      tool_choice: "auto", // upstream chi ho tro auto
    },
    // model chat (nemotron/mimo/big-pickle...): OpenAI Chat Completions
    chat: {
      model: modelId,
      messages: toOpenAiMessages(combineSystem(assets.agentdev, body.system), body.messages),
      stream: true,
      tools: [...decoysToOpenAi(assets.decoys), ...(toOpenAiTools(body.tools) || [])],
      tool_choice: "auto",
      ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
    },
  };
}
function combineSystem(agentdev, system) {
  const sysText = textOf(system);
  return sysText ? agentdev + "\n\n" + sysText : agentdev;
}

function zenHeaders(session, req) {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer public",
    "User-Agent": ZEN_UA,
    "x-opencode-client": "cli",
    "x-opencode-project": "global",
    "x-opencode-request": req,
    "x-opencode-session": session,
  };
}

async function postZen(path, payload, timeoutMs = ZEN_TIMEOUT_MS) {
  const session = mintSes(), req = mintMsg();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error("timeout gui zen sau " + timeoutMs + "ms")), timeoutMs);
  try {
    return await fetch(ZEN_BASE + path, {
      method: "POST", signal: ctl.signal, headers: zenHeaders(session, req),
      body: JSON.stringify({ ...payload, prompt_cache_key: session }),
    });
  } finally {
    clearTimeout(t);
  }
}

// Gioi han retry: FreeTierError -> mint ID moi thu lai 1 lan; loi mang -> doi 2s thu lai 1 lan.
async function postZenResilient(path, payload, log) {
  try {
    return { res: await postZen(path, payload) };
  } catch (e) {
    log(`zen network error (lan 1): ${String(e).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      return { res: await postZen(path, payload) };
    } catch (e2) {
      return { netErr: String(e2).slice(0, 300) };
    }
  }
}

// Stream Responses SSE -> Anthropic SSE (text chay thang, tool gom du args roi emit).
async function streamResponses(up, down, model) {
  const framer = anthropicFramer(down, model);
  const fns = new Map();
  let stopReason = "end_turn", usage = null;
  await pumpSSE(up, (ev, j) => {
    if (ev === "response.output_text.delta") framer.textDelta(j.delta || "");
    else if (ev === "response.function_call_arguments.delta") {
      const k = j.item_id || "f0";
      if (!fns.has(k)) fns.set(k, { call_id: j.call_id || k, name: j.name || "tool", args: "" });
      const f = fns.get(k);
      if (j.call_id) f.call_id = j.call_id;
      if (j.name) f.name = j.name;
      f.args += j.delta || "";
    }
    else if (ev === "response.output_item.added" && j.item && j.item.type === "function_call") {
      const k = j.item.id;
      if (!fns.has(k)) fns.set(k, { call_id: j.item.call_id || k, name: j.item.name || "tool", args: "" });
    }
    else if (ev === "response.output_item.done") {
      if (j.item && j.item.type === "function_call") {
        const k = j.item.id;
        const f = fns.get(k) || { call_id: j.item.call_id || k, name: j.item.name, args: j.item.arguments || "" };
        if (j.item.arguments && !fns.has(k)) f.args = j.item.arguments;
        stopReason = "tool_use";
        framer.tool(toToolUseBlock(f.call_id, f.name, f.args));
        fns.delete(k);
      }
    }
    else if (ev === "response.completed" || ev === "response.incomplete") {
      const r = j.response || {};
      usage = r.usage || usage;
      if ((r.output || []).some((i) => i.type === "function_call")) stopReason = "tool_use";
    }
  });
  framer.done(stopReason, usage);
}

export async function handleZen(body, model, assets, res, log) {
  // Failover: thu model dang chon truoc, hong thi sang model verified tiep theo.
  // Tra ve model THAT da dung (Claude chap nhan mismatch, da verify).
  // CHI failover loi retryable (mang/429/het quota/gate); loi 4xx khac doi model
  // cung hong nhu nhau -> nem ngay, tranh storm 8 request vo ich.
  // Doc runtime moi request de doi model luc dang chay (POST /admin/switch).
  const candidates = [runtime.zenModel, ...ZEN_VERIFIED.filter((m) => m !== runtime.zenModel)];
  let lastErr = null;
  for (const candidate of candidates) {
    const useResponses = RESPONSES_MODELS.has(candidate);
    const path = useResponses ? "/responses" : "/chat/completions";
    const payload = buildZenPayloads(body, assets, candidate)[useResponses ? "responses" : "chat"];
    try {
      const up = await postZenOnce(path, payload, log);
      log(`zen ${candidate} -> ${up.status}`);
      return finishZenStream(up, body, candidate, useResponses, res);
    } catch (e) {
      lastErr = e;
      if (!isRetryableZen(e)) throw e;
      log(`zen ${candidate} hong (${e.code || "error"}), failover sang model tiep theo`);
    }
  }
  throw lastErr || ApiError.internal("het model thu");
}

// Loi co the het bang doi model: mat mang, 429, model bi tu choi (401/403), gate, 5xx.
export function isRetryableZen(e) {
  if (!(e instanceof ApiError)) return false;
  if (e.code === Codes.UPSTREAM_UNREACHABLE || e.code === Codes.FREETIER_DENIED) return true;
  return e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500;
}

// 1 candidate: gui 1 lan (+1 retry neu FreeTierError), loi mang nem ra ngoai.
async function postZenOnce(path, payload, log) {
  const first = await postZenResilient(path, payload, log);
  if (first.netErr) throw ApiError.unreachable(`khong noi duoc opencode.ai tu may nay (firewall/DNS/mang?). Mo /diag de xem chi tiet. Chi tiet: ${first.netErr}`);
  const up = first.res;
  if (up.ok) return up;
  const t = await up.text();
  if (t.includes("FreeTierError")) {
    const retry = await postZenResilient(path, payload, log);
    if (retry.netErr) throw ApiError.unreachable(`khong noi duoc opencode.ai (lan 2): ${retry.netErr}`);
    if (retry.res.ok) return retry.res;
    throw ApiError.freetier((await retry.res.text()).slice(0, 500));
  }
  if (up.status === 403) throw ApiError.freetier(t.slice(0, 500));
  throw ApiError.upstream(up.status, t.slice(0, 500));
}

async function finishZenStream(up, body, model, useResponses, res) {
  if (body.stream !== false) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (useResponses) await streamResponses(up, res, model);
    else await streamOpenAi(up, res, model);
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (useResponses) {
      res.end(JSON.stringify(responsesToAnthropic(await collectResponses(up), model, toToolUseBlock)));
    } else {
      res.end(JSON.stringify(openAiTurnToAnthropic(await collectOpenAi(up), model)));
    }
  }
}
