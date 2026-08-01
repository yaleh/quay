---
id: DIR-124-F
title: "Runtime-contract ground-truth registry for PlanAuthor/PlanCheck: single-source repo facts + grounded-fact learning loop"
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Mechanize the recurring "grounded facts" problem: PlanAuthor/PlanCheck repeatedly fail on
the SAME repo-runtime-contract facts (CLI binary path, Node coverage output format, Touches
matching rules, provider runtime defaults, shared-module signatures), each task paying a
failed-PlanCheck-round + per-task grounding-fact fix. Build a **versioned, hash-bound
`GroundTruthRegistry`** of repo-invariant facts that `prepare-milestone.js` injects into the
PlanAuthor and PlanCheck prompts, and a **learning loop** that promotes `grounded-fact-gap`
PlanCheck findings into the registry (with a version bump) so a fact is never re-discovered
by a later task.

Distinct from DIR-124-D's ExecutionPolicy registry: that owns task-class → execution POLICY
(routing/gates/test-audit/resource profiles); this owns repo FACTS (what the runtime
actually is). Both share the "single executable owner over prompt prose" principle.

Fifth child of the DIR-124 family (ADR-020; seeded reference:
`docs/references/repo-ground-truth.md`).

**Independently executable / PRIORITY (2026-08-01, human decision):** no hard
prerequisite. [[DIR-124-B]] is OPTIONAL — a minimal versioned registry (a `version` field
+ content hash, upgraded to B's StageReceipt binding later) works without it. This child
directly eliminates the dominant prepare-milestone cost (PlanCheck first-attempt failures
from missing repo facts, ~30-40M tokens across the 2026-07-31→08-01 product batch) and is
executed BEFORE the DIR-124-B/C/D/E chain — it is the "fix the pipeline that every future
prepare runs through" task. Its own prepare/execute must not wait for the DIR-124 chain.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

The 2026-07-31 → 2026-08-01 product-task batch (DIR-099/100/101/103/104/105/112 + splits)
produced a recurring PlanCheck-failure pattern, each from a fact the PlanAuthor didn't know:

- CLI path `quay.ts` vs `quay.js` (5+ tasks);
- Node coverage output format (basename rows, no `%`, killed-child merges zero) (3+);
- Touches matching (parentheticals break exact-path match; directory entries don't satisfy
  exact-file; post-Touches content trips `touches-overbroad`) (4+);
- exact line/callsite counts (4+);
- runtime contract vs Proposal assumption (provider env defaults: native tasks_dir and
  github QUAY_GITHUB_REPO both default at runtime, so "required → error" is a false
  positive) (3+).

Each was fixed by adding per-task "grounded facts" to the task body — repo-invariant
knowledge duplicated across tasks. This is the exact "stable rules distributed across prose
instead of one executable owner" root cause DIR-124-D targets, for the FACTS category.
ADR-020 records the decision; this task mechanizes it.

## Requested action

0. **Template hygiene (mechanical, immediate):** fix the prepare-milestone preflight /
   task-schema checks so the recurring MECHANICAL preflight failures cannot happen:
   (a) reject a `## Touches` entry with a parenthetical comment after the backticked path
   (breaks exact-path matching, `preflight-touches-mismatch`); (b) reject any non-`##`-heading
   content after `## Touches` (parsed as Touches entries, `touches-overbroad`). This removes
   the ~15% of batch cost from template-format mistakes before the registry matters.
1. Define a versioned `GroundTruthRegistry` (JSON or TS module) with schema-validated fact
   entries: `{ id, category, fact, adrRef? }`. Seed it from the five fact classes in
   `docs/references/repo-ground-truth.md` + migrate the `inherited-core.md`
   `evidenceSurface` content into the registry.
2. `prepare-milestone.js` (both mirrors) injects the relevant registry subset into the
   PlanAuthor and PlanCheck prompts — read from the registry, not re-typed per task.
3. Bind the registry version/hash into the StageReceipt per DIR-124-B; a registry version
   change invalidates affected receipts deterministically.
4. Learning loop: classify a PlanCheck finding as `grounded-fact-gap` when repo-invariant
   and not task-specific; promote it into the registry with a version bump (via the
   proposal-convergence finding-ledger). An already-registered fact re-surfacing as a
   finding is a registry-injection defect, not a task defect.
5. Fail-closed: a missing/unknown-category registry reference, or a stale registry version
   vs receipt, fails the PlanCheck/prepare before content agents dispatch.
6. RED/GREEN fixtures: a task whose plan omits a registered fact FAILS PlanCheck with a
   `grounded-fact-gap` finding; after the fact is registered, a fresh PlanAuthor produces a
   correct plan (proves the learning loop).

## Acceptance Criteria

- [ ] A versioned `GroundTruthRegistry` is the single production owner of the seeded facts;
  the per-task "grounded facts" blocks in the affected task bodies are NO LONGER needed for
  a clean PlanCheck (grep-confirmable: the registry, not task-body duplication, is what the
  PlanCheck consults).
- [ ] PlanAuthor and PlanCheck prompts are injected with the registry subset (both
  `prepare-milestone.js` mirrors) — real injection, not prompt prose.
- [ ] Registry version/hash is bound into the StageReceipt; a version change invalidates
  affected receipts (RED/GREEN).
- [ ] A `grounded-fact-gap` PlanCheck finding promotes into the registry with a version
  bump via the finding-ledger — real production path, not fixture-only.
- [ ] A task that would previously fail PlanCheck on a seeded fact now passes on a fresh
  PlanAuthor attempt (the learning loop's payoff, shown on a real task).
- [ ] Unknown category / stale registry-version-vs-receipt fails closed before content
  agents dispatch.
- [ ] Mirror parity: `.claude/workflows/prepare-milestone.js` == `plugin/workflows/
  prepare-milestone.js`; vendor-sync clean.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real task that previously needed manual grounded-facts now prepares cleanly using
  the registry (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.
- [ ] `docs/references/repo-ground-truth.md` and `inherited-core.md`'s `evidenceSurface`
  are the registry's seeded content, not a second divergent copy.

## Human verification

1. Can a PlanAuthor produce a correct plan without any per-task grounded-facts block,
   purely from the injected registry?
2. Does a `grounded-fact-gap` finding actually update the registry (version bump), and does
   the next task benefit?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*ground-truth*`
- `plugin/scripts/*ground-truth*`
- `experiments/quay-perpetual-stream/test/*ground-truth*.test.mjs`
- `plugin/test/*ground-truth*.test.mjs`
- `docs/references/repo-ground-truth.md`
- `experiments/quay-perpetual-stream/inherited-core.md`
- `adr/ADR-020-runtime-contract-ground-truth-registry.md`
