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

export const BACKEND = (() => {
  const b = str("BACKEND", "zen").toLowerCase();
  if (!["zen", "ollama"].includes(b)) throw new Error(`BACKEND khong hop le: ${b} (chon zen|ollama)`);
  return b;
})();
export const PORT = num("PORT", 8898);
export const HOST = "127.0.0.1"; // local-only theo thiet ke, khong bind ra ngoai

// --- zen (da reverse tu binary opencode v1.18.21 + traffic that) ---
export const ZEN_BASE = str("ZEN_BASE", "https://opencode.ai/zen/v1").replace(/\/+$/, "");
export const ZEN_MODEL = str("ZEN_MODEL", "muse-spark-1.3-contributor-free");
export const ZEN_UA = "opencode/1.18.21 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14";
export const ZEN_TIMEOUT_MS = num("ZEN_TIMEOUT_MS", 120000);
// Model zen free di Responses API; cac model free con lai di /chat/completions.
export const RESPONSES_MODELS = new Set([
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free",
]);

// --- ollama ---
export const OLLAMA_BASE = str("OLLAMA_BASE", "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
export const OLLAMA_MODEL = str("OLLAMA_MODEL", "");

// --- model hien trong /model picker (alias Claude + zen default) ---
export const MODEL_IDS = [
  ZEN_MODEL,
  "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5",
  "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5",
];

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
  let agentdev = null;
  try { agentdev = loadText("agentdev.txt", 5000, null); } catch {}
  if (!agentdev) {
    // fallback ngan: chi chat text (khong tools) — lay tu title prompt
    const raw = fs.readFileSync(path.join(ROOT, "fp.json"), "utf8");
    const fp = JSON.parse(raw).fingerprint || raw;
    if (fp.length < 100) throw new Error("fp.json khong dung");
    agentdev = fp;
  }
  let decoys = [];
  try { decoys = loadJsonArray("decoy_tools.json"); } catch {}
  let tools42 = [];
  try { tools42 = loadJsonArray("tools42_oai.json"); } catch {}
  return { agentdev, decoys, tools42 };
}
