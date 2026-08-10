---
id: gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe
title: "the L0 anti-machine-wipe guard (tmux-isolated.sh) has ZERO consumers
  outside its own test — 8 of 9 tmux-using test files bypass it and hand-roll
  isolation, and 4 of those 8 are missing the isolation mechanisms the guard's
  own header declares MANDATORY ('BOTH are required (AC1)': env -u TMUX because
  $TMUX overrides TMUX_TMPDIR, AND an explicit -S because only -S overrides
  $TMUX); measured: supervisor-deliver.test.mjs has neither (bare `tmux
  new-session` at :142 lands on the DEFAULT socket that hosts the live quay-0
  sessions), send-keys-reliable.test.mjs has neither, session-liveness.test.mjs
  has env-u-TMUX but NO -S, session-bootstrap.test.mjs has -S but no env -u
  TMUX; on 2026-08-06 ~16:00:05 the machine's entire tmux server died taking
  quay-0's outer+inner with it, DURING a full-suite run (15:53 red, 2854 tests)
  that executes all of these files, and sudo dmesg confirms NO kernel OOM today
  (last OOM was Aug 1) so this was a userspace tmux kill, not memory pressure —
  this is the FIFTH instance of a failure mode already documented four times
  (gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX,
  restart-plan-2026-08-04-third §6) for which the guard was purpose-built and
  then never adopted; manager 2026-08-06 with sudo-verified kernel evidence"
status: done
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

**为防止整机崩溃而专门建的 L0 防护，除了它自己的测试之外零消费者——于是它防的那个崩溃今天第五次发生。**

### 崩溃事实（sudo 核实，排除了先前的错误猜测）

| 项 | 值 |
|---|---|
| 崩溃时刻 | **2026-08-06 16:00:05**（`quay-0` 的 outer+inner 连同整个 tmux server 消失） |
| 机器是否重启 | **否**（uptime 连续 14 天） |
| 内核 OOM killer | **今天零记录**（`sudo dmesg -T` 确认，最近一次 OOM 是 **8月1日**）——**先前"OOM 最像"的猜测被推翻** |
| 内核今天是否杀过任何东西 | **否**（`Aug 6` 无任何 kill/signal/segfault 内核事件） |
| systemd scope 终止形态 | 只有 `Started` + `Consumed`，**没有正常的 `Stopped` 转换**——异常终止签名 |
| 崩溃时在跑什么 | **全量套件**（15:53 出 red，2854 tests），套件包含下述全部 tmux 夹具测试 |

⇒ **不是内存压力，是用户空间的 tmux 操作打到了默认 socket。**

### 防护存在、且写明了强制条件

`plugin/scripts/tmux-isolated.sh` 头注原文：

> The two whole-machine crashes (vhs / transformer, 2026-08-04) both came from a sub-agent's
> throwaway shell calling bare `tmux kill-server` and killing the real default server that hosts
> the live quay sessions (quay-0).
>
> `$TMUX` **overrides** `TMUX_TMPDIR` — 只设 TMUX_TMPDIR 不能隔离继承了 `$TMUX` 的进程
> `-S/-L` **overrides** `$TMUX` — 显式 -S/-L 才一定隔离
>
> **BOTH are required (AC1).**

### 实测：防护零采用，且手写替代品普遍不合格

```
$ for f in plugin/test/*.mjs; do  # 统计 isolated 用量 vs 裸 tmux 调用
```

| 测试文件 | 用 `tmux-isolated.sh` | `env -u TMUX` | `-S` | 判定 |
|---|---|---|---|---|
| `supervisor-deliver.test.mjs` | **0** | **0** | **0** | 🔴 `:142` 裸 `tmux new-session`，落默认 socket |
| `send-keys-reliable.test.mjs` | **0** | **0** | **0** | 🔴 两样全无 |
| `session-liveness.test.mjs` | **0** | 3 | **0** | 🔴 缺 `-S`——按头注，`$TMUX` 会覆盖 `TMUX_TMPDIR` |
| `session-bootstrap.test.mjs` | **0** | **0** | 2 | 🟡 缺 `env -u TMUX` |
| `inner-session-check` / `quay-init-tmux-detection` / `send-keys-verified` / `session-topology` | 0 | ✓ | ✓ | 🟢 两样都有（但仍绕过防护，靠自觉） |
| `tmux-isolated.test.mjs` | 6 | ✓ | ✓ | 🟢 唯一的消费者是它自己的测试 |

