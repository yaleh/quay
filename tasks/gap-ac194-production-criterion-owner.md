---
id: gap-ac194-production-criterion-owner
title: AC-194 判据第五次变假——分类器按拼法枚举落地形态，且这条 AC 在生产载体上始终没有拥有者
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check
goal_ac: AC-194
---
**type:** execution

## Proposal

AC-194（`goals/AC-194-no-direct-to-develop-bypass.md`，`expect: exit 0`，GOAL-007 三例之③）此刻取假，
且**没有任何在飞任务认领这条 AC**——这是冻结population（`frozen-violated`）本轮报出的缺口。本条认领
此前 5 次认领都没人认领的那半边：AC-194 在**生产载体**上此刻为真、并在下一种落地拼法出现时**仍然**为真。

**本轮直接量（立案前实测，⛔ 非台账尾陈旧读数）**：判据逐字重跑 ⇒ `EXIT=1`，stdout 末行

    direct-to-develop bypass check not pass: unsupported-reflog-action: fetch -q . author:develop, fetch -q . chore/quay-dev-marketplace:develop

同一 checker `--root . --baseline develop~100 --json` 的读数：`evaluated:false`、
`reasonSecondary:"unclassifiable-commits-in-range"`、`unclassifiableCommits:2`、
`classification.ratio:0.98`（98/100）、`denominator.totalDirectCommits:0`、`candidates:[]`。

⇒ **不是「发生了直投」**（`totalDirectCommits` 为 0），而是**判据读不懂输入**：硬规则③b 下 checker 以
exit 3（NOT-EVALUATED）fail-closed，criterion 记 fail。两条不可分类的 reflog 条目原文
（`git reflog show develop` 的 `%gs`）：

- `6de94b9e4 develop@{42}: fetch -q . author:develop: fast-forward`
- `fa031022b develop@{45}: fetch -q . chore/quay-dev-marketplace:develop: fast-forward`

分类器（`plugin/scripts/direct-to-develop-bypass-check.ts:479`）只把 `/^fetch\b/ && /: storing ref\s*$/`
认作 `refMove`，而本仓的 author→develop 同步路径产生的是 `fetch -q . <branch>:<branch>: fast-forward`
⇒ 落入 unknown。

**为什么此前 5 次认领都没让判据留住为真**：全部是**一次性、按拼法或覆盖点**打的补丁，没有任何一条拥有
AC-194 这条【生产载体上的长期保证】本身——它们的 AC 全是 test 层读数（「同一测试 58/0」），结构上没有
一条要求过 `gate AC-194` 在生产 root 上 exit 0：

| 认领任务 | status | 它补的点 |
|---|---|---|
| `gap-ac194-bypass-check-unclassifiable-window` | done | 把整 DAG 721 条收窄到 first-parent 100 条 |
| `gap-ac194-reflog-action-vocabulary-incomplete` | done | 补第三种 action 拼法（`branch: Reset to`） |
| `gap-ac194-bracket-filter-drops-offspine-landing-tip` | done | 补括注准入（落地 tip 须在 spine 上） |
| `gap-ac194-frozen-verdict-predates-fix` | done | 判据读数重取（非缺陷，读数早于修复） |
| `gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check` | ready | 补 `fetch -q . <branch>:<branch>` 这一形态 |

<!-- dedup-ref -->
（去重说明，按机制不按症状）上表最后一条（ready）已认领**分类器拼法识别本身**的修复——它改
`plugin/scripts/direct-to-develop-bypass-check.ts` 的分类路径与同名测试，本条⛔不重做那部分；两条任务的
次序用顶层 `depends_on` 字段机械表达（⛔不靠本段散文）。本条补的是无人认领的另一半：生产载体上的
AC-194 真值，以及它**长期**成立。

**修法方向（⛔ 不是再加一个字符串）**：`plugin/scripts/direct-to-develop-bypass-check.ts:1137` 自己逐字写着
「⛔ Not a spelling whitelist — a spelling whitelist is structurally blind to the next landing form」，
而这正是它连续被破 5 次的方式。归类必须按**结构**判定（该 reflog 条目把 develop 前移到一个已存在的
commit ⇒ `refMove`，与拼法无关），否则第 6 次只是时间问题。

## AC

- [ ] AC1（立案直接量·复现固化）逐字重跑 AC-194 判据 ⇒ `EXIT=1`；贴 stdout/stderr 原文，与 `direct-to-develop-bypass-check.ts --root . --baseline develop~100 --json` 的 `evaluated` / `reason` / `unclassifiableCommits` / `denominator.totalDirectCommits` / `classification.ratio` 五个字段读数
- [ ] AC2（归因，硬规则④推论四）贴出那两条不可分类 reflog 条目的**完整 `%gs` 原文 + 时间戳**，点名产生它们的机制与 `文件:行`（本仓 author→develop 同步路径），并给出一条**若该机制为假则读数会不同**的对照
- [ ] AC3（真值恢复·**生产载体**，⛔ 非 fixture）在前置落地后，于同一生产 root 逐字重跑 AC-194 判据 ⇒ `exit 0`；并贴 `--json` 的 `evaluated:true`、`unclassifiableCommits:0`、`denominator.totalDirectCommits:0`
- [ ] AC4（台账翻转）`.quay/gate-events.jsonl` 中 AC-194 的 **goal-sweep 尾条** `verdict=pass`（贴该条原文与时间戳）
- [ ] AC5（负控制·证明判据能取假）注入一次 `commit:` 形态的 code-surface 直投进 `develop~100` 窗口 ⇒ 同一 checker `exit 1`（贴读数与恢复步骤）——判据不是恒真
- [ ] AC6（结构而非拼法·防第 6 次）造一个**此前未在任何名单里出现过**的 fetch 变体，分类器仍给出结构性归类（贴该形态的分类输出原文）；⛔ 若改法只是往名单里加字符串 ⇒ 本 AC 取假
- [ ] AC7（残留兜底）若前置落地后 AC3 仍非 `exit 0`（同窗口出现新形态或残留），本任务负责补齐**结构性**修法并使 AC3 成立；`gate AC-194` 仍非 0 而本任务被标 done ⇒ 不算完成
- [ ] AC8（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-production-criterion-owner` 绿；若本任务零代码改动，改贴 `git diff --name-only` 证明改动仅限 `tasks/gap-ac194-production-criterion-owner.md`

## DoD

真实落地：**AC-194 判据在生产载体上逐字重跑 `exit 0`（AC3）**，且 `.quay/gate-events.jsonl` 的 AC-194
goal-sweep 尾条翻为 `verdict=pass`（AC4），且该真值**不依赖任何新增的字符串白名单**（AC6 取假：一个从未
见过的拼法仍被结构性归类）。只把同名测试刷到 58/0、而生产 `gate AC-194` 仍非 0 ⇒ 不算完成（这正是此前
5 次认领的共同形态）。注入 `commit:` 直投后同一 checker 仍 `exit 1`（AC5）——判据能取假，不是恒真。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-ac194-production-criterion-owner.md