---
id: gap-git-history-landed-master-stale-under-two-line-model
title: taskWorkLanded 第三条信号 gitHistoryLanded 硬编码 master——两线模型下工作落
  integration，master 停在 ea2208cf/08-06（master..integration=2212）⇒ 08-06 后落地的一切对
  gitHistory 恒为假；散文 AC + 只改既有文件的任务（治理层大多数）三条信号全假 ⇒ workLanded=false ⇒ 永不判
  not-yet-flipped ⇒ 永远留 ready 池（closure 探针系统性少数 12 条）；处方=ref
  随两线模型走（integration/develop，保留「不算游离分支」原意）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（人 2026-08-12 00:4x 裁定，A 组）**：代码已合入 integration 且被 r308-green 覆盖，AC18 复核 measure 通过。

## Proposal

**`task-status-drift-check.ts` 的 `taskWorkLanded` 第三条信号 `gitHistoryLanded` 硬编码 `git log master --full-history`（:410/:444）。两线模型下工作落在 integration（develop 只经 batch-merge 前进），而 master 停在 ea2208cf（2026-08-06，master..integration=2212 条提交）⇒ 08-06 之后落地的一切对第三条信号恒为假。散文 AC + 只改既有文件的任务（治理层的大多数）三条信号全假 ⇒ workLanded=false ⇒ 永不判 not-yet-flipped ⇒ 永远留在 ready 池。**

### 实证（manager 2026-08-11 05:3x 三处自我更正后 + outer 复核）

- **master 陈旧**：`master=ea2208cf (2026-08-06)`；`master..integration=2212`、`master..develop=2182`。两线模型下 develop/integration 是工作线，master 是 5 天没动的历史 ref。
- **gitHistoryLanded 硬编码 master**：`task-status-drift-check.ts:410` `gitTry(repoRoot, ["log", "master", "--full-history", ...])`；`:444` 同（预聚合）。注释「only MASTER-REACHABLE commits count」的原意是【不把游离分支的提交算作落地】——意图对，坏的只是 ref 的选择。
- **taskWorkLanded 三信号 OR**：symbolResolved（AC ≥60% 符号可解析）/ touchLanded（(new) 新建文件存在）/ gitHistory（master-reachable 且提交信息提到任务且改了 Touches 具体路径）。散文 AC + 既有文件 ⇒ 前两信号假；master 陈旧 ⇒ 第三信号恒假 ⇒ workLanded=false。
- **notYetFlipped 实际判据**（manager 读实现后更正）：workLanded 且（AC 全勾 或 勾选率>0.5），或 AC 全勾。工作落地但 AC≤50% 判 stuck-work 放回可派池是**有意的、正确的**设计（gap-ready-pool-worklanded-traps-stuck-work），别改它。
- **分布更正**（manager 05:3x 取代 05:05）：该翻未翻=12、无 AC 段结构上翻不了=2（last-pane/suite-red）、AC≤50% 真有剩余工作=4。真·可派=4 非 1。
- **closure 机件形同虚设的根因**：closure-lag-check 复用 ready-pool-check 的 nyf 计数（复用对），但探针系统性少数 12 条 ⇒ 实跑 nyf=4 ≤ threshold=10 ⇒ 静默。阈值 30→10 治了「阈值高到永不触发」，治不了【输入探针系统性少数】——探针失效与「确实无积压」在记录上不可区分。

### 选定机制方向（实现归 inner，判定归 outer）

**gitHistoryLanded 的 ref 不硬编码 master，随两线模型走**：
1. **ref 用 integration（或 develop）**：fan-in 落 integration ⇒ 至少要含 integration；若要保留「不算游离分支」原意，用 develop 或 integration 均可，但不能是一条 5 天没动的 ref。
2. **配置来源**：gap-quay-init-never-writes-branch-model-config（$MERGE_TARGET/$FORK_BASELINE）落地后，ref 从配置读而非再硬编码一次。
3. **无 AC 段兜底**（manager 建议③）：无 `## Acceptance Criteria` 段的任务（total=0 ⇒ allAcsChecked 恒 false ⇒ 结构上翻不了 done）需兜底判据——现在那 2 条会永久卡 ready。

**验证锚**：修后 (a) integration 上已落地的任务 gitHistoryLanded=true（master 陈旧不再误判）；(b) 游离分支提交仍不算落地（原意保留）；(c) 无 AC 段任务可翻 done；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 master 陈旧（ea2208cf/08-06, master..integration=2212）+ gitHistoryLanded 硬编码 master（:410/:444）+ 三信号 OR + notYetFlipped 实际判据（本任务 Proposal 已含）
- [x] AC2: **gitHistoryLanded ref 随两线模型**——ref 用 integration/develop（或配置来源），master 陈旧不再误判
- [x] AC3: **游离分支原意保留**——不把游离分支提交算落地（负控制）
- [x] AC4: **无 AC 段兜底**——无 ## Acceptance Criteria 段的任务可翻 done；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：integration 落地任务 gitHistoryLanded=true（贴输出）；游离分支仍不算
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/task-status-drift-check.ts（gitHistoryLanded ref：master → integration/develop/配置）
- plugin/test/task-status-drift-check.test.mjs（新增两线模型 ref 用例）
- plugin/scripts/ready-pool-check.ts（无 AC 段兜底判据）
- plugin/test/ready-pool-check.test.mjs（无 AC 段用例）
- tasks/gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target.md（交叉标注——配置来源）
- tasks/gap-git-history-landed-master-stale-under-two-line-model.md（自身：勾 AC + 贴证据）

