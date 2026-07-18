# M27-competitive-bench benchmark report (reconciled from two independent iterations)

DIR-001 item 5: comparative capability benchmark against a real competitor (Tier-A). Base commit
`ff42be66fe7a8e0229ed4a6dd8b1e6f6da5ca1b2` (`exp5-outer-driver` HEAD at charter authoring). This
report reconciles two independently-run iterations that both created a report at this same path
(an add/add merge conflict at ABSORB, resolved per DIR-018 item 3's per-file reconciliation
discipline — not a blanket `--ours`/`--theirs` pick):

- **iteration-0** (branch `exp5-m27-iteration-0`, commit `b794863`), worktree
  `.../M27-competitive-bench/worktrees/iteration-0`. Benchmarked `gh issue` (primary) +
  `backlog.md` (secondary). Full original report preserved as `benchmark-report.iteration-0.md`
  alongside this file.
- **iteration-1** (branch `exp5-m27-iteration-1`, commit `f7448e7`), worktree
  `.../M27-competitive-bench/worktrees/iteration-1`, run WITHOUT reading iteration-0's worktree,
  branch, or report — genuinely independent. Also benchmarked `gh issue` + `backlog.md`, and
  independently argued `backlog.md` is arguably the fairer structural analog to quay. Full
  original report preserved as `benchmark-report.iteration-1.md` alongside this file.

Both iterations independently arrived at the same 4 core findings via different investigation
paths, and each surfaced unique findings the other did not — this reconciliation preserves both
sets rather than collapsing to one iteration's view. Full raw transcripts, per-command timing, and
verbatim tool output for every claim below are preserved in the two per-iteration report files
and in `transcripts/` (iteration-0's committed transcript files).

## Scope re-stated

Per charter: formalize the ad hoc "vs GitHub Issues/Linear" comparison yardstick (DIR-001's
Finding #3, CB-016's own worked example) into a real, run, repeatable benchmark against a real
competitor. Measure only — no fixes for any finding, no new Provider-ABI surface. Both iterations
covered Phase A (investigate/define), Phase B (run), and Phase C (log/report).

## Competitor selection (Done-when clause 1)

Both iterations independently confirmed: `gh` CLI v2.78.0, authenticated, against the real
`yaleh/quay` repo (Issues enabled); `backlog.md` v1.45.0, a real, locally-installed, CLI-scriptable
task tracker; Linear explicitly not pursued (no CLI/API access in this environment, per the
charter's exclusion). Both iterations chose to actually run the benchmark against BOTH `gh issue`
and `backlog.md`, not just inspect one.

**Iteration-1's additional judgment call** (not present in iteration-0's report): on direct
inspection, `backlog.md`'s primitive shape (local, markdown-frontmatter-backed, arbitrary
free-form status/label vocabulary) is structurally closer to quay's own local-filesystem task
store than `gh issue` is (a hosted, two-state open/closed tracker whose richer categorization is
bolted on via labels). `gh issue` remains the primary comparator because DIR-001's own text names
it explicitly and it has actual historical ad hoc-yardstick usage (CB-016-class); `backlog.md` is
run as a genuinely-judged-comparable secondary, not merely "also installed."

## Methodology (Done-when clause 2)

Both iterations independently constructed a 5-scenario list covering the same conceptual ground:
create (title+body), status transition (2-3 states), label/categorize, list/filter/search,
close/complete — run against `quay`, `gh issue`, and `backlog.md` via each tool's own primary CLI.
Full scenario-to-command mapping tables are in each iteration's own preserved report (§Phase B of
iteration-0, §2 of iteration-1) — they differ in exact flags/wording but not in scenario coverage.

