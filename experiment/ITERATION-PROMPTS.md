# Iteration Prompts — Quay-Native Bootstrap

**Experiment**: quay-native-bootstrap
**Protocol**: [`../docs/proposal/quay-bootstrap-experiment.md`](../docs/proposal/quay-bootstrap-experiment.md) (authoritative — read it before running any iteration)
**Objective**: Build quay-native (instance) by having quay-native progressively build itself (meta), staged from an explicit seed (σ=0) to a self-hosting fixpoint (σ→1), with a human sign-off gate at the end.
**Target**: V_instance ≥ 0.80 AND V_meta ≥ 0.80, σ→1, native + GitHub Provider both run, out-of-band audit green.

> Frozen vocabulary applies (`glossary.md`). Use Provider, Skill, status, lane, task, run, action button, capability verbatim — never invent synonyms.

---

## How to use this document

- **Iteration 0** below is fully concrete and actionable — execute it as written.
- **Iterations 1..k** are templated, not scripted: each iteration retires one more Skill's seed dependency, lifts σ, gets an `adjudicate` co-sign, and updates `provenance.md`. The exact feature scope per iteration emerges from the previous iteration's backlog state — do not pre-plan feature content.
- **Stage 2+ guidance** (GitHub Provider) and the **fixpoint iteration** (human sign-off) are separate sections below — read them before the iteration where they first apply, not before.
- Every iteration prompt implicitly begins with the **preconditions checklist** (§0) and ends with the **convergence checklist** (§Convergence Check template). Do not skip either.

---

## §0. Preconditions (check before every iteration, from iteration 0 onward)

```
[ ] manda daemon is live for this workspace (http://localhost:28912)
[ ] the workspace monitor is attached (manda:manda-monitor)
[ ] (stage 2+ only) `gh auth status` shows user yaleh, scopes repo + workflow
    — do NOT require this before stage 2 begins
[ ] experiment/provenance.md exists (after iteration 0) and is being read, not re-derived from memory
[ ] previous iteration's experiment/iterations/iteration-{N-1}.md has been read in full
[ ] experiment/directives/pending/ has been listed (`ls`) and every file in
    it read; each must reach an explicit applied/deferred/rejected outcome
    this iteration, recorded in this iteration's own report — see
    experiment/directives/README.md for the full protocol
```

G6 makes the manda check mandatory, not optional background — if the daemon is not live, stop and arm it before doing anything else.

---

## Iteration 0: Baseline — the v0 walking skeleton (seed-driven, σ=0)

**Objective**: Ship the seed-driven v0 loop end-to-end (walking-skeleton discipline, G5) — do **not** begin self-hosting in this iteration. Establish `provenance.md` with every task logged `{seed, seed, seed}`. Record baseline timing/effort data that will later serve as the effectiveness comparator (decision §10.5 of the protocol). Compute honest baseline V_instance / V_meta.

**Driver**: seed only — BAIME + epicd Skills (`authoring-convergence`, `fixpoint-convergence`, `adjudicate`) via manda + human review. No `quay:*` Skill exists yet; none is expected to.

