# Slimming the per-iteration read path for experiment 4 (quay-continuous-bootstrap)

- **Status:** proposal, drafted only — no edits applied yet. Requires explicit
  human sign-off per-lever before landing (see "Approval status" below).
  Reviewed by an independent architect pass on 2026-07-17 (see §9);
  baseline figures corrected, hard-gate wording tightened, no change to the
  four-lever scope.
- **Date:** 2026-07-17
- **Context:** captured from a live conversation between the human (Yale) and
  an observer Claude Code session investigating why `experiments/quay-continuous-bootstrap/`
  iterations 1-3 never processed DIR-005/DIR-006 despite listing
  `directives/pending/` every iteration (see gap-list entry **PR-001**, and
  `experiments/quay-continuous-bootstrap/provenance.md` steering note). The
  investigation traced the failure to "never looked" (verbatim copy-paste
  across iterations 1-3), and separately identified that the per-iteration
  read volume (~505KB / ~126K tokens across `ITERATION-PROMPTS.md`,
  `provenance.md`, `audits/`, `gap-list.md`, and three methodology
  `reference/` trees) has been growing unboundedly and plausibly contributes
  to exactly this class of miss (a directives check buried as 1-of-11 equal
  weight prose items, in a document large enough to invite pattern-matched
  shortcuts). This document is **not itself** a directive or an authorization
  to implement — it records the plan discussed so it can be reviewed, revised,
  and landed deliberately.

## 1. Framing constraint (governs every edit below)

This is **relocation and layering, not deletion**. The experiment has real,
hard-won discipline encoded in these files — "never dispatch G3 via manda,"
"Core stays dumb," the σ-reset reasoning, the three-snapshot regression
baseline, the manda-reliability envelope, etc. The goal is to change **what
gets loaded when**, not to drop any guardrail. Every byte cut from the
mandatory per-iteration read path must land somewhere still reachable — an
appendix, a grep-on-demand target, an on-request read — or a context-bloat
problem is just traded for a regression problem. No edit in this proposal
deletes content; each either narrows a read instruction's *scope* (Levers 1,
4), or replaces linear-history-scanning with a maintained summary while
keeping the full history intact below it (Lever 2), or splits a file into an
always-read part and a read-once-then-cited-by-section part (Lever 3).

## 2. Current state (baseline — original figures dated 2026-07-17, corrected
below after re-measurement against the live files; see §9)

**Correction:** the table below was drafted against an earlier snapshot of
the experiment (iteration ~3-4). Re-measured at review time, the experiment
had already reached **iteration 7 and been HALTed by the human operator**
("将对实验设置进行调整" — experiment settings will be adjusted). The
`audits/` growth in particular had already outrun the original estimate.
Corrected sizes:

| Source | Original estimate | Actual (re-measured, iteration 7 HALT) | Growth |
|---|---|---|---|
| `ITERATION-PROMPTS.md` (full) | 67KB | 67KB (confirmed) | static |
| `provenance.md` (full, append-only) | 34KB | 58KB | +~8KB/iteration (7 iterations in) |
| `audits/` (full directory) | 168KB, 16 files | **288KB, 31 files** | +4 files/iteration (not +2 — one adjudicate + up to three simulated-user reports per iteration), unbounded |
| `gap-list.md` | "~modest" | **27KB** (not modest — already the third-largest source) | linear |
| 3× methodology `reference/` trees | 88KB | ~102KB (confirmed same order of magnitude) | static |
| 2× native `SKILL.md` | 43KB | ~42.7KB confirmed (`packages/quay-native/skills/author/SKILL.md` 14,252B + `packages/quay-native/skills/execute/SKILL.md` 28,474B) — these are the two files actually read per the standing Context-extraction list (ITERATION-PROMPTS.md lines 627-628); the ~31KB figure for the 4 `.claude/skills/*/SKILL.md` methodology-skill definitions is a separate, unrelated set of files and does not apply here | static |
| **Total (re-measured)** | ~505KB / ~126K tokens | **~570KB+ / ~140K+ tokens**, and still growing | dominated by `audits/`, `gap-list.md`, and `provenance.md` |

