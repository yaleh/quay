# M78 Iteration-0 Acceptance Audit

**Audit session id:** adversarial-auditor-m78-iteration-0-2026-07-21

**Worktree:** `/home/yale/work/quay/milestones/M78/worktrees/iteration-0`
**Branch:** `exp5-m78-iteration-0`
**HEAD commit:** `bbf00b6`
**Audit date:** 2026-07-21
**Auditor stance:** Adversarial — default scepticism; REFUTE unless evidence is conclusive.

---

## Check 1 — Gate selfcheck (RED+GREEN fixture pair)

**Command:**
```
bash /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check-selfcheck.sh
echo "exit: $?"
```

**Actual output:**
```
PASS (RED): over-cap fixture correctly exited non-zero (exit 1)
PASS (GREEN): under-cap fixture correctly exited 0

PASS: both dashboard line-budget fixtures behaved as asserted (RED+GREEN).
exit: 0
```

**Verdict: CONFIRMED**

The selfcheck script produces both a RED pass (over-cap fixture exits non-zero) and GREEN pass (under-cap fixture exits 0), then exits 0 overall. Done-when criterion 1 (selfcheck) is met.

---

## Check 2 — Gate on post-cut dashboard.md

**Command:**
```
bash /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard.md
echo "exit: $?"
```

**Actual output:**
```
PASS: /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard.md — 511 lines (cap 1200). Dashboard is within the line budget.
exit: 0
```

**Verdict: CONFIRMED**

Gate exits 0 on the current dashboard.md (511 lines, well under 1200 cap). Done-when criterion 1 (exits 0 on post-cut dashboard) is met.

---

## Check 3 — dashboard.md line count

**Command:**
```
wc -l /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard.md
```

**Actual output:**
```
511 /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard.md
```

**Verdict: CONFIRMED**

511 lines < 1200. Done-when criterion 3 is met with substantial headroom.

---

## Check 4 — OUTER-LOOP.md: gate wired as HARD block before milestone_counter++

**Command:**
```
grep -n "dashboard\|summary.row\|Δv.*v̂\|audit.*merge.*sha\|milestone_counter" /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/OUTER-LOOP.md | head -30
```

