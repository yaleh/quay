# Charter M27-competitive-bench — DIR-001 item 5: comparative capability benchmark vs. a real
# competitor (Tier-A)

**Milestone id:** M27-competitive-bench · **surface:** cross-cutting (CLI, quay-native provider,
`gh` CLI as the real competitor comparator) · **type:** explore
**Source:** `tasks/exp5-M-COMPETITIVE-BENCH.md` (SELECTed m27, `milestone:M27-competitive-bench`) —
implements DIR-001 item 5. Full source: `directives/archive/DIR-001-evaluation-blind-spot-
provider-abi-and-outcome-based-methods.md` (status `applied (partial)`; items 3-6, including this
one, were explicitly BACKLOGGED at DIR-001's own m3 resolution, not applied then — this milestone
applies item 5 only; items 3, 6 remain separate backlog rows, `M-OUTCOME-EVAL`/
`M-HUMAN-REVIEW-CADENCE`; item 4 closed @M26-adversarial-eval).
**Charter authored:** m26→m27 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger) and task-store `Value type /
  cadence` field (`tasks/exp5-M-COMPETITIVE-BENCH.md`): **exploit (cross-experiment-comparison
  channel), method infra, no VT points**. This milestone does NOT add Provider-ABI surface, does
  NOT change quay's own capabilities in response to findings, and is NOT typed capability-growth —
  it formalizes an existing AD HOC comparison channel (DIR-001's Finding #3: "in exp4's gap-list
  'github' appears 9 times, almost all as a *comparison yardstick* ('vs GitHub Issues'), never as
  an evaluation of `quay-github` itself") into a real, run, repeatable benchmark. DIR-001's own
  Finding names this exact channel as "offline-validated as a genuine structural source" (item 5's
  text, quoted below) — i.e. the VALUE of this milestone is methodological (a durable, re-runnable
  comparison instrument for future SELECT passes and future capability-growth milestones to cite),
  not a direct product-capability delta.
- **Δv̂: 0 (zero VT points), explicit non-capability-growth justification.** Mirrors M26's
  Value-hypothesis framing of the same no-VT-points value type: this milestone audits/compares, it
  does not implement fixes for any gap the comparison finds (see "Explicitly OUT of scope" below).
  No `dashboard.md` §VT chart cell moves as a direct result of this milestone. If the benchmark
  surfaces a real capability gap worth closing, that becomes a NEW, separately-SELECTed
  capability-growth milestone candidate (logged with a paper trail, not folded in here) — this
  mirrors M26's "log real bugs with a paper trail, don't silently fix" discipline, applied here to
  "log real gaps, don't silently implement fixes for them."
- Metric `Y`: none (no VT chart move). Success is the Done-when list below: a real competitor
  identified and confirmed runnable in this environment (not assumed, not hypothetical), a
  benchmark methodology defined and actually executed (not a narrative feature table), and a
  written report with concrete, evidence-backed findings (timings, command counts, pass/fail per
  scenario) — honestly stating gaps AND advantages found on both sides, per DIR-001 item 5's own
  "formalize the ad hoc yardstick" framing (formalizing means making it real and repeatable, not
  making it favorable).

## Source (DIR-001 item 5, quoted verbatim)
From DIR-001's "Requested action" section, item 5:
> **Comparative capability benchmark** against a real competitor's feature matrix (formalize the
> ad-hoc "vs GitHub Issues/Linear" yardstick already used in CB-016) — this is the
> cross-experiment-comparison channel, offline-validated as a genuine structural source.

DIR-001's Finding (context, also quoted) named the ad hoc-yardstick pattern directly: "In exp4's
gap-list 'github' appears 9 times, almost all as a *comparison yardstick* ('vs GitHub Issues'),
never as an evaluation of `quay-github` itself."

