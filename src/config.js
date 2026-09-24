// config.js — MỌI cấu hình đọc 1 lần ở đây, validate xong mới chạy.
// Không file nào khác được đọc process.env trực tiếp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}
function num(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const _b = str("BACKEND", "zen").toLowerCase();
if (!["zen", "ollama", "openai"].includes(_b)) throw new Error(`BACKEND khong hop le: ${_b} (chon zen|ollama|openai)`);
const BACKEND = _b;
export { BACKEND };
export const PORT = (() => {
  for (const src of [process.env.PORT, process.argv[2]]) {
    const v = Number(src);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 8898;
})();
export const HOST = "127.0.0.1"; // local-only theo thiet ke, khong bind ra ngoai

// --- zen (da reverse tu binary opencode v1.18.21 + traffic that) ---
export const ZEN_BASE = str("ZEN_BASE", "https://opencode.ai/zen/v1").replace(/\/+$/, "");
export const ZEN_MODEL = str("ZEN_MODEL", "muse-spark-1.3-contributor-free");
export const ZEN_UA = "opencode/1.18.21 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14";
export const ZEN_TIMEOUT_MS = num("ZEN_TIMEOUT_MS", 120000);
// Model zen free di Responses API; cac model free con lai di /chat/completions.
function loadModelsJson() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "models.json"), "utf8"));
    return j.zen || {};
  } catch { return {}; }
}
const ZEN_CATALOG = loadModelsJson();
export const RESPONSES_MODELS = new Set(
  ZEN_CATALOG.responsesModels || [
    "muse-spark-1.3-contributor-free",
    "muse-spark-1.2-contributor-free",
  ]
);
// Thu tu failover: model dang chon truoc, roi cac model verified con lai.
export const ZEN_VERIFIED = ZEN_CATALOG.verified || [...RESPONSES_MODELS];
export const ZEN_DEFAULT = ZEN_CATALOG.default || "muse-spark-1.3-contributor-free";

// --- ollama ---
export const OLLAMA_BASE = str("OLLAMA_BASE", "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
export const OLLAMA_MODEL = str("OLLAMA_MODEL", "");

// --- openai-compatible generic (Groq/Cerebras/NVIDIA/OpenRouter/HF... tu nhap) ---
// OPENAI_URL la FULL chat-completions URL (vd https://api.groq.com/openai/v1/chat/completions).
// Khong co mac dinh: phai nhap URL + model (web dashboard, switch.js, hoac start.js muc 3).
export const OPENAI_URL = str("OPENAI_URL", "");
export const OPENAI_KEY = str("OPENAI_KEY", "");
export const OPENAI_MODEL = str("OPENAI_MODEL", "");

// --- model hien trong /model picker (alias Claude + zen default) ---
export const MODEL_IDS = [
  ZEN_MODEL,
  "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5",
  "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5",
];

// Runtime co the doi luc dang chay qua POST /admin/switch (khong can restart).
// Khoi tao tu env, chi doi qua endpoint admin (localhost-only).
export const runtime = {
  backend: BACKEND,
  zenModel: ZEN_MODEL,
  ollamaModel: OLLAMA_MODEL,
  openaiUrl: OPENAI_URL,
  openaiKey: OPENAI_KEY,
  openaiModel: OPENAI_MODEL,
};

// Luu/khoi phuc runtime vao file local (rieng may, gitignored) de tat proxy
// bat lai van giu backend/model cu (dashboard hien dung info cu).
// RUNTIME_FILE chi dung cho test (tro sang file tam).
// loadRuntime() goi TUONG MINH luc boot (proxy.mjs) / setup test, khong tu chay
// luc import de unit test khong doc nham file local cua may dev.
function runtimeFile() {
  return process.env.RUNTIME_FILE || path.join(ROOT, "runtime.local.json");
}
export function loadRuntime() {
  try {
    const saved = JSON.parse(fs.readFileSync(runtimeFile(), "utf8"));
    if (!saved || typeof saved !== "object") return;
    // Env truyen vao luc start (menu start.js / systemd) uu tien hon file cu.
    const hasEnv = (n) => process.env[n] !== undefined && process.env[n] !== "";
    if (["zen", "ollama", "openai"].includes(saved.backend) && !hasEnv("BACKEND")) {
      runtime.backend = saved.backend;
    }
    for (const [k, env] of [["zenModel", "ZEN_MODEL"], ["ollamaModel", "OLLAMA_MODEL"], ["openaiUrl", "OPENAI_URL"], ["openaiKey", "OPENAI_KEY"], ["openaiModel", "OPENAI_MODEL"]]) {
      if (typeof saved[k] === "string" && saved[k] && !hasEnv(env)) runtime[k] = saved[k];
    }
  } catch { /* chua co file -> dung env/mac dinh */ }
}
export function persistRuntime() {
  try { fs.writeFileSync(runtimeFile(), JSON.stringify(runtime, null, 2)); } catch {}
}

// --- ID time-ordered cua opencode (dao nguoc tu DB + traffic):
// ses_  = (T_SES - epoch_ms) * 4096 + 0xffe + 14 ky tu base62
// msg_  = (epoch_ms - M_MSG) * 4096 + 0x001 + 14 ky tu base62
// Server Zen chi chap nhan ID "tuoi" + dung marker -> proxy tu mint moi request.
export const T_SES = 1855425871850;
export const M_MSG = 1786706395100;

// --- assets (prompt/tools mau de vuot free-tier gate) ---
function loadText(rel, minLen, required) {
  const p = path.join(ROOT, rel);
  const t = fs.readFileSync(p, "utf8");
  if (t.length < minLen) throw new Error(`${rel} qua ngan (${t.length} chars), file co dung khong?`);
  if (required && !t.includes(required)) throw new Error(`${rel} thieu marker "${required}"`);
  return t;
}
function loadJsonArray(rel) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  if (!Array.isArray(d) || !d.length) throw new Error(`${rel} phai la array khong rong`);
  return d;
}
export function loadAssets() {
  // Du lieu fingerprint nam trong assets/ (khong de lung tung o root).
  let agentdev = null;
  try { agentdev = loadText("assets/agentdev.txt", 5000, null); } catch {}
  if (!agentdev) {
    // fallback ngan: chi chat text (khong tools) — lay tu title prompt
    const raw = fs.readFileSync(path.join(ROOT, "assets", "fp.json"), "utf8");
    const fp = JSON.parse(raw).fingerprint || raw;
    if (fp.length < 100) throw new Error("assets/fp.json khong dung");
    agentdev = fp;
  }
  let decoys = [];
  try { decoys = loadJsonArray("assets/decoy_tools.json"); } catch {}
  return { agentdev, decoys };
}
