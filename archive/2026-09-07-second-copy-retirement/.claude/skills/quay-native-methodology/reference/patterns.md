# Patterns — quay-native bootstrap methodology (as of iteration 88, HALTED NOT CONVERGED)

Source: `experiments/quay-native-bootstrap/` (protocol `docs/proposals/quay-bootstrap-experiment.md`).
This file documents the mechanics that produced the numbers below — not a
claim those mechanics are proven sufficient (they demonstrably plateaued;
see `v-meta-stall-analysis.md`).

## Final state (iteration 88, the last iteration before extraction)

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
           = 0.85 × 0.97 × 0.76 × 0.96 = 0.6016

V_meta     = completeness × effectiveness × reusability × validation
           = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973   (unchanged since
             iteration 66 — 22+ consecutive iterations exact zero movement)

σ_strict   = 62 / 73 = 0.8493  (down from 0.8611 the prior iteration —
             mechanical decrease from adding a seed-provenance task
             without a matching native-provenance numerator)
```

None of protocol §7's 5 convergence criteria hold:
1. Dual threshold (both ≥ 0.80) — NO, V_meta an order of magnitude short.
2. Self-hosting fixpoint (σ→1) — NO, σ_strict = 0.8493, and even trending
   down mechanically at the end.
3. Contract proven (native + GitHub Provider both run) — partially true
   but insufficient alone.
4. Out-of-band audit passed — iteration 88's own audit was pending
   dispatch at extraction time (each iteration's own audit is dispatched
   separately by the orchestrator, never self-performed).
5. Diminishing returns (ΔV < 0.02 for 2+ iterations) — NO, V_instance
   moved for 3 consecutive iterations (86, 87, 88).

## σ (self-hosting fraction) mechanics

- Per-task provenance triple `{author_by, execute_by, gate_by} ∈ {seed, native}`,
  recorded in `provenance.md`, never asserted from memory.
- σ_strict = (tasks with all three = native) / (total tasks), with a
  **permanent strict-exclusion set** of 3 tasks (QN-003, QN-004, QN-006)
  that are excluded from the numerator regardless of `status`, for
  documented structural reasons (QN-006 is the σ=0 floor task; QN-003/004
  had their "execute" work actually done during the authoring pass, not as
  a genuinely separate step). This exclusion set is the single canonical
  place such nuances are recorded — do not re-derive it per task.
- σ can and did **decrease** mechanically and honestly late in the
  experiment (adding seed-provenance test-coverage tasks without a
  matching native numerator increment) — this is expected, not a bug in
  the ledger.
- The last task with genuine `{native, native, native}` provenance was
  QN-070 (iteration 69). Every `skeleton` movement after that (iterations
  76, 86, 87, 88) was performed directly by the iteration-executor session
  (`{seed, seed, seed}`) — ad hoc test-infrastructure closure work, not
  Skill-driven. This is a concrete, checkable fact a consuming experiment
  should not paper over.

## V_instance factor mechanics

- `skeleton`: the v0 loop end-to-end (config → mcp → serve → action →
  Skill → done). Held at 0.85; its specific discovery vein
  (`check()`/`checkGate()` branch passthrough-fidelity, the source of
  iterations 66/69/76/86/87's movements) was declared **exhausted** by
  iteration 87's exhaustive branch enumeration — a stronger claim than
  "not searched," because the enumeration was actually performed and
  audited.
- `abi_symmetry`: CLI/MCP schema and error-shape equivalence
  (`abi-symmetry.mjs`, 5 checks as of iteration 88: task_list, task_get,
  task_write key+value equivalence, task_check, and the newly-added
  task_write CAS-conflict error-shape symmetry, QN-074). Held flat at
  0.96 for 52+ iterations (36-87) then moved to 0.97 at iteration 88 —
  demonstrating that "old and flat" is not itself evidence of exhaustion;
  a factor can go unsearched for dozens of iterations and still have real
  headroom on the first rigorous fresh pass. Declined/unexplored leads at
  extraction time: `task_list` filter-value equivalence, and
  non-existent-id error-reporting-mode asymmetry between CLI (`console.error`
  + exit code, no JSON shape) and MCP (`isError: true` JSON) — noted as
  a structural asymmetry in reporting *mode*, not a schema mismatch, so
  not pursued as a gap.
- `gate_correctness`: `quay task check` correctly asserting the
  `todo→ready`/`ready→done` gates, including compound/epic recursive
  children-done checks. Independently ceilinged since iteration 20 (68+
  iterations unaffected by later work) — the longest-standing ceiling of
  the four factors.
- `skill_convergence`: `quay:author`/`quay:execute` driving real tasks to
  a green gate within bounded rounds. Never moved once in 87 iterations
  (set at iterations 0-7, still 0.96 at iteration 88) — the single
  least-touched V_instance factor. Reason at extraction time: the live
  backlog's only non-`done` tasks (1 `todo`, 3 `needs-human`) are
  permanent, deliberately-adversarial fixtures already fully exercised;
  there is no fresh, non-adversarial task-level material to drive through
  the Skills. This is a backlog-shape fact, not a demonstrated
  architectural ceiling — a genuine new feature requiring authoring would
  be the natural way to generate fresh evidence.

## Layer-1 / Layer-2 Skill structure (as actually built, not as originally planned)

`quay-native-design.md` §5 specifies Layer-1 operation Skills
(`write-proposal`, `review-proposal`, `write-plan`, `review-plan`,
`implement`, `adjudicate`), each meant to run in its own fresh-context
subagent for review independence, plus Layer-2 orchestration Skills
(`quay:author`, `quay:execute`) that invoke them. **In practice, only the
two Layer-2 Skills were ever materialized as files**
(`packages/quay-native/skills/{author,execute}/SKILL.md`); the Layer-1
steps exist as named Method steps inside those files, each with an
explicit "Dispatch-capable target" (what should happen if a subagent
primitive exists) and "Degraded fallback" (what actually happened: same-
session sequential execution with a checklist standing in for reviewer
independence). This split never converged in practice because, for most
of the experiment's life, `ToolSearch` confirmed **no subagent-dispatch
primitive existed** in the source environment (iterations 1 through the
high-70s, reconfirmed nearly every iteration). Iterations 78-87 later
found an async manda nested-subagent dispatch path that *did* work, but
only under a strict hard rule (§0b: depth-1 caller must itself be a
background subagent, never synchronous same-session-as-broker) — this
was treated as `completeness`-adjacent staleness in the Skill files'
"Gaps" sections, not as a `skill_convergence` event, and no SKILL.md
credit was claimed for it as of iteration 88.

**Consuming-scope implication**: do not assume a cleaner Layer-1/Layer-2
split is "the real design, just not yet built" — treat the inline,
degraded-fallback structure as the actual proven artifact, and re-verify
any subagent-dispatch assumption live before building on top of it.

## Gate mechanics summary

See `gate-mechanics.md` for detail. Key points: `check()` is both a
quay-native product feature and the experiment's own convergence oracle
(guardrail G3) — this is why it is never allowed to self-certify; an
out-of-band audit co-signs every σ lift.

## Directive lifecycle summary

See `directive-lifecycle.md` for detail. Directives are a third artifact
class orthogonal to `provenance.md` (output/state) and `audits/`
(verification of output): external steering input, pending → archive,
one-time consumed, never silently dropped.

## G3 out-of-band audit discipline summary

See `g3-audit-discipline.md` for detail, including the concrete,
documented history of 3 overclaim attempts (iterations 29, 59, 61) each
independently caught and reverted by this discipline — direct evidence
the guardrail functions, not just theory.