The original "+2 files/iteration" growth rate for `audits/` undercounts:
each iteration produces one `iteration-N-adjudicate.md` plus two-to-three
`iteration-N-simulated-user-*.md` files (persona count varies 2-3 per
iteration), i.e. **+3 to +4 files/iteration**, not +2. By iteration 7 this
had already produced 31 files / 288KB — ahead of the original document's
"by iteration 10, ~400KB" projection, meaning the real trajectory would hit
that figure closer to iteration 8-9. `gap-list.md` was also mis-stated as
"~modest": at 27KB it is not a rounding error and should be considered a
candidate for a future Lever if it continues to grow at its current rate
(not addressed by any of the four levers below — see §9).

None of this changes the direction of the proposal, but it means the
savings figures in §5 understate the current benefit (the base to subtract
from is larger than stated) and the levers are, if anything, more urgent
than originally measured.

## 3. The four levers

### Lever 1 — Bound `audits/` reads (biggest single win, lowest risk)

**Current:** Context-extraction says read `audits/` in full — the whole
directory, 168KB across 16 files today, +2 files every iteration, no
ceiling.

**Change:** replace "read `audits/`" with "read only the most recent G3
co-sign and the most recent simulated-user verdict
(`audits/iteration-{N-1}-*`); older audits are archival — grep on demand if a
specific past finding is referenced."

**Saves:** ~148KB now; removes the fastest-growing leak entirely.
**Risk:** near-zero. Historical audits are evidence artifacts consumed for a
specific past finding, not standing operational input — nothing in the
iteration cycle actually re-reads audit #3 while running iteration #5.

### Lever 2 — Give `provenance.md` a running-state header

**Current:** 34KB, append-only, one full block per iteration. The executor
is instructed to "recompute σ_QX from `provenance.md` QX-* entries only,"
which forces scanning every historical block. Grows linearly forever.

**Change:** add a `## CURRENT STATE (overwrite each iteration)` block at the
top, holding only the fields the existing "V-score history (all iterations)"
table does *not* already carry: which V_meta re-triggers are live, and the
standing decisions (gap-list storage format, σ-reset rule, V_meta ceiling =
0.26). For the fields the V-score history table *does* already carry
(latest σ_QX, latest V_instance/V_meta, last-2 deltas), this block must NOT
independently restate those numbers — it must reference the table's latest
row instead (e.g. "see V-score history row for iteration N, below"), so the
table remains the single source of truth for per-iteration V-scores and the
header is derived/pointer, not a second, separately-maintained copy of the
same numbers. Per-iteration detail blocks stay below, unchanged, as the full
audit trail — read on demand, not at every start. Context-extraction reads
the header plus only `iteration-{N-1}`'s own block.

**Saves:** ~26KB now, unbounded going forward. Also removes the
"recompute σ by scanning every block" friction that itself invites
copy-paste shortcuts — the same failure shape as PR-001, in a different
file.

**Self-flagging caveat (must be stated, not hidden):** a running header only
helps if the executor actually overwrites it each iteration. If §0 discipline
is weak enough that PR-001 happened, this header can rot the same way. It is
designed to be self-flagging (a `_Last updated: iteration N_` line that
visibly lags the true iteration number), but that is a mitigant, not
immunity — worth remembering when reviewing future iteration reports.

**Staging caveat:** landing this mid-flight bakes in the values as of
whichever iteration is current when it's written. If a later iteration is
already in flight in the concurrent executor session when this lands, that
session may finalize without knowing to adopt the header, leaving it
visibly stale on the next read (which is at least detectable, not silently
wrong). Prefer landing at a clean iteration boundary; if landed mid-flight,
mark the header explicitly, e.g. `_Last updated: iteration N — iteration
N+1 in flight, header not yet adopted by executor_`.

