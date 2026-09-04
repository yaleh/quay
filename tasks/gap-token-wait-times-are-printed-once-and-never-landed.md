---
id: gap-token-wait-times-are-printed-once-and-never-landed
title: heavy-op token emits waited_ms on every acquire and lands none of it —
  the concurrency-relaxation experiment cannot measure its third number
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

**人的三步排序第三步**是令牌放宽实验：把重活令牌从全局单飞放宽到两个并发套件，跑一天，测三个数——
**吞吐实际变了多少 / 内存峰值到哪 / 令牌等待时长的真实分布**。

**第三个数现在测不出来。**

### 现状：已经在测，从来没存

外层实测 `plugin/scripts/heavy-op-token.sh`：

| 事实 | 位置 |
|---|---|
| `waited_ms` **已经是契约 measure** | `:34` `measure wait_ms = \`--acquire <project>\` 输出的 waited_ms 字段` |
| **成功路径打印它** | `:278` `printf 'waited_ms=%d holder=%s acquired=yes\n'` |
| **失败路径也打印它**（注释明写「a contract measure — emitted on failure too」） | `:288-289` |
| 设计时就预见到要看它 | `:61` `no fair queue / FIFO: starvation is observable first (waited_ms), the policy decision waits` |
| **没有任何落盘** | 全脚本 `grep -n "jsonl\|EVENTS\|LOG"` **零命中** |

⇒ **每次 acquire 都算出了等待时长，打到 stdout，然后就没了。**
调用方（`scripts/test.sh`、内层派发）没有一个把它收下来。

### 为什么这不是「顺手加个日志」

**「分布」需要的是每次 acquire 一条记录，跨一整天。** 现在能拿到的只有：
- 当前这次调用的一个数（且只在调用者恰好读了 stdout 时）；
- **零历史** ⇒ 放宽前后没有可比的基线。

**⇒ 没有落盘，「放宽到 2 并发」跑完一天之后，第三个数只能靠回忆或估计**——
而本仓已经为「数字来自估计」付过学费（外层 AC6 的立条理由）。

**更关键的是基线**：放宽实验要回答的是「变了多少」，
**所以单飞状态下的分布必须先采到**。落盘越晚上线，可比的基线窗口越短。
**这条不在第一步的关键路径上，但它的价值随时间衰减** ——早一天落盘，多一天基线。

### 与第一步的关系

**不相交，可并行。** 本条只动 `plugin/scripts/heavy-op-token.sh` 及其测试；
第一步（A6/tmpfs）动 `plugin/loop/fast-mode-loop-tick.md` 与 `plugin/scripts/quay-init.sh`。

**但第三步依赖它们两个**：worktree 仍在 tmpfs 时放宽并发是在重演 OOM（第一步），
`waited_ms` 不落盘则第三个数测不出来（本条）。

## Contract

