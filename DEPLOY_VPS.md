# OpsAi — VPS Deploy (gitsource / source layout)

Use the same style of site folder as your other VPS apps:

```text
yourdomain.com/          (or /var/www/opsai.yourdomain.com)
├── backup/              # deploy backups
├── gitsource/           # Git clone connected to GitHub
├── html/                # optional (static / default web root)
├── source/              # running app (synced from gitsource by deploy.sh)
├── ssl/                 # certificates (if used)
└── deploy.sh            # pull → sync → build → pm2 restart
```

- **`gitsource`** = only place connected to Git (`git pull`)
- **`source`** = what PM2 runs (env files + `storage` stay here, not overwritten)

---

## One-time setup on VPS

### 1. Create folders

```bash
sudo mkdir -p /var/www/opsai.yourdomain.com/{backup,gitsource,html,source,ssl}
cd /var/www/opsai.yourdomain.com
```

### 2. Connect `gitsource` to GitHub

```bash
cd /var/www/opsai.yourdomain.com
git clone https://github.com/gajanansapate17/OpsAI.git gitsource
# or: https://github.com/Lakeshj/OPS-Ai.git
```

Check:

```bash
cd gitsource
git remote -v
git status
```

### 3. Copy deploy script

```bash
cp gitsource/deploy.sh /var/www/opsai.yourdomain.com/deploy.sh
chmod +x /var/www/opsai.yourdomain.com/deploy.sh
```

### 4. First sync + env (before PM2)

```bash
cd /var/www/opsai.yourdomain.com
./deploy.sh
```

Then create env files **inside `source`** (not gitsource):

```bash
# Backend
cp source/backend/.env.example source/backend/.env
nano source/backend/.env
```

Set: `DB_*`, `JWT_SECRET`, `PORT` (e.g. `5013` or `5014` — whatever is free), AI keys.

**CORS (production):** use the public HTTPS origin only — **no** `:3001` / `:3002` ports (Cloudflare/nginx terminate TLS on 443):

```env
CORS_ORIGIN=https://opsai.socialchamps.com
```

Wrong (causes CORS issues if anything hits the API cross-origin):

```env
CORS_ORIGIN=https://opsai.socialchamps.com:3001,https://opsai.socialchamps.com:3002
```

```bash
# Frontend
cp source/frontend/.env.example source/frontend/.env.local
nano source/frontend/.env.local
```

```env
NEXT_PUBLIC_API_URL=/api
# MUST match backend PORT exactly (live API was on 5014)
BACKEND_INTERNAL_URL=http://127.0.0.1:5014
```

On a **dev machine with Cursor/VS Code Remote tunnels**, prefer `http://localhost:PORT` over `http://127.0.0.1:PORT` — IDE forwards can bind `127.0.0.1` and cause Next proxy timeouts / 500s.

### 5. MySQL (once for bootstrap, then migrate on every deploy)

```bash
sudo mysql -u root -p < source/mysql/opsai.sql
cd source/backend && npm run db:migrate
```

**Every later deploy** must also run migrations so live picks up new tables/columns
(e.g. Part 8A `015_workflow_waits.sql`). Prefer `./deploy.sh` (includes migrate),
or after a manual pull:

```bash
cd source/backend && npm run db:migrate
pm2 restart opsai-backend
```

See [docs/database-migrations.md](./docs/database-migrations.md).

### 6. Build + PM2

```bash
cd /var/www/opsai.yourdomain.com
./deploy.sh
```

Or manually:

```bash
cd source/frontend && npm install && npm run build
cd ../backend && npm install && npm run db:migrate

pm2 start npm --name opsai-frontend --cwd /var/www/opsai.yourdomain.com/source/frontend -- start
# Prefer npm start so prestart runs db:migrate on process boot
pm2 start npm --name opsai-backend --cwd /var/www/opsai.yourdomain.com/source/backend -- start
pm2 save
pm2 startup
```

If the backend was already started with `server.js` directly, either switch to
`npm start` as above, or always run `npm run db:migrate` in `deploy.sh` / after pull.

Live names on opsai.socialchamps.com: **`opsai-frontend`** + **`opsai-backend`** (not opsai-web / opsai-api).

### 7. Nginx → frontend `:3001` + API `:5013`

