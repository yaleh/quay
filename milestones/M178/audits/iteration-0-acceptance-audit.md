# M178 — iteration-0 acceptance audit (DIR-113)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: REFUTED**

Fresh-context adversarial audit of DIR-113 ("Pre-screen task-level `## Touches` orthogonality
before charter-authoring"), milestone M178. This audit did not see the build; all findings below
are derived by independently re-running the tests/scripts/greps myself and reading the checked-in
diffs, not by trusting the implementer's iteration report or commit message.

## 1. AC satisfaction (refute-first)

### AC1 — `derive-touches-heuristic.ts` exists, sibling test ≥80% coverage, DIR-109 pre-charter
body extraction is a superset of the M173-landed Touches list

**CONFIRMED.** Independently re-ran:

```
$ node --experimental-strip-types --experimental-test-coverage --test \
    experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts
✔ DIR-113 AC1: DIR-109 pre-charter body extraction is a superset of the M173-landed Touches (55ms)
...
ℹ tests 24  ℹ pass 24  ℹ fail 0
ℹ derive-touches-heuristic.ts | line 98.94 | branch 94.64 | funcs 100.00
```

24/24 pass, both line and branch coverage well above the 80% bar. The AC1 test embeds DIR-109's
actual pre-charter body text (commit `15d58e9`) and asserts every one of the 6 M173-charter-landed
Touches items (`scripts/test.sh`, 3 test files, `CLAUDE.md`, `.github/workflows/ci.yml`) is present
in the derived output — I read the assertion (`assert.deepEqual(missing, [])`) directly, it is not
a tautology.

### AC2 — `select-preflight.ts` shortlist assembly: given ≥2 touches-disjoint candidates, an
explicit "found orthogonal pair" log line appears BEFORE any charter-authoring fork is dispatched

**CONFIRMED.** Read the diff: `main()` in `select-preflight.ts` does
`for (const line of result.orthogonalScan.log) console.error(...)` **before**
`console.log(JSON.stringify(result, null, 2))` — synchronous, same function, no way for the JSON
payload to print first. I independently re-ran the CLI against the **live, non-fixture** task
store (not a canned fixture):

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts \
    --json --workspace-root . --milestone-counter 178 1>/dev/null
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-057 (auto-derived) ∥ DIR-099 (declared) — disjoint file-sets
... (9 lines total)
```

9 real orthogonal pairs, matching the commit message's claim exactly — reproduced independently,
not copied from the iteration report. `scanOrthogonalPairs`'s own unit tests
(`scan-log-explicit-on-none-found`, `scan-log-explicit-on-empty-candidates`) also cover the
"no pair found" arm, confirmed via `select-preflight.test.mjs` (21/21 pass).

### AC3 — 11 named autonomous-eligible candidates all carry real `## Touches`

**CONFIRMED.**

```
$ grep -l '^## Touches' tasks/DIR-{099,100,101,103,104,105,109,110,111,112}.md \
    tasks/exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md | wc -l
11
```

Spot-checked 2 for fabrication risk (auto-derived text silently passed off as reviewed):
DIR-112's own `## Plan` says verbatim "touches only `packages/quay/test/cli.test.mjs`" — matches
its backfilled `## Touches` exactly. DIR-105's own "Code changes" list names `store.ts:125`,
`quay-native.ts:83`, `init.ts:71,81` verbatim — matches. Neither carries the
"(auto-derived, unverified…)" annotation `renderTouchesSection` emits, consistent with these being
genuinely reviewed, not raw heuristic output.

### AC4 — golden-replay of M173's SELECT (DIR-070/DIR-109/DIR-110) reproduces the real 1-wide
narrowing verdict

**CONFIRMED.** Independently ran the real (non-symlinked) checker directly:

```
$ node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts \
    tasks/DIR-109.md tasks/DIR-110.md
OVERLAP: tasks/DIR-109.md ✗ tasks/DIR-110.md — must serialize (overlapping file-sets) \
  [overlap: .github/workflows/ci.yml]
(exit 1)
```

Reproduces the real M173 outcome (DIR-109×DIR-110 narrowed the batch to 1-wide because both touch
`.github/workflows/ci.yml`) exactly, from the newly-backfilled task-level Touches — proving the
change only moves the judgment earlier, doesn't alter the verdict.

### AC5 — `anti-drift-touches-check.ts`'s existing test suite unaffected, passes unmodified

**CONFIRMED**, with one caveat surfaced by digging past the self-report. Independently ran:

```
$ node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs \
    experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs
ℹ tests 46  ℹ pass 46  ℹ fail 0
```

46/46 pass — this is the "existing test suite" the AC names. Separately, the CLI-fixture wrapper
`anti-drift-touches-selfcheck.sh` DOES fail (3/4 fixtures FAIL — a symlink/`isDirect`-realpath
mismatch, unrelated to Touches logic). I did not take the iteration report's word that this is
"pre-existing" — I created a throwaway worktree at the pre-M178 commit (`0b9255a`) and reran the
identical selfcheck there:

```
$ git worktree add /tmp/pre-dir113-check 0b9255a
$ cd /tmp/pre-dir113-check && bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh
FAIL: mis-declared-overlap-BITES / stray-write-BITES / overbroad-declaration-BITES (identical)
```

Confirmed pre-existing, not caused by this milestone (`anti-drift-touches-check.ts`,
`touches-orthogonality-check.ts`, `concurrent-batch-scheduler.ts` are all absent from this
milestone's diff — verified via `git show 3f28b4e --stat`). Filed as
`gap-touches-orthogonality-symlink-isdirect-mismatch` (task file present, confirmed).

## 1a. Checklist write-back (DIR-020)

Applied directly to `tasks/DIR-113.md` — all 5 AC items and all 5 DoD items ticked `[x]` with
inline evidence citations (each citation names the exact command re-run and its result):

- AC1 (derive-touches-heuristic.ts + coverage + DIR-109 superset) → `[x]`
- AC2 (pre-charter log, before fork) → `[x]`
- AC3 (11/11 Touches backfilled) → `[x]`
- AC4 (golden-replay of M173) → `[x]`
- AC5 (anti-drift suite unaffected) → `[x]`
- DoD "extraction + soft schema check landed, real tests, `node --test` passes" → `[x]`
- DoD "select-preflight scan wired into call chain, real non-fixture SELECT evidence" → `[x]`
- DoD "real SELECT cycle produced ≥2-wide batch OR explicit no-pair log" → `[x]` (found-pair arm;
  see nuance below)
- DoD "11 backfilled Touches reviewed, cross-checked against Requested action" → `[x]`
- DoD "human-steered discipline (halt/golden-replay/independent audit), no autonomous SELECT" →
  `[x]` (task carries `label:human-steered`; `.halt` sentinel mtime 2026-07-26T12:42:43Z predates
  the M178 merge commit `3f28b4e` at 2026-07-26T17:22:53Z by ~4.7h; charter text: "the largest of
  the 5 human-steered milestones this session"; this audit is itself the independent-audit leg)

**Nuance on the "≥2-wide batch OR no-pair" DoD item**: the literal text names two arms (a batch was
produced, or an explicit "no orthogonal pair" line was logged). What actually happened is a third
case — 9 orthogonal pairs WERE found and logged, but no downstream batch was actually dispatched
this session (dispatching a batch is a separate, later pipeline stage outside DIR-113's declared
scope, which only closes the pre-screen step). I read this as satisfying the clause's own stated
intent (its closing sentence: "两种结果都算证据，但'完全没打印这行日志'不算完成" — only silence
fails it), not a literal third failing case, and ticked it — but flag the interpretive gap here
rather than silently resolving it in the citation alone.

## 2. DoD satisfaction

Substantively satisfied per the write-back above — no AC/DoD content gap found. However, per the
mechanical-gate governing rule below, the overall verdict is still REFUTED (see §3).

## 3. Mechanical gate

Run before write-back:

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-113 \
    experiments/quay-perpetual-stream/charters/M178-dir113-touches-preflight.md \
    /tmp/m178-absorb-entry.md
FAIL: clause0-ac-dod-present — checklist-form AC has 5 unchecked item(s) remaining
FAIL: clause1-adversarial-audit — NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag — NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor — neither a ≥80% coverage disposition NOR a matching WAIVER line
FAIL: DoD check failed — 4 clause violation(s) found
Exit code: 1
```

Re-run after this audit's own checklist write-back (all 5 AC + 5 DoD items ticked):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-113 \
    experiments/quay-perpetual-stream/charters/M178-dir113-touches-preflight.md \
    /tmp/m178-absorb-entry.md
PASS: clause0-ac-dod-present — task AC has 5 checkable clause(s) (checklist-form, 5/5 checked)
FAIL: clause1-adversarial-audit — NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag — NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor — neither a ≥80% coverage disposition NOR a matching WAIVER line
FAIL: DoD check failed — 3 clause violation(s) found
Exit code: 1
```

clause0 now PASSes (write-back closed it). clause1/clause2/clause7 still FAIL because
`/tmp/m178-absorb-entry.md` **does not exist at all** — the ABSORB step has not run for M178 yet
(no dashboard.md row, no backlog.md row, nothing under `/tmp/m178-absorb-entry.md`). This is the
same recurring absorb-entry-template-incompleteness pattern already logged against
M138/M139/M142/M144/M145/M165/M168/M173/M176/M177 in `dashboard.md` — not a defect specific to
DIR-113's own implementation.

**Non-zero exit → REFUTED by construction**, per this audit's charge.

## 4. Deviation-log write-back (DIR-017 Step 3)

One new row appended to `dashboard.md`'s "Homeostatic variables" deviation table, `caught-by:
machine` (this same audit pass; no separate writer/timing split):

- `REFUTED | machine | M178` — mechanical gate exit 1 (post-write-back: 3 clause violations,
  clause1/2/7, all attributable to the missing `/tmp/m178-absorb-entry.md`); explicitly notes this
  audit found NO defect in DIR-113's own implementation — all 5 AC + 5 DoD items independently
  re-confirmed by direct re-execution.

No `caught-by: human` row was added — no ABSORB entry exists anywhere for M178 (no
`/tmp/m178-absorb-entry.md`, no dashboard.md row, no backlog.md row) for the outer loop to have
drafted a disclosure into; there is nothing to transcribe.

## Summary

The DIR-113 implementation itself is real, well-tested, and — as far as this fresh-context,
refute-first pass could determine by independently re-running every check rather than trusting the
write-up — free of AC/DoD substance defects: all 5 AC and all 5 DoD checklist items are
independently confirmed by direct command re-execution (not self-report), including the two hardest
to fake (the DIR-109 superset test, and a real non-fixture SELECT-preflight run against the live
task store that produced 9 genuine orthogonal-pair log lines before the JSON payload). The
pre-existing symlink/`isDirect` CLI bug in the anti-drift selfcheck wrapper was independently
reproduced on the pre-M178 commit, confirming it is not a regression.

But the mechanical gate exits non-zero: no ABSORB entry exists yet for M178 at all (this milestone
has not reached the ABSORB step), so clause1 (adversarial-audit disposition), clause2 (V_meta lag
disposition), and clause7 (test-floor disposition/WAIVER) all FAIL structurally. Per this audit's
own governing charge ("Non-zero exit = REFUTED by construction"), the verdict is REFUTED — driven
entirely by the ABSORB-entry gap, not by any defect in the product change under audit.

**Verdict: REFUTED.**
