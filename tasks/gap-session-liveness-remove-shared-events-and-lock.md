---
id: gap-session-liveness-remove-shared-events-and-lock
title: "REMOVE the shared events file + the mutual-exclusion lock from
  session-liveness — observation topology is a TREE (manager→N outers,
  outer_i→inner_i), each edge an independent (observer,target) pair, read-only,
  no intersection; the shared file merges N independent streams then forces
  every consumer to filter back their own (strictly worse than N independent
  streams, zero benefit); the lock's only reason for existing was to protect the
  shared file — remove the file, duplicate mounting becomes harmless, lock has
  no reason; human ruling 2026-08-06 (two direct quotes: '共享事件文件这是个极端糟糕的设计' +
  '把互斥锁也彻底去掉'); hazard 1: who-starts-first decides what anyone sees (archguard
  08-05 07:31 'lock held by quay only watches quay sessions'), 2: already
  spawned a defect + patch (gap-a-log-already-filtered, LOOP_MIN threshold
  conflict), 3: fate-sharing (holder death blinds all, lock actively blocks
  takeover), 4: unbounded growth (measured 472KB, rotate/prune/truncate 0 hits);
  observation is PURE READ-ONLY (only capture-pane/git log/stat, zero target
  writes) — read-only is naturally non-exclusive, two observers on same pane
  cost one extra capture-pane per cycle; AC20's 'single-flight resource' premise
  is WRONG (observing is not a single-flight resource), introduced by an earlier
  manager session not by outer/inner"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Finding

**去掉共享事件文件 + 彻底去掉互斥锁——观测拓扑是树，只读天然不排他。**

**【人裁定（2026-08-06，两条原话）】**：
- 「共享事件文件这是个极端糟糕的设计！manager 监测多个 outer，多个 outer 监测自己的 inner，
  为什么要共享文件？」
- 「目标不需要知道自己被监测。多个观测者观测一个目标互相也不用知道，它们都应当是只读的。」
- 「把互斥锁也彻底去掉。」

**【核心论证（人）】**：观测拓扑是一棵树——manager→N 个 outer、outer_i→inner_i，每条边是独立的
(观察者,目标) 对，彼此无交集。共享文件把 N 条不相干的流合并成一条，再要求每个消费者过滤回自己要的
——**严格劣于 N 条独立流，无任何收益**。

**【AC20 前提本身是错的（管理者早期会话引入）】**：脚本注释原话「谁需要谁自己起一个」对单飞资源是错
的默认——它假设观测是单飞资源，而观测不是。**实测 session-liveness 对目标是纯只读**（只有
tmux capture-pane / git log / stat，零写入；send-keys 只在注释解释输入来源）。只读天然不排他——
两个观察者盯同一 pane 的代价只是每周期多一次 capture-pane 和几次 stat，互不影响也不需要互相知情。

**【因果链（四条已核实危害，去共享后同时消失）】**：
1. **谁先启动决定能力**：共享文件 → archguard 08-05 07:31「lock held by quay only watches quay sessions;
   archguard/meta-cc events never produced」——能力由启动顺序决定。
2. **已自生缺陷并打补丁**：tasks/gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second
   （manager 要 LOOP_MIN=0 而项目要抑制，一条流服务不了两个阈值；AC21「记全量读时判」是给共享打补丁）。
3. **命运共享**：持有者死则全瞎，而锁主动阻止他人接管。
4. **无界增长**：实测 events.jsonl 472KB（460K 行），rotate/prune/truncate grep 0 命中。

**互斥锁存在的唯一理由** = 保护那个共享文件；共享文件本身不该存在——去掉共享文件，重复挂载立刻无害，
锁就没有存在理由。

**【B-FULL-DELETE（人 2026-08-06 最终裁定，接续上面的锁裁定）】**：「彻底删掉 heavy-op-token.sh 及其
调用/相关逻辑，不再处理一次只跑一个重测试逻辑」——**heavy-op-token.sh 整体删除 + 全部调用点清理**：
scripts/test.sh（5 处）、session-liveness.sh（7 处）、session-liveness-mount.sh（1 处）、quay-init.sh
（2 处）、capability-catalog.sh（1 处声明）、plugin/loop/fast-mode-loop-tick.md（单飞挂载语义）、
heavy-op-token 测试文件（4 个）、cold-start-e2e.sh。「一次只跑一个重测试」约束整体退休，无替代。
（resource-gate.sh 仍是负载闸，与 token 不同——token 是跨项目互斥，gate 是单次运行负载门。）

### 目标形状

