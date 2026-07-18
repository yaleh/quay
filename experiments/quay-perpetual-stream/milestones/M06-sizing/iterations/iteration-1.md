# M06-sizing — iteration-1 (independent re-verification of iteration-0's claims)

**Milestone:** M06-sizing (explore, method-infra, no VT chart weight)
**Charter:** `experiments/quay-perpetual-stream/charters/M06-sizing.md`
**Worktree:** `experiments/quay-perpetual-stream/milestones/M06-sizing/worktrees/iteration-1`
**Branch:** `exp5-m06-iteration-1`
**Date:** 2026-07-18

## §0 Why this iteration exists

iteration-0 (branch `exp5-m06-iteration-0`) landed all 5 Done-when clauses in a single pass and
recommended the milestone be marked DONE **without** an iteration-1, arguing its own work is "pure
`.md`/script edits, no external/CI state that could yield new independent findings on
re-verification" — applying its own newly-authored size gauge to itself.

The outer-loop orchestrator rejected this self-exemption as a self-referential audit failure
exactly of the shape `inherited-core.md`'s own Domain-misfit Step 2 warns against: the same process
that produced the work also declared it exempt from independent verification, with no second
observer. This iteration is that second observer. Every claim below was independently re-derived,
not read off iteration-0's prose.

## §1 HARD GATES (pasted raw output)

