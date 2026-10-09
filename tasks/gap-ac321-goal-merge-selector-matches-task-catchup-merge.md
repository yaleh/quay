---
id: gap-ac321-goal-merge-selector-matches-task-catchup-merge
title: AC-321 误读 exit 1（隔离实际成立）：判据的 goal_merges() 把「任务分支追平 goal 分支」的合并也算作 goal
  并入，Mg 又被 tail -1 取到最旧的一条 —— 同因还打红 AC-324/327/328
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-321
---
## Finding

**本轮直跑读数**（2026-10-09，主检出 `/data/home/yale/work/quay`；判据文本逐字交 `/bin/sh`，⛔ 非台账尾巴）：

- `AC-321` ⇒ **exit 1**，stderr 逐字：
  `CAUSE=goal-task-landed-on-develop-bypassing-goal-branch — gap-goal030-promotion-writes-via-kernel-transition of GOAL-030 (flip e20ef12140bf3efef3c699b93044d84fcc83cde9) is on develop without having gone through goal/GOAL-030 or its merge commit`
- 同一轮里，同因同族的另外三条也读 exit 1（不是三个独立缺陷）：
  - `AC-327` ⇒ exit 1：`CAUSE=goal-merged-more-than-once — goal/GOAL-030 appears in 4 merge commits on develop`
  - `AC-324` ⇒ exit 1：`CAUSE=no-pre-merge-pass-before-merge — GOAL-905 merged at 1791215564 with zero pre-merge AC passes recorded before it`
  - `AC-328` ⇒ exit 1：`CAUSE=live-probe-not-passed-on-preview — GOAL-905 merged without any live-probe AC passing on its preview instance first`
- 同轮未受影响的对照：`AC-322`、`AC-323`、`AC-325`、`AC-326` 均 exit 0。

**反证：隔离本身成立，是判据问错了提交。** 以 `AC-321` 报的那条为例：

- `F = e20ef12140bf3efef3c699b93044d84fcc83cde9`（subject `tasks: 翻 gap-goal030-promotion-writes-via-kernel-transition done（driver 机械 fan-in）`，ct 1791434646）。
- 真正的 goal→develop 并入提交是 `d71d2bde4a74d35ce6981157f82a2710a2dab810`（subject `merge: goal/GOAL-030 into develop (request fda94d1f-f46a-4387-b8c0-f5ca7bc2e396)`，ct 1791484347），第一父 `3cce2d7dcb94b0be43098cd51c7205a93581fe6f`、第二父 `3f232bcc2619bf64f5fd0c76d6aadea6f3d1f1a9`。
- `git merge-base --is-ancestor e20ef12140 3cce2d7dcb` ⇒ **非 0**（⛔ 不经第一父）；`git merge-base --is-ancestor e20ef12140 3f232bcc26` ⇒ **0**（经第二父）。
- ⇒ `F` 进入 develop 的**唯一**路径就是该并入提交的第二父，即 `goal/GOAL-030`。这正是 `AC-321` 的 `expect` 明写的 `via` 形态（「已并入：经合并提交的第二父可达、不经第一父可达」）。

**根因（一行）**：判据里的 `goal_merges()` 匹配过宽，且 `Mg` 取了错的那一端。

```
goal_merges() { git log develop --merges --format='%H %ct %s' | grep -E "goal/$1([^0-9]|\$)"; }
...
Mg=$(goal_merges "$G" | tail -1 | cut -d' ' -f1)
```

- `grep -E "goal/GOAL-030([^0-9]|$)"` 同时命中**任务分支追平 goal 分支**的合并提交，因为那些 subject 里也含 `goal/GOAL-030`：`Merge branch 'goal/GOAL-030' into task/gap-goal030-…`。
- 该 goal 在 develop 上实测命中 4 条（`git log develop --merges --format='%s' | grep -cE …` = 4）：3 条是任务分支追平（`… into task/gap-goal030-archguard-before-after-comparability`（最旧）、`… into task/gap-goal030-branch-selfhost-probe`、`… into task/gap-goal030-preview-runs-branch-code`），只有 1 条是真正的 `merge: goal/GOAL-030 into develop (request …)`。
- `tail -1` 取 `git log` 输出的**最后一行 = 最旧的一条**，于是 `Mg` 落在一个追平合并上。`classify(F, Mg)` 于是把一个「目标不是 develop 的合并」当成了「goal 并入 develop 的合并」，读出 `direct`。
- 同一个选择器解释其余三条：`AC-327` 用 `k=$(goal_merges "$G" | grep -c .)`，宽正则把 3 条追平合并也数进去 ⇒ 「4 条合并」；`AC-324`/`AC-328` 把那个追平合并的时间戳（`1791215564` = `Merge branch 'goal/GOAL-905' into task/gap-goal905-drill-docs-b` 的 ct）当成了「并入时刻」，于是断言「并入前没有 pre-merge pass」「并入前没有 live-probe pass」——它们检查的是错误的那次合并。