**Prompt**:
```
You are running Iteration 0 of the quay-native bootstrap experiment.
Read the protocol in full before starting:
  docs/proposal/quay-bootstrap-experiment.md
  docs/proposal/quay-proposal.md
  docs/proposal/quay-native-design.md
  docs/proposal/glossary.md
  experiment/README.md

Precondition check (G6): confirm manda daemon is live for this workspace and
the monitor is attached. Do not proceed until confirmed.

1. Set up the modular architecture (do not gold-plate — walking skeleton only):
   - `.quay/config.yml` — enables the native Provider, points at a task store path.
   - `quay-native` binary skeleton: `task` subcommands (raw file ops: list/get/edit/check)
     and `mcp` subcommand (starts the ABI transport).
   - `quay` (Core) binary skeleton: `serve` (list/detail), `task`, `action` subcommands,
     as an MCP client over the Provider ABI.
   - One markdown+frontmatter task file, following the canonical view-model
     (quay-native-design.md §2): id, title, status, labels, parent, children.
   - Port the minimal Layer-2 orchestration entry point needed to drive one task
     to `done` using the seed (epicd `authoring-convergence` / `fixpoint-convergence`
     / `adjudicate`, dispatched via manda) — this is NOT `quay:author`/`quay:execute` yet;
     it is the seed standing in for them.
   - One default action button wired to that seed-driven trigger.

2. Run the v0 loop end-to-end, for real, and observe it happening:
   `.quay/config.yml` enables native → `quay-native mcp` starts the data transport
   → `quay serve` renders list/detail → click the action button → the host delivers
   the trigger into a Claude Code session → the seed Skill runs → the task reaches `done`.
   Do not simulate or describe this — execute it and capture what actually happened
   (timings, errors, manual interventions).

3. Collect baseline timing/effort data (this is the future effectiveness comparator,
   protocol §5.2 + decision §10.5 — do not skip, it cannot be reconstructed later):
   - Wall-clock time to build each skeleton piece (config, quay-native task ops,
     quay-native mcp, quay serve, action button wiring, seed integration).
   - Wall-clock time for the seed to drive the one task from `todo` to `done`.
   - Number of manual/human interventions required during the loop.
   - Any rounds-to-convergence data the seed Skills expose.
   Write this to experiment/provenance.md alongside the provenance entries (see below) —
   or a clearly linked timing section — so iteration N (when effectiveness is measured
   on the marginal increment) has a real baseline, not a guess.

4. Establish experiment/provenance.md:
   - One record per task, format: `{task_id, author_by, execute_by, gate_by}`.
   - Every task created in this iteration is logged `{seed, seed, seed}` —
     this is the σ=0 floor. Do not log anything as `native` yet; nothing is native yet.
   - σ = (# tasks with all three fields `native`) / (total tasks) = 0/N = 0.

5. Compute honest baseline scores. Show your work — do not assert a number without
   evidence for each factor:

   V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
   - skeleton: does the v0 loop actually complete end-to-end? (evidence: the run log from step 2)
   - abi_symmetry: is quay-native's CLI JSON output even schema-comparable to its MCP
     tool output yet? (likely low/partial at v0 — say so)
   - gate_correctness: does `quay-native task check` exist and correctly assert
     todo→ready / ready→done? (likely thin at v0)
   - skill_convergence: N/A or near-zero — no `quay:*` Skill exists yet; the seed is doing
     the work. Say so explicitly rather than inflating this factor.

   V_meta = completeness × effectiveness × reusability × validation
   - completeness: near-zero — no native methodology (Skills) exists yet to document.
   - effectiveness: N/A this iteration (no marginal increment to compare against yet;
     this iteration IS the baseline the comparator will use).
   - reusability: zero — nothing has transferred to GitHub yet (out of scope until stage 2).
   - validation: σ = 0, provenance log established. This is the honest floor.

   Expected honest range (protocol §9): V_instance moderate (skeleton runs, ABI thin);
   V_meta ≈ 0.15–0.25. If your numbers land far outside this range, re-check for
   inflation or unfair harshness — do not force the number to match the range if the
   evidence says otherwise, but do sanity-check against it.

6. Identify initial problems (concrete, not generic):
   - Where did the seed loop require manual patching to complete?
   - What is missing from the ABI/gate that the next iteration (quay:author self-hosting
     authoring) will need?
   - What about `quay-native task check` is currently a stub vs. a real gate?

7. Write experiment/iterations/iteration-0.md using the 10-section BAIME iteration
   report structure (see "Iteration report structure" below), including the full
   Convergence Check against §7 of the protocol (expect: NOT CONVERGED, and say why
   for each of the 5 criteria).

Constraints: honest assessment, data-driven, no predetermined evolution of the Skill
roster beyond what protocol §3's isomorphism table already names. Do not begin porting
quay:author in this iteration — that is iteration 1's job (G5).
```

