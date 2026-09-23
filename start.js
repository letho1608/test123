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
import { claudeSettingsPath, loadSettings, saveSettings } from "./scripts/lib/settings.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8898);
const IS_WIN = process.platform === "win32";
const CLAUDE_SETTINGS = claudeSettingsPath();
const ALIAS = "claude-sonnet-4-6"; // alias doi cao, ollama cp sang ten nay de nhin thay

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
  // stdin dong giua chung (EOF/khong TTY) -> readline tu close -> tra rong thay vi crash
  if (rl.closed) return Promise.resolve("");
  return new Promise((r) => {
    try {
      rl.question(q, (a) => r((a ?? "").trim()));
    } catch {
      r("");
    }
  });
};

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

// Cai systemd user service de chay nen (chi Linux, can systemctl).
// Tra ve true neu da cai (khong can chay foreground nua).
// Mang cong ty hay bat proxy he thong (HTTP_PROXY...). Dam bao traffic ve
// proxy localhost KHONG di vong qua proxy cong ty (se hong), bang cach
// them 127.0.0.1/localhost vao NO_PROXY neu thieu.
function ensureLocalhostBypass() {
  const hasProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    || process.env.https_proxy || process.env.http_proxy;
  if (!hasProxy) return;
  for (const k of ["NO_PROXY", "no_proxy"]) {
    const cur = process.env[k] || "";
    const parts = cur.split(",").map((s) => s.trim()).filter(Boolean);
    for (const need of ["127.0.0.1", "localhost"]) {
      if (!parts.includes(need)) parts.push(need);
    }
    process.env[k] = parts.join(",");
  }
  // Node >= 22 moi biet doc proxy env cho fetch(); bat len de request ra Zen di dung cua kiem soat.
  // (Node cu hon thi bien nay vo dung nhung vo hai.)
  if (!process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = "1";
  console.log("(phat hien proxy cong ty: giu localhost di thang + bat NODE_USE_ENV_PROXY cho request ra Zen)");
}

// Tu dong git pull (fast-forward) khi co ban moi tren remote. Khong mang thi bo qua im lang.
async function autoUpdate() {
  const git = (args, timeout = 20000) => {
    try {
      return spawnSync("git", args, { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });
    } catch { return null; }
  };
  try {
    if (!fs.existsSync(path.join(HERE, ".git"))) return;
    const dirty = git(["status", "--porcelain"]);
    const dirtyFiles = ((dirty && dirty.stdout) || "").trim();
    if (dirtyFiles) {
      // Cay ban (vd test-e2e vua ghi verified.json) -> pull se loi.
      // verified.local.json da gitignored nen test moi khong gay ra chuyen nay nua.
      console.log("working tree dang ban, bo qua auto-pull. Muon update tay:");
      console.log("  git stash push -m backup && git pull --ff-only && git stash pop");
      console.log("  (khong can giu thay doi thi: git checkout -- . && git pull --ff-only)");
      return;
    }
    const fetch = git(["fetch", "origin", "--quiet"]);
    if (!fetch || fetch.status !== 0) return; // khong mang / khong remote
    const behind = git(["rev-list", "--count", "HEAD..@{u}"]);
    const n = Number((behind && behind.stdout || "").trim());
    if (!Number.isFinite(n) || n <= 0) return;
    console.log(`co ${n} commit moi tren remote, dang pull...`);
    const pull = git(["pull", "--ff-only", "--quiet"], 60000);
    if (pull && pull.status === 0) console.log("da cap nhat code moi nhat, chay tiep.");
    else console.log("pull that bai (co sua local chua commit?), giu code hien tai va chay tiep.");
  } catch { /* offline -> chay tiep binh thuong */ }
}

async function setupSystemd(envExtra) {
  const hasCtl = spawnSync("systemctl", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  if (hasCtl.error || hasCtl.status !== 0) {
    console.log("(khong thay systemctl -> bo qua cai service, chay foreground nhu cu)");
    return false;
  }
  const ans = (await ask("Cai systemd service chay nen luon (khoi giu terminal)? [y/N]: ")).toLowerCase();
  if (ans !== "y" && ans !== "yes") return false;
  const sysd = path.join(os.homedir(), ".config", "systemd", "user");
  fs.mkdirSync(sysd, { recursive: true });
  const envLines = Object.entries({ PORT: String(PORT), ...envExtra })
    .map(([k, v]) => `Environment=${k}=${v}`).join("\n");
  const svc = `[Unit]\nDescription=zen-backend plugin (Claude Code backend)\nAfter=network-online.target\nWants=network-online.target\n\n`
    + `[Service]\nType=simple\nWorkingDirectory=${HERE}\n`
    + `ExecStartPre=-/usr/bin/git -C ${HERE} pull --ff-only --quiet\n`
    + `ExecStart=${process.execPath} ${path.join(HERE, "plugin.mjs")}\n${envLines}\n`
    + `Restart=on-failure\nRestartSec=5\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=default.target\n`;
  fs.writeFileSync(path.join(sysd, "zen-backend.service"), svc);
  for (const f of ["zen-claude-healthcheck.service", "zen-claude-healthcheck.timer"]) {
    try { fs.copyFileSync(path.join(HERE, "deploy", f), path.join(sysd, f)); } catch {}
  }
  const run = (args) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run(["daemon-reload"]);
  const en = run(["enable", "--now", "zen-backend"]);
  if (en.status !== 0) {
    console.error("enable service that bai:", (en.stderr || "").slice(0, 300));
    console.log("lam tay theo INSTALL-UBUNTU.txt muc 7.");
    return false;
  }
  run(["enable", "--now", "zen-claude-healthcheck.timer"]);
  const st = run(["is-active", "zen-backend"]);
  console.log(`\nservice zen-backend: ${(st.stdout || "").trim() || "unknown"}`);
  console.log(`xem log: journalctl --user -u zen-backend -f`);
  console.log(`tat: systemctl --user stop zen-backend`);
  return true;
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
const DEFAULT_ZEN = catalogZen().def;
// verified.local.json (ket qua test-e2e tren chinh may nay) uu tien nhat,
// roi den verified.json (ket qua chung trong repo), cuoi cung la hardcode.
function verifiedSet() {
  for (const f of ["verified.local.json", "verified.json"]) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));
      const ok = Object.entries(s.results || {}).filter(([, r]) => r && r.ok).map(([m]) => m);
      if (ok.length) return { set: ok, at: s.updated, from: f };
    } catch {}
  }
  return { set: catalogZen().verified, at: null, from: "hardcode" };
}
// Danh sach model mac dinh doc tu models.json (1 nguon duy nhat cho ca repo).
function catalogZen() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, "models.json"), "utf8"));
    if (j?.zen?.verified?.length) {
      return { verified: j.zen.verified, def: j.zen.default || j.zen.verified[0] };
    }
  } catch {}
  return { verified: [...HARDCODED_VERIFIED], def: HARDCODED_VERIFIED[0] };
}
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
    const { def } = catalogZen();
    if (!ids.includes(def) && ms[def]) ids.unshift(def);
    return ids.length ? ids : null;
  } catch { return null; }
}

