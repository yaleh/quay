---
id: gap-fan-in-execute-semantic-fallback-telemetry-blind
title: fan-in 语义兜底路径（fan-in-execute.js）的实际触发/落地情况在现有账本中完全不可观测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

- `plugin/scripts/worker-fan-in.ts:499` and `:2541` define the fan-in outcome type as a plain union `"landed" | "red"` — there is no third value identifying "landed via the fan-in-execute.js semantic fallback" as distinct from "landed via the mechanical path".
- `plugin/scripts/worker-driver.ts:4405` writes the mechanical result onto `outcome.mechanical_fan_in`. In this repo's own `.quay/worker-outcome.jsonl`, 2146 records carry this field (974 `landed` / 1172 `red`) — every single one attributable to the mechanical path; none attributable to the semantic fallback, because the schema has no slot for that attribution.
- `plugin/workflows/fan-in-execute.js`'s own stated purpose (its `meta.description`) is to run ONLY as a semantic fallback when the mechanical fan-in fails. Whether, and how often, this fallback actually fires and whether it succeeds is currently unknowable from any existing telemetry — a prior audit pass searched the full git history (27111+ commits) and all `.quay/*.jsonl`/`orchestration/*.jsonl`/`.workflow-events/*.jsonl` logs and found zero invocation-attributable evidence either way (only bookkeeping mentions of the file/mechanism itself, never a run trace).
- Related but separate, and currently unverifiable precisely BECAUSE of this blind spot: `plugin/workflows/fan-in-execute.js:689` hardcodes its scoped-gate test command (`bash scripts/test.sh --for-task ${task} --allow-thin`) instead of calling the shared single-source-of-truth `resolveScopedGateCommand` (`plugin/scripts/worker-fan-in.ts:222`, explicitly commented as the canonical implementation used by the mechanical path and everything else). No incident from this divergence has been recorded, but that absence is not meaningful evidence of safety — it is equally explained by the fallback path near-never firing, which this same telemetry gap prevents us from checking.
- Candidate remedy direction (finding only, not a committed plan): add a distinguishing outcome value/field (e.g. a `semantic_fan_in` sibling field to `mechanical_fan_in`, or a third outcome literal) so that when/if `fan-in-execute.js` runs, its attempt and result are visible in the same ledger — this is a prerequisite for deciding whether the scoped-gate hardcode divergence is worth fixing at all, since right now there's no way to tell whether that code path has ever executed.

**Dedup check performed**: `task_list` searched for `mechanical_fan_in`, `semantic fallback`, `fan-in-execute`, `semantic fan-in`, `semantic fallback workflow telemetry`, `landed via semantic`, `resolveScopedGateCommand`, `worker-fan-in.ts`, `scoped-gate test command hardcode`. The specific/narrow queries (`mechanical_fan_in`, `semantic fallback`, `semantic fan-in`, `landed via semantic`, `semantic fallback workflow telemetry`) all returned zero hits. The broad filename/identifier queries (`fan-in-execute.js`, `worker-fan-in.ts`, `resolveScopedGateCommand`) matched a very large number of unrelated tasks purely because those are widely-referenced shared files across many tasks' `Touches` sections, not because of a shared mechanism — none surfaced as addressing this specific telemetry-blind-spot/outcome-schema gap. No genuine duplicate found.

## AC

- [ ] `grep -n '"landed" | "red"' plugin/scripts/worker-fan-in.ts` confirms the outcome union currently has no slot for semantic-fallback attribution (negative control confirming the gap as filed) — or, if already fixed, a third/sibling value exists and is exercised by a real recorded outcome.
- [ ] A query over `.quay/worker-outcome.jsonl` (or whatever ledger exists at implementation time) can answer "has `fan-in-execute.js` ever run, and with what result" — currently this returns "unknowable" per the audit above; after the fix it must return a concrete count (even if zero).
- [ ] Once the semantic-fallback path is observable, the `plugin/workflows/fan-in-execute.js:689` hardcoded scoped-gate command vs. the shared `resolveScopedGateCommand` divergence is re-assessed with actual firing-frequency data, and a decision (fix it / leave it with documented rationale) is recorded.

## DoD

The worker-outcome ledger (or its successor) distinguishes a landing reached via `fan-in-execute.js`'s semantic fallback from one reached via the mechanical path, with a real recorded instance (or a real zero-count reading obtained by querying the new field, not by inability to query at all) as evidence — not a schema change that is never exercised in production.

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/workflows/fan-in-execute.js
- tasks/gap-fan-in-execute-semantic-fallback-telemetry-blind.md
