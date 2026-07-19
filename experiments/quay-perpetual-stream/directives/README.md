# directives/ — RETIRED (directives are now TASK-CANONICAL)

**As of DIR-028 / Plan A (2026-07-19), a directive is a quay TASK and nothing else.** There are no
`DIR-NNN.md` files here anymore — the `pending/` and `archive/` directories are gone, and so are the
`it0-dir-projection-check` / `it0-dir-task-project` scripts. A directive lives ONLY as a
`label:directive` quay task (`tasks/DIR-NNN.md` in the native store, git-tracked), which is the
single source of truth. This removed the dual-source (file + projected task) design that DIR-002/M05
introduced and that repeatedly drifted (the task copies silently diverged from the files — the exact
disease Plan A cured).

- **Create / steer:** `/quay-directive` (creates the directive task directly — see
  `.claude/skills/quay-directive/SKILL.md`).
- **List:** `task_list --label directive` (or the Web UI `?label=directive`).
- **Lifecycle:** `extra.dirStatus` on the task (`pending | applied | deferred | rejected`) — not a
  directory. Resolution is appended to the task body when a milestone resolves it.
- **Rationale:** `docs/proposals/exp5-crystallization-strategy.md` (Axis 1), and the DIR-028 task.

This file is the only thing left in `directives/`; it exists so anyone who looks here is redirected
to the task store.