**Iteration-1's independent scenario-coverage check** (a genuine skepticism contribution) explicitly
probed, before running anything, for scenarios a thinner pass might under-represent: label
pre-existence cost on `gh`, search-index propagation lag, repeated-flag label semantics (probed
using quay's own historical QX-016 bug class as a search heuristic), and `gh issue create`'s lack
of `--json` support. All four were subsequently confirmed as real findings (see gap log below).

## Runs, transcripts, timing (Done-when clause 3)

**iteration-0**: scratch instances at `/tmp/m27-quay-scratch/`, dedicated scratch GitHub repo
`yaleh/quay-bench-scratch-m27-it0`, `/tmp/m27-backlog-scratch/`. 13 quay commands / 18 gh commands
/ 13 backlog commands, full transcripts committed at `transcripts/{quay,gh,backlog}-run.txt`.
Timing summary: quay 12.309s total / 0.947s avg per command; gh 22.430s / 1.246s avg; backlog.md
4.710s / 0.362s avg (backlog.md ~2.6x faster than quay per call on the same local-filesystem
class of operation — quay's per-call MCP subprocess handshake identified as the dominant cost,
not file I/O).

**iteration-1**: scratch instances at `/tmp/quay-bench-scratch/tasks`, dedicated scratch GitHub
repo `yaleh/quay-bench-scratch-m27` PLUS one throwaway issue (#15) created directly in the real
`yaleh/quay` repo specifically to confirm real-repo access (created, labeled, closed, then
PERMANENTLY DELETED — confirmed via `gh issue view 15` returning "Could not resolve to an issue"),
`/tmp/quay-bench-backlog-scratch`. Full raw transcripts pasted inline in the preserved
iteration-1 report (§3.0-3.8), including per-command `time` output.

Both iterations' raw evidence is preserved verbatim in the per-iteration report files.

## End-to-end completability (Done-when clause 4)

Both iterations independently found: **all three tools complete all 5 scenarios end-to-end via
their own primary CLI**, with caveats on `gh issue` (no native intermediate-status field — a
hand-rolled label convention required; search-index propagation lag) and on `backlog.md`
(iteration-1 additionally found a PARTIAL result on list/filter: no `--label` filter flag exists
on `task list` at all — only fuzzy `search`; and an ambiguous close/complete semantics between
`--status Done` and `task archive`). See each iteration's own completability table for full detail
(iteration-0 §Phase C, iteration-1 §4).

## Capability gap/advantage log (Done-when clause 5) — reconciled, both iterations' findings preserved

Both iterations independently found the same 4 core findings via different paths:

| convergent finding | iteration-0 id | iteration-1 id |
|---|---|---|
| quay has no dedicated `task create` verb (upsert-via-edit only) | GAP-001 | G-01 |
| `gh issue` has no native multi-state status field (label-simulated workaround required) | GAP-003 | G-05 (+ G-12 relative advantage framing) |
| `gh issue` search-index propagation lag (transient, confirmed by re-check) | GAP-005 | G-06 |
| `backlog.md`'s repeated `--add-label X --add-label Y` silently drops all but the last value (real, on-disk-confirmed data-loss bug) | GAP-006 | G-07 |

**Findings unique to iteration-0** (not independently reproduced by iteration-1, since
iteration-1's own S1 scenario always supplied `--title` explicitly and never exercised this path):

- **GAP-002 (most severe finding of the whole benchmark, quay behind, real correctness/data-integrity
  bug)**: `quay task edit <new-id>` **without** `--title` silently creates a task with **no `title`
  field at all** (not even an empty string) — `task view --json` omits the key entirely, non-JSON
  view prints the literal string `undefined` as the title. Reproduced live:
  `task edit GAP-DEMO --status todo` then `task view GAP-DEMO --json` → no `title` key;
  non-JSON view → `GAP-DEMO: undefined [todo]`. Neither `gh issue create` nor `backlog task create`
  allow this as easily (both effectively require a title). This finding is a **real methodological
  gap in iteration-1's own coverage** — worth stating explicitly as evidence FOR running two
  independent iterations rather than one: the two-pass pattern caught something neither iteration
  alone would have covered, since iteration-1's own scenario always supplied `--title`.
- **GAP-004**: scoping note — quay's richer status model (native `todo`/`ready`/`done`/
  `needs-human` enum with `task check` gate concept) is an advantage (same underlying fact as
  GAP-003/G-05/G-12), but this is recorded as a distinct scoping clarification, not folded into it.
- **GAP-007 (quay behind, performance)**: quay's per-call MCP subprocess handshake (fresh Node
  process per CLI invocation) is the dominant latency cost, ~2.6x slower per call than
  `backlog.md` for the same local-filesystem class of operation.
- **GAP-008 (parity)**: all three tools complete all 5 scenarios end-to-end — no scenario is
  categorically unreachable for any tool.

**Findings unique to iteration-1** (not present in iteration-0's list):

- **G-02 (quay behind)**: `--help` text is stale relative to the actual `task edit` flag surface —
  help shows only `--status`, but the code supports far more flags (`--title/--body/--body-file/
  --labels/--extra/--parent/--children/--expect-status/--append-notes`, from M16-cli-edit-parity).
- **G-03 (gh issue behind)**: `gh issue create` does not support `--json` (only `list`/`view` do) —
  returns a bare URL string, harder to script than quay's uniform `--json` on every verb.
- **G-04 (gh issue behind)**: labels must pre-exist in the repo before use (`gh label create`
  required for any new label/status value) — quay and backlog.md both accept arbitrary free-form
  label strings inline; this doubles gh's command count for any new label.
- **G-08 (backlog.md behind)**: `task list` has NO `--label` filter flag at all (confirmed absent
  from `--help`) — only fuzzy `search` exists, which conflates label/title/body/decision/document
  text in one ranked list, not an exact filter.
- **G-09 (backlog.md behind)**: two different, semantically-distinct close/complete primitives
  (`--status Done` vs `task archive`) with no single obvious canonical one.
- **G-10 (quay ahead)**: `task list --search` is a real, instant, exact-substring match with no
  indexing/propagation lag — advantage over both gh's lagged index and backlog.md's fuzzy-scored
  search.
- **G-11 (quay ahead vs backlog.md)**: `task list --label A --label B` supports true AND-filter
  multi-label filtering via repeated flags, confirmed correct — backlog.md has no label filter at
  all (G-08).
- **G-13 (gh issue ahead, relative to backlog.md only)**: `gh issue close` is a single,
  unambiguous, purpose-built completion verb, unlike backlog.md's G-09 ambiguity.
- **G-14 (quay ahead)**: quay's every CLI verb exercised (`list`/`view`/`edit`/`check`) supports
  uniform `--json` output — the most consistently machine-scriptable output surface of the three.

**Reconciled total: 8 findings from iteration-0 (GAP-001..008) + 14 from iteration-1 (G-01..14),
with 4 pairs independently converging on the same underlying fact (listed in the convergence table
above) and the remainder unique to one iteration or the other. No finding from either iteration is
dropped in this reconciliation** — both iterations' full gap logs are preserved verbatim in their
respective per-iteration report files (`benchmark-report.iteration-0.md`,
`benchmark-report.iteration-1.md`), and the unique findings from each are summarized above.
GAP-002 (the single most severe finding, a real data-integrity bug) is the clearest evidence that
running two independent iterations against the same charter surfaced something a single pass would
have missed.

## Disposition of each gap (Done-when clause 7)

Every gap in both iterations' logs has an explicit disposition in its own preserved report
(iteration-0 §"Disposition of each gap", iteration-1 §6). Reconciled summary of actionable
(future-candidate) dispositions, deduplicated:

- **quay-side future-candidate findings** (none implemented here — out of scope, measurement
  only): GAP-001/G-01 (no dedicated `task create` verb), **GAP-002 (highest priority — real
  data-integrity bug, silent title-less task creation)**, GAP-007 (MCP subprocess per-call
  latency), G-02 (stale `--help` text, low severity, trivial documentation-only fix).
  Recommend a future backlog row, tentatively `M-QUAY-CLI-CREATE-ERGONOMICS`, covering
  GAP-001/GAP-002/GAP-007/G-02 together, SELECTed separately with its own charter.
- **Competitor-side findings** (not actionable by quay, recorded for completeness, no quay-side
  action): GAP-005/G-06 (gh search propagation lag — external system's own eventual-consistency
  behavior), GAP-006/G-07 (backlog.md repeated-flag bug — upstream defect, not quay's), G-03/G-04
  (gh issue's own `--json`/label-pre-existence limitations), G-08/G-09 (backlog.md's own filter/
  close-ambiguity limitations).
- **Advantage/parity findings** (no action needed): GAP-003/GAP-004/G-05/G-12 (quay's native
  status model), GAP-008 (parity), G-10/G-11/G-14 (quay's search/filter/JSON advantages), G-13
  (gh's relative advantage over backlog.md specifically).

None silently fixed inline in this milestone (per the charter's "Explicitly OUT of scope"), none
silently dropped with no record.

## Cleanup / no-litter confirmation

Both iterations independently confirmed the real experiment task store (`tasks/` at repo root) was
never touched, and the real `yaleh/quay` Issues tracker carries zero permanent benchmark litter:

- **iteration-0**: used a dedicated scratch repo (`yaleh/quay-bench-scratch-m27-it0`) exclusively,
  never created issues in the real `yaleh/quay` repo. Confirmed via `gh issue list -R yaleh/quay`
  showing no benchmark-related titles. Attempted `gh repo delete` on the scratch repo failed (403,
  token lacks `delete_repo` scope) — logged honestly, scratch repo left as private/clearly-marked
  disposable, human/future action needed to actually delete it.
- **iteration-1**: created one throwaway issue directly in the real `yaleh/quay` repo (#15,
  specifically to confirm real-repo write access per Done-when clause 1) and fully deleted it
  immediately after (confirmed via `gh issue view 15` returning "Could not resolve to an issue" —
  zero litter). For the bulk of the gh benchmark, used its own dedicated scratch repo
  (`yaleh/quay-bench-scratch-m27`, no `-it0` suffix — the two iterations used distinctly-named
  scratch repos, confirmed by iteration-0's own report as evidence of the concurrent run, avoiding
  any collision). Same `delete_repo` scope limitation encountered; best-effort archived (read-only)
  instead of deleted.

Both scratch GitHub repos (`yaleh/quay-bench-scratch-m27-it0` and `yaleh/quay-bench-scratch-m27`)
remain as private, clearly-disposable-marked repos pending either a `delete_repo` scope grant or
manual web-UI deletion — a human/future action item, not silently omitted from either report.

## Full test suite (Done-when clause 8)

Both iterations ran the full suite twice (once encountering a transient flake, once clean), and
both independently diagnosed the SAME root cause: the two iteration worktrees' test suites ran
concurrently against the real `yaleh/quay` repo, and `provider-abi-conformance.test.mjs` /
`mcp-server.test.mjs`'s live-fixture/live-fetch tests raced against each other's concurrent GitHub
API traffic — a pre-existing property of those test files' shared live fixtures, not a regression
introduced by this milestone (zero product code changed by either iteration).

- **iteration-0**: first run 33/34 pass (1 flake in `provider-abi-conformance.test.mjs`); isolated
  re-run of that file passed 100% clean; second full clean re-run passed 34/34, 0 fail.
- **iteration-1**: first run hit a flake in `mcp-server.test.mjs`'s github-provider live-fetch test
  (confirmed via `ps aux` that iteration-0's concurrent test process was still running at the same
  time); a second run, started only after confirming iteration-0's process had exited, passed
  completely clean: exit 0, 1051 `PASS:` assertions, 0 `FAIL:`, all 33 test files `✔`.

Both iterations' final clean runs confirm no regression from any benchmark scaffolding (both
iterations' scratch state lives entirely under `/tmp/`, outside the repo tree).

## `git diff --stat` (Done-when clause 9)

Both iterations independently confirmed only their own milestone directory/report was added, no
product code (`packages/*`) touched, no files under `tasks/` (the real experiment task store)
touched. This reconciled merge adds the two per-iteration report files
(`benchmark-report.iteration-0.md`, `benchmark-report.iteration-1.md`) alongside this reconciled
top-level report, plus iteration-0's committed `transcripts/` directory — still zero product code
touched.

## Summary — all 9 Done-when clauses

| # | clause | status | evidence location |
|---|---|---|---|
| 1 | real competitor(s) confirmed/selected | **MET** (both iterations, independently) | "Competitor selection" section above |
| 2 | benchmark methodology defined | **MET** (both iterations, independently) | "Methodology" section above |
| 3 | benchmark actually run, raw transcripts+timing | **MET** (both iterations, independently) | "Runs, transcripts, timing" section + `transcripts/*.txt` + per-iteration reports |
| 4 | end-to-end completability recorded, binary pass/fail | **MET** (both iterations, independently) | "End-to-end completability" section above |
| 5 | capability gap/advantage log, both directions | **MET** — 8 + 14 findings reconciled, 4 convergent pairs, no omissions | "Capability gap/advantage log" section above |
| 6 | written benchmark report exists at the specified path | **MET** | this file |
| 7 | every gap has an explicit disposition | **MET** | "Disposition of each gap" section above |
| 8 | full test suite passes, no regressions | **MET** — both iterations, same root cause independently diagnosed | "Full test suite" section above |
| 9 | `git diff --stat` shows only expected files touched | **MET** | "`git diff --stat`" section above |

## Note for ABSORB (per charter's "Note for ABSORB" section)

1. `it0-dod-check.sh` was deliberately NOT run by either iteration (fires at ABSORB, per the
   charter's own text) — this is the THIRD-EVER real (non-fixture, non-self-referential) test of
   the DoD meta-enforcer gate from DIR-017 Step 1, per the charter's explicit note (first: M25
   self-check; second: M26; third: this milestone). To be evaluated explicitly at ABSORB.
2. **22 total gap/advantage findings logged across both iterations** (8 from iteration-0,
   14 from iteration-1), with 4 pairs independently convergent — 18 distinct underlying findings
   after accounting for convergence. Every one has an explicit disposition (see above); none
   silently fixed inline, none silently dropped.
3. **This milestone's findings DO feed a candidate for a future SELECT.** GAP-002 (silent
   title-less task creation, iteration-0-only finding) is a real correctness/data-integrity gap —
   the single highest-priority actionable finding of the whole benchmark. Combined with GAP-001/
   G-01 (no dedicated create verb), GAP-007 (MCP latency), and G-02 (stale help text), these form a
   coherent candidate for a future capability-growth-typed milestone, tentatively
   `M-QUAY-CLI-CREATE-ERGONOMICS`. Not implemented here (out of scope — measurement only).
   Additionally, the fact that GAP-002 was found by only one of the two independent iterations is
   itself worth noting for future two-iteration milestone dispatch: it is concrete evidence that
   the convergent-independent-verification pattern (both iterations run the same charter, findings
   compared/reconciled at merge) catches real issues a single pass would miss, not just redundant
   confirmation of the same findings.
