# Charter M28-outcome-eval — DIR-001 item 3: outcome-based (job-to-be-done) evaluation, fixed
# real end-to-end task-board scenarios, binary pass/fail, dogfooding-gated (Tier-A)

**Milestone id:** M28-outcome-eval · **surface:** cross-cutting (CLI, MCP tools, quay-native
provider, quay-github provider, Web UI task board) · **type:** explore
**Source:** `tasks/exp5-M-OUTCOME-EVAL.md` (SELECTed m28, `milestone:M28-outcome-eval`) —
implements DIR-001 item 3. Full source: `directives/archive/DIR-001-evaluation-blind-spot-
provider-abi-and-outcome-based-methods.md` (status `applied (partial)`; items 3-6 were explicitly
BACKLOGGED at DIR-001's own m3 resolution, not applied then — this milestone applies item 3 only;
item 4 closed @M26-adversarial-eval, item 5 closed @M27-competitive-bench, item 6
(`M-HUMAN-REVIEW-CADENCE`) remains a separate backlog row, not touched here).
**Charter authored:** m27→m28 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger) and task-store `Value type /
  cadence` field (`tasks/exp5-M-OUTCOME-EVAL.md`): **explore, method infra, no VT points**,
  mirroring M26's and M27's Δv̂=0 framing of the same no-VT-points category — this milestone
  formalizes a NEW recurring evaluation method (fixed, real, end-to-end job-to-be-done scenarios,
  binary pass/fail, dogfooding-gated) into the outer loop's discovery engine, per DIR-001's own
  "institutionalize... as recurring evaluation methods layered into the outer loop's discovery
  engine (§4.4) and it0 checks" framing for items 3-6. It does not add Provider-ABI surface and
  does not change quay's own capabilities in response to findings — see "Explicitly OUT of scope."
