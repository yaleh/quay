# Quay Continuous Bootstrap — BAIME Experiment (Experiment 4)

- **Status**: HALT (stopped; ran to iteration 19). **SUPERSEDED by Experiment 5 `quay-perpetual-stream`** (2026-07-18) — its open DIRs/gaps carried to `../quay-perpetual-stream/backlog.md`, methodology to `../quay-perpetual-stream/inherited-core.md`. See `../quay-perpetual-stream/README.md`.
- **Date**: 2026-07-17
- **Owner**: Yale Huang
- **Protocol**: [`docs/proposals/quay-continuous-bootstrap-experiment-v4.md`](../../docs/proposals/quay-continuous-bootstrap-experiment-v4.md) (authoritative — this file operationalizes it, does not redefine it)
- **Iteration prompts**: [`ITERATION-PROMPTS.md`](./ITERATION-PROMPTS.md)
- **Origin**: an explicit strategic redirection asserted directly by the human in a live conversation (2026-07-17) — see `experiments/quay-webui-bootstrap/directives/pending/DIR-007-close-experiment-3-hand-off-to-experiment-4-continuous-improvement.md` for the triggering directive and its Finding section.
- **Inheritance from experiment 1**: [`../quay-native-bootstrap/CLOSING-REPORT.md`](../quay-native-bootstrap/CLOSING-REPORT.md) · [`../../.claude/skills/quay-native-methodology/`](../../.claude/skills/quay-native-methodology/)
- **Inheritance from experiment 2**: [`../quay-core-bootstrap/iterations/iteration-10.md`](../quay-core-bootstrap/iterations/iteration-10.md) (closing report) · [`../../.claude/skills/quay-core-bootstrap-methodology/`](../../.claude/skills/quay-core-bootstrap-methodology/)
- **Inheritance from experiment 3**: [`../quay-webui-bootstrap/HALT-RECOMMENDATION.md`](../quay-webui-bootstrap/HALT-RECOMMENDATION.md) · [`../quay-webui-bootstrap/iterations/iteration-5.md`](../quay-webui-bootstrap/iterations/iteration-5.md) · [`../../.claude/skills/quay-webui-bootstrap-methodology/`](../../.claude/skills/quay-webui-bootstrap-methodology/)

> Frozen vocabulary applies (`glossary.md`). Do not rename Provider, Skill, status, lane, action button, capability, run, task. BAIME terms used verbatim per `methodology-bootstrapping` skill.

---

## 1. Domain

This is the **fourth** BAIME experiment for the quay project, and the first that is **open-ended by design** rather than pursuing a fixed, bounded objective. It inherits methodology from all three prior experiments — experiment 1's Layer-1/Layer-2 Skill structure and gate/directive/G3 mechanics, experiment 2's manda-reliability, G3-dispatch, and V_meta-ceiling findings, and experiment 3's independent holistic visual-review mechanism, dual-viewport (desktop+mobile) requirement, and the confirmed two-experiment `effectiveness = 0.26` ceiling — rather than bootstrapping from σ=0 or V_meta=0. V_meta continues, unchanged in value, from experiment 3's stopping point.

Full rationale for why experiments 1–3's fixed-checklist `V_instance` shape does not fit this experiment, and the open-ended shape chosen instead, is in the protocol document (`docs/proposals/quay-continuous-bootstrap-experiment-v4.md` §1–§4) — this README only summarizes.

### Instance objective (four durable, rescored dimensions — protocol §4)

```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
```

Unlike experiments 1–3, these are **not** fixed checklists frozen at design time — each is rescored every iteration against the *current* best-known gap list (protocol §4.4), which itself grows (new gaps found via the standing simulated-user mechanism or direct human observation) and shrinks (gaps closed and verified) over time. `ΔV_instance` — not the raw level — is the primary cross-iteration-comparable trend signal; a separate, strictly monotonic "cumulative gaps closed" counter is the secondary signal. See protocol §4.3 for the full reasoning and the explicit tradeoff accepted.

1. **`capability_breadth`**: how much of the surface a reasonable user of quay (CLI, Web UI, MCP client) would expect to find functional is actually present — generalizes experiment 3's `ui_read_capability` to the whole project.
2. **`usability_quality`**: how good the experience actually is — visual/design quality, CLI ergonomics, error-message clarity, MCP tool-description quality, documentation findability — generalizes experiment 3's `visual_design_quality`.
3. **`verification_coverage`**: fraction of currently-claimed-working capability with a committed automated test, across CLI/Web UI/MCP — generalizes experiment 3's `verified_by_construction`.
4. **`system_health`**: no regression against any inherited V-factor snapshot (experiments 1, 2, or 3), and no open significant/blocking-severity gap past the iteration it was found without an explicit triage decision — generalizes experiment 3's `backlog_health`.

### Two standing continuous mechanisms (protocol §5 — new to this experiment)

