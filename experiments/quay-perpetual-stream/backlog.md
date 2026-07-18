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
