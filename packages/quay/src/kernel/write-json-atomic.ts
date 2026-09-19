// write-json-atomic.ts — the single atomic JSON-file write for every state writer.
// (tasks/gap-writestate-atomicity-split; moved to kernel/ by tasks/gap-arch-reverse-edges-zero)
//
// WHY A SINGLE IMPLEMENTATION: six state writers had split into two camps — two atomic
// (tmp + renameSync: driver-shared.ts writeControlState, inner-blocked-signal.ts
// writeRulingObserverState) and four non-atomic (direct writeFileSync: mirror-full-suite-state.ts
// writeMirrorState, red-window-triage.ts writeState, runner-state-write.ts writeState,
// suite-state-trigger.ts writeSuiteState) — and the split itself was invisible to any check.
// This module is the ONE atomic write: serialize to a unique temp file in the SAME directory,
// then renameSync it over the target. rename(2) is atomic on POSIX, so a concurrent reader sees
// either the previous complete file or the new complete file — never a torn, half-written JSON.
//
// Absorbed proposal-convergence.ts's private _atomicWriteJson (the same tmp-then-rename idiom);
// the only behavioral delta vs that private copy is a trailing newline, which every JSON.parse
// reader already tolerates (see _readCheckpointRecord / _readEpochRecord).
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// BOTH layers consume it and neither may depend on the other:
//   · PRODUCT side (L1, `packages/**`): serve.ts / server-state.ts import it directly. Before this
//     file moved, those imports pointed at `plugin/scripts/write-json-atomic.ts` — a `packages/**`
//     → `plugin/**` edge, i.e. the product reverse-importing the mechanism layer. The dist bundle
//     resolved it only because esbuild INLINED the plugin file (`build-dist.mjs`'s
//     `bundleNodePaths` docstring named that inlining as the reason for its extra node_modules
//     root). A kernel home makes the product's dependency an in-package one.
//   · MECHANISM side (L2/L3, `plugin/scripts/**`): `driver-shared.ts` and the suite/state writers
//     import it too. They reach it as a FORWARD edge (`plugin/` → `packages/`) through the
//     re-export at `plugin/scripts/write-json-atomic.ts`, so no caller's import site changes.
// A kernel file may import nothing outside `kernel/` except bare specifiers (node:*, npm) — this
// one imports only `node:fs` / `node:path` / `node:crypto`. Checked by
// `plugin/scripts/import-graph-check.ts` (the conditional fourth rule: `kernelChecked`).

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write `value` to `p` as pretty-printed JSON, atomically: serialize to a unique temp file in
 * `p`'s own directory, then renameSync it over `p`. The temp file shares `p`'s filesystem (a
 * cross-device rename is not atomic), and the random suffix prevents two concurrent writers of the
 * same path from clobbering each other's temp file.
 * @template T
 * @param {string} p  target file path; parent directories are created (mkdirSync recursive)
 * @param {T} value  any JSON-serializable value
 */
export function writeJsonAtomic<T>(p: string, value: T): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}
