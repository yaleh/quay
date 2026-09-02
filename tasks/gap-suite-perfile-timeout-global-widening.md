---
id: gap-suite-perfile-timeout-global-widening
title: perfile-timeout gate 名误称（passed=false 是真实失败非超时）——全局更正为 perfile-failure，止住「超时类」系统性误诊
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

「flaky 集群 10 组中超时类」（runner-grouping 78s / session-liveness 260s）的根**不是**「并发 16 核下测试超 60s perfile-timeout 阈值」——**这个 60s 阈值不存在**。`perfile-timeout` 是一个【误称】：它匹配 `__PERFILE__ ... passed=false`，而 `passed=false` 来自 `measure-suite-reporter.mjs` 透传 node test runner 的 `details.passed`——即「该文件有**真实失败的测试**」，不是「超时」。`duration_ms` 是「文件总墙钟」不是「超时触发点」；driver 271s / vendor 425s 都 `passed=true` 证明不存在 269s/425s 的超时闸（memory `perfile-timeout-gate-name-misleads`）。

**系统性误诊的机制**：看到 `__PERFILE__ duration_ms=269193 ... passed=false` 会被 gate 名误导成「per-file 超时（load-sensitive）」→ 按「超时类」立案（已 10 组），逐条加超时/拆分/白名单是治标。**真正的根是 gate 名**——它让每个工程师对「真实失败」反复误判为「超时」（前例 `gap-runner-grouping-list-groups-perfile-timeout-flaky` 实测：78s 的根是 transient 跨文件竞态，非超时）。

**修案更正（根因非超时）**：把 gate 名 `perfile-timeout` 更正为 `perfile-failure`（真实失败）。原「双层阈值（下层放宽 + 上层守卫）」方案作废——它是为「不存在的 60s 阈值」设计的；放宽/加守卫会造一个「恒绿检查」掩盖真实失败（硬规则 3b）。真实慢测试的回归信号由 `duration_ms`（per-file 墙钟历史，gap-test-detail-perfile-duration-failed 已落地）承担，不是这个 gate 的职责。

## Plan

1. 更正 gate 名：`runner-red-parse.ts` 的 `GATE_SCAN_FAILURE_LINES` 中 `"perfile-timeout"` → `"perfile-failure"`（唯一 truth 源），并改误称注释。
2. 同步全部 live 引用：`full-suite-runner.ts`（gate 注释 ×2）、`full-suite-runner-phases.test.mjs`（测试名 + 断言）、`capability-catalog.sh`（runner-red-parse.ts 目录描述）。
3. 验证：`__PERFILE__ passed=false` 红轮（fail=0）记录 `gate='perfile-failure'`；live 源码中不再有把 gate 名写作 `perfile-timeout` 的引用（仅剩历史轮记录 + 把「perfile-timeout」当作误称来引用的注释/文档）。

## Acceptance Criteria

- [x] AC1（能取假，gate 名更正）：`__PERFILE__ passed=false` 红轮（fail=0）的 round record `gate='perfile-failure'`（不再 `perfile-timeout`）——单测 `full-suite-runner-phases.test.mjs` 断言 `rec.gate === "perfile-failure"` 通过；（⛔ record 仍记 `perfile-timeout` ⇒ 假）。
- [x] AC2（能取假，无 live 残留）：live 源码（`runner-red-parse.ts` / `full-suite-runner.ts` / `full-suite-runner-phases.test.mjs` / `capability-catalog.sh`）中把 gate 名写作 `perfile-timeout` 的 live 引用清零——只剩历史轮记录 + 把「perfile-timeout」当作误称来引用的注释/文档（如 `runner-grouping-list-groups.test.mjs` 的历史注释、`perfile-timeout-gate-name-misleads` memory 名）；（⛔ 仍有把 gate 名写作 `perfile-timeout` 的 live 引用 ⇒ 假）。

## Definition of Done

`perfile-timeout` gate 名误称更正为 `perfile-failure`（passed=false = 真实失败非超时）落地；AC1/AC2 勾；`full-suite-runner-phases.test.mjs` 相关单测绿；live 源码无 `perfile-timeout` gate 名残留。

## Touches

- plugin/scripts/runner-red-parse.ts（gate 名 perfile-timeout → perfile-failure）
- plugin/scripts/full-suite-runner.ts（gate 注释同步）
- plugin/test/full-suite-runner-phases.test.mjs（断言 gate 名）
- plugin/scripts/capability-catalog.sh（目录描述同步）
- tasks/gap-suite-perfile-timeout-global-widening.md（自身）
