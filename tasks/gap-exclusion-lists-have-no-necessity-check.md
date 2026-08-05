---
id: gap-exclusion-lists-have-no-necessity-check
title: AC1b's exclusion table only grows and nothing can discover an unnecessary
  entry — green is not the same as necessary
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

`plugin/test/loop-shipping.test.mjs` 的 AC1b 排除表（`excluded` 数组）**只增不减，
且没有任何东西能发现一条已经不必要的排除项**。

2026-08-04 一个会话里加了**两条**排除项：e2e 一条（必要）、inner-brief 一条
（不必要），**两条从外面看一模一样**。必要性的判据是「去掉它还绿不绿」——
而一次绿跑只证明绿，**不证明必要**（外层 03:40Z 实测：绿 ≠ 必要）。

本次实例：`orchestration/inner-brief-2026-08-04-restart.md` 的排除项在源已修
（`6e01329e` 把完整旧路径拆成目录+文件名分写）后成为**死重**——它不换来任何绿，
只让该文件对六条旧路径全部失明。这是被人在一次性 worktree 里**逐条实测**揪出来的；
**机制本身没有任何地方会报它**。

与本仓契约棘轮「名单只能变短但没有强制函数」**同一形态**：一个能无限增长、且没有
必要性强制函数的列表，靠的是「记得检查」，而「记得」已被本仓反复证明不可靠。

### 可机械检查的一半

「必要」的严格判据是「去掉它仍绿」——那需要真移除+跑套件，不是静态检查能做的。
但「**惰性**」的一半是可机械检查的：某条排除项的目标文件里，如果**根本不再包含
六条旧路径模式中的任何一条**，那这条排除项就**必然不换任何绿**（它没在抑制任何
命中）。这是能被一条静态检查抓到的确定性事实。

## Contract

```
measure inert_exclusions = `bash scripts/test.sh plugin/test/loop-shipping-necessity-check.test.mjs` 输出的 inert 条目数字段
measure exclusion_count = `grep -c "path.join(repoRoot" plugin/test/loop-shipping.test.mjs` 输出的计数字段
band inert_exclusions = 0
invariant 排除表不允许惰性条目——每条排除项必须有它抑制的命中，或写明为何保留
invoke `bash scripts/test.sh plugin/test/loop-shipping.test.mjs`
control 往某排除项目标文件注入一条旧路径活引用 ⇒ 该条必须不再被报为惰性（判定翻转）
resume 先抓出当前惰性条目，再加检查
```

## Chosen mechanism

加一个**惰性排除检测**：对 `excluded` 中每条文件级排除项，扫其目标文件对 6 条
旧路径模式的命中数；命中数 = 0 的排除项标记为惰性并**报出**。报告形态（报出阻断 vs
只报不阻断）待看到实际惰性数量后定，但检测本身必须在场。

**不做**：不声称能证明「必要」（去掉仍绿）——那仍需要真移除+实测。惰性检测只抓
「**必然不必要**」的确定性下界，不抓「可能不必要」的灰色地带。

## Acceptance Criteria

- [ ] AC1: 对当前排除表跑检测，**逐条报出惰性条目**（实跑贴出；若无则如实报零）
- [ ] AC2: 移除惰性条目后，检测对剩余条目零报告（实跑贴出）
- [ ] AC3: **负控制**——往某排除项目标文件注入一条旧路径活引用，该条**不再**被报为惰性（实跑贴出）
- [ ] AC4: 检测**报告而不只是存在**——构造一个惰性条目时它必须报出/退出非 0，不静默通过
      （与「一个从没红过的检查与永远返回空集不可区分」同一族）
- [ ] AC5: 测试用 `node:test` 且带恰当的 `// @test-group`
- [ ] AC6: 任务体记录本次实例（inner-brief 排除项死重被人工实测揪出）作为证据

## Definition of Done

- [ ] AC1 与 AC3 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：排除表没有必要性强制函数这件事被机械化，不再是「记得检查」

## Touches
- tasks/gap-exclusion-lists-have-no-necessity-check.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/test/loop-shipping.test.mjs
- plugin/test/loop-shipping-necessity-check.test.mjs（新）
- plugin/scripts/test-framework-policy-check.ts（如涉及新文件注册）

## Dispatch review

reviewer: outer
at: 2026-08-04T04:05:00Z
changed: **本条由内层立案，外层只补两处让它过闸，不改它的判断。**
内层是在外层 03:40Z 交回一个一般性问题后立的案——外层实测判定它新加的一条排除项是死重
（删掉那一行 AC1b 仍绿 `pass 12 / fail 0`），并指出**这张表只增不减、没有任何东西能发现一条已经不必要的排除项**。
**立案的判断是内层自己的，外层不改它的机制选择。**

**外层补的第一处（`measure inert_exclusions`）**：原文写的是自然语言口径
（「排除表中目标文件对 6 条旧路径模式零命中的条目数」），**人读得懂，检查器读不懂**——
它要的是一条能原样跑的反引号命令。这正是外层自己在 tick 文档 §0c 里记过、
并且**一小时内踩过三次**的同一个坑（`measure` 行必须自带完整反引号命令，哪怕与上一行逐字相同）。

**外层补的第二处（本段）**：`## Dispatch review` 缺失。

**为什么外层直接改而不是转达**：这两处违规把契约棘轮推到 `new since baseline: 2`，
而 `run_static_checks` 在 `scripts/test.sh` 里**先于测试运行且退出非 0 即阻断** ⇒
**整个套件跑不起来**。内层此刻正在 3a 的关键路径上跑第 5 次全量套件
（它 03:54:48 起跑、本文件 03:55:30 建立，**早 42 秒，所以那一次没被挡住**），
**但下一次必然被挡**，外层自己的单文件运行此刻已经被挡住。
**这是即时阻塞，不是风格问题。** 写 `tasks/` 前外层已按纪律核对：
在飞三条任务（finding / token / tmpfs）的 `## Touches` **均不含 `tasks/`**，不会与内层撞车。

**一条顺带的观察，交给本任务自己消化**：**棘轮抓到的第一个对象，是从「排除表没有必要性检查」
这个发现里长出来的任务本身**——一张只增不减的名单需要执行者，而这条任务正是在说另一张名单缺同样的东西。
