---
id: gap-delivery-critical-mechanical-axis-orphaned-needs-ruling
title: delivery-critical 机械排序轴（slot-refill/concurrent-batch-scheduler,
  AC36）正式退役——人 2026-09-07 裁定不接入 worker-driver，清理孤儿代码/检查器/测试/catalog 条目
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Ruling（人 2026-09-07 裁定：正式退役）

**裁定**：`delivery-critical` 机械排序轴（AC36，`slot-refill.ts` + `concurrent-batch-scheduler.ts`）**正式退役**。
不接入 `worker-driver` 真实链路；delivery-critical 的优先性此后**完全由 selector 语义判断**承担
（`driver-runtime.ts:731-740` → `orchestration/dispatch-preference.md` 覆盖段谓词）。

**理由（采纳 worker 2026-09-07 实查的推荐，见下 Finding）**：
1. delivery-critical 阶段近尾声（`dispatch-preference.md` 实测 72 条带标签者 done 69 / superseded 1 / ready 2）——
   为一个即将失去输入的轴付接入成本不划算。
2. AC56（`gap-ac56-recommended-deordered`）已把机械轴与派发输出解耦（`slot-refill.ts:1201-1212`，
   注释逐字「the inner tick does NOT consume for dispatch」）；再接入需把 `deliveryCritical` 穿透
   `ready-pool-check → driver-runtime → worker-driver` 并补端到端测试，成本 > 阶段余量。
3. 机械孤儿与 `dispatch-preference.md` 覆盖段构成「同一语义两套实现」的漂移面，退役即消除。

**⊢ 本次退役符合该机件自己声明的失效前提**：`capability-catalog.sh:779` 逐字——
「失效前提：slot-refill --json 仍暴露 ranking 数组（移除或改形状则判据② 失去机械读面，本条失效）」。
移除 `ranking` 的 `deliveryCritical` 读面即触发该前提 ⇒ `ac36-sortkey-criterion-check.ts` 随之退役，
**不是"删一个还有效的检查"**。

## 范围（⛔ 显式不动的部分，防过度删除）

**在本次退役范围内**：
- `slot-refill.ts:1159-1175` `candidates.sort` 的 `delivery_critical` 第二排序轴（排序键回到 `(blocking_suite, id)`）。
- `slot-refill.ts:1218-1231` `ranking` 数组里的 `deliveryCritical` 字段（AC36 判据② 的唯一读面）。
- `concurrent-batch-scheduler.ts:110-118` `parseCandidate` 导出的 `deliveryCritical` 布尔（及其 `labels` 若无其它消费者）。
- `plugin/scripts/ac36-sortkey-criterion-check.ts` + `plugin/test/ac36-sortkey-criterion-check.test.mjs`（20 条 test）。
- `capability-catalog.sh` 中该脚本的四处条目（描述 `:104` / 节奏 `:453` / 失效前提 `:779` / 日期 `:1105`）。

**⛔ 显式不在范围内（动了即为过度删除）**：
- `slot-refill.ts:1025-1033`、`:1391-1396` 的 `delivery_critical_in_flight` —— 那是另一条任务
  （`gap-delivery-critical-label-at-promote-not-after-dispatch`）的产物，**不是排序轴**，本裁定未涉及。
- `ready-pool-check.ts` / `promotion-driver.ts` / `task-ops.ts` 里的 delivery-critical **打标签**路径
  （立案/晋升时按证据打标签）—— 那是 selector 语义路径的**输入**，退役排序轴后它更重要，必须保留。
- `plugin/scripts/ac56-recommended-deordered-check.ts` —— 它只读 `recommended` 数组与
  `recommended_order`/`recommended_unordered` 注解（实查：不读 `ranking`），退役后判据仍成立且仍应绿。
- `orchestration/dispatch-preference.md` 覆盖段的 delivery-critical **谓词本体**（`:22`）—— 保留，它是幸存机制。
- `outer-driver.ts` 自身的存废 —— 另议，不在本任务。

