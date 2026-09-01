---
name: quay-file-task
description: "Record a NEW quay task (any shape: contract/finding/plan/proposal — not just directives) in THIS workspace's task store via task_write, from content already discussed/decided in the active conversation or handed over as an already-drafted spec (a director/manager instruction relayed verbatim, a bug report with a proposed fix). This is the step BEFORE `author`: creating the todo-status task object itself, not advancing an existing one. Validates shape-aware four-artifact completeness (MIN_SECTION_CHARS=40, ready-pool-check.ts SHAPE_REGISTRY), Touches discipline (specific files not bare directories, self-touch, test files), and dedup-by-mechanism (not by symptom keyword) before writing. Prefer already-drafted content verbatim over re-authoring it. Not for label:directive tasks (use quay-directive) or for editing an existing task (use author / quay-task-operator). Invoke with a short title hint; Claude Code: /quay-file-task."
allowed-tools: Bash, Read, Write, Edit
---

# quay-file-task

    detect  :: Workspace → TaskStorePrefix                                        -- .quay/config.yml resolution, same as quay-directive
    dedup   :: MechanismKeyword × ExistingTasks → Duplicate?                       -- grep by MECHANISM, not symptom (dedup-tasks-by-mechanism-not-symptom)
    author  :: ConversationContext × DraftedSpec? → {shape, artifacts, Touches}     -- shape-aware; prefer already-drafted content verbatim
    id      :: Title × ExistingIds → TaskId                                        -- kebab-slug, collision-checked, `gap-<slug>` default family
    create  :: {...} → task_write(status: todo, labels, extra.schema) → CanonicalTask
    verify  :: CanonicalTask → task-schema-check.ts + artifactsComplete() readback  -- exit 0 / missing=[] required before commit
    land    :: CanonicalTask → git add tasks/<id>.md && commit (worktree hygiene as quay-directive step 8)

Generalizes `quay-directive`'s TASK-CANONICAL discipline (DIR-028 / Plan A: the task IS the
record, no side file, no projection) to non-directive tasks — the everyday case of filing a
`gap-*` defect, optimization, or execution task. Fills the step BEFORE `author`: `author`
advances an EXISTING `todo` task to `ready`; this skill creates the `todo` task object in the
first place. If the task already exists, do not use this skill — use `author` (still `todo`) or
`quay-task-operator` (any human-authorized edit to an existing task).

## When content is already fully drafted (the common case)

The request handed to you frequently already contains the complete task body — a director/human
instruction relayed verbatim ("请立案，任务体全文如下…"), or a diagnosis you or a peer already
wrote out in full. **Prefer that content verbatim over re-deriving it** — do not paraphrase or
re-author a spec someone already wrote carefully; your job in that case is validation +
mechanical filing (steps 2-7 below), not authorship. Only fall back to drafting fresh content
(part of step 3) when you were asked to file something from a bare finding/gist with no
ready-made body.

## Steps

1. **Locate the task store.** Same resolution as `quay-directive`: find `.quay/config.yml`
   upward from cwd; if none, STOP and say so. This workspace's own `tasks_dir` (from the enabled
   provider's config) is the target — never a hardcoded path.

2. **Dedup check — by MECHANISM, not by symptom keyword.** Before drafting/accepting content,
   search existing tasks (`task_list --json`, or grep `tasks/*.md`) for one naming the SAME
   underlying mechanism — e.g. "doc-check 结果未缓存" and "doc-check 每轮重跑" are the same
   mechanism under different symptom wording; grep the *mechanism* term, not the reporter's
   symptom phrasing. A real duplicate → STOP, point to the existing task id, do not file a
   second one. A related-but-distinct task (different mechanism, same area) → proceed, and note
   the related id in the new task's Proposal/Finding for traceability.

3. **Pick the shape and draft/accept content accordingly.** This workspace's todo→ready gate is
   shape-aware (`plugin/scripts/ready-pool-check.ts`'s `SHAPE_REGISTRY`, mirroring quay-native's
   `store.ts`): a task's four artifacts are its OWN shape's registered sections, not always a
   literal `## Contract`. Pick the shape that matches what's actually being filed — do not
   force-fit one shape onto content that is naturally another:
   - **`finding`** — a diagnosis/observation with no prescribed implementation:
     `## Finding` (the evidence) + `## AC` + `## DoD`. No plan dimension.
   - **`proposal`** — an approach with no separate staged plan (the common case for a
     single-leaf `gap-*` execution task): `## Proposal` + `## AC` + `## DoD`.
   - **`plan`** — an approach that needs a distinct staged plan:
     `## Proposal` + `## Plan` + `## AC` + `## DoD`.
   - **`contract`** — a directive-flavored task carrying a human ruling as its proposal-slot:
     `## Proposal` (or `## 人的裁定`) + `## Contract` + `## AC` + `## DoD`.
   Every section must clear **40 non-whitespace characters** (`MIN_SECTION_CHARS`,
   `ready-pool-check.ts`) — a heading followed by a placeholder word is not an artifact and fails
   the gate silently (`missing: [...]`) at the next promotion check, not at filing time. `## AC`
   MUST be a checklist of `- [ ]` items, each mechanically checkable (a command + exit code, or an
   equivalently mechanical grep/query — never a bare prose claim). `## DoD` states the
   real-landing bar (an object actually operated through the mechanism — artifacts/fixtures are
   necessary-not-sufficient, DIR-026 Reading A), not "tests exist."