1. **Self-hosted task tracking** (§5.1): this experiment's own backlog of development tasks is tracked via quay's own `mcp__quay__task_write` / `task_list` / `task_get` / `task_check` MCP tools (the native Provider, backed by `tasks/*.md`), not ad hoc markdown TODOs — literal dogfooding, mandatory from iteration 0.
2. **Continuous simulated-user usage** (§5.2): every iteration, an independent subagent (dispatched by the orchestrator via the native Agent/Task tool, never manda, never inline — same discipline as G3) uses quay's interfaces (CLI, Web UI desktop+mobile, MCP) the way a real user pursuing a concrete goal would, renders PASS/CONCERNS/FAIL per surface, and feeds findings directly into the gap list. Generalizes and strengthens experiment 3's §0c independent holistic visual review (which only ran when a visual change was claimed) into a standing, every-iteration practice across all of quay's surfaces, not just the Web UI.

### Halt/pause philosophy (protocol §4.5 — new vocabulary)

Because there is no fixed finish line, "CONVERGED"/"HALT" as experiments 1–3 used them don't directly apply to the instance layer. This experiment introduces **PAUSE**: a resumable, self-assessed state (ΔV_instance flat for 2+ consecutive iterations AND no new blocking/significant-severity gap found by that window's simulated-user passes) — not a terminal finish line. `V_meta ≥ 0.80` remains a genuinely bounded question and retains the CONVERGED vocabulary at the meta layer only. HALT remains available as an externally-imposed stop (human decision) at any time, distinct from a self-assessed PAUSE. See protocol §4.5 for full detail.

### Task IDs

All new tasks in this experiment use the `QX-*` prefix (quay-eXpanded-scope / eXperiment 4), distinct from experiment 1's `QN-*`, experiment 2's `QC-*`, and experiment 3's `QW-*`.

---

## 2. Inheritance baseline

Experiment 3 was HALTed (practical convergence accepted, not formally CONVERGED) at iteration 5. The extraction artifact is at `.claude/skills/quay-webui-bootstrap-methodology/`. Experiments 1 and 2's extraction artifacts remain in force unchanged. Starting scores for experiment 4 (iteration 0, not yet run):

```
V_instance (experiment 4's own dimensions — NOT yet measured; baseline is iteration 0's job,
             including seeding the initial gap list via the first simulated-user pass across
             all surfaces, per protocol §5.2 and ITERATION-PROMPTS.md's iteration-0 template)
             = capability_breadth × usability_quality × verification_coverage × system_health

V_meta (inherited from experiment 3's final values — NOT reset to zero, NOT re-derived)
             = 0.77 × 0.26 × 0.79 × 0.778 = 0.123
             (completeness × effectiveness × reusability × validation)
             V_meta_ceiling = 0.26 (effectiveness frozen since experiment 1 iteration 23;
             now confirmed by positive measurement across experiments 2 AND 3 — see
             `.claude/skills/quay-webui-bootstrap-methodology/reference/v-meta-ceiling-two-experiment.md`)

σ_QX (experiment 4's own tasks, QX-* only) = 0/0 (no tasks yet — iteration 0 has not run)
Experiment 3's final σ_QW = 7/9 = 0.778 (context only — experiment 4 must state explicitly
             whether/how it tracks this as an inherited floor, or resets to 0, per the same
             discipline experiment 3 applied at its own iteration 0 — see
             ITERATION-PROMPTS.md).

backlog_health / system_health baseline: no regression against experiment 1's final snapshot
             (`experiments/quay-native-bootstrap/CLOSING-REPORT.md`), experiment 2's iteration-10
             stopping values (core_abi_symmetry=1.0, web_ui_verification=1.0,
             action_delivery_mode=1.0, native_backlog_health=1.0), OR experiment 3's final
             snapshot (V_instance=1.0: ui_read_capability=1.0, visual_design_quality=1.0,
             verified_by_construction=1.0, backlog_health=1.0).
```

