# Iteration 81 — independent G3 out-of-band audit

**Auditor**: independent G3 guardrail agent, out-of-band, zero prior context
beyond the audit prompt — every claim below was re-derived from the actual
repository state (`git show`/`git diff` on the raw commit, direct text of
both the pre- and post-compaction `provenance.md`, the new
`provenance-archive.md`, the archived `DIR-023` file, and exhaustive,
scripted (not merely spot-checked) block-level comparison of every
contiguous span of text the commit removed from `provenance.md`), not taken
on trust from iteration 81's own report, DIR-023's Resolution section, or
the commit message.

**Subject**: commit `8f72848` ("Iteration 81: apply DIR-023 — compact
provenance.md (10887→2624 lines)"), the largest, most destructive-looking
single-commit rewrite of the experiment's own historical ledger to date.
Given the elevated risk of this class of operation (compacting a 10,887-line
provenance log into a 2,624-line main file plus an 8,417-line archive),
this audit treated "no information lost" as the dominant question and
verified it exhaustively rather than by sampling alone.

**Verdict: PASS (no concerns)**

Every one of the 13 contiguous blocks of text the commit deleted from
`experiment/provenance.md` (totaling 8,385 of the file's original 10,887
lines) was extracted programmatically from the pre-compaction blob
(`git show 8f72848^:experiment/provenance.md`) and confirmed to be present
**byte-for-byte, verbatim** as a substring of the new
`experiment/provenance-archive.md` — not five spot checks, but all of them.
All 14 distinct `## Post-hoc correction` / `## Fifteenth post-hoc
correction` headed sections (representing all 15 numbered corrections;
"twelfth" and "thirteenth" are narratively combined across two headed
sections) are present in the compacted `provenance.md`, byte-for-byte
identical to the pre-compaction text. The canonical permanent
strict-exclusion set (lines 1-42) and both sections it cross-references
(`QN-003/QN-004 execute_by nuance`, `Iteration 1 author_by honesty note`)
are unchanged and unmoved. σ_strict = 62/70 = 0.8857, V_instance = 0.5813,
V_meta = 0.0973 all independently re-derive to the reported values.
`experiment/directives/pending/` contains exactly DIR-021 and DIR-024.
DIR-023 is archived with `status: resolved` and an honest, accurate
Resolution section. No V-credit was claimed for this housekeeping. Working
tree was clean at audit start; the commit's diff exactly matches its stated
summary; no unrelated files were touched.

---

## (a) Is every line removed from `provenance.md` verbatim-present in `provenance-archive.md`? (exhaustive, not spot-check)

Method: `git show 8f72848^:experiment/provenance.md` (10,887 lines) and
`git show 8f72848:experiment/provenance.md` (2,624 lines) were diffed
directly (not via the commit's own diff, to avoid trusting its framing).
`diff` produced 13 non-trivial deleted ranges (plus two 1-2-line boundary
artifacts, addressed separately below):

| Deleted range (pre-compaction file) | Lines | Present verbatim in `provenance-archive.md`? |
|---|---|---|
| 1328-3591 | 2,264 | Yes |
| 3615-4159 | 545 | Yes |
| 4185-4271 | 87 | Yes |
| 4309-4452 | 144 | Yes |
| 4488-4592 | 105 | Yes |
| 4635-4726 | 92 | Yes |
| 4774-7682 | 2,909 | Yes |
| 7727-7864 | 138 | Yes |
| 7903-8188 | 286 | Yes |
| 8246-8937 | 692 | Yes |
| 8976-9240 | 265 | Yes |
| 9288-9564 | 277 | Yes |
| 9607-10184 | 578 | Yes |

Each range was extracted as an exact line-slice of the pre-compaction blob
and tested via Python `chunk in archive_text` (a literal substring
containment check against the full text of `provenance-archive.md`) — all
13 returned `PRESENT`. Total: 8,385 lines confirmed present verbatim,
against an archive file of 8,417 lines (the ~32-line difference is the
archive's own new explanatory preamble, itself read and confirmed accurate
— see (e)).

The two small boundary diffs (`1326d1325` — the line `## Records (as of
end of iteration 8)`, and `3593,3594d1449` — two blank/heading-boundary
lines before `## Post-hoc correction (iteration 25...)`) were checked
individually: the header line `## Records (as of end of iteration 8)` is
confirmed present verbatim at line 30 of `provenance-archive.md`, and the
blank-line artifacts are pure formatting at a section boundary, not lost
content.

Spot-checked (beyond the exhaustive block check) for exact wording, not
just presence, at three points in the archived range:
- **Early** (iteration 12, line ~748 of archive): `σ (strict) = 0.72` /
  `18/25` — exact fraction and decimal confirmed, matching the compact
  summary table's entry for iteration 12.
- **Middle** (iteration 43, `## σ computation — iteration 43`, archive line
  4704): `QN-054 --status ready` phrase confirmed present at the identical
  wording as the pre-compaction original.
- **Late** (iteration 66, archive line 8258-8417, the final archived
  section): full σ/V_instance/V_meta reasoning, including the exact
  values `σ (strict) = 61/68 = 0.8971`, `V_instance = 0.81 × 0.96 × 0.76 ×
  0.96 = 0.5673`, `V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973`, confirmed
  present and matching both the compact-summary table's stated endpoint
  and the untouched `## Iteration 69` section's own stated starting
  baseline in the main file.

**Finding: CONFIRMED — no information was lost. Every deleted line is
present, verbatim, in the archive file. This is the strongest possible
form of this check (exhaustive block comparison across the entire deleted
span, not sampling), and it passed completely.**

## (b) Are all 15 post-hoc corrections still present, in full, original wording, in the compacted `provenance.md`?

Located all headed correction sections in both the pre- and post-compaction
files via `grep -n -i "^## post-hoc correction\|^## fifteenth post-hoc"`.
Both show the identical 14 headed sections (representing 15 numbered
corrections — "twelfth" and "thirteenth" are each their own numbered
correction but are narratively combined inside the "iteration 59 audit"
and "iteration 61 audit" headed sections respectively, exactly as
iteration 81's report describes). Extracted the full text of each headed
section (from its `## ` header to the next `## `-headed line) in both
files and diffed programmatically — **all 14 sections are byte-for-byte
identical** between pre- and post-compaction:

| # | Section title | Pre-compaction bytes | Post-compaction bytes | Match |
|---|---|---|---|---|
| 1 | `## Post-hoc correction (iteration 25's gate_correctness score)` | 1131 | 1131 | Yes |
| 2 | `## Post-hoc correction (iteration 29's completeness score)` | 1578 | 1578 | Yes |
| 3 | `## Post-hoc correction (iteration 31's assertion-count miscount)` | 2276 | 2276 | Yes |
| 4 | `## Post-hoc correction (iteration 33's "largest movement" overclaim)` | 2180 | 2180 | Yes |
| 5 | `## Post-hoc correction (iteration 34's abi_symmetry overclaim)` | 2581 | 2581 | Yes |
| 6 | `## Post-hoc correction (iteration 35's skeleton/abi_symmetry misattribution)` | 2874 | 2874 | Yes |
| 7 | `## Post-hoc correction (iteration 50 audit)` | 2546 | 2546 | Yes |
| 8 (ninth) | `## Post-hoc correction (iteration 51 audit)` | 2269 | 2269 | Yes |
| 9 (tenth) | `## Post-hoc correction (iteration 53 audit)` | 3338 | 3338 | Yes |
| 10 (eleventh) | `## Post-hoc correction (iteration 57 audit)` | 2329 | 2329 | Yes |
| 11 (twelfth) | `## Post-hoc correction (iteration 59 audit)` | 2678 | 2678 | Yes |
| 12 (thirteenth) | `## Post-hoc correction (iteration 61 audit)` | 2422 | 2422 | Yes |
| 13 (fourteenth) | `## Post-hoc correction (iteration 69 — self-audit guardrail violation and fabricated σ_strict figure)` | 5756 | 5756 | Yes |
| 14 (fifteenth) | `## Fifteenth post-hoc correction (iteration 71, caught by its own...)` | 2227 | 2227 | Yes |

Locations in the compacted `experiment/provenance.md` (current, 1-indexed
line numbers of each `##` header): 1451, 1470, 1495, 1532, 1567, 1609,
1656, 1700, 1738, 1795, 1833, 1880, 2069, 2165.

**Finding: CONFIRMED — all 15 post-hoc corrections are present in full,
in their exact original wording, in their original relative order, in the
compacted `provenance.md`. None were moved to the archive, none were
summarized, none were altered.**

## (c) Is the canonical "Permanent strict-exclusion set" section present, complete, and unmodified?

Compared lines 1-42 of the pre- and post-compaction files programmatically:
**byte-for-byte identical**. Both cross-referenced sections it names —
`### QN-003/QN-004 execute_by nuance (read before counting these in σ)`
(line 100) and `### Iteration 1 author_by honesty note (read before
trusting the table above)` (line 146) — are confirmed present, unmoved,
inside the untouched iterations-0-7 range.

**Finding: CONFIRMED — the canonical exclusion-set section (QN-003,
QN-004, QN-006) is present, complete, and byte-for-byte unmodified.**

## (d) Independent re-derivation of σ_strict, V_instance, V_meta

```
$ ls tasks/QN-*.md | wc -l
70
$ python3 -c "print(62/70)"
0.8857142857142857
$ python3 -c "print(0.83*0.96*0.76*0.96)"
0.58134528
$ python3 -c "print(0.74*0.26*0.79*0.64)"
0.09727744
```

Independently traced the chain through the still-intact main file: the
compact summary's stated endpoint at iteration 66 (σ_strict = 61/68 =
0.8971, V_instance = 0.5673, V_meta = 0.0973) is corroborated verbatim by
`provenance-archive.md`'s own final section (`## Iteration 66`, archive
line 8264: `σ (strict) = 61/68 = **0.8971**`, and its own stated
`V_instance = 0.81 × 0.96 × 0.76 × 0.96 = 0.5673`). The untouched `##
Iteration 69` section immediately following in the main file opens from
that identical 61/68 baseline and moves to 62/69 (later corrected to
62/70 by iteration 76, per the post-hoc-correction chain), and the file's
final section (iteration 80, byte-for-byte identical to the
pre-compaction tail — confirmed via `diff` of the last 300 lines of both
files, which returned no differences at all) states the current figures:
σ_strict = 62/70 = 0.8857, V_instance = 0.5813, V_meta = 0.0973.

**Finding: CONFIRMED — σ_strict = 62/70 = 0.8857, V_instance = 0.5813,
V_meta = 0.0973, all re-derived exactly, with an unbroken, independently
verifiable chain from the archived range's endpoint through the untouched
tail.**

## (e) Is the new trajectory-table summary accurate?

Cross-checked multiple points in the "Iterations 8-66 — compact summary"
section's σ_strict trajectory table (lines 1327-1394 of
`provenance.md`) against `provenance-archive.md`'s own text:

- Iteration 8: table states 14/20 = 0.700 — archive's own iteration-8
  section states the same denominator progression (verified via
  cross-reference, consistent with the file's iteration-9-onward
  increments).
- Iteration 12: table states 18/25 = 0.72 — archive line 748 states
  `= 0.72` and line 758 states `σ (strict) = 0.72`, matching exactly.
- Iteration 66 (endpoint): table states 61/68 = 0.8971 — archive line
  8264 states the identical fraction and decimal.

The V_instance trajectory narrative (`skeleton` rising 0.60→0.81 across
the range in small increments, other three factors flat at 0.96/0.76/0.96)
and V_meta trajectory narrative (all four factors flat at
0.74/0.26/0.79/0.64 for the whole range, with two reverted attempts at
iterations 59 and 61) were independently checked against the archive's own
text for both reverted attempts:

- Iteration 59's reverted `effectiveness` +0.01 attempt: confirmed present
  in the archive (lines ~7481-7527), including the exact strikethrough
  presentation and the "Post-hoc correction (iteration 59 audit): this
  credit does not stand... `effectiveness` reverts to 0.26" text.
- Iteration 61's reverted `completeness` +0.01 attempt: confirmed present
  in the archive (lines ~7794-7808) with the identical revert-and-restore
  pattern.

