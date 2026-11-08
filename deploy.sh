#!/usr/bin/env bash
# ==============================================================================
# Robust Deployment Script for Delta India Strangle Virtual SL Engine
# Referenced from Desktop/funding deployment architecture
# ==============================================================================
set -euo pipefail

# Auto-detect application directory
if [ -d "/root/sl_strangle" ]; then
    APP_DIR="/root/sl_strangle"
elif [ -d "/root/strangle-sl" ]; then
    APP_DIR="/root/strangle-sl"
elif [ -d "/root/SL" ]; then
    APP_DIR="/root/SL"
elif [ -d "${HOME}/sl_strangle" ]; then
    APP_DIR="${HOME}/sl_strangle"
elif [ -d "${HOME}/strangle-sl" ]; then
    APP_DIR="${HOME}/strangle-sl"
elif [ -d "${HOME}/SL" ]; then
    APP_DIR="${HOME}/SL"
else
    APP_DIR="$(pwd)"
fi

SERVICE_NAME="strangle-sl"

echo "=========================================================="
echo " Starting Deploy in ${APP_DIR} on $(date -u)"
echo "=========================================================="

cd "${APP_DIR}"

# 1. Pull latest code from git (if repository exists)
if [ -d ".git" ]; then
    echo "[1/4] Pulling latest changes from git repository..."
    git pull origin master || git pull origin main || true
fi

# 2. Install production dependencies
echo "[2/4] Installing npm dependencies..."
npm install --omit=dev || npm install

# 3. Create / Update systemd service with dynamic node path
echo "[3/4] Configuring systemd service: ${SERVICE_NAME}..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN="$(command -v node || echo /usr/bin/node)"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Delta Exchange India Stop-Loss Monitor & Telegram Bot
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${APP_DIR}/.env

ExecStart=${NODE_BIN} index.js

KillSignal=SIGINT
TimeoutStopSec=30
KillMode=mixed
Restart=always
RestartSec=5s
LimitNOFILE=65536

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# 4. Restart service and verify status
echo "[4/4] Restarting ${SERVICE_NAME} service..."
systemctl restart "${SERVICE_NAME}"

sleep 2
systemctl status "${SERVICE_NAME}" --no-pager || true

echo "=========================================================="
echo " Deployment Complete!"
echo " Monitor live logs: journalctl -u ${SERVICE_NAME} -f"
echo "=========================================================="