**Actual output (excerpt relevant lines):**
```
107:   each item — never here, never by the loop itself. Clause 0 HARD-blocks step 7's `milestone_counter++`
244:   `|Δv−Δv̂|/Δv̂`; update ρ (fraction executed with inherited method unchanged); append the milestone's
249:   block format for ALL future milestones):** emit ONE LINE into `dashboard.md`'s `## Log` section per
250:   milestone ABSORB, using this exact format:
251:   `m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
252:   where `<verdict>` is one of `NO REFUTATION FOUND` / `CONCERNS` / `REFUTED`. Example:
253:   `m78 · DIR-054 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=abc1234 · → milestones/M78/`
254:   Full ABSORB narrative lives in `milestones/M<NN>/iteration-0.md` (the iteration report); the `## Log`
...
427:   - **Dashboard context-budget gate (DIR-054/M78; HARD-BLOCKS step 7's `milestone_counter++`):**
428:     run `bash experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` and
429:     paste stdout as evidence; non-zero exit HARD-BLOCKS `milestone_counter++`.
```

**Supplementary confirmation — gate position relative to step 7:**

Line 427 wires the dashboard gate inside step 6 (ABSORB). Step 7 (UPDATE DASHBOARD) begins at line 483 and contains `milestone_counter++` conditioned on "the V_meta gate, the design-only-milestone impl-row gate, AND the DoD meta-enforcer gate above ALL clear, AND the ABSORB `master` merge sub-step above has landed" (lines 485-487). The dashboard context-budget gate at line 427 textually precedes step 7's `milestone_counter++` and explicitly states "HARD-BLOCKS step 7's `milestone_counter++`".

**ONE-LINE summary row format (criterion 2b):**

Lines 249-253 of OUTER-LOOP.md explicitly prescribe:
```
emit ONE LINE into `dashboard.md`'s `## Log` section per milestone ABSORB, using this exact format:
`m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
```
With explicit example for M78. The prohibition against multi-section blocks is also stated: "The dashboard-context-budget gate" (line 255 context).

**Verdict: CONFIRMED**

(a) Dashboard gate is wired as HARD block before `milestone_counter++` at step 7 (gate at OUTER-LOOP.md line 427, step 7 at line 483). (b) ABSORB write-step is amended to ONE-LINE summary row format at lines 249-253. Done-when criterion 2 is fully met.

---

## Check 5 — Archive file exists

**Command:**
```
wc -l /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md
```

**Actual output:**
```
6006 /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md
```

Directory listing confirms only one file in archive:
```
log-m25-m72.md
```

**Verdict: CONFIRMED**

`dashboard-archive/log-m25-m72.md` exists with 6006 lines (the cut content). Done-when criterion 4 is met.

---

## Check 6 — Head sections (lines 1–379) unchanged from master

**Command:**
```
git diff HEAD~1 -- experiments/quay-perpetual-stream/dashboard.md | head -80
```

**Actual diff hunk header:**
```
@@ -378,6012 +378,6 @@ at its existing `OUTER-LOOP.md` step-6 dispatch point, not a new separately-sche
```

**Analysis:**

The single diff hunk starts at old-file line 378. This means lines 1 through 377 have zero diff lines — they are byte-for-byte identical to the previous commit. The hunk header context line (`at its existing \`OUTER-LOOP.md\` step-6 dispatch point...`) is line 378 of the old file; the change begins at line 378 of the original (removing 6012 lines and replacing with 6 lines).

Inspecting the current dashboard.md around the boundary (lines 375-391) confirms the `## Control limits` section, `## Log` header, and the first remaining log entry (`## M73 SELECT`) are intact — the `## Log` header itself sits at approximately line 381 in the current file, consistent with lines 1-380 being unchanged header material.

**Minor observation:** The Done-when criterion says "lines 1-379" unchanged; the diff hunk starts at line 378 (which is a context line, not a deletion). Lines 1-377 are provably unmodified. Line 378 appears as diff context (unchanged). Whether line 379 is the `## Log` header (unchanged) or part of the removed block is consistent with the hunk format showing line 378 as context — the deletion starts after it. This is not a refutation.

**Verdict: CONFIRMED**

Lines 1-377 are provably unchanged (no diff output before the hunk at line 378). The hunk context line at 378 is also unchanged. The head sections (VT curve, health tracks, control limits) are intact.

---

## Check 7 — Gate script actually counts lines and compares against 1200

**Command:**
```
cat /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh
```

**Actual output:**
```bash
#!/usr/bin/env bash
# it0-dashboard-line-budget-check.sh — dashboard context-budget gate (DIR-054 / M78).
# ...
CAP=1200
# ...
line_count=$(wc -l < "$DASHBOARD")

if [ "$line_count" -lt "$CAP" ]; then
  echo "PASS: $DASHBOARD — $line_count lines (cap $CAP). Dashboard is within the line budget."
  exit 0
fi

echo "FAIL: $DASHBOARD — $line_count lines meets or exceeds the cap of $CAP lines."
echo "Trim the ## Log section (archive old entries to dashboard-archive/) before completing ABSORB."
echo "The rolling-window discipline: retain only the last ~5 milestones in ## Log."
exit 1
```

**Verdict: CONFIRMED**

The script uses `wc -l` to count lines, compares with `CAP=1200` using `-lt` (strict less-than), exits 0 on pass and 1 on fail. Logic is correct and matches claims.

---

## Check 8 — ONE-LINE format described in OUTER-LOOP.md for ABSORB write-step

**Command:**
```
grep -n -A 5 "summary.row\|ONE.LINE\|ONE LINE\|one-line\|one line" /home/yale/work/quay/milestones/M78/worktrees/iteration-0/experiments/quay-perpetual-stream/OUTER-LOOP.md | head -40
```

**Actual output:**
```
88:   selected (M-NN)` section stating the pass number and one-line reason (aged-out, smaller Δv̂, wrong
...
249:   block format for ALL future milestones):** emit ONE LINE into `dashboard.md`'s `## Log` section per
250-   milestone ABSORB, using this exact format:
251-   `m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
252-   where `<verdict>` is one of `NO REFUTATION FOUND` / `CONCERNS` / `REFUTED`. Example:
253-   `m78 · DIR-054 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=abc1234 · → milestones/M78/`
254-   Full ABSORB narrative lives in `milestones/M<NN>/iteration-0.md` (the iteration report); the `## Log`
```

**Verdict: CONFIRMED**

The ABSORB write-step in OUTER-LOOP.md explicitly mandates ONE LINE per milestone in the `## Log` section with a specified format including `audit=<verdict>` and `merge=<sha>`. Done-when criterion 2b is confirmed from raw text.

---

## Check 9 — Test suite (no regressions)

**Command:**
```
cd /home/yale/work/quay/milestones/M78/worktrees/iteration-0/packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

**Actual output:**
```
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

**Verdict: CONFIRMED**

342 tests, 338 pass, 4 fail — exactly matches the pre-existing baseline. No new regressions introduced.

---

## Summary table

| # | Done-when criterion | Result |
|---|---|---|
| 1a | `it0-dashboard-line-budget-check-selfcheck.sh` exits 0, RED+GREEN | CONFIRMED |
| 1b | Gate exits 0 on post-cut `dashboard.md` | CONFIRMED |
| 2a | `OUTER-LOOP.md`: gate wired as HARD block before `milestone_counter++` | CONFIRMED |
| 2b | `OUTER-LOOP.md`: ABSORB write-step amended to ONE-LINE summary row format | CONFIRMED |
| 3 | `dashboard.md` wc -l < 1200 | CONFIRMED (511 lines) |
| 4 | `dashboard-archive/log-m25-m72.md` exists with cut content | CONFIRMED (6006 lines) |
| 5 | Head sections (lines 1-379) unchanged from master | CONFIRMED |
| 9 | Test suite: 342 tests, 338 pass, 4 fail (pre-existing baseline) | CONFIRMED |

---

## Final verdict

**NO REFUTATION FOUND**

All five Done-when criteria are confirmed from raw command output. No fabrication, no drift, no regressions detected. The gate script is mechanically sound (correct `wc -l` + integer comparison), the selfcheck is a genuine RED+GREEN fixture pair, the dashboard cut is real (6006 lines archived, 511 remaining), the OUTER-LOOP.md wiring is textually present at the correct structural position (step 6 ABSORB, before step 7 `milestone_counter++`), and the ONE-LINE format mandate is explicit with a worked example.
