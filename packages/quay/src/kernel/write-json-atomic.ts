// write-json-atomic.ts — the single atomic JSON-file write for every state writer.
// (tasks/gap-writestate-atomicity-split; moved to kernel/ by tasks/gap-arch-reverse-edges-zero)
//
// WHY A SINGLE IMPLEMENTATION: six state writers had split into two camps — two atomic
// (tmp + renameSync: driver-shared.ts writeControlState, inner-blocked-signal.ts
// writeRulingObserverState) and four non-atomic (direct writeFileSync: mirror-full-suite-state.ts
// writeMirrorState, red-window-triage.ts writeState, runner-state-write.ts writeState,
// suite-state-trigger.ts writeSuiteState) — and the split itself was invisible to any check.
//
// ── 2026-10-25: THE SPLIT WAS STILL PARTIALLY OPEN, AND THAT HALF IS NOW CLOSED ───────────────────
// `.quay/routine-findings.jsonl` finding `write-state-atomic-split` (routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1792940684375`) found one behaviour with THREE implementations still live:
// two more inline copies of the tmp+rename idiom (ci-runs-collect.ts writeState, driver-anchor.ts
// writeState) plus one plainly non-atomic writer (meta-driver.ts writeState — bare writeFileSync, so a
// concurrent reader could see a zero-length/half-written `.quay/meta-driver-state.json` and fall back to
// never-judged). All three now delegate here, as do two sibling read-back carriers in the same files
// (driver-anchor.ts writeTakeoverRecord, meta-driver.ts's action-record scan carrier — hard rule 5b:
// the named instance is not the only applicable point). The "single implementation" invariant is pinned
// by `plugin/test/writestate-single-implementation.test.mjs`, which fails if an inline tmp+rename or a
// plain JSON writeFileSync reappears in any of those writers.
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