- 每个观察者拥有自己的事件流（谁挂的谁拥有，stdout 流，Monitor 工具消费）
- 无锁（含 session-liveness 的 heavy-op 借用 + heavy-op-token.sh 本体的整体删除），目标完全无感，
  观察者之间互不知情，谁先启动无关
- manager 挂 N 个观察各 outer；每个 outer 挂 1 个观察自己 inner——全独立、全只读、零共享写点

## Requested action

**Chosen mechanism**（gap-kind 的机制节，DIR-122 的 `## Requested action` 角色）：

1. **`plugin/scripts/session-liveness.sh`**：删掉共享事件文件机制（`sl_json_append`/`sl_emit_shared`/
   `sl_heartbeat`/`SL_EVENTS_FILE`/`SL_GLOBAL_DIR`）与互斥锁借用（`_sl_acquire_or_noop`/
   `_sl_release_mount_lock`/`heavy-op-token.sh` 调用）。事件只走观察者自己的 stdout（`sl_emit` 只
   echo）；`SL_ROUND_MARKER` 测试接缝给轮次刻度。
2. **`plugin/scripts/heavy-op-token.sh` 整删**（B-FULL-DELETE）+ 全部调用点：`scripts/test.sh`
   （heavy_op_acquire 删，full-suite 标记改 `is_default_set`）、`plugin/scripts/quay-init.sh`
   （laydown 列表删）、`plugin/scripts/capability-catalog.sh`（声明删）、`test/cold-start-e2e.sh`、
   `plugin/scripts/loop-shipping-exclusion-data.mjs`（oldPaths 6→5）、`plugin/test/heavy-op-token*.test.mjs`（删）。
3. **`plugin/scripts/monitor-mount-check.sh`**：删共享事件 `delivered` 判据，收敛为 `mounted` +
   `targetRoot`/`targetOk` 两判据（谁挂的谁拥有 stdout 流，交付由挂载方 Monitor 承担）。
4. **`plugin/test/session-liveness.test.mjs`**：删 M1-M7（锁 + 共享文件）与 AC21（共享文件补丁）；
   加 AC2/AC4 并行观测测试（多观察者同一目标、不同 LOOP_MIN，各自流独立）。
5. **文档同步**：`plugin/loop/{fast-mode,orchestrator}-loop-tick.md`、`plugin/skills/{cold-start,init,manager}/SKILL.md`、
   `docs/analysis/fast-mode-loop-tick.md`、`orchestration/orchestrator-loop-tick.md` 三判据→两判据、
   单飞语义改、heavy-op 退休。

## Acceptance Criteria

- [x] AC1: 共享事件文件移除——每个观察者写自己的事件流（谁挂的谁拥有）
      - 证据：Contract invoke `grep -c 'SL_GLOBAL_DIR\|events.jsonl\|heavy-op-token\|_sl_acquire\|_sl_release' plugin/scripts/session-liveness.sh` → **0**（grep exit 1）；`sl_emit` 只 echo 到观察者自己的 stdout；`SL_ROUND_MARKER` 测试接缝给轮次刻度（替代旧的共享文件 HEARTBEAT 行）。
- [x] AC2: 互斥锁移除——多观察者并行挂载同一目标无冲突（无锁，天然可并行）；
      且 heavy-op-token.sh 已整体删除（含全部调用点：test.sh/quay-init/capability-catalog/cold-start-e2e/测试文件）
      - 证据：`plugin/test/session-liveness.test.mjs` AC2「多观察者并行挂载同一目标（无锁、无共享文件）」实跑通过——两个观察者都跑满 ≥2 轮、各自独立发 SESSION-GONE，流互不污染；`heavy-op-token.sh` + 4 个测试文件已删除（commit 2f9d4575）；test.sh/quay-init/capability-catalog 对 heavy-op 的引用 grep 为 0；`test/cold-start-e2e.sh` 只保留「必须 NOT 铺进目标项目」的负断言（退役标注）。
- [x] AC3: 目标无感——session-liveness 对目标仍纯只读（capture-pane/git log/stat，零写入）
      - 证据：grep 全脚本确认对 `$root`/`$target` 只做 `git -C "$root" log` / `stat -c %Y` / `capture-pane` / `find`（全只读）；唯一的写操作在自包含的 `selfcheck()` 里（`mktemp -d` 临时目录，写自己的诊断夹具），不碰目标。