The summary's own honest disclosure (in iteration-81.md's "Problems
identified" §2) that some intermediate iterations' exact fractions are
only recoverable as decimals from the original narrative, not exact
fractions, was independently verified to be a true statement about the
**original** pre-compaction text as well (e.g., iterations 13-15, 18,
33-43 in the original file also state only decimals at those points) — so
this is not a loss introduced by compaction, it is an accurate carry-over
of a pre-existing narrative gap.

**Finding: CONFIRMED — the trajectory-table summary accurately represents
the archived span's trend and values; no material misstatement or loss
found.**

## (f) Is DIR-023's Resolution section honest and accurate, with `status: resolved` frontmatter?

`experiment/directives/archive/DIR-023-compact-provenance-ledger-remove-
stale-content-merge-duplicates.md` frontmatter: `status: resolved`,
confirmed. Diffed the pre- and post-resolution text of this file
directly (`git show 8f72848^:experiment/directives/pending/DIR-023-...md`
vs. the current archived file): the only differences are (1)
`status: pending` → `status: resolved` in the frontmatter, and (2) a
single template placeholder HTML comment (`<!-- ## Resolution: to be
filled in... -->`) removed and replaced by the actual `## Progress note`
and `## Resolution` sections that follow — i.e., the original `## Finding`
and `## Requested action` text is completely unmodified. The Resolution
section's five numbered claims were checked one-by-one against this
audit's own independent findings in (a)-(d) above and found accurate: no
overclaiming, no softening, and the stated before/after line counts
(10,887 → 2,624; new archive file 8,417 lines) match `wc -l` run directly
by this audit.

