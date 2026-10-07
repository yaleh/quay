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

- [x] `grep -n '"landed" | "red"' plugin/scripts/worker-fan-in.ts` confirms the outcome union currently has no slot for semantic-fallback attribution (negative control confirming the gap as filed) — or, if already fixed, a third/sibling value exists and is exercised by a real recorded outcome.
- [x] A query over `.quay/worker-outcome.jsonl` (or whatever ledger exists at implementation time) can answer "has `fan-in-execute.js` ever run, and with what result" — currently this returns "unknowable" per the audit above; after the fix it must return a concrete count (even if zero).
- [x] Once the semantic-fallback path is observable, the `plugin/workflows/fan-in-execute.js:689` hardcoded scoped-gate command vs. the shared `resolveScopedGateCommand` divergence is re-assessed with actual firing-frequency data, and a decision (fix it / leave it with documented rationale) is recorded.

## DoD

The worker-outcome ledger (or its successor) distinguishes a landing reached via `fan-in-execute.js`'s semantic fallback from one reached via the mechanical path, with a real recorded instance (or a real zero-count reading obtained by querying the new field, not by inability to query at all) as evidence — not a schema change that is never exercised in production.

## Touches

- .gitignore
- packages/quay/test/build-plugin-dist.test.mjs
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/workflows/fan-in-execute.js
- plugin/test/fan-in-semantic-fallback-record.test.mjs
- tasks/gap-fan-in-execute-semantic-fallback-telemetry-blind.md

## Evidence