async function waitReady(port, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

async function main() {
  await autoUpdate();
  ensureLocalhostBypass();
  console.log("== chon backend cho plugin zen-backend ==");
  console.log("1. Ollama TRUC TIEP (khong qua plugin) - can ollama + model da pull");
  console.log("2. OpenCode Zen free tier (qua plugin, localhost)");
  console.log("3. OpenAI-compatible custom (Pollinations keyless / Groq / Cerebras / NVIDIA...)");
  console.log("4. Exit");
  const pick = await ask("chon [1/2/3/4]: ");
  if (pick === "4") { rl.close(); return; }
  if (pick !== "1" && pick !== "2" && pick !== "3") { rl.close(); return; }

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
    const alias = (await ask("alias Claude de dung [claude-sonnet-4-6]: ")) || "claude-sonnet-4-6";
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

  if (pick !== "2" && pick !== "3") { rl.close(); return; }
  if (pick === "3") {
    // OpenAI-compatible custom: Pollinations mac dinh (keyless), hoac bat ky endpoint nao.
    const url = (await ask("chat-completions URL [https://text.pollinations.ai/openai]: ")) || "https://text.pollinations.ai/openai";
    const key = await ask("API key (bo trong neu khong can, vd Pollinations): ");
    const model = (await ask("model [openai]: ")) || "openai";
    const cfg = loadSettings();
    cfg.modelOverrides = { ...(cfg.modelOverrides || {}) };
    delete cfg.modelOverrides[ALIAS];
    cfg.env = {
      ...(cfg.env || {}),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
      ANTHROPIC_API_KEY: "public",
      ANTHROPIC_MODEL: ALIAS,
    };
    saveSettings(cfg);
    console.log(`da patch ${CLAUDE_SETTINGS} (di qua plugin -> ${url})`);
    rl.close();
    const env = { ...process.env, PORT: String(PORT), BACKEND: "openai", OPENAI_URL: url, OPENAI_MODEL: model };
    if (key) env.OPENAI_KEY = key;
    console.log(`\nbackend=openai model=${model}\nMo terminal khac chay claude (settings.json da co san env).\n`);
    const p = spawn(process.execPath, [path.join(HERE, "plugin.mjs")], { env, stdio: "inherit" });
    if (await waitReady(PORT)) console.log(`\nplugin READY o http://127.0.0.1:${PORT} -> gio mo terminal khac chay claude.`);
    else console.log(`\nCANH BAO: plugin chua nghe sau 15s. Kiem tra log o tren.`);
    p.on("exit", (c) => process.exit(c ?? 0));
    return;
  }
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
  // Linux: hoi cai systemd service chay nen luon khoi giu terminal
  if (!IS_WIN && (await setupSystemd({ BACKEND: "zen", ZEN_MODEL: target }))) return;
  // preflight: port da co plugin chay san thi dung lai, khoi spawn chong
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    const j = await r.json();
    if (r.ok && j && j.object === "list") {
      console.log(`\nplugin da chay san o port ${PORT} -> dung lai, khoi start moi.`);
      console.log(`Mo terminal khac chay claude (settings.json da co san env).`);
      return;
    }
  } catch {}
  const env = { ...process.env, PORT: String(PORT), BACKEND: "zen", ZEN_MODEL: target };
  console.log(`\nbackend=zen model=${target}\nneu muon go tay thay vi dung settings:\n  ` + claudeEnvLines(`http://127.0.0.1:${PORT}`, ALIAS).join("\n  ") + "\n");
  const p = spawn(process.execPath, [path.join(HERE, "plugin.mjs")], { env, stdio: "inherit" });
  // doi plugin ready roi moi bao user chay claude (tranh Connection refused do start chua xong)
  if (await waitReady(PORT)) console.log(`\nplugin READY o http://127.0.0.1:${PORT} -> gio mo terminal khac chay claude.`);
  else console.log(`\nCANH BAO: plugin chua nghe sau 15s (port ${PORT} bi chiem? loi start?). Kiem tra log o tren.`);
  p.on("exit", (c) => process.exit(c ?? 0));
}
main();
