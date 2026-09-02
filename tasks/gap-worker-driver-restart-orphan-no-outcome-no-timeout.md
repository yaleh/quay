---
id: gap-worker-driver-restart-orphan-no-outcome-no-timeout
title: driver 重启孤儿化在飞 worker——零终态记录 + 零超时监管（区别于 cold-start-inflight 排除集正确性与
  no-record-on-abnormal-death 的活体观测）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

实测复盘（`gap-retire-inner-session-check-script`，2026-09-01）：该任务 14:01:43 起 ready、cap=5、全程在飞从未超过 3，却拖到 15:54:42 才真正开始有产出的 dispatch，中间 58 分钟（14:56:29→15:54:42）是一次**已派发但零终态记录**的孤儿在飞。

根因链（`worker-driver-supervisor.log` + `worker-round.jsonl` + `worker-outcome.jsonl` 直接量重建，非猜测）：
1. 14:56:29，driver（pid 1088471）把该任务 push 进内存 `running` 数组，spawn 一个 worker 子进程。
2. 15:12:37Z，driver 进程本身被终止重启（supervisor 日志：`driver exited code=null` / `stop sentinel present; exiting` 紧接 `started driver pid=3834862`）——按 `worker-driver.ts` 现有设计，driver 重启不碰在飞 worker 子进程，该 worker 存活但成为孤儿。
3. 旧 driver 内存里的 `running` 数组（含这次 dispatch 的 selector 理由、runId，以及 `runOneWorker` 为它设的 `timeoutMs` 计时器）随进程消亡整体丢失——`worker-outcome.jsonl` 里【从未出现过】14:56:29 这次 dispatch 的任何终态记录（非 completed、非 exited-not-landed、非 failed，是零记录）。
4. 新 driver 靠 `enumerateColdStartInflight`（worktree 存在 ∧ `/proc` 存活 `quay-task-worker` cmdline 命中该 task id）正确地把它继续排除在可派池外——这一半已经是对的（`gap-worker-driver-cold-start-inflight-blind`/`-refresh` 修的正是这个排除集本身的正确性），避免了双重派发，本任务不重修这一半。
5. 但排除期间【没有任何持久化记录】说明"这个 task 为什么在飞、是哪次 dispatch、已经跑了多久、原定超时预算是多少"——直到孤儿进程自己在某个时刻退出（或其 cmdline 不再匹配），`hasLiveWorkerForTask` 才转 false，排除自动解除，新一轮才会重新派发。**这中间的全部时长（本例 58 分钟）对任何观测者都是黑箱**，且没有任何超时/看门狗在监管这段孤儿存活期——如果这次孤儿是真的挂死（非本例的"仍在正常工作"），它会无限期占着这个 task 的槽位，直到人工发现。

**与两个已完成任务的区别（避免混修）**：
- `gap-worker-driver-cold-start-inflight-blind`/`-refresh` 修的是【排除集本身对不对】（worktree+活进程双条件、每轮重扫）——已经是对的。
- `gap-worker-driver-no-record-on-abnormal-death` 修的是【同一个存活 driver 亲眼观察到自己的 worker 异常退出】时补终态记录——这次的场景是**driver 自己先死**，连"观察"这个动作的主体都不在了，那条修复的 `computeOutcome` 调用点根本不会被触发。

**方向（对话中已确认）**：孤儿 worker 应被【纳入下一个 driver 实例的管理】，而不是杀掉重派——本仓库已有明确设计原则（"driver 生命周期操作从不碰 worker kind 的在飞子进程"），杀掉正在做事的孤儿有实质代价（可能杀在 git 操作/fan-in 锁持有中途，弄坏 worktree/分支状态；或者白白扔掉已经完成的部分工作）。要补的是"纳入管理"目前完全空缺的两块：
① 孤儿存活期间，把它的 dispatch 元数据（selector 理由、runId、原始派发时刻、原始超时截止时刻）持久化到磁盘，供下一个 driver 实例读取——而不是只在内存 `running` 里，一死全丢。
② 下一个 driver 实例的每轮 reconcile，对每个 cold-start-inflight 的 task 读这份持久化记录并做判断而非只排除：pid 仍存活且 cmdline 指纹吻合 ⇒ 重新纳入管理（轮询等待其退出，退出后照常算终态，**沿用原始超时截止时刻，不重置**——防止靠"每次 driver 重启续命"无限期占位）；pid 已不存在（已经退出但没人观察到）⇒ 立刻现场补写一条非 completed 的终态记录，并复用 `gap-worker-driver-no-record-on-abnormal-death` 已经落地的异常终态归宿（orphan worktree 清理 + 重试上限计数），标注一个可区分的原因字符串（如"driver 重启期间孤儿化，下一轮 reconcile 发现已退出"），使它与"driver 亲眼看见的死亡"在载体上可区分（硬规则 3b）。

## Plan

