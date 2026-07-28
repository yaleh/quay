---
id: DIR-120-B
title: "DIR-120 Phase 3b: fix drivable-workspace-check.ts's layering inversion —
  remove DEFAULT_REGISTRY_PATH, require explicit --registry, symlink the
  experiments mirror, fix selftest's silent-skip risk"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-120
children: []
extra:
  dirStatus: applied
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-120-B
    experiments/quay-perpetual-stream/charters/M194-dir120b-drivable-workspace-check-fix.md
    milestones/M194/absorb-entry.md
---

**type:** execution

## Proposal

`plugin/scripts/drivable-workspace-check.ts`'s `DEFAULT_REGISTRY_PATH = path.join(__dirname, "..",
"drivable-workspaces.yml")` is a directory-relative guess correct from only one of its two live
locations. From `plugin/scripts/` it resolves to `plugin/drivable-workspaces.yml`, confirmed
absent — the real registry lives only at `experiments/quay-perpetual-stream/
drivable-workspaces.yml`, one directory up from the (currently non-symlinked, byte-identical)
copy at `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts`, where the same
relative expression happens to resolve correctly by accident of location, not by design. This is
latent, not actively broken in production, because no real task in this repo's history sets
`extra.drivableWorkspaceArgs` (`grep -rl drivableWorkspaceArgs tasks/` matches only prose).

Fix: remove `DEFAULT_REGISTRY_PATH` entirely (not relocate it — relocating just re-encodes the same
one-fixed-path assumption at the currently-correct answer instead of the currently-wrong one).
`--registry <path>` becomes a required CLI flag; an omitted `--registry` becomes a clean usage
error (exit 2), replacing today's latent `ENOENT`-shaped `DrivableCheckEnvError`. Convert
`experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` to real symlinks
pointing at the `plugin/scripts/` originals (the same shape `config-wiring-check.ts` already uses,
confirmed real symlink today). Because the constant's removal has two independent, structurally
different downstream consumers, each needs its own fix and its own AC line (DIR-117 mechanism-claim
discipline — folding them into one "stays green" claim would let either half regress unnoticed):

- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` imports `DEFAULT_REGISTRY_PATH`
  but never uses the binding (a dead import, confirmed via grep) — removing the export turns this
  into a **compile-time** `SyntaxError` the instant the module graph loads, breaking every SELECT
  cycle. Fix: delete the dead import.
