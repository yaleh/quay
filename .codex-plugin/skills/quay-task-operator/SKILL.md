---
name: quay-task-operator
description: "Bounded, HUMAN-AUTHORIZED interactive Quay task operator (Codex adoption Stage 1 / DIR-121). Reads, checks, and — only after explicit human authorization in the active conversation — creates/edits tasks in THIS workspace's provider-neutral Quay store through the Quay MCP tools (task_list/task_get/task_check/task_write) with a separately proven CLI fallback. Enforces a strict transaction: read + capability check, authorization, before-snapshot + semantic diff, expectedStatus CAS where applicable, freshness re-read, MCP write, MCP readback, task-schema check, CLI readback, scoped Git diff/commit. Grants NO autonomous lifecycle authority: it must not tick AC/DoD, close tasks, SELECT/execute milestones, launch workers, merge/ABSORB/schedule, or treat transcript/session evidence as authoritative state. Invoke explicitly (Codex: $quay-task-operator; Claude: /quay-task-operator) with the task id and the authorized action."
allowed-tools: Bash, Read, Write, Edit
---

# quay-task-operator

    read     :: TaskId → task_get + task_check + capability manifest      -- know the object + what this provider can do
    authorize:: ConversationContext × Mutation → HumanApproval            -- EXPLICIT, in the active conversation; never inferred (standing DIR-130 exception → "Authority boundary")
    transact :: TaskId × Mutation → write → readback → schema → commit   -- the disciplined round-trip below
    fallback :: McpUnavailable → quay CLI (list/get/check)                -- read-path stays operational; writes still need authorization

**This is a human-control-surface client, not an orchestrator.** It replaces the
human-facing terminal role for bounded Quay task administration only. It is the
runtime-neutral canonical contract that the `.agents/skills/quay-task-operator`
(Codex) surface resolves to; `.agents` packaging is a symlink, not a copy of this
policy (single-source, enforced by `scripts/agents-claude-drift-check.ts`).

## Authority boundary (read first)

May, after explicit human authorization: list, get, check, create, and edit tasks
in this workspace's active provider store, and commit ONLY the authorized task
artifact.

Standing authorization (DIR-130) — a bounded exception to per-write authorization, on a
reversible field face only:

- MAY act without per-write "yes", citing DIR-130 as credential: `labels` add/remove
  (incl. `delivery-critical`-class priority labels); `extra.*` field writes. Criterion:
  reversible — a wrong value is correctable and produces no irreversible lifecycle effect.
- ⚠️ `task_write.labels` **replaces the whole label set, not appends.** A `task_write` with
  `labels: ["delivery-critical"]` on a task that already carries `gap`/`defect`/`directive`
  **deletes** those existing labels. For "append one label, keep the rest" use the dedicated
  `task_add_label` MCP verb (`{ id, label }` — reads current labels, appends without
  duplicating) instead of hand-assembling a `labels` array from a `task_get`.
- STILL requires per-write explicit "yes" (standing authorization does NOT cover): any
  `status` flip (todo/ready/done/needs-human, either direction), writing `superseded`, task
  deletion, and AC/DoD checkbox ticking.
- Every standing-authorization write MUST cite the recorded directive DIR-130 as credential
  in the commit message; an uncited autonomous write remains illegal.

MUST NOT, autonomously or from transcript/session evidence:

<!-- PROHIBITED-AUTONOMOUS-ACTIONS: canonical list, mirrored verbatim in root AGENTS.md; scripts/agents-claude-drift-check.ts asserts the two blocks stay set-identical. Edit both together. -->
- no independent AC/DoD ticking
- no task close or completion
- no SELECT or execute milestone
- no worker launch
- no merge, ABSORB, or schedule continuation
- no treating transcript/session evidence as authoritative state
<!-- /PROHIBITED-AUTONOMOUS-ACTIONS -->