**What the audit missed (correcting the ## Finding).** The claim "zero invocation-attributable evidence either way" is **falsified**: `.quay/gate-events.jsonl` already carries a real semantic-fallback *landing* — `{gate:"complete", actor:"quay-fan-in-workflow", item_id:"gap-superseded-dependency-blocks-dispatch-forever", timestamp:"2026-09-24T04:11:49.063Z", id:"5e2299bb-91ad-4153-a867-b0d9366c8c32"}`. The same task's worker-outcome record 1h earlier reads `2026-09-24T03:05:42.619Z exited-not-landed mechanical_fan_in:null` — i.e. the durable fan-in ledger says "not landed" for a task the semantic fallback in fact landed. The gap was therefore not "no evidence exists" but "**no query joins the evidence that exists**", plus "**a run that does not land leaves no trace at all**".

**Deliverable.**
- Write side — `worker-driver.ts --record-semantic-fallback --task <id> --phase start|end [--fallback-outcome landed|red|aborted] [--run-id <id>] [--reason <s>]` appends to `<root>/.quay/fan-in-semantic-fallback.jsonl` (gitignored, `worker-outcome.jsonl` family). Fail-closed (exit 2) on missing `--task`, out-of-vocabulary `--phase`, `--phase end` without `--fallback-outcome`, and `--phase start` with an outcome.
- Read side — `worker-driver.ts --semantic-fallback-report [--root <r>]`: read-only join of the new attempt ledger with the pre-existing `gate-events.jsonl` landing signal (`actor=quay-fan-in-workflow ∧ gate=complete`). `evaluated:false` only when **neither** carrier is readable (硬规则 3b: not conflated with a measured zero).
- Workflow wired: `plugin/workflows/fan-in-execute.js` records `--phase start` in the phase-1 prompt (step 0, after entry-preflight) and the paired `--phase end --outcome landed` at step 5.5c (right after the existing `complete`-GateEvent write). Both are best-effort (WARN, never blocking) — 硬规则 12: no new blocking precondition for observability.

**AC1 evidence (negative control, 位置判定).** `grep -c '"landed" | "red"' plugin/scripts/worker-fan-in.ts` = **2** (`:499` `MechanicalFanInResult`, `:2541` `GoalMergeFanInResult`). Deliberately **not** given a "semantic" value: that type describes the *mechanical* path's result, and the semantic fallback is not a value of it (硬规则 8 — no shared vocabulary). The sibling attribution instead lives in the new ledger's own word list (`SemanticFallbackOutcome = "landed" | "red" | "aborted"`, `SEMANTIC_FALLBACK_GATE_ACTOR = "quay-fan-in-workflow"`), and it **is exercised by a real recorded outcome** (the 2026-09-24 landing above).

**AC2 evidence (concrete count, not "unknowable").** Run against the production carriers (main checkout):
`node --experimental-strip-types plugin/scripts/worker-driver.ts --semantic-fallback-report --root /data/home/yale/work/quay`
⇒ `{"evaluated":true,"ledgerPresent":false,"gateEventsPresent":true,"attempts":0,"completions":0,"runs":0,"landings":0,...,"gateEventLandings":[{"task":"gap-superseded-dependency-blocks-dispatch-forever","ts":"2026-09-24T04:11:49.063Z","id":"5e2299bb-..."}]}`
A concrete answer with a concrete count. `--root`-less reads in a worktree (no gitignored carriers) correctly return `evaluated:false` rather than a fake zero.

**AC3 evidence + decision (firing frequency).** Measured: semantic-fallback landings in the whole production ledger = **1** (2026-09-24) vs mechanical-path `complete` events = **825** (`actor=quay-driver`). The declared `loop.scoped_command` in `.quay/config.yml` is `["bash","{worktree}/scripts/test.sh","--for-task","{task}","--allow-thin"]` — byte-equal to the hardcode's argv ⇒ **no actual divergence today**, only a latent "does not follow the config". **Decision: leave it, documented** (rationale now printed in the workflow directly above the line; the line itself moved from `:689` to `:716` because of the AC3 comment). Grounds: (a) the path fires ~never; (b) it is byte-equivalent today; (c) the workflow is being retired (`fan-in-workflow-retirement-check.ts`, L3 双副本删净) ⇒ changing it now only enlarges the change surface of a path about to disappear. Revisit trigger recorded: if the workflow survives P3, route it through `resolveScopedGateCommand` — the moment `.quay/config.yml` changes, the hardcode silently stops matching.

**Tests.** `plugin/test/fan-in-semantic-fallback-record.test.mjs` — 7 tests, all green, including the negative controls that make the report falsifiable: a `quay-driver` `complete` event is **not** counted as a semantic-fallback landing; a same-actor non-`complete` event is not counted; both carriers absent ⇒ `evaluated:false`; unpaired start ⇒ `unfinished`; malformed/out-of-vocabulary lines never become readings; CLI fail-closed paths. `plugin/test/fan-in-execute-paths-s*.test.mjs` (96 tests) still green after the workflow edits.

**修复（本轮 exited-not-landed 轮）：pre-fix anchor 基线漂移。** 本任务给 `plugin/workflows/fan-in-execute.js` 新增了 2 处真实的 `plugin/scripts/worker-driver.ts` 调用（step 0 的 `--phase start` / step 5.5c 的 `--phase end`）+ 1 条点名 `plugin/scripts/worker-fan-in.ts` 的 AC3 理由注释；三者各被 `rewriteMarkdown` 折成一个 `${CLAUDE_PLUGIN_ROOT}` anchor ⇒ `packages/quay/test/build-plugin-dist.test.mjs` 的 AC5 所钉的「改写前 anchor 数」从 **22** 变为 **25**，suite 红（`fan-in-execute.js: pre-fix anchor count changed — the measurement drifted`）。该测试【直接读 `fan-in-execute.js` 文本】，故 one-hop import 判它与本 delta UNRELATED，而因果为真（data-file 读形态）。修法：重测并把基线钉值 22→25，注释同步；下界断言 `preFixCounts["fan-in-execute.js"] >= 20`（0.16.0 基线）未动。复现/修复读数：`node --test packages/quay/test/build-plugin-dist.test.mjs` 修前 AC5 red（pre=25, pinned=22），修后 exit 0、44 tests pass，`[AC4-task]` 打印 `fan-in-execute.js=25`。已把该测试文件加入 `## Touches`——否则 fan-in step 3 的 anti-drift（读 worktree 内本任务文件的 Touches vs `git diff <mergeTarget>...HEAD`）会把它判成 out-of-declared 硬红。

**Residual gap (honest).** The attempt ledger is written only from the workflow's own start/landed points; its failure exits (suite-red exhaustion, ff-retry exhausted, plugin-root-invalid) currently surface only as an unmatched `phase=start` (`unfinished`), not as an explicit `--outcome red|aborted`. `--fallback-outcome red|aborted` is implemented and tested but not yet wired into those exits.