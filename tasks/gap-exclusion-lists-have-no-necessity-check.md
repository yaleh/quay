---
id: gap-exclusion-lists-have-no-necessity-check
title: AC1b's exclusion table only grows and nothing can discover an unnecessary
  entry — green is not the same as necessary
status: done
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
measure inert_exclusions = `bash scripts/test.sh --scoped plugin/test/loop-shipping-necessity-check.test.mjs` 输出的 inert 条目数字段
measure exclusion_count = `grep -c "path.join(repoRoot" plugin/scripts/loop-shipping-exclusion-data.mjs` 输出的计数字段
band inert_exclusions = 0
invariant 排除表不允许惰性条目——每条排除项必须有它抑制的命中，或写明为何保留
invoke `bash scripts/test.sh --scoped plugin/test/loop-shipping.test.mjs`
control 往某排除项目标文件注入一条旧路径活引用 ⇒ 该条必须不再被报为惰性（判定翻转）
resume 先抓出当前惰性条目，再加检查
```

## Chosen mechanism

加一个**惰性排除检测**：对 `excluded` 中每条文件级排除项，扫其目标文件对 6 条
旧路径模式的命中数；命中数 = 0 的排除项标记为惰性并**报出**。报告形态（报出阻断 vs
只报不阻断）待看到实际惰性数量后定，但检测本身必须在场。

**不做**：不声称能证明「必要」（去掉仍绿）——那仍需要真移除+实测。惰性检测只抓
「**必然不必要**」的确定性下界，不抓「可能不必要」的灰色地带。

**执行落定（2026-08-05）**：
- **名单搬家**：`excluded` + 6 条旧路径从 `loop-shipping.test.mjs` 内联搬进
  `plugin/scripts/loop-shipping-exclusion-data.mjs`（单一事实源，`exclusion_count` 度量已改指此处）。
  扫描（AC1b）与惰性检测（necessity-check）读**同一份**数据，两条路径不可能漂移。
- **报告形态定为报出阻断**：惰性条目**无** `retainedNote` ⇒ 检测报出并 `fail`（退出非 0）。
  实际惰性数量 = 1（`quay-init-loop.test.mjs`），属死重（目标文件不含任何旧路径模式），**移除**。
  移除后当前表 `inert_exclusions: 0`。
- **invariant 的「或写明为何保留」分支机械化**为 `retainedNote` 字段：惰性条目若带书面保留理由
  则计入 `inert-but-retained`（不阻断）；当前表无条目使用它，未来防御性重加必须写理由。
- **范围**：文件级条目（target 是普通文件；目录条目治理增长的子树、结构性向前看，属文档化外延）。
  缺失 target 视同惰性（陈旧条目——目标已不存在，抑制不了任何命中）。
- **measure/invoke 改用 `--scoped` 形态**：显式文件形态（`scripts/test.sh <file>`）会走**全量静态档**，
  当前 master 上有 8 条**他任务**的契约棘轮新违规（dispatch-review-missing 等，os-anchor 系 2026-08-05 落地）
  使全量静态档先于测试即红，`inert_exclusions` 出不来。`--scoped <file>` 只跑改动相关静态档 + 该测试，
  隔离本任务字段（与 `--for-task` 同一 scoped 度量面）。**全量套件 2 连绿（DoD）依赖那些他任务修完棘轮。**

## Acceptance Criteria

- [x] AC1: 对当前排除表跑检测，**逐条报出惰性条目**（实跑贴出；若无则如实报零）
      — 移除前实测（把已死的 `quay-init-loop.test.mjs` 排除项临时放回，检测逐条报出并 fail）：
      ```
      inert_exclusions: 1
      scanned file-level exclusion entries: 13
      inert-but-retained entries: 0
        inert plugin/test/quay-init-loop.test.mjs (hits=0) retainedNote=NO
        VIOLATION plugin/test/quay-init-loop.test.mjs — inert with no retainedNote
      ✖ AC1/AC2 — … (fail 1)
      ```
      该条目标文件对 6 条旧路径模式**零命中**（全用 `path.join(ws, 'orchestration', …)` 分写），
      排除它不抑制任何命中——与 inner-brief 死重同形。
- [x] AC2: 移除惰性条目后，检测对剩余条目零报告（实跑贴出）
      — 移除 `quay-init-loop.test.mjs` 排除项后（本分支最终提交态），实测：
      ```
      inert_exclusions: 0
      scanned file-level exclusion entries: 12
      inert-but-retained entries: 0
      ✔ AC1/AC2 — … (pass)
      ✔ AC3 — … ✔ AC4 — …  (pass 3 / fail 0 / cancelled 0)
      ```
- [x] AC3: **负控制**——往某排除项目标文件注入一条旧路径活引用，该条**不再**被报为惰性（实跑贴出）
      — `AC3 — negative control` 子测试（实跑 pass）：
      ```
      clean target:   countOldPathHits = 0  → inert → violation(1)
      live target:    注入 path.join('orchestration','orchestrator-loop-tick.md') 后 countOldPathHits > 0
                      → 该条不再被报为惰性（violations = 0，判定翻转）✔
      ```
      （注入串用 `path.join` 在运行时拼出，测试源里**不出现连续旧路径字面量**，避免自触发 AC1b。）
- [x] AC4: 检测**报告而不只是存在**——构造一个惰性条目时它必须报出/退出非 0，不静默通过
      （与「一个从没红过的检查与永远返回空集不可区分」同一族）
      — `AC4 — the detector REPORTS an inert entry` 子测试（实跑 pass）：构造四类条目并断言分类：
      `violations = ['constructed-inert', 'constructed-missing']`（无 `retainedNote` 的惰性条目，
      以及**缺失 target** 的陈旧条目——目标已删除，抑制不了任何命中），且
      `retainedInert = ['constructed-retained']`（惰性 + 书面 `retainedNote` ⇒ invariant「或写明为何保留」分支，
      不阻断）。若检测返回空集，这些断言即红——证明检测「报出」而非静默。主测试对真实表
      `assert.deepEqual(violations, [])`，任何无 `retainedNote` 的惰性条目都使整个 necessity-check 退出非 0。
- [x] AC5: 测试用 `node:test` 且带恰当的 `// @test-group`
      — 新文件 `plugin/test/loop-shipping-necessity-check.test.mjs` 头部 `// @test-group governance`
      且 `import { test } from 'node:test'`；scoped 静态档的 test-framework-policy 检查全绿
      （`real repo: every glob file imports node:test or is on the exemption list; list is 34` pass；
      新文件无需登记 legacy 豁免，故 `test-framework-policy-check.ts` 本任务**未改**）。
