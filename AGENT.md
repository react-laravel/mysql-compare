# MySQL Compare — Agent 指南

## 项目概述

基于 **Tauri 2 + React + TypeScript + Vite** 的桌面数据库客户端。`main` 为全 Rust 后端；完整 Electron / Web 版在 `electron` 分支。

## 技术栈

- **Shell**: Tauri 2（`src-tauri/`）
- **Backend**: Rust（sqlx MySQL/PG、redis、ssh2）
- **Frontend**: React 19 + Zustand + Tailwind CSS 4 + Monaco
- **桥接**: `src/renderer/lib/tauri-api.ts` → `invoke` / `listen`

## 目录

```text
src/renderer/           React UI
src/shared/             AppAPI / types 契约
src-tauri/src/
  commands/             Tauri commands
  drivers/              mysql / pg / redis
  ssh/                  tunnel / sftp / terminal
  diff/ sync/           对比与同步
  store/                connections + host keys
```

## 命令

```bash
npm run dev
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 规范

- 不要自动跑长驻 `tauri dev`
- 桌面不再依赖 Node sidecar / Express
- 对照 `electron` 分支行为做 parity，优先 happy path
