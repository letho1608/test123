// logger.js — log co level, ra stderr + file proxy.log (de journald/systemd gom).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;
const LOG_FILE = path.join(ROOT, "proxy.log");

function write(level, msg) {
  if (LEVELS[level] < MIN) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  if (LEVELS[level] >= LEVELS.warn) console.error(line);
  else console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

export const logger = {
  debug: (m) => write("debug", m),
  info: (m) => write("info", m),
  warn: (m) => write("warn", m),
  error: (m) => write("error", m),
};