## Finding

**背景（worker 2026-09-07 实查，非猜测）**：`delivery-critical` 在派发决策上有两条互不相通的路径：

**路径 A（机械，写得完整但接不到生产）**：
- `plugin/scripts/slot-refill.ts:1030`（`dcLabels`）+ `:1159-1175`（`candidates.sort`）把排序键从
  `(blocking_suite, id)` 改成 `(blocking_suite, delivery_critical, id)`——`gap-ac36-delivery-critical-priority-axis`
  （已 done）落地的真实机械代码。
- `plugin/scripts/concurrent-batch-scheduler.ts:110-118`（`parseCandidate`）读 frontmatter `labels`，暴露 `deliveryCritical` 布尔。
- **但** `slot-refill.ts:1201-1212`（AC56，已 done）把这条优先序从输出的 `recommended` 数组里去掉——
  `recommended` 重新按字典序排列，`ranking`（携带 `deliveryCritical`）只作为「验证面」保留，
  注释逐字：「the inner tick does NOT consume for dispatch」（`slot-refill.ts:1209`）。
- 唯一把 `slot-refill.ts` 接入「读数→动作」链条的调用方是 `plugin/scripts/outer-driver.ts:223-234`（`slotRefillRoutine`）。
- **`outer-driver.ts` 不在标准启动集**：`plugin/scripts/start-drivers.ts:30`
  `const DRIVER_KINDS = ["promotion", "worker"] as const;`——标准冷启动（`quay:drivers` skill）只起两种 kind。
- 即使起了，读数也无消费者：`orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md:56` 逐字
  「Fact 的内容无任何程序消费者」。

**路径 B（真实在跑，纯靠 LLM 自觉）**：
- `worker-driver.ts` 对 `slot-refill` 零 import/零调用（grep 实测）。
- 候选集来自 `driver-runtime.ts:704-711`（`readyPoolCheck`）的 `pool.ready`——`ready-pool-check.ts:2147`
  只是 `ready.sort()`（纯字典序，无 delivery-critical 轴），且 `pool.ready` 仅 id 字符串，
  `deliveryCritical` 布尔虽在 promote 路径算出（`ready-pool-check.ts:1750-1786`）但未随之传出。
- 真正「挑一个」的动作由 `driver-runtime.ts:731-740`（`defaultSelectorArgv`）构造 prompt、spawn LLM 子代理
  （`worker-default` profile），令其读 `orchestration/dispatch-preference.md` 按覆盖段谓词判断——
  **prompt 只传 candidate id 列表，不传 `labels`**，delivery-critical 判断完全交给该子代理自读文件。
- 实证：`.quay/worker-dispatch.json` 的 `selectorReason` 确含按 delivery-critical 谓词推理的痕迹
  ⇒ 这条纯 prompt 路径「目前碰巧在跑」，但机制上无代码强制。

**核心问题（已由上面 Ruling 裁决）**：同一语义目标的两套实现，一套有测试保证但是孤儿，一套是生产路径但无机制保证。

## AC

- [x] **排序轴移除（正向 + 负控制，一条命令各出一个数）**：`plugin/scripts/slot-refill.ts` 的
      `candidates.sort` 比较体与 `ranking` 构造中 `deliveryCritical` **零命中**
      （`sed -n '1150,1240p' plugin/scripts/slot-refill.ts | grep -c deliveryCritical` ⇒ `0`）；
      **负控制**：同文件 `delivery_critical_in_flight` 相关行**仍非零命中**
      （`grep -c delivery_critical_in_flight plugin/scripts/slot-refill.ts` ⇒ ≥2，打印命中行）——
      两个数一起贴，只贴前者不算（零计数须配「谓词对已知为真样本干跑」，硬规则 2）。
