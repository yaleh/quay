---
id: gap-leak-residue-per-run-namespace-isolation
title: tmux 残留无 per-run namespace——跨运行归属混 + 遗留累积（人 2026-08-13 方向；runner 级统一清理的前提）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：人 2026-08-13 问句（方向非裁定）——「套件自身产生 tmux server 残留，回收与扫描之间有竞态——
能否为每次运行指定独立的路径/namespace 以避免冲突和便于统一清理？」manager 读实现后给 can/can't 分界。

**现成接口（读实现，manager 2026-08-13）**：
```
plugin/test/session-liveness-helpers.mjs
  :12-18  SPLIT CONCURRENCY SAFETY —— 拆分文件并发跑，一个文件的 after() 不得删兄弟文件在用的探针目录
  :43-45  let probeTmpPrefix = "session-liveness-"; setProbeTmpPrefix(p)  ⇒ 隔离已做到【文件】粒度
  :29-34  路径已走 TMUX_TMPDIR + 显式 -S
  :64-79  dirHasLiveOwner()：读 /proc/net/unix 判「有无活属主」
```
⇒ **缺的正是「每次运行」这一层**：把前缀的根从 `/tmp/` 换成 `/tmp/quay-run-<runId>/`（runId 短 id，
runner 经 env 下发，**worktree 跑也必须传**，否则归属仍混）。

**能修 vs 不能修（manager 分界）**：
- **能修**：跨运行**归属**（leak-scan 只扫自己子树 ⇒ 并发不可见）＋**统一清理**（一次运行一个目录；
  再加「属主已死 + 超龄」清扫器，防 2026-08-12 23:54 量到的 9 个孤儿 server 与 4375 个 /tmp 遗留目录）。
- **不能修**：**同一次运行内部的回收竞态**——窗口采样（round 97 峰值 5、98 峰值 6）inner 全程空闲，
  残留是套件自己的，换 namespace 后仍是自己的，扫描跑在回收前照样红。**归 gap-leak-scan-reap-race-false-red**
  （done：bounded reap-wait 已实现）。

**⭐ 依赖关系（manager 2026-08-13）**：人第二条方向「runner 最外层统一清理」的**前提**是本条——
按名字/前缀扫 = session-liveness-helpers.mjs:47-63 禁止的形状（2026-08-08 按进程名批量杀致两层监视器
同时失明的事故，invariant no_pkill_by_name_on_live=1）。有了 `/tmp/quay-run-<runId>/`，「本轮创建的东西」
= 一棵子树，清理判据变成**按路径归属 + 属主存活**（`dirHasLiveOwner()` 已实现），非按名字。
⇒ **namespace 是 runner 级清理的前提，不是并列项。**

**两个落地约束（manager）**：
- **次序**：清理必须跑在 leak-scan **之前**，否则扫描照样和回收赛跑；扫描随后只扫本轮命名空间。
- **⚠️ 别把信号清掉**：若清理无条件生效，「测试会泄漏」再也不红 ⇒ **必须把「本轮清理掉了几个/哪些」记进
  轮记录**，让泄漏从「闸门信号」降级为「可观测指标」，不是消失（否则用「假红消失」换「真信号消失」，
  与 failures[] 同族）。
- `sun_path` ~107 字节上限，**runId 别用完整 UUID**（现路径 ≈52 字符，加一层短 id 宽裕）。
- 必须覆盖**全部生产者**（worktree 跑同样拿到 env）。

**现成可复用**：`provision-verify-worktree.sh --teardown` 头注释已写明「teardown 必须完整——删目录 +
回收进程」（来自 gap-suite-leaks-live-claude-sessions 的 4 个孤儿 109-120h 泄漏）⇒ 模式与教训已在，别重造。

## Plan

1. 前缀根 `/tmp/` → `/tmp/quay-run-<runId>/`（runId 短 id，runner 经 env 下发，worktree 跑同传）。
2. runner 级统一清理：按路径归属 + 属主存活（dirHasLiveOwner），跑在 leak-scan 前；不按名字杀。
3. 清理计数进轮记录（本轮清掉几个/哪些）——泄漏降级为可观测指标不消失。
4. leak-scan 只扫自己的 runId 子树。
5. 负控：跨运行残留互不可见；孤儿累积不增长。

## AC

- [ ] AC1: 每次运行独立 `/tmp/quay-run-<runId>/` 前缀（worktree 跑也拿到 env）
- [ ] AC2: 统一清理按路径归属+属主存活（不按名字），跑在 leak-scan 前
- [ ] AC3: 清理计数进轮记录（泄漏降级为指标不消失）
- [ ] AC4: 负控——跨运行残留互不可见 / 孤儿不累积
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 负控样例贴出（见 Evidence：跨运行残留互不可见 / 清理计数在轮记录）
- [ ] 全量套件绿

## Touches

- plugin/test/session-liveness-helpers.mjs（setProbeTmpPrefix 根改造 / runId env）
- plugin/scripts/full-suite-runner.ts（runId env 下发 / 统一清理调用 / 清理计数写轮记录）
- plugin/scripts/tmux-leak-scan.sh（扫描只扫本轮子树）
- tasks/gap-leak-residue-per-run-namespace-isolation.md（自身）
