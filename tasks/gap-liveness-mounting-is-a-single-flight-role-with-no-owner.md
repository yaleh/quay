---
id: gap-liveness-mounting-is-a-single-flight-role-with-no-owner
title: "Liveness mounting is a single-flight role that nobody owns — 1 mount became 5 in thirty minutes because 'mount your own' is a correct decision five times over"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/SPEC-outer-liveness-productization.md` **AC20**（管理者，2026-08-03）。
管理者收回了自己「需要就自己重挂」那句话，并指出**那句话本身就是缺陷**。

**实测**：21:2xZ 杀掉 5 个旧版实例并通知两个外层「需要就自己重挂」，**30 分钟后 5 个挂载、12 个进程**：

| ppid | 属主 | 挂载时刻 |
|---|---|---|
| 120373 | 管理者 | 19:21Z **和** 21:50Z——**同一人两个** |
| 966759 | quay 外层 | 21:23Z（收到通知后重挂） |
| 2388387 | archguard 外层 | 21:24Z（同上） |
| **270244** | **quay 内层** | 21:49Z——**它也挂了一个，没人知道** |

**每个参与者的判断单看都对**——「我需要监视器，我没有，所以我挂一个」。
五个人都这么想就有五个挂载，同一次状态切换被报五遍。

**一般形态（管理者原话）**：**「谁需要谁自己起一个」对单飞资源是错的默认。**
正确的默认是「谁需要谁去**订阅**」，挂载是一个**有主的、可接管的角色**。
这与令牌同理，区别只在于**令牌天然排他、监视器看起来不排他——看起来不是，所以没人给它加锁**。

## Contract

```
measure mount_count = `ps -eo ppid,args | grep -c '[s]ession-liveness.sh'` 的进程数字段
measure takeover_ms = `bash plugin/scripts/session-liveness-mount.sh` 在持有者被 kill -9 后输出的接管耗时毫秒字段
band mount_count = 1
invariant 挂载是有主角色，订阅不需要挂载；第二个挂载是空操作不是失败
invoke `bash plugin/scripts/session-liveness-mount.sh`（或等价入口）
control 已有活持有者时再挂 ⇒ 退出 0 且不新增进程；kill -9 持有者后再挂 ⇒ 必须接管
resume 先做锁与空操作语义，再做共享事件文件，最后做接管负控制
```

## Chosen mechanism

**AC20a–d 逐条落地（管理者判据，不得改写）：**

1. **AC20a 单飞锁**：挂载前取锁，**复用 `heavy-op-token.sh` 已验证的那套**——
   `wx` 原子创建 + **mtime 陈旧 AND pid 不存活**才回收，绝不裸覆盖、绝不永久锁死。
   **不要新写一套**：那套锁今天已在真实死持有者上回收了 17 次，是本仓唯一被实战验证过的锁。
2. **AC20b 第二个挂载是空操作**：检测到活持有者 ⇒ 打印属主与 pid，**退出 0**。
   **报错会让人去 kill，而 kill 正是这一整摊事的来源。**
3. **AC20c 事件写共享文件**（`$QUAY_GLOBAL_DIR/session-liveness/events.jsonl`），
   **订阅与挂载分离**——要看事件的人不必自己挂一个。
4. **AC20d 接管负控制**：持有者被 `kill -9` 后，下一次挂载必须**接管**（陈旧回收），
   否则单飞就变成单点故障。

**不做**：不新写锁；不把第二个挂载做成失败；不为了减噪而改 RESUMED/IDLE 判据
（那是 [[gap-session-liveness-hashes-the-token-counter-as-if-it-were-work]] 的范围，
管理者已按 §1.6 停止追查，重复事件当前不产生成本）。

## Acceptance Criteria

- [x] AC1（=AC20a）: 挂载前取单飞锁，**复用 `heavy-op-token.sh` 的锁语义**，不新写一套（贴出复用点）
      复用点（`plugin/scripts/session-liveness.sh` 单飞门，直接调用，不新写锁）：
      ```
      HEAVY_OP_STALE_TIMEOUT_S="$SL_MOUNT_STALE_S" bash "$hot" \
          --acquire "$SL_OWNER" --root "$SL_GLOBAL_DIR" --timeout 0 >"$out_file" 2>"$err_file"
      ```
      其中 `$hot="$REPO_ROOT/plugin/scripts/heavy-op-token.sh"`——wx 原子创建 + mtime 陈旧 AND
      pid 不存活才回收，绝不裸覆盖、绝不永久锁死（那套锁已在真实死持有者上回收 17 次）。
      测试钉住：`M7 (AC1)` 断言 source 含 `heavy-op-token.sh` + `--acquire` + 「mtime 陈旧」「pid 不存活」。
- [x] AC2（=AC20b）: 已有活持有者时再挂 ⇒ **退出 0**、打印属主与 pid、**不新增进程**（实跑输出贴任务体）
      实跑（第二个挂载，第一个持有者 pid 4018511 活着）：
      ```
      $ bash plugin/scripts/session-liveness-mount.sh; echo exit=$?
      session-liveness: starting pid=4018632 file=session-liveness.sh md5=6f81cbb61d9725a1
      session-liveness-mount: 已有活持有者（属主 quay-outer，pid 4018511）——第二个挂载是空操作（exit 0），不新增进程
      exit=0
      ```
      锁域内 `mount_count` 保持不变（测试 M2/M5 断言 =1；进程瞬时退出，不成为第二个监视器）。
- [x] AC3（=AC20c）: 事件写入共享文件，**第二方不挂载即可读到同一批事件**（实跑输出贴任务体）
      实跑（订阅方直接读 `$QUAY_GLOBAL_DIR/session-liveness/events.jsonl`，不需要挂载）：
      ```
      $ tail -4 /tmp/…/events.jsonl
      {"ts":1785802087659,"event":"HEARTBEAT","name":"quay-outer","msg":"holder alive"}
      {"ts":1785802088722,"event":"HEARTBEAT","name":"quay-outer","msg":"holder alive"}
      {"ts":1785802089841,"event":"HEARTBEAT","name":"quay-outer","msg":"holder alive"}
      {"ts":1785802090765,"event":"HEARTBEAT","name":"quay-outer","msg":"holder alive"}
      ```
      真实事件也落地共享文件（测试 M6 断言 `SESSION-GONE sh` 出现在 `events.jsonl`，且读文件不新增进程）。
- [x] AC4（=AC20d）: **接管负控制**——`kill -9` 持有者后下一次挂载**成功接管**，记录 `takeover_ms`（实跑贴出）
      实跑（`kill -9 4018511` 后）：
      ```
      $ bash plugin/scripts/session-liveness-mount.sh
      session-liveness-mount: 接管成功 takeover_ms=152（陈旧锁被回收，前一持有者已死）
      ```
      测试 M3 断言接管后新持有者 pid == 新挂载进程、`mount_count` 仍 =1。
- [x] AC5: **反向负控制（不得误抢）**——持有者**活着**时再挂 ⇒ **绝不接管**、不 kill 任何进程。
      **这条不过，AC4 不算数**——把「重复挂载」换成「互相抢夺」是更坏的交易
      测试 M2/M4 断言：第二个挂载后锁文件**字节不变**、持有者进程**仍活着**、`mount_count` 不变。
- [x] AC6: **端到端计数**——一次真实三方场景后 `mount_count == 1`（实跑输出贴任务体）
      实跑（三次挂载：一次持有 + 两次空操作后，按锁域内 `/proc` 计数）：
      ```
      mount_count=1
      ```
      测试 M5 断言三次挂载后锁域内仅 1 个 `session-liveness.sh` 进程。
- [x] AC7（**外层新增，见下方设计缺口**）: **持有者死亡必须可被订阅方发现**——
      共享事件文件带心跳/时间戳，订阅方能据此判定「看门的已经不在了」，
      **且该判定不依赖任何人恰好去尝试挂载**（实跑输出贴任务体）
      实跑（持有者 kill -9 后 1.5s，订阅方取最后一条 ts——**不相等即心跳已停**）：
      ```
      last_ts_before="ts":1785802090765  last_ts_after="ts":1785802090765  (相等=心跳已停)
      ```
      机制：持有者每轮往共享 `events.jsonl` 追加一条 `{"ts":…,"event":"HEARTBEAT",…}`；心跳线一停，
      订阅方看最后一条 ts（或文件 mtime）即知「看门的已经不在了」，不需要任何人去试挂。测试 M6 钉住。
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`
      `plugin/test/session-liveness.test.mjs` 与 `plugin/test/monitor-mount-check.test.mjs`
      均首行 `// @test-group governance` 且 `import { test } from "node:test"`。
