---
id: gap-ac80-prompt-canonical-and-invariant-checker
title: 三层各有 git 跟踪 prompt 正本 + 不变式检查器（AC80，人 14:2xZ 裁定）——当前 outer/inner ❌；正本 vs CronList 副本会漂
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（三层各有 prompt 正本 + 不变式检查器——人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）**。

**现状（manager 14:2xZ meta-cc 实测）**：
```
manager  ✅ 正本 git 跟踪（manager-tick-prompt.txt, 571 字符）+ A1 不变式检查 + registry sha256
outer    ❌ 无正本文件（cron prompt 只活在 session-only 的 CronCreate 里）   ← 本任务 outer 侧
inner    ❌ 无正本文件（ScheduleWakeup 哨兵，runtime 解析）                  ← 本任务 inner 侧
```

**⚠️ 判据3 是真难点（manager 14:0xZ 实证）**：正本文件 与 真正投进 CronCreate 的字符串【必须比对一致】——**两者是两份副本，而副本会漂**。今日实证：manager-loop-tick.md 的豁免面副本在人裁定后立刻过期，而审计读的正是那份副本。
**⊢ 检查器须比对 正本内容 vs CronList 返回的 prompt；只查「文件存在」不算**。

**判据1**：outer 有 git 跟踪 prompt 正本（如 outer-tick-prompt.txt）+ inner 有 git 跟踪 prompt 正本。
**判据2**：三层各有不变式检查器（对比正本 vs CronList 实际 prompt，逐字节一致）。
**判据3（真难点）**：检查器比对【正本内容 vs CronList 返回的 prompt】——不是只查「文件存在」；两份副本逐字节一致。
**判据4**：与 AC79（inner CronCreate 锚）/ AC81（注册表收据）配套。

**不覆盖**：不改唤醒机制本体；不在窗口内改。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager 的正本形态（manager-tick-prompt.txt）+ A1 不变式检查器（manager-anchor-check.py）。
2. 判据1：outer + inner 各有 git 跟踪 prompt 正本。
3. 判据2/3：不变式检查器（对比正本 vs CronList 实际 prompt，逐字节）。
4. 判据4：与 AC79/AC81 配套。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## C17 建议（outer-landable —— outer 独占 `orchestration/*` 与 `plugin/loop/*.md`，inner 只经检查器消费，不得单边编辑）

**① `orchestration/outer-tick-prompt.txt`（new，outer 侧正本）**
- 内容 = outer 自己传给 CronCreate 的**完整 prompt 原文**（逐字）。⚠️ 判据3 比对的正是「正本 vs 活 prompt」逐字节一致性——正本必须与投进 cron 的串严格同一。
- **已落地**（develop commit `72b99cda`，cron job `4e88cb1b` 的 prompt 原文）：
  `执行 /home/yale/work/quay/orchestration/orchestrator-tick-core.md 中的 tick 指令（入口直指执行核，1 跳；理由档案按需查 src:N，不要全读）`
- 检查器 `--layer outer` 的正本路径 = `orchestration/outer-tick-prompt.txt`（存在则比对；缺失报 NOT-EVALUATED/MISSING-正本，独立取值非通过）。
- 指针要求（检查器强制，勿破坏）：必须含 `orchestrator-tick-core.md`（1 跳指向执行核）；不得含 ISO 日期 / 提交号 / `gap-` 任务名 / 决策词（本轮重点/优先/先做/暂停/跳过/派发）。哨兵清扫规则由执行核持有，不要求内联。
- 提交形态：随外层提交，保持工作树干净（未提交改动 = 漂移未经审阅，检查器报 VIOLATED）。

**② `plugin/loop/fast-mode-loop-tick.md`（inner 正本位置）**
- 落一段精确的 inner CronCreate prompt 原文（**下方代码块内容，逐字，勿加/删/改任何字符**）——检查器 `--layer inner` 从 `AC80-INNER-ANCHOR-BEGIN`/`AC80-INNER-ANCHOR-END` 标记之间提取该段作为正本。
- 格式（检查器 `extractCanonical` 的提取契约，落地必须原样）：
  - 注释行含字面量 `AC80-INNER-ANCHOR-BEGIN`（形如 `<!-- AC80-INNER-ANCHOR-BEGIN: … -->`）；
  - 下一行 = 完整 inner prompt（**单行，字节原样**）；
  - 下一行 = `<!-- AC80-INNER-ANCHOR-END -->`，**直接跟在 prompt 行后，无空行**。
- 建议落点：`### 6. 重新排程` 附近（src ≈1162-1205）或「本文档是 inner 的出厂锚」节（src ≈295）——位置不影响提取，仅可读性。
- 该 prompt **自带 AC81 哨兵清扫规则**（CronList + 清扫），检查器强制内联。
- ⛔ 落地点归 outer 的 plugin/loop 编辑面；inner 只读该段（经检查器），不得单边改。