**Expected Output**:
- Working v0 skeleton (config → mcp → serve → action button → seed Skill → `done`), actually executed, not described.
- `experiment/provenance.md` created, every task `{seed, seed, seed}`, σ = 0.
- Baseline timing/effort data recorded for later effectiveness comparison.
- `experiment/iterations/iteration-0.md` with honest V_instance (moderate) / V_meta (~0.15–0.25) and a concrete problem list.
- Convergence Check: NOT CONVERGED (expected and correct at iteration 0).

---

## Iterations 1..k: Retire one Skill's seed dependency, lift σ (template)

**Objective (recurring)**: Retire one more Skill's dependency on the seed, author the marginal feature increment this implies, lift σ measurably, get the mechanical `adjudicate` co-sign for this lift, and update `provenance.md`. Do not pre-plan which feature or how many iterations this takes — that emerges from the previous iteration's backlog and problem list.

**Per-Skill seed retirement order (fixed, decision §10.2 of the protocol)**: `quay:author` (authoring side) retires its seed dependency **before** `quay:execute` (execution side). Expect intermediate provenance states like `{native, seed, native}` — these are valid, not bugs.

### Context extraction (do this first, every iteration)

```
Read, in full, before doing anything else:
  experiment/iterations/iteration-{N-1}.md  — prior system state, V scores, problems
  experiment/provenance.md                   — current per-task {author_by, execute_by, gate_by}
  experiment/audits/                         — prior adjudicate / human sign-offs, if any

Extract:
  - current σ (recompute from provenance.md; do not trust a remembered number)
  - which Skill's seed dependency is next in line to retire (author before execute)
  - the specific problems iteration {N-1} identified as blocking the next lift
  - whether iteration {N-1} attempted and rejected any alternative approach
    (needed for evolution justification below)
```

### Lifecycle capability-reading protocol

