# M20-quay-task-to-plan-skill-proposal-step — iteration-1

**Type:** development-class, real implementation (not design-only). **Independent
re-derivation** — a separate iteration-0 ran in parallel elsewhere in this repo;
this iteration deliberately did not read iteration-0's worktree, branch, or report.
Design decisions below are this iteration's own, derived fresh from the charter,
plan Phase 6, proposal §§12-13, and `.claude/skills/quay-directive/SKILL.md`.

## HARD GATES

### Worktree isolation proof

```
$ git rev-parse --show-toplevel
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/worktrees/iteration-1
$ git branch --show-current
exp5-m20-iteration-1
```

Confirmed: working inside the dedicated worktree, on branch `exp5-m20-iteration-1`,
not the shared repo root.

### `git diff --stat` scope proof (against pre-charter base `fdb3f39`)

```
$ git add -A && git diff --stat fdb3f39
 .claude/skills/quay-task-to-plan/SKILL.md          | 255 +++++++++++++++++++++
 .../prompts/adjudicate-proposal.md                 | 142 ++++++++++++
 .../quay-task-to-plan/prompts/proposal-subagent.md |  99 ++++++++
 experiments/quay-perpetual-stream/backlog.md       |   2 +-
 4 files changed, 497 insertions(+), 1 deletion(-)
```

Scoped exactly to `.claude/skills/quay-task-to-plan/` (the new skill) plus this
milestone's own `backlog.md` bookkeeping row (this iteration report itself will
add one more file to that diff once committed). No Core CLI code, no
`inherited-core.md`/`OUTER-LOOP.md` edits, no Phase 7 content.

### Plan-time line-budget gate (run before dispatch, per charter)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M20-quay-task-to-plan-skill-proposal-step.md
PASS: experiments/quay-perpetual-stream/charters/M20-quay-task-to-plan-skill-proposal-step.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```

### Gate-hash-by-reference check (run before dispatch, per charter)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M20-quay-task-to-plan-skill-proposal-step.md
PASS: experiments/quay-perpetual-stream/charters/M20-quay-task-to-plan-skill-proposal-step.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```

Both PASS. No re-derivation of the gate text needed.

## Design summary (this iteration's own derivation)

Read, in order: charter, `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 6
(Stages 6.1-6.3, lines 415-503), `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
§§12-13 (lines 306-481), `.claude/skills/quay-directive/SKILL.md` (structural
precedent), DIR-014 (motivating directive). Built:

- `.claude/skills/quay-task-to-plan/SKILL.md` (255 lines) — frontmatter, provider
  read/write contract (§0), proposal step (§2), adjudication/write-back step (§3),
  operational step summary (§4), non-goals.
- `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md` (99 lines) —
  parametrized by `{{PERSONA}}` (`minimal-surface-area`, `pattern-consistent`),
  blank-slate/no-inter-agent-communication instructions baked into the prompt
  body itself, not just the dispatcher's discipline.
- `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md` (142 lines) —
  convergence/divergence check, epic-split exception, idempotent section-replace
  write-back instructions, mandatory readback.

Total: 496 lines — within the plan's ~460-line estimate and the ≤500-line
phase-budget PASS condition.

## Charter Done-when clauses — evidence

### Clause 1 — `SKILL.md` exists with valid frontmatter matching quay-directive's shape

```
$ head -5 .claude/skills/quay-task-to-plan/SKILL.md
---
name: quay-task-to-plan
description: For a development-class quay task (or a milestone's grouped task set), run N independent blank-slate proposal subagents, adjudicate their divergence, and write the reconciled proposal back to the task's body via the Provider ABI's task_write tool (never a status-only patch). This is the PROPOSAL STEP ONLY (Phase 6 of docs/plans/3-7-quay-task-to-plan-skill.md) — it stops after write-back; the plan-authoring step, TDD gate, and DISPATCH wiring are a separate future phase and are explicitly not invoked by this skill yet. Invoke on a development/capability-growth-typed task that needs a proposal before it can be planned.
allowed-tools: Bash, Read, Write, Task
---
```

Matches `quay-directive`'s YAML frontmatter shape (`name`/`description`/
`allowed-tools`). File listing:

```
$ find .claude/skills/quay-task-to-plan -type f | sort
.claude/skills/quay-task-to-plan/SKILL.md
.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md
.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md
```

**MET.**

### Clause 2 — provider read/write contract documented (Stage 6.1)

