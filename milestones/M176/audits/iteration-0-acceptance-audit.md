# M176 — iteration-0 acceptance audit (gap-absorb-charter-audit-not-committed)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Stance:** adversarial / refute-first. Fresh context — no prior exposure to this build.

## 1. AC satisfaction (refute-first)

Task: `tasks/gap-absorb-charter-audit-not-committed.md`. Implementation landed directly on
`master` in commit `c3ae6dda8ead37f4fe536a7b520a67ece4df877f` (human-authored, not dispatched
through the pipeline this milestone itself fixes — labels `gap, human-steered`, absorb-entry
notes "second of 5 sequential human-steered milestones this session").

| # | AC | Verdict | Evidence |
|---|---|---|---|
| 1 | OUTER-LOOP.md charter step explicitly `git add`s the new charter file | **CONFIRMED** | `git show c3ae6dd -- experiments/quay-perpetual-stream/OUTER-LOOP.md` adds `⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS milestone's own commit sequence...` to the `charter ::` step — same `⊨`-clause prose idiom the rest of the file already uses for procedural rules. |
| 2 | `execute-milestone.js` Audit phase commits its own output, OR Land phase mechanically stages `milestones/M<NN>/audits/*` | **CONFIRMED (both)** | Diff adds Audit-phase step "4a. STAGE THE AUDIT FILE... `git add` this audit file". Land phase CAPTURE step (serial AND concurrent code paths, `.claude/workflows/` and `plugin/workflows/` mirrors — `diff` confirms byte-identical) changed from prose-conditional ("if a non-primary iteration produced evidence") to unconditional: resolve `MILESTONE_ROOT` and `git add` everything under `$MILESTONE_ROOT/{audits,iterations}/` plus the charter if still untracked. |
| 3 | Single authoritative path-prefix rule used by both the Audit-phase write and the dogfood-evidence-gate lookup | **CONFIRMED** | `gate_resolve_milestone_root()` added to `gate-script-lib.sh` (both `experiments/.../scripts/` and `plugin/scripts/` copies, identical). Live-ran `bash experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --milestone M176` → resolves `milestones/M176` correctly (exit 0). `execute-milestone.js`'s prompts reference the same function name in both phases. `grep -rn "gate_resolve_milestone_root\|-ge 130"` shows the numeric `130` boundary exists in exactly ONE place; every other hit is a comment naming the function. Along the way the implementer found and fixed a real vacuous-pass bug in the old dual-probe lookup (confirmed by re-reading the diff — old loop matched `milestones/${MILESTONE}` literally against a bare-digit id, which never existed). |
| 4 | A fresh milestone run (serial path) lands with its charter AND audit file already committed as part of the ABSORB commit — no manual sweep needed afterward | **REFUTED** | `git show --stat c3ae6dd` includes the charter file (66 insertions) but **touches no `milestones/M176/audits/` path at all**. `find milestones/M176 -type f` (before this audit wrote anything) returned only `iterations/iteration-0.md` — no audit file existed anywhere in git history or on disk. The commit message's own claim — "This milestone's own charter + audit-report path are committed here as live proof" — is **false for the audit half**: no adversarial audit ran before the Land/merge commit landed on master. `git worktree list` shows no leftover M176 branch, and the task is still `status: todo` on master with **zero** gate events for it in `.quay/gate-events.jsonl` — i.e. the pipeline's own Land phase (which writes the ABSORB log entry, step 3) never ran for M176 either; `dashboard.md` has no `M176`/`m176` row before this audit's own write-back. This audit (the actual first Audit-phase pass for M176) necessarily lands in a **separate, later** commit than `c3ae6dd` — which is exactly the "manual sweep" pattern this task exists to eliminate, demonstrated live rather than avoided. |
| 5 | `tree-hygiene-check.sh` surfaces an untracked charter/audit file at Gate time as at least a WARNING | **CONFIRMED** | Live-ran `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` while this milestone's own audit file was still untracked and observed `tree-hygiene: WARN — untracked ABSORB-pipeline evidence file(s)...` with exit 0 (non-blocking, as designed — confirmed the WARN does not affect the exit code). |
| 6 | Existing it0 selfchecks + gate hashes stay green | **PARTIALLY CONFIRMED / left unticked** | `dod-fixture-selfcheck.sh` 17/17, `audit-independence-selfcheck.sh` 7/7, `vmeta-lag-selfcheck.sh` 8/8, `task-schema-selfcheck.sh` 14/14, `loadbearing-test-gate-selfcheck.sh` PASS, `it0-gate-hash-check.sh --by-reference <charter>` PASS. But `touches-orthogonality-selfcheck.sh`, `routine-scheduler-selfcheck.sh`, `serial-fanin-absorb-selfcheck.sh`, and `concurrent-batch-scheduler-selfcheck.sh` all **FAIL**. Verified via a disposable worktree checked out at the pre-M176 commit (`3054ca7`) that all 4 fail **identically** there — confirmed pre-existing breakage, not a regression this milestone introduced. Left unticked because the AC's literal text ("stay green") is not met in absolute terms, even though M176 is not the cause. |
| 7 | No regression to the serial or concurrent execution paths | **CONFIRMED** | `node --check` passes on both `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`. The Land-phase CAPTURE edit is structurally parallel across both the serial and concurrent code blocks. The two workflow mirrors remain byte-identical (`diff` exit 0). `plugin/test/plugin-packaging.test.mjs` 30/30 (the packaging regression the implementer caught mid-build, from a first-draft hardcoded `experiments/quay-perpetual-stream/` regex in the `plugin/scripts/` WARN copy, is fixed). Full `scripts/test.sh`: **513 pass / 1 fail / 3 skipped** (517 total) — the 1 failure (`packages/quay/test/serve-adversarial-eval.test.mjs`, `EADDRINUSE: 0.0.0.0:42227`) is a test-concurrency port collision, not touched by this milestone's diff; re-ran the file in isolation and it passed 1/1 cleanly, confirming it is test-infra flake, not a regression from this change. |

