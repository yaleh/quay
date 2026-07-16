---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: Broker-side agent.spawn servicing must actually use run_in_background=true (per caps-broker.md's own written spec) — foreground spawns block the broker from servicing concurrent cap-requests, and must be fixed before any multi-concurrent-nested-subagent capability can be validated
---

## Finding

While servicing iteration 80's live `cord` cap-request (id
`18c2c4000ef2f1b6`, DIR-022's trial) from the orchestrator's own top-level
turn, the orchestrator itself spawned the leaf agent with a plain,
foreground `Agent(description=..., prompt=...)` call — **no
`run_in_background=true`** — and waited synchronously (~4.8s) for it to
finish before calling `respond`.

This directly contradicts the broker protocol's own written
specification. `caps-broker.md` (manda-monitor skill reference,
"Role 2: caps broker", line 71) states explicitly:

> `agent.spawn` → apply the depth guard (below); if allowed,
> `Agent(run_in_background=true, prompt=args.prompt,
> subagent_type=args.subagent_type)`, ...

The orchestrator did not follow this. In this one instance it caused no
visible problem — a single request, serviced quickly, well inside the
caller's 90s deadline. But this is structurally the exact same class of
bug this experiment has already diagnosed and fixed twice before, in two
different locations:

- DIR-011/DIR-015: a session that dispatches its own iteration subagent
  in the foreground cannot service a concurrent `cap-requests-*` event
  for the dispatch's entire duration.
- DIR-016: the same gap, one dispatch call later in the same cycle (the
  G3 audit subagent dispatch), left open even after DIR-015 fixed the
  first instance.

This is now a **third** occurrence of the identical foreground-blocking
mistake, this time in the broker's own `agent.spawn` servicing step
itself — the one place where the fix already exists on paper
(`caps-broker.md` already specifies `run_in_background=true`), yet was
not actually followed in live practice. If a broker session ever
receives multiple concurrent `cap-requests-*` events (which is exactly
the scenario a future "multiple concurrent async nested subagent" trial
would need to exercise), a foreground spawn on the first request would
block the broker from noticing or servicing the second and third request
until the first's leaf agent completes — silently serializing what should
be concurrent, or timing out later requests entirely, without any
diagnostic signal beyond a generic cap-request timeout.

## Requested action

1. Any session acting as a manda broker (servicing `cap-requests-<name>`
   per `caps-broker.md`) must actually issue `agent.spawn` servicing calls
   with `run_in_background=true`, exactly as `caps-broker.md` already
   specifies — this directive does not change the spec, it requires
   actually following it, and requires this to be independently
   confirmable (cite the actual dispatch call's `run_in_background`
   argument value used, mirroring the existing orchestrator-scoped
   confirmation discipline DIR-015 action 2 / DIR-016 action 2 already
   established for the iteration- and audit-dispatch cases).
2. Before any directive or iteration claims to validate "multiple
   concurrent async nested subagent" capability, it must first confirm
   (and if necessary fix) that the broker side of the exchange spawns
   each serviced request in the background, not the foreground — a
   concurrency trial run against a foreground-spawning broker cannot
   distinguish "the mechanism doesn't support concurrency" from "the
   broker itself is serializing requests due to this known,
   already-specified-but-unfollowed fix." Conflating these two would
   produce a false negative about the mechanism's actual capability.
3. Once broker-side background spawning is confirmed, the next
   appropriate iteration (or a directly-instructed live trial in this
   conversation, at the human's discretion) should attempt a minimal,
   bounded trial of 2-3 concurrent async `Dispatch` calls against a
   single broker to observe and record whether they are serviced
   genuinely concurrently (overlapping leaf-agent lifetimes, not
   strictly sequential) or merely queued-and-serial even with background
   spawning — and record the `agent.spawn` depth/quota guard's behavior
   under this load (MAX_DEPTH=3, MAX_SPAWN=10 per `caps-broker.md`).
4. This is a correctness/reliability fix to existing, already-specified
   behavior, not new task/product work — do not claim V_instance/V_meta
   credit for applying it, consistent with this experiment's treatment of
   similar meta/process fixes.

<!-- ## Resolution: to be filled in by the iteration/session that applies this directive -->
