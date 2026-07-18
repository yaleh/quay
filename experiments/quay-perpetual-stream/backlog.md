# Milestone / Opportunity Backlog — quay-perpetual-stream (Experiment 5)

Milestone-sized candidates (calibrated to exp1–4 as reference units). Carried by reference from
exp4 (`experiments/quay-continuous-bootstrap/`). Raw polish gaps are NOT standalone milestones —
they are bundled into a milestone or handled by the exploit-tier simulated-user channel.

Value hypotheses are numeric `Δv̂` on chart-0 surface-capability points (§6.2); fill precise numbers
at SELECT time once VT origin is scored.

## Product-value milestones

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-DIST | Distribution: Node SEA / Bun compile release artifacts via GitHub Actions | Packaging | DIR-004 (REOPENED, **URGENT**) | **explore** | high (Packaging cov ~0.2→~0.8, ~+12) | **DONE (m1, 2026-07-18)** — realized Δv=+6.0 exact vs hypothesis; merged to master; CI green run https://github.com/yaleh/quay/actions/runs/29635782886; gap-list CB-023 closed |
| M-CLI-UX | CLI usability closeout (UQ-042..046: grammar, --format synopsis/case/examples) | CLI | exp4 gap-list usability_quality | exploit | low (~+2) | **STALE at m2 SELECT (2026-07-18, it0 ceiling check)** — UQ-042..046 were already closed in exp4 iteration 15 (`gap-list.md` lines 35-39/185-189, all `~~strikethrough~~`/"(done)"). exp4's true FINAL open-gap set (it19) is only ENV-001/SH-006/NEW-001/PKG-010, all minor/env — there is no real CLI-surface milestone-sized scope left to close. NOT selected; retained here as a documented dead-end so a future SELECT doesn't re-discover this from scratch. |
| M-DOCS | Docs surface hardening (docs_quality sub-dimension, new it18) | Docs | exp4 gap-list docs_quality | exploit | med (~+4) | **STALE at m3 SELECT (2026-07-18, `it0-ceiling-check.sh`)** — DOC-001..005 (the it18 docs_quality findings this row cites) were already closed in exp4 iteration 19 (`gap-list.md`, confirmed via mechanized check: all 5 CLOSED). No real Docs-surface milestone-sized scope left to close from this source. NOT selected. |

## Methodology-infrastructure milestones (strengthen the method's own substrate)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-DIRTASK | Directives-as-quay-tasks single-source-of-truth cutover (+ update `quay-directive` skill to emit tasks not files) | MCP/CLI (task store) | DIR-006 (REOPENED) | explore | med | **STALE at m3 SELECT (2026-07-18)** — checked `directives/archive/DIR-006-*.md` directly: DIR-006 is **CLOSED**, not reopened, with a formal considered resolution ("Option B: files canonical") that explicitly REJECTS this row's own premise ("updating the quay-directive skill to produce tasks would require significant tooling work with no clear benefit given the file-based system's actual usage pattern"). This backlog row predates that resolution and was never updated. NOT selected — dispatching it would re-litigate a decision already made and documented. |
| M-GATES | Institutionalize the 4 systematic-explore it0 checks as real gates (ceiling arithmetic, gate-hash/transclusion, dogfooding evidence-gate, domain-misfit audit-channel) | (method infra) | offline-replay §4.4 | explore | med | **DONE (m2, 2026-07-18)** — `it0-ceiling-check.sh`, `it0-gate-hash-check.sh`, `it0-dogfood-evidence-gate.sh` under `experiments/quay-perpetual-stream/scripts/`, `inherited-core.md` domain-misfit procedure, `OUTER-LOOP.md` step 4 rewired; these same scripts were then used to audit M-DOCS and M-DIRTASK above and caught both stale, 1 milestone after being built |