### Gate 1 — directives/pending/ disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md
```

**This differs from iteration-0's gate-1 result** (iteration-0 saw only `.gitkeep`, zero real
files). DIR-005 was created by the human directly in this live conversation, concurrently with or
shortly after iteration-0's run, and was NOT visible to iteration-0 — it is new to this iteration.

**Disposition (this iteration's own words):** DIR-005 requests a new methodology-infrastructure
milestone (`M-VMETA-GATE`) to track/alarm/gate V_meta consolidation lag at the outer-loop ABSORB
boundary. Its own text states its relationship to DIR-004/M06-sizing explicitly: "the sole
connection is charter overhead ... that work stays in DIR-004 and is only referenced, not
duplicated here, to keep both directives' Done-when disjoint." M06-sizing's charter in-scope list
(items 1-6) does not include a V_meta ledger, consolidation-lag health track, or ABSORB gate —
DIR-005's five Done-when clauses are a disjoint scope from all of M06-sizing's. **DISPOSITION:
deferred — out of scope for M06-sizing's charter; belongs to a future outer-loop SELECT (as
`M-VMETA-GATE` or folded into the next methodology-infra milestone, per DIR-005's own suggested
resolution path). Not applied, not rejected — genuinely deferred with a stated reason**, consistent
with this milestone's own charter (which does not authorize DIR-005-shaped scope expansion) and
with DIR-005's own explicit non-duplication instruction.

### Gate 2 — manda hub health

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

### Gate 3 — G7 reachability

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

### Gate 4 — worktree creation

```
$ git worktree add experiments/quay-perpetual-stream/milestones/M06-sizing/worktrees/iteration-1 -b exp5-m06-iteration-1
Preparing worktree (new branch 'exp5-m06-iteration-1')
HEAD is now at d5ba266 Add DIR-005: V_meta consolidation lag — track, alarm, gate the inner->outer hand-off
```

Note: this branches from current `master`, which does **not** yet include iteration-0's actual
work (that exists only on `exp5-m06-iteration-0`, commits `b16e4ec`/`13fd062`) — by design, per the
dispatch instructions, so this iteration's re-verification starts from a genuinely independent base
rather than inheriting iteration-0's tree.

### Gate 5 — gate-hash check on this milestone's own charter

```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M06-sizing.md
PASS: experiments/quay-perpetual-stream/charters/M06-sizing.md HARD GATES block matches pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) modulo declared [PARAM: ...] substitutions.
```

(Run from the worktree, same result as iteration-0's gate-5 — the pinned source has not drifted.)

## §2 Independent re-verification — all 6 items

### Item 1 — Size definition + verify-iteration gauge (Done-when 1): **confirmed as claimed**

Read the actual diff (`git diff master exp5-m06-iteration-0 -- inherited-core.md`, not iteration-0's
prose report). The new "Milestone size definition + verify-iteration size gauge" section is
genuinely present: a size definition matching DIR-004's own wording, a concrete UNDER-SIZED /
OVER-SIZED / correctly-sized decision procedure, and three worked examples (m1 oversized, m2/m4
correctly sized).

Independently re-derived the m1/m2/m4 claims from `dashboard.md`'s actual Log section (not from
iteration-0's report):
- **m1/M01-dist**: `dashboard.md` line 163-170 (ABSORB log entry) states verbatim: "Iteration-1:
  pushed to real `origin`... tag-pushed v0.3.0→v0.3.4 fixing 4 distinct real CI failures (Windows
  MSYS path resolution needing `cygpath -w`; `gh` absent in the bare container, switched to REST
  API; private-repo release assets needing the dedicated `/releases/assets/{id}` endpoint...) to a
  fully green run." This is genuine new build work in iteration-1, not pure re-verification —
  **confirms OVERSIZED**, exactly as iteration-0 characterized it.
- **m2/M-GATES**: `dashboard.md` line 195-213 states iteration-0 built+committed all 3 scripts,
  found+fixed one real bug in its own gate-hash script; iteration-1 "was a deliberately lightweight
  stability-confirmation pass... independently re-ran all 3 scripts against fresh fixtures (zero
  drift)... investigated the dogfood-gate's FAIL against M01-dist iteration-0.md and confirmed it a
  correct positive" — real independent re-derivation with a genuine outcome that could have gone
  either way. **Confirms correctly-sized**, exactly as iteration-0 characterized it.
- **m4/M04-discover**: `dashboard.md` lines 99-117 document the arithmetic: iteration-0's report
  claimed VT chart-1 total 95.83/120; independently re-summing the cited per-surface values
  (20.00+18.00+18.40+17.00+8.25+13.08) via `python3 -c "print(...)"` gives 94.73, not 95.83 — "a
  pure ... arithmetic slip of 95.83 during iteration-1's independent re-verification." **Confirms
  correctly-sized** with a real caught error, exactly as iteration-0 characterized it.

No mischaracterization found in item 1 — the m1/m2/m4 worked examples hold up against
`dashboard.md`'s actual log text, not just iteration-0's paraphrase of it.

### Item 2 — Value-typed ledger + governance/infra hard floor (Done-when 2): **confirmed as claimed**

Read the actual diff. The 5 value types (capability-growth, discovery, instrument-correction,
risk/option, governance-integrity) are genuinely defined with one-line descriptions. The
governance/infra hard floor is genuinely present and states the DIR-002/DIR-006 generalization.

`OUTER-LOOP.md`'s SELECT step (step 1) diff is genuinely substantive, not decorative: it adds a
mandatory "size the candidate BEFORE dispatch" instruction (referencing the new gauge), a mandatory
"record each candidate's value type(s)... alongside its VT Δv̂" instruction with VT explicitly
demoted to "one input among several, never the sole ranker", and the governance/infra hard-floor
check as a required SELECT-time action. This is a real process requirement, not prose window
dressing — it changes what SELECT must record, not just what it may.

### Item 3 — Gate-hash-by-reference mechanism (Done-when 3): **confirmed as claimed, with independently re-run evidence**

This is the most technically involved claim; scrutinized directly rather than trusting the pasted
report output.

**Script extension re-read directly** (`git diff master exp5-m06-iteration-0 --
scripts/it0-gate-hash-check.sh`): genuinely adds a `--by-reference` mode. Given a charter, it
extracts a `GATE-HASH-REF: <sha256> (<path> lines <range>)` line, recomputes the sha256 of the
CURRENT pinned block (lines 100-131 of `ITERATION-PROMPTS.md`), and PASS/FAILs on exact match.
Default (no-flag) mode's code path is untouched — confirmed by reading the diff, not just the
report's assertion.

**Re-ran the command myself** (extracted iteration-0's actual committed files via `git show
exp5-m06-iteration-0:<path>`, copied to a scratch location, ran the actual script from repo root):

```
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check-VERIFY-TMP.sh --by-reference /tmp/M01-dist-by-reference-VERIFY.md
PASS: /tmp/M01-dist-by-reference-VERIFY.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
EXIT: 0
```

Genuinely PASSES, exit 0. Matches iteration-0's pasted output exactly.

**Independently counted tokens myself** (this repo has `tiktoken` available; used the identical
`cl100k_base` encoding iteration-0 reports using):

```
$ python3 -c "
import tiktoken
enc = tiktoken.get_encoding('cl100k_base')
text = open('/tmp/M01-dist-by-reference-VERIFY.md').read()
print('real tokens:', len(enc.encode(text)))
"
real tokens: 1796
$ wc -l /tmp/M01-dist-by-reference-VERIFY.md
95
```

I independently measured **1796 tokens** (iteration-0 reported 1798 — a 2-token discrepancy,
plausibly a tiktoken minor-version/library difference; immaterial, both numbers are well under the
2K alarm and both confirm the proof-of-concept genuinely shrank the charter). Line count matches
exactly (95).

For contrast, re-measured the original `M01-dist.md` myself: **2476 real tokens / 136 lines** —
matches iteration-0's separately-reported figure exactly, and confirms the by-reference form's
claimed ~27% reduction is real (2476→1796/1798, removing the ~50-line fenced gate block).

**Verified the "dispatched agent's actual prompt still contains literal gate text" claim** by
reading `M01-dist-dispatch-prompt-worked-example.md`'s full content myself (not iteration-0's
excerpt). The file genuinely contains the complete, literal HARD GATES block text — compared side
by side against `sed -n '100,131p' experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
(the pinned source) — and it matches verbatim modulo the same kind of `[PARAM: ...]` substitutions
(directive-dir path, worktree path/branch name) every other real charter's verbatim transclusion
uses. This is not a hash reference standing in for the text; it is the actual gate prose, present
in full, inside a worked dispatcher-prompt artifact.

