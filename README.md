# zen-proxy

Proxy localhost cho **Claude Code**: dùng **opencode CLI trên máy này** (không qua
server opencode.ai — tool chạy nội bộ trong opencode), **OpenCode Zen free tier**
(không cần key), **Claude gốc** (API key của bạn), hoặc bất kỳ endpoint
**OpenAI-compatible** nào (Groq, Cerebras, NVIDIA NIM, OpenRouter...) — tất cả qua 1 lệnh duy nhất.

Luồng backend local (khuyên dùng): Claude Code → proxy (`ANTHROPIC_BASE_URL`
về `127.0.0.1:8898`) → `opencode run -s <session>` trên máy → provider bạn đã
cấu trong `opencode.json` → text cuối trả về Claude hiển thị. Tools của Claude
bị lột đi — Claude chỉ làm màn hình, không gọi server Anthropic.

## Lệnh `zen-proxy` (khuyên dùng)

```bash
cd zen-claude-proxy
node bin/zen-proxy.js start                        # chạy proxy nền ở http://127.0.0.1:8898
node bin/zen-proxy.js providers                    # liệt kê providers + models, đánh dấu cái đang dùng
node bin/zen-proxy.js use local:9router/ag/x          # opencode CLI, model trong opencode.json
node bin/zen-proxy.js use zen:muse-spark-1.3-contributor-free
node bin/zen-proxy.js use claude:claude-sonnet-5-5  # claude gốc: đi thẳng api.anthropic.com, tốn phí TK bạn
node bin/zen-proxy.js use groq:llama-3.3-70b-versatile
node bin/zen-proxy.js providers add myep --url https://.../chat/completions --key xxx --models m1,m2
node bin/zen-proxy.js providers rm myep
node bin/zen-proxy.js refresh zen                   # tải danh sách model Zen free mới nhất
node bin/zen-proxy.js status                        # xem backend/model đang dùng (JSON)
node bin/zen-proxy.js stop                          # dừng proxy
node bin/zen-proxy.js restore                       # khôi phục settings.json từ backup mới nhất
```

`use` đổi model **nóng, không restart** (tự patch `~/.claude/settings.json`,
mở session Claude mới là dùng ngay). `npm link` 1 lần để gõ `zen-proxy` từ mọi thư mục.

## Chạy nền bằng systemd (Ubuntu)

```bash
node bin/zen-proxy.js install     # cài service, dùng backend đang chạy
node bin/zen-proxy.js log         # xem log
node bin/zen-proxy.js uninstall   # gỡ service (giữ nguyên settings + providers)
```

Muốn đổi backend trước khi cài: `use` đổi trước rồi `install`.
Chạy cả sau khi đăng xuất: `loginctl enable-linger $USER`.
Unit không pin backend nên restart vẫn giữ đúng cái đang dùng.

## Cài đặt (Ubuntu + Windows giống nhau)

Chỉ cần clone repo và chạy:

```bash
git clone https://github.com/letho1608/test123.git zen-claude-proxy
cd zen-claude-proxy
npm start
```

## Đổi backend/model lúc đang chạy (không restart)

Mở web dashboard `http://127.0.0.1:8898/` (tiếng Việt, bấm là đổi):
Cài 1 lần để gõ được từ mọi thư mục:

```bash
# Windows (cmd, chạy 1 lần) — thay bằng đường dẫn repo của bạn:
setx PATH "%PATH%;D:\Code\zen-claude-proxy\bin"
# (mở cmd mới rồi gõ: status)

# Ubuntu (chạy 1 lần):
ln -sf ~/zen-claude-proxy/bin/status ~/.local/bin/status
# (đảm bảo ~/.local/bin có trong PATH rồi gõ: status)
```

Chưa cài thì đứng trong thư mục `bin` gõ `status` (Windows) hoặc `./status` (Ubuntu).
Mở tay cũng được: `http://127.0.0.1:8898/` (đúng port proxy đang chạy).

- **Opencode CLI local (khuyên dùng):** tool chạy trong `opencode` máy bạn, session
  dài sticky (`LOCAL_SESSION`, reset bằng nút "reset session opencode" trên dashboard
  hoặc `POST /admin/local-reset`). Mặc định model freetier `opencode/big-pickle`
  (không key, không login); để trống mới rơi về mặc định trong `opencode.json`.
- **Zen free tier:** bấm dùng 1 trong các model verified (nút "cập nhật zen" để tải list mới nhất)
- **Claude gốc:** bấm dùng để đi thẳng API Anthropic (tốn phí tài khoản của bạn)
- **OpenAI-compatible đã lưu:** mỗi cấu hình có nút dùng từng model + nút xóa
- **OpenAI-compatible tự nhập:** nhập tên + URL/key/models rồi "lưu & dùng"
  (lưu vào `providers.json`, tắt proxy mở lại vẫn còn) hoặc "chỉ dùng 1 lần"

