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

- [x] AC1: 每次运行独立 `/tmp/quay-run-<runId>/` 前缀（worktree 跑也拿到 env）
- [x] AC2: 统一清理按路径归属+属主存活（不按名字），跑在 leak-scan 前
- [x] AC3: 清理计数进轮记录（泄漏降级为指标不消失）
- [x] AC4: 负控——跨运行残留互不可见 / 孤儿不累积
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 负控样例贴出（见 Evidence：跨运行残留互不可见 / 清理计数在轮记录）
- [ ] 全量套件绿

## Touches

- plugin/test/session-liveness-helpers.mjs（setProbeTmpPrefix 根改造 / runId env）
- plugin/scripts/full-suite-runner.ts（runId env 下发 / 统一清理调用 / 清理计数写轮记录）
- plugin/scripts/tmux-leak-scan.sh（扫描只扫本轮子树）
- tasks/gap-leak-residue-per-run-namespace-isolation.md（自身）

## Evidence

**实现（2026-08-13，task agent）**：

- **per-run namespace（AC1）**：`session-liveness-helpers.mjs` 新增 `runIdOf()` / `runNamespaceRoot(id)` /
  `probeRoot()`。`QUAY_RUN_ID` 由 runner 下发时，探针根从 `os.tmpdir()` 改为
  `/tmp/quay-run-<shortRunId>/`（`sweepTmp` 与四个探针构造器 `makeHermeticProbe`/`makePlainPane`/
  `makeClaudePaneProcess`/`makeTwoWindowSession` 全部改走 `probeRoot()`）。runner（`full-suite-runner.ts`）
  从 state-file UUID 派生 **8 hex 短 id**（`runId.replace(/-/g,"").slice(0,8)`），经 `QUAY_RUN_ID` env 下发
  给 child（systemd 与非 systemd 两条 spawn 路径都传），故 worktree 全量跑（同一 env 流）同样拿到。
  `QUAY_RUN_ID` 未设（scoped/direct 跑）时回退到 `os.tmpdir()` 旧布局——既有测试 byte-for-behavior 不变。
  sun_path 约束：短 id 下探针 socket 路径 ≈70 字符，远低于 ~107 字节上限。
- **统一清理（AC2）**：runner 在套件启动**前**调 `sweepRunNamespaces()`（扫全部 `/tmp/quay-run-*`，
  删**属主已死**者——路径归属 + `dirHasLiveOwner()` 属主存活判据，绝无按名批量杀，invariant
  no_pkill_by_name_on_live=1）；这先于 suite-tail leak-scan，满足「清理跑在 leak-scan 前」次序约束。
  套件结束后再 `sweepRunNamespace(ownId)` 清本 run 子树（孤儿不累积）。
- **清理计数进轮记录（AC3）**：`verification-round.jsonl` 新增 `tmux_cleaned`（本轮清理掉的 owner-dead
  残留目录数）+ `tmux_cleaned_dirs`（前 50 个路径）。有残留才写（绿轮可无）；live-owner 真泄漏仍红
  （gate 完整），owner-dead 残留被清理并计数（泄漏降级为可观测指标，不消失）。
- **leak-scan 只扫本轮子树（AC4）**：`tmux-leak-scan.sh` 在 `QUAY_RUN_ID` 设置时只扫
  `/tmp/quay-run-<runId>/*`（dir）+ `pgrep -a tmux | grep -F <run_root>`（proc），跨运行残留互不可见；
  未设时保留历史 `/tmp/skv-* session-liveness-* ...` 前缀语义。reap-wait 机制原样保留。

**Scoped 验证（`scripts/test.sh --for-task gap-leak-residue-per-run-namespace-isolation`，worktree 根）**：
```
ℹ tests 116
ℹ pass 116
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 82909
```
（select-tests-for-touches 解析 Touches → `full-suite-runner.test.mjs` + `tmux-leak-scan.test.mjs`，2/4 Touches 解析为测试，另 2 项为 helpers/自身无直接测试文件。）

**补充验证（helper 改造不破坏既有测试）**：
- `session-liveness-sweep.test.mjs`：5/5 pass（sweepTmp/dirHasLiveOwner owner-liveness 语义保持）
- `session-liveness-events.test.mjs` + `heartbeat`：32 pass / 1 skip（skip 为 real-probe 可用性） / 0 fail

**负控样例（AC4 / DoD 第二项）**：
1. **跨运行残留互不可见**：`/tmp/quay-run-other999/session-liveness-leftover` 存在时，`QUAY_RUN_ID=test4321`
   leak-scan `--check` 输出 `clean — no NEW residual`（exit 0）；而 `QUAY_RUN_ID=test1234` 同子树内残留则
   `FAIL — NEW residual ... STILL PRESENT`（exit 1）——归属隔离成立。
2. **清理计数在轮记录**：预置 `/tmp/quay-run-stale1234/subdir` 后跑 runner（fake green suite），round record
   携带 `tmux_cleaned: 1` / `tmux_cleaned_dirs: ["/tmp/quay-run-stale1234"]`；runner stderr 打印
   `pre-suite cleanup removed 1 stale /tmp/quay-run-* namespace(s)`。
3. **孤儿不累积**：跑完 scoped + runner 测试后 `ls -d /tmp/quay-run-* | wc -l` = 0（post-suite 自清生效）。
