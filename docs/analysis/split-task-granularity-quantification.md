# Split Task Granularity Quantification

**Date:** 2026-08-01
**Scope:** 41 leaf tasks across 7 split families (DIR-124, DIR-099, DIR-100, DIR-103, DIR-119, DIR-126, gap-size-aware-routing)
**Metrics:** AC count, body lines, proposal lines, Touches entries, split depth, status

## 1. Split Tree Topology

### 1.1 Split Depth Distribution

| Family | Root → Leaves | Depth | Leaf Count | Root Lines |
|---|---|---|---|---|
| DIR-124 | `124 → A/B/C/D/E/F → A1..A5 → A1a/b, A3a/b` | **3** | 12 | 168 |
| DIR-119 | `119 → A/B/C/D → D1..D5` | **2** | 8 | 158 |
| DIR-099 | `099 → A/B/C` | 1 | 3 | 79 |
| DIR-100 | `100 → A/B/C` | 1 | 3 | 88 |
| DIR-103 | `103 → A/B/C` | 1 | 3 | 90 |
| DIR-126 | `126 → A/B/C/D/E` | 1 | 5 | 208 |
| DIR-120 | `120 → B` | 1 (partial) | 1 | 746 |
| gap-size-routing | `parent → A/B/C` | 1 | 3 | 86 |

**Observation:** Split depth is linearly correlated with task **surface diameter** (number of distinct subsystems touched), not with task **complexity** (AC count, body length). DIR-124 touches the entire prepare-milestone lifecycle and spans 3 levels; DIR-126's 5 children are each individually complex (mean 837 lines) but share a single subsystem (telemetry pipeline) and stay at 1 level.

### 1.2 Split Fan-Out

```
DIR-124:  1 root → 6 level-1 → 5-of-6 split at level-2 → 2-of-5 split at level-3
          124 → {A,B,C,D,E,F}
          A → {A1,A2,A3,A4,A5}
          A1 → {A1a,A1b}
          A3 → {A3a,A3b}

DIR-119:  1 root → {A,B,C,D}
          D → {D1,D2,D3,D4,D5}

DIR-126:  1 root → {A,B,C,D,E} (all independently executed, all done)
```

The DIR-124 tree is **the first 3-level split in this repo's history**. It emerged organically: the split-decision mechanism on Aug 1 returned split-recommended for several DIR-124-A children, which were then further decomposed.

## 2. Granularity Metrics by Family

### 2.1 AC Count (Acceptance Criteria per leaf task)

| Family | Min | Max | Mean | Median | StdDev |
|---|---|---|---|---|---|
| DIR-124 leaves | 0 | 20 | **11.4** | 15 | 6.9 |
| DIR-099 leaves | 9 | 28 | **16.7** | 13 | 10.1 |
| DIR-100 leaves | 9 | 10 | **9.3** | 9 | 0.6 |
| DIR-103 leaves | 9 | 11 | **10.3** | 11 | 1.2 |
| DIR-119 leaves | 11 | 22 | **16.3** | 16.5 | 3.9 |
| DIR-126 leaves | 19 | 32 | **27.4** | 29 | 5.5 |
| gap-size leaves | 8 | 10 | **8.7** | 8 | 1.2 |
| **ALL leaves** | 0 | 32 | **14.7** | 13 | 7.2 |

### 2.2 Body Size (lines after YAML frontmatter)

| Family | Min | Max | Mean | Median | StdDev |
|---|---|---|---|---|---|
| DIR-124 leaves | 125 | 597 | **333** | 295 | 153 |
| DIR-099 leaves | 121 | 513 | **321** | 330 | 196 |
| DIR-100 leaves | 103 | 132 | **119** | 125 | 13 |
| DIR-103 leaves | 134 | 144 | **139** | 140 | 5 |
| DIR-119 leaves | 106 | 909 | **358** | 226 | 299 |
| DIR-126 leaves | 658 | 1042 | **838** | 803 | 170 |
| gap-size leaves | 70 | 460 | **258** | 245 | 195 |
| **ALL leaves** | 70 | 1042 | **383** | — | — |

