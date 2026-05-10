# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TrentCAD

A desktop CAD collaboration tool built for FRC Team 2129. Wraps Git LFS with a user-friendly UI so SolidWorks users can share files without learning Git. Uses check-out/check-in (lock-based) collaboration like GrabCAD Workbench. GitHub is the Git host.

## Build Commands

```bash
npm run dev        # Start Electron dev server with hot reload
npm run build      # Production build (outputs to out/)
npm run package    # Build + create installer (outputs to dist/)
```

## Architecture

**Electron app** with three processes:
- **Main process** (`src/main/`) — Git operations, file locking, file watching, IPC handlers
- **Preload** (`src/preload.ts`) — Bridges main ↔ renderer via `contextBridge`
- **Renderer** (`src/renderer/`) — React UI

**Key main process modules:**
- `git.ts` — All Git/LFS operations (create, clone, sync, publish, status, history). Uses `simple-git` npm package.
- `locking.ts` — Check-out/check-in via `git lfs lock`/`unlock`
- `ipc.ts` — All `ipcMain.handle()` registrations + chokidar file watcher
- `config.ts` — App config (recent projects) persisted in Electron userData

**Renderer:**
- `hooks/useGit.ts` — Single hook managing all project state and IPC calls
- Components: `ProjectSetup` (create/join/open wizard), `ProjectBrowser` (full-width file table with Name/Status/Checked Out By columns), `Toolbar` (sync/publish/check-out/check-in), `ActivityFeed` (collapsible bottom panel), `DetailsPanel` (right sidebar for selected file info)

**Shared types** in `src/shared/types.ts` — used by both main and renderer.

## Git-to-CAD Terminology

This project deliberately hides Git terminology. In code and UI:
- Repository → Project
- Clone → Join Project
- Pull → Sync
- Commit + Push → Publish
- git lfs lock → Check Out
- git lfs unlock → Check In
- git log → History

## UI Layout

The file browser is the central element (full-width table, not a sidebar tree). Right side has a details panel for the selected file. Activity feed is a collapsible panel at the bottom. Status bar at the very bottom shows counts of modified/locked files.

## Tech Stack

- Electron + React + TypeScript
- electron-vite (Vite-based build)
- simple-git (Git CLI wrapper)
- chokidar (file watching)
- electron-builder (packaging)
- @vitejs/plugin-react v4 (must stay v4 for electron-vite/vite 6 compat)

## Dev Notes

- On Linux, run with `ELECTRON_DISABLE_SANDBOX=1` (already set in the dev script)
- `simple-git`'s `.add()` only accepts file paths — use `.raw(['add', '-A'])` for staging all
- Lock state takes priority over modified state in `getStatus()` so lock indicators always show

## Future Phases (not yet implemented)

- Phase 2: Part numbering system (parts.json manifest, configurable format)
- Phase 3: SolidWorks C# add-in communicating via local REST API
- Phase 4: Google Drive one-way sync (Git → Drive mirror)
