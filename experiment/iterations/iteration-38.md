# Iteration 38: fix stale `provider.yml`/`DESIGN.md` compound/epic scope comments (QN-049)

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work; `experiment/directives/pending/` empty)
**Stage**: 2+ (native and GitHub Providers both exist; GitHub-Provider-side documentation-accuracy fix this iteration)

## 1. Context from prior iteration

Iteration 37 ended with: σ (strict) = 40/47 = 0.8511, V_instance = 0.4903
(0.70 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (flat many iterations), all 5
convergence criteria scored NO. Iteration 37's own independent audit
(`experiment/audits/iteration-37-independent-adjudicate.md`) returned a
clean **PASS** — zero corrections needed, confirming iteration 37's
factor-attribution reasoning was correct on the merits. Iteration 37's
"Problems identified for next iteration" named, as fresh candidate
sources: (1) reusing the systematic cross-package test-coverage-gap grep
technique for a fresh candidate; (2) re-checking whether any fresh gap has
emerged in `packages/quay/DESIGN.md`/`packages/quay-github/DESIGN.md`; (3)
continuing to look for genuinely Skill-orchestration-timing-shaped work to
break `effectiveness`'s 17-consecutive-iteration plateau (0.26); (4)
considering whether a genuinely new GitHub-Provider capability increment
is overdue to move `reusability`, flat for 12 consecutive iterations
(26-37).

Seven post-hoc corrections exist in `experiment/provenance.md` prior to
this iteration (iterations 25, 29, 31, 33, 34, 35, and the
iteration-36-internal correction), all tracing to the same root cause:
citing a precedent without actually reading that iteration's real content
this session. Iteration 37 broke this streak with a clean PASS audit,
having actually read iteration 24's full text before citing it and
explicitly checking for closer alternative precedents. This iteration
follows that same discipline throughout.

## 2. Preconditions checked

- `manda` daemon live for this workspace: confirmed via `ps aux | grep
  manda` (daemon processes present on ports 21471 and 28912, both with
  active `mcp`/`mcp-dispatch`/`mcp-tools` child processes).
- `gh` CLI authenticated as `yaleh` with `repo`+`workflow` (and additional)
  scopes: confirmed via `gh auth status`.
- `experiment/directives/pending/` confirmed **empty** via `ls` (mandatory
  first step, re-checked per instructions).
- Full regression suite (24 `*.test.mjs` files across all three packages,
  plus `abi-symmetry.mjs`) re-run at the start of this iteration to
  confirm a clean starting baseline: all pass, "ALL FOUR SURFACES
  SYMMETRIC."
- `git status --short` confirmed clean at the start of this iteration
  (modulo the pre-existing, deliberately-untouched
  `docs/proposal/baime-lite-driving-external-projects.md`).
- `ls tasks/QN-*.md | wc -l` confirmed 47 tasks at the start of this
  iteration (matching iteration 37's own tally).
- `ls packages/quay-native/*.md` re-confirmed no `DESIGN.md` exists for
  `quay-native` (matching iteration 36's finding — not re-derived from
  memory).

## 3. Observe

Per the task instructions and iteration 37's own problem list, this
iteration performed a fresh, exhaustive read of `packages/quay-github/
DESIGN.md` (486 lines, read in full — not skimmed, not assumed from
memory of prior iterations' summaries) looking for any not-yet-closed gap.
`packages/quay-native/DESIGN.md` was re-confirmed not to exist (`ls
packages/quay-native/*.md` → only non-`DESIGN.md` files), consistent with
iteration 36's own finding.

The full read of `packages/quay-github/DESIGN.md` surfaced a genuine,
concrete, internal-consistency defect that had not been named or tracked
by any prior iteration's problem list: **§5's "Capabilities (v1.3)" block
and, separately, `packages/quay-github/provider.yml`'s own inline
comments both still described `gate` and `skill` as scoped to "primitive
tasks only,"** with `provider.yml`'s `gate:` comment explicitly stating
*"no compound/epic children-recursion — this experiment has never had a
real compound GitHub task."*

This claim is demonstrably false and has been false since **iteration 25
(QN-035, DIR-006)**, 12 iterations before this one: that iteration
implemented `childrenStatus()`-based compound/epic gate recursion in
`github-client.js`, created a real compound issue structure in the live
`yaleh/quay` repo (issues #5/#6/#7, still present in the repo today), and
live-verified the full compound gate path end-to-end. `DESIGN.md`'s own
§3.5/§3.6 sections document this accurately and in detail (they were
correctly updated at iteration 25 and have not drifted since) — but
neither `provider.yml`'s comments nor `DESIGN.md`'s own §5 capability
summary were ever back-ported to match, an honest oversight in an
otherwise-thorough iteration-25 update that updated the narrative sections
but missed the file's own capability-declaration block and the sibling
config file entirely.

**This is a real gap, not a fabricated one** — verified via three
independent checks, not assumed:
1. `git log --oneline -- packages/quay-github/provider.yml` shows exactly
   four commits, the most recent being iteration 18 (QN-029) — 20
   iterations of subsequent drift, unnoticed.
2. Live re-verification this iteration (`quay-github task check gh-7
   --json` and Core's `quay task check gh-7 --provider github --json`
   passthrough) both confirm the compound gate genuinely works today,
   directly contradicting the stale comment's claim.
3. `DESIGN.md`'s own top-of-document status line ("v1.4 implemented...
   gate... extended to compound/epic tasks by QN-035") already
   contradicts its own §5's "v1.3"/"primitive tasks only" text — an
   internal inconsistency within the same file, not just between files.

## 4. Strategy

The gap is narrow, real, and unambiguous: correct the stale prose in
`provider.yml` and `DESIGN.md` §5 to match the actual, already-implemented,
already-verified capability scope — no new code, no new test, a pure
documentation-accuracy fix. This was scoped as a single task (QN-049), one
action, one proof, per the standing "one action, one proof" discipline:

1. Live re-verify the compound gate against the real `gh-5`/`gh-6`/`gh-7`
   issues (already created by QN-035, still present) via both
   `quay-github`'s own CLI and Core's generic passthrough — first, before
   any edit, to have current, dated evidence in hand.
2. Correct `provider.yml`'s header comment and `gate:`/`skill:` capability
   comments to accurately cite QN-035/iteration 25/DIR-006 and the
   compound/epic scope.
3. Correct `DESIGN.md` §5's own "v1.3"/"primitive tasks only" block to
   match, and add a sentence confirming the capability *booleans*
   themselves were never wrong — only the comments describing them.
4. Re-run the full regression suite and confirm zero `.js` source diff.

This was authored and driven through `quay-native`'s own CLI lifecycle
(`task create`/`task edit --status ready`/`task edit --status done`) with
`task check` gated at both transitions, per the standing "native"
convention (see §6 for the honesty note on what that does and does not
mean).

## 5. Execution

`packages/quay-github/DESIGN.md` (486 lines) was read in full. `packages/
quay-github/provider.yml` (82 lines) was read in full. Both confirmed the
stale-comment defect described above.

**Live re-verification, performed first, before any edit:**

```
$ node packages/quay-github/bin/quay-github.js task check gh-7 --json
{
  "id": "gh-7", "gate": "none", "ok": true, "reason": "terminal",
  "childrenStatus": [
    { "id": "gh-5", "status": "done" },
    { "id": "gh-6", "status": "done" }
  ]
}

$ node packages/quay/bin/quay.js task check gh-7 --provider github --json
(byte-identical output, confirmed via direct comparison)
```

`tasks/QN-049.md` was created via `quay-native task create`, with a full
Proposal/Plan/AC/DoD body (4 AC items, 4 DoD items) naming the gap, citing
the exact stale language, the live re-verification evidence, and the
`git log` evidence that `provider.yml` had drifted unmaintained since
iteration 18. Gated `todo → ready` via `task check`: proceeded (author
artifacts all present).

`packages/quay-github/provider.yml` was edited: the header comment block
(v1 → v1.4, "primitive tasks only" removed, QN-035/iteration 25/DIR-006
cited) and the `gate:`/`skill:` capability comments (both rewritten to
state compound/epic support, citing the real `gh-5`/`gh-6`/`gh-7` fixture
still present in the repo as live evidence). The corrected text, quoted
verbatim:

```yaml
# provider.yml — the GitHub Provider's static self-declaration
# (quay-proposal.md §10, QN-002's Plan/AC). Travels with the Provider.
#
# v1.4 walking skeleton (G5): read + minimal status-only write (QN-024,
# iteration 10) + gate (QN-028, iteration 17, primitive tasks; extended to
# compound/epic tasks QN-035, iteration 25, DIR-006) + skill (QN-029,
# iteration 18: status_skill_map/action_buttons, backed by the
# now-provider-parameterized quay:author/quay:execute Skills — see
# packages/quay-native/skills/{author,execute}/SKILL.md's iteration-18
# honesty notes; this was NOT free — it required fixing a real hardcoded-
# to-quay-native limitation in those Skills first, not just this file).

...

  gate: true          # QN-028 (iteration 17): task_check, primitive tasks;
                     # extended to compound/epic (children non-empty) tasks
                     # by QN-035 (iteration 25, DIR-006) via a ported,
                     # recursive childrenStatus() — live-verified against a
                     # real compound issue structure (gh-5/gh-6/gh-7) still
                     # present in this repo; see DESIGN.md §3.5/
                     # github-client.js#checkGate.
  skill: true         # QN-029 (iteration 18): status_skill_map/action_buttons
                     # declared below, backed by the provider-parameterized
                     # quay:author/quay:execute Skills (`quay task <cmd>
                     # --provider github`, Core's existing generic
                     # passthrough — zero Core-side code change).
                     # executeEpic's compound recursion against this
                     # Provider was itself live-verified by QN-035's own
                     # gh-7 lifecycle drive (iteration 25); no longer scoped
                     # to primitive tasks only, matching `gate` above.
```

`packages/quay-github/DESIGN.md` §5 was edited to match: header bumped
"v1.3" → "v1.4" (aligning with the file's own top-of-document status
line, which already said v1.4), the `gate:`/`skill:` comment block
rewritten to match `provider.yml`'s corrected text, and a new sentence
added: "the booleans themselves were never wrong, but both this section's
own comments and `provider.yml`'s own inline comments had drifted stale
since iteration 25/QN-035."

**Verification after the edit:**

```
$ node packages/quay-github/bin/quay-github.js manifest --json
capabilities: {"data.read":true,"manifest":true,"data.write":true,
               "gate":true,"skill":true}
```

Unchanged — confirming the edit touched only comments, not the booleans
themselves (`DESIGN.md`'s "Matches `provider.yml`'s own capability
booleans verbatim" claim remains true). YAML validity was independently
confirmed by parsing `provider.yml` directly with the `yaml` module and by
the successful `manifest` command run above.

**Diff-scope verification:**

```
$ git diff --stat
 packages/quay-github/DESIGN.md    | 19 +++++++++++++------
 packages/quay-github/provider.yml | 25 ++++++++++++++++---------

$ git diff --stat -- '*.js'
(empty)
```

Confirms zero source-code change — a pure documentation/comment fix.

**Full regression suite**, run after the edit: all 24 `*.test.mjs` files
across all three packages exit 0; `node packages/quay-native/test/
abi-symmetry.mjs` reports "ALL FOUR SURFACES SYMMETRIC." Zero regressions.

`tasks/QN-049.md` was gated `ready → done` via `task check`: `ok:true`
(4/4 AC checkboxes checked, cross-verified against real command output —
the live re-run compound-gate JSON, the `manifest --json` output, the
regression suite's actual exit codes, the `git diff --stat` output — not
"should work" reasoning). All 8 AC/DoD checkboxes were flipped from `[ ]`
to `[x]` only after each was independently, genuinely re-verified.

## 6. Provenance update

`experiment/provenance.md` updated with a new "Records (as of end of
iteration 38)" section (task ledger row for QN-049, the honesty note on
QN-049's lifecycle execution, the corrected `provider.yml` text quoted
verbatim), a new "σ computation — iteration 38" section, and a new
"V-factor attribution — iteration 38" section — all detailed in §7/§8
below and written into `provenance.md` directly.

**Honesty note on QN-049's lifecycle execution.** As with every task since
the seed's author/execute retirement, "native" here means the
`quay-native` CLI's mechanical `task check` gate was genuinely invoked at
both the author→ready and execute→done transitions (both returned
`ok:true`, confirmed via direct command output, not estimated), and the
task file itself was authored and driven through its lifecycle using
`quay-native task create`/`task edit`/`task check` rather than
hand-edited frontmatter status. It does NOT mean an independent,
fresh-context subagent performed the authoring or execution work in
isolation from this top-level session — this environment still has no
verified subagent-dispatch primitive (confirmed via `ToolSearch` this
iteration — the search surfaced `mcp__plugin_manda_manda__Agent`, a
subagent-spawn proxy, but this matches every prior iteration's finding
that this primitive exists but has never been independently verified
reliable per DIR-004/DIR-005's established findings, not a new
discovery), so "native" continues to describe the degraded-fallback mode
already documented for every prior "native" entry since iteration ~15:
the same top-level session performs the work directly, then invokes the
real `quay-native` gate mechanically and honestly reports its actual JSON
output.

σ before this iteration: 40/47 = 0.8511. σ after: 41/48 = 0.8542 (Δσ =
+0.0031). See §8 (provenance.md excerpt) below for the full computation.

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

Per the standing discipline, two precedents were located and read in full
this iteration (not merely cited from memory), and both counsel the same
conclusion:

- **Iteration 25's post-hoc `gate_correctness` correction** (read in full
  this iteration): iteration 25's own *new gate-logic-building* work (a
  real, substantial `childrenStatus()` port into the GitHub Provider) was
  corrected to hold `gate_correctness` flat, because that factor is
  precisely "does `quay-native task check` correctly assert the gate" —
  native's own gate, per protocol §5.1. This iteration's QN-049 touches
  neither native's gate logic nor even the GitHub Provider's gate *logic*
  (zero `.js` diff, confirmed via `git diff --stat -- '*.js'`) — only
  prose comments describing already-existing, unmodified gate behavior. A
  fortiori not `gate_correctness`.
- `abi_symmetry` was explicitly considered and ruled out, not merely
  skipped: protocol §5.1 defines it as a cross-surface schema/content-
  equivalence proof (`quay-native task ... --json` vs. MCP tool output,
  "CLI is the golden test harness"). This iteration's live re-verification
  (`quay-github` CLI vs. Core's passthrough, byte-identical) re-confirms
  an *already-existing* equivalence established at iteration 25 itself —
  it does not newly prove one. Not implicated.
- `skeleton` was considered: protocol §5.1 scopes it to "the v0 loop runs
  end-to-end" / new capability/route/action work. `git diff --stat`
  confirms zero code change of any kind — no new route, action, gate
  transition, or capability. Not implicated.
- `skill_convergence` was considered: no `quay:author`/`quay:execute`
  SKILL.md Method-step content changed this iteration. Not implicated.

```
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903
```

ΔV_instance = **0.0000** (unchanged from iteration 37).

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **Iteration 29's post-hoc `completeness` correction** (read in full this
  iteration): iteration 29's original `completeness` credit for revising
  `experiment/ITERATION-PROMPTS.md` was corrected to flat, because
  "`completeness` is protocol-scoped (§5.2) to `quay:author`/
  `quay:execute`'s own documented methodology, not this experiment's own
  iteration-guidance document," with iteration 10's own identical
  precedent cited directly. This iteration's fix touches `provider.yml`/
  `DESIGN.md` — neither is a SKILL.md file, and neither documents new
  Skill-orchestration Method-step content. Per this established
  precedent, `completeness` is not the right factor either, even though
  this task is unambiguously a documentation-accuracy fix in spirit. Held
  **flat (0.74)**.
- **effectiveness: 0.26 (unchanged).** No timing data was recorded for
  this task as a candidate `effectiveness` data point — this is a small,
  documentation-only fix, not a Skill-orchestration-timing-shaped task,
  and no attempt was made to force it into that role. Remains the honest,
  unmeasured ceiling, now for **18 consecutive iterations (21-37, and now
  38)**.
- **reusability: 0.79 (unchanged).** Protocol §5.2 scopes this to "the
  methodology transfers to a second Provider (GitHub) unmodified" — i.e.,
  quay-native's methodology *driving new GitHub-Provider construction*.
  This iteration builds no new capability (zero `.js` diff, confirmed); it
  corrects stale prose describing an already-built, already-transferred
  capability from 12 iterations ago (QN-035/iteration 25). Per iteration
  24/37's own established precedent for "no new capability" work, this
  does not count toward `reusability` either. Held flat for the
  **thirteenth consecutive iteration (26-38)**.
- **validation: 0.64 (unchanged).** Per standing convention, credited only
  after the out-of-band audit for this iteration's own work occurs (next
  iteration, via the top-level orchestrator's separate `Agent` dispatch,
  G3). Correctly held flat pending that audit, not self-simulated.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged). QN-049's genuine contribution — closing
a real, 12-iteration-old internal-consistency defect between a Provider's
own static self-declaration and its actual, already-implemented,
already-verified capability scope — does not move any of the eight
V-factor axes, per the two directly on-point precedents applied above.
This is a real and valuable fix that is not automatically forced into one
of the eight precisely-scoped V-factor axes when the evidence does not
support it, matching the discipline already established at iterations 25,
28, 29, and 37.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool. This session
did not attempt to self-obtain or simulate any such audit.

`experiment/audits/iteration-37-independent-adjudicate.md` remains the
most recent independent audit of this experiment's iteration work (a
clean PASS with zero corrections needed).

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether the claimed staleness of `provider.yml`'s original comments is
   accurate — an independent reviewer should re-derive via `git log
   --oneline -- packages/quay-github/provider.yml` (confirming the file's
   most recent prior commit predates QN-035/iteration 25) and by reading
   `tasks/QN-035.md`/`experiment/iterations/iteration-25.md` directly to
   confirm compound/epic gate support was genuinely added there and never
   back-ported to this file.
2. Whether holding all eight V-factors flat is correct, given the two
   precedents cited (iterations 25 and 29's own post-hoc corrections) — an
   independent reviewer should re-read both corrections in full and
   confirm this iteration's reasoning applies them faithfully rather than
   selectively.
3. Independent re-verification that `git diff --stat -- '*.js'` is empty
   (zero source-code change) and that the full regression suite (24
   `*.test.mjs` files plus `abi-symmetry.mjs`) genuinely passes
   unchanged after this iteration's edit.
4. Independent re-run of `quay-github task check gh-7 --json` and `quay
   task check gh-7 --provider github --json` to confirm both still return
   the byte-identical, compound-aware result reported in this report.
5. `git status --short` should show a clean working tree at audit time,
   modulo the one pre-existing, deliberately-untouched
   `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.4903 (unchanged), V_meta = 0.0973 (unchanged).
      Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set
      + gate)** — **NO.** σ (strict) = 41/48 = 0.8542, up from
      40/47 = 0.8511, still far from 1. No `quay:author`/`quay:execute`
      Method-step content changed this iteration; no gate logic changed.
      Remains NO for the same standing reason (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 37's framing. This iteration's work
      corrects a documentation-accuracy defect in the GitHub Provider's
      own self-declaration (not a capability change, not new evidence of
      "both run"), so it does not itself move criterion 3's own
      characterization further.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES**, now for a fourth consecutive iteration
      (ΔV_instance = 0.0000 this iteration, +0.0070 at iteration 37,
      0.0000 at iteration 36, +0.0050 at iteration 35's own corrected
      values — all < 0.02). **Scored NO on substance**, consistent with
      this experiment's standing practice (iterations 28-37): a small/flat
      ΔV sitting far below the 0.80 dual threshold on both axes reflects a
      value function genuinely pinned near its own floor, not a system
      approaching convergence and leveling off there. Criteria 1-4 remain
      clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met for a fourth consecutive
iteration but scored NO on substance for the reasons above. V_instance
(0.4903) and V_meta (0.0973) remain far below the 0.80 dual threshold on
both axes.

## Problems identified for next iteration

1. **A fresh source of self-selected work will again be needed** for the
   next iteration if `directives/pending/` is again empty. This
   iteration's gap (stale `provider.yml`/`DESIGN.md` §5 compound/epic
   scope comments) is now closed; the fresh-exhaustive-DESIGN.md-read
   technique used to find it proved productive and should be considered
   again if `packages/quay/DESIGN.md` (not re-read exhaustively this
   iteration — only `packages/quay-github/DESIGN.md` was) has any similar
   drift.
2. **`effectiveness` remains at its honest ceiling (0.26)**, now for 18
   consecutive iterations (21-37, and now 38) — the single longest-flat
   V_meta factor in the experiment's history. No genuinely
   Skill-orchestration-timing-shaped work arose naturally this iteration
   either; per explicit instruction, none was fabricated to force a break
   in this plateau. A future iteration should consider whether a
   deliberately-scoped task (no live external-network dependency, timed
   end-to-end through a real `quay:author`→`quay:execute` Skill
   invocation) can finally produce a creditable data point.
3. **`reusability` remains flat**, now for the thirteenth consecutive
   iteration (26-38). No genuinely new GitHub-Provider capability
   increment has been scoped since iteration 25 (QN-035) — a future
   iteration should consider whether one is overdue, rather than
   continuing to find test-coverage/documentation-accuracy-only gaps.
4. **This iteration's precedent-matching to iterations 25 and 29 is
   itself the most audit-sensitive claim in this report** (see §9 point
   2) — a future iteration should not treat this iteration's own
   reasoning as settled precedent until the next independent audit has
   reviewed it.
5. **A systematic drift-detection technique** (re-reading each Provider's
   own `provider.yml`/`DESIGN.md` in full, specifically checking for
   any capability-scope claim that predates a later capability-expanding
   iteration) is itself now documented, reusable evidence for a future
   iteration needing to find a genuine, non-fabricated self-selected-work
   candidate. `packages/quay-native/provider.yml` and `packages/quay/
   DESIGN.md` have not yet been checked for the identical drift pattern
   this iteration found in `quay-github`'s files.