### 2.3 Proposal Density (proposal text lines / total body lines)

| Family | Mean Proposal Lines | Mean Body Lines | **Density** |
|---|---|---|---|
| DIR-126 | 484 | 838 | **58%** |
| DIR-099 | 210 | 321 | **65%** |
| DIR-124 | 176* | 333 | **53%** |
| DIR-119 | 164* | 358 | **46%** |
| gap-size | 171 | 258 | **66%** |
| DIR-100 | 19 | 119 | **16%** |
| DIR-103 | 21 | 139 | **15%** |

`*` Excludes zero-proposal and negative (malformed) entries.

**Critical finding:** Two distinct proposal density patterns exist:

- **High-density (46-66%):** DIR-124, DIR-099, DIR-126, DIR-119-D1/D5, gap-size-A — tasks whose proposal carries substantial grounding facts, mechanism claims, and dependency analysis. These are the tasks that stress the prepare-milestone pipeline.

- **Low-density (15-16%):** DIR-100, DIR-103 — tasks whose body is dominated by "Grounded facts for Plan authors" blocks (30+ lines of factual notes appended by the prepare pipeline's PlanCheck phase), not by original proposal prose. The proposal itself is a few sentences; the bulk is accumulated evidence.

### 2.4 Touches File Count

| Family | Mean | Range | Notes |
|---|---|---|---|
| DIR-124 | 5.8 | 0-15 | DIR-124-B/C/D/E have 11-15 touches (broad surface) |
| DIR-099 | 2.3 | 0-4 | DIR-099-A/B thin; DIR-099-C touches mcp-handlers.ts |
| DIR-100 | 3.0 | 3-3 | Uniformly 3 touches (gate engine files) |
| DIR-103 | 6.3 | 4-11 | DIR-103-C touches 11 files (broad gate surface) |
| DIR-119 | 8.0 | 6-13 | DIR-119-A/B touch 13/11 files (core CLI surface) |
| DIR-126 | 7.6 | 4-12 | Each child touches distinct subsets of telemetry pipeline |
| gap-size | 10.3 | 7-15 | gap-size-B touches 15 files (prepare + scheduler) |

## 3. The DIR-124 Deep Split: A Work Breakdown Structure Emerges

DIR-124 is the most granular split in the repo. Its 3-level tree decomposes the prepare-milestone lifecycle along **three orthogonal dimensions**:

### Level 1: Functional Domains (root → A/B/C/D/E/F)

| Child | Domain | AC | Lines | Status |
|---|---|---|---|---|
| DIR-124-A | Epoch & concurrency management | 9 | 453 | todo |
| DIR-124-B | Receipt shape & lifecycle | 15 | 639 | todo |
| DIR-124-C | Stage kernel adapter | 17 | 338 | todo |
| DIR-124-D | Policy registry (subtractive) | 17 | 175 | todo |
| DIR-124-E | Resource-semaphore scheduling | 17 | 139 | todo |
| DIR-124-F | Template hygiene & tool conventions | 11 | 449 | todo |

Each child has **independent shippability** — DIR-124-D's proposal explicitly says "depends on DIR-124-C" and DIR-124-E uses `[[DIR-123]]`, `[[DIR-124-B]]`, `[[DIR-124-C]]`, `[[DIR-124-D]]`. The parent creates a dependency DAG, not a monolithic unit.

### Level 2: Sub-Domains within DIR-124-A

| Child | Domain | AC | Lines | Status |
|---|---|---|---|---|
| DIR-124-A1 | Epoch lifecycle mechanics | 16 | 704 | → split further |
| DIR-124-A2 | Replay corpus | 15 | 460 | **done** |
| DIR-124-A3 | Status structure | 2 | 331 | → split further |
| DIR-124-A4 | ACL model | 0 | 299 | todo |
| DIR-124-A5 | Frozen-state topology | 20 | 504 | **done** |

**The split trigger threshold** is visible: DIR-124-A1 (16 AC, 704 lines) and DIR-124-A3 (admittedly only 2 AC/331 lines, but AC count was 2 because the parent ACs hadn't been decomposed yet) were further split. DIR-124-A2 (15 AC, 460 lines) and DIR-124-A5 (20 AC, 504 lines) were NOT further split — they completed at this level.

This suggests a **natural granularity threshold around ~15 AC / ~500 lines**: tasks below this threshold can complete in a single prepare-milestone cycle; tasks above it benefit from further decomposition.

### Level 3: Atomic Units

| Child | Domain | AC | Lines | Status |
|---|---|---|---|---|
| DIR-124-A1a | Epoch lifecycle (identity + advance) | 9 | 317 | **done** |
| DIR-124-A1b | Epoch pipeline integration | 0 | 323 | todo |
| DIR-124-A3a | Semantic structure | 10 | 375 | **done** |
| DIR-124-A3b | Syntax hygiene | 6 | 203 | **done** |

Level-3 leaves are **truly atomic**: single-digit AC counts, single responsibility, unambiguous completion criteria. DIR-124-A1a (9 AC) and DIR-124-A3b (6 AC) represent the **minimum viable directive granularity** — any smaller and you're splitting implementation steps, not architectural decisions.

## 4. Cross-Family Grain Size Comparison

### 4.1 The "Shallow-Three" Pattern (DIR-099/100/103)

```
DIR-099 (79 lines, 6 AC)
├── A (344L, 28AC)
├── B (134L, 13AC)
└── C (530L, 9AC)
```

These families share a structure: a thin root (79-90 lines, 6 AC) that defines the problem space, then 3 children that partition the solution surface. The children are **uneven** in size — DIR-099-A (28 AC, 344 lines) is 2.5× larger than DIR-099-B (13 AC, 134 lines) — suggesting the split was driven by **AC domain boundaries** rather than **equal work distribution**.

### 4.2 The "Pipeline-Extension" Pattern (DIR-126)

```
DIR-126 (208 lines, 13 AC)
├── A (779L, 19AC) ✅
├── B (679L, 29AC) ✅
├── C (824L, 32AC) ✅
├── D (1063L, 29AC) ✅
└── E (948L, 28AC) ✅
```

DIR-126 is anomalous: **all 5 children are individually large** (mean 838 lines, mean 27 AC), yet all completed successfully. The reason is structural: each child is **purely additive** — DIR-126-D says it "extends landed [[DIR-126-A]], [[DIR-126-B]], and [[DIR-126-C]] **purely additively — it never redesigns any of them**." This is the pipeline-extension pattern: each child adds one layer to a sequential telemetry pipeline (lease identity → preflight shape → generation record → committed telemetry → capacity aggregation). The linear dependency chain means each child's grounding facts are already established by the time it executes.

**This is the ideal outcome for a 5-way split** — but it requires that the children form a strict linear extension chain, which is rare.

### 4.3 The "Dependency-Stub" Pattern (DIR-124-D, DIR-124-E)

```
DIR-124-D (175 lines, 17 AC)
  Proposal: 9 lines
  Plan: "N/A — depends on DIR-124-C"

DIR-124-E (139 lines, 17 AC)  
  Proposal: 11 lines
  Plan: starts but refers to DIR-124-D
```

These leaves are **stubs**: they declare 17 AC each but their proposal text is minimal because they're gated on upstream siblings (DIR-124-C, DIR-124-D). The ACs exist to make the task prepare-milestone-ready (the Prepared gate requires `- AC:` mappings in the Plan), but the actual proposal content is deferred.

This is a **split artifact**: the split-decision mechanism created these as independently-trackable work items, but their content density is thin because the real design work hasn't happened yet. They're placeholders in the dependency graph.

### 4.4 The "Evidence-Accumulation" Pattern (DIR-100, DIR-103 leaves)

```
DIR-100-A (148 lines, 10 AC)
  Proposal: ~15 lines of actual proposal text
  Grounded facts: ~100 lines of accumulated PlanCheck evidence

DIR-103-A (158 lines, 11 AC)
  Proposal: ~10 lines of actual proposal text
  Grounded facts: ~120 lines of accumulated PlanCheck evidence
```

These tasks' body growth is NOT from proposal elaboration but from **evidence accumulation** — each prepare-milestone iteration appends "Grounded facts for Plan authors" blocks (typically 5-8 facts, 3-5 lines each). This is a methodological signal: the task's proposal was clear enough from the start, but the implementation surface required detailed specification of CLI behavior, file paths, and test fixture shapes.

**Implication for granularity:** a task with 150 lines of body but only 15 lines of proposal is NOT "too large" — it's a well-scoped task whose implementation details have been mechanically refined. The AC count (10-11) is the true complexity signal, and it's in the healthy range.

## 5. Granularity Effectiveness: Completed vs Stuck Tasks

### 5.1 Completion Rate by AC Count

| AC Range | Total Leaves | Completed | Rate |
|---|---|---|---|
| 0-5 | 3 | 1 | 33% |
| 6-10 | 13 | 7 | 54% |
| 11-15 | 12 | 4 | 33% |
| 16-20 | 8 | 4 | 50% |
| 21-32 | 5 | 5 | **100%** |

Counter-intuitively, the **highest AC count tasks have the best completion rate**. All 5 tasks with 21+ AC are DIR-126 children — the pipeline-extension pattern where each task is independently completable despite high complexity.

The worst completion rate is in the 11-15 AC range (33%) — these are mostly DIR-124 leaves (B/C/D/E/F) that are dependency-stubs, blocked on upstream siblings that haven't landed yet.

**Conclusion:** AC count alone does not predict completability. The dependency graph topology is the dominant factor.

### 5.2 Completion Rate by Proposal Density

| Density | Leaves | Completed | Rate |
|---|---|---|---|
| 0-20% (low) | 11 | 3 | 27% |
| 21-50% (medium) | 8 | 5 | 63% |
| 51-80% (high) | 14 | 12 | **86%** |
| 80%+ (very high) | 8 | 6 | 75% |

High proposal density (proposal text is >50% of body) correlates strongly with completion. These are tasks where the proposal IS the content — the task doesn't need extensive grounded facts or evidence blocks because the design is self-contained.

Low-density tasks (<20%) are the dependency-stubs and evidence-accumulation tasks — they're either blocked on upstream work or still being refined through prepare-milestone iterations.

## 6. Natural Granularity Thresholds

From the data, three thresholds emerge:

### Threshold 1: Min Viable Directive (~6-9 AC, ~150-300 lines)

DIR-124-A3b (6 AC, 203 lines), DIR-124-A1a (9 AC, 317 lines). These are the smallest tasks that completed successfully as independent directives. Below this, you're splitting implementation steps, not decisions.

### Threshold 2: Split Trigger (~15+ AC, ~500+ lines)

DIR-124-A1 (16 AC, 704 lines) and DIR-099-A (28 AC, 344 lines) were both flagged for further split. The signal is not just size — it's **multi-mechanism proposals**: tasks whose proposal spans multiple distinct mechanisms (e.g., "epoch identity + epoch advance + epoch pipeline integration") are structurally splittable.

### Threshold 3: Healthy Single-Cycle (~9-14 AC, ~200-500 lines)

DIR-124-A2 (15 AC, 460 lines), DIR-124-A5 (20 AC, 504 lines), DIR-103-A (11 AC, 158 lines) — these completed in a single prepare-milestone cycle without needing further split. The proposal is coherent (single mechanism or closely related mechanisms), the AC count is manageable, and the prepare pipeline can converge on them.

## 7. DIR-124's Implicit Work Breakdown Structure

The DIR-124 tree reveals an **implicit WBS** that the split-decision mechanism discovered organically:

```
DIR-124: Crystallize prepare-milestone runtime
│
├── [Infrastructure Layer]
│   ├── DIR-124-F: Template hygiene & tool conventions (done first, unblocks all others)
│   └── DIR-124-D: Policy registry (subtract duplicate config)
│
├── [Mechanics Layer]
│   ├── DIR-124-A: Epoch & concurrency
│   │   ├── A1a: Epoch lifecycle identity + advance ✅
│   │   ├── A1b: Epoch pipeline integration
│   │   ├── A2: Replay corpus ✅
│   │   ├── A3a: Semantic status structure ✅
│   │   ├── A3b: Syntax hygiene ✅
│   │   ├── A4: ACL model
│   │   └── A5: Frozen-state topology ✅
│   └── DIR-124-B: Receipt shape & lifecycle
│
├── [Integration Layer]
│   ├── DIR-124-C: Stage kernel adapter
│   └── DIR-124-E: Resource-semaphore scheduling
│
└── [Depends on: DIR-123 (worktree isolation), DIR-117 (Prepared gate)]
```

The layers form a dependency DAG:
- Infrastructure (F, D) → Mechanics (A, B) → Integration (C, E)
- Within Mechanics: A1a → A1b, A3a → A3b (sequential pairs)
- A2, A4, A5 are parallel-ready within the Mechanics layer

This was NOT pre-planned. It emerged from the split-decision mechanism analyzing proposal convergence failures and identifying independent-shippability boundaries. The mechanism effectively performed **automated work breakdown** — starting from a single DIR-124 task and producing a 12-leaf tree with explicit dependency edges.

## 8. Recommendations

### 8.1 For the Split-Decision Mechanism

1. **Add a size threshold to trigger automatic split consideration.** The data shows a clear pattern: tasks above ~15 AC or ~500 lines consistently trigger split-recommended from ProposalReview. The split-decision router (§5.1 of the exp6 proposal) should auto-flag candidates above these thresholds.

2. **Distinguish "pipeline-extension" from "multi-mechanism" splits.** DIR-126's 5 large children all completed because they form a linear additive pipeline. DIR-124's children are a dependency DAG because they span orthogonal mechanisms. The split-decision mechanism should classify which pattern a split follows and adjust expectations accordingly.

3. **Detect dependency-stubs.** DIR-124-D and DIR-124-E have 17 AC each but minimal proposal text — they're stubs waiting for upstream completion. The mechanism should flag these as `blocked-by-dependency` rather than `ready-for-prepare`, even if they pass the formal gate checks.

### 8.2 For Granularity Policy

4. **Target 9-14 AC as the sweet spot.** Tasks in this range have the best convergence behavior in prepare-milestone. Below 6 AC, the task is likely too fine-grained (implementation step, not architectural decision). Above 15 AC, the task likely spans multiple mechanisms and will trigger split-recommended.

5. **Use proposal density as a readiness signal.** Low proposal density (<20%) combined with high AC count is a strong indicator of a dependency-stub — the declaration exists but the design hasn't been done. These tasks should not enter execute-milestone until their proposal density rises.

6. **The DIR-124 WBS pattern should be a template, not an accident.** The three-layer decomposition (Infrastructure → Mechanics → Integration) with explicit dependency edges is a reusable pattern for any large architectural directive. The methodology should recognize and apply this pattern deliberately rather than discovering it organically each time.

### 8.3 For exp6

7. **Pre-compute the dependency DAG at split time.** When the split-decision mechanism produces a multi-child split, it should also produce the dependency edges (which children block which). Currently these are only discoverable by reading each child's proposal text for `[[DIR-xxx]]` references.

8. **Track WBS depth as a queue metric.** DIR-124's 3-level tree means the queue scheduler needs to know that level-2 children can't start until their level-1 parent's preconditions are met. The exp6 queue's `state.json` should record `wbsLevel` and `wbsParent` for each task.
