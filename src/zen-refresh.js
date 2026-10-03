// zen-refresh.js — tai danh sach model Zen free tu OpenCode, luu vao
// models.json + providers.json. Dung chung cho POST /admin/refresh-zen,
// auto-refresh dinh ky, CLI `refresh zen`.
import fs from "node:fs";
import path from "node:path";
import { ROOT, ZEN_DEFAULT, loadAssets } from "./config.js";
import { handleZen } from "./backends/zen.js";
import { loadProviders, saveProviders } from "./providers/registry.js";
import { parseJsonText } from "./json.js";
import { logger } from "./logger.js";

export const ZEN_CATALOG_URL = "https://models.opencode.ai/api.json";

// Loc model free (cost input+output = 0) tu api.json — pure, co unit test.
export function pickFreeModels(apiJson) {
  const ms = (((apiJson || {}).opencode || {}).models) || {};
  return Object.keys(ms).filter((id) => {
    const c = (ms[id] || {}).cost || {};
    return c.input === 0 && c.output === 0;
  });
}

let _assets = null;
// Ping 1 model Zen bang request that (di dung gate fingerprint) nhung khong
// failover: chi model nay tra loi 200 moi tinh la ok. Re hon e2e nhieu,
// dung de loc so bo model free moi truoc khi dem di e2e.
export async function pingZenModel(model) {
  if (!_assets) _assets = loadAssets();
  const t0 = Date.now();
  const body = {
    model,
    messages: [{ role: "user", content: "reply with exactly: OK" }],
    max_tokens: 8,
    stream: false,
  };
  let status = 0, payload = "";
  const res = {
    writeHead(s) { status = s; },
    end(d) { payload = String(d || ""); },
  };
  try {
    await handleZen(body, model, _assets, res, () => {}, { candidates: [model] });
  } catch (e) {
    return { ok: false, model, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 200) };
  }
  if (status !== 200) return { ok: false, model, ms: Date.now() - t0, error: payload.slice(0, 200) };
  return { ok: true, model, ms: Date.now() - t0 };
}

// Model PASS e2e -> dua vao verified that (models.json + providers.json)
// de dashboard/failover dung ngay, khong can restart (server doc fresh moi request).
// FAIL khong tu loai (co the do 429 nhat thoi) — muon loai thi xoa tay.
// rootDir chi dung cho test (tro sang thu muc tam).
export async function promoteVerifiedModel(model, rootDir = ROOT) {
  const modelsPath = path.join(rootDir, "models.json");
  let catalog = {};
  try { catalog = parseJsonText(fs.readFileSync(modelsPath, "utf8")); } catch {}
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) catalog = {};
  catalog.zen = catalog.zen && typeof catalog.zen === "object" ? catalog.zen : {};
  if (!Array.isArray(catalog.zen.verified)) catalog.zen.verified = [];
  if (!catalog.zen.verified.includes(model)) catalog.zen.verified.push(model);
  fs.writeFileSync(modelsPath, JSON.stringify(catalog, null, 2));
  try {
    const providers = loadProviders();
    if (providers.zen) {
      providers.zen.config.models = catalog.zen.verified;
      saveProviders(providers);
    }
  } catch (e) {
    logger.warn(`promote: khong cap nhat duoc providers.json: ${String(e).slice(0, 150)}`);
  }
  logger.info(`PROMOTED ${model} -> verified (dashboard/failover dung ngay)`);
  return catalog.zen.verified;
}

// Gop catalog cu voi danh sach free moi tai ve — pure, co unit test.
// Nguyen tac: verified CHI chua model da e2e-pass that (test-e2e ghi vao day);
// refresh khong bao gio tu them vao verified, chi loai con nao het free.
export function mergeCatalog(prev, freeModels) {
  const prevZen = (prev && typeof prev === "object" && !Array.isArray(prev) && prev.zen) || {};
  const prevVerified = Array.isArray(prevZen.verified) ? prevZen.verified : [];
  const prevFree = Array.isArray(prevZen.free) ? prevZen.free : prevVerified;
  const verified = prevVerified.filter((m) => freeModels.includes(m));
  const prevDefault = typeof prevZen.default === "string" ? prevZen.default : "";
  const def = freeModels.includes(prevDefault) ? prevDefault
    : verified.includes(ZEN_DEFAULT) ? ZEN_DEFAULT
    : verified[0] || freeModels[0] || "";
  const added = freeModels.filter((m) => !prevFree.includes(m));
  const removed = prevFree.filter((m) => !freeModels.includes(m));
  const responsesModels = Array.isArray(prevZen.responsesModels) ? prevZen.responsesModels : [];
  return { catalog: { default: def, verified, free: freeModels, responsesModels }, added, removed };
}

export async function refreshZenCatalog() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error("timeout")), 20000);
  let r;
  try {
    r = await fetch(ZEN_CATALOG_URL, {
      signal: ctl.signal, headers: { "User-Agent": "zen-claude-proxy" },
    });
  } finally {
    clearTimeout(t);
  }
  if (!r.ok) throw new Error(`OpenCode API status ${r.status}`);
  const freeModels = pickFreeModels(await r.json());
  // Update models.json (giu verified + responsesModels cu)
  const modelsPath = path.join(ROOT, "models.json");
  let prev = {};
  try { prev = parseJsonText(fs.readFileSync(modelsPath, "utf8")); } catch {}
  if (!prev || typeof prev !== "object" || Array.isArray(prev)) prev = {};
  const { catalog, added, removed } = mergeCatalog(prev, freeModels);
  prev.zen = { ...(prev.zen || {}), ...catalog };
  // Ping model free moi de biet con nao gate nhan that (ghi reachable, dashboard
  // van chi hien verified). Model cu ping ok tu truoc thi giu, het free thi rot.
  const prevReachable = Array.isArray(prev.zen.reachable) ? prev.zen.reachable : [];
  const stillReachable = prevReachable.filter((m) => freeModels.includes(m));
  const pingedOk = [];
  const pingedFail = [];
  for (const m of added) {
    logger.info(`ping zen model moi: ${m} ...`);
    const r = await pingZenModel(m);
    if (r.ok) {
      pingedOk.push(m);
      logger.info(`ping ok: ${m} (${r.ms}ms)`);
    } else {
      pingedFail.push(m);
      logger.warn(`ping hong: ${m} (${String(r.error).slice(0, 150)})`);
    }
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  prev.zen.reachable = [...stillReachable.filter((m) => !pingedOk.includes(m)), ...pingedOk];
  fs.writeFileSync(modelsPath, JSON.stringify(prev, null, 2));
  // Update providers.json: chi dua verified (dung duoc that) vao failover + dashboard
  const providers = loadProviders();
  if (providers.zen) {
    providers.zen.config.models = catalog.verified;
    saveProviders(providers);
  }
  logger.info(`refresh-zen: ${freeModels.length} free (${catalog.verified.length} verified, moi +${added.length}, mat -${removed.length}, ping ok +${pingedOk.length})`);
  return { count: freeModels.length, verified: catalog.verified, models: freeModels, added, removed, pingOk: pingedOk, pingFail: pingedFail, reachable: prev.zen.reachable };
}
