// providers/registry.js — quản lý nhiều provider (zen, ollama, groq, cerebras...)
// Đọc providers.json + models.json, cung cấp API để server/CLI dùng.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonText } from "../json.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function providersFile() {
  return process.env.PROVIDERS_FILE || path.join(ROOT, "providers.json");
}

// Built-in providers luôn có mặc định
const BUILTINS = {
  zen: {
    type: "zen",
    name: "OpenCode Zen",
    enabled: true,
    config: {
      url: "https://opencode.ai/zen/v1",
      apiKey: "public",
      models: [],
    },
  },
  ollama: {
    type: "ollama",
    name: "Ollama",
    enabled: true,
    config: {
      url: "http://127.0.0.1:11434/v1",
      apiKey: "",
      models: [],
    },
  },
  claude: {
    type: "claude",
    name: "Claude (gốc)",
    enabled: true,
    config: {
      url: "",
      apiKey: "",
      models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5", "claude-fable-5-1"],
    },
  },
};

export function loadProviders() {
  try {
    const raw = parseJsonText(fs.readFileSync(providersFile(), "utf8"));
    // Merge với built-ins (built-in luôn có thể bị override từ file)
    return { ...BUILTINS, ...raw };
  } catch {
    return { ...BUILTINS };
  }
}

export function saveProviders(providers) {
  const f = providersFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(providers, null, 2));
}

export function getProvider(providers, id) {
  return providers[id] || null;
}

export function listProviders(providers) {
  return Object.entries(providers).map(([id, p]) => ({
    id,
    type: p.type,
    name: p.name,
    enabled: p.enabled !== false,
    models: p.config?.models || [],
  }));
}

export function addProvider(providers, id, { type, name, url, apiKey, models }) {
  if (providers[id]) throw new Error(`provider "${id}" đã tồn tại`);
  providers[id] = {
    type: type || "openai",
    name: name || id,
    enabled: true,
    config: {
      url: url || "",
      apiKey: apiKey || "",
      models: models || [],
    },
  };
  saveProviders(providers);
  return providers[id];
}

export function removeProvider(providers, id) {
  if (BUILTINS[id]) throw new Error(`không thể xóa built-in provider "${id}"`);
  if (!providers[id]) throw new Error(`provider "${id}" không tồn tại`);
  delete providers[id];
  saveProviders(providers);
}

export function updateProvider(providers, id, updates) {
  if (!providers[id]) throw new Error(`provider "${id}" không tồn tại`);
  providers[id] = { ...providers[id], ...updates };
  saveProviders(providers);
  return providers[id];
}

// Lấy tất cả models từ tất cả enabled providers
export function getAllModels(providers) {
  const result = [];
  for (const [id, p] of Object.entries(providers)) {
    if (p.enabled === false) continue;
    const models = p.config?.models || [];
    for (const m of models) {
      result.push({ provider: id, model: m });
    }
  }
  return result;
}
