// scripts/lib/settings.js — doc/ghi settings.json cua Claude (dung chung start.js + switch.js).
// Tu phat hien path theo OS: Windows %USERPROFILE%\.claude, Linux/macOS ~/.claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}
export function loadSettings() {
  try { return JSON.parse(fs.readFileSync(claudeSettingsPath(), "utf8")); }
  catch { return {}; }
}
export function saveSettings(cfg) {
  const p = claudeSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}
