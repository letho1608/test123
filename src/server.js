// server.js — HTTP server: routes, validation, graceful shutdown.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PORT, HOST, BACKEND, MODEL_IDS, ZEN_MODEL, ZEN_BASE, OLLAMA_BASE, OLLAMA_MODEL, ROOT, runtime, ZEN_VERIFIED, ZEN_DEFAULT, OPENAI_URL } from "./config.js";
import { loadSettings, saveSettings } from "../scripts/lib/settings.js";
import { logger } from "./logger.js";
import { ApiError, validateMessagesBody } from "./errors.js";
import { loadAssets } from "./config.js";
import { handleZen } from "./backends/zen.js";
import { handleOllama } from "./backends/ollama.js";
import { handleOpenAi } from "./backends/openai.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const assets = loadAssets();
logger.info(`assets: agentdev=${assets.agentdev.length} chars, decoys=${assets.decoys.length}`);

function sendError(res, err) {
  const api = err instanceof ApiError ? err : ApiError.internal(String(err?.message || err).slice(0, 300));
  if (!(err instanceof ApiError)) logger.error(`HANDLER ${err?.stack || err}`.slice(0, 500));
  else logger.warn(`API ${api.status} [${api.code}] ${api.message.slice(0, 200)}`);
  try {
    res.writeHead(api.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(api.toJSON()));
  } catch {}
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 50 * 1024 * 1024) req.destroy(new Error("body qua lon")); });
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); }
      catch { reject(ApiError.badRequest("body khong phai JSON hop le")); }
    });
    req.on("error", reject);
  });
}

async function diag() {
  const out = { ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, node: process.version, time: new Date().toISOString(), checks: {} };
  const dns = await import("node:dns").then((m) => m.promises).catch(() => null);
  try {
    const ips = dns ? await dns.resolve4("opencode.ai") : [];
    out.checks.dns_opencode_ai = { ok: true, ips };
  } catch (e) { out.checks.dns_opencode_ai = { ok: false, error: String(e).slice(0, 200) }; }
  try {
    const t0 = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(new Error("timeout")), 20000);
    const r = await fetch(ZEN_BASE + "/models", { signal: ctl.signal, headers: { "User-Agent": "zen-claude-proxy" } });
    clearTimeout(t);
    const txt = await r.text();
    out.checks.zen_models = { ok: r.ok, status: r.status, ms: Date.now() - t0, sample: txt.slice(0, 120) };
  } catch (e) { out.checks.zen_models = { ok: false, error: String(e).slice(0, 300) }; }
  try {
    const t0 = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(new Error("timeout")), 10000);
    const r = await fetch(new URL("/api/tags", OLLAMA_BASE), { signal: ctl.signal });
    clearTimeout(t);
    out.checks.ollama = { ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) { out.checks.ollama = { ok: false, error: String(e).slice(0, 300) }; }
  // ok chung = duong backend dang dung (luc nay, co the doi qua /admin/switch)
  out.ok = runtime.backend === "ollama" ? !!out.checks.ollama?.ok : !!out.checks.zen_models?.ok;
  return out;
}

const DEFAULT_ALIAS = "claude-sonnet-4-6"; // alias Claude gui di, giong switch.js/start.js

// Patch settings.json cua Claude giong hệt switch.js de CLI + web nhat quan:
// zen/openai -> di qua proxy; ollama -> ollama cp + di thang.
function applySwitch(b) {
  if (b.backend === "ollama") {
    const alias = (typeof b.alias === "string" && b.alias.trim()) || DEFAULT_ALIAS;
    const cp = spawnSync("ollama", ["cp", b.ollamaModel, alias], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (cp.status !== 0) throw ApiError.unreachable(`ollama cp that bai: ${(cp.stderr || cp.stdout || "").slice(0, 300)}`);
    const cfg = loadSettings();
    cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
    delete cfg.modelOverrides[alias]; // di thang: khong rewrite ten model
    cfg.env = {
      ...(cfg.env || {}),
      ANTHROPIC_BASE_URL: "http://127.0.0.1:11434",
      ANTHROPIC_AUTH_TOKEN: "ollama",
      ANTHROPIC_API_KEY: "ollama",
      ANTHROPIC_MODEL: alias,
    };
    saveSettings(cfg);
    return { alias };
  }
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
  if (b.backend === "zen") cfg.modelOverrides[DEFAULT_ALIAS] = b.zenModel;
  else delete cfg.modelOverrides[DEFAULT_ALIAS];
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: DEFAULT_ALIAS,
  };
  saveSettings(cfg);
  return {};
}

