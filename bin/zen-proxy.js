#!/usr/bin/env node
// zen-proxy.js — Unified CLI entry point
// Usage:
//   zen-proxy start              # Start proxy daemon
//   zen-proxy use <provider:model>  # Switch model (hot, no restart)
//   zen-proxy providers           # List all providers/models
//   zen-proxy providers add <id> --url <url> --key <key> --models <m1,m2>
//   zen-proxy refresh zen         # Fetch latest Zen models
//   zen-proxy status              # Show current backend + TUI
//   zen-proxy stop                # Stop daemon
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const PORT = Number(process.env.PORT || 8898);
const BASE = `http://127.0.0.1:${PORT}`;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + path, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

async function cmdStart() {
  // Check if already running
  try {
    const r = await get("/admin/status");
    if (r.status === 200) {
      console.log(`proxy đã chạy ở ${BASE} (backend=${r.json.backend})`);
      return;
    }
  } catch {}

  // Backup settings before starting
  const { backupSettings } = await import("../scripts/lib/settings.js");
  const backup = backupSettings();
  if (backup) console.log(`đã backup settings: ${backup}`);

  console.log(`khởi động proxy ở ${BASE}...`);
  const env = { ...process.env, PORT: String(PORT) };
  const child = spawn(process.execPath, [path.join(ROOT, "proxy.mjs")], {
    env,
    stdio: "inherit",
    detached: false,
  });

  // Wait for ready
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await get("/v1/models");
      if (r.status === 200) {
        console.log(`proxy READY ở ${BASE}`);
        return;
      }
    } catch {}
  }
  console.log("CẢNH BÁO: proxy chưa sẵn sàng sau 15s. Kiểm tra log.");
  child.on("exit", (c) => process.exit(c ?? 0));
}

async function cmdUse(target) {
  if (!target) {
    console.error("thiếu target: zen-proxy use <provider:model>");
    process.exitCode = 1;
    return;
  }
  const [provider, model] = target.split(":");
  if (!provider || !model) {
    console.error(`sai định dạng: "${target}" (cần provider:model)`);
    process.exitCode = 1;
    return;
  }

  try {
    // Provider-based switching: provider "groq"/"claude"/... -> backend + registry config.
    // Khong gui clientPatched de server tu patch settings.json (Claude Code moi doi that).
    const body = { provider, model };
    const r = await post("/admin/switch", body);
    if (r.json.ok) {
      console.log(`đã chuyển sang ${provider}:${model}`);
    } else {
      console.error("lỗi:", r.json.error || JSON.stringify(r.json));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("không kết nối được proxy (chạy `zen-proxy start` trước):", String(e).slice(0, 200));
    process.exitCode = 1;
  }
}

async function cmdProviders() {
  try {
    const r = await get("/admin/providers");
    if (r.status !== 200 || !r.json.ok) {
      console.error("proxy không chạy");
      process.exitCode = 1;
      return;
    }
    const s = await get("/admin/status").catch(() => ({ json: {} }));
    console.log(`backend hiện tại: ${s.json.backend || "?"}${s.json.provider ? " (provider=" + s.json.provider + ")" : ""}`);
    for (const p of r.json.providers || []) {
      const cur = s.json.provider === p.id ? "  <-- dang dung" : "";
      console.log(`- ${p.id} (${p.type})${cur}`);
      for (const m of p.models || []) console.log(`    ${m}`);
    }
  } catch (e) {
    console.error("không kết nối được proxy:", String(e).slice(0, 200));
    process.exitCode = 1;
  }
}

async function cmdProvidersRm(id) {
  if (!id) {
    console.error("thiếu id: zen-proxy providers rm <id>");
    process.exitCode = 1;
    return;
  }
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(BASE + "/admin/providers/" + encodeURIComponent(id), { method: "DELETE" }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try { resolve({ status: r.statusCode, json: JSON.parse(d) }); }
          catch { resolve({ status: r.statusCode, json: {} }); }
        });
      });
      req.on("error", reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });
    if (res.json.ok) console.log(`đã xóa provider "${id}"`);
    else {
      console.error("lỗi:", res.json.error || JSON.stringify(res.json));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("không kết nối được proxy:", String(e).slice(0, 200));
    process.exitCode = 1;
  }
}

async function cmdProvidersAdd(id, args) {
  // Parse --url, --key, --models
  const getOpt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const url = getOpt("--url");
  const key = getOpt("--key") || "";
  const modelsStr = getOpt("--models");
  const models = modelsStr ? modelsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];

  if (!url) {
    console.error("thiếu --url");
    process.exitCode = 1;
    return;
  }

  // Add to providers.json directly
  const { loadProviders, addProvider } = await import("../src/providers/registry.js");
  const providers = loadProviders();
  try {
    addProvider(providers, id, { type: "openai", name: id, url, apiKey: key, models });
    console.log(`đã thêm provider "${id}" với ${models.length} models`);
  } catch (e) {
    console.error("lỗi:", e.message);
    process.exitCode = 1;
  }
}

