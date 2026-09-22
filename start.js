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
// stdin pipe (khong phai terminal, vd test tu dong): doc het len truoc roi tra loi tuan tu.
// readline + pipe tren Windows chi doc duoc dong dau.
let pipedLines = null;
if (!process.stdin.isTTY) {
  try { pipedLines = fs.readFileSync(0, "utf8").split(/\r?\n/); } catch { pipedLines = []; }
}
const ask = (q) => {
  if (pipedLines) {
    process.stdout.write(q);
    const a = (pipedLines.shift() ?? "").trim();
    process.stdout.write(a + "\n");
    return Promise.resolve(a);
  }
  return new Promise((r) => rl.question(q, (a) => r(a.trim())));
};

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8")); } catch { return {}; }
}
function saveSettings(cfg) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2));
}

function claudeEnvLines(baseUrl, model, authToken) {
  if (IS_WIN) {
    const lines = [
      `$env:ANTHROPIC_BASE_URL = "${baseUrl}"`,
      `$env:ANTHROPIC_API_KEY = "public"`,
      `$env:ANTHROPIC_MODEL = "${model}"`,
    ];
    if (authToken) lines.splice(2, 0, `$env:ANTHROPIC_AUTH_TOKEN = "${authToken}"`);
    lines.push(`claude`);
    return lines;
  }
  const auth = authToken ? ` ANTHROPIC_AUTH_TOKEN=${authToken}` : "";
  return [
    `export ANTHROPIC_BASE_URL=${baseUrl}${auth} ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=${model}`,
    `claude`,
  ];
}

