// worktree-namespace.ts — FORWARDING re-export (tasks/gap-src-root-gate-cycle-break).
//
// The implementation moved DOWN to `core/worktree-namespace.ts`: `gate/**` used to import this src-ROOT file
// (`gate → ""`), while the src root imports gate (`"" → gate`) — together one directory-level SCC.
// Everything below the gate layer now lives in `core/`, and this path stays as the supported import
// surface for every historical consumer (tests, plugin/scripts, quay-native, docs probes).
//
// ⛔ Do not re-add implementation here: a `core/` module may not import this file, and a body kept
// here would put the src root back in the gate cycle the move removed.
export * from "./core/worktree-namespace.ts";
