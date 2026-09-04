---
id: gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks
title: ready-pool-check's taskWorkLanded overshoots — "Touches file exists on
  master" is read as "work landed", so tasks that modify existing files are
  recommended for promotion AND excluded from the pool simultaneously
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

内层 2026-08-04 在队列状态记录（外层确认）发现的机制缺陷：`ready-pool-check.ts` 的 `taskWorkLanded`
信号（复用 task-status-drift 的「工作落 master」判据）**过冲**：

- 判据把「任务的任一 Touches 文件在 master 上存在」当作「工作已落 master」。
- 对**新建文件**型任务成立（新文件在 master 上 = 工作确实落了）。
- 对**改既有文件**型任务**错误**：Touches 文件（如 `scripts/test.sh`）一直在 master 上，与任务是否
  落地无关。

**具体后果（已实测）**：补晋 3 条改既有文件的任务后，`pool` 字段仍为 **0**——机制**推荐它们补晋**
（candidates 列它们）、又**排除它们**（taskWorkLanded 判已落）。自相矛盾，且对改既有文件型任务
流水线的补晋完全失效（pool 永远到不了 ≥3）。

### 选定机制

**`taskWorkLanded` 区分「任务自己的改动已落」与「Touches 文件只是存在」**：

- 对 `(new)` 标记的 Touches：文件在 master 上 = 已落（现状正确）。
- 对既有文件 Touches：不能以「文件存在」判已落——改用它（或 drift-check 的）**任务特有符号解析**
  （任务声明的符号在树里可解析），或按任务分支的 diff 判断（工作是否真实合入）。

## Acceptance Criteria

- [x] AC1: `taskWorkLanded` 不再把「既有 Touches 文件在 master 上存在」判为已落——对改既有文件型任务，
      须用任务特有符号解析或等价信号（不依赖文件存在性）
- [x] AC2: **负控制**——一条改既有文件、工作未落的任务 ⇒ 必须留在池里（不被排除）
- [x] AC3: **正控制**——一条改既有文件、工作已落的任务 ⇒ 必须排除（not-yet-flipped）
- [x] AC4: **自相矛盾消除**——补晋 3 条改既有文件型任务后，`pool` 必须反映它们（≥3），不再是 0
      （实跑输出贴任务体，修复前后对照）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`；补「改既有文件、未落」与「已落」夹具
- [x] AC6: 防回归——`ready-pool-check` 的测试断言「既有文件型未落任务在池里」恒成立

## Definition of Done

- [x] AC1–AC6 全部勾上；AC4 修复前后 pool 对照逐字贴任务体
- [x] 真实树跑通：改既有文件型任务的补晋能被机制正确反映（pool 反映真实）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——修复后 batch-3 全量重跑 GREEN（tests 2283 / fail 0 / cancelled 0 / skipped 28）

### AC4 修复前后 pool 对照（真实树，2026-08-04）

补晋 6 条改既有文件型任务（gap-drive-text / gap-eighty-one / gap-load-sensitive / gap-init-ships / gap-eighty-two / gap-preflight）后：

```
BEFORE（旧 checker，touch 过冲）：pool: 0   ← 6 条全被「Touches 文件已在 master」误判排除
AFTER （修复后 checker）：       pool: 4   ← 改既有文件型任务正确反映在池里（≥3）
```

（2 条仍被排除——gap-drive-text / gap-init-ships——是**既有的符号信号边缘**：其 AC 反引号引用了已在 master 的既有函数（`checkTouchesPair` 等）导致 resolve，与本次 touch 过冲无关。）

### invoke 实跑证据（task-contract-check 消费者）

`scripts/test.sh plugin/test/ready-pool-check.test.mjs` → ℹ tests 13 / pass 13 / fail 0 / cancelled 0 / skipped 0（含新增「改既有文件未落/已落」夹具）。`task-status-drift-check.test.mjs` → 34 pass / 0 fail（镜像 byte-identical 同步）。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/scripts/task-status-drift-check.ts（若需复用其任务特有符号解析）

## Contract

measure   pool_after_promote = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json` stdout 的 pool 字段
band      pool_after_promote = ≥3（补晋改既有文件型任务后必须反映它们）
invariant existing_file_not_landed = 1（既有 Touches 文件存在 ≠ 工作已落）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json`
control   负控制（未落⇒在池）＋正控制（已落⇒排除）＋AC4 自相矛盾消除
resume    信号判定与夹具分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T23:0xZ
changed: 外层受内层 flag + 队列状态记录立案。三处收紧：
(1) **不是改一处判据**——是修「既有文件存在 ≠ 已落」这个信号语义；(new) 文件型维持现状，
既有文件型改用任务特有符号；
(2) **AC4 用真实树的补晋对照**——补晋 3 条改既有文件型任务，pool 必须 ≥3 不再是 0（自相矛盾
消除的实证）；
(3) **AC2/AC3 双向负控制**——未落/已落各构造一次，防止只修一半。
status: todo——排在当前 batch-3（phantom-in-flight 在飞）之后。