- Read **all** relevant Layer-1/Layer-2 Skill definitions that exist so far **before** the iteration starts (even ones you don't expect to touch — architecture drift is caught this way).
- Read the **specific** Skill/capability you are about to modify or port again immediately **before** using it, even if you read it at the top of the iteration — state may have changed since.

### Iteration cycle (Observe → Codify → Automate → Evaluate → Convergence Check)

```
1. OBSERVE
   - What does quay-native's own backlog look like right now (query it through
     quay-native's own CLI/MCP, not by reading files by hand, once task_list works)?
   - Which task(s) are the natural next candidate(s) for the Skill retiring its seed
     dependency this iteration?
   - What gap, specifically, is stopping that Skill from self-hosting today?
     (Cite iteration {N-1}'s problem list — do not invent a new gap out of thin air.)

2. STRATEGY FORMATION
   - Decide the smallest feature increment that both (a) advances quay-native's
     instance backlog and (b) is the vehicle for retiring this iteration's target
     Skill's seed dependency. One action, one proof — do not scope two unrelated
     features into one iteration.
   - If this iteration is stage 2+ (native + GitHub both must eventually run),
     read "§Stage 2+" below before scoping.
   - If σ is at or near 1 and the Skill set + gate have been stable across the
     previous iteration, read "§Fixpoint iteration" below instead of continuing
     this generic template.

3. EXECUTION
   - Port or extend the targeted Skill so that it — not the seed — authors/executes/gates
     the chosen task(s). Layer-1 operation Skills run in their own subagent
     (fresh context, review independence — design §5). Orchestration Skills
     (`quay:author`/`quay:execute`) dispatch them; whether the orchestration Skill
     itself runs in a subagent is the environment's call, not the Skill's.
   - Drive the chosen task(s) through the targeted transition using the native Skill,
     for real — capture the actual run, not a projection of what it would do.
   - Update `provenance.md`: flip the retired field(s) to `native` for every task this
     iteration actually drove natively. Do not bulk-flip tasks that weren't actually
     driven this iteration — σ is a fact, not an aspiration.

4. EVALUATION — compute both V's honestly, from evidence gathered this iteration

   V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
   - Re-check all four factors, not just the one this iteration touched — regressions
     in earlier factors are common and must be caught here.

   V_meta = completeness × effectiveness × reusability × validation
   - completeness: is the retired Skill's methodology now fully documented and
     self-contained (not "mostly," fully)?
   - effectiveness: speedup on THIS iteration's marginal increment only, measured
     against the recorded stage-0 seed pace (experiment/provenance.md timing data)
     — never against the cumulative artifact (G2). If you cannot cite a specific
     stage-0 timing number to compare against, effectiveness is not measurable yet;
     say so rather than guessing.
   - reusability: 0 until stage 2 begins (no transfer target exists yet). Do not
     score this against native-on-native reuse — that is completeness, not reusability.
   - validation: σ (recomputed from provenance.md this iteration) + is the
     mechanical adjudicate co-sign for this lift in hand (see step 5)?

   Recompute σ = (# tasks with author_by = execute_by = gate_by = native) / (total tasks).
   State the before/after σ explicitly.

5. OUT-OF-BAND AUDIT (G3 — mandatory every σ lift, mechanical, not optional)
   - Run an independent epicd `adjudicate` pass against this iteration's lifted
     task(s) and the gate that certified them. `adjudicate` must be independent of
     whatever authored/executed the task — it reads the artifact + diff only.
   - **Terminology (added by DIR-012, iteration 65 — see `docs/proposal/
     glossary.md`'s "Subagent dispatch mechanisms" section for full
     definitions):** this audit is dispatched via a **native subagent** —
     the top-level orchestrator's own platform `Agent`/Task tool, a
     fresh-context spawn within the same session/orchestrator invocation,
     entirely separate from whatever authored/executed the task. This is
     distinct from a **manda nested subagent** (manda's own
     `mcp__plugin_manda_manda__Agent` cap-request mechanism, relayed to a
     live broker session). **This audit step MUST continue to use the
     native subagent mechanism, not the manda nested subagent mechanism —
     see the DEFERRED note immediately below for why.**
   - **DEFERRED (DIR-012 action 2): requiring the manda nested subagent
     mechanism for this audit step.** DIR-012 asked whether this audit
     should instead be required to run via the manda nested subagent
     mechanism, on the reasoning that its broker round-trip gives a
     stronger process-separation guarantee. Iteration 65 evaluated this
     and found the precondition DIR-012 itself set — "confirm G6's
     manda-daemon-liveness precondition can be relied upon for every
     iteration's audit step without making audits newly flaky" — is
     **not** satisfiable given the experiment's own recorded history:
     `experiment/directives/README.md`'s own iteration-14/15 updates
     record the synchronous `Agent` cap-request spawn timing out 5/5
     reproductions even with the manda daemon process confirmed live and
     multiple monitors (`worker`, `cord`, `terminal`) alive on the host,
     including a case (iteration 15) where the *audit dispatch itself*
     failed for this reason, leaving that iteration with no independent
     mechanical co-sign at all. Whether any given fresh iteration session
     has a live monitor bound to it, and whether a live parent-broker
     session is actively watching the right `cap-requests-<name>`
     channel at the moment the audit needs to run, are per-session,
     per-moment facts (§Core-scope work item 3's own manda-reuse
     discipline already establishes this) — not something a MUST-level
     requirement can safely assume for **every** future iteration without
     risk of newly making the mandatory G3 step flaky. This sub-item is
     therefore **resolved as DEFERRED**, not applied: the audit dispatch
     mechanism named in this section remains the native subagent (the
     top-level orchestrator's own `Agent` tool), unconditionally, for
     every iteration going forward, until a future iteration can
     mechanically confirm live-monitor coverage is reliable across
     fresh sessions (not just the current session at the moment of
     writing) rather than merely possible in principle.
   - Write the verdict to `experiment/audits/iteration-{N}-adjudicate.md`
     (co-sign or specific findings — if it finds problems, the σ lift for the
     affected tasks does not count yet; fix and re-audit before claiming the lift).
   - This is the mechanical gate audit only. The separate human fixpoint sign-off
     (G4) is NOT triggered here — it happens once, at the fixpoint iteration only
     (see "§Fixpoint iteration" below). Do not conflate the two.

6. CONVERGENCE CHECK — evaluate against protocol §7, all five, every iteration:
   [ ] 1. Dual threshold: V_instance ≥ 0.80 AND V_meta ≥ 0.80
   [ ] 2. Self-hosting fixpoint: σ→1, next increment built with zero seed,
          Skill set + gate stable across builds (this is almost always NO
          until very late — do not check it prematurely)
   [ ] 3. Contract proven: native + GitHub Provider both run (NO until stage 2+ completes)
   [ ] 4. Out-of-band audit passed: adjudicate co-sign on every lift so far +
          human fixpoint sign-off (the human sign-off part is NO until the
          fixpoint iteration)
   [ ] 5. Diminishing returns: ΔV < 0.02 for 2+ iterations
   Status: NOT CONVERGED unless literally all five are YES with evidence.

7. Write experiment/iterations/iteration-N.md (10-section structure below).

8. Evolution guidance for the Skill roster (A_n) itself:
   - Evolve a Skill/capability only on: retrospective evidence from this iteration's
     OBSERVE step + a demonstrated gap + a documented attempted alternative that failed.
   - Do NOT evolve on: pattern-matching to what "seems complete," anticipatory design
     ("we'll probably need X later"), or theoretical completeness.
   - Every evolution must state: what necessity was demonstrated, and how the
     improvement is quantifiable (which V component moved, by how much).
```

### Key principles (every iteration, no exceptions)

- **Honest calculation** — ground every factor in cited evidence from this iteration's run, not from memory of prior iterations or from what "should" be true.
- **Dual-layer focus** — score V_instance and V_meta independently; never let a good instance score paper over a weak meta score or vice versa.
- **Justified evolution** — the Skill set only changes with demonstrated necessity (§8 above).
- **Rigorous convergence** — all 5 criteria, every iteration, no partial credit and no "close enough."

---

## §Stage 2+: When GitHub-Provider-building iterations begin

Trigger this section once σ is high enough on the native side that quay-native itself can plausibly drive a new Provider's construction (protocol §4.1, stage 2..k) — not before, and not merely because "it's time" by iteration count.

```
Preconditions specific to this stage (in addition to §0):
[ ] `gh auth status` confirms user yaleh, scopes repo + workflow
[ ] this repository is published to GitHub and has real issues to target
    (protocol §10.1 — GitHub Provider is built against this repo's own issues)

Scoping rule: building the GitHub Provider must be DRIVEN BY quay-native
(quay:author / quay:execute authoring and executing the GitHub-Provider-building
tasks), not hand-built by the seed or by ad-hoc human coding. If quay-native
cannot yet drive this work, σ is not actually high enough yet for this stage —
go back to retiring more seed dependency first, do not force it.

This is "one action, two proofs" (protocol §4.1 two-birds note):
  - Instance proof: native + GitHub Provider both run → ABI declared stable
    only then (proposal §14). Do not declare ABI stability before both run.
  - Meta proof: reusability in V_meta is measured on this transfer target
    ONLY (G2) — this is the one and only reusability evidence source; do not
    substitute native-on-native self-hosting evidence for it.

Do not build a third backend. GitHub is the sole v1 transfer target
(decision §10.4 of the protocol).
```

---

## §Core-scope work: standing constraints for any task touching `packages/quay`

Added by iteration 29 (DIR-008), sourced from `docs/proposal/
quay-core-scope-expansion-discussion.md` (a discussion document, not a
directive itself — read in full there for the underlying reasoning; do
not re-derive these from scratch). These four constraints bind **every**
future iteration whose task touches `packages/quay` (the Core: CLI + Web
server + action-trigger edge), the same way G1-G6 bind every iteration
regardless of task. They do not authorize or request any new
implementation work by themselves (the three original proposals in the
discussion doc — browser-automation Web UI verification, Core CLI/MCP/
Web-UI three-way symmetry, mock/log-file action-delivery mode — remain
separate, not-yet-issued, future directives).

1. **Terminology discipline.** This project's glossary
   (`docs/proposal/glossary.md`) freezes "MCP" to mean specifically the
   Provider ABI transport (`quay-native mcp`, `quay-github mcp`, `quay
   mcp`). Browser-automation tooling available to a Claude Code session
   (chrome-devtools / playwright MCP servers) is an unrelated mechanism
   that happens to share the protocol name. Any iteration prompt or task
   body touching both must keep them unambiguous — write "browser-
   automation tooling (chrome-devtools / playwright MCP)," never bare
   "MCP testing" — especially now that a real Core-level `quay mcp`
   exists (QN-036) alongside it.
2. **G5 discipline for Web UI verification.** `packages/quay/src/
   serve.js`'s own header states the Web UI is deliberately "crude but
   real... no framework, no styling beyond what's needed to prove the
   loop." Any browser-driven or other Web UI verification work must stay
   scoped to confirming *existing* behavior (list renders, detail
   renders, action-button POST fires) and must not become a pretext for
   improving the UI's appearance or interactivity before the skeleton's
   functional loop is otherwise complete — per G5's own warning that "the
   bootstrap ambition amplifies" the gold-plating temptation.
3. **manda-investigation reuse discipline.** Iterations 13-18 already
   spent substantial effort establishing that: the async `Dispatch` queue
   primitive works but nothing reliably claims tasks submitted to it; a
   genuine synchronous `Agent` fresh-context spawn times out (reproduced
   5/5 as of iteration 15); and even a correctly-targeted dispatch to a
   session's own monitor channel produces no execution unless a live
   process is actually watching that monitor's output (DIR-005's
   finding, iteration 18). Any future prompt involving action-delivery
   verification must explicitly instruct: do not re-discover these
   findings from scratch — cite and build on
   `experiment/directives/archive/DIR-004-*.md` and
   `experiment/directives/archive/DIR-005-*.md` directly — and must not
   make an automated test's pass/fail hinge on live manda delivery
   succeeding, since that has been repeatedly shown to be a per-session,
   per-moment fact, not a reliably available one.
