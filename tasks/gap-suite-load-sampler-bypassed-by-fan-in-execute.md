---
id: gap-suite-load-sampler-bypassed-by-fan-in-execute
title: suite-load-sampler 被 AC84 fan-in 直跑绕过 ⇒ web /tests 负载曲线断供 5+ 小时（数据源断供，非渲染坏）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 09:5xZ 实测，直接量非猜测）**：`suite-load-sampler.ts` 全仓只被 `full-suite-runner.ts` 一处调用。AC84（outer 不再跑 suite，fan-in 直跑接管）落地后，几乎所有套件轮次走 `.claude/workflows/fan-in-execute.js` 的 `setsid bash scripts/test.sh`（不经 full-suite-runner.ts，见 fan-in-execute.js:103-105 注释），sampler 再没被主路径调用——它没坏，被架构迁移绕过了，没人回头接新线。

**实测**：`.quay/suite-load-*.jsonl` 最后写于 08-24 04:18-04:35（断供 5+ 小时）；verification-round.jsonl runId 前缀分布：fm-（fan-in 直跑，无 load 样本）252 条 vs UUID（full-suite-runner，有 load 样本）12 条。`renderLoadCurveSvg()`（packages/quay/src/serve-handlers.ts:2575）行为正确（无样本返回空串优雅省略），**不是渲染坏，是数据源断供**。web 服务进程代码不陈旧（serve-handlers.ts 自其启动以来零变更），重启服务端换不来数据，修法必须在数据源。

## Plan

把 suite-load-sampler 的采样调用接到 fan-in-execute 的 detached 直跑那一刻（`setsid bash scripts/test.sh` 启动时同起 sampler，套件结束时停），恢复负载曲线数据源。⛔ 不经 full-suite-runner.ts（那正是被绕过的路径）。

## Acceptance Criteria

- [ ] AC1（能取假，数据源恢复）：fan-in-execute 直跑套件时，`.quay/suite-load-*.jsonl` 产生新样本（⛔ 一轮直跑后仍无新样本 ⇒ 假）。
- [ ] AC2（能取假，非渲染假象）：web `/tests` 负载曲线区块有可绘制样本（⛔ 空串省略 ⇒ 假）。

## Definition of Done

sampler 接线到 fan-in-execute detached 直跑落地 develop；AC1-2 全勾；一轮 fan-in 直跑套件后负载曲线数据源恢复（AC1 复现），web 区块重新有曲线。

## Touches

- .claude/workflows/fan-in-execute.js（detached 直跑时起/停 sampler）
- plugin/workflows/fan-in-execute.js（双拷贝同步，workflows-dual-copy-drift-check）
- plugin/scripts/suite-load-sampler.ts（如需适配直跑调用）
- plugin/test/fan-in-execute-paths.test.mjs（或对应测试）
- tasks/gap-suite-load-sampler-bypassed-by-fan-in-execute.md（自身）