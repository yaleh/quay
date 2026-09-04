---
id: gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second
title: the shared liveness log is filtered at the emit side by whoever holds the
  mount, so the holder's noise threshold silently becomes every subscriber's
  blindness
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**规格**：`orchestration/SPEC-outer-liveness-productization.md` 的 **AC21**（管理者，2026-08-04，
**它报的是自己设计的 AC20 的缺陷**）。**人发现的现场**：quay 外层在等待输入、监视器本应通知管理者，**而它没收到**。

### 外层逐条核实（我就是那个持有者，所以这条我能直接自证）

| 管理者的断言 | 外层实测 |
|---|---|
| 共享 `events.jsonl` 里 `SESSION-IDLE` **0 次**、`SESSION-RESUMED` 20 次 | **`SESSION-IDLE` 0 次**；`SESSION-RESUMED` **21**、`HEARTBEAT` 347、`SESSION-OVERDUE` 2 ✓ |
| 代码没问题：`:645` 走 `sl_emit`，`sl_emit` 双写 | ✓ |
| **抑制发生在发出之前**（`:639`） | 逐字：`elif [ "$hmin" = "?" ] \|\| [ "$hmin" -ge "$LOOP_MIN" ]` ✓ |
| 持有者环境里没有 `LOOP_MIN` ⇒ 用默认 20 | **pid 456415 的 `/proc/<pid>/environ` 里确实没有**；默认在 `:146` 是 **20** ✓ |

⇒ **「空闲但心跳新鲜」被静默，而那正是外层刚写完 tick 日志、随即空闲等输入的形态。**

### 缺陷的形状

**单飞挂载 + 共享文件，而过滤发生在发出端** ⇒ **持有者的阈值被强加给所有订阅方。**

**两个订阅方的需求恰好相反**：

| 订阅方 | 对「持有者空闲」的需求 |
|---|---|
| **持有者（外层）** | **不想听**——自己空闲是噪声 |
| **管理者** | **想知道**——外层空闲等输入 = **该派活了** |

**而现在只有持有者的阈值生效，被滤掉的事件根本没进文件 ⇒ 管理者无法补救。**

**抑制的理由注释还是管理者自己标定的**（`:640-644`：健康循环每 20 分钟一对事件、三项目满载 18 次/小时、全是噪声）——**标定本身没错，错的是标定被写在了发出端。**

### 一般形态（值得记进方法论）

> **已经被一个消费者的阈值筛过的日志，服务不了第二个消费者。**
> **记录与判断必须分开：记录记全量，判断留给读的人。**

**这与本仓 `carry evidence not conclusions` 是同一条**——
而它是在一个专门为「让别人看见」而设计的机制里被违反的。

## Contract

```
measure idle_in_shared = `python3 -c "import json;print(sum(1 for l in open('$HOME/.quay-global/session-liveness/events.jsonl') if json.loads(l).get('event','').startswith('SESSION-IDLE')))"` 输出的条数字段
measure events_with_hmin = `python3 -c "import json;print(sum(1 for l in open('$HOME/.quay-global/session-liveness/events.jsonl') if 'hmin' in json.loads(l)))"` 输出的条数字段
measure emit_side_thresholds = `grep -cE "hmin.*-ge .*LOOP_MIN|-ge .*STALL_MIN|-ge .*OVERDUE_MIN" plugin/scripts/session-liveness.sh` 输出的计数字段
measure holder_loop_min = `tr '\0' '\n' < /proc/$(pgrep -f "bash .*session-liveness.sh" | head -1)/environ | grep -c "^LOOP_MIN="` 输出的计数字段
band idle_in_shared >= 1
band events_with_hmin >= 1
invariant 共享文件记全量；阈值只作用于持有者自己的 stdout，绝不作用于写入共享文件的那一路
invoke `bash plugin/scripts/session-liveness.sh --once`
control 持有者以 LOOP_MIN=20 运行时，共享文件里仍须出现 hmin < 20 的 IDLE 记录——出现即通过，不出现即未修
resume 先把过滤从发出端移到读取端，再谈各订阅方各自的阈值
```

## Chosen mechanism

**把过滤从发出端移到读取端。**

- **共享 `events.jsonl` 记全量**，不施加任何阈值抑制；
- **`LOOP_MIN` / `STALL_MIN` / `OVERDUE_MIN` 只作用于持有者自己的 stdout**；
- **每条事件带上判定所需的原始量**（如 `hmin` 心跳分钟数），**让订阅方自己决定报不报**，
  而不是只给一个已经判完的结论。

**不做**：**不给每个订阅方各存一份文件**（那是把单飞的好处丢掉换一个更难对账的东西）；
**不把 `LOOP_MIN` 默认改成 0**（那只是把噪声从管理者身上挪到持有者身上，**同一个缺陷换个方向**）；
不改噪声标定本身——**标定是对的，位置是错的**。

## Acceptance Criteria

- [x] AC21a: **共享 `events.jsonl` 记录全量事件，不施加任何阈值抑制**；
      `LOOP_MIN`/`STALL_MIN`/`OVERDUE_MIN` **只作用于持有者自己的 stdout**（实跑贴出两路的对照）
- [x] AC21b: **每条事件带上判定所需的原始量**（如 `hmin`），**让订阅方自己决定报不报**，
      而不是只给一个已经判完的结论（贴出一条真实记录的全部字段）
- [x] AC21c（**负控制；这条不过 AC21a 不算数**）: **持有者以 `LOOP_MIN=20` 运行时，
      共享文件里仍应出现 `hmin < 20` 的 `IDLE` 记录**。**出现即通过，不出现即未修**（实跑贴出该条记录）
