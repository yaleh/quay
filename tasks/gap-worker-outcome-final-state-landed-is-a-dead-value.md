---
id: gap-worker-outcome-final-state-landed-is-a-dead-value
title: worker-outcome.final_state 的 landed 是只出现过 1 次的死取值——按它统计吞吐会读成「吞吐≈0」
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`.quay/worker-outcome.jsonl` 全库 1,896 条记录里，`final_state == "landed"` 只出现过 **1 条**
（2026-08-28T04:51:48.946Z，任务 `gap-suite-force-color-ansi-test-sh-normalize`）。当前真实的
成功终态是 `completed`（实测 09-13 当天 45 条，同日 git 上 `翻 … done` 的落地 48 次，两者接近），
未落地态是 `exited-not-landed`（全库 1,111 条）与 `failed`（100 条）。

**危害形态**：任何消费者若按 `final_state == "landed"` 统计吞吐，会得到「吞吐 ≈ 0」——
一个与「系统完全停摆」同形的读数（硬规则 3b：取值读错 ⇒ 输出与某个正常/异常状态同形，
且不可区分）。本次定量复核的作者本人就在初稿里栽了这一跤，见
`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §6 第一行。

## Touches

- `plugin/scripts/worker-driver.ts`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md`

## Acceptance Criteria

- [ ] 枚举 `final_state` 的**全部**写入点（grep 命中数 + 前 3 条实际内容 + 文件:行号），
      判定 `landed` 是否还有活写入路径；写不出这个清单视为未完成。
- [ ] 二选一并落地：①机械 fan-in 真正落地后写 `landed`，且任务体写明 `completed` 与 `landed`
      的语义差别；②或从写入面与取值表中**移除** `landed`，并在载体 schema/文档里明确
      成功态就是 `completed`。⛔ 不接受两者都不做。
- [ ] 取一个**真实**已落地任务，验证其 worker-outcome 记录的 `final_state` 能与
      `exited-not-landed` 区分；给出负控制：取一个真实未落地任务，其取值必须不同。
- [ ] 修复后连续 ≥3 天的生产记录里，成功态计数与同期 git `翻 … done` 落地数的偏差 <10%，
      读数与命令行贴进任务体。

## Definition of Done

读数取自**生产载体** `.quay/worker-outcome.jsonl`，不接受 fixture 满足（把注入 seam 关掉后
AC 仍应成立）。若选择方案②（移除死取值），必须同时 grep 全仓确认没有消费者还在读 `landed`
（含测试、文档、web 面），命中数与清单贴进提交——硬规则 5b：兄弟实例常在同一层。