4. **Resolution of the two open scope/attribution questions (discussion
   doc §4), decided by iteration 29:**
   - **(a) Scope:** Core is **already in scope**, no protocol §10
     resolution needed. `experiment/README.md` §1's instance objective
     already depends on the v0 walking skeleton, which already includes
     `packages/quay` (the Core) — it is not a new backend being added,
     it is the pre-existing Core layer several already-completed tasks
     (QN-027, QN-031, QN-033, QN-036, QN-038, QN-039) have exercised
     without any prior objection or §10 amendment. No change to
     `experiment/README.md` §1 is made by this decision — the existing
     text already covers it.
   - **(b) V-factor attribution:** Core-level three-way symmetry work
     (CLI ⟷ Core MCP ⟷ Web UI) and action-delivery mock-verification
     work should be credited to the **same factors that already credit
     the analogous Provider-level work**, not a new fifth factor: new
     Core capability code → `skeleton`; new Core CLI/MCP schema-symmetry
     proof (extending `abi-symmetry.mjs`'s discipline one layer up, or a
     genuinely new Core-level equivalent script) → `abi_symmetry`; new
     Core gate-logic change → `gate_correctness`. This is a direct
     extension of precedent already applied at the Provider level, not a
     new invention, and it explicitly avoids re-opening the extended
     `effectiveness`-attribution debate seen in iterations 21-24 —
     `effectiveness` is not the right factor for structural
     capability/symmetry work regardless of which layer (Provider or
     Core) it targets.
