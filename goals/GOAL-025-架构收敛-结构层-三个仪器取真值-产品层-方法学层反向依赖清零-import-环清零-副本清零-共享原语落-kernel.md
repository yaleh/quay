---
id: GOAL-025
title: 架构收敛（结构层）：三个仪器取真值、产品层→方法学层反向依赖清零、import 环清零、副本清零、共享原语落 kernel/、catalog 声明表数据化
status: active
kind: goal
origin: 人 2026-09-19 两轮对话：①对 quay 做 archguard 架构分析并补充未覆盖部分；②检查 .sh 层，相信其中许多应集成入
  .ts 以构建更紧凑架构；③按 SPEC-architecture-consolidation-ts-and-shell-2026-09-19
  立案，Phase 0 三个 task 已立（gap-arch-import-graph-check / gap-arch-sh-census-check /
  gap-arch-coverage-self-report）；同日四条裁定（kernel/、控制面 shell 暂保留、experiments
  副本先改符号链接、verify-deliver-coldstart 不立案）。
activatedAt: 2026-09-19T05:30:42.502Z
statusLog:
  - at: 2026-09-19T05:30:42.503Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-19 对话中明确指示「先立 Phase 0 的三个 task，再建 GOAL 并激活（单次授权）」；8 条
      AC（AC-304~AC-311）已就位且判据均为读本地检查器输出的轻量形态，今天逐条实跑均为 exit 1 并带
      CAUSE=（能取假），桩检查器下通过/失败/未评估三支各 18/18 符合预期。
---
## 背景

2026-09-19 对 quay 做了一次架构复盘（archguard 分析 + 对 .ts / .sh 的补充测量），结论是：**骨架是对的（`packages/quay` 包级零环、ABI 收敛在低扇出叶子上），松散在三处**——①shell 层里有约 1.3 万行「以 bash 为壳、内嵌 python/node/jq 为实」的程序，并有字节相同的重复副本；②产品层 `packages/` 反向 import 方法学层 `plugin/`（5 条边、4 个符号）；③分析仪器自己有盲区：archguard 默认 global scope 只指向 `packages/quay/src`，对 `plugin/scripts` 报「0 环」而自写 import 图在同一批文件里算出 3 个文件级 SCC（1 值级 + 2 类型级）。

正本 SPEC：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（⚠️ 写本 GOAL 时该文件位于分支 `worktree-spec-architecture-refactor`，尚未合入 develop；本 GOAL 与各 AC 正文自足，不依赖读到它）。

本 GOAL 是 SPEC 的**第一个 GOAL（结构收敛与棘轮，对应 SPEC Phase 0–4）**；SPEC §10 已论证「GOAL 装结果与长期保证、task 装工作单元，且按阶段拆成两个 GOAL」。第二个 GOAL（shell 层 TS 化，Phase 5）待本 GOAL 落地、Phase 0 基线出来后再立——它的量化阈值在基线前不可定（硬规则 4 推论）。

## 范围与非目标

范围（每项对应一条 AC）：
①三个仪器落地并在真实仓库上取到有效读数、且能取假——`import-graph-check`（AC-304）、`sh-census-check`（AC-305）、`arch-coverage-report`（AC-306）；
②`packages/**` → `plugin/**`/`experiments/**` 的反向 import 边清零（AC-307）；
③值级与类型级 import 环清零（AC-308）；
④`packages/quay/src/kernel/` 建立并被消费（AC-309，落点由人 2026-09-19 裁定）；
⑤`experiments/` 与 `plugin/` 之间字节相同的非链接副本清零，处理方式是改符号链接而非删除（AC-310，人 2026-09-19 裁定）；
⑥`capability-catalog.sh` 的声明表离开 bash、入口保留（AC-311）。

非目标（⛔ 每一项都是有意排除，不是遗漏；充分性闸据此判退出条件是否被 AC 覆盖）：
- **Phase 1b/1c/1d**（无调用者 sh 退役、24 个薄包装的调用方改直调、根目录杂物归位）：由 task 承担，**不进 AC**——「无调用者」是静态字符串匹配候选而非结论，删除前须动态引用核对，没有可机械判定的单调终点。
- **Phase 5 shell 层 TS 化**（`integration-batch-merge`/`develop-deliver-tgz`/`quay-init`（已有 `gap-quay-init-native-reconcile`）等）：属第二个 GOAL。
- **约 1200 行 tmux/supervisor 控制面 shell**（`send-keys-reliable`、`supervisor-*`、`process-budget`）：人 2026-09-19 裁定「暂时保持 bash 现状，长期考虑退役」。
- **`verify-deliver-coldstart.sh`（9111 行）**：人 2026-09-19 裁定「列入路线图但先不立案，等前几步落地后按实测成本再裁定」。
- **Phase 6 巨型 TS 模块拆分**（`observation.ts`、`worker-driver.ts` 等）：无可判的单调终点，且**行数不是判据**（易被刷）；走「先调查任务、后拆分任务」的既有模式。
- 不改 Provider ABI 与公开 CLI/MCP 表面。

## 判据形态

- 所有判据读**真检查器在真实仓库根的输出**（不是 fixture）；检查器不存在或未评估时判据一律 exit 1，⛔ 不是 0（硬规则 3b）。
- 会回升的量（AC-307~311）带 `long-term: true`，达成后由复验域每轮复验（goal-mechanism §12b）；三个仪器落地条（AC-304~306）建成即不撤销，不带。
- 判据均为「读本地检查器输出 + 静态断言」的轻量形态，⛔ 不是 suite 规模命令（goal-mechanism §11 成本边界）。
- 主防线在同步侧：Phase 0 的检查器同时接入 `scripts/test.sh` 静态层，回升在 fan-in 那一刻就变红；本 GOAL 的 `long-term` AC 是后备（覆盖绕过 suite 的直改）。

## 退出条件

8 条 AC 全部 achieved：AC-304/305/306（三个仪器在真实仓库根取到有效读数，且 `--selftest` 的注入用例能取假）；AC-307（反向 import 边 = 0）；AC-308（值级 SCC = 0 且类型级 SCC = 0）；AC-309（`kernel/` 已建立且被至少 3 个文件消费）；AC-310（字节相同的非链接重复副本 = 0）；AC-311（capability-catalog 声明表已离开 bash 且 `--summary` 入口仍工作）。