## Current-state note (re-verified at charter-authoring time, not assumed from DIR-001's or CB-016's
## original 2026-07-18 text)
- **CB-016 itself is not literally a "GitHub Issues/Linear yardstick" gap** — re-checked directly
  (`grep -rn CB-016`): CB-016 is a closed gap-list entry from exp4 (`experiments/quay-continuous-
  bootstrap/gap-list.md`, closed via task QX-023, "Extend search to task body content") whose own
  gap TEXT used "significant gap vs GitHub Issues / Linear where full-text body search is standard"
  as its justifying comparison framing — i.e. CB-016 is the concrete WORKED EXAMPLE of the ad hoc
  yardstick pattern DIR-001 item 5 names (a feature judged against an informal, undocumented mental
  model of what GitHub Issues/Linear do), not itself a standing benchmark artifact to formalize.
  This milestone formalizes the PATTERN CB-016 exemplifies (informal, narrative "vs GitHub
  Issues/Linear" comparisons scattered across exp4 gap-list entries) into a real, run comparison —
  it does not re-open or re-score CB-016 itself (already `done`, per `provenance.md` line 735).
- **A real, authenticated, runnable competitor is confirmed present in this environment**: `gh`
  CLI (v2.78.0) is installed and authenticated (`gh auth status` → logged in to `github.com` as
  `yaleh`, token scopes include `repo`), and the `origin` remote of this very repo
  (`https://github.com/yaleh/quay.git`) is a real GitHub repository with Issues available — this is
  the SAME tool DIR-001's Finding says was already being used informally as a yardstick. `gh issue`
  is therefore the real competitor for this benchmark, matching the directive's own named example
  ("GitHub Issues") rather than the untested "Linear" alternative (no Linear CLI/access is present
  in this environment — Linear is explicitly not pursued, see "Explicitly OUT of scope").
- **`backlog.md` (npm package `backlog.md@1.45.0`) is also globally installed** in this environment
  (`npm ls -g` confirms it, binary `backlog` on PATH) and is a real, CLI-scriptable open-source
  task tracker (init/task/board/search subcommands). It is noted here as a second real candidate
  the in-scope investigation (item 1 below) must actually evaluate, not assumed away — but `gh
  issue` is the directive's own named comparator and the one with actual historical usage
  (CB-016-class comparisons, DIR-001's Finding #3's "9 times... vs GitHub Issues" tally) — the
  in-scope work confirms which one (or both) is used for the actual run benchmark, per item 1's own
  investigate-don't-assume instruction.
- **The `quay` CLI entry point is `packages/quay/bin/quay.js`** (`packages/quay/package.json`'s
  `bin.quay` field), not a bare `src/cli.js` path — confirmed by direct inspection, since an
  earlier guess at the entry point (`src/cli.js`) does not exist. Any command-count / round-trip
  timing methodology (item 2 below) must invoke the real bin entry point.

## In-scope work
1. **Competitor selection, investigated not assumed.** Confirm which real, currently-installed-or-
   installable tool is used as the comparator: `gh issue` (GitHub CLI against the real
   `yaleh/quay` GitHub repo, already authenticated) is the primary candidate per DIR-001's own
   named example and historical usage pattern (CB-016-class ad hoc comparisons). Actually check
   `backlog.md`'s CLI shape too (already installed) as a secondary comparator if time/scope allows —
   document the actual investigation (commands run, what each tool's primitive operations are), not
   an assumed choice. Do NOT pursue Linear (no CLI/API access in this environment — would require a
   synthetic/hypothetical comparison, explicitly disallowed, see "Explicitly OUT of scope").
2. **Benchmark methodology definition.** Define a small, fixed set of real task-board job-to-be-done
   scenarios usable against BOTH `quay` (via `packages/quay/bin/quay.js`, using the quay-native
   provider — a real local filesystem-backed store, not a mock) and the chosen competitor(s)
   end-to-end via each tool's own PRIMARY interface (CLI for `gh issue`/`backlog`, not a
   side-channel API call). Candidate scenario shapes (finalize concretely at run time, not
   narratively): (a) create a task/issue with title+body, (b) transition it through 2-3 status
   states, (c) add/query a label or equivalent categorization, (d) list/filter/search open items,
   (e) close/complete it. For each scenario, measure: command count (number of discrete CLI
   invocations needed), and round-trip wall-clock time (actually timed, e.g. `time` around each
   command sequence) — both metrics must be from REAL command runs, not estimated.
3. **Run the benchmark against both tools.** Execute the defined scenarios against `quay` (CLI,
   quay-native provider, in a scratch/throwaway task-store instance so this milestone's own
   benchmark runs don't pollute the real experiment task store) and against the chosen
   competitor(s) (real `gh issue` commands against a scratch GitHub repo or issue subset — NOT
   against `yaleh/quay`'s real issue tracker in a way that pollutes it; use a disposable test issue
   set, closed/cleaned up after, or a dedicated scratch repo if creating throwaway issues in
   `yaleh/quay` is undesirable). Capture raw command transcripts and timing output as the pasted
   evidence for the Done-when clauses below.
4. **Job-to-be-done end-to-end completability check.** For each scenario, explicitly record whether
   it CAN be completed end-to-end via each tool's own primary interface alone (binary pass/fail per
   tool per scenario) — this is the "whether a job-to-be-done can be completed end-to-end via each
   tool's own primary interface" comparison named in this milestone's scope, distinct from the
   command-count/timing friction metric (item 2-3), since a tool could be slow-but-complete or
   fast-but-incomplete for a given scenario.
5. **Capability gap/advantage log.** From the run results (items 3-4), log every concrete capability
   gap or advantage found — in EITHER direction (quay ahead, competitor ahead, or parity) — as
   individual gap-list-style entries (id, description, which tool, evidence citation). Honesty
   discipline explicit: a scenario where quay is worse must be logged as such, not omitted or
   softened; a scenario where quay is better must also be logged, not assumed away as
   uninteresting. No fix is implemented for any gap found (see "Explicitly OUT of scope").
6. **Written benchmark report** (`experiments/quay-perpetual-stream/milestones/
   M27-competitive-bench/benchmark-report.md` or equivalent), consolidating: competitor(s)
   investigated and the one(s) actually benchmarked (with rationale), the scenario list and
   methodology, raw run transcripts/timing evidence, the capability gap/advantage log (item 5), and
   an explicit disposition for each real gap found (logged as a future-candidate backlog note, per
   "Explicitly OUT of scope" below — not silently fixed, not silently dropped).

## Explicitly OUT of scope this milestone
- **No new Provider-ABI surface.** This milestone measures/compares; it does not add fields,
  capabilities, or providers.
- **No changes to quay's own capabilities in response to findings.** This milestone MEASURES, it
  does not implement fixes — any real gap found is logged as a disposition/future-candidate
  backlog note (item 6), not silently fixed inline, mirroring M26's "log real bugs with a paper
  trail, don't silently fix" discipline applied here to gaps rather than bugs. If a finding is
  severe enough to warrant immediate action, that is a SEPARATE future SELECT candidate, not a
  rider on this milestone.
- **No synthetic or hypothetical competitor.** The comparator must be a real, actually-runnable
  tool exercised via real commands in this environment (`gh issue` against the real, authenticated
  `yaleh/quay` GitHub repo, and/or `backlog.md` if item 1's investigation finds it in-scope-worthy)
  — not a narrative table of Linear's or any other tool's documented features. Linear specifically
  is explicitly NOT pursued (no CLI/API access present in this environment; pursuing it would
  require either a synthetic mock or an out-of-band signup/API-key acquisition, both out of scope).
- **No DIR-017 scope.** DIR-017 Steps 2-3 remain blocked pending human verification of Step 1
  (M25's DoD meta-enforcer) — this milestone does not touch `inherited-core.md`'s DoD section, does
  not touch DIR-017, and does not advance its Steps 2-3 in any way.
- **No work toward DIR-001 items 3 or 6** (`M-OUTCOME-EVAL`, `M-HUMAN-REVIEW-CADENCE`) — each is
  its own separate backlog row, not folded in here. (Item 4, `M-ADVERSARIAL-EVAL`, already closed
  @M26.)
- **No polluting the real `yaleh/quay` GitHub Issues tracker with throwaway benchmark artifacts**
  left uncleaned. Any real GitHub issues created for the `gh issue` comparator run must be closed
  and/or deleted as part of item 3's execution, or created in a dedicated scratch repo instead — no
  permanent scratch-issue litter left in the production repo's real Issues tab.
- **No retroactive re-scoring of CB-016 itself.** CB-016 is already `done` (closed via QX-023); this
  milestone formalizes the ad hoc-yardstick PATTERN it exemplifies, it does not reopen or re-judge
  CB-016's own historical resolution.

## Line budget: small-milestone norm (no ceiling-expansion regime) — plan below satisfies the
## line-budget gate's phase/stage-plan convention anyway, for dogfooding-evidence clarity
This milestone's in-scope list (6 top-level items above) is at/under the small-milestone norm's
item-count proxy threshold — no `Line budget: <N>` declaration over 2000 is warranted and the
ceiling-expansion regime is NOT invoked (unlike M18/M24/M25). A lightweight phase breakdown is
given below purely to sequence the work (investigate before define before run before report), not
because the scope requires phase/stage decomposition:

- **Phase A — Investigate & define** (items 1-2): confirm the real competitor(s), define the fixed
  scenario list and methodology.
- **Phase B — Run** (items 3-4): execute the benchmark against both `quay` and the competitor(s) in
  scratch/throwaway instances, capture raw transcripts/timing, record end-to-end completability.
- **Phase C — Log & report** (items 5-6): log every gap/advantage found (both directions, honestly),
  write the consolidated benchmark report.

**Plan-time line-budget gate result (run at charter-authoring time, real output, draft-then-check-
then-finalize):**
```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M27-competitive-bench.md
PASS: experiments/quay-perpetual-stream/charters/M27-competitive-bench.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```
No `Line budget: <N>` declaration over 2000 is present, and the "In-scope work" section's top-level
numbered-item count (6) is at/under the script's default threshold (8), so the script's coarse
proxy does not flag this charter as requiring a phase/stage plan; a lightweight sequencing plan
(Phase A/B/C above) is included anyway for dogfooding-evidence-gate clarity, not because the gate
required it.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` Real competitor(s) confirmed and selected (item 1) — pasted evidence of investigation
   (`gh auth status`, `gh --version`, `backlog --version`/`--help` output, confirmation of the real
   `yaleh/quay` GitHub repo access) and explicit rationale for which tool(s) are actually
   benchmarked.
2. `[ ]` Benchmark methodology defined (item 2) — fixed scenario list (creation, status transitions,
   labeling/categorization, list/filter/search, close/complete) with the exact commands to be run
   against `quay` (via `packages/quay/bin/quay.js`) and against each chosen competitor, pasted as
   the methodology section of the report.
3. `[ ]` Benchmark actually run against `quay` and the chosen competitor(s) (item 3) — pasted raw
   command transcripts and real timing output (not estimated) for every scenario, against a
   scratch/throwaway task-store/issue instance (no pollution of the real experiment task store or
   the real `yaleh/quay` Issues tracker left behind).
4. `[ ]` End-to-end job-to-be-done completability recorded per scenario per tool (item 4) — binary
   pass/fail table, pasted, distinct from the friction metrics in clause 3.
5. `[ ]` Capability gap/advantage log produced (item 5) — every concrete finding logged in EITHER
   direction (quay ahead, competitor ahead, parity), gap-list-style entries (id, description, which
   tool, evidence citation) — no finding silently omitted or softened.
6. `[ ]` Written benchmark report exists (item 6) at `experiments/quay-perpetual-stream/milestones/
   M27-competitive-bench/benchmark-report.md`, consolidating items 1-5's evidence into one document.
7. `[ ]` Every real capability gap found (item 5) has an explicit disposition recorded (logged as a
   future-candidate backlog note or explicitly deferred with rationale) — none silently fixed
   inline in this milestone, none silently dropped with no record.
8. `[ ]` Full existing test suite passes post-change (no regressions from any scratch-store/
   throwaway-repo tooling added for the benchmark) — pasted raw output.
9. `[ ]` `git diff --stat` against the pre-charter base commit shows only the expected files touched
   (any benchmark-scaffolding scripts, the benchmark report, task-store write-back for real gaps
   found) — no unrelated product code, no leftover scratch task-store files committed.

Milestone is DONE when all nine are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1:
whether iteration-0's competitor choice (item 1) is actually the best-justified real option in this
environment (not merely the first one checked), whether the scenario list (item 2) is genuinely
representative of real task-board jobs-to-be-done (not cherry-picked to favor quay or the
competitor), whether the run transcripts (item 3) are real command executions with real timing (not
fabricated or estimated), and whether the gap/advantage log (item 5) is honestly bidirectional (not
one-sided) — iteration-1 must independently investigate/verify iteration-0's competitor choice and
benchmark methodology rather than rubber-stamping it, per the explicit skepticism instruction in
"Dispatcher notes" below.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch. Run at charter-authoring time, directly against this file:
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M27-competitive-bench.md
PASS: experiments/quay-perpetual-stream/charters/M27-competitive-bench.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
(Confirms the hash is unchanged since M06's original citation of the same pinned block, reused
unchanged through M26 per that milestone's own `dashboard.md` SELECT-m27 entry — no drift; re-run
once more immediately before dispatch as standard practice.)

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (DIR-001/task-store-sourced, not a
   `gap-list.md` gap id — same confirmed limitation as M13/M21-M26). DIR-001 item 5's text and
   `tasks/exp5-M-COMPETITIVE-BENCH.md` are the direct sources, both confirmed present at
   charter-authoring time.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence (tool
   version/auth output, methodology text, raw command transcripts + timing, pass/fail tables, the
   gap log, the benchmark report file itself, `git diff --stat`) — no clause is narrative-only.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s concrete decision procedure: Step 1,
   this milestone's own Done-when list already requires real command transcripts/timing output
   (clause 3) and a pass/fail completability table (clause 4) as its verification mechanisms. Step
   2, is either self-referential? The `quay` side of each run IS produced and verified by the same
   iteration/process (same sandbox) — self-referential in isolation. BUT the COMPETITOR side (`gh
   issue` against the real, independently-operated GitHub API/service, authenticated via a
   pre-existing token not created by this milestone) is a genuinely independent, differently-
   provisioned system — the comparison itself (quay's real output vs. a real external service's
   real output, both timed and transcript-captured) is the audit channel, structurally similar to
   M01-dist's Node-free-container pattern (an environment/actor this milestone's own code did not
   construct). Step 3, an independent mechanism EXISTS (the real GitHub API/service via `gh`) — no
   ceiling, proceed to dispatch with that as the declared channel. Step 4, the same mechanism (real
   `gh` commands against the real GitHub API) serves both the it0 declaration here and the actual
   iteration-time benchmark run (item 3) — no divergence.
e. **Plan-time line-budget gate** — this charter declares the small-milestone-norm regime
   explicitly (see "Line budget" section above); result: **PASS** (6 top-level in-scope items, at/
   under the script's default 8-item threshold; no `Line budget: <N>` over 2000 declared) — full
   command + PASS reasoning documented in that section above.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly, not here)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a
capability-growth-typed milestone with a NONZERO realized VT Δv — this milestone is typed
exploit/method-infra with Δv̂=0 by design (no VT chart cell, no capability-growth primary type), so
condition (a) does not apply regardless of outcome UNLESS the realized Δv turns out nonzero at
ABSORB (re-check then, not assumed here — it should not, since this milestone adds no ABI surface
and implements no fixes for any finding). Condition (b) requires iteration-0 to recommend skipping
iteration-1 — not authorized; both iterations run regardless. Do not pre-judge which condition (if
either) fires — state plainly at ABSORB, per the documented-no-op discipline.

## V_meta consolidation-lag gate — evaluate at ABSORB (state explicitly, not here)
Check every `v-meta-ledger.md` row with status `confirmed`-but-not-`consolidated` against the K=2
alarm threshold at ABSORB time. Do not pre-judge the outcome here — this is now itself one of the
DoD clauses `it0-dod-check.{sh,mjs}` mechanically checks was dispositioned (see "Note for ABSORB"
below); state the check's real outcome in the ABSORB log entry.

## Design-only-milestone impl-row gate — evaluate at ABSORB (state explicitly, not here)
This milestone is not obviously design-only (it ships an actually-run benchmark, raw transcripts,
and a written report, not a design doc with a future-implementer checklist) — but do not pre-judge
this at charter-authoring time. Run `it0-impl-row-check.sh exp5-M-COMPETITIVE-BENCH backlog.md` at
ABSORB and paste the real output as part of the closing evidence, per the standing gate's own
invocation convention.

## DoD meta-enforcer gate — evaluate at ABSORB (state explicitly, not here)
Per DIR-017/M25, `scripts/it0-dod-check.sh` must run against this milestone's charter + backlog row
+ ABSORB-entry text before `milestone_counter++` may execute (HARD BLOCK, same shape as the other
three gates above). Do not pre-judge PASS/FAIL here.

## Note for ABSORB
1. **This is the DoD meta-enforcer's third-ever real (non-fixture, non-self-referential) test.** Per
   cp-25.md's flagged item and M25/M26's own ABSORB entries (first real test M25 self-check;
   second real test M26), this milestone's ABSORB is the third time the checker is run against a
   charter/backlog-row/ABSORB-text it did not itself produce. State EXPLICITLY in the m27 ABSORB
   entry whether `it0-dod-check.sh` continued to generalize cleanly, or whether it needed
   adjustment (and if so, exactly what broke and why) — continuing the load-bearing evidence trail
   from M26 on whether DIR-017 Step 1's mechanism is genuinely operative outside its own build
   context.
2. **Any real capability gap found during the benchmark must be logged with a paper trail** (per
   Done-when clause 7) — a gap discovered and silently left unfixed with no report entry and no
   future-candidate disposition is itself a DoD violation in spirit (an undocumented, dropped
   finding), even if no existing gate's mechanical check catches it directly. State in the ABSORB
   entry how many real gaps/advantages (in each direction) were logged, and confirm each has an
   explicit disposition, per Done-when clause 7's own text.
3. **State explicitly whether this milestone's findings feed a NEW future SELECT candidate.** If
   the benchmark finds a real, significant capability gap, the ABSORB entry should note whether a
   new backlog row is warranted (separate from this milestone's own row) — this milestone's scope
   is measurement only, per "Explicitly OUT of scope," so any resulting fix work is necessarily a
   FUTURE milestone, not folded in retroactively here.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — per the M23-outer-driver-isolation discipline standing
(DIR-018). Base commit for both M27 iteration worktrees/branches: current HEAD of
`exp5-outer-driver`, confirmed at charter-authoring time via `git rev-parse exp5-outer-driver` →
**`e86b98fda411150df980c900dc9814a6f769a968`**. Worktree/branch paths (mirrors M26's exact
directory convention): `experiments/quay-perpetual-stream/milestones/M27-competitive-bench/
worktrees/iteration-{0,1}`, branches `exp5-m27-iteration-{0,1}`. Merge iteration-0/iteration-1
results into `exp5-outer-driver` first (per-file conflict resolution, reconciliation notes per
DIR-018 item 3's no-silent-drop discipline); only THEN merge `exp5-outer-driver` → `master` as the
single ABSORB publish commit (`git checkout master && git merge --no-ff exp5-outer-driver`),
sequenced after the adversarial-audit gate, V_meta consolidation-lag gate, design-only-milestone
impl-row gate, AND the DoD meta-enforcer gate all clear. iteration-0 executes the full Phase A/B/C
sequence in one pass (investigate/define → run → log/report — a single coherent
build+verify pass, not three separate BAIME iterations).

**iteration-1 skepticism instruction (explicit, not optional):** given this milestone's own
Done-when clause 5/7 honesty discipline and item 5's explicit "no finding silently omitted or
softened" instruction, iteration-1 must NOT simply read iteration-0's benchmark report and
rubber-stamp its competitor choice, methodology, or findings. iteration-1 independently
investigates/verifies iteration-0's competitor choice (item 1) — confirming `gh issue` (and/or
`backlog.md`) is genuinely the best-available real comparator in this environment, not merely the
first one iteration-0 happened to check — and independently re-runs (or critically re-examines) the
benchmark methodology and scenario list (item 2), genuinely trying to find a scenario iteration-0's
methodology under-represents, a timing/command-count measurement that doesn't hold up under
independent re-execution, or a gap/advantage iteration-0 either missed or over/under-stated in
severity. This mirrors M26's own iteration-1-skepticism instruction (independently re-deriving an
audit rather than trusting iteration-0's report text), applied here to a comparative-benchmark
context: the risk is not a rigged fixture, it is a benchmark that is methodologically thin, favors
one side by construction, or under-reports a real finding in either direction.