**Status at review time: this caveat is currently moot but will become live
again.** As of this review, the experiment is **HALTed** after iteration 7
(human-imposed stop, `provenance.md` "HALT note" — "将对实验设置进行调整",
i.e. settings will be adjusted before further iterations run). There is no
iteration in flight and no live worktree mid-edit right now — `git worktree
list` shows worktrees for iterations 1-7, all pointing at already-committed
history, none uncommitted or active. This means **now is the clean
iteration boundary** the staging caveat asks for, and Lever 2 could land
without the mid-flight risk it describes. However, the HALT is explicitly
described as pending an "adjustment" to experiment settings of unknown
scope — if that adjustment changes provenance.md's structure, section
ordering, or the iteration-record format itself, a header inserted now
could need re-adaptation before iteration 8 resumes. Land Lever 2 only
after (or as part of) whatever the settings-adjustment turns out to be, not
speculatively ahead of it — otherwise this proposal risks colliding with a
second, unrelated edit to the same file. Also note `provenance.md` already
contains a compact running table, "## V-score history (all iterations)"
(currently ~15 lines, one row per iteration, holding V_instance, ΔV,
V_meta, and σ_QX for every iteration to date) — this substantially
overlaps with what the proposed `CURRENT STATE` header would hold. The
Lever 2 edit should fold into or reference this existing table rather than
create a second, parallel summary that can drift out of sync with it (see
§9).

### Lever 3 — Split `ITERATION-PROMPTS.md` into runbook + reference (deferred)

**Current:** 67KB, re-read in full every iteration; ~70% is invariant
rationale/history/essays (inherited methodology constraints, common-mistakes
archive, design-question history, inheritance narrative).

**Change:** carve into two files:
- `RUNBOOK.md` (~15-20KB): the §0 gates, the Observe→…→Pause iteration
  cycle, the report template — the only part that must be in context every
  iteration.
- `ITERATION-PROMPTS.md` keeps the rationale/inheritance/constraints/mistakes
  as a reference appendix, read once at iteration 0 and cited by section
  thereafter, not re-read wholesale.

**Saves:** ~49KB/iteration.
**Risk:** moderate — this is the file the concurrently-running executor
session is actively keying off. Cut points must preserve exact semantics,
and the runbook must cite the appendix for anything it summarizes rather
than dropping the meaning.

**Status: deferred out of this first pass.** It rewrites the live
executor's primary script; it should be staged at a clean iteration
boundary and land through the same directive/steering mechanism used for
other on-the-record process changes, not as a silent rewrite mid-experiment.

### Lever 4 — Stop re-reading stable skill reference wholesale

**Current:** "read `.claude/skills/.../reference/` fresh each iteration" for
all three methodology directories (88KB) plus both native `SKILL.md` files
(43KB) — every iteration, regardless of whether that iteration touches any
of that material.