Dùng lệnh cũng được:

```bash
npm run switch -- local [model-opencode]  # vd: npm run switch -- local opencode/big-pickle (mặc định freetier này)
npm run switch -- zen [model-zen]     # vd: npm run switch -- zen big-pickle
npm run switch -- openai <url> [key] <model>
```

## Yêu cầu

- Node.js >= 18 (không cần gì thêm)
- Claude Code cài qua npm: `npm i -g @anthropic-ai/claude-code`
- Backend local: đã cài opencode CLI (`opencode --version` chạy được) + model/key
  đã cấu trong `~/.config/opencode/opencode.json`

## Chạy

```bash
npm start
```

Chi tiết từng lệnh cài trên Ubuntu xem file `docs/INSTALL-UBUNTU.txt`.

Menu:

```text
1. Opencode CLI local (KHUYEN DUNG) - tool chay trong `opencode` may nay
2. OpenCode Zen free tier (muse-spark-1.3-contributor-free, không cần key)
3. OpenAI-compatible custom (tự nhập URL/key/model)
4. Exit
```

Chọn `1` → nhập model opencode (ENTER = freetier `opencode/big-pickle`) + thư mục
làm việc (`LOCAL_CWD`). Proxy chạy `opencode run --format json` cho mỗi request
Claude: session dài, tool-call liên tục nằm gọn trong opencode.
Chọn `2` → liệt kê model Zen free (đọc từ `models.opencode.ai`, giống `opencode models opencode`
nhưng không cần cài opencode) để pick, mặc định là `muse-spark-1.3-contributor-free`.
Chọn `3` → OpenAI-compatible custom: tự nhập URL/key/model
(Groq, Cerebras, NVIDIA NIM, OpenRouter, HuggingFace router...). Đi qua proxy để dịch protocol.
Trên Linux còn hỏi thêm có cài systemd service chạy nền luôn không (khỏi giữ terminal).

`npm start` sẽ:

1. Tự patch config Claude (`~/.claude/settings.json`, Windows: `%USERPROFILE%\.claude\settings.json`):
   merge `modelOverrides: { "claude-sonnet-5-5": "<model-tương-ứng>" }` (giữ nguyên các key khác,
   không restore khi tắt — đúng 1 lần là xong).
2. Start proxy ở `http://127.0.0.1:8898` và in lệnh chạy Claude.

Chạy Claude ở terminal khác:

Windows (PowerShell):

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8898"
$env:ANTHROPIC_API_KEY = "public"
$env:ANTHROPIC_MODEL = "claude-sonnet-5-5"
claude
```

Ubuntu (bash):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8898 ANTHROPIC_API_KEY=public ANTHROPIC_MODEL=claude-sonnet-5-5
claude
```

Tên `claude-sonnet-5-5` chỉ là alias để Claude chịu validate — request thực tế
proxy tự route sang model backend đã chọn.

## Cấu trúc code

```text
proxy.mjs            entry point mỏng (gọi src/server.js)
bin/
  zen-proxy.js       CLI thống nhất: start/use/providers/refresh/status/stop/restore
  start.js           menu chọn backend + cài systemd service
  switch.js          đổi backend/model lúc đang chạy (npm run switch -- ...)
  status(.cmd)       gõ "status" là mở web dashboard (Win/Linux)
  uninstall.sh       gỡ service + Claude + config (bash bin/uninstall.sh)
src/
  config.js          mọi cấu hình + validate env, hằng số, load assets
  logger.js          log theo level (debug/info/warn/error)
  errors.js          error contract thống nhất + validate input (400 sớm)
  ids.js             mint ses_/msg_ đúng format time-ordered
  json.js            parse JSON chịu BOM Windows
  zen-refresh.js     tải + lọc model Zen free (endpoint refresh, auto-refresh)
  providers/
    registry.js      multi-provider registry (zen/local/claude/openai tự thêm)
  translators/
    anthropic.js     blocks Anthropic + map tool opencode->Claude
    responses.js     Anthropic <-> Responses API (zen)
    openai.js        Anthropic <-> Chat Completions (openai + zen-chat)
  sse.js             đọc SSE + khung SSE Anthropic (dùng chung zen/openai/local)
  backends/
    local.js         opencode CLI local (`opencode run -s`, lot tools Claude)
    zen.js           Zen free tier (fingerprint, retry, failover, route /responses|/chat)
    openai.js        OpenAI-compat tự nhập URL/key/model
  server.js          routes, validation, graceful shutdown, /diag, web dashboard /
assets/              prompt/tools mẫu cho free-tier gate (agentdev.txt, decoy_tools.json, fp.json)
deploy/              systemd units (zen-proxy.service, healthcheck.*)
docs/                hướng dẫn cài Ubuntu (INSTALL-UBUNTU.txt)
scripts/             healthcheck.mjs, test-e2e.js (kiểm định tool-loop thật)
  lib/settings.js    đọc/ghi + backup/restore settings.json của Claude
test/                unit test offline (`npm test`, vài giây)
models.json          danh sách model free + route endpoint (1 nguồn duy nhất)
providers.json       registry providers (built-in zen/local/claude + tự thêm, sửa tay có hiệu lực ngay)
verified.json        kết quả test-e2e (menu đọc để gắn tag)
```