- [x] AC6: 任务体记录本次实例（inner-brief 排除项死重被人工实测揪出）作为证据
      — 见上方「执行落定」。另记**执行期新实例**：os-anchor（`plugin/scripts/os-anchor-install.sh`
      于 2026-08-05 11:05Z 落地）给 AC1b 引入一条**漏网活引用**（`$root/orchestration/orchestrator-loop-tick.md` 兼容旧布局），
      AC1b 表先于它，全绿跑到它即红——正是本任务「名单没有必要性强制函数」的镜面（缺名单条目的漏网）。
      修复为**加排除项**（该脚本驱动 meta-cc/archguard 等外部旧布局工作区，旧路径是合法目标布局，非 quay 自身引用），
      必要性检查对它报非惰性（命中 > 0）。

## Definition of Done

- [ ] AC1 与 AC3 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：排除表没有必要性强制函数这件事被机械化，不再是「记得检查」

## Touches
- tasks/gap-exclusion-lists-have-no-necessity-check.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/test/loop-shipping.test.mjs
- plugin/test/loop-shipping-necessity-check.test.mjs（新）
- plugin/scripts/loop-shipping-exclusion-data.mjs（新——排除表 + 6 条旧路径的单一事实源；
  `exclusion_count` 度量已改指此处）
- plugin/scripts/test-framework-policy-check.ts（如涉及新文件注册）——**未改**：新测试文件用
  `node:test` + `@test-group governance`，无需登记 legacy 豁免
- （仅数据引用，文件本体未改）plugin/scripts/os-anchor-install.sh——AC1b 漏网活引用，加排除项修复

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
