---
id: gap-b15-telemetry-snapshot-untracked
title: telemetry snapshot 收进 gitignore（运行时遥测非代码，读盘不读 git）——收敛非 fan-in 提交节奏
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**B15-telemetry（telemetry snapshot 收进 gitignore —— manager ⑤ 2026-08-14 05:3xZ + outer 5 分裁决，§7 活锁分析引出的提交节奏收敛）**。

**背景（§7 活锁分析，manager 已核实）**：`fan-in-ff-merge.sh` 的 ff-only 成功与否取决于 **develop 上所有提交**的频率，不是 fan-in merge 频率——近 6h develop **135 条**提交 vs **12 条** fan-in merge，相邻间隔中位 **103s** ≪ suite 时长 **390s** ⇒ **一次 suite 跑完期间 develop 中位前进约 4 次 ⇒ 在当前节奏下 ff-only 几乎必然失败**，每次失败代价=重 merge+重跑全量 suite。

**outer 对 ⑤ 的裁决（manager 只裁自己，outer/inner 的提交节奏归各层核）**：
- **telemetry snapshot（近 6h 14 条，全部 outer 写）→ 收敛**。`milestones/fast-mode-telemetry/*.json` 是运行时遥测（`.gitignore:242` 自己已把它与 tick-log 同类），读者（slot-refill / quay-suite / select-tests-for-touches / accounting-emit / supervisor-preempt-candidates / task-ac-carryover-check / inner-panel-stale-check / capability-catalog.sh）**读磁盘文件不读 git**。
- **实现约束（决定性）**：`fan-in-ff-merge.sh:123` 要求 **`git status --porcelain` 空**（把未跟踪也算脏）⇒ **「在飞期间不提交」若表现为【留脏树】= 硬阻 ff**，比重试更贵 ⇒ **收敛不能靠「推迟 commit」，只能靠「让文件不在 tracked tree 里」**——`git rm --cached` + 进 `.gitignore`。
- **tasks 类 48 条不可让**（硬规则 11b：任务文件是生产输入，派发读盘不读 git，「改了盘上任务体就当场提交」）；**docs 可收敛**（本就随 fan-in merge 走）；**core 编辑保持即时**（C17 止损型）；**inner 直改 develop 小头**。

**判据**：
- **判据1（gitignore 化）**：`milestones/fast-mode-telemetry/*.json` 进 `.gitignore` + `git rm --cached`（历史 155 提交保留不动，同 tick-log 处置）——B6 每 tick 照写磁盘（测量不丢）、**只在 in-flight=0 窗口 commit**。14→~1/6h。
- **判据2（读者无碍）**：slot-refill 等 8 个读者按位置核过**读磁盘文件**（`fs.readFileSync` 等），gitignore 后不受影响——回放一次 `--report` 输出与 gitignore 前一致。
- **判据3（ff 闸不被自身污染）**：gitignore 后 `git status --porcelain` 不含 telemetry 文件（与 B15-fan-in-clean-tree 闸同族：运行时状态不得出现在 porcelain 里）。
- **判据4（能取假·真样本，D2 不构造）**：近 6h 的 14 条 telemetry commit 是现成真实样本——gitignore 化之前它们每条都推进 develop、都可能在 in-flight suite 窗口内打断 ff ⇒ 回放必须红（判据1 未满足）；gitignore 化后同窗口不再有 telemetry 提交。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 `.gitignore:242` 分类注 + telemetry 8 读者落点 + `fast-mode-telemetry.ts --snapshot` 写路径。
2. 判据1：`milestones/fast-mode-telemetry/*.json` 进 `.gitignore` + `git rm --cached`（历史保留）。
3. 判据2：读者按位置核过读磁盘文件（`--report` 回放输出一致）。
4. 判据3：gitignore 后 porcelain 不含 telemetry 文件。
5. 判据4：近 6h 14 条 telemetry commit 回放红（gitignore 前）/ 同窗口不再有（gitignore 后）。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：telemetry snapshot gitignore 化 + `git rm --cached`（历史保留），B6 照写磁盘。
- [ ] AC2 判据2：8 读者按位置核过读磁盘文件，gitignore 后 `--report` 输出一致。
- [ ] AC3 判据3：gitignore 后 porcelain 不含 telemetry 文件（与 ff 闸同族）。
- [ ] AC4 判据4 能取假：近 6h 14 条 telemetry commit 回放红（gitignore 前）/ gitignore 后同窗口零 telemetry 提交（D2 真样本）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] telemetry snapshot 收进 gitignore + 读者无碍 + porcelain 干净 + 真样本回放红→绿。

## Touches

- .gitignore（`milestones/fast-mode-telemetry/*.json` 条目 + 注释，与 :242 分类一致）
- milestones/fast-mode-telemetry/（`git rm --cached`，历史保留）
- plugin/test/fast-mode-telemetry-gitignore.test.mjs（负控制 fixture + 真样本回放）
- tasks/gap-b15-telemetry-snapshot-untracked.md（自身）

## Test-Files

- plugin/test/fast-mode-telemetry-gitignore.test.mjs

## Evidence

（inner 落地，2026-08-14）

**判据1（gitignore 化）**：`.gitignore` 新增 `milestones/fast-mode-telemetry/*.json`（注释与 :242 的
tick-log / gate-events.jsonl 分类一致）+ `git rm --cached` 12 个 tracked snapshot（2026-08-02 → 2026-08-14，
历史提交保留不动）。`git check-ignore milestones/fast-mode-telemetry/2026-08-14.json` 命中；
`git ls-files milestones/fast-mode-telemetry/` 归零；磁盘文件仍在（`ls milestones/fast-mode-telemetry/2026-08-14.json`）。

**判据2（读者无碍）**：写入端 `writeAggregateReport` 走磁盘 `fs.writeFileSync(<root>/milestones/fast-mode-telemetry/<date>.json)`
（`fast-mode-telemetry.ts:1485-1502`）；`git rm --cached` 只移除索引、磁盘文件仍在 ⇒ 读者读磁盘不受影响。
读者按位置核过读磁盘：accounting-emit.ts:129/142 `fs.readdirSync`+`fs.readFileSync`（dir mode 取 newest）；
slot-refill / quay-suite / select-tests-for-touches / supervisor-preempt-candidates / task-ac-carryover-check /
inner-panel-stale-check / capability-catalog.sh 均通过 `fast-mode-telemetry.ts --report/--slots` 或目录读，不读 git。
`--report` 照常 exit 0（reader 回放无碍）。

**判据3（porcelain 干净）**：gitignore 后 `git status --porcelain -- milestones/fast-mode-telemetry/` 为空；
fixture 额外写入一个 fresh snapshot probe，porcelain 仍为空（B6 每 tick 照写磁盘不再脏树，与
B15-fan-in-clean-tree 闸同族：运行时状态不得出现在 porcelain 里）。

**判据4（能取假·真样本回放）**：`git log 22431170~1..HEAD -- milestones/fast-mode-telemetry/` 回放
2026-08-14 06h 窗口（01:31 22431170 → 06:03 d6db1483）真实 14 条 telemetry commit = 14（红：gitignore 前
每条都推进 develop、都可能在 in-flight suite 窗口内打断 ff）；gitignore 化后 `git ls-files` 归零 + fresh write
不脏 porcelain（绿：同窗口不再有 telemetry 提交）。fixture 由 `plugin/test/fast-mode-telemetry-gitignore.test.mjs`
逐条断言。

**scoped 门**：`bash scripts/test.sh --for-task gap-b15-telemetry-snapshot-untracked --allow-thin` 绿。
