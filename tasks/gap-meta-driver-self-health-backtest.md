---
id: gap-meta-driver-self-health-backtest
title: "meta-driver self-health backtest: offline deterministic liveness-check
  detection-delay/false-alarm analysis over .quay/meta-driver-round.jsonl"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

meta-driver's semantic half (the `meta-review` routine) has been failing on **100% of invocations since 2026-09-14**, continuously through at least 2026-10-09 (`"routine threw: snapshotTrackedChanges is not defined"`), while the mechanical heartbeat loop kept ticking every ~40-60s the whole time, looking healthy. This has never been caught by any existing mechanism — the only trace is an incidental mention in `tasks/gap-ac255-anchor-kind-set-silent-loss.md:46` ("AI 关联发现…本任务不修，须另立"), and no follow-up was ever filed.

Before proposing or building any production liveness check, this task runs a **read-only, zero-LLM, fully deterministic backtest** against the real historical carrier `.quay/meta-driver-round.jsonl` to measure: how early could a minimal liveness rule have caught this specific outage, and at what false-alarm cost, across a declared grid of parameterizations? The output is an analysis artifact (script + JSON results + a short writeup), not a production change.

**Explicit non-goals**: this task does **not** modify `plugin/scripts/meta-driver.ts` or any production driver code, does **not** itself decide to ship a liveness check, and does **not** bundle with any other meta-driver refactor. If the backtest result is strong, filing the minimal production-check task is a separate, follow-up task gated on this one's result (see DoD).

## Plan

1. Write `docs/analysis/meta-driver-self-health-backtest.mjs` — a standalone Node script, no new dependencies, that **streams** `.quay/meta-driver-round.jsonl` line-by-line (the file is ~200MB on this host; must never be loaded wholesale into memory) and extracts, from every line whose `facts[]` contains an entry with `name:"meta-review"`, the tuple `{ts, state, reason}`, sorted chronologically by `ts` (not by `round` — `round` resets on every process respawn and is not globally monotonic, confirmed by inspecting the raw file).
2. From that attempt sequence compute two independent rule families and their firing timestamps:
   - **Count-based**: for N ∈ {1,3,5,10,20}, the rule fires at the first attempt index `i` where the preceding N consecutive attempts are all non-`verified`.
   - **Time-window-based**: for T ∈ {15m,30m,1h,3h,6h,24h}, the rule fires at the first point in time where more than T has elapsed since the last `verified` attempt.
3. Compute **detection delay** per rule = firing timestamp − real outage start timestamp (first non-`verified` attempt in the continuous failing streak that runs to the end of the file).
4. Compute **false-alarm count** per rule = number of times, across the ENTIRE file history (not just the known outage window), the rule would have fired and then cleared (a later `verified` attempt occurs before the next firing) — i.e. transient flags distinct from the one real sustained outage.
5. Separately record any **attempt gap** (a span with zero `meta-review` entries at all, vs. entries that ran and failed) between the last known `verified` attempt and the first recorded `failed` attempt — digest-gate-skipped-by-design must not be counted as a false alarm or folded into the outage-detection accounting.
6. Write `docs/analysis/meta-driver-self-health-backtest.results.json`: one record per rule parameterization `{rule_family, param, fired_at, detection_delay_ms, false_alarm_count, false_alarm_timestamps}`, plus a top-level summary `{outage_start_ts, last_verified_ts, total_attempts, total_failed, total_verified, attempt_gap_before_outage_ms}`.
7. Write `docs/analysis/meta-driver-self-health-backtest.md`: a short human-readable writeup stating the smallest N/T that would have caught the real outage, its detection delay in minutes/hours, and its false-alarm count over the full history.
8. Reproducibility proof: re-run the script a second time (cold shell, same input) and diff its JSON output byte-for-byte against the committed artifact.
9. **Decision gate recorded in DoD, not actioned here**: if some (N,T) in the grid achieves detection delay ≤24h AND false-alarm count ≤2 over the full history, the `.md` writeup states explicitly that a follow-up minimal production-liveness-check task is warranted. Filing that follow-up task is a separate action gated on this result — never bundled into this task or into a meta-driver.ts rewrite.

## Touches

- docs/analysis/meta-driver-self-health-backtest.mjs (new)
- docs/analysis/meta-driver-self-health-backtest.results.json (new)
- docs/analysis/meta-driver-self-health-backtest.md (new)
- tasks/gap-meta-driver-self-health-backtest.md

## AC

- [ ] `node docs/analysis/meta-driver-self-health-backtest.mjs --in .quay/meta-driver-round.jsonl --out docs/analysis/meta-driver-self-health-backtest.results.json` exits 0 and the output file is valid JSON: `node -e 'JSON.parse(require("fs").readFileSync("docs/analysis/meta-driver-self-health-backtest.results.json","utf8"))'` exits 0.
- [ ] The results JSON's top-level summary shows the real outage is represented (not an empty/degenerate run): `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/analysis/meta-driver-self-health-backtest.results.json","utf8")); process.exit((r.total_attempts>0 && r.total_failed>0) ? 0 : 1)'`.
- [ ] All 11 declared rule parameterizations (5 count-based N values + 6 time-window T values) are present: `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/analysis/meta-driver-self-health-backtest.results.json","utf8")); process.exit(r.rules.length>=11 ? 0 : 1)'`.
- [ ] Reproducibility: a second run with the same input produces byte-identical JSON: `node docs/analysis/meta-driver-self-health-backtest.mjs --in .quay/meta-driver-round.jsonl --out /tmp/rerun-meta-sh-$$.json && diff -q docs/analysis/meta-driver-self-health-backtest.results.json /tmp/rerun-meta-sh-$$.json`.
- [ ] `docs/analysis/meta-driver-self-health-backtest.md` states the headline rule's detection delay in prose: `grep -q "detection delay" docs/analysis/meta-driver-self-health-backtest.md`.
- [ ] `plugin/scripts/meta-driver.ts` is untouched by this task: `git diff --name-only HEAD -- plugin/scripts/meta-driver.ts` prints nothing（人工/落地流程核验，执行者本地用 `git status --porcelain plugin/scripts/meta-driver.ts` 自核空输出）.

## DoD

真实落地 = 上述三个产物文件随本任务提交进 develop，且 `results.json` 的数字是对 `.quay/meta-driver-round.jsonl`（gitignored，不随 commit 搬运）真实历史的直接读数，不是 fixture/构造样本——落地后审阅者在生产机上现场用 `grep` 核对 `outage_start_ts`/`last_verified_ts` 能在该文件里定位到对应行。本任务**不**决定是否上线生产 liveness check；那是一个独立、仅在本任务 DoD 第 9 步条件成立时才触发的后续任务，不在本任务范围内，也不得合并进本任务或任何 meta-driver.ts 重写。