- [x] **`concurrent-batch-scheduler.ts` 去 DC**：`grep -c 'deliveryCritical' plugin/scripts/concurrent-batch-scheduler.ts` ⇒ `0`；
      且全仓库对 `parseCandidate(...).deliveryCritical` 的非测试消费者为 0
      （`grep -rn 'deliveryCritical' --include=*.ts plugin/scripts/ | grep -v node_modules` 输出贴出，
      剩余命中必须全部落在上面「范围外」清单里，逐条对应）。
- [x] **检查器退役**：`plugin/scripts/ac36-sortkey-criterion-check.ts` 与
      `plugin/test/ac36-sortkey-criterion-check.test.mjs` 删除；
      `node --experimental-strip-types plugin/scripts/deletion-closure-check.ts`（或套件内等价关口）对该删除通过——
      即全仓库对 `ac36-sortkey-criterion-check` 的引用为 0（`grep -rn` 贴出，`docs/analysis/dead-set-recomputed.json`
      这类快照文件若命中，一并核对是否需同步）。
- [x] **catalog 四表同步**：`plugin/scripts/capability-catalog.sh` 中 `ac36-sortkey-criterion-check.ts`
      的四处条目（`:104` 描述 / `:453` 节奏 / `:779` 失效前提 / `:1105` 日期）全部移除；
      `bash plugin/scripts/capability-catalog.sh` 退出 0，且自报的 `summary: N scripts` 比改前**少 1**
      （改前/改后两个 N 都贴出，不硬记数字）。
- [x] **closure baseline 重锚**：因 `capability-catalog.sh` 变更，跑
      `node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor`
      更新 `docs/analysis/quay-init-closure-ratchet.baseline.json`；
      `runner-static-gate.ts` 的 re-anchor freshness 检查绿（贴输出）。
- [x] **单测同步**：`plugin/test/slot-refill.test.mjs`（现 42 处 DC 命中）与
      `plugin/test/concurrent-batch-scheduler.test.mjs`（现 18 处）中断言该排序轴的用例删除或改判为「无 DC 轴」；
      若 `@test-group` / 用例数变更触及 ratchet 基线，同步更新基线（贴出基线 diff 或说明「无基线涉及」）。
- [x] **`dispatch-preference.md` 记录退役**：写下一行明确「AC36 机械排序轴已于 2026-09-07 按人裁定退役，
      delivery-critical 优先完全由 selector 语义判断，无机械保证」——
      `grep -n '机械排序轴' orchestration/dispatch-preference.md` 命中该行（贴出）；
      ⛔ 覆盖段谓词本体不动。
- [x] **SPEC 同步**：`orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md` §2.1
      中 outer-driver Fact「无程序消费者」那条，补上「AC36 机械排序轴已于 2026-09-07 按人裁定退役、孤儿代码已清理」的结论
      （`grep -n '2026-09-07' <该文件>` 命中，贴出）。

## DoD

- [x] 上述每条判据本轮**实跑并贴出输出**，不是转述；零计数的那几条附带负控制读数。
- [x] 退役后**全量 suite 绿**（`scripts/test.sh`），且绿的那一轮在移除之后（贴 suite 结束时刻与移除提交时刻，后者早于前者）。
- [x] `git log` 上有一次真实的删除提交（`git show --stat` 可见 `ac36-sortkey-criterion-check.{ts,test.mjs}` 被删）。

## Touches

- `.quay/suite-bucket-reattribution.jsonl`
- `plugin/scripts/slot-refill.ts`
- `plugin/scripts/concurrent-batch-scheduler.ts`
- `plugin/scripts/ac36-sortkey-criterion-check.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/slot-refill.test.mjs`
- `plugin/test/concurrent-batch-scheduler.test.mjs`
- `plugin/test/ac36-sortkey-criterion-check.test.mjs`
- `plugin/test/ac56-recommended-deordered-check.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `docs/analysis/test-file-baseline.txt`
- `docs/analysis/dead-set-recomputed.json`
- `orchestration/dispatch-preference.md`
- `orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md`
- `tasks/gap-delivery-critical-mechanical-axis-orphaned-needs-ruling.md`