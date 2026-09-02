---
id: gap-continue-conflict-rule-missing-task-files
title: CONTINUE 冲突消解协议缺任务文件规则——6 条规则无一点名 tasks/*.md，相邻 3 条教「取 develop 版」⇒ 静默抹掉本轮 AC 勾选
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**实测（2026-09-02 调查）**：`worker-driver.ts` 的 `continueConflictResolutionNote()`（约 `:1176-1187`）给 CONTINUE worker 的冲突消解规则共 6 条 + 1 条 FF 段，**没有任何一条点名 `tasks/*.md`**（在该函数体行范围内 grep `tasks/` 命中 0；`plugin/test/worker-driver-resident.test.mjs:920-949` 的断言也只钉住 outline / code / dual-copy 三条，无任务文件断言）。

**为什么这是缺陷而不是「少一条可有可无的规则」**：现有 6 条里有 **3 条**（(1) outline / (3) dual-copy / (4) tick doc）逐字教「**take the develop version**」。任务文件是 markdown 不是 code，worker 若把它类比成「doc」就会取 develop 版，**静默抹掉自己这一轮已经勾上的 AC 勾选标记与写好的 `## Evidence`**。而抹掉后的产物与正确解**同形**——下一轮 fan-in 的 ac-precheck 才报红，且理由指向「AC 未勾」而非「合并把它抹了」，把一个合并缺陷伪装成一个实现缺陷（硬规则 3b 同族）。

**发生率（硬规则 12，查历史非等下一轮）**：生产载体 `.quay/worker-outcome.jsonl` 近期 `merge-develop` 失败 **48** 次，其中冲突面**只含** `tasks/*.md` 的 **11** 次、`tasks/` 与其它混合 **2** 次 ⇒ **13/48 涉及任务文件**。最近 6 次：`gap-execution-loop-productization-p2-p4`(08-30T16:20)、`gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered`(08-30T16:36)、`gap-suite-scheduler-main-lpt-missing`(09-01T01:46)、`gap-retire-inner-hygiene-delete-session-face`(09-01T13:33)、`gap-promotion-commit-message-misleading-on-first-track`(09-01T22:55)、`gap-quay-init-escalations-vendor-freshness-false-positive`(09-02T05:41)。

**负控制（证明现在靠的是即兴而非纪律）**：09-02T05:41 那次 worker 在无规则下解**对**了——合并提交 `9d874fafb` 对两边取并集（Touches 行采纳 develop 措辞、AC1/AC2 保留分支侧的已勾状态而 develop 侧未勾）。**补规则是把这次运气固化成纪律。**

**修法**：在 `continueConflictResolutionNote()` 增一条任务文件规则，语义直接取自 `orchestrator-tick-core.md:74` B16 的 A/B 类处置（per-hunk 取并集），并补上 `status:` 例外（worker 不写 frontmatter，取 develop 值）。规则语义（实现时写成与既有 6 条同风格的英文条目，本处不逐字钉死措辞）：

> `(2b) task files (tasks/<id>.md — your own task body or another task's)`：取双方 per-hunk 并集——**既**保留 develop 侧的改动（driver/manager 可能收窄了 `## Touches`、追加了 `## Needs-Human`、或翻了 `status:`），**也**保留分支侧的改动（AC 复选框勾选、`## Evidence` 新增段）。⛔ 不得「take the develop version」——那会静默丢掉本轮的 AC 勾选，下一轮 fan-in 的 ac-precheck 会以一个误导性理由报红。⛔ worker 不得自己写 `status:` frontmatter：`status:` 冲突一律取 develop 值（该字段归 promotion/worker driver 所有）。

**同族先例（不是重复，是同一协议的另一条规则增量）**：`gap-continue-prompt-conflict-resolution-protocol`（done，立的是 derived/outline + code 语义并集 + `commit --no-edit`）与 `gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward`（done，立的是 dual-copy + ff-not-fast-forward + modify/delete 三型）。两者都以「补一条 CONTINUE 规则」为形态各自立过任务，本条是第三条同形增量，覆盖它们都没覆盖的文件类。

**范围限定**：本条只做 CONTINUE 面的 A/B 类新冲突处置。B16 条款里的另两半**不在本条范围**——①「既有 needs-human 批量机械处理」（`worker-driver.ts:383` 逐字「人翻转 needs-human→ready 才恢复」，机械只有单向、无反向路径，需要一个决策者）；②B16-C「读两边意图」（早已切给 manager 语义面 `semantic-face-dispatch-record.ts:22` kind `b16c-conflict-intent`，但该 kind 记录数 = 0，是一条已声明未运行的路径）。这两半各自需要独立立案，不要在本条里顺手做。

**⚠️ 撰写注记**：本任务体**刻意不含复选框字面量**（`- ` 加方括号 x 的序列）。首版含 4 处该字面量，导致 `task check` 把其中一处数成一条**已勾选的 AC**（`acTotal:7 acChecked:1`，而真实为 6 条全未勾）——实现本条时若要在代码或测试里写该字面量，注意别把它写回任务体。

## Acceptance Criteria

- [x] AC1: **规则落地（按位置判定，非关键词）**——在 `continueConflictResolutionNote()` **函数体行范围内** grep `tasks/` 命中 ≥1；引用该计数时打印命中的实际行内容（硬规则 2）
- [x] AC2: **语义为并集且禁取 develop 版**——该规则文本同时含并集指示（`union` 或「并集」）与对 AC 勾选标记 / `## Evidence` 的保留指示，且含对「take the develop version」的显式禁止
- [x] AC3: **status: 例外与写所有权一致**——规则明确 `status:` 冲突取 develop 值、worker 不写 frontmatter；与 `orchestrator-tick-core.md:74` AC3「写所有权分离」不矛盾
- [x] AC4: **测试钉住**——`plugin/test/worker-driver-resident.test.mjs` 新增覆盖任务文件规则的断言（现有断言只钉 outline/code/dual-copy 三条）；`node --test plugin/test/worker-driver-resident.test.mjs` exit 0，贴输出
- [x] AC5: **负控制（能取假）**——把新规则文本从函数体删除后重跑 AC4 的测试**必须红**，恢复后必须绿；两次输出都贴出来
- [x] AC6: **生产路径可见（非 fixture）**——对一个**真实存在的** task id 调用 `buildContinueWorkerPrompt()` 生产路径，grep 其返回的 prompt 文本命中该规则；不得以 fixture/注入数据满足本条（硬规则 4 推论三）

## Definition of Done

规则落在生产 prompt 构造路径 `continueConflictResolutionNote()` 里并经 `buildContinueWorkerPrompt()` 对真实 task id 的一次实际调用中被 grep 到（**不是 fixture、不是测试替身**）；AC5 的双向负控制两次输出均已贴出（删规则→红、恢复→绿），证明该断言能取假而非空转；`--for-task` scoped 门 + 全量 suite 绿；改动经 fan-in 落到 develop，`git show develop:plugin/scripts/worker-driver.ts` 可见该规则。**仅有测试通过不算 done**——AC6 的真实 prompt 输出是本条的落地判据。

## Touches

- plugin/scripts/worker-driver.ts（continueConflictResolutionNote 增任务文件冲突规则 (2b)）
- plugin/test/worker-driver-resident.test.mjs（新增任务文件规则断言 + AC5 负控制）
- tasks/gap-continue-conflict-rule-missing-task-files.md（自身）
