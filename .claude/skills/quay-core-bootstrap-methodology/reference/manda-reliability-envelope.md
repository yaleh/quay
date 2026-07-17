# manda Agent (`mcp__plugin_manda_manda__Agent`) reliability envelope

Source: `experiments/quay-core-bootstrap/iterations/iteration-4.md`,
`iteration-5.md`, `iteration-6.md`. This is a specific, evidence-backed
characterization experiment 1 never had — experiment 1 only recorded
"no subagent-dispatch primitive existed for most of the experiment's
life" (see `quay-native-methodology/reference/patterns.md`'s Layer-1/
Layer-2 section) plus one later async workaround under a strict hard
rule (DIR-020), without a tiered timing/complexity breakdown.

## The three-tier envelope (fully characterized, iterations 4-6)

| Tier | Task shape | Timeout tried | Result |
|---|---|---|---|
| Trivial | single-word echo ("respond with the word PONG and nothing else") | 90s | SUCCESS, first attempt, immediate (iteration 4) |
| Medium | single file read + structured JSON response | 90s | (not separately tested at 90s) |
| Medium | single file read + structured JSON response | 150s | SUCCESS, first attempt (iteration 5) |
| Complex | multi-file read (3 files) + adversarial analysis of 4 factual claims + structured JSON verdict — i.e. G3-audit-shaped work | 90s | TIMEOUT (`MCP error -32603: timeout waiting for cap "agent.spawn" result after 1m30s`) (iteration 4) |
| Complex | same shape as above | 150s | SUCCESS, first attempt, no timeout, no error (iteration 6) |

**Precise statement of the finding**: complex, G3-audit-shaped tasks do
**not** reliably time out — they time out at a 90s timeout and succeed at
a 150s timeout (1/1 in both cases, single trials, not yet repeated). The
correct summary is "timeout-dependent, not complexity-dependent," not
"complex tasks always fail." Do not compress this to "manda times out on
complex work" — that overstates the finding beyond what was tested (only
one trial per cell; the envelope is characterized, not exhaustively
validated).

## What remains conditional, not what changed

Across all three tiers, the primitive remains **conditional**, not
unconditional: it requires (a) a live manda daemon (`.manda/hub.addr`
reachable) and (b) a non-self cord broker (per DIR-020's hard rule — the
depth-1 caller must not itself be the broker). No trial in iterations 4-6
relaxed either precondition. ToolSearch surveys repeated in iterations 7-10
(the comprehensive fallback search, re-trigger 4) confirmed no
unconditional fresh-context spawn primitive appeared. See
`experiments/quay-core-bootstrap/iterations/iteration-10.md` §3b re-trigger 4.

## The {native,native,native} provenance-triple confirmation

Separately from the manda-Agent envelope above (which is about true
subagent dispatch), iterations 7-10 confirmed that the
`{author_by, execute_by, gate_by} = {native, native, native}` provenance
triple is reproducible **on demand**, four consecutive times (QC-007,
QC-008, QC-009, QC-010), via the **degraded-fallback** interpretation of
quay:author/quay:execute — i.e. same-session sequential Method-step
execution (write-proposal → review-proposal → write-plan → review-plan →
gate; implement → self-audit-ac → gate-check), each step explicitly named
and followed, with the final `mcp__quay__task_check` gate call as the
Skill's own Method step (not a bare status edit). This is "native" in the
sense that the Skill's own Method steps were the operative driver, not in
the sense of true independent fresh-context subagent dispatch. Useful
finding: a consuming experiment does not need true subagent dispatch to
earn native-triple provenance under this interpretation — but should be
explicit that this is what "native" means here, to avoid conflating it
with genuine dispatch independence (which the manda envelope above
addresses separately).

## Consuming-scope guidance

- When designing a new experiment's manda-dispatch timeout policy, use
  150s as the floor for anything above trivial complexity — 90s produced
  a false-negative ("times out") read on a task that succeeds at 150s.
- Do not claim the unconditional-primitive re-trigger (see
  `quay-native-methodology/reference/v-meta-stall-analysis.md` re-trigger
  4) fires just because reliability improved — conditionality
  (daemon + non-self broker) and reliability (does it complete within a
  given timeout) are two independent axes; only the second moved here.
- Each cell of the envelope table above is a single trial. Treat this as
  a directional characterization sufficient to set a timeout policy, not
  as a statistically validated success rate.
