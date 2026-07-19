# Proposal — Crystallizing exp5: from molten prose to executable single-source invariants

**Status:** proposal (2026-07-19). **Source:** geometric-information-theory diagnosis of exp5
(`docs/references/基于几何信息论的未来软件开发与信息系统建设研究报告.pdf`) + the live findings
of the 2026-07-19 human-steered session (DIR-014 closure, DIR-025/026/027, the "two DIR files"
single-source diagnosis).

This document is deliberately **lean and action-oriented**. A crystallization strategy written as
a large prose ruleset would itself be molten expansion (the additive-prose paradox, §3). Its output
is a list of **subtractive moves and executable assertions**, not new descriptive rules.

## 1. Measurement — exp5 is still molten, and the molt is self-generated

Geometric information theory frames a system's evolution between **Expansion** (description length
`L(G)` grows — molten) and **Convergence** (crystallization into executable pillars/invariants —
solid). exp5 is stuck in Expansion.

- Whole-experiment churn: **code:doc ≈ 1:9.38** (the report's diagnosis).
- Last 12 h (a heavily-worked session): **2,224 code : 19,310 doc = 1:8.68** — barely moved.
- The molt is dominated by **process byproducts**, not governance intent:
  | source (12 h) | lines | nature |
  |---|---|---|
  | iteration reports | 5,666 | process narrative |
  | **directive task projections** | **2,423** | **pure dual-source duplication** |
  | charters + dashboard | 3,179 | process narrative |
  | rule prose (OUTER-LOOP/inherited-core) | 833 | mostly descriptive, not executable |
  | **DIR files (the actual human intent)** | **1,046** | the legitimate core |

**~1,000 lines of real intent generate >18,000 lines of descriptive/duplicative byproduct.** Each
bit of governance intent (a ~50-line DIR) balloons into: a DIR file + a full-content task copy +
inherited-core/OUTER-LOOP prose + a charter (re-copies the task) + 2 iteration reports + an audit
report + dashboard entries ≈ 1,000+ lines. `L(G)` explodes per bit of intent; the executable
invariant grows by ~one gate clause.

## 2. The disease is one family (all observed live, 2026-07-19)

1. **Dual source.** A directive lives in BOTH `directives/…/DIR-NNN.md` AND `tasks/DIR-NNN.md`. The
   anti-drift check is not a cure — it *presupposes* two sources and reconciles them. DIR-025 made
   it worse by duplicating the *full* content into the task.
2. **The two copies already diverge.** `tasks/DIR-027.md` omits the DIR file's `## Resolution` — the
   task is an incomplete copy, so it doesn't even show that/how DIR-027 was implemented.
3. **Half-crystallized rules.** split-or-commit's SELECT-split rule, ABSORB two-outcome rule, and
   parent-done-iff-children are **prose only**; only the needs-human-reason is an executable clause.
   DIR-026 reproduced the exact designed-not-wired disease it was filed to end.
4. **Special-cases-as-entropy.** M42 (a real milestone) shipped with no charter — a one-off shape.
5. **Escrow backlog.** 6 DIRs sit `pending` with real-landing deferred to future milestones.

## 3. Root cause — the cure has been ADDITIVE, so it feeds the disease

Every past anti-drift move was **more prose**: another check, another Clause, another DIR, more
OUTER-LOOP text. **Adding descriptive mass to fight molten-ness is self-defeating** — it raises
`L(G)`. This very session, while fixing real things, added ~19 k lines of doc, including the 2,423
lines of the exact duplication the human then flagged.

**The root cause is not any single unfinished DIR — it is that the governance *process* is
high-entropy: it emits descriptive and duplicative artifacts as byproducts.** Crystallization must
therefore be **subtractive (remove representations, delete redundant prose) + executable (runnable
invariants)** — never additive prose. When a deviation is found, fix the **document or skill that
generated it**, not just the artifact (else the generator keeps emitting the deviation).

## 4. Crystallization strategy — four axes (subtractive + executable)

### Axis 1 — Collapse dual sources to a single source (+ delete the reconciliation machinery)
- **Plan A (first move):** make directives **task-canonical** — the quay task (`tasks/DIR-NNN.md`,
  already a git-tracked file in the native store) is the single source; `directives/pending|archive/`
  is retired or becomes a *generated view*; pending/archive becomes task status/label. Symmetric
  with DIR-009's milestone decision.
- **Delete, don't add:** the `it0-dir-projection-check` anti-drift script and the
  `it0-dir-task-project` projection script both exist only to compensate for the dual source — with
  one source they are *removed*, not kept. Net negative lines.
- **Generalize:** anywhere content lives twice (charter copying a task's AC/DoD; `backlog.md` vs the
  task store; dashboard copying task status) → one source + a generated view.

### Axis 2 — Turn load-bearing rules into executable invariants; delete narrative prose
- Anything a milestone MUST satisfy is a **DoD clause or a `quay gate`**, fixture-pinned — not prose
  in OUTER-LOOP/inherited-core. Crystallize the prose rules that are actually load-bearing
  (split-or-commit's split-gate, parent-done-iff-children) into executable checks.
- Prose that merely **narrates** what a gate does is redundant with the gate → shrink to a pointer.

### Axis 3 — Let executable artifacts BE the record, not prose narratives about them
- Iteration reports (5,666 lines/12 h) mostly restate the diff + ticked AC + GateEvent. The **commit
  SHA + `quay gate-log` + the AC checkbox state ARE the record** (DIR-024's aim). Shrink reports to a
  pointer.
- ABSORB prose dispositions ("adversarial-audit gate: documented no-op…") → **GateEvents**
  (DIR-022/024). Apply "the meter is runnable, not asserted" (epicd ADR-019) uniformly.

### Axis 4 — Lower the governance process's own entropy
- A small executable delta (one gate, one fix) should not trigger charter + full task-copy + 2
  iterations + audit. Right-size the ceremony to the delta. M42 (no charter) accidentally showed the
  lean shape; make that a *deliberate, consistent* tier, not a one-off.

## 5. North-star metric (make molt visible and gated)
Track **per-milestone code:doc increment ratio** on `dashboard.md`; a milestone whose delta is
overwhelmingly new prose (beyond a threshold, excluding legitimate intent) is **flagged** — the same
"make the invariant executable" discipline applied to the molten-ness metric itself.

## 6. Sequencing
1. **Land Plan A** (Axis 1, first move) — task-canonical directives; delete the two reconciliation
   scripts. This is the first genuinely *subtractive* crystallization and removes the flagged
   dual-source. Executed via the quay task model (proposal→task, AC/DoD, split-or-commit, independent
   audit; deviations root-caused to docs/skills).
2. Crystallize split-or-commit's prose rules into executable checks (Axis 2).
3. Shrink iteration reports / ABSORB dispositions to GateEvent pointers (Axis 3; advances DIR-024).
4. Add the north-star ratio metric + flag (Axis 5) — as an executable check, not prose.

## 7. Forward hook — quay as a document-management substrate
This proposal's own future is Axis-1 applied to *documents at large*: proposals, plans, and design
docs are today loose `docs/` markdown (a second source alongside any task that references them). The
next discussion (human-noted) is **extending quay to manage documents** — so a proposal/plan is a
first-class quay object with one canonical home and generated views, not a `docs/` file duplicated
into task bodies. This document is written to `docs/proposals/` under the *current* convention; its
own migration into quay is the concrete first test of that future capability.

## 8. Canonical task schema — Axis 1+2 applied to task STRUCTURE

**The task's SHAPE is itself multi-sourced** (the dual-source disease one level up). "What sections
a task has" is defined inconsistently in ≥3 places: the `/quay-directive` skill (Finding / Requested
action / AC / DoD / a vestigial empty Resolution — no Proposal), `OUTER-LOOP.md` SELECT (Proposal /
Plan / AC / DoD — no Finding), and the DoD clauses (Clause 0 checks AC/DoD; Clause 8 checks
Proposal/Plan for milestones only). Live evidence (DIR-028's own task): no `## Proposal`; a DoD in
prose not a checklist; TWO `## Resolution` sections, one empty; a body `dirStatus: pending` line
CONTRADICTING the frontmatter `dirStatus: applied` field (lifecycle stored twice).

**Fix — ONE canonical task schema, uniform across every task kind (milestone AND directive), and
EXECUTABLE (a validator, not prose):**
- `## Proposal` — **required**: the proposed approach/change (a directive's Finding+Requested action
  fold into it, or a short `## Context` lead-in precedes it).
- `## Plan` — **optional**: a `docs/plans/*.md` reference or `N/A — <reason>`. A directive may omit
  it (its implementation plan belongs to the milestone that resolves it).
- `## Acceptance Criteria` — **required, GFM checklist** `- [ ]`.
- `## Definition of Done` — **required, GFM checklist** `- [ ]` (fixes the prose-DoD inconsistency).
- **Lifecycle is FIELDS ONLY** — `status` + `extra.dirStatus`. **Retire the `## Resolution` section
  as a status mirror:** a Resolution/`## Execution record` is appended ONLY at close and holds
  *evidence* (what/how/commits), never the status value and never an empty placeholder. The old
  file-format template (inherited from `directives/README`) that mandated `## Resolution: outcome:
  applied|deferred` — a duplicate of `dirStatus` — is the root source; it is removed.
- **One validator, fixture-pinned:** extend DoD Clause 0 (or a dedicated `task-schema-check`) to
  assert the whole schema (required sections present, AC/DoD checklist-form, no status-mirror
  Resolution, no duplicated lifecycle line). All authoring paths (SELECT, `/quay-directive`) emit
  this shape; the validator is the single executable definition. This collapses the ≥3 scattered
  shape-definitions into ONE and fixes the milestone/directive asymmetry in one stroke.

## 9. Formalized prompt-document style — the VEHICLE for the rewrites (baime skill-authoring)

The crystallization requires rewriting molten prompt documents (the `/quay-directive` skill,
`OUTER-LOOP.md` at 511 lines, `inherited-core.md`). Rewriting them as *more prose* is the additive
paradox (§3). Instead adopt **baime's formalized style** (`skill-authoring` /
`subagent-prompt-construction`) — which is itself a crystallization technology, applying the axes to
the documents:
- **`## Spec` λ-block (≤30 lines):** a compact symbolic contract (`λ(x)→y ∧ ∀ ∈ ≤ …`) replacing
  paragraphs of prose — high density, low `L(G)` (Axis 2/4).
- **`contracts:` frontmatter (≥3 grep/not-grep, `target: self`):** the document carries **executable
  assertions about its own structure**, machine-verified — "the meter is runnable, not asserted"
  applied to the document itself (Axis 2). `OUTER-LOOP.md` today has zero self-verification.
- **Fixed structure + line bounds + `reference/` offload:** a canonical document schema (single
  source for the document's shape — Axis 1), with detail loaded on demand (Axis 4).
- **Isomorphism:** the SKILL.md fixed structure ≈ the §8 canonical *task* schema; `contracts:`
  self-verification ≈ the schema validator. §8 and §9 are two faces of one move — a canonical schema
  for an object + a formalized, self-verifying document that generates/checks it.

**Tension to resolve (decision needed):** baime's `contracts:` are verified by the baime plugin's
`validate-plugin.sh`; exp5's prompt docs are not baime-plugin skills. Either (a) build a small exp5
contract-validator (a runnable meter for document conformance — itself an Axis-2 crystallization), or
(b) bring the exp5 prompt docs under the baime plugin's skill format / the future quay document
manager (§7). Recommendation: (a) now (cheap, unblocks the rewrites), converging toward (b) as §7's
document-management capability lands.

## 10. Non-goals
- Do NOT crystallize by writing MORE rules — that is the additive-prose paradox (§3). Every item
  above is a deletion, a collapse, or an executable assertion.
- Do NOT rewrite historical process narrative (past reports/dashboard log) — leave the record;
  crystallize forward.
