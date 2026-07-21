---
id: exp5-M-ARCH-AUDIT-POST-TS-P3
title: "Architecture health audit post-TS-P3 migration (archguard L_D/L_G)"
status: ready
labels:
  - milestone-candidate
  - crystallization
  - explore
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-POST-TS-P3
    experiments/quay-perpetual-stream/charters/M83-arch-audit-post-ts-p3.md
    /tmp/m83-absorb-entry.md
---
## Proposal

Now that TS P3 migration has ported quay-native (M80), quay-github (M81), and quay Core
utilities (M82), the codebase has a substantial TS surface for the first time. This is the
first meaningful opportunity to run the archguard L_D/L_G lens (per ADR-007) on the real
typed codebase.

The explore goal: run archguard dependency analysis on all three packages (quay, quay-native,
quay-github), document the dependency graph, identify any cycles or god-package smells, and
map the architectural risks for the two remaining Core migration targets (gate/ in P3-B-2 and
serve.js/mcp-server.js in P3-B-3). Findings are filed as evidence-backed improvement tasks
if blocking cycles or smells are found; the audit report becomes the grounding artifact for
P3-B-2/B-3 scope decisions.

Value type: discovery + instrument-correction. Δv̂ = 0 (L_D/L_G instrument-correction; no
VT chart cell). The explore fills the gap that ADR-007 identified but the TS migration's
exploit cadence left dark.

## Plan

N/A — one-pass explore (run archguard, document findings, file tasks). No staged sub-phases
needed; scope is one audit pass producing one report artifact.

## Acceptance Criteria

- [ ] archguard dependency analysis run on packages/quay, packages/quay-native, packages/quay-github; raw findings documented in `milestones/M83/audits/arch-audit.md`
- [ ] any dependency cycles identified and filed as tasks (or explicitly noted as none-found)
- [ ] god-package / high-fan-out smells identified (or noted as none-found)
- [ ] remaining migration risk map for P3-B-2 (gate/) and P3-B-3 (serve+mcp) documented in the audit report
- [ ] no regressions introduced (explore-only — no product code changes)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] Audit report exists at `milestones/M83/audits/arch-audit.md` with all AC items addressed
- [ ] Any blocking findings filed as tasks before ABSORB
- [ ] Adversarial audit disposition recorded
- [ ] Acceptance gate PASS
