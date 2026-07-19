# M38-dod-gate-operative-real-milestone — iteration-0 report

Worktree: `experiments/quay-perpetual-stream/milestones/M38-dod-gate-operative-real-milestone/worktrees/iteration-0`
Branch: `exp5-m38-iteration-0`

## HARD GATES (by-reference)

- Manda healthz gate: **N/A this milestone** — no Web UI surface touched (per charter's explicit
  statement of this exemption).
- Port-4173 reachability gate: **N/A this milestone** — no Web UI surface touched (per charter's
  explicit statement of this exemption).
- `it0-gate-hash-check.sh --by-reference` against the charter: the charter cites
  `GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93` against
  `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131; the HARD GATES block
  text was read directly from that file at the start of this iteration and complied with (worktree
  isolation: all edits below are confined to this worktree; branch discipline followed).

## What I did, in order

### AC item 1 — seed `extra.acceptance` on the real task

Ran:
```
node packages/quay/bin/quay.js task edit exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --acceptance \
  'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md /tmp/m38-iter0-absorb-entry.md' \
  --json
```
Confirmed via the command's own `--json` output: `"extra": {"acceptance": "bash
experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
/tmp/m38-iter0-absorb-entry.md"}`. Task id used (not milestone id), per the established convention
confirmed at M37 ABSORB (grepped `tasks/QENG-5-DEMO-PASS.md`/`QENG-5-DEMO-FAIL.md` and every real
`it0-dod-check.sh` invocation in `dashboard.md` — all use the task id as the first arg).

### AC item 2 — draft a plausible ABSORB entry

Written to `/tmp/m38-iter0-absorb-entry.md` (the same path `extra.acceptance` references). Contains:
SELECT reasoning recap, what this iteration did, a `## Backlog row` section (required by
`it0-dod-check.mjs` clause 4/6 to determine design-only status — this milestone is NOT design-only),
and explicit DoD clause dispositions for all 8 clauses (0-7), including the literal substring
"V_meta consolidation-lag" within the Clause 2 disposition paragraph, per the discovered-at-M37
exact-phrase requirement (`/V_meta consolidation[- ]lag.../i` in `it0-dod-check.mjs`).

### AC item 3 — actually run `quay gate`

```
$ node packages/quay/bin/quay.js gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
quay-native mcp: serving tasks from .../worktrees/iteration-0/tasks
FAIL — acceptance failed (exit 1)
EXIT=1
```

This is the CORRECT real verdict for iteration-0, not a bug. Running the underlying check directly
for full diagnostics:
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE \
    experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md \
    /tmp/m38-iter0-absorb-entry.md
...
PASS: clause1-adversarial-audit ... PASS: clause2-vmeta-lag ... PASS: clause3-line-budget ...
PASS: clause4-impl-row ... PASS: clause5-no-self-exemption ... PASS: clause6-escrow-delta-v ...
PASS: clause7-test-floor ...
FAIL: clause0-ac-dod-present: checklist-form AC has 5 unchecked item(s) remaining (REFUTED-equivalent,
  HARD-blocks exactly as an unmet criterion does): [...5 AC bullets...] [tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md]

FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT=1
```
Clauses 1-7 all PASS/N/A correctly. Clause 0 correctly FAILs because the task's 5 AC checkboxes are
still `- [ ]` — and per this iteration's own explicit instructions, I am the PRIMARY iteration
executor, NOT the out-of-band acceptance-audit subagent, so I must NOT tick those boxes myself (only
the separate audit subagent ticks them, per DIR-020/M34 convention). This means `quay gate` is
CORRECTLY, mechanically HARD-BLOCKing at this point in the real lifecycle — exactly the behavior
DIR-021 wants proven: the gate is not a rubber stamp, it genuinely reflects unmet DoD state. The
milestone's real ABSORB (after the acceptance audit runs and ticks the boxes, or after a second
draft resolves outstanding items) would re-run this exact command and, if the audit confirms NO
REFUTATION FOUND and ticks the boxes, get PASS/exit 0 instead.

### AC item 4 — confirm the GateEvent

```
$ node packages/quay/bin/quay.js gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json
[
  {
    "id": "d8a7e729-9eea-4c93-945f-9c57a069d206",
    "item_id": "exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE",
    "pipeline_id": "exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE",
    "gate": "acceptance",
    "actor": "quay-cli",
    "verdict": "fail",
    "timestamp": "2026-07-19T08:09:19.741Z",
    "payload": { "reason": "acceptance failed (exit 1)" }
  }
]
```
A real GateEvent was appended to the engine's gate-event log (`.quay/gate-events.jsonl`, gitignored
by design as a runtime log — see `.gitignore:16`), keyed to the real task id
`exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`, `verdict: fail`, matching the real exit code above. This
satisfies AC item 2's GateEvent requirement and the REAL LANDING bar's clause (a) — a GateEvent keyed
to this task id exists in `quay gate-log`.

### AC item 5 — promote `quay gate`/`quay complete` to primary in OUTER-LOOP.md step 6

Rewrote the "DoD meta-enforcer gate" paragraph (previously lines ~307-342) so the operative
invocation sequence is: (1) write the absorb-entry-excerpt file first, (2) confirm/seed
`extra.acceptance` referencing that file path, (3) run `quay gate <milestone-task>` as the PRIMARY
invocation (previously this was the bare `it0-dod-check.sh` call, with `quay gate` only mentioned as
an additive "Engine route" side-note), (4) confirm the GateEvent via `quay gate-log --json`, (5)
paste both into the ABSORB log entry. All of the original "Engine route" side-note's substantive
content (QENG-1/QENG-2 references, the `it0-dod-check.sh` reuse relationship, the QENG-5-DEMO-PASS/
FAIL fixture smoke-test lines, the Clause 3/6/7 trigger-condition detail) is preserved, merged into
the new structure — nothing was deleted, only re-sequenced and promoted. Verified:
```
$ grep -nE "quay (gate|complete)" experiments/quay-perpetual-stream/OUTER-LOOP.md
319:     **PRIMARY invocation — `quay gate <milestone-task>` ...
334:     3. Run **`quay gate <milestone-task>`** — this is the OPERATIVE invocation, not
337:        `quay gate` is the wired invocation path ...
341:        `milestone_counter++` **MUST NOT** run until `quay gate <milestone-task>` is re-run and ...
343:     4. Confirm the GateEvent landed: `quay gate-log <milestone-task> --json` ...
345:     5. Paste BOTH the `quay gate` command's literal stdout ...
349:     (`quay complete <milestone-task>` is the equivalent DIR-023-lifecycle-adoption invocation once ...
357:     literal ABSORB text baked in at SELECT time), written immediately before `quay gate` is invoked ...
374:     time: `quay gate QENG-5-DEMO-PASS` → exit 0; `quay gate QENG-5-DEMO-FAIL` → exit 1 (committed ...
376:     wiring itself, but are NOT a substitute for running `quay gate <milestone-task>` against the ...
```
`quay gate <milestone-task>` now appears as step 3 of a numbered PRIMARY procedure, not a
parenthetical side-note.

### AC item 6 / DoD-report item — chicken/egg ABSORB-ordering resolution, explicit

**The problem:** `extra.acceptance`'s command needs an `<absorb-entry-file>` argument, but that
file's real content (the ABSORB narrative) does not exist at SELECT time — it is drafted live,
mid/end of the milestone.

**The resolution (confirmed by direct action, not just assertion):** the command references a FILE
PATH (`/tmp/m38-iter0-absorb-entry.md`), never literal ABSORB text inlined into the `--acceptance`
string itself. This is exactly the same `/tmp/m<NN>-absorb-entry.md` pattern already standing
practice for every `it0-dod-check.sh` invocation since M25 — confirmed by grepping `dashboard.md`:
`/tmp/m37-absorb-entry.md` (M37), and similar placeholders at M25/M28/M29/M30. The ordering in the
REAL flow is:
1. At SELECT time (or at task-authoring time within iteration-0, as done here), the
   `extra.acceptance` command is seeded with the FINAL DECIDED file path (e.g.
   `/tmp/m38-iter0-absorb-entry.md` here, or `/tmp/m38-absorb-entry.md` at the milestone's real
   final ABSORB) — the path itself is decided upfront (a naming convention, not a discovery), even
   though the file's CONTENT does not exist yet.
2. The file does not need to exist for `quay task edit --acceptance` to succeed — `--acceptance`
   just stores a command string; it is not validated/executed at seed time.
3. Immediately before `quay gate <milestone-task>` is actually invoked (at real ABSORB), the
   ABSORB-entry-excerpt file is written to that exact path (the same `awk`/paste extraction from the
   dashboard.md entry-in-progress, the pattern used since M25).
4. `quay gate <milestone-task>` is then run — it reads `extra.acceptance`, which shells out to
   `it0-dod-check.sh <task-id> <charter> <that-now-existing-file>`, and the file has real content by
   the time the check reads it.
This iteration demonstrated the full mechanics of this ordering directly: I wrote
`/tmp/m38-iter0-absorb-entry.md` BEFORE running `quay gate`, and the seeded `extra.acceptance`
command already pointed at that exact path from the moment it was set — no re-seed needed between
steps, because the path was decided once and the file materialized to fill it in later. Do NOT
seed `extra.acceptance` with literal ABSORB text baked in — always a file path, decided early,
written late.

## DoD clauses (0/1/2/3/5 apply; 4/6/7 N/A)

- **Clause 0** (AC/DoD present): task has 5 checkable AC bullets and a `## Definition of Done`
  section referencing the standard clauses — PASS structurally. (The AC bullets themselves are
  correctly still unchecked — see AC item 3 above; that is a clause-0 checklist-completion matter
  for the separate acceptance audit, not a structural-presence matter.)
- **Clause 1** (adversarial-audit): documented no-op at this iteration-0 stage — the unconditional,
  out-of-band audit runs separately per DIR-020/M34 and will record its own verdict.
- **Clause 2** (V_meta consolidation-lag): N/A, re-confirmed — `v-meta-ledger.md`'s one row remains
  `consolidated` since m7, no `confirmed`-and-unresolved rows outstanding. V_meta consolidation-lag
  is clear.
- **Clause 3** (line-budget): re-confirmed PASS via `it0-dod-check.sh`'s own clause3 run above
  (`PASS: experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md —
  scope within the small-milestone norm`).
- **Clause 4** (impl-row): **N/A** — this milestone's own output IS the real-landing proof itself
  (wiring change + its own real exercise), not a design doc awaiting a future `-IMPL` follow-up.
- **Clause 5** (no-self-exemption): PASS — no undeclared self-exemption language found; the charter's
  N/A dispositions for clauses 4/6/7 are each explicitly reasoned in its own DoD paragraph.
- **Clause 6** (escrow-Δv): **N/A** — not design-only (confirmed via the `## Backlog row` text: no
  "design delivered"/"design-doc only" marker).
- **Clause 7** (test-floor): **N/A, re-confirmed via `git diff --stat`:**
  ```
  $ git diff --stat
   experiments/quay-perpetual-stream/OUTER-LOOP.md   | 97 +++++++++++++++--------
   tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md | 12 ++-
   2 files changed, 74 insertions(+), 35 deletions(-)
  ```
  Zero `packages/quay*` files touched — only `OUTER-LOOP.md` prose and the task's `extra.acceptance`
  metadata. Confirms the charter's own N/A determination for this clause.

## Files changed / committed

- `tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md` — `extra.acceptance` seeded (via `quay task
  edit`, which writes directly to this file).
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — step 6 DoD meta-enforcer gate paragraph
  restructured, `quay gate`/`quay complete` promoted to primary instruction, all prior content
  preserved/merged.
- `/tmp/m38-iter0-absorb-entry.md` — draft ABSORB entry (outside repo, referenced by
  `extra.acceptance`; not committed, matches the established `/tmp/m<NN>-absorb-entry.md`
  extraction-file convention which has never been a committed repo artifact).
- This report: `experiments/quay-perpetual-stream/milestones/M38-dod-gate-operative-real-milestone/report.iteration-0.md`.

## AC/DoD checkboxes

Left unchecked (`- [ ]`) in `tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md` per this iteration's
explicit instructions — I am the primary iteration executor, not the out-of-band acceptance-audit
subagent; per DIR-020/M34 convention only that separate audit ticks boxes.

## Summary of evidence for the milestone's own AC items 1-5

1. `extra.acceptance` seeded, non-empty, file-path-referencing — confirmed via `task edit --json`
   output above.
2. `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` actually invoked (not a fixture), exited 1
   matching the real (correctly-FAIL, checklist-incomplete) DoD verdict; `quay gate-log ... --json`
   returned a real GateEvent — both pasted above.
3. `OUTER-LOOP.md` step 6 promotes `quay gate`/`quay complete` to the primary instruction — grep
   output above shows 10 matches inside a numbered PRIMARY procedure, not a side-note.
4. REAL LANDING bar: GateEvent keyed to this exact task id exists in `quay gate-log` (pasted above);
   this report pastes the `quay gate` command output as the DoD-gate evidence (this iteration's own
   dashboard-equivalent artifact, since the real dashboard ABSORB entry is authored later at the
   milestone's actual ABSORB by whichever iteration/reconciliation produces it).
5. Chicken/egg ordering resolution documented explicitly above, with the exact mechanics of when the
   file is decided (early, as a path) vs. written (late, right before `quay gate` runs).