## Contract

measure   git_history_landed_on_integration = `git log integration --oneline | grep -cE "inner: gap-suite-execution-rollback|fan-in: task/gap-suite-execution-rollback"` 的 stdout 数字
band      git_history_landed_on_integration >= 1（integration 上落地任务可被检出）
invariant stray_branch_not_landed = 1（游离分支提交不算落地——原意保留）
invariant no_ac_section_flippable = 1（无 ## Acceptance Criteria 段任务可翻 done）
invoke    `git log integration --full-history --oneline | grep -iE "inner: gap-suite-execution|fan-in: task/gap-suite" | head -3`（贴 integration 落地证据）
control   integration 落地可检出；游离分支不算；无 AC 段可翻；既有不回归
resume    ref 改 / 无 AC 兜底 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:3x 三处自我更正（数字/根因/机制评价）+ 单行根因——gitHistoryLanded 硬编码 master，master 停 ea2208cf/08-06，两线模型下工作落 integration ⇒ 08-06 后恒假 ⇒ 散文 AC+既有文件任务永不判 nyf。closure 探针系统性少数。处方：ref 随两线模型 + 无 AC 段兜底。实现归 inner，判定归 outer

## Implementation evidence (inner 2026-08-11)

**AC1 复现固化**：任务体 Proposal 已记录 master 陈旧（ea2208cf/08-06, master..integration=2212，本任务体）+ gitHistoryLanded 硬编码 master（task-status-drift-check.ts 旧 :410/:444）+ 三信号 OR + notYetFlipped 实际判据。实跑确认 master 仍陈旧：
```
$ git log -1 --format="master=%h (%ad)" --date=short master
master=ea2208cf (2026-08-06)
$ git rev-list --count master..integration
2273
```

**AC2 gitHistoryLanded ref 随两线模型**：新增 `export function landingRef(repoRoot, {ref, candidates})`（task-status-drift-check.ts）——`opts.ref` 显式优先（ready-pool-check 的 `--integration/--develop/--master` 配置来源），否则取 integration→develop→master 第一个存在的 ref，全缺回退 master（单线仓库/旧 fixture）。per-task path（`git log <ref> --full-history -- <paths>`）与 batched `buildGitHistoryIndex`（`git log <ref> --full-history -m --name-only`）两处都改用 `landingRef`。实跑：integration 落地任务可检出，master 陈旧不再误判。

**AC3 游离分支原意保留**（负控制）：落地判据是「从所选 ref 可达」——未合入 integration 的 stray `task/*` 分支提交不可达，不算落地。测试 `git-history: two-line model — ... a stray branch does NOT land (AC2/AC3)` 覆盖 per-task + batched 两路径。

**AC4 无 AC 段兜底**：`notYetFlipped` 的 done-flip 门改为 `workLanded && (allAcsChecked || acRatio > 0.5 || total === 0)`——无 `## Acceptance Criteria` 勾选（total=0）的任务结构上翻不了 done（allAcsChecked 恒 false），work 落地后即以落地本身为收尾信号；work 未落地仍留池（stuck-work 保护不破）。

**scoped 门**（worktree，`--for-task gap-git-history-landed-master-stale-under-two-line-model --allow-thin`）：EXIT=0。新增测试全绿：
```
✔ landingRef: opts.ref wins, then integration→develop→master, then master fallback (two-line model)
✔ git-history: two-line model — integration is the landing ref (stale master does not misjudge); a stray branch does NOT land (AC2/AC3)
✔ no-AC-section fallback: landed no-AC task is a done-flip; unlanded no-AC task stays in the pool (AC4)
✔ ready pool: a no-AC task whose work lands on INTEGRATION is a done-flip (two-line model + AC4)
ℹ fail 0 · ℹ cancelled 0
```
task-status-drift-check.test.mjs 116 pass / 0 fail / 1 opt-in skip；ready-pool-check.test.mjs 65 pass / 0 fail。

**Contract invoke（integration 落地证据）**：
```
$ git log integration --full-history --oneline | grep -iE "inner: gap-suite-execution|fan-in: task/gap-suite" | head -3
c67676b4 fan-in: task/gap-suite-execution-rollback-to-main-session-not-restored-after-crash
649ee499 inner: gap-suite-execution-rollback-to-main-session-not-restored-after-crash — 套件执行形态计数器...
4d77c6c0 fan-in: task/gap-suite-blocking-red-window-unattributable
```
measure `git_history_landed_on_integration` = 2（band ≥ 1 满足）。

**提交（worktree）**：
- 5926c4c6 inner: ... gitHistoryLanded ref follows two-line model (landingRef: integration→develop→master, opts.ref override)
- 80a27358 inner: ... no-AC-section fallback in notYetFlipped (total===0 joins the done-flip gate)
- 179b12f4 inner: ... tests: two-line landingRef (AC2/AC3) + no-AC fallback (AC4)

**DoD 全量套件绿**：留给外层 verification-round 验证（本 inner 未跑全量）。