## Kiểm định model (verified không còn hardcode)

`node scripts/test-e2e.js [model-id | all]` — với mỗi model, script tự start proxy,
chạy Claude Code thật làm 1 task bắt buộc dùng tool (tạo file đúng nội dung),
rồi ghi kết quả vào `verified.json`. Menu đọc file này để gắn tag.

- Test 1 con lẻ mất ~2-5 phút; quét full 8 con mất ~20-30 phút.
- Lần quét gần nhất (trong `verified.json`): cả 8 model free đều PASS tool loop.
  Lưu ý: quét dồn dập có thể ăn `429 FreeUsageLimitError` (rate limit phía Zen) —
  đợi vài phút chạy lại con đó là pass.

## Proxy backend local hoạt động thế nào

Mỗi request `POST /v1/messages` của Claude Code được ép thành 1 prompt text
(`src/backends/local.js: buildLocalPrompt`, giữ full history + nhãn role) rồi
chạy `opencode run -s <LOCAL_SESSION> [--model <LOCAL_MODEL>]`. Opencode tự
loop tool nội bộ tới khi xong; text cuối gói thành message Anthropic
`stop_reason: end_turn` trả về. `tools` của Claude bị lột — Claude không chạy
tool nào. Session dài = tái dùng cùng `-s` (xem `POST /admin/local-reset` để
đổi session mới). Task cần duyệt quyền mà không ai duyệt sẽ treo tới
`LOCAL_TIMEOUT_MS` (mặc định 10 phút) rồi báo 504 — nên cấu `permissions` cho
agent relay hoặc dùng `LOCAL_AGENT` read-only.

## Proxy backend Zen hoạt động thế nào

Free tier Zen không check API key mà check "độ giống opencode". Proxy tự route
mỗi model đúng endpoint của nó:

- `muse-spark-1.3/1.2-contributor-free` → `/responses` (prompt agent + 6 tools mồi)
- `nemotron-3-ultra/3.5-lightning-free`, `mimo-v2.6/v2.5-flash-free`, `big-pickle`,
  `ling-3.0-flash-fin-free` → `/chat/completions` (prompt agent + 6 tools mồi)

Điểm chung bắt buộc: `Authorization: Bearer public` + header `x-opencode-*` với
`ses_/msg_` ID đúng format time-ordered (backend tự mint, không cần binary),
`stream: true`, `tool_choice: "auto". Model free còn lại trả `401 Model is not supported`.

Backend và Claude chạy **cùng máy, localhost-only** (`127.0.0.1`), Windows lẫn Ubuntu.

## Lưu ý

- Free tier là tài nguyên của OpenCode — dùng test thì ok, đừng mang đi production.
  Gate phía server có thể đổi bất cứ lúc nào (lúc đó proxy sẽ 403 cho tới khi reverse lại).
- Mỗi request Zen cõng thêm ~13KB prompt + tools mồi → tốn token hơn bình thường.
- Proxy không có auth — vì bind localhost nên chỉ process trên máy gọi được. Đừng bind ra ngoài.
- API key các provider tự thêm lưu plaintext trong `providers.json` — file này đã gitignore
  (xem mẫu ở `providers.example.json`), đừng commit key thật. `runtime.local.json`
  (lưu backend/model đang dùng, gồm cả key) cũng đã gitignore.
- Server tự tải lại danh sách model Zen free mỗi 24h (`ZEN_REFRESH_HOURS=0` để tắt);
  model mới dùng được ngay, không cần restart.

## Lỗi thường gặp

**`API Error: Connection refused` trong Claude Code** = Claude không nối được tới proxy backend.
99% là do backend **chưa chạy** (mỗi terminal mới phải start trước), hoặc lệch port:

1. Kiểm tra backend có nghe không:
   - Windows (PowerShell): `curl.exe -s http://127.0.0.1:8898/`
   - Ubuntu: `curl -s http://127.0.0.1:8898/`
   - Phải thấy web dashboard `zen-proxy`. Nếu `Connection refused` → chạy `npm start` (chọn 1 cho local) trước rồi mới mở Claude.
2. Kiểm tra opencode CLI (backend local): mở `http://127.0.0.1:8898/diag` trên browser —
   xem `checks.opencode_cli.ok` có `true` không. Nếu `false`, cài opencode CLI
   và cấu model/key trong `opencode.json` trước.
3. Đổi port thì đổi cả 2 chỗ: `PORT=9000 npm start` + `ANTHROPIC_BASE_URL`
   trong settings.json (hoặc chạy lại `npm start`, nó patch lại).
