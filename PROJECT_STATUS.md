# OpsAi / Keyword Chat Forge — Project Status

Last updated: 22 Jul 2026

## What this project is

Workspace AI chat for teams.

- **Frontend:** Next.js (App Router)
- **Backend:** Express + MySQL
- **AI:** OpenAI (`gpt-4o-mini` default), prompt caching

Roles: **Admin**, **Project Manager**, **Employee**.  
Goal: accurate answers with lower token cost via workspace summary + session memory.

## Expected outcomes

- Reduce API token consumption by 50% or more (on track via summary + session memory + caching; keep measuring in usage)
- Improve response accuracy through persistent workspace knowledge (Workspace Summary from docs)
- Maintain conversational continuity across active chats (session memory)
- Reduce response latency through prompt caching (stable summary + bot prefix)
- Eliminate the need for users to repeatedly explain project context
- Deliver a consistent AI experience across all workspace bots while keeping project knowledge centralized

---

## Architecture: Bots vs System Prompts

| | **Bots** | **System Prompts** |
|---|----------|-------------------|
| Audience | Employees (`@bot` in chat) | Platform features (admin-managed) |
| Scope | Per-bot prompt, model, capability | One prompt per use case |
| Tied together? | No | No |
| Example | `@image`, `@SEO Writer` | `workspace_summary` — Workspace Knowledge Evaluator |

**Summary use case:** one System Prompt. Internal extract/condense/final stay in code.
After **System Prompt save**, scores refresh automatically (reevaluate existing summaries).
After **file upload/delete**, summary stays unchanged until Admin/PM clicks **Regenerate from files**.

## Chat flow

```
User → Workspace → Bot (@...) → Workspace Summary → Bot Prompt
→ Session Memory (always with bot; without bot only if prompt is important)
→ User Prompt → Bot model (caching)
→ Response → Update Session Memory (same rule) → Return
```

**Workspace Summary** = AI system context (what/how the workspace is).  
**Not** user reading material. Visible only in **Workspace Edit → Summary**.  
Employees do not see it. Chat still uses it for every workspace.

**System Prompts** (AI Assistants → System prompts, Admin only) drive platform jobs
such as summary generation — they are **not** injected into chat bot selection.

---

## Features added

1. **Auth & access** — JWT, `/auth/me`, roles, 401 handling  
2. **Workspaces** — CRUD, team assign, folders, threads  
3. **Chat** — messages, Markdown AI replies, `@` bots, scroll/bubble layout fixes  
4. **Static memory** — upload → Markdown (PDF/DOCX/XLSX/PPTX/TXT/MD), chunks, delete originals after convert  
5. **Prompt assembly** — server-side; summary + bot + session + recent; cache key; usage logs  
6. **Session memory** — per thread; **bot selected = always**; **no bot = only important prompts**  
7. **Workspace Summary** — auto after file change; versions (last ~3) + restore; category scores  
8. **Bot models** — per-bot `capabilityType` + `model`; chat uses bot model  
9. **Platform System Prompts** — admin CRUD by use case; single `workspace_summary` (Workspace Knowledge Evaluator) drives summary scoring; Add supports future use cases  
10. **Migrations / verify** — `db:migrate`, `stage1:verify`

---

## Fixes

| Area | Fix |
|------|-----|
| Auth | Logout on refresh, AuthGuard redirects, JWT/security hardening |
| Chat UI | Markdown render, page scroll, bubble overflow, unique class names |
| Documents | Readable `.md` names, drop originals, no `.gz`, ExcelJS, OCR error, resume pending converts |
| Chat gen | Server prompt assembly; summary used instead of full files |
| Summary UI | Category scores, edit-dialog tabs/overflow; removed from sidebar |
| Models | GPT-5 `max_completion_tokens` support |
| Architecture | Separated Bots from global System Prompts (no bot assignment) |

---

## Chat context rules

| Input | In chat? |
|-------|----------|
| Workspace Summary | Yes |
| Bot prompt (`promptTemplate`) | Yes (if bot selected) |
| Platform System Prompts | No (used by summary evaluator / platform jobs only) |
| Session memory | Bot selected: always. No bot: only for important prompts |
| Static memory files | No (only when regenerating summary) |
| Recent messages + current prompt | Yes |

---

## Next / planned

- Optional `@` workspace mention  
- Image/video bot runners (media APIs)  
- OCR for scanned PDFs  
- Better retrieval (embeddings) later  
- More platform System Prompt use cases as features grow  