1. 扩展 `appendWorkerPid`（`worker-driver.ts:1539`）已有的原子写（tmp+rename）模式为一份按 taskId 索引的结构化持久记录：`{taskId, runId, workerPid, selectorReason, startedAtMs, timeoutDeadlineMs, cmdlineFingerprint}`，在 `spawnSelected` 里 spawn 后立即写、在该 worker 的终态被正常计算（`computeOutcome` 返回）时清除对应条目——正常路径（driver 全程存活）行为不变，只多一份持久化影子。
2. 常驻循环每轮 reconcile 步骤（`step = "reconcile"` 附近）新增：对 `enumerateColdStartInflightAsync` 返回集合里的每个 task，读第 1 步的持久记录：
   - 记录缺失（driver 从未见过这次 dispatch，例如手工起的 worker）⇒ 跳过，维持现状（不越权接管非本机制派发的进程）。
   - 记录存在且 pid 存活（用记录里的 `cmdlineFingerprint` 复核，不裸信 pid 数字，避免 pid 复用误判——同 `hasLiveWorkerForTask` 已用的词边界 cmdline 匹配手法）⇒ 纳入 `running`，用轮询该 pid 存活性代替 `child_process` 的 `close` 事件，退出后照常调用 `computeOutcome` 走正常归宿；沿用记录里的 `timeoutDeadlineMs`（不重置），到期一样 `SIGTERM`。
   - 记录存在但 pid 已不存活（孤儿已经在无人观察时退出）⇒ 立刻调用 `gap-worker-driver-no-record-on-abnormal-death` 落地的异常终态归宿函数，原因标注为可区分的孤儿字符串，随后清掉该持久记录。
3. `worker-driver.test.mjs` 覆盖：①持久记录写入/清除的原子性与内容；②reconcile 对"pid 存活+fingerprint 吻合"的 adopt 路径（轮询到退出后终态落盘且超时截止时刻未被重置）；③"pid 不存活"的立即终态兜底路径（终态非 completed 且 orphan worktree 按既有归宿被清理）；④"记录缺失"的不越权跳过路径。

## Acceptance Criteria

- [x] AC1（能取假，持久化）：直接调 spawn 路径后，检查持久化文件里存在该 task 的 `{runId, workerPid, selectorReason, startedAtMs, timeoutDeadlineMs}` 记录；worker 正常结束后该记录被清除。⛔ spawn 后记录缺失，或结束后记录仍残留 ⇒ 假。
- [x] AC2（能取假，pid 已死的 finalize）：构造一个"有 task worktree、持久记录存在、但记录里的 pid 已不存活"的夹具，跑一轮 reconcile，断言 `worker-outcome.jsonl` 新增一条该 task 的记录且 `final_state !== "completed"`，且该记录能与"存活 driver 亲眼观察到的异常死亡"记录通过 reason 字段区分。⛔ 无新记录，或 reason 与正常死亡路径同形 ⇒ 假。
- [x] AC3（能取假，pid 存活的 adopt 且超时不重置）：构造一个"记录里的 `timeoutDeadlineMs` 已经过期（在 adopt 发生前）"的夹具，跑一轮 reconcile，断言该孤儿 pid 被 `SIGTERM`、且落盘终态为 `timed-out`（不是靠 adopt 重新给了一个未过期的新窗口才活下来）。⛔ 用一个已过期的原始截止时刻却没被判超时 ⇒ 假。
- [x] AC4（能取假，无回归）：`node plugin/scripts/task-schema-check.ts tasks/gap-worker-driver-restart-orphan-no-outcome-no-timeout.md` 与相关 scoped 测试（`--for-task` 覆盖 `worker-driver.ts`）均为 exit 0。

## Definition of Done

driver 重启导致的孤儿在飞 worker，下一个 driver 实例的 reconcile 循环里有据可查（持久化的 selector 理由/起止时刻）、有归宿可判（存活→纳入超时监管的 adopt，已死→立刻补终态并清理），不再是"排除集之外一片黑箱、只能等它自己消失"——`worker-outcome.jsonl` 对本机制派发的每一次 dispatch（含跨越 driver 重启的）最终都有且只有一条终态记录；AC1-4 全部机械验证通过并 land 到 develop。

## Touches

- plugin/scripts/worker-driver.ts（appendWorkerPid 扩展为结构化持久记录 + reconcile 步骤新增 adopt/finalize 分支）
- plugin/test/worker-driver.test.mjs（AC1-3 对应夹具测试）
- tasks/gap-worker-driver-restart-orphan-no-outcome-no-timeout.md（自身）

## Needs-Human

**执行 2026-09-02T07:21:31.658Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：9472ea1b-5fe6-421b-a63b-7514e943790e
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-worker-driver-restart-orphan-no-outcome-no-timeout-wk-prod-1788285192.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-worker-driver-restart-orphan-no-outcome-no-timeout-wk-prod-1788285192.log
