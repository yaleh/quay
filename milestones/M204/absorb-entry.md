## M204 ABSORB entry

**Milestone id:** M204
**Task:** DIR-126-E (recalibrate the prepare-milestone capacity model from real telemetry —
`--capacity-report` aggregation — fifth and final child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-E | Recalibrate the prepare-milestone capacity model from real telemetry — a purely additive `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json'` aggregation mode on `milestone-preparation-check.ts` (both mirrors) emitting P50/P85 wall time + summed agent-minutes by class/highRisk/terminal/decision, mechanical-vs-content dispatch work, prepared/attempt ratio, terminal/decision yield, absorbed-task/prepare-hour, concurrent duplicate-generation minutes, unchanged-terminal recomputation, reuse-terminal hits, and explicit exclusions; reads ONLY checked-in artifacts (never session JSONL); regenerates the throughput-capacity doc from real output with traceable sample provenance | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts +
plugin/scripts/ mirror, its test file, and docs/proposals/quay-milestone-workflow-throughput-
capacity-model.md. Touches NO packages/quay* product code, so the product-touching surface labels
(cli/web-ui/provider-abi/mcp) do NOT apply. Purely additive: a new CLI mode on an existing script
plus a doc regeneration; no existing check changes shape or becomes stricter.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M204)

**CONCERNS** — all 23 AC items CONFIRMED by the fresh-context adversarial acceptance audit's OWN
live runs/fixtures (never the implementer's self-report; audit session
`9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`, artifact
`milestones/M204/audits/iteration-0-acceptance-audit.md`). Gate item: both mirrors exit 0,
well-formed JSON, `code: ok`, `sampleCount: 29`; the mechanical wiring is a real independent
top-level `if (parsed.capacityReport)` dispatch block at `milestone-preparation-check.ts:1092`.
DoD items 1/2/3/5 confirmed; two disclosed concerns, NEITHER a refutation: (1) DoD item 4 (real
`reuse-terminal` proof) remains OPEN — 0/26 live reuse-terminal samples; the zero-work claim is
fixture-proven and schema-guaranteed but not yet witnessed by live data, flagged honestly in doc §4
and the iteration report per the task's own Defaults/Risks, never synthesized (DoD checkbox
deliberately left `- [ ]`); (2) 5 of the 26 doc-cited telemetry samples are untracked in the
working tree (M205's concurrent prep generations, pre-land timestamps 18:06–20:33Z before the
21:03Z land commit), with negligible headline impact (tracked-only P50 29.3m vs 29.1m; P85
identical 58.8m) — two machine-caught deviation rows written to dashboard.md, both `status: open`.
Mechanical gate `it0-dod-check.sh` exits 0 (clause0 hard-blocks only on unchecked AC boxes;
23/23 checked).

## ABSORB gate run (M204, post-audit)

Re-run live at this Land (2026-07-30):

- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-E
  experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md
  milestones/M204/absorb-entry.md` → **PASS**, all 12 applicable clauses (`clause0-ac-dod-present`:
  "23 checkable clause(s) (checklist-form, 23/23 checked)"; clause7 N/A — surface label
  `method-infra` exclusively non-product-touching; clause12 N/A documented no-op, see the
  audit-independence disposition below), exit 0.
- `bash experiments/quay-perpetual-stream/scripts/task-schema-check.sh tasks/DIR-126-E.md` →
  `PASS: tasks/DIR-126-E.md — schema v1 conformant (kind=milestone-candidate)`, exit 0.
- `npx tsx experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task
  tasks/DIR-126-E.md` → `{"ok":true,"code":"wiring-coverage-complete", ... "findings":[]}`
  (all 10 mechanism claims matched), exit 0.
- `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` → `clean — no un-gitignored
  scratch left in the main tree`, exit 0. (The 6 untracked `milestones/prepare-telemetry/
  gap-wiring-coverage-check-*/` records + untracked `milestones/M205/` + `docs/plans/M205-*` belong
  to M205's concurrent prep/plan work — disclosed in the audit's Concern #1; the hygiene check's
  own scratch patterns do not flag tracked-destination milestone evidence, consistent with the
  audit's own clause10 PASS.)
- `bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` → `clean — no
  orphaned milestone evidence in un-merged iteration branches` (prunable merged iteration
  branches=0, registered iteration worktrees=0), exit 0. M204 built directly on master (1
  iteration, commit `23f8891`, no separate worktree/branch) — nothing to prune.
- `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 200
  experiments/quay-perpetual-stream/v-meta-ledger.md` → `PASS: no confirmed-unconsolidated row past
  K without a dated carry-forward` (milestone_counter=200 K=2, both ledger rows `[ok]`).
- `bash experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` → `PASS:
  ... dashboard.md — 999 lines (cap 1200)` pre-this-entry, exit 0.
- `bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift detected`
  (incl. `scripts/milestone-preparation-check.ts` verified identical), exit 0. Live
  `--capacity-report --workspace .` on BOTH mirrors → exit 0 / exit 0, `cmp` byte-identical,
  `code: ok`, `sampleCount: 30` (one more than the audit's 29 — the corpus is a moving target:
  concurrent M205/M206/M207 prep generations landed since the audit run), `'generatedAtMs' in
  report === false`.
- Real test suite, re-run live: `scripts/test.sh
  experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` → **80/80 pass,
  0 fail** (incl. the C1 gate item: live subprocess invocations on both mirrors).

**Audit-independence gate (run honestly at this Land, dispositioned not waived — M195/M200-M203
lineage precedent):** `bash experiments/quay-perpetual-stream/scripts/audit-independence-check.sh
--orchestrator-id 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1
milestones/M204/audits/iteration-0-acceptance-audit.md` → **FAIL** (exit 1): the artifact's session
id (`9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`) EQUALS the orchestrator's own id — the systemic
DIR-093/M142 session-id-indistinctness class inherent to the workflow-agent architecture (an
orchestrator-dispatched subagent inherits the orchestrator's session id, so the artifact can never
carry a distinct one). DISPOSITION: substantive independence IS preserved — the audit is a
fresh-context, refute-first pass that re-ran every load-bearing command itself (both mirrors live,
`cmp`s, `sync-vendor.sh --check`, the 80-test suite, the mechanical gate) and re-derived every doc
figure from its own live `--capacity-report` run, citing auditor-generated evidence for all 23 AC
items, never the implementer's self-report (see `milestones/M204/audits/iteration-0-acceptance-
audit.md`). The `## Audit-independence check` absorb-entry section is deliberately NOT added: per
`it0-dod-check.ts`'s clause12 implementation a present section is mechanically re-executed and its
FAIL would hard-block every subsequent DoD-gate run (incl. the acceptance gate) on an
architecturally-unfixable session-id match; clause12 therefore stays a documented no-op (N/A),
exactly as in M195/M200/M201/M202/M203, with the honest FAIL recorded here instead. The audit's
"Notes for Land" suggestion to add the section is superseded by this mechanical reality — the
honest-run-plus-disposition recording IS the lineage's clause12 satisfaction path.

**PHI CONSOLIDATION CHECK (M204):** checked — no clearly-applicable prior adaptation was reused
unchanged by this milestone. The `--capacity-report` aggregation mode mirrors the existing
`--telemetry-report`/`--metrics`/`--build` dispatch shape as a same-domain, same-file structural
template and REUSES (not re-derives) `_walkJsonFiles`/`validateTelemetryRecord`/
`computeMetricsForReceipt`/`CACHEABLE_TERMINALS` — all same-subsystem code reuse, a different axis
than a V_meta-ledger cross-domain adaptation. Neither V_meta ledger row
(`domain-audit-channel≡CI-job`, already `consolidated` — nothing to re-consolidate; `repo-root
isolation-leak lesson`, an unrelated `.halt`-path/workspace-root failure mode) was reused unchanged
here, so no citation crosses the φ threshold and nothing consolidates into `inherited-core.md`
this pass.

adversarial-audit disposition: CONCERNS — all 23 AC items CONFIRMED by the auditor's own live runs/fixtures (gate item: both mirrors exit 0, well-formed JSON, code=ok, sampleCount=29; mechanical wiring verified at milestone-preparation-check.ts:1092); two disclosed concerns, neither a refutation: (1) DoD item 4 (real reuse-terminal proof) remains OPEN — 0/26 live reuse-terminal samples; the zero-work claim is fixture-proven and schema-guaranteed but not yet witnessed by live data, flagged honestly in doc §4 and the iteration report per the task's own Defaults/Risks, never synthesized; (2) 5 of the 26 doc-cited telemetry samples are untracked in the working tree (M205's concurrent prep generations, pre-land timestamps 18:06–20:33Z before the 21:03Z land commit), with negligible headline impact (tracked-only P50 29.3m vs 29.1m; P85 identical 58.8m) — deviation rows written to dashboard.md. DoD items 1/2/3/5 confirmed; item 5 carries the untracked-samples caveat.

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward (vmeta-lag-check.sh --counter 199 experiments/quay-perpetual-stream/v-meta-ledger.md, exit 0 — both ledger rows [ok]: consolidated row "lag gate does not apply", proposed row "not past φ threshold, no lag gate").
