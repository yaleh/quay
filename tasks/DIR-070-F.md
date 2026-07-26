---
id: DIR-070-F
title: "DIR-070-F: Gap 3 — extract methodology skills (lower priority)"
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-070
children: []
extra:
  dirStatus: deferred
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-F
    experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md
    /tmp/m179-absorb-entry.md
---
## Proposal

Extract reusable methodology patterns from the remaining three `.claude/skills/` into plugin skills. Lower priority than DIR-070-E — these are reference material, not operational pipelines.

## Plan

### quay-native-methodology
- Extract: gate mechanics reference (`reference/gate-mechanics.md`), directive lifecycle (`reference/directive-lifecycle.md`), patterns (`reference/patterns.md`), G3 audit discipline (`reference/g3-audit-discipline.md`)
- Leave: experiment-specific case studies, inventory data, V-meta analysis

### quay-webui-bootstrap-methodology
- Extract: visual review mechanism rules (`reference/visual-review-mechanism.md`), effectiveness-timing corpus
- Leave: experiment-specific V-meta ceiling analysis, G3 env gap case study

### quay-core-bootstrap-methodology
- Lowest priority — mostly experiment history. Extract nothing; leave as experiment-local reference.

### Update manifests
Add extracted skills to `plugin.json` commands[] and `plugin-packaging.test.mjs`.

## Acceptance Criteria

- [x] Extracted skills pass leak test (no `experiments/quay-perpetual-stream` or `exp5`) — audit-confirmed: `grep -rl "experiments/quay-perpetual-stream\|exp5" plugin/skills/quay-native-methodology/ plugin/skills/quay-webui-bootstrap-methodology/` → zero matches (M179 iteration-0 acceptance audit)
- [x] Original `.claude/skills/` still contain experiment-specific context — audit-confirmed: `git status --porcelain` on both `.claude/skills/` dirs is empty (untouched); `examples/`, `inventory/`, `scripts/`, `templates/`, `experiment-config.json` still present (M179 iteration-0 acceptance audit)
- [x] `plugin.json` commands[] updated — audit-confirmed: `git show 6983aa6 -- plugin/.claude-plugin/plugin.json` shows commands[] grew 7→9, both new SKILL.md paths added (M179 iteration-0 acceptance audit)
- [x] `plugin-packaging.test.mjs` passes — audit-confirmed with caveat: 33/34 pass; the 1 failure (`task-schema.ts` attribution-stripping, unrelated file) independently reproduced identically on the pre-DIR-070-F parent commit `6983aa6^`, confirming it predates and is orthogonal to this task. Full repo suite: 521 tests, 517 pass, 1 (same) pre-existing fail, 3 skipped, zero regressions (M179 iteration-0 acceptance audit)

## Definition of Done

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 3 — audit-confirmed: task cites it at line 47; doc §"差距 3" lists exactly `quay-native-methodology`/`quay-webui-bootstrap-methodology` as the reusable candidates (M179 iteration-0 acceptance audit)
- [x] Extracted methodology skills in `plugin/skills/` — audit-confirmed: all 6 reference files + 2 SKILL.md byte-identical (`diff -q`) to their `.claude/skills/` sources (M179 iteration-0 acceptance audit)
- [x] `plugin.json` updated — same evidence as AC3 (M179 iteration-0 acceptance audit)
- [x] Plugin packaging test passes — same evidence/caveat as AC4 (M179 iteration-0 acceptance audit)
- [x] Human-steered: touches `.claude/skills/` (driver-self-rewrite per DIR-062 clause 1) — read-only touch: confirmed by dedicated regression test that originals are unmodified — audit-confirmed: `node --test --test-name-pattern="original .claude/skills/ sources are unmodified" plugin/test/plugin-packaging.test.mjs` → 1/1 pass (M179 iteration-0 acceptance audit)

**Audit disposition (M179 iteration-0):** overall verdict REFUTED — not by AC/DoD content (all
independently re-confirmed above) but by the mechanical gate (`it0-dod-check.sh` exits 1: clause1/2/7
FAIL — `/tmp/m179-absorb-entry.md` lacks adversarial-audit/V_meta-lag/test-floor disposition
statements) and lifecycle non-promotion (`status: todo` on master despite merge `6983aa6`, no
gate-events.jsonl entry). See `milestones/M179/audits/iteration-0-acceptance-audit.md` for full
detail and deviation log write-back in `dashboard.md`.

## Touches

- `.claude/skills/quay-native-methodology/` (extract, not delete)
- `.claude/skills/quay-webui-bootstrap-methodology/` (extract, not delete)
- `plugin/skills/quay-native-methodology/SKILL.md` (new)
- `plugin/skills/quay-webui-bootstrap-methodology/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`