```text
[inner-tick] 执行内层 tick。不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 orchestration/fast-mode-tick-core.md 拿本轮步骤（执行核；理由/实测/代价在 plugin/loop/fast-mode-loop-tick.md，仅需「为什么」时按 src:N 查，不要每轮全读）；(2) `tail -10 .quay/inner-tick-log.jsonl` 拿上一轮状态（只 tail，全读不可行）；(3) 读 orchestration/manager-phase-goal.md 拿当前阶段目标与 AC（当前阶段在文件后段，按节标题定位，勿全读）。执行完必须向 .quay/inner-tick-log.jsonl 追加一行。唤醒锚核实（AC81）：每轮先核实——CronList 恰一条 + 其 id 等于注册表记录 + --verify 报 registry-verified；三条全真则不动，任一为假才清扫重建，绝不靠记住的 ID。
```

**判据对应**：判据1（outer+inner 各有 git 跟踪正本）由 ① ② 覆盖；判据2/3（不变式检查器 + 逐字节比对）由检查器 `plugin/scripts/outer-anchor-check.ts` 覆盖；判据4（与 AC79/AC81 配套）由 inner 正本段内含的 AC81 规则 + 外层 CronCreate 锚覆盖。

## Acceptance Criteria

- [ ] AC1 判据1：outer + inner 各有 git 跟踪 prompt 正本。
- [ ] AC2 判据2：三层各有不变式检查器。
- [ ] AC3 判据3：检查器比对正本内容 vs CronList 实际 prompt（逐字节，非只查存在）。
- [ ] AC4 判据4：与 AC79/AC81 配套。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 三层各有 git 跟踪 prompt 正本 + 不变式检查器（对比正本 vs CronList，逐字节一致）。

## Touches

- orchestration/outer-tick-prompt.txt (new，outer 侧正本——外层核心文件 outer 独占写；outer 已落 develop 72b99cda)
- plugin/scripts/outer-anchor-check.ts (new，不变式检查器——本任务落地)
- plugin/scripts/capability-catalog.sh（检查器声明注册——本任务落地）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照——新 plugin/scripts 文件触发的注册同步，`--write-inventory` 重生成）
- plugin/test/outer-anchor-check.test.mjs (new，检查器测试——本任务落地)
- plugin/loop/fast-mode-loop-tick.md（inner 侧正本位置——C17 建议，outer 落地）
- tasks/gap-ac80-prompt-canonical-and-invariant-checker.md（自身）

## Evidence

（2026-08-14 回填——检查器 + 测试已落地）

- **检查器** `plugin/scripts/outer-anchor-check.ts`：覆盖 outer + inner 两层；指针形式判据镜像
  manager-anchor-check.py ①-④（必指执行核 / inner 哨兵规则 / 无状态渗入 / 无决策词 / 工作树未提交），
  判据3 用 UTF-8 字节比对 正本 vs `--cron-prompt`/stdin 传入的完整活 prompt（CronList 显示截断，绝不解析）。
  退出码：0=OK / 1=VIOLATED / 2=NOT-EVALUATED（正本缺失或未提供活 prompt —— 硬规则 3b 独立取值，非通过）。
- **real-data 判据3 测试**（`plugin/test/outer-anchor-check.test.mjs`，25 条全绿）：实际 inner prompt（任务体给定）
  与实际 outer prompt（develop `72b99cda` 的 `orchestration/outer-tick-prompt.txt`）同时作正本与 `--cron-prompt`，
  断言 byte-equality（exit 0）；负控：一字符漂移 / 仅空白漂移 ⇒ exit 1；指针形式违反即使 byte 相同 ⇒ exit 1；
  正本缺失 / 未提供活 prompt ⇒ exit 2。
- **default 路径 NOT-EVALUATED**：本 worktree（base ac9c7da3，无 outer 正本、无 inner 正本段）
  `--layer outer`/`--layer inner` 均报 MISSING-正本 exit 2 —— fan-in 合入 develop 后 outer 侧真实比对路径生效。
- **`--for-task` scoped 门**：`scripts/test.sh --for-task gap-ac80-prompt-canonical-and-invariant-checker --allow-thin`
  在任务 worktree 内 **exit 0**（scoped 静态检查层全绿，含 delivery-inventory-drift-gate、rhythm-consumer-check、
  capability-catalog --json；新测试 `outer-anchor-check.test.mjs` 25 条全跑并过）。
- **fan-in-ts-typecheck-gate**：`--task gap-ac80-... --worktree <本 worktree> --merge-target develop` →
  `newMovedTsFiles=["plugin/scripts/outer-anchor-check.ts"]`、`typecheck=green`、**verdict=admitted（exit 0）**。
- **注册联动**（新 plugin/scripts 文件的两处机械同步，AC3）：`plugin/scripts/capability-catalog.sh` 已声明
  question + cadence(按需) + invalidation + last-reaffirmed + matching + CONSUMER（AC1c 闸 0 unclassified）；
  `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 已 `--write-inventory` 重生成（disk=snapshot=247）。
- 提交：见本任务 worktree 分支 `task/gap-ac80-prompt-canonical-and-invariant-checker` 的 git log。
