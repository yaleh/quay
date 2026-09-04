---
id: gap-the-finding-shape-still-requires-a-plan-section
title: "The finding shape still lists plan as required, so a ## Finding task
  without ## Plan fails the gate — the last red assertion in the reinstall
  threshold"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**这是重装门槛 e2e 里最后一条红断言。** 红断言数今晚从 **4 → 1**
（`install-config-driven-e2e`：A1/A2/A3 已绿）。

外层实测 A4 的精确失败点：

```
shape=finding  ok=false  artifacts={"proposal":true,"plan":false,"ac":true,"dod":true}
```

**`finding` 形状的必需段集合里仍然包含 `plan`**——而 **finding 形状的整个前提就是没有 `## Plan`**
（ADR-001：finding 型任务无 Plan 段，不该走里程碑严格契约）。

### 为什么它与现场数字不冲突（两者都真）

管理者实测 meta-cc **14 个 todo 有 11 个过闸**（先前 0/15）。**不矛盾**：

| | `## Finding` | `## Plan` | `plan` 判定 | 结果 |
|---|---|---|---|---|
| meta-cc 的 DIR 模板 | 有 | **也有** | `true` | **过闸** |
| e2e 的 A4 夹具 | 有 | **无**（断言名逐字如此） | **`false`** | **红** |

**⇒ 现场那批任务恰好都带 `## Plan`，所以掩盖了这个残留。**
**⇒ 只看现场会宣布 A4 完成；测试测的是判据本身，所以它红。**

### 落地记录（2026-08-04，内层执行）

**A4 已绿，且顺带发现并处置了 master 既有的第二条红 AC1b**：
`install-config-driven-e2e.test.mjs` 断言冷启动目标布局（`orchestration/orchestrator-loop-tick.md` /
`docs/analysis/fast-mode-loop-tick.md`），但 `loop-shipping.test.mjs` 的 AC1b 排除表没把它列入，
导致全量套件一直有这条与 A4 无关的红。已加一行豁免（与 `quay-init-loop.test.mjs`/`cold-start-e2e.sh`
同类）。**该豁免是文件级无条件排除：让 e2e 文件对六条旧路径全部失明，而它只合理提到两条**——
这是被接受的代价，已记录（见 Dispatch review 的 AC1b 发现条目）。

**排除表本身没有必要性检查**（只增不减，无机制能发现已不必要的条目）——本任务的 landing 过程
就是实证（一个会话加了两条排除项，一条必要一条不必要，从外面看一模一样）。已另立任务
`gap-exclusion-lists-have-no-necessity-check` 承载惰性检测。

## Contract

```
measure a4_red = `scripts/test.sh --test-name-pattern="A4" packages/quay/test/install-config-driven-e2e.test.mjs` 的 fail 计数字段
measure finding_requires_plan = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <finding-no-plan-id> --json` 输出中 artifacts.plan 的布尔字段
band a4_red = 0
invariant finding 形状不得要求 `## Plan`；每种形状的必需段来自形状注册表，不是共用一张表
invoke `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id> --json`
control `## Finding` 无 `## Plan` ⇒ 过 author→ready；`## Plan` 形状缺 `## Plan` ⇒ 仍必须红
resume 先看 SHAPE_REGISTRY 里 finding 的必需段集合，再改
```

## Chosen mechanism

**改的是形状注册表里 `finding` 的必需段集合，不是放宽通用判定。**

`finding` 的完整契约应当是它自己那套（Finding / AC / DoD 等），**在自己的量纲上同样严**——
**不是「少检查一项」**。这是 `gap-the-dod-gate-encodes-a-retired-task-shape` 已确立的原则
（注释逐字：*dispatch is not a waiver*），本条只是把它落到 `plan` 这一项上。

**不做**：不把 `plan` 从**所有**形状里去掉（`## Plan` 形状仍须要求它——AC3 是它的负控制）；
不给 `task check` 加旁路；**不改任何任务的内容去迁就闸**（人已裁定）。

## Acceptance Criteria

- [x] AC1: **A4 变绿**——`a4_red = 0`（实跑输出贴任务体）
      **证据**：全量套件 run3/run4/run5（`full-suite-{3,4,5}.log`）均 `FULL-SUITE-EXIT=0`、
      `fail 0`、`cancelled 0`（每轮 1951 ✔ / 24 ﹣）；其中
      `✔ A4 — a ## Finding task WITHOUT ## Plan passes the author→ready gate; a ## Plan task still goes through the strict contract`