**Directives carried forward from experiment 3** (per DIR-007 requested action #4 — neither was applied before experiment 3's stop):
- `DIR-004` (Node SEA / Bun compile release artifacts, GitHub Actions build+publish) — was deferred as out-of-scope under experiment 3's Web-UI-only objective; now legitimately **in scope** under experiment 4's whole-project objective.
- `DIR-006` (git worktree isolation for iteration execution) — was filed but not yet applied; experiment 4's protocol adopts it directly as a **standing guardrail from iteration 0** (protocol §8) rather than re-filing it as a pending directive.

Iteration 0 must re-file or explicitly re-confirm both in `experiments/quay-continuous-bootstrap/directives/` per the standard directive-lifecycle mechanism (`experiments/quay-native-bootstrap/directives/README.md`), not silently drop them.

A first iteration that re-derives V_meta from zero, or from an experiment other than 3's final values, is a scoring error — see protocol §6.

---

## 3. Convergence / pause target

This experiment does not have a single "converged" finish line the way experiments 1–3 did. See protocol §4.5 for the full PAUSE/CONVERGED/HALT vocabulary. Summary:

- **PAUSE** (instance layer, resumable): ΔV_instance < 0.02 for 2+ consecutive iterations AND no new blocking/significant-severity gap found by the standing simulated-user mechanism in that window.
- **CONVERGED** (meta layer only): V_meta ≥ 0.80 — remains a genuinely bounded question; currently capped at a ceiling of 0.26 by the same `effectiveness` factor experiments 1–3 all hit, so not expected to be reachable without a genuine, non-manufactured re-trigger (protocol §6, G2).
- **HALT**: an externally-imposed stop (human decision) at any time, distinct from a self-assessed PAUSE — same meaning as experiments 1–3 used it.

---

## 4. Directory layout

```
experiments/quay-continuous-bootstrap/
  README.md                  ← this file
  ITERATION-PROMPTS.md       ← operational iteration prompts (open-ended V_instance, §0c continuous
                                simulated-user mechanism, self-hosted task-tracking mechanism)
  provenance.md               ← QX-* task provenance ledger (inheritance record already written)
  gap-list.md OR QX-* `gap`-labeled tasks  ← iteration 0 must choose and record which (protocol §9 item 1)
  iterations/                ← iteration-N.md reports (iteration-0.md is the next action)
  audits/                    ← G3 out-of-band adjudicate verdicts AND simulated-user pass verdicts
  directives/
    pending/                 ← active steering directives (DIR-004, DIR-006 to be re-filed here at iteration 0)
    archive/                 ← consumed/resolved directives (none yet)
```

---

## 5. Guardrails (inherited from experiments 1–3, plus new standing ones)

G1–G6 carry over unchanged (see `experiments/quay-webui-bootstrap/README.md` §5 for the current text, restated in full in the protocol document §8). Plus, standing from iteration 0 (not deferred):

- **Git worktree isolation**: each iteration's development/testing executes in a dedicated git worktree, merged to `master` only after that iteration's success criteria are confirmed, removed after merge (adopted directly from DIR-006, not re-filed as pending).
- **Desktop + mobile dual-viewport**: any browser-based test/visual/usability check covers both viewports, not desktop-only (adopted from DIR-003).
- **Standing web-service reachability** (new G7): quay's own web UI is kept running and reachable on `0.0.0.0` (not localhost-only) continuously, so the standing simulated-user mechanism always has a live target (adopted from DIR-001's precedent).
- **Write-surface boundary**: carried forward from experiment 3 — no new write path beyond the existing action-button trigger without an explicit, separately-filed task/directive.

See protocol document §8 for full text and rationale of each.

---

## 10. Iteration history

| Iteration | Date | Primary work | V_instance | V_meta | σ_QX | Status |
|-----------|------|-------------|------------|--------|------|--------|
| 0 | 2026-07-17 | Baseline measurement, gap seeding (19 gaps), self-hosted task tracking test | 0.236 | 0.123 (inherited) | 0/1 (floor: 0.778 inherited) | Complete |
| 1 | 2026-07-17 | CLI/Web UI/MCP prefix filter, --help, --prefix crash fix (9 gaps closed) | 0.388 | 0.136 | 6/7 = 0.857 | Complete |
| 2 | 2026-07-17 | Sort by updated (CLI+Web UI), list-page action buttons, MCP schema test (5 gaps closed) | 0.443 | 0.142 | 9/10 = 0.900 | Complete |
| 3 | 2026-07-17 | Back link context, mobile table, gate-fail feedback, orientation banner, open-redirect fix (8 gaps closed) | 0.491 | 0.148 | 14/15 = 0.933 | Complete |
| 4 | 2026-07-17 | Multi-label AND-filter, sticky actions column, updatedAt display, list-page target tooltip (6 gaps closed) | 0.561 | 0.150 | 18/19 = 0.947 | Complete |
| 5 | 2026-07-17 | Label nav toggle semantics, full-text title search, CLI timestamp column (3 gaps closed) | 0.576 | 0.151 | 21/22 = 0.955 | Complete |
| 6 | 2026-07-17 | Body search, label nav truncation, minor polish bundle (5 gaps closed; 4 new significant from audit) | 0.564 | 0.152 | 24/25 = 0.960 | Complete |
| 7 | 2026-07-17 | Freq label sort + active pinning, doc staleness fix, body search heading exclusion (4 gaps closed) | 0.601 | 0.152 | 27/28 = 0.964 | HALT |

**ΔV trajectory**: +0.152 → +0.055 → +0.048 → +0.070 → +0.015 → −0.012 → +0.037

**Final state at HALT**: V_instance=0.601, V_meta=0.152, σ_QX=27/28=0.964, cumulative gaps closed=40, open significant gaps: CB-008/CB-010/CB-014/UQ-008.
