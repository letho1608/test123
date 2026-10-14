// backends/local.js — opencode CLI tren chinh may nay (khong qua server opencode.ai).
// Claude Code -> proxy (Anthropic) -> `opencode run --format json` (tool chay NOI BO
// trong opencode: doc/sua file, shell...) -> text cuoi goi ve dang Anthropic end_turn.
// Tools cua Claude bi lot di: Claude chi lam man hinh hien thi, khong chay tool,
// khong goi server Anthropic.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../errors.js";
import { textOf, toolResultText } from "../translators/anthropic.js";
import { anthropicFramer } from "../sse.js";
import { LOCAL_TIMEOUT_MS, runtime, persistRuntime } from "../config.js";

export function opencodeBin() {
  // Ten hien thi / override. Windows: npm dat shim .ps1/.cmd — Node spawn
  // khong chay duoc .ps1, .cmd can shell (khong an toan) -> xem opencodeTarget().
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  return process.platform === "win32" ? "opencode.cmd" : "opencode";
}

// Resolve binary that that de spawn truc tiep (khong shell -> khong shell-injection
// tu prompt user). Windows: doc shim .cmd de lay exe that phia sau.
// Cache theo gia tri OPENCODE_BIN (test doi env giua chung van dung).
let _target = null, _targetKey = null;
export function opencodeTarget() {
  const key = (process.env.OPENCODE_BIN || "") + "|" + process.platform;
  if (_target && _targetKey === key) return _target;
  _targetKey = key;
  if (process.env.OPENCODE_BIN) { _target = { file: process.env.OPENCODE_BIN, shell: false }; return _target; }
  if (process.platform !== "win32") { _target = { file: "opencode", shell: false }; return _target; }
  try {
    const w = spawnSync("where.exe", ["opencode.cmd"], { encoding: "utf8", timeout: 10000 });
    const cmdPath = (w.stdout || "").split(/\r?\n/).map((s) => s.trim()).find((s) => s.toLowerCase().endsWith("opencode.cmd"));
    if (cmdPath) {
      const txt = fs.readFileSync(cmdPath, "utf8");
      const m = txt.match(/"([^"]+)"\s+%\*/);
      if (m) {
        const entry = m[1].replace(/%~?dp0%|%dp0%/gi, path.dirname(cmdPath) + path.sep).replace(/\\+/g, "\\");
        if (entry && fs.existsSync(entry)) { _target = { file: entry, shell: false }; return _target; }
      }
    }
  } catch { /* fallback duoi */ }
  _target = { file: "opencode.cmd", shell: true };
  return _target;
}

// system + history Anthropic -> 1 prompt text cho `opencode run`.
// Giu full lich su (session dai) + nhan role de opencode hieu ngu canh.
// (pure, co unit test)
export function buildLocalPrompt(body) {
  const parts = [];
  const sys = textOf(body.system);
  if (sys) parts.push("[system]\n" + sys);
  for (const m of body.messages || []) {
    if (m.role === "system") {
      const t = typeof m.content === "string" ? m.content : textOf(m.content);
      if (t) parts.push("[system]\n" + t);
    } else if (m.role === "user") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      const texts = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === "text" && b.text) texts.push(b.text);
        else if (b.type === "tool_result") texts.push(`[ket qua tool ${b.tool_use_id || ""}]\n${toolResultText(b.content)}`);
        else if (b.type === "image") texts.push("[image: relay text khong truyen duoc anh, bo qua]");
      }
      if (texts.length) parts.push("[user]\n" + texts.join("\n"));
    } else if (m.role === "assistant") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
      const texts = blocks.filter((b) => b && b.type === "text" && b.text).map((b) => b.text);
      const tools = blocks
        .filter((b) => b && b.type === "tool_use")
        .map((b) => `[tool da chay: ${b.name} ${JSON.stringify(b.input ?? {})}]`);
      if (texts.length || tools.length) parts.push("[assistant]\n" + [...texts, ...tools].join("\n"));
    }
  }
  return parts.join("\n\n").trim() || "(trong)";
}

// Parse NDJSON cua `opencode run --format json`:
// - sessionID that (dang "ses_...") de request sau tai dung (-s)
// - text tra loi (gop tu cac event text, nhieu hinh dang de phong doi schema)
// - error event -> nem message that cua opencode thay vi exit code chung chung.
// (pure, co unit test)
export function parseRunJson(out) {
  let text = "", sessionID = "", error = "";
  const seen = new Set();
  for (const line of String(out || "").split("\n")) {
    const t = line.trim();
    if (!t || (!t.startsWith("{"))) continue;
    let j;
    try { j = JSON.parse(t); } catch { continue; }
    if (j && typeof j.type === "string") seen.add(j.type);
    if (j && typeof j.sessionID === "string" && j.sessionID.startsWith("ses") && !sessionID) {
      sessionID = j.sessionID;
    }
    if (j && j.type === "error") {
      const m = j?.error?.message || j?.message || "opencode bao loi (khong ro)";
      error = String(m).slice(0, 500);
      continue;
    }
    // Cac dang text co the gap (schema khong document -> thu lan luot).
    const p = j?.part;
    if (p && typeof p.text === "string" && p.text) text += p.text;
    else if (typeof j?.text === "string" && /^(text|message|response|output|delta|content|result)$/.test(j.type || "")) text += j.text;
    else if (typeof j?.delta === "string" && j.delta) text += j.delta;
    else if (p && typeof p.delta === "string" && p.delta) text += p.delta;
  }
  return { text, sessionID, error, events: [...seen] };
}

