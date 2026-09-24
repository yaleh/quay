---
id: gap-ac194-production-criterion-owner
title: "AC-194 结构判定缺钉子——测试只钉旧拼法（: storing ref），改回白名单不会有任何测试变红"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check
  - gap-superseded-dependency-blocks-dispatch-forever
goal_ac: AC-194
---
**type:** execution

## Proposal

**本条已收窄（2026-09-24，manager 层裁定）。** 立案时的前提（AC-194 判据 `EXIT=1`、`unclassifiableCommits:2`）
**已被他任务满足**，剩下的唯一活口是「缺钉子」。

**此刻的生产读数（逐字重跑，生产 root HEAD `993859ea`，2026-09-24T02:40:27Z）**：

    EXIT=0
    evaluated=true   ok=true   reasonSecondary=null
    unclassifiableCommits=0
    classification: 100/100 (ratio 1)
    denominator.totalDirectCommits=0
    candidates.length=0

`.quay/gate-events.jsonl` 的 AC-194 goal-sweep 尾条亦为 `verdict=pass`
（2026-09-23T17:50:01.644Z，`criterionHash=d3eb8d7a6165b156`）。

**前置由谁满足（⛔ 本条不重做那部分）**：`gap-suite-ambient-reds-block-all-code-landings`（done）的"第 4 类"
已按**结构**修好分类器——原文见 `plugin/scripts/direct-to-develop-bypass-check.ts:479` 起：任何以 `fetch`
开头的 reflog action 都必然是一次 ref-level 移动（git-fetch 在本地从不创建 commit），与 status 后缀无关。
立案当轮探针实测（6 个变体，含**从未在任何名单里出现过**的后缀）：

| `%gs` 输入 | `classifyReflogAction` |
|---|---|
| `fetch -q . author:develop: fast-forward` | `refMove` |
| `fetch -q --force . some-branch:develop: forced-update` | `refMove` |
| `fetch -q . totally-novel-branch-i-have-never-seen:develop: pruned` | `refMove` |
| `fetch -q . x:develop: some-future-suffix-nobody-enumerated` | `refMove` |
| `commit: fix something` | `direct`（负控成立） |

⇒ 原 AC3（生产真值）、AC4（台账翻转）、AC6 的**实现侧**均已满足。

**剩下的真缺口是「钉子」**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 对 fetch **只有 1 条断言**
（`:1017`），且用的是**旧拼法** `: storing ref`。也就是说——**把结构判定改回白名单，不会有任何测试变红。**
这正是本任务要防的"第 6 次"，而它此刻**没有载体**（硬规则 9：可见性 ≠ 执行，该给它造产物）。

⛔ 本条**不再**新增任何字符串白名单；⛔ 不重做分类器实现（已由他任务完成）。

## AC

- [ ] AC1（现状固化·生产载体）在生产 root 逐字重跑 AC-194 判据 ⇒ `exit 0`，贴 `evaluated` /
      `unclassifiableCommits` / `classification.ratio` / `denominator.totalDirectCommits` / `candidates.length`
      五个字段读数；并附 `.quay/gate-events.jsonl` 中 AC-194 的 goal-sweep 尾条原文与时间戳
- [ ] AC2（前置归属·引用不重做）贴 `plugin/scripts/direct-to-develop-bypass-check.ts:479` 起的结构判定注释原文，
      点名 `gap-suite-ambient-reds-block-all-code-landings` 为其落点；证明本条**零实现改动**
- [ ] AC3（**钉子**·本条核心）在 `plugin/test/direct-to-develop-bypass-check.test.mjs` 增加断言，至少钉住：
      （a）生产真实形态 `fetch -q . author:develop: fast-forward` ⇒ `refMove`；
      （b）≥1 个**任何名单里都没有**的后缀（如 `pruned`）⇒ `refMove`。
      **并做一次变异检验**：把 `classifyReflogAction` 的 fetch 分支临时改回 `&& /: storing ref\s*$/.test(s)`
      ⇒ 新断言**必须变红**（贴红/绿两次读数 + 恢复后的 `git diff --stat` 为空）。⛔ 只加一条与 `:1017` 同形的
      拼法断言 ⇒ 本 AC 取假
- [ ] AC4（负控制·判据不是恒真）在**一次性 scratch clone**（⛔ 不在真 develop 上注入）的窗口内
      注入一次 `commit:` 形态的 code-surface 直投 ⇒ 同一 checker `exit 1`；贴读数与恢复步骤
- [ ] AC5（防第 6 次·结构余量）列出实测到的 fetch 后缀词表，并证明一个**不在该词表内**的后缀仍归类 `refMove`
      （即判定与词表无关）；贴分类输出原文
- [ ] AC6（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-production-criterion-owner` 绿

## DoD

真实落地：**钉子存在且可证伪**——AC3 的变异检验里把结构判定改回白名单后**新断言变红**（这是"测得出来"的
唯一证据；硬规则 4 推论三：一个**改回旧实现也不变红**的测试不是钉子，只是回声）。且生产 root 上 AC-194 判据
保持 `exit 0`（AC1），且负控仍能取假（AC4）。只把测试条数刷高、或新增一条与 `:1017` 同形的拼法断言 ⇒ 不算完成；
把分类器实现重做一遍（已由他任务完成）⇒ 也不算完成。

## Touches

- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/scripts/direct-to-develop-bypass-check.ts
- tasks/gap-ac194-production-criterion-owner.md