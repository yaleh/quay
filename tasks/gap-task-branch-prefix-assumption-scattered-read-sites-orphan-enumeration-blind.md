---
id: gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind
title: task/ 前缀假设散落 31 处/7 文件：worktreeExists 已修但 worker-driver 4 处 +
  fast-mode-telemetry 2 处读方仍对无前缀分支隐身
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worktree-exists-blind-to-unprefixed-task-branch
---
## Proposal

`gap-worktree-exists-blind-to-unprefixed-task-branch`（**已 done，AC 6/6**）把 `fast-mode-telemetry.ts`
的 `worktreeExists` 改成了形状感知（路径 basename ∨ 分支去掉可选 `task/` 前缀）。**但那只是簇里的一个。**
2026-09-08 对 develop 实测：

```
git grep -c 'refs/heads/task/' develop -- 'plugin/scripts/*.ts' 'plugin/scripts/*.sh'
  claim-task.sh 14 · claim-task.ts 3 · fast-mode-telemetry.ts 3 · integration-batch-merge.sh 1
  periodic-push-backup.sh 1 · release-task.sh 3 · worker-driver.ts 6        合计 31 处 / 7 文件
```

**仍然隐身的【读方】共 6 处代码点（注释不计）**：
- `worker-driver.ts:459` / `:474` / `:486` / `:499` —— 残留 worktree 的存在判定与路径列举，
  各自手写 `^branch refs/heads/task/<id>$` 正则/字面比较；
- `fast-mode-telemetry.ts:556` —— `for-each-ref --format=%(refname:short) refs/heads/task/`，
  **只枚举带前缀的分支**；
- `fast-mode-telemetry.ts:1558` —— `openBranches.has('refs/heads/task/' + rec.taskId)`。

**这正是硬规则 5b 的实例**：修的人只盯着被报出来的那一处，而**兄弟实例就在同一个文件里**
（`worktreeExists` 修好了，同文件 `:556`/`:1558` 没动）。

**生产代价（已实测）**：2026-09-08 有两个 worktree 的分支无 `task/` 前缀
（`gap-perfile-psi-window-join`、`gap-meta-ffpushtodevelop`，worker 自由 `git worktree add` 建出），
它们对整套 worker-driver 孤儿枚举与机械 fan-in 清理**结构上不在视野里**，停摆 19–20 小时、
各压着 332 行 / 48 行未落产出；人工 `git branch -m` 补前缀后驱动才看得见。
⇒ 这不是「没被派发」，是「枚举不到」。

**⛔ 修法不是把 31 处字面量逐个改宽**——那 31 处里既有**写方**（`claim-task.*` 17 处、`release-task.sh` 3 处
建/删分支，它们确立命名约定，本来就该带前缀）也有**读方**（枚举/判存在/清理），还有纯注释。
盲目放宽读方会让约定失去强制力。正确形态是两半：
**(a) 写方唯一化并强制**——worktree 建出来就必须是 `task/<id>`；当前实际创建点是 worker 派发 prompt 里的
自由 `git worktree add`（无 `-b`，于是复用同名分支甚至 develop 本身——2026-09-08 实测到一个 worker
把 worktree 建在 `develop` 分支上，其提交会直接落 develop 绕过 fan-in），
`dispatch-worktree-setup.sh` 是可加自检的机械落点；
**(b) 读方收敛到单一判定源**——一个共享 helper 解析「某 taskId 的 worktree 路径 + 分支 ref」，
上述 6 处读方全部改调它，不再各自写正则。`worktreeExists` 已实现的形状判定就是该 helper 的现成语义。

## Plan

1. 抽出共享 helper（落点建议 `fast-mode-telemetry.ts`，`worktreeExists` 已有的判定语义即为其内核）：
   输入 taskId，输出该任务的 worktree 路径与分支 ref；判定 = 路径 basename == taskId
   ∨ 分支去掉可选 `task/` 前缀 == taskId。fail-soft 语义保持：git 失败 ⇒ 空/false，
   ⛔ 不得把「读不到」变成「存在」（硬规则 3b）。