## DIR-001-sourced candidates (2026-07-18)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-ABI-EVAL | Provider-ABI VT surface (capability matrix) + native/github differential conformance suite | Provider-ABI (new chart-1 surface) | DIR-001 items 1-2 | explore | chart transition, Δv̂≈0 direct (re-baseline, not capability close) | **DONE (m3, 2026-07-18)** — cov=0.654 realized (vs 0.30 placeholder), chart-1 VT=101.33/120; found PR-ABI-001 (github task_write silently drops unsupported fields) + PR-ABI-002 (github task.parent null via task_get, non-null via task_list) both logged in gap-list.md; merged to master. Write-completeness gap now precisely bounded (1/5 fields) — a real, sized candidate for a future explore milestone if selected. |
| M04-discover | (see charter, unchanged) | CLI/MCP/WebUI/Docs | protocol §4.4 exploit channel | exploit | ~0 to +1 direct, discovery value | **DONE (m4, 2026-07-18)** — 4 persona passes complete; headline finding MD-001 (significant, independently re-confirmed iteration-1): exp4 iterations 13/14/16/17/18/19 never merged their dev-phase commits to master despite gap-list "Closed"/CHANGELOG claiming otherwise, 12 gap-list entries reopened. 6 new findings (DOC-006/007, UQ-049/050, others). MCP pass found 0 gaps. VT chart-1 corrected to 94.73/120 (iteration-1 fixed an arithmetic slip). Merged to master. |
| M-OUTCOME-EVAL | Outcome-based (job-to-be-done) evaluation: fixed real end-to-end task-board scenarios, binary pass/fail, dogfooding-gated | cross-cutting | DIR-001 item 3 | explore | method infra, no VT points | Backlogged, not yet charter-ready — needs a concrete scenario list authored at SELECT time. |
| M-ADVERSARIAL-EVAL | Adversarial/negative-path + security evaluation (fault injection, token handling, open-redirect, injection review) | cross-cutting | DIR-001 item 4 | explore | method infra, no VT points | Backlogged. |
| M-COMPETITIVE-BENCH | Comparative capability benchmark vs. a real competitor (formalize CB-016's ad hoc GitHub Issues/Linear yardstick) | cross-cutting | DIR-001 item 5 | exploit (cross-exp comparison channel) | method infra, no VT points | Backlogged. |
| M-HUMAN-REVIEW-CADENCE | Standing periodic human-led capability review as an explore milestone type (institutionalize the `/quay-directive` channel itself, not just react to it) | method infra | DIR-001 item 6 | explore | method infra, no VT points | Backlogged — offline data (RESULTS.md) shows every structural discovery came from this channel, never the simulated-user; worth a recurring-cadence design once ≥2 more DIR-* instances exist to generalize from. |

## M03-abi-eval-sourced candidates (2026-07-18)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-GH-WRITE | GitHub Provider write-completeness (title/body/labels/parent-children write; fix PR-ABI-001's silent-drop-no-error failure mode at minimum, real write support as stretch) | Provider-ABI | gap-list PR-ABI-001 (significant) | explore | Provider-ABI cov 0.654→~0.85 (write fraction 1/5→~4/5, weight 20, Δv̂≈+3 to +4) | Real, precisely-sized candidate — M03-abi-eval's matrix bounds the gap exactly (write=0.20, the lone thin cell). Minimum-viable form: make the MCP schema reject/error on unsupported fields instead of silently dropping them (closes the "no error signal" danger even without full write support); stretch form: implement real title/body/labels write against GitHub's API. Not yet charter-authored. |
| M-GH-PARENT | Fix quay-github's `task_get`/`task_list` parent-resolution asymmetry (PR-ABI-002) | Provider-ABI | gap-list PR-ABI-002 (minor) | exploit | small (~+0.5, cov nudge only) | Small, well-bounded — `github-client.js#get()` needs the same parentIndex lookup `list()` already does. Candidate for bundling into M-GH-WRITE rather than a standalone milestone (too small alone per "raw polish gaps are NOT standalone milestones"). |

## DIR-002-sourced candidate (2026-07-18, TOP PRIORITY for m5 SELECT)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-DIR-PROJECTION | Directives-as-quay-tasks restrained projection (files stay canonical, `/quay-directive` also creates/refreshes a generated `label: directive` task; mechanical anti-drift reconciliation check; outer-loop inbox drain also reads `task_list --label directive`) | MCP/CLI (task store) + method infra | DIR-002 (deferred at m4 drain, not applied — see `directives/pending/DIR-002-*.md` disposition note) | explore | method infra, no VT points (dogfooding load-bearing value, same thread as DIR-001) | **SELECTED as m5** (2026-07-18). Charter authored at `charters/M05-dir-projection.md`, gate-hash PASS. DIR-002 explicitly forbids repeating exp4 DIR-006 it11's mistake (destructive file-delete cutover) — scope must be strictly additive/generated-projection, with Done-when 3's anti-drift check as the actual mechanical enforcement previously missing. Ranked ahead of M-MERGE-RECOVER and M-GH-WRITE/M-GH-PARENT: repeat-governance-drift risk (2nd time this exact requirement has been dropped) outweighs a per-provider capability gap or code-integrity recovery (M-MERGE-RECOVER deferred to m6, still real and sized). |

## M04-discover-sourced candidates (2026-07-18)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-MERGE-RECOVER | Recover ~12 exp4 iterations' worth of `packages/quay` code that gap-list.md/CHANGELOG.md claim shipped but were never actually merged to `master` (MD-001): `--version`/`-V`, `--page-size` (CLI+Web UI+JSON mode), `--format json` alias, `packages/quay/{README,CHANGELOG,LICENSE}.md`, `package.json` `files`/`license` fields — either by re-merging the original `experiment-4-iteration-{13,14,16,17,18,19}` branch tips (conflict risk against intervening M-DIST/M-ABI-EVAL master history, needs real review) or by re-implementing fresh against current master (safer, smaller diff, re-verify each against its original test additions). Also fold in DOC-006 (document the SEA/release artifacts M-DIST already shipped — currently completely undocumented in README.md) and DOC-007 (CHANGELOG v0.3.x entry, correct the v0.2.0 entry's false claims) as part of the same milestone's docs-closeout scope, since both require touching the same files. | CLI, Docs, Packaging | gap-list MD-001 (significant) + DOC-006/DOC-007 (minor) | explore | med-high (CLI cov likely 0.95→lower once merge-drift is priced in, recovers back toward ~0.90+; Docs cov 0.70→higher once SEA is documented and CHANGELOG corrected; Δv̂≈+4 to +6 est., precise number needs re-baseline at SELECT time once this milestone's charter is authored) | Not yet charter-authored. Sizing rationale: 6 iterations' worth of `bin/quay.js`/`serve.js`/test changes is real re-implementation/re-verification effort, not a 1-line fix — explicitly named by the charter's own bundling rule as backlog-candidate-worthy. Smaller sub-candidate `M-DOCS-SEA` (DOC-006/007 alone, docs-only, no code recovery) could be split out if `M-MERGE-RECOVER`'s code-recovery scope is judged too large for one milestone at SELECT time. |
| UQ-049 | Web UI `?search=` URL param silently no-ops (real param is `q`); mobile-viewport title-text CSS overflow (UQ-050). | Web UI | gap-list UQ-049 (minor) / UQ-050 (low) | exploit | low (~+0.5-1, cov nudge only) | Small, well-bounded — likely bundle into `M-MERGE-RECOVER`'s Web UI touch-surface or a future exploit-channel pass rather than a standalone milestone (too small alone per "raw polish gaps are NOT standalone milestones"). |

## Backlog exhaustion finding (m3 SELECT, 2026-07-18)
Every carried-by-reference candidate above except M-DIST/M-GATES (both DONE) is now confirmed STALE
— the exp4-vintage backlog has no remaining milestone-sized product-value or methodology-infra scope.
The only genuinely open exp4 items are minor/environmental (ENV-001, SH-006 — see below) or already
closed (CB-006, confirmed via ceiling-check). **This backlog needs fresh discovery, not another
carried-reference pick.** Per protocol §4.4's discovery-engine portfolio, the next legitimate source
is the **exploit channel** (standing simulated-user / persona review) run against the CURRENT live
product — which has changed materially since exp4's last review (M-DIST added real SEA/CI surfaces
that no simulated-user persona has ever exercised) — not a 4th attempt to mine an exhausted carried
list. See m3 SELECT = M-DISCOVER in `dashboard.md`.