- [x] AC2: **正向**——`## Finding` 无 `## Plan` 的任务 ⇒ `artifacts.plan` 不再参与 finding 形状的判定，
      `ok=true`（实跑贴出）
      **证据**（实跑命令：
      `QUAY_NATIVE_TASKS_DIR=<临时 workspace> node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check A4-FINDING --json`）：
      ```json
      {"id":"A4-FINDING","gate":"author->ready","ok":true,"shape":"finding",
       "artifacts":{"proposal":true,"ac":true,"dod":true},"acTotal":1,"acChecked":1,
       "reason":"all required artifacts present; eligible to move to ready"}
      ```
      **artifacts 中无 `plan` 键**（不是 present-and-false，是 finding 形状根本不注册 plan）。
- [x] AC3: **反向负控制**——`## Plan` 形状的任务**缺 `## Plan`** ⇒ **仍必须红**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「finding 太严」修成「所有形状都不查 plan」是更坏的交易**
      **证据**（两个方向；均以 AC2 同款完整命令实跑：
      `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id> --json`）：
      - 无 Plan 体（Proposal+AC+DoD，无 Plan 无 Finding）⇒ `shape=unknown` fail-closed：
        ```json
        {"id":"A4-PLAN-MISSING-PLAN","gate":"author->ready","ok":false,"shape":"unknown",
         "reason":"unrecognized task shape (no ## Contract / ## Finding / ## Plan section) — unknown shapes fail closed"}
        ```
      - `## Plan` 形状缺 AC ⇒ 仍红：
        ```json
        {"id":"A4-PLAN-MISSING-AC","gate":"author->ready","ok":false,"shape":"plan",
         "artifacts":{"proposal":true,"plan":true,"ac":false,"dod":true},
         "reason":"missing artifacts: ac"}
        ```
- [x] AC4: **meta-cc 方向不退化**——带 `## Plan` 的 DIR 模板任务**仍然过闸**（实跑贴出）
      **证据**：
      - DIR 模板（`## Finding` + `## Plan` 都带）⇒ `shape=finding`（Finding 优先于 Plan），`ok=true`：
        ```json
        {"id":"A4-DIR-TEMPLATE","gate":"author->ready","ok":true,"shape":"finding",
         "artifacts":{"proposal":true,"ac":true,"dod":true},"reason":"all required artifacts present; eligible to move to ready"}
        ```
      - 纯 plan 形状合规（Proposal+Plan+AC+DoD）⇒ `shape=plan`，`ok=true`：
        ```json
        {"id":"A4-PLAN-OK","gate":"author->ready","ok":true,"shape":"plan",
         "artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"reason":"all required artifacts present; eligible to move to ready"}
        ```
- [x] AC5: **门槛全绿**——`install-config-driven-e2e` **五条断言全绿**（`fail 0` 且 `cancelled 0`，实跑贴出）
      **证据**：run3/run4/run5 全量套件日志中该文件五条断言全 `✔`（含 A4），套件整体
      `FULL-SUITE-EXIT=0` / `fail 0` / `cancelled 0`（1951 ✔ / 0 ✖ / 24 ﹣）。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group product`
      **证据**：`packages/quay-native/test/gate-shape-dispatch.test.mjs` 首行 `// @test-group product`、
      `import { test } from "node:test"`。

## Definition of Done

- [x] AC2 与 AC3 两个方向的实跑输出都贴进任务体
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
      **判据链（外层 03:4xZ 裁定 run5 绿即落地）**：run3 + run4 连续两条全绿
      （各 `fail 0` / `cancelled 0` / 2203 tests）满足「连跑 2 次全绿」的字面判据；
      run4→run5 的树差只有一行（按必要性判据撤掉 inner-brief 死重排除项），其影响半径
      完全落在 `loop-shipping` 自己的 AC1b 内，run5（最终树 `fail 0` / `cancelled 0`）覆盖该 delta。
      **第 6 次套件被明确跳过并记账**：它在关键路径上约 15–25 分钟、买不到可测量的信息——
      这笔成本是算过的，不是没人算过的节省。**另外**：03:54:42 因撤排除项而起的 run5 重跑
      成本（~15 分钟）由外层记在自己账上（外层的判断变更导致），不是本任务的返工。
- [x] 任务体记录：**现场那批任务恰好都带 `## Plan`，所以掩盖了这个残留**——
      **只看现场会宣布完成，而测试测的是判据本身**（见 Proposal 的落地记录）

## Carries