async function cmdRefreshZen() {
  try {
    const r = await post("/admin/refresh-zen", {});
    if (r.json.ok) {
      console.log(`đã làm mới ${r.json.count || "?"} models từ OpenCode`);
      if (r.json.added?.length) console.log(`  mới: ${r.json.added.join(", ")}`);
      if (r.json.removed?.length) console.log(`  mất: ${r.json.removed.join(", ")}`);
    } else {
      console.error("lỗi:", r.json.error || JSON.stringify(r.json));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("không kết nối được proxy:", String(e).slice(0, 200));
    process.exitCode = 1;
  }
}

async function cmdStatus() {
  try {
    const r = await get("/admin/status");
    console.log(JSON.stringify(r.json, null, 2));
  } catch (e) {
    console.error("proxy không chạy ở port", PORT);
    process.exitCode = 1;
  }
}

async function cmdStop() {
  try {
    const r = await post("/admin/stop", {});
    if (r.json.ok) {
      console.log("đã dừng proxy");
      // Offer restore
      const { listBackups, restoreSettings } = await import("../scripts/lib/settings.js");
      const backups = listBackups();
      if (backups.length > 0) {
        console.log(`\nbackup gần nhất: ${backups[0]}`);
        console.log("chạy sau để restore: zen-proxy restore");
      }
    }
  } catch (e) {
    console.error("không kết nối được proxy");
    process.exitCode = 1;
  }
}

async function cmdRestore() {
  const { listBackups, restoreSettings } = await import("../scripts/lib/settings.js");
  const backups = listBackups();
  if (backups.length === 0) {
    console.log("không có backup nào");
    return;
  }
  const latest = backups[0];
  if (restoreSettings(latest)) {
    console.log(`đã restore từ ${latest}`);
  } else {
    console.error("restore thất bại");
    process.exitCode = 1;
  }
}

async function cmdInstall() {
  if (process.platform === "win32") {
    console.error("install chi chay tren Linux (Windows: chay `start` giu terminal).");
    process.exitCode = 1;
    return;
  }
  const { systemctlAvailable, systemctl, writeUnit, SERVICE, TIMER } = await import("../scripts/lib/systemd.js");
  if (!systemctlAvailable()) {
    console.error("khong thay systemctl.");
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.PORT) || 8898;
  // Dam bao runtime.local.json ton tai: service khoi dong lai giu dung backend dang dung.
  const cfg = await import("../src/config.js");
  cfg.loadRuntime();
  cfg.persistRuntime();
  writeUnit(ROOT, port);
  systemctl(["daemon-reload"]);
  const en = systemctl(["enable", "--now", SERVICE]);
  if (en.status !== 0) {
    console.error("cai that bai:", (en.stderr || "").slice(0, 200));
    process.exitCode = 1;
    return;
  }
  systemctl(["enable", "--now", TIMER]);
  console.log(`xong: service dang ${((systemctl(["is-active", SERVICE]).stdout || "").trim() || "?")} (port ${port})`);
  console.log(`log: zen-proxy log  |  muon chay sau khi dang xuat: loginctl enable-linger $USER`);
}

async function cmdUninstall() {
  if (process.platform === "win32") {
    console.error("uninstall service chi ho tro Linux systemd.");
    process.exitCode = 1;
    return;
  }
  const { systemctlAvailable, removeUnits } = await import("../scripts/lib/systemd.js");
  if (!systemctlAvailable()) {
    console.error("khong thay systemctl.");
    process.exitCode = 1;
    return;
  }
  removeUnits();
  console.log("da go service + timer zen-proxy (giu nguyen settings Claude va providers.json).");
}

async function cmdLog(n) {
  const lines = Number(n) || 50;
  // Uu tien log service; khong co thi doc proxy.log.
  try {
    const { systemctlAvailable, SERVICE } = await import("../scripts/lib/systemd.js");
    if (systemctlAvailable()) {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("journalctl", ["--user", "-u", SERVICE, "-n", String(lines), "--no-pager"], { encoding: "utf8" });
      if (!r.error && r.status === 0 && (r.stdout || "").trim()) {
        process.stdout.write(r.stdout);
        return;
      }
    }
  } catch {}
  try {
    const { readFileSync } = await import("node:fs");
    const all = readFileSync(path.join(ROOT, "proxy.log"), "utf8").trimEnd().split("\n");
    console.log(all.slice(-lines).join("\n"));
  } catch {
    console.error("chua co log.");
    process.exitCode = 1;
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "start": return cmdStart();
    case "use": return cmdUse(args[0]);
    case "providers":
      if (args[0] === "add") return cmdProvidersAdd(args[1], args.slice(2));
      if (args[0] === "rm" || args[0] === "remove" || args[0] === "del") return cmdProvidersRm(args[1]);
      return cmdProviders();
    case "refresh": return cmdRefreshZen();
    case "status": return cmdStatus();
    case "stop": return cmdStop();
    case "restore": return cmdRestore();
    case "install": return cmdInstall();
    case "uninstall": return cmdUninstall();
    case "log": return cmdLog(args[0]);
    default:
      console.log([
        "zen-proxy",
        "",
        "  start                 chay foreground",
        "  install               cai service chay nen (Linux)",
        "  uninstall             go service",
        "  log [n]               xem n dong log cuoi",
        "  use <provider:model>  doi model, khong restart",
        "  providers             xem providers + models",
        "  providers add <id> --url <url> --key <key> --models <m1,m2>",
        "  providers rm <id>     xoa provider tu them",
        "  refresh zen           cap nhat model zen",
        "  status                xem dang dung gi",
        "  stop                  dung proxy",
        "  restore               khoi phuc settings.json",
      ].join("\n"));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