- **Judgment flag, stated explicitly per this charter's own authoring instruction, not silently
  overridden:** the task store's stated value type (explore, method infra, no VT points) is used
  as authored, but it is worth flagging that this milestone's ACTUAL scope is closer to an audit
  than a pure infra build — all 5 scenarios drive REAL end-to-end task-board state through BOTH
  providers and the Web UI (dogfooding real capabilities: `quay:author`/`quay:execute` Skills, the
  github provider's real write path, `task_check`'s childrenStatus() gate, the served Web UI's
  `action_buttons`, and `--parent` reparenting). Unlike M27 (which measures a comparator this
  milestone's own code did not build), M28's scenarios directly exercise quay's own product
  surfaces end-to-end — closer in kind to M26's adversarial audit than to a neutral infra build.
  This judgment is noted here, per the charter-authoring instruction, but the task store's stated
  type (explore/method-infra/no-VT) is NOT silently overridden — it is used as-is below, with this
  flag preserved for ABSORB's own re-check.
- **Δv̂: 0 (zero VT points), explicit non-capability-growth justification.** Mirrors M26/M27: this
  milestone measures/verifies whether 5 real jobs-to-be-done can be completed end-to-end via each
  surface's own primary interface; it does not implement fixes for any gap found (see "Explicitly
  OUT of scope"). No `dashboard.md` §VT chart cell moves as a direct result of this milestone. If a
  scenario fails or a real gap is found, that becomes a NEW, separately-SELECTed capability-growth
  milestone candidate (logged with a paper trail), mirroring M26/M27's "log, don't fix" discipline.
- Metric `Y`: none (no VT chart move). Success is the Done-when list below: each of the 5 scenarios
  driven to completion (or explicit documented failure) via its real primary interface — CLI
  Skills, `gh`-backed provider writes, the childrenStatus() gate, the served Web UI, and
  cross-provider parent/children writes — with pasted evidence (transcripts, screenshots/DOM
  snapshots, before/after state) for every clause, honestly recording pass AND fail outcomes.

## Source (DIR-001 item 3, quoted verbatim)
From DIR-001's "Requested action" section (the "Then institutionalize... recurring evaluation
methods" preamble, followed by items 3-6), item 3:
> **Outcome-based (job-to-be-done) evaluation**: a fixed set of real end-to-end task-board scenarios
> scored binary pass/fail, dogfooding-gated (extends M-GATES's dogfooding evidence-gate from "was
> polish done" to "does the capability actually run end-to-end").

## Current-state notes (re-verified at charter-authoring time, not assumed from the task store's
## drafted-@M27 text)
- **The 5-scenario draft in `tasks/exp5-M-OUTCOME-EVAL.md` is used as the STARTING Done-when set**,
  per that file's own stated instruction: "A future charter selecting this candidate should treat
  these 5 as the starting Done-when set, adding/pruning only with a stated reason." No scenario is
  pruned or added in this charter; each is carried forward with a verified-real command surface
  (see below), and one text-level substitution is made where the draft's original command text does
  not exist verbatim in the repo (see next bullet).
- **`quay:author` and `quay:execute` Skills are CONFIRMED REAL**, exactly as named in the draft.
  Verified directly: `packages/quay-native/skills/author/SKILL.md` (frontmatter `name:
  quay:author`) and `packages/quay-native/skills/execute/SKILL.md` (frontmatter `name:
  quay:execute`) both exist with the exact invocation semantics the draft describes (`todo → ready`
  and `ready → done` respectively, `λ(taskId, provider = "native")`). No substitution needed for
  scenarios 1-3's Skill references.
- **DISCREPANCY FOUND AND SUBSTITUTED — scenario 5's `quay task write --parent` is not a real CLI
  invocation.** Direct inspection of `packages/quay/bin/quay.js` (`grep -n 'sub === "'`) shows the
  only `task` subcommands are `list`, `view`, `edit`, `check` — there is no `task write` subcommand.
  The real CLI verb for a field-level patch (including `--parent`) is **`quay task edit <id>
  --parent <newParentId>`** (`packages/quay/bin/quay.js` lines ~401-450, `cmd === "task" && sub ===
  "edit"`, which accepts `--title/--status/--body/--body-file/--labels/--extra/--parent/--children/
  --expect-status/--append-notes`). Separately, `task_write` IS a real name — but at the MCP tool
  layer, not the CLI (`packages/quay/src/mcp-server.js` line 310, `"task_write"`, a generic
  passthrough proxying the Provider's own `taskWrite`). This charter's scenario 5 (below) is
  rewritten to use the real CLI verb `quay task edit --parent` as the primary dogfooding surface
  (matching "own primary interface" per item 3's text), noting the MCP `task_write` tool as an
  available alternate surface, not a fabricated CLI command.
- **`gh-5`/`gh-6`/`gh-7` fixtures (cited in scenario 3's draft text) are CONFIRMED REAL and CLOSED**,
  not synthetic. Verified via `gh issue view {5,6,7} --repo yaleh/quay --json number,title,state`:
  issue #5 = `[QN-035-fixture] Child A: sample task under DIR-006 compound/epic verification`
  (CLOSED), #6 = `[QN-035-fixture] Child B...` (CLOSED), #7 = `[QN-035-fixture] Parent epic: DIR-006
  compound/epic gate live verification` (CLOSED). These are real, already-used fixtures from
  M09/M12's own live verification work (`gh-7` role=compound, children=["gh-5","gh-6"], both done) —
  usable as a READ-ONLY reference/regression check, but scenario 3's own Done-when clause requires a
  FRESH drive-to-done on new task instances (not a re-use of already-closed gh-5/6/7, since those
  are already `done` and re-driving them would not exercise a fresh todo→ready→done path). Also
  present in the real repo: open scratch issues #3, #4, #11-14 (leftover `[M09-GH-WRITE-SCRATCH]`/
  `[M12-ABI-PARENT-WRITE-SCRATCH]` issues from prior milestones — NOT to be reused or further
  polluted by this milestone; this milestone creates its OWN scratch issues per scenario and closes/
  cleans them up per the "Explicitly OUT of scope" no-litter discipline below).
- **`action_buttons` (scenario 4's cited Web UI surface) is CONFIRMED REAL.** Verified:
  `packages/quay/src/serve.js` lines 567 and 865 both reference `manifest.action_buttons`, filtering
  applicable buttons by task status and rendering them as the served task board's action controls.
  `quay serve [--port <port>]` is a real CLI subcommand (confirmed in `--help` output).
- **Browser automation tooling is available in this dispatch environment** (`chrome-devtools` and
  `playwright` MCP tool families) — scenario 4's dispatched iteration agent(s) MUST actually drive a
  browser against the served UI (navigate, click the real `action_buttons`, read the resulting DOM
  state), not merely inspect `serve.js`'s HTML-generation source code. Static inspection of the
  server-side rendering logic does NOT satisfy the dogfooding-evidence-gate for this scenario.
- **`task_check`'s childrenStatus() gate (scenario 3) is CONFIRMED REAL on BOTH providers**, not
  native-only. `packages/quay-github/src/github-client.js` lines 309-408 implement
  `childrenStatus()` for the github provider (explicitly ported from `store.js`'s native
  implementation per DIR-006), confirmed already live-verified in M12's iteration transcripts
  (`task_check gh-7 -> ok=true, childrenStatus present=true`). Both providers are therefore real,
  available comparators for scenario 3, not one live + one hypothetical.
- **The `quay` CLI entry point is `packages/quay/bin/quay.js`** (same confirmed fact as M27's
  charter) — all CLI-surface scenarios below invoke this real bin entry point, not a guessed path.

## In-scope work
1. **Scenario 1 — primitive task author→execute round-trip via CLI, native provider.** Create a
   fresh primitive task at `todo` (via `quay task edit <id> --status todo` on a newly-created task
   file, or the native provider's own create path if one exists — confirm and use the real create
   mechanism, do not assume `quay task create` exists without checking). Drive `todo → ready` via
   the `quay:author` Skill (writes/reviews Proposal/Plan/AC/DoD, asserts the gate via `quay task
   check`), then drive `ready → done` via the `quay:execute` Skill, using ONLY the CLI + these two
   Skills — zero manual store.js edits. Pass = task reaches `done` with Skill-driven transitions as
   the only human-visible actions; fail = any manual intervention required (document exactly what
   intervention, if any).
2. **Scenario 2 — same job, GitHub provider, real issue.** Identical scenario 1 shape, `--provider
   github`, against a REAL, freshly-created issue in the real `yaleh/quay` repo (not gh-5/6/7,
   already closed/done — a fresh scratch issue, clearly labeled e.g. `[M28-outcome-eval-scratch]`
   in its title, so it is distinguishable from product issues at a glance). Pass = same end-state
   (`done`) via the same Skills against the github provider; fail = documented blocker. Same
   no-permanent-litter discipline as M26/M27: the scratch issue is closed and/or clearly marked as
   scratch (not left open/unlabeled) once the scenario concludes.
3. **Scenario 3 — compound/epic task drive-to-done, parent + 2+ children, both providers.** Create a
   FRESH parent task with 2+ children (NOT a re-use of the already-`done` gh-5/6/7 fixtures — those
   remain a read-only reference point only) on the native provider, drive each child `done` via
   `quay:execute`, confirm `task_check`'s `childrenStatus()` gate reports the parent completable,
   and drive the parent itself to `done`. Repeat the same shape against the github provider (fresh
   scratch issues, same no-litter discipline as scenario 2). Pass = both providers show a working
   parent+children `done` end-state gated correctly by `childrenStatus()`; fail = documented
   divergence or blocker, per provider.
4. **Scenario 4 — Web UI task-board round-trip via `action_buttons`.** Start `quay serve`, use
   real browser automation (`chrome-devtools` or `playwright` MCP tools — actually navigate/click,
   not static HTML inspection) to advance a real task's status by clicking the served UI's
   `action_buttons`, then confirm the resulting state via `task_get` (CLI `quay task view` or the
   MCP `task_get` tool) matches what the UI displayed. Pass = the UI-driven transition is confirmed
   by an independent read (`task_get`/`task view`) to have actually persisted; fail = UI displays a
   transition that `task_get` does not corroborate, or the UI itself cannot complete a real
   transition via its primary controls.
5. **Scenario 5 — cross-provider parent/children write.** M12-abi-parent-write's own capability,
   exercised as a real job-to-be-done (reparenting during backlog reorganization), via the REAL CLI
   verb `quay task edit <childId> --parent <newParentId>` (draft's original `quay task write
   --parent` text corrected per the discrepancy noted above — `task write` is not a real CLI
   subcommand; `task edit` is). Run against BOTH providers: native (confirm `store.js`'s persisted
   `parent` field changes) and github (confirm the cross-issue body-checkbox mutation this provider
   uses to represent parent/children relationships actually changes, live-verified via `gh issue
   view <newIssue> --json body` before/after). Pass = both providers reflect the reassignment
   end-to-end when read back independently (`task_get`/`task view`, not just the write call's own
   return value); fail = documented divergence.

Each scenario is binary pass/fail, dogfooding-gated: it MUST be driven via the real CLI/Skill/UI/
MCP-tool surface exercised end-to-end (not by calling internal provider functions directly, not by
inspecting source code as a substitute for running it). If any command or Skill name referenced in
the original task-store draft turns out not to exist under its exact cited name during execution,
the dispatched iteration must substitute the real equivalent and explicitly note the substitution
in its evidence — the same discipline already applied above for scenario 5's `task write` →
`task edit` correction.

## Explicitly OUT of scope this milestone
- **No new Provider-ABI surface.** This milestone drives and verifies existing capabilities
  end-to-end; it does not add fields, capabilities, or providers.
- **No fixing any gap/bug found inline.** If a scenario fails, or a real bug/gap is discovered while
  driving it, it is logged with a disposition (future-candidate backlog note or explicit deferral
  rationale) — NOT silently fixed inline in this milestone, mirroring M26's/M27's "log, don't fix"
  discipline exactly. Any fix work is a SEPARATE future SELECT candidate.
- **No synthetic or mocked task-board state.** Every scenario's task-board state (task-store files,
  GitHub issues, served UI content) must be real and dogfooding-gated — created via the real CLI/
  Skill/UI/MCP surfaces in this environment, not a fixture pre-seeded by hand-editing store files or
  a mocked provider response.
- **No real-repo litter left behind.** Any scratch task-store files or scratch `yaleh/quay` GitHub
  issues created for scenarios 1-3/5 must be closed and/or clearly marked as scratch (title-tagged,
  e.g. `[M28-outcome-eval-scratch]`) and cleaned up as part of each scenario's own execution — same
  no-permanent-litter discipline as M26/M27. The already-open scratch issues from prior milestones
  (#3, #4, #11-14) are NOT to be reused or further polluted; this milestone creates and cleans up
  its own.
- **No re-scoping the 5 scenarios without a stated reason.** The 5-scenario draft from
  `tasks/exp5-M-OUTCOME-EVAL.md` is used as-is (with the one command-text substitution noted above,
  which is a correction of a factual error, not a scope change). Adding or pruning a scenario
  requires an explicit stated reason in the charter or, if discovered mid-dispatch, in the
  iteration's own evidence trail.
- **No DIR-017 scope.** DIR-017 Steps 2-3 remain blocked pending human verification of Step 1
  (M25's DoD meta-enforcer) — this milestone does not touch `inherited-core.md`'s DoD section, does
  not touch DIR-017, and does not advance its Steps 2-3 in any way.
- **No work toward DIR-001 items 4, 5, or 6** — item 4 (`M-ADVERSARIAL-EVAL`) already closed @M26,
  item 5 (`M-COMPETITIVE-BENCH`) already closed @M27, item 6 (`M-HUMAN-REVIEW-CADENCE`) remains a
  separate backlog row, not folded in here.

## Line budget: small-milestone norm (no ceiling-expansion regime) — plan below satisfies the
## line-budget gate's phase/stage-plan convention anyway, for dogfooding-evidence clarity
This milestone's in-scope list (5 top-level scenario items above) is at/under the small-milestone
norm's item-count proxy threshold — no `Line budget: <N>` declaration over 2000 is warranted and
the ceiling-expansion regime is NOT invoked (unlike M18/M24/M25). A lightweight phase breakdown is
given below purely to sequence the work, not because the scope requires phase/stage decomposition:

- **Phase A — Native-provider scenarios** (items 1, 3-native-half): scenario 1 end-to-end, and the
  native-provider half of scenario 3's compound/epic drive.
- **Phase B — GitHub-provider scenarios** (items 2, 3-github-half, 5): scenario 2 end-to-end, the
  github-provider half of scenario 3, and the cross-provider reparent (scenario 5) on both
  providers.
- **Phase C — Web UI scenario & consolidated report** (item 4 plus write-up): the browser-driven
  Web UI round-trip, and a consolidated results/evidence write-up covering all 5 scenarios.

**Plan-time line-budget gate result (run at charter-authoring time, real output):**
```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M28-outcome-eval.md
PASS: experiments/quay-perpetual-stream/charters/M28-outcome-eval.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```
No `Line budget: <N>` declaration over 2000 is present, and the "In-scope work" section's top-level
numbered-item count (5) is at/under the script's default threshold (8), so the script's coarse
proxy does not flag this charter as requiring a phase/stage plan; a lightweight sequencing plan
(Phase A/B/C above) is included anyway for dogfooding-evidence-gate clarity, not because the gate
required it.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` Scenario 1 (primitive task author→execute round-trip, CLI, native provider, item 1) run
   end-to-end via `quay:author`/`quay:execute` Skills only — pasted transcript of the Skill
   invocations and the final `quay task view <id>` output showing `status: done`, explicit note of
   any manual intervention required (pass = none).
2. `[ ]` Scenario 2 (same job, github provider, item 2) run end-to-end against a real, freshly
   created `yaleh/quay` issue — pasted transcript, `gh issue view <n>` before/after, final task
   state confirmed `done`, scratch issue closed/marked per the no-litter discipline.
3. `[ ]` Scenario 3 (compound/epic drive-to-done, parent + 2+ children, both providers, item 3) run
   end-to-end on FRESH task instances (not gh-5/6/7 reuse) — pasted `task_check` output showing
   `childrenStatus()` gating the parent correctly on both providers, final parent+children `done`
   states confirmed.
4. `[ ]` Scenario 4 (Web UI task-board round-trip via `action_buttons`, item 4) run via real browser
   automation (chrome-devtools or playwright MCP tools) against a live `quay serve` instance —
   pasted browser-tool transcript/snapshot evidence of the click-driven transition, plus an
   independent `task_get`/`task view` read confirming the persisted state matches.
5. `[ ]` Scenario 5 (cross-provider parent/children write via `quay task edit --parent`, item 5) run
   against both providers — pasted before/after `task_get`/`task view` output for native, and
   before/after `gh issue view --json body` output for github, confirming the reassignment
   persisted on both.
6. `[ ]` Every scenario's outcome (pass or fail) recorded explicitly, including any scenario that
   FAILS or requires manual intervention — no scenario silently omitted, softened, or marked pass
   without pasted evidence, per item 3's own dogfooding-evidence-gate extension.
7. `[ ]` Any real gap/bug discovered while driving the 5 scenarios is logged with an explicit
   disposition (future-candidate backlog note or explicit deferral rationale) — none silently fixed
   inline, none silently dropped with no record, mirroring M26/M27's "log, don't fix" discipline.
8. `[ ]` Written outcome-eval report exists (e.g. `experiments/quay-perpetual-stream/milestones/
   M28-outcome-eval/outcome-eval-report.md`), consolidating all 5 scenarios' methodology, evidence,
   pass/fail outcomes, and the gap/bug disposition log (item 7) into one document.
9. `[ ]` No real-repo litter left behind — every scratch task-store file and every scratch
   `yaleh/quay` GitHub issue created for this milestone's scenarios is closed and/or clearly marked
   scratch by the time this milestone is DONE (pasted final-state check, e.g. `gh issue list
   --search "M28-outcome-eval-scratch"` showing all such issues closed).
10. `[ ]` Full existing test suite passes post-change (no regressions from any scratch-scenario
    tooling added) — pasted raw output.
11. `[ ]` `git diff --stat` against the pre-charter base commit shows only the expected files
    touched (any scenario-driving scripts, the outcome-eval report, task-store write-back for any
    real gaps found) — no unrelated product code, no leftover scratch task-store files committed.

Milestone is DONE when all eleven are met and stable ≥1 iteration (§3.2 condition 1). Terminate
early per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for
iteration-1: whether iteration-0's scenario runs are genuinely fresh, real, dogfooding-gated
executions (not partially reused from already-`done` fixtures like gh-5/6/7, not narrated without
transcripts), whether the Web UI scenario (4) was actually browser-driven (not just server-source
inspected), whether the cross-provider write (scenario 5) genuinely persisted on BOTH providers
when independently re-read (not just accepted from the write call's own return value), and whether
any real gap/bug found was honestly logged with a disposition rather than glossed over — iteration-1
must independently re-derive/re-verify iteration-0's scenario runs rather than rubber-stamping the
report, per the explicit skepticism instruction in "Dispatcher notes" below.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch. Run at charter-authoring time, directly against this file:
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M28-outcome-eval.md
PASS: experiments/quay-perpetual-stream/charters/M28-outcome-eval.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
(Confirms the hash is unchanged since M06's original citation of the same pinned block, reused
unchanged through M27 per that milestone's own `dashboard.md` SELECT-m28 entry — no drift; re-run
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
   `gap-list.md` gap id — same confirmed limitation as M13/M21-M27). DIR-001 item 3's text and
   `tasks/exp5-M-OUTCOME-EVAL.md`'s 5-scenario draft are the direct sources, both confirmed present
   at charter-authoring time.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence (Skill
   transcripts, `gh issue view` before/after, `task_check`/`task_get`/`task view` output, browser
   automation transcripts/snapshots, the outcome-eval report itself, `git diff --stat`) — no clause
   is narrative-only. This IS item 3's own named extension of the dogfooding evidence-gate ("was
   polish done" → "does the capability actually run end-to-end").
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s concrete decision procedure: Step 1,
   this milestone's own Done-when list already requires real transcripts/before-after state
   (clauses 1-5) and an honest pass/fail-with-evidence record (clause 6) as its verification
   mechanism. Step 2, is either self-referential? Scenarios 1/3(native-half)/5(native-half) run
   entirely within this sandbox's own filesystem-backed native provider — self-referential in
   isolation. BUT scenarios 2/3(github-half)/5(github-half) drive real writes against the
   independently-operated GitHub API/service (authenticated via a pre-existing token this milestone
   did not create), and scenario 4 drives a real browser (an external, independently-implemented
   rendering/interaction engine, not this milestone's own code) against the served UI — both are
   genuinely independent, differently-provisioned audit channels, structurally similar to M27's own
   "real GitHub API/service" channel and M01-dist's Node-free-container pattern. Step 3, independent
   mechanisms EXIST (the real GitHub API/service via `gh`/the github provider, and a real browser
   engine via chrome-devtools/playwright) — no ceiling, proceed to dispatch with both as declared
   channels. Step 4, the same mechanisms (real `gh`-backed provider writes, real browser automation)
   serve both the it0 declaration here and the actual iteration-time scenario runs (items 2-5) — no
   divergence.
e. **Plan-time line-budget gate** — this charter declares the small-milestone-norm regime
   explicitly (see "Line budget" section above); result: **PASS** (5 top-level in-scope items, at/
   under the script's default 8-item threshold; no `Line budget: <N>` over 2000 declared) — full
   command + PASS reasoning documented in that section above.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly, not here)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a
capability-growth-typed milestone with a NONZERO realized VT Δv — this milestone is typed
explore/method-infra with Δv̂=0 by design (no VT chart cell, no capability-growth primary type), so
condition (a) does not apply regardless of outcome UNLESS the realized Δv turns out nonzero at
ABSORB (re-check then, not assumed here — see the Value-hypothesis judgment flag above; it should
not apply since this milestone adds no ABI surface and implements no fixes for any finding).
Condition (b) requires iteration-0 to recommend skipping iteration-1 — not authorized; both
iterations run regardless. Do not pre-judge which condition (if either) fires — state plainly at
ABSORB, per the documented-no-op discipline.

## V_meta consolidation-lag gate — evaluate at ABSORB (state explicitly, not here)
Check every `v-meta-ledger.md` row with status `confirmed`-but-not-`consolidated` against the K=2
alarm threshold at ABSORB time. Do not pre-judge the outcome here — this is now itself one of the
DoD clauses `it0-dod-check.{sh,mjs}` mechanically checks was dispositioned (see "Note for ABSORB"
below); state the check's real outcome in the ABSORB log entry.

## Design-only-milestone impl-row gate — evaluate at ABSORB (state explicitly, not here)
This milestone is not obviously design-only (it drives 5 real end-to-end scenarios, produces raw
transcripts/screenshots, and a written report, not a design doc with a future-implementer
checklist) — but do not pre-judge this at charter-authoring time. Run `it0-impl-row-check.sh
exp5-M-OUTCOME-EVAL backlog.md` at ABSORB and paste the real output as part of the closing
evidence, per the standing gate's own invocation convention.

## DoD meta-enforcer gate — evaluate at ABSORB (state explicitly, not here)
Per DIR-017/M25, `scripts/it0-dod-check.sh` must run against this milestone's charter + backlog row
+ ABSORB-entry text before `milestone_counter++` may execute (HARD BLOCK, same shape as the other
three gates above). Do not pre-judge PASS/FAIL here.

## Note for ABSORB
1. **This is the DoD meta-enforcer's fourth-ever real (non-fixture, non-self-referential) test.**
   Per cp-25.md's flagged item and M25/M26/M27's own ABSORB entries (first real test M25
   self-check; second real test M26; third real test M27), this milestone's ABSORB is the FOURTH
   time the checker is run against a charter/backlog-row/ABSORB-text it did not itself produce.
   State EXPLICITLY in the m28 ABSORB entry whether `it0-dod-check.sh` continued to generalize
   cleanly, or whether it needed adjustment (and if so, exactly what broke and why) — continuing
   the load-bearing evidence trail from M26/M27 on whether DIR-017 Step 1's mechanism is genuinely
   operative outside its own build context.
2. **Any real gap/bug found while driving the 5 scenarios must be logged with a paper trail** (per
   Done-when clause 7) — a gap discovered and silently left unfixed with no report entry and no
   future-candidate disposition is itself a DoD violation in spirit (an undocumented, dropped
   finding), even if no existing gate's mechanical check catches it directly. State in the ABSORB
   entry how many real gaps/bugs (if any) were found per scenario, and confirm each has an explicit
   disposition, per Done-when clause 7's own text.
3. **State explicitly whether this milestone's findings feed a NEW future SELECT candidate.** If
   any scenario fails, or a real, significant capability gap is found, the ABSORB entry should note
   whether a new backlog row is warranted (separate from this milestone's own row) — this
   milestone's scope is measurement only, per "Explicitly OUT of scope," so any resulting fix work
   is necessarily a FUTURE milestone, not folded in retroactively here.
4. **State explicitly whether the Value-hypothesis judgment flag (see above) changes at ABSORB.**
   Confirm the realized Δv is indeed 0 (no VT chart cell moved) as designed, and confirm whether the
   task store's stated value type (explore, method infra, no VT points) held up as an accurate
   characterization given what was actually run, or whether the audit-like character flagged above
   warrants a note for future value-typing of similar milestones.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — per the M23-outer-driver-isolation discipline standing
(DIR-018). Base commit for both M28 iteration worktrees/branches: current HEAD of
`exp5-outer-driver`, confirmed at charter-authoring time via `git rev-parse exp5-outer-driver` →
**`5ba3cba3eec91fa113004ff4c2c117c9a7d1be94`** (unchanged since SELECT time, verified directly, no
drift). Worktree/branch paths (mirrors M26/M27's exact directory convention):
`experiments/quay-perpetual-stream/milestones/M28-outcome-eval/worktrees/iteration-{0,1}`, branches
`exp5-m28-iteration-{0,1}`. Merge iteration-0/iteration-1 results into `exp5-outer-driver` first
(per-file conflict resolution, reconciliation notes per DIR-018 item 3's no-silent-drop discipline);
only THEN merge `exp5-outer-driver` → `master` as the single ABSORB publish commit (`git checkout
master && git merge --no-ff exp5-outer-driver`), sequenced after the adversarial-audit gate, V_meta
consolidation-lag gate, design-only-milestone impl-row gate, AND the DoD meta-enforcer gate all
clear. This will be the DoD meta-enforcer's FOURTH-ever real test (first: M25 self-check; second:
M26; third: M27; fourth: this milestone) — see "Note for ABSORB" item 1 above. iteration-0 executes
the full Phase A/B/C sequence in one pass (native-provider scenarios → github-provider scenarios →
Web UI scenario + consolidated report — a single coherent build+verify pass, not three separate
BAIME iterations).

**iteration-1 skepticism instruction (explicit, not optional):** given this milestone's own
Done-when clause 6/7 honesty discipline and item 3's explicit "does the capability actually run
end-to-end" instruction, iteration-1 must NOT simply read iteration-0's outcome-eval report and
rubber-stamp its pass/fail calls. iteration-1 independently re-runs (or critically re-examines with
fresh evidence) each of the 5 scenarios — genuinely trying to find a scenario iteration-0 marked
`pass` that does not actually hold up under independent re-execution (e.g. a Web UI transition that
looked right in a screenshot but `task_get` doesn't corroborate, a cross-provider write that
persisted on one provider but not the other, a compound/epic gate that iteration-0 exercised on
already-`done` fixtures rather than a genuinely fresh task instance), or a real gap/bug iteration-0
either missed or under-reported. This mirrors M26's/M27's own iteration-1-skepticism instruction
(independently re-deriving rather than trusting iteration-0's report text), applied here to an
outcome-based-evaluation context: the risk is not a rigged fixture, it is a scenario marked "pass"
on the strength of a plausible-looking transcript rather than a genuinely independently-verified
end state.
