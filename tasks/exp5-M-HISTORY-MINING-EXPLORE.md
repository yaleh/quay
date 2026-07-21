---
id: exp5-M-HISTORY-MINING-EXPLORE
title: "meta-cc session-history mining exploration: surface hidden defects, ADR
  candidates, and crystallizable patterns from exp5 Claude Code session history
  (first use of history-mining.md probe concept; M88 mandatory explore)"
status: ready
labels:
  - milestone-candidate
  - explore
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-HISTORY-MINING-EXPLORE
    experiments/quay-perpetual-stream/charters/M88-history-mining-explore.md
    /tmp/m88-absorb-entry.md
---
## Proposal

Exp5 has accumulated substantial Claude Code session history across M01–M87. Every
high-value human-triggered correction in this experiment — the `.js→.ts` runtime-resolution
blind spot (M77), the CHILD-LINK-SYMMETRY modeling hole, the recurring clause-0 / audit-id
formatting errors — came from reading the session history and spotting a recurring defect, an
implicit decision that should be an ADR, or a one-off fix that should be a general check.
This axis (process/provenance) currently has no standing instrument.

The explore goal: use meta-cc tools (`query_session_signals`, `analyze_errors`,
`query_edit_sequences`, `query_session_content`, `get_tech_debt`, `get_work_patterns`) to
mine the exp5 session history and produce evidence-backed findings in three classes:
- **defect / gap** — recurring errors, unverified claims, silently-dropped requirements
- **ADR candidate** — load-bearing decisions made implicitly across sessions
- **crystallizable pattern** — one-off fixes that should become general checks / skills

Findings are filed as tasks ROUTED BY TYPE (defect → `milestone-candidate`; ADR → `adr-draft`;
pattern → `crystallization`) with mandatory evidence refs (session-id + turn/commit citation).

This is a one-time manual exploration — not the standing routine (DIR-055). It validates the
`history-mining.md` probe concept shipped with M86 (DIR-056) and fills the process/provenance
dark axis before the standing routine is wired.

Value type: discovery/explore. Δv̂ = 0 (no VT chart cell; instrument-correction class).

## Plan

N/A — one-pass exploration (run meta-cc queries, document findings, file evidence-backed
tasks). No staged sub-phases; scope is one mining pass producing one findings report artifact.

REFUTE-FIRST discipline: all queries must seek to REFUTE claims of health — surface what went
wrong, what recurred, what was lost. Never file self-congratulatory or loop-favorable tasks.

## Acceptance Criteria

- [x] meta-cc session history queried using ≥3 distinct tool types (e.g. `query_session_signals`, `analyze_errors`, `query_edit_sequences`); raw findings documented in `milestones/M88/audits/history-mining-findings.md`
- [x] ≥1 evidence-backed task filed with session-id + turn/commit reference per reachable finding class (defect, ADR candidate, or pattern); findings without refs are rejected
- [x] All filed tasks have correct labels per finding type (defect→`milestone-candidate`, ADR→`adr-draft`, pattern→`crystallization`)
- [x] No product code changes introduced (explore-only; post-explore git-status clean)

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.

- [x] Findings report at `milestones/M88/audits/history-mining-findings.md` with all AC items addressed; ≥1 real filed task per class (task ids: exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP, exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS, exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH, exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN, exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT)
- [x] Evidence-backing: every filed task body cites a session-id / turn / commit ref (not vague) — verified by audit
- [x] Adversarial audit disposition recorded (NO REFUTATION FOUND / CONCERNS / REFUTED)
- [ ] Acceptance gate (`quay gate exp5-M-HISTORY-MINING-EXPLORE`) PASS

## Human verification when exp5 marks this done

1. Do the filed tasks have real session-id / turn / commit references (not fabricated)?
2. Are findings genuinely negative (defects/gaps/candidates), not self-congratulatory?
3. Is every filed task labeled correctly by finding type?
4. Did the exploration surface at least one non-obvious finding not already in the task backlog?
5. If any filing is ref-less, vague, or loop-favorable, it is NOT done — send back.