function isSesID(s) {
  return typeof s === "string" && /^ses_[A-Za-z0-9]+$/.test(s);
}
export function localToAnthropic(text, model) {
  return {
    id: "msg_" + Math.random().toString(16).slice(2, 14),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: text || "" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// Chay `opencode run --format json` bat dong bo (khong block event loop).
// Session: chi truyen -s khi co sessionID that ("ses_..."); khong thi tao moi
// roi luu sessionID that ve runtime de request sau tai dung (session dai).
// Reject som thay vi treo khi: thieu binary, exit != 0, qua timeout tool-loop dai.
export function runOpencode(prompt, opts = {}) {
  const bin = opts.bin || opencodeBin();
  const session = opts.session || runtime.localSession || "";
  const args = ["run", "--format", "json"];
  if (isSesID(session)) args.push("-s", session);
  if (opts.model) args.push("--model", opts.model);
  if (opts.agent) args.push("--agent", opts.agent);
  args.push(prompt);
  const timeoutMs = opts.timeoutMs || LOCAL_TIMEOUT_MS;
  const cwd = opts.cwd || process.env.LOCAL_CWD || process.cwd();
  const tgt = opts.bin ? { file: opts.bin, shell: false } : (opts.target || opencodeTarget());
  return new Promise((resolve, reject) => {
    let child;
    try {
      // stdin ignore: khong de opencode doi nhap lieu (permission prompt) treo pipe.
      // shell:false + argv array: prompt user khong the shell-inject.
      child = spawn(tgt.file, args, { cwd, windowsHide: true, shell: tgt.shell, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(ApiError.unreachable(`khong chay duoc opencode CLI (${bin}): ${String(e.message || e).slice(0, 200)}`));
      return;
    }
    let out = "", err = "";
    let done = false;
    const fail = (e) => { if (!done) { done = true; clearTimeout(t); try { child.kill(); } catch {} reject(e); } };
    if (opts.signal) {
      // Client ngat giua chung (Claude abort/timeout) -> kill opencode, khong de
      // child treo giu event loop / chay tool-loop vo chu.
      const onAbort = () => fail(ApiError.upstream(502, "client ngat ket noi, da kill opencode"));
      if (opts.signal.aborted) { fail(ApiError.upstream(502, "client ngat ket noi truoc khi chay")); }
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const t = setTimeout(() => fail(ApiError.upstream(504,
      `opencode CLI qua lau (> ${Math.round(timeoutMs / 1000)}s), da kill (tool-loop dai? tang LOCAL_TIMEOUT_MS)`)), timeoutMs);
    child.stdout.on("data", (c) => {
      out += c;
      if (out.length > 4 * 1024 * 1024) fail(ApiError.upstream(502, "output opencode qua lon (>4MB)"));
    });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", (e) => fail(ApiError.unreachable(
      `khong chay duoc opencode CLI (${bin}): ${String(e.message || e).slice(0, 200)} (cai opencode chua? chay "opencode --version" thu)`)));
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      const parsed = parseRunJson(out);
      if (parsed.sessionID) {
        // Giu session that cho request sau (session dai). Luu ra file de
        // tat proxy bat lai van nho.
        try { runtime.localSession = parsed.sessionID; persistRuntime(); } catch {}
      }
      if (parsed.error) {
        // Exit code process (vd 1) khong phai HTTP status -> ep ve 502,
        // khong thi writeHead nem va response treo.
        const st = (code && code >= 400 && code <= 599) ? code : 502;
        reject(ApiError.upstream(st, `opencode: ${parsed.error}`));
      } else if (code === 0) {
        const text = parsed.text.trim();
        resolve({ text: text || "(opencode tra ve rong)", sessionID: parsed.sessionID, events: parsed.events, stderr: String(err).slice(-2000) });
      } else {
        reject(ApiError.upstream(502, `opencode CLI exit ${code}: ${String(err || out).slice(-500) || "khong ro loi"}`));
      }
    });
  });
}

function burstText(framer, text) {
  // opencode run khong stream -> burst 1 lan cho giong stream that.
  for (let i = 0; i < text.length; i += 2000) framer.textDelta(text.slice(i, i + 2000));
}

export async function handleLocal(body, model, res, log, opts = {}) {
  const session = opts.session || runtime.localSession || "";
  // model rong = dung model mac dinh trong opencode.json (khong truyen --model).
  const useModel = opts.model !== undefined ? opts.model : (runtime.localModel || "");
  const prompt = buildLocalPrompt(body);
  log(`local opencode session=${session || "(moi)"} model=${useModel || "(mac dinh opencode.json)"} prompt=${prompt.length} chars (lot ${(body.tools || []).length} tools Claude)`);
  const ctl = new AbortController();
  const onClose = () => ctl.abort();
  try { res.on("close", onClose); } catch {}
  let text;
  try {
    const r = await runOpencode(prompt, { session, model: useModel, agent: opts.agent || process.env.LOCAL_AGENT || "", signal: ctl.signal });
    text = r.text;
    if (!r.text || r.text === "(opencode tra ve rong)") log(`local canh bao: tra ve rong (events: ${(r.events || []).join(",") || "khong ro"})`);
  } finally {
    try { res.off("close", onClose); } catch {}
  }
  if (body.stream !== false) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const framer = anthropicFramer(res, model);
    burstText(framer, text);
    framer.done("end_turn", {});
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(localToAnthropic(text, model)));
  }
}
