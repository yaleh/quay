# DIR-120 (M192) — Adversarial Acceptance Audit (iteration-0)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Scope:** DIR-120's remaining scope — Phase 2 (delete root legacy `.quay/gates.yml`/`.quay/loop.yml`
+ their branch-A reader fallback) and Phase 3a (exp5 `.quay/loop.yml` profile-fragment restriction).
Phase 0/1 already landed at M186 (independently re-audited there, NO REFUTATION FOUND at that
scope). Phase 3b split to [[DIR-120-B]], out of scope here by the task's own explicit split.

**Stance:** fresh context, refute-first — every claim below was independently reproduced against
live command output / diffs / test runs this session, not taken on the implementer's self-report.

## Verdict

**CONCERNS**

All 11 Acceptance Criteria items and 7 of 8 Definition of Done items are independently confirmed
true against real, reproduced evidence. One DoD item — the task's own explicit "Touches-list gap"
sign-off requirement — is genuinely unsatisfied: real, necessary implementation-side edits exist to
6 test files (plus `.quay/config.yml` and one new test file) that are not named in either the
task's own Touches list or the M192 charter's Touches list, and no sign-off for this gap exists
anywhere in the task record. This does not call into question the substantive engineering work,
which is solid and well-tested, but it is a real, confirmed gap against the task's own explicit
DoD text.

## AC-by-AC refutation attempt

1. **`config-wiring-check` three-way problem classification + selftest ≥80% coverage.** Already
   confirmed at M186 audit (2026-07-27) and re-confirmed unmodified in scope this session. Not
   re-litigated here (Phase 0/1 scope).
2. **RED evidence for Phase 1/2 baseline.** Already confirmed at M186. Not re-litigated.
3. **Phase 1's 4 decisions landed.** Already confirmed at M186. Not re-litigated.
4. **Phase 2: physical deletion + branch-A fallback deletion + structural grep + tests + real
   calls.** CONFIRMED.
   - `ls -la .quay/gates.yml .quay/loop.yml` → both `No such file or directory` (ENOENT).
   - `grep -n "existsSync(legacy" packages/quay/src/gate/config/loader.ts
     packages/quay/src/loop-params.ts` → exactly 1 hit in each file (`loader.ts:102`,
     `loop-params.ts:87`). Reading the surrounding context in both files confirms each hit sits
     inside an `else` block reached only when `fs.existsSync(unifiedConfigPath)` is false (branch
     B) — zero fallthrough-from-branch-A guards remain.
   - `node --test packages/quay/test/loop-params.test.mjs` → `49 passed, 0 failed`, including the
     flipped line-197 test, now named `"DIR-120 Phase 2 RED: config.yml with no loop: section now
     FAIL-CLOSED even with sibling loop.yml present (branch-A terminal, no more fallthrough)"`.
   - Real post-deletion `node packages/quay/bin/quay.ts gate --list` → prints 20 real gate names
     (`dod`, `acceptance`, `impl-row`, `vmeta-lag`, `adr-001`, `adr-007`, `delivery-standalone-smoke`,
     `anti-gaming`, `tree-hygiene`, `worktree-branch-hygiene`, `ts-typecheck`, etc.), resolved purely
     from `.quay/config.yml`.
   - Real direct `readLoopParams(repoRoot)` call (`node --input-type=module -e "import
     {readLoopParams} from './packages/quay/src/loop-params.ts'; console.log(...)"`) → returns the
     real 8-field object (`board`, `gates`, `stop`, `policy`, `execution`, `audit`, `concurrency`,
     `routines`), including the real `routines` array with 4 entries (`self-validation`,
     `architecture-analysis`, `history-mining`, `browser-explorer`).
5. **NEW gates-side silent-data-loss test.** CONFIRMED. New file
   `packages/quay/test/gate-config-loader.test.mjs`, test `"DIR-120 Phase 2 RED: config.yml present
   with NO gates: key, real-content sibling gates.yml present -> returns EMPTY shape, not legacy
   content"` — independently re-run this session as part of `node --test
   packages/quay/test/gate-config-loader.test.mjs packages/quay/test/loop-params.test.mjs` →
   `49 passed, 0 failed`. The test constructs exactly the scenario the AC names (config.yml with no
   `gates:` key, sibling `gates.yml` with real `fixed:` content) and asserts `readGatesConfig`
   returns the empty six-key shape, not the legacy content — confirmed by reading the test body
   directly, not inferred.