5. **G3 (out-of-band audit) applies to Core on exactly the same terms as
   Provider (added by DIR-013, iteration 65).** Per `docs/proposal/
   quay-core-scope-expansion-discussion.md` §3 item 3 (quoted verbatim):
   > **G3 (out-of-band audit) must extend to Core.** If a future Core MCP
   > server (DIR-007) is used as evidence toward quay-native's own
   > self-certification claims, the independent audit mechanism (G3) must
   > explicitly cover Core-level code too — quay-native's own gate must
   > not be the sole judge of Core's correctness, the same
   > "no self-certification" principle the protocol already applies at
   > the Provider level.
   Concretely: any iteration whose task touches `packages/quay` (Core —
   `mcp-server.js`, `serve.js`, `bin/quay.js`, `provider-env.js`,
   `action.js`, `config.js`, `provider-client.js`, or any other Core
   source file) must receive the same mandatory §5 OUT-OF-BAND AUDIT
   dispatch (independent `adjudicate`, native-subagent-dispatched per the
   terminology/mechanism note in §5 above) as a Provider-layer change —
   no self-certification by whichever Skill/session authored or executed
   the Core change, and no exemption for Core code on the theory that it
   is "infrastructure" rather than "the thing being verified." This is a
   codification of what this experiment's own audit-dispatch practice
   has already done uniformly since iteration 13 (verified retrospectively
   at iteration 65 — see `experiment/directives/archive/
   DIR-013-codify-g3-audit-extends-to-core.md`'s Resolution for the full
   retrospective check), not a new obligation being introduced for the
   first time.

