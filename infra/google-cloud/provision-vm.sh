#!/usr/bin/env bash
set -euo pipefail

APP_NAME="controle-faturamento"
APP_ROOT="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
RUNTIME_USER="controle"
PORT="8080"
ARTIFACT_PATH="${1:-}"

if [[ -z "${ARTIFACT_PATH}" || ! -f "${ARTIFACT_PATH}" ]]; then
  echo "Uso: $0 /caminho/para/app.tgz" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "Atualizando pacotes..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg build-essential python3 nginx

INSTALL_NODE="0"
if ! command -v node >/dev/null 2>&1; then
  INSTALL_NODE="1"
else
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "${NODE_MAJOR}" -lt 20 ]]; then
    INSTALL_NODE="1"
  fi
fi

if [[ "${INSTALL_NODE}" == "1" ]]; then
  echo "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! id -u "${RUNTIME_USER}" >/dev/null 2>&1; then
  echo "Criando usuario de execucao..."
  sudo useradd --system --create-home --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${RUNTIME_USER}"
fi

echo "Preparando diretorios..."
sudo mkdir -p "${APP_ROOT}" "${DATA_DIR}"
sudo rm -rf "${APP_ROOT:?}/"*
sudo tar -xzf "${ARTIFACT_PATH}" -C "${APP_ROOT}"
sudo chown -R "${RUNTIME_USER}:${RUNTIME_USER}" "${APP_ROOT}" "${DATA_DIR}"

echo "Instalando dependencias da aplicacao..."
cd "${APP_ROOT}"
sudo -u "${RUNTIME_USER}" npm ci --omit=dev

echo "Configurando systemd..."
sudo tee "/etc/systemd/system/${APP_NAME}.service" > /dev/null <<EOF
[Unit]
Description=Controle de Faturamento
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUNTIME_USER}
Group=${RUNTIME_USER}
WorkingDirectory=${APP_ROOT}
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=${PORT}
Environment=DATA_DIR=${DATA_DIR}
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Configurando Nginx..."
sudo tee "/etc/nginx/sites-available/${APP_NAME}" > /dev/null <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
sudo nginx -t

echo "Iniciando servicos..."
sudo systemctl daemon-reload
sudo systemctl enable --now "${APP_NAME}"
sudo systemctl enable --now nginx
sudo systemctl restart nginx

echo "Provisionamento concluido."
