---
name: zen-models
description: Dùng model OpenCode Zen free tier hoặc Ollama local thay cho model mặc định. Dùng khi user hỏi về model free, đổi model, hết quota, hoặc lỗi model.
---

# Dùng model Zen free / Ollama trong session này

Repo này (`zen-claude-proxy`) cho phép chạy model free bên trong Claude Code:

- **Zen free** (cần proxy localhost đang chạy ở `http://127.0.0.1:8898`,
  start bằng `node start.js` rồi chọn `2`):
  `muse-spark-1.3-contributor-free`, `muse-spark-1.2-contributor-free`,
  `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`,
  `mimo-v2.6-flash-free`, `mimo-v2.5-free`, `big-pickle`, `ling-3.0-flash-fin-free`
- **Ollama** (đi thẳng `http://127.0.0.1:11434`, không proxy):
  model bất kỳ đã `ollama pull`, đặt alias `claude-*` bằng `ollama cp`

## Kiểm tra nhanh backend còn sống không

- Proxy Zen: mở `http://127.0.0.1:8898/` phải thấy trang status;
  `http://127.0.0.1:8898/diag` cho biết đường ra `opencode.ai` có thông không.
- Ollama: `ollama list` phải thấy model; `curl http://127.0.0.1:11434/` trả "Ollama is running".

## Lỗi thường gặp (đọc để tự xử, khỏi hỏi user)

- `Connection refused` → backend tương ứng chưa chạy (proxy / ollama serve).
- `401 Model X is not supported` → model free đó đã bị Zen tắt phía server, đổi model khác trong list verified (`node start.js` → 2).
- `429 FreeUsageLimitError` → rate limit free tier, đợi vài phút thử lại.
- `403 FreeTierError` sau khi đã chạy ngon → gate server vừa đổi, báo để reverse lại.

## Lưu ý khi dùng model free làm việc

Model free yếu hơn Claude chính chủ: prompt phải rõ ràng, imperative
("Tạo file X với đúng nội dung Y, không hỏi lại"), chia task nhỏ.
Với task tool phức tạp mà model cứ hỏi lại thay vì làm, hãy thử model khác
trong list verified (`nemotron-3-ultra-free`, `big-pickle` khá nhất nhóm chat).
