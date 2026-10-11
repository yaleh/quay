---
id: gap-ac69-malformed-record-exits-3-and-passes-the-static-gate
title: "ac69 check: a malformed measurement record exits 3, which run_checker
  treats as non-fatal, so the static gate stays green although the registry and
  mutation case expect RED"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
I verified this on 2026-10-12 in a scratch worktree at develop `b9cc4bfce`. I ran the real production wrapper `run_checker` from `plugin/scripts/checker-cost-lib.sh`, the same one that `plugin/scripts/runner-static-gate.ts` calls at around line 666:

| Record state | Raw checker exit | run_checker result |
|---|---|---|
| valid | 0 | `PASS`, rc=0 |
| `conclusion` field dropped (malformed) | **3** | `STATIC_CHECK_NOT_EVALUATED`, **rc=0, the suite stays green** |
| record deleted | 2 | `STATIC_CHECK_FAILED exit=2`, rc=2 (red) |

- The registry comment (`runner-static-gate.ts` around lines 655-664) says "Mutation case + unit tests carry the negative control (delete record / drop conclusion ⇒ RED, restore ⇒ GREEN)".
- `run_checker` maps exit 3 to a non-fatal not-evaluated result (`checker-cost-lib.sh` around lines 158-160).
- `ac69-slot-queue-gap-check.ts` sets `EXIT_MALFORMED = 3` (around line 16).
- The mutation case `plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh` (inject (2), around line 48) asserts only that the RAW checker exits non-zero. So it passes, even though the production gate does not go red.

The effect is latent today: the committed record is valid. But a corrupted record would not block a landing.

This is the only confirmed misjudgment from a 2026-10-12 trace of checker exit-code 2/3 producers and consumers. The other mismatches found in that trace are out of scope here: capability-manifest-check and criterion-carrier-inline-check exit 2 for not-evaluated and are treated as red, and their intended behaviour has not been established.

## Plan
1. A present but structurally invalid record has been read and judged, so it is a FAIL. Make the malformed path exit 1. Keep exit 2 for an absent record, which is red today.
2. Change the mutation case to judge each injected fault through `run_checker` semantics, not the raw exit code: exit 3 counts as staying green. Inject (2) must then show `STATIC_CHECK_FAILED`.
3. Correct the registry comment so it matches the exit codes the checker actually returns.
4. Look for other cases of the same defect class (hard rule 5b). For every checker invoked through `run_checker` in `runner-static-gate.ts` that has a mutation case under `plugin/scripts/checker-mutation-cases/`, find whether any injected fault makes the checker exit 3. List them. Report only; do not fix the others in this task.
5. `.sh` edits may be counted by the sh-census ratchet. If the census check reddens, keep the diff line-neutral.