## 2. DoD satisfaction

| # | DoD item | Verdict | Evidence |
|---|---|---|---|
| 1 | OUTER-LOOP.md charter step change landed and verified (a real charter's `git add` is part of that milestone's own commit history, not swept later) | **CONFIRMED** | The M176 charter itself (`charters/M176-gap-absorb-charter-audit-commit.md`) is present in `c3ae6dd`'s file list, not left untracked. |
| 2 | `execute-milestone.js` Audit-phase/Land-phase change landed; a real milestone's audit file lands in the SAME commit series that merges the milestone (not left untracked) | **REFUTED** | Same evidence as AC4 above — no audit file exists in `c3ae6dd` or anywhere prior to this audit. The *instruction text* landed; the *behavioral claim it makes about itself* has not been demonstrated by a real run — the pipeline's own Land phase never ran for M176 (task still `todo`, no gate event, no dashboard log row). |
| 3 | Path-prefix rule is single-sourced (grep confirms no duplicated boundary logic) | **CONFIRMED** | See AC3 above. |
| 4 | All it0 selfchecks + gate hashes green on the merged result | **PARTIALLY CONFIRMED** | See AC6 above — 4 pre-existing, non-regression failures remain unresolved. |
| 5 | No new backlog accumulates over the next 5 milestones (spot-check `git status` clean on charters/ and audits/ after each) | **UNVERIFIABLE at audit time** | Forward-looking criterion; 0 milestones have landed since M176 as of this audit (2026-07-26). Cannot be confirmed or refuted yet. |

## 3. Checklist write-back (DIR-020)

Applied directly to `tasks/gap-absorb-charter-audit-not-committed.md`: 5 of 7 AC items ticked
`[x]` with evidence citations, 1 AC item left `[~]` (partial — see item 6 above), 1 AC item left
unticked with an explicit **REFUTED** note (item 4). DoD: 2 of 5 items ticked `[x]`, 1 left `[~]`,
2 left unticked (1 REFUTED, 1 unverifiable-forward-looking). See the task file's current state
for the full inline citations.

## 4. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-absorb-charter-audit-not-committed \
    experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md \
    /tmp/m176-absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining (REFUTED-equivalent,
      HARD-blocks exactly as an unmet criterion does): "A fresh milestone run (serial path) lands with
      its charter AND audit file already" [tasks/gap-absorb-charter-audit-not-committed.md]
FAIL: clause0-ac-dod-present: '## Definition of Done' section does not reference the standard DoD
      (must reference the standard five clauses / inherited-core, per the reference-plus-extras rule)
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor: FAIL — product-touching surface [none/fail-closed] has NEITHER a ≥80%
      test-coverage disposition NOR a matching test-floor WAIVER line in the ABSORB-entry text

FAIL: DoD check failed — 5 clause violation(s) found (see above).
EXIT: 1
```

Non-zero exit — **REFUTED by construction**, per the audit charge. Ran twice (before and after
this audit's own checklist write-back); exit code stayed 1 both times (clause0's unchecked-item
count dropped from 7→1 after write-back, but 4 other clauses still fail independent of the
task-file checklist — clause1/clause2/clause7 fail because `/tmp/m176-absorb-entry.md` is a
minimal stub, written at 15:24Z, ~26 minutes before the 15:50Z merge commit, with no adversarial-
audit, vmeta-lag, or test-floor disposition text; clause0's DoD-reference sub-check is a
task-authoring format gap unrelated to this milestone's product code).

## 5. Deviation-log write-back (DIR-017 Step 3)

Three rows appended to `dashboard.md`'s "Homeostatic variables" deviation table, all
`caught-by: machine` (this audit pass, same agent, no split timing):

1. **REFUTED** — AC4/DoD-item-2 unmet (audit file never landed in the ABSORB commit; Land ran
   before Audit for M176 itself).
2. **CONCERNS** — mechanical gate FAILs on clause1/clause2/clause7 because the ABSORB-entry stub
   predates and was never completed after the merge (recurring absorb-entry-template gap, same
   pattern as M138/M139/M142/M144/M145/M165/M168/M173).
3. **CONCERNS** — 4 it0 selfchecks fail, confirmed pre-existing (not caused by M176) via a
   pre-M176 worktree comparison.

## 6. Verdict

**REFUTED.**

The three code-level root causes (charter commit, audit-file commit mechanism, path-prefix
single-source) are genuinely and correctly implemented — confirmed by direct diff/grep/live-run
inspection, not self-report. The optional tree-hygiene WARN is also genuinely implemented and
non-blocking as designed.

But the task's own central claim — that a real milestone can now land with **both** its charter
**and** audit file already committed, closing the gap the task exists to fix — is **not proven by
M176 itself**. M176's own landing commit (`c3ae6dd`) is missing exactly the artifact class (the
audit file) that this milestone's fix is supposed to guarantee gets committed, because no
adversarial audit ran before the human merged it to master. That is not a hypothetical edge case;
it is the literal scenario under test, observed directly, on the very milestone meant to
demonstrate the fix. Combined with the mechanical gate's non-zero exit (independently required by
the audit charge to force REFUTED), the overall verdict is REFUTED — the fix is well-built and
partially proven, but the end-to-end DoD claim ("no manual sweep needed") remains unverified and,
on the one real data point available (M176 itself), contradicted.