6. **Phase 3a providers FAIL-CLOSED + RED/GREEN + object-shaped-gates test.** CONFIRMED, with
   independently-reproduced real RED/GREEN output (not the implementer's pasted transcript):
   - RED: created a fresh temp `.quay/loop.yml` with `providers: {}` and ran `node
     plugin/scripts/config-wiring-check.ts --verify-readers --workspace <tmp>` myself → exit code 2,
     `ERROR: cannot verify readers for <tmp>: FAIL-CLOSED: .quay/loop.yml declares 'providers:' — a
     loop-only profile fragment may not declare 'providers:' ... (DIR-120 Phase 3a)`.
   - GREEN: ran the identical command against the real, unmodified
     `experiments/quay-perpetual-stream` workspace myself → exit code 0, `PASS: verify-readers
     agreement holds`, with the real printed `readLoopParams` output showing `gates:["it0-set"]` and
     no `providers:` key.
   - Object-shaped `gates:` rejection: independently confirmed as a first-class, separately-named
     test in `loop-params.test.mjs` (`"DIR-120 Phase 3a RED: object-shaped gates: in branch-B
     loop.yml throws FAIL-CLOSED (pre-existing invariant, now explicitly named)"`), passing in the
     same 49/49 run above.
7. **NEW cross-check (`--verify-readers`) — checker verdict vs. real reader behavior, asserted in
   code.** CONFIRMED. `bash experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh`
   independently re-run this session → `22 passed, 0 failed`, including
   `verify-readers-green-set-containment-ok`, `verify-readers-green-verdict-agreement-ok`,
   `verify-readers-red-set-containment-catches-dangling-gate-name` (a deliberately-mismatched
   synthetic case with a bogus gate name, proving the set-containment assertion actually
   distinguishes agreement from disagreement rather than being vacuously true), and
   `verify-readers-cli-red-exit-1`/`verify-readers-cli-green-exit-0`. Read the `verifyReaders()`
   implementation directly in `plugin/scripts/config-wiring-check.ts`: it calls the real
   `readGatesConfig`/`readLoopParams`/`listGates`/`checkField`/`checkGatesValueResolvable`
   functions directly (no reimplementation), asserting set-containment and per-field value equality
   in code — closing the gap the AC names.
8. **branch-A-only sign-off recorded as a human decision.** CONFIRMED. `## Proposal`'s Chosen
   mechanism section explicitly states "Phase 2 — branch-A-only termination (human-signed-off)."
9. **NEW doc-comment/pointer cleanup (`quay.ts`, `config.yml`).** CONFIRMED.
   - `grep -n "gates\.yml" packages/quay/bin/quay.ts` (real, post-change) → 4 remaining hits (lines
     200, 390, 1119, 1154), all re-read directly: each now describes `.quay/gates.yml` as "a legacy
     `.quay/gates.yml` only for a workspace with no `config.yml`" — none claims it is a live
     fallback for THIS workspace (down from the pre-change baseline of 9 hits at lines 198, 205,
     220, 383, 384, 386, 388, 1110, 1141, all of which asserted the file was live here).
   - `.quay/config.yml`'s header comments re-read directly (both the top-of-file DIR-050/DIR-120
     comment and the `gates:` section's own header comment): the self-contradictory sentence "The
     legacy gates.yml remains as a back-compat fallback for workspaces that haven't migrated, but
     this section is now the SINGLE SOURCE OF TRUTH" is gone, replaced with text correctly stating
     the legacy file for THIS workspace has been deleted and the fallback code path removed.
10. **`gate-ergonomics.test.mjs`/`dod-gate-set.test.mjs` re-run green, unmodified.** CONFIRMED.
    `git diff --stat` shows 0 lines changed in both files. `node --test
    packages/quay/test/gate-ergonomics.test.mjs packages/quay/test/dod-gate-set.test.mjs`
    independently re-run this session → `29 passed, 0 failed`.
11. **Full/focused `scripts/test.sh` passes.** CONFIRMED. `bash scripts/test.sh` (the canonical,
    unfiltered glob) independently re-run this session, full run, no shortcuts → exit code 0,
    `tests 582 / suites 4 / pass 579 / fail 0 / cancelled 0 / skipped 3 / todo 0` (the 3 skips are
    the declared live-GitHub/conformance opt-in files per ADR-019 decision #1 — expected without
    `QUAY_TEST_LIVE_GITHUB=1`, not a silent exclusion).

## DoD-by-DoD refutation attempt

1. Root legacy files gone + branch-A fallback code gone, verified by real post-deletion calls —
   **CONFIRMED** (same evidence as AC #4).
2. exp5 profile-fragment enforcement (`providers:` FAIL-CLOSED, real file still validates) —
   **CONFIRMED** (same evidence as AC #6).
3. Checker verdict vs. reader real behavior shown to agree, side by side — **CONFIRMED** (same
   evidence as AC #7).
4. `scripts/test.sh` passes in full — **CONFIRMED** (same evidence as AC #11).
5. `gate-ergonomics.test.mjs`/`dod-gate-set.test.mjs` green, unmodified, re-run — **CONFIRMED**
   (same evidence as AC #10).
6. **The Touches-list gap has an explicit sign-off recorded, not a silent omission — NOT
   CONFIRMED (the CONCERN).** `git diff --stat` (real, this session) shows these files modified
   beyond the two Touches lists' union:
   - `packages/quay/test/adr-gate.test.mjs`
   - `packages/quay/test/delivery-standalone-smoke-gate.test.mjs`
   - `packages/quay/test/dir022-remaining-gates.test.mjs`
   - `packages/quay/test/dir032-audit-independence.test.mjs`
   - `packages/quay/test/it0-gates.test.mjs`
   - `packages/quay/test/ts-typecheck-gate.test.mjs`
   - `.quay/config.yml` (modified; present in the task's own Touches list but absent from the
     charter's narrower one — a lesser instance of the same drift)
   - `packages/quay/test/gate-config-loader.test.mjs` (new file; not in either Touches list)

   Reading each of the 6 test-file diffs directly confirms they are real, necessary consequences of
   Phase 2 (each workspace fixture's gate declarations had to move from a sibling `.quay/gates.yml`
   into `config.yml`'s own `gates:` section, because branch A is now terminal and would otherwise
   silently ignore the sibling file — the exact class of behavior this milestone's own
   `gate-config-loader.test.mjs` names). They are not accidental/unrelated edits. But `grep -n` for
   each of these 8 filenames against `tasks/DIR-120.md` returns zero hits — no sign-off, addendum,
   or acknowledgment of this gap exists anywhere in the task record, despite the task's own Risks
   section explicitly naming this exact failure class ("the charter's own Touches list must name
   every real colocated edit/regression-evidence surface ... not silently absorb them under
   'obviously implied'"). Left unchecked in the task's DoD list pending a real sign-off.
7. `quay.ts`/`.quay/config.yml` doc-comment cleanup — **CONFIRMED** (same evidence as AC #9).
8. [[DIR-120-B]] independence — **CONFIRMED**. `tasks/DIR-120-B.md` exists as a distinct task
   (`status: todo`, `parent: DIR-120`, `dirStatus: applied`), a structurally separate file set
   (`drivable-workspace-check.ts` et al.) — independent of this task's own completion state
   regardless of DIR-120-B's own progress.

## Mechanical gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-120
experiments/quay-perpetual-stream/charters/M192-dir120-config-crystallization-phase2-3.md
milestones/M192/absorb-entry.md` → **exit 0**, all 12 clauses PASS/N/A (`clause0-ac-dod-present`:
task AC has 11/11 checked; `clause1-adversarial-audit`/`clause2-vmeta-lag`: disposition statements
present per below; `clause10-tree-hygiene`/`clause11-worktree-branch-hygiene`: clean). Note:
`clause0` checks AC-checklist literal completion only, not the DoD checklist — it does not, and by
design cannot, catch the Touches-list-gap DoD item left unchecked above. A non-zero mechanical-gate
exit would have been REFUTED-by-construction per this audit's own charge; it is 0, so this verdict
rests on the audit's own independent AC/DoD review, not the mechanical gate.

## V_meta consolidation-lag

`bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 190
experiments/quay-perpetual-stream/v-meta-ledger.md` (milestone_counter at audit time = 191, per
`dashboard.md`) → `PASS: no confirmed-unconsolidated row past K without a dated carry-forward`
(both ledger rows `[ok]` — one already consolidated, one not past the φ threshold).

## Deviation-log write-back

One machine-caught deviation row appended to `dashboard.md`'s Homeostatic variables table (level
CONCERNS, caught-by machine, caught-at M192, age 0) — this same audit pass's own Touches-list-gap
finding above. No caught-by:human row was added: no `milestones/M192/iterations/iteration-0.md` (or
equivalent) exists yet disclosing this gap for the audit to transcribe — this is a machine-original
finding, not a transcription of a build-side disclosure.
