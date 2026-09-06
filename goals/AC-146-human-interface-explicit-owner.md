---
id: AC-146
title: 人机接口必须有【显式承接者】
status: active
kind: criterion
goal: GOAL-002
origin: |
  manager 09:2xZ 直读：driver 不能 AskUserQuestion；取消 outer 后到达人的通道只剩 needs-human
  状态 + escalations.md。该通道当前已实际堵塞——.quay/promotion-outcome.jsonl 里
  action="needs-human" + retry-cap-exhausted 已 3 条（3 个真实任务被打成 needs-human），
  而这件事没有任何一个界面主动让人看见，是 manager 巡检时才发现的。
evidence:
  at: 2026-09-06T09:44:29.929Z
  verdict: fail
  reading: AC-146 has no criterion defined (fail-closed — an unenforceable AC must
    never silently pass)
---

**判据（能取假）**：一条 `needs-human` 产生后，人**在不读任何 transcript 的前提下**能从一个
可查界面看到它（web/文件/通知，形态落笔方定）。

**取假**：产生一条 needs-human，而人只能靠翻 transcript 或靠 manager 转述才知道 ⇒ 假。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