---

## §Fixpoint iteration: σ→1, human sign-off (not just adjudicate)

Trigger this section only when: σ has reached (or is about to reach) 1, AND the Skill set + gate have been stable (unchanged) across the previous iteration's build. Both conditions, not just σ.

```
1. Confirm the fixpoint test itself (protocol §4.2): build the next increment
   using v_n with zero seed involvement, and check that the resulting Skill set
   + gate are IDENTICAL to v_n's — not merely "similar" or "equivalent in spirit."
   If anything differs, this is not yet the fixpoint iteration — go back to the
   generic per-iteration template above and continue lifting σ.

2. Run the mechanical adjudicate co-sign as usual (G3) — this is necessary but
   explicitly NOT sufficient here (G4).

3. Request the HUMAN fixpoint sign-off — a distinct, mandatory gate:
   - The human reviews the full provenance log, the fixpoint reproduction evidence,
     and both V scores' trajectories.
   - The human's question is not "did it reproduce itself" (that's the mechanical
     fixpoint test in step 1) but "is the reproduced methodology actually correct" —
     the Trusting-Trust question (G4): a self-hosting system can reproduce itself
     bit-identically and still share the same bug in both copies.
   - Record the sign-off (or the specific rejection + required rework) in
     experiment/audits/fixpoint-human-signoff.md. Do not proceed to declaring
     the experiment converged without this file existing and being affirmative.

4. Only after BOTH the mechanical fixpoint test (step 1) and the human sign-off
   (step 3) are green does convergence criterion 2 AND criterion 4 (protocol §7)
   both read YES. Re-run the full Convergence Check (all 5 criteria) one more time
   with this evidence before declaring CONVERGED.

Do not let fixpoint stability alone ("it reproduced itself") stand in for
correctness. These are two separate, both-mandatory gates (protocol §7 note).
```

---

## Iteration report structure (use for every `experiment/iterations/iteration-N.md`)

