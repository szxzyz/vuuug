---
name: CashWatch duplicate root vs server/ files
description: Root-level storage.ts/telegram.ts are dead duplicates; the real ones live in server/
---

This project (CashWatch / Paid Adz) has near-duplicate files at the repo root
(`storage.ts`, `telegram.ts`) alongside the real, actively-imported ones in `server/`
(`server/storage.ts`, `server/telegram.ts`). All runtime code (`server/index.ts`,
`server/routes.ts`, `server/auth.ts`) imports `./storage` and `./telegram` relative to
`server/`, so the root copies are unused by the running app (root `telegram.ts` may be
referenced by standalone `fix-*.js` maintenance scripts at the repo root, not the server).

**Why:** Editing the root copy first (matching the shorter/first grep hit) produced a change
that never took effect at runtime — silent no-op. Confirmed dead via `grep` for importers of
`'./storage'`/`'./telegram'` outside `server/`.

**How to apply:** Before editing `storage.ts` or `telegram.ts` in this repo, check both the
root and `server/` copies exist and confirm which one `server/index.ts`'s import chain
actually resolves to (it's the `server/` one) before making changes.