function dashboardPage() {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>zen-proxy</title>
<style>body{font-family:sans-serif;max-width:720px;margin:24px auto;padding:0 16px}h2{margin:0 0 4px}.card{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin:16px 0}ul{list-style:none;padding:0;margin:8px 0}li{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid #eee}li:first-child{border-top:none}button{cursor:pointer;padding:4px 12px;border-radius:6px;border:1px solid #888;background:#f4f4f4}button:hover{background:#e6e6e6}button:disabled{opacity:.5;cursor:default}input{width:100%;box-sizing:border-box;padding:6px;margin:4px 0;border:1px solid #aaa;border-radius:6px}label{font-size:13px;color:#555}.row{display:flex;gap:8px;align-items:center}.muted{color:#666;font-size:13px}#msg{white-space:pre-wrap;background:#f7f7f7;border-radius:6px;padding:8px;min-height:20px;font-size:13px}.cur{font-weight:bold;color:#0a6c2e}.tag{font-size:12px;color:#fff;background:#0a6c2e;border-radius:4px;padding:1px 6px;margin-left:6px}</style>
</head><body>
<h2>zen-proxy</h2>
<div class="muted">proxy cho Claude Code — <a href="/diag">/diag</a> &middot; <a href="/v1/models">/v1/models</a> &middot; <button id="refresh" type="button">lam moi</button></div>
<div id="msg">dang tai...</div>
<div class="card"><h3>1. Ollama local</h3>
<div class="row"><label for="alias">alias Claude:</label><input id="alias" value="${DEFAULT_ALIAS}" style="max-width:220px"></div>
<ul id="ollama"></ul></div>
<div class="card"><h3>2. Zen free tier</h3><ul id="zen"></ul></div>
<div class="card"><h3>3. OpenAI-compatible tu nhap</h3>
<label>chat-completions URL</label><input id="oai-url" placeholder="https://api.groq.com/openai/v1/chat/completions">
<label>API key</label><input id="oai-key" placeholder="key (trong neu endpoint khong can)">
<label>model</label><input id="oai-model" placeholder="llama-3.3-70b-versatile">
<div class="row"><button id="oai-go" type="button">dung cau hinh nay</button></div></div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return r.json();
}
function say(t) { $("msg").textContent = t; }
async function doSwitch(body, label) {
  say("dang doi sang " + label + "...");
  try {
    const j = await api("/admin/switch", body);
    if (j.ok) { say("XONG: backend=" + j.backend + " (mo session Claude moi de dung)"); load(); }
    else say("LOI: " + (j.error || JSON.stringify(j)).slice(0, 300));
  } catch (e) { say("LOI ket noi proxy: " + String(e).slice(0, 200)); }
}
async function load() {
  try {
    const s = await api("/admin/status");
    say("dang dung: backend=" + s.backend
      + (s.backend === "ollama" ? " model=" + (s.ollamaModel || "-") + " (di thang Ollama)" : "")
      + (s.backend === "zen" ? " model=" + s.zenModel : "")
      + (s.backend === "openai" ? " model=" + (s.openaiModel || "-") + " @ " + (s.openaiUrl || "-") : ""));
    const z = await api("/admin/zen-models");
    $("zen").innerHTML = (z.verified || []).map((m) =>
      "<li><span>" + esc(m) + (m === s.zenModel && s.backend === "zen" ? '<span class="tag">dang dung</span>' : "") + (m === z.def ? " (mac dinh)" : "") + "</span>"
      + '<button data-zen="' + esc(m) + '">dung</button></li>').join("") || "<li>khong co model</li>";
    document.querySelectorAll("[data-zen]").forEach((b) => b.onclick = () => doSwitch({ backend: "zen", zenModel: b.dataset.zen }, "zen/" + b.dataset.zen));
    const o = await api("/admin/ollama-models");
    $("ollama").innerHTML = o.ok
      ? ((o.models || []).map((m) =>
        "<li><span>" + esc(m) + (m === s.ollamaModel && s.backend === "ollama" ? '<span class="tag">dang dung</span>' : "") + "</span>"
        + '<button data-ollama="' + esc(m) + '">dung</button></li>').join("") || "<li>ollama chua co model (ollama pull &lt;model&gt; truoc)</li>")
      : "<li>khong noi duoc Ollama (" + esc((o.error || "").slice(0, 120)) + ")</li>";
    document.querySelectorAll("[data-ollama]").forEach((b) => b.onclick = () => doSwitch({ backend: "ollama", ollamaModel: b.dataset.ollama, alias: $("alias").value.trim() || "${DEFAULT_ALIAS}" }, "ollama/" + b.dataset.ollama));
  } catch (e) { say("LOI ket noi proxy: " + String(e).slice(0, 200)); }
}
$("refresh").onclick = load;
$("oai-go").onclick = () => {
  const url = $("oai-url").value.trim(), model = $("oai-model").value.trim();
  if (!url || !model) { say("LOI: nhap du URL + model."); return; }
  doSwitch({ backend: "openai", openaiUrl: url, openaiKey: $("oai-key").value, openaiModel: model }, "openai/" + model);
};
load();
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  let pathname = req.url || "/";
  try { pathname = new URL(req.url, "http://127.0.0.1").pathname; } catch {}
  try {
    if (req.method === "HEAD") { res.writeHead(200); res.end(); return; }
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(dashboardPage());
      return;
    }
    if (req.method === "GET" && pathname === "/diag") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await diag(), null, 2));
      return;
    }
    if (req.method === "GET" && (pathname === "/admin/status")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, openaiUrl: runtime.openaiUrl, openaiModel: runtime.openaiModel, port: PORT, time: new Date().toISOString() }));
      return;
    }
    if (req.method === "GET" && pathname === "/admin/zen-models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, verified: ZEN_VERIFIED, def: ZEN_DEFAULT, current: runtime.zenModel }));
      return;
    }
    if (req.method === "GET" && pathname === "/admin/ollama-models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(new Error("timeout")), 10000);
        const r = await fetch(new URL("/api/tags", OLLAMA_BASE), { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error(`ollama status ${r.status}`);
        const j = await r.json();
        const models = ((j || {}).models || []).map((m) => m.name || m.model).filter(Boolean);
        res.end(JSON.stringify({ ok: true, models }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, models: [], error: String(e).slice(0, 200) }));
      }
      return;
    }
    if (req.method === "POST" && pathname === "/admin/switch") {
      // Doi backend/model luc dang chay, khong can restart. Chi nghe localhost.
      // Web dashboard hoac switch.js gui them clientPatched=true khi da tu patch
      // settings.json + ollama cp o client; khong thi server lam tron goi.
      // Thu tu bat buoc: validate het -> apply (co the fail) -> cuoi cung moi
      // commit runtime, de switch that bai khong de lai runtime nua voi.
      const b = await readJson(req);
      if (b.backend !== undefined && !["zen", "ollama", "openai"].includes(b.backend)) {
        throw ApiError.badRequest("backend phai la zen|ollama|openai");
      }
      const next = {
        backend: b.backend || runtime.backend,
        zenModel: runtime.zenModel,
        ollamaModel: runtime.ollamaModel,
        openaiUrl: runtime.openaiUrl,
        openaiKey: runtime.openaiKey,
        openaiModel: runtime.openaiModel,
      };
      if (b.zenModel !== undefined) {
        if (typeof b.zenModel !== "string" || !b.zenModel.trim()) throw ApiError.badRequest("zenModel phai la string khac rong");
        next.zenModel = b.zenModel;
      }
      if (b.ollamaModel !== undefined) {
        if (typeof b.ollamaModel !== "string" || !b.ollamaModel.trim()) throw ApiError.badRequest("ollamaModel phai la string khac rong");
        next.ollamaModel = b.ollamaModel;
      }
      if (next.backend === "ollama" && b.backend === "ollama" && !b.ollamaModel) {
        throw ApiError.badRequest("doi sang ollama can ollamaModel");
      }
      for (const k of ["openaiUrl", "openaiKey", "openaiModel"]) {
        if (b[k] !== undefined) {
          if (typeof b[k] !== "string") throw ApiError.badRequest(`${k} phai la string`);
          next[k] = b[k];
        }
      }
      if (next.backend === "openai" && b.backend === "openai"
        && (!next.openaiUrl.trim() || !next.openaiModel.trim())) {
        throw ApiError.badRequest("doi sang openai can openaiUrl + openaiModel khac rong");
      }
      let extra = {};
      if (b.backend !== undefined && !b.clientPatched) {
        extra = applySwitch({ backend: next.backend, zenModel: next.zenModel, ollamaModel: next.ollamaModel, openaiUrl: next.openaiUrl, alias: b.alias });
      }
      Object.assign(runtime, next);
      logger.info(`admin switch -> backend=${runtime.backend} zen=${runtime.zenModel} ollama=${runtime.ollamaModel || "-"} openai=${runtime.openaiModel || "-"} @ ${runtime.openaiUrl}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, openaiUrl: runtime.openaiUrl, openaiModel: runtime.openaiModel, ...extra }));
      return;
    }
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      const ids = runtime.backend === "ollama" && runtime.ollamaModel ? [runtime.ollamaModel, ...MODEL_IDS] : MODEL_IDS;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [...new Set(ids)].map((id) => ({ id, object: "model", created: Date.now(), owned_by: runtime.backend })) }));
      return;
    }
    if (req.method !== "POST" || (pathname !== "/v1/messages" && pathname !== "/messages")) {
      throw ApiError.notFound("use POST /v1/messages");
    }
    const body = await readJson(req);
    validateMessagesBody(body);
    // Doc runtime moi request (doi duoc luc dang chay qua /admin/switch).
    const backend = runtime.backend;
    const model = body.model || (backend === "ollama" ? runtime.ollamaModel : runtime.zenModel);
    const log = (m) => logger.info(m);
    log(`HIT ${backend} model=${model} stream=${body.stream !== false} tools=${(body.tools || []).length}`);
    if (backend === "ollama") {
      if (!runtime.ollamaModel) throw ApiError.misconfigured("chua chon model ollama (doi qua /admin/switch hoac env OLLAMA_MODEL)");
      // return await (khong phai return thuong): de rejection chay qua catch ->
      // sendError, neu khong client treo vinh vien + FATAL unhandledRejection.
      return await handleOllama(body, model, res, log);
    }
    if (backend === "openai") {
      return await handleOpenAi(body, model, res, log, { url: runtime.openaiUrl, apiKey: runtime.openaiKey, model: runtime.openaiModel });
    }
    return await handleZen(body, model, assets, res, log);
  } catch (e) {
    sendError(res, e);
  }
});

export function start() {
  // Log loi fatal truoc khi chet de khong bao gio "chet im".
  const fatal = (kind) => (err) => {
    try {
      fs.appendFileSync(path.join(ROOT, "proxy.log"),
        `${new Date().toISOString()} [FATAL] ${kind}: ${String(err?.stack || err).slice(0, 1000)}\n`);
    } catch {}
  };
  process.on("uncaughtException", fatal("uncaughtException"));
  process.on("unhandledRejection", fatal("unhandledRejection"));
  server.listen(PORT, HOST, () => logger.info(`zen-proxy [${runtime.backend}] on http://${HOST}:${PORT}`));
  // Graceful shutdown: dung nhan request moi, doi request dang chay xong (toi da 30s) roi tat.
  let shuttingDown = false;
  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`nhan ${sig}, draining...`);
    server.close(() => {
      logger.info("da tat sach");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("drain qua lau, ep tat");
      process.exit(1);
    }, 30000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}
