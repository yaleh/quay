# Dashboard — quay-perpetual-stream (Experiment 5)

**state: RUNNING**
**milestone_counter: 94** · **chart: 1** · **checkpoint cadence: every 5 milestones (non-blocking)**
<!-- NOTE (M65 ABSORB header sync): body log's m65 ABSORB entry below sets milestone_counter → 65;
kept in sync at each ABSORB going forward (same staleness class flagged before at m39..m64).
65 % 5 == 0 — CHECKPOINT DUE this milestone (cp-65 written below).
70 % 5 == 0 — CHECKPOINT DUE (cp-66 written at M70 ABSORB). -->
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

### OUTWARD VT term (DIR-038-C) — the unbounded, additive dimension the cov ruler could not see

The `Σ weight·cov` model above is BOUNDED (`cov ∈ [0,1]`) and near-saturated (≈0.93), so it scores only
FILLING pre-enumerated surfaces — never ADDING a capability or being USED externally. Two real forms of
value scored **0** under it and are now captured by an explicit **unbounded** term, `outwardVT` (single
source: `scripts/outward-vt-check.mjs`; soft weights, revisable at a checkpoint like the cov weights):

`outwardVT = 10·externalDeployments + 1·foreignTasksDriven + 5·newCapabilities` — no ceiling (a sum of
unbounded counts), the property the bounded cov cells structurally lack.

**Realized outward VT (this restart window, REAL objects — not a placeholder):**
| signal | count | ×weight | provenance |
|---|---|---|---|
| external deployments | 1 | 10 | quay is archguard's task backend (DIR-036-B) — `/home/yale/work/archguard/.quay/` + `quay-tasks/` |
| foreign tasks driven | 9 | 9 | quay's loop autonomously drove to done: TASK-24/25, DIR-001/002, TASK-29, TASK-EXP-A, ARCH-CONC-A/B/C |
| new capabilities | 5 | 25 | cov-uncell-able: document-management (M45), migrate (DIR-039), concurrent-scheduler (DIR-044), dispatched+audit (DIR-048), autonomous concurrency (DIR-049) |
| **outward VT term** | | **44** | non-saturating, confirmed by `outward-vt-check.mjs` |

