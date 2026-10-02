// test/systemd.test.js — systemd unit builder (offline, khong can systemctl that)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildUnit, serviceDir, systemctlAvailable, SERVICE } from "../scripts/lib/systemd.js";

describe("systemd", () => {
  it("buildUnit tro dung root + proxy.mjs + port, khong pin backend", () => {
    const u = buildUnit({ root: "/home/u/zen-claude-proxy", nodeExec: "/usr/bin/node", port: 8898 });
    assert.ok(u.includes("WorkingDirectory=/home/u/zen-claude-proxy"));
    assert.ok(u.includes("ExecStart=/usr/bin/node " + path.join("/home/u/zen-claude-proxy", "proxy.mjs")));
    assert.ok(u.includes("Environment=PORT=8898"));
    assert.ok(!u.includes("BACKEND"));
    assert.ok(u.includes("Restart=on-failure"));
  });
  it("serviceDir nam trong systemd user", () => {
    assert.ok(serviceDir().endsWith(path.join(".config", "systemd", "user")));
  });
  it("systemctlAvailable tra boolean, khong nem", () => {
    assert.equal(typeof systemctlAvailable(), "boolean");
  });
  it("ten service on dinh", () => {
    assert.equal(SERVICE, "zen-proxy");
  });
});
