# Split-Decision Mechanism Review: Auto-Approve Policy & Recommendation Logic

**Date:** 2026-08-01
**Source:** Analysis of 22 prepare-decisions, 8 split decisions, code-level review of `checkSplitRecommendation` + `nextAction`

## 1. Current State: What Got Split?

### Complete Inventory

| Decision | Task | Code | Repairable? | Enacted? |
|---|---|---|---|---|
| split | DIR-124-A | (from parent) | — | ✅ 5 children (A1-A5) exist |
| split | DIR-124-A1 | (wiring coverage) | — | ✅ 2 children (A1a, A1b) exist |
| split | DIR-124-A3 | (wiring coverage) | — | ✅ 2 children (A3a, A3b) exist |
| split | DIR-124-B | 4-mechanism inventory | no | ✅ 4 children (B1-B4) exist |
| split | DIR-124-F | 6-mechanism inventory | no | ✅ 6 children (F1-F6) exist |
| split | DIR-124-A4 | 16-finding subsystem cluster | yes | ❌ children: [] — recorded, not enacted |
| split | DIR-124-A1b | 14 claims vs 6 AC | no | ❌ children: [] — recorded, not enacted |
| split | gap-build-evidence-manifest-missing | 3-mechanism inventory | no | ❌ 3 declared, 0 on disk |
| split | gap-prepare-milestone-epoch-scope-change | (wiring coverage) | — | ❌ 1 declared, 0 on disk |
| commit | DIR-112* | (split recommended, overridden) | — | — |

`*` DIR-112's decision file text says "ProposalReview found wiring-coverage gaps — split as recommended" but decision = "commit". This is a data-quality issue — the reason text is stale.

### Success Rate: 5/9 enacted (56%). 4/9 incomplete (44%).

## 2. The Split-Recommendation Logic (Code Review)

```typescript
// proposal-convergence.ts:212-241
export function checkSplitRecommendation({ ledger, mechanismCount, mechanismInventory, 
  touchSetSize, smallMilestoneTouchBoundary = 8 }) {
  
  // TRIGGER 1: ≥3 distinct-rootCause BLOCKING findings in same subsystem
  // → repairable: true (one delta round can potentially fix)
  const bySubsystem = groupBlockingByRootCause(ledger);
  for (const [subsystem, { count }] of Object.entries(bySubsystem)) {
    if (count >= 3) {
      return { recommend: true, code: "split-subsystem-blocking-cluster", 
               repairable: true };
    }
  }
  
  // TRIGGER 2: >2 independently landable mechanisms
  // → repairable: false (scope change requires charter edit)
  if (effectiveCount > 2) {
    return { recommend: true, code: "split-multi-mechanism", 
             repairable: false };
  }
  
  // TRIGGER 3: touchSetSize > 8
  // → repairable: false
  if (touchSetSize > smallMilestoneTouchBoundary) {
    return { recommend: true, code: "split-touch-set-too-large", 
             repairable: false };
  }
}
```

### The Three Split Codes

| Code | Condition | Repairable | Meaning |
|---|---|---|---|
| `split-subsystem-blocking-cluster` | 3+ blocking findings in one subsystem, same rootCauseKey | **YES** | Potentially fixable with one focused delta round |
| `split-multi-mechanism` | >2 independently landable mechanisms | NO | Scope too broad — must redesign charter |
| `split-touch-set-too-large` | touches > 8 files | NO | Surface too broad — must narrow scope |

### The Repairable Bypass (Currently Skipped by Auto-Approve)

```typescript
// proposal-convergence.ts:253-267
export function nextAction({ ..., splitCheck, splitBypassAvailable }) {
  if (openBlocking === 0) return { action: "stop-prepared" };
  
  // M206/M3: one focused revision + delta review before terminal split
  if (splitCheck?.recommend && splitCheck.repairable === true && 
      splitBypassAvailable === true && (deltaRound || 0) === 0) {
    return { action: "consume-split-bypass", ... };
  }
  
  if (splitCheck?.recommend) return { action: "stop-split", ... };
}
```

The `split-subsystem-blocking-cluster` path has a **built-in bypass**: before recommending terminal split, try one focused delta revision. The split recommendation signal says "this subsystem has ≥3 blocking findings from the same root cause — but they might all be fixable with one targeted edit."

The orchestrator's auto-approve policy **skips this bypass**. It treats all split recommendations identically — instantly records a split decision — even for the `repairable: true` case where a single delta round might close all blocking findings without splitting.

## 3. The Four Problems

### Problem 1: Auto-Approve Skips the Repairable Bypass (High Impact)

**Affected:** DIR-124-A4 (16 findings, one subsystem, repairable=true)

