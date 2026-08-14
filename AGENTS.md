# Repository Instructions for AI Agents

This file applies to the entire repository. Every AI agent must read it before changing files.

本文件适用于整个仓库。任何 AI 在修改文件前都必须完整阅读并遵守。

## 1. Start Here / 开始工作前

1. Read `README.md`, `docs/README.md`, and `docs/AI-development-guide.md`.
2. Run `git status --short --branch` and inspect the current branch and user changes.
3. Do not discard, overwrite, stash, or reformat changes whose origin is unknown.
4. Read the relevant frontend component, server type, runtime schema, storage normalizer, and tests before editing a cross-layer feature.
5. Check whether an old process is still serving port `8765` before diagnosing frontend/backend schema mismatches.

中文要求：先读文档、先查 Git 状态、保留用户修改、跨层功能必须同时调查前端和后端。遇到“前端已有选项但后端提示枚举不支持”时，先确认 `8765` 是否仍运行旧服务。

## 2. Project Facts / 项目事实

- Runtime: Node.js `>=24.12 <25`, npm workspaces, TypeScript.
- Frontend: Vue 3 + Vite in `frontend/`.
- Backend: Fastify + WebSocket + serial/TCP/UDP transports in `server/`.
- Desktop: Electron in `desktop/`; it starts the same Fastify app on a random loopback port.
- Tests: Vitest tests are under `server/test/`, including frontend pure logic and storage tests.
- Production frontend output: tracked files under `server/public/`.
- Python is not used by the current application.

Do not introduce a second communication implementation for Electron. Browser and Electron modes must continue sharing `server/src`.

## 3. Source and Build Boundaries / 源码与构建边界

- Edit Vue code only under `frontend/src/`.
- Edit server code only under `server/src/`.
- Edit Electron behavior in `desktop/src/main.ts`.
- Never manually edit hashed files in `server/public/`; run `npm run build` to regenerate them.
- `server/dist/`, `desktop/dist/`, `release/`, and `node_modules/` are ignored build/local outputs.
- `server/public/` is intentionally committed because `npm start` and packaged Electron load it.

If a frontend change is made, the completed commit must include the newly generated `server/public/index-<hash>.js`, updated `index.html`, and deletion of the obsolete hash file.

## 4. Cross-Layer Contract Checklist / 跨层协议同步

For communication settings, frame formats, generator controls, parser fields, or API payloads, inspect and usually update all applicable files:

1. `frontend/src/types.ts`
2. `server/src/core/types.ts`
3. `server/src/core/schemas.ts`
4. `frontend/src/storage.ts`
5. Relevant Vue component under `frontend/src/components/`
6. Relevant server implementation under `server/src/core/`, `server/src/http/`, or `server/src/transports/`
7. Tests under `server/test/`
8. `README.md` and, for architectural changes, `docs/AI-development-guide.md`

Only updating the frontend causes Zod API rejection. Only updating the backend can cause saved browser data to be silently rejected by frontend normalization.

## 5. Behavior That Must Be Preserved / 不可破坏的行为

- A service process owns only one active transport mode at a time.
- Serial RX records are formed by the configurable idle merge interval; TCP is a byte stream and does not preserve application frame boundaries; UDP datagrams do.
- HEX display spaces are presentation only. Stored and transmitted values remain compact business data.
- Frame preview and preset full-frame display must never overwrite raw editor/preset data.
- Frame sequence values advance only after a successful transport write. Preview and failed sends do not advance them.
- Length and CRC ranges reference field IDs, not array indexes; deleting a field must clear references to it.
- Generated-control `update` changes the value/preview; `commit` may trigger auto-send. Range-slider dragging must not send continuously.
- Float32 and Float64 are fixed at 4 and 8 bytes and use IEEE 754 with the selected byte order.
- Browser storage is untrusted input. Preserve validation, limits, defaults, legacy default-profile fallback, and per-profile isolation.
- Closing a detached presets/parser/dashboard window must restore its tab in the main window.
- Electron keeps one process per named instance, allows different named instances to run independently, and closes each instance's Fastify backend before quitting.

More detail is in `docs/AI-development-guide.md`.

## 6. Scope and Documentation / 修改范围与文档

- Keep edits focused on the requested behavior; do not bundle unrelated refactors.
- Update `README.md` with every user-visible feature, command, environment, packaging, or limitation change.
- Update `docs/AI-development-guide.md` when architecture, data flow, persistence, invariants, testing strategy, or packaging changes.
- Treat dated handoff files as historical records, not the source of current truth.
- Comments should explain non-obvious constraints, not narrate straightforward code.

## 7. Verification / 验证

Before committing a completed change, run from the repository root:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Use focused tests while iterating, but the full commands above are the handoff baseline. Tests use local loopback TCP/UDP and do not require real hardware. If timing tests fail while Electron or another server is running, stop competing project processes and retry before weakening assertions.

After runtime schema changes, verify the actual running service with a representative API request. A successful `/api/health` response alone does not prove that the process is the newly built version.

## 8. Commits / 提交规则

- Commit every completed code, configuration, or documentation change before handing off.
- 每次完成代码、配置或文档修改后，都必须在交付前创建本地 Git commit。
- Every commit message must contain both Chinese and English.
- 每条提交信息必须同时包含中文和英文。
- Keep each commit focused on one logical change.
- Never commit credentials, tokens, private keys, `.env` files, logs, runtime data, or packaged release directories.

Recommended format:

```text
type: 中文摘要 / English summary

中文：说明行为、原因和验证。
English: Describe the behavior, reason, and verification.
```

## 9. Branches, Merge, and Push / 分支、合并与推送

- Do not push commits or branches unless the user explicitly requests it.
- 除非用户明确要求，否则不要向 GitHub 推送。
- Use a dedicated branch for authentication, permissions, secrets, migrations, release/deployment configuration, core architecture, destructive behavior, or broad dependency upgrades.
- Test and commit high-risk work on that branch, then wait for explicit user approval before merging into `main`.
- Before a requested push, confirm the intended branch, fetch the remote, inspect divergence, and push only the requested branch.
- Do not merge old local feature branches merely because they exist. Several retained branches may already be ancestors of `main` and are historical references.
- Never force-push, reset hard, or delete branches/tags without explicit authorization.

## 10. Useful Commands / 常用命令

```powershell
npm install
npm run dev:server
npm run dev:frontend
npm run desktop
npm run desktop:pack
npm exec electron-builder -- --win nsis --x64
```

See `README.md` for user-facing startup and packaging instructions.
