# M178 — iteration-0 acceptance audit (DIR-113)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: NO REFUTATION FOUND**

Fresh-context adversarial re-audit of DIR-113 ("Pre-screen task-level `## Touches` orthogonality
before charter-authoring"), milestone M178. This is a re-run of the prior REFUTED audit pass (same
session id, `b2e1e1e`): that pass found the DIR-113 *implementation* substance-clean but the
mechanical gate blocked purely on a missing `/tmp/m178-absorb-entry.md` disposition. This pass (a)
independently re-verifies every AC/DoD claim from scratch (not trusting the prior write-up or the
implementer's report), (b) confirms the intervening "Build re-dispatch" commit (`fe2da05`) already
fixed the `clause7-test-floor` surface-tag gap, and (c) supplies the two remaining disposition
statements (`clause1`/`clause2`) that only the Audit phase itself is entitled to produce, then
re-runs the mechanical gate.

## 1. AC satisfaction (refute-first, independently re-executed)

### AC1 — `derive-touches-heuristic.ts` exists, sibling test ≥80% coverage, DIR-109 pre-charter
body extraction is a superset of the M173-landed Touches list

**CONFIRMED.** Independently re-ran:

```
$ bash experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh
✔ DIR-113 AC1: DIR-109 pre-charter body extraction is a superset of the M173-landed Touches (63.6ms)
...
ℹ tests 24  ℹ pass 24  ℹ fail 0
```

24/24 pass. (Coverage figures — line 98.94% / branch 94.64% — were independently confirmed in this
same session's earlier `--experimental-test-coverage` run; re-confirmed here via the selfcheck
wrapper's full pass with no regression.)

### AC2 — `select-preflight.ts` shortlist assembly: given ≥2 touches-disjoint candidates, an
explicit "found orthogonal pair" log line appears BEFORE any charter-authoring fork is dispatched

**CONFIRMED.** Read `select-preflight.ts` directly: in `main()`, line 887-888 does
`for (const line of result.orthogonalScan.log) console.error(...)`, and line 890 —
strictly after, same synchronous function — does `console.log(JSON.stringify(result, null, 2))`.
No branch lets the JSON print first. Independently re-ran against the **live, non-fixture** task
store:

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts \
    --json --workspace-root . 1>/tmp/sp-out.json 2>/tmp/sp-err.log
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-099 (declared) ∥ DIR-100 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-099 (declared) ∥ DIR-101 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-100 (declared) ∥ DIR-101 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-100 (declared) ∥ DIR-103 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-100 (declared) ∥ DIR-104 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-101 (declared) ∥ DIR-103 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-101 (declared) ∥ DIR-104 (declared) — disjoint file-sets
```

7 real orthogonal pairs this run (task-store state has drifted slightly since the earlier 9-line
run cited in the prior audit — expected, since new candidates have entered/left the pool; the
mechanism itself is what's under test, not a fixed count). Confirmed via
`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs`:
30/30 pass (up from the prior pass's 21/21 — 9 new tests landed by the intervening M181 milestone,
no regression).

### AC3 — 11 named autonomous-eligible candidates all carry real `## Touches`

**CONFIRMED.**

```
$ grep -l '^## Touches' tasks/DIR-{099,100,101,103,104,105,109,110,111,112}.md \
    tasks/exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md | wc -l
11
```

### AC4 — golden-replay of M173's SELECT (DIR-070/DIR-109/DIR-110) reproduces the real 1-wide
narrowing verdict

**CONFIRMED.** Independently ran:

```
$ node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts \
    tasks/DIR-109.md tasks/DIR-110.md
OVERLAP: tasks/DIR-109.md ✗ tasks/DIR-110.md — must serialize (overlapping file-sets) \
  [overlap: .github/workflows/ci.yml]
(exit 1)
```

Matches the real M173 1-wide narrowing exactly.

### AC5 — `anti-drift-touches-check.ts`'s existing test suite unaffected, passes unmodified

**CONFIRMED.**

```
$ node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs \
    experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs
ℹ tests 46  ℹ pass 46  ℹ fail 0
```

The previously-filed `gap-touches-orthogonality-symlink-isdirect-mismatch` (pre-existing
`anti-drift-touches-selfcheck.sh` CLI-wrapper bug, independently reproduced on the pre-M178 commit
by the prior audit pass) is unchanged territory — not re-litigated here since it was already
confirmed pre-existing and unrelated.

## 1a. Checklist write-back (DIR-020)

`tasks/DIR-113.md` already carries all 5 AC + 5 DoD items ticked `[x]` with inline evidence
citations, written back by the prior audit pass in this same session (commit `b2e1e1e`). This
pass's independent re-execution reconfirms every one of those citations still holds against current
`master` — no drift found, no edit needed.

## 2. DoD satisfaction

Substantively satisfied — reconfirmed above, no new gap found. The soft schema check was also
independently re-verified this pass:

```
$ bash experiments/quay-perpetual-stream/scripts/task-schema-selfcheck.sh
PASS: all 14 fixtures behaved as asserted.
```

## 2a. Disposition append (gap-absorb-entry-clause-disposition-sequencing / M180)

Before running the mechanical gate, appended two disposition lines to `/tmp/m178-absorb-entry.md`
(pre-existing file from the M178 Build re-dispatch, already carrying the `surface:method-infra`
backlog-row fix from `fe2da05` but no clause1/clause2 disposition yet):

1. `adversarial-audit disposition: NO REFUTATION FOUND` — written only after reaching that verdict
   via the independent re-execution above.
2. `V_meta consolidation-lag: <verbatim result>` — ran the exact command the later Gate phase runs:

```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 181 \
    experiments/quay-perpetual-stream/v-meta-ledger.md
V_meta consolidation-lag check — experiments/quay-perpetual-stream/v-meta-ledger.md
milestone_counter=181 K=2
  [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
  [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

PASS: no confirmed-unconsolidated row past K without a dated carry-forward
exit=0
```

(counter = 182 − 1 = 181, per `dashboard.md`'s current `milestone_counter: 182`.) The verbatim
`PASS: no confirmed-unconsolidated row past K without a dated carry-forward` text was copied
into the appended disposition line, not paraphrased.

## 3. Mechanical gate

Run before appending the two disposition lines (clause7 already fixed by the prior Build
re-dispatch, `fe2da05`):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-113 \
    experiments/quay-perpetual-stream/charters/M178-dir113-touches-preflight.md \
    /tmp/m178-absorb-entry.md
PASS: clause0-ac-dod-present ...
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text
FAIL: DoD check failed — 2 clause violation(s) found
Exit code: 1
```

Re-run after appending the disposition lines (§2a above):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-113 \
    experiments/quay-perpetual-stream/charters/M178-dir113-touches-preflight.md \
    /tmp/m178-absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 5 checkable clause(s) (checklist-form, 5/5 checked)
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS
PASS: clause4-impl-row: PASS
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record: N/A — legacy/unlabeled task
PASS: clause10-tree-hygiene: PASS — clean
PASS: clause11-worktree-branch-hygiene: PASS — clean
PASS: clause12-audit-independence: N/A — documented no-op
N/A: clause9-split-or-commit: no `needs-human` outcome declared

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
Exit code: 0
```

**Zero exit → passes this audit's mechanical-gate charge.**

## 4. Deviation-log write-back (DIR-017 Step 3)

No new row required: this pass's finding is `NO REFUTATION FOUND`, not `REFUTED`/`CONCERNS`, so the
charge's write-back trigger does not fire. The pre-existing `REFUTED | machine | M178` row in
`dashboard.md`'s Homeostatic-variables deviation table (added by the prior audit pass in this same
session) is left untouched as an accurate historical record of that earlier state (gate genuinely
exited 1 at that time, purely on the missing-disposition gap); it is superseded in substance by
this pass's `exit 0` re-run, documented here rather than retroactively edited.

## Summary

Independently re-executed all 5 AC + 5 DoD checks from a fresh context: no defect found anywhere in
the DIR-113 implementation (`derive-touches-heuristic.ts`, `select-preflight.ts`'s pre-charter
orthogonality scan, `task-schema-check.ts`'s soft warning, the 11 backfilled task-level `## Touches`
sections, and the untouched `anti-drift-touches-check.ts` authoritative gate). The previously
REFUTED verdict was driven entirely by a missing `/tmp/m178-absorb-entry.md` disposition
(clause1/clause2), which the intervening Build re-dispatch (`fe2da05`, clause7 surface-tag fix) and
this audit pass's own required disposition append (§2a) have now both resolved. The mechanical gate
now exits 0 with all 12 applicable clauses PASS/N/A.

**Verdict: NO REFUTATION FOUND.**
