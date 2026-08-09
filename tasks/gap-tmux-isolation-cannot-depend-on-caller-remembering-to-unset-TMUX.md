---
id: gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX
title: the L0 defense (env -u TMUX) is launch-side and can't be remembered by
  every caller — make tmux isolation structural so a forgetful sub-agent shell
  cannot touch the default server
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层裁定 G（L0，A–F 之外的第七条；`orchestration/outer-rulings-2026-08-04-A-F.md` 裁定 E 的兜底）。
人 2026-08-04 指示：`env -u TMUX` **不是既成事实**，由外层走正常流程（判据 + 测试 + 负控制）落地。

### 证据（已实测钉死，简报 §1）

```
$TMUX  压过 TMUX_TMPDIR    —— 仅设 TMUX_TMPDIR 不隔离继承了 $TMUX 的进程
-S/-L  压过 $TMUX          —— 显式 -S/-L 永远隔离
```

两台机器（vhs / transformer）的整机崩溃都来自子代理临时写的 shell 裸调 `tmux kill-server`，
误杀真实默认服务端。已提交代码里 5 处隔离助手**全部**正确 `delete env.TMUX`、显式 `-S`/`-L`
用法 **0 处** ⇒ **任何仓库级 lint 一条也抓不到**（缺陷只在临时命令里）。裁定 E 的纯函数分类器
消掉了**测试**里的危险面（`tmux_in_tests = 0`）；L0 兜住的是**临时探索**那条路径——不在仓库里，
lint 永远看不见。

### 选定机制

**把隔离变成调用形态，而不是调用方的记忆。** 落地一个仓库内助手 `plugin/scripts/tmux-isolated.sh`：

```
env -u TMUX tmux -S "<tmpdir>/tmux-$(id -u).sock" "$@"
```

- 显式 `-S`（压过 `$TMUX`）+ `env -u TMUX`（压过 `TMUX_TMPDIR` 混淆），两条都做，缺一不可；
- socket 建在 `TMPDIR`/`${XDG_RUNTIME_DIR:-/tmp}` 下的私有路径——**任何 `kill-server` 只能杀掉这个
  隔离 socket**，默认服务端（真实 quay 会话）不受影响；
- 仓库里触碰 tmux 的脚本（`session-liveness.sh`、驱动助手等）改经此助手，或在头部明示等价形态。

**边界（明确不 scope 的）**：不拦截、不 lint 子代理的临时 shell（那不可见也不可挡）；不做
PreToolUse hook（人已否决，裁定 E）。本任务只让「repo 与测试里出现的 tmux 调用」结构上不可能
打到默认服务端，并给临时探索路径一个安全模板。

## Acceptance Criteria

- [x] AC1: `plugin/scripts/tmux-isolated.sh` 存在且可执行：`env -u TMUX tmux -S "<私有 socket>" "$@"`，
      socket 路径含 uid 且落在 `TMPDIR`/`${XDG_RUNTIME_DIR:-/tmp}` 下；缺 `-S` 或 `$TMUX` 未被 unset 时
      fail-closed（报错退出非 0，不静默回退默认服务端）
- [x] AC2: **负控制（单向杀伤）**——`tmux-isolated.sh kill-server` 后，**默认服务端必须完好**
      （实跑 `tmux ls` 退出 0）；再证 `tmux-isolated.sh ls` 报「无服务器」（该 socket 已死）。
      两个方向的实跑输出逐字贴任务体
- [x] AC3: 仓库内触碰 tmux 的**既有**脚本迁移或明示（grep 出全部 `tmux ` 调用点，逐个改为经助手
      或补 `env -u TMUX`+显式 `-S`；`session-liveness.sh` 是 A/D 任务的既有触摸面，若撞车按
      顺序 rebase 不并行）
