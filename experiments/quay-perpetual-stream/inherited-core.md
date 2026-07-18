# Inherited Core (Tier-B pinned methodology) — quay-perpetual-stream (Experiment 5)

The reusable inner methodology every milestone charter inherits by reference (charter Tier-A pins a
path + git SHA to this file; it is NOT inlined per iteration). Consolidation (§4.2) grows this file:
when a milestone adaptation is reused unchanged by a later different-domain milestone (φ confirmed),
merge it here and retire its delta citation.

## Extracted skills (read in order — delta chain)
1. `.claude/skills/quay-native-methodology/` — full base (gate mechanics `task check`, directive
   lifecycle, G3 out-of-band audit discipline, provenance/σ ledger).
2. `.claude/skills/quay-core-bootstrap-methodology/` — delta: manda nested dispatch, G3-dispatch
   discipline (DIR-003), σ-inherited-floor trap, multiplicative-V_meta ceiling diagnostic.
3. `.claude/skills/quay-webui-bootstrap-methodology/` — delta: §0c independent holistic visual
   review, σ floor-RESET, dual-viewport requirement, domain-misfit audit-channel need.

**Known weakness (this experiment must fix via consolidation):** the delta chain must be read in
order; there is no single consolidated core, and citations can drift. First consolidation target is
to merge the confirmed φ edges (§0c visual-review; dispatch/G3 discipline; σ-floor handling) into a
single authoritative core section here.

## exp4 methodology (NOT yet extracted to a skill — inherited as artifacts)
- `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` — hardened HARD GATES block (the
  **verbatim source for charter gate transclusion**), §0c continuous simulated-user, non-blocking
  dispatch.
- `experiments/quay-continuous-bootstrap/VMETAFORMULA.md` — the DIR-008 V_meta redesign record.
- `experiments/quay-continuous-bootstrap/directives/archive/DIR-009-*.md` — the gate-dilution failure
  and the mechanically-self-proving-gate fix (basis for the hash-check invariant).

## exp5-native additions (from the offline-replay design)
- **Charter three-tier contract** (protocol §3.1) + gate transclusion + hash check.
- **Inner termination five conditions**, calibrated K=2 / budget≈10 (protocol §3.2; `RESULTS.md` A).
- **Systematic-explore it0 checks** — ceiling arithmetic, gate-hash, dogfooding evidence-gate,
  domain-misfit audit-channel (protocol §4.4; `RESULTS.md` B2).
- **Binary Done-when mandatory** per milestone (protocol §3.4).

## Pinned gate source (transclude verbatim into every charter)
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` HARD GATES block (raw-output bar,
per-file directive disposition, worktree isolation proof, process-blocking-gap enumeration).
The charter must copy this byte-for-byte; a hash/substring check asserts no paraphrase (DIR-009).

## Domain-misfit audit-channel — concrete decision procedure (M02-gates Done-when clause 4)

The it0 systematic-explore check "domain-misfit audit-channel" (protocol §4.4d) was previously
framed abstractly: "does this new domain have an independent audit channel?" That framing requires
judgment with no worked steps. This section replaces it with a concrete procedure a future
charter-author applies directly at it0, BEFORE dispatch:

**Step 1 — name the domain's existing verification mechanism(s).** List every mechanism this
milestone's own Done-when clauses already require to demonstrate correctness (e.g. "CI job run",
"local test suite", "manual click-through"). If the list is empty, STOP — the charter has no
Done-when evidence plan yet; fix that first (this is really a Check 3 failure surfacing here).

**Step 2 — ask: is any listed mechanism SELF-REFERENTIAL (the same process/actor that produces the
work also verifies it, with no independent second observer or environment)?** A local `node --test`
run performed by the same iteration that wrote the code is not independent (same process, same
assumptions can be baked into both the code and the test). A CI job invoked by a real external
trigger (tag push, PR event) run in a separate, differently-provisioned environment IS independent,
even if it runs "the same" test suite — the environment and trigger are the independent variable,
not the test content.

**Step 3 — if Step 2 finds NO independent mechanism among the Done-when list, the domain has a
misfit: the milestone's plan currently has no audit channel and MUST add one before dispatch.**
Concretely, prefer (in this order, most to least preferred):
  a. **Reuse an existing out-of-band mechanism from a DIFFERENT actor/environment** than the one
     producing the work (e.g. a CI job on a hosted runner, a container with a deliberately
     different capability set than the dev sandbox, a second reviewing agent/process).
  b. **Construct a minimal new one** if (a) doesn't exist for this domain — but it must be
     something that can FAIL independently of the implementation succeeding by construction (a
     check that always passes when the code "looks right" is not an audit channel, it's a
     restatement).
  c. If neither (a) nor (b) is reachable at all (rare — most domains in this repo have at least a
     CI job or a container available), this IS a genuine ceiling per §3.2 condition 3 — redesign
     the milestone's scope rather than silently dispatching without an audit channel.

**Step 4 — the SAME mechanism should serve BOTH the it0 declaration and the actual iteration-time
verification.** Do not declare one audit channel in the abstract at it0 and then verify with a
DIFFERENT mechanism later — that's exactly the drift this procedure exists to prevent. If the it0
channel and the later verification diverge, that divergence itself should be logged as an
adaptation-log finding, not silently absorbed.

### Validation against M01-dist's own finding (self-consistency check)

M01-dist's it0 (§4.4d in its charter) named its audit channel abstractly: "a fresh shell (or CI job)
with no local Node install, running the built executable directly." Applying the procedure above
retroactively:
- **Step 1**: M01-dist's Done-when list already required CI (clauses 2/3) and local build
  verification (clause 4).
- **Step 2**: the local build+test-suite run (§5.5 of iteration-0) is self-referential (same
  sandbox, same process that wrote the SEA build scripts). The Node-free container run (§5.4) is
  NOT self-referential — it is a `debian:stable-slim` Docker container that never had Node
  installed, a genuinely different environment than the dev sandbox that wrote the code.
- **Step 3**: an independent mechanism EXISTS (the Docker container) — no ceiling, proceed to
  dispatch with that as the declared channel. This matches M01-dist's own it0d declaration exactly.
- **Step 4**: M01-dist's adaptation-log entry #1 (iteration-0 §9) independently arrived at exactly
  this same conclusion — "the it0 domain-misfit audit-channel and the CI verification job should
  be the literal same mechanism" — encoding the SAME Docker container pattern into the
  `sea-verify-node-free` CI job (§6) rather than inventing a second, different check for CI.

**Result: applying this procedure to M01-dist's own it0 produces the same audit-channel answer
M01-dist actually used** (a Node-free container, later mechanized identically in CI) — confirming
the procedure is a faithful concretization of what M01-dist already did by judgment, not a
redescription that would have given a different answer.
