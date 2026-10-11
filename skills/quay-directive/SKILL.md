---
name: quay-directive
description: "Record a new directive for THIS workspace's quay task store as a TASK-CANONICAL quay task (label:directive) via task_write — the task IS the single source of truth (DIR-028/Plan A; NO directives/*.md file, NO projection, NO anti-drift check). Workspace-portable: works in any project with a .quay/config.yml, with or without an experiments/ dir. Every directive MUST carry runnable Acceptance Criteria + a real-landing Definition of Done (a file/fixture is necessary-not-sufficient — done = a real object actually operated through the mechanism, DIR-026 Reading A). Invoke after discussing the finding/action in the active conversation — host invocation is a thin adapter only: Claude Code uses /quay-directive, Codex uses $quay-directive (e.g. quay-directive manda dispatch confirmed genuine)."
allowed-tools: Bash, Read, Write, Edit
---

# quay-directive

    detect  :: Workspace → TaskStorePrefix                                           -- THIS workspace's own store, not a fixed experiment layout
    author  :: ConversationContext × Brief? → {Finding, RequestedAction, AC, DoD}     -- AC runnable; DoD real-landing (DIR-026)
    create  :: {...} → task_write(label:directive, full body) → CanonicalTask          -- the TASK is the single source (DIR-028); no file
    land    :: CanonicalTask → commit (→ ff-merge if authored in a worktree)

**TASK-CANONICAL (DIR-028 / Plan A).** A directive is a quay **task** and nothing else — there
is NO `directives/<X>/…/DIR-NNN.md` file, no projection, and no anti-drift check (dual-source
machinery, all retired). The task, stored as `tasks/DIR-NNN.md` (or whatever `tasks_dir` this
workspace's `.quay/config.yml` names) in the active provider's store, is the ONE canonical
record. This skill turns a conversation already had into that task. Do not re-introduce a
`directives/` file.

**Workspace-portable.** This skill generalizes "the active experiment" to **this
workspace's own task store**: it does not assume an `experiments/` directory exists, does not
list `experiments/*/`, and does not touch an `experiments/<X>/.halt` sentinel. A repo that has
no `experiments/` at all (the common case for a project that only installed this plugin) works
identically to a workspace that runs its own BAIME-style research loop under `experiments/` — that
kind of layout is one instance of a workspace, not a hardcoded assumption baked into this skill.

The optional argument after the skill invocation (`/quay-directive` in Claude Code,
`$quay-directive` in Codex — host invocation syntax is a thin adapter only; the lifecycle
policy below is the one canonical contract both resolve to) is a short title hint only. The
Finding and Requested action must be drawn from what was ALREADY discussed in this conversation.
If nothing substantive was discussed, stop and say so instead of inventing content.

## Steps

1. **Find this workspace's task store — never assume a fixed experiment layout.**
   Locate `.quay/config.yml` (search upward from the current directory, same resolution `quay`
   itself uses). If none is found, STOP and say so — this skill needs a real quay workspace.
   This workspace's own `tasks_dir` (from the enabled provider's config) is the single task
   store this skill operates on. If the repo happens to also contain an `experiments/` directory
   with an active BAIME-style loop, that is just additional context for the Finding/Requested-action
   narrative — it does NOT change where the task is stored or how the id is computed below.

2. **Compute the next DIR id from the TASK store (not files).**
   `node <path-to-quay>/bin/quay.js task list --label directive --json` (or the active provider's
   own CLI/MCP `task_list` with `--label directive`) against THIS workspace; take the max `DIR-NNN`
   present, +1, zero-pad to 3. If this workspace uses a different directive-id convention/prefix
   (e.g. a project-specific prefix), follow that workspace's own convention instead — do not
   assume the bare `DIR-NNN` scheme quay's own repo uses is universal. Compute fresh every time; never reuse a
   number from memory.

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
     REAL deliverable — not a demo/fixture — actually passed through the mechanism), verifiable by a
     durable engine/system artifact (GateEvent / engine-written status / log / regenerated view) keyed
     to that real object. Include the escrow rule: stays `pending` until that real-landing evidence
     exists. Per DIR-026 SPLIT-OR-COMMIT: if the directive's scope cannot be fully completed in one
     pass, it is SPLIT into completable board children (each done-or-`needs-human`), never deferred
     in prose.
   - `## Human verification when this workspace marks this done` (recommended): a short numbered
     checklist naming the real artifact to inspect and distinguishing real-object evidence from
     demo/fixture/prose evidence.

