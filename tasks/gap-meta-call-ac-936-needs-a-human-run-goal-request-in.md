---
id: gap-meta-call-ac-936-needs-a-human-run-goal-request-in
title: AC-936 needs a human-run goal request in the main checkout
status: needs-human
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding
AC-936 的判据要求主检出 `.quay/goal-requests.jsonl` 里至少一条被 driver 消费的请求，而 worker 的写守卫禁止把主检出当作写目标、goal-driver 又把该 AC 判为 world-gated 不派活 ⇒ GOAL-914 的收尾停在一次人工动作上。这份证据应该由谁产生？

**要人裁决的是什么**：AC-936 needs a human-run goal request in the main checkout
**选项与代价**：① 人工/manager 在主检出跑一次 `quay goal request GOAL-914 AC-936 --reason '<why now>'`，下一轮 goal-driver 消费即转绿；代价=一次人工动作，但证据仍是外部真实请求；② 让 goal-driver 在世界门控时自己提交一条请求；代价=AC 的证据变成自产，driver 用自己的运行造出证明自己机制的载体，此后真请求与自产请求不可区分；③ 放宽 AC-936 判据接受 worktree 证据；代价=直接废掉 AC-938/AC-941 刚建立的『绿必须来自落地后的生产写入』
**为什么机器不能自决**：机器不能自决：①/②/③ 的差别不是实现选择，而是『这条判据还要不要能取假』——② 让 driver 自己造出证明自己机制的载体（硬规则 4：结构上不可能取假的量不是测量），③ 让 worktree 的一次性证据重新算数（AC-938/AC-941 正是为杜绝它而立的否证条件）。本轮读数为 fail，timeSeries `goal:AC-936:verdict` 已连续 50 轮 unchanged=fail、crossed=true（threshold 8）；证据文档把 ① 写成预期，同一段又承认主检出载体不存在，与 GOAL-914 命题『推进不应依赖人』相抵。
**若机器自行选错，什么难以撤销**：若机器自行选 ②（driver 自产请求），此后 `.quay/goal-requests.jsonl` 再也分不清真外部请求与自产请求，AC-936 的证据永久失去取假能力——这种污染不会自愈，只能靠人事后重造载体与判据；③ 一旦落地，AC-938/AC-941 建立的『生产载体』纪律就被同一份判据自己撤回。
**实测依据**：`criteria.AC-936.verdict` = "fail"（meta-driver 机械采集于 2026-11-06T20:04:49Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `docs/evidence/2026-11-06-goal-request-queue.md`：「它由第一个真正调用该动词的人创建。worker 的写守卫禁止把主检出路径当作写目标」
- `goals/GOAL-914-goal-driver-自驱闭环-立案生命周期-下一步投影与请求消费-quay-native.md`：「结果是：goal 的推进仍然依赖人读 round fact、人写任务、人恢复卡住的任务。」

## AC（draft）
- [ ] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [ ] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [ ] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [ ] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Touches
- `goals/AC-936-goal-request-队列-提交-消费-幂等.md`
- `plugin/scripts/goal-driver.ts`
- `docs/evidence/2026-11-06-goal-request-queue.md`
- `tasks/gap-meta-call-ac-936-needs-a-human-run-goal-request-in.md`