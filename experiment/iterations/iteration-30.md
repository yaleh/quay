# Iteration 30

- **date:** 2026-07-15
- **status:** complete
- **primary driver:** fresh OBSERVE-phase search (no pending directive at
  session start) surfaced `packages/quay/DESIGN.md` §2.5's third named
  "Known gap" as the highest-value, genuinely tractable target: the
  `provider://manifest/<id>` MCP resource's `name` field had never been
  checked against a client that enumerates resources by `name` rather
  than `uri`

## 1. Context from prior iteration

`experiment/iterations/iteration-29.md` (573 lines, read in full fresh
this iteration) ended with:

- σ (strict) = 32/39 = 0.8205, σ (inclusive) = 34/39 = 0.8718 (final,
  corrected numbers — see that report's own §6 and the post-hoc
  correction note appended to `provenance.md` immediately after its
  "Records" section).
- **V_instance = 0.67 × 0.94 × 0.76 × 0.96 = 0.4595** (skeleton 0.67,
  abi_symmetry 0.94, gate_correctness 0.76, skill_convergence 0.96) —
  unchanged from iteration 28.
- **V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973** (completeness 0.74,
  effectiveness 0.26, reusability 0.79, validation 0.64) — **corrected**
  post-audit: the original iteration-29 report had claimed `completeness`
  0.75 (+0.01) for QN-040's `ITERATION-PROMPTS.md` addition; the
  independent audit found this an overclaim (protocol §5.2 scopes
  `completeness` to `quay:author`/`quay:execute`'s own SKILL.md content,
  and iteration 10 set a directly on-point precedent holding this exact
  file's own revisions flat). Corrected to 0.74, V_meta unchanged from
  iteration 28.
- All 5 convergence criteria: NO, except criterion 5 ("diminishing
  returns, ΔV < 0.02 for 2+ iterations"), which was — for the first time —
  literally satisfied (iterations 28-29 both had ΔV_instance = ΔV_meta =
  0.0000), while the report explicitly flagged that this reflects a value
  function pinned near its own floor, not genuine convergence-approach
  behavior, and that criterion 5 alone does not offset criteria 1-4 all
  being clearly NO.
- The iteration-29 independent out-of-band audit
  (`experiment/audits/iteration-29-independent-adjudicate.md`) returned
  **PASS WITH CONCERNS** — all mechanical/factual claims verified exactly
  (QN-039's tests, DIR-008 timing, section faithfulness, regression
  suite, scope, σ/V arithmetic); the one substantive finding was the
  `completeness` +0.01 overclaim, corrected in `provenance.md` and in
  `iteration-29.md` itself, both read fresh (post-correction) this
  iteration — not from any pre-correction memory.
- **"Problems identified for next iteration"** named, in priority order:
  (1) the real-Claude-Code-session MCP-client tool-use gap (structural,
  not to be attempted/bypassed); (2) `effectiveness` flat at 0.26 for 8
  consecutive iterations (21-28, and 29); (3) `reusability` held flat for
  the 4th consecutive iteration (26-29), single iteration-25 data point
  still the only move; (4) criterion 5's literal-vs-substantive tension,
  flagged for a future iteration/audit to weigh, not unilaterally
  resolved; (5)/(6) the two `resolveProviderEnv()`/`quay serve` gaps and
  DIR-008 are both now closed, do not re-list; (7) the discussion doc
  remains unresolved notes, not a directive; (8) no pending directive as
  of end of iteration 29.

## 2. Preconditions checked

- `docs/proposal/quay-bootstrap-experiment.md` re-read in full (protocol:
  self-hosting identity M(Q)=Q, §5.1/§5.2 value formulas as PRODUCTS of 4
  factors each — not means, §6 guardrails G1-G6, §7's 5 convergence
  criteria, §10's resolved decisions).
- `experiment/README.md` and `experiment/ITERATION-PROMPTS.md` re-read in
  full, including the "§Core-scope work" standing-constraints section
  added by iteration 29/DIR-008 (real, binding for any task touching
  `packages/quay` — QN-041 does, so its four constraints were checked
  against this task's scope: terminology discipline N/A here, no
  Web-UI/browser-automation work involved; G5 Web-UI discipline N/A, no
  Web UI touched; manda-investigation reuse discipline N/A, no
  action-delivery work; constraint 4's V-factor-attribution mapping was
  the one directly relevant — applied below in §7/§8).
- `experiment/provenance.md` read: `ls`/`wc -l` confirmed 4051 lines at
  session start; the tail (post-hoc correction sections for iterations 25
  and 29, both read in full) plus the first ~1012 lines (iterations 0-7
  in detail) were read via paginated `Read`; the remaining middle section
  trusted per the established convention (each iteration's own report
  already carries the authoritative per-iteration detail; provenance.md's
  running tables are consistency-checked against the task-count/σ
  arithmetic instead of re-read line-by-line every iteration).
- `ls experiment/directives/pending/` at session start: **confirmed
  empty** (only `.` and `..` entries) — matching iteration 29's own
  end-state.
- `git status --short` at session start: clean except the one
  pre-existing untracked file, `docs/proposal/
  baime-lite-driving-external-projects.md` — re-confirmed, per its own
  explicit self-labeled status ("forward-looking discussion notes, not a
  resolved decision or a commitment to build"), that it is **not** a
  directive; left untracked/as-is, exactly as instructed.
- `experiment/directives/README.md` re-read in full (lifecycle mechanism:
  pending/ → archive/, required `## Resolution` section) — not needed
  this iteration (no directive to process), but read per the standing
  "read before each phase" discipline.
- `experiment/audits/iteration-29-independent-adjudicate.md` read in full
  (verdict: PASS WITH CONCERNS, `completeness` overclaim — already
  corrected in `provenance.md`/`iteration-29.md` before this iteration
  began; re-confirmed the correction is in place, not re-applied).
- manda daemon: `.manda/config.yml` / `.manda/hub.addr` present (G6
  precondition file check); `ToolSearch` re-run for "quay task mcp
  server tools" at session start — **no `quay`-related tools surfaced**
  (same structural finding as every iteration since 25 — this session
  started before `.mcp.json`'s registration could be freshly discovered;
  not attempted further, per explicit instruction not to bypass or
  simulate around this).
- `gh auth status`: confirmed user `yaleh`, scopes include `repo` +
  `workflow` (token scopes: codespace, gist, read:org, repo, workflow).
- 19 `*.test.mjs` files + `abi-symmetry.mjs` = 20 test-bearing files
  confirmed via `find` at session start, all re-run and passing before
  any new work began (baseline-clean confirmation, not assumed from
  iteration 29's own claim).

## 3. Observe

- Re-ran the full regression suite (20 test-bearing files) fresh at
  session start: all PASS, zero pre-existing failures — confirms
  iteration 29's own end-state claim independently, not merely trusted.
- Searched `packages/*/src/*.js` and `packages/*/DESIGN.md` for
  remaining named-but-unclosed gaps (`grep -rn "TODO\|not yet\|
  unmapped\|untested\|not covered\|gap"`), rather than mechanically
  re-processing iteration 29's own priority list unchanged (per this
  iteration's own OBSERVE-phase judgment, per instruction). Found
  `packages/quay/DESIGN.md` §2.5's "Known gaps" section still listing
  **three** residual items after QN-036 (iteration 26): (a) the real
  Claude-Code-session stdio transport lifecycle (structural, not
  actionable this session — matches problem #1 above); (b) `task_write`'s
  CAS option not specifically exercised through the Core MCP path (a
  thin, low-risk, generic passthrough, explicitly named as low-priority
  in the source); (c) the `provider://manifest/<id>` resource's `name`
  field never checked against a name-based (not uri-based) MCP client.
- Item (c) was judged the most concretely closable, genuinely-scoped gap:
  unlike (a) (structural/environmental) and (b) (explicitly low-risk,
  thin passthrough already covered transitively), (c) names a specific,
  checkable, previously-never-tested fact about the MCP protocol's own
  `resources/read` semantics as actually implemented by the SDK this
  project uses.
- **Live probe performed before writing any Proposal text** (per this
  iteration's standing instruction to apply the precedent-search
  discipline and verify facts before scoring, not just before computing
  σ): wrote a standalone script, connected a real MCP client to the real
  `quay mcp` subprocess (two-Provider fixture, same shape as
  `mcp-server.test.mjs`'s own), and confirmed live: `listResources()`
  returns `{name: "manifest", uri: "provider://manifest", ...}` and
  `{name: "manifest-native", uri: "provider://manifest/native", ...}` —
  distinct fields, genuinely present; `readResource({ name: "manifest" })`
  (uri omitted) throws `MCP error -32603` (zod: `params.uri` expected
  string, got undefined) — the SDK's `resources/read` request is
  uri-keyed by protocol, `name` is listing/display-only. This is real,
  new evidence gathered this iteration, not reasoning from memory or the
  source comments alone.
- **Precedent search performed before scoring (per this iteration's
  explicit standing instruction, applied rigorously):** searched
  `provenance.md` and prior iteration reports for the closest analogous
  case. Found iteration 29's QN-039 to be directly on point: both are
  test-coverage-closure tasks (adding a regression assertion for
  existing, unchanged, already-correct behavior), and QN-039 held all
  four V_instance factors flat with the explicit reasoning "tested
  existing schema-conformant branches, it did not add or change any
  schema." Also checked `abi_symmetry`'s own historical move pattern
  (iterations 1, 2, 3, 10, 13) — every past `abi_symmetry` increase
  corresponded to a **new** value-level CLI/MCP schema-equivalence proof
  being established for the first time (e.g. iteration 13's `task_check`
  becoming the fourth ABI surface proven symmetric). QN-041's fact (uri-
  keyed, not name-keyed lookup) is a pre-existing, unchanged property of
  the MCP SDK itself — not a new surface `quay` built or changed — so it
  does not fit that pattern either. Concluded: QN-039's precedent
  applies, not `abi_symmetry`'s.

## 4. Strategy

One feature increment chosen: close DESIGN.md §2.5's third named gap as
QN-041, a leaf task, driven through the full native `todo → ready → done`
lifecycle via `quay:author` + `quay:execute`'s documented methods, in the
same same-session degraded-fallback mode established since iteration 1
(reconfirmed via `ToolSearch`, not re-assumed). The task's own Proposal
states its expected V-factor impact (flat, per the QN-039 precedent) up
front, rather than scoping ambiguously and deciding post-hoc which factor
"feels right" — directly applying this iteration's standing instruction.

## 5. Execution

1. Wrote `tasks/QN-041.md`'s Proposal (citing the live probe above),
   Plan, AC, DoD. `quay-native task check QN-041 --json` confirmed the
   `author->ready` gate `ok:true` (all four artifact sections present,
   AC checkboxes checked per this project's authoring-time
   self-verification convention since QN-019/iteration 8) before `task
   edit --status ready`.
2. Extended `packages/quay/test/mcp-server.test.mjs`'s existing
   "Resource enumeration" block (block 2) with 5 new assertions:
   - `listResources()`'s default-alias entry carries `name: "manifest"`.
   - Its per-Provider entry carries `name: "manifest-native"`, distinct
     from `uri: "provider://manifest/native"`.
   - The two fields are genuinely different strings (not the same value
     under two keys).
   - `readResource({ name: "manifest" })` (uri omitted) rejects rather
     than silently succeeding or resolving the wrong resource.
   - (Existing assertions below, unchanged.)
3. Updated the file's own header comment to describe the new coverage
   and cite the closed DESIGN.md gap.
4. **Adversarial break/restore cycle** (this project's established TDD
   discipline for proving a new test has teeth, not merely passing by
   coincidence): edited `packages/quay/src/mcp-server.js` to make the
   per-Provider resource's registered `name` collide with its `uri`
   (`` `provider://manifest/${id}` `` instead of `` `manifest-${id}` ``).
   Re-ran the test: **exactly 2 live FAILs** (the two new distinctness
   assertions), all pre-existing and other new assertions still PASS.
   Restored from `/tmp/mcp-server.js.bak`; `diff` confirmed
   byte-identical restoration; re-ran: all PASS again, zero regressions.
5. Updated `packages/quay/DESIGN.md` §2.5: struck through the closed gap
   entry, added a closure note citing this task, the new assertions, and
   the adversarial break/restore result.
6. Checked all 4 AC boxes and all 4 DoD boxes on `tasks/QN-041.md`, each
   independently re-verified against the actual command output/test
   results captured above (not "should work" reasoning) before checking.
7. `quay-native task check QN-041 --json` confirmed the `execute->done`
   gate `ok:true, acChecked:4/4`; `task edit --status done`.
8. **Full regression suite, final re-run:** all 19 `*.test.mjs` files +
   `abi-symmetry.mjs` — **20 total test-bearing files, all PASS, zero
   regressions.** `ps aux | grep -i quay` confirmed no orphaned
   test-spawned subprocesses; the one live `node packages/quay/bin/
   quay.js mcp` process is the genuinely-registered `.mcp.json`
   project-scoped MCP server from iteration 28.
9. `git diff --stat` confirmed only `packages/quay/test/
   mcp-server.test.mjs` (41 insertions/deletions) and `packages/quay/
   DESIGN.md` (14 insertions/deletions) changed among tracked production/
   doc files — **zero diff to `mcp-server.js` itself**, matching the
   task's own DoD claim.

## 6. Provenance update

`experiment/provenance.md` updated with a new "Records (as of end of
iteration 30)" section and a fresh "σ computation — iteration 30"
section.

```
σ (strict reading)
  = (# tasks with author_by = execute_by = gate_by = native AND status = done) / (total tasks)
  = 33 / 40
  = 0.8250

σ (inclusive reading — adds QN-003, QN-004)
  = 35 / 40
  = 0.8750

σ_author_only = 39 / 40 = 0.9750
```

Total task count is now **40** (QN-001..QN-041, minus the never-allocated
QN-018) — 1 new task created and completed this iteration.

**σ (strict) = 0.8250, up from 0.8205 at the end of iteration 29 (Δσ =
+0.0045).** Smaller than iteration 29's own +0.0097 (which completed two
tasks against a 39-task denominator); this iteration completed one task
against a now-larger 40-task denominator — an honest consequence of
denominator growth, not a change in method or pace.

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

- **skeleton: 0.67 (unchanged).** QN-041 added test coverage and a
  `DESIGN.md` documentation update only — `git diff --stat` confirms
  zero change to `mcp-server.js`'s own runtime behavior (the `name`
  field it asserts on already existed since QN-036/iteration 26). No new
  capability was constructed. Held flat.
- **abi_symmetry: 0.94 (unchanged).** `abi-symmetry.mjs` re-run fresh,
  unchanged, still "ALL FOUR SURFACES SYMMETRIC." QN-041 did not add or
  change any CLI/MCP schema — it proved a pre-existing, unchanged
  protocol-level fact (uri-keyed, not name-keyed resource lookup) that
  the MCP SDK itself already enforced. Per this iteration's precedent
  search (§3 above), every historical `abi_symmetry` increase corresponds
  to a **new** symmetry surface being established for the first time;
  this task established no new surface, so it does not qualify. Held
  flat — deliberately, having checked and rejected the tempting
  surface-level match ("this touches MCP resources") against the
  factor's actual historical scoring pattern.
- **gate_correctness: 0.76 (unchanged).** Zero diff to `store.js`'s or
  `github-client.js`'s own gate logic this iteration.
- **skill_convergence: 0.96 (unchanged).** QN-041 was driven through the
  same leaf-task, degraded-fallback author→execute lifecycle every prior
  ordinary task has used. Per the precedent iterations 26/28/29
  established for their own analogous single-ordinary-task iterations, an
  ordinary task driven to a green gate via the already-converged
  `quay:author`/`quay:execute` procedure is not new evidence about Skill
  *convergence* itself; it is the already-converged procedure being
  applied again. Held flat.

```
V_instance = 0.67 × 0.94 × 0.76 × 0.96 = 0.4595
```

ΔV_instance = **0.0000** (unchanged). Honestly flat, for the fifth
consecutive iteration (26-30): this iteration's genuine work (one closed
DESIGN.md-named test-coverage gap, live-probe-verified before being
claimed) does not land inside any of the four precisely-defined
V_instance factors as this experiment has consistently, precedent-
checked, scored them.

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness: 0.74 (unchanged).** QN-041 touched
  `packages/quay/test/mcp-server.test.mjs` and `packages/quay/
  DESIGN.md` — neither is `quay:author`/`quay:execute`'s own SKILL.md
  Method-step content, the exact scope protocol §5.2 sets for this
  factor and the exact scope the corrected iteration-29
  post-hoc-correction reaffirmed. Applying that just-corrected precedent
  directly (not merely citing it in the abstract): held flat.
- **effectiveness: 0.26 (unchanged).** QN-041 is test-authoring/probe/
  debugging work (write a probe script, extend a test file, run an
  adversarial break/restore cycle), not Skill-orchestration-timing-shaped
  work comparable to the stage-0 QN-006 baseline (~2m59s). Remains the
  honest, unmeasured ceiling, now for **9 consecutive iterations (21-29,
  and now 30)**.
- **reusability: 0.79 (unchanged).** `git diff --stat -- packages/
  quay-native packages/quay-github` is **empty** for this iteration's
  work (confirmed both before and after QN-041's execution) — zero
  Provider-side capability-construction event; QN-041 is Core-only work.
  Per protocol §5.2's precise scoping ("the methodology transfers to a
  second Provider... measured on the transfer target only"), there is
  nothing to credit here. Held flat for the fifth consecutive iteration
  (26-30).
- **validation: 0.64 (unchanged).** Per standing convention, credited
  only after the out-of-band audit for **this iteration's own work**
  occurs — which happens after this report is committed, via the
  top-level orchestrator's separate `Agent` dispatch (G3). Correctly held
  flat pending that audit, not self-simulated.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged from iteration 29's corrected value).
QN-041's genuine contribution (a real, previously-untested MCP-protocol
fact, now demonstrated and captured as a committed regression assertion)
stands on its own merits as instance-layer test-coverage improvement —
per protocol §5.2's precise scoping and this project's established,
just-reaffirmed precedent, it does not move any V_meta factor.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool.

`experiment/audits/iteration-29-independent-adjudicate.md` (read in full
at the start of this session) remains the most recent independent audit;
it returned PASS WITH CONCERNS with one substantive finding (the
`completeness` overclaim), already corrected in `provenance.md` and
`iteration-29.md` before this iteration began.

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether QN-041's live probe (run before the Proposal was written) and
   its adversarial break/restore cycle genuinely reproduce as described
   — specifically, whether an independent re-run of the exact same
   break (`` `manifest-${id}` `` → `` `provider://manifest/${id}` ``)
   produces exactly 2 FAILs as claimed, and whether the restored file is
   genuinely byte-identical to the pre-break version (verifiable via
   `git diff` against the committed `mcp-server.js`, since it is
   unchanged from HEAD by this iteration's own claim).
2. Whether holding `abi_symmetry` flat for this task is the correct call
   — this report's own §7 explicitly names and rejects the tempting
   surface-level match ("this touches MCP resources, so credit
   abi_symmetry") in favor of a precedent-based rejection; an independent
   reviewer should check whether that precedent-search reasoning holds up
   or whether a case exists for treating "closing a previously-unproven
   protocol-boundary fact" as a legitimate abi_symmetry-qualifying event
   distinct from what iterations 1/2/3/10/13 did.
3. Whether `git diff --stat` genuinely shows zero change to
   `mcp-server.js` (the DoD's central scope claim) — independently
   reproducible via `git show <this-iteration's-commit> --stat`.
4. Independent re-run of the full regression suite (20 test-bearing
   files) to confirm zero regressions, matching this report's claim.
5. `git status --short` should show a clean working tree at audit time
   (confirmed clean at the end of this session, re-confirmed after
   commit, per §10 below).

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** — **NO.**
      V_instance = 0.4595 (unchanged), V_meta = 0.0973 (unchanged). Both
      remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate)** — **NO.** σ (strict) = 0.8250, up from 0.8205, still far
      from 1. No `quay:author`/`quay:execute` Method-step content changed
      this iteration; no gate logic changed. Remains NO for the same
      standing reason (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **NO,
      unchanged from iteration 29's own characterization.** This
      iteration's work is entirely Core-side (native + the Core's own
      MCP server); it does not touch the native/GitHub Provider-transfer
      question at all, and does not close the specific remaining gap
      (a real Claude Code session's own `ToolSearch`/tool-call
      discovering and invoking `quay`'s tools) — unchanged, and, per
      explicit instruction, not attempted this iteration.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** — **YES as
      literally worded, now for a 3-iteration run (28, 29, 30).**
      ΔV_instance = 0.0000 this iteration (< 0.02) and ΔV_meta = 0.0000
      this iteration (< 0.02); iterations 28 and 29 both also had
      ΔV_instance = ΔV_meta = 0.0000 (29's corrected value). Same
      caveat as iteration 29 recorded, now with one more iteration of
      supporting (or rather, non-disconfirming) evidence: this reflects
      a value function pinned near its own floor across five
      structurally "housekeeping/test-coverage-closure"-shaped
      iterations (26-30), not a system approaching its 0.80 threshold
      and leveling off there. Recorded honestly as criterion-5-as-
      literally-stated being met for a third consecutive iteration,
      while continuing to flag (per iteration 29's own item 4, not yet
      resolved by any process empowered to resolve it) that this alone
      does not indicate approaching convergence given criteria 1-4 all
      remain clearly NO.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met for a third consecutive
iteration — but this alone does not approach convergence given criteria
1-4 all remain far from satisfied, and the near-zero ΔV continues to
reflect a value function pinned near its own floor across five
consecutive iterations of genuinely quiet, honestly-scoped
housekeeping/test-coverage work, not genuine convergence-approach
behavior. Overall convergence requires all 5 criteria; 4 of 5 are
unambiguously NO.

## Problems identified for next iteration

1. **The real-Claude-Code-session MCP-client tool-use gap remains open,
   unchanged.** Same framing as iterations 28-29's problem #1: whichever
   session starts fresh against this repo next should, as one of its
   first actions, approve the pending `quay` MCP server and check its own
   `ToolSearch` output for `quay`-related tools before any other tool
   use — genuinely closing this gap if `quay`'s tools surface, honestly
   reporting if they do not. This session's own `ToolSearch` again found
   nothing quay-related (expected, structural, not a new finding).
2. **`effectiveness` remains at its honest ceiling (0.26)**, now for 9
   consecutive iterations (21-29, and now 30). QN-041 was not
   Skill-orchestration-timing-shaped work. A future iteration should
   explicitly capture wall-clock timestamps bracketing genuinely
   Skill-orchestration-shaped work, comparable to the stage-0 QN-006
   baseline (~2m59s), if and when such work naturally arises from the
   backlog — not manufactured solely to move this factor.
3. **`reusability` was deliberately held flat this iteration**, for the
   fifth consecutive iteration (26-30) — `git diff --stat` against
   `packages/quay-native`/`packages/quay-github` was empty. The single
   iteration-25 data point remains the only such move in this ledger. A
   future iteration should watch for genuine GitHub-Provider-side work
   (not native-only or Core-only work) as the next legitimate
   opportunity to move this factor, without inventing one.
4. **`packages/quay/DESIGN.md` §2.5's three named gaps are now down to
   two**: (a) the real Claude-Code-session stdio transport lifecycle
   (structural, tracked as problem #1 above) and (b) `task_write`'s CAS
   option not specifically exercised through the Core MCP path
   (explicitly named as low-risk/low-priority in the source; a candidate
   for a future iteration if no higher-value gap is found first, but not
   scoped or pursued this iteration to avoid manufacturing low-value work
   merely to show movement).
5. **Criterion 5's "2+ iterations" wording is now literally satisfied
   for 3 consecutive iterations (28-30), with the value function still
   pinned near its own floor.** The tension flagged in iteration 29's
   problem #4 (whether protocol §7 should be read as "diminishing
   returns" alone or "diminishing returns AND some proximity to
   threshold") remains unresolved by any process empowered to resolve
   it — this report continues to name it honestly rather than
   unilaterally reinterpreting the protocol's plain wording.
6. **No new pending directive exists as of the end of this iteration**
   (`experiment/directives/pending/` is empty). A future iteration's
   first priority, per standing convention, should be problem #1 above if
   still unresolved, or a fresh OBSERVE-phase search of the kind this
   iteration performed (checking `DESIGN.md`/source-comment-named gaps
   directly) if problem #1 remains structurally unactionable.
