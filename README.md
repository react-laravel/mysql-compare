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
     └─ store/        AES-GCM secrets with an OS credential-store master key
```

## Run

```bash
npm install
npm run dev          # tauri dev
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Linux builds also need `libdbus-1-dev`. Saving or unlocking credentials requires an unlocked OS credential service: macOS Keychain, Windows Credential Manager, or a Linux Secret Service provider such as GNOME Keyring. The app reports an error if that service is unavailable and preserves existing records.

TLS, SSH fingerprint confirmation, credential migration, pagination and cancellation behavior are documented in [the reviewed fixes](docs/grok-review-2026-10-01.md).

On Unix, the Rust SSH regression tests require `ssh-keygen` and `/usr/sbin/sshd`
(install `openssh-server` on Linux). They use loopback sockets and temporary keys,
without changing your SSH configuration or saved host keys.

## Features

- Connection CRUD with encrypted secret storage
- MySQL / PostgreSQL / Redis with certificate-verified TLS or a verified SSH tunnel
- Browse / row CRUD / SQL console / EXPLAIN
- Schema + row-level data diff; sync plan + execute with progress
- SSH file manager + terminal
- Export / import (CSV / TXT / SQL; MySQL mysqldump when available)

## Notes

- Old Electron / Web deployments: use the `electron` branch.
- Unknown or changed SSH host fingerprints require native user confirmation before authentication; legacy TOFU records require confirmation once after upgrade.
- Each SSH forwarding connection verifies its host key before authentication against the key trusted by the tunnel's initial probe; a changed key is rejected.
- Re-enter passwords when migrating from Electron `safeStorage` (new key file format).

## Regression checks

```bash
npm run typecheck
npm test
npm run build:ui
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
python3 scripts/test-data-contracts.py
```

The database contract runner starts disposable MySQL and PostgreSQL servers on
loopback ports, tests value round trips, export scopes and 100,000-row comparisons,
then stops the servers and removes their temporary data. On macOS it uses Homebrew
MySQL and PostgreSQL 14; set `MYSQL_COMPARE_MYSQL_BIN` / `MYSQL_COMPARE_PG_BIN` to use
other binary directories. CI runs the same contracts against isolated service containers.

SQL results are bounded to 10,000 rows per result and 16 MB per execution and show
a truncation indicator. Bulk comparison, sync and export use bounded batches;
comparison may use temporary disk space. Cross-engine schema sync is rejected;
data-only sync requires existing target tables. Schema metadata used for paging
is cached for up to 15 seconds and invalidated by local write/DDL operations.
