// write-json-atomic.ts — OLD-PATH RE-EXPORT (tasks/gap-arch-reverse-edges-zero).
//
// The single atomic JSON-file write now lives at `packages/quay/src/kernel/write-json-atomic.ts`
// (see that file for the full reachability argument and the single-implementation rationale). This
// path is kept as a re-export for one release cycle so that:
//   · every mechanism-side import site (`./write-json-atomic.ts` in driver-shared.ts, the
//     suite/state writers, the tests) keeps resolving unchanged, and
//   · in-flight worktrees / other checkouts that still spell this path do not break mid-flight.
// The direction is plugin → kernel, NEVER the reverse: a `kernel` file re-exporting from here would
// re-create the `packages/**` → `plugin/**` reverse edge this move exists to remove, and
// `plugin/scripts/import-graph-check.ts` would read it as a regression.
//
// ⛔ Do not add logic here — a second implementation on this path is exactly the drift the single
// implementation exists to prevent. It ships self-contained: build-plugin-dist's `coreSrcAliasPlugin`
// re-points `packages/quay/src/**` specifiers from plugin sources onto the real Core source tree and
// inlines them (`dist/write-json-atomic.js`), so a consumer needs no `packages/` tree.

export * from "../../packages/quay/src/kernel/write-json-atomic.ts";
