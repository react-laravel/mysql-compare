# MySQL Compare

A lightweight desktop database compare client (Electron + React + TypeScript) inspired by Navicat / DBeaver. It now supports **MySQL and PostgreSQL** connections, with first-class **SSH tunnel**, browse / edit, **schema diff**, **row-level data diff**, and data sync.

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
     ├─ services/    connection / mysql / postgres / ssh / schema / diff / sync
     └─ store/       electron-store + safeStorage encryption
```

The renderer NEVER touches the database drivers or SSH directly — every DB action is an IPC call.

## Run

```bash
npm install
npm run dev
```

## Web Mode

Browser deployment is now supported with a standalone web API server plus a Vite-built frontend.

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

## Phase 1 (MVP, done)
- Connection CRUD with secure password storage (Electron `safeStorage`)
- Local MySQL / PostgreSQL + SSH tunnel (random local port, managed by `ssh-service`)
- DB / table tree, table search, table data with paging / where / sort
- Row insert / edit / delete (PK-based), batch delete with confirmation
- Table structure (columns / indexes / `CREATE TABLE`)
- Schema diff between two databases (any two connections)
- Row-level data diff with PK-based pairing and sample mismatches
- Sync plan preview + execute with progress log + multiple existing-table strategies
- Cross-engine data sync for workflows where the target schema already exists (for example Laravel `migrate` on PostgreSQL)

## Phase 2 (planned)
- Foreign-key aware sync ordering
- SQL editor tab (Monaco) and query result tab
- Export (CSV / JSON / SQL dump) and import
- Saved query history
- More auth methods (SSH agent, jump host)

## Security Notes
- Passwords / keys are encrypted via OS keychain (`safeStorage`); only ciphertext is persisted.
- Renderer cannot read decrypted secrets — only `hasPassword` flags are exposed.
- All identifiers are whitelist-validated before being interpolated into SQL.
- Destructive sync strategies require explicit user selection + a confirmation dialog.
- Cross-engine structure sync is intentionally conservative. For MySQL -> PostgreSQL, create the target schema first (for example via Laravel migrations), then use row diff + data sync.
