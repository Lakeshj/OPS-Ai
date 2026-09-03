#!/usr/bin/env bash
# OpsAi VPS deploy: gitsource → source → build → migrate → pm2 restart
# Install: cp gitsource/deploy.sh /var/www/opsai.yourdomain.com/deploy.sh && chmod +x deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GITSOURCE="${ROOT}/gitsource"
SOURCE="${ROOT}/source"
BACKUP="${ROOT}/backup"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$GITSOURCE/.git" ]]; then
  echo "ERROR: ${GITSOURCE} is not a git repo. Clone into gitsource first."
  exit 1
fi

mkdir -p "$BACKUP" "$SOURCE"

echo "==> Backup source → backup/${STAMP}"
if [[ -d "$SOURCE/backend" || -d "$SOURCE/frontend" ]]; then
  mkdir -p "${BACKUP}/${STAMP}"
  rsync -a \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'storage' \
    "${SOURCE}/" "${BACKUP}/${STAMP}/" || true
fi

echo "==> git pull in gitsource"
cd "$GITSOURCE"
git pull --ff-only

echo "==> rsync gitsource → source (preserve env, node_modules, .next, storage)"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'storage' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'backend/.env' \
  --exclude 'frontend/.env' \
  --exclude 'frontend/.env.local' \
  "${GITSOURCE}/" "${SOURCE}/"

echo "==> frontend install + build"
cd "${SOURCE}/frontend"
npm install
npm run build

echo "==> backend install + migrate (local→live schema parity)"
cd "${SOURCE}/backend"
npm install
npm run db:migrate

echo "==> pm2 restart"
pm2 restart opsai-frontend opsai-backend || {
  echo "PM2 restart failed — starting if missing..."
  pm2 describe opsai-frontend >/dev/null 2>&1 || \
    pm2 start npm --name opsai-frontend --cwd "${SOURCE}/frontend" -- start
  pm2 describe opsai-backend >/dev/null 2>&1 || \
    pm2 start npm --name opsai-backend --cwd "${SOURCE}/backend" -- start
  pm2 save
}

echo "==> Done ${STAMP}"
pm2 status