## Deferred / environmental (not milestones)
- ENV-001 (MCP process restart) — minor, root-cause host-controlled, mitigated. Not fixable at code level.
- SH-006 (stderr leak) — minor.
- CB-006 (configurable page size) — minor/medium; bundle into a Web UI milestone if one opens.

## Selection guidance (§4.5)
≥1 explore milestone per 5. Suggested first pass: **M-DIST** (explore, URGENT, opens the Packaging
chart) → ~~M-CLI-UX~~ (dead, see STALE note above) → **M-GATES** (explore, highest method-ROI) →
M-DOCS (exploit) → **M-DIRTASK** (explore) → checkpoint 1.

Revised order after m2 SELECT (2026-07-18): **M-DIST(done) → M-GATES → M-DOCS → M-DIRTASK →
checkpoint 1.**

Revised order after m4/M04-discover iteration-0 (2026-07-18): the exploit-channel discovery pass
found the backlog's most consequential item yet — **M-MERGE-RECOVER** (significant, MD-001 merge-drift)
should be the next SELECT ahead of M-GH-WRITE/M-GH-PARENT, since it recovers real, previously-claimed
CLI/Docs/Packaging capability that is silently absent from `master` today, vs. M-GH-WRITE's smaller,
already-fully-bounded Provider-ABI write-completeness gap. Suggested: **M-MERGE-RECOVER (explore) →
M-GH-WRITE (explore) → M-GH-PARENT (exploit, bundle into M-GH-WRITE) → checkpoint 2.**