- [x] AC4: `session-launch-recipes.md` / 交接文档补一条：L0 落地前会话启动**不带** `env -u TMUX`
      （AC4 已定）；L0 落地后启动命令可加，但隔离不再依赖它——助手的显式 `-S` 是主防线
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`；测试**自己**不裸调 `tmux kill-server`
      （用隔离 socket 验证，测试目录 `tmux` 出现次数为 0 或仅经助手）

## Definition of Done

- [x] AC1–AC5 全部勾上；AC2 两个方向的实跑输出逐字贴进本任务体
- [x] 一次真实演示：经助手建的隔离会话被杀，外层真实 quay 会话（`tmux ls`）完好
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——fan-in 后实测：tests 2276 / fail 0 / cancelled 0 / skipped 25

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`scripts/test.sh plugin/test/tmux-isolated.test.mjs`（worktree 内以 QUAY_TEST_SKIP_STATIC_CHECKS=1 跑；fan-in 后全量绿见 DoD）→ ℹ tests 5 / pass 5 / fail 0 / cancelled 0 / skipped 0。

### AC2 实跑输出（2026-08-04，逐字）

```
--- 1. BEFORE: default server alive? (env -u TMUX tmux ls) ---
quay-0: 4 windows (created Tue Aug  4 11:02:44 2026) (group quay) (attached)
default-tmux-ls exit=0
--- 2. create a session on the ISOLATED socket via the helper ---
isolated new-session exit=0
iso-proof: 1 windows (created Tue Aug  4 15:06:20 2026)
isolated ls exit=0
--- 3. THE KILL: tmux-isolated.sh kill-server (isolated socket only) ---
isolated kill-server exit=0
--- 4. AFTER: helper socket reports no server ---
no server running on /run/user/1000/tmux-1000.sock
isolated ls-after exit=1
--- 5. AC2 DIRECTION 1: DEFAULT server must be INTACT (tmux ls exit 0) ---
quay-0: 4 windows (created Tue Aug  4 11:02:44 2026) (group quay) (attached)
default-tmux-ls exit=0
```

## Touches

- plugin/scripts/tmux-isolated.sh (new)
- plugin/test/tmux-isolated.test.mjs (new)
- plugin/scripts/session-liveness.sh
- orchestration/session-launch-recipes.md

（顺序注记：`session-liveness.sh` 的迁移若与 A/D/B 的在飞改动撞车，按顺序 rebase 不并行——
本任务与 A/D/B 的 `checkTouchesPair` 实测全部 `disjoint:true`，理论无撞，仅作兜底。）

## Contract

measure   default_server_alive = `tmux ls` stdout 的行数字段
band      default_server_alive = ≥1（负控制后默认服务端仍在）
invariant helper_uses_explicit_S = 1（tmux-isolated.sh 必含 `-S`，不含则 fail-closed 自检）
invoke    `scripts/test.sh plugin/test/tmux-isolated.test.mjs`
control   `tmux-isolated.sh kill-server` ⇒ default_server_alive 不降（AC2 负控制）
resume    助手与迁移分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T14:4xZ
changed: 外层裁定 G（L0）立案。相对简报 §2 的收紧：
(1) **不是把 `env -u TMUX` 塞回启动命令**——那已被 restart-plan AC4 明确排除，且是本次重启犯过的错；
(2) **隔离由「调用形态」承载**——显式 `-S` + `env -u TMUX` 的助手，压过调用方是否记得；
(3) **AC2 是「单向杀伤」负控制**——证明助手最危险的用法（kill-server）只杀隔离 socket、默认服务端
必须存活，这是 L0 存在的全部理由；
(4) **不 scope 拦子代理临时 shell、不做 hook**——人已否决 hook（裁定 E），临时命令 lint 不可见，
本任务只在可见面（repo 脚本 + 测试 + 启动配方）让危险调用结构性不可能。
status: todo→**ready**（2026-08-04T14:5xZ 外层裁定 R3/L0 优先级：两次事故来源都是临时探索路径，
L0 结构性关闭它 ⇒ 升入 A/D 并发批次，不再排在 A/D/B 之后）。touches 的 `session-liveness.sh` 行
格式修正（备注移出路径，resolve 不再 MISSING）。与 A/D/B 的 `checkTouchesPair` 实测全部
`disjoint:true`。

> 交叉标注（2026-08-09，`gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe` AC11）：
> 本任务（L0 防护 `tmux-isolated.sh`）是**同一失效模式的第四、第五次之间建的防护**——但防护零采用，
> 第五次（2026-08-06 16:00:05，sudo 排除内核 OOM）仍发生：8/9 tmux 测试文件绕过它，
> 4/8 缺隔离条件（如 `session-liveness` 缺 `-S`、`session-bootstrap` 缺 `env -u TMUX`）。
> 根因是「注释里的禁令不是机制」。该任务把 L0 结晶为 `.ts` 库 `tmux-session.ts`（决策核 / 可注入 exec /
> 真实语义验证三层），并新增静态检查 `tmux-test-isolation-check.ts` 机械强制「起真实 tmux 必须走机制或
> 双条件齐备」——防护从「存在」变成「被调用」。
