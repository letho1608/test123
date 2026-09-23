// backends/ollama.js — wrapper mong qua backend openai generic.
// (Ollama tu v0.14 noi native Anthropic nen thuong di thang khong qua day;
//  nhung van giu de test/back-compat + khi can log/dich tap trung.)
import { OLLAMA_BASE, runtime } from "../config.js";
import { handleOpenAi } from "./openai.js";

export async function handleOllama(body, model, res, log) {
  return handleOpenAi(body, model, res, log, {
    url: OLLAMA_BASE + "/chat/completions",
    apiKey: "",
    model: runtime.ollamaModel,
  });
}
