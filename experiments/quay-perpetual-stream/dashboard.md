# Dashboard — quay-perpetual-stream (Experiment 5)

**state: RUNNING**
**milestone_counter: 9** · **chart: 1** · **checkpoint cadence: every 5 milestones (non-blocking)**
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

### Chart-1 re-score (M04-discover, exploit-channel 4-persona pass) — 2026-07-18

Re-scored the 5 chart-0 surfaces (Provider-ABI is M03-abi-eval's scope, unchanged here) from this
milestone's own live persona-pass findings, per the charter's Done-when clause 2. Cited findings are
in `experiments/quay-continuous-bootstrap/gap-list.md` (MD-001, CB-006/021/022, UQ-047/048/049/050,
PKG-003/004/005/006/007/008, DOC-006/007) and the M04-discover iteration-0 report.

| surface | prior cov | new cov | rationale |
|---|---|---|---|
| CLI | 0.95 | **0.80** | MD-001's merge-drift is CLI-surface-heaviest: `--version`/`-V` (UQ-047), `--page-size` in all 3 modes (CB-006/CB-022), and `--format json` alias (CB-021) are ALL live-confirmed absent/broken on master despite gap-list.md having asserted them closed since exp4 iterations 13-17. Core subcommands (`task list/view/edit/check`, `action list/run`, `serve`, `mcp`) all work correctly on both the `.tgz`/node path AND the SEA executable path (byte-identical `--help`, live-verified) — the drop is bounded to the 4 specific reopened capabilities, not a broad regression. 0.95→0.80 reflects 4 real capability losses on a ~20-capability-wide surface, not a catastrophic surface failure. |
| MCP | 0.90 | **0.90** | Live stdio-client persona pass (real `@modelcontextprotocol/sdk` `Client`+`StdioClientTransport`, not test mocking) exercised `tools/list`, `task_list`, `task_get`, `task_write`, `task_check`, `resources/list` end-to-end — all 6 clean, no new gaps found. MCP surface is unaffected by MD-001 (the drifted commits were CLI/Web UI/docs-only; `mcp-server.js` was not among the files touched by the unmerged commits). Unchanged. |
| Web UI | 0.95 | **0.92** | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (`?search=` URL param silently no-ops; real param is `q` — a real discoverability trap for anyone constructing URLs by the visible field's `name` attribute) and UQ-050 (mobile title-text CSS overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. |
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
- **ABSORB m4 = M04-discover → DONE** 2026-07-18. Merged `exp5-m04-iteration-1` → `master`
  (`--no-ff`; 1 real content conflict in `backlog.md` — both this iteration's DIR-002-sourced
  section and iteration-1's own M04-discover-sourced section were appended at the same location;
  resolved by keeping both sections concatenated, no semantic loss). milestone_counter → 4 (next
  milestone, m5, hits the 5-milestone checkpoint cadence — write a non-blocking checkpoint after
  m5's ABSORB). VT chart-1 total is now **94.73/120** (corrected during iteration-1's independent
  re-verification, see VT table note above) — exp5's first genuine VT decrease, explicitly a
  measurement correction (MD-001 merge-drift was always-true product state, only now measured) not
  a capability regression. Two new backlog candidates directly recoverable from this milestone's
  findings: `M-MERGE-RECOVER` (recover the ~12 iterations of never-merged exp4 code, fold in
  DOC-006/007) and a small `UQ-049` row (bundle candidate). Selection guidance updated in
  `backlog.md`. Ranking going into m5 SELECT: `M-DIR-PROJECTION` (DIR-002, top priority per its
  own deferred-drain note) vs. `M-MERGE-RECOVER` (real product-integrity gap, med-high Δv̂) vs.
  `M-GH-WRITE`/`M-GH-PARENT` (smaller, precisely-bounded). Next SELECT will weigh governance-drift
  risk (DIR-002, 2nd dropped instance of the same requirement) against product-integrity risk
  (M-MERGE-RECOVER, silently-wrong ledger) — both are legitimate top candidates, decided at m5
  SELECT with full reasoning recorded then, not pre-decided here.
- **SELECT m5 = M-DIR-PROJECTION** 2026-07-18. Weighed against `M-MERGE-RECOVER` (real
  product-integrity gap surfaced by MD-001, med-high Δv̂ but no repeat-governance-drift risk) —
  chose `M-DIR-PROJECTION` per the standing rule established at m4's drain ("pivot immediately if
  pre-dispatch, defer to next slot if mid-milestone with real work already done") and DIR-002's own
  top-priority flag: this is the SECOND time the identical restrained-projection requirement has
  been agreed then dropped (exp4 DIR-006 it11 destructive cutover + it15 rollback, now exp5 DIR-002
  re-flagging the same gap) — a repeat-governance-drift risk outranks a one-off product-integrity
  gap, and `M-MERGE-RECOVER` remains fully real and sized, deferred to m6. Charter authored at
  `charters/M05-dir-projection.md` (explore, MCP/CLI task-store + method-infra surface, no VT chart
  weight — measured on discovery-latency/dogfooding health tracks instead, per §4.2/§4.3). it0
  ceiling check done inline at authoring time (`grep -rn "label.*directive\|directive.*label"
  packages/*/src .claude/skills/quay-directive/` → no existing projection mechanism found; not
  already done, not unreachable). Gate-hash check: `it0-gate-hash-check.sh
  charters/M05-dir-projection.md` → **PASS** ("HARD GATES block matches pinned source ... modulo
  declared [PARAM: ...] substitutions"). `backlog.md`'s M-DIR-PROJECTION row updated to SELECTED.
  Dispatching inner iteration-0 next via `baime:iteration-executor`, worktree
  `milestones/M05-dir-projection/worktrees/iteration-0` branch `exp5-m05-iteration-0`.
- **ABSORB m5 = M-DIR-PROJECTION → DONE** 2026-07-18. Merged `exp5-m05-iteration-1` → `master`
  (`--no-ff`, clean merge, no conflicts). Realized-value check (per the milestone's own value
  hypothesis): a real, live `/quay-directive` invocation this milestone produced a real projected
  task (DIR-003, archived-as-applied, `task_get` evidence pasted) and the anti-drift check genuinely
  caught a real, previously-unknown bug — not a contrived one. iteration-0 built the anti-drift
  script and dogfood demo; iteration-1's independent re-verification (checking `git show`/`git diff`
  against the actual committed content rather than trusting iteration-0's prose, per this
  experiment's standing discipline) found the script and `OUTER-LOOP.md` both used a non-existent
  CLI flag `--labels` (plural) instead of the real `--label` (singular) — `packages/quay/bin/quay.js`
  silently ignores unrecognized flags rather than erroring, so this masked a genuine live-CLI
  filtering bug that iteration-0's own testing never exercised (it always used a pre-fetched JSON
  file, never the live-CLI code path) and that was further coincidentally masked from producing a
  visibly-wrong final answer by the `.mjs` companion script's separate id-shape regex filter. Fixed
  both occurrences, re-verified output unchanged post-fix, logged the narrower remaining gap as
  `PR-005` (`.mjs`'s id-shape-based rather than label-based filtering — left as out-of-charter
  hardening, not blocking). 2 consecutive clean iterations with all 5 Done-when clauses met and
  stable — DONE per §3.2 condition 1. milestone_counter → **5**, hitting the checkpoint cadence
  (every 5 milestones, non-blocking) — writing checkpoint-1 now, then continuing directly to m6
  SELECT without stopping. No VT chart points (method-infra milestone, measured on
  discovery-latency/dogfooding health tracks instead, per its own charter). `backlog.md`'s
  M-DIR-PROJECTION row marked DONE. `M-MERGE-RECOVER` (deferred from m5, real product-integrity gap
  from MD-001) is now the leading candidate for m6 SELECT alongside `M-GH-WRITE`/`M-GH-PARENT`
  (smaller, precisely-bounded provider-ABI fixes) and the newly-logged `PR-004`/`PR-005` (CLI
  label-filter gaps, likely foldable into whichever milestone touches the CLI next rather than
  standalone).
- **DRAIN + SELECT m6 = M-SIZING** 2026-07-18, immediately after checkpoint-1. `ls -1
  directives/pending/` showed `DIR-003-milestone-sizing-cost-band-and-value-typed-selection.md` (1
  file) — a genuinely new human directive (via `/quay-directive`, arrived asynchronously per the
  loop's own control surface). **Numbering collision found and fixed before dispatch**: its id
  (DIR-003) collided with the already-archived `DIR-003-m05-dir-projection-dogfoods-directive-task-
  projection.md` (M05's own live dogfood artifact, a different directive created the same day).
  Renamed to DIR-004 (`git mv` + in-file header edit) before any further processing — mirroring the
  M03-discover→M04-discover renumbering discipline already established at m3→m4.
  DIR-004's finding: reviewing m1-m5, "2 iterations" is a cost-proxy artifact not a real size
  signal (true gauge: does iteration-0 land all Done-when, does iteration-1 have real material to
  independently re-derive — m1 was mildly oversized, m2/m4 correctly sized); and VT prices only
  capability-growth value, scoring m2/m5 at 0 and m4 at **-6.60** despite m4 being one of the two
  most valuable milestones so far (it caught MD-001, a real measurement error carried since before
  m1) — SELECT has been compensating with ad hoc prose instead of a structured, typed ledger.
  **Applied immediately** (not deferred): no inner milestone was in-flight (m5 had just been
  absorbed, checkpoint-1 just written) — per the standing rule from m4's drain ("pivot immediately
  if pre-dispatch, defer if mid-milestone with real work already done"), this is a clean pre-dispatch
  case, same class as DIR-001's immediate supersession at m3.
  **First live application of DIR-004's own requested value-typed ledger, to THIS SELECT** (one
  milestone ahead of its own Done-when-2 target of "starting m7" — dogfooding it informally while
  authoring M-SIZING's own charter, since M-SIZING obviously has no VT Δv̂ of its own and needed a
  real ranking argument other than "the directive says so"): candidate value types recorded —
  M-SIZING = **governance-integrity + risk/option** (fixes SELECT's own blind spot before it causes
  a 3rd repeat-governance-drift instance, same risk class as DIR-002); M-MERGE-RECOVER (deferred
  again, still real) = **instrument-correction**; M-GH-WRITE/M-GH-PARENT (deferred again) =
  **capability-growth**, VT Δv̂≈+3-4, the only one with a positive VT number — and per DIR-004's own
  point, ranking by VT alone would have picked M-GH-WRITE here and permanently deferred the
  self-correcting milestone type. Chose M-SIZING BEFORE M-MERGE-RECOVER despite M-MERGE-RECOVER
  being flagged leading candidate at cp-01 (written minutes earlier) — DIR-004 arrived after cp-01
  and directly changes the ranking logic itself, so applying the OLD (VT-only-adjacent) ranking to
  choose between them first would be circular; fixing the ranking mechanism takes precedence over
  using it once more unfixed.
  Charter authored: `charters/M06-sizing.md` (explore, method-infra surface, no VT chart weight).
  it0 ceiling check done inline (`grep -rn "value.typed\|verify-iteration.*gauge\|cost band" ...`
  → nothing found, not already done). Gate-hash check: `it0-gate-hash-check.sh
  charters/M06-sizing.md` → **PASS**. `backlog.md` gains an M-SIZING row (DONE-pending) and a
  revised order note. DIR-004 archived with status `applied (m6)` and a Resolution section
  recording the renumbering + immediate-apply rationale. Dispatching inner iteration-0 next.
- **ABSORB m6 = M-SIZING → DONE** 2026-07-18. Merged `exp5-m06-iteration-1` → `master` (`--no-ff`,
  clean, no conflicts). Realized-value check: `inherited-core.md` now has a size definition +
  verify-iteration gauge section and a value-typed SELECT ledger (5 named types + governance/infra
  hard floor), both referenced from `OUTER-LOOP.md`'s SELECT/AUTHOR-CHARTER steps; the
  gate-hash-by-reference mechanism is real (new `--by-reference` mode on `it0-gate-hash-check.sh`,
  demonstrated on a genuine M01-dist proof-of-concept at ~1796-1798 real tokens, under the 2K alarm,
  with the dispatched-agent-still-sees-literal-gate-text safeguard confirmed via a worked example).
  **iteration-0 recommended DONE without an iteration-1** — an explicit exception to this
  experiment's established 2-iteration pattern, self-justified via its own newly-authored size gauge
  ("pure doc/script edits, nothing for a fresh worktree to independently re-derive"). The outer loop
  REJECTED this self-exemption before dispatching iteration-1: a milestone's own iteration-0 judging
  its own work exempt from independent verification is exactly the SELF-REFERENTIAL pattern
  `inherited-core.md`'s domain-misfit procedure (Step 2) already names as invalid ("the same
  process/actor that produces the work also verifies it"), and the prior base rate favored
  dispatching anyway (3 of 5 prior milestones had iteration-1 catch something real: M02 gate-hash
  false-FAIL, M04 VT arithmetic slip, M05 `--labels`/`--label` typo). **iteration-1 vindicated the
  override**: it found and fixed a real defect — iteration-0's self-consistency table (Done-when 4)
  mislabeled m2/M-GATES's value type as governance-integrity and attributed a fabricated-adjacent
  quote to DIR-004, when DIR-004's own archived text explicitly types m2 as risk/option
  ("pre-empted 3 wasted SELECTs") and governance-integrity belongs to m5, not m2 — now the 4th of 6
  milestones where independent re-verification caught something real. **Standing lesson recorded**:
  a milestone must never self-exempt from the iteration-1 stability check on its own judgment, even
  when the size gauge it just built would seem to license it — the size gauge is a sizing tool, not
  an escape hatch from §3.2 condition 1's "stable ≥1 iteration" bar, and self-assessed exemption is
  inherently the self-referential case the audit-channel procedure exists to catch.
  iteration-1's fresh HARD GATES run also surfaced a NEW pending directive, **DIR-005** ("V_meta
  consolidation lag — track, alarm, gate the inner→outer hand-off"), committed straight to master
  (commit `d5ba266`, predates iteration-0's own worktree branch point) — dispositioned by iteration-1
  as deferred (out of M06-sizing's own Done-when scope; DIR-005's own text proposes a separate
  milestone). Will be drained properly at the m6→m7 boundary next, per the invariant (never absorb
  async input mid-milestone — this is the boundary).
  milestone_counter → **6**. `backlog.md`'s M-SIZING row marked DONE. Next: drain DIR-005 (fresh,
  real disposition — not just citing iteration-1's placeholder note), then SELECT m7 using the
  value-typed ledger for real, this being its first FULLY in-force use per DIR-004's own Done-when 2
  target ("the next SELECT after this directive" — that's m7).
- **DRAIN + SELECT m7 = M-VMETA-GATE** 2026-07-18. m6/M-SIZING fully absorbed, no inner milestone
  in-flight — this is the m6→m7 boundary. Drained `directives/pending/`: only DIR-005 present
  (`v-meta consolidation lag`). Pre-dispatch → pivot-immediately standing rule applies. Moved to
  `directives/archive/`, status `applied (m7)`, Resolution section filled in for real (superseding
  iteration-1's earlier out-of-scope placeholder note from M06-sizing's own HARD GATES run).
  **First FULLY in-force use of the value-typed SELECT ledger** (per DIR-004's own Done-when 2
  target — "the next SELECT after this directive"). Candidates weighed: **M-VMETA-GATE**
  (DIR-005-sourced, governance-integrity + risk/option — "same class of failure as DIR-002/DIR-006":
  an invariant with no mechanical enforcement) vs. **M-MERGE-RECOVER** (M04-discover-sourced,
  instrument-correction, real product-integrity gap MD-001, now deferred twice — from m5 and m6) vs.
  **M-GH-WRITE/M-GH-PARENT** (capability-growth, Provider-ABI). VT Δv̂ alone would favor
  M-GH-WRITE (only one with nonzero chart points) or defer both infra candidates indefinitely — the
  ledger's whole purpose is to prevent exactly that systematic bias. Selected **M-VMETA-GATE**:
  (a) pre-dispatch pivot-immediately applies to a freshly-arrived directive, same as DIR-001/DIR-004
  before it; (b) DIR-005's own first-proof requirement (Done-when 4) targets the `CI-job≡audit-
  channel` pattern, which is ALREADY past its φ confirmation threshold (confirmed m1+m3, m6 now
  complete) — every milestone this is deferred adds to a lag this very milestone exists to measure
  and gate, a compounding cost M-MERGE-RECOVER/M-GH-WRITE's static gaps don't share. Authored
  `charters/M07-vmeta-gate.md` (5 in-scope work items + 5 binary Done-when, verbatim from DIR-005).
  Gate-hash check: `it0-gate-hash-check.sh --by-reference charters/M07-vmeta-gate.md` → **PASS** —
  this is the first REAL forward use of the by-reference mechanism M-SIZING built (fulfilling that
  milestone's own Done-when 3 commitment: "or used live when authoring the next real charter"), not
  another proof-of-concept. `backlog.md` gains an M-VMETA-GATE row under a new "DIR-005-sourced
  candidate" section marked SELECTED. **Pre-commitment recorded for m8: M-MERGE-RECOVER, no further
  deferral** — m5 (M-DIR-PROJECTION), m6 (M-SIZING), and now m7 (M-VMETA-GATE) are three consecutive
  governance/infra-heavy explore milestones; that pattern must not continue into m8 by default
  regardless of what else surfaces at the m7→m8 boundary, absent a genuine blocking gap or external
  HALT. Dispatching inner iteration-0 next.
- **ABSORB m7 = M-VMETA-GATE → DONE** 2026-07-18. Iteration-0 built all 5 charter items: new
  `v-meta-ledger.md` (initially 3 rows, migrated from DIR-005's Finding), a `V_meta consolidation
  lag` health track in `dashboard.md` (K=2 alarm), and an ABSORB-step gate in `OUTER-LOOP.md`.
  Iteration-1 independent re-verification (5th of 7 milestones catching something real) found and
  fixed: (1) a real structural bug — DIR-005 items (a)/(b) are the SAME insight at two points in
  its confirmation history (m1 origin, m3 threshold-crossing), not two distinct insights; two rows
  would have double-counted one debt item against the K=2 alarm. Corrected to one row with an
  evolving confirmation count (1→2), with the correction's reasoning traced directly to
  `dashboard.md`'s own m1/m3 log-entry wording ("validated once at M01-dist" / "gets its 2nd
  confirming instance"). (2) The "milestones-since-confirmed" health-track metric was narrative,
  not mechanically computable — added the explicit formula
  `milestone_counter (current) − confirming milestone number` grounded in `dashboard.md`'s own
  logged `milestone_counter → N` values. (3) The ABSORB gate's wording named no concrete block
  target — tightened to explicitly gate step 7's `milestone_counter++`. All 5 Done-when clauses
  met with re-derived (not self-reported) evidence; no code touched, no test run required per
  charter Done-when 5. Merged `exp5-m07-iteration-1` → `master` (`--no-ff`, clean, no conflicts).
  **First-proof requirement (DIR-005/charter Done-when 4) resolved AT THIS ABSORB, by
  consolidation, not carry-forward**: the `domain-audit-channel≡CI-job` ledger row (confirmed at
  m3, already 3 milestones-since-confirmed and past K=2 by m6-complete — zero slack remaining)
  was folded into `inherited-core.md`'s "Domain-misfit audit-channel" section under a new
  "CONSOLIDATED — φ-confirmed pattern" subsection, recording the m3 confirming instance (M03-abi-
  eval's cross-provider conformance suite reusing the CI-job-as-audit-channel pattern from M01-dist,
  unchanged, in a genuinely different domain) and retiring the citation as an established,
  twice-confirmed convention. Ledger row status → `consolidated`. `dashboard.md`'s new health
  track updated to 0 rows past-threshold-and-unresolved — the gate's first real bite, demonstrated
  against a genuine pre-existing case as DIR-005 itself required, not a hypothetical future one.
  milestone_counter → **7**. `backlog.md`'s M-VMETA-GATE row to be marked DONE next.
  **Standing pre-commitment reaffirmed**: SELECT m8 = M-MERGE-RECOVER, no further deferral — three
  consecutive governance/infra-heavy explore milestones (m5, m6, m7) is enough; m8 must be
  product-value work absent a genuine blocking gap or external HALT.
- **SELECT m8 = M-MERGE-RECOVER** 2026-07-18. No `.halt`, `directives/pending/` empty (only
  `.gitkeep`). Honoring the pre-commitment made at m7's ABSORB — first product-value milestone
  since m4, breaking a 3-milestone governance/infra-explore streak (m5/m6/m7). Confirmed at
  charter-authoring time via `git diff --stat master experiment-4-iteration-19 -- packages/quay`
  that a direct branch re-merge of the original exp4 dev-phase commits is unsafe: those branches
  predate M-DIST and M-ABI-EVAL and would delete files master now has (`scripts/build-sea.sh`,
  `scripts/esbuild-sea.mjs`, `scripts/version-sea-shim.js`, `test/provider-abi-conformance.
  test.mjs`) — **chose re-implement-fresh against current master**, per backlog's own
  safer-path guidance. Charter `charters/M08-merge-recover.md` covers all 9 in-scope items
  (CB-021/CB-006/CB-022/UQ-047/UQ-048/PKG-003..008/DOC-001..007) as 7 binary Done-when clauses.
  Value type: capability-growth (primary) + instrument-correction (secondary — CHANGELOG's false
  v0.2.0 claims). Δv̂ re-derived from m4's live baseline (CLI 0.80, Docs 0.55, Packaging 0.85) at
  ≈+7.6 (CLI+3.25, Docs+3.75, Packaging+0.60), superseding the backlog row's earlier pre-charter
  "+4 to +6" guess — realized number at ABSORB is authoritative, not this estimate. it0 domain-
  misfit audit-channel check explicitly applies the just-consolidated CI-job≡audit-channel
  convention (`inherited-core.md`, added at m7's own ABSORB) — first real-world reuse of that
  consolidation, one milestone after landing. Gate-hash check:
  `it0-gate-hash-check.sh --by-reference charters/M08-merge-recover.md` → **PASS**. Dispatching
  inner iteration-0 next.
- **ABSORB m8 = M-MERGE-RECOVER → DONE** 2026-07-18. Iteration-0: re-implemented fresh against
  current `master` (not a branch re-merge, per the SELECT-time conflict-risk finding) all 9
  in-scope items — `--version`/`-V`, `--format json` alias, `--page-size` (CLI table/JSON + Web UI
  + UQ-048 validation), `package.json` `files`/`license` fields, `packages/quay/{README,CHANGELOG,
  LICENSE}.md`, root README SEA section, corrected+new CHANGELOG entries — with Done-when 1-6
  evidenced and Done-when 7 (VT re-score + gap-list closure) explicitly left as genuine, honestly-
  flagged remaining scope. Self-caught and self-fixed a worktree-isolation violation (report
  initially written to the shared repo root) before finishing. Iteration-1: independently
  re-verified Done-when 1-6 on a fresh worktree/fresh `npm install`/fresh full test run (31/31,
  zero discrepancies vs iteration-0's claims) and closed iteration-0's one open caveat (Docker
  audit-channel `--provider github` subtests, previously blocked only by missing `gh` CLI in the
  `node:20-slim` image — re-attempted with `gh` provisioned via the official apt repo, fully clean,
  zero-caveat pass). Independently re-derived the VT arithmetic from scratch (did not trust
  iteration-0's draft) — found iteration-0's own math internally consistent this time (no
  arithmetic slip, unlike m4's precedent), with the small delta (103.48→103.73) attributable to the
  newly-closed Docker caveat, a genuinely new finding not a correction. Actually applied Done-when
  7's file edits (not just drafted): `dashboard.md`'s chart-1 re-score section and
  `gap-list.md`'s per-entry closure annotations with live command-output citations, deliberately
  leaving MD-001's umbrella un-resolved pending confirmed presence on `master`. Merged
  `exp5-m08-iteration-1` → `master` (`--no-ff`, commit `b168153`, 15 files, 1794 insertions/49
  deletions — fast-forward-inclusive of iteration-0's commits). Re-ran the full test suite directly
  on merged `master` as the closing check: 31/31 pass, 0 fail. Marked `gap-list.md`'s MD-001
  umbrella **RESOLVED** (strikethrough id, resolution note citing merge commit `b168153` and the
  `git merge-base --is-ancestor` confirmation) — this experiment's ABSORB step, not the iteration-1
  worktree, per MD-001's own root-cause lesson ("ledger says closed, `master` doesn't have the
  code" — now both agree, verified on `master` itself). **Realized Δv = +9.00** (94.73→103.73/120),
  above the charter's own Δv̂≈+7.6 pre-dispatch estimate (calibration: realized exceeded estimate by
  ~18%, in the direction of under-estimating — the Docker-caveat closure was genuinely unanticipated
  value, not overreach). VT chart-1 curve append: `(m8/M08-merge-recover, 103.73/120, Δv=+9.00)`.
  milestone_counter → **8**. `backlog.md`'s `M-MERGE-RECOVER` row marked DONE next. Inner-convergence
  success track: 8/8 (m8 also 2 iterations, Done-when-complete, no mid-milestone re-scope — the
  Done-when-7 deferral was pre-declared genuine remaining scope, not an ad hoc re-scope). Discovery
  latency: 0 (iteration-1's Docker-caveat closure and gap-list edits landed same-milestone, not
  deferred further). V_meta consolidation lag: unchanged, 0 rows past-threshold-and-unresolved (no
  new ledger rows proposed this milestone — M08 was a pure capability-recovery milestone, not a
  methodology-infra one). No new pending directives at the m8→m9 boundary (drain re-run: `ls -1
  directives/pending/` empty). Continuing per the standing instruction: no further deferral needed,
  SELECT m9 next from whatever's live in `backlog.md`/`directives/pending/` at that time.
- **SELECT m9 = M-GH-WRITE (bundled with M-GH-PARENT)** 2026-07-18. No `.halt`, `directives/
  pending/` empty (re-drained). Following the standing selection order recorded at m5/m6's ABSORB
  (`backlog.md` line 93-96: M-SIZING → M-MERGE-RECOVER → M-GH-WRITE → M-GH-PARENT bundled →
  checkpoint 2 at m10). Confirmed at charter-authoring time via direct source read
  (`packages/quay-github/src/mcp-server.js`, `github-client.js`) that PR-ABI-001 (task_write
  silently drops title/body/labels via zod stripping, status-only schema) and PR-ABI-002 (`get()`
  never builds `parentIndex`, always returns `parent: null`, asymmetric vs `list()`) are both still
  live on current master — no drift since m3. Charter `charters/M09-gh-write.md` scopes: (1) real
  title/body/labels write via the existing `ghApiRun` PATCH pattern `setStatus` already uses, (2) a
  hard-error floor for any field left unimplemented (replaces the silent-drop danger even if the
  write stretch is partial), (3) `get()`'s parent fix by reusing `list()`'s own
  `fetchAllIssues()`+`buildParentIndex()`, (4) explicit exclusion of parent/children WRITE
  (cross-issue body mutation — a materially riskier path, deferred to a future milestone to keep
  this one's blast radius contained per the M06-sizing gauge). Value type: capability-growth
  (primary) + risk/option (secondary — closing the no-error-signal danger). Δv̂≈+2.9 (Provider-ABI
  cov 0.654→~0.80, write fraction 1/5→~3/5 — deliberately narrower than backlog's own "+3 to +4"
  pre-charter guess, which assumed full 4/5 field completion; this charter's scope stops short of
  parent/children write). it0 domain-misfit audit-channel check applies the now-twice-confirmed
  CI-job≡audit-channel convention. Gate-hash check:
  `it0-gate-hash-check.sh --by-reference charters/M09-gh-write.md` → **PASS**. Dispatching inner
  iteration-0 next.
- **DIR-006 arrived mid-m9** 2026-07-18 (`directives/pending/DIR-006-webui-browser-verification-
  regression.md`, human-asserted directly in conversation). Finding: zero real playwright/chrome-
  devtools browser-tool usage across all 9 milestones despite M04-discover's charter/report
  narrating a "real browser session" backed only by `curl` evidence — a claim-vs-pasted-evidence
  mismatch iteration-1 re-verification should have caught and did not; no mechanized Web UI
  visual-verification gate exists in `inherited-core.md`/`OUTER-LOOP.md`; also requests a
  systematic audit of exp1-4 for other silently-dropped-enforcement methodology requirements
  (3rd instance of this failure class after DIR-002/DIR-005). **NOT actioned now** — m9's inner
  iteration-0 is in-flight; per the governing invariant ("never perturb an in-flight inner
  milestone"), disposition is deferred to the m9→m10 boundary drain. Logged here so it is not
  lost in the interim.
- **ABSORB m9 = M-GH-WRITE (bundled M-GH-PARENT) → DONE** 2026-07-18. Iteration-0: implemented real
  `title`/`body`/`labels` write (`github-client.js#writeFields`, reusing the `ghApiRun` PATCH
  pattern `setStatus` already used) live-verified against a dedicated scratch issue `gh-11`; a
  hard-error floor (`isError:true`) for any unimplemented field (`parent`/`children`), replacing
  the prior silent-drop-via-zod-stripping danger — required a source-dive into
  `@modelcontextprotocol/sdk`'s `zod-compat.js` to find the actual stripping mechanism and fix it
  with an explicit `z.object({...}).catchall(z.unknown())` schema; `github-client.js#get()`'s
  parent-resolution asymmetry fixed by reusing `list()`'s own `fetchAllIssues()`+
  `buildParentIndex()`; self-caught and self-fixed a regression this same fix caused in
  `task-check-passthrough.test.mjs` (extended `fake-gh.mjs`'s fixture for the new paged-list call
  `get()` now also issues). Iteration-1: independently re-verified all 7 Done-when clauses from a
  fresh worktree/fresh `npm install` — re-read `gh-11` live, re-derived the `gh-5`/`gh-7` parent
  symmetry BOTH pre-fix (reproducing the original asymmetry against the base commit, proving the
  bug was real) AND post-fix, re-ran the hard-error-floor probe via the real MCP stdio protocol,
  re-ran the full test suite fresh (31/31), independently re-derived the cov/VT arithmetic from
  scratch via a fresh `python3 -c` run (HELD UP unchanged: cov=12/13=0.9231, VT=109.11/120,
  Δv=+5.38 — no arithmetic error, unlike some earlier milestones), and re-ran the domain-misfit
  Docker audit-channel in a SECOND, differently-provisioned container (`node:20-slim` + downloaded
  `gh` release binary, vs iteration-0's `debian:stable-slim` + apt-get) — 19/19 PASS again,
  confirming the pattern is robust to provisioning-path variation, not an artifact of one specific
  container recipe. **Iteration-1 caught two real, non-blocking defects**: (1) a wording bug in
  this file's own Δv arithmetic-recheck prose ("below" should have read "above," directly
  contradicting the very next sentence — not an arithmetic error); (2) iteration-0 had NOT actually
  applied Done-when 7's `gap-list.md` sub-clause despite the charter requiring it, and had left a
  FALSE justifying note in `capability-matrix.md` claiming that file "does NOT" apply to exp5
  milestones — contradicted by M08-merge-recover iteration-1's own extensive closure entries
  already present in that same file. Iteration-1 fixed both: wrote real `gap-list.md` closure rows
  for PR-ABI-001/PR-ABI-002 citing its own fresh live evidence, and retracted the false note.
  Merged `exp5-m09-iteration-1` → `master` (`--no-ff` — fast-forward-inclusive of iteration-0's
  commits). Re-ran the full test suite directly on merged `master` as the closing check: 31/31
  pass, 0 fail, exit 0. **Realized Δv = +5.38** (103.73→109.11/120), above the charter's own
  conservative Δv̂≈+2.9 pre-dispatch estimate — the realized write fraction (4/5) exceeded the
  charter's "~3/5 realistic" placeholder, and the read-side PR-ABI-002 fix contributed an
  additional, separately-unitemized delta the placeholder arithmetic didn't account for. VT
  chart-1 curve already appended above (§ "Chart-1 re-score (M09-gh-write...)"):
  `(m9/M09-gh-write, 109.11/120, Δv=+5.38)`. `milestone_counter` → **9**. `backlog.md`'s
  `M-GH-WRITE`/`M-GH-PARENT` rows marked DONE next. Inner-convergence success track: 9/9 (m9 also 2
  iterations, Done-when-complete, no mid-milestone re-scope). Discovery latency: 0 (both of
  iteration-1's catches — the wording defect and the missing gap-list sub-clause — were fixed
  same-milestone, not deferred). V_meta consolidation lag: unchanged, 0 rows past-threshold (no new
  ledger rows proposed this milestone — M09 was a pure capability-recovery/write-completeness
  milestone, not a methodology-infra one). **m9→m10 boundary drain**: `directives/pending/` now
  contains THREE items — DIR-006 (logged mid-m9 above, Web UI browser-verification regression +
  requested exp1-4 methodology-carry-forward audit), DIR-007 (arrived via the same external
  `/quay-directive` channel shortly after DIR-006, discovered via `git log` after m9 iteration-0
  completed — G3 out-of-band adversarial-audit role cited in `inherited-core.md` but never
  operationalized as a mechanized Done-when/HARD GATE anywhere in exp5's 9 milestone charters; what
  exp5 built instead — the domain-misfit audit-channel and iteration-1's same-template independent
  re-run — is explicitly NOT a substitute for G3's cross-role, claim-refutation-scoped adversarial
  audit), and DIR-008 (arrived the same way, not yet read in detail by the outer loop — per
  `git log`'s commit title: "exp5 σ-inherited-floor trap never consolidated, already cost a silent
  VT correction"). All three are same-failure-class (citation-without-enforcement, the
  DIR-002/DIR-005 pattern) and will be read/disposed together at the SELECT m10 step, likely as a
  dedicated methodology-infra charter (parallel to how DIR-005 alone became M07-vmeta-gate) — exact
  scope/bundling decision deferred to that boundary, not decided now. Checkpoint cp-02 is due at
  milestone_counter=10 (next milestone) — non-blocking, write it and continue, do not stop.
- **SELECT m10 = M-AUDIT-CONSOLIDATION (bundles DIR-006 + DIR-007 + DIR-008)** 2026-07-18. No
  `.halt`. `directives/pending/` drain confirms exactly the three items logged at m9's ABSORB, all
  still `status: pending`. Read DIR-008 in full this step (it was only titled, not read, at m9's
  ABSORB) — confirms the same hypothesis: `inherited-core.md`'s own kickoff-commit "Known weakness"
  line pre-named exactly these three φ edges ("§0c visual-review; dispatch/G3 discipline; σ-floor
  handling") as its "First consolidation target" — DIR-006/007/008 are that trio's three pieces,
  discovered incrementally by the human's live audit, not three independent findings. Bundling into
  one charter (governance-integrity + risk/option value type, no VT weight, parallel to
  M02/M05/M06/M07's methodology-infra precedent) rather than three separate thin milestones, per
  DIR-004's method-ROI framing and the directives' own explicit request to be read/disposed
  together. Charter `charters/M10-audit-consolidation.md` scopes 8 Done-when clauses: (1-3) DIR-006
  — mechanized Web UI verification requirement in `inherited-core.md`, M04-discover's cov numbers
  flagged provisionally-uncertain + a new `M-WEBUI-REVERIFY` backlog candidate (actual
  re-verification explicitly deferred, per DIR-006's own item 3 scoping), exp1-4 systematic audit
  performed and findings recorded; (4-6) DIR-007 — a genuinely distinct, concretely-named
  adversarial-audit-role step added to `inherited-core.md`/`OUTER-LOOP.md` as its own out-of-band
  dispatch (not folded into iteration-1), mechanized as a gate on VT-scoring/self-exemption-attempt
  milestones only (explicit non-blanket cadence rule recorded); (7-8) DIR-008 — VT₀
  reset-vs-carry-forward decision + σ-inherited-floor trap consolidated as operational content
  (completing the kickoff commit's trio), manda-dispatch discipline consolidated at its correct
  narrow scope (DIR-020 self-deadlock + DIR-015/016/024 background-dispatch, fire-and-forget
  explicitly unaffected). Deliberately larger than the recent 5-7-clause norm (M06-sizing's own
  gauge) — justified: pure documentation/consolidation (no live external mutation, unlike M09), and
  every item traces directly to a directive's own already-itemized requested action, not
  newly-invented scope. Gate-hash check:
  `it0-gate-hash-check.sh --by-reference charters/M10-audit-consolidation.md` → **PASS**.
  Dispatching inner iteration-0 next.
