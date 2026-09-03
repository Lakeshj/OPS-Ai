# OpsAi

Monorepo with two apps:

```
OpsAI/
├── frontend/     # Next.js UI (port 3001)
├── backend/      # Express API (port 5013)
└── mysql/        # SQL dumps / helpers
```

## Local setup

```bash
# Frontend
cd frontend
npm install
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=/api  (same origin)
# BACKEND_INTERNAL_URL=http://127.0.0.1:5013
npm run dev

# Backend (other terminal)
cd backend
npm install
cp .env.example .env         # DB, JWT, AI keys, CORS
npm run dev
```

Open `http://localhost:3001/api` in the browser — Next proxies to Express and should return `{ ok: true, ... }`.
Direct backend URL also works: `http://localhost:5013/api`.

From repo root you can also use:

```bash
npm run install:all
npm run dev:web
npm run dev:api
```

## VPS / production (PM2)

See **[DEPLOY_VPS.md](./DEPLOY_VPS.md)** for the `gitsource` / `source` / `deploy.sh` layout (same style as your other VPS sites).

**Database schema:** any new table/column/ENUM must be a file in `backend/migrations/` and applied with `cd backend && npm run db:migrate` on local **and** live. See [docs/database-migrations.md](./docs/database-migrations.md).

Quick version (flat clone):

```bash
git clone <your-repo-url> OpsAI
cd OpsAI

# Frontend
cd frontend
npm install
# create .env.local with production NEXT_PUBLIC_API_URL
npm run build
pm2 start npm --name opsai-web -- start
cd ..

# Backend
cd backend
npm install
# create .env
pm2 start server.js --name opsai-api

pm2 save
pm2 startup
```

Nginx should proxy your domain to `127.0.0.1:3001` (web) and API to `127.0.0.1:5013`.