- [x] AC4: 观察者互不知情——manager 观 outer + outer 观 inner 独立并行，谁先启动无关；
      同一目标被两个 LOOP_MIN 不同的观察者盯，各自阈值只作用于各自 stdout（AC21 根因消失）
      - 证据：`plugin/test/session-liveness.test.mjs` AC4「同一目标两个 LOOP_MIN 不同的观察者」实跑通过——先起 LOOP_MIN=999（抑制健康空闲），后起 LOOP_MIN=0（全报）；两个观察者都发 SESSION-RESUMED；空闲时 B（LOOP_MIN=0）报 SESSION-IDLE、A（LOOP_MIN=999）在自己流上保持静默——各自阈值只服务各自的流。
- [x] AC5: 与 gap-a-log-already-filtered（打补丁的）交叉标注——本任务去掉根因，该补丁可退役
      - 证据：`tasks/gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second.md` 已有「交叉标注（AC5，2026-08-06，gap-session-liveness-remove-shared-events-and-lock）」节，声明其机制（共享文件记全量、阈值只作用于持有者 stdout）失去存在理由、`sl_emit_shared` 双写共享文件已随根因移除而退役；session-liveness.test.mjs 原 AC21 测试已删，由新的 AC4 并行观测测试承担同等正控制。

## Definition of Done

- [x] 代码落地：`plugin/scripts/session-liveness.sh` 不含共享事件文件/锁/heavy-op 借用（`grep -c` 为 0）
      - 证据：`grep -c 'SL_GLOBAL_DIR\|events.jsonl\|heavy-op-token\|_sl_acquire\|_sl_release' plugin/scripts/session-liveness.sh` → 0；`grep -c 'sl_json_append\|sl_emit_shared\|sl_heartbeat\|SL_EVENTS_FILE'` → 0。
- [x] `plugin/scripts/heavy-op-token.sh` 及其 4 个测试文件已删除；test.sh/quay-init/capability-catalog/cold-start-e2e 无引用
      - 证据：`ls plugin/scripts/heavy-op-token.sh` 与 `ls plugin/test/heavy-op-token*` 均不存在；`git log` 显示删除落地于 2f9d4575；全树 grep `heavy-op-token` 只剩退役标注（注释/负断言），无调用点。
- [x] 测试绿：`plugin/test/session-liveness.test.mjs`（AC2/AC4 并行观测正控制实跑通过）、
      `plugin/test/monitor-mount-check.test.mjs`（两判据）、`plugin/test/loop-shipping*.test.mjs`、`plugin/test/quay-init-loop.test.mjs`
      - 证据：session-liveness.test.mjs 全绿（含 AC2/AC4 并行观测正控制）；monitor-mount-check.test.mjs 11/11 绿（mounted+targetOk 两判据，delivered 已除）；loop-shipping.test.mjs 绿 + loop-shipping-necessity-check.test.mjs 绿（本任务补了 `packages/quay/plugin` 条目的 retainedNote——oldPaths 6→5 后该条目 inert）；quay-init-loop.test.mjs 46/48（AC3「铺全机制集」本任务修复：`inner-blocked-signal.ts`/`inner-forensics.mjs`/`task-contract-check.ts`/`task-status-drift-check.ts`/`touches-orthogonality-check.ts` 加入显式铺设表；剩余 2 个失败 `AC1(skill)`/`AC2` 为 **ac8 40→6 instrument 集成（commit 2f6621ed）的既有回归**，与本次改动无关——已用 HEAD 原版 quay-init.sh 复现确认）。
- [x] 文档同步：两份 tick 文档 + 三个 skill 的「三判据/单飞/共享事件」语义已改
      - 证据：`plugin/loop/{fast-mode,orchestrator}-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md` + `orchestration/orchestrator-loop-tick.md` 已含「2026-08-06 delivered 随共享 events.jsonl 移除」「heavy-op-token.sh 已退休」；本任务再清理 4 处残留「单飞挂载」现行语义表述（orchestrator-loop-tick.md:199、cold-start SKILL.md:203/207）与 2 处重活令牌放宽实验引用（fast-mode-loop-tick x2）；三个 skill 的 delivered/单飞/共享事件语义均已改。
- [x] 实跑证据贴进任务体（AC2 两观察者并行、AC4 阈值独立的正控制输出）
      - 证据：Contract measure `parallel_observers` = **2**（`SESSION_TARGETS` 两观察者盯同一 pane quay-0:0.0 的 `--once` 输出，两行 SESSION-STATUS 均正常）；AC2/AC4 的测试输出见 `plugin/test/session-liveness.test.mjs`（`✔ AC2 — multiple observers mount the SAME target in parallel...` / `✔ AC4 — observers don't know each other...`）。