**为什么 2026-10-03 那次改写没有拦住它**：那次改写（见 `AC-321` statusLog：人裁定「改判据并重开 321–323」）把 first-parent 链换成祖先关系，同时引入了这个 `goal_merges()`。它在 GOAL-901..905 这批**演练** goal 上验证通过——那些 goal 的任务分支从 goal 分支直接分叉、追平方向是 `Merge branch 'develop' into task/…`（subject 里是 `develop`，不含 `goal/<id>`），宽正则**碰巧**只命中真正的并入。2026-10-08 起第一批**真实试点** goal（GOAL-030..033）跑起来后，任务分支自己也带提交、与 goal 分支双向分叉，fan-in 先在任务分支上做 `Merge branch 'goal/GOAL-030' into task/…`，宽正则才开始命中。**演练语料在结构上排除不掉这个形状**——所以这不是「同一个 bug 又犯了一次」，而是这个选择器从未在真实拓扑上被读过一次。

**同族扫描（硬规则 5b）**：这一行在 **7** 个判据文件里逐字相同——`AC-321`、`AC-322`、`AC-323`、`AC-324`、`AC-325`、`AC-327`、`AC-328`（连同 `Mg=$(goal_merges "$G" | tail -1 | cut -d' ' -f1)` 选择行也逐字相同）。命中 **7** 条；前 3 条：`goals/AC-321-…`、`goals/AC-322-…`、`goals/AC-323-…`（同一目录、同一行 `goal_merges() { git log develop --merges --format='%H %ct %s' | grep -E "goal/$1([^0-9]|\$)"`）。
⛔ **`AC-326` 不在这一族**：它的 `goal_merges()` 是 `git log develop --first-parent --merges …` 变体、且没有 `Mg=` 选择行，本轮读 exit 0 ——不属本缺陷面，**不要改它**（改了反而是把一条无关判据拖进风险）。

**已实测的修法（本轮在真仓库上端到端跑过，不是设想）**：把该行收紧为「目标必须是 develop」——

```
grep -E "goal/$1[^ ]* into develop([^0-9]|\$)"
```

- 兼容两种 subject 形态：生产 `merge: goal/GOAL-030 into develop (request fda94d1f-…)`；测试夹具用 git 默认消息的 `Merge branch 'goal/GOAL-001' into develop`。
- 排除 `Merge branch 'goal/GOAL-030' into task/…`（目标不是 develop）。
- 实测选中项（`git log develop --merges`）：GOAL-030 命中 4→1、GOAL-905 4→1，GOAL-031/032/033/904 各 1→1，且选中的都是 `merge: goal/<id> into develop (request …)`。
- 把该 patch 打到判据文本上逐条直跑（真仓库、`/bin/sh`）：`AC-321` ⇒ `PASS: 16 landing(s) via goal branch, none landed on develop directly`（exit 0）；`AC-327` ⇒ `PASS: 6 merged goal(s), each entered develop through exactly one merge commit`（exit 0）；`AC-324`、`AC-328` 由 exit 1 转 exit 0；`AC-322`、`AC-323`、`AC-325`、`AC-326` 仍 exit 0（未被打红）。

**为什么现有夹具抓不到（回归用例必须补的形状）**：`packages/quay/test/ac322-criterion-catchup.test.mjs` 的 `buildLanding()` 里，任务分支 `landing` 分叉自 `goal/GOAL-001`，它的追平合并合入的是 develop 的 **SHA**（`:236` `git merge -q --no-edit "$merged"`），subject 因此是 `Merge commit '<sha>' into landing`——**不含 `goal/<id>`**；develop 上唯一匹配宽正则的是 `:252` 那次 `--no-ff` 并入。所以该夹具上宽/窄正则结果相同，缺陷不可见。要复现，夹具必须造出「任务分支自带提交 **且** 非 ff 地把 `goal/<id>` 合进自己」这一步（生产 fan-in 的 `Merge branch 'goal/<id>' into task/<x>`），并让该合并提交经 goal 分支进 develop。

<!-- dedup-ref -->
**与既有任务的关系**：`gap-goal-criterion-rewrite-stale-test-fixtures`（done）记录了三簇因判据改写而未同步的夹具红，并明确选择了测试侧、未动 `goals/*.md`——那个决定在当时是对的（夹具确实缺前置），但它也意味着这个选择器至今没有过真实拓扑上的读数。`gap-goal-active-ac-gap-classification-ignores-round-verdict`（done）改的是 goal-driver 的缺口分类，与本条的选择器缺陷无关。机制去重扫描：`tasks/*.md` 里没有任何 `todo`/`ready`/`needs-human` 的任务命名本机制（现有提及者全部 `done`）；`task-granularity-advice.ts` 对下面 Touches 的读数为 `peers: []`、`mentions: []`。