In particular "no task close or completion" means the operator never sets `status: done`
and never calls a lifecycle promotion on its own authority. A transcript-derived finding
may SUPPORT a human-authorized write; it never, by itself, authorizes the write, ticks a
box, or advances a lifecycle.

## The operator transaction (every mutation, in order)

1. **Read + capability check.** `task_get <id>` and `task_check <id>` through Quay
   MCP; read the provider manifest (`provider://manifest`) to confirm what the
   active provider can write (status vs. title/body/labels/parent/children). If the
   provider cannot write a requested field, STOP and say so — do not fake it.
2. **Explicit human authorization.** State the exact mutation (fields + new values)
   and wait for an explicit "yes" in the active conversation. No authorization → no
   write. Ambiguity is a "no".
3. **Before-snapshot + semantic diff.** Record the task's current content (a hash of
   the body + the `status`/`extra` fields) and show the human-visible semantic diff
   (old → new) BEFORE writing.
4. **`expectedStatus` where applicable.** For any write that touches `status` (or any
   lifecycle-relevant field), pass `expectedStatus` = the status read in step 1 (CAS).
   This refuses a stale-status write. **Honest limit:** this is NOT atomic same-status
   body CAS — two writers that both read the same status can still both write the body.
   Do not claim otherwise; if that guarantee is needed, it is a separate provider-neutral
   product task (e.g. an `expectedUpdatedAt`/content-hash ABI), not something this
   operator silently provides.
5. **Immediate freshness re-read.** Immediately before the write, `task_get <id>` again
   and confirm the snapshot from step 3 still matches. If it changed, STOP (fail closed)
   and re-present the diff.
6. **MCP write.** `task_write` with the authorized fields (+ `expectedStatus` from
   step 4). On `isError:true` (e.g. a CAS conflict), STOP — do not retry blindly.
7. **MCP readback.** `task_get <id>` and verify the written fields equal what was
   authorized. Mismatch → STOP and report.
8. **Task schema check.** Run the shipped canonical-task-schema check on the task file
   and require exit 0:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/task-schema-check.js <path-to-task-file>` (or, when installed as
   a plugin, `node "${CLAUDE_PLUGIN_ROOT}/scripts/dist/task-schema-check.js" ...`). A FAIL
   means fix the task body, not the script.
9. **CLI readback.** Independently read the SAME values through the CLI fallback —
   `node packages/quay/bin/quay.ts task view <id> --json` and
   `node packages/quay/bin/quay.ts task check <id> --json` — proving the MCP and CLI
   surfaces agree (provider-neutral, not an MCP-only artifact).
10. **Scoped Git diff + commit.** `git diff --name-only` must show ONLY the authorized
    task artifact (and authorized adapter/evidence files). Stage and commit ONLY those
    paths. If the worktree has unrelated dirty files, leave them untouched — never
    `git add -A`. A conflict or an unrelated dirty-file overlap with the intended commit
    path FAILS CLOSED (stop, ask the human).

## MCP-first, CLI-fallback

Prefer the Quay MCP tools (they exercise the same provider-neutral surface the product
dogfoods). If the project Quay MCP server is unavailable, degrade EXPLICITLY: report
"MCP unavailable — using CLI fallback," and use
`node packages/quay/bin/quay.ts task list/get/view/check ...` for the read path. The
read path (list/get/check) must remain operational without MCP. A write still requires
authorization and, via the CLI, `task edit --expect-status <read-status>` for the same
CAS discipline. Missing MCP is a degraded-but-working state, never a reason to skip
authorization or schema checks.

## Notes
- **Provider-qualified ids.** Quote ids as the active provider returns them; the native
  store uses `tasks/<id>.md`, other providers map differently.
- **No autonomous lifecycle.** This skill never calls `quay complete/promote/retreat`
  or sets `status: done` on its own authority; those are orchestrator/human decisions.
- **Conflict honesty over convenience.** When in doubt about concurrent writers, stop
  and surface it; this stage deliberately does not claim atomic body-write protection.