- [x] AC9（**管理者 2026-08-03 23:35Z 转报，外层并入本条**）: **`monitor-mount-check` 的
      `ownedByThisSession` 判据必须废除或改写**。
      现状（`plugin/scripts/monitor-mount-check.sh:9`）：沿每个匹配 pid 的 ppid 链找最近的
      claude 进程，与本进程的链比对 ⇒ **别的会话挂的监视器一律判 `false`**。
      而**真实投递已由 REPO-STALL 事件证明** ⇒ **判据比现实严，把成功的挂载判成失败**。
      **更要紧的是它与本任务的设计直接冲突**：AC20c 要的正是
      **一方挂载、多方订阅**——在那个设计下「是不是本会话挂的」**根本不该是通过条件**。
      判据：改为**「事件是否真的送达」**（共享事件文件有新事件 / REPO-STALL 可见），
      **不是「是不是我挂的」**。负控制：别的会话挂的、投递正常 ⇒ **必须判 PASS**；
      无人挂载 ⇒ **必须判 FAIL**（两个方向都贴）
      改写完成：`ownedByThisSession` 字段已从 `monitor-mount-check.sh --json` 移除，判据替换为
      `delivered`（共享 `events.jsonl` mtime 新鲜）。两个方向的测试都贴：
      ```
      ✔ AC9 — a monitor from ANOTHER session with NORMAL delivery ⇒ delivered=true (别的会话挂的、投递正常 ⇒ PASS)
      ✔ AC5 — a monitor orphaned to a PREVIOUS session with NO fresh events ⇒ delivered=false (无人挂载 ⇒ FAIL)
      ```
      （`plugin/test/monitor-mount-check.test.mjs` 11/11 通过）

