// serve/index.ts — the single entry point of the web/HTTP surface subpackage.
//
// WHY THIS FILE EXISTS (gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src):
// the 24 `serve*` / `server-state` modules used to sit FLAT in `packages/quay/src/`, while
// `cli/`, `core/`, `gate/` and `kernel/` were real subpackages. A new reader scanning `src/`
// could not tell the web surface from the Core library, and `src/` carried 52 top-level files.
// The move is PURE RELOCATION: no module's exports, behaviour, or import graph changed — only
// the directory they live in (and therefore the specifiers that reach them).
//
// ⛔ Do not import from this barrel inside the moved modules themselves. They import each other
// by exact specifier (`./serve-render.js`), which keeps the intra-package graph explicit and
// avoids a barrel cycle. This file is for callers OUTSIDE `src/serve/` that want the surface
// as one unit; it is not on any hot path.
//
// `export *` (not a curated list): the point of the move is that the surface is ONE thing. A
// hand-maintained re-export list would drift the moment a module gains an export, and drift
// here is silent (the symbol is simply absent). The typecheck is what proves the barrel whole.

export * from "../core/server-state.js";
export * from "./serve.js";
export * from "./serve-adr.js";
export * from "./serve-architecture.js";
export * from "./serve-binding.js";
export * from "./serve-board.js";
export * from "./serve-dashboard.js";
export * from "./serve-doc.js";
export * from "./serve-git.js";
export * from "./serve-goal.js";
export * from "./serve-handlers.js";
export * from "./serve-heap-cap.js";
export * from "./serve-http-json.js";
export * from "./serve-i18n.js";
export * from "./serve-lang.js";
export * from "./serve-live.js";
export * from "./serve-log.js";
export * from "./serve-needs-human.js";
export * from "./serve-render.js";
export * from "./serve-send.js";
export * from "./serve-sessions.js";
export * from "./serve-system.js";
export * from "./serve-task.js";
export * from "./serve-tests.js";
