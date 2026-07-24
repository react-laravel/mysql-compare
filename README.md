# MySQL Compare

A lightweight desktop / web database client (Electron + React + TypeScript) inspired by Navicat / DBeaver. It supports **MySQL**, **PostgreSQL**, and **Redis**, with first-class **SSH tunnel**, browse / edit, **schema diff**, **row-level data diff**, and data sync.

## Architecture

```
Renderer (React + Tailwind + zustand)
     │  window.api  (contextBridge, type-safe)
    ▼
Preload  (the only place using ipcRenderer)
     │  ipcMain.handle
    ▼
Main process
     ├─ ipc/         channel routing
     ├─ services/    connection / mysql / postgres / redis / ssh / schema / diff / sync
     └─ store/       electron-store + safeStorage encryption
```

The renderer NEVER touches the database drivers or SSH directly — every DB action is an IPC call.

Web mode reuses the same renderer and services behind an Express API (+ optional DogeOW SSO).

## Run

```bash
npm install
npm run dev
```

## Web Mode

Browser deployment is supported with a standalone web API server plus a Vite-built frontend.
Web mode supports either standalone HTTP Basic authentication or DogeOW one-time-ticket SSO.

Local development:

```bash
# terminal 1
export MYSQL_COMPARE_SECRET='persist-a-random-32-byte-secret'
export MYSQL_COMPARE_WEB_USERNAME='admin'
export MYSQL_COMPARE_WEB_PASSWORD='use-a-long-unique-password'
export MYSQL_COMPARE_ALLOWED_ORIGINS='http://127.0.0.1:5173'
npm run web:server

# terminal 2
npm run web:dev
```

Production build:

```bash
npm run web:build
npm run web:start
```

Detailed deployment steps and environment variables are documented in [docs/web-deployment.md](docs/web-deployment.md).

## Build

```bash
npm run dist          # current OS
npm run dist:mac      # mac dmg
npm run dist:win      # win nsis
```

## Features

### Done
- Connection CRUD with secure password storage (Electron `safeStorage` / web encrypted JSON store)
- Local MySQL / PostgreSQL / Redis + SSH tunnel (random local port, managed by `ssh-service`)
- DB / table (or Redis key) tree, search, paging / where / sort
- Row insert / edit / delete (PK-based), batch delete with confirmation
- Table structure (columns / indexes / `CREATE TABLE`); MySQL + PostgreSQL ALTER SQL
- Schema diff + row-level data diff between two SQL databases
- Sync plan preview + execute with progress log
- **FK-aware sync ordering** (topo sort by foreign keys); MySQL `FOREIGN_KEY_CHECKS`; PG batch `TRUNCATE` / `DROP … CASCADE`
- Cross-engine data sync when the target schema already exists (for example Laravel `migrate` on PostgreSQL)
- SQL console (Monaco) with selection run, Explain, open file, and recent history
- Export (CSV / TXT / SQL dump; MySQL also mysqldump / mysqldump-ssh) and import (CSV / TXT / SQL)
- SSH file manager, remote Monaco editor, and terminal
- Web mode with Basic auth or DogeOW SSO

### Redis notes
- Key browse / create / edit / delete are supported
- Diff / sync / SQL / dump export are not supported for Redis
- Key listing soft-caps at 10 000 keys (UI toast when truncated)

### Still planned
- Named/saved query bookmarks (history already keeps the last 20 per connection+database)
- JSON export format
- More auth methods (SSH agent, jump host)
- PostgreSQL multi-schema (currently pinned to `public`)
- Web SSH: directory download + drag-and-drop upload parity with Electron

## Security Notes
- Passwords / keys are encrypted via OS keychain (`safeStorage`); only ciphertext is persisted.
- Renderer cannot read decrypted secrets — only `hasPassword` flags are exposed.
- All identifiers are whitelist-validated before being interpolated into SQL.
- Destructive sync strategies require explicit user selection + a confirmation dialog.
- Cross-engine structure sync is intentionally conservative. For MySQL -> PostgreSQL, create the target schema first (for example via Laravel migrations), then use row diff + data sync.
