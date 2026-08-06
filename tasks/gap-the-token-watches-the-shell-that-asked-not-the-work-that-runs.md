---
id: gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs
title: The heavy-op token's liveness watches the shell that acquired it, not the
  work that is running — a retry loop makes the token reclaimable while the work
  continues
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**这是一个可达状态，不是已观察到的并发。** 管理者在回收内存时发现并报出，外层独立核实了结构性证据。
**任务体全程按「可达」措辞，不许写成「已发生」**——夸大一次现场，下一个人会去找不存在的日志。

### 现象与机制（管理者，2026-08-03）

令牌记录 `holder=archguard pid=3686239`，**该 pid 已死**，但 archguard 的 coverage 套件**正在跑**，
跑它的是**另一个 pid**。原因是 archguard 用

```
timeout 590 npx vitest run --coverage        # 放在一个重试循环里
```

**每次 `timeout` 杀掉一个尝试，持有令牌的那个 shell 就死了，令牌留在原地，
而下一次尝试用新 shell 继续跑。**

**⇒ 令牌的存活判定盯的是「取令牌的那个 shell」，不是「真正在跑的活」。**

### 后果（可达，非已发生）

此刻 quay 若来 `--acquire`，**回收会成功**（pid 确实死了）⇒ 两个项目的重活真的并发
⇒ **令牌存在的理由被绕开**。`stale_reclaims` 40 分钟内 **17 → 20**，与每次 `timeout` 杀一个 shell 吻合。

### 外层独立核实：结构性证据，不依赖抓现行

令牌文件的**全部内容**是：

```
holder=archguard
pid=3686239
acquired_ms=1785796956346
host=vhs
```

**没有 pgid、没有 session、没有真正干活的 pid。** 持有者 pid 已死而 `held_ms=674698`（11.2 分钟）。
**⇒ 「存活判定盯的是取令牌的 shell」可以直接从文件格式读出来**，
不需要恰好撞见一次并发——这一点让本条不必依赖时机就能立案。

### 一个显然的修法，已被实测否掉

「记录进程组（pgid），存活 = 组内任一进程还活着」听起来能解决重试循环。**但实测否掉了它**：
同一时刻 archguard 的两个 vitest 进程是

```
pid=3703496  pgid=3703496  ppid=2388051(archguard 会话)
pid=3703528  pgid=3703528  ppid=3703496
```

**pgid 各自不同** ⇒ 相继的尝试**不共享进程组**，pgid 与 pid 一样会随尝试死亡而失效。
**session 则相反——它太粗**：整个项目会话整天都活着，令牌会永远显示被占。

**⇒ pid / pgid / session 三个「猜哪个进程代表这份活」的方案都不成立。**

## Contract

```
measure holder_liveness_source = `cat $QUAY_GLOBAL_DIR/heavy-op/token` 中用于存活判定的字段名
measure reclaimable_while_working = `bash plugin/scripts/heavy-op-token.sh --acquire quay --timeout 0` 在「活仍在跑但取锁 shell 已死」夹具下是否成功的布尔字段
band reclaimable_while_working = false
invariant 令牌的存活信号必须来自「知道这份活是否还在继续」的那个实体，不得由旁观者猜进程
invoke `bash plugin/scripts/heavy-op-token.sh --status`
control 取锁 shell 被 kill 但重试循环仍在跑 ⇒ 不可回收；重试循环本身结束/被杀 ⇒ 到期后可回收
resume 先用夹具复现「取锁 shell 死而活仍在跑」，再改判定
```

## Chosen mechanism

**外层裁定：改成有到期时间的租约 + 显式续租，pid 死亡降级为「加速释放」而不是唯一信号。**

理由是上面那条否定推理：**没有任何一个进程标识能可靠代表「这份活」**——
pid 随 `timeout` 死、pgid 不跨尝试、session 太粗。
**而知道「活是否还在继续」的实体只有一个：那个重试循环本身。**
所以让它说话，而不是让令牌去猜。

1. **租约**：`--acquire` 写入 `lease_expires_ms`。到期即可回收，**与 pid 无关**。
2. **续租**：`--renew <project>` 由**重试循环**在每次尝试之间调用一次（一行）。
   **它是唯一知道活还在继续的实体**，也是唯一该负责的实体。