## Requested action

1. 经 `quay goal write <id> --criterion <新文本> --origin <理由>` 收紧上面那 7 条判据（`AC-321`、`AC-322`、`AC-323`、`AC-324`、`AC-325`、`AC-327`、`AC-328`）的 `goal_merges()` 行（⛔ 不手改 `goals/*.md`；写面是 CLI/provider，文件由 provider 自行提交）。`Mg=$(…)` 那一行**保持原样**即可：收紧后每个 goal 至多一条命中，`tail -1` 即该条。⛔ `AC-326` 不改。
2. 新增回归夹具，钉住「任务分支追平合并」这一形状：任务分支自带提交 + 非 ff 地 `git merge goal/<id>` 进任务分支（使该合并提交的 subject 含 `goal/<id>` 而目标是 task 分支）、该合并提交经 goal 分支进 develop ⇒ 判据仍判 `via` / 不 exit 1。附**取假半边**：同一夹具把该合并提交换成目标为 develop 的形态时判据同样 pass，证明用例不是恒绿。
3. 硬规则 5b：把同族扫描读数（7 条命中 + 前 3 条路径）与上面「演练语料为何排除不掉该形状」的构造写进落地提交。

## AC

- [ ] `quay goal gate AC-321` ⇒ exit 0 且 stderr 无 `CAUSE=`；`goals/AC-321-*.md` 的 `criterion` 经 `quay goal write` 写入（⛔ 非手搓）；Evidence 贴 `git show develop:goals/AC-321-*.md` 里 `goal_merges()` 那一行逐字。
- [ ] 8 条判据逐个 `quay goal gate <AC>` 全 exit 0：`AC-321`/`AC-324`/`AC-327`/`AC-328` 由 exit 1 转 exit 0，`AC-322`/`AC-323`/`AC-325`/`AC-326` 仍 exit 0；8 行读数与退出码逐个贴在 Evidence。
- [ ] 回归用例：新增 `packages/quay/test/ac321-criterion-goal-merge-selection.test.mjs`，构造「任务分支追平合并」（subject 含 `goal/<id>`、目标为 task 分支）且该提交经 goal 分支进 develop ⇒ 从 `goals/AC-321-*.md` **运行期读出**的判据（⛔ 不在测试里复制一份正文）读 exit 0 而不是 exit 1，且该路径下 `classify` 判 `via`。
- [ ] 取假（硬规则 4 推论四）：用 `cp` 备份把 `goal_merges()` 行临时回退为宽正则（⛔ 不用 `git checkout --`），上一条用例至少 1 条断言变红；Evidence 贴红/绿两次实跑输出与恢复后的绿输出。
- [ ] `bash scripts/test.sh --for-task gap-ac321-goal-merge-selector-matches-task-catchup-merge` 退出 0 且非 thin（Evidence 贴出被执行的测试文件名，≥1 个）。
- [ ] 硬规则 5b 产物：Evidence 贴同族扫描的命中数（7）与前 3 条路径，以及宽/窄正则在同一 goal 上的命中条数对照（4 vs 1）。

## DoD

develop 上 `quay goal gate AC-321` 直跑 exit 0，且同一轮 `AC-321`..`AC-328` 八条判据读数全为 exit 0。回归夹具已进 develop：今后再出现「任务分支把 goal 分支合进自己」的拓扑时，判据不会再把那次追平合并当成 goal 并入——`Mg` 结构上只可能是目标为 develop 的合并提交（这条路径被用例直接钉住，而不是靠「这次没红」推断）。

## Touches

- goals/AC-321-隔离-branch-mode-goal-的任务落地不出现在-develop-的-first-parent-链上.md
- goals/AC-322-追平-每次-goal-分支落地都包含其追平时刻的-develop.md
- goals/AC-323-不重派-落到-goal-分支的任务此后不再被派发.md
- goals/AC-324-并入前可见-pre-merge-ac-在-goal-并入-develop-之前就被判为-pass.md
- goals/AC-325-人工并入-每个-goal-合并提交先有人工并入请求-且-goal-的-achieved-晚于并入.md
- goals/AC-327-混入度-每个并入的-goal-在-develop-first-parent-链上恰为一个提交.md
- goals/AC-328-并入前试用-live-probe-类-pre-merge-ac-在预览实例上-pass-之后才并入.md
- packages/quay/test/ac321-criterion-goal-merge-selection.test.mjs
- tasks/gap-ac321-goal-merge-selector-matches-task-catchup-merge.md