## 设计缺口（外层提出，2026-08-03 22:00Z，AC20 原文未覆盖）

**AC20b 与 AC20d 之间有一个洞：接管只发生在「有人尝试挂载」的那一刻，
而 AC20b 恰恰在教育所有参与者不要去尝试。**

推演：持有者进程死掉 ⇒ 没有人在看 ⇒ 但也没有人会去挂载（大家已经学会「有主了，我不挂」）
⇒ **单飞成功地把 5 个挂载收敛成 0 个，而没有任何东西会报警**。
AC20d 的接管是对的，但它是**被动**的，触发条件被 AC20b 抑制了。

**AC7 是这个洞的判据**：订阅方必须能从共享事件文件本身看出「看门的不在了」——
**心跳时间戳陈旧**即是信号，不需要任何人去试挂。

**活证据（2026-08-04 00:20Z，外层自己身上）**：外层 21:12Z 重挂的那个监视器
**再次静默死亡**（exit 1，输出文件已不存在，而 `session-liveness.sh` 未被改动——
mtime 18:55、`bash -n` 通过、工作树干净，**死因不在脚本**）。
最可能的链条：脚本退出 ⇒ 外层加的 `grep` 过滤器**无匹配** ⇒ `grep` 返回 1 ⇒ 管道 exit 1。
**⇒ 外层为降噪滤掉 RESUMED 之后，「看门的死了」与「一切安静」返回同一个状态。**
这是同一个洞的第三次现身（第一次 exit 144 零诊断、第二次跑过时副本、本次过滤器吞掉死讯），
**且这次是外层自己造的**——所以 AC7 不能只要求「心跳陈旧可见」，
**还必须要求：订阅方的过滤器无论怎么写，都不能让看门者的死亡变成静默**
（可行做法：事件流里始终包含一条无法被业务过滤器滤掉的存活心跳）。

**另一条同源观察**：`ppid 270244` 是**内层给自己挂的**。
一个会话给自己挂存活监视，**事件投递进它自己的通道**——
**会话一死，它的死讯就没有地方可送**。所以单飞的持有者**不应当是被监视的那个会话**。
这不是噪声问题，是**结构上无法完成它存在的目的**。

## Definition of Done

- [x] AC2/AC4/AC5 三条的实跑输出都贴进任务体（见上方 AC2/AC4/AC5 的实跑块；AC5 由测试 M2/M4 的
      「锁字节不变 + 持有者进程不灭」断言钉住）
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**——
      本仓 2026-08-03 已发生一次 `fail 0 / cancelled 2` 的假绿）
      ——**协调方所有**：本任务只跑 scoped 测试（session-liveness.test.mjs 37/38→修后全绿、
      monitor-mount-check 11/11、heavy-op-token + wait 17/17、cold-start-skill + quay-init-loop 全绿），
      完整套件由协调方 fan-in 连跑 2 次判定。
- [x] 任务体记录一般形态：**「谁需要谁自己起一个」对单飞资源是错的默认**；
      正确的默认是「谁需要谁去订阅」，挂载是有主的、可接管的角色
      （见下方「实现记录」）。

## 实现记录（2026-08-04，外层执行）

**一般形态（管理者原话，逐字照搬）**：**「谁需要谁自己起一个」对单飞资源是错的默认。**
正确的默认是「谁需要谁去**订阅**」，挂载是一个**有主的、可接管的角色**。
这与令牌同理，区别只在于**令牌天然排他、监视器看起来不排他——看起来不是，所以没人给它加锁**。