**What should have happened:**
1. ProposalReview returns `split-subsystem-blocking-cluster` with `repairable: true`
2. `nextAction` returns `consume-split-bypass` — one focused delta revision
3. Repairing agent makes a targeted fix addressing the root cause cluster
4. Delta review checks if fix closed the cluster
5. If yes → no split needed. If no → terminal split.

**What actually happened:**
1. Auto-approve policy records split decision immediately
2. Split decision filed at `milestones/prepare-decisions/DIR-124-A4.json`
3. But children were never created — task left in `status: todo, children: []`
4. Task is now in **split limbo**: decision says split, but no children exist

The repairable bypass isn't just a performance optimization — it's the mechanism's **last chance to avoid unnecessary split**. For `split-multi-mechanism` (repairable=false), auto-approval is correct because the task's scope is genuinely too broad and no delta round can fix that. But for `split-subsystem-blocking-cluster`, the findings might ALL close with one edit — the auto-approve policy throws away that information.

### Problem 2: Incomplete Splits Create Limbo State (High Impact)

**Affected:** DIR-124-A4, DIR-124-A1b, gap-build-evidence-manifest-missing, gap-prepare-milestone-epoch-scope-change-grants-full-review

4 out of 9 split decisions (44%) are incomplete:

| Task | Decision Filed | Children in Frontmatter | Child Files on Disk |
|---|---|---|---|
| DIR-124-A4 | ✅ | `[]` | N/A |
| DIR-124-A1b | ✅ | `[]` | N/A |
| gap-build-evidence-manifest-missing | ✅ | 3 declared | 0 exist |
| gap-prepare-milestone-epoch-scope-change | ✅ | 1 declared | 0 exist |

Two distinct failure modes:

**Mode A: Decision filed, no children declared (A4, A1b).** The auto-approve recorded the decision at `milestones/prepare-decisions/` but the split action — decomposing the proposal into child tasks, assigning M-numbers, creating task files — was never performed. The task remains in its original form with `children: []`.

**Mode B: Children declared, files missing (gap-build-evidence, gap-epoch-scope-change).** The split reasoning was done — the parent task body contains a table with child titles, M-numbers, and mechanism descriptions. But the actual `tasks/<child-id>.md` files were never created. The children exist in prose but not in the task store.