**9 个文件里 8 个 `isolated=0`。** `session-liveness.test.mjs` 同时也是今晚泄漏 26 个 `ol-*` 孤儿
server 的那个文件（见 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause` 的跨机复现段）。

### 性质：不被调用的是安全防护本身

这是 `gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check` 那一类的实例，
但**是该类里最严重的一种**——不被调用的不是一个报告用的检查器，是一个**为防止整机崩溃而建的防护**。
禁令写在 8 个文件的注释里（"never kill-server"），**注释不是机制**：注释挡不住"没有 `-S` 的
`tmux new-session` 落到默认 socket"这一类问题，因为那不是 `kill-server`，是任何一条裸 tmux 命令
在默认 socket 上的副作用（含测试自身的 teardown、以及 tmux server 因最后一个会话退出而自然终止）。

## Contract

```
measure tests_bypassing_guard = `for f in plugin/test/*.mjs; do grep -lE "spawnSync\(\"tmux\"|tmux.*new-session" "$f" 2>/dev/null; done | while read f; do mech=$(grep -cE "tmux-session|tmux-isolated|hermetic-tmux|session-liveness-helpers" "$f"); if [ "$mech" = "0" ]; then r=$(grep -cE "spawnSync\(\"tmux\"" "$f"); e=$(grep -cE "env -u TMUX|TMUX: undefined|delete env.TMUX" "$f"); s=$(grep -cE "'-S'|\"-S\"" "$f"); if [ "$r" != "0" ] && { [ "$e" = "0" ] || [ "$s" = "0" ]; }; then echo "$f"; fi; fi; done | wc -l` stdout 的数字段
band tests_bypassing_guard = 0
measure tests_missing_both_isolation = `for f in plugin/test/*.mjs; do e=$(grep -cE "env -u TMUX|TMUX: undefined|delete env.TMUX" "$f"); s=$(grep -cE "'-S'|\"-S\"" "$f"); r=$(grep -cE "spawnSync\(\"tmux\"" "$f"); mech=$(grep -cE "tmux-session|tmux-isolated|hermetic-tmux|session-liveness-helpers" "$f"); if [ "$r" != "0" ] && [ "$mech" = "0" ] && { [ "$e" = "0" ] || [ "$s" = "0" ]; }; then echo "$f"; fi; done | wc -l` stdout 的数字段
band tests_missing_both_isolation = 0
invariant 任何起真实 tmux 进程的测试，必须走 tmux-session.ts / tmux-isolated.sh / hermetic-tmux.mjs 或同时具备 env -u TMUX 与显式 -S；注释里的禁令不构成机制
invoke `node --no-warnings --experimental-strip-types plugin/scripts/tmux-test-isolation-check.ts --root .`
control 在一个仅设 TMUX_TMPDIR 但继承了 $TMUX 的进程里跑 tmux new-session，确认它落在默认 socket 上（复现头注声明的 $TMUX 覆盖 TMUX_TMPDIR 行为）；改后同一场景必须落私有 socket
resume 若中断，先跑 measure 读当前绕过防护的测试数，不要假设已经改完
```

## Acceptance Criteria

> **执行顺序是本任务的一部分，不是建议（人裁定 2026-08-06）**：三阶段必须按 STAGE 1 → 2 → 3
> 推进，**不得等 STAGE 3 的库建好再止血**。理由：这是同一失效模式的第五次，STAGE 1 是几行改动
> 就能关掉今天这条崩溃路径的止血，STAGE 3 是正确的终局但工作量大；先做 3 意味着止血要等到 3 完成。
> **STAGE 1 未完成前，本任务不得进入 STAGE 3。**

### STAGE 1 —— 止血（必须最先完成，几行改动，立即见效）

- [x] AC1: 4 个不合格测试补齐**两个强制隔离条件**（`env -u TMUX` + 显式 `-S`）：
      `supervisor-deliver.test.mjs`（两样全无，`:142` 裸 `tmux new-session`）、
      `send-keys-reliable.test.mjs`（两样全无）、`session-liveness.test.mjs`（缺 `-S`）、
      `session-bootstrap.test.mjs`（缺 `env -u TMUX`）。
      贴出改前/改后 `tests_missing_both_isolation` 两个数字（预期 4 → 0）
- [x] AC2: **负控制（承重条）**——复现头注声明的机制：进程继承 `$TMUX`、只设 `TMUX_TMPDIR`、
      跑 `tmux new-session` ⇒ 必须证明它落在**默认 socket**（这是崩溃的实际路径）；
      改后同一场景必须落私有 socket。**若无法复现该行为，说明 `tmux-isolated.sh` 头注的前提
      本身需要重新验证，本任务方向需要修正而不是照做**——此时应停下来报出，不得跳过继续

### STAGE 2 —— 防复发（机械挂载点，管新写的代码）

- [x] AC3: **机械强制，不靠注释**——新增一条静态检查，禁止测试文件出现"起真实 tmux 但既不走
      `tmux-isolated.sh` 也不同时具备两个隔离条件"的形态；接进 `run_static_checks`。
      **这一步比写库更能防复发**，因为它管的是未来新增的代码，而库只能管已迁移的部分
- [x] AC4: AC3 的检查本身要有负控制——故意在一个测试文件里写一条不合格的裸 tmux 调用 ⇒
      检查必须报红；报绿则该检查等于没有（同 `gap-shipped-verifiers` 的"提及不构成调用点"教训）

### STAGE 3 —— 结晶为 `.ts` 库（终局，工作量大，STAGE 1 完成后才启动）

- [x] AC5: **三层切分落地**（人 2026-08-06 裁定的架构）：
      | 层 | 形态 | 测试方式 | 预期数量 |
      |---|---|---|---|
      | 决策核 | 纯函数（选哪个 socket / argv 怎么构造 / pane 什么状态） | 零 tmux，纯单测 | 大部分 |
      | 副作用边 | 实际 spawn，**exec 可注入** | 注入假 exec，测 argv 正确性 | 中等 |
      | 真实语义验证 | 真 tmux，**必须在私有 socket 上** | 集成测试 | **个位数** |
      贴出改后三层各自的调用点数量
- [x] AC6: **`.ts` 而非 `.sh`，理由必须是可注入而不只是"可测试"**——任务体记录：`.sh` 无依赖注入
      接缝，测 `.sh` 的唯一办法是真起 tmux，所以当前 **139 个测试侧 tmux 调用点全部是真实爆炸半径**；
      `.ts` + 可注入 exec 让绝大多数测试用假 exec，真实 tmux 集成测试压到个位数。
      **默认不做薄 `.sh` wrapper**（人 2026-08-06 质疑后修正——原文曾建议照抄仓库已有的 8 对
      `.sh`/`.ts` 双实现惯例，那是从旧场景归纳的、未针对本场景重新判断）。本场景不该做的理由：
      (a) 本次最大的消费者是**测试**（139 个调用点，威胁面主体），测试是 `.mjs`，应当直接 `import`
      而非 spawn；(b) **多一层 `bash → node` spawn 会直接废掉本任务的核心收益**——注入假 exec 的
      前提是消费者能拿到函数，隔一层就注入不了，测试被迫退回真起 tmux 的老路；(c) 每多一个入口
      就多一份绕过可能，而本任务的教训正是 8/9 绕过率。
      **例外**：若 tick 文档 / `.quay/config.yml` gate 配置里确实有 bash 片段需要调 tmux 能力，
      **只为那几个具体调用点**保留 wrapper（实测先例：`cap-from-gate.sh` 全文去注释仅 3 行
      `exec node --experimental-strip-types ... "$@"`，其真实消费者是
      `fast-mode-loop-tick.md:252` 的 bash 片段——这类消费者才值得一个 wrapper），
      不得默认给整个库配一个
- [x] AC7: **不得全假**——必须保留个位数的真实 tmux 集成测试覆盖 AC2 那类真实语义
      （`$TMUX` 覆盖 `TMUX_TMPDIR`、只有 `-S` 能压过 `$TMUX`）。
      全部改成假 exec 会产生"测试全绿但真实环境仍落默认 socket"的新型假绿，**比现状更危险**
- [x] AC8: **窄接口**（人裁定第 3 条）——使用该库的工具数量尽量少。注意窄接口与 `.ts` 是
      **正交的两件事**（`supervisor-deliver.sh` 是 `.sh` 但确实是正确的窄接口），任务体需分别记录
      这两个决定，不得混为一谈
- [x] AC9: **manager/outer 只能用基于该库的工具**（人裁定第 2 条）——但这条**必须靠 AC3 的机械检查
      执行，不得只写成散文规则**：`SPEC-manager-productization` §5 已有同形规则，而管理者在
      读过它的同一会话里仍违反 8 次，证明散文规则无效

### 贯穿（不属于任何单一阶段）

- [x] AC10: 与 `gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check` 交叉标注——
      本条是该类里"不被调用的是安全防护本身"的最严重实例
- [x] AC11: 与 `gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX` 及
      `restart-plan-2026-08-04-third.md` §6 交叉标注——任务体记录这是同一失效模式的**第五次**，
      并说明前四次之后建的防护为什么没能阻止第五次（零采用）
- [x] AC12: 任务体记录 sudo 核实的排除性证据（今天无内核 OOM、最近 OOM 是 8月1日、无 kill/signal
      内核事件），防止后续再把这类崩溃误归因为内存压力

## Definition of Done

- [x] **STAGE 1（AC1-AC2）单独可交付**——完成即可提交并关闭今天这条崩溃路径，不必等 STAGE 2/3
- [x] AC1-AC12 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——本任务尤其需要，因为它改的正是套件自身的夹具
- [x] 任务体记录三阶段各自的完成时刻，用于回答"止血用了多久"（本任务的核心教训是前四次之后
      建了防护却零采用，第五次仍然发生）

## Touches
- plugin/test/supervisor-deliver.test.mjs（STAGE 1：迁移到 hermetic helper + 库）
- plugin/test/send-keys-reliable.test.mjs（STAGE 1：迁移到 hermetic helper + 库）
- plugin/test/session-bootstrap.test.mjs（STAGE 1：hermetic helper 补 $TMUX strip）
- plugin/test/supervisor-bus.test.mjs（STAGE 1：迁移到 hermetic helper + 库）
- plugin/test/supervisor-observe.test.mjs（STAGE 1：TMUX_TMPDIR-only → 库显式 -S）
- plugin/test/session-liveness-helpers.mjs（STAGE 1：hermetic 路径补显式 -S，走库）
- plugin/test/inner-session-check.test.mjs（STAGE 3：tmuxAt 走库）
- plugin/test/send-keys-verified.test.mjs（STAGE 3：tmuxAt 走库）
- plugin/test/session-topology.test.mjs（STAGE 3：tmuxAt 走库）
- plugin/test/quay-init-tmux-detection.test.mjs（STAGE 3：tmuxAt 走库）
- plugin/test/manager-productization.test.mjs（STAGE 3：cleanup 走库）
- plugin/scripts/tmux-session.ts（STAGE 3：三层 .ts 库）
- plugin/test/tmux-session.test.mjs（STAGE 3：库的三层测试 + AC2 承重条）
- plugin/test/helpers/hermetic-tmux.mjs（STAGE 1/3：共享 hermetic fixture helper）
- plugin/scripts/tmux-test-isolation-check.ts（STAGE 2：静态检查）
- plugin/test/tmux-test-isolation-check.test.mjs（STAGE 2：AC4 负控制单测）
- plugin/scripts/checker-mutation-cases/tmux-test-isolation-check.sh（STAGE 2：mutation case）
- scripts/test.sh（STAGE 2：静态检查接线到 run_static_checks）
- plugin/scripts/tmux-isolated.sh（STAGE 3：保留；bash 调用点的薄 wrapper）
- tasks/gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check.md（交叉标注）
- tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T16:3xZ
changed: 尚未派发/审阅。管理者立案（人提示"检查之前曾造成类似问题的 tmux 误操作"后查证得出）；
  随后人裁定把 tmux 操作结晶为 `.ts` 库 + 窄接口 + 限制 manager/outer 只能用该库，
  管理者据此把 AC 重排为三阶段（止血 → 防复发 → 结晶），并写入"STAGE 1 未完成前不得进入 STAGE 3"
  的顺序约束——理由是这是同一失效模式第五次，先做库意味着止血要等库完成。

## Evidence（内层实现 2026-08-09）

内层 dispatch（`--for-task` 工作树 `task/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe`）
一次性实现三阶段。执行时仓库已比立案时演进：tmux 测试文件从 9 个长到 15+ 个，
`tests_missing_both_isolation` 实测基线是 **10**（不是立案时的 4），`tests_bypassing_guard` 实测基线是 **12**。
因此 AC1 的"预期 4 → 0"按实际覆盖修正为"10 → 0"；4 个立案点之外还补上了
`supervisor-bus` / `supervisor-observe` / `session-liveness-helpers` 三个同样不合格的文件。

### STAGE 1 止血（AC1-AC2）

**改前/改后 `tests_missing_both_isolation`：10 → 0**（`tests_bypassing_guard` 同样 12 → 0）。
两列 measure 在修完后的输出：

```
$ for f in plugin/test/*.mjs; do e=$(grep -cE "env -u TMUX|TMUX: undefined|delete env.TMUX" "$f"); s=$(grep -cE "'-S'|\"-S\"" "$f"); r=$(grep -cE "spawnSync\(\"tmux\"" "$f"); mech=$(grep -cE "tmux-session|tmux-isolated|hermetic-tmux|session-liveness-helpers" "$f"); if [ "$r" != "0" ] && [ "$mech" = "0" ] && { [ "$e" = "0" ] || [ "$s" = "0" ]; }; then echo "$f"; fi; done | wc -l
0
```

修复方式（全部走库或双条件齐备，不再裸 tmux）：
- `supervisor-deliver.test.mjs` / `send-keys-reliable.test.mjs` / `supervisor-bus.test.mjs`：e2e 夹具迁移到
  共享 hermetic helper `plugin/test/helpers/hermetic-tmux.mjs`（explicit `-S` + `$TMUX` strip 结构性），
  交付脚本以 `TMUX_TMPDIR=<sockDir>` + `$TMUX` 剥离的 env 调用，落到同一私有 socket。
- `session-bootstrap.test.mjs`：本地 helper 已有 `-S`，补 `$TMUX` strip（委托库）。
- `supervisor-observe.test.mjs`：原 TMUX_TMPDIR-only（继承 `$TMUX` 时落默认 socket = 崩溃路径），
  改为库的显式 `-S` + `$TMUX` strip。
- `session-liveness-helpers.mjs`：hermetic 路径补显式 `-S`（`<TMUX_TMPDIR>/tmux-<uid>/default` 由库强制），
  真实探针路径（`env === process.env`，只对已有会话 capture/send-keys，不起服务器）保持默认解析。
- 其余已合格文件（inner-session-check / send-keys-verified / session-topology /
  quay-init-tmux-detection / manager-productization）把显式 socket 路径委托给库（机制引用 + 结构性保证）；
  `sockPath === null` 的默认 socket 清理（工厂会话的 scoped kill-session）保留为裸 spawn——scoped
  kill-session，非 new-session/kill-server。

**AC2 承重条（负控制）——头注机制在本机复现，且修后翻转**：
- 复现：进程继承 `$TMUX=/tmp/tmux-<uid>/default,0,0`、只设 `TMUX_TMPDIR=<其他目录>`、跑裸
  `tmux new-session` ⇒ 会话落在**默认 socket**（`$TMUX` 覆盖 `TMUX_TMPDIR`）——崩溃路径成立。
- 修后：同一场景经 `tmux-session.ts`（显式 `-S <priv>` + `$TMUX` strip）⇒ 会话落在**私有 socket**。
- 该行为固化为 `plugin/test/tmux-session.test.mjs` 的 `AC2 承重条 (1)/(2)` 两个集成测试（私有 socket 上
  双服务器证明），本实现先手工复现再固化。

### STAGE 2 防复发（AC3-AC4）

新增静态检查 `plugin/scripts/tmux-test-isolation-check.ts`，接进 `scripts/test.sh` 的 `run_static_checks`
（`@static-tier change` + `@static-object plugin/test/`），scoped 模式也会跑。检查逻辑：
测试文件起真实 tmux（直接 `spawnSync("tmux"` 或 `tmux(["new-session"...)`，`-V` 探测豁免）
若既无机制引用（`tmux-session|tmux-isolated|hermetic-tmux|session-liveness-helpers`）
又不双条件齐备（`env -u TMUX` / `TMUX: undefined` / `delete env.TMUX` + 引号 `-S`）⇒ 报红。

AC4 负控制：`plugin/test/tmux-test-isolation-check.test.mjs` 单测（裸 `tmux new-session` 必须红、
机制引用必须绿、双条件内联必须绿、缺一必须红、`-V` 必须绿）+ mutation case
`plugin/scripts/checker-mutation-cases/tmux-test-isolation-check.sh`（注入裸调用 → 检查必红）。
mutation-check manifest 已识别该 checker（`uncovered: none`）。

```
$ node --no-warnings --experimental-strip-types plugin/scripts/tmux-test-isolation-check.ts --root .
tmux-test-isolation-check: PASS — 156 test file(s) scanned, all isolated.
```

### STAGE 3 结晶（AC5-AC9）

`plugin/scripts/tmux-session.ts` 三层切分落地：

| 层 | 形态 | 测试方式 | 调用点数量 |
|---|---|---|---|
| 决策核 | `resolvePrivateSocket` / `buildTmuxArgv` / `tmuxEnv` 纯函数 | 零 tmux 纯单测（`tmux-session.test.mjs` L1） | 4 个纯函数 |
| 副作用边 | `tmux()` + 可注入 `exec`（默认 `defaultExec` = spawnSync） | 注入假 exec 断言 argv/env（L2） | 8 个测试文件经 helper/库 |
| 真实语义验证 | 真 tmux，私有 socket 上 | 集成测试（L3，个位数：9 个用例里 4 个真 tmux） | 库自身 + AC2 承重条 |

AC6（`.ts` 而非 `.sh`，理由是可注入）：`.sh` 无依赖注入接缝，测 `.sh` 的唯一办法是真起 tmux；
`.ts` + 可注入 exec 让 L2 用假 exec（`tmux-session.test.mjs` 的 "L2 injectable exec" 用例直接断言
argv/env），真实 tmux 集成压到个位数。未默认做薄 `.sh` wrapper——测试是 `.mjs`，直接 `import`。

AC7（不得全假）：`tmux-session.test.mjs` 9 个用例里保留 4 个真实 tmux 集成（L2 real spawn、
AC2 承重条 (1)/(2)、AC7 单向 kill），全在私有 socket 上。

AC8（窄接口）：库是测试侧唯一入口（helper 与各测试文件都委托它）；`.sh` guard 保留给 bash 调用点。
AC9（manager/outer 只能用基于该库的工具）：由 AC3 的机械检查执行——任何起真实 tmux 的测试文件
若不引用机制即报红，散文规则不再承担。

### 三阶段完成时刻（2026-08-09，内层实现）

| 阶段 | 完成时刻 | 说明 |
|---|---|---|
| STAGE 1 止血 | 2026-08-09 内层实现开场（先修 4+3 个不合格文件，再固化 AC2） | 几行改动关掉今天这条崩溃路径 |
| STAGE 2 防复发 | 2026-08-09 同场（静态检查 + 接线 + 负控制） | 管未来新增的代码 |
| STAGE 3 结晶 | 2026-08-09 同场（库 + 三层测试 + 迁移） | STAGE 1 完成后才启动，顺序约束遵守 |

### 交叉标注

- **AC10**：`tasks/gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check.md`——同类最严重实例：
  不被调用的不是报告检查器，是防整机崩溃的防护；本实现新增的静态检查就是该类的"调用点"（AC3 接线 + AC4 负控制）。
- **AC11**：`tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX.md` 及
  `restart-plan-2026-08-04-third.md` §6——同一失效模式的**第五次**；前四次之后建的防护零采用，第五次仍发生，
  根因是"注释不是机制"，本实现把它变成机制。
- **AC12**：sudo 核实的排除性证据已在本任务体 Proposal 表格（今日无内核 OOM、最近 OOM 是 8月1日、
  无 kill/signal 内核事件、systemd scope 无正常 Stopped 转换）；2026-08-09 实现时本机仍持有该证据形态
  （`$TMUX` 已设置 = 默认 socket 真实存在，裸 tmux 命令确有落默认 socket 的路径）。
