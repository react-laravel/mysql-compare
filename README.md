# MySQL Compare

Lightweight desktop database client (**Tauri 2 + Rust + React**) inspired by Navicat / DBeaver. Supports **MySQL**, **PostgreSQL**, and **Redis**, with **SSH tunnel**, browse / edit, **schema diff**, **row-level data diff**, and data sync.

> **Branches:** `main` = full Rust / Tauri desktop. Electron + Web (Express) live on the `electron` branch.

## Architecture

```
Renderer (React + Tailwind + zustand)
     │  invoke / events  (tauri-api)
    ▼
Tauri shell (Rust)
     ├─ commands/     AppAPI surface
     ├─ drivers/      mysql / postgres / redis (sqlx + redis)
     ├─ ssh/          tunnel / sftp / terminal / host keys
     ├─ diff/ + sync/ schema & data compare, FK-ordered sync
     └─ store/        AES-GCM encrypted connection secrets
```

## Run

```bash
npm install
npm run dev          # tauri dev
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Features

- Connection CRUD with encrypted secret storage
- MySQL / PostgreSQL / Redis + SSH tunnel
- Browse / row CRUD / SQL console / EXPLAIN
- Schema + row-level data diff; sync plan + execute with progress
- SSH file manager + terminal
- Export / import (CSV / TXT / SQL; MySQL mysqldump when available)

## Notes

- Old Electron / Web deployments: use the `electron` branch.
- First-time SSH hosts use TOFU (trust on first use) host-key storage.
- Re-enter passwords when migrating from Electron `safeStorage` (new key file format).
