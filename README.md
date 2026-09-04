# Heuresis

Standalone desktop application for learning, capture and review.

## Architecture

- React + Vite frontend
- Tauri 2 desktop shell
- Existing Supabase project remains the source of truth
- Heuresis writes directly to the existing `heuresis_*` tables
- Capture creates real `heuresis_cards` rows; it does not use the legacy Personal OS `knowledge_entries` workflow

## First milestone

1. Desktop shell boots independently of Personal OS.
2. Supabase session can be established and persisted.
3. Existing collections and packs can be read.
4. Capture can create a card directly in a selected Heuresis pack.
5. Existing Heuresis UI is migrated progressively after the data boundary is verified.

## Local setup

Create `.env` from `.env.example`, install dependencies, then run:

```bash
npm install
npm run tauri dev
```

For the same Windows ARM64 target used by Engines:

```bash
rustup target add aarch64-pc-windows-msvc
npm run tauri build -- --target aarch64-pc-windows-msvc
```

Do not put Supabase service-role or secret keys in this desktop app. Only the publishable client key belongs in `VITE_SUPABASE_PUBLISHABLE_KEY`.