```
measure landed_records = `wc -l < .quay/heavy-op-token-events.jsonl` 输出的行数字段
measure fields_per_record = `tail -1 .quay/heavy-op-token-events.jsonl | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"` 输出的键数字段
measure acquire_still_works = `bash plugin/scripts/heavy-op-token.sh --acquire probe 2>&1; echo $?` 输出的退出码字段
measure fail_path_landed = `bash plugin/scripts/heavy-op-token.sh --acquire probe2 2>&1 >/dev/null; wc -l < .quay/heavy-op-token-events.jsonl` 输出的行数字段
band landed_records >= 1
band acquire_still_works = 0
invariant 每次 acquire 落一条记录，成功与超时两条路径都落；落盘失败绝不阻塞 acquire
invoke `bash scripts/test.sh plugin/test/heavy-op-token.test.mjs`
control 落盘目标不可写时 acquire 仍必须成功——观测机制绝不能变成新的单点故障
resume 先落盘再谈放宽；单飞状态下的基线窗口越早开始越有价值
```

## Chosen mechanism

**每次 acquire 追加一条 JSONL 到 `<root>/.quay/heavy-op-token-events.jsonl`**，
字段至少：`ts` / `project` / `waited_ms` / `acquired`（yes|no）/ `holder` / `outcome`。

**与本仓既有运行时状态同族**：`gate-events.jsonl` 的形态、位置与 gitignore 处理逐字对齐
（**并且要真的加进 `.gitignore`**——`loop-driver.jsonl` 就是漏了那一行，
见 [[gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes]] 的缺陷三）。

**不做**：不引入任何新依赖；**不做公平队列/FIFO**（`:61` 的既有决定是「先观测饥饿，策略决定往后放」，
本任务只补观测，**不动策略**）；**不在本任务里放宽并发上限**——
**放宽是第三步，本条只是让第三步可测**，两件事混做会让「变了多少」失去基线。

## Acceptance Criteria

- [x] AC1: **每次 acquire 落一条**——连跑 3 次 `--acquire`，`.quay/heavy-op-token-events.jsonl` 增加 3 行，
      每行含 `waited_ms` 与 `acquired`（实跑贴出三行原文）
      **证据**（`heavy-op-token-events.test.mjs` 实跑；三行原文）：
      ```json
      {"ts":1785813076254,"project":"probe","waited_ms":0,"acquired":"yes","holder":"probe","outcome":"acquired"}
      {"ts":1785813076614,"project":"probe","waited_ms":0,"acquired":"yes","holder":"probe","outcome":"acquired"}
      {"ts":1785813076897,"project":"probe","waited_ms":0,"acquired":"yes","holder":"probe","outcome":"acquired"}
      ```
- [x] AC2: **等待路径的数是真的**——构造一次真实排队（令牌被持有时再 acquire），
      落下的 `waited_ms` **与实际等待秒数相符**（实跑贴出，含两个时刻）。
      **不许只验「字段存在」**——`waited_ms` 恒为 0 也能通过一个只查存在性的断言
      **证据**（真实排队：holder 持锁 ~2s 后自然死亡，waiter 轮询）：
      ```
      heavy-op-token: HELD by block (pid 599350, held 481ms) — waiter did not acquire
      heavy-op-token: token held — waited 1s ...
      heavy-op-token: HELD by block (pid 599350, held 1615ms) — waiter did not acquire
      heavy-op-token: token held — waited 2s ...
      heavy-op-token: RECLAIMED stale token (mtime 2s old, pid 599350 not alive) — reclaim #1
      waited_ms=2000 holder=waiter acquired=yes
      {"ts":...,"project":"waiter","waited_ms":2000,"acquired":"yes","holder":"waiter","outcome":"acquired"}
      ```
      **`waited_ms=2000` ≈ 真实 ~2s 等待**（日志「waited 2s」即观测值）——验数值，不只验字段存在。
- [x] AC3: **超时/失败路径也落**（`:289` 已经在打印它）——实跑贴出一条 `acquired=no` 的记录
      **证据**：
      ```json
      {"ts":...,"project":"meta-cc","waited_ms":0,"acquired":"no","holder":"waiter","outcome":"timeout"}
      ```
- [x] AC4: **负控制（这条不过 AC1 不算数）**——把落盘目标改为不可写，
      `--acquire` **仍必须成功、退出码 0**。**观测机制绝不能变成新的单点故障**（实跑贴出）
      **证据**（落盘目标不可写，acquire 仍成功）：
      ```
      waited_ms=0 holder=quay acquired=yes
      exit=0
      ```
- [x] AC5: **gitignore**——`git check-ignore -v .quay/heavy-op-token-events.jsonl` 退出码 0，
      规则与 `gate-events.jsonl` 同形（实跑贴出）
      **证据**：
      ```
      $ git check-ignore -v .quay/heavy-op-token-events.jsonl; echo $?
      .gitignore:27:**/.quay/heavy-op-token-events.jsonl	.quay/heavy-op-token-events.jsonl
      exit=0
      ```
- [x] AC6: **报表**——一条命令给出分布（至少 count / 中位 / p90 / max），
      **在真实数据上跑一次并贴出**；样本不足时明确报「样本 N 不足」而不是打印一个漂亮的 0
      **证据**（样本 7 < 10）：
      ```
      heavy-op-token-events: count=7 — 样本 7 不足 (need >= 10 for a distribution); no median/p90/max printed
      ```
      （样本 12，含 AC2 的 2000ms 真实等待）：
      ```
      heavy-op-token-events: count=12 median_ms=0 p90_ms=0 max_ms=2000
      ```
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`heavy-op-token-events.test.mjs` 首行 `// @test-group governance`、
      `import { test } from "node:test"`；engine 文件 `heavy-op-token.test.mjs` 扩展
      `--events-file` 路由（AC9 隔离：测试周期绝不写真实 workspace 事件文件）。

## Definition of Done

- [x] AC2 与 AC4 的实跑输出都贴进任务体（真实排队一份、落盘不可写一份）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
      **证据**：套件 #10 与 #11（最终状态 `baaa0f80`，与第一步合并落地）连续两条
      `FULL-SUITE-EXIT=0` / `fail 0` / `cancelled 0`（各 1960 ✔ / 24 ﹣）。
- [x] 任务体记录**基线窗口的起始时刻**——第三步要回答「放宽后变了多少」，
      **单飞状态下的分布就是它的基线**，起点必须是可引用的一个时刻
      **证据**：本分支首次真实落盘 = AC1 第一条记录的 `ts=1785813076254`（2026-08-04）。
      合并后真实全量套件的 acquire 将续写同一类记录，构成放宽实验的单飞基线。
- [x] 任务体明写：**本条不放宽并发上限**，放宽是第三步
      **证据**：提交信息与实现均明写「Does NOT relax the concurrency ceiling — that is step 3」。

