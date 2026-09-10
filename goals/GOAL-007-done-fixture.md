---
id: GOAL-007
title: done 任务的判据后来变假时，没有任何机制会重新评估——三例实测，且常驻测试因 fixture 钉住前提而恒绿
status: achieved
kind: goal
origin: >
  【提请裁定，2026-09-07，draft — 激活权归人（裁定 3）】


  问题：一条 task 翻 done 之后，它的判据【再也不会被重新评估】。当判据当年成立所依赖的前提后来变了，任务仍是
  done、常驻测试仍全绿、而缺陷正在生产上流血——三者可以同时为真，且没有任何机制会报出来。


  【实测三例，全部 status: done，全部由人手工发现（非机制发现）】


  ① gap-fan-in-ff-retry-counter-scope
     其 AC2 逐字写着取假条件：「⛔ 历史失败 2 次的任务在新 dispatch 第 1 次就被锁 ⇒ 假」。
     该条件此刻成立：gap-bypass-check-unclassifiable-exits-zero 在相隔数小时、developHead 各不相同的
     独立派发周期里走到 attempt 8，而闸是 >= 3。
     前提变更：当年 runId 是 fm-<task>-<epoch>-<rand>（每次 dispatch 一个），现在是 wk-prod-<epoch>
     （每个驱动进程一个）。载体证据：.quay/fan-in-retries.jsonl 242 条 / 137 个 runId，旧形态单 runId
     最多 6 条（在 3 次预算内），wk-prod-1788717081 单 runId 31 条、横跨 7 个任务。
     代价：立案时 7 条中 5 条已永久闩锁，每周期只剩 1 次 ff 机会而非 3 次。

  ② gap-suite-load-sampler-orphan-process
     落地于 08-27 09:12；孤儿进程起于 08-29 21:07（晚 2.5 天），存活 8.3 天、cwd 为已删除的 worktree、
     写 /tmp/fsr-abort-*（full-suite-runner 中止路径）。2026-09-07 由人手工清掉。
     ⇒ 不是修复前的遗留，是修复未覆盖的路径。

  ③ gap-direct-to-develop-bypasses-fan-in-gates
     done 而缺陷仍在，已被 gap-bypass-check-unclassifiable-exits-zero 的任务体逐字记为「假完成」。

  【为什么长期不被发现——这一半是机械可查的，不是推测】


  常驻测试恒绿，因为它的 fixture 把【前提本身】钉死了。以 ① 为例，plugin/test/fan-in-ff-merge.test.mjs

  覆盖 attempt 递增与 escalation 的用例（:202 / :234 / :315）全绿，而它们喂进去的 runId 是：
      "--run-id", "fm-res-1786"                     (:214)
      assert.equal(rec.runId, "fm-gap-x-17866", …)  (:293)
  全是旧的 fm-* per-dispatch 形态，生产喂的是 wk-prod-<epoch>。

  ⇒ 这些用例【结构上不可能】发现该缺陷。硬规则④推论三（只能被 fixture 满足的判据不是测量）＋

  4c（判据的量须穿过所有中间层）的合体，而这次的中间层是【时间】：前提在实现落地之后才改变。


  【层级不对称——问题的结构定位】


  goal 层【有】再评估：goal-driver 每轮（约 42 秒）对每条 active AC 跑 gateCriterion，产出 pass/fail，

  achieved 与 fail 的分歧会被报为 achieved-but-failing。

  task 层【没有】任何等价物：extra.acceptance 只在 fan-in 当轮跑一次，此后再不重跑；

  「能取假」的负控制在当轮验证一次即被丢弃，不成为常驻判据。

  ⇒ 同一个洞在两层都存在，但 goal 层至少能【看见】它（已立 gap-goal-achieved-but-failing-no-handler

  补其处理者），task 层连检测者都没有。


  【成本约束——任何修法都要先过这一关】


  不能「周期性重跑所有 done 任务的 acceptance」：任务数以百计，且多数 acceptance 是 suite 规模的命令。

  硬规则④推论一：成本结构未知前不设数值阈值——所以本条也【不】预设采样率或周期。


  【请裁的是方向，四条候选（不排序，不预设推荐）】


  甲 撰写纪律：凡写「能取假」的 AC，其取假条件必须成为一条常驻测试，且该测试喂的值必须是【生产实际形态】。
     代价最低、不新增机制；但守与不守在记录上无法区分 ⇒ 硬规则⑨：这类规则应当造产物，而不是写得更醒目。
  乙 机械对照：对被点名的前提，比对测试 fixture 取值与生产载体取值，不一致即报。
     能取假、有产物；但「被点名的前提」如何登记本身是个新契约。
  丙 task 层再评估：仿 goal-driver，对【子集】的 done 任务重跑判据（触发条件而非周期：如该任务 Touches
     的文件自落地后发生过变更）。有先例、形态清楚；但要先解决成本与选择判据。
  丁 不修：承认 task 层判据是一次性的，把需要长期保证的东西一律上移到 goal 层 AC（那里已有再评估）。
     这是一个正当选项——它把「哪些保证值得长期维持」变成一个显式选择，而不是默认全都维持。

  【为什么是 GOAL 而不是 task】


  发生率 3 已过阈值（硬规则⑫），但修法可能落在撰写纪律、判据模板、或一个跨任务的再评估机制上，

  Touches 结构上写不出来；硬凑一个具体 Touches 立成 task 会违反「立案 Touches 须具体」。

  按载体规则：跨多个机制、需要新契约的方向 → draft GOAL → 人激活。


  【已就地处理、不在本条范围内的】

  - ① 的具体修法已立 gap-ff-retry-counter-runid-no-longer-per-dispatch（ready），其 AC
  含「测试改用
    生产形态 runId，并断言同一 wk-prod-* 下两次派发互不累计——该断言在改动前必然为红」。
  - goal 层的 achieved-but-failing 无处理者已立
  gap-goal-achieved-but-failing-no-handler（ready）。

  - ② 的孤儿已手工清除；其复发路径（abort 分支）未单独立案，发生率 1，按硬规则⑫记为观察项。