4. **Create the CANONICAL task** — the single source. Prefer the MCP `task_write` tool; CLI fallback
   is the active provider's own richer CLI (Core's own `task edit` may be status-only depending on
   version — prefer MCP `task_write`, or the provider's native CLI, for a body/extra/labels write):
   `task_write` with `id=DIR-NNN`, `labels` including `directive`, `status: todo`,
   `extra: {"dirStatus":"pending","schema":"v1"}`, and `body` = the full record from step 3.
   - `extra.schema` MUST be `"v1"` — the canonical-task-schema marker. This is what makes the task
     schema-applicable to the schema-check below; without it the task reports N/A-legacy (a
     detectable switchover error — the round-trip self-check in step 6 catches a forgotten marker
     loudly).
   - `id` = `DIR-NNN` (the computed id; use this workspace's own prefix convention).
   - `labels` MUST include `directive` (this is what surfaces it in `task_list --label directive`
     and the Web UI `?label=directive` filter).
   - `status` = `todo` for a fresh directive.
   - `extra.dirStatus` = `pending` (pending | applied | deferred | rejected). **This is a task
     field, not a directory** — there is no `pending/`/`archive/` folder.
   - `body` = the full record from step 3. There is NO `Source:` line (the task is not a
     projection of anything), NO body `dirStatus:` / `Status mirror:` line (lifecycle is the
     frontmatter `extra.dirStatus` field ONLY), and NO separate file. The web UI renders this
     body directly.
   - Read it back (`task_get`) and show the user the result.

5. **Lifecycle is a task-field change, never a file move.** When later work resolves this
   directive, it appends a `## Resolution` section to THIS task's body and sets `extra.dirStatus`
   (`applied`/`deferred`/`rejected`) + `status: done` — via `task_write`. There is no file to move
   from `pending/` to `archive/`; `extra.dirStatus` IS the archive state. Deferred + a needs-more-work
   note means the directive stays a live `label:directive` task at its recorded `dirStatus`.
   **Do NOT pre-seed an empty `## Resolution` at create time** (no `<!-- filled at close -->` stub —
   the schema check FAILs an empty-placeholder Resolution). The resolving change appends a
   `## Resolution` that carries **evidence** (or an `## Execution record`) — NEVER a bare
   status-mirror that only restates `outcome: applied|deferred` with no evidence. Absence of
   `## Resolution` on a still-open directive is correct.

6. **Self-check the round-trip BEFORE landing (canonical-task-schema v1).** After create + read-back,
   run the SHIPPED canonical-task-schema check (not a reference into any `experiments/**` path).
   The path is host-relative (thin adapter): when installed as a Claude plugin use
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/dist/task-schema-check.js" <path-to-the-task-file>`; in a
   checkout (Claude repo skill or Codex `$quay-directive`) use the repo-relative
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/task-schema-check.js <path-to-the-task-file>` (or the `.sh` wrapper
   alongside it). Require **exit 0** before committing. A `FAIL` means fix the TASK body (not the
   script); an `N/A legacy` line means the `extra.schema:"v1"` marker was forgotten in step 4 — add it.

   **Land it.** Commit the new/edited task file in this workspace's own task store:
   `git add <task-file-path> && git commit -m "DIR-NNN: <one-line summary>"`.
   **Human-steering hygiene:** if this workspace runs an autonomous loop that could race a direct
   commit (paused via its own project-specific sentinel, if it has one — a workspace-specific
   mechanism, not something this skill assumes exists universally), either pause that loop first
   per its own documented convention, OR author in a private worktree and land at a clean window.
   If no such loop exists in this workspace (the common case for a
   fresh install), commit directly.

## Notes
- **No file, no projection, no anti-drift.** If you find yourself creating a `directives/…/DIR-NNN.md`
  file or running a projection/anti-drift script, STOP — those were retired by DIR-028. The task is
  the sole source.
- **Do not invent content.** Finding + Requested action come from the conversation; the title hint
  after `/quay-directive` does not authorize new content.
- **No hardcoded experiment layout.** This skill never lists `experiments/*/`, never assumes a
  single "active experiment," and never touches an `experiments/<X>/.halt` file — those were
  assumptions specific to one particular workspace's layout in an earlier, non-portable version
  of this skill. Any
  loop-pause mechanism is workspace-specific context surfaced in step 6, not a hardcoded path here.