**Regression-re-ran default mode myself** against all 6 real charters:

```
$ for f in experiments/quay-perpetual-stream/charters/*.md; do
    ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check-VERIFY-TMP.sh "$f"
  done
PASS: .../M01-dist.md ...
PASS: .../M02-gates.md ...
PASS: .../M03-abi-eval.md ...
PASS: .../M04-discover.md ...
PASS: .../M05-dir-projection.md ...
PASS: .../M06-sizing.md ...
```

All 6 PASS, matching iteration-0's claim exactly. Item 3 is genuinely confirmed, not merely asserted.

### Item 4 — Self-consistency table (Done-when 4): **CORRECTION — a real mismatch found and fixed**

First confirmed the read-only property: `git diff master exp5-m06-iteration-0 --
experiments/quay-perpetual-stream/dashboard.md` is genuinely **empty** — `dashboard.md` was never
touched by iteration-0's commits. Confirmed a second way: diffed the worktree's post-merge
`dashboard.md` byte-for-byte against the repo-root copy — identical (exit 0). The self-consistency
table is genuinely read-only, as claimed.

**But the table content itself does NOT reproduce DIR-004's own table.** Read DIR-004's archived
text directly (`experiments/quay-perpetual-stream/directives/archive/DIR-004-milestone-sizing-cost-band-and-value-typed-selection.md`,
lines 51-56) — its own table reads, verbatim:

```
| milestone | Δv (VT) | real value type | VT captured it? |
| m1 M-DIST | +6.0 | capability growth on an existing surface | yes |
| m2 M-GATES | 0 | risk/option value (pre-empted 3 wasted SELECTs) | no — scored 0 |
| m3 M-ABI-EVAL | +13.08 ... | discovery value (blind spot + 2 real bugs) | no |
| m4 M04-discover | −6.60 | instrument-correction value (exposed exp4's false "closed" ledger, MD-001) | no |
```

iteration-0's self-consistency table (`inherited-core.md`, as committed on `exp5-m06-iteration-0`)
instead labeled **m2 as `governance-integrity`**, justified by a quote — `"m2 ... scored 0 VT
despite being real governance/method-infra wins"` — attributed to DIR-004. That exact phrase does
**not** appear anywhere in DIR-004's archived text (`grep -n "real governance\|method-infra wins"`
against the archived file returns zero matches). DIR-004's own table explicitly types m2 as
**risk/option**, not governance-integrity — governance-integrity in DIR-004's text is applied to
**m5/M-DIR-PROJECTION**, not m2 (DIR-004 predates m5 and does not type m5 in its own table at all,
since DIR-004 was written reviewing only m1-m4; the "governance-integrity, VT 0" phrase for
M-DIR-PROJECTION appears in DIR-004's §B "Consequence" paragraph discussing m5 SELECT candidates,
not about m2).

