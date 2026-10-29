// loaded-version.ts — FORWARDING re-export (tasks/gap-routine-architecture-analysis-core-src-flat-root-god-modules).
//
// The implementation moved DOWN to `core/loaded-version.ts`. Why: the same directory-SCC rule that
// produced `config.ts`'s shim (tasks/gap-src-root-gate-cycle-break). `packages/quay/src/init/` now
// holds init's phase modules; `init.ts` (src ROOT) imports `./init/*` (`"" → init`), so a phase
// module importing a src-ROOT implementation would close `init ↔ ""` — measured, not predicted: the
// first version of that split made `archguard-runner` report `directoryCycleCount=1, modules=["init",""]`.
//
// The module is a Core reading by its own header ("为什么在 Core 而不是内核里") and imports only
// `kernel/` + `core/` modules, so moving the body down adds no edge back up.
//
// This path stays the supported import surface for every historical consumer (tests,
// `plugin/scripts`, `cli/server.ts`). ⛔ Do not re-add implementation here: a `core/` or `init/`
// module may not import this file, and a body kept here would put the src root back into the cycle.
export * from "./core/loaded-version.ts";