4. **Write `## Touches`.** List the SPECIFIC files this task will touch — never a bare directory
   (a directory-level Touches asymmetrically locks concurrent work and fails the narrowness
   check downstream). Include:
   - the concrete source/script files the implementation will change,
   - the test file(s) that will cover it (a Touches list with no test file is incomplete),
   - **the task's own file** (`tasks/<id>.md`) — self-touch, otherwise the task's own status
     flip can't be attributed to itself.
   If the task adds a new shipped `plugin/scripts/*.ts`, also touch its capability-catalog entry
   and outline registration — a new script file trips three registration gates
   (outline + capability-catalog + laydown; see `plugin/scripts/capability-catalog.sh` header) —
   name all three in Touches, not just the script itself.

5. **Compute the id.** Default family is `gap-<kebab-slug>` (defect/optimization/execution
   tasks); use a different family ONLY when the workspace's own convention calls for one (e.g.
   `DIR-NNN` belongs to `quay-directive` — do not invent a directive under this skill). The slug
   is a short, mechanism-naming kebab-case phrase, not a generic restatement of the symptom
   (mirrors step 2's dedup discipline — a well-named id makes the NEXT dedup check cheaper).
   Confirm the candidate id doesn't already exist (`task_get <id>` → not-found, or
   `tasks/<id>.md` absent) before using it — id collision silently overwrites.

6. **Create the task.** `task_write` (MCP, preferred) with `id`, `title`, `status: todo`,
   `labels: [gap]` (add `defect` when it's a bug/regression; omit for pure optimization/spec
   work — match the label pattern of comparable recent tasks in this store), `extra: {schema:
   "execution"}` (the marker most `gap-*` tasks in this store carry; use `schema: "v1"` only when
   this task is itself a directive-flavored `contract`-shape task, matching `quay-directive`'s own
   marker), `body` = the shape-appropriate content from steps 3-4. Read it back (`task_get`) and
   show the result.

7. **Self-check BEFORE landing.** Run the shipped schema check and require exit 0:
   `node plugin/scripts/task-schema-check.ts tasks/<id>.md` (or, when installed as a plugin,
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/task-schema-check.ts" ...`). A FAIL means fix the task
   body, not the script. Then independently confirm shape-aware completeness the same way the
   promotion gate will — `node packages/quay/bin/quay.ts task check <id> --json` (the CLI-surfaced
   equivalent of `artifactsComplete()`/`detectShape()` in `plugin/scripts/ready-pool-check.ts`) —
   its `missing` must be `[]`. Do not commit on a non-empty `missing`.

8. **Land it — pick the host-appropriate path; both are real, don't default to one without
   checking.** How this skill is actually landed depends on how the invoking session is running,
   not on this workspace's layout — determine which of the two you are BEFORE writing anything:

   - **Isolated background session** (a spawned subagent, a `claude --bg` session, or any host
     that enforces a worktree-isolation guard — a direct `Edit`/`Write`/commit against the shared
     checkout is refused until you isolate). Isolate first: this host's own isolation tool if it
     has one, or a manual `git worktree add <path> -b <branch> <authoritative-branch>`. **Verify
     the base is actually fresh before trusting it — do not skip this.** A tool's default base can
     silently resolve to a stale ref (observed in practice: a default-base worktree landed 7837
     commits behind the workspace's authoritative branch). Confirm freshness explicitly —
     `git rev-list --count <base>..<authoritative-branch>` should be `0` (or you know why it
     isn't) — before doing any work in it; branch off the workspace's own authoritative branch by
     name (this store's `tasks_dir` resolution from step 1 tells you which branch that is) rather
     than accepting an unverified default. Do steps 1-7 in that isolated worktree, then merge the
     resulting commit back into the shared checkout's working branch (dry-run first —
     `git merge-tree <merge-base> <working-branch> <your-branch>` — to confirm no conflict, then
     `git merge --no-edit <your-branch>`), following whatever doc-branch↔authoritative-branch sync
     convention this workspace documents (if any) so the change reaches the real task store, not
     an orphaned local branch nobody reads.
   - **Unconstrained foreground/interactive session** whose working directory already IS the
     shared checkout, with no isolation guard in effect (a persistent driving session with direct
     write access to the working tree — this is how this workspace's own task-filing history
     actually lands this class of work: every sampled instance was a single-parent commit straight
     onto the checkout's current branch, with zero worktree or branch detours). Just commit
     directly there — no worktree needed, and forcing one adds ceremony a direct commit doesn't.

   Either way: scope the commit to ONLY the task file(s) this step authored (plus any
   capability-catalog/outline registration named in step 4) — `git add tasks/<id>.md ... && git
   commit -m "tasks: 立案 <id>（<one-line why>）"`, never `git add -A`. If the checkout/worktree has
   unrelated dirty files, leave them untouched.

## Notes

- **Not for directives.** A `label:directive` task (a recorded human ruling with a `DIR-NNN` id)
  goes through `quay-directive`, not this skill — that skill's id scheme, `extra.dirStatus`
  lifecycle, and Resolution-append convention are directive-specific and don't apply here.
- **Not for advancing an existing task.** If the task already exists at `todo`, use `author`
  (write/complete its artifacts) instead of re-filing. If it exists at any status and needs an
  authorized edit, use `quay-task-operator`.
- **Prefer verbatim over re-authoring.** When the requester already wrote the full task body,
  copy their content through steps 3-4's validation rather than rewriting it in your own words;
  only fix genuine gaps (a missing Touches self-touch, a section under the 40-char floor, an
  unresolved dedup hit) — do not editorialize content someone already approved upstream.
- **Do not invent content.** A bare title hint does not authorize fabricated Proposal/Finding
  text — if nothing substantive was discussed or handed to you, stop and say so (same rule as
  `quay-directive`).
