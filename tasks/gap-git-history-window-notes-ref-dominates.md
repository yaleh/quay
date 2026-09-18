---
id: gap-git-history-window-notes-ref-dominates
title: git-history 窗口被 refs/notes/quay-cmv-merge 线性链占满：生产读路径 200 条里 185 条是 notes
  提交，且钉死全仓 code-delta fan-in（AC3 非空判据恒红）
status: ready
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**缺口（实测 2026-09-18，本机 `/home/yale/work/quay`，⛔ 非估算）**：`git log --all --topo-order -n 200` 把
`refs/notes/quay-cmv-merge` 的线性 notes 链**整段连续吐出**（topo-order 对线性链是连续发射的），而该链的 tip
当前是仓库最新的提交 ⇒ **窗口 200 个槽位里 185 个是 notes 提交**。两个后果：

**① 生产缺陷（用户可见）**：`readGitHistory`（`packages/quay/src/observation.ts:2636`）的 argv 逐字是
`["-C", root, "log", "--all", "--topo-order", "-n <limit>"]` —— `--all` 含 `refs/notes/*`。
直调生产读路径实测：`readGitHistory(root, {limit: 200})` ⇒ `status: ok`，**200 条里 185 条 subject 是
`Notes added by 'git notes add'`**，真实提交只剩 15 条 ⇒ Web UI 的 git-history 页被 notes 噪声淹没。

**② 全仓阻塞（更贵）**：`packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`
的 AC3 非空判据（`:72-77`）断言「窗口内存在 merge 的第二父提交」。该窗口实测 = 200 条里 185 条 notes、
其中 186 条带 ≥2 父（notes 链含 `git notes merge` 产生的合并提交），但**在窗内的第二父边缘 = 0**
（链长 233 > 窗口 200，第二父全部落在窗外）⇒ 判据恒红。**该红不属于任何 code-delta 任务的 delta，却让每一轮
code-delta fan-in 都在 `step=suite` 死掉。**

## Evidence（本条立案时的实测读数，全部为直接量）

**窗口组成（worktree 内实测）**：
```
git log --all --topo-order -n 200 --format="%H %P"
  ⇒ 200 行；其中带 ≥2 父的 186 条；第二父落在窗口内的边缘 = 0
notes 提交在窗口内 = 185 / 200
refs/notes/quay-cmv-merge 链长 = 233（2026-08-12 13:20:01 → 2026-09-18 11:34:57）
```

**对照（能区分；硬规则 4 推论四）——把 notes 从 `--all` 里去掉，同一算法**：
```
git log --branches --tags --remotes --topo-order -n 200 --format="%H %P"
  ⇒ 窗口 200 条；merge 66 条；第二父落在窗口内的边缘 = 66
```
⇒ **非空判据从「0」翻成「66」** ⇒ 归因成立：占满窗口的是 notes 链，不是测试要验的分页语义。

**「不是本任务 delta」的对照**：同一测试在**主检出**（不含任何本任务改动）**逐字同样失败**；且两侧
`git log --all --topo-order -n 200 --format=%H` 的有序 hash 序列**完全相同** ⇒ 失败与本任务的改动无关。

**写入者**：`plugin/scripts/cross-machine-verify.sh:97` `MERGE_REF="quay-cmv-merge"`，`:161` `git notes --ref=… add`、
`:167` `append`，`:24-26` 声明它是「SHARED STATE: git notes, pushed to the shared remote (origin)」。
⇒ 该 ref 是**活跃的跨机验证状态载体**，不会被清理。