**Re-score (AC #1): M45 document-management** scored **cov = 0** ("no VT chart cell"); under the outward
term it contributes as **1 new capability = 5 points → non-zero** (`rescore(0,1).rescued === true`). The
ruler now READS the external `L_T` signal DIR-036 produces, so capability-adding and external use register
value without a pre-enumerated cov cell. (Integrating the outward term into the per-milestone Δv that
feeds the rolling-slope halt — A — is the terminal DIR-038 step once the outward cadence is a standing input.)

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

### Chart-1 re-score (M04-discover, exploit-channel 4-persona pass) — 2026-07-18

Re-scored the 5 chart-0 surfaces (Provider-ABI is M03-abi-eval's scope, unchanged here) from this
milestone's own live persona-pass findings, per the charter's Done-when clause 2. Cited findings are
in `experiments/quay-continuous-bootstrap/gap-list.md` (MD-001, CB-006/021/022, UQ-047/048/049/050,
PKG-003/004/005/006/007/008, DOC-006/007) and the M04-discover iteration-0 report.

| surface | prior cov | new cov | rationale |
|---|---|---|---|
| CLI | 0.95 | **0.80** | MD-001's merge-drift is CLI-surface-heaviest: `--version`/`-V` (UQ-047), `--page-size` in all 3 modes (CB-006/CB-022), and `--format json` alias (CB-021) are ALL live-confirmed absent/broken on master despite gap-list.md having asserted them closed since exp4 iterations 13-17. Core subcommands (`task list/view/edit/check`, `action list/run`, `serve`, `mcp`) all work correctly on both the `.tgz`/node path AND the SEA executable path (byte-identical `--help`, live-verified) — the drop is bounded to the 4 specific reopened capabilities, not a broad regression. 0.95→0.80 reflects 4 real capability losses on a ~20-capability-wide surface, not a catastrophic surface failure. |
| MCP | 0.90 | **0.90** | Live stdio-client persona pass (real `@modelcontextprotocol/sdk` `Client`+`StdioClientTransport`, not test mocking) exercised `tools/list`, `task_list`, `task_get`, `task_write`, `task_check`, `resources/list` end-to-end — all 6 clean, no new gaps found. MCP surface is unaffected by MD-001 (the drifted commits were CLI/Web UI/docs-only; `mcp-server.js` was not among the files touched by the unmerged commits). Unchanged. |
| Web UI | 0.95 | **0.92 CONFIRMED** | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (`?search=` URL param silently no-ops; real param is `q` — a real discoverability trap for anyone constructing URLs by the visible field's `name` attribute) and UQ-050 (mobile-viewport CSS horizontal overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. **CONFIRMED at M11-webui-reverify (m11, 2026-07-18):** re-verified with REAL `mcp__playwright__*` tool-call traces (navigate + snapshot/screenshot, both viewports) — see `milestones/M11-webui-reverify/iterations/iteration-0.md` and, independently re-derived from a fresh worktree/branch, `milestones/M11-webui-reverify/iterations/iteration-1.md`, for the full pasted traces (identical findings in both). UQ-049 reproduces identically (`?search=DIR-004` → 169/169 unfiltered, page 1 of 9; `?q=DIR-004` → correctly filtered to 9 tasks). UQ-050 reproduces as a genuine live horizontal-overflow bug, though live DOM inspection (`element.scrollWidth`/`getBoundingClientRect`) pins the overflowing element more precisely than the original narrative: on the specific task re-tested (DIR-004 detail, mobile 390px), the page `<h1>` title itself wraps cleanly with NO overflow (`h1.scrollWidth === h1.clientWidth === 366`), but `document.body.scrollWidth` (477px) exceeds `window.innerWidth` (390px) because of an unbroken long URL string in the task body content (`Release: https://github.com/yaleh/quay/releases/tag/v0.2.0`, an `<li>` with `scrollWidth=401` vs `clientWidth=302`) — screenshot-confirmed the URL text is cut off at the viewport edge. Root cause is the same missing `overflow-wrap`/`word-break` CSS class of bug M04-discover flagged, just observed on body-content long tokens rather than (or in addition to) the h1 title specifically — recorded as a CONFIRM, not a CORRECT, since the underlying cov-affecting defect (mobile-viewport horizontal overflow exists and is real) is unchanged; only the most-precise element attribution is refined. 0.92 retained unchanged (no Δv — pure instrument re-derivation, not a correction), per the charter's value-typed ledger (this re-verification's value type is discovery + risk/option, NOT capability-growth; the ⚠️ annotation is removed because the evidence gap DIR-006 flagged is now closed with real browser-tool traces, not because the underlying number changed). |
| Packaging / Distribution | 0.85 | **0.85** | SEA executable path (M-DIST's headline deliverable) verified working end-to-end this milestone: `--help`, `task list`, `mcp`, `serve` all function correctly on the SEA binary, byte-identical `--help` output vs the `.tgz`/node path. `package.json` metadata gaps (PKG-003/004/005/006/007/008: missing `files`/`license` fields, missing `packages/quay/{README,CHANGELOG,LICENSE}.md`) are real but were already true before this milestone (MD-001 reveals they were NEVER actually fixed, not that they regressed) — the packaging cov score has always implicitly excluded these (gap-list.md's own "Closed" claims for them were the miscalibration, not a change in the underlying artifact). Held flat rather than dropped, since the SEA-path capability this surface is primarily scored on is confirmed solid; the metadata gaps are better reflected as a Docs-adjacent finding (folded into Docs' drop below) since they're about published-artifact *documentation/metadata completeness*, which is this surface's thinner, historically-never-actually-0.85-justifying edge — flagged for a more rigorous re-derivation at the M-MERGE-RECOVER milestone rather than guessed further here. |
| Docs | 0.70 | **0.55** | Two real, previously-invisible findings: DOC-006 (root README.md has ZERO mention of the SEA/single-file-executable distribution path — the charter's own explicitly-named candidate gap, and a major shipped capability with no user-facing docs at all) and DOC-007 (CHANGELOG.md is stuck at "v0.2.0", no v0.3.x/SEA entry despite `package.json` reporting 0.3.4, AND the v0.2.0 entry itself makes 3 false shipped-feature claims per MD-001). Combined with the DOC-001..005/PKG-004..008 reopenings (packages/quay/{README,CHANGELOG,LICENSE}.md all confirmed absent, `package.json` missing `files`/`license`), Docs is the surface most concretely damaged by this milestone's findings — a genuine, evidenced drop, not a soft impression. |
| **VT chart-1 total (after m4)** | **101.33/120** | **94.73/120** | CLI 25×0.80=20.00 (was 23.75, −3.75); MCP 20×0.90=18.00 (unchanged); Web UI 20×0.92=18.40 (was 19.00, −0.60); Packaging 20×0.85=17.00 (unchanged); Docs 15×0.55=8.25 (was 10.50, −2.25); Provider-ABI 20×0.654=13.08 (unchanged, out of scope). Total = 20.00+18.00+18.40+17.00+8.25+13.08 = **94.73/120** (≈0.789 normalized, down from 0.844 at m3). |

**Iteration-1 correction (independent re-verification):** iteration-0's original text stated this
total as 95.83/120 (Δv=−5.50); re-summing the same five per-surface point values it cites
(20.00+18.00+18.40+17.00+8.25+13.08) gives **94.73/120**, and the per-surface deltas it lists
(−3.75, 0, −0.60, 0, −2.25 = −6.60) also sum to 101.33−6.60=94.73, not 95.83. This was a pure
arithmetic/transcription slip in iteration-0 (the per-surface cov values and rationale were correct
and are unchanged here) — corrected in this iteration, independently re-verified via
`python3 -c "print(20.00+18.00+18.40+17.00+8.25+13.08)"` → `94.73`.

This is the first milestone in exp5 where VT genuinely DECREASES (Δv=−6.60 vs m3's 101.33) — not a
regression in the product, but a correction of a **measurement error carried since m1**: MD-001's
merge-drift means chart-0's cov numbers have been systematically overstated since before exp5 even
began (they were inherited from exp4's own, now-shown-to-be-inaccurate, "Closed" ledger). This is
exactly the kind of finding the exploit-channel persona-review discovery engine exists to surface —
consistent with DIR-001's broader thesis that un-audited "closed" claims silently distort the value
function the outer loop steers on.

VT curve (append, chart-1 basis): `[ ..., (m3/M-ABI-EVAL, 101.33/120), (m4/M04-discover, 94.73/120,
Δv=−6.60, MEASUREMENT CORRECTION not a capability regression — see MD-001; corrected from
iteration-0's arithmetic slip of 95.83 during iteration-1's independent re-verification) ]`

### Chart-1 re-score (M08-merge-recover, CLI/Docs/Packaging capability recovery) — 2026-07-18

Re-scored CLI/Docs/Packaging (the 3 surfaces MD-001 flagged) from this milestone's own live
re-verification evidence, per the charter's Done-when clause 7. This is iteration-1's
INDEPENDENTLY RE-DERIVED score (iteration-0's own §7 draft flagged its own numbers "provisional,
explicitly flagged for iteration-1's own independent re-derivation" — this section is that
re-derivation, not a copy-forward). Cited findings are in
`experiments/quay-continuous-bootstrap/gap-list.md` (MD-001, CB-006/021/022, UQ-047/048,
PKG-003..008, DOC-001..007) and this milestone's own iteration-1 report
(`experiments/quay-perpetual-stream/milestones/M08-merge-recover/iterations/iteration-1.md`), which
contains fresh, independently-captured command output for every claim below (not iteration-0's
pasted output re-cited).

| surface | prior cov (m4) | new cov | rationale (iteration-1's own independent live evidence) |
|---|---|---|---|
| CLI | 0.80 | **0.94** | All 4 MD-001-flagged CLI losses independently re-verified fixed on a fresh worktree/fresh `npm install`: `--version`/`-V` print the real `0.3.5` package version and exit 0; `--format json` and `--json` produce byte-identical output for `task list` (verified via `diff`) and `--format yaml` is a hard usage error (exit 1); `--page-size` works in CLI table mode (`# showing 1 of 3 tasks`), JSON mode (element count truncated, confirming the `printJson(sorted)` bug fix), AND Web UI (`?pageSize=N`, verified via live `curl` against a `quay serve` instance); invalid `--page-size` values (`0`, `-1`, `abc`) all exit 1 with a descriptive stderr error (UQ-048). ADDITIONALLY (beyond iteration-0's own evidence): the Docker audit-channel caveat iteration-0 explicitly left open (10 `--provider github` subtests failing only because `node:20-slim` lacks the `gh` CLI) is NOW FULLY RESOLVED — re-ran the same audit container with `gh` installed via the official apt repository inside the container, and got a **fully clean, zero-caveat pass**: all 10 previously-`gh`-blocked `--provider github` subtests now pass inside the independently-provisioned container (see iteration-1 report §Part A.5 for full transcript). This closes the one residual confidence discount iteration-0's own 0.93 carried; 0.93→0.94 (small, since the discount closed was a process/environment gap, not a code gap — no new capability was added, so the score does not jump further). Not 1.0: no other CLI surface was touched this milestone (out of scope per charter item 9), same ceiling reasoning iteration-0 gave. |
| Docs | 0.55 | **0.85** | Independently re-confirmed via fresh `grep`/`ls` on the re-derived worktree: `packages/quay/{README,CHANGELOG,LICENSE}.md` all exist with real content (8812/728/1067 bytes respectively — byte-identical to iteration-0's own figures, confirming no drift since iteration-0's commit); DOC-001..006 coverage independently re-confirmed via direct grep of `packages/quay/README.md` (`--provider <id>`, `action list`/`action run`, `task view`/`task edit --status`, Configuration section ordering matching this repo's own `.quay/config.yml`, releases URL, and the SEA distribution section all present); root README's SEA section independently confirmed at line 236, closing DOC-006. CHANGELOG.md's v0.2.0 false claims correction and new v0.3.x entry (DOC-007) independently re-read and confirmed accurate against the same live evidence used to close CB-006/021/022/UQ-047/048 above. Not 1.0: `packages/quay/CHANGELOG.md` remains a deliberate pointer/stub (documented design choice, not a gap) — kept at the same conservative 0.85 iteration-0 proposed, independently re-derived rather than merely copied forward. |
| Packaging | 0.85 | **0.90** | Independently re-confirmed: `package.json` `files` (`README.md`, `CHANGELOG.md`, `LICENSE.md`, `bin`, `src`) and `license` (`"MIT"`) fields present with a fresh per-entry existence check (`fs.existsSync` for every `files` entry — all 5 EXISTS, zero ghost entries), closing PKG-003/004/005/006/007/008 for real. SEA path itself unchanged/still solid (out of this milestone's touch scope). Not higher: same charter-scope ceiling reasoning as iteration-0 — packaging metadata is now complete but the surface's ceiling in this milestone's scope was always "package.json + the 3 doc files," not a broader packaging redesign. |
| **VT chart-1 total (after m8)** | **94.73/120** | **103.73/120** | CLI 25×0.94=23.50 (+3.50 vs m4's 20.00); MCP 20×0.90=18.00 (unchanged, out of scope); Web UI 20×0.92=18.40 (unchanged, out of scope); Packaging 20×0.90=18.00 (+1.00 vs m4's 17.00); Docs 15×0.85=12.75 (+4.50 vs m4's 8.25); Provider-ABI 20×0.654=13.08 (unchanged, out of scope). Total = 23.50+18.00+18.40+18.00+12.75+13.08 = **103.73/120** (≈0.864 normalized, up from 0.789 at m4). |

**Arithmetic re-check** (this milestone's own standing convention, applied independently by
iteration-1 rather than trusting iteration-0's own §7 draft, which explicitly flagged itself
provisional):
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+13.08)"
103.73
```
Total confirmed: **103.73/120**. Δv = 103.73 − 94.73 = **+9.00** — above the charter's own
Δv̂≈+7.6 pre-dispatch estimate and also above iteration-0's own draft total of 103.48/120
(Δv=+8.75); the difference (+0.25) is entirely attributable to iteration-1's own independently
re-derived CLI cov (0.94 vs iteration-0's draft 0.93), driven by the now-fully-resolved Docker
`gh`-provisioning caveat — a genuinely NEW piece of evidence iteration-1 gathered (not present in
iteration-0's own report), not an arithmetic correction of iteration-0's math (iteration-0's own
23.25+18.00+18.40+18.00+12.75+13.08=103.48 python3 re-check was independently re-verified here and
found to be internally consistent — no arithmetic slip this time, unlike m4's iteration-0→
iteration-1 correction precedent). This is itself worth noting for the experiment's own base-rate
tracking: this is the first M08-class milestone where iteration-1's re-derivation did NOT catch an
arithmetic error in iteration-0's numbers, only extended them with new evidence (the Docker
audit-channel closure) iteration-0 had explicitly deferred to iteration-1's own scope.

VT curve (append, chart-1 basis): `[ ..., (m4/M04-discover, 94.73/120), (m8/M08-merge-recover,
103.73/120, Δv=+9.00, CAPABILITY RECOVERY — CLI/Docs/Packaging surfaces recovered from MD-001's
merge-drift measurement error; iteration-1 independently re-derived every cov number and the total
from fresh command output, catching a small evidence gap (Docker audit-channel gh-caveat) rather
than an arithmetic error) ]`

### Chart-1 re-score (M09-gh-write, Provider-ABI write-completeness) — 2026-07-18 — CONFIRMED (iteration-1)

**CONFIRMED — independently re-derived from scratch by iteration-1** (fresh worktree
`exp5-m09-iteration-1`, based on the same `75a57df` base commit iteration-0 branched from, fresh
`npm install`, iteration-0's commit merged in only AFTER an independent spot-check of its diff;
fresh live command output re-run, not copy-pasted from iteration-0's transcripts — see
`milestones/M09-gh-write/iterations/iteration-1.md` for the full re-verification transcript).
**Iteration-0's cov/VT arithmetic HELD UP under independent re-derivation** — same inputs
(read/write/gate/skill fractions), same cov=12/13=0.9231, same VT total 109.11/120, same
Δv=+5.38, re-derived via a fresh `python3 -c` calculation, not merely re-read from iteration-0's
own text (mirrors M08 iteration-1's own precedent of explicitly stating whether the prior
iteration's math held up). One wording defect WAS found and fixed in this section's own prose
(see arithmetic re-check paragraph below) — a "below" that should have read "above", contradicting
the very next sentence in the same paragraph; not an arithmetic error, a copy-edit slip. Re-scored
Provider-ABI (the only surface this milestone touched) from this milestone's own live
re-verification evidence, per the charter's Done-when clause 7. Cited findings are in
`milestones/M03-abi-eval/capability-matrix.md`'s own re-derivation section and this milestone's
own iteration-0 report (`milestones/M09-gh-write/iterations/iteration-0.md`), which contains the
full live command transcripts (real `gh issue view` before/after against a dedicated scratch
issue `gh-11`, and the real `gh-5`/`gh-7` parent-symmetry re-check) — both independently
re-confirmed live by iteration-1, fresh, against the real `yaleh/quay` repo.

| surface | prior cov (m3, unchanged through m8) | new cov | rationale (this iteration's own live evidence) |
|---|---|---|---|
| Provider-ABI | 0.654 | **0.923** | Re-derived per-capability (capability-matrix.md's own re-derivation table): read 0.90→**1.00** (PR-ABI-002 closed — `github-client.js#get()` now calls the same `fetchAllIssues()`+`buildParentIndex()` pair `list()` already used; live-verified `task_get gh-5 -> parent: "gh-7"`, matching `task_list`); write 0.20→**0.80** (PR-ABI-001 closed for 4 of 5 fields — status/title/body/labels all real writes, live-verified against a dedicated scratch issue `gh-11` with real `gh issue view` before/after transcripts for each field; parent/children write remains explicitly out of this milestone's charter-scoped exclusion, now hard-errors `isError:true` rather than silently no-op'ing — live-verified); gate 1.00 and skill 1.00 unchanged (untouched this milestone). cov = (5+4+2+1)/(5+5+2+1) = 12/13 = **0.9231**. |
| **VT chart-1 total (after m9)** | **103.73/120** | **109.11/120** | CLI 25×0.94=23.50 (unchanged, out of scope); MCP 20×0.90=18.00 (unchanged, out of scope); Web UI 20×0.92=18.40 (unchanged, out of scope); Packaging 20×0.90=18.00 (unchanged, out of scope); Docs 15×0.85=12.75 (unchanged, out of scope); Provider-ABI 20×0.9231=**18.46** (+5.38 vs m8's 13.08). Total = 23.50+18.00+18.40+18.00+12.75+18.46 = **109.11/120** (≈0.909 normalized, up from 0.864 at m8). |

**Arithmetic re-check** (this milestone's own standing convention):
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*12/13)"
109.11153846153847
```
Total confirmed: **≈109.11/120** (109.1115…, rounds to 109.11). Δv = 109.11 − 103.73 = **+5.38** —
**above** the charter's own Δv̂≈+2.9 pre-dispatch estimate scaled to points (charter's own value
hypothesis text computed Δv̂ from a cov delta of 0.654→~0.80, i.e. ≈+2.92 points at weight 20; this
milestone's REALIZED cov (0.923) exceeded that placeholder target (0.80) because BOTH the write
stretch over-performed (4/5 realized vs the charter's conservative "~3/5 realistic" framing) AND
the read-side PR-ABI-002 fix contributed an additional read 0.90→1.00 delta the charter's own
placeholder arithmetic did not separately itemize — so the REALIZED point delta (+5.38) is larger,
not smaller, than the pre-dispatch estimate. This is the opposite direction of a shortfall: the
charter under-estimated by being conservative on scope, and the actual outcome landed better than
predicted. (**Iteration-1 correction**: iteration-0's own draft of this paragraph mistakenly said
"below the charter's own Δv̂≈+2.9 ... estimate" here, directly contradicting its own next two
sentences ("the REALIZED point delta (+5.38) is larger, not smaller" / "the opposite direction of
a shortfall") — a copy-edit slip, not an arithmetic error; the underlying numbers were always
consistent with "above", only this one word was wrong. Fixed by iteration-1's independent
re-derivation pass.) Iteration-1 independently re-derived this arithmetic from scratch (fresh
`python3 -c` run against fresh worktree evidence, see `iterations/iteration-1.md`) per this
experiment's own base-rate discipline (most of the last several milestones' iteration-1 passes
have caught something real) — **the numeric arithmetic itself held up unchanged; the one thing
caught was this wording defect**, now fixed.

VT curve (append, chart-1 basis, CONFIRMED iteration-1 — independently re-derived, arithmetic
held, one wording defect fixed): `[ ..., (m8/M08-merge-recover, 103.73/120),
(m9/M09-gh-write, 109.11/120, Δv=+5.38, CAPABILITY-GROWTH — Provider-ABI write-completeness:
PR-ABI-001 (real title/body/labels write, hard-error floor for the remaining unimplemented
parent/children field) and PR-ABI-002 (get() parent-resolution symmetry fix) both closed;
independently re-derived and confirmed by iteration-1, fresh worktree/fresh command output) ]`

### Chart-1 re-score (M12-abi-parent-write, Provider-ABI write completion) — 2026-07-18 — CONFIRMED

**ABSORB cross-check (outer loop, 2026-07-18).** Both iteration-0 (branch `exp5-m12-iteration-0`,
commit `f172b29`) and iteration-1 (branch `exp5-m12-iteration-1`, commit `6d76cdf`, dispatched from
a fresh worktree based on the pre-charter `9ae3cd3` SELECT commit, instructed NOT to read
iteration-0's report first) independently arrived at the SAME numbers: cov 12/13→13/13, Δv=+1.54,
full bidirectional reassignment achieved by both, no scope narrowing by either. Both branches were
merged into master (`a1f581a` then `47898fe`); the merge conflict across the 5 touched files was
resolved by keeping iteration-1's implementation as canonical (`setChildCheckboxes`/
`writeRelations`), since both implementations were functionally equivalent and independently
live-verified — iteration-0's own report is retained at
`milestones/M12-abi-parent-write/iterations/iteration-0.md` for provenance. Full test suite
re-run on the merged master: 31/31 files pass, 0 failures, including
`provider-abi-conformance.test.mjs` (live GitHub API calls).

**Out-of-band adversarial audit** (per `inherited-core.md`'s Adversarial-audit cadence rule
condition (a) — this milestone is capability-growth-typed with nonzero realized Δv, so the gate
fired for real this time, not re-argued away as it correctly was not required to at m11):
dispatched as a fresh-context `baime:iteration-executor`, explicitly charged to REFUTE rather than
re-verify. Verdict: **CONCERNS** (non-blocking — see
`milestones/M12-abi-parent-write/audits/iteration-1-adversarial-audit.md`, commit `349b005`). No
defect found in the code, the live evidence, or the Δv/cov arithmetic (independently
re-recomputed to 110.65/120, independently re-ran the conformance suite live, independently
queried `gh issue view` and confirmed the transcripts in both iteration reports are genuine, not
fabricated). Three real findings, honestly recorded rather than dismissed: (1) this section and
`capability-matrix.md` were left in an un-finalized "DRAFT" state by the merge — fixed by this
ABSORB pass; (2) `gap-list.md` was missing its PR-ABI-003 closure row despite
`capability-matrix.md`'s text implying it existed — fixed, see `gap-list.md`'s new PR-ABI-003 row;
(3) iteration-1's "independent derivation" framing overstated its independence — it ran strictly
after iteration-0 (committed 15:05:28Z vs. iteration-0's 14:36:52Z) and reused real shared
scratch-issue fixtures (`gh-12`/`gh-13`) iteration-0 had already created and mutated. Git ancestry
itself is clean (no report/code contamination — iteration-1 did not read iteration-0's files), so
the underlying implementation-and-verification IS a genuine second, separately-authored pass, but
the "fresh, isolated" framing should be read as "independently authored" rather than "fully
isolated from all shared state," since GitHub scratch issues are real mutable external state
shared across both worktrees. This is a calibration note for how future iteration-1 dispatches
describe their own independence, not a finding that undermines the shipped result.

Write-semantics decision (charter Done-when 2, stated explicitly, not left implicit): writing
`children: [...]` on task X mutates X's OWN body (add/remove `- [ ] #<n>` lines, preserving `[x]`
state for kept children); writing `parent: <id>` on task X mutates the TARGET parent's body (adds
a checkbox line referencing X) and REMOVES the checkbox line referencing X from every OTHER issue
currently listing X as a child (full bidirectional reassignment, not merely an
add/remove-child-on-one-issue primitive) — see `github-client.js`'s `writeRelations()` header
comment for the full statement. This iteration realized FULL bidirectional reassign-parent
semantics (charter §"Explicit exclusions" narrower-primitive fallback was NOT needed — no scope
had to be narrowed relative to the charter's stated scope item 2).

| capability | fields scored | github realized | fraction |
|---|---|---|---|
| read | status, title, body, labels, parent/children | 5/5 (unchanged since M09-gh-write; PR-ABI-002 symmetry) | 1.00 |
| write | status, title, body, labels, parent/children | **5/5 (M12: parent/children write closed — add/preserve-checked-state/reassign/remove all live-verified against real issues `gh-12`/`gh-13`/`gh-14`)** | **1.00** |
| gate | primitive, compound | 2/2 (unchanged, untouched this milestone) | 1.00 |
| skill | status_skill_map/action_buttons | 1/1 (unchanged, untouched this milestone) | 1.00 |

cov = (5 + 5 + 2 + 1) / (5 + 5 + 2 + 1) = **13 / 13 = 1.0000** — full closure of the Provider-ABI
surface's write dimension, matching the charter's own ceiling arithmetic exactly (§ Value
hypothesis: "closing to 5/5 moves cov from 12/13=0.9231 to 13/13=1.00 ... +1.54 VT points").

| surface | prior cov (m9, unchanged through m11) | new cov | rationale (this iteration's own live evidence) |
|---|---|---|---|
| Provider-ABI | 0.9231 | **1.0000** | write 0.80→**1.00** (parent/children write closed via `github-client.js#writeRelations()`/`setChildCheckboxes()` — cross-issue body-text checkbox mutation, full bidirectional reassignment; live-verified against dedicated scratch issues `gh-12`/`gh-13` (parents) and `gh-14` (child): add (`gh-14`→parent `gh-12`, checkbox appears on `gh-12`'s body), checked-state preservation (re-deriving an unchanged children set on `gh-13` leaves an existing `[x]` line byte-identical), reassignment (`gh-14`→parent `gh-13`, checkbox removed from `gh-12`, added to `gh-13`), and removal (`children: []` on `gh-13` removes the line, role reverts to primitive)); read/gate/skill unchanged (untouched this milestone). cov = (5+5+2+1)/(5+5+2+1) = 13/13 = **1.0000**. |
| **VT chart-1 total (after m12, CONFIRMED)** | **109.11/120** | **110.65/120** | CLI 25×0.94=23.50 (unchanged, out of scope); MCP 20×0.90=18.00 (unchanged, out of scope); Web UI 20×0.92=18.40 (unchanged, out of scope); Packaging 20×0.90=18.00 (unchanged, out of scope); Docs 15×0.85=12.75 (unchanged, out of scope); Provider-ABI 20×1.0000=**20.00** (+1.54 vs m9's 18.46). Total = 23.50+18.00+18.40+18.00+12.75+20.00 = **110.65/120** (≈0.922 normalized, up from 0.909 at m9). |

**Arithmetic re-check** (this milestone's own standing convention):
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*13/13)"
110.65
```
Total confirmed: **≈110.65/120**. Δv = 110.65 − 109.11 = **+1.54** — matches the charter's own
Δv̂ ceiling estimate EXACTLY (§ Value hypothesis: "+1.54 VT points if fully closed"), because this
iteration realized full 5/5 write closure (not a narrower add/remove-only primitive) — the
"actual realized Δv may be smaller ... or larger only up to this ceiling" clause resolved at
its ceiling, not below it.

VT curve (append, chart-1 basis, CONFIRMED — independently derived by BOTH iteration-0 and
iteration-1, out-of-band adversarial audit returned CONCERNS/non-blocking, no code or arithmetic
defect found): `[ ..., (m9/M09-gh-write, 109.11/120), (m12/M12-abi-parent-write, 110.65/120,
Δv=+1.54, CAPABILITY-GROWTH — Provider-ABI write-completeness: parent/children write closed via
checkbox-in-body cross-issue mutation, full bidirectional reassignment, live-verified against real
GitHub scratch issues by both iterations independently; adversarial-audited, CONCERNS verdict
recorded above, non-blocking) ]`

**Adversarial-audit gate — CLOSED (first real trigger since the gate was built at M10).** This
milestone's value hypothesis typed `capability-growth` with a nonzero realized Δv (+1.54), so
`inherited-core.md`'s Adversarial-audit cadence rule condition (a) fired for real this pass —
unlike m11, where the gate was correctly adjudicated as NOT firing (discovery/risk-option-typed,
Δv=0). The outer loop dispatched the audit (see above), it returned CONCERNS (non-blocking), and
its three findings were fixed/recorded as part of this same ABSORB pass rather than deferred.

## Health tracks (§4.2–4.4, §6.1)

| track | current | alarm |
|---|---|---|
| ρ reuse rate | **~0.85** (m5: HARD GATES/worktree-isolation/report-shape/iteration-1-independent-reverify pattern all reused unchanged from m1-m4; new work product is the skill update + anti-drift script + OUTER-LOOP.md wiring, by design) | must-not-fall |
| φ fold-back (confirmed edges) | **3 confirming** (domain-audit-channel≡CI-job pattern CONFIRMED at m3, 2nd different-domain instance; m5's own anti-drift check IS a 3rd instance of the same pattern by charter design [§ it0 check d], but not yet an independently-dispatched-milestone reuse, so not counted as a 4th confirming edge — tracked for m6+) | — |
| charter thickness (tokens) | **~1.8 K** (M01-dist), **~2.1 K** (M02-gates), **~2.0 K** (M03-abi-eval), **~2.0 K** (M04-discover), **~1.9 K** (M05-dir-projection) — all near/over the 2K alarm; gate-block overhead is now the dominant, structural driver across every charter regardless of scope, not milestone-specific dilution | >2 K = dilution |
| discovery latency (mechanizable) | **0** (m1-m5 all — m5's PR-004/PR-005 gap-list findings were logged same-iteration as found, not deferred; PR-005 specifically was iteration-1 catching a bug iteration-0 introduced and shipped in the SAME milestone, zero-latency self-correction) | >~8 iters late |
| calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); m2/m5 no VT Δv̂ (methodology-infra, by design); m3 Δv̂ "≈0 direct" (re-baseline); m4 re-score, no formal Δv̂ (discovery-value framing) | trend must shrink |
| inner-convergence success | **5/5** (m1-m5 each: 2 iterations, Done-when-complete, no mid-milestone re-scope — m5's iteration-1 found and fixed a real bug [`--labels`/`--label` CLI typo] but this counts as convergence-with-correction, not re-scope: same charter, same Done-when, no scope change) | mid-milestone re-scope = fail |
| V_meta consolidation lag | **0 rows past threshold-and-unresolved as of m7-complete.** The `domain-audit-channel≡CI-job` row (confirmed at m3, 3 milestones-since-confirmed by m6, already past K=2) was **resolved by consolidation at m7's own ABSORB** — folded into `inherited-core.md`'s "Domain-misfit audit-channel" section, ledger row status → `consolidated`. This is the gate's first real bite (DIR-005/M07-vmeta-gate Done-when 4): fired on a genuine pre-existing past-threshold case, resolved same-ABSORB rather than carried forward. The ledger's other row (m3's isolation-leak lesson) remains `proposed`, not yet past threshold. Symmetric to the discovery-latency track above: measures milestones-since-confirmed for any ledger row past the φ 2-confirmation threshold but not yet `consolidated`. | **>2 milestones (K=2)** since confirmed-but-not-consolidated |
| Human-review cadence (M15-human-review-cadence, DIR-001 item 6) | **milestones-since-last-human-directive = 3** (as of m15 ABSORB, milestone_counter→15). Last human-initiated directive was DIR-011, arriving at the m12→m13 boundary in the same burst as DIR-009/DIR-010 (this dashboard's own `directives/pending/` log: all three dispositioned at the "DRAIN (m12→m13 boundary)" entry, `pending/` re-drained empty at every boundary since — m13→m14, m14→m15, and m15's own SELECT). Count = milestone_counter(15) − arrival milestone(12) = 3. Recomputed at each ABSORB purely from the drain evidence step 0 already produces — no new instrumentation. Full generalization tally of all 11 directives (arrival boundary / initiation mode / finding kind) recorded in `milestones/M15-human-review-cadence/iterations/iteration-0.md` (iteration-1 independently derived the identical 10/11-human, 1/11-self-raised split but computed the counter as-of-m14/pre-m15-completion = 2; reconciled to 3 at this ABSORB, since m15's own completion is itself a zero-new-directive data point that must be folded in — see the merged doc's outer-loop reconciliation reasoning in this milestone's ABSORB dashboard-log entry). **Explicitly NON-BLOCKING** — observational only, logged at each checkpoint (`OUTER-LOOP.md` step 8); carries no HARD BLOCK language anywhere it appears and must never gate `milestone_counter++`, unlike the V_meta consolidation-lag gate above (deliberate contrast — directives are asynchronous/human-paced by nature, not a mechanically resolvable backlog item). | **soft-alarm only, K=5** milestones since last human directive (recommend a human skim `checkpoints/cp-<NN>.md`; never blocks the loop) |

## Homeostatic variables (DIR-017 Step 3 / M36-dod-leakage-metrics)

Computed from `inherited-core.md`'s "Deviation-record schema" section and its 5 backfilled worked
examples (`DEV-01`..`DEV-05`) — best-effort backfill, NOT exhaustive (see that section's own
limitation note). All 4 metrics below are DIR-017 Step 3's own named metrics, verbatim.

| variable | current value | arithmetic (cited) |
|---|---|---|
| (a) deviations caught by machine vs human | **2 machine : 3 human** (ratio 0.40 : 0.60) | DEV-01 human, DEV-02 machine, DEV-03 human, DEV-04 human, DEV-05 machine → machine={DEV-02,DEV-05}=2, human={DEV-01,DEV-03,DEV-04}=3, of 5 total |
| (b) fraction reaching `verified-eliminated` | **4/5 = 80%** | DEV-01, DEV-02, DEV-03, DEV-05 = `verified-eliminated`; DEV-04 = `fixed` (deliberately NOT promoted — the record explicitly declines to treat the underlying process question as settled, see `inherited-core.md`'s DEV-04 row) |
| (c) median deviation age | **0 milestones** (age-to-resolution, all 5 rows) | age-to-resolution values: DEV-01=0, DEV-02=0, DEV-03=0, DEV-04=0 (found+addressed same milestone, though status stayed `fixed` not `verified-eliminated`), DEV-05=0 → sorted [0,0,0,0,0], median = 0. **Caveat, stated honestly, not hidden**: this is a real number, not a placeholder, but it is a weak signal at N=5 — all 5 backfilled examples happen to be same-ABSORB catch-and-fix cases (partly a selection artifact: the charter's 5 named examples are the well-documented, already-resolved ones; DIR-019's own found-to-fixed-milestone span (DEV-03) is 5 milestones (m25→m30) if measured origin-to-found instead of found-to-resolution — a materially different, non-zero number depending which span the "age" question is really asking about). Future backfill extension (out of this milestone's scope) would sharpen this once more, especially non-same-ABSORB, rows exist. |
| (d) product-value shipped per K milestones (K=5) | **full-stream: ≈3.26 Δv / 5 milestones · recent window (m29-m35): ≈0.64 Δv / 5 milestones** | Full-stream: sum of every genuine, same-chart, non-corrective capability-growth Realized Δv from `dashboard.md`'s own ABSORB log (the same 6 values already used as this stream's "qualifying-milestone slope" in `checkpoints/cp-30.md`/`cp-35.md` — m3's +13.08 and m4's −6.60 are a chart-basis expansion and an explicitly-stated measurement correction respectively, not delivered capability-growth work, and are excluded from the numerator for that reason, exactly as the existing qualifying-milestone convention already excludes them): m1=+6.0, m8=+9.00, m9=+5.38, m12=+1.54, m29=+0.50, m33=+0.40 → total = 6.0+9.00+5.38+1.54+0.50+0.40 = **22.82**. Denominator: **all 35** milestones absorbed so far (m1-m35) — reusing this stream's own already-established "qualifying rate 6/35" denominator convention (`checkpoints/cp-35.md`'s VT-trajectory section), since the question this metric answers ("how much value ships per K milestones of loop execution") is about the pace of the whole stream, not just the subset of milestones eligible to register a qualifying Δv → 22.82/35×5 ≈ **3.257**. Recent window (last 7 ABSORBed milestones, m29-m35, chosen because it is the DIR-017-program-era window, post the Clause 6/7/escrow-Δv-aware discipline): m29=+0.50, m30=0, m31=0, m32=0, m33=+0.40, m34=0, m35=0 → total = **0.90** over 7 milestones → 0.90/7×5 ≈ **0.643**. Both figures reported (not just one cherry-picked) because they answer different questions — full-stream shows the whole stream's average rate (front-loaded by m1/m8/m9/m12's early capability-growth milestones), recent-window shows the CURRENT rate under the now-mature DoD-governed regime (which has deliberately run mostly method-infra/governance milestones since m13, consistent with `inherited-core.md`'s explore-cadence floor, not a value-shipping slowdown). |

**Forward-update responsibility**: see `inherited-core.md`'s "Forward-update responsibility" subsection
(under the Deviation-record schema section) — the Clause-1 per-milestone acceptance-audit subagent is
the standing writer of new/updated deviation rows (and, by extension, this table's 4 derived numbers),
at its existing `OUTER-LOOP.md` step-6 dispatch point, not a new separately-scheduled process.

## Control limits (pre-declared; §6/§6.1)
- inner budget = 10 (past → default HALT, continue needs authorization)
- ΔV plateau <0.02 both layers, K=2 consecutive → stop
- gate-hash: any non-verbatim gate → block (0 tolerance)
- discovery-latency alarm: mechanizable-channel discovery >~8 iters late
- explore cadence: ≥1 explore milestone per 5

## Log
## M73 SELECT — exp5-M-CRYST-B4

**Selected:** exp5-M-CRYST-B4 — B4 Migrate existing tasks to canonical schema (or forward-only + validator flags legacy)

**Rationale:** Only remaining non-human-steered milestone candidate. B4 is a close-out verification: the forward-only grandfather approach is already implemented (all tasks report PASS or EXPLICIT N/A-legacy; 0 FAILs; checkNoScaffolding passes on all schema-marked tasks). The milestone verifies the sweep output, formally documents the grandfather decision, and ticks the task closed. LOOP-EXECUTABLE.

**Deferred:** D2, F1 (human-steered).

---
## M73 ABSORB — exp5-M-CRYST-B4

**Milestone:** M73 · **Task:** exp5-M-CRYST-B4 · **Status:** done  
**Commit:** (M73 MERGE) · **Type:** crystallization/administrative · **VT Δ:** 0

### What landed
- `tasks/exp5-M-CRYST-B4.md`: forward-only grandfather formally adopted; Resolution section documents decision + full 54-line PASS sweep output (each with "schema v1 conformant" verdict proving A1-A7 including A6 checkNoScaffolding); all 4 AC/DoD boxes ticked [x]
- Sweep result: 291 total, 54 PASS (schema v1), 237 N/A-legacy-explicit, 0 FAIL — board schema-consistent; no retroactive migration of 200+ legacy done/archived tasks
- B3 wiring ensures all future SELECTed tasks carry `schema: v1` at dispatch time (forward-only self-heals)

### Audit: initial REFUTATION FOUND → outer-loop fix applied → NO REFUTATION FOUND
Initial build: Resolution section contained only summary footer ("291 total, 54 pass, 237 N/A-legacy, 0 fail") without granular per-file PASS lines. Auditor: a forensic reviewer cannot independently verify A6 (checkNoScaffolding) from a summary alone — each PASS line must show "schema v1 conformant" to prove the 7-assertion chain ran per task. Fix: outer loop pasted full 54-line PASS output into Resolution section. Post-fix audit: NO REFUTATION FOUND.

| ID | Title | Type | VT Δ |
|---|---|---|---|
| exp5-M-CRYST-B4 | B4 task schema forward-only grandfather close-out | crystallization/administrative | 0 |


---
## M74 ABSORB — DIR-044 concurrent-scheduler MECHANISM (dedicated D3 dispatch)

**Milestone:** M74 · **Task:** [[DIR-044]] (mechanism) · **Status:** done (mechanism); DIR-044 directive PARTIAL — live-run split to [[DIR-044-LIVE]]  
**Charter:** `charters/M74-dir044-concurrent-scheduler.md` · **Type:** capability-growth + governance-integrity · **VT Δ:** 0 (method-infra, no VT cell)  
**Dispatch:** human-directed, off-loop in the `.halt` window (loop paused at M73→M74 boundary); every increment landed via private worktree + ff-merge (DIR-027). `milestone_counter` untouched until this ABSORB.  
**Commits:** 38c0933 (inc1), e12a736 (inc2), 6cb65a6 (inc3), 57941c9 (inc4), 8d8911e (inc5), 5879517 + b8b94c5 (audit hardening).

### What landed (the DIR-044 mechanism, 5 increments, TDD)
- `touches-orthogonality-check.mjs` — disjoint/overlap verdict; CONSERVATIVE fail-closed (absent/overbroad/typo → serialize). Single-source `matchGlob`/`normalizePath`/`isOverbroadDeclaration`/`checkTouchesPair`.
- `concurrent-batch-scheduler.mjs` — greedy maximal disjoint EXECUTION batch; excludes shared-state-touching + learning-type candidates; computes the dispatch PLAN (native-only, spawns no agents itself, no manda).
- `serial-fanin-absorb.mjs` — deterministic id-sorted fan-in (background builds finish in nondeterministic order → reproducible plan); counter +N, deterministic dashboard append.
- `anti-drift-touches-check.mjs` — NON-WAIVABLE after-the-fact HARD guardrail; bites a mis-declared/overbroad/stray-write batch.
- `golden-replay-dir044.mjs` — replays the RECORDED real pair DIR-039 (M62) ∥ DIR-042-A (M59) through the whole pipeline → reproduces the frozen serial oracle (counter +2, both entries, disjoint, no drift). Exit 0.
- **78 DIR-044 tests, 7/7 selfchecks, 92–98% line coverage; full exp5 suite 232/232 green.**

### Audit (charter Step 5 — fresh-context, 3 rounds)
Round 1: CONFIRMED golden-replay (disjointness independently re-derived from git `7ca6043`/`3e7556b`; `comm -12` empty; fixtures byte-faithful) but REFUTED the guardrail's airtightness — **H3**: an overbroad-but-legal glob (`packages/**`) defeated the out-of-declared arm with no dishonest input. Round-1 syntactic fix was re-broken in round 2 (`packages/**/*`, `**/*.js`, …); replaced with a SEMANTIC anchoring-depth rule + canonical path normalization. **Round 3: H3 CLOSED, H1 CLOSED, no new refutation, no false-positive.** (Exactly the multi-round D3 hardening the vmeta-lag-check lineage records.)

### Honest disposition (DoD item 1 NOT met — split, not fabricated)
The mechanism is proved on the RECORDED diffs only. No LIVE `Agent(run_in_background)` ≥2-wide batch was dispatched (the scheduler computes the plan; live dispatch is the driver's job). DoD item 1 ("a REAL ≥2-wide batch actually RAN via native background subagents on exp5's own loop") is therefore UNCHECKED and split to the follow-on [[DIR-044-LIVE]] — it needs two real ready disjoint milestone-candidates + the driver wired to dispatch from the plan, occurring on first real use. **The DIR-044 directive is NOT fully drained; it0 Clause 0 would correctly flag the open box.** M74 delivered and audited the complete mechanism; the directive completes when DIR-044-LIVE lands.

**Side-fix this window (unrelated to DIR-044):** `bf0a492` repaired a pre-existing red test (`task-schema.test.mjs` "conformant directive → PASS") the loop's own M69/B6 shipped stale when it added the A7 validator; exp5 suite now fully green.

| ID | Title | Type | VT Δ |
|---|---|---|---|
| DIR-044 (mechanism) | Cross-milestone concurrent-scheduler mechanism (touches/batch/fan-in/anti-drift + golden-replay) | capability-growth/governance-integrity | 0 |


---
## M75 + M76 FAN-IN ABSORB — DIR-044-LIVE (first REAL ≥2-wide concurrent batch)

**Milestones:** M75 ∥ M76 (concurrent) · **counter 74 → 76** · **Task:** [[DIR-044-LIVE]] (closes [[DIR-044]] DoD item 1) · **Type:** capability-proof + product (real test coverage) · **VT Δ:** 0

**This is the live end-to-end proof the M74 mechanism was golden-replayed against but never actually ran.** Two disjoint execution milestone-candidates were dispatched as REAL native background subagents (`Agent(run_in_background=true)`), each in its own worktree, then serial-fan-in ABSORBed — no driver rewrite, human-orchestrated in the `.halt` window.

### Pre-flight (mechanism, M74)
- `touches-orthogonality-check` on the two tasks → **DISJOINT** (exit 0).
- `concurrent-batch-scheduler` → **2-wide batch** [M75, M76].

### Concurrent builds (real background subagents, each gated offline)
- **M75** exp5-M-LIVE-A (worktree `quay-live-A`, branch `live/M75-native-testcov`, commit `0fbe6a2`): new `packages/quay-native/test/live-a-longform-headings.test.mjs` — pins `createStore().check()` long-form heading alias resolution (`## Acceptance Criteria`/`## Definition of Done` via `extractSection`), a real coverage gap. `node --test` → 2/2 pass offline. Scope: only `packages/quay-native/test/**`.
- **M76** exp5-M-LIVE-B (worktree `quay-live-B`, branch `live/M76-core-testcov`, commit `eb432b7`): new `packages/quay/test/live-b-provider-env.test.mjs` — direct per-branch coverage for the pure `resolveProviderEnv` (QN-045) never unit-tested before. `node --test` → 7/7 pass offline. Scope: only `packages/quay/test/**`.

### Serial fan-in (the deferred shared-state writes)
- `serial-fanin-absorb --counter 74` → plan: counter 74→76, deterministic id-sorted order M75→M76.
- Merges: M75 ff → `0fbe6a2`; M76 conflict-free real merge → `4d87291`. **NO merge conflict.**
- `anti-drift-touches-check` on the ACTUAL post-build diffs → **ANTI-DRIFT OK** (no out-of-declared write, no cross-build overlap — the two real diffs stayed exactly within their declared `## Touches`).
- Behavior-preserving: both new tests green on merged master (9/9 combined); shared exp5 state untouched by either build (only this fan-in wrote counter/dashboard).

### Outcome
DIR-044-LIVE DoD satisfied on exp5's OWN repo: a real ≥2-wide batch ran via native background subagents, fan-in ABSORBed cleanly (counter +2, both entries, no conflict), anti-drift PASS on real diffs. **[[DIR-044]] is now fully done** — the mechanism (M74) + the live proof (M75∥M76) both landed.

| ID | Title | Type | VT Δ |
|---|---|---|---|
| exp5-M-LIVE-A | offline test: quay-native long-form heading gate resolution | product/test-coverage | 0 |
| exp5-M-LIVE-B | offline test: quay Core resolveProviderEnv | product/test-coverage | 0 |

---

## M77 ABSORB — exp5-M-TS-MIGRATION-P1 (TS migration P1: provider-client.js → .ts)

**Milestone:** M77 · **counter 76 → 77** · **Task:** [[exp5-M-TS-MIGRATION-P1]] · **Type:** capability-growth (L_C hardening) + governance-integrity (ADR-012) · **VT Δ:** 0

**Charter:** `charters/M77-ts-migration-p1.md` (amended 2026-07-21 to include caller import extension updates)  
**Worktree:** `milestones/M77/worktrees/iteration-0` (branch `exp5-m77-iteration-0`, commit `a630814`)  
**Merge:** `9ca2b0a` (2026-07-21)

### Iteration summary

**iteration-0 scope-discovery** (first pass): TypeScript Bundler moduleResolution `.js`→`.ts` fallback is compile-time only; Node.js runtime requires exact extension. Result: needs-human initially, then charter amended (in-project fix, not external blocker).

**iteration-0 retry** (successful):
- `packages/quay/src/provider-client.js` → `provider-client.ts` with named interfaces `ConnectProviderOptions` (parameter) + `ProviderClient` (return); no `@ts-nocheck`; no `any` on public signature
- 4 caller import extensions updated `.js`→`.ts` (3 named in charter + `test/task-check.test.mjs` discovered during execution)
- `npx tsc --noEmit` → exit 0; test suite 342/338/4 (exact master baseline)

### Gate dispositions

- **adversarial-audit:** NO REFUTATION FOUND — agent `a6ec1c7e707f2bf90` (distinct from orchestrator `a653b2e9`). All 5 Done-when confirmed from raw output.
- **V_meta consolidation-lag (--counter 76):** PASS — no rows past threshold; V_meta consolidation-lag: clear.
- **impl-row gate:** PASS — not design-only.
- **quay gate exp5-M-TS-MIGRATION-P1:** PASS (GateEvent `b75db8be`, 2026-07-21T17:21:20Z)
- **Merge:** clean, no conflicts. Reconciliation note: only 5 package files changed in branch (provider-client.ts + 4 import fixes); milestone evidence files (iteration-0.md, audit) committed separately to master.

### Adaptation log

Scope-sizing lesson: TS migration milestones must enumerate ALL importers of the ported module, not just non-test callers. Charter listed 3 callers; 4 existed. Future charters: run `grep -r "provider-client.js"` before scope declaration.

| ID | Title | Type | VT Δ |
|---|---|---|---|
| exp5-M-TS-MIGRATION-P1 | TS migration P1: provider-client.js → .ts (ADR-012 L_C hardening) | capability-growth / governance-integrity | 0 |

## SELECT M78 — DIR-054 dashboard context-budget discipline

**Selected:** DIR-054 — dashboard.md context-budget discipline (rolling-window cut + line-budget gate + ABSORB summary-row format)

**Rationale:** Explore pick (method-infra). M73–M77 were all exploit-typed (6 consecutive); the ≥1 explore per 5 rule requires an explore at M78. DIR-054 is the highest-urgency explore candidate: `dashboard.md` is 6505 lines / ~545 KB, with 94% dead narrative — a direct per-iteration context tax that worsens with every milestone, and the same pathology exp5 retired from exp3's `provenance.md`. The fix is bounded, loop-executable, and makes the constraint mechanical (runnable gate) rather than prose.

**Deferred:** DIR-056 (probe-spec formalization, prerequisite for DIR-055/052/053 standing routines); exp5-M-TS-MIGRATION-P2 (TS migration next phase); DIR-050 (config consolidation) — all remain strong candidates but none has DIR-054's operational urgency.

**Task:** [[DIR-054]] (`tasks/DIR-054.md`) — dashboard.md context-budget discipline  
**Charter:** `experiments/quay-perpetual-stream/charters/M78-dir054-dashboard-line-budget.md`

m78 · DIR-054 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=b4c0a1a · → milestones/M78/


## SELECT M79 — exp5-M-TS-MIGRATION-P2

**Selected:** exp5-M-TS-MIGRATION-P2 — TS migration P2: Provider ABI view-model TypeScript interfaces

**Rationale:** Exploit pick. M78 was explore (dashboard budget gate); M79 can be exploit per the ≥1-in-5 rule. TS-P2 is the highest-value continuation: the Provider ABI contract (`{id, title, status, role, labels, parent/children, body}`) gains compile-time TypeScript types, hardening the exact architectural seam around which all three packages are organised. Bounded scope (1 new `abi.ts` + update to `provider-client.ts`), autonomous per parent's cleared human-steered gate (2026-07-21), behavior-preserving by construction (TS is JS superset; tsc --noEmit gate).

**Deferred:** DIR-056 (probe-spec formalization), DIR-050 (config consolidation), DIR-052/053/055 (standing routines).

**Task:** [[exp5-M-TS-MIGRATION-P2]] (`tasks/exp5-M-TS-MIGRATION-P2.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M79-ts-migration-p2.md`


m79 · exp5-M-TS-MIGRATION-P2 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=b74aa2e · → milestones/M79/


## SELECT M80 — exp5-M-TS-MIGRATION-P3-A

**Selected:** exp5-M-TS-MIGRATION-P3-A — TS migration P3-A: port quay-native src/ to TypeScript

**Rationale:** Exploit pick. P3 was split per DIR-026 SPLIT-OR-COMMIT into three per-package children (P3-A: quay-native, P3-B: quay Core, P3-C: quay-github). P3-A is selected first: most self-contained (3 files, ~1013 lines, no dependencies on other packages' ports), highest confidence in a clean iteration-0. Removes `@ts-nocheck` from `store.js` and `mcp-server.js`, adds named types using `Task`/`AdrRecord`/`Manifest` from `abi.ts` (M79). Behavior-preserving by construction; golden-diff discipline; autonomous per parent's cleared human-steered gate.

**Deferred:** P3-B (quay Core internals), P3-C (quay-github), DIR-056 (probe-spec), DIR-050 (config consolidation).

**Task:** [[exp5-M-TS-MIGRATION-P3-A]] (`tasks/exp5-M-TS-MIGRATION-P3-A.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M80-ts-migration-p3a.md`

m80 · exp5-M-TS-MIGRATION-P3-A · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=0864f89 · → milestones/M80/


## SELECT M81 — exp5-M-TS-MIGRATION-P3-C

**Selected:** exp5-M-TS-MIGRATION-P3-C — TS migration P3-C: port quay-github src/ to TypeScript

**Rationale:** Exploit pick. Continuation of ADR-012 P3 program. P3-C (quay-github, 3 files, 1254 lines) is the natural next step after P3-A (quay-native, M80). P3-B (quay Core, 19 files, ~2837 lines) is explicitly deferred — too large for one milestone, needs further per-module splitting. P3-C is bounded, similar scope to P3-A, and removes `@ts-nocheck` from `github-client.js` + `mcp-server.js`, wiring `Task` from `abi.ts` into the GitHub → view-model mapping.

**Deferred:** P3-B (quay Core internals — needs per-module split at SELECT), DIR-056, DIR-050.

**Task:** [[exp5-M-TS-MIGRATION-P3-C]] (`tasks/exp5-M-TS-MIGRATION-P3-C.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M81-ts-migration-p3c.md`

m81 · exp5-M-TS-MIGRATION-P3-C · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=c648f11 · → milestones/M81/


## SELECT M82 — exp5-M-TS-MIGRATION-P3-B-1

**Selected:** exp5-M-TS-MIGRATION-P3-B-1 — TS migration P3-B-1: quay Core utility modules (10 small files)

**Rationale:** Exploit pick. P3-B was split at SELECT per DIR-026 into 3 children: P3-B-1 (10 small utility files, ~965L), P3-B-2 (gate/ dir, ~1316L), P3-B-3 (serve+mcp, ~1872L). P3-B-1 selected first — all files <200 lines, lowest tsc error risk, clears the path for the larger files in P3-B-2/3. Maintains TS migration momentum through the Core package after P3-A/P3-C.

**Deferred:** P3-B-2 (gate/), P3-B-3 (serve+mcp), P4 (method-infra scripts), DIR-056, DIR-050.

**Task:** [[exp5-M-TS-MIGRATION-P3-B-1]] (`tasks/exp5-M-TS-MIGRATION-P3-B-1.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M82-ts-migration-p3b1.md`

m82 · exp5-M-TS-MIGRATION-P3-B-1 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=4e70d8c · → milestones/M82/

## SELECT M83 — exp5-M-ARCH-AUDIT-POST-TS-P3

**Selected:** exp5-M-ARCH-AUDIT-POST-TS-P3 — Architecture health audit post-TS-P3 migration (archguard L_D/L_G)

**Rationale:** Explore pick (mandatory: M79-M82 were 4 consecutive exploits; ≥1-in-5 rule requires explore at M83). After 5 TS migration milestones, the codebase has substantial TS coverage for the first time — this is the first opportunity to run archguard's L_D/L_G lens on the real typed surface (ADR-007 obligation). Findings will map remaining P3-B-2/B-3 risks and file blocking issues if any.

**Deferred:** P3-B-2 (gate/), P3-B-3 (serve+mcp), P4 (method-infra), DIR-050, DIR-056.

**Task:** [[exp5-M-ARCH-AUDIT-POST-TS-P3]] (`tasks/exp5-M-ARCH-AUDIT-POST-TS-P3.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M83-arch-audit-post-ts-p3.md`

m83 · exp5-M-ARCH-AUDIT-POST-TS-P3 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=f4b9780 · → milestones/M83/

## SELECT M84 — exp5-M-TS-MIGRATION-P3-B-2

**Selected:** exp5-M-TS-MIGRATION-P3-B-2 — TS migration P3-B-2: quay Core gate/ subdirectory (7 files, 1316 lines)

**Rationale:** Exploit pick. M83 archguard audit confirmed: no cycles in gate/, all external imports are stdlib+yaml+already-migrated TS; registry.js is MEDIUM risk (696L) but manageable. mcp-server.js (P3-B-3) imports 3 gate/ files — P3-B-2 must precede P3-B-3. Natural continuation of TS migration momentum.

**Deferred:** P3-B-3 (serve+mcp), P4 (method-infra), DIR-050, DIR-056.

**Task:** [[exp5-M-TS-MIGRATION-P3-B-2]] (`tasks/exp5-M-TS-MIGRATION-P3-B-2.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M84-ts-migration-p3b2.md`

m84 · exp5-M-TS-MIGRATION-P3-B-2 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=3a4d029 · → milestones/M84/

## SELECT M85 — exp5-M-TS-MIGRATION-P3-B-3

**Selected:** exp5-M-TS-MIGRATION-P3-B-3 — TS migration P3-B-3: serve.js + mcp-server.js (2 files, 1872 lines)

**Rationale:** Exploit pick. P3-B-2 (gate/) landed in M84 — mcp-server.js's 3 gate/ dependencies are now .ts. This is the final child of P3-B; completing it closes out Core src/ TS migration (only bin/quay.js entry remains). M83 audit: serve.js=LOW risk (3 TS imports + stdlib); mcp-server.js=MEDIUM (MCP SDK + zod types, all well-defined).

**Deferred:** P4 (method-infra scripts), DIR-050, DIR-056.

**Task:** [[exp5-M-TS-MIGRATION-P3-B-3]] (`tasks/exp5-M-TS-MIGRATION-P3-B-3.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M85-ts-migration-p3b3.md`

m85 · exp5-M-TS-MIGRATION-P3-B-3 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=9a2c49e · → milestones/M85/

## SELECT M86 — DIR-056

**Selected:** DIR-056 — probe-spec formalization: replace `dispatch:` magic-string in routines with portable probe specs (`instrument`/`fallback`/`output_routing` + objective body), decoupling WHAT from HOW in the routine track.

**Rationale:** Exploit pick. ADR-012 TS migration closed at M85 (all packages/*/src/ done). DIR-056 is the highest-value next exploit: unlocks the standing routine track by formalizing the probe-spec abstraction that DIR-052/053/055 require. Without it, adding a new routine requires a skill edit; with it, adding a probe = dropping a spec file + a loop.yml line. Bounded scope (routine-scheduler + routine-file-gate + loop-params + new probe specs + vendor sync), LOOP-EXECUTABLE.

**Deferred:** P4 (TS migration method-infra scripts — 5235 lines, needs split at SELECT; deferred to post-M86 when split-or-commit creates children), DIR-050 (config consolidation), CRYST-D3 (human-steered).

**Task:** [[DIR-056]] (`tasks/DIR-056.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M86-dir056-probe-spec.md`

m86 · DIR-056 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=5be0d06 · → milestones/M86/

## SELECT M87 — DIR-050

**Selected:** DIR-050 — consolidate per-workspace `.quay/` config surface: fold `config.yml` + `gates.yml` + `loop.yml` into ONE `.quay/config.yml` with `providers`/`gates`/`loop` sections; retire `coexist` dead param.

**Rationale:** Exploit pick. M86 completed the probe-spec formalization; M87 continues method-infra cleanup. DIR-050 removes cross-file config indirection (loop.yml.board references config.yml.providers; loop.yml.gates references gates.yml), gives each workspace a single source of truth, and retires `coexist` (speculative generality with no live scenario — YAGNI/ADR-004). Mechanical, LOOP-EXECUTABLE, backward-compatible reader preserves legacy 3-file workspaces.

**Deferred:** DIR-052 (real self-validation routine fire), DIR-053 (arch-analysis routine fire), DIR-055 (meta-cc mining routine). P4 (TS migration method-infra, 5235L — split-or-commit needed).

**Task:** [[DIR-050]] (`tasks/DIR-050.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M87-dir050-config-consolidation.md`

m87 · DIR-050 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=8a4fb85 · → milestones/M87/

## SELECT M88 — exp5-M-HISTORY-MINING-EXPLORE

**Selected:** exp5-M-HISTORY-MINING-EXPLORE — meta-cc session-history mining exploration: surface hidden defects, ADR candidates, and crystallizable patterns from exp5 Claude Code session history (M88 mandatory explore; first use of history-mining.md probe concept).

**Rationale:** Explore pick (mandatory: M84–M87 were four consecutive exploits; ≥1-in-5 rule requires explore at M88). The process/provenance axis — what recurred, what was learned, what drifted — is currently dark. Every high-value correction in exp5 has come from ad-hoc human meta-cc runs. This milestone mines the session history systematically using the REFUTE-first history-mining.md probe concept shipped in M86 (DIR-056). Not DIR-055 (standing routine): this is a one-time manual exploration that validates the concept and fills the dark axis.

**Deferred:** DIR-052 (real self-validation routine fire), DIR-053 (arch-analysis routine fire), DIR-055 (meta-cc mining standing routine). P4 (TS migration method-infra, 5235L — split-or-commit needed).

**Task:** [[exp5-M-HISTORY-MINING-EXPLORE]] (`tasks/exp5-M-HISTORY-MINING-EXPLORE.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M88-history-mining-explore.md`

m88 · exp5-M-HISTORY-MINING-EXPLORE · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=3f196ca · → milestones/M88/

## SELECT M89 — exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH

**Selected:** exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH — fix YAML frontmatter colon crash: a single task with `: ` in a frontmatter value crashes `task_list` for the entire task store; add post-write YAML validation to `quay-native` task write path.

**Rationale:** Exploit pick. Production-safety defect surfaced by M88 history-mining: unquoted colon in frontmatter value (`routines: run` substring in `dirStatus`) blocks the loop from reading its own task board at session start. One corrupted task takes down the whole board. No existing validation gate prevents this. Fix is bounded (~80L) and urgent.

**Deferred:** exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP (process fix, lower urgency than board crash), DIR-052 (routine fire, real-fire DoD needed), DIR-055 (standing routine). P4 (TS migration method-infra, 5235L — split needed).

**Task:** [[exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH]] (`tasks/exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M89-yaml-frontmatter-crash.md`

m89 · exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH · Δv=0 (v̂=0) · audit=CONCERNS · merge=a1759b3 · → milestones/M89/

## SELECT M90 — exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP

**Selected:** exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP — fix ABSORB dispatch-record documentation gap: `OUTER-LOOP.md` step 6 lacks explicit guidance for creating the dispatch-record file and populating `Dispatch record:` in the `## Audit-independence check` section, causing recurring clause12 failures (4× in M82, manually worked-around in M88/M89).

**Rationale:** Exploit pick. Governance-integrity / instrument-correction defect with direct recurring operational impact. Fix is a targeted ~20-line text addition to OUTER-LOOP.md step 6 "Ordering + disposition authoring" — no gate logic changes. Bounded scope, no external dependency. M90 = 90 % 5 == 0 → CHECKPOINT due after ABSORB.

**Deferred:** DIR-052/053/055 (real routine-fire DoD unmet), exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS, P4 (TS migration method-infra, 5235L — split needed).

**Task:** [[exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP]] (`tasks/exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md`

m90 · exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP · Δv=0 (v̂=0) · audit=CONCERNS · merge=5068913 · → milestones/M90/

## SELECT M91 — exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS

**Selected:** exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS — fix QC-T1 healthcheck fixture: task absent from store + OUTER-LOOP.md has no explicit session-start healthcheck step; error silently swallowed 3× in session `e0fb1192` (2026-07-20).

**Rationale:** Exploit pick (4th post-M88 explore reset; next mandatory explore M93). Governance-integrity defect: a broken native task store liveness probe is indistinguishable from a passing one when the error is swallowed. Fix: add QC-T1 healthcheck step to OUTER-LOOP.md session-start (idempotent re-create on missing) + re-create `tasks/QC-T1.md` fixture. Bounded scope (~25L), no external dependency.

**Deferred:** DIR-052/053/055 (real routine-fire DoD blocked), exp5-M-TS-MIGRATION-P4 (5235L — split needed).

**Task:** [[exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS]] (`tasks/exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M91-qc-t1-fixture-probe.md`

m91 · exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=8418004 · → milestones/M91/

## SELECT M92 — exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED

**Selected:** exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED — wire loop-driver SKILL to consume probe specs (`routines[].probe:` → `readProbeSpec` → `output_routing`); DIR-056 marked done (M86) with core SKILL wiring absent; probe spec files inert (grep → 0).

**Rationale:** Exploit pick (5th post-M88 explore reset; next mandatory explore M93). Development-class defect: probe-spec form is a no-op in production — the three shipped specs (self-validation, architecture-analysis, history-mining) have zero execution path. Wiring unlocks DIR-055 (meta-cc mining, blocked on output_routing) and DIR-052/053 (routine migration). Requires `quay-task-to-plan` pipeline before dispatch per OUTER-LOOP.md step 5a.

**Deferred:** DIR-052/053/055 (all blocked on this wiring — resolved by M92), exp5-M-TS-MIGRATION-P4 (5235L — split-or-commit required).

**Task:** [[exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED]] (`tasks/exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M92-dir056-probe-spec-wiring.md`

m92 · exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=73fbd44 · → milestones/M92/

## SELECT M93 — exp5-M-ARCH-AUDIT-M93-EXPLORE

**Selected:** exp5-M-ARCH-AUDIT-M93-EXPLORE — archguard architecture audit of post-TypeScript-migration codebase; last audit was M83; significant structural changes since then (M84-M92). Explore class: discovers unknown structural defects, does NOT fix them.

**Rationale:** MANDATORY EXPLORE (5th exploit since M88 explore — M89/M90/M91/M92 were all exploits; M93 resets the explore counter). Archguard probe (`instrument: archguard`) now wired via M92 SKILL update; audit covers packages/quay, packages/quay-native, packages/quay-github post-TS-migration. Methodology-class — no quay-task-to-plan required; dispatch directly.

**Deferred:** PROBE-SV-M92-001 (acceptance gate --cwd bug — exploit, M94+), DIR-055 (meta-cc mining — development-class exploit, M94+).

**Task:** [[exp5-M-ARCH-AUDIT-M93-EXPLORE]] (`tasks/exp5-M-ARCH-AUDIT-M93-EXPLORE.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M93-arch-audit-explore.md`

m93 · exp5-M-ARCH-AUDIT-M93-EXPLORE · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=6096cc6 · → milestones/M93/

## SELECT M94 — PROBE-SV-M92-001

**Selected:** PROBE-SV-M92-001 — fix acceptance gate cwd threading: `packages/quay/src/gate/registry.ts` calls `resolveRunnerOptions()` with no `gateConfig`, so `--cwd <worktree>` is silently ignored; gate always runs acceptance command in `process.cwd()`, not the worktree (DIR-046 regression, filed by self-validation probe at M92).

**Rationale:** Exploit pick (1st post-M93 explore reset; next mandatory explore by M98). Bounded defect with direct impact on the loop's own acceptance gate correctness — every `quay gate <task> --cwd <worktree>` silently uses the wrong directory. PROBE-SV-M92-001 is already `milestone-candidate` + `defect`, backed by concrete archguard/code evidence, with real FILE-ONLY confirmation from M92. ARCH-M93-001..004 are also candidates; ARCH-M93-004 (ABI violation) is the next cleanest post-M94 pick (bounded: single `createAdrStore` cross-boundary import).

**Deferred:** ARCH-M93-001 (gate/ god-package, fanOut=62 — large refactor, not M94), ARCH-M93-002 (startMcpServer god-function — scope/split needed), ARCH-M93-003 (startServer god-function — 675L scope), ARCH-M93-004 (ABI boundary violation — M95+ pick), DIR-055 (meta-cc mining standing routine).

**Task:** [[PROBE-SV-M92-001]] (`tasks/PROBE-SV-M92-001.md`)  
**Charter:** `experiments/quay-perpetual-stream/charters/M94-acceptance-gate-cwd-fix.md`

m94 · PROBE-SV-M92-001 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=HEAD · → milestones/M94/
