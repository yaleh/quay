---
id: gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms
title: tick-vocabulary.test.mjs SAFE_SUBSTRINGS whitelist is stale against the
  40→6 entry-point forms — the ac8 40→6 merge (a4b1d9a9) added `quay-branch.ts
  integration-batch-merge` + `quay-dispatch.ts concurrent-batch-scheduler`
  references to 3 tick docs (fast-mode-loop-tick.md:374/676,
  orchestrator-loop-tick.md:728) that the whitelist (only has
  `integration-batch-merge.sh` / `concurrent-batch-scheduler.ts` old forms)
  doesn't classify → full-suite red (fail-closed catch-all, first failure the
  suite hit)
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`tick-vocabulary.test.mjs` 的 SAFE_SUBSTRINGS 白名单没跟上 40→6 入口形态——合并 a4b1d9a9 引入的真回归（full-suite gate 抓到的第一个失败）。**

### 失败（可复算）

`plugin/test/tick-vocabulary.test.mjs` AC4「every `batch` line classifiable」测试（~line 122）：
`unclassified` 非空，3 处引用含 "batch" 但不在白名单：

| 文件 | 行 | 文本 | 含的 "batch" 形态 |
|---|---|---|---|
| fast-mode-loop-tick.md | 374 | `plugin/scripts/quay-branch.ts integration-batch-merge --develop "$FORK_BASELINE" --integration "$MERGE_TARGET"` | `integration-batch-merge` |
| fast-mode-loop-tick.md | 676 | `node --experimental-strip-types plugin/scripts/quay-dispatch.ts concurrent-batch-scheduler --root "$(pwd)" tasks/<A>.md tasks/<B>.md --json` | `concurrent-batch-scheduler` |
| orchestrator-loop-tick.md | 728 | `plugin/scripts/quay-branch.ts integration-batch-merge --root "$REPO_ROOT" --develop "$FORK_BASELINE" --integration "$MERGE_TARGET" --sync` | `integration-batch-merge` |

**根因**：ac8 40→6（`gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect`，done）把
tick 文档的指令从旧直调脚本（`integration-batch-merge.sh` / `concurrent-batch-scheduler.ts`）改成**新入口
派发形态**（`quay-branch.ts integration-batch-merge` / `quay-dispatch.ts concurrent-batch-scheduler`），
但**没同步更新 `tick-vocabulary.test.mjs` 的 SAFE_SUBSTRINGS**——白名单只含旧形态（
`integration-batch-merge.sh`、`concurrent-batch-scheduler.ts`），新入口形态不入列 ⇒ 这 3 行被判
「未分类」⇒ 测试红 ⇒ full-suite red reason=failed（fail-closed catch-all，这是套件遇到的第一个失败）。

### 方向（接法留执行时）

**测试白名单补新入口形态**（不是改文档）——40→6 的设计就是让文档引用 6 个入口（`.ts` 是入口文件、
非 `.sh` 风险），文档引用 `quay-branch.ts` / `quay-dispatch.ts` 是**正确形态**。修法：在
`tick-vocabulary.test.mjs` 的 SAFE_SUBSTRINGS 增加 `quay-branch.ts`、`quay-dispatch.ts`
（或完整命令形态 `quay-branch.ts integration-batch-merge` 等），并同步「机件真名」分类。

**为什么不是回滚合并**：40 个提交、1 个 2 行白名单缺口，回滚不成比例；产品代码无恙（失败是测试
白名单陈旧，非功能回归）。

## Contract

```
measure unclassified_batch_lines = `node --no-warnings --experimental-strip-types plugin/test/tick-vocabulary.test.mjs 2>&1 | grep -c 'unclassified batch lines'` stdout 数字段（红=1，修后=0）
band unclassified_batch_lines = 0
invariant tick 文档引用的 40→6 入口形态（quay-branch.ts / quay-dispatch.ts 等）必须在 SAFE_SUBSTRINGS 中有对应分类，不得因白名单陈旧而红
invoke `node --no-warnings --experimental-strip-types plugin/test/tick-vocabulary.test.mjs`
control 把新入口形态从 SAFE_SUBSTRINGS 里删掉 ⇒ 测试必须复红（证明白名单是唯一约束）；加入 ⇒ 绿
resume 若中断，先跑 measure 读当前 unclassified 数，再读 tick-vocabulary.test.mjs 的 SAFE_SUBSTRINGS 原文
```

