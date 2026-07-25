---
name: execute
description: Use when driving a task at status `ready` toward `done` — implements the plan, self-audits against AC/DoD, and asserts the `ready -> done` gate via `quay task check`. Takes the epic branch (drive children to done, then integration-accept) when the task's derived role is `compound`. Invoke with a task id and, optionally, a provider id (default `native`).
status: exercised
σ: 0.40
last_exercise: iteration-27
---

# quay:execute

λ(taskId: TaskId, provider: ProviderId = "native") → ExecutionOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `ready` status.
Corresponds to the `execute` operation in the status model (design §3):
`ready → done ⟺ AC satisfied ∧ DoD passed (integration acceptance for epics)`.

## Spec

```
ExecutionOutcome = Done | NeedsHuman(reason: String)

executeTask :: (TaskId, ProviderId) → ExecutionOutcome
executeTask(id, provider) = {
  task:    quay task view <id> --provider <provider> --json,
  assert:  task.status == "ready",
  role:    task.role,   -- DERIVED (design §2): children non-empty => compound
  return:  case role of
    "primitive" → executeLeaf(task, provider)
    "compound"  → executeEpic(task, provider)
}

-- Leaf path: implement the plan's Phases, TDD-style (borrowed discipline
-- from the seed's primitive-executor, scoped to quay-native's own tooling —
-- no epicd CLI calls).
executeLeaf :: (Task, ProviderId) → ExecutionOutcome
executeLeaf(task, provider) = {
  forEachPhase: implementPhaseRedGreen(task),   -- write/adjust tests, make them pass
  selfAudit:    reRunAC(task),                  -- check AC boxes only when actually verified true
  gate:         quay task check <id> --provider <provider>,
  return: case gate.ok of
    True  → { quay task edit <id> --status done --provider <provider> ; Done }
    False → NeedsHuman(gate.reason)
}

-- Compound (epic) path: design §4's execution process.
executeEpic :: (Task, ProviderId) → ExecutionOutcome
executeEpic(task, provider) = {
  ensureChildrenExist: task.children,           -- created at authoring or now, on a late split
  driveEach:  [ driveChildToDone(c, provider) | c <- task.children ],  -- recursive: todo->author->ready->execute->done
  integrationAccept: runEpicLevelACAndDoD(task),
  return: case integrationAccept of
    Pass → { quay task edit <id> --status done --provider <provider> ; Done }
    Fail → NeedsHuman("integration acceptance failed")
}
```

## Method — named steps, each with a stated environment-capability requirement and a degraded fallback (mirrors quay:author's QN-003 structure; leaf path only — epic path untested at v0)

1. **`implement-phase`** — `quay task view <id> --provider <provider>
   --json`; for each Plan phase, write/adjust tests first, confirm they
   fail for the expected reason, then implement the minimum change to pass
   (Red/Green, borrowed from the seed's `primitive-executor` discipline).
   - *Dispatch-capable target:* own fresh-context subagent per phase.
   - *Degraded fallback:* same-session sequential implementation (this
     environment's current mode — no subagent-dispatch primitive found, per
     `quay:author`'s QN-003 finding, which applies equally here).
   - **Negative/error-path sub-check (added iteration 61, generalizing a
     pattern discovered across iterations 58-60 — QN-062/063/064):** before
     treating a Plan phase's happy-path test as sufficient, explicitly ask
     whether the phase's target code has an **untested failure mode** at
     any of these three, now-repeatedly-demonstrated distinct points, and
     close it if genuinely open (do not manufacture one if the phase has
     none):
     1. **connection/startup failure** — does the call path correctly
        propagate a failure to *start* or *connect* to the thing being
        driven (a crashing subprocess, an unreachable Provider), rather
        than hanging or crashing the host process? (QN-062: a malformed
        `QUAY_GITHUB_REPO` causing `resolveRepo()` to throw, verified
        through both Core CLI's eager-connect and Core MCP's lazy-connect
        paths.)
     2. **malformed/absent input shape** — does the call path handle a
        real-but-degenerate data shape from an external source (`null`/
        `undefined` where a string is expected, an empty collection),
        distinct from every existing fixture, without crashing? (QN-063:
        `null`/`undefined` GitHub issue `body`, previously only exercised
        via an empty-string stand-in.)
     3. **live mid-session failure** — does the call path correctly
        surface a failure that occurs *after* a successful connection, in
        the middle of an otherwise-successful session (a live upstream
        call failing partway through), without crashing the host process
        or silently swallowing the failure? (QN-064: a live `gh api` 404
        from inside `fetchAllIssues()`, occurring after a successful
        Provider connect.)
     This sub-check is a **documented consequence of real, independently-
     justified work already performed** (iterations 58-60 each found and
     closed a genuinely distinct instance of this category by first
     grepping `experiments/quay-native-bootstrap/provenance.md`/the target source for prior
     coverage) — it is written here so a future `implement-phase` pass
     treats this as a standing consideration for *any* Plan phase touching
     an external boundary (a Provider subprocess, a network call, a
     parsed external data shape), not as three now-closed, one-off tasks.
     It does **not** mandate manufacturing a negative-path test where none
     is genuinely open (G5) — only that the question be asked and the
     answer (open/already-covered/not-applicable) be recorded, the same
     discipline `self-audit-ac` already requires for AC checkboxes.
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
     `experiments/quay-native-bootstrap/audits/iteration-N-adjudicate.md` for the mechanism this
     experiment currently uses to satisfy that requirement. Do not treat a
     green `self-audit-ac` + green `gate-check` as sufficient proof of
     correctness on its own (G3/G4).
3. **`gate-check`** — run `quay task check <id> --provider <provider>
   --json`. If `ok: true`, run `quay task edit <id> --status done
   --provider <provider>`. If `ok: false`, do not force it — report the
   gate's `reason` (e.g. "N/M AC checkboxes checked") and leave the task at
   `ready` for another pass, or route to `needs-human` if a genuine blocker
   (not an implementation-layer gap) is found.

## Gaps (honestly declared)

- **No unconditional subagent-dispatch primitive exists in this environment.**
  The `mcp__plugin_manda_manda__Agent` tool provides a conditional
  manda-proxied Agent (confirmed live: experiment 2, iterations 4-6), but it
  requires a live daemon (`.manda/hub.addr` reachable) AND a non-self broker
  armed on the target channel (DIR-020). A reliable, unconditional native
  fresh-context spawn — what this Skill's `self-audit-ac` independence
  contract actually needs — does not exist. The degraded, same-session
  fallback remains this Skill's actual operating mode.

- **No independent adjudicate-style audit is built into this Skill itself.**
  Design §5's "review independence (no self-certification)" contract for
  execution is not enforced by tooling; it currently relies on a separate,
  explicitly-invoked audit pass (G3's out-of-band adjudicate), not on
  anything this Skill enforces mechanically. The `ready->done` gate
  transition produced by this Skill is provisional until a genuinely
  separate (fresh-context) adjudicate-style check co-signs it.

- **Not yet dispatched via manda in a background worker by this Skill
  itself.** Dispatch binding is currently the host's job (`quay action
  run`); this Skill is invoked directly inside whatever session receives
  that trigger.
