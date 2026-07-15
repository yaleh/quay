---
name: quay:execute
description: Use when driving a quay-native task at status `ready` toward `done` — implements the plan, self-audits against AC/DoD, and asserts the `ready -> done` gate via `quay-native task check`. Takes the epic branch (drive children to done, then integration-accept) when the task's derived role is `compound`. Invoke with a task id.
---

# quay:execute

λ(taskId: TaskId) → ExecutionOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `ready` status.
Corresponds to the `execute` operation in the status model (design §3):
`ready → done ⟺ AC satisfied ∧ DoD passed (integration acceptance for epics)`.

**Honesty note (iteration 1):** still **not yet used** to drive any task —
per the fixed per-Skill retirement order (protocol §10.2), iteration 1's
scope was authoring-side only (`quay:author` — see QN-001/QN-003/QN-004/
QN-005 in `experiment/provenance.md`). QN-006 (iteration 0's one task-to-
`done`) and any task driven to `done` since remain seed-executed. This
Skill's own authoring task (QN-004) was driven to `ready` by `quay:author`
in iteration 1 — that only means the *plan* to retire this Skill's seed
dependency now exists; the Skill itself remains unexercised. σ for
`quay:execute` remains 0 until a later iteration actually dispatches it and
records `execute_by: native`. Iteration 1 also confirmed (via `quay:author`'s
own exercise) that **this environment has no subagent-dispatch primitive**
— the same finding applies here, and is reflected in the Method/Gaps below.

## Spec

```
ExecutionOutcome = Done | NeedsHuman(reason: String)

executeTask :: TaskId → ExecutionOutcome
executeTask(id) = {
  task:    quay-native task get <id> --json,
  assert:  task.status == "ready",
  role:    task.role,   -- DERIVED (design §2): children non-empty => compound
  return:  case role of
    "primitive" → executeLeaf(task)
    "compound"  → executeEpic(task)
}

-- Leaf path: implement the plan's Phases, TDD-style (borrowed discipline
-- from the seed's primitive-executor, scoped to quay-native's own tooling —
-- no epicd CLI calls).
executeLeaf :: Task → ExecutionOutcome
executeLeaf(task) = {
  forEachPhase: implementPhaseRedGreen(task),   -- write/adjust tests, make them pass
  selfAudit:    reRunAC(task),                  -- check AC boxes only when actually verified true
  gate:         quay-native task check <id>,
  return: case gate.ok of
    True  → { quay-native task edit <id> --status done ; Done }
    False → NeedsHuman(gate.reason)
}

-- Compound (epic) path: design §4's execution process.
executeEpic :: Task → ExecutionOutcome
executeEpic(task) = {
  ensureChildrenExist: task.children,           -- created at authoring or now, on a late split
  driveEach:  [ driveChildToDone(c) | c <- task.children ],  -- recursive: todo->author->ready->execute->done
  integrationAccept: runEpicLevelACAndDoD(task),
  return: case integrationAccept of
    Pass → { quay-native task edit <id> --status done ; Done }
    Fail → NeedsHuman("integration acceptance failed")
}
```

## Method — named steps, each with a stated environment-capability requirement and a degraded fallback (mirrors quay:author's QN-003 structure; leaf path only — epic path untested at v0)

1. **`implement-phase`** — `quay-native task get <id> --json`; for each Plan
   phase, write/adjust tests first, confirm they fail for the expected
   reason, then implement the minimum change to pass (Red/Green, borrowed
   from the seed's `primitive-executor` discipline).
   - *Dispatch-capable target:* own fresh-context subagent per phase.
   - *Degraded fallback:* same-session sequential implementation (this
     environment's current mode — no subagent-dispatch primitive found, per
     `quay:author`'s QN-003 finding, which applies equally here).
2. **`self-audit-ac`** — check off `## AC` checkboxes **only when
   independently re-verified true** against the actual code/tests — never
   because "it should work."
   - *Dispatch-capable target:* an independent subagent re-runs
     tests/diff-review before checkboxes are trusted.
   - *Degraded fallback:* same-session re-run of the actual test suite
     (not trusting a prior "it passed" claim), matching iteration 0's
     QN-006 execution discipline.
   - **Independent-audit requirement (not optional):** this self-audit step
     is a **necessary but explicitly insufficient** substitute for G3's
     out-of-band audit. The `ready->done` gate transition produced by this
     Skill is **provisional** until a genuinely separate (fresh-context)
     adjudicate-style check co-signs it — see
     `experiment/audits/iteration-N-adjudicate.md` for the mechanism this
     experiment currently uses to satisfy that requirement. Do not treat a
     green `self-audit-ac` + green `gate-check` as sufficient proof of
     correctness on its own (G3/G4).
3. **`gate-check`** — run `quay-native task check <id> --json`. If `ok:
   true`, run `quay-native task edit <id> --status done`. If `ok: false`, do
   not force it — report the gate's `reason` (e.g. "N/M AC checkboxes
   checked") and leave the task at `ready` for another pass, or route to
   `needs-human` if a genuine blocker (not an implementation-layer gap) is
   found.

## Gaps (honestly declared)

- **No subagent-dispatch primitive exists in this environment** (same
  finding as `quay:author`'s QN-003 — confirmed via an explicit tool check,
  not assumed). The `self-audit-ac` step above therefore cannot achieve true
  reviewer independence on its own; this is exactly why the independent-audit
  requirement in step 2 is stated as mandatory, not advisory.
- No independent adjudicate-style audit is built into this Skill itself yet
  — design §5's "review independence (no self-certification)" contract for
  execution is not enforced by tooling; it currently relies on a separate,
  explicitly-invoked audit pass (as iteration 0's
  `experiment/audits/iteration-0-adjudicate.md` and iteration 1's
  `experiment/audits/iteration-1-adjudicate.md` do), not on anything this
  Skill enforces mechanically.
- The epic/compound branch (`executeEpic`) is unexercised — no compound task
  has been driven through this Skill yet (or through the seed either). This
  is untested code-as-documentation, not a validated path.
- Not yet dispatched via manda in a background worker by this Skill itself
  (see quay:author's same gap note — dispatch binding is currently the
  host's job).
- **This Skill itself remains entirely unexercised as of iteration 1** — its
  own authoring task (QN-004) was driven to `ready`, but that is a plan for
  retiring its seed dependency, not the retirement itself. `execute_by` is
  `seed` for every task in `experiment/provenance.md` as of iteration 1.