**同族先例（硬规则 5b：修好一处 ≠ 只有一处）**：兄弟文件
`packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 的 AC2 oracle
被 `gap-git-graph-pagination-ac2-oracle-races-live-refs`（**done**）用「冻结 ref 窗口 + `observation.ts` 的
`GitExec` 宿主读取缝隙（`:2573-2582`）」修过，**生产读路径零改动**。
**本文件的 AC3 判据没有做同类加固**——它**直接** `execFileSync("git", ["-C", REPO_ROOT, "log", "--all", …])`
并在无 `exec` 缝隙的情况下调 `readGitHistory`，读的是**实时 `--all`**。
⚠️ 但**冻结 ref 窗口并不足够**：本条的病因不是「两次读之间 ref 前进」，而是「`--all` 把**与渲染的提交图无关的
`refs/notes/*`** 也算进窗口且它当前占满窗口」——冻结窗口仍会把 notes 冻在里面。⇒ 修法必须**把 notes 从窗口的
定义里排除**，或让非空判据不再以「窗内第二父边缘」为量。

## Plan

1. **先做两读互校，确认病因不是「窗口位移」**（避免误取兄弟任务的修法）：对同一瞬间取
   (a) `--all` 窗口与 (b) 去 notes 窗口，比较第二父边缘数。若 (a)=0 而 (b)>0，则病因是 notes 占用，
   **不是** race ⇒ 冻结 ref 窗口**不适用**（⛔ 照搬兄弟修法会做出一个「冻住了但仍然是 0」的判据）。
2. **选定修法（二选一，需在实现前把理由写进任务体）**：
   a. **生产侧排除 notes**：`readGitHistory` 的 `--all` 改为显式 ref 范围（`--branches --tags --remotes`）
      或加 `--exclude=refs/notes/*`——**同时**要处理一个语义问题：notes 提交此前一直出现在 git-history 页，
      排除它们是否会让某些既有测试的对拍 oracle 失配（**必须逐个核 `--all` 的其它读者**）。
   b. **只修测试侧**：让 AC3 的非空判据改用与分页语义同源的量，而不是「实时 `--all` 窗口内的第二父边缘」。
3. **硬规则 3b/4 的两条红线（⛔ 不可接受的修法）**：
   - 把判据改成恒真（例如「仓库里存在 merge 提交」——结构上不可能为假）；
   - 只对两侧交集比对、或让 oracle 回声 `readGitHistory`。
4. **负控制**：把 notes 链人为推到窗口之上（或注入一个占满窗口的线性 ref）⇒ 修完的判据**必须仍能取假**
   （即：仍能报出「窗口内没有可验的第二父边缘」这一类不适格），⛔ 不得变成恒绿。
5. **收口**：`bash scripts/test.sh --for-task <本任务>` 绿 + 全量 suite 绿（后者是本条真正的价值：
   解除全仓 code-delta fan-in 的阻塞）。

## Acceptance Criteria

- [ ] AC1（病因判定，可被证伪）：任务体里同时给出同一瞬间的 (a) `--all` 窗口与 (b) 去 notes 窗口的
      「merge 数 / 窗内第二父边缘数」两组读数；且由它们**明确写出**病因是 notes 占用而非 race
      （⛔ 只给一组读数不算）。
- [ ] AC2（生产面被修）：`readGitHistory(root, {limit: 200})` 返回的 200 条里，subject 形如
      `Notes added by 'git notes add'` 的条数 = **0**；且**逐个核过** `--all` 的其它读者（grep
      `"--all"` + `git log` 的调用点）并在任务体里列出「每处是否受同一 notes 污染影响」的清单。
- [ ] AC3（全仓阻塞解除，这是本条的真实价值）：
      `node --test packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`
      ⇒ `fail 0`，**且**该判据仍能取假——负控制：构造一个「窗口内确无可验第二父边缘」的输入 ⇒ 判据必须报红
      （⛔ 若负控制下仍绿，说明修法把判据改成了恒真，AC3 不成立）。
- [ ] AC4（全量）：`bash scripts/test.sh` 全量绿，`# fail 0`。

## Definition of Done

**REAL LANDING**：不是「测试不红了」，而是**生产 git-history 页不再被 notes 提交淹没**，且**全仓 code-delta
任务的 fan-in 不再被这一条恒红挡住**：

1. **落地对象**：AC2 的生产读路径读数（notes 条数 = 0，改前改后同一命令对照）+ AC3 的负控制（判据仍可假）。
2. **可被打红**：AC1 的两组读数（只给一组即不成立）+ AC3 的负控制（恒真即不成立）。
3. **记账**：任务体里写明修法**取 a 还是 b** 及理由；若取 a，必须含「`--all` 其它读者」清单（遗漏一个即
   可能把 notes 从一处排除、在另一处留下）。
4. **不许越界**：若最终只修测试侧，任务体必须明说「生产读路径 `observation.ts` 未改」；若改了生产侧，
   必须列出全部受影响读者与各自的对拍 oracle 是否已同步。

## Touches

- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
- tasks/gap-git-history-window-notes-ref-dominates.md
（若 Plan 取 a，加入 `packages/quay/src/observation.ts` 与受影响的兄弟测试文件——⛔ 实现前先把 Touches 补全，
不要边做边加。）