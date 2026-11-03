#!/usr/bin/env bash
# 강원 먹거리 이음 — 리눅스 설치 (Ubuntu/Debian, systemd)
set -e
cd "$(dirname "$0")"; DIR="$(pwd)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Node.js 18 이상이 필요합니다. 예) curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"; exit 1; fi
[ -f .env ] || cp .env.example .env
mkdir -p storage && chmod 700 storage
sudo tee /etc/systemd/system/gwfood.service >/dev/null <<UNIT
[Unit]
Description=강원 먹거리 이음 서버
After=network.target
[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/server/server.js
Restart=always
User=$(id -un)
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now gwfood
sleep 2; sudo journalctl -u gwfood -n 5 --no-pager
echo "설치 완료 · 상태: sudo systemctl status gwfood · 로그: sudo journalctl -u gwfood -f"
