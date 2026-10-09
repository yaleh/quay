---
id: gap-goal032-preview-merge-and-postmerge-verify
title: GOAL-032 ③：预览试用、quay goal merge、并入后生产读数核验
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal032-selfhost-and-archguard-evidence
goal_ac: AC-349
---
**type:** execution

## Proposal

GOAL-032 的第三块，也是最后一块：在 AC-347/348 均已达成的前提下，发起 `quay goal merge`，并入后核验生产读数与合并形态（AC-349）。

## Plan

1. `quay goal preview GOAL-032 start --port <n>`（可选，本次改动风险小，若实现者判断没必要起 preview 也可，但若起则按惯例核验跑的是分支代码）。
2. `quay goal merge GOAL-032 --reason "…"`——记录一条 HUMAN 合并请求事件，真正的 merge 由 worker-driver 执行（SPEC-goal-branch §4.7）。
3. 等待（或在本任务的后续轮次里核验）worker-driver 完成 `goal/GOAL-032 → develop` 的机械 fan-in。**若 fan-in 在 suite 步骤红，先判断是否是与 GOAL-030/031 遇到过的同族"全量 suite 并发环境伪影"（可参照 `gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in`/`gap-loop-shipping-worktree-container-snapshot-toctou-race` 的诊断方法：先在隔离 worktree 单独跑失败的测试文件确认是否复现），⛔ 不要不经诊断就重试或改判据。**
4. 并入后：主检出追平 develop；核对 develop 上 `grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts plugin/scripts/goal-driver.ts` 两者均 ≥1；核对 `goal/GOAL-032` 以恰好一个合并提交进入 develop 的 first-parent 链（AC-349 criterion 已有该检查逻辑，可直接复用）。
5. 核对 GOAL-032 与 AC-347/348/349 的 staleness/achieved 状态在合并后正确收敛（`quay goal check --staleness`）。
6. ⛔ 本任务不重启任何生产 driver 进程。若实现过程中判断某个改动需要重启生产 goal-driver 进程才能在生产"生效"（区别于"代码已正确落地"），必须在任务体里**只报告**准备情况与影响，**不执行重启**，交回给调用方裁定。

## Acceptance Criteria