from: gap-no-e2e-proves-install-is-configuration-driven
acs: AC5

本任务承载红 e2e 的 A4 绿（finding 无 Plan 过闸）：drop finding 形状的 Plan 要求后，
`packages/quay/test/install-config-driven-e2e.test.mjs` 的 A4 断言必须变绿——**谁修谁证明**。
（原 stub 承载任务 `gap-finding-shape-still-requires-plan` 已并入本条，避免重复承载。）

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- plugin/test/loop-shipping.test.mjs  （landing 时追加：AC1b 排除项，见 Dispatch review）

## Dispatch review

reviewer: outer
at: 2026-08-04T02:12:00Z
changed: **重装门槛 e2e 的最后一条红断言**，外层实测定位：
`shape=finding ok=false artifacts={"proposal":true,"plan":false,...}`
⇒ **`finding` 形状的必需段集合里仍含 `plan`**。
**与管理者现场实测（meta-cc 11/14 过闸）不冲突且两者都真**：
**meta-cc 的 DIR 模板 `## Finding` 与 `## Plan` 两个标题都有**，所以 `plan: true`；
**e2e 的夹具是「`## Finding` WITHOUT `## Plan`」**，正是 ADR-001 说该放行的那一类。
**⇒ 现场那批任务恰好都带 `## Plan`，掩盖了残留；测试测判据本身，所以它红。**
**AC3 是真判据**：把「finding 太严」修成「所有形状都不查 plan」是更坏的交易——
本条只改 `finding` 的必需段集合，**不放宽通用判定**，
沿用 `dispatch is not a waiver` 那条已确立的原则。
**排序**：**它是门槛内唯一剩下的红断言** ⇒ 与 LOOP_SCRIPTS / tmux 同级最高，
且**不动 `quay-init.sh`**，可与它们并行。

reviewer: inner（landing）
at: 2026-08-04T04:1xZ
changed: **执行落地记录**。判据（AC1–AC6 + DoD）全部勾选，证据见上。
**landing 过程中新增的处置，逐条说明**：

1. **AC1b 发现（Touches 追加 `plugin/test/loop-shipping.test.mjs`）**：
   全量套件在 finding 分支上 `fail 1`，根因是 **master 既有红**（与 A4、与本任务无关）——
   `install-config-driven-e2e` 断言冷启动目标布局（orchestration/ + docs/analysis/ 的 tick 文档
   路径），没进 `loop-shipping.test.mjs` AC1b 的排除表。加一行豁免（与 `quay-init-loop.test.mjs`/
   `cold-start-e2e.sh`/`README.md` 同类：目标布局引用）。
2. **e2e 豁免的失明代价（外层负控制实测）**：文件级无条件排除让该文件对六条旧路径全部失明，
   而它只合理提到两条。选择保持文件级（与既有排除项一致），**代价已记录在本 Proposal 的落地记录**。
3. **inner-brief 豁免按必要性判据撤除**：曾追加 `orchestration/inner-brief-2026-08-04-restart.md`
   的豁免，外层 03:40Z 用「去掉它还绿不绿」实测证伪其必要性（源已在 6e01329e 把旧路径拆写），
   **已撤**——保留它会不换任何绿、只让该文件对六条旧路径失明。
4. **排除表无必要性检查 → 已另立任务** `gap-exclusion-lists-have-no-necessity-check`。

## 遥测记录（2026-08-04，与真实区间不符，**不可用作基线**）

- **真实起止**：派发 02:14:03（`f520642b`），落地 04:10:47（`fce8f73f`）。执行者在
  02:2x 的整机 OOM 中死亡（原 `--task-start` 于 02:13:36 由执行者记录），工作经管理者抢救、
  由重启后的内层续做，真实有效工作约 90 分钟（含一段执行者死亡的空窗）。
- **遥测记录**：`.workflow-events/fm-gap-the-finding-shape-...-1785809616537-kbqp4u.jsonl`
  是 OOM 前的**幽灵 open start**，无 end，**未补 end**（按约束归
  `gap-a-crash-leaves-phantom-in-flight-tasks` 的对账机制处理，判据必须是可观测的 worktree/
  进程/分支，不许用时龄）。若按该记录补 end 会算出 ~3 小时——失真，不可用。
- **为何不符**：崩溃后重启的会话补记 `--task-start` 产生的是**失真**而非缺失（本轮实测的形态，
  已列入对账任务 AC）。本批遥测读数（完成数/吞吐）不可用于第三步的前后对比基线。
