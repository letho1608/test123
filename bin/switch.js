// switch.js — doi backend/model luc DANG CHAY, khong can restart proxy.
//   npm run switch -- status     (in trang thai + tu mo web dashboard chon model)
//   npm run switch -- local [model-opencode]  (vd: npm run switch -- local 9router/ag/x)
//   npm run switch -- zen [model-zen]        (vd: npm run switch -- zen big-pickle)
//   npm run switch -- openai <url> [key] <model>
// Web dashboard cung lam duoc het: mo http://127.0.0.1:8898/ (xem port thuc te o duoi).
// Hai viec: (1) patch settings.json cua Claude, (2) POST /admin/switch cho proxy dang chay.
import { exec } from "node:child_process";
import { claudeSettingsPath, loadSettings, saveSettings } from "../scripts/lib/settings.js";

const PORT = Number(process.env.PORT || 8898);
const BASE = `http://127.0.0.1:${PORT}`;
const ALIAS = "claude-sonnet-5-5";

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function cmdStatus() {
  try {
    const s = await get("/admin/status");
    console.log(JSON.stringify(s.json, null, 2));
  } catch (e) {
    console.error("proxy khong chay o port", PORT, "(mo bang npm start truoc)");
    process.exitCode = 1;
    return;
  }
  console.log(`dashboard chon model: ${BASE}/`);
  const url = `${BASE}/`;
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function cmdZen(model) {
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}), [ALIAS]: model };
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: ALIAS,
  };
  const p = saveSettings(cfg);
  console.log(`da patch ${p} -> zen/${model}`);
  try {
    const s = await post("/admin/switch", { backend: "zen", zenModel: model, clientPatched: true });
    console.log("proxy:", JSON.stringify(s.json));
  } catch {
    console.log("proxy chua chay (mo bang npm start, chon 2) - settings da luu, mo proxy la dung ngay.");
  }
}

async function cmdLocal(model) {
  // Trong = freetier mac dinh (khong dung 9router/opencode.json cua may).
  const m = (model && model.trim()) || "opencode/muse-spark-1.3-contributor-free";
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
  cfg.modelOverrides[ALIAS] = m;
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: ALIAS,
  };
  const p = saveSettings(cfg);
  console.log(`da patch ${p} -> opencode CLI local (model ${m})`);
  try {
    const s = await post("/admin/switch", { provider: "local", model: m, clientPatched: true });
    console.log("proxy:", JSON.stringify(s.json));
  } catch {
    console.log("proxy chua chay (mo bang npm start) - settings da luu, mo proxy la dung ngay.");
  }
}

async function cmdOpenAi(url, key, model) {
  if (!url || !model) {
    console.error("thieu URL/model: npm run switch -- openai <chat-completions-URL> [key] <model>");
    process.exitCode = 1;
    return;
  }
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
  delete cfg.modelOverrides[ALIAS];
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: ALIAS,
  };
  const p = saveSettings(cfg);
  console.log(`da patch ${p} -> openai-compatible ${model} @ ${url}`);
  try {
    const s = await post("/admin/switch", { backend: "openai", openaiUrl: url, openaiKey: key || "", openaiModel: model, clientPatched: true });
    console.log("proxy:", JSON.stringify(s.json));
  } catch {
    console.log("proxy chua chay (mo bang npm start, chon 3) - settings da luu, mo proxy la dung ngay.");
  }
}

async function main() {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd === "status") return cmdStatus();
  if (cmd === "local") return cmdLocal(a || "");
  if (cmd === "zen") return cmdZen(a || "muse-spark-1.3-contributor-free");
  if (cmd === "openai") return cmdOpenAi(a, b, c);
  console.log([
    "dung: npm run switch -- <lenh>   (lenh status tu mo web dashboard)",
    "  status                       xem backend/model proxy dang dung + mo web",
    "  local [model-opencode]       doi sang opencode CLI local (trong = freetier muse-spark)",
    "  zen [model-zen]              doi sang Zen (can proxy dang chay; tu patch settings)",
    "  openai <url> [key] <model>   doi sang OpenAI-compat tu nhap (bat buoc URL + model)",
  ].join("\n"));
}
main();
