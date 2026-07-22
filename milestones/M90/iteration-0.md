# Milestone M90 — iteration-0 report

**Task:** `exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP`  
**Charter:** `experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md`  
**Branch:** `exp5-m90-iteration-0`  
**Date:** 2026-07-22  
**Status:** COMPLETE (Done-when 1-3 confirmed)

---

## §1 — Setup

Worktree created:

```
git worktree add milestones/M90/worktrees/iteration-0 -b exp5-m90-iteration-0
HEAD is now at 543080a SELECT M90: exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP (OUTER-LOOP.md dispatch-record doc fix)
```

---

## §2 — HARD GATES (raw output)

**[ ] `ls -1 experiments/quay-continuous-bootstrap/directives/pending/`**

```
ls: cannot access '/home/yale/work/quay/experiments/quay-continuous-bootstrap/directives/pending/': No such file or directory
```

The `experiments/quay-continuous-bootstrap/directives/pending/` directory does not exist (exp4 is a closed historical experiment; its pending/ mechanism was retired). No files to disposition.

**[ ] `cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"`**

```
http://localhost:34303
{"root":"/home/yale/work/quay"}
```

manda healthz: PASS.

**[ ] `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"`**

```
200
```

Port-4173 (Web UI) reachability: 200 OK. (Note: the charter states this gate is N/A — no Web UI surface change in M90 — but the service happens to be running; pasted as required.)

**[ ] Worktree add — "HEAD is now at" line:**

```
HEAD is now at 543080a SELECT M90: exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP (OUTER-LOOP.md dispatch-record doc fix)
```

All worktree-isolated edits in this iteration target paths under `milestones/M90/worktrees/iteration-0/`.

**N/A gates (per charter):**
- manda healthz: **present above** (service running, not N/A after all — pasted as evidence)
- Port-4173 reachability: **present above** (service running, not N/A after all — pasted as evidence)

---

## §3 — The fix (Done-when 1)

### Diff: `experiments/quay-perpetual-stream/OUTER-LOOP.md`

```diff
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -403,6 +403,32 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
        not re-derive them — so un-authored dispositions pass silently unless you write them in. The
        `extra.acceptance` command references this FILE PATH, never ABSORB text baked in at SELECT
        (chicken/egg: the narrative is drafted live, mid-milestone).
+       - **Dispatch-record file — concrete operator procedure (M90/exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP).**
+         Clause 12 (audit-independence) HARD-FAILS if the dispatch-record file is absent or the audit
+         session ID it records does not appear in the audit artifact. To avoid this recurring failure,
+         follow these steps IN ORDER when dispatching the adversarial audit subagent at this ABSORB step:
+         1. **Dispatch the audit subagent** (a fresh-context `baime:iteration-executor` call,
+            `run_in_background=true`, refutation-focused prompt per `inherited-core.md`'s
+            "Adversarial-audit role" section).
+         2. **Record the session ID you receive back** from the dispatch (the `Agent tool` / task ID
+            / session identifier the harness assigns to the dispatched subagent's run).
+         3. **Immediately create the dispatch-record file** (before authoring the ABSORB entry):
+            ```
+            echo "<audit-session-id-received-in-step-2>" > /tmp/m<NN>-dispatch-record.txt
+            ```
+            One session ID per line, bare (no prose). If you dispatch multiple audit subagents,
+            append each ID: `echo "<id2>" >> /tmp/m<NN>-dispatch-record.txt`.
+         4. **Include `## Audit-independence check` in the ABSORB entry** with exactly these three
+            lines (copy this block verbatim, substituting real values):
+            ```
+            ## Audit-independence check
+            Artifact: milestones/M<NN>/audits/iteration-0-acceptance-audit.md
+            Orchestrator id: <this session's own id>
+            Dispatch record: /tmp/m<NN>-dispatch-record.txt
+            ```
+         5. **Reminder:** `Dispatch record: N/A` invokes `--allow-uncorroborated` (pre-DIR-034
+            escape hatch) — only use it when no real independent audit was dispatched (unusual;
+            the acceptance audit should refute the N/A disposition if an audit actually ran).
      - **`extra.acceptance` convention:** `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
```

Done-when 1: CONFIRMED — OUTER-LOOP.md step 6 "Ordering + disposition authoring" sub-step now includes:
- Explicit step-by-step dispatch-record file creation procedure (steps 1-3)
- Concrete sample `## Audit-independence check` block (step 4)
- Reminder about N/A escape hatch (step 5)

---

## §4 — Synthetic test proof (Done-when 2)

### Test setup

