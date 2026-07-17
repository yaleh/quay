# DIR-006

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Make directives first-class quay tasks (single source of truth); one-time clean cutover for experiment 4 — migrate DIR-004/DIR-005 into directive-tasks and delete the files

## Finding

In this live conversation the human decided that steering directives should
be tracked as `quay` tasks (dogfooding the self-hosted task-tracking
mechanism, protocol §5.1), in the most restrained form possible and with
**no transitional dual-representation** — explicitly citing recent projects
(`manda`, `epicd`) where maintaining the same record in two forms caused
drift/redundancy problems.

Grounding investigation of the actual code established the write-path
capability matrix (not assumption):

| Write path | create? | title/body/labels? | status? | provider-agnostic? |
|---|---|---|---|---|
| `quay` Core CLI `task edit` (`packages/quay/bin/quay.js:152-170`) | no | no | yes only | yes |
| `quay` Core CLI `task create` | command does not exist | — | — | — |
| `quay-native` CLI `task create/edit` (`packages/quay-native/bin/quay-native.js:115-177`) | yes | yes | yes | **no — binds the native backend** |
| MCP `task_write` (`packages/quay-native/src/mcp-server.js:80-100`) | yes | yes (title/body/labels/parent/status) | yes | yes |

Key facts:
- The provider-agnostic Core CLI is deliberately **status-only for writes**
  ("v1 supports status-only writes", `bin/quay.js:159-168`) and has **no
  `task create`**. It cannot write a task body or labels, so it cannot, by
  itself, create a directive-task or write a Resolution section.
- Full-fidelity, provider-agnostic task creation today goes through the MCP
  `task_write` tool — exactly what iteration 0 already used to create QX-001.
- The Web UI **already filters by label** (QW-005, `serve.js:302-305`), and
  the CLI `task list` already supports `--label` and `--prefix`
  (`bin/quay.js:79,116`). So "see directives alongside other tasks and
  filter them" needs **no new UI or CLI query code** — only a labeling
  convention (`label: directive`).
- The human accepted that carrying the directive's sections (Finding /
  Requested action / Resolution) inside a task's markdown **body** is fine
  — the body is plain markdown and the UI does not special-case it.
- The native store already provides atomic/CAS writes (`store.js:60`
  exclusive-create `wx` + retry; `expectedStatus` CAS; append-note primitive
  `store.js:281-293`), which are a *stronger* concurrency guard than the
  skill's current manual `git status` safety-check dance over the
  `directives/` tree.

Conclusion: the redundancy-free end state is **the directive IS a task**
(single source of truth in the task store), not a task plus a file. The only
real risk is the *transition*, which the human wants done as a single clean
cutover with zero dual-write window.

This directive records that decision and its one-time migration. It does NOT
couple itself to closing the Core-CLI write-parity gap (see Requested action
item 5) — that is a separate, independently-motivated capability gap.

## Requested action

1. **Adopt "directive = task" as the single source of truth** for
   experiment 4 going forward. A directive is a normal task in the native
   task store with:
   - `label: directive` (enables the existing Web UI `?label=directive` and
     CLI `--label directive` filtering with zero new query code),
   - lifecycle carried in the task `status` (define and record the mapping,
     e.g. `todo` = pending, `done` = applied, plus an explicit
     `needs-human`/rejected convention),
   - the DIR-NNN identifier and the `Finding` / `Requested action` /
     `Resolution` sections carried in the task **body** (plain markdown),
   - the DIR-NNN number preserved as a body header and/or title convention
     (the task's own store id may differ, e.g. a `QX-*`/`directive`-labeled
     id — record the chosen id convention).
   There is to be **no** `directives/pending|archive/` file created for any
   NEW directive after cutover.

2. **One-time clean cutover, decided by the human: option (a) migrate +
   delete.** In a single iteration, at a single commit:
   - Create directive-tasks (via MCP `task_write`) faithfully carrying the
     full content of the two currently-pending experiment-4 directives —
     **DIR-004** (Node SEA/Bun packaging + GitHub Actions) and **DIR-005**
     (land action buttons end-to-end / README screenshots / serve-G7).
   - **Delete** `experiments/quay-continuous-bootstrap/directives/pending/DIR-004-*.md`
     and `DIR-005-*.md` in the same commit (their content now lives only in
     the tasks — leaving the files would be exactly the dual-copy being
     eliminated). Their prior existence remains recoverable via git history,
     which is the audit trail.
   - Do **not** create any parallel/second copy. The moment both a file and
     a task exist for the same directive, the cutover has failed.

3. **The `quay-directive` skill flips atomically at the same cutover
   commit.** After cutover the skill creates a directive-**task** (via
   `task_write` short-term — see item 5) and **must not also write a
   `DIR-NNN.md` file**. Update the skill's own steps accordingly:
   - replace "compute next id from `directives/*/DIR-*.md`" with the chosen
     directive-task id/numbering convention,
   - replace the `git status` safety-check over `directives/` with reliance
     on the store's atomic/CAS write (record this substitution explicitly),
   - keep the "draft from the conversation, human confirms before it lands"
     discipline unchanged.

4. **Legacy is frozen, never migrated.** Directives of the three closed
   experiments (`quay-native-bootstrap`, `quay-core-bootstrap`,
   `quay-webui-bootstrap`) and any experiment-4 directive already resolved
   before cutover are **frozen historical audit artifacts** — left exactly
   as-is in their existing files, explicitly labeled "pre-task legacy form,"
   and never dual-maintained. Do not retroactively convert them.

5. **Do NOT couple this to the Core-CLI write-parity gap.** File, as its own
   separate gap-list entry (not a requirement of this directive), the fact
   that the provider-agnostic Core CLI cannot create tasks or write
   body/labels (`bin/quay.js:152-170`), unlike the MCP `task_write` tool and
   the Web UI — an `capability_breadth`/abi-symmetry gap worth closing on its
   own merits (a `quay task create` + body-passthrough on `task edit`, which
   the underlying `store.write`/`task_write` already support). The
   `quay-directive` skill uses MCP `task_write` in the meantime; **only once
   that CLI gap is closed on its own** should the skill migrate to a portable
   `quay task create` invocation. This directive must not be blocked on it.

6. **This directive's own disposition.** DIR-006 is a one-time
   process/cutover decision, not ongoing steering. On application, archive
   it normally to `directives/archive/` (with its Resolution recorded) as the
   frozen historical record of the cutover — it is NOT itself migrated into a
   task. After application, `directives/pending/` is empty and every NEW
   directive is a task.

7. **Scope / attribution.** This is process/infrastructure + a small amount
   of `capability_breadth` (the labeling/lifecycle convention) — it does not
   by itself move `usability_quality`, `verification_coverage`, or
   `system_health`. Any code touched under `packages/quay` (e.g. if the
   separate CLI-parity gap is picked up) requires the standard independent G3
   adjudicate dispatch. Adding a directive-task must go through the same
   `task_write` path iteration 0 already exercises — no backend-specific
   (`quay-native` CLI) shortcut.

8. Record the resolution of this directive (applied/deferred/rejected, with
   evidence — including the chosen status→lifecycle mapping, the directive-
   task id convention, and confirmation that DIR-004/DIR-005 files were
   deleted and no dual copy remains) in whichever iteration first acts on it.

## Resolution
<!-- to be filled in by whichever iteration applies it -->
