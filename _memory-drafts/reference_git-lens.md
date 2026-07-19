---
name: reference-git-lens
description: The GIT (geometric-information-theory) lens — use ONLY the validated layers (goal-closure L_T..L_S + hard-over-soft + Π_{S→E}); the continuous math is NOT rigor (ADR-006)
metadata:
  node_type: memory
  type: reference
---

Two reference docs frame quay's crystallization program (in-repo at `docs/references/`):
- `geometry-as-llm-architecture-interface.md` — the KEY doc, a self-audit that grades the geometry framework into 证据充分 / 机制成立待验 / 假统一.
- `基于几何信息论的未来软件开发与信息系统建设(两阶段周期版).md` — the two-phase-cycle version.

**Use these VALIDATED layers:**
- **Goal-closure checklist** — the five loss axes: `L_T` feasibility/tests, `L_C` constraints/types, `L_D` description length, `L_G` generative-alignment (reinvented/duplicated abstractions), `L_S` stability/behavior-variance. Value: tells you which axis is still DARK. Today quay instruments `L_T` + half of `L_C`; `L_G`/`L_D`/`L_S` are dark.
- **Hard over soft (硬形变 / Π_{S→E})** — turn a region of intent into an executable check that fails on drift (state-space truncation; the density-prior can't erode it). 软形变 (prose/prompt) only bends the model's conditional distribution and gets re-eroded each cycle because the LLM mode-seeks back to training-typical attractors.
- **Verification asymmetry** — LLMs generate faster than reviewers verify; the binding constraint is cheap executable verification, not more generation.
- **Two-phase breathing** — expansion (entropy↑, absorb) ⇄ convergence (entropy↓, crystallize); switch to expansion when ∂L_D/∂t→0 and the demand queue is non-empty; force convergence when L_S or L_D exceed threshold.

**Do NOT cite as rigor:** the continuous math — Fisher metric, natural gradient, intrinsic dimension `d`, compression ratio `ρ`. The audit calls it abuse of notation / 假统一 (zero out-of-sample predictions). Fluency of a geometric argument is not evidence, especially from an LLM.

Codified as ADR-004 (hard-over-soft), ADR-005 (verification), ADR-006 (this stance), ADR-007 (instrument dark axes), ADR-008 (two-phase). See [[reference-archguard-metacc-tools]] for the L_D/L_G instrument and [[workflow-milestone-cadence]] for how the L_T-on-the-real-axis discipline lands.
