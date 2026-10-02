// scripts/lib/systemd.js — quan ly systemd user service cho Ubuntu (zen-proxy).
// Chay nen sau khi dang xuat can `loginctl enable-linger $USER` (CLI tu nhac).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SERVICE = "zen-proxy";
export const TIMER = "zen-claude-healthcheck.timer";
// Ten unit cu (giua lai de uninstall sach may tung cai ban cu).
export const LEGACY_UNITS = [
  "zen-backend.service",
  "zen-claude-proxy.service",
  "zen-claude-healthcheck.service",
];

export function serviceDir() {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

export function systemctlAvailable() {
  try {
    const r = spawnSync("systemctl", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

export function systemctl(args) {
  return spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
}

// Unit KHONG pin BACKEND/MODEL: proxy tu khoi phuc backend dang dung tu
// runtime.local.json (dashboard doi van giu sau restart). Chi pin PORT.
export function buildUnit({ root, nodeExec, port }) {
  return `[Unit]\nDescription=zen-proxy (Claude Code backend, chay nen)\nAfter=network-online.target\nWants=network-online.target\n\n`
    + `[Service]\nType=simple\nWorkingDirectory=${root}\n`
    + `ExecStartPre=-/usr/bin/git -C ${root} pull --ff-only --quiet\n`
    + `ExecStart=${nodeExec} ${path.join(root, "proxy.mjs")}\nEnvironment=PORT=${port}\n`
    + `Restart=on-failure\nRestartSec=5\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=default.target\n`;
}

export function writeUnit(root, port) {
  const dir = serviceDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SERVICE}.service`), buildUnit({
    root,
    nodeExec: process.execPath,
    port,
  }));
  // Healthcheck timer tu deploy/ (neu thieu thi bo qua, khong fail install).
  for (const f of ["zen-claude-healthcheck.service", TIMER]) {
    try {
      fs.copyFileSync(path.join(root, "deploy", f), path.join(dir, f));
    } catch {}
  }
  // Don unit ten cu, tranh 2 instance giu cung port.
  for (const u of LEGACY_UNITS) {
    systemctl(["disable", "--now", u]);
    try { fs.unlinkSync(path.join(dir, u)); } catch {}
  }
}

export function removeUnits() {
  const dir = serviceDir();
  systemctl(["disable", "--now", SERVICE]);
  systemctl(["disable", "--now", TIMER]);
  for (const u of LEGACY_UNITS) systemctl(["disable", "--now", u]);
  for (const f of [`${SERVICE}.service`, "zen-claude-healthcheck.service", TIMER, ...LEGACY_UNITS]) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
  systemctl(["daemon-reload"]);
}
