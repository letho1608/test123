// start.js — menu khoi dong proxy (Windows + Ubuntu, chi can Node >= 18)
//   1: backend Ollama (chon model trong `ollama list`)
//   2: backend opencode zen (free tier)
//   3: exit
// Tu patch ~/.claude/settings.json (merge modelOverrides, giu cac key khac).
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8898);
const IS_WIN = process.platform === "win32";
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const ALIAS = "claude-sonnet-4-5"; // model name dung trong Claude Code (da verify)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

function patchClaudeSettings(targetModelId) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8")); } catch {}
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}), [ALIAS]: targetModelId };
  // nhung env vao settings de mo claude khong can export tay (tranh loi "Not logged in")
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: ALIAS,
  };
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2));
  console.log(`da patch ${CLAUDE_SETTINGS} (modelOverrides.${ALIAS} -> ${targetModelId} + env ANTHROPIC_*)`);
}

function ollamaModels() {
  const r = spawnSync("ollama", ["list"], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((n) => n && n !== "NAME");
}

function claudeEnvLines() {
  if (IS_WIN) {
    return [
      `$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:${PORT}"`,
      `$env:ANTHROPIC_API_KEY = "public"`,
      `$env:ANTHROPIC_MODEL = "${ALIAS}"`,
      `claude`,
    ];
  }
  return [
    `export ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=${ALIAS}`,
    `claude`,
  ];
}

async function main() {
  console.log("== zen-claude-proxy ==");
  console.log("1. Ollama (model da cai tren may)");
  console.log("2. OpenCode Zen free tier (muse-spark-1.3-contributor-free)");
  console.log("3. Exit");
  const pick = await ask("chon [1/2/3]: ");
  if (pick === "3") { rl.close(); return; }

  let env = { ...process.env, PORT: String(PORT) };
  let target;
  if (pick === "1") {
    const models = ollamaModels();
    if (!models) { console.error("khong chay duoc `ollama list` (chua cai ollama hoac chua start?)"); rl.close(); process.exitCode = 1; return; }
    if (!models.length) { console.error("ollama chua co model nao (`ollama pull <model>` truoc)"); rl.close(); process.exitCode = 1; return; }
    console.log("model ollama:");
    models.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    const n = Number(await ask(`chon [1-${models.length}] (mac dinh 1): `) || "1");
    target = models[n - 1] || models[0];
    env.BACKEND = "ollama";
    env.OLLAMA_MODEL = target;
    env.OLLAMA_BASE = process.env.OLLAMA_BASE || "http://127.0.0.1:11434/v1";
  } else if (pick === "2") {
    target = "muse-spark-1.3-contributor-free";
    env.BACKEND = "zen";
  } else { rl.close(); return; }

  patchClaudeSettings(target);
  rl.close();
  console.log(`\nbackend=${env.BACKEND} model=${target}\nchay Claude Code terminal khac:\n  ` + claudeEnvLines().join("\n  ") + "\n");
  const p = spawn(process.execPath, [path.join(HERE, "proxy.mjs")], { env, stdio: "inherit" });
  p.on("exit", (c) => process.exit(c ?? 0));
}
main();
