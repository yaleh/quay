---
id: gap-ac38-outer-doc-split
title: AC38: outer 双份文档漂移未切分（按 manager 先例同形切分）
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**AC38（manager 034125 实测）**：outer 双份文档漂移未切分。`plugin/loop/orchestrator-loop-tick.md` 1508 行 vs `orchestration/orchestrator-loop-tick.md` 1267 行，共同 727 行，**各有 540-780 行独有 = 漂移仍在**。

**对照 manager 已切分先例**：plugin 322 / orchestration 1647 —— manager 已完成同形切分，outer 没做。

**判据原文**：「outer 完成同形切分，切分后两份的独有内容各自可解释（产品行为 / 本层实例状态），并留切分声明」。

**实现归 inner。**

**验证锚**：修后 (a) 切分后两份独有内容各自可解释；(b) 留切分声明；(c) 按 manager 先例同形；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录漂移实测（plugin 1508 vs orchestration 1267，共同 727，各 540-780 独有）（本任务 Proposal 已含）
- [x] AC2: **同形切分**——按 manager 先例（plugin 322 / orchestration 1647）切分 outer 双份
- [x] AC3: **独有内容可解释**——切分后两份独有内容各自可解释（产品行为 / 本层实例状态）
- [x] AC4: **切分声明**——留切分声明
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：切分后两份独有行数 + 切分声明贴出
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence

**AC38 修后实跑（2026-08-12，inner 执行）**

**Contract measure（invoke）**：`comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l` = **729** 独有行（comm -12 共同 = 1043；文件行数 plugin 1515 / orchestration 1290）。

**切分实现（AC2/AC3）**：
- **plugin/loop/orchestrator-loop-tick.md → 产品行为正本**（随 `quay-init --loop` 铺到任何项目）。去 quay 实例化：工作分支模型不写死 quay 取值（改指 config `fork_baseline`/`merge_target` + 本层状态节）；目标项目清单不写死 quay/archguard/meta-cc（改 `<目标项目根清单>` + 实例指针）；3.5 批量合回 develop/integration 字面量改 `$FORK_BASELINE`/`$MERGE_TARGET`；`/home/yale/work/*` 路径改占位；`quay-0:inner` 改 `$TMUX_SESSION:inner` 约定 + 实例注记。
- **orchestration/orchestrator-loop-tick.md → 本层实例状态**（quay 自身消费）。新增 `## 本层状态` 节集中 quay 实例值（工作分支两线 develop/integration、外层 checkout=integration、目标项目 quay/archguard/meta-cc、tmux quay-0:inner、跨项目优先级、real-target 路径、层间 tick 间隔、suite-health/熔融-结晶指针）；保留 quay 特有判据取值与历史实测。
- **切分后各自独有可解释**：plugin 独有 = 产品行为（通用外层规则，无 quay 字面量）；orchestration 独有 = 本层实例状态（quay 网络取值 / 实测代价）。`outer-doc-split.test.mjs` 机械固化：plugin 无 `git branch -f develop integration` / 无 `/home/yale/work/` runnable 字面量 / 有 FORK_BASELINE+MERGE_TARGET config 引用；orchestration 有 `## 本层状态` 且含 quay 实例值。

**切分声明（AC4）**：四份文件各留 `切分声明（AC38`：
- `plugin/loop/orchestrator-loop-tick.md`（产品行为正本，含机械判据命令）
- `orchestration/orchestrator-loop-tick.md`（本层实例状态，指向 plugin 产品正本 + `## 本层状态` 节）
- `orchestration/orchestrator-tick-core.md`（执行核引用产品/实例两份）
- `plugin/loop/fast-mode-tick-core.md`（内层核引用同一批行为文件）

**测试（AC5）**：
- `scripts/test.sh --for-task gap-ac38-outer-doc-split --allow-thin` → **exit 0**（tick-core-static-check PASS：AC3 src:N 100% / AC4 pointer OK / AC5 numbering OK / AC6 prohibition；instrument-failure PASS 5/5；red-on-omission PASS；selector 0 test thin allowed）。
- 新增 `plugin/test/outer-doc-split.test.mjs` 6 用例全绿。
- 回归：tick-core-static-check / adr016-screen-use-check / no-manager-tick-doc-check / batch-vocabulary-check / inner-session-check / slot-free-trigger / self-report-vocab-audit / threshold-scope-check / red-window-shared-gate / tick-vocabulary / suite-state-trigger / reanchor-prompt / state-worded-clause-check / judgment-consumer-check —— 全绿（172 用例）。
- AC3 核验：shipped docs（plugin/loop/*.md + skills）零 `plugin/loop/` 路径引用（quay-init-loop-consumer-doc-refs 的 AC3 断言直接核验 PASS；其真安装用例因 worktree 缺 gitignored vendor 产物 plugin/vendor/quay/dist 而环境性失败，非本改动引入）。

**提交**：切分 / 声明 / 测试分步提交（见 commit 列表）。

## Touches

- plugin/loop/orchestrator-loop-tick.md（切分到产品行为）
- orchestration/orchestrator-loop-tick.md（切分到本层实例状态）
- plugin/loop/fast-mode-tick-core.md（切分声明）
- orchestration/orchestrator-tick-core.md（切分声明）
- plugin/test/（切分一致性用例）
- tasks/gap-ac38-outer-doc-split.md（自身：勾 AC + 贴证据）

## Contract

measure   doc_unique_lines = `comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l` 的 stdout 数字
band      doc_unique_lines 切分后每份独有可解释（各自主题单一）
invariant split_declared = 1（切分声明在场）
invoke    `comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l`（贴切分后独有行数）
control   同形切分；独有可解释；切分声明；既有不回归
resume    切分 / 声明 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 034125 全量 AC 求值。AC38 未开工，判据明确、红窗可做。实现归 inner。
