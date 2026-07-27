#!/usr/bin/env bash
set -euo pipefail

# Run from site root:
#   /var/www/yourdomain.com/deploy.sh
# Expected folders:
#   backup/  gitsource/  source/  html/  ssl/

APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
GIT_ROOT="$APP_ROOT/gitsource"
SOURCE_ROOT="$APP_ROOT/source"
BACKUP_ROOT="$APP_ROOT/backup"
BRANCH="${DEPLOY_BRANCH:-main}"
NOW="$(date +%Y-%m-%d_%H-%M-%S)"

WEB_PM2_NAME="${WEB_PM2_NAME:-opsai-web}"
API_PM2_NAME="${API_PM2_NAME:-opsai-api}"

if [[ ! -d "$GIT_ROOT/.git" ]]; then
  echo "ERROR: $GIT_ROOT is not a git repo."
  echo "Clone first: git clone <repo-url> \"$GIT_ROOT\""
  exit 1
fi

echo "==> Backup current source"
mkdir -p "$BACKUP_ROOT"
if [[ -d "$SOURCE_ROOT/frontend" || -d "$SOURCE_ROOT/backend" ]]; then
  cp -a "$SOURCE_ROOT" "$BACKUP_ROOT/source_$NOW"
fi

echo "==> Pull latest code in gitsource"
cd "$GIT_ROOT"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Sync gitsource -> source"
mkdir -p "$SOURCE_ROOT"
rsync -a --delete \
  --exclude=".git/" \
  --exclude="frontend/node_modules/" \
  --exclude="backend/node_modules/" \
  --exclude="frontend/.next/" \
  --exclude="frontend/.env" \
  --exclude="frontend/.env.local" \
  --exclude="backend/.env" \
  --exclude="backend/storage/" \
  "$GIT_ROOT/" "$SOURCE_ROOT/"

echo "==> Build frontend"
cd "$SOURCE_ROOT/frontend"
npm install
npm run build

echo "==> Install backend + migrate"
cd "$SOURCE_ROOT/backend"
npm install
npm run db:migrate || true

echo "==> Restart PM2 apps"
cd "$SOURCE_ROOT/frontend"
if pm2 describe "$WEB_PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$WEB_PM2_NAME" --update-env
else
  pm2 start npm --name "$WEB_PM2_NAME" -- start
fi

cd "$SOURCE_ROOT/backend"
if pm2 describe "$API_PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$API_PM2_NAME" --update-env
else
  pm2 start server.js --name "$API_PM2_NAME"
fi

pm2 save

echo "==> Health checks"
curl -fsS "http://127.0.0.1:5013/api" >/dev/null && echo "API OK"
curl -fsS "http://127.0.0.1:3001/api" >/dev/null && echo "WEB PROXY OK"

echo "==> Deploy complete ($NOW)"
