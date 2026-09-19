// write-json-atomic.ts — MIRROR PAIR of plugin/scripts/write-json-atomic.ts
// (tasks/gap-arch-reverse-edges-zero).
//
// The single atomic JSON-file write now lives at `packages/quay/src/kernel/write-json-atomic.ts`
// (see that file for the full reachability argument and the single-implementation rationale). The
// plugin copy is a re-export of it; THIS copy is the same re-export with the RELATIVE PATH CORRECTED
// FOR ITS OWN DIRECTORY DEPTH — `experiments/quay-perpetual-stream/scripts/` is one level deeper
// than `plugin/scripts/`, so the repo root is one `../` further up.
//
// ⛔ That is the ONLY difference between the two copies, and it is structural, not semantic: the
// pair is registered in plugin/scripts/mirror-pair-drift-allowlist.json with the same
// path-depth reason the `tree-hygiene-check.sh` / `worktree-branch-hygiene-check.sh` pairs carry.
// Byte-identity is the WRONG invariant for a file whose correctness is depth-dependent; a future
// edit to EITHER side re-trips mirror-pair-drift-check (the exemption is re-checked against the
// recorded sha256s, never a one-shot pass).
//
// This copy is CONSUMED, not decorative: experiments/quay-perpetual-stream/test/
// write-json-atomic.test.mjs imports `../scripts/write-json-atomic.ts`, so the depth-correct
// prefix above is load-bearing.

export * from "../../../packages/quay/src/kernel/write-json-atomic.ts";