- [x] `.quay/gate-events.jsonl` 含一条 `GOAL-032` 的 `goal-merge-request` 事件，无 `--override`——`requestEventId 3353bb79-6b6b-4d31-a90c-55936b1e863a`（2026-10-09T02:59:58.909Z，actor `human`，tipSha `c0f192a8d0cd2849fe24eeed6c8b4a8ee9fa5cdf`），payload `override: null`、`unmetAcs: []`、`sufficiency.verdict: not-evaluated`（只展示不拦）。⚠️ 请求**之前**先修了一处声明缺陷（否则除 `--override` 外恒不可并入，而本 AC 禁止 override）：AC-349 是**结构上的并入后判据**（其 criterion 在 `goal-merge-result(outcome=landed)` 出现前恒 exit 3，判据首行自述 `exit 3 = 尚未并入`），但记录上缺 `phase` ⇒ 缺省 `pre-merge`（`goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-032)` 恒含 AC-349 ⇒ `quay goal merge` 恒被 `pre-merge-ac-unmet` 拒绝。已按 goal store 正本声明 `quay goal write AC-349 --phase post-merge`（author 提交 `3723086fd`；GOAL-030 的 AC-341/342、GOAL-031 的 AC-345 同形判据亦为 post-merge）。该修正**只改求值相位、不跳过验证**：`unmetPreMergeAcs` 修正后为空数组，而 AC-349 仍须在并入后被判定为 achieved（见 AC4 后的时序读数）
- [x] develop 上 `grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts` 与 `plugin/scripts/goal-driver.ts` 均 ≥1——并入后 develop（tip `0da918926afe058fa46358e35f310057ba225ebe`）：`git show develop:packages/quay/src/criterion-fidelity.ts | grep -c parseBinaryVerdict` = **4**，`git show develop:plugin/scripts/goal-driver.ts | grep -c parseBinaryVerdict` = **3**；主检出工作树读数与之一致（4 / 3，主检出在 2026-10-09T03:10Z 已追平 develop，`git rev-list --count develop..author` = 0）
- [x] `goal/GOAL-032` 以恰好一个合并提交进入 develop 的 first-parent 链，该合并提交的第二父提交 = 分支 tip——合并提交 `0da918926afe058fa46358e35f310057ba225ebe`（subject `merge: goal/GOAL-032 into develop (request 3353bb79-6b6b-4d31-a90c-55936b1e863a)`，2026-10-09T03:05:28Z）：`git rev-list --parents -n1` 词数 = 3（恰两父）、父 1 = `3723086fd`（develop 侧）、父 2 = `c0f192a8d`（= 请求事件记录的 goal tip）；`git rev-list --first-parent develop | grep -cx <landed>` = 1（在 first-parent 链上且只出现一次）；泄漏检查 `git rev-list <landed>^1..<tip> | grep -xF -f <first-parent 清单>` 为空（无 goal 分支内部提交混入 first-parent）；并入后 `git rev-parse --verify --quiet goal/GOAL-032` 为空 ⇒ 分支已被驱动删除（§4.7 步骤 4）。**AC-349 criterion 本体在主检出实跑**（`quay goal gate AC-349 --dry-run`，2026-10-09T03:10:44Z）⇒ `pass` / exit 0，`evaluationRoot: /data/home/yale/work/quay`
- [x] `quay goal check --staleness` 对 GOAL-032 不报任何新鲜度分歧——两次读数（硬规则 4c：判据点名的量在**读取时**必须仍取得到，故两次都记）：(a) **并入后、GOAL-032 仍 active 时**（2026-10-09T03:09Z）`{fresh:[GOAL-032], stale:[], notEvaluated:[], divergent:[], scopeSize:1, evaluated:true}` exit 0——GOAL-032 在**在域内**且三个分歧桶全空；(b) GOAL-032 经 I2 机械翻 `achieved` 后（2026-10-09T03:17:51Z）`{fresh:[], stale:[], notEvaluated:[], divergent:[], scopeSize:0, evaluated:false}` exit 0——goal 已离开 `activeGoals()` 的在域集合，故不再出现在任何桶里。**时点性说明**：并入 ⇒ AC-349 变可判 ⇒ 03:13:58 记 `pass` ⇒ 03:17:51 GOAL-032 `active→achieved`；读 (b) 的 `evaluated:false` 是「并入已把该 goal 从分歧窗口里带走」的后果，不是「没查成」（同 GOAL-031 任务记录的同一形态漂移）
- [x] 若判断需要生产 driver 重启：仅在任务体里记录「哪个 driver、读哪个配置、重启后行为会怎样变化、当前生产読数现状」，**不执行**——**判断：不需要重启；本任务全程未重启任何 driver 进程（`start`/`stop`/`restart` 一次都没调）**。理由与读数见下方 `## Notes` 的「生产生效面」一节

## Definition of Done

GOAL-032 以恰好一个合并提交进入 develop；develop 上两处调用方均已委托给 kernel；AC-347/348/349 在并入后全部可判定为真；全程未重启任何生产 driver 进程。

## Notes

**执行时序（全部为实测时刻，UTC）**

| 时刻 | 事件 |
|---|---|
| 02:57:07 / 02:57:10 | AC-347 / AC-348 在 `goal-GOAL-032` 判据 worktree 上求值 `pass`（AC-348 随后由 goal-driver 依 I2 翻 `achieved`，author 提交 `0b9b67cf4`） |
| 02:59:58 | `quay goal write AC-349 --phase post-merge` 之后（提交 `3723086fd`），`quay goal merge GOAL-032` 记录请求 `3353bb79`（`unmetPreMergeAcs` = `[]`） |
| 03:05:28 | worker-driver 机械 fan-in 成功：合并提交 `0da91892` 落到 develop，`goal/GOAL-032` 删除 |
| 03:08:51 | `goal-merge-result` 事件（`outcome: landed`，`requestEventId 3353bb79`，`landedSha 0da91892`，`tipSha c0f192a8d`） |
| 03:10:44 | AC-349 criterion 主检出实跑 `pass`（dry-run 读数） |
| 03:13:58 | AC-349 记 `pass`，状态 `active→achieved` |
| 03:17:51 | GOAL-032 `active→achieved`（`I2: all ACs achieved + sufficiency covered`） |

**并入尝试只有一次，且一次即绿**：首次请求 `3353bb79` 就是最终生效的那一次，没有出现 GOAL-030/031 遇到过的「并入临时树被 `.quay/` 快照里的孤儿交付 worktree 污染 ⇒ `loop-shipping` 的「恰好一份 `fast-mode-telemetry.ts`」转红」那一族伪影（03:05 那次 fan-in 曾成功穿过全量 suite），故 Plan 步骤 3 里那套「先隔离复现再归因」的诊断路径本轮无需启用。