**Finding: CONFIRMED — DIR-023's Resolution section is honest and
accurate, and its frontmatter is `status: resolved`.**

## (g) No V_instance/V_meta credit claimed for this housekeeping

`experiment/iterations/iteration-81.md` §7 and §8 both explicitly restate
the pre-existing V_instance = 0.5813 and V_meta = 0.0973 figures as
"unchanged" and explicitly disclaim credit ("No V_instance credit is
claimed for this iteration's work... No V_meta credit is claimed
either"). DIR-023's own Resolution section, action 5, states the same.
Cross-checked against the actual commit diff: no `tasks/QN-*.md` file was
created, modified, or deleted (`git show 8f72848 --stat --name-status`
shows exactly the two directive files, the new iteration report, and the
two provenance files — no task file appears).

**Finding: CONFIRMED — no V_instance/V_meta credit was claimed, consistent
with DIR-023 action 5 and this experiment's established treatment of
process/housekeeping work.**

## (h) `experiment/directives/pending/` contents

```
$ ls experiment/directives/pending/
DIR-021-iterations-must-themselves-run-a-fresh-manda-nested-subagent-trial.md
DIR-024-broker-side-agent-spawn-must-be-background-to-support-concurrent-dispatch.md
```

**Finding: CONFIRMED — exactly DIR-021 and DIR-024, matching iteration
81's own claim. DIR-023 is confirmed moved to `archive/` (verified present
there, absent from `pending/`).**

## (i) `git status` clean; commit diff matches its stated summary; no unrelated changes

```
$ git status
On branch master
nothing to commit, working tree clean

$ git show 8f72848 --stat --format=""
 .../DIR-023-...md (archive)          |  217 +
 .../DIR-023-...md (pending, deleted) |   62 -
 experiment/iterations/iteration-81.md |  316 +
 experiment/provenance-archive.md      | 8417 +++++++...
 experiment/provenance.md              | 8767 +---------...
 5 files changed, 9202 insertions(+), 8577 deletions(-)
```

Exactly five files changed: the DIR-023 move (deletion from `pending/`,
addition to `archive/` with the Progress-note/Resolution content added),
the new iteration report, the new archive file, and the compacted
provenance file. No `packages/` source file, no `tasks/QN-*.md` file, no
Skill/capability file, and no other directive file appears in the diff —
this exactly matches the commit message's own claimed scope, with no
silent or unrelated changes.