**Important:** Proxy `/api` **directly to the backend**. Do not rely only on the Next.js rewrite for production — if `opsai-backend` is down or the rewrite URL is wrong, Cloudflare shows **502 on login** while the homepage still loads.

```nginx
server {
  listen 80;
  server_name opsai.socialchamps.com;

  client_max_body_size 50M;

  # AI evaluate / summary can take >60s — avoid nginx 502
  proxy_connect_timeout 75s;
  proxy_send_timeout 180s;
  proxy_read_timeout 180s;

  # API → Express (keeps /api/... path; backend serves /api in prod)
  location /api/ {
    proxy_pass http://127.0.0.1:5013;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api {
    proxy_pass http://127.0.0.1:5013;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # App → Next.js
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Important for Cloudflare 502:**

1. Backend must stay **HTTP** on `127.0.0.1:5013` (do **not** set `USE_NODE_HTTPS=true`).
2. TLS belongs on **nginx / Cloudflare**, not on Node.
3. `opsai-backend` must be **online** in `pm2 status` — homepage 200 + `/api` 502 almost always means Next is proxying the **wrong PORT** (e.g. 5013 vs real 5014).
4. Git remote on the VPS must be the repo you push to (`lakesh` / `Lakeshj/OPS-Ai`). If VPS still pulls `gajanansapate17/OpsAI`, your API fixes never reach live.

### 8. Smoke test (run on the VPS)

```bash
pm2 status
pm2 logs opsai-backend --lines 80 --nostream

# Use the real PORT from backend .env (live was 5014)
curl -s http://127.0.0.1:5014/api
curl -s http://127.0.0.1:5014/api/health

# After nginx /api location is added:
curl -s http://127.0.0.1/api
# or: curl -s https://opsai.socialchamps.com/api
```

**Fix loop when homepage works but login is 502:**

```bash
# 1) Is API listening? (match PORT in backend .env)
ss -lntp | grep -E '5013|5014' || netstat -lntp | grep -E '5013|5014'

# 2) Restart and check logs
pm2 restart opsai-backend
pm2 logs opsai-backend --lines 100 --nostream

# 3) Frontend rewrite must use the SAME port
grep -E 'PORT|USE_NODE_HTTPS|NODE_ENV|CORS_ORIGIN' source/backend/.env
grep BACKEND_INTERNAL_URL source/frontend/.env.local
# Expect e.g. PORT=5014 and BACKEND_INTERNAL_URL=http://127.0.0.1:5014
# CORS_ORIGIN=https://opsai.socialchamps.com   (no :3001)

# 4) Rebuild frontend after changing BACKEND_INTERNAL_URL, then restart both
cd source/frontend && npm run build
pm2 restart opsai-frontend opsai-backend

# 5) Pull the branch you actually push to, then deploy
cd gitsource && git remote -v && git pull && cd .. && ./deploy.sh
```

---

## Every update (after you push to GitHub)

```bash
cd /var/www/opsai.yourdomain.com
./deploy.sh
```

What it does:

1. Backup current `source` → `backup/`
2. `git pull` inside **`gitsource`**
3. `rsync` → **`source`** (keeps `.env`, `node_modules`, `.next`, `storage`)
4. `npm install` + `build` frontend
5. backend `npm install` + **`npm run db:migrate`** (required for local→live schema parity)
6. `pm2 restart` `opsai-frontend` + `opsai-backend`

Schema changes (new tables/columns/ENUMs) only reach live if the migration `.sql`
file is in git **and** migrate runs on the live DB. Details:
[docs/database-migrations.md](./docs/database-migrations.md).
---

## Ports / PM2 names

| App      | Port (example) | PM2 name         | Runs from         |
|----------|----------------|------------------|-------------------|
| Frontend | 3001 / 3002    | `opsai-frontend` | `source/frontend` |
| Backend  | 5013 / **5014**| `opsai-backend`  | `source/backend`  |

`BACKEND_INTERNAL_URL` and nginx `proxy_pass` must use the **same** backend PORT as `.env`.

---

## Default admin (SQL seed)

- Email: `admin@example.com`
- Change password after first login.

## Notes

- Connect Git only in **`gitsource`**. Do not run `git` inside `source` for deploys.
- Keep secrets only in **`source/.../.env`** — never commit them.
- This is a Node app: Nginx proxies to Next; do not expect HTML files in `html/` for the main app.