Excerpt from `SKILL.md` §0:

> **Read.** `mcp__quay__task_get` (single task, full detail...) and
> `mcp__quay__task_list` (candidate/milestone-membership queries...) — MCP tools
> preferred in-session. CLI fallback... `node packages/quay/bin/quay.js task list
> --label milestone:<id> --json` / `task get <id> --json`.
>
> **Write.** `mcp__quay__task_write` — **the full-field write path**
> (`body`/`extra`/`labels`/`parent`/`children`/`status`/`title`...), **never a
> status-only patch**. CLI fallback for the native provider specifically:
> `packages/quay-native/bin/quay-native.js task edit <id> --body '...' --extra
> '{"proposalStatus":"..."}' --json`... the Core CLI's
> `packages/quay/bin/quay.js task edit` is deliberately status-only in v1 per
> QN-024 and **cannot** perform this write; do not use it for this purpose.

DIR-011 portability rule excerpt:

> a task's proposal is *portable metadata* and MUST live in the task's `body`,
> not solely in `extra{}`... `extra.proposalStatus` MAY additionally be written
> as a native-only, query-performance convenience, but is **never the sole
> record of the fact**.
>
> **GitHub degradation.** On the GitHub provider, `extra{}` does not exist and
> there is no native `parent`/`children` field — the `## Proposal` body section
> is written exactly the same way..., but the `extra.proposalStatus` mirror is
> simply omitted..., and any parent/children grouping... degrades to the
> checkbox-in-body convention per M12.

Mechanical check (no non-existent `task write` CLI verb invoked, correct tool
names used):

```
$ grep -n "quay.js task edit" .claude/skills/quay-task-to-plan/SKILL.md
50:  documented fallback — the Core CLI's `packages/quay/bin/quay.js task edit` is
$ grep -n '`task write`\|quay.js task write\| task write ' .claude/skills/quay-task-to-plan/*.md .claude/skills/quay-task-to-plan/prompts/*.md
(no output — no invocation of a non-existent CLI subcommand)
```

**MET.**

### Clause 3 — proposal step documented + real prompt template exists (Stage 6.2)

`SKILL.md` §2 documents: N=2 default, blank-slate-leaning dispatch, no shared
context/no inter-agent communication, persona differentiation
(minimal-surface-area / pattern-consistent), architect-review retained as an
additional pass (chain diagram included), writes nothing until adjudication.

File exists:

```
$ wc -l .claude/skills/quay-task-to-plan/prompts/proposal-subagent.md
99 .claude/skills/quay-task-to-plan/prompts/proposal-subagent.md
```

Excerpt (persona parametrization):

> - `minimal-surface-area` — "Propose the approach that changes the fewest
>   files / introduces the fewest new concepts / has the smallest blast
>   radius..."
> - `pattern-consistent` — "Propose the approach most consistent with existing
>   patterns already used elsewhere in this codebase..."
>
> Do NOT call task_write or any other task-mutating tool. Your job ends at
> producing the proposal text; a separate adjudication step (a different agent
> invocation) is responsible for reconciling proposals and writing back to the
> task.

**MET.**

### Clause 4 — adjudication/write-back step documented + real prompt template exists (Stage 6.3)

`SKILL.md` §3 documents: convergence/divergence check, divergence → adjudicate
winner or synthesize merge + record `### Adjudication note` (alternatives from
BOTH proposals preserved), convergence → write back with no fabricated note,
N=1 fallback, epic-split exception, exactly-once write via `task_write`,
idempotent section-replace (not append-orphan) for regeneration, mandatory
`task_get` readback.

File exists:

```
$ wc -l .claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md
142 .claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md
```

Excerpt (regeneration discipline + readback):

> Idempotently replace the existing "## Proposal" section if one is already
> present (replace from the "## Proposal" heading through, but not past, the
> next "##" heading...); if no "## Proposal" section exists yet, append one.
> ...
> READ BACK (mandatory evidence, do not skip). Immediately call
> mcp__quay__task_get on {{TASK_ID}} again and confirm the returned body
> contains your just-written "## Proposal" section verbatim.

**MET.**

### Clause 5 — demonstrated dry-run/self-test evidence (real provider read/write)