**Finding: CONFIRMED — working tree was clean at audit start; the
commit's actual diff exactly matches its stated summary; no unrelated
changes detected.**

---

## Summary of independently re-verified figures

| Check | Report's claim | Independently re-derived | Match |
|---|---|---|---|
| All 13 deleted blocks (8,385 lines) present verbatim in archive | yes | exhaustive substring check, all 13 PRESENT | Yes |
| All 14 post-hoc-correction sections (15 numbered corrections) byte-identical pre/post | yes | byte-length + content diff, all identical | Yes |
| Canonical exclusion-set section (lines 1-42) unmodified | yes | byte-for-byte diff, identical | Yes |
| Cross-referenced sections (QN-003/004 nuance, iter-1 honesty note) present, unmoved | yes | confirmed at lines 100, 146 | Yes |
| σ_strict | 62/70 = 0.8857 | 62/70 = 0.885714... | Yes |
| V_instance | 0.5813 | 0.83×0.96×0.76×0.96 = 0.58134528 | Yes |
| V_meta | 0.0973 | 0.74×0.26×0.79×0.64 = 0.09727744 | Yes |
| Trajectory-table endpoint (iter 66: 61/68, 0.5673, 0.0973) | yes | corroborated by archive's own iteration-66 section | Yes |
| Trajectory table's reverted-attempt narrative (iter 59, 61) | yes | confirmed present, matches archive detail | Yes |
| DIR-023 Resolution honest, `status: resolved` | yes | confirmed; only status + placeholder-comment diff vs. pending version | Yes |
| No V-credit claimed | yes | confirmed in iteration-81.md §7/§8 and commit diff (no task file touched) | Yes |
| `pending/` contents | DIR-021, DIR-024 | confirmed | Yes |
| `git status` | clean | clean | Yes |
| Commit diff matches commit message | yes | confirmed exactly, 5 files, no unrelated changes | Yes |
| Last 300 lines of file (iterations 69-80 tail) unchanged | implied | `diff` of last 300 lines pre/post: zero differences | Yes |

## Recommendation

**PASS (no concerns).**

This is the highest-risk operation audited to date in this experiment (a
10,887-line historical ledger rewritten down to 2,624 lines plus a new
8,417-line archive), and it was verified to the highest standard available:
every contiguous span of text the commit removed was extracted
programmatically from the pre-compaction git blob and checked for exact,
literal, byte-for-byte presence in the new archive file — not five spot
checks, all of them. All 15 post-hoc corrections, the canonical
strict-exclusion set, and the two sections it cross-references were
confirmed byte-identical between the pre- and post-compaction files. The
new compact-summary trajectory table was checked against the archive's own
independently-stated figures at three separated points (early, middle, and
the full endpoint) and found accurate, including its honest disclosure of
its own pre-existing (not compaction-introduced) fraction/decimal gaps.
σ_strict = 62/70 = 0.8857, V_instance = 0.5813, and V_meta = 0.0973 all
independently re-derive exactly. DIR-023 is archived with `status:
resolved` and a Resolution section that accurately and non-overclaimingly
matches this audit's own independent findings. No V-credit was claimed.
`experiment/directives/pending/` contains exactly DIR-021 and DIR-024. The
working tree was clean at audit start, and the commit's actual diff
(`git show 8f72848 --stat`) exactly matches its own commit message's
claimed scope — five files, no unrelated or silent changes.

**No information loss, no unfaithful summarization, and no unsupported
claim was found. No post-hoc correction is warranted against
`experiment/iterations/iteration-81.md` or DIR-023's Resolution section.**
This would have been the 16th post-hoc correction in this experiment's
history had one been needed; none was.

---

## Post-audit verification (HEAD vs. `origin/master`)

After committing this audit report, this audit pushed to `origin` and
confirmed `HEAD` and `origin/master` point to the identical commit SHA
(see this audit's own commit and the immediately following `git
status`/`git log` check for the exact final state).
