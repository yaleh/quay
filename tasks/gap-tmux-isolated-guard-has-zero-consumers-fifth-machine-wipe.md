---
id: gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe
title: "the L0 anti-machine-wipe guard (tmux-isolated.sh) has ZERO consumers outside its own test —
  8 of 9 tmux-using test files bypass it and hand-roll isolation, and 4 of those 8 are missing the
  isolation mechanisms the guard's own header declares MANDATORY ('BOTH are required (AC1)':
  env -u TMUX because $TMUX overrides TMUX_TMPDIR, AND an explicit -S because only -S overrides
  $TMUX); measured: supervisor-deliver.test.mjs has neither (bare `tmux new-session` at :142 lands
  on the DEFAULT socket that hosts the live quay-0 sessions), send-keys-reliable.test.mjs has
  neither, session-liveness.test.mjs has env-u-TMUX but NO -S, session-bootstrap.test.mjs has -S
  but no env -u TMUX; on 2026-08-06 ~16:00:05 the machine's entire tmux server died taking
  quay-0's outer+inner with it, DURING a full-suite run (15:53 red, 2854 tests) that executes all
  of these files, and sudo dmesg confirms NO kernel OOM today (last OOM was Aug 1) so this was a
  userspace tmux kill, not memory pressure — this is the FIFTH instance of a failure mode already
  documented four times (gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX,
  restart-plan-2026-08-04-third §6) for which the guard was purpose-built and then never adopted;
  manager 2026-08-06 with sudo-verified kernel evidence"
status: todo
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
measure tests_bypassing_guard = `for f in plugin/test/*.mjs; do grep -lE "spawnSync\(\"tmux\"|tmux.*new-session" "$f" 2>/dev/null; done | xargs grep -L "tmux-isolated" 2>/dev/null | wc -l` stdout 的数字段
band tests_bypassing_guard = 0
measure tests_missing_both_isolation = `for f in plugin/test/*.mjs; do e=$(grep -c "env -u TMUX\|TMUX: undefined" "$f"); s=$(grep -cE "'-S'|\"-S\"" "$f"); r=$(grep -cE "spawnSync\(\"tmux\"" "$f"); if [ "$r" != "0" ] && { [ "$e" = "0" ] || [ "$s" = "0" ]; }; then echo "$f"; fi; done | wc -l` stdout 的数字段
band tests_missing_both_isolation = 0
invariant 任何起真实 tmux 进程的测试，必须走 tmux-isolated.sh 或同时具备 env -u TMUX 与显式 -S；注释里的禁令不构成机制
invoke `bash plugin/scripts/tmux-isolated.sh -V`
control 在一个仅设 TMUX_TMPDIR 但继承了 $TMUX 的进程里跑 tmux new-session，确认它落在默认 socket 上（复现头注声明的 $TMUX 覆盖 TMUX_TMPDIR 行为）；改后同一场景必须落私有 socket
resume 若中断，先跑 measure 读当前绕过防护的测试数，不要假设已经改完
```

## Acceptance Criteria

- [ ] AC1: 全部起真实 tmux 的测试文件改为走 `tmux-isolated.sh`（或经论证保留手写，但必须同时具备
      `env -u TMUX` + 显式 `-S`），贴出改前/改后 `tests_bypassing_guard` 与
      `tests_missing_both_isolation` 两个数字
- [ ] AC2: **负控制（承重条）**——复现头注声明的机制：进程继承 `$TMUX`、只设 `TMUX_TMPDIR`、
      跑 `tmux new-session` ⇒ 必须证明它落在**默认 socket**（这是崩溃的实际路径）；
      改后同一场景必须落私有 socket。若无法复现该行为，说明头注的前提本身需要重新验证，
      任务方向需要修正而不是照做
- [ ] AC3: **机械强制，不靠注释**——新增一条静态检查，禁止测试文件出现"起真实 tmux 但既不走
      tmux-isolated.sh 也不同时具备两个隔离条件"的形态；接进 `run_static_checks`
- [ ] AC4: 与 `gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check` 交叉标注——
      本条是该类里"不被调用的是安全防护本身"的最严重实例
- [ ] AC5: 与 `gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX` 及
      `restart-plan-2026-08-04-third.md` §6 交叉标注——任务体记录这是同一失效模式的**第五次**，
      并说明前四次之后建的防护为什么没能阻止第五次（零采用）
- [ ] AC6: 任务体记录 sudo 核实的排除性证据（今天无内核 OOM、最近 OOM 是 8月1日、无 kill/signal
      内核事件），防止后续再把这类崩溃误归因为内存压力

## Definition of Done

- [ ] AC1-AC6 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——本任务尤其需要，因为它改的正是套件自身的夹具

## Touches
- plugin/test/supervisor-deliver.test.mjs
- plugin/test/send-keys-reliable.test.mjs
- plugin/test/session-liveness.test.mjs
- plugin/test/session-bootstrap.test.mjs
- plugin/scripts/tmux-isolated.sh
- scripts/test.sh
- tasks/gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check.md（交叉标注）
- tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T16:2xZ
changed: 尚未派发/审阅（管理者立案，人提示"检查之前曾造成类似问题的 tmux 误操作"后查证得出）
