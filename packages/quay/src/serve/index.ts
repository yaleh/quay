// serve/index.ts — the single entry point of the web/HTTP surface subpackage.
//
// WHY THIS FILE EXISTS (gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src):
// the 24 `serve*` / `server-state` modules used to sit FLAT in `packages/quay/src/`, while
// `cli/`, `core/`, `gate/` and `kernel/` were real subpackages. A new reader scanning `src/`
// could not tell the web surface from the Core library, and `src/` carried 52 top-level files.
// The move is PURE RELOCATION: no module's exports, behaviour, or import graph changed — only
// the directory they live in (and therefore the specifiers that reach them).
//
// SPLIT (gap-routine-architecture-analysis-god-package-serve-fanout-556, 2026-10-26): the flat
// relocation above moved the god package rather than splitting it — archguard then flagged
// `quay/src/serve` ITSELF (fanOut=556, 25 files, 285 entities, 15,687 lines). The surface is now
// five cohesive subpackages, so no single package carries the whole graph:
//   view/   — presentation: i18n table, language, HTML render, dashboard, binding policy
//   pages/  — page handlers: board, live, needs-human, system
//   io/     — I/O + transport: git, sessions, send, snapshot store
//   feat/   — feature handlers: task, tests, goal
//   docs/   — docs surface: adr, architecture, doc
// serve.ts stays the router (setup + server lifecycle), serve-handlers.ts the route dispatcher.
// The move is PURE RELOCATION: no module's exports, behaviour, or import graph changed — only
// the directory they live in (and therefore the specifiers that reach them).
//
// ⛔ Do not import from this barrel inside the moved modules themselves. They import each other
// by exact specifier (`../view/serve-render.js`), which keeps the intra-package graph explicit
// and avoids a barrel cycle. This file is for callers OUTSIDE `src/serve/` that want the surface
// as one unit; it is not on any hot path.
//
// `export *` (not a curated list): the point of the move is that the surface is ONE thing. A
// hand-maintained re-export list would drift the moment a module gains an export, and drift
// here is silent (the symbol is simply absent). The typecheck is what proves the barrel whole.

export * from "../core/server-state.js";
export * from "./serve.js";
export * from "./docs/serve-adr.js";
export * from "./docs/serve-architecture.js";
export * from "./view/serve-binding.js";
export * from "./pages/serve-board.js";
export * from "./view/serve-dashboard.js";
export * from "./docs/serve-doc.js";
export * from "./io/serve-git.js";
export * from "./feat/serve-goal.js";
export * from "./serve-handlers.js";
export * from "./serve-heap-cap.js";
export * from "./serve-http-json.js";
export * from "./view/serve-i18n.js";
export * from "./view/serve-lang.js";
export * from "./pages/serve-live.js";
export * from "./serve-log.js";
export * from "./pages/serve-needs-human.js";
export * from "./view/serve-render.js";
export * from "./io/serve-send.js";
export * from "./io/serve-sessions.js";
export * from "./pages/serve-system.js";
export * from "./feat/serve-task.js";
export * from "./feat/serve-tests.js";