**Environment note (honest disclosure):** this session has no generic
Task/subagent-spawn tool available (`mcp__plugin_manda_manda__Agent` was
attempted and failed with `MCP error -32602: cap request requires to=... ` —
broker-routing infrastructure not present in this sandbox). The N=2 proposal
drafts below were therefore authored directly by this iteration in strict
written isolation (drafting persona A's proposal without referencing persona
B's specific content, and vice versa) rather than via two separate spawned
subagent processes. This is a substitution for the *proposal-authoring*
step's mechanism only — it does NOT weaken the evidence for the write-back
mechanism itself (Stage 6.3's actual acceptance target), which used the real
MCP `task_write`/`task_get` tools throughout, unmodified.

**1. Scratch task creation (native provider, real MCP tool call):**

```
$ mcp__quay__task_write id=ZZ-M20-SCRATCH-1 title="SCRATCH — M20 iteration-1 dry-run task (safe to delete, not real backlog)" labels=["scratch","m20-dry-run"] status=todo body="# SCRATCH — M20 iteration-1 dry-run task\n\nThis task exists ONLY to dry-run the quay-task-to-plan skill's proposal\nwrite-back step (Stage 6.3 evidence). It is not real backlog/directive work.\nSafe to delete.\n\n## Original ask (synthetic)\nAdd a `--dry-run` flag to a hypothetical CLI subcommand that previews a write\nwithout performing it.\n"
→ {"task":{"id":"ZZ-M20-SCRATCH-1","title":"SCRATCH — M20 iteration-1 dry-run task (safe to delete, not real backlog)","status":"todo","labels":["scratch","m20-dry-run"],"parent":null,"children":[],"role":"primitive","extra":{},"body":"...","updatedAt":1784397409827.2454}}
```

On-disk location confirmed native, not this worktree's own `./tasks/` (the MCP
server was launched against the shared repo root at session start, per this
repo's `.mcp.json`; the skill's own documented contract is provider/location-
agnostic and works identically regardless of which native tasks_dir the
provider process is bound to):

```
$ find /home/yale/work/quay -maxdepth 6 -name "ZZ-M20-SCRATCH-1.md"
/home/yale/work/quay/tasks/ZZ-M20-SCRATCH-1.md
```

**2. Two independent persona proposals drafted** (minimal-surface-area,
pattern-consistent) for the scratch task's synthetic `--dry-run` flag ask —
full text in this iteration's transcript; both converged on the same
underlying approach (a boolean flag that computes-then-previews before the
real mutating write, no central cross-cutting framework, no separate preview
subcommand), differing only in framing/emphasis, not in what gets built. Per
`adjudicate-proposal.md`'s convergence-check instructions, this is a
**convergence** case — no `### Adjudication note` fabricated.

**3. Write-back — first write (real MCP `task_write` call, full-field, `body` +
`extra`):**

```
$ mcp__quay__task_write id=ZZ-M20-SCRATCH-1 body="<full reconstructed body with new ## Proposal section>" extra={"proposalStatus":"adjudicated"}
→ {"task":{"id":"ZZ-M20-SCRATCH-1", ..., "extra":{"proposalStatus":"adjudicated"}, "body":"# SCRATCH — M20 iteration-1 dry-run task\n\n...\n\n## Proposal\n\nSource: adjudicated, 2026-07-18, minimal-surface-area + pattern-consistent\n\nAdd a `--dry-run` boolean flag to the target subcommand...\n\nKey design decisions: (1) flag lives inside the one subcommand's handler...\n\nAlternatives considered and rejected: a global `--dry-run` flag handled centrally...\n", "updatedAt":1784397469539.2605}}
```

**4. Readback #1 (mandatory evidence, real MCP `task_get` call):**

```
$ mcp__quay__task_get id=ZZ-M20-SCRATCH-1
→ {"task":{"id":"ZZ-M20-SCRATCH-1", ..., "body":"...## Proposal\n\nSource: adjudicated, 2026-07-18, minimal-surface-area + pattern-consistent\n\n...", "updatedAt":1784397469539.2605}}
```

Confirmed: the `## Proposal` section, with the exact adjudicated content, is
present in the freshly-read body — the write landed.

**5. Regeneration-discipline proof — second write (re-run write-back, same
task, to prove idempotent section-replace not append-orphan):**

```
$ mcp__quay__task_write id=ZZ-M20-SCRATCH-1 body="<same body with ## Proposal section's Source line amended '(REGENERATED — regeneration-discipline demonstration, iteration-1 dry-run)' and an added paragraph explaining the proof>"
→ {"task":{"id":"ZZ-M20-SCRATCH-1", ..., "body":"...## Proposal\n\nSource: adjudicated, 2026-07-18, minimal-surface-area + pattern-consistent (REGENERATED — regeneration-discipline demonstration, iteration-1 dry-run)\n\n...This regenerated section proves the write-back step performs an idempotent\nsection-replace...\n", "updatedAt":1784397481819.2637}}
```

**6. Readback #2 (mandatory evidence, real MCP `task_get` call):**

```
$ mcp__quay__task_get id=ZZ-M20-SCRATCH-1
→ {"task":{"id":"ZZ-M20-SCRATCH-1", ..., "body":"...## Proposal\n\nSource: adjudicated, 2026-07-18, minimal-surface-area + pattern-consistent (REGENERATED...)\n\n...", "updatedAt":1784397481819.2637}}
```

Confirmed exactly ONE `## Proposal` section present in the body (not two,
i.e. no append-orphan duplication) — the regeneration discipline (proposal
§3/§12.2, mirroring M05's `## Status mirror` idempotent-replace pattern)
demonstrably works as documented.

**7. Cleanup:** no `task delete` verb exists on either the MCP tool surface or
the Core CLI (`quay task --help` lists only `list`/`view`/`edit`/`check`; no
`delete`/`remove`) — this itself confirms the skill's documentation that
`task edit` is the only mutating verb and there is no delete primitive to
route around. Cleaned up by removing the underlying native-store file
directly (a one-off cleanup action, not a skill-documented write path):

```
$ rm /home/yale/work/quay/tasks/ZZ-M20-SCRATCH-1.md
$ mcp__quay__task_get id=ZZ-M20-SCRATCH-1
→ error: no such task: ZZ-M20-SCRATCH-1 (provider: native)
```

Confirmed removed — no scratch/test pollution left in the real task store.

**MET** — full-field `task_write` write-back proven end-to-end (initial write +
regeneration + two readbacks), against a real (scratch, clearly-labeled,
now-deleted) task in this repo's own native provider.

### Clause 6 — `git diff --stat` scoped only to the skill dir + milestone bookkeeping

See HARD GATES section above — confirmed: only `.claude/skills/quay-task-to-plan/`
(3 files) + `experiments/quay-perpetual-stream/backlog.md` (1 line) changed
against base `fdb3f39`. This iteration report file itself will be the 5th file
in the final committed diff. No Core CLI code, no `inherited-core.md`/
`OUTER-LOOP.md` edits, no Phase 7 content anywhere in the diff.

**MET.**

### Clause 7 — full existing test suite still passes (N/A, stated)

No script/tooling code was changed this iteration — only skill/prompt markdown
files (`.claude/skills/quay-task-to-plan/**`) plus `backlog.md` prose plus this
report, plus a scratch-task provider dry-run (no code path exercised beyond
already-existing, already-tested `task_write`/`task_get` MCP tool
implementations). **N/A, stated explicitly per the charter's own clause-7
carve-out** ("N/A-and-stated if only skill/prompt markdown + a scratch-task
dry-run were touched").

**MET (N/A).**

### Clause 8 — `backlog.md` gains a DONE row noting Phase 7 remains open

`experiments/quay-perpetual-stream/backlog.md`'s existing
`M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` row (already present, pre-drafted at the
m19→m20 SELECT boundary with status `pending (SELECTED for m20)`) updated to
`DONE (m20, 2026-07-18, iteration-1)` with full evidence summary, explicitly
stating: "Phase 7 (plan step, TDD ≥80% gate, DISPATCH wiring, non-discretionary
policy) remains explicitly open future work — not started."

```
$ git diff fdb3f39 -- experiments/quay-perpetual-stream/backlog.md | head -5
diff --git a/experiments/quay-perpetual-stream/backlog.md b/experiments/quay-perpetual-stream/backlog.md
index ...
--- a/experiments/quay-perpetual-stream/backlog.md
+++ b/experiments/quay-perpetual-stream/backlog.md
@@ ...
```

**MET.**

## it0 systematic-explore checks (§4.4, recorded)

a. **Ceiling/floor arithmetic** — N/A this milestone, confirmed: no VT-chart
   claim introduced anywhere in `SKILL.md`, the prompts, or the backlog row
   (Realized Δv explicitly not claimed; `backlog.md`'s DONE note does not cite
   a VT number, consistent with the charter's "zero direct VT points" framing).
b. **Gate-hash/transclusion** — verified PASS above (`--by-reference` mode).
c. **Dogfooding evidence-gate** — every Done-when clause above carries pasted
   file/excerpt/raw-output evidence; clause 5 carries a real provider
   read/write run (not narrative), including the honest disclosure of the
   subagent-spawn tool substitution.
d. **Domain-misfit audit-channel** — no live external system touched beyond
   this repo's own already-in-use native task store, scratch-scoped
   (`ZZ-*` prefix, `scratch` label, deleted post-verification).
e. **Plan-time line-budget gate** — PASS, recorded above.

## Adversarial-audit gate (evaluated at ABSORB, per charter)

Realized Δv is **zero** (capability-growth+discovery-typed, no VT chart cell
for a new skill artifact — mirrors M16-cli-edit-parity-impl's precedent). No
nonzero Δv claimed anywhere in this report or the backlog row. Per the
charter's condition (a), the adversarial-audit gate does NOT fire. Condition
(b) (iteration-0 recommending skipping iteration-1) does not apply to this
report — this IS iteration-1, dispatched regardless of any such
recommendation per the charter's own override instruction.

## Design decisions unique to this independent re-derivation

Since this is a genuine second, independent derivation (not a copy of
iteration-0's design), several judgment calls were made fresh from the source
material rather than guessed at:

1. **Frontmatter `allowed-tools`**: `Bash, Read, Write, Task` — added `Task`
   beyond quay-directive's `Bash, Read, Write` because this skill's core
   mechanism (N independent subagent dispatch) genuinely requires spawning
   subagents, unlike quay-directive which does not.
2. **Persona set**: chose exactly the two personas named in the plan's own
   Stage 6.2 acceptance-criteria example text (`minimal-surface-area` vs.
   `pattern-consistent`) rather than inventing different labels, since the
   plan document itself already suggested this pairing as illustrative and
   using it verbatim keeps the skill traceable to its spec.
3. **N=1 fallback and epic-split exception**: both explicitly written into the
   adjudication prompt template, even though neither is exercised in this
   iteration's own dry-run (which used N=2, converged, no split) — included
   because the plan/proposal text names both as real cases the mechanism must
   handle, not because this iteration invented new scope.
4. **Convergence vs. divergence outcome in the dry-run**: this iteration's own
   two persona drafts genuinely converged (same underlying design, different
   framing) rather than being staged to diverge — an honest outcome of running
   the mechanism as designed, not cherry-picked to make adjudication's
   divergence-handling path look exercised. The divergence-handling code path
   (adjudication note, alternatives-preservation) is therefore verified by
   prompt-template inspection (clause 4) but not by this dry-run's outcome —
   stated honestly as a gap, not papered over.
5. **Subagent-spawn substitution**: disclosed transparently in clause 5 rather
   than silently drafting two proposals in one context and calling it
   "independent" — the isolation discipline (not seeing the other draft while
   writing) was followed as closely as a single-context session allows, but
   this is a real, stated limitation, not equivalent to two genuinely separate
   process invocations.

## Remaining gaps / honest self-assessment

- **Divergence path untested by dry-run outcome** (see design decision 4
  above) — the *documentation* of the divergence-handling behavior (Stage 6.3
  acceptance) is present and inspectable, but no live run in this iteration
  exercised the "proposals actually disagreed" branch. A future dry-run with a
  more genuinely divergence-prone synthetic task (or an environment with a
  working subagent-spawn tool) could close this.
- **No working generic subagent-spawn tool in this session** — noted honestly;
  does not block Stage 6.2/6.3's *documentation* acceptance criteria (which
  are about the skill's contract being correctly specified), but means the
  N-subagent proposal step's own mechanism (as opposed to the write-back
  mechanism) was not exercised via two genuinely isolated tool-call-level
  agent processes this iteration.
- **GitHub-provider degradation is documented, not live-tested** — explicitly
  out of scope per the charter's own note ("Phase 6's dry-run evidence...
  GitHub degradation is documented, not live-tested, this phase").

## Convergence assessment

All 8 Done-when clauses are individually evidenced and MET (clause 7 MET-as-
N/A). `git diff --stat` scope is clean (skill dir + backlog bookkeeping +
this report only). Gates PASS. This iteration recommends the milestone as
DONE pending the standard ≥1-iteration-stability check against the parallel
iteration-0's own independent result (per §3.2 condition 1) — a human/outer-
loop reconciliation step this report does not itself perform (no access to
iteration-0's material by design).
