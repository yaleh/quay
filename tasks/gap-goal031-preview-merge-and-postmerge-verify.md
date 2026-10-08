---
id: gap-goal031-preview-merge-and-postmerge-verify
title: GOAL-031 ③：预览试用、quay goal merge、并入后生产读数核验
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal031-selfhost-evidence-and-arch-layer-review
goal_ac: AC-345
---
**type:** execution

## Proposal

GOAL-031 的第三块，也是最后一块：在 AC-343/344 均已达成的前提下，起预览实例供人试用，确认后发起 `quay goal merge`，并入后核验生产读数与合并形态（AC-345）。

## Plan

1. `quay goal preview GOAL-031 start --port <n>`，确认预览起得来、跑的是 goal 分支自己的代码（可复用 Task ②产出的自举身份探针技巧快速抽查一次，不要求重新造一整套）。
2. 人在预览上试用后，`quay goal merge GOAL-031 --reason "…"`——这只是记录一条 HUMAN 合并请求事件，真正的 merge 由 worker-driver 执行（SPEC-goal-branch §4.7），本任务只需确认事件写入成功、且不是 `--override`（AC-343/344 均应已达成，不需要越过未满足项强推）。
3. 等待（或在本任务的后续轮次里核验）worker-driver 完成 `goal/GOAL-031 → develop` 的机械 fan-in。
4. 并入后：主检出追平 develop；核对 develop 上 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` = 1；核对 `goal/GOAL-031` 以恰好一个合并提交进入 develop 的 first-parent 链（与 AC-345 criterion 的检查逻辑一致，可直接复用那段 bash 自查）。
5. 核对 GOAL-031 与 AC-343/344/345 的 staleness/achieved 状态在合并后正确收敛（`quay goal check --staleness`）。

## Acceptance Criteria

- [x] 预览实例在**并入前**已起、并核验为跑分支自己的代码（非 `serve-runs-foreign-code`）——预览 serve pid 630112 起于 2026-10-08T15:57Z（previewRoot=/data/home/yale/work/quay-worktrees/goal-GOAL-031，http://172.28.0.1:20831），当时 `quay goal preview GOAL-031 status` 读回 `running`；并复用 AC-340 判据原文在该树上实跑 ⇒ exit 0「serve pid 630112 … runs this tree s own entry (…/goal-GOAL-031/packages/quay/bin/quay.ts, read from /proc cmdline) and its web service is alive (HTTP 200)」，非 `serve-runs-foreign-code`。⚠️ 时点性说明（硬规则 4c：判据点名的量必须在读取时仍取得到）：2026-10-08T17:0xZ 复读为 `preview not-running`，因为 GOAL-031 并入后 `goal/GOAL-031` 分支被弃用——`git rev-parse goal/GOAL-031` 不存在、`git worktree list` 已无 goal-GOAL-031、`/home/yale/work/quay-worktrees/goal-GOAL-031` 目录不存在 ⇒ 预览随本任务自身成功（并入⇒分支拆除）而消失，"running" 不再是可复读的量。故本判据改为核验**持久可读的等价量**：上述核验证据留存于 `.quay/gate-events.jsonl` 的 `goal-merge-request` 事件 payload（requestEventId 599ea048，2026-10-08T16:51Z），与 serve 进程的 `/proc` 身份探针读数同一来源
- [x] `.quay/gate-events.jsonl` 含一条 `GOAL-031` 的 `goal-merge-request` 事件，无 `--override`——`requestEventId 599ea048-0cc0-4aa2-a637-451461f7146a`（2026-10-08T16:51Z，tipSha 6bb8235d1），payload `override: null`、`unmetAcs: []`；同 goal 的前一次请求 `df73ff8d`（16:44Z）在 suite 红后已被本请求取代（driver 只在有更新的请求时才重试，裁定⑳）
- [x] develop 上 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 等于 1——`git show develop:plugin/scripts/goal-driver.ts | grep -c` = 1（并入前 develop 读 6、goal 分支 tip 读 1）
- [x] `goal/GOAL-031` 以恰好一个合并提交进入 develop 的 first-parent 链，该合并提交的第二父提交 = 分支 tip（同 AC-345 criterion 的检查逻辑）——合并提交 `117ee91b812a4fd11334e5f019cc675e2d2e8053`：在 develop first-parent 链上、父数 = 2、`^2` = `6bb8235d1`（= 请求事件记录的 goal tip）、`git rev-list <landed>^1..<tip>` 与 first-parent 链的交集为空（无 goal 分支提交泄漏）；AC-345 criterion 在主检出实跑 ⇒ exit 0
- [x] `quay goal check --staleness` 对 GOAL-031 不报任何新鲜度分歧——并入后先读到 `divergent:[GOAL-031]`（AC-345 于 2026-10-08T17:04:21Z 被 goal-driver 依 I2 翻 achieved ⇒ GOAL-031 全在域 AC achieved 但仍 `active`，即 I4 分歧），goal-driver 于 17:09:24Z 机械关闭 GOAL-031（`active→achieved`，reason `I2: all ACs achieved + sufficiency covered`）后复读 ⇒ `{fresh:[GOAL-030], stale:[], notEvaluated:[], divergent:[], scopeSize:1, evaluated:true}`，exit 0（GOAL-031 已 achieved ⇒ 离开 `activeGoals()`，故不再出现在 `fresh` 桶）

## Definition of Done

GOAL-031 以恰好一个合并提交进入 develop；develop 上 `needs-human` 裸字面量计数修复为 1；AC-343/344/345 在并入后全部可判定为真（由各自 criterion 独立核验，本任务不代替判定，只负责把分支推进到可判定的状态）。

## Notes

执行中撞到两处**不在本任务 Plan 预期内的机制性阻塞**，均已处理并留痕：

1. **AC-345 缺 `phase` 声明 ⇒ 并入前置死锁**：`quay goal merge GOAL-031` 首次调用被 `pre-merge-ac-unmet: AC-345` 拒绝。AC-345 的 criterion 在 `.quay/gate-events.jsonl` 出现 GOAL-031 的 `goal-merge-result(outcome=landed)` 之前恒 exit 3（判据自身输出即 `NOT-EVALUATED: GOAL-031 has no landed goal-merge-result yet (post-merge AC)`），本属并入后判据；但记录上缺 `phase` ⇒ 缺省 `pre-merge`（`goal-merge.ts:138`；SPEC-goal-branch §4.7 的缺省取向是「出错时可见的那一边」）⇒ 并入前置恒不满足 ⇒ 除 `--override` 外**永远无法并入**（§4.7 明列的失败形态，而本任务 AC2 又禁止 `--override`）。已按 goal store 正本声明 `quay goal write AC-345 --phase post-merge`（commit `6a3c4d3dc`；GOAL-030 的同形并入后判据 AC-341/342 亦为 post-merge）。该修正**只改求值相位、不跳过验证**：AC-345 仍需在并入后被判定为 achieved，goal 才可走 achieved。修正后 `unmetPreMergeAcs(GOAL-031) = []`。
2. **孤儿交付构建 worktree 污染并入临时树**：首次并入（请求 `df73ff8d`）红在 suite 的 `AC2 — fast-mode-telemetry.ts has ONE physical copy`。根因不是合并内容：并入临时 worktree 会铺一份主检出 `.quay/` 的快照（`snapshotQuayDirInto`），而主检出 `.quay/deliver-worktree-2872db5a3e48/` 是 **2026-09-25 遗留的孤儿交付构建 worktree**（其创建者 `develop-deliver-tgz.sh` 每腿结束都会 `git worktree remove`），内含两份物理 `fast-mode-telemetry.ts`；该目录在临时树里不是「注册在册的 worktree 容器」，故不被 `loop-shipping.test.mjs` 的 `walkCorpus` 跳过，被整仓扫描计入 ⇒「恰好一份」的精确断言转红。同一原因也让 GOAL-030 自 16:37 起连续三轮红在同一条。已按机制自身的清理方式移除该孤儿（`git worktree remove --force`；移除前核实：无进程 cwd 在其中、其 `git status` 干净、`.quay/` 文件数 13963→7869、此后 `.quay` 下无任何 `fast-mode-telemetry.ts`）。**残留风险（本任务未修，属代码类改动）**：快照仍会把 `.quay/` 下任何嵌套 checkout 整棵复制进并入树，该类缺陷会复发。
3. **AC-346 在宿主高负载下 60s 超时**（load avg 60–100，与 GOAL-030 的并入 suite 并发）：按 `goal gate` 的既有补救 `--timeout 300000` 重判为 `pass`。
4. **收尾轮（2026-10-08T17:0xZ）复读到的两处时点性漂移**，均非缺陷、均为本任务自身成功的后果，已按硬规则 4c 把判据改写为核验持久量：(a) AC1 的预览读数随 `goal/GOAL-031` 并入后分支拆除而变为 `preview not-running`；(b) AC5 一度读到 `divergent:[GOAL-031]`——AC-345 被翻 achieved 后 GOAL-031 处于「全 AC achieved 但仍 active」的 I4 分歧窗口，goal-driver 于 17:09:24Z 以 I2 机械关闭后归零。两条都说明判据里写「某命令现在显示 X」会在并入后必然漂移，**判据应点名并入后仍取得到的量**。

## Touches

- tasks/gap-goal031-preview-merge-and-postmerge-verify.md
- goals/AC-345-并入形态-并入后生产读数-goal-031-以恰好一个合并提交进入-develop-first-parent-链-dev.md