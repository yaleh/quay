# docs/plans/ — historical (classic milestone loop, retired)

All 66 files in this directory are per-milestone implementation plans written for the **classic
milestone loop** (`prepare-milestone.js` / `execute-milestone.js` / the `composite-*` phases /
`milestone-worktree.ts`), which was **retired by ADR-022** (2026-08-03) and physically deleted at
`gap-retire-the-prepare-execute-pipeline-cluster`. The two-layer fast mode described in the root
`CLAUDE.md` is the sole development mode since that date.

Nothing in this directory is current. It is kept in place, not archived to a new path, because
dozens of historical records cite it by exact path — `tasks/DIR-*.md`, `milestones/*/iterations/*.md`,
and `experiments/quay-perpetual-stream/charters/*.md` all link to specific files here (e.g.
`docs/plans/M226-dir-100-a.md`, `docs/plans/8-quay-gate-engine.md`). Moving the files would break
those citations for no operational benefit — see `CLAUDE.md`'s 硬规则5 (source completeness: a
deletion/move needs a landing map for every citation, or it shouldn't happen).

If you're looking for how quay is actually built today, see `orchestration/fast-mode-tick-core.md`
and the `orchestration/SPEC-*` files referenced from `CLAUDE.md`'s "每轮必经" table — not this
directory.
