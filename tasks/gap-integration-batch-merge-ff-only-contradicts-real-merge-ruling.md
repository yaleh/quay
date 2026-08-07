---
id: gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling
title: integration-batch-merge.sh is FF-only but the SPEC ruling (2026-08-06
  23:4x) directs real-merge on divergence — blocked twice tonight (develop
  advances via direct commits; batch merge exits needs-human each time)
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**`integration-batch-merge.sh` 只做 fast-forward；SPEC 裁定（2026-08-06 23:4x）已否证 FF 前提、方向为真 merge——机制与裁定不符，批量合每次都被 NOT-FF 挡住 needs-human。**

### 根因（SPEC 已记录，非本任务发现）

`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` §4 原假设「integration 永远是
develop 后代 ⇒ fast-forward 无冲突」。**2026-08-06 23:48 60 秒实证否证**：外层完成对齐 merge、恢复 FF
后一分钟内 develop 又领先 3 个提交。**direction 裁定（23:4x）**：「承认 develop 前进，integration → develop
从 FF 改真 merge（每次量小可能有冲突）；『勤合并维持 FF』不可行」。

### 实测（本任务立案于 2026-08-07 00:5x，外层 tick）

```
$ bash plugin/scripts/integration-batch-merge.sh --root /home/yale/work/quay --develop develop --integration integration --dry-run
integration-batch-merge: NOT-FAST-FORWARD — develop has commits integration lacks (divergence); needs human
$ git rev-list --count integration..develop
29        # develop 领先 29 个提交（内层/外层/管理者直写 develop）
```

develop 只被内层 tick-log / 任务簿记、外层 tick-log、管理者提交直接推进（SPEC 实测：develop 收 271 个
直接提交，inner 88 / outer 61 / manager 26 / tasks 25 / fix 16）。**这是常态不是异常**。

### 阻塞记录

| 时刻 | 形态 | 处置 |
|---|---|---|
| 2026-08-06 23:4x | 批量合 NOT-FF（develop 272 领先） | 外层手动对齐 merge（42581411，10 冲突 develop-authoritative），恢复 FF |
| 2026-08-07 00:5x | 批量合 NOT-FF（develop 29 领先） | 外层推迟到干净窗口（内层 3 subagent 活跃）——**机制仍无法自行处理** |

`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`（done）的 AC3 是
「fast-forward 正路径 + 真分歧负控制」——**该任务的机制假设已被裁定否证**，脚本需要真 merge 模式。

### 选定机制（方向，接法留执行时）

给 `integration-batch-merge.sh` 加**真 merge 模式**（如 `--merge`，默认仍 dry-run 安全）：NOT-FF 时不再
直接 needs-human，而是：
1. **先报告分歧面**（develop-only / integration-only 各多少，冲突文件清单）；
2. **已知共享文件的冲突按 develop-authoritative 自动解**（tick-log.md、tasks/*.md、queue-state——
   这些是外层/内层直接写 develop 的文件，integration 侧没有它们的权威版本）；
3. **真实代码冲突 → 仍 fail-closed needs-human**（绝不 blind --ours/--theirs——与既有纪律一致）。

## Contract

```
measure pending_commits = `git rev-list --count develop..integration` stdout 数字段（当前 38）
band pending_commits = 无固定阈值（红窗期 integration 照常接收，pending 面天然可变）
invariant integration→develop 的批量合不得因「develop 被直接提交推进」这一常态而永远 needs-human；真分歧（代码冲突）仍须 fail-closed
invoke `bash plugin/scripts/integration-batch-merge.sh --root /home/yale/work/quay --develop develop --integration integration --dry-run`
control 人为制造一个 develop-only 提交（如改 tick-log）⇒ 批量合必须能自行处理（真 merge 或明确报告分歧面），不得永远 exit needs-human；再人为制造一个真实代码冲突 ⇒ 必须 fail-closed 不自动解
resume 若中断，先跑 measure 读当前 pending 面，再读 SPEC §4 的裁定原文
```

## Acceptance Criteria

- [ ] AC1: NOT-FF 时脚本输出分歧面（develop-only / integration-only 各 N + 冲突文件清单），不再只有一行 `needs human`
- [ ] AC2: 已知共享文件（tick-log.md / tasks/*.md / queue-state）的冲突按 develop-authoritative 自动解，批量合能推进
- [ ] AC3: **负控制（承重条）**——真实代码冲突仍 fail-closed（不 blind --ours/--theirs、不动 ref），贴出冲突文件清单
- [ ] AC4: 实跑一次完整批量合（真实 divergencency 场景），integration..develop=0，贴出 merge 提交

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 与 `gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point` 交叉标注（该任务机制假设已被裁定否证）

## Touches
- plugin/scripts/integration-batch-merge.sh
- tasks/gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling.md
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（交叉标注）
- orchestration/SPEC-branching-model-integration-branch-2026-08-05.md（落地记录节）

## Dispatch review

reviewer: none
at: 2026-08-07T00:5xZ
changed: 尚未派发。立案人：外层（2026-08-07 00:5x tick，批量合第二次被 NOT-FF 挡住）。