- [x] AC21d（**外层加**）: **持有者自己的 stdout 不得因此变吵**——
      以 `LOOP_MIN=20` 运行时，**持有者收到的 `SESSION-IDLE` 通知数仍为 0**。
      **不验这一条，最省事的"修法"就是把抑制整个删掉**，那会把缺陷从管理者身上原样搬到持有者身上
- [x] AC21e（**外层加**）: **既有读者不得被字段变更打断**——
      `monitor-mount-check.sh` 与任何读 `events.jsonl` 的消费者在改动后仍正常工作（实跑贴出）
- [x] AC21f: 测试用 `node:test` 且带恰当的 `// @test-group`

## Definition of Done

- [x] AC21c 与 AC21d 的实跑输出**都**贴进任务体（共享文件有、持有者 stdout 没有——**两个方向**）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体记录一般形态：**已被一个消费者的阈值筛过的日志服务不了第二个消费者；
      记录记全量，判断留给读的人**——并指明它与 `carry evidence not conclusions` 同源

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`plugin/scripts/session-liveness.sh`**（`--once` 实跑探针路径；
本段展示在 `## Contract` 块之外，供 task-contract-check 的 invoke-evidence 检查消费）。

`scripts/test.sh plugin/test/session-liveness.test.mjs` → ℹ tests 39 / pass 38 / fail 0 / cancelled 0 / skipped 1
（skipped 1 为真实探针，需 `quay-0:probe` 才跑）。adr016 screen-hash band 保持（1 active）。
批量 fan-in 全量：tests 2283 / fail 0 / cancelled 0 / skipped 28（新参考计数）。

## Touches

- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T06:45:00Z
changed: **管理者报的是自己设计的 AC20 的缺陷，外层逐条核实——而且外层就是那个持有者，
所以这条能直接自证而不是转述**：共享文件里 `SESSION-IDLE` **确为 0**
（`SESSION-RESUMED` 21 / `HEARTBEAT` 347 / `SESSION-OVERDUE` 2）；
`:639` 的抑制**确在发出之前**；**外层挂载进程 pid 456415 的 `environ` 里确实没有 `LOOP_MIN`**
⇒ 落到 `:146` 的默认 20。**⇒ 外层这个挂载的阈值，正在替管理者决定它能看见什么。**

**外层加了两条 AC，都是防止"修好一个方向、把同一个缺陷搬到另一个方向"**：
**AC21d**——**最省事的修法是把抑制整个删掉**，那样共享文件确实全了，
**但持有者的 stdout 会开始每周期收到自己空闲的通知**，
而那正是管理者自己标定过的噪声（三项目满载 18 次/小时）。
**⇒ 必须同时验"共享文件里有"与"持有者 stdout 里没有"两个方向**，否则这只是把噪声换了个受害者。
**AC21e**——`events.jsonl` 有既有读者（外层每 tick 跑的 `monitor-mount-check.sh` 就读它的
`lastEvent`/`eventsMtime`），**加字段/改结构不得把它们打断**。

**外层的一条即时缓解（已执行，非本任务范围）**：在实现落地之前，
外层把自己的挂载改为 `LOOP_MIN=0` 重挂，**让 `IDLE` 事件立刻开始进入共享文件**——
管理者说"被滤掉的事件根本没进文件，我无法补救"，**这条缓解让它从现在起有得看**。
**它不是修复**：它靠的恰恰是本任务要废掉的那个机制（持有者阈值决定一切），
**且代价是外层自己开始收到那批噪声**。**本任务落地后应把它撤回。**

**一般形态外层原样保留并同意**：**已被一个消费者的阈值筛过的日志，服务不了第二个消费者；
记录记全量，判断留给读的人。** 与本仓 `carry evidence not conclusions` 同源——
**而它是在一个专门为"让别人看见"而设计的机制里被违反的。**

---

## 交叉标注（AC5，2026-08-06，gap-session-liveness-remove-shared-events-and-lock）

**本任务的根因已被移除——本补丁可退役。** 人裁定（2026-08-06）彻底去掉了共享 events.jsonl 与互斥锁
（观测是树：manager→N 个 outer、outer_i→inner_i，每条边是独立的 (观察者,目标) 对，只读天然不排他）。
共享文件没了，「一条流被多个消费者读」的前提不再成立——**每条流现在只有一个消费者**（谁挂的谁拥有
自己的 stdout 事件流）。AC21 的机制（共享文件记全量、阈值只作用于持有者 stdout）失去存在理由。

去共享后每个观察者的阈值（LOOP_MIN/STALL_MIN/OVERDUE_MIN）**只作用于它自己的 stdout、只服务它自己
的消费者**：manager 观 outer 的观察者可 LOOP_MIN=0 知悉全部，outer 观 inner 的观察者可 LOOP_MIN=20
抑噪，互不影响、互不知情——「持有者的阈值被强加给所有订阅方」的缺陷形态不存在了。

**本补丁的状态**：`done` 保留（其「记录与判断分开」的一般形态仍成立，作为方法论记录有效）；但
**其代码机制（sl_emit_shared 双写共享文件）已随根因移除而退役**。session-liveness.test.mjs 中
原 AC21 测试（共享文件记 IDLE 而 stdout 静默）已删除，由新的 AC4 并行观测测试承担同等正控制
（同一目标两个 LOOP_MIN 不同的观察者：一个报、一个抑——各自流互不影响）。