**Change:** the standing per-iteration need is only the two named files the
V_meta re-trigger check actually uses (`v-meta-stall-analysis.md`,
`v-meta-ceiling-diagnostic.md`, ~11KB combined). The rest is "read once, and
re-read the specific skill only when that skill is being modified this
iteration." The wholesale-every-iteration instruction this narrows is the
third bullet of `ITERATION-PROMPTS.md`'s "Lifecycle capability-reading
protocol" section (lines 639-645) — "Read
`.claude/skills/quay-native-methodology/reference/`, ... files fresh each
iteration." That bullet is not separate, already-existing discipline the
read-list merely failed to mirror; it is itself the mandate being edited.
The first two bullets of that same section ("read all relevant Skill
definitions before the iteration starts" / "re-read the specific
Skill/capability being modified immediately before using it") already state
the narrower rule this lever wants to apply — the third bullet currently
overrides that narrower rule with a wholesale reread, and this lever removes
that override.

**Saves:** ~80KB/iteration.
**Risk:** low — this aligns the read list with an already-documented
discipline rather than introducing a new one.

## 4. The PR-001-specific fix (orthogonal to size, bundled here because this is the natural moment)

Independent of total read volume, add a small hard-gate block at the very
top of §0 — the four items that cannot be satisfied by prose recall because
they require pasted raw output, not summary:

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

The existing 11-item checklist stays; its current directives item is
reworded to back-reference the hard gate rather than restate the
requirement in a second, competing voice:

- old: `[ ] experiments/quay-continuous-bootstrap/directives/pending/ has
  been listed (`ls`) and every file in it read; each must reach an explicit
  applied/deferred/rejected outcome...`
- new: `[ ] directives/pending/ dispositioned — satisfied via the HARD
  GATES block above (raw `ls` pasted, every listed file given an outcome).
  This INCLUDES the directives carried forward from experiment 3...` (rest
  unchanged)

**Why this closes PR-001 directly:** the miss happened because "directives
listed" was one of eleven equal-weight prose items, satisfiable by
paraphrase — which made copy-pasting the prior report's sentence forward
indistinguishable from genuine re-execution. Requiring literal `ls` output
makes a stale copy visibly wrong: last iteration's output showing only
DIR-004 cannot be pasted forward once the tree holds three files without the
mismatch being obvious on inspection.

## 5. Net effect

Per-iteration nominal reads drop from ~505KB (~126K tokens, original
estimate — corrected to ~570KB+/~140K+ tokens against the re-measured
iteration-7 baseline, see §2) to roughly ~90-110KB (~25K tokens) once
Levers 1, 2, and 4 plus the hard-gate fix are applied — most of the
reduction from Levers 1 and 4, which are also the lowest-risk. The
absolute savings are larger than originally stated because `audits/` alone
is now 288KB rather than 168KB; the ~90-110KB post-lever estimate should
also be revisited once real post-edit numbers are available, since Lever
1's "most recent audit only" scope still grows slowly with persona count
per iteration (2-4 files, ~20-40KB, not a fixed constant). Lever 3
(the largest structural edit, and the one most entangled with the live
executor session) is deferred to a later, separately staged pass.

## 6. Ordering / coordination caveat

All four levers touch files the concurrently-running executor session
reads live. Levers 1, 2 (modulo its staging caveat), and 4 are additive or
subtractive edits to read-list *instructions* — low risk to apply
mid-experiment. Lever 3 rewrites the executor's primary script and is
deferred; if picked up later it should go through the directive/steering
mechanism so the change is on the record, not a silent rewrite.

**Out-of-order / interaction risk:** the four edits are not fully
independent. If Lever 2's `CURRENT STATE` header lands before or after a
settings-adjustment edit to `provenance.md` (see the HALT status noted in
Lever 2 above) without coordination, the two edits could conflict on
section placement or duplicate the existing "V-score history" table.
Landing order should be: hard-gate fix and Levers 1/4 first (they touch
`ITERATION-PROMPTS.md` only and do not interact with each other's edit
regions), then Lever 2 last and only once `provenance.md`'s post-HALT
shape is settled. **Gate owner/trigger:** whoever lands Phase 2 (Lever 2)
must, at implementation time (not from this proposal's original review
date), first re-read `experiments/quay-continuous-bootstrap/provenance.md`'s
current HALT note and confirm either (a) the settings-adjustment has landed
and its diff to `provenance.md` is known, so Lever 2 can be reconciled
against it, or (b) the human operator has explicitly confirmed the
settings-adjustment does not touch `provenance.md`'s structure. This check
must be performed fresh immediately before landing Lever 2, not assumed
satisfied because this proposal or its architect review once found the
experiment HALTed at a clean boundary. If Lever 3 is later picked up out of sequence with
Levers 1/4 already applied, its "runbook" extraction must carry forward
whatever read-list narrowing Levers 1/4 already introduced rather than
reverting to the original wholesale-read instructions when the file is
split — i.e. Lever 3 should diff against the *already-slimmed*
`ITERATION-PROMPTS.md`, not against a pre-Lever-1/4 copy, or the earlier
levers' savings would be silently undone by the later restructuring.

## 7. Approval status

Per human decision on the corresponding conversation turn:

- **Scope approved for drafting:** Levers 1, 2, 4, plus the PR-001 hard-gate
  fix ("low-risk trio + PR-001 fix"). Lever 3 explicitly deferred.
- **Landing mechanism:** draft only — exact edit text is reviewed by the
  human before anything is written to `ITERATION-PROMPTS.md` or
  `provenance.md`. Nothing in this proposal has been applied as of this
  document's date.
- **Sub-staging for Lever 2:** apply Edits 1-3 (hard-gate, Lever 1, Lever 4)
  as soon as approved — they are pure read-list/gate changes, safe
  mid-flight. Land Lever 2's `provenance.md` header at the next clean
  iteration boundary rather than while an iteration is in flight, per the
  staging caveat in §3.

## 8. Open question (resolved during architect review — see §9)

Whether to further tighten the hard-gate wording so it distinguishes
*acknowledgment* from *disposition* — i.e. explicitly state that noting a
directive's filename is not sufficient; each DIR must land on
apply/defer-with-reason/reject THIS iteration. This was proposed in
discussion (motivated by iteration 4's misapplication of PR-001, which used
"the mechanism is unreliable" as a reason to keep deferring rather than
giving a genuine disposition).

**Resolved:** confirmed against `iterations/iteration-4.md` line 54 — the
loophole is not hypothetical, it already happened once ("DIR-005 and DIR-006
remain unacknowledged per PR-001 finding... notes the gap without re-filing
a directive"). §4's hard-gate block above has been edited to explicitly
require a disposition, not an acknowledgment, and to call out this exact
precedent so a future iteration can't repeat it by citing PR-001 itself as
a stand-in for a decision.

## 9. Architect review findings (2026-07-17)

An independent architect pass re-measured every file this proposal cites
and re-checked the experiment's live state before editing this document.
Findings, in order of severity:

1. **Baseline was stale, not just approximate (fixed in §2).** The
   proposal's "current state" table was measured against roughly the
   iteration 3-4 state of the experiment. By review time the experiment had
   reached **iteration 7 and been HALTed** by the human operator
   ("将对实验设置进行调整" — settings will be adjusted). Actual sizes:
   `audits/` is 288KB/31 files (not 168KB/16), `provenance.md` is 58KB (not
   34KB), and `gap-list.md` is 27KB (not "~modest" — it is close in size to
   `provenance.md` and is not addressed by any of the four levers). The
   `audits/` growth rate is +3 to +4 files/iteration (one adjudicate + 2-3
   simulated-user reports), not the stated +2 — the "by iteration 10,
   ~400KB" projection was already exceeded in effect by iteration 7. None
   of this changes the proposal's direction, but the specific numbers in
   §2 and §5 were wrong enough to mislead anyone approving this by the
   figures alone, so they have been corrected in place rather than left as
   a footnote.

2. **The experiment is currently HALTed, which the proposal's staging
   logic did not account for.** Lever 2's "staging caveat" and §6's
   "ordering / coordination caveat" both assume a continuously-running
   concurrent executor session and frame "land at a clean iteration
   boundary" as a future event to wait for. In fact, per `provenance.md`'s
   "HALT note" and the absence of any in-flight worktree (`git worktree
   list` shows only committed history for iterations 1-7), **the
   experiment is at a clean boundary right now** — but it is paused
   pending an unspecified "settings adjustment" from the human operator,
   which could itself touch `provenance.md` or `ITERATION-PROMPTS.md`.
   Landing Lever 2 speculatively, ahead of and uncoordinated with that
   adjustment, risks a collision (duplicate or conflicting edits to the
   same file). This is a genuine open risk, not just a wording issue — the
   proposal did not previously know to distinguish "clean boundary because
   nothing is running" from "clean boundary and safe to edit right now,"
   which are not the same thing when a second, unrelated edit to the same
   files is expected soon. Recommendation: sequence Lever 2 to land as
   part of, or immediately after, the settings-adjustment, not before it.

3. **Lever 2 as drafted risks a genuine "relocation not deletion" gap:
   silent duplication, not information loss.** `provenance.md` already
   contains a `## V-score history (all iterations)` table (~15 lines,
   updated once per iteration, holding V_instance/ΔV/V_meta/σ_QX for every
   iteration to date) — this is functionally the same content the proposed
   `CURRENT STATE` header would hold. The proposal's framing ("relocation
   and layering, not deletion," §1) is honored with respect to the
   *historical* per-iteration blocks (nothing there is deleted), but as
   drafted it would create a **second, separately-maintained summary**
   that can drift out of sync with the existing one — e.g. an executor
   updates the new header but forgets the old table, or vice versa, and
   the two disagree on the current σ_QX. This is not a hypothetical:
   PR-001 itself is a demonstrated failure mode of "a second place that
   needs updating and sometimes isn't." The edit-as-landed should either
   fold the new header into the existing V-score history table (extend its
   columns rather than add a parallel structure) or explicitly designate
   one as the source of truth and the other as derived/deprecated, not
   maintain two independently.

4. **The hard-gate loophole flagged in §8 was confirmed, not
   hypothetical, and has been closed in §4.** Checked directly against
   `iterations/iteration-4.md`: iteration 4 satisfied the *original*
   directives-check wording by citing PR-001 as the reason DIR-005/DIR-006
   remained unaddressed, without giving either directive an actual
   apply/defer/reject disposition. This is precisely the failure mode
   PR-001 was meant to close, recurring in a slightly mutated form one
   iteration after the gap was first named. The hard-gate block in §4 has
   been edited to explicitly require a disposition per listed file, not an
   acknowledgment of the meta-problem, and to cite this precedent so it
   cannot be repeated by name-checking PR-001 as if that were itself a
   decision.

5. **Residual gate loophole, not fully closable by wording (flagged, not
   fixed).** Even with the tightened gate, "paste the literal `ls` output"
   raises the cost of faking compliance but does not make it impossible —
   a sufficiently motivated (or careless) execution could still fabricate
   a plausible-looking paste that doesn't match the real directory state,
   and nothing in the gate cross-checks the pasted text against an
   independently-verifiable source at review time. The gate's real
   strength is that a *stale* copy-paste becomes visibly wrong on
   inspection (the original mechanism this proposal correctly identifies),
   not that fabrication becomes impossible. This residual risk is judged
   acceptable — the goal is to close the *specific, demonstrated* failure
   mode (verbatim copy-paste of stale prior output), not to build a
   cryptographic audit trail — but it should not be oversold as closing
   the class of "unfaithful execution" generally. A G3 audit or the
   simulated-user pass remains the actual backstop against fabricated
   compliance, not the hard gate itself.

6. **`gap-list.md` (27KB) is not covered by any lever and is trending
   toward the same shape as `provenance.md`.** It is read in full every
   iteration per §0 preconditions and is growing linearly with no bound
   proposed here. Out of scope for this pass (the approved scope in §7 is
   explicitly "Levers 1, 2, 4, plus the hard-gate fix"), but worth flagging
   now rather than rediscovering it as a second context-bloat proposal
   once it reaches `provenance.md`'s current size.

7. **Prior-art check (web search, see citations below):** the general
   direction of this proposal — replacing linear history-scanning with a
   maintained current-state summary, bounding unbounded log-style reads,
   and placing the highest-priority instructions where positional
   attention is strongest — is consistent with current guidance on
   long-running-agent context management and "lost in the middle"
   mitigation. Specifically: placing the hard-gate block at the very top
   of §0 (as drafted) rather than mid-checklist is the right call
   positionally, since multi-turn instruction-following degrades with
   distance from the start/end of context and improves when critical
   instructions are kept near an edge rather than buried in the middle.
   This is corroborating evidence for the hard-gate placement choice, not
   a claim that it was informed by this research originally.
   - [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
   - [Context Window Management for Long-Running Agents: Strategies and Tradeoffs](https://machinelearningmastery.com/context-window-management-for-long-running-agents-strategies-and-tradeoffs/)
   - [Scale AI: A Guide to Improving Long Context Instruction Following](https://scale.com/blog/long-context-instruction-following)
   - [Lost in the Middle in LLMs](https://medium.com/@cenghanbayram35/lost-in-the-middle-in-llms-86e461dc7212)

**Net assessment:** the proposal's core direction (relocate, bound, and
layer rather than delete) is sound and consistent with current best
practice. The most consequential fix from this review is #3 (avoid a second
drifting summary in `provenance.md`) combined with #2 (don't land Lever 2
ahead of the pending settings-adjustment) — both are edits to *how* Lever 2
should be staged, not to whether it should happen. #4/#8 closes a
confirmed, not merely hypothetical, gate loophole. No finding here argues
against proceeding with the approved scope in §7.
