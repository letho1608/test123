// switch.js — doi backend/model luc DANG CHAY, khong can restart proxy.
//   node switch.js status
//   node switch.js zen [model-zen]        (vd: node switch.js zen big-pickle)
//   node switch.js ollama <model-ollama> [alias-claude]
// Hai viec: (1) patch settings.json cua Claude, (2) POST /admin/switch cho proxy dang chay.
import { spawnSync } from "node:child_process";
import { claudeSettingsPath, loadSettings, saveSettings } from "./scripts/lib/settings.js";

const PORT = Number(process.env.PORT || 8898);
const BASE = `http://127.0.0.1:${PORT}`;
const ALIAS = "claude-sonnet-4-6";

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
    console.error("proxy khong chay o port", PORT, "(mo bang node start.js truoc)");
    process.exitCode = 1;
  }
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
    const s = await post("/admin/switch", { backend: "zen", zenModel: model });
    console.log("proxy:", JSON.stringify(s.json));
  } catch {
    console.log("proxy chua chay (mo bang node start.js chon 2) - settings da luu, mo proxy la dung ngay.");
  }
}

async function cmdOllama(model, alias) {
  alias = alias || "claude-sonnet-4-6";
  if (!model) {
    console.error("thieu ten model: node switch.js ollama <model-ollama> [alias]");
    process.exitCode = 1;
    return;
  }
  console.log(`copy ollama: ${model} -> ${alias} ...`);
  const cp = spawnSync("ollama", ["cp", model, alias], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (cp.status !== 0) {
    console.error("ollama cp that bai:", (cp.stderr || "").slice(0, 300));
    process.exitCode = 1;
    return;
  }
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
  delete cfg.modelOverrides[alias];
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: "http://127.0.0.1:11434",
    ANTHROPIC_AUTH_TOKEN: "ollama",
    ANTHROPIC_API_KEY: "ollama",
    ANTHROPIC_MODEL: alias,
  };
  const p = saveSettings(cfg);
  console.log(`da patch ${p} -> ollama truc tiep ${model} (alias ${alias}), khong can proxy.`);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "status") return cmdStatus();
  if (cmd === "zen") return cmdZen(a || "muse-spark-1.3-contributor-free");
  if (cmd === "ollama") return cmdOllama(a, b);
  console.log([
    "dung: node switch.js <lenh>",
    "  status                  xem backend/model proxy dang dung",
    "  zen [model-zen]         doi sang Zen (can proxy dang chay; tu patch settings)",
    "  ollama <model> [alias]  doi sang Ollama truc tiep (ollama cp + patch settings)",
  ].join("\n"));
}
main();