- `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts`'s `main()` does `let
  registryPath = DEFAULT_REGISTRY_PATH` as a live **runtime** default when `--registry` is omitted
  — removing the export turns this into `undefined`, surfacing only at call time. Fix: require an
  explicit `--registry` before calling `loadRegistry`, matching `drivable-workspace-check.ts`'s own
  new required-flag behavior.

Separately, `drivable-workspace-check.ts`'s own `selftest()` gates its three "real-registry-*"
assertions behind `fs.existsSync(DEFAULT_REGISTRY_PATH)` today — once that constant is removed,
this guard must be re-derived so a run can prove each of the three actually executed (not silently
skipped while an aggregate "all fixture cases PASS" line still reports success over strictly less
real coverage).

Finally, `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` — confirmed
**not** covered by `scripts/test.sh`'s glob (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`) —
currently relies on `DEFAULT_REGISTRY_PATH` resolving correctly only because this copy's
`__dirname` happens to sit one directory below the real registry; once it becomes a symlink,
`__dirname` resolves to `plugin/scripts/` and this breaks regardless of the constant's removal. All
of the above (symlink conversion, constant removal, both consumer fixes, this test's own rewrite)
must land in one atomic change and this file must be re-run directly, since no existing canonical
suite run is evidence for it.

`.quay/config.yml`'s `gates.it0` list already registers a real `drivable-workspace` gate entry
(`argsKey: drivableWorkspaceArgs`) — wired, not dead configuration, but never fed by any real task.
This milestone records an explicit sign-off that this chain stays end-to-end-unexercised (no real
task sets `drivableWorkspaceArgs`; manufacturing one solely to poke this path is the same
self-celebratory-fixture pattern this repo's own convention rejects elsewhere), not a silent
omission.

## Plan

N/A — directive resolved via a human-steered milestone. Split from `tasks/DIR-120.md` (DIR-026
SPLIT-OR-COMMIT, 2026-07-28) after 5+ independent, real findings across `prepare-milestone.js`'s
actual ProposalReview rounds all traced to this same sub-area — a self-contained unit of work
(fix one script's layering inversion plus its two downstream consumers plus its own out-of-glob
test), distinct in kind from Phase 2/3a's "delete legacy config files" scope, which DIR-120 itself
keeps.

## Finding

Carried over from `tasks/DIR-120.md`'s own original Finding #4 ("层次倒置: `drivable-workspaces.yml`
实际位于 `experiments/quay-perpetual-stream/` 下，但读它的 `drivable-workspace-check.sh` 是
`plugin/scripts/` 里的产品级 gate") plus real code reads performed during this session's
`prepare-milestone.js` dispatches against DIR-120 (before the Phase 3b split) — see the Proposal
above for the grounded, line-cited detail (all independently re-verified across multiple real
review rounds, not speculation).

## Requested action

1. Remove `DEFAULT_REGISTRY_PATH` (export + computation) from `plugin/scripts/
   drivable-workspace-check.ts`; make `--registry` a required flag; omitted `--registry` → clean
   usage error, exit 2.
2. Convert `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` to real
   symlinks pointing at the `plugin/scripts/` originals.
3. Re-derive `selftest()`'s three `real-registry-*` assertions to run unconditionally against the
   real checked-in registry path (a `selftest`-internal constant, never re-exported), each
   individually named/counted so a run can prove each actually executed.
4. `select-preflight.ts`: remove the dead `DEFAULT_REGISTRY_PATH` import. Own tests re-run green as
   independent evidence from item 5.
5. `human-steered-classify.ts`: replace the `DEFAULT_REGISTRY_PATH` runtime default with a
   required-`--registry` check before any `loadRegistry` call. Own tests re-run green as
   independent evidence from item 4.
6. `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs`: rewrite every
   assertion to pass an explicit `--registry`/injected `Registry` object; run directly (`node
   --test`) with real pasted output, since `scripts/test.sh` does not cover this file.
7. Record an explicit sign-off that `.quay/config.yml`'s `gates.it0` `drivable-workspace` entry
   stays end-to-end-unexercised this milestone (no real task sets `drivableWorkspaceArgs`).
8. Items 1-6 land atomically — any subset alone leaves a different one of the four affected files
   broken by an independent mechanism.

## Acceptance Criteria

- [x] `drivable-workspaces.yml` stays at `experiments/quay-perpetual-stream/drivable-workspaces.yml`
  (`ls` proof, unmoved); `DEFAULT_REGISTRY_PATH` removed from `drivable-workspace-check.ts`;
  omitting `--registry` gives a clean usage error, exit 2 — real command output pasted, not
  asserted.
  **Audit evidence (M194 adversarial audit, 2026-07-28):** `ls -la
  experiments/quay-perpetual-stream/drivable-workspaces.yml` shows a regular file, unmoved (dated
  Jul 23, predates this milestone). `grep -rn DEFAULT_REGISTRY_PATH` across `.ts`/`.mjs`/`.sh`
  files finds zero live bindings (only prose comments referencing the removed name).
  `node plugin/scripts/drivable-workspace-check.ts /tmp` (no `--registry`) printed `usage: ...` +
  `ERROR: --registry is required...` and exited 2.
- [x] `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` are real
  symlinks to the `plugin/scripts/` originals — `ls -la` proof pasted.
  **Audit evidence:** `ls -la experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}`
  shows both as `lrwxrwxrwx ... -> ../../../plugin/scripts/drivable-workspace-check.{ts,sh}`.
- [x] `selftest()`'s three "real-registry-*" checks are shown to individually execute and pass
  post-change (each check ID visible in output), not just an aggregate "all fixture cases PASS"
  line that could mask a silently-skipped check.
  **Audit evidence:** `node plugin/scripts/drivable-workspace-check.ts --selftest` printed
  `SELFTEST PASS: real-registry-file-exists`, `real-registry-has-authorized-root`,
  `real-registry-covers-archguard`, `real-registry-rejects-tmp` individually, plus the aggregate
  line and exit 0.
- [x] `select-preflight.ts`'s dead `DEFAULT_REGISTRY_PATH` import is removed — its own existing
  tests re-run green, real output pasted, independent of the next item.
  **Audit evidence:** `grep -n DEFAULT_REGISTRY_PATH experiments/quay-perpetual-stream/scripts/select-preflight.ts`
  returns nothing. `node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs`
  → `tests 31 / pass 31 / fail 0`.
- [x] `human-steered-classify.ts`'s CLI default-registry logic requires an explicit `--registry` —
  its own existing tests re-run green, real output pasted, independent of the item above (a
  structurally different, runtime-class defect from the compile-time import fix — do not combine
  into one checkbox).
  **Audit evidence:** source shows `usage()` called (exit 2) when `--workspace` given but
  `registryPath` unset, before any `loadRegistry` call. `node --test
  experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs` → `tests 24 / pass 24 /
  fail 0`, including `CLI: --workspace given but --registry omitted -> usage error exit 2`.
- [x] `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` (not covered by
  `scripts/test.sh`'s glob) passes an explicit `--registry` in every assertion and has been run
  directly (`node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs`)
  with real, pasted GREEN output.
  **Audit evidence:** direct run → `tests 27 / pass 27 / fail 0`, including
  `CLI: paths given but --registry omitted -> usage error exit 2`; grep confirms every
  `loadRegistry`/CLI-spawn call in the file passes an explicit registry path/object.
- [x] `.quay/config.yml`'s `gates.it0` `drivable-workspace` entry's continued end-to-end
  non-exercise is explicitly signed off (reason: no real task sets `drivableWorkspaceArgs`;
  manufacturing one to poke this path is rejected) — not a silent omission.
  **Audit evidence:** `.quay/config.yml` line 58-60 still registers `name: drivable-workspace`,
  `argsKey: drivableWorkspaceArgs`; `grep -rn drivableWorkspaceArgs tasks/` matches only this
  task's own prose (no real task sets the key) — sign-off is explicit in the Proposal/Requested
  action above, not a silent gap.
- [x] `plugin/test/plugin-packaging.test.mjs`'s exp5-label-leak test (which names
  `drivable-workspace-check.ts`/`.sh` as shipped files) is re-run and confirmed unaffected by the
  symlink conversion.
  **Audit evidence:** `node --test plugin/test/plugin-packaging.test.mjs` → `tests 34 / pass 34 /
  fail 0`, including `DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path
  references`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code and prose claims alone are necessary but insufficient — real command output
is required for every item above.

- [x] All items above landed on `master` under human-steered discipline, with real evidence, not
  asserted.
  **Audit evidence:** commit `1ca3a6d` on `master` (`git log --oneline` confirms it is HEAD's
  immediate predecessor-of-charter-only-commits chain); working tree clean (`git status` — only
  unrelated untracked `.halt` sentinels).
- [x] A fresh independent audit confirms each real symlink, each independent consumer fix, the
  selftest's per-check visibility, and the out-of-glob test's direct real re-run.
  **Audit evidence:** this M194 adversarial audit (fresh context, session
  13efe277-45ff-4563-bcfe-fd2c3db3e2a5) independently re-ran all of the above real commands itself
  rather than trusting the build's self-report.

## Human verification when exp5 marks this DIR done

1. Are `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts`/`.sh` really
   symlinks now (`ls -la`), not regular files?
2. Does `--selftest`'s output show each of the three "real-registry-*" checks individually, not
   just an aggregate pass line?
3. Were `select-preflight.ts` and `human-steered-classify.ts` fixed and verified independently of
   each other?
4. Is `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` actually run
   directly (not just assumed covered by `scripts/test.sh`)?

## Execution record

- **Milestone:** M194 (DIR-120 Phase 3b — drivable-workspace-check.ts layering-inversion fix)
- **Iteration count:** 1 (direct commit on `master`, no separate worktree/branch — the Build phase
  edited the shared working tree in place per the current `execute-milestone.js` convention,
  confirmed current for M187 through M194)
- **Realized Δv:** 0 (v̂>0, capabilityGrowth, deliverable, method-infra surface — no chart-2
  `packages/quay*` surface cell moves; a gate script's own registry-resolution correctness is
  method-infra capability, not a product surface — same VT-ruler-cannot-score-it class as
  M164/M167/M179/M188/M189/M192/M193)
- **Merge commit:** `1ca3a6d` (Build: remove `DEFAULT_REGISTRY_PATH`, require `--registry`,
  convert experiments-tree copies to real symlinks + fix the resulting symlink-invocation noop,
  re-derive `selftest()`'s per-check visibility, fix both downstream consumers, rewrite the
  out-of-glob test)
- **Audit verdict:** NO REFUTATION FOUND (fresh independent adversarial acceptance audit, session
  `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, 2026-07-28) — all 8 AC + both DoD items independently
  re-confirmed true against live re-run test/diff/CLI-call evidence, not the implementer's
  self-report (see the `**Audit evidence:**` annotations under each AC/DoD checkbox above).
- **Outcome:** `DEFAULT_REGISTRY_PATH` removed from `drivable-workspace-check.ts`; `--registry` is
  now a required flag with a clean exit-2 usage error on omission; both experiments-tree copies are
  real symlinks to the `plugin/scripts/` originals; `selftest()`'s three `real-registry-*` checks
  each individually visible in output; `select-preflight.ts`'s dead import removed,
  `human-steered-classify.ts`'s runtime default replaced with a required-flag check, each verified
  independently (31/31 and 24/24 tests); the out-of-`scripts/test.sh`-glob
  `drivable-workspace-check.test.mjs` rewritten and re-run directly (27/27); `plugin-packaging.test.mjs`
  unaffected (34/34); `.quay/config.yml`'s `gates.it0` `drivable-workspace` entry's continued
  non-exercise explicitly signed off, not a silent omission.
  **Split-or-commit resolution (real cross-milestone process gap, closed at this Land, not
  smoothed over):** this milestone's own Gate phase HARD BLOCKED on first pass —
  `tasks/DIR-120.md` (parent) carries `status: done` from M192's own Land while this task (child)
  was still `status: todo`, a real ADR-014/DIR-026 PARENT-DONE-IFF-CHILDREN violation introduced at
  M192 (undetected there because M192's own Gate phase ran BEFORE M192's own Land, when `DIR-120`
  was not yet `done` — `split-or-commit` is a whole-task-store check, not scoped to the task being
  landed). The workflow's automatic `needs-human` disposition was reconsidered per ADR-014 decision
  2 (`needs-human` is legitimate ONLY for external blockers; this was purely in-project
  bookkeeping) and resolved by actually completing this task's real, independently-verified-complete
  implementation rather than by loosening the check or leaving it at `needs-human`. Re-run at Land:
  `it0-split-or-commit-check.ts .` → `PASS: 472 task(s) checked — no split-or-commit violations`;
  `quay gate DIR-120-B --gate split-or-commit` → `PASS`. `it0-dod-check.sh DIR-120-B <charter>
  <absorb-entry>` re-run at Land: exit 0.

## Touches

- plugin/scripts/drivable-workspace-check.ts
- plugin/scripts/drivable-workspace-check.sh
- experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts
- experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh
- experiments/quay-perpetual-stream/drivable-workspaces.yml
- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/scripts/human-steered-classify.ts
- experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
- plugin/test/plugin-packaging.test.mjs
