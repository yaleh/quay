# Milestone / Opportunity Backlog — quay-perpetual-stream (Experiment 5)

Milestone-sized candidates (calibrated to exp1–4 as reference units). Carried by reference from
exp4 (`experiments/quay-continuous-bootstrap/`). Raw polish gaps are NOT standalone milestones —
they are bundled into a milestone or handled by the exploit-tier simulated-user channel.

Value hypotheses are numeric `Δv̂` on chart-0 surface-capability points (§6.2); fill precise numbers
at SELECT time once VT origin is scored.

## Product-value milestones

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-DIST | Distribution: Node SEA / Bun compile release artifacts via GitHub Actions | Packaging | DIR-004 (REOPENED, **URGENT**) | **explore** | high (Packaging cov ~0.2→~0.8, ~+12) | aged 8+ exp4 iters with no outer owner; the canonical first milestone |
| M-CLI-UX | CLI usability closeout (UQ-042..046: grammar, --format synopsis/case/examples) | CLI | exp4 gap-list usability_quality | exploit | low (~+2) | bundle of polish gaps; good warm-up/exploit milestone |
| M-DOCS | Docs surface hardening (docs_quality sub-dimension, new it18) | Docs | exp4 gap-list docs_quality | exploit | med (~+4) | thin/irregular coverage per exp4 transfer_breadth |

## Methodology-infrastructure milestones (strengthen the method's own substrate)

| id | title | surface(s) | source | e/x | rough Δv̂ | notes |
|---|---|---|---|---|---|---|
| M-DIRTASK | Directives-as-quay-tasks single-source-of-truth cutover (+ update `quay-directive` skill to emit tasks not files) | MCP/CLI (task store) | DIR-006 (REOPENED) | explore | med | prose-commitment failed twice (applied→reopened) — needs TOOLING enforcement, not prose |
| M-GATES | Institutionalize the 4 systematic-explore it0 checks as real gates (ceiling arithmetic, gate-hash/transclusion, dogfooding evidence-gate, domain-misfit audit-channel) | (method infra) | offline-replay §4.4 | explore | med | converts ~206 iters of late-discovery latency into it0 alarms; highest method-ROI |

## Deferred / environmental (not milestones)
- ENV-001 (MCP process restart) — minor, root-cause host-controlled, mitigated. Not fixable at code level.
- SH-006 (stderr leak) — minor.
- CB-006 (configurable page size) — minor/medium; bundle into a Web UI milestone if one opens.

## Selection guidance (§4.5)
≥1 explore milestone per 5. Suggested first pass: **M-DIST** (explore, URGENT, opens the Packaging
chart) → M-CLI-UX (exploit warm-up) → **M-GATES** (explore, highest method-ROI) → M-DOCS (exploit)
→ **M-DIRTASK** (explore) → checkpoint 1.
