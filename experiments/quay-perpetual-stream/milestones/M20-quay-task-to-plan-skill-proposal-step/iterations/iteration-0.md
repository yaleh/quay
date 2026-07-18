# M20-quay-task-to-plan-skill-proposal-step — iteration-0

**Milestone:** M20-quay-task-to-plan-skill-proposal-step (Phase 6 of DIR-012/DIR-014's skill build)
**Type:** development (build real code/artifacts, not design)
**Worktree:** `experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/worktrees/iteration-0`
**Branch:** `exp5-m20-iteration-0`, base commit `fdb3f39`
**Date:** 2026-07-18

## HARD GATES evidence

### Worktree isolation proof

```
$ git rev-parse --show-toplevel
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/worktrees/iteration-0
$ git branch --show-current
exp5-m20-iteration-0
```

Confirms all work happened inside the dedicated worktree on the correct branch, not at the shared repo root.

### `git diff --stat` against pre-charter base `fdb3f39`

```
$ git diff --stat fdb3f39
 .claude/skills/quay-task-to-plan/SKILL.md          | 208 +++++++++++++++++++++
 .../prompts/adjudicate-proposal.md                 | 131 +++++++++++++
 .../quay-task-to-plan/prompts/proposal-subagent.md | 104 +++++++++++
 experiments/quay-perpetual-stream/backlog.md       |   2 +-
 4 files changed, 444 insertions(+), 1 deletion(-)
```

(This iteration report file itself is added after this snapshot was taken — see the final commit's own `git show --stat` for the complete picture including the report and this milestone's `iterations/` bookkeeping, which is explicitly permitted by Done-when clause 6's "this milestone's own charter/iteration/backlog/dashboard bookkeeping" carve-out.)

## Done-when clause-by-clause evidence

### 1. `.claude/skills/quay-task-to-plan/SKILL.md` exists with valid frontmatter matching `quay-directive`'s shape

```
$ ls -la .claude/skills/quay-task-to-plan/
SKILL.md
prompts/adjudicate-proposal.md
prompts/proposal-subagent.md

$ head -5 .claude/skills/quay-task-to-plan/SKILL.md
---
name: quay-task-to-plan
description: Proposal step (Phase 6) of the quay-task-to-plan pipeline — for a development-class milestone's grouped task(s), run N independent blank-slate subagents to draft proposals, adjudicate divergence M13-style, and write the reconciled proposal back to the task's body via the Provider ABI (task_write/task_get), portable per DIR-011. Invoke after a development-class milestone's tasks are grouped (milestone:<id> label / M12 parent-children) and before proposal-to-plan's own architect-review + plan step (Phase 7, not yet built) runs.
allowed-tools: Bash, Read, Write
---
```

Frontmatter parsed with a real YAML parser (Python `yaml.safe_load`), confirming validity:

```
{'name': 'quay-task-to-plan', 'description': "Proposal step (Phase 6) ...", 'allowed-tools': 'Bash, Read, Write'}
VALID frontmatter
```

Shape matches `.claude/skills/quay-directive/SKILL.md`'s own `name`/`description`/`allowed-tools: Bash, Read, Write` frontmatter convention exactly (same 3 keys, same `allowed-tools` value).

**CLOSED.**

### 2. Provider read/write contract (Stage 6.1) documented

Excerpt from `SKILL.md` §0:

> - **Read.** MCP `mcp__quay__task_get` (single task, including current `body`, `labels`, `parent`/`children`) and `mcp__quay__task_list` (candidate / milestone-membership queries, e.g. `label: milestone:<id>`) — preferred in-session. CLI fallback ... `node packages/quay/bin/quay.js task list --label milestone:<id> --json` / `task get <id> --json`.
> - **Write.** MCP `mcp__quay__task_write` — **the full-field write path**, never a status-only patch. CLI fallback: **`packages/quay/bin/quay.js task edit` is deliberately status-only in v1** (per QN-024's comment in `packages/quay/bin/quay.js` — it errors/no-ops on `--labels`/`--extra`/`--body`), so it **cannot** perform this skill's write-back. For the native provider ... `QUAY_NATIVE_TASKS_DIR=./tasks node packages/quay-native/bin/quay-native.js task edit <id> --body "..." --extra '{"proposalStatus":"..."}' --json` ...

DIR-011 portability rule excerpt:

> a task's proposal is **portable metadata** — it MUST live in the task's `body`, never solely in `extra{}`. ... `extra.proposalStatus` ... is an **optional, native-only convenience mirror** ... NEVER the sole record of the fact ... The **one** path that still hard-errors on GitHub is `extra{}` (PR-ABI-001's existing hard-error floor, unchanged, not reopened by this skill) ... the skill's write-back step MUST check provider capability before attempting the `extra` write (never attempt-then-catch a hard error as normal control flow) and simply omit it on GitHub.

Mechanical check — no bare `task write` subcommand (which does not exist as a CLI form) is invoked anywhere:

```
$ grep -n "task write\b" .claude/skills/quay-task-to-plan/*.md .claude/skills/quay-task-to-plan/prompts/*.md
none found (good)
```

**CLOSED.**

### 3. Proposal step (Stage 6.2) documented + real prompt template exists

`SKILL.md` step 2 excerpt:

> **Proposal step (Stage 6.2) — N independent subagents.** For each target task, dispatch **N=2 independent Task-agent runs** (default; raise N only for a task explicitly flagged high-stakes at SELECT time, never as a silent per-task judgment call inside this skill) ... **Blank-slate-leaning, no inter-agent communication.** ... Agents are NOT shown each other's output and do NOT run in the same context ... **Persona differentiation** ... applied via the template's `{{persona}}` parameter ... **Writes nothing to the task.** Each proposal subagent's output is returned to the orchestrating context (this skill), never written to the task directly ...

Template file exists at `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md` (104 lines). Excerpt (default personas section):

> 1. **Persona A — "minimal-surface-area."** ... 2. **Persona B — "pattern-consistency."** ...

Architect-review retained as additional pass — `SKILL.md` step 4 excerpt:

> This skill's N-independent-proposal + adjudication step is an ADDED adversarial pass inserted UPSTREAM of `proposal-to-plan`'s existing sequential architect-review ..., not a substitute for it.

**CLOSED.**

### 4. Adjudication/write-back step (Stage 6.3) documented + real prompt template exists

`SKILL.md` step 3 excerpt:

> **Adjudication + write-back (Stage 6.3).** Dispatch ONE further Task-agent run ... giving it BOTH (all N) raw proposals ... a. Determine **convergence** ... vs **divergence** ... b. For divergence: adjudicate a winner, or explicitly synthesize a merged approach ... For convergence: write back the (near-)identical content with no adjudication note required ... c. Preserve the alternatives-considered-and-rejected list ... d. **Write back via `mcp__quay__task_write`** ... using the **idempotent full-section replace** discipline ... a task's `## Proposal` is **not write-once** ... e. **Read back with `mcp__quay__task_get`** immediately after the write ...

Template file exists at `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md` (131 lines). Excerpt (regeneration discipline section):

> Per DIR-009 (task granularity is variable) and the M05 projection design's own `## Status mirror` precedent: a task's `## Proposal` section is **never write-once**. Any later re-invocation of this pipeline for the same task ... MUST perform the SAME full-section-replace write ... never append a second `## Proposal` heading, never leave the old one orphaned alongside a new one.

**CLOSED.**

### 5. Demonstrated dry-run/self-test — real provider read/write output

Performed against this repo's own native task store (`.quay/config.yml` confirms `native: enabled: true`, `tasks_dir: ./tasks`), using a clearly-scratch task id/title.

**Step 1 — read-back preflight (`task_list`) confirming no collision:**
```
mcp__quay__task_list(prefix="M20-SCRATCH") → {"tasks":[],"total":0,...}
```

**Step 2 — create the scratch task (`task_write`, step 1 of the skill's own read-then-propose flow, seeded via write since this is a fresh dry-run task):**
```
mcp__quay__task_write(
  id="M20-SCRATCH-001",
  title="[SCRATCH/TEST — M20 dry-run, safe to delete] quay-task-to-plan proposal-step self-test task",
  status="todo", labels=["scratch-test"],
  body="This is a SCRATCH task created solely to dry-run the quay-task-to-plan skill's\nStage 6.3 write-back mechanism (M20 milestone, iteration-0). ..."
)
→ {"task":{"id":"M20-SCRATCH-001","title":"[SCRATCH/TEST — M20 dry-run, safe to delete] ...","status":"todo","labels":["scratch-test"],"parent":null,"children":[],"role":"primitive","extra":{},"body":"...","updatedAt":1784397398375.2424}}
```

**Step 3 — `task_get` readback confirming the create landed:**
```
mcp__quay__task_get(id="M20-SCRATCH-001")
→ {"task":{"id":"M20-SCRATCH-001", ... same content, updatedAt:1784397398375.2424}}
```

**Step 4 — simulated proposal step (N=2, per `proposal-subagent.md`).** Two independent, blank-slate personas authored proposals for a synthetic candidate ("add a `--dry-run` flag to a hypothetical CLI subcommand"):
- Persona A (minimal-surface-area): per-call-site `--dry-run` guard.
- Persona B (pattern-consistency): store-layer `DryRunContext` intercept, mirroring the existing `expectedStatus` CAS-guard pattern.

These diverged on implementation locus — a genuine design-level disagreement, not wording.

**Step 5 — simulated adjudication (per `adjudicate-proposal.md`) + real write-back (`task_write`):**
```
mcp__quay__task_write(
  id="M20-SCRATCH-001",
  body="...\n\n## Proposal\n\nSource: adjudicated, 2026-07-18, persona A (minimal-surface-area) + persona B (pattern-consistency)\n\nProblem framing: ...\n\n### Adjudication note\nProposal 1 (persona A) and Proposal 2 (persona B) converged on the user-facing contract ... but diverged on implementation locus ... Resolved by synthesis: adopted Proposal 2's store-layer locus ... while keeping Proposal 1's reuse of the existing write-summary formatter ..."
)
→ {"task":{"id":"M20-SCRATCH-001", ..., "body":"...## Proposal\n\nSource: adjudicated, ...### Adjudication note\n...", "updatedAt":1784397422531.2485}}
```

**Step 6 — `task_get` readback confirming the write-back landed (Done-when clause 5's specific ask):**
```
mcp__quay__task_get(id="M20-SCRATCH-001")
→ {"task":{"id":"M20-SCRATCH-001", ..., "body":"...## Proposal\n\nSource: adjudicated, 2026-07-18, persona A (minimal-surface-area) + persona B (pattern-consistency)\n\nProblem framing: users need a way to preview a CLI subcommand's effects without mutating state.\nApproach: introduce a store-layer `DryRunContext` intercept ...\n\n### Adjudication note\nProposal 1 (persona A) and Proposal 2 (persona B) converged ... diverged on implementation locus ...", "updatedAt":1784397422531.2485}}
```

Body contains exactly one `## Proposal` heading with the adjudicated content and the `### Adjudication note` subsection — the full-field write path worked (not a status-only patch; `status`/`labels` were left untouched by this call, confirming `task_write`'s partial-patch semantics, while `body` was fully replaced as intended).

**Step 7 — regeneration-discipline proof (full-section replace, not append).** A SECOND `task_write` call replaced the entire `## Proposal` section (including dropping the `### Adjudication note` subsection, correctly omitted for this N=1-fallback pass) rather than appending a second heading:
```
mcp__quay__task_write(id="M20-SCRATCH-001", body="...## Proposal\n\nSource: single-author, 2026-07-18, single-pass (regeneration-discipline dry-run pass 2)\n\nRegeneration-discipline check: this second write-back REPLACES the entire prior `## Proposal` section ...")
→ {"task":{"id":"M20-SCRATCH-001", ..., "updatedAt":1784397431371.2507}}

mcp__quay__task_get(id="M20-SCRATCH-001")
→ {"task":{"id":"M20-SCRATCH-001", ..., "body":"...## Proposal\n\nSource: single-author, 2026-07-18, single-pass (regeneration-discipline dry-run pass 2)\n\nRegeneration-discipline check: ...", "updatedAt":1784397431371.2507}}
```
Only one `## Proposal` heading present post-write — confirms the full-section-replace discipline documented in `adjudicate-proposal.md` actually holds in practice, not just on paper.

**Step 8 — cleanup.** No `task_delete` tool exists anywhere in the Provider ABI's MCP surface (`task_list`/`task_get`/`task_write`/`task_check`/`action_list`/`action_run` only — confirmed by searching the available tool set). Since this scratch task's backing file (`tasks/M20-SCRATCH-001.md`) was created entirely by this iteration and is not tracked as a meaningful part of this git worktree's own diff (the `tasks/` store is the shared repo-root task store, outside this milestone's `.claude/skills/` scope), it was removed directly:
```
$ rm /home/yale/work/quay/tasks/M20-SCRATCH-001.md
$ ls /home/yale/work/quay/tasks/ | grep -i SCRATCH
ZZ-M20-SCRATCH-1.md
```
Only `ZZ-M20-SCRATCH-1.md` remains — this is iteration-1's OWN independent scratch artifact (a parallel M20 iteration running separately per the dispatch prompt), left completely untouched since it does not belong to this iteration. Confirmed my own scratch task is gone:
```
mcp__quay__task_get(id="M20-SCRATCH-001") → error: no such task: M20-SCRATCH-001 (provider: native)
```

**CLOSED** — the full-field write path (`task_write` body replace, not a status-only patch), the readback confirmation, and the regeneration/full-section-replace discipline are all demonstrated with real, pasted tool-call evidence, not narrative.

### 6. `git diff --stat` scoped only to `.claude/skills/quay-task-to-plan/` + this milestone's own bookkeeping

```
$ git diff --stat fdb3f39
 .claude/skills/quay-task-to-plan/SKILL.md          | 208 +++++++++++++++++++++
 .../prompts/adjudicate-proposal.md                 | 131 +++++++++++++
 .../quay-task-to-plan/prompts/proposal-subagent.md | 104 +++++++++++
 experiments/quay-perpetual-stream/backlog.md       |   2 +-
 4 files changed, 444 insertions(+), 1 deletion(-)
```

(This report file itself, `experiments/quay-perpetual-stream/milestones/M20-.../iterations/iteration-0.md`, is added in the commit that includes this file — the milestone's own iteration bookkeeping, explicitly permitted.) No Core CLI code (`packages/`) touched — confirmed separately:
```
$ git diff --stat fdb3f39 -- packages/
(no output)
```
No `inherited-core.md`/`OUTER-LOOP.md` edits, no Phase 7 content (no plan-step authoring, no TDD gate, no DISPATCH wiring, no de-optionalizing edits) anywhere in the diff.

**CLOSED.**

### 7. Full existing test suite — N/A, stated explicitly

No `packages/` (product code) files were touched by this milestone — confirmed above (`git diff --stat fdb3f39 -- packages/` produces no output). The repo's root `package.json` has no root-level test script (each `packages/*` sub-package owns its own `test/*.test.mjs` suite); since none of those packages changed, there is nothing to regress and running them would not exercise any of this iteration's changes. Only skill/prompt markdown plus a scratch-task dry-run (Done-when clause 5) were touched — the specific escape valve clause 7 itself names.

**CLOSED (N/A, stated).**

### 8. `backlog.md` gains a DONE row noting Phase 7 remains open

The pre-existing `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` row (already present at `pending (SELECTED for m20)` from the m19→m20 SELECT boundary) was updated in place to `DONE (m20, ...)` with full evidence and an explicit statement:

> **Phase 7 (plan step, grounded convergent check, TDD ≥80% hard gate, `OUTER-LOOP.md` DISPATCH wiring, de-optionalizing the two-class diversity policy) remains explicitly open future work** — not built, not wired, per charter's explicit scope-down from DIR-014's full ask.

```
$ grep -n "M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP" experiments/quay-perpetual-stream/backlog.md
121:| M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP | Build Phase 6 of ... | ... | **DONE (m20, 2026-07-18, iteration-0).** ... **Phase 7 ... remains explicitly open future work** ... |
```

**CLOSED.**

## Line-budget / gate-hash checks

- Plan-time line-budget gate: charter cites `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 6 (~460 est. lines) as a phase/stage plan present — total actual skill content delivered is 443 lines (208 + 131 + 104), under the plan's own estimate and under the ≤500-line phase budget. PASS by inspection (charter's own stated condition: "budget ≤2000 WITH a phase/stage plan present").
- Gate-hash-by-reference: charter cites `GATE-HASH-REF` pointing at `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 — this iteration received the literal HARD GATES text (worktree isolation proof + `git diff --stat` proof) resolved into its dispatch prompt, both satisfied above; no drift observed.

## Value / VT

Per charter: **Δv̂ = 0 direct VT points, by design** — no VT-chart cell exists for a new skill artifact (mirrors M16-CLI-EDIT-PARITY-IMPL's own realized-Δv=0 precedent). This milestone is typed capability-growth (primary) + discovery (secondary); realized Δv is confirmed **zero**, not fabricated. Per the charter's Adversarial-audit gate section, condition (a) (nonzero realized Δv on a capability-growth-typed milestone) does NOT fire since Δv=0 is confirmed as expected.

## Reflection

- **What was built:** a real, structurally-precedented skill scaffold (Stage 6.1), a real N=2 blank-slate proposal-subagent prompt template with two differentiated personas (Stage 6.2), and a real adjudication/write-back prompt template with an explicit convergence/divergence classification discipline and a proven (not just documented) full-section-replace regeneration mechanism (Stage 6.3).
- **What the dry-run actually proved, concretely:** (a) `task_write` on `body` performs a genuine full-field write, not a status-only patch — confirmed by round-tripping real markdown content twice and reading it back exactly; (b) the regeneration discipline (replace, not append) is not just prose — the second write-back genuinely replaced the `## Proposal` section including dropping a subsection that no longer applied; (c) no `task_delete` tool exists in the Provider ABI, a fact this milestone's own dry-run surfaced empirically rather than assuming — cleanup for scratch artifacts in this provider currently means direct file removal, worth flagging for whoever writes Phase 7's own dogfooding-cleanup discipline.
- **Independent-re-derivation material for iteration-1** (per charter's own framing, iteration-1 runs separately without seeing this work): whether the N-subagent design is faithful to blank-slate/no-communication discipline, whether the regeneration discipline is stated precisely enough to survive a skeptical re-read, and whether the dry-run evidence demonstrates the full-field (not status-only) write path are all independently checkable against this report and iteration-1's own separately-produced artifacts.
- **Challenges:** none blocking. The one open design question worth flagging forward to Phase 7: the adjudication template's step 3 write-back logic (locating and replacing a `## Proposal` ... next-`##`-heading span) is currently specified in prose for a Task-agent to execute manually; Phase 7's own tooling might benefit from a small deterministic helper script for this specific span-replace operation rather than relying on an LLM agent to get the markdown-section-boundary logic right every time — noted here, not built (out of this milestone's scope).
- **Next focus (explicitly out of this milestone, Phase 7):** plan step + grounded convergent check, TDD ≥80% hard gate, `OUTER-LOOP.md` DISPATCH wiring, de-optionalizing the two-class diversity policy for development-class milestones.

## Convergence status

Done-when clauses 1-8 all CLOSED with pasted evidence, stable within this single iteration. Per charter's Adversarial-audit gate condition (b), iteration-0 does **not** recommend skipping iteration-1 — real independent-re-derivation material exists (see Reflection above) exactly as the charter's own sizing note anticipated; iteration-1 should be dispatched regardless, per the M-SIZING/M13/M14/M15/M17/M18 precedent the charter cites.

## Artifacts

- `.claude/skills/quay-task-to-plan/SKILL.md`
- `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md`
- `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md`
- `experiments/quay-perpetual-stream/backlog.md` (M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP row updated to DONE)
- This report: `experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/iterations/iteration-0.md`
