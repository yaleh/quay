---
id: gap-no-cross-project-heavy-op-token
title: "Three projects on four cores need one token for heavy operations —
  arbitration by an agent watching is soft, a token is hard"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人 2026-08-03 裁定：把双层循环推到 `archguard` 与 `meta-cc`，同时作为 quay 产品化交付的验证，
并由外层充当跨项目管理者以避免资源冲突。

**外层的建议被采纳：管理者的核心功能必须机械化，不能靠一个 agent 盯着。**

### 为什么不能靠盯

今晚已有一个完全同形的实例：外层对人明确表示「不推送、等授权」，
**而内层推了两次**——因为那条边界只写在外层自己的行为里，不约束任何别的 agent。

> **靠 agent 盯着的仲裁是软形变**（在-`U`、可侵蚀、不跨 agent）；
> **一个谁都绕不过的令牌是硬形变**（截断状态空间）。

`docs/analysis/instrument-failure-mode.md` 的判据在这里直接适用。

### 实测的资源约束

| | 进程数 | 超订（4 核） | 实测后果 |
|---|---|---|---|
| 一套循环跑套件 | 16–17 | 4.25× | CPU 压力 85–95 |
| **今晚两个套件并发** | **34** | **8.5×** | **压力 96.62、重型测试被 cancel** |
| 三套不协调 | 约 51 | 12.75× | — |

### 三个项目的重型操作互不相同

| 项目 | 重型操作 | runner |
|---|---|---|
| quay | `bash scripts/test.sh` | `node --test`，16–17 进程 |
| archguard | `npm test` | **vitest**（自带 worker 池） |
| meta-cc | `make test` | **`go test ./...`**（Go 自己的并行） |

**⇒ 令牌必须与 runner 无关**——它闸的是「我要开始一次重型测试」，
每个 runner 内部的并发仍归各自管。

## Contract

```
measure  holder = `bash scripts/heavy-op-token.sh --status` 输出的 holder 字段
measure  wait_ms = `bash scripts/heavy-op-token.sh --acquire <project>` 输出的 waited_ms 字段
measure  reclaims = `bash scripts/heavy-op-token.sh --status` 输出的 stale_reclaims 字段
band     concurrent_holders = 1                                  # 任何时刻至多一个持有者
invariant 令牌状态目录在测试前后一致（测试用 --root 指向临时目录，不碰真实的）
invoke   `bash scripts/heavy-op-token.sh --acquire quay --timeout 0`
control  A 持有时 B 请求 ⇒ B 必须拿不到且打印 A 的身份与已持有时长；A 释放后 B 必须拿到
resume   n/a: 单次获取/释放，无中途产物
```

## Chosen mechanism

**一个文件、一个令牌、可复制到任何项目。**

### 一、令牌本体 `scripts/heavy-op-token.sh`

- **状态在仓库之外**：`${QUAY_GLOBAL_DIR:-$HOME/.quay-global}/heavy-op/`——
  三个项目共享，任何一个仓库被删都不影响
- **获取用 `wx` 原子创建**，与本仓 Land 锁同款模式（`CLAUDE.md` 已记录该模式；
  实现随 `milestone-worktree.ts` 退役，**这里重建模式而不是抄代码**）
- **心跳**：持有者定期 touch 令牌文件；陈旧回收 = mtime 超时 **且** 持有者 pid 不存活。
  **两条同时成立才回收**——只看 mtime 会误杀长跑的合法持有者
- **不静默等待**：`--timeout 0`（默认）拿不到就**立即退出非 0 并打印持有者身份与已持有时长**。
  调用方按自己的节奏重试。**静默等待与卡死不可区分**（本仓已有的原则）

### 二、故意选择「失败即放行」，但要大声

若 `$QUAY_GLOBAL_DIR` 不可写或不可达 ⇒ **打印一条醒目标记后放行**，不阻断。

**理由与本仓「检查应 fail-closed」的原则不冲突**：那条针对的是**安全检查**，
而这是**调度令牌**。失败即阻断会让三个项目同时停摆，且不能自恢复；
失败即放行的代价是一次争抢，可恢复。**但必须大声**——AC 要求测两条路径。

### 三、接线

- quay：`scripts/test.sh` 在**全量套件**路径上获取/释放；
  **scoped 路径（`--for-task` / 显式文件 / 非默认 `--group`）不取令牌**——
  与现有 `resource-gate.sh` 的豁免边界完全一致，那是负载下必须保持可用的验证路径
- archguard / meta-cc：**本任务不接线**——它们的接线属于冷启动交付
  （[[exp6 阶段 2 计划]] 的阶段 3），本任务只交付可复制的令牌本体

### 四、与现有 `resource-gate.sh` 的关系

**两者串联，不合并**：令牌管**跨项目互斥**，资源闸管**本机负载是否适合开跑**。
顺序是先取令牌、再过闸——**闸失败要释放令牌**，否则一次 WAIT 会把令牌扣住。

**不做**：不做公平队列/FIFO——先让饥饿可观测（`waited_ms` 会显示），
有数据再决定要不要机械化排队。**在知道成本结构前设策略是 416s 那个错误**；
不做后台守护进程；不改各 runner 的内部并发。

## Acceptance Criteria

- [x] AC1: `--acquire` / `--release` / `--status` 三个子命令；`--status` 输出 `holder`、
      `held_ms`、`stale_reclaims` 三个字段
