// fs-path.ts — THE kernel's one "realpath when it resolves, else its path.resolve form" predicate.
//
// WHY this leaf exists (tasks/gap-routine-semantic-dedup-scan-normalize-path-triple, and the eight
// earlier `semantic-dedup-scan` filings of the same body: normalize-path-realpath-or-resolve,
// normalise-path-copy, path-normalization, B2, path-normalization-3x, path-normalization-quad):
// the six-line body
//
//     try { return fs.realpathSync(p); } catch { return path.resolve(p); }
//
// was re-written under five different names in five kernel files. Every call site asks the same
// question — "is the path another producer wrote the same place as the path I derived?" — and a
// copy is a place for the two spellings to drift apart.
//
// ⛔ THIS IS NOT `packages/quay/src/core/fs-path.ts#realpathOrSelf` (a DELIBERATELY different,
// strictly wider predicate: it resolves the longest EXISTING ancestor and re-appends the remaining
// segments, so a not-yet-created path still gets its symlinked ancestors resolved). The two are
// separate on purpose:
//   · Core may not import the kernel (the `reverseEdges` ratchet), and the shipped kernel bundle's
//     `packages/quay/src` copies are inlined at BUILD time from the repo (`build-plugin-dist.mjs`
//     coreSrcAliasPlugin), so a raw-`.ts` plugin cache install has no `packages/` tree to reach.
//   · `plugin/scripts/resolve-quay-cli.ts` additionally documents itself as a consumer-copyable
//     reference implementation; keeping this helper INSIDE the plugin tree preserves that property.
// Callers whose comparison target is produced by `realpathOrSelf`/archguard (which use the wider
// form) must stay on that side — see the comment in `archguard-runner.ts`.
//
// ⛔ Never throws: an unresolvable path falls back to its `path.resolve` form, so "could not
// resolve" is never conflated with "resolved to a different place" (hard rule 3b).

import fs from "node:fs";
import path from "node:path";

/** `fs.realpathSync(p)`, falling back to `path.resolve(p)` when `p` cannot be resolved.
 *
 *  The fallback is the ABSOLUTE spelling of the given path, not a best-effort ancestor walk — this
 *  is the predicate the kernel tools have always used; the wider `realpathOrSelf` lives in Core. */
export function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
