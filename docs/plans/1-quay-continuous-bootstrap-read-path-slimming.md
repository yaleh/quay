# Plan: Slim the per-iteration read path for experiment 4 (quay-continuous-bootstrap)

- **Source proposal:** `docs/proposals/quay-continuous-bootstrap-read-path-slimming.md`
  (reviewed, §9 architect pass applied 2026-07-17). This plan implements the
  approved scope from that proposal's §7 ("Approval status"): the hard-gate
  fix, Lever 1, Lever 2, and Lever 4. Lever 3 is explicitly deferred by the
  proposal and is **not implemented** by this plan (see Phase 3).
- **Nature of this plan:** not a software plan. There is no application code,
  build, or automated test suite involved. The deliverable is a small number
  of precise text edits to two markdown files —
  `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` and
  `experiments/quay-continuous-bootstrap/provenance.md` — that a *different*,
  separately-run Claude Code session (the experiment's iteration executor)
  reads at the start of every iteration and follows as operating
  instructions. "Acceptance criteria" here means (a) the diff lands exactly
  as specified, (b) no other content in the target file is touched, and (c)
  a verification method that is necessarily manual/deferred — read the
  *next* iteration report once the experiment resumes and confirm the
  executor actually followed the new instruction, since there is no
  automated test for prompt-following.
- **Current live state (as of this plan's writing):** the experiment is
  HALTed after iteration 7, pending an unspecified "settings adjustment"
  from the human operator (`将对实验设置进行调整`). `git worktree list` shows
  only committed history for iterations 1-7 — no iteration is in flight.
  This is a clean landing window, per the proposal's §9 finding #2, but the
  window is temporary: the pending settings-adjustment could itself touch
  `provenance.md`.

## Phase list

| Phase | Scope | File(s) touched | Risk | Status |
|---|---|---|---|---|
| 1 | Hard-gate fix + Lever 1 + Lever 4 | `ITERATION-PROMPTS.md` only | low | ready to implement |
| 2 | Lever 2 (provenance CURRENT STATE header) | `provenance.md` only | medium (dedup design step) | ready to implement, with an explicit design sub-step before editing |
| 3 | Lever 3 (RUNBOOK.md split) | would touch `ITERATION-PROMPTS.md` | — | **NOT AUTHORIZED** — listed for completeness only, no stages, no implementation |

**Dependency note (be honest about what actually depends on what):** Phase 1
and Phase 2 touch **different files** (`ITERATION-PROMPTS.md` vs.
`provenance.md`) and different, non-overlapping sections within those files.
There is no structural reason Phase 2 must land after Phase 1 — they could
land in either order or in parallel. The proposal's own ordering
recommendation (§6, "Landing order should be: hard-gate fix and Levers 1/4
first... then Lever 2 last") is a **sequencing preference for review
clarity and staged risk exposure**, not a technical dependency: Phase 1 is
uniformly low-risk and independent of any pending external change, while
Phase 2 is gated on an extra design step (the V-score-history dedup, see
Phase 2 Stage 0 below) and on the settings-adjustment/HALT timing described
in the proposal §9 finding #2. This plan follows that preference — Phase 1
first — but notes explicitly that it is a preference, not a hard blocker.
Phase 3 is not sequenced at all; it is out of scope.

---

## Phase 1 — Hard-gate fix + Lever 1 + Lever 4 (`ITERATION-PROMPTS.md`)

**Rationale for bundling:** all three edits are independent, non-overlapping
read-list/gate changes to the same file, each individually low-risk (per
proposal §5/§6: "pure read-list/gate changes, safe mid-flight"). They can
land as one phase with three stages, or as three separate commits — either
is fine since they don't interact. Recommend three separate commits for
clean rollback granularity, still as a single phase/session of work.

### Stage 1.1 — HARD GATES block (PR-001 fix)

**Target:** `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`,
top of `## §0. Preconditions` section (currently starting at line 85, with
the fenced checklist block starting at line 87).

**Edit:** insert the `HARD GATES` block (proposal §4, verbatim text already
drafted there) as new content immediately after the `## §0. Preconditions`
heading (line 85) and before the existing fenced checklist block (line 87).
Use the exact text from proposal §4:

```
HARD GATES — paste the literal command output into §2 of this iteration's report,
not a prose summary. A summary is not acceptable evidence for these four; the raw
output is the artifact. (This block exists because through iteration 3 the
"directives listed" check was satisfied by copying the prior report's sentence
forward, and DIR-005/DIR-006 went unseen for three iterations — see gap-list PR-001.)

[ ] ls -1 experiments/quay-continuous-bootstrap/directives/pending/
    → paste the raw file listing. Then give EACH file listed an explicit
      applied/deferred-with-reason/rejected DISPOSITION this iteration — not
      an acknowledgment. Naming the gap (e.g. "still open per PR-001") or
      restating that the mechanism is unreliable is NOT a disposition and
      does not satisfy this gate — each filename needs its own outcome
      stated in this iteration's own words, even if the outcome is
      "deferred, reason: X." If the listing shows more files than you have
      given a real disposition to, you have not completed this gate.
      (This sub-clause exists because iteration 4 satisfied the letter of
      the original gate by citing PR-001 itself as the reason DIR-005/
      DIR-006 remained unaddressed — technically an acknowledgment, but not
      a disposition, and the loophole this gate is meant to close.)
[ ] cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
    → paste both outputs.
[ ] curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
    → paste the status code (G7 reachability).
[ ] git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-N
    -b experiment-4-iteration-N
    → paste the "HEAD is now at <hash>" line.
```

**Second edit, same stage:** reword the existing directives checklist item
inside the fenced §0 block (currently lines 102-108) to back-reference the
new HARD GATES block instead of restating the requirement:

- Before (current lines 102-108):
  ```
  [ ] experiments/quay-continuous-bootstrap/directives/pending/ has been listed (`ls`) and
      every file in it read; each must reach an explicit applied/deferred/rejected outcome
      this iteration, recorded in this iteration's own report — this INCLUDES the two
      directives carried forward from experiment 3 (DIR-004 packaging/distribution, now
      re-filed here per protocol §8; DIR-006 worktree isolation, adopted directly as a
      standing guardrail rather than re-filed as still-open — confirm both are represented
      correctly in this experiment's own directives/ tree at iteration 0)
  ```
- After (per proposal §4's specified replacement, with the "rest unchanged"
  tail — i.e. the experiment-3 carried-forward-directives detail — preserved
  verbatim, only the opening clause changed):
  ```
  [ ] directives/pending/ dispositioned — satisfied via the HARD GATES block above (raw
      `ls` pasted, every listed file given an outcome). This INCLUDES the two directives
      carried forward from experiment 3 (DIR-004 packaging/distribution, now re-filed here
      per protocol §8; DIR-006 worktree isolation, adopted directly as a standing guardrail
      rather than re-filed as still-open — confirm both are represented correctly in this
      experiment's own directives/ tree at iteration 0)
  ```

**Acceptance criteria:**
- (a) `git diff` on `ITERATION-PROMPTS.md` shows exactly two changed
  regions: the new HARD GATES block inserted before the §0 fenced checklist,
  and the reworded directives-checklist line; no other line in the file
  differs.
- (b) The HARD GATES block text matches proposal §4 verbatim (diff the
  inserted text against the proposal's fenced block; should be identical).
- (c) Verification (deferred, manual): the next iteration report's §2
  ("Preconditions checked") must contain pasted raw output for all four
  gates (an `ls -1` listing, `.manda/hub.addr` contents + curl healthz
  response, an HTTP status code, and a `HEAD is now at <hash>` line) — not
  prose paraphrase of any of them. If any of the four is summarized instead
  of pasted, the gate has not been satisfied as designed.

### Stage 1.2 — Lever 1: bound `audits/` reads

**Target:** `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`,
Context-extraction section (`### Context extraction (do this first, every
iteration)`, currently lines 616-637), specifically the `audits/` line
inside the fenced block (current line 623-624).

**Edit:**
- Before (current lines 619-624, the `Read, in full` list):
  ```
  Read, in full, before doing anything else:
    experiments/quay-continuous-bootstrap/iterations/iteration-{N-1}.md  — prior state, V scores, problems
    experiments/quay-continuous-bootstrap/provenance.md                   — current QX-* task provenance
    experiments/quay-continuous-bootstrap/gap-list.md (or QX-*-gap-labeled tasks, per iteration-0 decision)
    experiments/quay-continuous-bootstrap/audits/                         — prior G3 co-signs AND
                                                                              prior simulated-user verdicts
  ```
- After (only the `audits/` line changes; all other lines in this block are
  untouched):
  ```
  Read, in full, before doing anything else:
    experiments/quay-continuous-bootstrap/iterations/iteration-{N-1}.md  — prior state, V scores, problems
    experiments/quay-continuous-bootstrap/provenance.md                   — current QX-* task provenance
    experiments/quay-continuous-bootstrap/gap-list.md (or QX-*-gap-labeled tasks, per iteration-0 decision)
    experiments/quay-continuous-bootstrap/audits/iteration-{N-1}-*        — ONLY the most recent G3
                                                                              co-sign and the most recent
                                                                              simulated-user verdict(s);
                                                                              older audits are archival —
                                                                              grep on demand for a specific
                                                                              past finding, do not read in full
  ```

**Acceptance criteria:**
- (a) `git diff` shows only the `audits/` line (now two/three wrapped lines)
  changed within the Context-extraction fenced block; the
  `iterations/iteration-{N-1}.md`, `provenance.md`, and `gap-list.md` lines
  are byte-identical to before.
- (b) The new instruction narrows scope (most-recent-iteration audits only)
  without deleting the "grep on demand" escape hatch for older audits —
  matches proposal §3 Lever 1 framing ("relocation, not deletion").
- (c) Verification (deferred, manual): the next iteration report should not
  cite or quote content from any `audits/iteration-{N-2}-*` file or older
  as if freshly re-read this iteration (citing it because a specific past
  finding is relevant, with an explicit grep-on-demand framing, is fine and
  expected; treating it as part of the standing read list is not).

### Stage 1.3 — Lever 4: narrow the reference/ re-read instruction

**Target:** `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`,
`### Lifecycle capability-reading protocol (inherited, unchanged)` section
(currently lines 639-645).

**Edit:**
- Before (current lines 641-645):
  ```
  - Read all relevant Skill definitions before the iteration starts.
  - Re-read the specific Skill/capability being modified immediately before using it.
  - Read `.claude/skills/quay-native-methodology/reference/`,
    `.claude/skills/quay-core-bootstrap-methodology/reference/`, and (once produced)
    `.claude/skills/quay-webui-bootstrap-methodology/reference/` files fresh each iteration.
  ```
- After:
  ```
  - Read all relevant Skill definitions before the iteration starts.
  - Re-read the specific Skill/capability being modified immediately before using it.
  - `.claude/skills/quay-native-methodology/reference/`,
    `.claude/skills/quay-core-bootstrap-methodology/reference/`, and
    `.claude/skills/quay-webui-bootstrap-methodology/reference/`: read once (iteration 0),
    then re-read only the specific skill's reference material in an iteration that is
    actually modifying that skill — per the "re-read immediately before using it" rule
    above, this is not a new discipline, just the existing rule stated as the standing
    read-list default instead of a wholesale-every-iteration reread. The two files the
    V_meta re-trigger check actually uses every iteration
    (`v-meta-stall-analysis.md`, `v-meta-ceiling-diagnostic.md`) remain in the standing
    Context-extraction read list above (unchanged from Lever 4 scope — see Context
    extraction).
  ```
  Note: the two `v-meta-*` files and the two native `SKILL.md` files already
  appear as standing reads in the Context-extraction fenced block (lines
  625-628) — this stage does not touch that block; it only narrows this
  separate "read reference/ fresh each iteration" line. No edit to
  Context-extraction is needed for Lever 4 since its two named standing
  files are already itemized there individually, not folded into a
  wholesale `reference/` read.

**Acceptance criteria:**
- (a) `git diff` shows only the third bullet of the Lifecycle
  capability-reading protocol section changed; the first two bullets are
  untouched.
- (b) The edit removes the "fresh each iteration, wholesale" instruction for
  all three `reference/` trees and replaces it with "read once + re-read
  only what's touched," while leaving the two named `v-meta-*` files'
  standing-read status (in Context-extraction) unchanged, per the proposal's
  explicit carve-out.
- (c) Verification (deferred, manual): a future iteration report should not
  show evidence of the executor re-reading, say,
  `quay-webui-bootstrap-methodology/reference/` in full during an iteration
  that does not touch that methodology's skill.

**Phase 1 acceptance (rollup):** all three stages' individual criteria
above hold, plus: `git diff` on `ITERATION-PROMPTS.md` touches only the
three regions above (HARD GATES insertion + directives line reword;
`audits/` line; Lifecycle protocol third bullet) — total file line-count
delta should be roughly +20 to +25 lines (the new HARD GATES block is the
dominant addition; the other two stages are net-neutral-to-small
rewordings). No edit to `provenance.md` occurs in Phase 1.

---

## Phase 2 — Lever 2: `provenance.md` CURRENT STATE header

**Gating condition before starting this phase:** confirm the human
operator's "settings adjustment" (the reason for the iteration-7 HALT) has
either (a) landed and its shape is known, or (b) been confirmed as not
touching `provenance.md`'s structure/section-ordering/iteration-record
format. If neither is confirmed, do not proceed with this phase — land it
only once, or as part of, the settings-adjustment, per proposal §9 finding
#2. This is a timing gate, not a technical dependency on Phase 1.

### Stage 2.0 — Design step: fold into, don't duplicate, the V-score history table

This stage must be done and its output reviewed **before** any edit is
written, per proposal §9 finding #3. `provenance.md` already has a `##
V-score history (all iterations)` table (lines 560-573) with one row per
iteration holding `Iteration | V_instance | ΔV_instance | V_meta | σ_QX |
Notes`. This is functionally the same content the proposed `CURRENT STATE`
header would summarize. Two duplication risks to design around, not two
options to leave open:

- **Risk A:** a new standalone `CURRENT STATE` block plus the existing
  table both get updated independently, and drift (exactly the PR-001
  failure shape, per the proposal's own self-flagging caveat).
  Unacceptable per proposal §9 finding #3.
- **Resolution to implement:** the `CURRENT STATE` block is **not** a
  second data store. It is a short prose header, placed at the top of the
  file, that (1) states the values for the *fields the V-score history
  table does not carry* — namely the standing decisions (gap-list storage
  format, σ-reset rule, V_meta ceiling = 0.26) and which V_meta re-triggers
  are currently live — and (2) for the fields the table *does* carry
  (latest σ_QX, latest V_instance/V_meta, last-2 deltas), **references the
  table's own last row(s) by iteration number instead of restating the
  numbers** (e.g. "see V-score history row for iteration 7, below"), OR, if
  restating for at-a-glance convenience is preferred over a table lookup,
  the restated numbers must be sourced by an explicit "must match V-score
  history table, iteration N row" note co-located with them so a future
  editor updating one is visually prompted to update the other. Prefer the
  reference-not-restate form — it structurally cannot drift because there
  is only one number, not two.

**Acceptance criteria for this stage:**
- (a) A concrete before/after text for the `CURRENT STATE` block is drafted
  (see Stage 2.1 below, which is the output of this design step) that
  contains no field which independently restates a number already present
  in the V-score history table without a co-located cross-reference tying
  the two together.
- (b) The design explicitly designates the V-score history table as the
  source of truth for per-iteration V_instance/ΔV/V_meta/σ_QX, and the
  `CURRENT STATE` block as derived/pointer, not parallel — matching
  proposal §9 finding #3's required resolution ("either fold... or
  explicitly designate one as source of truth and the other as
  derived/deprecated, not maintain two independently").

### Stage 2.1 — Insert the CURRENT STATE block

**Target:** `experiments/quay-continuous-bootstrap/provenance.md`, top of
file, immediately after the title (line 1: `# Experiment 4
(quay-continuous-bootstrap) — provenance ledger`) and the one-line
description (lines 3-6), before the `---` separator (line 8) that precedes
`## Inheritance record`.

**Edit (illustrative text — exact wording to be finalized against Stage
2.0's design output and the actual post-settings-adjustment state; this is
the shape, not necessarily the final words):**

```markdown
## CURRENT STATE (overwrite each iteration — see V-score history table below for the
source-of-truth per-iteration numbers; do not restate numbers here independently)

_Last updated: iteration 7 (HALT)_

- **Latest scores:** see "V-score history (all iterations)" table, iteration 7 row, for
  V_instance / ΔV_instance / V_meta / σ_QX. Do not duplicate those figures here — update
  the table, not this line, when a new iteration completes.
- **Live V_meta re-triggers:** [none fired as of iteration 7 — restate explicitly each
  iteration; this field does NOT exist in the V-score history table, so it lives here]
- **Standing decisions (do not re-litigate without new evidence):**
  - Gap-list storage: [iteration-0 decision — cite section]
  - σ-reset rule: [inherited-floor-vs-reset-to-0 decision — cite section]
  - V_meta ceiling: 0.26 (inherited from experiment 1, confirmed positively across
    experiments 2/3 — see Inheritance record below)
- **Status:** HALT (human-imposed, after iteration 7 — "将对实验设置进行调整"; see HALT
  note at bottom of file for full detail)
```

The exact field values (live re-triggers, standing-decision citations) must
be sourced from the real current content of the file at implementation time
(the "Iteration 0 record" and "HALT note" sections), not invented — this
plan specifies structure and the dedup discipline, not final prose.

**Acceptance criteria:**
- (a) `git diff` on `provenance.md` shows exactly one inserted block between
  the file's opening description and the first `---` separator; no
  pre-existing content (including the "Inheritance record" heading onward,
  the per-iteration records, and the "V-score history" table itself) is
  altered, reordered, or deleted.
- (b) The inserted block contains a `_Last updated: iteration N_` line that
  is self-flagging (per proposal §3 Lever 2's stated mitigant) — i.e. it
  will visibly lag if a future iteration forgets to update it, because the
  number is human-readable and checkable against the V-score history
  table's last row.
- (c) No numeric field in the inserted block duplicates a number already in
  the V-score history table without an explicit "see table" pointer in
  place of the number (per Stage 2.0's resolution).
- (d) Verification (deferred, manual): once the experiment resumes,
  iteration 8's report and its `provenance.md` edit must show the `CURRENT
  STATE` block's `_Last updated:_` line advanced to iteration 8 AND the
  V-score history table's new row 8 added — both changed together, not one
  without the other. If only one changes, the drift risk this stage was
  designed to prevent has materialized and should be flagged back to the
  human operator, not silently tolerated.

### Stage 2.2 — Update Context-extraction and report template §6 to reference the header

**Target A:** `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`,
Context-extraction fenced block (lines 619-624, already touched by Phase 1
Stage 1.2 for the `audits/` line — this stage touches the adjacent
`provenance.md` line only, no overlap).

- Before (current, post-Phase-1 state — the `provenance.md` line, currently
  line 621 pre-Phase-1, position may shift slightly after Stage 1.2's edit
  but the line itself is untouched by Phase 1):
  ```
    experiments/quay-continuous-bootstrap/provenance.md                   — current QX-* task provenance
  ```
- After:
  ```
    experiments/quay-continuous-bootstrap/provenance.md (CURRENT STATE header + iteration-{N-1}'s
                                                            own record block only — not the full
                                                            per-iteration history; older iterations'
                                                            detail is archival, grep on demand)
  ```

Also update the "Extract:" list item currently reading `current σ_QX
(recompute from provenance.md QX-* entries only)` (line 631) to read from
the new header instead of recomputing by scanning:

- Before:
  ```
    - current σ_QX (recompute from provenance.md QX-* entries only)
  ```
- After:
  ```
    - current σ_QX (read directly from provenance.md's CURRENT STATE header / V-score
      history table's latest row — do not recompute by scanning every historical QX-*
      block; the header exists precisely to remove that scan)
  ```

**Target B:** `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`,
report template §6 "Provenance update" (currently lines 873-874):

- Before:
  ```
  ## 6. Provenance update
  [Per-QX-* task {author_by, execute_by, gate_by} diffs this iteration; σ_QX before → after]
  ```
- After:
  ```
  ## 6. Provenance update
  [Per-QX-* task {author_by, execute_by, gate_by} diffs this iteration; σ_QX before → after.
  Confirm BOTH the CURRENT STATE header AND the V-score history table row for this iteration
  were updated together in provenance.md — updating one without the other is a drift risk
  the header was specifically designed to avoid (see provenance.md's CURRENT STATE block
  comment).]
  ```

**Acceptance criteria:**
- (a) `git diff` on `ITERATION-PROMPTS.md` for this stage shows exactly two
  changed regions: the `provenance.md` line + the σ_QX extraction bullet in
  Context-extraction, and the §6 report-template paragraph. No other
  report-template section (§1-5, §7-11) is touched.
- (b) The edits are additive/narrowing instructions consistent with "read
  the header, not the full history" — they do not remove the ability to
  read full history on demand (the full per-iteration blocks remain in
  `provenance.md`, untouched by Stage 2.1).
- (c) Verification (deferred, manual): iteration 8's report §6 should show
  explicit confirmation language that both the header and the table row
  were updated (per the new template prompt), and Context-extraction in
  iteration 8's own process (visible via what it cites in §1 "Context from
  prior iteration") should show it read the header rather than
  re-deriving σ_QX from a full scan.

**Phase 2 acceptance (rollup):** Stage 2.0's design output is reviewed and
resolves the duplication risk before Stage 2.1 is written; Stage 2.1's
insertion and Stage 2.2's two `ITERATION-PROMPTS.md` edits land together
(they reference each other and should not be split across separate,
unreviewed commits); the gating condition (settings-adjustment
landed/known) is satisfied before this phase starts, not before Phase 1.

---

## Phase 3 — Lever 3 (RUNBOOK.md split) — NOT AUTHORIZED, future work only

Per proposal §3 Lever 3 and §7 ("Approval status"), this lever is
**explicitly deferred** and out of scope for this plan. It is listed here
only so the full proposal's lever set is visible in one place, not as an
authorized phase:

- **What it would do:** split `ITERATION-PROMPTS.md` into a small
  `RUNBOOK.md` (§0 gates, the iteration cycle, the report template — the
  ~15-20KB actually needed every iteration) and keep the remaining
  ~49KB/iteration of rationale/history/inherited-constraints content as a
  read-once reference appendix, cited by section rather than re-read
  wholesale.
- **Why it's not in this plan:** the proposal itself defers it ("Status:
  deferred out of this first pass... should be staged at a clean iteration
  boundary and land through the same directive/steering mechanism used for
  other on-the-record process changes, not as a silent rewrite
  mid-experiment") and §7 confirms only Levers 1/2/4 + the hard-gate fix
  were approved for drafting.
- **If picked up later:** per proposal §6, its "runbook" extraction must
  diff against the *already-slimmed* `ITERATION-PROMPTS.md` (i.e., after
  Phase 1 and Phase 2 of this plan have landed), not against a
  pre-Phase-1/2 copy — otherwise the earlier levers' savings would be
  silently reverted by the later restructuring. A future plan document
  should be written for this phase when/if it is authorized; it is not
  pre-authorized by this document.

---

## Summary of file-level acceptance (both phases combined, once landed)

- `ITERATION-PROMPTS.md`: touched by Phase 1 (3 regions) and Phase 2 Stage
  2.2 (2 more regions), all within `§0 Preconditions`, `Context extraction`,
  `Lifecycle capability-reading protocol`, and report-template `§6` — no
  other section of the file (Iteration 0 baseline material, V_instance/
  V_meta factor definitions, §Core-scope constraints, §Inherited
  methodology constraints, "Common mistakes" appendix, etc.) should show
  any diff.
- `provenance.md`: touched only by Phase 2 Stage 2.1 (one inserted block at
  the top) — the "Inheritance record," all per-iteration record sections,
  the existing "V-score history" table, the "Steering note," the
  "Human-observed gap-list seed candidates," and the "HALT note" sections
  should show no diff.
- Neither phase deletes any content (per the proposal's §1 framing
  constraint, "relocation and layering, not deletion") — verify this
  explicitly as part of reviewing each phase's diff before it lands.
