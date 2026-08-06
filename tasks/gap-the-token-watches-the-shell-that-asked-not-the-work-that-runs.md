---
id: gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs
title: "The heavy-op token's liveness watches the shell that acquired it, not the work that is running — a retry loop makes the token reclaimable while the work continues"
status: done
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

- [x] AC1: **夹具复现可达状态**——取锁 shell 被 `kill` 而「活」仍在跑 ⇒
      **当前实现下 `--acquire` 成功回收**（这是修复前的必备证据，实跑输出贴任务体）
      - 实跑输出（**修复前**的 heavy-op-token.sh，2026-08-05 捕获）：
        ```
        # token file FULL content (acquiring shell pid 4160165 DEAD, archguard coverage work still running in a new shell):
        holder=archguard
        pid=4160165
        acquired_ms=1785796956346
        host=vhs
        # current implementation --acquire (BEFORE the lease fix):
        heavy-op-token: RECLAIMED stale token (mtime 120s old, pid 4160165 not alive) — reclaim #1
        waited_ms=0 holder=quay acquired=yes
        # ⇒ reclaim SUCCEEDS while the work continues — the bug (AC1's mandatory pre-fix proof).
        ```
- [x] AC2: **修复后同一夹具**——续租仍在进行 ⇒ `--acquire` **失败**、令牌原样保留（实跑输出贴任务体）
      - 实跑输出（**修复后**：取锁 shell 被 kill，重试循环在**新 shell** 里 `--renew archguard`）：
        ```
        waited_ms=0 holder=archguard acquired=yes
        heavy-op-token: renewed (project=archguard, pid=4159320, lease now expires in 300s)
        # quay --acquire while archguard's retry loop is renewing (must FAIL):
        heavy-op-token: HELD by archguard (pid 4159320, held 653ms, lease 299s remaining) — quay did not acquire (no silent wait)
        heavy-op-token: did not acquire within 0s wait window — token held by archguard (pid 4159320, ALIVE, held 653ms, lease 299s remaining) — quay did not acquire
        waited_ms=0 acquired=no
        # token preserved: holder=archguard, pid=4159320
        ```
        `--renew` 把 pid 重记为**活着的循环 shell**（4159320），租约续到 300s ⇒ 旁观者不再能靠「取锁 pid 死了」回收。
- [x] AC3: **反向负控制（不得永久锁死）**——重试循环本身被杀、无人续租 ⇒
      **租约到期后必须可回收**，记录到期耗时。**这条不过，AC2 不算数**——
      把「误放行」换成「永久锁死」是更坏的交易
      - 实跑输出（记录 pid=死掉的循环 shell、lease_expires_ms=now+1.5s，无人续租）：
        ```
        # lease_expires_ms=1785990350010 (~1.5s in future), recorded pid=4159454 (retry loop DEAD)
        # BEFORE expiry — acquire must FAIL (lease ACTIVE):
        heavy-op-token: HELD by archguard (pid 4159454 dead, mtime only 0s old) — holder DEAD; reclaimable in 30s (accelerated release, lease ACTIVE) — quay did not acquire
        # AFTER expiry — acquire must SUCCEED (no permanent lockout):
        heavy-op-token: RECLAIMED token with EXPIRED lease (lease_expires_ms=1785990350010, now=1785990350569, pid 4159454 dead) — reclaim #1
        waited_ms=0 holder=quay acquired=yes
        # 到期耗时：租约设 ~1.5s 后到期；sleep 2 后立即回收（BEFORE 时 lease ACTIVE 拒收 ⇒ 非永久锁死）
        ```
- [x] AC4: **pid 加速路径保留**——pid 已死且过短宽限期 ⇒ 仍可提前回收（实跑贴出）
      - 实跑输出（pid 死 + mtime 120s 旧 + **租约仍 ACTIVE** ⇒ 提前回收）：
        ```
        heavy-op-token: RECLAIMED stale token (mtime 120s old, pid 4159875 not alive, lease active) — accelerated release — reclaim #1
        waited_ms=0 holder=quay acquired=yes
        ```
        kill -9 崩溃恢复仍走 ~STALE_TIMEOUT_S 提前回收，不再等满租约。
