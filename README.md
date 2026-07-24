# Keyword Chat Forge — Next.js

Full-stack Next.js version of OpsAi. The original React project stays in `../keyword-chat-forge`.

## Database — same as React project

**You do NOT need a new database.**

Both projects use the same MySQL database (`opsai`) via `backend/.env`. If the React app already works, copy `backend/.env` from the React project.

## CORS — what is `CORS_ORIGIN`?

The backend (port **5012**) only accepts browser requests from allowed frontend URLs.

| Frontend | URL |
|----------|-----|
| React (old) | http://localhost:8080 |
| Next.js (new) | http://localhost:3001 |

Example in `backend/.env`:

```
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:8080
```

## How to run (self-contained — do not use React project)

Run **both** from this folder only:

1. Terminal 1 — backend:
   ```bash
   cd backend
   npm run dev
   ```

2. Terminal 2 — frontend:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3001

Stop the React project's backend/frontend if ports 5012 or 3001 are in use.

The React project (`../keyword-chat-forge`) is **not** part of this setup anymore.

## Ports

| Service | Port |
|---------|------|
| Next.js frontend | 3001 |
| Express API | 5012 |

## Env files

Frontend `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:5012/api
```

Backend `.env`: copy from React project + CORS line above.

## Crash: `EADDRINUSE`

| Port | Fix |
|------|-----|
| 5012 | Backend already running — use it, don't start a second one |
| 3001 | Close other Next.js terminal |
