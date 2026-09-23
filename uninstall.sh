#!/usr/bin/env bash
# Tat + go sach service/timer cua zen-backend plugin.
# Chay:  bash uninstall.sh   (hoac chmod +x roi nhap dup de chay)
set -u
echo "== tat service/timer cu =="
for u in zen-backend.service zen-claude-proxy.service zen-claude-healthcheck.timer zen-claude-healthcheck.service; do
  systemctl --user disable --now "$u" 2>/dev/null || true
done
echo "== xoa file unit =="
rm -f ~/.config/systemd/user/zen-backend.service \
      ~/.config/systemd/user/zen-claude-proxy.service \
      ~/.config/systemd/user/zen-claude-healthcheck.service \
      ~/.config/systemd/user/zen-claude-healthcheck.timer
systemctl --user daemon-reload 2>/dev/null || true
echo "== tat process plugin dang chay (neu co) =="
pkill -f "zen-claude-proxy/plugin.mjs" 2>/dev/null || true
pkill -f "zen-claude-proxy/proxy.mjs" 2>/dev/null || true
echo ""
echo "XONG. Kiem tra (phai bao not-found/inactive):"
echo "  systemctl --user status zen-backend"
echo "Muon dung lai thi: node start.js (chon backend -> go y)"