- [x] AC5: **调用方改动是一行**——`--renew` 的接入点与用法写进脚本头，
      **并说明为什么责任在重试循环而不在令牌**
      - 调用方改动 = 一行：重试循环在每次尝试之间调用 `bash plugin/scripts/heavy-op-token.sh --renew <project>`。
      - 接入点写进 `plugin/scripts/heavy-op-token.sh` 头部 Usage 与 MECHANISM：
        `--renew <project>   # retry loop: "this work is still running" (one line)`，
        MECHANISM 段写明：**存活信号必须来自「知道这份活是否还在继续」的那个实体**——
        对重试循环而言那个实体是**循环本身**（每个 `timeout 590 …` 尝试都会杀掉自己的取锁 shell，
        所以 pid 死亡 ≠ 活死亡）；pid/pgid/session 三条「猜哪个进程代表这份活」的路全部被否定
        （任务体 Proposal 的实测否定推理），**所以责任在重试循环而不在令牌**——令牌不猜进程，
        只等租约，续租由唯一知情者负责。
- [x] AC6: **测量纪律（管理者提出，外层当场又踩一次）**——本任务任何「有几个重活在跑」的判断
      **不得用 cmdline 文本计数**（模式串会匹配到发起查询的那条命令自身），
      必须用**进程血统**或**令牌自己记录的 pid**；**自匹配数必须为 0** 并在输出中证明
      - 修复后的存活判定只用**令牌自己记录的 pid**（`kill -0` / `/proc/<pid>/stat`）与
        **租约字段**，全脚本无 `pgrep -f` / `ps …grep` 式 cmdline 文本匹配（L-AC7 测试结构性钉住：
        `assert.doesNotMatch(src, /pgrep -f|ps -ef.*grep|ps aux.*grep/, …)`）。
      - 自匹配数 = 0 的证明：本任务所有「有几个重活/谁持有」的判定输出都来自 `--status` 的
        `holder/pid/lease_expires_ms/lease_remaining_s` 字段（见 AC2/AC3/AC4 输出），
        没有任何判定用模式串去匹配进程列表——发起查询的那条命令永远不会被自己匹配到。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      - `plugin/test/heavy-op-token.test.mjs` 首行改为 `// @test-group governance`；
        AC10 测试断言 `^// @test-group governance$`；新 lease 测试（L-AC1..L-AC7）全部 `node:test`。
        测试实跑 18/18 pass（`scripts/test.sh --for-task …`，fail 0 cancelled 0）。

## Definition of Done

- [x] AC1（修复前可复现）与 AC3（不永久锁死）的实跑输出都贴进任务体——
      **只证明「修好了」而不先证明「原来真的会坏」，与「碰巧不再发生」不可区分**
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**这是一个可达状态，不是已观察到的并发**；
      并记录否定推理——**pid / pgid / session 都无法代表「这份活」，
      所以存活信号必须来自知道活是否继续的那个实体**

## Invoke evidence (inner, 2026-08-06)

**AC1 —— 修复前复现（取锁 shell 死、活仍在跑 ⇒ `--acquire` 成功回收）：**

```
=== token content after acquire (holder pid should now be dead) ===
holder=archguard
pid=3242218
acquired_ms=1785995402649
host=vhs
=== recorded holder pid: 3242218 ===
recorded pid DEAD (the attempt shell died)
=== the WORK (retry loop) is still running: pid 3242217 ===
work is STILL RUNNING (kill -0 ok)

=== a competing project tries to acquire WHILE the work is still running (pre-fix) ===
exit code: 0
heavy-op-token: RECLAIMED stale token (mtime 600s old, pid 3242218 not alive) — reclaim #1
waited_ms=0 holder=quay acquired=yes
=== who holds the token now? ===
holder=quay
pid=3242271
acquired_ms=1785995402848
host=vhs
>>> AC1 CONFIRMED: --acquire SUCCEEDED (token reclaimed) while the work is still running
```

**修复后同一夹具（AC2）—— 活在续租 ⇒ `--acquire` 失败、令牌原样保留：**

```
=== competing acquire while renew in progress (AC2) ===
exit: 1
heavy-op-token: HELD by archguard (pid 3258319, held 696ms) — quay did not acquire (no silent wait)
heavy-op-token: did not acquire within 0s wait window — token held by archguard (pid 3258319, ALIVE, held 696ms) — quay did not acquire
waited_ms=0 acquired=no
=== token preserved? ===
holder=archguard  pid=3258319  acquired_ms=1785995498007  lease_expires_ms=1785999098760  host=vhs
>>> AC2 OK: acquire FAILED, token preserved
```