This is a genuine mischaracterization, not a defensible interpretation: the milestone's own
Done-when 4 text requires the table to "reproduce DIR-004's own table" — and on m2 specifically, it
did not. m1, m3, m4 rows were independently checked and are correct (m1=capability-growth,
m3=discovery — matching DIR-004's prose "VT is blind to discovery value (m3)" since m3 postdates
DIR-004's own table rows which stop at m4, and m4=instrument-correction, matching verbatim).

**Fixed in this iteration's worktree** (`inherited-core.md`, committed `c9917f7`): relabeled m2 as
`risk/option`, replaced the fabricated-quote justification with the actual DIR-004 table line
quoted verbatim, and added an explicit correction note documenting what was wrong and why. Also
corrected the section's motivating prose paragraph (which had the same "real governance/method-infra
wins" framing applied to both m2 and m5) to attribute risk/option to m2 and governance-integrity to
m5 separately, matching DIR-004's actual text.

```diff
-| m2/M-GATES | 0 | **governance-integrity** (mechanized 3 of 4 it0 checks, ...) | Yes — DIR-004
-  explicitly cites "m2 ... scored 0 VT despite being real governance/method-infra wins", i.e.
-  non-capability-growth, matching governance-integrity here. |
+| m2/M-GATES | 0 | **risk/option** (mechanized 3 of 4 it0 checks, ... — pre-empted wasted SELECTs
+  on stale/unreachable candidates, e.g. the M-CLI-UX rejection at m2's own attempt-1 and
+  M-DOCS/M-DIRTASK rejections at m3) | Yes — DIR-004's own table (archived directive, line 54)
+  reads verbatim: "m2 M-GATES | 0 | risk/option value (pre-empted 3 wasted SELECTs) | no — scored
+  0", matching risk/option here exactly. (**Correction, iteration-1**: ... Fixed to match DIR-004's
+  own table verbatim ...) |
```

(Full diff: `git -C .../worktrees/iteration-1 show c9917f7 -- experiments/quay-perpetual-stream/inherited-core.md`.)

### Item 5 — Test suite (Done-when 5): **confirmed as claimed**

Re-ran the full suite myself from this iteration's own worktree, post-merge, post-fix:

```
$ node --test packages/*/test/*.test.mjs > /tmp/test_output_it1.log 2>&1; echo "EXIT: $?"
EXIT: 0
$ grep -c "^✔ " /tmp/test_output_it1.log
31
$ grep -c "^✖ " /tmp/test_output_it1.log
0
$ grep "ℹ fail" /tmp/test_output_it1.log
ℹ fail 0
$ grep "ℹ pass" /tmp/test_output_it1.log
ℹ pass 31
```

31/31 test files pass, 0 failures, exit code 0 — matches iteration-0's claimed count exactly. No
regression from the M06-sizing content itself (the `.md` edits touch no code path) nor from this
iteration's own correction (a prose-only fix inside a `.md` file).

### Item 6 — "Charter-thickness is word-count not token-count" finding: **spot-checked, real, correctly out-of-scope**

Independently re-measured all 6 real charters with `tiktoken`/`cl100k_base` myself (not just
M01-dist, which is all iteration-0's report showed in full):

```
$ python3 -c "
import tiktoken, glob
enc = tiktoken.get_encoding('cl100k_base')
for f in sorted(glob.glob('experiments/quay-perpetual-stream/charters/*.md')):
    print(f, 'real tokens:', len(enc.encode(open(f).read())))
"
experiments/quay-perpetual-stream/charters/M01-dist.md real tokens: 2476
experiments/quay-perpetual-stream/charters/M02-gates.md real tokens: 3062
experiments/quay-perpetual-stream/charters/M03-abi-eval.md real tokens: 3180
experiments/quay-perpetual-stream/charters/M04-discover.md real tokens: 2972
experiments/quay-perpetual-stream/charters/M05-dir-projection.md real tokens: 2876
experiments/quay-perpetual-stream/charters/M06-sizing.md real tokens: 3676
```

The finding is real and, if anything, understated by iteration-0 (which only fully measured
M01-dist and left the others as "not re-run this pass"): **all 6 existing charters, including
M06-sizing's own, are well over the 2K real-token alarm** — `dashboard.md`'s tracked
`~1.8K/~2.1K/~2.0K/~2.0K/~1.9K` figures (word-count based, `wc -w`) undercount real BPE tokens by
roughly 35-55% across the board, not just on M01-dist.

**Judgment on scope**: agree with iteration-0's call that fixing `dashboard.md`'s tracked
charter-thickness row is legitimately out-of-scope for M06-sizing's own 6-item in-scope list (none
of items 1-6 authorize editing that tracked metric row) and does not block any of the 5 Done-when
clauses, all of which are about DEFINING the gauge/ledger/mechanism, not about retroactively fixing
every existing charter's thickness. However, iteration-0's report explicitly said this finding
"wasn't" logged as a gap-list entry and merely flagged it "for the next outer-loop session to
consider" — that is weaker than warranted given how directly this bears on Done-when 3's own
"under 2K" claim (which iteration-0 satisfied on the PROOF-OF-CONCEPT file specifically, correctly,
but the underlying dashboard-tracked metric that motivated the whole milestone is shown by this same
measurement to be silently wrong repo-wide). Recommend the ABSORB step for this milestone add a
gap-list entry (not fix the row directly) so the finding isn't lost between now and whenever the
next outer-loop session reads this report — a cheap, low-risk addition consistent with this
milestone's own existing scope (documenting a finding, not fixing the tracked row).

## §3 Done-when — status with this iteration's own evidence

| # | Clause | Status (iteration-1 independent check) |
|---|---|---|
| 1 | Size definition + verify-iteration gauge, referenced from SELECT | **MET** — confirmed against `dashboard.md`'s actual log text (§2 item 1) |
| 2 | Value-typed ledger + governance/infra hard floor, SELECT step updated | **MET** — confirmed substantive, not decorative (§2 item 2) |
| 3 | Gate-hash-by-reference demonstrated on REAL charter, PASS + real count <2K, literal-text confirmed | **MET** — independently re-run, PASS reproduced, tokens independently recounted (1796 vs. claimed 1798, immaterial), literal gate text confirmed present verbatim (§2 item 3) |
| 4 | Self-consistency check reproduces DIR-004's own m1-m5 table (read-only) | **MET, after correction** — m2 was mislabeled governance-integrity (should be risk/option per DIR-004's own table) with a fabricated supporting quote; fixed in this iteration's worktree, commit `c9917f7` (§2 item 4) |
| 5 | Full test suite passes | **MET** — 31/31, exit 0, independently re-run from this worktree (§2 item 5) |

