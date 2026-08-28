---
id: gap-verification-round-static-fail-no-record
title: verification-round 对未完整跑完的轮次结构性不落记录（静态闸 fail + 动态测试 fail 同族）——今天两例 0 记录 + 记录无 taskId 归因
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **前提修正（2026-08-25，pool-quality-judge should-remove → manager 复核 → 撤回 supersede → 再并入动态测试 fail 同族）**：本任务曾被我误判「前提证伪」而 supersede（f8fbf237），manager 复核后撤回并改精确前提（e8f56165）；后又并入 manager 新报的动态测试 fail 同族缺口。我两次没把「机制存在」与「机制今天触发」分开验——第一次照抄 manager 归因没核实前提，第二次信 judge「31 条存在=前提证伪」没查今天是否真触发。硬规则「verify 不 trust」同坑两次。

## Proposal

`verification-round.jsonl` 对**未完整跑完的轮次结构性不落记录**——同一族「某类失败在生产载体里结构性缺席，观测者据此误判为『没发生』」，两个已核实的子类：

1. **静态闸 fail**：`full-suite-runner.ts` 的 `isStaticCheckFailureLine → staticCheckDetected → reason="gate-failed"+gate="static-check"` 机制**存在且历史工作过**（31 条记录 08-12~08-24），但**今天 split-long 撞到的 spec-declaration-point-check 失败 0 记录**（`verification-round.jsonl` 今天 0 条 gate=static-check、0 条 spec-declaration-point gate-fail，而 split-long fan-in suite log 确实有 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1`）。正则 `/^STATIC_CHECK_FAILED:/` 本应命中，为何不触发待诊断。
2. **动态测试 fail**（manager 08-25 新报，我核实）：`gap-worker-driver-retry-cap-not-wired` 的真实测试断言失败（`resident loop does not exit`，5831.7ms，见 `/tmp/fan-in-suite-gap-worker-driver-retry-cap-not-wired.log.prev`）**在 `verification-round.jsonl` 和 `per-task-suite-records.jsonl` 里都是 0 条**——从未被 promote 成一条 round 记录，痕迹只留在 `/tmp/fan-in-suite-<task>.log`（fan-in 内部临时文件，非面向 web 正本）。`/tests` 页（`serve-tests.ts → readTests`）只读 verification-round.jsonl ⇒ 对这类失败盲。

3. **记录无 taskId 归因**：31 条历史 `gate=static-check` 记录的 `taskId` 字段**全部 None**——即便产生记录，也无法按 taskId 归因到具体任务。

**⊕ 顺带确认的旧坑**：`/tmp/fan-in-suite-<task>.log` 跨 relaunch 复用不轮转（已有 memory），这次能捞到证据全靠 `.log.prev` 旧副本，当前 `.log` 已被后续轮次覆盖——直接影响「事后能否查证一次失败」。

## Plan

诊断并修复「未完整跑完的轮次不落记录」的统一机制（manager 建议：`full-suite-runner.ts` 无论静态闸 / 动态测试哪一类导致轮次未完整跑完，都应落一条带 `reason` 的记录，而非只在 gate-failed 一种路径落）；并给记录补 `taskId` 归因。⛔ 两个子类可能同根（统一修法）也可能不同根（静态闸=检测漏、动态测试=fan-in 路径绕过），落笔方先诊断根因再改，不盲写别名掩盖「为何该走的路没走」。

## Acceptance Criteria

- [ ] AC1（能取假，静态闸 fail 落记录）：复现 split-long 的 spec-declaration-point-check 失败，`verification-round.jsonl` 出现对应 `gate=static-check` 记录（failures[] 含 checker 名）；（⛔ 仍 0 记录 ⇒ 假）。
- [ ] AC2（能取假，动态测试 fail 落记录）：复现 retry-cap 的真实测试断言失败（`resident loop does not exit`），`verification-round.jsonl` 出现带 `reason` 的记录（不再只留 `/tmp/fan-in-suite-<task>.log`）；（⛔ 仍 0 记录 ⇒ 假）。
- [ ] AC3（能取假，taskId 归因）：上述记录 `taskId` 非 None（能归因到具体任务）；（⛔ 仍 None ⇒ 假）。
- [ ] AC4（能取假，不回归）：31 条历史记录（08-12~08-24）不变形、机制对其它静态闸（如 direct-to-develop-bypass-check）仍正常落记录；（⛔ 回归/历史变形 ⇒ 假）。

## Definition of Done

未完整跑完的轮次（静态闸 / 动态测试）统一落带 `reason` + `taskId` 的记录；AC1-AC4 全勾；split-long 与 retry-cap 两场景回放可区分「没跑」vs「跑了但失败」且可归因。

## Touches

- plugin/scripts/full-suite-runner.ts（未完整轮次统一落记录 + taskId 归因）
- plugin/scripts/pre-verified-round-record.ts（verification-round 记录写入方，fan-in 桶路径 + taskId 字段）
- tasks/gap-verification-round-static-fail-no-record.md（自身）
