// healthcheck.mjs — kiem tra proxy con song + duong ra backend con tot khong
// Chay tay:  node healthcheck.mjs [port]
// Chay dinh ky qua systemd timer (xem zen-claude-healthcheck.*).
// Logic: GET /diag cua proxy; 2 lan fail lien tiep -> systemctl restart service.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || process.argv[2] || 8898);
const SERVICE = process.env.SERVICE || "zen-claude-proxy";
const STATE_FILE = path.join(os.tmpdir(), "zen-health-fails.json");

function loadFails() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).fails || 0; }
  catch { return 0; }
}
function saveFails(n) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ fails: n })); } catch {}
}

async function main() {
  let diag = null, err = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`http://127.0.0.1:${PORT}/diag`, { signal: ctl.signal });
    clearTimeout(t);
    diag = await r.json();
  } catch (e) { err = String(e).slice(0, 200); }
  const ok = !!(diag && diag.ok);
  if (ok) {
    saveFails(0);
    console.log(`OK backend=${diag.backend} zen=${diag.checks?.zen_models?.ok} ollama=${diag.checks?.ollama?.ok}`);
    return;
  }
  const fails = loadFails() + 1;
  saveFails(fails);
  console.log(`FAIL lan ${fails}: ${err || JSON.stringify(diag?.checks || {}).slice(0, 300)}`);
  if (fails >= 2) {
    console.log(`restart ${SERVICE} ...`);
    const r = spawnSync("systemctl", ["--user", "restart", SERVICE], { encoding: "utf8" });
    if (r.error) console.log("khong goi duoc systemctl (khong phai linux/systemd?):", String(r.error).slice(0, 150));
    else console.log("restart exit:", r.status);
    saveFails(0);
  }
  process.exitCode = 1;
}
main();
