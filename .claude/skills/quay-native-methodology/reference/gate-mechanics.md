# Gate mechanics — `task check` / `checkGate()`

Source: `packages/quay-native/src/store.js` (`check()`, `childrenStatus()`),
exposed via `quay-native task check <id>` (CLI) and the `task_check` MCP
tool (`mcp-server.js`), design reference `docs/proposals/quay-native-design.md`
§3 (status model), §6 (four symmetric surfaces).

## What it asserts

Two status transitions, both artifact-gated:

- `todo → ready` ("author" gate): passes only when Proposal, Plan, AC, and
  DoD sections are all present **and** every AC checkbox is checked. Note:
  an early version (through iteration 7) only checked AC checkbox
  *presence*, not checked-*state* — a task could reach `ready` with zero
  AC boxes actually checked. Found live by QN-017 (iteration 7, the first
  genuine `needs-human` exercise) and fixed in iteration 8 (QN-019) to
  require full-checked state, matching the execute gate's stricter
  behavior.
- `ready → done` ("execute" gate): passes only when AC is fully checked
  **and**, for compound (epic) tasks, every child is itself `done` —
  recursively, not just one level deep. An earlier version (iteration 6,
  QN-012) checked only immediate children's `status` field directly; a
  `done` child whose own grandchild had reverted could still be reported
  falsely `done`. Fixed in iteration 7 (QN-016): `childrenStatus()` is
  recursive, and a compound child whose own subtree is not fully done is
  reported as the distinct status `stale-done`, never silently collapsed
  into `done`. Cycle-safe (a cyclic children graph resolves to
  `missing`/`ok:false` rather than crashing or hanging).

## Why it is both contestant and judge (guardrail G3)

`task check` is simultaneously (a) a quay-native product feature and (b)
the experiment's own convergence oracle — if it is wrong, the feature and
the stopping rule are wrong together, self-certified. This is the exact
reason the out-of-band audit (see `g3-audit-discipline.md`) exists: until
a fixpoint reproduces, "did the gate decide correctly?" is never decided
by the gate's own green result alone.

## Three structurally distinct `needs-human` triggers (all mechanically exercised, not narrated)

1. `executeLeaf`'s own gate failure — a leaf task's AC is not fully
   satisfied (QN-017, iteration 7: a deliberately-unsatisfiable-by-
   construction AC item).
2. A compound task's child cannot reach `done`, so `driveEach` cannot
   complete (QN-020/QN-021, iteration 8).
3. All children reach `done`, but the epic's own integration acceptance
   (`runEpicLevelACAndDoD`) itself fails — the one previously-untested
   boolean combination `acOk: false, childrenOk: true` in `store.js`'s
   compound gate (QN-022/QN-023, iteration 9).

## Gameability boundary (explicitly acknowledged, not solved)

Fixing "checked vs. merely present" (iteration 8) closes a narrow
mechanical asymmetry only. The deeper gap — an author could check an AC
box without independent verification the underlying claim is actually
true — remains open by design: the gate is still both contestant and
judge for this class of claim. This is precisely why `quay:execute`'s
`self-audit-ac` Method step is explicitly documented as "necessary but
explicitly insufficient" on its own, and why the independent out-of-band
audit requirement is stated as mandatory, not advisory.

## Consuming-scope guidance

- Reuse the gate's artifact-completeness + checked-state + recursive-
  children-done logic as the reference shape for any new status-model
  gate; do not reintroduce the "presence not checked-state" or
  "one-level-deep children check" regressions this experiment already
  found and fixed.
- Never let a new gate become the sole arbiter of its own correctness —
  carry forward the out-of-band audit requirement (`g3-audit-discipline.md`)
  for any load-bearing status transition.
- If extending to a Core-level ABI (three-way CLI ⟷ Core MCP ⟷ Web UI, per
  the v2 proposal's instance objective item 1), treat this file's four-
  surface symmetry precedent (list/get/write/check) as the pattern to
  replicate one layer up, not a Provider-only concern.
