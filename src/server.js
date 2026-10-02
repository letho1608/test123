// server.js — HTTP server: routes, validation, graceful shutdown.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PORT, HOST, BACKEND, MODEL_IDS, ZEN_MODEL, ZEN_BASE, OLLAMA_BASE, OLLAMA_MODEL, ROOT, runtime, ZEN_VERIFIED, ZEN_DEFAULT, ZEN_REFRESH_HOURS, OPENAI_URL, persistRuntime } from "./config.js";
import { loadSettings, saveSettings } from "../scripts/lib/settings.js";
import { logger } from "./logger.js";
import { ApiError, validateMessagesBody } from "./errors.js";
import { loadAssets } from "./config.js";
import { parseJsonText } from "./json.js";
import { handleZen } from "./backends/zen.js";
import { handleOllama } from "./backends/ollama.js";
import { handleOpenAi } from "./backends/openai.js";
import { loadProviders, saveProviders, addProvider, updateProvider, removeProvider } from "./providers/registry.js";
import { refreshZenCatalog } from "./zen-refresh.js";

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
  const out = { ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, claudeModel: runtime.claudeModel, node: process.version, time: new Date().toISOString(), checks: {} };
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
  // claude goc bypass proxy -> khong can check upstream, proxy van healthy.
  if (runtime.backend === "claude") out.ok = true;
  else out.ok = runtime.backend === "ollama" ? !!out.checks.ollama?.ok : !!out.checks.zen_models?.ok;
  return out;
}

const DEFAULT_ALIAS = "claude-sonnet-5-5"; // alias Claude gui di, giong switch.js/start.js

