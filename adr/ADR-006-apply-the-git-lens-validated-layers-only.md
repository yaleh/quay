---
id: ADR-006
title: Apply the GIT lens — validated layers only (goal-closure L_T..L_S +
  hard-over-soft + Π_{S→E}); reject the continuous math
status: accepted
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - git-lens
  - crystallization
accepted-date: 2026-07-20
---
## Context
Two reference docs frame this program: `docs/references/geometry-as-llm-architecture-interface.md` (a self-audit that grades the geometry framework into 证据充分 / 机制成立待验 / 假统一) and `docs/references/基于几何信息论的未来软件开发与信息系统建设(两阶段周期版).md`. The audit is explicit: the continuous math (Fisher metric, natural gradient, intrinsic dimension `d`, compression ratio `ρ`) is **abuse of notation / 假统一** — it makes "the shape of rigor" without doing the arithmetic; it made zero out-of-sample predictions. Only specific layers survive.

## Decision
Adopt, as analytical tools, the **validated layers only**:
1. the **goal-closure checklist** `L_T` (feasibility/tests) / `L_C` (constraints/types) / `L_D` (description length) / `L_G` (generative-alignment: reinvented/duplicated abstractions) / `L_S` (stability/behavior-variance) — its value is telling you which axis is still DARK;
2. **hard-over-soft** (ADR-004);
3. **Π_{S→E}** (region → executable check).

EXPLICITLY REJECT citing the continuous math (Fisher / natural gradient / intrinsic dimension / `ρ`) as rigor or as justification for any decision. Fluency of a geometric argument is not evidence — especially from an LLM.

<!-- enforcement: N/A — a stance on analytical honesty (which tools to trust), irreducibly judgment. A naive grep guard would false-positive on the reference docs and on ADRs that NAME these terms in order to reject them (the "cited as justification" vs "named to reject" distinction is semantic, not grep-able). Honored by discipline, not a gate. (OQ2, human-confirmed 2026-07-19.) Promoted proposed→accepted 2026-07-20: enforcement question resolved N/A, nothing left to land per ADR-011. -->

## Consequences
- **Forbids:** grounding a decision in the continuous-dynamics layer; presenting a geometric metaphor as proof without an out-of-sample check.
- **Enables:** ADR-007 (instrument dark axes) and ADR-008 (two-phase breathing) are instances of this lens applied; the L_T..L_S checklist becomes the milestone review question (see CLAUDE.md pointer).
- **Scope / relations:** parent of ADR-007 and ADR-008; consistent with ADR-004/005 (which are the two validated levers this lens keeps). Reference both `docs/references/` files for the framework AND its limits.

**Amended 2026-10-22 (re-evaluation against 3 months of production data)** — human-approved 2026-10-22.

- **Continuous-math stance: the rejection stands, but its reason changes from "uncomputable" to
  "computable, uncalibrated".** The premise that these quantities are "not computed / basically
  cannot be computed" is outdated: archguard now computes the architecture intrinsic dimension
  (`archguard_get_intrinsic_dimension`, history in `.archguard/arch-health-history.json`). The
  carrier holds exactly 2 snapshots:

  | timestamp | mode | entityCount | dInt | dIntNormalized |
  |---|---|---|---|---|
  | 2026-10-01T08:30Z | `direct` | 860 | 126 | 0.1465 |
  | 2026-10-08T07:29Z | `jl` (k=308, ε=0.3) | 1018 | 99 | 0.0972 |

  The tool reports `trend: "decreasing"`. That trend is **not a reading**: the two points differ in
  computation mode AND in entity count, so the delta mixes the system's change with the
  instrument's change (硬规则 4b — a derived quantity with an untested layer in between). So
  `d_int` is still not admissible as rigor or as justification. What changed is the reason: the
  quantity exists and is computed; it has not been calibrated against anything.
- **Promotion path (so that the rejection is itself falsifiable).** `d_int` may be cited as
  evidence for a decision only after ALL of:
  1. a **fixed computation mode** (one of `direct` / `jl`, with fixed parameters) for every
     snapshot used;
  2. **≥ N same-mode snapshots**, with N fixed in the pre-registration below, not chosen afterwards
     (硬规则 4 推论: no threshold before the cost structure is known; N is part of the registration,
     not of this ADR);
  3. **one pre-registered out-of-sample prediction that hits.** Example: a predicted `d_int` change
     over a window, registered before the window closes, that predicts the central-growth-share
     reading of the `design-evolution-readings` routine (`.quay/design-evolution-history.jsonl`) for
     that window. A miss is recorded as a miss and resets the path.
  Until then the rejection is in force. If the path is met, this rejection is narrowed, not
  silently ignored.
- **Goal-closure layer reinforced.** Asking "which axis is dark" (Decision item 1) found two dark
  axes that no existing instrument named:
  - **growth-direction axis**: where growth lands relative to a subsystem's declared center. The
    `design-evolution-readings` round of 2026-10-22T00:40Z reads the `serve` central share at **1%**
    (153 of 11,687 changed lines in the central file `serve-handlers.ts`) vs **82%** for
    `worker-history` (baseline `2440b52d0` → `ff32d031d`). Note the same round as a whole is
    `evaluated:false` (its `worker-post-909` subsystem has a zero denominator), so these two are
    per-subsystem readings, not an aggregate.
  - **instrument-liveness axis**: whether a declared check actually runs on real input (see
    ADR-004's 2026-10-22 amendment and ADR-007's 2026-10-22 status note).
- **The discrete layer's one registered numeric prediction missed, and the miss was recorded.**
  GOAL-033 predicted the package SCC would go 6→5; the measured outcome was 6→4 (`fan-in/` left the
  SCC together with `cli/`, because `cli/driver.ts` was its only in-cycle importer). The goal's
  frontmatter records it rather than rewriting it: "2026-10-09 goal 作者更正 SCC 期望 6→5 为 6→4"
  (see AC-351). One prediction, one miss: the discrete layer also has no hit record yet, so it gets
  no extra trust beyond "it told us which axis to look at".