3. **pid 死亡 = 加速释放**：pid 已死 **且** 已过一个短宽限期 ⇒ 可提前回收
   （保留今天已被实战验证 20 次的行为，只是不再是**唯一**依据）。
4. **失败方向是安全的**：调用方不续租 ⇒ 租约到期 ⇒ 令牌释放 = **与今天行为相同，不会更糟**。
   这是本方案优于「记录真正干活的 pid」的关键——后者要求调用方在活起来之后再上报，
   **中间那段窗口无人保护，且一旦上报缺失就静默退化**。

**不做**：不记录 pgid/session 作为存活依据（已被实测否掉，见 Proposal）；
不移除 pid 存活检查（它仍是有效的加速信号）；不加后台守护进程（本仓已裁定懒回收是对的）；
**不要求 vitest / node --test 本身知道令牌的存在**（它们不该知道）。

## Acceptance Criteria

- [ ] AC1: **夹具复现可达状态**——取锁 shell 被 `kill` 而「活」仍在跑 ⇒
      **当前实现下 `--acquire` 成功回收**（这是修复前的必备证据，实跑输出贴任务体）
- [ ] AC2: **修复后同一夹具**——续租仍在进行 ⇒ `--acquire` **失败**、令牌原样保留（实跑输出贴任务体）
- [ ] AC3: **反向负控制（不得永久锁死）**——重试循环本身被杀、无人续租 ⇒
      **租约到期后必须可回收**，记录到期耗时。**这条不过，AC2 不算数**——
      把「误放行」换成「永久锁死」是更坏的交易
- [ ] AC4: **pid 加速路径保留**——pid 已死且过短宽限期 ⇒ 仍可提前回收（实跑贴出）
- [ ] AC5: **调用方改动是一行**——`--renew` 的接入点与用法写进脚本头，
      **并说明为什么责任在重试循环而不在令牌**
- [ ] AC6: **测量纪律（管理者提出，外层当场又踩一次）**——本任务任何「有几个重活在跑」的判断
      **不得用 cmdline 文本计数**（模式串会匹配到发起查询的那条命令自身），
      必须用**进程血统**或**令牌自己记录的 pid**；**自匹配数必须为 0** 并在输出中证明
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1（修复前可复现）与 AC3（不永久锁死）的实跑输出都贴进任务体——
      **只证明「修好了」而不先证明「原来真的会坏」，与「碰巧不再发生」不可区分**
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**这是一个可达状态，不是已观察到的并发**；
      并记录否定推理——**pid / pgid / session 都无法代表「这份活」，
      所以存活信号必须来自知道活是否继续的那个实体**

## Touches

- tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs.md
- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs
- scripts/test.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T23:05:00Z
changed: 管理者报出现象与机制并交外层判修法。**外层先做了两件事再下判断。**
**其一，把证据从「抓现行」换成「读格式」**：令牌文件的全部内容只有
`holder/pid/acquired_ms/host`——**没有 pgid、没有 session、没有干活的 pid**，
持有者 pid 已死而 `held_ms=674698`。**⇒ 缺陷可以从文件格式直接读出来，不必依赖时机**，
这让本条不再需要「恰好撞见一次并发」才能立案。
**其二，实测否掉了一个显然的修法**：同一时刻 archguard 的两个 vitest 进程
`pgid=3703496` 与 `pgid=3703528` **各自不同** ⇒ 相继尝试不共享进程组，
pgid 会和 pid 一样随尝试死亡失效；而 session 太粗（整天都活）。
**⇒ pid/pgid/session 三条「猜哪个进程代表这份活」的路都不通**——
**这个否定推理是本任务最重要的产出**，它直接决定了修法只能是「让知道的人说话」。
**据此裁定租约 + 显式续租**，责任落在**重试循环**（唯一知道活是否继续的实体），
pid 死亡降级为加速信号而非唯一依据。**并写明它为什么优于「记录真正干活的 pid」**：
后者要求活起来之后再上报，**中间窗口无人保护，且上报缺失时静默退化**；
而租约的失败方向是安全的——不续租就到期释放，**与今天行为相同，不会更糟**。
**AC3 是真判据**：把「误放行」换成「永久锁死」是更坏的交易。
**AC6 收录管理者的测量纪律**：判并发不得数 cmdline 文本——
**管理者踩了两次，外层在核实本条时当场又踩了第四次**（模式串匹配到发起查询的命令自身），
所以它进 AC 而不是留在对话里。
