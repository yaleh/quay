---
name: quay-directive
description: Record a new directive for the currently-active quay BAIME experiment as a TASK-CANONICAL quay task (label:directive) via task_write — the task IS the single source of truth (DIR-028/Plan A; NO directives/*.md file, NO projection, NO anti-drift check — those dual-source mechanisms were retired). Auto-detects the active experiment. Every directive MUST carry runnable Acceptance Criteria + a real-landing Definition of Done (a file/fixture is necessary-not-sufficient — done = a real object actually operated through the mechanism, DIR-026 Reading A). Invoke after discussing the finding/action in this conversation, e.g. /quay-directive manda dispatch confirmed genuine.
allowed-tools: Bash, Read, Write, Edit
---

# quay-directive

    detect  :: Experiments → ActiveExperiment
    author  :: ConversationContext × Brief? → {Finding, RequestedAction, AC, DoD}   -- AC runnable; DoD real-landing (DIR-026)
    create  :: {...} → task_write(label:directive, full body) → CanonicalTask        -- the TASK is the single source (DIR-028); no file
    land    :: CanonicalTask → commit (→ ff-merge if authored in a worktree)

**TASK-CANONICAL (DIR-028 / Plan A, 2026-07-19).** A directive is a quay **task** and nothing
else — there is NO `directives/<EXPERIMENT>/…/DIR-NNN.md` file, no projection, and no anti-drift
check (all three were retired as dual-source machinery; the task, stored as `tasks/DIR-NNN.md` in
the native store, is git-tracked and is the ONE canonical record). This skill turns a conversation
already had into that task. Do not re-introduce a `directives/` file — that was the exact
dual-source disease Plan A removed.

The optional argument after `/quay-directive` is a short title hint only. The Finding and Requested
action must be drawn from what was ALREADY discussed in this conversation. If nothing substantive
was discussed, stop and say so instead of inventing content.

## Steps

1. **Determine `<EXPERIMENT>` — the currently active experiment. Never assume.**
   List every `experiments/*/` that contains an experiment (README with a `**Status**:` line). Classify
   each **active** / **not started** / **closed** from its README status line (or latest iteration).
   - Exactly one active → use it. Zero active but the conversation is clearly about one specific
     experiment → use it, stating which and why. More than one active, or ambiguous → STOP and ask.
   State the chosen `<EXPERIMENT>` explicitly before proceeding.

2. **Compute the next DIR id from the TASK store (not files — files no longer exist).**
   `node packages/quay/bin/quay.js task list --label directive --json` (or the native CLI); take the
   max `DIR-NNN` for `<EXPERIMENT>` (mind cross-experiment id collisions — an experiment prefixes its
   own ids per its convention, e.g. `exp5-DIR-004`; the current exp5 convention is bare `DIR-NNN`),
   +1, zero-pad to 3. Compute fresh every time; never reuse a number from memory.

3. **Author the directive content** (drawn from the conversation, concrete and checkable):
   - `## Proposal` (MANDATORY, canonical-task-schema v1) — the chosen approach, authored per the
     proposal-to-plan discipline. For a directive this folds `## Finding` + `## Requested action`
     behind a one-line Context lead-in (or is a distinct section preceding them). Real approach text,
     never a stub — the schema check FAILs a missing/placeholder Proposal.
   - `## Plan` (canonical-task-schema v1) — a directive MAY omit this, but stamping
     `## Plan\n\nN/A — directive resolved via a milestone; no staged plan` makes the round-trip
     unambiguous. If present it must be `N/A — <reason>` OR a resolving `docs/plans/*.md` path.
   - `## Finding` — the concrete finding/evidence discussed.
   - `## Requested action` — the specific, checkable action(s).
   - `## Acceptance Criteria` (MANDATORY) — a checklist of `- [ ]` items, each a **runnable command
     with an exit code** (or an equivalently mechanical grep/query check), never a prose claim.
   - `## Definition of Done` (MANDATORY) — **the bar is REAL LANDING, not artifacts.** State that the
     directive is NOT done when a script/gate/wiring exists, a file is created, or a fixture passes —
     those are necessary-not-sufficient (DIR-026 Reading A: the anti-fakery bar, which does NOT
     license phased/partial delivery). Done ONLY when the change is operative on the real object (a
     REAL milestone — not a demo/fixture — actually passed through the mechanism), verifiable by a
     durable engine/system artifact (GateEvent / engine-written status / log / regenerated view) keyed
     to that real object. Include the escrow rule: stays `pending` until that real-landing evidence
     exists. Per DIR-026 SPLIT-OR-COMMIT: if the directive's scope cannot be fully completed by one
     milestone, it is SPLIT into completable board children (each done-or-`needs-human`), never
     deferred in prose.
   - `## Human verification when the experiment marks this done` (recommended): a short numbered
     checklist naming the real artifact to inspect and distinguishing real-object evidence from
     demo/fixture/prose evidence.

4. **Create the CANONICAL task** — the single source. Prefer the MCP `task_write` tool; CLI fallback
   is the native provider's own richer CLI (the Core CLI `task edit` is status-only in v1 and cannot
   write a body/extra):
   `QUAY_NATIVE_TASKS_DIR=./tasks node packages/quay-native/bin/quay-native.js task edit DIR-NNN
   --labels directive --title "<title>" --extra '{"dirStatus":"pending","schema":"v1"}' --body "<the
   full body: ## Proposal + (## Plan) + ## Finding + ## Requested action + ## Acceptance Criteria +
   ## Definition of Done + (optional) ## Human verification>" --status todo --json`.
   - `extra.schema` MUST be `"v1"` — the canonical-task-schema marker. This is what makes the task
     schema-applicable to `task-schema-check.sh`; without it the task reports N/A-legacy (a detectable
     switchover error — the round-trip self-check in step 6 catches a forgotten marker loudly).
   - `id` = `DIR-NNN` (the computed id; use the experiment's prefix convention).
   - `labels` MUST include `directive` (this is what surfaces it in `task_list --label directive` and
     the Web UI `?label=directive` filter).
   - `status` = `todo` for a fresh directive (the task's own lifecycle status).
   - `extra.dirStatus` = `pending` — the directive lifecycle field (pending | applied | deferred |
     rejected). **This is a task field, not a directory** — there is no `pending/`/`archive/` folder.
   - `body` = the full record from step 3. There is NO `Source:` line (the task is not a projection of
     anything), NO body `dirStatus:` / `Status mirror:` line (lifecycle is the frontmatter
     `extra.dirStatus` field ONLY — a body status-mirror line is projection scaffolding the schema
     check FAILs), and NO separate file. The web renders this body directly.
   - Read it back (`task get <id>` / `task_get`) and show the user the result.

5. **Lifecycle is a task-field change, never a file move.** When a milestone later resolves this
   directive, it appends a `## Resolution` section to THIS task's body and sets `extra.dirStatus`
   (`applied`/`deferred`/`rejected`) + `status: done` — via `task_write`. There is no file to move
   from `pending/` to `archive/`; `extra.dirStatus` IS the archive state. Deferred + a needs-more-work
   note means the directive stays a live `label:directive` task at its recorded `dirStatus`.
   **Do NOT pre-seed an empty `## Resolution` at create time** (no `<!-- filled at close -->` stub —
   the schema check FAILs an empty-placeholder Resolution). The resolving milestone appends a
   `## Resolution` that carries **evidence** (or an `## Execution record`) — NEVER a bare
   status-mirror that only restates `outcome: applied|deferred` with no evidence. Absence of
   `## Resolution` on a still-open directive is correct; the schema forbids the empty-placeholder and
   bare-status-mirror shapes, not the not-yet-resolved state.

6. **Self-check the round-trip BEFORE landing (canonical-task-schema v1).** After create + read-back,
   run `node experiments/quay-perpetual-stream/scripts/task-schema-check.mjs tasks/DIR-NNN.md` (or the
   `.sh` wrapper) and require **exit 0** before committing. A `FAIL` means fix the TASK body (not the
   script — same discipline as the gate-hash / line-budget checks); an `N/A legacy` line means the
   `extra.schema:"v1"` marker was forgotten in step 4 — add it. This makes the skill self-enforcing:
   the schema is emitted by construction, verified before the commit below.

   **Land it.** The loop now runs directly on `master` (DIR-027 retired the driver branch), and this
   skill runs off-loop. Commit the new/edited `tasks/DIR-NNN.md`:
   `git add tasks/DIR-NNN.md && git commit -m "DIR-NNN (<EXPERIMENT>): <one-line summary>"`.
   **Human-steering hygiene (DIR-027 item 5):** if the autonomous loop is running, either pause it
   first (`touch experiments/<EXPERIMENT>/.halt`, drained at the next boundary) OR author in a private
   worktree off `master` and fast-forward at a clean window — never race the loop on `master`. If the
   loop is provably paused/idle, commit directly on `master`.

## Notes
- **No file, no projection, no anti-drift.** If you find yourself creating a `directives/…/DIR-NNN.md`
  file or running a projection/anti-drift script, STOP — those were retired by DIR-028. The task is
  the sole source.
- **Do not invent content.** Finding + Requested action come from the conversation; the title hint
  after `/quay-directive` does not authorize new content.