Both modes leave the task in an **un-actionable state**: `status: todo`, no way to execute it (can't prepare-milestone a split-recommended task, can't execute children that don't exist).

### Problem 3: DIR-124-A1b Re-Split at Level 3 is a Granularity Warning (Medium Impact)

**Event chain:**
```
DIR-124 → A → A1 (16 AC, 704 lines)
           → split recommended: mechanism count > 2
           → A1a (9 AC, 317 lines) ✅ done
           → A1b (0 AC, 323 lines) ← ALREADY a level-3 leaf
             → split recommended AGAIN: "14 wiring claims vs 6 AC items"
             → children: [] — limbo
```

A1b was already a level-3 leaf. It had 0 AC items because the parent DIR-124-A1's ACs weren't decomposed to this granularity level. The ProposalReview then found "14 wiring claims vs 6 AC items" — the mechanism extraction counted 14 claims (from the proposal's prose) against 6 AC items (from the parent's charter).

**This is a split at the wrong level.** The decomposition A→A1→A1b was too shallow — A1b inherited a proposal that still spanned 8 cross-workflow boundaries. The 1st split should have produced more children (A1b through A1e) rather than two children where one inevitably triggers a 3rd-level split.

**The auto-approve policy compounds this:** instead of diagnosing "why is a level-3 leaf still multi-mechanism?", it blindly records another split decision, leaving A1b in limbo.

### Problem 4: mechanismCount Threshold (> 2) is Correct but Mechanism Extraction May Overcount (Low Impact)

The threshold is reasonable: a task with 3+ independently landable mechanisms IS too broad for a single milestone. But DIR-124-A1b's "14 wiring claims vs 6 AC" suggests the mechanism extraction (`extractMechanismClaims` from `wiring-coverage-check.ts`) is counting **proposal claims** rather than **independently shippable mechanisms**.

A proposal claim like "the instrumentation MUST cover 8 phase boundaries" gets counted as one mechanism. But each boundary's instrumentation is a distinct implementation unit. The extraction should distinguish:
- **Architectural mechanisms** (independently designable, landable, reversible) → count toward the >2 threshold
- **Implementation coverage items** (must cover N of the same mechanism type) → count as 1 mechanism, not N

This is a calibration issue, not a logic defect. The `> 2` threshold is correct for genuine architectural mechanisms but too aggressive when coverage items are being counted as mechanisms.

## 4. Recommendations

### 4.1 Fix the Auto-Approve Policy (Immediate)

**Current policy:** "auto-approve all split-recommended" → records split decision for every `stop-split` without discrimination.

**Recommended policy:** Differentiate by split code:

| Code | Policy | Rationale |
|---|---|---|
| `split-multi-mechanism` | **Auto-approve** | Not repairable — scope requires charter edit. Correct to split immediately. |
| `split-touch-set-too-large` | **Auto-approve** | Not repairable — surface too broad. Correct to split immediately. |
| `split-subsystem-blocking-cluster` | **Consume bypass first** | Repairable — one focused delta revision may close all findings. Only split if bypass fails. |

This means the orchestrator should:
1. Check `splitCheck.code`
2. If `split-multi-mechanism` or `split-touch-set-too-large`: auto-record-split (current behavior)
3. If `split-subsystem-blocking-cluster`: let the prepare-milestone loop consume the repairable bypass → run one delta round → if findings persist, THEN record split

### 4.2 Require Split Completion Before Decision is "Done" (Immediate)

A split decision is NOT complete when `milestones/prepare-decisions/<taskId>.json` is written. It is complete when:
1. Child task `.md` files exist in `tasks/`
2. Each child has a valid `id`, `status: todo`, and `parent` backlink
3. M-numbers are assigned (if development-class)
4. The parent's `children:` frontmatter array is populated

The `--record-split-decision` path should validate these postconditions or flag the task as `needs-human: split-recorded-but-not-enacted`.

### 4.3 Add a Recursive-Split Guard (Immediate)

A task at WBS level ≥ 2 that triggers `split-multi-mechanism` is a **structural anomaly** — the decomposition was too shallow at a higher level. Instead of blindly splitting deeper, the mechanism should:

```
if (wbsLevel >= 2 && code === "split-multi-mechanism") {
  return { action: "stop-needs-human", 
           reason: "level-2+ leaf still multi-mechanism — decomposition too shallow upstream" };
}
```

This would have caught DIR-124-A1b before it reached limbo.

### 4.4 Calibrate Mechanism Extraction for Implementation-Coverage vs Architectural-Mechanism (Short-Term)

The `extractMechanismClaims` function in `wiring-coverage-check.ts` should distinguish:

| Claim Type | Example | Counts As |
|---|---|---|
| Architectural | "RunIdentity mint + stage journal" | 1 mechanism |
| Architectural | "Verify cache lookup + persist" | 1 mechanism |
| Coverage | "instrument all 8 phase boundaries" | 1 mechanism (NOT 8) |
| Coverage | "cover all 6 AC items" | Not a mechanism (AC count, not mechanism count) |

DIR-124-A1b's "14 claims vs 6 AC" → the real mechanism count is probably 2-3 (schema module integration, phase boundary instrumentation, cross-workflow event emission), not 14.

### 4.5 Add a Split-Completion Audit Gate (Short-Term)

A periodic check (or post-compact recovery step) should scan for tasks in split limbo:

```bash
for each task with decision="split" in milestones/prepare-decisions/:
  if task.children is empty OR any child .md file is missing:
    flag as "split-incomplete"
```

This turns the invisible limbo into a visible queue state that the orchestrator can act on.

### 4.6 The `> 2` Mechanism Threshold is Correct — Don't Change It (No Action)

Despite the overcounting concern in Problem 4, the threshold of `> 2` is well-calibrated. The data confirms:

- DIR-126 children had 1 mechanism each (= 1 for each of A/B/C/D/E) and all 5 completed
- DIR-124-B (4 mechanisms) was correctly split into 4 children
- DIR-124-F (6 mechanisms) was correctly split into 6 children
- Tasks with 1-2 mechanisms (DIR-099-A/B/C, DIR-100-A/B/C, DIR-103-A/B/C) complete in single prepare-milestone cycles

Changing the threshold would cause more false negatives (tasks that SHOULD split but don't) without significantly reducing false positives. The fix is better mechanism extraction (4.4), not a different threshold.

## 5. Summary

| Problem | Severity | Fix | Effort |
|---|---|---|---|
| Auto-approve skips repairable bypass for subsystem clusters | High | Route by split code (4.1) | Small |
| 44% incomplete splits (limbo state) | High | Postcondition validation (4.2) + audit gate (4.5) | Medium |
| Level-3 re-split (A1b) | Medium | Recursive-split guard (4.3) | Small |
| Mechanism overcounting | Low | Calibrate extraction (4.4) | Medium |
| Threshold > 2 | — | No change needed (4.6) | — |

**The auto-approve policy is correct for 2 of 3 split codes.** It should be narrowed, not abandoned. The split-decision logic itself is sound — the three triggers (subsystem cluster, multi-mechanism, oversized touch set) capture the right conditions. The issues are in the **orchestrator's consumption** of the signal (skipping the bypass, not completing the split action) and the **mechanism extraction** sensitivity (overcounting coverage items as mechanisms).