**两处与 Plan 字面的偏离（据实记录，不是静默偏离）**

1. **未起预览实例（Plan 步骤 1 写明可选）**：GOAL-032 是**纯函数重构**（新增一个 kernel 纯函数 `parseBinaryVerdict` + 两处薄包装），没有 serve / Web UI / driver 运行时面可供试用——预览实例只会产出与判据 worktree 重复的读数，还得承担 §4.10 的孤儿 serve 回收风险。分支自举的实证改由 AC-348 已落盘的**模块解析身份证据**承担（`scripts/goal-032-selfhost-probe.mjs`：三条 realpath 全部落在 `goal-GOAL-032` 树内、`allMatch: true`，且对主检出跑同一 specifier 的负对照 `allMatch: false`——是可证伪的读数，不是常量）。
2. **声明了 AC-349 的求值相位**（见 AC1 的说明）。这是 SPEC-goal-branch §9.2 列的「实现期残留」，实现时就地决定并记入任务：不改 I2、不改 sufficiency 判据、不绕过任何验证。

**生产生效面（Plan 步骤 6 / AC5 要求的报告，⛔ 未执行任何重启）**

- **哪个 driver**：宿主持有 goal-driver 的是 **driver-anchor**（`/data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/home/yale/work/quay`），goal-driver 的循环**跑在该进程内**（`goal-round.jsonl` 的 `pid` 字段 = anchor pid，`run_id: gl-prod-anchor`）。本次改动落在 `plugin/scripts/goal-driver.ts` 与 `packages/quay/src/criterion-fidelity.ts`——这两个模块是它在启动时 `--experimental-strip-types` 一次性加载的，**运行中的进程不会热加载已改的文件**。
- **读哪个配置**：没有配置项控制这一加载——它读的就是主检出工作树里的 `.ts` 源文件本身（不读 `drivers.yml`、不读任何 feature flag）。
- **重启后行为会怎样变化：预期没有可观测变化。** 依据是本 goal 自己先做的等价性调查（GOAL-032 body「背景」）：两条旧实现与 `parseBinaryVerdict` 的算法逐字相同，唯一差异（`faithful`/`vacuous` vs `covered`/`insufficient`）是**作为数据传入**的合法词表，重构只是把代码搬进 kernel，词表逐字保留。⇒ 这是一次**行为保持**的重构；不重启的代价 = 进程内仍跑旧函数体，而旧函数体与新函数体同判。
- **当前生产读数现状**：**判据求值路径已经是新代码**——`gateCriterion` 经 `runAsync(goalStoreArgv(...))` 起**新进程**跑 `goal-store gate`，每轮都是新进程 ⇒ AC-349 于 03:13:58 直接用合并后的树判 `pass`，GOAL-032 于 03:17:51 走完 `achieved`，全程零重启。唯一仍持旧模块体的是 goal-driver **进程内**的 sufficiency 采样（`sampleSemanticSufficiency` 的解析那一层；判官本身是 `runAsync` 起子进程），如上所述行为等价。
- **另一件已发生但非本任务所为的事**：承载 goal-driver 的 anchor 于 **03:09:22Z** 自行重启（新 pid `3148965`，`--takeover 1770939`），该时刻晚于合并提交 `03:05:28Z`，且主检出在 03:10Z 已带合并后的文件（grep 4 / 3）⇒ 即便按「进程内模块」这条最严口径，当前生产 host 也已加载到委托版本。**这不是本任务触发的，本任务未调用 `quay driver start|stop|restart`。**

**收尾自检**：本任务 worktree（`/home/yale/work/quay-worktrees/gap-goal032-preview-merge-and-postmerge-verify`）已 `merge --no-edit develop`（fast-forward 到 `50729a266`）；`bash scripts/test.sh --for-task gap-goal032-preview-merge-and-postmerge-verify --allow-thin` ⇒ exit 0（selector 选了 0 个测试文件，thin allowed；全量 suite 仍由 fan-in 跑）；scoped 门缓存已按同一 develop sha 落盘（`--write-scoped-gate-cache` 报 `developSha a5d51b42…`，`cacheFile /data/home/yale/work/quay/.quay/scoped-gate-cache.json`）。

## Touches

- tasks/gap-goal032-preview-merge-and-postmerge-verify.md
