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
Chọn `2` → liệt kê model Zen free (đọc từ `models.opencode.ai`, giống `opencode models opencode`
nhưng không cần cài opencode) để pick, mặc định là `muse-spark-1.3-contributor-free`
(model duy nhất đã verify end-to-end; model khác có thể 401/500 do endpoint/SDK khác).

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

## Cấu trúc code

```text
proxy.mjs            entry point mỏng (gọi src/server.js)
src/
  config.js          mọi cấu hình + validate env, hằng số, load assets
  logger.js          log theo level (debug/info/warn/error)
  errors.js          error contract thống nhất + validate input (400 sớm)
  ids.js             mint ses_/msg_ đúng format time-ordered
  translators/
    anthropic.js     blocks Anthropic + map tool opencode->Claude
    responses.js     Anthropic <-> Responses API (zen)
    openai.js        Anthropic <-> Chat Completions (ollama + zen-chat)
  sse.js             đọc SSE + khung SSE Anthropic (dùng chung 2 backend)
  backends/
    zen.js           Zen free tier (fingerprint, retry, route /responses|/chat)
    ollama.js        Ollama OpenAI-compat
  server.js          routes, validation, graceful shutdown, /diag
test/                unit test offline (`npm test`, vài giây)
test-e2e.js          kiểm định tool-loop thật (`node test-e2e.js [model|all]`)
```

## Kiểm định model (verified không còn hardcode)

`node test-e2e.js [model-id | all]` — với mỗi model, script tự start proxy,
chạy Claude Code thật làm 1 task bắt buộc dùng tool (tạo file đúng nội dung),
rồi ghi kết quả vào `verified.json`. Menu `start.js` đọc file này để gắn tag.

- Test 1 con lẻ mất ~2-5 phút; quét full 8 con mất ~20-30 phút.
- Lần quét gần nhất (trong `verified.json`): cả 8 model free đều PASS tool loop.
  Lưu ý: quét dồn dập có thể ăn `429 FreeUsageLimitError` (rate limit phía Zen) —
  đợi vài phút chạy lại con đó là pass.

## Backend Zen hoạt động thế nào

Free tier Zen không check API key mà check "độ giống opencode". Proxy tự route
mỗi model đúng endpoint của nó:

- `muse-spark-1.3/1.2-contributor-free` → `/responses` (prompt agent + 6 tools mồi)
- `nemotron-3-ultra/3.5-lightning-free`, `mimo-v2.6/v2.5-flash-free`, `big-pickle`,
  `ling-3.0-flash-fin-free` → `/chat/completions` (prompt agent + đủ 42 tools opencode)

Điểm chung bắt buộc: `Authorization: Bearer public` + header `x-opencode-*` với
`ses_/msg_` ID đúng format time-ordered (proxy tự mint, không cần binary),
`stream: true`, `tool_choice: "auto". Model free còn lại trả `401 Model is not supported`.

## Lưu ý

- Free tier là tài nguyên của OpenCode — dùng test thì ok, đừng mang đi production.
  Gate phía server có thể đổi bất cứ lúc nào (lúc đó proxy sẽ 403 cho tới khi reverse lại).
- Mỗi request Zen cõng thêm ~13KB prompt + tools mồi → tốn token hơn bình thường.
- Proxy không có auth — vì bind localhost nên chỉ process trên máy gọi được. Đừng bind ra ngoài.

## Lỗi thường gặp

**`API Error: Connection refused` trong Claude Code** = Claude không nối được tới proxy.
99% là do proxy **chưa chạy** (mỗi terminal mới phải start proxy trước), hoặc lệch port:

1. Kiểm tra proxy có nghe không:
   - Windows (PowerShell): `curl.exe -s http://127.0.0.1:8898/`
   - Ubuntu: `curl -s http://127.0.0.1:8898/`
   - Phải thấy dòng `zen-claude-proxy dang chay`. Nếu `Connection refused` → chạy `node start.js` (chọn 2) trước rồi mới mở Claude.
2. Kiểm tra đường ra mạng của máy: mở `http://127.0.0.1:8898/diag` trên browser —
   xem `zen_models.ok` có `true` không. Nếu `false`, đọc `error` trong đó (DNS/timeout/...)
   rồi gửi output cho người debug.
3. Đổi port thì đổi cả 2 chỗ: `PORT=9000 node start.js` + `ANTHROPIC_BASE_URL`
   trong settings.json (hoặc chạy lại `start.js`, nó patch lại).
