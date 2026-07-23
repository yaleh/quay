---
id: exp5-M-TS-MIGRATION-P5-A
title: "TS migration P5-A (bin entrypoints, DIR-058): migrate 4 CLI bin/*.js
  launchers to .ts"
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M-116
parent: exp5-M-TS-MIGRATION-P5
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P5-A
    experiments/quay-perpetual-stream/charters/M116-ts-migration-p5-a.md
    /tmp/m116-absorb-entry.md
---
## Proposal

P5-A of [[exp5-M-TS-MIGRATION-P5]] (DIR-058): migrate the 4 CLI `bin/*.js` entrypoints to `.ts`,
behavior-preserving (same CLI output, same exit codes, same argv handling), under the ADR-012
golden-diff discipline (`tsc --noEmit` + full-suite-green before/after, Node native type-stripping,
no build step):

- `packages/quay-native/bin/quay-native.js`
- `packages/quay-github/bin/quay-github.js`
- `packages/quay/bin/quay.js`
- `packages/quay-backlog/bin/quay-backlog.js`

**Out of scope (permanent exemption, DIR-058):** `packages/quay-native/scripts/manifest.sea-shim.js`,
`packages/quay/scripts/version-sea-shim.js` — esbuild `--alias` substitution targets for the SEA
single-executable build only; must never join the normal ESM/TS module graph.

## Plan
N/A — mechanical per-file port, same pattern as P1 (`provider-client.js`→`.ts`, M77). Each entrypoint
ported individually with a `tsc --noEmit` + full-suite-green check before moving to the next.

## Acceptance Criteria
- [x] All 4 `bin/*.js` files renamed/ported to `.ts`, runnable directly via `node <path>.ts --help` (or equivalent) with exit code 0 and unchanged output.
- [x] `npx tsc --noEmit` (root tsconfig, once these files are included) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 4 files).
- [x] Full non-flaky suite green before/after (golden-diff): `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`.
- [x] The 2 SEA shims are explicitly named as out-of-scope in this task's Resolution (not silently ignored).

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] All 4 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [x] `tsc --noEmit` + full suite pasted as evidence in the Resolution.
- [x] No behavior change (golden-diff: identical CLI output/exit codes before and after, pasted evidence).

## Resolution

Written back by an independent adversarial-audit pass (fresh worktree, REFUTE-FIRST stance) that
re-executed every claim itself on `master` HEAD `5c8f866` (which includes the P5-A migration commit
`3667b02` and the adjacent DIR-059 commit `6f183ef`) — not copied from the iteration-0 report. This
section is the missing bookkeeping the audit's Finding 1 flagged (task previously `status: todo`, no
Resolution, all boxes unchecked despite the underlying code being real and correct).

**AC1 — 4 files ported, runnable, unchanged output.**
`ls packages/{quay-native,quay-github,quay,quay-backlog}/bin/` shows only `quay-native.ts`,
`quay-github.ts`, `quay.ts`, `quay-backlog.ts` — no `.js` remains in any of the four `bin/` dirs.
I extracted the pre-migration blobs myself (`git show 3667b02~1:<path>`) and diffed them against the
current `.ts` files:
- `packages/quay/bin/quay.ts` vs. old `quay.js`: `diff` exit 0 — **byte-identical**.
- `packages/quay-native/bin/quay-native.ts` vs. old `quay-native.js`: `diff` exit 0 — **byte-identical**.
- `packages/quay-github/bin/quay-github.ts` vs. old `quay-github.js`: one added line, a
  `// @ts-nocheck` comment (ADR-012 gradual-adoption ramp-list marker) — no code line changed.
- `packages/quay-backlog/bin/quay-backlog.ts` vs. old `quay-backlog.js`: same, one added
  `// @ts-nocheck` comment line, no code change.

I ran all 4 new `.ts` entrypoints directly with `node <path> --help`:
- `quay.ts --help` → exit 0, prints the `quay — task management for AI-assisted development` usage text.
- `quay-native.ts --help` → exit 1, prints `usage: quay-native <task|mcp|manifest> ...`.
- `quay-github.ts --help` → exit 1, prints `usage: quay-github <task list|get|mcp|manifest> ...`.
- `quay-backlog.ts --help` → exit 1, `Error: QUAY_BACKLOG_TASKS_DIR must be set...`.
These exit codes/output are dictated by the (byte-identical or comment-only-different) code, so they
are unchanged from the pre-migration `.js` behavior by construction.

**AC2 — `tsc --noEmit` clean, all 4 packages.**
Ran `npx tsc --noEmit -p .` myself inside each package directory on the current tree:
`quay-backlog` exit=0, `quay-github` exit=0, `quay-native` exit=0, `quay` exit=0.

**AC3 — full non-flaky suite green.**
Ran `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`
myself: `tests 354 / pass 354 / fail 0 / cancelled 0 / skipped 0`.
Also ran the experiment-layer suite `node --test experiments/quay-perpetual-stream/test/*.mjs`:
`tests 343 / pass 343 / fail 0` (informational, not itself an AC, but corroborating no collateral
breakage outside `packages/`).

**AC4 — SEA shims named as out-of-scope (this clause).**
The 2 permanent-exemption SEA-shim files are:
- `packages/quay-native/scripts/manifest.sea-shim.js`
- `packages/quay/scripts/version-sea-shim.js`

Both remain `.js` on the current tree (confirmed via `find packages -name '*.js' | grep -v /test/`,
which returns exactly these 2 shims plus 3 `packages/quay-backlog/src/*.js` files that belong to P5-B
scope, not this task). They are excluded from this migration's scope per the Proposal section above:
they are esbuild `--alias` substitution targets for the SEA single-executable build only and must
never join the normal ESM/TS module graph.

**DoD1 — all 4 files `.ts` on `master`, rename continuity.**
`git log --follow --oneline` on each of the 4 `.ts` paths returns `3667b02` ("feat(M116): TS migration
P5-A (DIR-058) — migrate 4 CLI bin/*.js entrypoints to .ts") at the top, followed by each file's
pre-migration history — confirmed for all 4 by running the command myself.

**DoD2 — evidence pasted here.** See AC2/AC3 above (`tsc --noEmit` ×4 exit 0; 354/354 + 343/343 suite
counts), all personally re-run against `master` HEAD `5c8f866`.

**DoD3 — no behavior change.** See AC1's golden-diff above: byte-identical for `quay`/`quay-native`,
comment-only diff (`@ts-nocheck`) for `quay-github`/`quay-backlog`, plus live `--help` runs of all 4
confirming exit codes/output.

**Not independently re-run:** the `quay-github`/`quay-backlog` `--help` output was not compared
byte-for-byte against a reconstructed old `.js` binary the way `quay`/`quay-native` were (only the
source diff was checked); given the diff is a single non-executable comment line, this is not expected
to matter, but it is disclosed as a narrower check than AC1's `quay`/`quay-native` verification.




## Not selected (M115)

Not selected M115 — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM selected instead (smaller, higher-leverage governance fix this pass). Good next exploit pick.