All 5 Done-when clauses are MET as of this iteration's committed state (post-correction).

## §4 Isolation proof (end-of-iteration)

```
$ git -C experiments/quay-perpetual-stream/milestones/M06-sizing/worktrees/iteration-1 status --short
(clean)
```

```
$ git -C /home/yale/work/quay status --short -- experiments/
(clean)
```

Both clean: all iteration-1 work (the merge of iteration-0's actual content plus the m2
value-type correction) is committed on `exp5-m06-iteration-1`; the shared tree at repo root shows
zero drift.

```
$ git -C experiments/quay-perpetual-stream/milestones/M06-sizing/worktrees/iteration-1 log --oneline -5
c9917f7 M06-sizing iteration-1: correct self-consistency table m2 value-type mismatch
626048e Merge exp5-m06-iteration-0 into iteration-1 (independent re-verification pass)
13fd062 M06-sizing iteration-0: iteration report
b16e4ec M06-sizing iteration-0: size definition, verify-iteration gauge, value-typed SELECT ledger, governance/infra hard floor, gate-hash-by-reference mechanism
d5ba266 Add DIR-005: V_meta consolidation lag — track, alarm, gate the inner->outer hand-off
```

Branch `exp5-m06-iteration-1` contains the final, verified state: iteration-0's actual committed
work (merged, not re-typed from prose) plus this iteration's one correction.

## §5 Recommendation — is the milestone DONE now?

**Yes, DONE now — but only after this iteration's correction, and this iteration was genuinely
necessary, not a formality.**

All 5 Done-when clauses are confirmed MET with this iteration's own independently-derived evidence,
now including the fix to Done-when 4. This is the milestone's first CLEAN confirmed pass — the
"2nd consecutive clean confirmation" pattern this experiment normally requires (iteration-0
delivering, iteration-1 independently re-verifying and finding it clean) did NOT actually occur on
the first attempt: iteration-1 (this one) found a real, non-trivial defect in iteration-0's own
Done-when 4 evidence and had to fix it before the milestone's evidence set was actually correct.

