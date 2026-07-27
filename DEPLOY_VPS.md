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

Set: `DB_*`, `JWT_SECRET`, `PORT=5013`, `CORS_ORIGIN=https://yourdomain.com`, AI keys.

```bash
# Frontend
cp source/frontend/.env.example source/frontend/.env.local
nano source/frontend/.env.local
```

```env
NEXT_PUBLIC_API_URL=/api
BACKEND_INTERNAL_URL=http://127.0.0.1:5013
```

### 5. MySQL (once)

```bash
sudo mysql -u root -p < source/mysql/opsai.sql
cd source/backend && npm run db:migrate
```

### 6. Build + PM2

```bash
cd /var/www/opsai.yourdomain.com
./deploy.sh
```

Or manually:

```bash
cd source/frontend && npm install && npm run build
cd ../backend && npm install

pm2 start npm --name opsai-web --cwd /var/www/opsai.yourdomain.com/source/frontend -- start
pm2 start server.js --name opsai-api --cwd /var/www/opsai.yourdomain.com/source/backend
pm2 save
pm2 startup
```

### 7. Nginx → frontend `:3001`

```nginx
server {
  listen 80;
  server_name yourdomain.com;

  client_max_body_size 50M;

  # optional static:
  # root /var/www/opsai.yourdomain.com/html;

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
# optional: sudo certbot --nginx -d yourdomain.com
```

### 8. Smoke test

```bash
curl http://127.0.0.1:5013/api
curl http://127.0.0.1:3001/api
# or https://yourdomain.com/api
```

Expect: `{ "ok": true, "message": "OpsAi API is working", ... }`

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
5. backend migrate
6. `pm2 restart` `opsai-web` + `opsai-api`

---

## Ports / PM2 names

| App      | Port | PM2 name    | Runs from                          |
|----------|------|-------------|------------------------------------|
| Frontend | 3001 | `opsai-web` | `source/frontend`                  |
| Backend  | 5013 | `opsai-api` | `source/backend`                   |

---

## Default admin (SQL seed)

- Email: `admin@example.com`
- Change password after first login.

## Notes

- Connect Git only in **`gitsource`**. Do not run `git` inside `source` for deploys.
- Keep secrets only in **`source/.../.env`** — never commit them.
- This is a Node app: Nginx proxies to Next; do not expect HTML files in `html/` for the main app.
