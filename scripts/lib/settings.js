// scripts/lib/settings.js — doc/ghi settings.json cua Claude (dung chung start.js + switch.js).
// Tu phat hien path theo OS: Windows %USERPROFILE%\.claude, Linux/macOS ~/.claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJsonText } from "../../src/json.js";

export function claudeSettingsPath() {
  // CLAUDE_SETTINGS_FILE chi dung cho test (tro sang file tam).
  if (process.env.CLAUDE_SETTINGS_FILE) return process.env.CLAUDE_SETTINGS_FILE;
  return path.join(os.homedir(), ".claude", "settings.json");
}
export function loadSettings() {
  try { return parseJsonText(fs.readFileSync(claudeSettingsPath(), "utf8")); }
  catch { return {}; }
}
export function saveSettings(cfg) {
  const p = claudeSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

// --- Backup/Restore ---
export function backupPath() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(os.homedir(), ".claude", `settings.json.backup.${ts}`);
}

export function backupSettings() {
  const src = claudeSettingsPath();
  if (!fs.existsSync(src)) return null;
  const dst = backupPath();
  fs.copyFileSync(src, dst);
  return dst;
}

export function restoreSettings(backupFile) {
  const src = backupFile || backupPath();
  if (!fs.existsSync(src)) return false;
  const dst = claudeSettingsPath();
  fs.copyFileSync(src, dst);
  return true;
}

export function listBackups() {
  const dir = path.join(os.homedir(), ".claude");
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith("settings.json.backup."))
      .sort()
      .reverse();
  } catch { return []; }
}