```markdown
# Iteration N: [one-line title — what Skill's seed dependency this iteration targets]

**Date**: YYYY-MM-DD
**Driver**: [seed | quay:author (native) | quay:author + quay:execute (native) | ...]
**Stage**: [0 | 1 | 2..k | fixpoint]

## 1. Context from prior iteration
[σ before, open problems inherited, what this iteration targets and why]

## 2. Preconditions checked
[§0 checklist, plus stage-specific preconditions if applicable]

## 3. Observe
[backlog state, gap analysis, evidence for what's blocking the next σ lift]

## 4. Strategy
[the one feature increment chosen, and which Skill's seed dependency it retires]

## 5. Execution
[what was actually built/ported/run — cite real runs, not projections]

## 6. Provenance update
[per-task {author_by, execute_by, gate_by} diffs this iteration; σ before → after]

## 7. V_instance
- skeleton: 0.XX — [evidence]
- abi_symmetry: 0.XX — [evidence]
- gate_correctness: 0.XX — [evidence]
- skill_convergence: 0.XX — [evidence]
- **Total**: 0.XX

## 8. V_meta
- completeness: 0.XX — [evidence]
- effectiveness: 0.XX — [evidence, cite the stage-0 baseline compared against, marginal increment only]
- reusability: 0.XX — [evidence; 0 until stage 2 GitHub transfer target exists]
- validation: 0.XX — [σ + adjudicate status]
- **Total**: 0.XX

## 9. Out-of-band audit
[adjudicate verdict, link to experiment/audits/iteration-N-adjudicate.md;
 human sign-off status if this is the fixpoint iteration]

## 10. Convergence Check
- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)
- [ ] 2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set + gate)
- [ ] 3. Contract proven (native + GitHub both run)
- [ ] 4. Out-of-band audit passed (adjudicate co-sign + human fixpoint sign-off)
- [ ] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations)

**Status**: NOT CONVERGED | CONVERGED

## Problems identified for next iteration
[concrete, evidence-based — feeds directly into next iteration's context extraction]
```

---

## Execution guidance (apply to every iteration, baseline and beyond)

- **Perspective**: embody the meta-agent for this domain — you are simultaneously building quay-native and using quay-native's emerging methodology to build it. Keep both hats visible in the writeup; do not silently switch between them.
- **Rigor**: honest dual-layer calculation, every factor cited to evidence gathered this iteration.
- **Thoroughness**: no token-limit shortcuts — a partial provenance update or a partial audit is worse than a smaller iteration scope.
- **Authenticity**: discover the next feature/gap from the actual backlog and actual run evidence; do not assume or pattern-match to what a "typical" bootstrap would need next.
- **Evaluation protocol**: independent dual-layer assessment — instance measured against protocol §5.1's four factors; meta assessed against protocol §5.2's four factors and G2's held-out discipline; convergence requires both layers plus the fixpoint/audit criteria, never either alone.
- **Honest-assessment bias avoidance**: actively seek disconfirming evidence for any score above 0.7; enumerate gaps explicitly rather than summarizing them away; ground every score in a concrete artifact or run log; challenge any score that jumped by more than 0.15 in one iteration; watch specifically for the anti-patterns in the Common Mistakes list below.

### Common mistakes to actively guard against (self-hosting-specific)

- **Backfilling the bootstrap narrative** — claiming a task is `{native, native, native}` in provenance.md when it was actually hand-guided or seed-assisted. σ must be a fact computed from honest records, not an aspiration (G1).
- **Collapsing V_meta onto the cumulative artifact** — scoring reusability or effectiveness against "everything built so far" instead of the marginal increment / GitHub transfer target only (G2).
- **Self-certifying the gate** — treating a green `quay-native task check` as sufficient proof that quay-native built quay-native *correctly*, without the independent adjudicate/human audit (G3, G4).
- **Declaring fixpoint on reproduction alone** — σ→1 and a stable Skill set prove stability, not correctness; the human sign-off is not a formality (G4).
- **Gold-plating before the skeleton runs** — perfecting `quay:author` before `quay-native task list` works end-to-end (G5).
- **Treating manda or `gh` as assumed background** — both are explicit per-stage preconditions (§0, §Stage 2+), not ambient infrastructure (G6).
