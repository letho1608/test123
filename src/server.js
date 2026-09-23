// server.js — HTTP server: routes, validation, graceful shutdown.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, HOST, BACKEND, MODEL_IDS, ZEN_MODEL, ZEN_BASE, OLLAMA_BASE, OLLAMA_MODEL, ROOT, runtime, ZEN_VERIFIED } from "./config.js";
import { logger } from "./logger.js";
import { ApiError, validateMessagesBody } from "./errors.js";
import { loadAssets } from "./config.js";
import { handleZen } from "./backends/zen.js";
import { handleOllama } from "./backends/ollama.js";

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

function statusPage() {
  const b = runtime.backend;
  const model = b === "ollama" ? runtime.ollamaModel : runtime.zenModel;
  const where = b === "ollama" ? `${model} @ ${OLLAMA_BASE}` : `${model} @ ${ZEN_BASE}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>zen-backend plugin</title></head><body style="font-family:sans-serif;max-width:640px;margin:40px auto">`
    + `<h2>zen-backend plugin dang chay</h2>`
    + `<p>backend: <b>${b}</b> (${where})</p>`
    + `<p>Day la API cho Claude Code (<code>POST /v1/messages</code>), khong phai trang web.</p>`
    + `<p>Chay Claude Code terminal khac voi:<br><code>ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=claude-sonnet-4-5</code></p>`
    + `<p><a href="/diag">/diag</a> - chuan doan mang &amp; backend &middot; <a href="/v1/models">/v1/models</a></p>`
    + `</body></html>`;
}

const server = http.createServer(async (req, res) => {
  let pathname = req.url || "/";
  try { pathname = new URL(req.url, "http://127.0.0.1").pathname; } catch {}
  try {
    if (req.method === "HEAD") { res.writeHead(200); res.end(); return; }
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(statusPage());
      return;
    }
    if (req.method === "GET" && pathname === "/diag") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await diag(), null, 2));
      return;
    }
    if (req.method === "GET" && (pathname === "/admin/status")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, port: PORT, time: new Date().toISOString() }));
      return;
    }
    if (req.method === "POST" && pathname === "/admin/switch") {
      // Doi backend/model luc dang chay, khong can restart. Chi nghe localhost.
      const b = await readJson(req);
      if (b.backend !== undefined) {
        if (!["zen", "ollama"].includes(b.backend)) throw ApiError.badRequest("backend phai la zen|ollama");
        runtime.backend = b.backend;
      }
      if (b.zenModel !== undefined) {
        if (typeof b.zenModel !== "string" || !b.zenModel) throw ApiError.badRequest("zenModel phai la string khac rong");
        runtime.zenModel = b.zenModel;
      }
      if (b.ollamaModel !== undefined) {
        if (typeof b.ollamaModel !== "string" || !b.ollamaModel) throw ApiError.badRequest("ollamaModel phai la string khac rong");
        runtime.ollamaModel = b.ollamaModel;
      }
      logger.info(`admin switch -> backend=${runtime.backend} zen=${runtime.zenModel} ollama=${runtime.ollamaModel || "-"}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel }));
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
      return handleOllama(body, model, res, log);
    }
    return handleZen(body, model, assets, res, log);
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
  server.listen(PORT, HOST, () => logger.info(`zen-backend plugin [${runtime.backend}] on http://${HOST}:${PORT}`));
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
