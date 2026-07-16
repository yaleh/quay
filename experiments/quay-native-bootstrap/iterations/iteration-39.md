# Iteration 39: correct `quay-native-design.md` §8's stale "Open decisions" (QN-050)

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work; `experiments/quay-native-bootstrap/directives/pending/` empty)
**Stage**: 2+ (native and GitHub Providers both exist; this iteration's work is a documentation-accuracy fix to the shared native design document)

## 1. Context from prior iteration

Iteration 38 ended with: σ (strict) = 41/48 = 0.8542, V_instance = 0.4903
(0.70 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (flat many iterations), all 5
convergence criteria scored NO. Iteration 38's own independent audit
(`experiments/quay-native-bootstrap/audits/iteration-38-independent-adjudicate.md`) returned a
clean **PASS** — zero corrections needed, extending the clean-audit streak
to two consecutive iterations (37, 38). Iteration 38's "Problems identified
for next iteration" named, as fresh candidate sources: (1) reusing the
systematic drift-detection technique (re-reading each Provider's own
`provider.yml`/`DESIGN.md` for capability-scope claims that predate a
later capability-expanding iteration) against `packages/quay/DESIGN.md`
next; (2) continuing to look for genuinely Skill-orchestration-timing-
shaped work to break `effectiveness`'s 18-consecutive-iteration plateau
(0.26); (3) considering whether a genuinely new GitHub-Provider capability
increment is overdue to move `reusability`, flat for 13 consecutive
iterations (26-38).

Seven post-hoc corrections exist in `experiments/quay-native-bootstrap/provenance.md` prior to
iteration 37, all tracing to the same root cause: citing a precedent
without actually reading that iteration's real content this session.
Iterations 37 and 38 both broke this pattern with clean PASS audits,
having actually read cited precedents in full and explicitly searched for
closer alternatives before settling on one. This iteration continues that
discipline throughout, extending the target streak to three.

## 2. Preconditions checked

- `manda` daemon live for this workspace: confirmed via `ps aux | grep
  manda` (daemon processes present on ports 21471 and 28912, both with
  active `mcp`/`mcp-dispatch`/`mcp-tools` child processes).
- `gh` CLI authenticated as `yaleh` with `repo`+`workflow` (and additional)
  scopes: confirmed via `gh auth status`.
- `experiments/quay-native-bootstrap/directives/pending/` confirmed **empty** via `ls` (mandatory
  first step, re-checked per instructions — re-verified again at the start
  of this session, not assumed from the task prompt's own claim).
- Full regression suite (24 `*.test.mjs` files across all three packages,
  plus `abi-symmetry.mjs`) re-run at the start of this iteration to
  confirm a clean starting baseline: all pass, "ALL FOUR SURFACES
  SYMMETRIC."
- `git status --short` confirmed clean at the start of this iteration
  (modulo the pre-existing, deliberately-untouched
  `docs/proposal/baime-lite-driving-external-projects.md`).
- `ls tasks/QN-*.md | wc -l` confirmed 48 tasks at the start of this
  iteration (matching iteration 38's own tally).
- `experiments/quay-native-bootstrap/audits/iteration-38-independent-adjudicate.md` read in full:
  confirmed **Verdict: PASS**, no correction required.

## 3. Observe

Per iteration 38's own problem list item #1, this iteration first
attempted a fresh, exhaustive read of `packages/quay-native/DESIGN.md` —
confirmed via `ls packages/quay-native/*.md` that this file **does not
exist** (consistent with iterations 36 and 38's own prior finding, not
newly discovered). `packages/quay/DESIGN.md` (375 lines) was then read in
full, fresh, and cross-checked against live code:

- Core's six registered MCP tools (`task_list`, `task_get`, `task_write`,
  `task_check`, `action_list`, `action_run`, confirmed via `grep
  registerTool`) match the document's own §2.2/§4.2 accounting exactly.
- The CLI dispatch table (`bin/quay.js`, read in full) matches the
  document's own capability-set claims exactly, including the explicit
  "task edit/task check out of scope for Web UI" claim (§4.1), confirmed
  consistent with `serve.js` (no edit/check handling found there).
- Every "Known gaps" entry in §2.5 was checked: two are marked closed with
  citations (QN-038/QN-047, QN-043, QN-041) matching actual code; the one
  remaining open item (a fresh session's tool-use without
  `--dangerously-skip-permissions` requiring human interactive approval)
  is honestly inherently unclosable from a non-interactive harness, not
  stale.

**No staleness was found in `packages/quay/DESIGN.md`.** The productive
lead instead came from re-reading `docs/proposal/quay-native-design.md`
(171 lines, read in full) — the single authoritative cross-package design
document every Skill, gate, and prior iteration's own reasoning cites as
"design §N" (`author/SKILL.md`, `execute/SKILL.md`, `store.js`'s own
header comments, `quay-github/DESIGN.md`'s cross-references all cite it) —
and checking its §8 ("Open decisions") against actual, current code state
rather than assuming it remained accurate.

All five items listed as "open" were found, on direct verification, to
already be resolved — each by its own recommended option — and exercised
in the shipped codebase for many iterations:

1. **Storage format** (markdown+frontmatter vs. fresh schema) → resolved:
   markdown+frontmatter, confirmed via `packages/quay-native/src/store.js`
   and every task file's actual on-disk shape.
2. **`needs-human`** (status vs. label) → resolved: kept as a real status,
   confirmed via `store.js`'s `VALID_STATUSES` constant (line 13) and
   `execute/SKILL.md`'s own Gaps section documenting QN-017, QN-020/021,
   QN-022/023 as genuine exercises of this status.
3. **manda-absent fallback** (sync-inline vs. print-command) → resolved:
   both, confirmed via `packages/quay/src/action.js`'s own header comment
   documenting and implementing the full three-tier chain.
4. **`quay:execute` epic branch** (dispatch vs. wait vs. both) → resolved
   as the recommended "both": confirmed via `execute/SKILL.md`'s
   `executeEpic` pseudocode (`driveEach`) and its own Gaps section citing
   iterations 5, 8, 9, and 27 as genuine exercises.
5. **Operation-Skill roster** (standalone `decompose` vs. folded) →
   resolved as the recommended "folded": confirmed via `author/SKILL.md`
   step 4's explicit text and the absence of any standalone `decompose`
   Skill file (`ls packages/quay-native/skills/` shows only `author/` and
   `execute/`).

**This is a real gap, not a fabricated one** — verified via direct
inspection of the actual current source files for all five items (not
assumed from memory of any prior iteration's summary), and independently
corroborated by a `git log` search that surfaced commit `199cd9d` ("Fix
stale Provider-ABI wording in glossary.md and quay-proposal.md," dated
between iterations 31 and 32) — the same class of top-level-proposal-doc
staleness fix, performed once before in this experiment's history but
never logged in `provenance.md` or credited to any V-factor. This
corroborates, from an independent source, the conclusion reached below
about how this class of fix should be scored.

## 4. Strategy

The gap is narrow, real, and unambiguous, the same shape as QN-049
(iteration 38) one level up: correct the stale "open decision" prose in
`docs/proposal/quay-native-design.md` §8 to record each item's actual,
already-made and already-exercised resolution — no new code, no new test,
a pure documentation-accuracy fix. Scoped as a single task (QN-050), one
action, one proof:

1. Re-verify all five items against current code/state, with concrete
   file/line citations for each (done in §3 above).
2. Rewrite §8 to mark each item RESOLVED, keeping the original
   question framing intact (so a reader can see what was asked and how it
   was answered) — matching QN-049's own precedent of correcting in place
   rather than deleting history.
3. Re-run the full regression suite and confirm zero `.js`/`.yml` diff.

This was authored and driven through `quay-native`'s own CLI lifecycle
(`task create` / body write / `task check` / `task edit --status ready` /
`task edit --status done`) with `task check` gated at both transitions,
per the standing "native" convention (see §6 for the honesty note on what
that does and does not mean).

## 5. Execution

`docs/proposal/quay-native-design.md` (171 lines) was read in full.
`packages/quay-native/skills/author/SKILL.md` (172 lines) and `packages/
quay-native/skills/execute/SKILL.md` (326 lines) were both read in full to
verify items 4 and 5's resolutions directly against the Skills'
own text, not merely assumed.

`tasks/QN-050.md` was created via `quay-native task create`, with the body
written via a direct call to the same `store.write()` function `task edit
--body` itself invokes (used only because the body's length made a
single shell-flag invocation awkward — confirmed to be the identical code
path, not a different or hand-edited mechanism). The body contains a full
Proposal/Plan/AC/DoD (5 AC items, one per open-decision item; 4 DoD
items), citing the exact stale §8 language, the concrete file/line
evidence for each resolution, and the `git log` evidence for the
independent `199cd9d` precedent.

**Live re-verification, performed and cited before any edit** (see §3
above for the per-item evidence).

`docs/proposal/quay-native-design.md` §8 was then edited in place: a new
lead-in paragraph explains the update; each of the five original
bullet points is kept verbatim, with a new **RESOLVED** line appended
directly beneath it citing the concrete evidence.

**Diff-scope verification:**

```
$ git diff --stat
 docs/proposal/quay-native-design.md | 37 +++++++++++++++++++++++++++++++++++++
 1 file changed, 37 insertions(+)

$ git diff --stat -- '*.js' '*.yml'
(empty)
```

Confirms zero source/config-code change — a pure documentation fix.

**Full regression suite**, run after the edit: all 24 `*.test.mjs` files
across all three packages exit 0; `node packages/quay-native/test/
abi-symmetry.mjs` reports "ALL FOUR SURFACES SYMMETRIC." Zero regressions.

`tasks/QN-050.md` was gated `todo → ready` via `task check`: `ok:true` (all
four artifacts present). All 5 AC checkboxes were independently
re-verified (each against the actual file/line evidence cited above, not
"should be true" reasoning) before being checked, then gated `ready →
done`: `ok:true` (5/5 AC checkboxes checked). All 4 DoD checkboxes were
similarly independently re-verified (diff-scope command output, full
regression-suite exit codes, both gate-check JSON outputs, and this
report's own honest V-factor accounting) before being checked.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` updated with a new "Records (as of end of
iteration 39)" section (task ledger row for QN-050, the honesty note on
QN-050's lifecycle execution), a new "σ computation — iteration 39"
section, and a new "V-factor attribution — iteration 39" section — all
detailed in §7/§8 below and written into `provenance.md` directly.

σ before this iteration: 41/48 = 0.8542. σ after: 42/49 = 0.8571 (Δσ =
+0.0030). See `provenance.md`'s own σ-computation section for the full
breakdown (inclusive and author-only diagnostic readings included).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

Per the standing discipline, the precedent search this iteration found:

- **Iteration 29's post-hoc `completeness` correction** is the closest
  precedent for the meta-layer question (see §8 below); for the
  instance-layer factors, `git diff --stat -- '*.js' '*.yml'` directly
  confirms zero source/config-code change — no new route, action, gate
  transition, capability, or CLI/MCP schema-equivalence proof was
  produced. `skeleton`, `abi_symmetry`, and `gate_correctness` are each
  explicitly ruled out on this direct evidence alone, without needing a
  precedent chain: the protocol's own defining language for each
  ("the v0 loop runs end-to-end"; "CLI ... emits the same schema as ...
  MCP tool result"; "does `quay-native task check` correctly assert the
  gate") all require actual code/behavior change or a new
  cross-surface proof, neither of which occurred.
- `skill_convergence` was considered: no `quay:author`/`quay:execute`
  SKILL.md Method-step content changed this iteration (both SKILL.md
  files were read in full to verify §8's claims about them, but neither
  was edited — `git diff --stat` confirms no `skills/` path in the diff).
  Not implicated.

```
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903
```

ΔV_instance = **0.0000** (unchanged from iteration 38).

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **Iteration 29's post-hoc `completeness` correction** (read in full this
  iteration, not merely cited from memory): iteration 29's original
  `completeness` credit for revising `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` was
  corrected to flat, because "`completeness` is protocol-scoped (§5.2) to
  `quay:author`/`quay:execute`'s own documented methodology, not this
  experiment's own iteration-guidance document," with iteration 10's own
  identical precedent cited directly. `docs/proposal/
  quay-native-design.md` is the shared design document those Skills
  implement against — not a SKILL.md file itself — and this task
  documents already-made, already-exercised decisions; it adds no new
  Skill-orchestration Method-step content. Per this established
  precedent, `completeness` is not the right factor, even though this
  task is unambiguously a documentation-accuracy fix in spirit (matching
  QN-049/iteration 38's own identical conclusion for the sibling
  `provider.yml`/`DESIGN.md` fix one level down). Held **flat (0.74)**.
- A second, independent corroborating precedent was found this iteration
  by searching `git log` directly (not just `provenance.md`): commit
  `199cd9d` performed the identical class of fix (stale wording in
  `glossary.md`/`quay-proposal.md`, dated between iterations 31 and 32)
  and was never logged in `provenance.md` nor credited to any V-factor —
  independent, out-of-band confirmation that this class of fix has
  consistently not been scored.
- **effectiveness: 0.26 (unchanged).** QN-050's own timing was recorded
  (`experiments/quay-native-bootstrap/timing/iteration-39.log`: task-create→execute-done span
  ~2m52s/172s) for completeness, but this is a documentation-only task
  with no code change — not a candidate for the scope-matched-timing
  comparator established at iterations 21-23 (which requires a
  code-change task comparably scoped to the stage-0 baseline). No attempt
  was made to force this into an effectiveness data point. Remains the
  honest, unmeasured ceiling, now for **19 consecutive iterations (21-38,
  and now 39)**.
- **reusability: 0.79 (unchanged).** Protocol §5.2 scopes this to "the
  methodology transfers to a second Provider (GitHub) unmodified." This
  task touches neither Provider's capability set — only the native design
  document's own §8. Held flat for the **fourteenth consecutive iteration
  (26-39)**.
- **validation: 0.64 (unchanged).** Per standing convention, credited only
  after the out-of-band audit for this iteration's own work occurs (next
  iteration, via the top-level orchestrator's separate `Agent` dispatch,
  G3). Correctly held flat pending that audit, not self-simulated.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged). QN-050's genuine contribution — closing
a real staleness in the single most-cited design document in the
codebase, so that all five of its "Open decisions" now accurately reflect
decisions actually made and exercised rather than misleadingly appearing
still-open — does not move any of the eight V-factor axes, per the
directly on-point precedent (iteration 29) and its independent
corroboration (`199cd9d`) applied above. This is a real and valuable fix
that is not automatically forced into one of the eight precisely-scoped
V-factor axes when the evidence does not support it, matching the
discipline already established at iterations 25, 28, 29, 37, and 38.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool. This session
did not attempt to self-obtain or simulate any such audit.

`experiments/quay-native-bootstrap/audits/iteration-38-independent-adjudicate.md` remains the
most recent independent audit of this experiment's iteration work (a
clean PASS with zero corrections needed, the second consecutive clean
audit after iteration 37).

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether the claimed resolution of each of `quay-native-design.md` §8's
   5 items is accurate — an independent reviewer should re-derive each
   citation directly (`store.js`'s `VALID_STATUSES`, `action.js`'s header
   comment, `execute/SKILL.md`'s `driveEach` pseudocode and Gaps section,
   `author/SKILL.md` step 4's text, and the absence of a standalone
   `decompose` Skill file) rather than trusting this report's own
   restatement.
2. Whether holding all eight V-factors flat is correct, given the
   iteration-29 precedent cited and the independent `199cd9d`
   corroboration — an independent reviewer should re-read iteration 29's
   correction in full and independently confirm `199cd9d`'s existence,
   date, and scoring (absence from `provenance.md`) via `git log`/`git
   show` directly.
3. Independent re-verification that `git diff --stat -- '*.js' '*.yml'` is
   empty (zero source/config-code change) and that the full regression
   suite (24 `*.test.mjs` files plus `abi-symmetry.mjs`) genuinely passes
   unchanged after this iteration's edit.
4. `git status --short` should show a clean working tree at audit time,
   modulo the one pre-existing, deliberately-untouched
   `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.4903 (unchanged), V_meta = 0.0973 (unchanged).
      Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set
      + gate)** — **NO.** σ (strict) = 42/49 = 0.8571, up from
      41/48 = 0.8542, still far from 1. No `quay:author`/`quay:execute`
      Method-step content changed this iteration; no gate logic changed.
      Remains NO for the same standing reason (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 38's framing. This iteration's work
      corrects a documentation-accuracy defect in the shared native design
      document (not a capability change, not new evidence of "both run"),
      so it does not itself move criterion 3's own characterization
      further.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES**, now for a fifth consecutive iteration
      (ΔV_instance = ΔV_meta = 0.0000 this iteration, 0.0000 at iteration
      38, +0.0070 at iteration 37 — all < 0.02). **Scored NO on
      substance**, consistent with this experiment's standing practice
      (iterations 28-38): a small/flat ΔV sitting far below the 0.80 dual
      threshold on both axes reflects a value function genuinely pinned
      near its own floor, not a system approaching convergence and
      leveling off there. Criteria 1-4 remain clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met for a fifth consecutive
iteration but scored NO on substance for the reasons above. V_instance
(0.4903) and V_meta (0.0973) remain far below the 0.80 dual threshold on
both axes.

## Problems identified for next iteration

1. **A fresh source of self-selected work will again be needed** for the
   next iteration if `directives/pending/` is again empty. This
   iteration's gap (stale `quay-native-design.md` §8 "Open decisions") is
   now closed; the systematic drift-detection technique (re-reading a
   design/config document in full and checking its claims against current
   code state, rather than assuming currency) has now found genuine gaps
   twice in a row (iterations 38, 39) and should be tried again — remaining
   untried targets include `docs/proposal/quay-proposal.md`'s own body
   (beyond the terms-table fix already made in `199cd9d`) and
   `docs/proposal/glossary.md` in full.
2. **`effectiveness` remains at its honest ceiling (0.26)**, now for 19
   consecutive iterations (21-38, and now 39) — the single longest-flat
   V_meta factor in the experiment's history. No genuinely
   Skill-orchestration-timing-shaped, code-changing task arose naturally
   this iteration either; per explicit instruction, none was fabricated to
   force a break in this plateau.
3. **`reusability` remains flat**, now for the fourteenth consecutive
   iteration (26-39). No genuinely new GitHub-Provider capability
   increment has been scoped since iteration 25 (QN-035) — a future
   iteration should consider whether one is overdue, rather than
   continuing to find test-coverage/documentation-accuracy-only gaps.
4. **This iteration's precedent-matching to iteration 29, and its
   independent corroboration via `199cd9d`, is itself the most
   audit-sensitive claim in this report** (see §9 point 2) — a future
   iteration should not treat this iteration's own reasoning as settled
   precedent until the next independent audit has reviewed it.
5. **The top-level proposal documents (`quay-proposal.md`,
   `quay-bootstrap-experiment.md`, `quay-native-design.md`) all still
   carry a `**Status:** Draft (pre-implementation)` header line**,
   noted but deliberately NOT edited this iteration (out of this task's
   narrow §8 scope, per the Plan's own step 3) — a future iteration should
   consider whether this is itself a staleness worth a dedicated,
   narrowly-scoped fix, while being aware that per this iteration's own
   `199cd9d` precedent, such a fix would likely also hold all eight
   V-factors flat.