## Acceptance Criteria
- [x] `node --test plugin/test/ac69-slot-queue-gap-check.test.mjs` exits 0. It includes a case where a record missing `conclusion` gives exit 1. —— rc=0, `tests 18 / pass 18 / fail 0`. The case `硬规则 3b 负控制 — record MISSING required field ⇒ exit 1 (RED), never 0 or 3` asserts `r.status === 1` as a LITERAL plus `EXIT_MALFORMED === 1`, with explicit `notEqual 0` and `notEqual 3`. Output in §AC1.
- [x] Production-path control. In the task worktree, source `plugin/scripts/checker-cost-lib.sh` and call `run_checker "ac69-slot-queue-gap-check" node --no-warnings --experimental-strip-types plugin/scripts/ac69-slot-queue-gap-check.ts --root "$PWD"` three times, with: the valid record, the record with `conclusion` deleted, and the record deleted. Paste the three outputs; they must give rc 0, rc≠0 with `STATIC_CHECK_FAILED`, and rc≠0 with `STATIC_CHECK_FAILED`. Restore the record afterwards. —— rc 0 (`PASS`); rc 1 with `STATIC_CHECK_FAILED: ac69-slot-queue-gap-check exit=1`; rc 2 with `STATIC_CHECK_FAILED: ac69-slot-queue-gap-check exit=2`; the record restored byte-identical (`git status --porcelain` empty). Output in §AC2.
- [x] `bash plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh` exits 0. Then temporarily revert the checker to exit 3 for the malformed case and show the mutation case now fails; paste that output and revert. —— rc=0 (both injections make the production gate red). With `EXIT_MALFORMED` reverted to 3 the case exits 3 (STAYED-GREEN) after printing `STATIC_CHECK_NOT_EVALUATED: ac69-slot-queue-gap-check`; the checker was then restored to 1. Output in §AC3.
- [x] Class scan (5b): paste the number of checkers found in Plan step 4, and the first 3, with the injected fault and the exit code for each. —— 75 checkers in the intersection (79 distinct `run_checker` names in `runner-static-gate.ts` ∩ the 92 files in `plugin/scripts/checker-mutation-cases/`); 10 of them have a mutation-case injection under which the checker exits 3. First 3 (alphabetical): `checked-in-write-check` — injected fault "an input whose module evaluation never completes" ⇒ exit 3; `checker-count-drift-check` — an absent/unreadable carrier ⇒ exit 3; `criterion-failure-attribution-check` — `goals/` removed (unreadable input) ⇒ exit 3. All 10 are deliberate NOT-EVALUATED probes whose case PINS the value 3 (verified by re-running each with exit 3 normalized to `run_checker`'s non-fatal 0 — all 10 then fail with a named "expected 3, got 0" diagnostic, none silently accepts it), so 0 remain of THIS task's shape. Output in §AC4.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-ac69-malformed-record-exits-3-and-passes-the-static-gate` green.

## Touches
- tasks/gap-ac69-malformed-record-exits-3-and-passes-the-static-gate.md
- plugin/scripts/ac69-slot-queue-gap-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/test/ac69-slot-queue-gap-check.test.mjs

## Evidence

### §AC1 — `node --test plugin/test/ac69-slot-queue-gap-check.test.mjs` exits 0 (incl. a `conclusion`-missing case asserting exit 1)

```console
✔ RECORD_REL points at the committed measurement record (0.782982ms)
✔ REQUIRED_FIELDS — the record must carry task/measuredAt/dataSource/method/stats/conclusion/conclusionReason (0.540587ms)
✔ VALID_CONCLUSIONS — conclusion must be maintain|change (the「改法或维持」axis) (0.091228ms)
✔ hasFiniteMedian — true only for a finite number (0.145296ms)
✔ validateRecord — a complete record is ok (0.193336ms)
✔ validateRecord — a non-object record is not ok (0.093487ms)
✔ validateRecord — missing a required field is not ok (names the field) (0.145877ms)
✔ validateRecord — an invalid conclusion value is not ok (0.084108ms)
✔ validateRecord — a non-finite median is not ok (0.086898ms)
✔ validateRecord — a trivial conclusionReason is not ok (0.142016ms)
✔ AC1 DoD — the REAL committed measurement record is GREEN (CLI exit 0) (78.490365ms)
✔ AC1 DoD — the real record's conclusion field is one of maintain|change and has a median (0.322593ms)
✔ 硬规则 3b 负控制 — record ABSENT ⇒ exit 2 (NOT-EVALUATED), never 0 (75.527713ms)
✔ 硬规则 3b 负控制 — record MALFORMED JSON ⇒ exit 1 (RED), never 0 or 3 (76.605718ms)
✔ 硬规则 3b 负控制 — record MISSING required field ⇒ exit 1 (RED), never 0 or 3 (138.529847ms)
✔ 硬规则 3b 负控制 — record INVALID conclusion value ⇒ exit 1 (RED), never 0 or 3 (80.042278ms)
✔ 硬规则 3b — the three exit codes are pairwise distinct (0 ≠ 1 ≠ 2) and RED ≠ the non-fatal 3 (0.153286ms)
✔ checkRecord — direct call returns ok:false + distinct code for an absent file (0.994737ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 543.745771
$ echo "rc=$?"  ⇒  rc=0
```

### §AC2 — production path: `run_checker` over (a) valid, (b) `conclusion` deleted, (c) record deleted, then restore

```console
$ . plugin/scripts/checker-cost-lib.sh   # then run_checker 3× from the worktree root

$ run_checker "ac69-slot-queue-gap-check" node --no-warnings --experimental-strip-types plugin/scripts/ac69-slot-queue-gap-check.ts --root "$PWD"
# --- (a) VALID record ---
ac69-slot-queue-gap-check: PASS — measurement record present and structurally complete
  task=gap-ac69-suite-slot-full-should-queue-not-wait measuredAt=2026-08-14T04:56:32Z conclusion=maintain medianSeconds=123.4
rc=0

# --- (b) record with the `conclusion` field DELETED ---
ac69-slot-queue-gap-check: FAIL (malformed) — missing required field(s): conclusion
STATIC_CHECK_FAILED: ac69-slot-queue-gap-check exit=1
rc=1

# --- (c) record DELETED ---
ac69-slot-queue-gap-check: NOT-EVALUATED (record absent) — measurement record NOT FOUND: /data/home/yale/work/quay-worktrees/gap-ac69-malformed-record-exits-3-and-passes-the-static-gate/docs/analysis/ac69-slot-release-vs-dispatch-gap.json
STATIC_CHECK_FAILED: ac69-slot-queue-gap-check exit=2
rc=2

# --- restore: cp back the backup ---
$ git status --porcelain -- docs/analysis/ac69-slot-release-vs-dispatch-gap.json
(no output = restored byte-identical)
ac69-slot-queue-gap-check: PASS — measurement record present and structurally complete
  task=gap-ac69-suite-slot-full-should-queue-not-wait measuredAt=2026-08-14T04:56:32Z conclusion=maintain medianSeconds=123.4
rc=0
```

### §AC3 — mutation case GREEN (rc=0); then the exit-3 negative control makes it FAIL (rc=3 STAYED-GREEN); then reverted

The case echoes the checker's OWN verdict lines but not the wrapper's `STATIC_CHECK_FAILED:` machine line — see §AC3b for why.

```console
$ bash plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh "$D"   # D = a fresh temp workdir
ac69-slot-queue-gap-check: PASS — measurement record present and structurally complete
  task=gap-ac69-suite-slot-full-should-queue-not-wait measuredAt=2026-08-14T00:00:00Z conclusion=maintain medianSeconds=123.4
ac69-slot-queue-gap-check: NOT-EVALUATED (record absent) — measurement record NOT FOUND: /tmp/ac69-casecheck-J56VgQ/docs/analysis/ac69-slot-release-vs-dispatch-gap.json
ac69-slot-queue-gap-check: FAIL (malformed) — missing required field(s): conclusion
ac69-slot-queue-gap-check: PASS — measurement record present and structurally complete
  task=gap-ac69-suite-slot-full-should-queue-not-wait measuredAt=2026-08-14T00:00:00Z conclusion=maintain medianSeconds=123.4
rc=0
```

Negative control — `EXIT_MALFORMED` temporarily reverted to 3, then restored (md5 verified byte-identical, `git status --porcelain` empty):

```console
ac69-slot-queue-gap-check: PASS — measurement record present and structurally complete
  task=gap-ac69-suite-slot-full-should-queue-not-wait measuredAt=2026-08-14T00:00:00Z conclusion=maintain medianSeconds=123.4
ac69-slot-queue-gap-check: NOT-EVALUATED (record absent) — measurement record NOT FOUND: /tmp/ac69-negctl-E5aR1z/docs/analysis/ac69-slot-release-vs-dispatch-gap.json
ac69-slot-queue-gap-check: FAIL (malformed) — missing required field(s): conclusion
STATIC_CHECK_NOT_EVALUATED: ac69-slot-queue-gap-check
STAYED-GREEN: the production gate stayed green with the conclusion field DROPPED
rc=3
```

### §AC3b — the false fan-in red this round removed (the case must not publish the harness's own red marker)

Plan step 2 makes the case judge each fault through `run_checker` — so the case now RUNS the production wrapper, whose stderr carries `STATIC_CHECK_FAILED: <name> exit=<rc>` on any non-zero. The first implementation echoed the wrapper's full output to the case's stdout. That is a self-inflicted red:

- `checker-mutation-check` captures a case's stdout+stderr (`spawn(..., {stdio:["ignore","pipe","pipe"]})`) and re-emits it into the full-suite stream in plain (`--check`) mode.
- `runner-static-gate.ts` runs `checker-mutation-check --check` (full tier) and `--check-changed` (change tier) inside the STATIC-CHECK phase of the suite, i.e. BEFORE `testPhaseStarted`.
- `full-suite-runner`'s `^STATIC_CHECK_FAILED:` pattern (`isStaticCheckFailureLine`) fires on any such line in that phase and flips the WHOLE round red (`reason=static-check`, `failures[]` = every accumulated `VIOLATION:` line + the fail-closed checkers).

Measured 2026-10-11 (prior round, `exited-not-landed`): the fan-in suite reported `# fail 87` / `# suite red failed` while `# pass 10911` and `tapFail=0` — no test failed, no `__PERFILE__ … passed=false`. The only failure-pattern lines in the entire pre-test phase were exactly the four `STATIC_CHECK_FAILED: ac69-slot-queue-gap-check exit={2,1}` lines this case echoed (2 runs × 2 arms). Removing them leaves ZERO failure-pattern matches in the pre-test phase:

```console
$ sed -n '1,2307p' <suite.log> | grep -nE 'new since baseline:[[:space:]]*[1-9]|(over|exceeds|exceeded) the ratchet ceiling|ceiling was RAISED|CEILING BREACH|FAIL:[[:space:]]*[0-9]+[[:space:]]+(ratchet[[:space:]]+)?violation|^STATIC_CHECK_FAILED:|^not ok|^[#ℹ][[:space:]]*(fail|cancelled)[[:space:]]+[1-9]|^✖[[:space:]]|^__PERFILE__[[:space:]]+duration_ms=.*passed=false|tmux-leak-scan: FAIL' | grep -v ac69-slot-queue-gap-check
(no match)
```

Fix: `gate_red` writes the wrapper's output to `${workdir}/gate.out` and echoes it through `grep -v '^STATIC_CHECK_FAILED:'`, so the case reports the gate verdict (its own exit code + the checker's verdict line) without publishing the harness's marker. The exit-3 arm's `STATIC_CHECK_NOT_EVALUATED:` line matches no runner failure pattern, so it is kept.

Verification (the exact producer that leaked, run as the suite runs it — `scripts/test.sh:314` exports `TZ=UTC`, which the case's dynamic `date -u` label depends on):

```console
$ TZ=UTC bash plugin/scripts/checker-mutation-check.sh --check
…
checkers_total: 87
checkers_with_mutation: 87
mutations_that_stayed_green: 0
mutations_that_always_red: 0
uncovered (registered checker with no mutation case): 0
errors: 0
not_evaluated: 0
RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore; mutations_that_stayed_green = 0.
$ echo $?  ⇒ 0   # and `grep -c '^STATIC_CHECK_FAILED:'` over that output = 0
```

⛔ Scope note (NOT fixed here, reported): the runner's guard for fixture output is `!testPhaseStarted`, so it only protects the TEST phase. Any mutation case that echoes a wrapper machine line during the static-check phase will re-create this false red. The three sibling cases that also call `run_checker` (`repo-root-derivation-check`, `checked-in-write-check`, `checker-count-drift-check`) avoid it by construction — they run the checker directly and never print the wrapper's machine line. A runner-side guard (e.g. `checker-mutation-check` not re-emitting case output in `--check` mode, or the runner ignoring markers while `checker-mutation-check` is on the stack) would be the general fix; it is outside this task's `## Touches`.

### §AC4 — class scan (Plan step 4 / hard rule 5b)

```console
Distinct run_checker names in plugin/scripts/runner-static-gate.ts : 79
Files in plugin/scripts/checker-mutation-cases/                     : 92
Intersection (name has a mutation case)                            : 75

Instrument: each case run with a PATH shim in front of node/bash that records the raw
exit code of every interpreter invocation (one case = one temp workdir, same contract as
checker-mutation-check.ts: bash <case>.sh <workdir>).

Checkers whose case sees a raw exit code 3, with the full per-invocation rc sequence:
  checked-in-write-check                   0,1,0,3,1,0,0,0
  checker-count-drift-check                0,1,1,1,0,3,3,0
  criterion-failure-attribution-check      0,1,1,1,0,3,0
  direct-to-develop-bypass-check           0,1,0,0,3,3,0,0,0,0,0,0,0,0,3,3,0,3,0,0
  primitives-drift-check                   0,1,0,3,3,0,0
  profiles-role-coverage-check             0,1,1,1,1,3,0,0
  release-master-advance-needs-check       0,1,1,1,0,3,3,3,0,1,0
  repo-root-derivation-check               0,1,0,3,0
  target-identity-literal-check            0,1,0,1,0,1,0,0,0,0,1,3,0,0
  workflow-runner-self-hosted-check        0,1,0,1,1,3,0

Count = 10.

Refinement (is any of them THIS task's shape — a fault the case expects to REDDEN,
whittled down to a non-fatal 3 that the case accepts as "caught"?): each of the 10 was
re-run with exit 3 NORMALIZED to run_checker's non-fatal 0. Every one then FAILS with a
named diagnostic, i.e. every one PINS the value 3 as its own expectation (a deliberate
NOT-EVALUATED arm), and none reports STAYED-GREEN or exits 0:
  checked-in-write-check                   normalized-case-rc=2
  checker-count-drift-check                normalized-case-rc=5
  criterion-failure-attribution-check      normalized-case-rc=3
  direct-to-develop-bypass-check           normalized-case-rc=1
  primitives-drift-check                   normalized-case-rc=3
  profiles-role-coverage-check             normalized-case-rc=4
  release-master-advance-needs-check       normalized-case-rc=3
  repo-root-derivation-check               normalized-case-rc=2
  target-identity-literal-check            normalized-case-rc=2
  workflow-runner-self-hosted-check        normalized-case-rc=5

Sample diagnostics (the case naming what it expected):
  STAYED-GREEN: checker exited 0 with goals/ REMOVED (unreadable input masquerading as 'no bare failure exits', 硬规则 3b)
  WRONG-WITHHOLD — an unreadable goal store must withhold the verdict (exit 3), got 0
  NOT-EVALUATED not honoured — an absent carrier produced exit 0 (expected 3; 0 would be the 硬规则 3b defect: unreadable reading as PASS)
  NOT-EVALUATED-MISREPORTED — an absent .github/workflows/ exited 0, expected 3 (a missing population must never read as a pass)
  NOT-EVALUATED(a) WRONG — absent fleet repo gave exit 0, expected 3 (⛔ must not be 0 = 'no drift')
  MUTATION-FAIL [NOT-EVALUATED when no init artifact is obtainable]: checker exited 0, expected 3

ac69 itself (post-fix) is in the intersection but NOT in the 10: its raw checker rc
sequence is 0,2,1,0 (baseline / delete / drop-conclusion / restore) — no 3.
Before this task it WAS a member of the class — the Proposal's table records the malformed
arm exiting 3 while the old case accepted any non-zero (so the production gate stayed green).
```

## Blocker

**2026-10-11T16:47:05.315Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 87
- run_id：wk-prod-anchor
- session_id：778d8c38-c1e0-4667-9eab-666459d07b32

（续做轮 2026-10-12 已定位该 suite red 的真因：本条 mutation case 把 wrapper 的
`STATIC_CHECK_FAILED:` 机器行回显进了静态相位流 —— 见 §AC3b。修复后再无任何失败模式行。）