- Dispatch-record file: `/tmp/m90-test-dispatch-record.txt` containing `m90-iter0-test-session-2026-07-22`
- Audit artifact: `milestones/M90/audits/iteration-0-acceptance-audit.md` containing `**Audit session id:** m90-iter0-test-session-2026-07-22`
- Synthetic ABSORB entry `/tmp/m90-test-absorb-entry.md` with:
  ```
  ## Audit-independence check
  Artifact: milestones/M90/audits/iteration-0-acceptance-audit.md
  Orchestrator id: test-orchestrator-id
  Dispatch record: /tmp/m90-test-dispatch-record.txt
  ```

### `it0-dod-check.mjs` output (full)

```
--- it0-dod-check: exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP ---
charter: experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md
absorb-entry: /tmp/m90-test-absorb-entry.md

PASS: clause3-line-budget: PASS — PASS: experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
PASS: clause5-no-self-exemption: no undeclared self-exemption language found (or all found exemptions have a matching WAIVER line)
PASS: clause6-escrow-delta-v: PASS — design-only milestone claims no Δv (documented no-op, e.g. 'Δv̂: 0, no VT chart cell')
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching (method-infra/docs/cross-cutting/packaging)
PASS: clause8-task-canonical-lifecycle-record: N/A — no 'milestone:M<N>' label found — legacy/unlabeled task, predates the DIR-014 item 6 cutover [tasks/exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP.md]
PASS: clause10-tree-hygiene: PASS — tree-hygiene: clean — no un-gitignored scratch left in the main tree.
PASS: clause11-worktree-branch-hygiene: PASS — worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
PASS: clause12-audit-independence: PASS — PASS: audit artifact's session id ("m90-iter0-test-session-2026-07-22") is distinct from the orchestrator's own id ("test-orchestrator-id") AND is corroborated by the independent dispatch-record — genuinely independent (DIR-034 anti-forgery check satisfied)
N/A: clause9-split-or-commit: no `needs-human` outcome declared — N/A (the done path is governed by clauses 0-8; a partial/unchecked-AC ABSORB is HARD-blocked by clause 0)
FAIL: clause0-ac-dod-present: checklist-form AC has 3 unchecked item(s) remaining ...
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text ...
FAIL: clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text ...
FAIL: clause4-impl-row: FAIL — design-only milestone impl-row rule ...

FAIL: DoD check failed — 4 clause violation(s) found (see above).
```

**Clause 12 line (the only clause that matters for this Done-when):**
```
PASS: clause12-audit-independence: PASS — PASS: audit artifact's session id ("m90-iter0-test-session-2026-07-22") is distinct from the orchestrator's own id ("test-orchestrator-id") AND is corroborated by the independent dispatch-record — genuinely independent (DIR-034 anti-forgery check satisfied)
```

Done-when 2: CONFIRMED — Clause 12 shows `clause12-audit-independence: PASS` on first attempt.

The other FAILs (clauses 0/1/2/4) are expected for a synthetic test fixture — they require real ABSORB content (actual AC checks, audit verdict, vmeta-lag disposition, impl-row). The clause 12 test is isolated and correct.

---

## §5 — Gate script unchanged (Done-when 3)

```
$ cd milestones/M90/worktrees/iteration-0 && git diff HEAD -- experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
(empty output)
```

Done-when 3: CONFIRMED — `it0-dod-check.mjs` has zero diff vs HEAD. Only `OUTER-LOOP.md` was touched.

---

## §6 — Done-when status

| # | Clause | Status |
|---|---|---|
| 1 | OUTER-LOOP.md step 6 updated with dispatch-record procedure + sample block | CONFIRMED |
| 2 | Synthetic ABSORB entry passes `clause12-audit-independence: PASS` | CONFIRMED |
| 3 | `it0-dod-check.mjs` unchanged — git diff empty | CONFIRMED |
| 4 | Adversarial audit verdict | ABSORB-time (outer loop) |
| 5 | `quay gate exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP` | ABSORB-time (outer loop) |

---

## §7 — Issues / blockers

None. The iteration completed all three iteration-0 Done-when clauses.

---

## §8 — Artifacts

- `milestones/M90/worktrees/iteration-0/experiments/quay-perpetual-stream/OUTER-LOOP.md` — edited (26-line addition)
- `milestones/M90/worktrees/iteration-0/milestones/M90/audits/iteration-0-acceptance-audit.md` — synthetic test fixture
- `/tmp/m90-test-dispatch-record.txt` — synthetic dispatch-record (not committed, ephemeral)
- `/tmp/m90-test-absorb-entry.md` — synthetic absorb entry (not committed, ephemeral)