## Touches

- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs
- .gitignore
- plugin/test/heavy-op-token-events.test.mjs（新，AC7）

## Dispatch review

reviewer: outer
at: 2026-08-04T03:15:00Z
changed: **人的三步排序里，第三步（令牌放宽实验）被明确标注依赖「waited_ms 落盘」。
外层实测把这个依赖的形状查准了，结论是「一半已有、一半全无」**：
`waited_ms` **已经是契约 measure 且成功与失败两条路径都在打印**（`:34`/`:278`/`:289`），
**但全脚本零落盘**（`grep jsonl|EVENTS|LOG` 零命中）。
⇒ **要做的不是「开始测量」，是「把已经在算的数收下来」**——这个区分决定了工作量与风险等级，
写进任务体免得实现者从头设计一套度量。

**外层补了两条判据，都是防「通过但没用」**：
AC2 要求**在真实排队下验数值本身**——`waited_ms` 恒为 0 同样能通过一个只查字段存在的断言，
**那正是本仓「空集守门」那一族**；AC4 要求**落盘目标不可写时 acquire 仍必须成功**——
**观测机制绝不能变成新的单点故障**，而令牌是全局单飞点，它挂了整条流水线停。

**外层预先堵死一条范围漂移**：**本任务不放宽并发上限**。
放宽是第三步；两件事混做，「变了多少」就没有基线了。
同理 `:61` 记着的「不做公平队列，先观测饥饿」是既有决定，本条只补观测、不动策略。

**排期（外层的判断，供裁）**：本条**与第一步不相交，可并行派发**
（本条动 `heavy-op-token.sh`，第一步动 `quay-init.sh` 与 `fast-mode-loop-tick.md`）。
**并且它有时间价值**：第三步问的是「放宽后变了多少」，**单飞状态下的分布就是基线**，
**落盘越晚上线，可比的基线窗口越短**。它不在第一步的关键路径上，但它的价值随时间衰减——
这是外层建议不要把它排到第一步之后的唯一理由。

**并发资格（外层逐条 `## Touches` 对比后修正自己上一句话）**：
外层先写了「与第一步不相交，可并行」——**对第一步成立，但不是全称**。实测：

| 对手 | 交集 | 结论 |
|---|---|---|
| 第一步 `gap-the-shipped-tick-doc-...-tmpfs` | 空 | **可并行** |
| 在飞的 `finding-shape`（`packages/quay-native/*`） | 空 | **可并行** |
| `gap-init-guesses-the-tmux-session-...` | 空 | 可并行 |
| **`gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes`** | **`.gitignore`** | **必须串行** |

**两条都要往 `.gitignore` 加一行**（本条加 `heavy-op-token-events.jsonl`，那条加 `loop-driver.jsonl`），
**同文件同区域** ⇒ 不同批。**这正是本仓「同文件重叠必须派发前拦下、不留到 Land 才撞」的既有规则**，
外层把它写在这里而不是等合并冲突。

reviewer: inner（landing）
at: 2026-08-04
changed: **执行落地记录**。AC1–AC7 + DoD 全部勾选，证据见上。实现：`heavy-op-token.sh` 每次 acquire
在三条终态路径（成功/超时/fail-open）各落一条 JSONL（`ts/project/waited_ms/acquired/holder/outcome`），
落盘失败被吞掉、绝不改变 acquire 退出码（AC4）；`--events-file`/`HEAVY_OP_EVENTS_FILE` 测试接缝；
`--report` 分布报表（样本 <10 报「样本 N 不足」）；`.gitignore` 加 `**/.quay/heavy-op-token-events.jsonl`
（与 gate-events.jsonl 同形，AC5）；`heavy-op-token-events.test.mjs` 新测试（AC1-AC6，governance 标签）。
**与 loop-driver 任务的 `.gitignore` 串行约束确认**（两条同文件同区域，不可同批）。
**本任务与第一步合并落地，DoD 全量 #10/#11 一次满足两任务。**

## 遥测记录（2026-08-04，与真实区间不符，**不可用作基线**）

- **真实起止**：执行 subagent 于 03:0x 派发、03:12:25 提交实现（`9cc8d59c`），落地 04:27:03
  （`e6d01a7a`）。
- **遥测记录**：**无有效记录**。曾补记 `--task-start`（05:06:34），但那是崩溃后重启会话的
  补记——结束它会产生「几分钟 vs 真实约 1 小时」的合理外观错数，已**删除该补记**（见
  `gap-a-crash-leaves-phantom-in-flight-tasks` 新增 AC）。
- **为何不符**：OOM 后重启简报未含遥测括号指令，空上下文内层无记忆可依；补记的起止与真实
  区间不符。本批遥测读数不可用于第三步的前后对比基线。