**挂载入口**：`plugin/scripts/session-liveness-mount.sh`（`exec` 进 `session-liveness.sh`，同一 pid）。
`session-liveness.sh` 自身也在长跑模式取单飞锁——**任何入口都单飞**；`--once` / `--mask` /
`--api-errors` / `--last-input` 是诊断接缝，不取锁、不写心跳。

**单飞门（`_sl_acquire_or_noop`）**：
1. 快查 `heavy-op-token.sh --acquire <owner> --root $QUAY_GLOBAL_DIR/session-liveness --timeout 0`。
   - `acquired=yes` ⇒ 本进程成为持有者（锁 pid == 监视器 pid，因 `exec` 保持 pid）。
   - 有活持有者（锁 pid 存活）⇒ 打印属主与 pid、**退出 0**（AC20b，报错会让人去 kill）。
   - 死持有者（锁 pid 不活）⇒ 有界等待 `--timeout N` 接管（AC20d，`takeover_ms` 从第一次尝试起算）。
   - fail-open（状态目录不可写）⇒ 无锁继续跑监视器（调度角色不是安全检查，与令牌同源）。
2. 取锁后 `trap _sl_release_mount_lock EXIT`——正常退出/SIGTERM 释放锁；SIGKILL 不触发 trap，
   锁留陈旧由下一次挂载回收（这本身就是 AC20d 的接管）。

**两个实现陷阱（均已修并测试钉住）**：
- 取锁不能放进命令替换 `$(...)`——它引入瞬态子 shell 当 heavy-op-token 的父进程，锁记下子 shell
  的 pid（随即退出），下一个挂载会误回收活持有者。必须重定向到文件再读。
- 单飞门必须**直接调用**、不能 `case "$( _sl_acquire_or_noop )" in`——命令替换的子 shell 会在函数
  返回时触发 EXIT trap 立刻释放锁，锁被取到后瞬间释放，单飞直接失效。

**共享事件文件（AC20c/AC7）**：`$QUAY_GLOBAL_DIR/session-liveness/events.jsonl`，每行
`{"ts":<epoch-ms>,"event":<事件类型>,"name":<目标名>,"msg":<整行>}`。持有者每轮追加一条
`HEARTBEAT`（只进共享文件，不污染 stdout/Monitor 事件流）。订阅方取最后一条 ts / 文件 mtime
判「看门的不在了」——不依赖任何人去试挂。

**AC9（monitor-mount-check）**：`ownedByThisSession` 废除，判据改为 `delivered`（共享事件文件
有新事件）；别的会话挂的、投递正常 ⇒ PASS；无人挂载 ⇒ FAIL。skill 与 tick 文档同步。

**处置内层那个挂载（`ppid 270244`）**：**不杀**——管理者已明说「不用急着杀」，AC20 落地后单飞会
自然收敛它。结构性理由已记录：内层给自己挂存活监视，事件投递进它自己的通道，**会话一死死讯无处
可送** ⇒ 单飞持有者**不应当是被监视的那个会话**——这不是噪声问题，是结构上无法完成其目的。

## Touches

- plugin/scripts/session-liveness.sh
- plugin/scripts/heavy-op-token.sh
- plugin/test/session-liveness.test.mjs
- orchestration/SPEC-outer-liveness-productization.md

## Dispatch review

reviewer: outer
at: 2026-08-03T22:00:00Z
changed: 管理者收回「需要就自己重挂」并把 AC20a–d 交给外层走项目正常流程。
**判据逐字照搬，未改写**——这是管理者的裁定，不是外层的设计。
**外层加了两条自己的东西，都标注了来源**：
**AC5（反向负控制）**——把「重复挂载」换成「互相抢夺」是更坏的交易，
**AC5 不过则 AC4 不算数**，这是本仓今天反复用到的双向控制纪律；
**AC7（外层发现的设计缺口）**——**AC20b 与 AC20d 之间有一个洞**：
接管只在「有人尝试挂载」时发生，而 AC20b 正在教育所有人不要尝试
⇒ 持有者一死，单飞会把 5 个挂载收敛成 **0** 个而无人报警。
判据是让订阅方从共享事件文件的**心跳陈旧**自行发现，**不依赖任何人去试挂**。
**处置内层那个挂载（管理者交给外层）**：**不杀**——
管理者已明说「不用急着杀」，而 kill 正是这摊事的来源；
AC20 落地后单飞会自然收敛它。**但记录一条结构性理由**：
内层给自己挂存活监视，事件投递进它自己的通道，**会话一死死讯无处可送**
⇒ **单飞持有者不应当是被监视的那个会话**，这不是噪声问题，是结构上无法完成其目的。
