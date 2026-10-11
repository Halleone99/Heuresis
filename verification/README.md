# Local verification harness

Used to verify the learning workspace end to end without touching the real
Supabase project. It is **not** part of the app build and adds no app dependency.

What it runs against:

* **PostgreSQL 15+** with every migration in `../supabase/migrations/`, on top of a
  small stub of Supabase's platform (`sql/00_supabase_stub.sql`: API roles,
  `auth.uid()`, `auth.users`, storage tables, and the two Personal OS tables the
  app reads).
* **PostgREST 12** (the same server Supabase uses) with real row-level security,
  column grants, triggers and constraints.
* `gateway.mjs` — a tiny stand-in for Supabase Auth (password + refresh grants,
  `/user`, `/logout`) that also proxies `/rest/v1` to PostgREST. It can inject
  write failures via `/__test/fail-writes?n=1`.
* The real app (`npx vite`) in Chromium via Playwright.

## Run

```bash
cd verification
npm install                      # Playwright only
# put a PostgREST 12 binary at ./postgrest
PGBIN=/usr/lib/postgresql/16/bin ./setup.sh   # as a non-root user
node gateway.mjs &               # http://localhost:54321
(cd .. && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 1421) &
./run-all.sh                     # sign-in: thomas@example.test / heuresis
```

Database snapshots created by `setup.sh`:

| Snapshot | Contents |
| --- | --- |
| `heuresis_v1_baseline` | All migrations **before** `20261012090000_knowledge_workspace_v2.sql`, plus a small Study library |
| `heuresis_v2_baseline` | The same after the v2 migration (applied twice to prove idempotency) |
| `heuresis_showcase` | v2 plus notes, lessons, mistakes and practice history used for screenshots |

`./db.sh restore <snapshot>` resets the working database between suites.

## Suites

| File | Covers |
| --- | --- |
| `tests/e2e1.mjs` | Workflows 1–10: sign-in, five sections, subject/topic/sub-topic, Ctrl+Shift+N capture while typing elsewhere, draft survival across restart, open/edit/autosave, lesson via Ctrl+Shift+L, captures attached to the lesson, reopen after restart |
| `tests/e2e2.mjs` | Workflows 11–17: mistake without correction → clarify later, recall with same-day protection, search → exact note, Back, delete + confirmation + undo, Study library/topic/card search/restore after restart, six window sizes, offline capture → reconnect → server |
| `tests/e2e3.mjs` | Wiki links and backlinks, make-a-flashcard through `createCard`, move a note, rename/delete topics (non-empty refused), organise lesson captures, Overview links, Alt+digit, theme persistence |
| `tests/e2e4.mjs` | Capturing from inside the editor returns focus and caret; empty new note discarded; first save of a new note then continued editing (no duplicates) |
| `tests/e2e5.mjs` | Editor: `#`/`-`/`1.` shortcuts, Example block, exiting a block, italic, multi-line paste with lists, source view round trip |
| `tests/e2e6.mjs` | Continuity: a remembered note moved or deleted on another device while the app was closed; 30 rapid section switches |
| `tests/v1mode.mjs` | Behaviour before the v2 migration: read-only Notebook with a notice, legacy notes readable, nothing written, Study unaffected |
| `tests/format.mjs` | Markdown ⇄ editor HTML round trip for representative notes |
| `tests/tour.mjs` | Screenshots: `node tests/tour.mjs <dir> <width> <height> <light|dark>` |
| `sql/mig_checks.sql` | Direct SQL checks of the v2 constraints, triggers, grants and RLS (instructions in the file header) |

Set `CHROMIUM_PATH` to use a specific Chromium build.