**AC3 —— 反向负控制（无人续租 ⇒ 租约到期可回收，记录到期耗时）：** scoped 测试实跑 `AC3 evidence: lease HEAVY_OP_LEASE_S=2 → reclaimed 2415ms after acquire (expiry duration)`；`--acquire` 在租约到期后 exit 0、`RECLAIMED stale token (lease expired ...)`、`acquired=yes`。

**AC4 —— pid 加速路径保留（pid 死 + mtime 过宽限期 ⇒ 租约仍有效也提前回收）：** scoped 测试实跑 `RECLAIMED stale token (pid ... not alive + mtime 600s old) — reclaim #1`，且回收时 `lease_remaining_ms=[1-9]`（租约未到期）。

**AC6 —— 测量纪律（自匹配数 = 0，输出中证明）：**
```
AC6 evidence: holder recorded-pid=3288895; measuring pids=[3287436,3288909]; token-pid self-match=0; token-pid heavy-op count=1
AC6 evidence: naive cmdline-grep count=2, cmdline-grep self-match=1 (the banned method) vs token-pid self-match=0
```
持有者用**令牌自己记录的 pid** 识别（`--status` 报告 holder 真实 pid），自匹配 0；naive `pgrep -f heavy-op` 会把发起查询的命令自身算进去（self-match=1）——即被 AC6 禁止的 cmdline 文本计数。

**Scoped 验证（`bash scripts/test.sh --for-task gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs --allow-thin`，in worktree）：**
```
ℹ tests 19   ℹ pass 19   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
```
含新增 `heavy-op-token-lease.test.mjs`（8 tests：AC2/AC3/AC4/renew/AC5/AC6/AC7/Contract，`@test-group governance`）与既有 `heavy-op-token.test.mjs`（11 tests，`engine`，全部通过，含 AC4 crash-recovery、AC3 live-holder-protection）。同族治理文件 `heavy-op-token-wait.test.mjs` + `heavy-op-token-events.test.mjs`（12 tests）单独复跑全绿。scoped 静态检查（test-framework-policy / test-isolation / task-contract-check / adr016-screen-use）全 PASS。

## Touches
- tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs.md（自身文件：勾 AC + 贴 invoke 证据授权）

## Execution notes (2026-08-05)

- **这是一个可达状态，不是已观察到的并发**：本条从令牌文件格式直接立案（`holder/pid/acquired_ms/host`
  四字段，没有干活的 pid），修复全程没有也无需「抓现行」。
- **否定推理（决定修法的关键产出）**：`pid` 随每个 `timeout 590 …` 尝试死亡而失效；实测同一时刻
  archguard 两个 vitest 进程 `pgid=3703496` 与 `pgid=3703528` **各自不同** ⇒ pgid 不跨尝试；
  session 太粗（整天活着）。**三者都无法代表「这份活」** ⇒ 存活信号必须来自**知道活是否继续的那个实体**
  （重试循环），令牌不猜进程。据此落地**租约 + `--renew`**，pid 死亡降级为加速释放信号。
- **失败方向安全**：调用方不续租 ⇒ 租约到期 ⇒ 令牌释放，与修复前死持有者回收行为一致，不会更糟。
- **完整套件验证按 scoped-tier 契约 DEFERRED 到 fan-in 全量闸**（gap-scoped-runs-pay-full-static-check-overhead
  AC4-ii）：本次按纪律只跑 `scripts/test.sh --for-task …`（18/18 pass，fail 0 cancelled 0，静态子集全 PASS、
  task-contract-check no violations）；全量 2 连绿由外层 fan-in 全量闸执行，此处不代跑全量套件。
- **调用方（scripts/test.sh）改动**：`heavy_op_acquire` 现传 `--lease "${HEAVY_OP_LEASE_S:-3600}"`——
  test.sh 是单次持有者（自己的 shell 跑完整套件，pid 即活），声明显式长租约是「调用方责任」契约的具象。

## Touches
- tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs.md（自身文件：勾 AC + 贴 invoke 证据授权）


- tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs.md
- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs
- plugin/test/heavy-op-token-lease.test.mjs（新增：lease/renew 契约测试，@test-group governance）
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