Per the milestone's own newly-authored verify-iteration size gauge (ironic but apt, since this is
exactly the self-application iteration-0 attempted and got wrong): "iteration-1 is forced into new
build work" is one of the two named signals — but the correct reading here is narrower than a full
OVER-SIZED verdict. The fix was a one-paragraph-scope correction inside an already-in-scope
Done-when 4 artifact (fixing a table row iteration-0 itself was required to produce), not new
Done-when-scoped work outside the charter's 6 in-scope items. This is closer to "iteration-1 caught
a real error via genuine independent re-derivation" (the m2/m4 correctly-sized pattern) than to
"iteration-1 had to do net-new build work" (the m1 oversized pattern) — the milestone's OWN sizing
was fine; iteration-0's EXECUTION on one Done-when clause had a real, catchable defect, which is
precisely the class of thing the 2-iteration independent-verify pattern exists to catch. No further
iteration-2 is warranted: the defect found was narrow, fully characterized, and fixed with pasted
evidence in this same iteration, and no other item (1, 2, 3, 5, or 6) surfaced any further defect
under equally close scrutiny.

Recommending: **milestone DONE**, ABSORB should merge `exp5-m06-iteration-1` (not
`exp5-m06-iteration-0` directly — iteration-0's tree has the uncorrected table) to `master`, and the
ABSORB entry should note the m2 correction plus add a gap-list entry for the charter-thickness
under-measurement finding (§2 item 6) so it is not lost.

## §6 Explicit verdict: was iteration-0's "no iteration-1 needed" self-exemption justified in hindsight?

**No — it was not justified, and this iteration is direct evidence against it, not just a formal
rebuttal of its reasoning.**

iteration-0's argument was structural: ".md/script edits have no external/CI state that could
drift between iteration-0 and a re-run, so re-running the same deterministic checks would yield
byte-identical results." That argument is TRUE for items 3 and 5 (the gate-hash-check PASS/FAIL
result and the test-suite pass count genuinely are deterministic and did reproduce identically here
— 1796 vs 1798 tokens is a measurement-tool nuance, not drift, and both checks PASSED exactly as
before). But the argument silently assumed the only thing worth re-verifying was MECHANICAL
determinism (would the same command produce the same output) — it did not consider that a
Done-when clause's own CONTENT could be wrong independent of any external state changing. Done-when
4 required a table that "reproduces DIR-004's own table" — that is not a deterministic-command
check, it is a CLAIM ABOUT A COMPARISON, exactly the kind of thing a second reader with fresh eyes
(not the same process that wrote the comparison) is positioned to catch and the writing process is
structurally poorly positioned to catch (the same reasoning that produced the (wrong) mapping also
produced the (wrong) "Yes, matches" verdict next to it — textbook confirmation bias, not a
tooling/build-state problem at all).

This matches the base-rate pattern named in the dispatch context exactly: 3 of 5 prior milestones
(M02, M04, M05) had real, non-trivial bugs caught by independent re-verification, and this
iteration makes it **4 of 6** — a prose/comparison-fidelity bug in M06-sizing's own self-consistency
table, caught by the same "second observer" discipline the milestone's own charter cites the
domain-misfit procedure for. iteration-0's exemption claim reasoned correctly about EXTERNAL STATE
determinism but did not recognize that its own DONE-WHEN-4 CLAIM had exactly the self-referential
audit-channel gap `inherited-core.md`'s own Step 2 warns about: the same process that wrote the
comparison table also declared (in its own §9 recommendation) that no further check was needed —
without ever having a second, independent reader check whether the comparison it had just written
was itself accurate. The outer-loop orchestrator's rejection of the self-exemption was correct, and
this iteration is the concrete evidence, not a hypothetical one.

## §7 Artifacts

- `experiments/quay-perpetual-stream/inherited-core.md` (corrected, this worktree, commit `c9917f7`)
  — m2 value-type row + supporting prose fixed to match DIR-004's own table.
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`, `scripts/it0-gate-hash-check.sh`,
  `milestones/M06-sizing/proof-of-concept/*` — merged unchanged from `exp5-m06-iteration-0`
  (confirmed correct, no further edits needed).
- This report: `experiments/quay-perpetual-stream/milestones/M06-sizing/iterations/iteration-1.md`.
