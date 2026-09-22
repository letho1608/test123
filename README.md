# zen-claude-proxy

Chạy model **OpenCode Zen free tier** (`muse-spark-1.3-contributor-free`) hoặc **Ollama** local
bên trong **Claude Code**.

- **Ollama (từ v0.14): nói native Anthropic `/v1/messages` → đi thẳng, KHÔNG proxy.**
- **Zen free tier: bắt buộc qua proxy** (free tier gate chỉ pass request đúng dạng opencode).
  Proxy và Claude chạy **cùng máy, localhost-only** (`127.0.0.1`), Windows lẫn Ubuntu.

## Yêu cầu

- Node.js >= 18 (không cần gì thêm)
- Claude Code cài qua npm: `npm i -g @anthropic-ai/claude-code`
- Backend Ollama: đã cài + start Ollama, đã `ollama pull <model>`

## Chạy

```bash
node start.js        # hoặc: npm start
```

Chi tiết từng lệnh cài trên Ubuntu xem file `INSTALL-UBUNTU.txt`.

Menu:

```text
1. Ollama (model đã cài trên máy)
2. OpenCode Zen free tier (muse-spark-1.3-contributor-free, không cần key)
3. Exit
```

Chọn `1` → liệt kê `ollama list` để pick model, rồi tự `ollama cp` sang tên
dạng `claude-*` (Claude Code chỉ gửi đi tên model bắt đầu bằng `claude-`,
còn Ollama chỉ serve tên nó biết — copy là cầu nối). **Đi thẳng, không proxy.**
Chọn `2` → dùng Zen free tier, không cần key (bắt buộc qua proxy, xem dưới).

`start.js` sẽ:

1. Tự patch config Claude (`~/.claude/settings.json`, Windows: `%USERPROFILE%\.claude\settings.json`):
   merge `modelOverrides: { "claude-sonnet-4-5": "<model-tương-ứng>" }` (giữ nguyên các key khác,
   không restore khi tắt — đúng 1 lần là xong).
2. Start proxy ở `http://127.0.0.1:8898` và in lệnh chạy Claude.

Chạy Claude ở terminal khác:

Windows (PowerShell):

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8898"
$env:ANTHROPIC_API_KEY = "public"
$env:ANTHROPIC_MODEL = "claude-sonnet-4-5"
claude
```

Ubuntu (bash):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8898 ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=claude-sonnet-4-5
claude
```

Tên `claude-sonnet-4-5` chỉ là alias để Claude chịu validate — request thực tế
proxy tự route sang model backend đã chọn.

## Backend Zen hoạt động thế nào

Free tier Zen không check API key mà check "độ giống opencode":

- `Authorization: Bearer public` + `User-Agent: opencode/...` + header `x-opencode-*`
- `stream: true` bắt buộc, `tool_choice: "auto"`
- body mang system prompt + tool definitions đặc trưng của opencode (file `agentdev.txt`,
  `decoy_tools.json`), kèm tool của Claude Code
- `ses_/msg_` ID đúng format time-ordered của opencode (proxy tự mint, không cần binary)

## Lưu ý

- Free tier là tài nguyên của OpenCode — dùng test thì ok, đừng mang đi production.
  Gate phía server có thể đổi bất cứ lúc nào (lúc đó proxy sẽ 403 cho tới khi reverse lại).
- Mỗi request Zen cõng thêm ~13KB prompt + 6 tools mồi → tốn token hơn bình thường.
- Proxy không có auth — vì bind localhost nên chỉ process trên máy gọi được. Đừng bind ra ngoài.
