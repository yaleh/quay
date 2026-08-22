---
id: gap-bucket-subset-tmux-leak-scan-missing
title: bucket 子集路径补 suite-tail 泄漏扫描（tmux-leak-scan --snapshot/--check + session-liveness-sweep-kill）——降频 violation
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac126-suite-bucket-execution-enable-wiring
---

**type:** execution

## Proposal

**来源**：inner 观察 + manager 2026-08-22 裁决「须跑，另立 follow-up（不进 AC126）」。

**判据**：`tmux-leak-scan --check` 是**检查器**（suite-tail 残留泄漏断言，真缺陷类「测试泄漏 tmux server/temp dir ⇒ 主资源压力与崩溃」，见 gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause），且是**每轮语义**非「全量专属」——`--snapshot`（本轮前基线）/`--check`（本轮新增即泄漏）的 delta 对，桶子集跑真测试同样会漏。桶路径跳过它 = 该检查器在桶轮上从「每轮跑」变「从不跑」= **降频**，违反人②「本阶段是选桶不是降频」+ 阶段目标非目标「⛔ 不因省时降低任何检查器执行频率」。

**为什么 inner 执行**：改 bucket 子集路径（scripts/test.sh / full-suite-runner.ts）属产品代码 → inner 域。

## Plan

1. 桶路径补 suite-tail 泄漏扫描：`tmux-leak-scan --snapshot`@子集起 + `--check`@子集末，**伴生 `session-liveness-sweep-kill.mjs`（best-effort catch-all）一并补**——两者同属 suite-tail 块、同被跳过。
2. 负控制：桶轮注入泄漏 ⇒ 仍出 `tmux-leak-scan: FAIL`（机械核：桶路径含 `--check` 调用）。
3. fan-in（AC78 workflow）land。

## Acceptance Criteria

- [x] AC1: 桶路径（bucket 子集）含 `tmux-leak-scan --snapshot`/`--check` 调用 + `session-liveness-sweep-kill.mjs`（两者同补，不再跳过）。
- [x] AC2: 负控制——桶轮注入泄漏 ⇒ 仍出 `tmux-leak-scan: FAIL`（机械可核）。

## Definition of Done

- [x] 桶子集路径补齐 suite-tail 泄漏扫描 + 负控制通过；AC1-2 全勾；land 到 develop。

## Touches

- scripts/test.sh（桶路径补 suite-tail 泄漏扫描）
- plugin/scripts/full-suite-runner.ts（若涉桶路径 suite-tail 块）
- tasks/gap-bucket-subset-tmux-leak-scan-missing.md（自身）
