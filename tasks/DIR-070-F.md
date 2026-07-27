---
id: DIR-070-F
title: "DIR-070-F: Gap 3 — extract methodology skills (lower priority)"
status: done
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

## Execution record

- **Milestone:** M179
- **Iteration count:** 1 (`milestones/M179/iterations/iteration-1.md` — the substantive extraction
  had already landed pre-milestone at `6983aa6`; iteration-1 re-verified the landed implementation
  directly against live artifacts rather than trusting the prior report, and applied the
  Build-phase-scoped fix per `gap-absorb-entry-clause-disposition-sequencing`'s established
  mechanism: tagged `/tmp/m179-absorb-entry.md`'s Backlog row with `surface:packaging`, flipping the
  mechanical gate's clause7-test-floor FAIL→N/A).
- **Realized Δv:** 0 (v̂>0, capability-growth — extracted `quay-native-methodology` +
  `quay-webui-bootstrap-methodology` reference material to `plugin/skills/`; pure packaging/
  distribution addition, no chart-2 surface cell moves — same DIR-070-A/B/C/D sibling pattern).
- **Merge commit:** `7bed8c2` ("M179/DIR-070-F: Build iteration 1 — re-verify landed implementation,
  fix backlog-row surface tag"; the substantive extraction itself is `6983aa6`, already on `master`
  before this ABSORB ran — no separate iteration worktree/branch existed to merge at this ABSORB,
  `git worktree list`/`git branch -a` confirm no M179/DIR-070-F branch).
- **Audit verdict:** NO REFUTATION FOUND (M179 round-2 re-audit, session
  `006748f4-b16e-4522-a7a6-68b595240e42` — superseding the prior REFUTED verdict, which was driven
  entirely by the missing `/tmp/m179-absorb-entry.md` disposition artifact, not by any AC/DoD
  substance gap; all 4 AC + 5 DoD items independently re-confirmed fresh against live
  grep/diff/test-output — see `milestones/M179/audits/iteration-0-acceptance-audit.md` §"Round 2").
- **Outcome:** `plugin/skills/quay-native-methodology/` + `plugin/skills/quay-webui-bootstrap-methodology/`
  landed on `master` as leak-free, byte-identical mirrors of the `.claude/skills/` originals;
  `plugin.json` commands[] 7→9; closes the last open child (Gap 3) of the DIR-070 epic; mechanical
  gate `it0-dod-check.sh DIR-070-F <charter> /tmp/m179-absorb-entry.md` exits 0 (12/12 clauses
  PASS/N/A); dashboard.md ABSORB log entry + deviation-row resolution recorded at `m179`
  (milestone_counter 184→185).
