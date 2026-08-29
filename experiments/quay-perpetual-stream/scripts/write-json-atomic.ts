// write-json-atomic.ts — the single atomic JSON-file write for every state writer.
// (tasks/gap-writestate-atomicity-split)
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