function ollamaModels() {
  // stdio[0]=ignore: khong de ollama nut stdin cua menu
  const r = spawnSync("ollama", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((n) => n && n !== "NAME");
}

// model free da verify e2e qua proxy (chat + stream + tools)
// Mac dinh cung (phong khi chua chay test-e2e.js); neu co verified.json thi lay theo ket qua that.
const HARDCODED_VERIFIED = [
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "mimo-v2.6-flash-free",
  "mimo-v2.5-free",
  "big-pickle",
  "ling-3.0-flash-fin-free",
];
const DEFAULT_ZEN = HARDCODED_VERIFIED[0];
function verifiedSet() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(HERE, "verified.json"), "utf8"));
    const ok = Object.entries(s.results || {}).filter(([, r]) => r && r.ok).map(([m]) => m);
    if (ok.length) return { set: ok, at: s.updated };
  } catch {}
  return { set: [...HARDCODED_VERIFIED], at: null };
}
const VERIFIED_ZEN = HARDCODED_VERIFIED;
async function zenModels() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch("https://models.opencode.ai/api.json", {
      signal: ctl.signal, headers: { "User-Agent": "zen-claude-proxy" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const ms = (((j || {}).opencode || {}).models) || {};
    const ids = Object.keys(ms).filter((id) => {
      const c = (ms[id] || {}).cost || {};
      return c.input === 0 && c.output === 0; // chi list model free
    });
    if (!ids.includes(VERIFIED_ZEN) && ms[VERIFIED_ZEN]) ids.unshift(VERIFIED_ZEN);
    return ids.length ? ids : null;
  } catch { return null; }
}

async function main() {
  console.log("== chon backend cho Claude Code (khong proxy neu duoc) ==");
  console.log("1. Ollama TRUC TIEP (khong proxy) - can ollama + model da pull");
  console.log("2. OpenCode Zen free tier (qua proxy localhost)");
  console.log("3. Exit");
  const pick = await ask("chon [1/2/3]: ");
  if (pick === "3") { rl.close(); return; }

  if (pick === "1") {
    // Ollama noi native /v1/messages tu v0.14 -> di thang, khong can proxy.
    // Claude Code chi gui ten model di (bat dau bang claude-), nen cp model sang ten do.
    const models = ollamaModels();
    if (!models) { console.error("khong chay duoc `ollama list` (chua cai ollama hoac chua start?)"); rl.close(); process.exitCode = 1; return; }
    if (!models.length) { console.error("ollama chua co model nao (`ollama pull <model>` truoc)"); rl.close(); process.exitCode = 1; return; }
    console.log("model ollama:");
    models.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    const n = Number(await ask(`chon model [1-${models.length}] (mac dinh 1): `) || "1");
    const src = models[n - 1] || models[0];
    const alias = (await ask("alias Claude de dung [claude-haiku-4-5]: ")) || "claude-haiku-4-5";
    console.log(`copy ollama: ${src} -> ${alias} ...`);
    const cp = spawnSync("ollama", ["cp", src, alias], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (cp.status !== 0) { console.error("ollama cp that bai:", (cp.stderr || "").slice(0, 300)); rl.close(); process.exitCode = 1; return; }
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
    console.log(`da patch ${CLAUDE_SETTINGS} (di thang ollama, khong proxy)`);
    rl.close();
    console.log("\nXONG. Mo terminal khac chay:\n  " + claudeEnvLines("http://127.0.0.1:11434", alias, "ollama").join("\n  ") + "\n");
    console.log("(settings.json da co san env, thuong mo `claude` la chay, khoi export.)");
    return;
  }

  if (pick !== "2") { rl.close(); return; }
  // --- backend zen: BAT BUOC qua proxy (free tier gate chi pass request dang opencode) ---
  let models = await zenModels();
  const { set: verified, at: verifiedAt } = verifiedSet();
  if (verifiedAt) console.log(`(tag verified lay tu test-e2e ngay ${verifiedAt.slice(0, 10)})`);
  if (!models) {
    console.log("khong lay duoc list model zen (mang?), dung mac dinh:", DEFAULT_ZEN);
    models = [...verified];
  } else {
    // verified len truoc
    models = [...verified.filter((m) => models.includes(m)),
      ...models.filter((m) => !verified.includes(m))];
    console.log("model zen free:");
    models.forEach((m, i) => console.log(`  ${i + 1}. ${m}${verified.includes(m) ? "  (verified)" : ""}`));
  }
  const n = Number(await ask(`chon model [1-${models.length}] (mac dinh 1): `) || "0");
  const target = (n >= 1 && models[n - 1]) ? models[n - 1] : DEFAULT_ZEN;
  if (!verified.includes(target)) {
    console.log(`Luu y: model nay chua verify e2e qua proxy - chay 'node test-e2e.js ${target}' de kiem, hoac chon model (verified).`);
  }
  const cfg = loadSettings();
  cfg.modelOverrides = { ...(cfg.modelOverrides || {}), [ALIAS]: target };
  cfg.env = {
    ...(cfg.env || {}),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_API_KEY: "public",
    ANTHROPIC_MODEL: ALIAS,
  };
  saveSettings(cfg);
  console.log(`da patch ${CLAUDE_SETTINGS} (modelOverrides.${ALIAS} -> ${target} + env ANTHROPIC_*)`);
  rl.close();
  // preflight: port da co proxy minh chay san thi dung lai, khoi spawn chong
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    const j = await r.json();
    if (r.ok && j && j.object === "list") {
      console.log(`\nproxy da chay san o port ${PORT} -> dung lai, khoi start moi.`);
      console.log(`Mo terminal khac chay claude (settings.json da co san env).`);
      return;
    }
  } catch {}
  const env = { ...process.env, PORT: String(PORT), BACKEND: "zen", ZEN_MODEL: target };
  console.log(`\nbackend=zen model=${target}\nneu muon go tay thay vi dung settings:\n  ` + claudeEnvLines(`http://127.0.0.1:${PORT}`, ALIAS).join("\n  ") + "\n");
  const p = spawn(process.execPath, [path.join(HERE, "proxy.mjs")], { env, stdio: "inherit" });
  // doi proxy ready roi moi bao user chay claude (tranh Connection refused do start chua xong)
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
      if (r.ok) { ready = true; break; }
    } catch {}
  }
  if (ready) console.log(`\nproxy READY o http://127.0.0.1:${PORT} -> gio mo terminal khac chay claude.`);
  else console.log(`\nCANH BAO: proxy chua nghe sau 15s (port ${PORT} bi chiem? loi start?). Kiem tra log o tren.`);
  p.on("exit", (c) => process.exit(c ?? 0));
}
main();
