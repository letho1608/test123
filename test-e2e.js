// test-e2e.js — kiem dinh model that qua Claude Code (tool loop that)
//   node test-e2e.js [model-id | all]   (mac dinh: muse-spark-1.3-contributor-free)
// Ket qua luu verified.json de start.js hien tag theo ket qua that (khong hardcode).
// Moi model mat ~2-5 phut (model free cham). Chay full 8 con thi di uong cafe.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2] || "muse-spark-1.3-contributor-free";
const VERIFIED_FILE = path.join(HERE, "verified.json");
const ALIAS = "claude-sonnet-4-5";
const PER_MODEL_TIMEOUT = 5 * 60 * 1000;

function loadVerified() {
  try { return JSON.parse(fs.readFileSync(VERIFIED_FILE, "utf8")); }
  catch { return { updated: null, results: {} }; }
}
function freePort() {
  return 18000 + crypto.randomInt(0, 2000);
}
async function waitReady(port, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function testOne(model, port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-home-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-work-"));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({
    modelOverrides: { [ALIAS]: model },
  }));
  const env = {
    ...process.env,
    HOME: home, USERPROFILE: home,
    PORT: String(port), BACKEND: "zen", ZEN_MODEL: model,
  };
  const proxy = spawn(process.execPath, [path.join(HERE, "proxy.mjs")],
    { env, stdio: "ignore" });
  const t0 = Date.now();
  try {
    if (!await waitReady(port)) return { ok: false, ms: Date.now() - t0, note: "proxy khong ready" };
    const want = "E2E-OK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const file = "e2e_ok.txt";
    const childEnv = {
      ...env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: "public",
      ANTHROPIC_MODEL: ALIAS,
    };
    const prompt = `Create a file named ${file} containing exactly the text ${want} and nothing else.`;
    const args = ["--allowedTools", "Write", "-p", prompt];
    // win32: chay qua cmd /c (khong dung shell:true de tranh mang prompt)
    const out = await new Promise((resolve) => {
      const p = process.platform === "win32"
        ? spawn("cmd", ["/c", "claude", ...args], { cwd: work, env: childEnv, stdio: ["ignore", "pipe", "pipe"] })
        : spawn("claude", args, { cwd: work, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let txt = "";
      p.stdout.on("data", (d) => (txt += d));
      p.stderr.on("data", (d) => (txt += d));
      const kill = setTimeout(() => { try { p.kill(); } catch {} resolve({ timeout: true, txt }); }, PER_MODEL_TIMEOUT);
      p.on("close", (c) => { clearTimeout(kill); resolve({ code: c, txt }); });
      p.on("error", (e) => { clearTimeout(kill); resolve({ spawnErr: String(e), txt }); });
    });
    let got = null;
    try { got = fs.readFileSync(path.join(work, file), "utf8").trim(); } catch {}
    const ok = got === want;
    return { ok, ms: Date.now() - t0, note: ok ? `file dung noi dung (${got})` : `file=${JSON.stringify(got)} out=${String(out.txt || out).slice(0, 200)}` };
  } finally {
    try { proxy.kill(); } catch {}
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  let list;
  if (ARG === "all") {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(HERE, "models.json"), "utf8"));
      list = j?.zen?.verified?.length ? j.zen.verified : null;
    } catch {}
    list = list || [
      "muse-spark-1.3-contributor-free", "muse-spark-1.2-contributor-free",
      "nemotron-3-ultra-free", "nemotron-3.5-lightning-free",
      "mimo-v2.6-flash-free", "mimo-v2.5-free", "big-pickle", "ling-3.0-flash-fin-free",
    ];
  } else list = [ARG];
  const store = loadVerified();
  for (const m of list) {
    console.log(`\n=== test ${m} ===`);
    const r = await testOne(m, freePort());
    console.log(r.ok ? `PASS (${r.ms}ms) ${r.note}` : `FAIL (${r.ms}ms) ${r.note}`);
    store.results[m] = { ok: r.ok, ms: r.ms, note: r.note, at: new Date().toISOString() };
    store.updated = new Date().toISOString();
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(store, null, 2));
  }
  console.log("\n=== tong ket ===");
  for (const m of list) {
    const r = store.results[m];
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${m}  (${r.ms}ms) ${r.note}`);
  }
}
main();
