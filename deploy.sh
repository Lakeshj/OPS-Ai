#!/usr/bin/env bash
#
# Simple deploy for OpsAi ONLY — does not touch other projects.
# Run from site root:
#   cd /var/www/opsai.socialchamps.com
#   bash deploy.sh
#
# Layout:
#   gitsource/OPS-Ai/   ← git pull here (change GIT_REPO below if folder name differs)
#   source/             ← live app (PM2 runs from here)
#   backup/source/      ← backup before each deploy
#
# Manual steps (not automated):
#   - Edit source/backend/.env and source/frontend/.env.local when needed
#   - First-time PM2 start if process does not exist yet

set -e

# ── Paths (OpsAi site only) ────────────────────────────────────────────────
APP_ROOT="/var/www/opsai.socialchamps.com"
GIT_REPO="$APP_ROOT/gitsource/OPS-Ai"   # or: gitsource/keyword-chat-forge
SOURCE="$APP_ROOT/source"
BACKUP="$APP_ROOT/backup/source"
BRANCH="${BRANCH:-main}"

# PM2 process name(s) for THIS site only — change to match: pm2 list
PM2_APP="${PM2_APP:-opsai.socialchamps.com}"
# If you use separate web + api processes instead of one, set these and leave PM2_APP empty:
PM2_WEB="${PM2_WEB:-}"
PM2_API="${PM2_API:-}"

# ── 1) Backup current source ───────────────────────────────────────────────
echo "==> Backup source -> backup/source"
mkdir -p "$BACKUP"
rm -rf "${BACKUP:?}"/*
cp -a "$SOURCE/." "$BACKUP/"

# ── 2) Pull latest code in gitsource ───────────────────────────────────────
echo "==> Git pull in $GIT_REPO"
if [[ ! -d "$GIT_REPO/.git" ]]; then
  echo "ERROR: $GIT_REPO is not a git repo."
  echo "Clone first, e.g.:"
  echo "  cd $APP_ROOT/gitsource && git clone <repo-url> OPS-Ai"
  exit 1
fi
cd "$GIT_REPO"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ── 3) Copy gitsource -> source (keep .env + storage) ──────────────────────
echo "==> Sync gitsource -> source (keeping .env and storage)"
mkdir -p "$SOURCE"
rsync -a --delete \
  --exclude=".git/" \
  --exclude="frontend/node_modules/" \
  --exclude="backend/node_modules/" \
  --exclude="frontend/.next/" \
  --exclude="frontend/.env" \
  --exclude="frontend/.env.local" \
  --exclude="backend/.env" \
  --exclude="backend/storage/" \
  "$GIT_REPO/" "$SOURCE/"

# ── 4) Build frontend ──────────────────────────────────────────────────────
echo "==> Frontend: npm install + build"
cd "$SOURCE/frontend"
npm install
npm run build

# ── 5) Backend install (+ optional migrate) ────────────────────────────────
echo "==> Backend: npm install"
cd "$SOURCE/backend"
npm install

echo "==> Backend: db migrate (skip errors if already applied)"
npm run db:migrate || true

# ── 6) Restart THIS app only (PM2) ─────────────────────────────────────────
echo "==> PM2 reload (OpsAi only)"
if [[ -n "$PM2_APP" ]]; then
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    pm2 reload "$PM2_APP" --update-env
  else
    echo "WARN: PM2 app '$PM2_APP' not found. Start manually, e.g.:"
    echo "  cd $SOURCE/frontend && pm2 start npm --name opsai-web -- start"
    echo "  cd $SOURCE/backend && pm2 start server.js --name opsai-api"
  fi
else
  [[ -n "$PM2_WEB" ]] && pm2 reload "$PM2_WEB" --update-env
  [[ -n "$PM2_API" ]] && pm2 reload "$PM2_API" --update-env
fi

# ── 7) Nginx (optional) ────────────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  echo "==> Reload nginx"
  sudo systemctl reload nginx || true
fi

echo "==> Deploy complete"
echo "    Check: pm2 logs $PM2_APP --lines 50"
