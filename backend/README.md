# Backend API Server with MySQL (Modular Architecture)

This is the Node.js backend server that provides all the API endpoints for the frontend application, now using MySQL database.

## Structure

```
backend/
├── server.js                 # App entry (listen + mount)
├── routes/index.js           # Mounts all feature routes under /api
├── config/
│   ├── database.js           # MySQL pool
│   ├── openai.js             # OpenAI client
│   └── init-db.sql
├── middleware/
│   ├── auth.js
│   └── errorHandler.js
├── utils/formatters.js
└── modules/                  # Feature modules (isolated by domain)
    ├── auth/
    ├── users/
    ├── workspaces/
    ├── folders/
    ├── chatThreads/
    ├── chatMessages/
    ├── assistants/
    ├── analytics/
    └── chatGenerate/
```

Each feature module has its own `*.routes.js` and `*.controller.js`. A failure in one module's logic is contained to that feature's request handlers; other modules keep their own routes.

## Setup

1. Navigate to the backend directory:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Setup MySQL Database:

   a. Make sure MySQL is installed and running on your system

   b. Create the database and tables by running the SQL script:

   ```bash
   mysql -u root -p < config/init-db.sql
   ```

   c. Apply tracked schema migrations:

   ```bash
   npm run db:migrate
   ```

   Migrations are idempotent and recorded in the `schema_migrations` table.

4. Configure Database Connection via `.env` in the backend directory.

5. Start the server:

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

The server will run on the port from `.env` (default `5013`).

## API Endpoints

All public paths are unchanged from before (mounted under `/api`).

### Auth
- POST `/api/auth/login`
- POST `/api/auth/register`

### Users
- GET/POST `/api/users`
- GET/PUT/DELETE `/api/users/:id`

### Workspaces
- GET/POST `/api/workspaces`
- GET/PUT/DELETE `/api/workspaces/:id`
- GET `/api/users/:userId/workspaces`

### Folders
- GET/POST `/api/folders`
- GET/PUT/DELETE `/api/folders/:id`
- GET `/api/workspaces/:workspaceId/folders`

### Chat Threads
- GET/POST `/api/chat-threads`
- GET/PUT/DELETE `/api/chat-threads/:id`
- GET `/api/folders/:folderId/chat-threads`
- GET `/api/users/:userId/workspaces/:workspaceId/chat-threads`

### Chat Messages
- GET/POST `/api/chat-messages`
- GET/PUT/DELETE `/api/chat-messages/:id`
- GET `/api/chat-threads/:threadId/messages`

### Keyword Assistants
- GET/POST `/api/assistants`
- GET/PUT/DELETE `/api/assistants/:id`
- Each assistant has a configurable `capabilityType` and `model`

### Workspace Summary
- GET `/api/workspaces/:workspaceId/summary`
- PUT `/api/workspaces/:workspaceId/summary` with `{ content }`
- POST `/api/workspaces/:workspaceId/summary/regenerate`
- POST `/api/workspaces/:workspaceId/summary/versions/:versionId/restore`
- Keeps the latest current summary plus three previous versions
- Restoring a version also restores its active-document snapshot
- Summary edits and automatic regenerations are evaluated with global admin criteria

### Admin AI Settings
- GET/PUT `/api/admin/ai-settings` (Admin only)
- Configures summary model, evaluation model, and global evaluation prompt

### Analytics
- GET `/api/analytics/overview`
- GET `/api/analytics/charts/:type`
- GET `/api/analytics/dashboard-stats`

### Chat Generation
- POST `/api/chat/generate`
  - Body: `{ threadId, prompt, assistantId? }`
  - Server resolves workspace access, workspace summary, bot prompt, session memory, and recent messages
  - Uses the selected bot's configured model and a cacheable summary/bot prefix
  - Logs token/cache usage to `ai_usage_events` and updates `chat_session_memory`

### Workspace Documents (Static Memory uploads)
- GET `/api/workspaces/:workspaceId/documents`
- POST `/api/workspaces/:workspaceId/documents` (multipart field: `file`)
- GET `/api/documents/:id`
- DELETE `/api/documents/:id`
- POST `/api/documents/:id/reconvert`

Upload rules:
- Admin or owning Project Manager only for create/delete
- Allowed: PDF, DOCX, XLSX, PPT, PPTX, TXT, MD
- Size/quota limits from env (`STATIC_MEMORY_MAX_FILE_MB`, `STATIC_MEMORY_WORKSPACE_QUOTA_MB`)
- Files stored under `backend/storage/static-memory/` (outside public web paths)
- After upload, conversion runs asynchronously:
  - `uploaded` → `converting` → `ready` or `failed`
  - Readable Markdown saved as `.../markdown/{original-name}-{id}.md`
  - Original is kept only until conversion succeeds, then deleted to save disk space
  - Chunks written to `document_chunks`
  - Workspace summary is regenerated and evaluated after conversion
- Deleting a document also regenerates and evaluates the workspace summary
- Legacy `.ppt` is rejected; use `.pptx`
- Retry conversion only works while the original still exists (failed uploads). Ready docs must be re-uploaded to reconvert.

### Verify Stage 1

Run a read-only dry run (no OpenAI request or token cost):

```bash
npm run stage1:verify
```

This checks ready documents, readable Markdown, static memory, chunks, prompt
assembly, cache key construction, session-memory rows, and usage events.
