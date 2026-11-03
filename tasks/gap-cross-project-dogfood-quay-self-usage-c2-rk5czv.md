---
id: gap-cross-project-dogfood-quay-self-usage-c2-rk5czv
title: "[cross-project dogfood] Quay's meta-driver re-emits the same
  take-develop rejection every tick with no debounce or human escalation, so
  one…"
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-771863-1793687392142-rk5czv` read the real usage artifacts of source project `quay-self-usage` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: Quay's meta-driver re-emits the same take-develop rejection every tick with no debounce or human escalation, so one dirty worktree freezes sync for 30+ min.

**Quay-side components**: `plugin/scripts/meta-driver.ts`, `plugin/scripts/driver-filters.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `/data/home/yale/work/quay/tasks/gap-meta-call-author-develop-take-develop-30.md:16` — 选项与代价：A 保持每 tick 重拒… B 按状态变化消抖… C 消抖+升级：连续 N 次同因拒绝后写 META/needs-human 信号，闭合冻结盲区
- `/data/home/yale/work/quay/tasks/gap-meta-call-author-develop-take-develop-30.md:19` — syncHealth.semanticTakeDevelopRefused = 7（meta-driver 机械采集）…全部来自同一次 .mcp.json 脏工作树事件
- `/data/home/yale/work/quay/plugin/scripts/driver-filters.ts:911` — reset 前先枚举工作树；有任何 reset 会破坏的状态 ⇒ 拒绝

- round: `cpd-771863-1793687392142-rk5czv` (record `cross-project-dogfood@cpd-771863-1793687392142-rk5czv::c2`)
- source project: `quay-self-usage`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Acceptance Criteria
- [ ] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [ ] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-cross-project-dogfood-quay-self-usage-c2-rk5czv.md`