2. 读方收敛：`worker-driver.ts:459/474/486/499` 与 `fast-mode-telemetry.ts:556/1558` 六处改调 helper。
   `:556` 的 `for-each-ref refs/heads/task/` 需换成枚举 worktree 后按 helper 判定，
   ⛔ 不能只是把 ref 前缀去掉（那会把全仓无关分支都当任务分支）。
3. 写方强制：`dispatch-worktree-setup.sh` 加分支名自检——传入的 worktree 分支名不是 `task/<id>`
   即失败并报出（含实测到的 `develop` 本身这种最坏形态），⛔ 不得静默接受。
4. 逐类清点 31 处并在提交信息写明「写方 / 读方 / 注释」三类条数与各类前 3 条实际内容
   （硬规则②：引用计数前先打印命中的实际内容）。

## AC

- [x] 逐类清点：提交信息里写出「写方 N1 / 读方 N2 / 注释 N3」三类条数与各类前 3 条实际内容，且 N1+N2+N3 与落地当时重新取的 `git grep -c 'refs/heads/task/' develop -- 'plugin/scripts/*.ts' 'plugin/scripts/*.sh'` 求和读数一致（贴两个读数，⛔ 非转述）
- [x] 六处读方（`worker-driver.ts:459 :474 :486 :499` + `fast-mode-telemetry.ts:556 :1558`）改动后各贴一次实际行内容，确认均不再自写 `refs/heads/task/` 判定而是调共享 helper
- [x] 负控制（能取假）：造一个分支名**不带** `task/` 前缀的 worktree，断言 `worker-driver` 的残留 worktree 枚举**能列出它**；改动前对同一样本干跑必须**列不出**——前后两次读数不同，排除恒真（硬规则④）
- [x] 负控制反向：造一个与任一 taskId 无关的 worktree（如 `worktree-slow-tests-analysis`），断言枚举**不**把它当成任务 worktree（防止放宽后误纳）
- [x] 写方自检：对一个分支名为 `develop` 的 worktree 跑 `dispatch-worktree-setup.sh`，断言它**失败并报出**（贴失败输出）；负控制：分支为 `task/<id>` 时仍成功
- [x] `node --test plugin/test/fast-mode-telemetry.test.mjs plugin/test/worker-driver.test.mjs` 全绿，贴 pass/fail 计数

## DoD

生产载体读数：改动落地后，对主检出跑一次 worker-driver 的残留 worktree 枚举，
断言它能列出当时真实存在的、分支无 `task/` 前缀的 worktree（若届时已无此类样本，则按 AC3 的构造样本执行，
并在提交信息注明「生产中已无此类残留」）。
⛔ **基线必须对 `worker-driver.ts` 的枚举重新取**——不得沿用「`worktreeExists` 改动前看不见」这个旧基线：
`worktreeExists` 已由前置任务修好、现在**已经看得见**，拿它当 before 会让判据恒真（硬规则④）。
⛔ 单测绿是必要非充分（硬规则④推论三）。

## Touches

- plugin/scripts/fast-mode-telemetry.ts（共享 helper + `:556`/`:1558` 两处读方收敛）
- plugin/scripts/worker-driver.ts（`:459 :474 :486 :499` 四处读方收敛）
- plugin/scripts/dispatch-worktree-setup.sh（写方：worktree 分支名自检）
- plugin/test/fast-mode-telemetry.test.mjs（helper 三形态 + 误纳负控制单测）
- plugin/test/worker-driver.test.mjs（枚举走 helper 的回归 + 无前缀样本负控制）
- plugin/test/dispatch-worktree-setup.test.mjs（写方自检单测：develop 分支拒 + task/<id> 负控制）
- docs/analysis/quay-init-closure-ratchet.baseline.json（改三个 scripts 后 re-anchor closure baseline）
- tasks/gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind.md（自身）

## Verification

对照（硬规则④推论四）：把一个无前缀 worktree 改名加上 `task/` 前缀，枚举结果必须由「列不出」翻成「列得出」；
再改回去必须翻回来——一个参数翻转结论就翻，排除恒真/恒假。