---

## 背景

一条 task 翻 done 之后，它的判据【再也不会被重新评估】。当判据当年成立所依赖的前提后来变了，任务仍是 done、常驻测试仍全绿、而缺陷正在生产上流血——三者可以同时为真，且没有任何机制会报出来。实测三例（全部 status: done，全部由人手工发现而非机制发现）：① gap-fan-in-ff-retry-counter-scope（runId 由 fm-* per-dispatch 变为 wk-prod-* per-driver，闸被闩锁）② gap-suite-load-sampler-orphan-process（修复未覆盖的路径，孤儿存活 8.3 天）③ gap-direct-to-develop-bypasses-fan-in-gates（假完成）。常驻测试恒绿是因为 fixture 把【前提本身】钉死——喂进去的 runId 全是旧形态，结构上不可能发现该缺陷。

## 范围与非目标

层级不对称：goal 层【有】再评估（goal-driver 每轮对每条 active AC 跑 gateCriterion，achieved-but-failing 会被报出），task 层【没有】任何等价物。成本约束：不能「周期性重跑所有 done 任务的 acceptance」（任务数以百计、多数是 suite 规模）。

请裁的是方向，四条候选（不排序、不预设推荐）：甲 撰写纪律；乙 机械对照（比对 fixture 取值与生产载体取值）；丙 task 层再评估（触发条件而非周期）；丁 不修（把长期保证上移到 goal 层 AC）。

不在本条范围（已就地处理）：① 的具体修法已立 gap-ff-retry-counter-runid-no-longer-per-dispatch（ready）；goal 层 achieved-but-failing 无处理者已立 gap-goal-achieved-but-failing-no-handler（ready）；② 的孤儿已手工清除，复发路径发生率 1 记为观察项。

## 退出条件

提请裁定（激活权归人）done-task 判据再评估缺失的修法方向（四条候选）。现已裁定并就地处理——具体修法分别立 task 就位，status 现为 achieved。
