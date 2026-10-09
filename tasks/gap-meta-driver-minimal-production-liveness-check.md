---
id: gap-meta-driver-minimal-production-liveness-check
title: "meta-driver minimal production liveness check: standalone on-demand N=3
  detector, derived from the self-health backtest, scoped to avoid touching
  driver.ts/driver-runtime.ts"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增一个独立、零依赖的检查脚本，不 import/不改变任何生产包间依赖边，也不碰任何既有 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Proposal

`tasks/gap-meta-driver-self-health-backtest.md` (done) proved, against the real `.quay/meta-driver-round.jsonl` production history, that a trivial rule — N≥3 consecutive non-`verified` attempts, or T≥30m since the last `verified` attempt — detects a real semantic-half outage within under 1 hour with **zero false alarms** over the entire 53k-round history, versus the 27 days it actually took to go undetected. This task ships that exact rule as a standalone, invokable CLI checker.

**Explicit scope reduction, stated honestly up front** (so this task's AC do not silently overclaim): this check is implemented as a **standalone, on-demand CLI tool** — it is NOT wired into `quay driver status`'s automatic output (`packages/quay/src/cli/driver.ts` / `plugin/scripts/driver-runtime.ts`), and it does NOT register as a new `plugin/scripts/*.ts` capability (avoiding the capability-catalog/outline/laydown registration machinery that applies to shipped driver-facing scripts). Both of those files are heavily regression-tested (12+ `driver-runtime-s*.test.mjs` files) and a correct, validated change there needs the full ~20min suite run and its own dedicated review budget — attempting that here, under this task's own scope, risks an unvalidated change to shared production infrastructure. **Auto-wiring this verdict into `quay driver status`'s output is a legitimate, separate follow-up task, deliberately deferred — not done here.**

This task's own bar: ship a correct, tested, standalone tool that a human (or a future cron/task) can run right now to get the true liveness verdict — and prove it actually flags the real, still-ongoing production outage at landing time.

**Explicit non-goals**: no change to `plugin/scripts/meta-driver.ts`, no new driver kind, no change to `plugin/scripts/driver-runtime.ts` or `packages/quay/src/cli/driver.ts`, no automatic alerting/halting behavior, no bundling with any other meta-driver refactor.

## Plan

1. Write `docs/analysis/meta-driver-liveness-check.mjs`: a standalone script exporting `checkLiveness(attempts, { n })` (pure function: given a chronological list of `{ts,state}` attempts and an N threshold, returns `{ok, state: "healthy"|"degraded"|"not-evaluated", reason, lastVerifiedTs, consecutiveNonVerified}`), plus a CLI entry that reads `--root <dir>` (defaults carrier path to `<root>/.quay/meta-driver-round.jsonl`), extracts attempts the same way `meta-driver-self-health-backtest.mjs` does (both `meta-driver` and `meta-review` fact names — reusing that already-verified lesson, not re-deriving it), and exits 0 (healthy) / 1 (degraded, N≥3 consecutive non-`verified`) / 3 (not-evaluated: carrier missing/unreadable/empty).
2. Self-test mode `--self-test`: runs embedded fixtures covering healthy (3 verified in a row), degraded (3 consecutive non-verified), not-evaluated (missing/empty/malformed carrier), and a negative control (2 consecutive non-verified must NOT flag — proves the threshold is exact, not off-by-one), printing PASS/FAIL per case and exiting non-zero on any failure.
3. **Landing-time proof against the real live carrier** (the single most important AC — a check that cannot detect the currently-active real outage would be worthless): `node docs/analysis/meta-driver-liveness-check.mjs --root .` must report `degraded` right now, since the real outage (`tasks/gap-meta-driver-self-health-backtest.md`'s finding) is still ongoing in production as of this task's landing.
4. Write a short `docs/analysis/meta-driver-liveness-check.md` stating: what it checks, its two exit-code-relevant states, how to run it, and the explicit "not auto-wired yet" scope note from the Proposal, so a future reader doesn't assume more automation exists than actually does.

## Touches

- docs/analysis/meta-driver-liveness-check.mjs
- docs/analysis/meta-driver-liveness-check.md
- tasks/gap-meta-driver-minimal-production-liveness-check.md

## AC

- [ ] Self-test passes: `node docs/analysis/meta-driver-liveness-check.mjs --self-test` exits 0.
- [ ] Negative control holds: a fixture with exactly 2 consecutive non-`verified` attempts (one below the N=3 threshold) reports `healthy`, not `degraded` — checked as one of the `--self-test` cases, and independently confirmed via `node -e` constructing that exact fixture and calling `checkLiveness` directly.
- [ ] Not-evaluated is a real, distinguishable third state (not folded into healthy or degraded): `node docs/analysis/meta-driver-liveness-check.mjs --root /tmp/nonexistent-root-$$` exits 3.
- [ ] Landing-time real-carrier proof: `node docs/analysis/meta-driver-liveness-check.mjs --root .` exits 1 (degraded) against the actual live `.quay/meta-driver-round.jsonl` — the real outage must still be reported, not a stale/fixture result.
- [ ] `docs/analysis/meta-driver-liveness-check.md` explicitly states the "not yet wired into `quay driver status`" scope note: `grep -q "quay driver status" docs/analysis/meta-driver-liveness-check.md`.
- [ ] No shared production infrastructure touched: `git status --porcelain packages/quay/src/cli/driver.ts plugin/scripts/driver-runtime.ts plugin/scripts/meta-driver.ts` prints nothing.

## DoD

真实落地 = 上述两个产物文件随本任务提交进 develop；落地当刻对真实 `.quay/meta-driver-round.jsonl` 跑该脚本必须报 `degraded`（反映仍在持续的真实 outage，不是构造样本）。本任务**明确不**把这条校验接入 `quay driver status` 的自动输出或任何常驻 driver 循环——那是一个独立、需要跑完整 suite 验证的后续任务，本任务只交付一个正确、可独立运行、可重复的按需检查工具，诚实标注尚未自动化这一事实，不得在文档里暗示已经接入生产自动告警。