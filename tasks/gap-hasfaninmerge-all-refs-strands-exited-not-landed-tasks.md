---
id: gap-hasfaninmerge-all-refs-strands-exited-not-landed-tasks
title: slot-refill 的 hasFanInMerge 用 --all 判 fan-in，未落地任务被永久判为已 land 待翻 done
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/slot-refill.ts` 的 `hasFanInMerge(root, taskId)` 用 `git log --all --merges --grep <taskId>` 判定「该任务分支已被合并」。`--all` 把**任务分支自身**也算进去，而每个 worker 在 fan-in 前都会执行 `git merge develop` 把 develop 合进任务分支，产生一条 `Merge branch 'develop' into task/<id>` 的 merge 提交——这条提交本身就命中该 grep。

于是：worker 走到 merge 这一步、但随后没能落地（exited-not-landed）的任务，`hasFanInMerge` 恒为 true。`isNotYetFlippedSkip` 的另一个合取项是「AC 完成度 >50% 或全勾」，而能走到 merge 这一步的任务通常已勾掉大部分 AC ⇒ 任务被 defer 为 `not-yet-flipped`、永不再派发；而它剩下的 AC（通常正是「全量绿」）没有任何机制去跑 ⇒ 也永不翻 done。两头都不动，结构性搁浅。

exited-not-landed 的 CONTINUE 豁免救不了它：该豁免只跳过 touches-overlap 一项，`slot-refill.ts` 的注释明确写明 not-yet-flipped / landed / self-touch / marker 各闸继续生效。

判别量是 **merge 提交对集成分支的可达性**，不是 merge 的方向——fan-in 走 ff，落地后任务分支上那条 `Merge branch 'develop' into task/<id>` 本身就成为 develop 的祖先。同一文件里的兄弟信号 `hasLandedImplementation`（:615）已经用的是 `git log develop`，只有 `hasFanInMerge` 用 `--all`，这是 5b 型的「同一原则只落实到被报出来的那一处」。

## Evidence

2026-09-11 实测对照（三条已 fan-in 的任务 vs 一条搁浅任务，同一读法）：

| 任务 | 命中 merge | 可达 develop | status |
|---|---|---|---|
| gap-meta-withfailureoutput | 7413e5ff8 | YES | done |
| gap-ac240-e2e-closure-same-run-pairing | 3924f54f4 | YES | done |
| gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated | 406f8b750 | YES | done |
| gap-prose-prereq-negation-blind-and-paragraph-scoped | 378948140 | NO | ready（搁浅） |

发生率（直接量，非窄窗）：扫全部 tasks/，status 为 ready 或 todo 且「存在命中 merge 但无一条可达 develop」的任务共 **6** 条，AC 完成度依次为 6/8、9/9、7/10、7/7、7/8、11/11——全部 >50%，全部结构性不可派发。其中三条分别承载 GOAL-009 的 AC-239 / AC-241 / AC-242，即该缺陷正把一个 active goal 的最后三条判据钉死。

## AC

- [x] AC1（缺陷复现，可取假）：在 `plugin/test/slot-refill.test.mjs` 用真 git fixture 造形态 A——任务分支上有一条 `Merge branch 'develop' into task/<id>`，且该分支从未合回 develop。改前的 `hasFanInMerge` 对形态 A 返回 true（红）。
- [x] AC2（修法）：`hasFanInMerge` 只数**可达集成分支**的 merge（读法与同文件 `hasLandedImplementation` 一致），集成分支由参数传入、默认 `develop`，不新写死第二个字面量。
- [x] AC3（改后读数）：同一 fixture 形态 A 上 `hasFanInMerge` 返回 false。
- [x] AC4（双向控制）：fixture 形态 B——任务分支已 ff 进 develop——改前改后 `hasFanInMerge` 均返回 true，证明修法没有把真 fan-in 一并判否。
- [x] AC5（消费者层）：`isNotYetFlippedSkip` 对形态 A 返回 false、对形态 B（AC 全勾）返回 true。
- [x] AC6（生产读数，枚举非布尔）：修后在本仓库跑 `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --json`，把 deferred 中 reason 为 `not-yet-flipped` 的 id **逐条列出**，并对每条打印其命中 merge 是否可达 develop；断言每一条都至少有一条可达的 merge（即不再有仅因本缺陷被判的条目）。
- [x] AC7（全量绿）：`scripts/test.sh` 全量绿。

## DoD

真实被搁浅的任务重新进入派发并实际落地——不是「测试存在」。具体：本修复合入 develop 后，那六条中至少一条重新被 driver 派发、完成 fan-in、status 翻 done，并在 `.quay/worker-round.jsonl` 留下对应派发记录。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/slot-refill.ts
- plugin/test/slot-refill.test.mjs
- tasks/gap-hasfaninmerge-all-refs-strands-exited-not-landed-tasks.md
