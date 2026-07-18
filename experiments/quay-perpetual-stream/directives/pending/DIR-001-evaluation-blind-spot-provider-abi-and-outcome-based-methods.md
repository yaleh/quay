# DIR-001

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: The evaluation instrument is a polish engine blind to the Provider/ABI surface — add capability-completeness evaluation methods

## Finding

The whole coverage picture that drives VT (`dashboard.md`: CLI 0.95 / MCP 0.90
/ Web UI 0.95) rests on exp4's `gap-list.md`, and that instrument has a
structural blind spot that makes the "near-perfect" reading false. Evidence:

1. **~90% of all improvement ideas came from AI-internal channels.** Source-
   column tally over `experiments/quay-continuous-bootstrap/gap-list.md`:
   G3 (self-review gate) 55, simulated-user 43+1, Persona 29+2, human 13+3,
   cross-experiment 6, project-maintainer (simulated) 4, metric 1. This
   matches the offline-replay finding (`experiments/offline-replay/RESULTS.md`)
   that the standing simulated-user is a polish engine (0/6 structural
   discoveries). The actual closed gaps confirm it: overwhelmingly cosmetic
   micro-polish ("1 matches" grammar UQ-042, plural "results" UQ-037, label-nav
   ordering, `--format json` help wording, package.json ghost `files` entries).

2. **The Provider ABI / GitHub backend — quay's entire reason to exist
   ("provider-agnostic task board / pluggable Provider ABI") — is not a VT
   surface at all.** `dashboard.md` §VT lists only CLI/MCP/Web UI/Packaging/Docs.
   The value function literally cannot see this capability area, so no milestone
   will ever be selected to grow it.

3. **The GitHub Provider is a deliberately minimal walking skeleton and has
   been out of the evaluation loop since exp2.** `packages/quay-github/provider.yml`
   declares read + status-only write; `title/body/labels/parent/children` writes
   are explicitly `unimplemented`. In exp4's gap-list "github" appears 9 times,
   almost all as a *comparison yardstick* ("vs GitHub Issues"), never as an
   evaluation of `quay-github` itself.

Net: cov≈0.95 measures polish density of the three Core surfaces the personas
repeatedly re-examined, not capability completeness against what a real task
board must do. Un-evaluated entirely: ABI contract robustness / cross-provider
conformance, GitHub write completeness, real end-to-end task workflows
(mirror issue → gate → status write-back → verify on github.com), adversarial /
negative paths (bad config, API rate-limit, network failure, concurrent write,
malformed frontmatter, large backlog), security (token handling, open-redirect),
and actual job-to-be-done product value.

## Requested action

Open a near-term **explore** milestone (suggested id `M-ABI-EVAL`, ahead of the
remaining backlog polish milestones) that does BOTH of the following before any
further Core-surface polish milestone is selected, because the value function
currently cannot see the largest gap:

1. **Add a `Provider-ABI` surface to the VT value function** (`dashboard.md`
   §VT + protocol §6.2 weight table; treat added weight as a chart transition
   with a recorded conversion factor so VT stays comparable). Score it by an
   explicit **capability matrix**, not polish density:
   `{read, write, gate, skill} × {status, title, body, labels, parent/children}
   × {native, github}`. The large empty region of that matrix is the honest
   re-scoring of "near-perfect".

2. **Build an ABI conformance / differential-test suite** run against BOTH the
   native and github providers from one spec; any behavioral divergence is a
   logged gap. This is a mechanizable structural-discovery channel that the
   simulated-user provably cannot produce, and it directly feeds the M-GATES
   discovery-latency track.

Then institutionalize, as recurring evaluation methods layered into the outer
loop's discovery engine (§4.4) and it0 checks — do NOT leave them to the
simulated-user:

3. **Outcome-based (job-to-be-done) evaluation**: a fixed set of real end-to-end
   task-board scenarios scored binary pass/fail, dogfooding-gated (extends
   M-GATES's dogfooding evidence-gate from "was polish done" to "does the
   capability actually run end-to-end").
4. **Adversarial / negative-path + security evaluation**: explicit fault
   injection and a token-handling / open-redirect / injection review.
5. **Comparative capability benchmark** against a real competitor's feature
   matrix (formalize the ad-hoc "vs GitHub Issues/Linear" yardstick already used
   in CB-016) — this is the cross-experiment-comparison channel, offline-validated
   as a genuine structural source.
6. **Periodic human-led capability review as a standing explore milestone**
   (via this `/quay-directive` channel), since offline data shows every
   structural discovery came from human insight / metric anomaly / cross-experiment
   comparison, never from the simulated-user.

## Resolution (added when moved to archive/, or updated in place if deferred)
<!-- to be filled in by the iteration that applies this directive -->
