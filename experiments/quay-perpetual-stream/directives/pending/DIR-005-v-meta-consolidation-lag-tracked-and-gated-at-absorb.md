# DIR-005

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: V_meta consolidation lag — the inner loop's build+verify specialization defers V_meta absorption indefinitely; make the inner→outer hand-off tracked, alarmed, and gated at ABSORB (do NOT re-fuse exploration into the inner loop)

## Finding

Analyzing the inner-loop development process (why every milestone m1–m4 ran
exactly 2 inner iterations) surfaced a structural cost that is NOT a V_instance
problem and is currently invisible to every existing health track.

exp5 has refactored the two-layer BAIME relative to exp1–4. In exp1–4 a single
iteration stream FUSED exploration and execution — many iterations (10–33),
each carrying a bit of both V_instance and V_meta, converging both slowly but
with **no V_meta absorption lag** (methodology insight was consolidated in the
same stream that produced it). exp5 SEPARATED them:

- **inner loop = build + independent-verify** (2 iterations): a specialized,
  near-deterministic EXECUTION pipeline delivering V_instance. iteration-0 lands
  all Done-when; iteration-1 independently re-derives. There is no exploration
  left inside to justify a 3rd iteration — the milestone was sized (DIR-004) so
  iteration-0 can land it whole. "2 iterations" is a structural consequence, not
  a coincidence (m1 is the honest exception: genuine unforeseeable execution
  uncertainty — cross-platform CI failures — made its iteration-1 real build
  work, correctly exceeding the build+verify template).
- **outer loop = exploration / V_meta convergence** (perpetual, milestone-grained):
  where the hard judgments now live (sizing, value-typing — DIR-001/002/004).

This separation is a genuine achievement (the inner loop is fast and reliable),
and it should be PRESERVED — the fix here must NOT push exploration back into the
inner loop (e.g. adding a "reflection iteration"), which would re-fuse the two
things exp5 cleanly split and slow the inner loop back down.

The cost of the separation is a **V_meta absorption lag**: methodology insights
discovered INSIDE a milestone are logged as "adaptation candidates" and handed
to a later outer consolidation that is **unmeasured, undated, and can be deferred
indefinitely**. Three concrete instances are already outstanding in `dashboard.md`:
1. m1's `domain-audit-channel ≡ CI-job` pattern + per-subcommand audit exercise —
   "logged but NOT yet consolidated".
2. φ fold-back: the `CI-job ≡ audit-channel` pattern has CROSSED the §4.2
   confirmation threshold (2 cross-domain confirmations: m1 packaging, m3
   cross-provider) yet "consolidation into inherited-core.md's confirmed-pattern
   section [is] still pending, not yet done".
3. m3's repo-root isolation-leak lesson — "noted for a future consolidation pass,
   not applied this milestone".

Nothing tracks the total outstanding V_meta debt, nothing alarms when a
CONFIRMED insight ages without consolidation, and each ABSORB is free to say
"consolidate later" with no cost — so the debt silently accumulates. This is the
same class of failure as DIR-002/DIR-006: an invariant ("confirmed insights get
folded into inherited-core.md") with no mechanical enforcement.

## Requested action

Fix the inner→outer HAND-OFF (not the inner loop). Make V_meta consolidation
tracked, alarmed, and gated at the ABSORB boundary. Suggested milestone id
`M-VMETA-GATE` (methodology-infrastructure, explore) — or fold into the next
methodology-infra milestone if one is selected first. Three mechanisms + one
proof:

1. **Tracked ledger.** Replace the prose "adaptation candidate / φ pending"
   mentions with an explicit ledger (in `dashboard.md` or a sibling file), one
   row per insight: `insight | origin milestone | confirmation count | status
   {proposed | confirmed | consolidated}`. Migrate the 3 known outstanding items
   above into it as the initial contents.

2. **Health track + alarm.** Add a `V_meta consolidation lag` health track,
   symmetric to the existing discovery-latency track: for any insight that has
   crossed the φ confirmation threshold (2 cross-domain confirmations) but is not
   yet `consolidated`, count milestones-since-confirmed; **alarm at > 2
   milestones** (K=2, consistent with the plateau/other thresholds).

3. **ABSORB gate.** In `OUTER-LOOP.md`'s ABSORB step: a milestone may NOT be
   marked DONE / increment `milestone_counter` while any `confirmed`-but-not-
   `consolidated` insight is past the alarm threshold. Resolve by EITHER
   consolidating it into `inherited-core.md` at this ABSORB, OR recording an
   explicit, DATED carry-forward reason (no silent deferral).

4. **First proof (the gate must actually bite).** The `CI-job ≡ audit-channel`
   pattern (item 2 above) is ALREADY past threshold (confirmed m1 + m3, now m6
   complete). The next ABSORB after this directive must EITHER consolidate it
   into `inherited-core.md` (pasted diff) OR record the new dated carry-forward
   reason — demonstrating the gate fires on a real, pre-existing case rather than
   only on hypothetical future ones.

Binary Done-when (mandatory, §3.4):
1. `[ ]` The V_meta insight ledger exists with the 3 known outstanding items
   migrated in (status fields populated) — pasted diff.
2. `[ ]` `dashboard.md` gains a `V_meta consolidation lag` health track with the
   K=2 threshold written explicitly — pasted diff.
3. `[ ]` `OUTER-LOOP.md`'s ABSORB step contains the gate, referencing the ledger
   and the track — pasted diff.
4. `[ ]` First proof: the next ABSORB either consolidates the past-threshold
   `CI-job ≡ audit-channel` pattern into `inherited-core.md` (pasted diff) OR
   records a dated carry-forward reason — one of the two is verifiably present.
5. `[ ]` No code ⇒ no test run required; if any script is touched, full existing
   suite passes (pasted raw output).

Explicit non-goal: do NOT add an exploration/reflection iteration to the inner
loop. The inner-loop build+verify specialization is retained; only the hand-off
to the outer loop's V_meta absorption is instrumented and bounded. Relationship
to DIR-004: the sole connection is charter overhead (lowering it — DIR-004 item 5
— eases both milestone size and inner-iteration count); that work stays in
DIR-004 and is only referenced, not duplicated here, to keep both directives'
Done-when disjoint.

## Resolution (added when moved to archive/, or updated in place if deferred)
<!-- to be filled in by the iteration that applies this directive -->