- [x] AC2: **双向负控制**——A 持有时 B `--acquire` 必须失败且打印 A 的身份与已持有时长；
      A `--release` 后 B 必须成功。两个方向实跑输出见下方 Evidence
- [x] AC3: **陈旧回收需两条同时成立**（mtime 超时 **且** pid 不存活）；
      构造「mtime 陈旧但进程仍活」的 fixture，断言**不回收**——见 Evidence
- [x] AC4: **崩溃恢复**——kill -9 持有者后，另一方在超时后能回收并取得令牌；实跑输出见 Evidence
- [x] AC5: **失败即放行且大声**——把 `QUAY_GLOBAL_DIR` 指向不可写路径，
      断言退出 0 且 stdout 含醒目标记；恢复后回到正常互斥（见 Evidence）
- [x] AC6: `scripts/test.sh` 全量路径取/放令牌；**scoped 路径不取**——结构性（唯一 acquire 调用在
      `is_default_set` 守卫内、gate 前）+ scoped 行为（单文件跑不产生 heavy-op 目录）+ **全路径实跑**：
      协调方 token fan-in 套件运行时 `holder=quay`，套件结束 EXIT trap 释放 → `holder=none`
- [x] AC7: **闸失败要释放令牌**——构造资源闸 WAIT 情形（env 缝），断言令牌未扣住（AC 测试 + 实跑）
- [x] AC8: 令牌是**单文件、无仓库依赖**——复制到空目录也能跑（临时目录实跑证明）
- [x] AC9: 测试全部用 `--root`/`QUAY_GLOBAL_DIR` 指向临时目录，**不碰真实令牌**；
      并在测试内 try/finally 删除临时目录（隔离契约 R6）
- [x] AC10: 测试带 `// @test-group engine` 声明（test-framework-policy 通过，无新增违规）

## Definition of Done

- [x] AC2/AC3/AC4/AC5 的实跑输出贴进任务体（见下方 Evidence）
- [x] `scripts/test.sh` 全绿：协调方 token fan-in 套件 **2065 tests / 2046 pass / 0 fail / 0 cancelled /
      19 skipped**（exit 0，`/tmp/token-fanin-fullsuite.log`；套件期间持令牌、结束自动释放）。参考值
      2054→2065。scoped 11/11 绿
- [x] 明确记录：**靠 agent 盯着的仲裁不跨 agent**。今晚「外层不推送」这条正是这样失效的——
      它约束了外层，而内层推了两次，因为那条边界只写在外层自己的行为里

## Evidence（实跑输出，2026-08-03）

**AC2 双向负控制**：A 持有时 B 拿不到并打印 A 身份；A 释放后 B 拿到。
```
$ ... --acquire quay --timeout 0                          # A
waited_ms=0 holder=quay acquired=yes
$ ... --acquire meta-cc --timeout 0                       # B while A holds
heavy-op-token: HELD by quay (pid 864866, held 93ms) — meta-cc did not acquire (no silent wait)
exit=1
$ ... --release quay                                       # A
heavy-op-token: released (project=quay, pid=864866)
$ ... --acquire meta-cc --timeout 0                       # B after A releases
waited_ms=0 holder=meta-cc acquired=yes  exit=0
```

**AC3 陈旧回收需双条件**（mtime 陈旧但进程仍活 → 不回收）：
```
$ HEAVY_OP_STALE_TIMEOUT_S=1 ... --acquire quay --timeout 0
heavy-op-token: HELD by aliveproj (pid 865704, held ...ms) — quay did not acquire
exit=1 ; token file PRESERVED (not reclaimed)
```
镜像（dead pid + fresh mtime → 不回收）亦测。

**AC4 崩溃恢复**（kill -9 持有者 → 另一方回收）：
```
heavy-op-token: RECLAIMED stale token (mtime 10s old, pid 999999 not alive) — reclaim #1
waited_ms=0 holder=meta-cc acquired=yes
--status → stale_reclaims=1, holder=meta-cc
```

**AC5 失败即放行且大声**（不可写 QUAY_GLOBAL_DIR → exit 0 + 醒目标记）：
```
==============================================
HEAVY-OP-TOKEN FAIL-OPEN: /tmp/.../blocker/heavy-op
  is not writable/reachable. Proceeding WITHOUT the cross-project mutex.
...
waited_ms=0 holder=<fail-open> acquired=no   exit=0
```
恢复（可写 root）后回到正常互斥。

**AC6 全路径实跑**（协调方 fan-in 套件）：启动后 `holder=quay, pid=873459`（套件取令牌），
套件完成 EXIT trap 释放 → `holder=none`。scoped 单文件跑不产生 `heavy-op` 目录。

**AC7 闸失败释放**（env 缝强制 WAIT）：
```
=> WAIT: CPU 饥饿（some avg10 >= 40）... scripts/test.sh: resource gate says WAIT
shell exit=1 ; token released on gate WAIT (correct)
```

## Touches

- scripts/heavy-op-token.sh
- scripts/test.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T08:45:00Z
changed: 三处。(1) 明确令牌与 runner 无关——三个项目分别是 `node --test`/vitest/`go test`，闸的是「重型操作」不是「node 套件」；(2) 故意选「失败即放行但大声」而非 fail-closed，因为这是调度令牌不是安全检查，失败即阻断会让三项目同时停摆且不能自恢复——但要求 AC5 测两条路径；(3) 明确不做公平队列，先让饥饿通过 `waited_ms` 可观测，有数据再决定——在知道成本结构前设策略是本仓记录过的 416s 错误