// Patch settings.json cua Claude giong hệt switch.js de CLI + web nhat quan:
// zen/ollama/openai -> di qua proxy; claude -> bypass proxy, dung API Anthropic truc tiep.
function applySwitch(b) {
  if (b.backend === "claude") {
    const model = (typeof b.claudeModel === "string" && b.claudeModel.trim()) || "claude-sonnet-5-5";
    const cfg = loadSettings();
    cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
    delete cfg.modelOverrides[DEFAULT_ALIAS]; // dung model that, khong rewrite alias
    cfg.env = { ...(cfg.env || {}) };
    delete cfg.env.ANTHROPIC_BASE_URL; // ve API goc api.anthropic.com
    delete cfg.env.ANTHROPIC_AUTH_TOKEN; // xoa token ollama thua (neu co)
    if (cfg.env.ANTHROPIC_API_KEY === "public") delete cfg.env.ANTHROPIC_API_KEY; // key ao cua proxy -> dung auth that
    cfg.env.ANTHROPIC_MODEL = model;
    saveSettings(cfg);
    return { bypass: true };
  }
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
  if (b.backend === "zen") cfg.modelOverrides[DEFAULT_ALIAS] = b.zenModel;
  else if (b.backend === "ollama") cfg.modelOverrides[DEFAULT_ALIAS] = b.ollamaModel;
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
<style>body{font-family:sans-serif;max-width:720px;margin:24px auto;padding:0 16px}h2{margin:0 0 4px}h3{margin:0 0 8px}.card{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin:16px 0}ul{list-style:none;padding:0;margin:8px 0}li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #eee}li:first-child{border-top:none}li span:first-child{overflow:hidden;text-overflow:ellipsis}button{cursor:pointer;padding:4px 12px;border-radius:6px;border:1px solid #888;background:#f4f4f4;white-space:nowrap}button:hover{background:#e6e6e6}button:disabled{opacity:.5;cursor:default}input{width:100%;box-sizing:border-box;padding:6px;margin:4px 0;border:1px solid #aaa;border-radius:6px}label{font-size:13px;color:#555}.row{display:flex;gap:8px;align-items:center}.muted{color:#666;font-size:13px}#msg{white-space:pre-wrap;background:#f7f7f7;border-radius:6px;padding:8px;min-height:20px;font-size:13px}.cur{font-weight:bold;color:#0a6c2e}.tag{font-size:12px;color:#fff;background:#0a6c2e;border-radius:4px;padding:1px 6px;margin-left:6px}.big{font-size:15px}</style>
</head><body>
<h2>zen-proxy</h2>
<div class="muted">proxy cho Claude Code — <a href="/diag">/diag</a> &middot; <a href="/v1/models">/v1/models</a> &middot; <button id="refresh" type="button">tải lại</button> &middot; <button id="refresh-zen" type="button">cập nhật zen</button></div>
<div id="msg">đang tải...</div>
<div id="status"></div>
<div id="providers"></div>
<div class="card"><h3>OpenAI-compatible tự nhập</h3>
<label>tên (lưu để dùng lại, vd: groq)</label><input id="oai-id" placeholder="groq">
<label>chat-completions URL</label><input id="oai-url" placeholder="https://api.groq.com/openai/v1/chat/completions">
<label>API key</label><input id="oai-key" placeholder="key (trống nếu endpoint không cần)">
<label>models (cách nhau bằng dấu phẩy)</label><input id="oai-model" placeholder="llama-3.3-70b-versatile, mixtral-8x7b-32768">
<div class="row"><button id="oai-save" type="button">lưu &amp; dùng</button><button id="oai-go" type="button">chỉ dùng 1 lần</button></div>
<div class="muted">đã lưu thì hiện ở danh sách trên (nút dùng/xóa), tắt proxy mở lại vẫn còn.</div></div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return r.json();
}
async function del(path) {
  const r = await fetch(path, { method: "DELETE" });
  return r.json();
}
function say(t) { $("msg").textContent = t; }
async function doSwitch(body, label) {
  say("đang đổi sang " + label + "...");
  try {
    const j = await api("/admin/switch", body);
    if (j.ok) { say("Xong: " + (j.provider ? "provider=" + j.provider + " " : "") + "backend=" + j.backend + " (mở session Claude mới để dùng)"); load(); }
    else say("Lỗi: " + (j.error || JSON.stringify(j)).slice(0, 300));
  } catch (e) { say("Lỗi kết nối proxy: " + String(e).slice(0, 200)); }
}
async function load() {
  try {
    const s = await api("/admin/status");
    const curModel = s.backend === "ollama" ? (s.ollamaModel || "-")
      : s.backend === "zen" ? s.zenModel
      : s.backend === "claude" ? (s.claudeModel || "-")
      : (s.openaiModel || "-") + " @ " + (s.openaiUrl || "-");
    const note = s.backend === "claude" ? " (đi thẳng Anthropic, không qua proxy)"
      : s.backend === "ollama" ? " (qua proxy, không đi thẳng nữa)" : "";
    $("status").innerHTML = '<div class="card"><h3>Đang dùng</h3>'
      + '<div class="big"><b>' + esc(s.provider || s.backend) + '</b> · model=' + esc(curModel) + esc(note) + '</div>'
      + '<div class="muted">đổi model bên dưới, mở session Claude mới để dùng</div></div>';
    if ($("msg").textContent === "đang tải...") say("chọn model bên dưới để đổi.");
    const p = await api("/admin/providers");
    const providers = p.providers || [];
    // provider đang dùng lên đầu, rồi built-in, rồi tự thêm (a-z)
    const order = { zen: 0, ollama: 1, claude: 2 };
    providers.sort((a, b) => {
      const ac = s.provider === a.id, bc = s.provider === b.id;
      if (ac !== bc) return ac ? -1 : 1;
      const ao = order[a.id] !== undefined ? order[a.id] : 3;
      const bo = order[b.id] !== undefined ? order[b.id] : 3;
      if (ao !== bo) return ao - bo;
      return a.id < b.id ? -1 : 1;
    });
    let html = "";
    for (const prov of providers) {
      const isCustom = !["zen", "ollama", "claude"].includes(prov.id);
      html += '<div class="card"><h3>' + esc(prov.name) + ' (' + esc(prov.type) + ')' + (isCustom ? ' <button data-del-provider="' + esc(prov.id) + '">xóa</button>' : '') + '</h3>';
      if (prov.type === "ollama") {
        html += '<div id="ollama-models"></div>';
      } else if (prov.type === "zen") {
        const z = await api("/admin/zen-models");
        const zlist = z.verified || [];
        html += zlist.length
          ? '<ul>' + zlist.map((m) =>
            "<li><span>" + esc(m) + (m === z.def ? " (mặc định)" : "") + "</span>"
            + '<button data-zen="' + esc(m) + '">dùng</button></li>').join("") + '</ul>'
          : '<p class="muted">chưa có model verified.</p>';
      } else if (prov.type === "claude") {
        html += '<p class="muted">đi thẳng API Anthropic (không qua proxy, tốn phí theo tài khoản của bạn)</p>';
        html += '<ul>' + (prov.models || []).map((m) =>
          "<li><span>" + esc(m) + "</span>"
          + '<button data-oai-provider="' + esc(prov.id) + '" data-oai-model="' + esc(m) + '">dùng</button></li>').join("") + '</ul>';
      } else {
        const mlist = prov.models || [];
        html += mlist.length
          ? '<ul>' + mlist.map((m) =>
            "<li><span>" + esc(m) + "</span>"
            + '<button data-oai-provider="' + esc(prov.id) + '" data-oai-model="' + esc(m) + '">dùng</button></li>').join("") + '</ul>'
          : '<p class="muted">chưa có model — xóa rồi thêm lại, hoặc sửa models trong providers.json.</p>';
      }
      html += '</div>';
    }
    $("providers").innerHTML = html;
    // Bind zen buttons
    document.querySelectorAll("[data-zen]").forEach((b) => b.onclick = () => doSwitch({ provider: "zen", model: b.dataset.zen }, "zen/" + b.dataset.zen));
    // Bind openai provider buttons
    document.querySelectorAll("[data-oai-provider]").forEach((b) => b.onclick = () => doSwitch({ provider: b.dataset.oaiProvider, model: b.dataset.oaiModel }, b.dataset.oaiProvider + "/" + b.dataset.oaiModel));
    // Bind delete-custom-provider buttons
    document.querySelectorAll("[data-del-provider]").forEach((b) => b.onclick = async () => {
      if (!confirm('Xóa provider "' + b.dataset.delProvider + '"?')) return;
      say("đang xóa " + b.dataset.delProvider + "...");
      try {
        const j = await del("/admin/providers/" + encodeURIComponent(b.dataset.delProvider));
        if (j.ok) { say("Xong: đã xóa " + b.dataset.delProvider); load(); }
        else say("Lỗi: " + (j.error || JSON.stringify(j)).slice(0, 300));
      } catch (e) { say("Lỗi kết nối proxy: " + String(e).slice(0, 200)); }
    });
    // Load ollama models if ollama provider exists
    const ollamaProv = providers.find((p) => p.type === "ollama");
    if (ollamaProv) {
      const o = await api("/admin/ollama-models");
      const ollamaHtml = o.ok
        ? ((o.models || []).map((m) =>
          "<li><span>" + esc(m) + "</span>"
          + '<button data-ollama="' + esc(m) + '">dùng</button></li>').join("") || "<li>ollama chưa có model (chạy ollama pull &lt;model&gt; trước)</li>")
        : "<li>không nối được Ollama (" + esc((o.error || "").slice(0, 120)) + ")</li>";
      const el = $("ollama-models");
      if (el) {
        el.innerHTML = "<ul>" + ollamaHtml + "</ul>";
        document.querySelectorAll("[data-ollama]").forEach((b) => b.onclick = () => doSwitch({ provider: "ollama", model: b.dataset.ollama }, "ollama/" + b.dataset.ollama));
      }
    }
  } catch (e) { say("Lỗi kết nối proxy: " + String(e).slice(0, 200)); }
}
$("refresh").onclick = load;
$("refresh-zen").onclick = async () => {
  say("đang tải danh sách model zen mới...");
  try {
    const j = await api("/admin/refresh-zen", {});
    if (j.ok) {
      say("Xong: " + j.count + " models free" + (j.added && j.added.length ? " (mới: " + j.added.join(", ") + ")" : " (không có model mới)") + " — dùng ngay, không cần restart");
      load();
    }
    else say("Lỗi: " + (j.error || JSON.stringify(j)).slice(0, 300));
  } catch (e) { say("Lỗi kết nối proxy: " + String(e).slice(0, 200)); }
};
$("oai-go").onclick = () => {
  const url = $("oai-url").value.trim(), model = $("oai-model").value.trim().split(",")[0].trim();
  if (!url || !model) { say("Lỗi: nhập đủ URL + model."); return; }
  doSwitch({ backend: "openai", openaiUrl: url, openaiKey: $("oai-key").value, openaiModel: model }, "openai/" + model);
};
$("oai-save").onclick = async () => {
  const id = $("oai-id").value.trim().toLowerCase();
  const url = $("oai-url").value.trim();
  const models = $("oai-model").value.split(",").map((m) => m.trim()).filter(Boolean);
  if (!id || !url || !models.length) { say("Lỗi: nhập đủ tên + URL + models."); return; }
  say("đang lưu " + id + "...");
  try {
    const j = await api("/admin/providers", { id, url, apiKey: $("oai-key").value, models });
    if (!j.ok) { say("Lỗi: " + (j.error || JSON.stringify(j)).slice(0, 300)); return; }
    doSwitch({ provider: id, model: models[0] }, id + "/" + models[0]);
  } catch (e) { say("Lỗi kết nối proxy: " + String(e).slice(0, 200)); }
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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(dashboardPage());
      return;
    }
    if (req.method === "GET" && pathname === "/diag") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await diag(), null, 2));
      return;
    }
    if (req.method === "GET" && (pathname === "/admin/status")) {
      const providers = loadProviders();
      // Find current provider id
      let currentProvider = null;
      if (runtime.backend === "claude") {
        currentProvider = "claude";
      } else {
        for (const [id, p] of Object.entries(providers)) {
          if (p.type === runtime.backend && (p.type !== "openai" || p.config?.url === runtime.openaiUrl)) {
            currentProvider = id;
            break;
          }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        backend: runtime.backend,
        provider: currentProvider,
        zenModel: runtime.zenModel,
        ollamaModel: runtime.ollamaModel,
        openaiUrl: runtime.openaiUrl,
        openaiModel: runtime.openaiModel,
        claudeModel: runtime.claudeModel,
        port: PORT,
        providers: Object.entries(providers).map(([id, p]) => ({
          id, name: p.name, type: p.type, enabled: p.enabled !== false,
        })),
        time: new Date().toISOString(),
      }));
      return;
    }
    if (req.method === "GET" && pathname === "/admin/zen-models") {
      const providers = loadProviders();
      const zenProvider = providers.zen;
      const verified = zenProvider?.config?.models?.length ? zenProvider.config.models : ZEN_VERIFIED;
      let free = [];
      try {
        const f = parseJsonText(fs.readFileSync(path.join(ROOT, "models.json"), "utf8"))?.zen?.free;
        if (Array.isArray(f)) free = f;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, verified, free, def: ZEN_DEFAULT, current: runtime.zenModel }));
      return;
    }
    if (req.method === "GET" && pathname === "/admin/providers") {
      const providers = loadProviders();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        providers: Object.entries(providers).map(([id, p]) => ({
          id, name: p.name, type: p.type, enabled: p.enabled !== false,
          url: p.config?.url || "",
          models: p.config?.models || [],
        })),
      }));
      return;
    }
    // --- Admin: luu (them/moi) 1 OpenAI-compatible provider tu nhap ---
    if (req.method === "POST" && pathname === "/admin/providers") {
      const b = await readJson(req);
      const id = typeof b.id === "string" ? b.id.trim().toLowerCase() : "";
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw ApiError.badRequest("id chi gom chu thuong/so/gach-ngang (vd: groq)");
      if (["zen", "ollama", "claude"].includes(id)) throw ApiError.badRequest(`"${id}" la built-in, khong duoc ghi de`);
      const url = typeof b.url === "string" ? b.url.trim() : "";
      if (!url) throw ApiError.badRequest("thieu chat-completions URL");
      try { new URL(url); } catch { throw ApiError.badRequest("URL khong hop le"); }
      const rawModels = Array.isArray(b.models) ? b.models : typeof b.models === "string" ? b.models.split(",") : [];
      const models = rawModels.map((m) => String(m).trim()).filter(Boolean);
      if (!models.length) throw ApiError.badRequest("can it nhat 1 model");
      const apiKey = typeof (b.apiKey ?? b.key) === "string" ? (b.apiKey ?? b.key) : "";
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : id;
      const providers = loadProviders();
      if (providers[id]) {
        updateProvider(providers, id, { type: "openai", name, enabled: true, config: { url, apiKey, models } });
      } else {
        addProvider(providers, id, { type: "openai", name, url, apiKey, models });
      }
      logger.info(`provider saved: ${id} (${models.length} models @ ${url})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id, name, url, models }));
      return;
    }
    // --- Admin: xoa 1 provider tu them (built-in khong xoa duoc) ---
    if (req.method === "DELETE" && pathname.startsWith("/admin/providers/")) {
      const id = decodeURIComponent(pathname.slice("/admin/providers/".length)).trim().toLowerCase();
      try {
        removeProvider(loadProviders(), id);
      } catch (e) {
        throw ApiError.badRequest(String(e.message || e).slice(0, 200));
      }
      // Neu dang dung provider vua xoa -> ve zen mac dinh de khong treo request
      if (runtime.openaiUrl) {
        const providers = loadProviders();
        const stillThere = Object.values(providers).some((p) => p.config?.url === runtime.openaiUrl);
        if (!stillThere && runtime.backend === "openai") {
          runtime.backend = "zen";
          runtime.openaiUrl = "";
          runtime.openaiKey = "";
          runtime.openaiModel = "";
          persistRuntime();
        }
      }
      logger.info(`provider removed: ${id}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id }));
      return;
    }
    if (req.method === "GET" && pathname === "/admin/ollama-models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      try {
        const providers = loadProviders();
        const ollamaProvider = providers.ollama;
        const ollamaBase = ollamaProvider?.config?.url || OLLAMA_BASE;
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(new Error("timeout")), 10000);
        const r = await fetch(new URL("/api/tags", ollamaBase), { signal: ctl.signal });
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
      // Provider-based switching: { provider: "groq"/"claude"/..., model } -> backend + registry config
      if (b.provider !== undefined) {
        const providers = loadProviders();
        const prov = providers[b.provider];
        if (!prov) throw ApiError.badRequest(`provider "${b.provider}" khong ton tai`);
        if (prov.enabled === false) throw ApiError.badRequest(`provider "${b.provider}" bi disable`);
        const model = b.model || prov.config?.models?.[0];
        if (!model) throw ApiError.badRequest(`provider "${b.provider}" chua co model nao`);
        const next = {
          backend: prov.type === "zen" ? "zen" : prov.type === "ollama" ? "ollama" : prov.type === "claude" ? "claude" : "openai",
          zenModel: runtime.zenModel,
          ollamaModel: runtime.ollamaModel,
          openaiUrl: prov.config?.url || "",
          openaiKey: prov.config?.apiKey || "",
          openaiModel: model,
          claudeModel: runtime.claudeModel,
        };
        if (next.backend === "zen") next.zenModel = model;
        if (next.backend === "ollama") next.ollamaModel = model;
        if (next.backend === "claude") next.claudeModel = model;
        let extra = {};
        if (!b.clientPatched) {
          extra = applySwitch({ backend: next.backend, zenModel: next.zenModel, ollamaModel: next.ollamaModel, openaiUrl: next.openaiUrl, claudeModel: next.claudeModel, alias: b.alias });
        }
        Object.assign(runtime, next);
        persistRuntime();
        logger.info(`admin switch -> provider=${b.provider} backend=${runtime.backend} model=${model}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, provider: b.provider, backend: runtime.backend, model, ...extra }));
        return;
      }
      if (b.backend !== undefined && !["zen", "ollama", "openai", "claude"].includes(b.backend)) {
        throw ApiError.badRequest("backend phai la zen|ollama|openai|claude");
      }
      const next = {
        backend: b.backend || runtime.backend,
        zenModel: runtime.zenModel,
        ollamaModel: runtime.ollamaModel,
        openaiUrl: runtime.openaiUrl,
        openaiKey: runtime.openaiKey,
        openaiModel: runtime.openaiModel,
        claudeModel: runtime.claudeModel,
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
      if (b.claudeModel !== undefined) {
        if (typeof b.claudeModel !== "string" || !b.claudeModel.trim()) throw ApiError.badRequest("claudeModel phai la string khac rong");
        next.claudeModel = b.claudeModel;
      }
      if (next.backend === "claude" && b.backend === "claude" && !b.claudeModel && !next.claudeModel) {
        throw ApiError.badRequest("doi sang claude can claudeModel");
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
        extra = applySwitch({ backend: next.backend, zenModel: next.zenModel, ollamaModel: next.ollamaModel, openaiUrl: next.openaiUrl, claudeModel: next.claudeModel, alias: b.alias });
      }
      Object.assign(runtime, next);
      persistRuntime(); // tat proxy bat lai van giu info cu (dashboard hien dung)
      logger.info(`admin switch -> backend=${runtime.backend} zen=${runtime.zenModel} ollama=${runtime.ollamaModel || "-"} openai=${runtime.openaiModel || "-"} @ ${runtime.openaiUrl} claude=${runtime.claudeModel || "-"}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: runtime.backend, zenModel: runtime.zenModel, ollamaModel: runtime.ollamaModel, openaiUrl: runtime.openaiUrl, openaiModel: runtime.openaiModel, claudeModel: runtime.claudeModel, ...extra }));
      return;
    }
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      const ids = runtime.backend === "ollama" && runtime.ollamaModel ? [runtime.ollamaModel, ...MODEL_IDS] : MODEL_IDS;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [...new Set(ids)].map((id) => ({ id, object: "model", created: Date.now(), owned_by: runtime.backend })) }));
      return;
    }
    // --- Admin: refresh Zen models from OpenCode ---
    if (req.method === "POST" && pathname === "/admin/refresh-zen") {
      try {
        const r = await refreshZenCatalog();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        logger.error(`refresh-zen failed: ${String(e).slice(0, 300)}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }));
      }
      return;
    }
    // --- Admin: reload providers.json + models.json ---
    if (req.method === "POST" && pathname === "/admin/reload") {
      try {
        // Force reload by clearing require cache (for ESM, we just re-read)
        const providers = loadProviders();
        logger.info(`reload: ${Object.keys(providers).length} providers loaded`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, providers: Object.keys(providers) }));
      } catch (e) {
        logger.error(`reload failed: ${String(e).slice(0, 300)}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }));
      }
      return;
    }
    // --- Admin: stop daemon ---
    if (req.method === "POST" && pathname === "/admin/stop") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      logger.info("admin stop requested");
      setTimeout(() => process.exit(0), 100);
      return;
    }
    if (req.method !== "POST" || (pathname !== "/v1/messages" && pathname !== "/messages")) {
      throw ApiError.notFound("use POST /v1/messages");
    }
    const body = await readJson(req);
    validateMessagesBody(body);
    // Doc runtime moi request (doi duoc luc dang chay qua /admin/switch).
    const backend = runtime.backend;
    if (backend === "claude") {
      throw ApiError.misconfigured("dang dung Claude goc (bypass proxy) — request truc tiep api.anthropic.com, khong qua proxy. Doi lai zen/ollama/openai de dung proxy.");
    }
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

  // Watch providers.json + models.json for hot-reload
  const watchFiles = [
    path.join(ROOT, "providers.json"),
    path.join(ROOT, "models.json"),
  ];
  for (const f of watchFiles) {
    try {
      const w = fs.watch(f, (eventType) => {
        if (eventType === "change") {
          logger.info(`hot-reload: ${path.basename(f)} changed`);
          // Reload providers
          try {
            const providers = loadProviders();
            logger.info(`hot-reload: ${Object.keys(providers).length} providers`);
          } catch (e) {
            logger.error(`hot-reload failed: ${String(e).slice(0, 200)}`);
          }
        }
      });
      // unref: khong giu event loop (tranh treo process test khi server.close)
      try { w.unref(); } catch {}
    } catch {}
  }

  // Auto-refresh danh sach model Zen free dinh ky (mac dinh 24h, tat: ZEN_REFRESH_HOURS=0).
  // Chay nen sau boot 60s roi lap lai; that bai thi bo qua, lan sau thu lai.
  if (ZEN_REFRESH_HOURS > 0) {
    logger.info(`auto refresh zen models moi ${ZEN_REFRESH_HOURS}h (tat: ZEN_REFRESH_HOURS=0)`);
    let refreshing = false;
    const autoRefresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const r = await refreshZenCatalog();
        if (r.added.length) logger.info(`zen co model moi: ${r.added.join(", ")}`.slice(0, 300));
      } catch (e) {
        logger.warn(`auto refresh-zen hong (lan sau thu lai): ${String(e).slice(0, 200)}`);
      } finally {
        refreshing = false;
      }
    };
    try { setTimeout(autoRefresh, 60000).unref(); } catch {}
    try { setInterval(autoRefresh, ZEN_REFRESH_HOURS * 3600 * 1000).unref(); } catch {}
  }

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
