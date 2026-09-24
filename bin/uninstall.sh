#!/usr/bin/env bash
# Go sach zen-proxy + Claude Code tren Ubuntu (service, process, package, config).
# Chay tu repo root:  bash bin/uninstall.sh   (hoac chmod +x roi nhap dup de chay)
set -u
echo "== tat service/timer (gom ca ten service cu) =="
for u in zen-proxy.service zen-backend.service zen-claude-proxy.service zen-claude-healthcheck.timer zen-claude-healthcheck.service; do
  systemctl --user disable --now "$u" 2>/dev/null || true
done
echo "== xoa file unit =="
rm -f ~/.config/systemd/user/zen-proxy.service \
      ~/.config/systemd/user/zen-backend.service \
      ~/.config/systemd/user/zen-claude-proxy.service \
      ~/.config/systemd/user/zen-claude-healthcheck.service \
      ~/.config/systemd/user/zen-claude-healthcheck.timer
systemctl --user daemon-reload 2>/dev/null || true
echo "== tat process proxy + claude dang chay (neu co) =="
pkill -f "zen-claude-proxy/proxy.mjs" 2>/dev/null || true
pkill -x claude 2>/dev/null || true
echo "== go Claude Code (npm global) =="
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g @anthropic-ai/claude-code 2>/dev/null \
    || sudo npm uninstall -g @anthropic-ai/claude-code 2>/dev/null || true
fi
echo "== xoa config Claude (~/.claude, ~/.claude.json) =="
rm -rf ~/.claude ~/.claude.json
echo ""
echo "XONG. Kiem tra (phai bao not-found/inactive + command not found):"
echo "  systemctl --user status zen-proxy"
echo "  which claude || echo 'claude da go'"
echo "  ls ~/.claude 2>/dev/null || echo '~/.claude da xoa'"
echo "Muon dung lai thi: git pull && npm start (chon backend -> go y)"
