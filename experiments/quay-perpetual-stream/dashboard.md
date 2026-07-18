# Dashboard — quay-perpetual-stream (Experiment 5)

**state: RUNNING**
**milestone_counter: 3** · **chart: 1** · **checkpoint cadence: every 5 milestones (non-blocking)**
**stop signals only: human `.halt` sentinel · internal exit (VT slope<threshold / hypothesis falsified)**

## VT — Value Trajectory (weighted surface-capability points; §4.1, §6.2)

Chart-0 surface weights (initial, soft — revise at checkpoint 1 from live data):

| surface | weight | cov (0..1) | points = weight·cov |
|---|---|---|---|
| CLI | 25 | 0.95 | 23.75 |
| MCP | 20 | 0.90 | 18.00 |
| Web UI | 20 | 0.95 | 19.00 |
| Packaging / Distribution | 20 | 0.85 (M01-dist DONE — SEA/Bun executables + CI, DIR-004 closed) | 17.00 |
| Docs | 15 | 0.70 | 10.50 |
| **VT₁ (after m1)** | **/100** | | **88.25** |

### Chart-1 transition (M03-abi-eval, DIR-001 items 1-2) — Provider-ABI surface added

New surface, weight **20** (comparable to Packaging/MCP — structural product pillar, DIR-001's
own framing: "quay's own reason to exist [is a] provider-agnostic task board"). chart-0's 5
surfaces carry over 1:1 (no re-scoring — out of this milestone's scope); chart-1 Σ = 120.

**cov derivation (REALIZED, not the charter's 0.30 pre-dispatch placeholder)** — from
`milestones/M03-abi-eval/capability-matrix.md`'s own live-verified findings (iteration-0), scored
as the github Provider's OWN realized fraction of the ABI's per-field capability surface
(the dimension the placeholder was estimating — how complete is the 2nd, heterogeneous-backend
Provider relative to the ABI's full field set), weighted by field-count per capability row (the
comparable, non-N/A cells only — gate's/skill's title/body/labels/N/A rows excluded, matrix's own
"Summary — cell count" section):

| capability | fields scored | github realized | fraction |
|---|---|---|---|
| read | status, title, body, labels, parent/children | 4.5/5 (parent/children: children full, `parent` path-dependent — full via `task_list`, always `null` via `task_get`, PR-ABI-002) | 0.90 |
| write | status, title, body, labels, parent/children | 1/5 (status only — PR-ABI-001: unsupported fields silently dropped, not merely "unimplemented" in an erroring sense) | 0.20 |
| gate | primitive, compound | 2/2 (both live-verified against real issues — gh-3 primitive, gh-7 compound — not just injected-fixture unit tests) | 1.00 |
| skill | status_skill_map/action_buttons | 1/1 (byte-identical shape to native's own, generic Core passthrough, live-confirmed via `manifest`) | 1.00 |

cov = (4.5 + 1 + 2 + 1) / (5 + 5 + 2 + 1) = **8.5 / 13 = 0.654** (rounded to 3dp: 0.6538…)

This is HIGHER than the charter's own 0.30 pre-dispatch placeholder — the placeholder assumed
gate/skill were "ported-but-thin"/uncertain (DIR-001's own framing); this milestone's live
differential evidence found gate and skill FULLY symmetric across both providers (the only
material gap is write-completeness, previously known in general but now precisely bounded: 1/5
write fields, not 0/5 — status write does work, live-verified idempotently against real issues).
The narrower-than-feared gap is itself part of this milestone's realized-value signal (charter's
own "does the resulting cov number survive a second look" question) — not asserted as pre-decided,
derived from the matrix's own per-cell live evidence, cited above.

| surface | weight | cov | points |
|---|---|---|---|
| CLI | 25 | 0.95 | 23.75 |
| MCP | 20 | 0.90 | 18.00 |
| Web UI | 20 | 0.95 | 19.00 |
| Packaging / Distribution | 20 | 0.85 | 17.00 |
| Docs | 15 | 0.70 | 10.50 |
| **Provider-ABI (NEW)** | **20** | **0.654** | **13.08** |
| **VT chart-1 total (after m3)** | **/120** | | **101.33** |

Conversion factor: chart-0's 5 surfaces carry over 1:1 (88.25 unchanged); chart-1 adds the new
20-weight Provider-ABI term on top (+13.08), for a chart-1 total of **101.33/120** (≈0.844
normalized, vs chart-0's 88.25/100 = 0.8825 normalized — the two totals are on different scales,
not directly comparable without normalizing; recorded both raw and normalized to avoid an
apples-to-oranges Δv claim next milestone).

VT curve (append, chart-1 basis from m3 forward):
`[ (m0, 82.25/100), (m1/M-DIST, 88.25/100, Δv=+6.0), (m2/M-GATES, 88.25/100, Δv=0, methodology-infra
no VT points), (m3/M-ABI-EVAL, 101.33/120, chart transition — not a direct Δv vs m2's 88.25/100;
the +13.08 is the NEW surface's own first-ever score, not incremental growth on an existing one) ]`

Scoring basis (bootstrap, from exp4 `gap-list.md` + `backlog.md` framing): CLI/MCP/Web UI
near-saturated (exp4 closed 102 cumulative gaps, only 4 open at FINAL: ENV-001, SH-006, NEW-001,
PKG-010 — all minor/env). Packaging is the clear low point: existing PKG-series closed (tgz
npm-pack works) but backlog explicitly frames the packaging *vision* (Node SEA/Bun compiled
release artifacts) as unmet — M-DIST rated URGENT, Δv̂≈+12 to reach ~0.8. Docs closed its gap
series but backlog flags coverage as "thin/irregular" — M-DOCS still open, Δv̂≈+4.

VT curve (append `Δv` per milestone): `[ (m0, 82.25), (m1/M-DIST, 88.25, Δv=+6.0) ]`
Slope (marginal points / milestone): **+6.0** (1 data point so far — trend, not yet a rate)

## Health tracks (§4.2–4.4, §6.1)

| track | current | alarm |
|---|---|---|
| ρ reuse rate | **~0.85** (m3: HARD GATES/worktree-isolation/report-shape all reused unchanged from m1/m2; new work product is the matrix+suite, by design) | must-not-fall |
| φ fold-back (confirmed edges) | **3 confirming** (raw-output-bar 3rd-in-a-row + m3 4th; domain-audit-channel≡CI-job pattern now **CONFIRMED** at m3 — 2nd, different-domain [cross-provider vs. cross-platform] instance reusing the M01-dist-derived `inherited-core.md` procedure unchanged, crosses the §4.2 fold-back threshold; consolidation into inherited-core.md's confirmed-pattern section still pending, not yet done) | — |
| charter thickness (tokens) | **~1.8 K** (M01-dist), **~2.1 K** (M02-gates), **~2.0 K** (M03-abi-eval) — all near/over the 2K alarm; gate-block overhead is now the dominant, structural driver across every charter regardless of scope, not milestone-specific dilution | >2 K = dilution |
| discovery latency (mechanizable) | **0** (m1, m2, m3 all — m3's gap-list findings PR-ABI-001/002 were logged same-iteration as found, not deferred) | >~8 iters late |
| calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); m2 no VT Δv̂ (methodology-infra); m3 Δv̂ explicitly "≈0 direct" (re-baseline milestone) — realized cov (0.654) came in materially above the charter's own 0.30 placeholder, a genuine miscalibration on the ESTIMATE though not on a formal Δv̂ (no formal % applicable — flagged so a future numeric placeholder is treated as a real hypothesis to calibrate against, not a throwaway guess) | trend must shrink |
| inner-convergence success | **3/3** (m1: 2 iterations; m2: 2 iterations; m3: 2 iterations, 2nd a stability re-confirmation with zero corrections needed — all three Done-when-complete, no mid-milestone re-scope) | mid-milestone re-scope = fail |

## Control limits (pre-declared; §6/§6.1)
- inner budget = 10 (past → default HALT, continue needs authorization)
- ΔV plateau <0.02 both layers, K=2 consecutive → stop
- gate-hash: any non-verbatim gate → block (0 tolerance)
- discovery-latency alarm: mechanizable-channel discovery >~8 iters late
- explore cadence: ≥1 explore milestone per 5

## Log
- Bootstrap (m0): confirmed exp4 stopped, carry-by-reference verified (backlog.md → exp4 reopened
  DIRs + open gaps; inherited-core.md → 3 extracted skills + exp4 methodology). Scored VT₀=82.25
  from exp4 gap-list.md. state → RUNNING. Selecting M-DIST next per backlog guidance (explore,
  URGENT).
- SELECT m1 = M-DIST (explore). Value hypothesis Δv̂=+6.0 (Packaging cov 0.55→0.85, weight 20)
  recorded BEFORE dispatch. Charter authored: `charters/M01-dist.md` (scope: DIR-004's undelivered
  half — Node SEA/Bun single-file executables, CI build+publish, no-Node verification; the existing
  npm-pack/.tgz path is NOT redone). Gate-hash transclusion + it0 checks recorded in-charter.
  Dispatching inner milestone next.
- ABORTED (user, pre-inner-convergence) 2026-07-18: M-DIST inner iteration-0 (SEA build) had started
  when the loop was aborted. Cleaned for fresh restart under the corrected inbox-drain driver: worktree
  + `charters/M01-dist.md` + `milestones/M01-dist/` removed, 255MB dist-sea discarded; 28KB SEA build
  scripts salvaged on branch `salvage/exp5-m01-attempt-1`. milestone_counter stays 0 (m1 not
  completed); VT₀ unchanged. Restart re-selects M-DIST fresh.
- RESTART 2026-07-18: drained `directives/pending/` (empty, nothing to disposition). Re-SELECT
  m1 = M-DIST (explore, URGENT). Value hypothesis Δv̂=+6.0 (Packaging cov 0.55→0.85, weight 20)
  re-recorded BEFORE dispatch — unchanged from the aborted attempt (no scope drift). Charter
  restored verbatim from pre-abort commit `13f3ac8` to `charters/M01-dist.md` (content was never
  invalidated — only the in-flight worktree/iteration artifacts were cleaned). it0 gate-hash
  re-verified: charter's transcluded block still literal-matches
  `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100–131 (source file
  unchanged since authoring). Dispatching inner iteration-0 next via `baime:iteration-executor`,
  salvaged SEA scripts on `salvage/exp5-m01-attempt-1` available for the worktree to cherry-pick
  if useful (not required — iteration-0 re-derives from charter + gap-list, not from the salvage
  branch, to keep provenance clean).
- **ABSORB m1 = M-DIST → DONE** 2026-07-18. Iteration-0: SEA builds for `quay`+`quay-native`, 2 real
  bugs fixed (`import.meta.url` SEA-bundling crash, `path`-import regression caught by raw-output-bar
  convention), Node-free Docker verification, 4 Done-when clauses met/substantial. Iteration-1: pushed
  to real `origin` (github.com/yaleh/quay), tag-pushed v0.3.0→v0.3.4 fixing 4 distinct real CI
  failures (Windows MSYS path resolution needing `cygpath -w`; `gh` absent in bare container, switched
  to REST API; private-repo release assets need the dedicated `/releases/assets/{id}` endpoint, not
  `browser_download_url`) to a fully green run
  (https://github.com/yaleh/quay/actions/runs/29635782886, tag v0.3.4). All 6 Done-when clauses MET.
  Gap-list CB-023 closed (`experiments/quay-continuous-bootstrap/gap-list.md`). No ceiling/redesign
  trigger fired — anticipated "no push access" blocker checked directly (it0 discipline) and found
  not to apply. **Realized Δv=+6.0, exact match to Δv̂=+6.0 (0% calibration error).** Merged
  `exp5-m01-iteration-1` → `master` (`--no-ff`, 13 files, SEA scripts + CI workflow + gap-list entry)
  so the delivered capability is live in the shared tree, not stranded in a worktree branch. VT
  82.25→88.25. milestone_counter → 1. φ: raw-output-bar convention gets a 2nd-in-a-row confirming
  instance in a new domain (packaging) — worth explicit note in `inherited-core.md` as doubly-proven,
  not just carried by citation. Two adaptation candidates (domain-audit-channel≡CI-job pattern;
  per-subcommand audit exercise) logged but NOT yet consolidated — only 1 milestone's evidence, need
  a 2nd confirming instance per φ threshold (§4.2). Backlog `M-DIST` row marked DONE.
- SELECT m2 attempt 1 = M-CLI-UX (exploit, per backlog's suggested ordering) — **REJECTED at it0
  ceiling/floor arithmetic check** (§4.4 check a): grepped `experiments/quay-continuous-bootstrap/
  gap-list.md` for the named UQ-042..046 scope and found all 5 already closed in exp4 iteration 15
  (`~~strikethrough~~`, "(done)" annotations). exp4's actual FINAL open-gap set (it19) is only
  ENV-001/SH-006/NEW-001/PKG-010, all minor/environmental — M-CLI-UX as backlog-described has ZERO
  real remaining scope. This is exactly the it0 discipline this experiment exists to institutionalize
  (catch stale/unreachable targets before dispatch, not 8 iterations in). Backlog updated with a
  STALE note so this isn't re-discovered from scratch later. **No inner milestone dispatched for
  this rejected attempt — 0 wasted inner iterations**, which is itself evidence for the it0 checks'
  value (the exact offline-validated finding, RESULTS.md B2 check 1).
- SELECT m2 attempt 2 = **M-GATES** (explore, highest method-ROI per backlog). Unlike product-value
  milestones, M-GATES targets the discovery-latency / charter-thickness / ρ health tracks directly,
  not a VT chart-0 surface — value hypothesis recorded in those terms (§4.1 methodology-infra
  milestones don't carry VT points; §4.2/§4.3). Charter authored next.
- **ABSORB m2 = M-GATES → DONE** 2026-07-18. Iteration-0 built and committed (`f28d012`)
  `it0-ceiling-check.sh`, `it0-gate-hash-check.sh`, `it0-dogfood-evidence-gate.sh` under
  `experiments/quay-perpetual-stream/scripts/`, plus a concrete domain-misfit decision procedure in
  `inherited-core.md` and an `OUTER-LOOP.md` step-4 update pointing at all of it by path. Found+fixed
  one real bug in its own gate-hash script (false FAIL against M01-dist from incomplete PARAM-line
  stripping) via dogfooding before declaring done. Iteration-1 was a deliberately lightweight
  stability-confirmation pass (charter's "stable ≥1 iteration" sub-clause) — independently re-ran all
  3 scripts against fresh fixtures (zero drift, zero regressions, zero new edits), confirmed
  iteration-0's commit was genuinely present (not just claimed — the exact M01-dist iteration-1
  lesson applied here), investigated the dogfood-gate's FAIL against M01-dist iteration-0.md and
  confirmed it a correct positive (real evidence exists but past the script's default 40-line
  window), not a script bug. **MILESTONE DONE**, all 6 Done-when clauses confirmed stable across the
  iteration boundary. Merged `exp5-m02-iteration-0` → `master` (`--no-ff`). Realized value
  (methodology-infra framing, no VT points): 3 of 4 it0 checks are now genuinely mechanized and
  usable by a future outer pass with reduced manual judgment vs. the ad hoc grep+read-through that
  caught M-CLI-UX; the 4th (dogfooding evidence-gate) is disclosed as a partial mechanization
  (narrows but doesn't eliminate judgment on FLAG results). The deferred metric — does m3 actually
  invoke these scripts and take less effort than m2-attempt-1's manual pass — is unmeasured until m3.
  milestone_counter → 2. Backlog `M-GATES` row to be marked DONE next.
- SELECT m3 attempt 1 = M-DOCS — **REJECTED at it0 ceiling check** (now run via the just-merged
  `it0-ceiling-check.sh` script itself, not manual grep — the tool built at m2 was used at m3, one
  milestone later): DOC-001..005 all CLOSED already (exp4 iteration 19). SELECT m3 attempt 2 =
  M-DIRTASK — **REJECTED**: `directives/archive/DIR-006-*.md` shows DIR-006 CLOSED with a formal
  resolution ("Option B: files canonical") that explicitly rejects this row's own tooling-cutover
  premise. Both rejections recorded with 0 wasted inner iterations (same pattern as M-CLI-UX at m2).
  **Backlog-exhaustion finding**: every carried-by-reference candidate is now stale or done; see
  `backlog.md`'s new "Backlog exhaustion finding" section. SELECT m3 attempt 3 = **M-DISCOVER**
  (exploit, per protocol §4.4's discovery-engine portfolio — the standing simulated-user/persona
  channel, not another carried-reference mine). Scope: run persona review against the CURRENT live
  product (post-M-DIST, post-M-GATES) across CLI/MCP/Web UI/Docs, since M-DIST added real SEA/CI
  surfaces no persona has ever exercised, and re-score VT surface cov from live findings (the
  dashboard's own top-of-file note has flagged chart-0 weights as "initial, soft — revise at
  checkpoint 1 from live data" since bootstrap; m3 is a natural point to start that, ahead of the m5
  checkpoint). Charter authored next: `charters/M03-discover.md`.
  it0 gate-hash check run via M-GATES' own script (first real-world use of the mechanized check,
  one milestone after being built): `it0-gate-hash-check.sh charters/M03-discover.md` → **PASS**
  (exit 0). Dispatching inner iteration-0 next.
- **DIR-001 drain (2026-07-18, before m3 dispatch)**: `ls -1 experiments/quay-perpetual-stream/directives/pending/`
  showed `DIR-001-evaluation-blind-spot-provider-abi-and-outcome-based-methods.md` (1 file).
  Disposition: **applied (partial)**. Finding: VT's chart-0 surface set has no Provider-ABI term,
  so the value function cannot see quay's core ABI-completeness gap; the GitHub Provider has been
  out of the eval loop since exp2 (status-only write, unimplemented title/body/labels/parent-children).
  This SUPERSEDES the just-authored m3-attempt-3 selection (M03-discover) — its own persona-review
  method is exactly the polish-engine channel DIR-001 indicts, so running it first would reproduce
  the blind spot. M03-discover is DEFERRED (not discarded, 0 inner iterations spent — same clean
  pattern as the M-CLI-UX/M-DOCS/M-DIRTASK rejections) to m4+, ready to dispatch as-is. **SELECT m3
  (final) = M-ABI-EVAL** (explore, chart-0→chart-1 transition per §4.1). DIR-001 items 3-6
  backlogged as 4 new candidate rows (`backlog.md`), not built this milestone (would blow this
  charter's scope). Full disposition + rationale recorded in
  `directives/archive/DIR-001-evaluation-blind-spot-provider-abi-and-outcome-based-methods.md`'s
  Resolution section. Charter authored: `charters/M03-abi-eval.md` (scope: capability matrix +
  native/github differential conformance suite; explicitly NOT closing the write-completeness gap
  itself — that's later scope this milestone's output makes selectable). Value hypothesis: chart-1
  VT₀ = 88.25 + 20·0.30(placeholder) = 94.25 pre-dispatch estimate; REALIZED cov to be derived from
  this milestone's own matrix+suite evidence, not the placeholder. Gate-hash check:
  `it0-gate-hash-check.sh charters/M03-abi-eval.md` → **PASS** (exit 0). Dispatching inner
  iteration-0 next via `baime:iteration-executor`.
- **ABSORB m3 = M-ABI-EVAL → DONE** 2026-07-18. Iteration-0: built the Provider-ABI capability
  matrix (`milestones/M03-abi-eval/capability-matrix.md`) and an 18-scenario differential
  conformance suite (`packages/quay/test/provider-abi-conformance.test.mjs`) run live against both
  native and the real `yaleh/quay` github provider (primitive + compound task shapes), all 18
  passing; found and logged 2 genuine new gaps (PR-ABI-001: github `task_write` silently drops
  unsupported fields with no error; PR-ABI-002: github `task.parent` resolves via `task_list` but
  always returns `null` via `task_get` — a real internal inconsistency, not a documented
  limitation). Mid-iteration self-caught a repo-root isolation leak (2 files) and recovered inside
  the worktree before finishing — logged as an adaptation-log finding recommending
  `inherited-core.md` flag dashboard.md/gap-list.md/backlog.md as standing risk paths for this
  exact mistake (noted for a future consolidation pass, not applied this milestone — out of scope).
  Iteration-1: independent stability re-confirmation (M02-gates iteration-1 pattern) — fresh
  worktree, fresh `npm install`, re-ran the full conformance suite (18/18, byte-identical) and full
  existing suite (31/31, 0 regressions) from scratch rather than trusting iteration-0's pasted
  output, hand-recomputed the VT arithmetic (cov=0.6538→0.654, points=13.08, chart-1 total=101.33,
  matches exactly), spot-checked the 2 most load-bearing matrix citations against source. Zero
  drift, zero corrections needed. **All 6 Done-when clauses MET and stable across the iteration
  boundary.** Merged `exp5-m03-iteration-1` → `master` (`--no-ff`, 6 files: capability-matrix.md,
  conformance suite, 2 iteration reports, dashboard.md's chart-1 VT section, gap-list.md's 2 new
  entries). **Chart transition executed**: chart-0's 5 surfaces carry over 1:1 (unchanged, out of
  this milestone's scope), Provider-ABI added at weight 20 with REALIZED cov=0.654 (derived from
  the matrix's own per-capability-row realized fractions: read 0.90, write 0.20, gate 1.00, skill
  1.00 — weighted by field count), NOT the charter's 0.30 pre-dispatch placeholder — the realized
  number came in materially higher than guessed, because gate/skill turned out fully symmetric
  across providers (the charter's own stated worry) while write is the genuinely thin cell.
  **Chart-1 VT = 88.25 (carried) + 13.08 (Provider-ABI) = 101.33/120** (≈0.844 normalized,
  comparable to chart-0's 0.8825 — a real but modest dip, consistent with DIR-001's thesis that the
  "near-perfect" reading was inflated by the surface set the old chart couldn't see past).
  Calibration: charter's Δv̂ was explicitly "≈0 direct" (this was a re-baseline milestone, not a
  capability-close) — the realized value is the re-baseline's honesty, not a VT point delta in the
  usual sense; DIR-001's finding #3 (GitHub provider under-evaluated) is now falsifiable-and-largely-
  confirmed with live evidence (write genuinely thin at 0.20) rather than argued from provider.yml
  labels alone. milestone_counter → 3. chart → 1. Backlog `M-ABI-EVAL` row to be marked DONE next.
  φ: CI-job≡audit-channel pattern (from `inherited-core.md`, validated once at M01-dist) gets its
  2nd confirming instance here — the conformance suite explicitly designed as its own standing
  audit channel, same pattern, different domain (cross-provider vs. cross-platform) — this crosses
  the φ confirmation threshold (§4.2, "a LATER different-domain milestone reuses an adaptation
  unchanged"); worth folding into `inherited-core.md` as a confirmed, not just proposed, pattern at
  the next natural editing pass.
- SELECT m4 = **M04-discover** (exploit). No `.halt`, `directives/pending/` empty. Candidates
  considered: `M04-discover` (already authored+gate-hash-verified, deferred from m3, exploit —
  balances explore cadence after 3 straight explore milestones m1-m3), `M-GH-WRITE`/`M-GH-PARENT`
  (fresh from m3's own findings, not yet charter-authored). Selected M04-discover: it's fully
  ready (0 authoring cost), satisfies explore/exploit cadence (§4.5, ≥1 explore per 5 — already
  met 3/3, an exploit pick is due), and its persona sweep now runs against a chart-1 product
  (Provider-ABI baseline just established) rather than the stale chart-0-only context it was
  originally authored against — a strictly better time to run it than when first drafted.
  Renamed `charters/M03-discover.md` → `charters/M04-discover.md` (worktree/branch paths only —
  `milestones/M03-discover/*` → `milestones/M04-discover/*`, `exp5-m03-iteration-N` →
  `exp5-m04-iteration-N` — to avoid colliding with M-ABI-EVAL's already-used m3 branch names;
  scope/rationale/Done-when unchanged from original authoring). Gate-hash re-verified PASS after
  rename: `it0-gate-hash-check.sh charters/M04-discover.md` → PASS (exit 0). M-GH-WRITE/
  M-GH-PARENT remain backlogged, ready for m5+. Dispatching inner iteration-0 next.
- **Mid-milestone directive drain (2026-07-18, during M04-discover)**: `ls -1
  experiments/quay-perpetual-stream/directives/pending/` showed
  `DIR-002-directives-as-quay-tasks-restore-restrained-projection-design.md` (1 file). Finding:
  exp4 DIR-006's "files-canonical, Option B" resolution (cited as settling M-DIRTASK's rejection at
  m3-attempt-2, `backlog.md`) is re-characterized by the human as a transition failure rationalized
  as a decision — the original restrained requirement (files canonical + generated task
  *projection*, not replacement) was never actually built; it11 did a destructive cutover instead
  of the agreed projection, the enabling tooling step was skipped, and it15's rollback discarded
  the real goal rather than fixing the missing enforcement. Disposition: **DEFERRED** (not
  applied/rejected) — M04-discover's iteration-0 just landed with a significant real finding
  (MD-001 merge-drift) and iteration-1 stability-confirmation is already queued; pivoting now would
  waste in-flight work, unlike DIR-001 which arrived pre-dispatch. Added as `M-DIR-PROJECTION` to
  `backlog.md`, flagged **top priority for m5 SELECT** (repeat-governance-drift risk outranks the
  M-GH-WRITE/M-GH-PARENT provider-capability gaps). Full disposition rationale recorded in-place in
  `directives/pending/DIR-002-*.md`'s new "Disposition note" section (file stays in pending/, not
  archived, since it's deferred not resolved). Continuing M04-discover: dispatching a lightweight
  iteration-1 stability-confirmation pass next, per iteration-0's own recommendation given MD-001's
  significance.
