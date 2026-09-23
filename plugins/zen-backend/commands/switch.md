---
description: Đổi backend/model lúc đang chạy (zen <-> ollama) mà không restart plugin
argument-hint: "[ollama <model> [alias] | zen [model] | status]"
---

Đổi backend hoặc model của plugin `zen-backend` đang chạy ở `http://127.0.0.1:8898`
(mặc định theo `PORT`), KHÔNG restart process. Tham số: $ARGUMENTS.

Cách làm (chạy shell thật, không nói suông):

1. Nếu `$ARGUMENTS` rỗng hoặc là `status`: `GET http://127.0.0.1:8898/admin/status`
   rồi báo backend + model đang dùng.
2. Nếu là `zen [model]` (thiếu model thì dùng `muse-spark-1.3-contributor-free`):
   - `POST http://127.0.0.1:8898/admin/switch` body `{"backend":"zen","zenModel":"<model>"}`
   - Cập nhật `~/.claude/settings.json`: `modelOverrides["claude-sonnet-4-6"]`
     thành model đó (giữ nguyên các key khác).
3. Nếu là `ollama <model> [alias]` (alias mặc định `claude-sonnet-4-6`):
   - Chạy `ollama cp <model> <alias>` để Ollama nhìn thấy tên đó.
   - Xóa `modelOverrides[alias]` trong settings (đi thẳng, không rewrite).
   - Set `env` trong settings: `ANTHROPIC_BASE_URL=http://127.0.0.1:11434`,
     `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=ollama`, `ANTHROPIC_MODEL=<alias>`.
   - `POST http://127.0.0.1:8898/admin/switch` body
     `{"backend":"ollama","ollamaModel":"<model>"}` (để plugin cùng trạng thái,
     dù request Claude lúc này đi thẳng Ollama không qua plugin).
4. Báo lại kết quả + nhắc user: session Claude đang mở giữ model cũ,
   mở session mới (hoặc `/model`) để dùng model mới.

Không tự bịa endpoint: chỉ dùng 2 endpoint admin trên. Thất bại thì đọc message
lỗi trả về và báo nguyên văn, không đoán.