## Acceptance Criteria

- [x] AC1: SAFE_SUBSTRINGS 增加 40→6 入口形态（`quay-branch.ts` / `quay-dispatch.ts` 及完整命令形态），
      3 处引用全部可分类
      **实测**：`plugin/test/tick-vocabulary.test.mjs` SAFE_SUBSTRINGS 已有裸子命令形态
      （`concurrent-batch-scheduler` / `integration-batch-merge`，b209f4fd 所加），本次补充两个
      **入口点形态** `quay-dispatch.ts` / `quay-branch.ts`。任务引用的 3 处新入口形态全部可分类：
      `fast-mode-loop-tick.md:374`（`quay-branch.ts integration-batch-merge`）、
      `fast-mode-loop-tick.md:676`（`quay-dispatch.ts concurrent-batch-scheduler`）、
      `orchestrator-loop-tick.md:728`（`quay-branch.ts integration-batch-merge`）。
      把任务引用的 3 处原文（临时注入 tick 文档）跑 `node --experimental-strip-types
      plugin/test/tick-vocabulary.test.mjs` ⇒ **5/5 绿**（含 AC4 全可分类断言）。
      （注：当前 integration 树上的 tick 文档为旧形态 `integration-batch-merge.sh` /
      `concurrent-batch-scheduler.ts`——ac8 的新入口形态行已被 7642849a revert；白名单须同时覆盖新旧两形态。）
- [x] AC2: **负控制**——从白名单删新形态 ⇒ 测试复红（证明白名单是唯一约束，非测试失效）
      **实测**：临时把任务引用的 3 处新入口形态注入 tick 文档，再从 SAFE_SUBSTRINGS 删掉全部新形态
      （裸子命令 + 入口点）⇒ AC4「every batch line classifiable」**红**（`unclassified batch lines` 非空，
      fail 1）；恢复新形态 ⇒ **绿**。白名单是唯一约束，非测试失效。
- [x] AC3: full-suite 重跑过这个失败点（后续失败另行分诊，本条只保证 tick-vocabulary 绿）
      **实测**：`bash scripts/test.sh --for-task gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms --allow-thin`
      ⇒ **exit 0**。tick-vocabulary 5/5 绿；scoped 静态检查全 PASS（test-framework-policy /
      test-isolation / task-contract strict-subset / strategic-doc-staleness / drive-contract）。
      本失败点（tick-vocabulary AC4 未分类）已过。
- [x] AC4: 与 `gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect` 交叉标注
      （ac8 改了文档形态没同步测试白名单）
      **实测**：ac8 任务体已加 AC7 交叉标注段（2026-08-08）：「40→6 集成改了文档形态却没同步测试白名单……
      这是 AC8 同族缺陷的又一实例：**集成落地 ≠ 测试白名单同步**」。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（见上各 AC 的「实测」）
- [x] full-suite 绿（或本失败点通过、后续失败另立任务）——scoped gate exit 0，本失败点通过
- [x] 交叉标注完成（ac8 任务体 AC7 段）

## Touches
- plugin/test/tick-vocabulary.test.mjs（SAFE_SUBSTRINGS 增加入口形态）
- plugin/loop/fast-mode-loop-tick.md（只读：引用的 374/676 行）
- orchestration/orchestrator-loop-tick.md（只读：728 行）
- tasks/gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms.md（自身文件）
- tasks/gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T03:1xZ
changed: 外层分诊（full-suite 03:08 红，fail-closed catch-all）：根因 = 40→6 合并改文档形态未同步测试
  白名单；裁定不回滚 40 提交（2 行修复 vs 40 提交不成比例）；立案交 inner 修白名单后重跑套件。