- [x] 遵循 inherited-core 标准 DoD（五条款：proposal/implementation/verification/evidence/closure 全落地）
      - 本任务实现（shared-events+lock 移除、heavy-op 全删）由 develop 上的 2f9d4575/57d8fac5/dc08a3a6 落地；本次派发补齐验收：文档残留清理、necessity-check retainedNote、quay-init 铺设表修复、AC 勾选与证据。

## Touches

- tasks/gap-session-liveness-remove-shared-events-and-lock.md
- plugin/scripts/session-liveness.sh
- plugin/scripts/session-liveness-mount.sh
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/heavy-op-token.sh
- plugin/scripts/quay-init.sh
- plugin/scripts/capability-catalog.sh
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/skills/cold-start/SKILL.md
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
- plugin/test/heavy-op-token.test.mjs
- plugin/test/heavy-op-token-events.test.mjs
- plugin/test/heavy-op-token-lease.test.mjs
- plugin/test/heavy-op-token-wait.test.mjs
- plugin/test/session-liveness.test.mjs
- plugin/test/monitor-mount-check.test.mjs
- plugin/test/quay-init-loop.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/loop-shipping-necessity-check.test.mjs
- plugin/test/task-contract-check.test.mjs
- scripts/test.sh
- test/cold-start-e2e.sh
- packages/quay/test/install-config-driven-e2e.test.mjs
- tasks/gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second.md

## Contract

measure   parallel_observers = `bash plugin/scripts/session-liveness.sh --once 2>&1 | grep -c 'SESSION-STATUS'` stdout 数字段（多观察者并行挂载各自正常）
band      parallel_observers = ≥2（多观察者可并行，无锁冲突、各自事件流）
invoke    `grep -c 'SL_GLOBAL_DIR\|events.jsonl\|heavy-op-token\|_sl_acquire\|_sl_release' plugin/scripts/session-liveness.sh` 输出须为 0（共享文件/锁/令牌借用全部移除）
control   两观察者盯同一 pane 并行 ⇒ 都正常（AC2）；目标零写入（AC3）
resume    去共享与去锁分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T13:0xZ
changed: 人裁定重写（替代被撤回前提的任务）——去掉共享事件文件 + 彻底去掉互斥锁。核心论证：观测拓扑
是树、只读天然不排他、共享文件严格劣于独立流、锁的唯一理由（保护共享文件）随之消失。AC20 单飞前提
是错的（管理者早期会话引入，非外层/内层的锅）。四条危害核实（启动顺序/自生缺陷/命运共享/无界增长）。

## 范围钉死（2026-08-06T13:1xZ，管理者核实 + 外层确认，防误删）

**heavy-op-token.sh 有两个完全不同的用途，人的「彻底去掉互斥锁」只针对第一个**：
- **① 挂载互斥（去掉，人已裁定）**：session-liveness 借用（调用点 --root $SL_GLOBAL_DIR）。
- **② 重测试调度（保留，不在裁定范围）**：原始用途，scripts/test.sh **5 处**调用——三项目共用四核、
  一次只跑一个重测试，与观测完全无关。**不要动**。

**实现边界**：只摘 session-liveness 这一侧（10 处引用），**不删 heavy-op-token.sh 本体**（最后提交
bb25732b 未触及；删了会打断 test.sh 调度）。

**待定**：人更早说「单飞锁是本机开发实验使用、不应进产品化交付」——听起来针对 heavy-op-token 整体
（「三项目共用四核」是实验室条件），但人未就此明确裁定。A/B 两个范围选项已摆给人、等回复。**人明确
之前，②按原样保留**。

## Scope: FULL DELETE of heavy-op-token.sh (human ruling supersedes prior pin)

**人新裁定（2026-08-06，覆盖之前 A 范围钉死）**：原话「彻底删掉 heavy-op-token.sh 及其调用/相关逻辑，
不再处理一次只跑一个重测试逻辑」。范围 = B 全删：
1. **heavy-op-token.sh 本体删除**
2. **所有调用点清理**：scripts/test.sh（5 处）+ session-liveness.sh（7 处）+ session-liveness-mount.sh（1 处）
   + quay-init.sh（2 处）+ capability-catalog.sh（1 处声明）+ fast-mode-loop-tick.md:176-180（单飞挂载语义
   改写）+ heavy-op-token 测试文件 + cold-start-e2e.sh
3. **一次只跑一个重测试约束整体退役，无替代方案**
**删除顺序**：代码/测试 → shipped 文档 → 历史文档标注退役。
