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
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

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

### 目标形状

- 每个观察者拥有自己的事件流（谁挂的谁拥有）
- 无锁，目标完全无感，观察者之间互不知情，谁先启动无关
- manager 挂 N 个观察各 outer；每个 outer 挂 1 个观察自己 inner——全独立、全只读、零共享写点

## Acceptance Criteria

- [ ] AC1: 共享事件文件移除——每个观察者写自己的事件流（谁挂的谁拥有）
- [ ] AC2: 互斥锁移除——多观察者并行挂载无冲突（无锁，天然可并行）
- [ ] AC3: 目标无感——session-liveness 对目标仍纯只读（capture-pane/git log/stat，零写入）
- [ ] AC4: 观察者互不知情——manager 观 outer + outer 观 inner 独立并行，谁先启动无关
- [ ] AC5: 与 gap-a-log-already-filtered（打补丁的）交叉标注——本任务去掉根因，该补丁可退役

## Touches

- plugin/scripts/session-liveness.sh（去共享 events + 去锁；每观察者自己的流）
- plugin/loop/fast-mode-loop-tick.md（AC20 单飞语义改：观测不排他）
- plugin/scripts/monitor-mount-check.sh（去 mounted 依赖；「在看我」语义调整）
- tasks/gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second.md（AC5 交叉标注）

## Contract

measure   parallel_observers = `bash plugin/scripts/session-liveness.sh --once 2>&1 | grep -c 'observing\|监测'` stdout 数字段（多观察者并行挂载各自正常）
band      parallel_observers 多观察者可并行（无锁冲突、各自事件流）
invoke    `grep -n 'SL_GLOBAL_DIR\|events.jsonl\|heavy-op/token\|_sl_acquire' plugin/scripts/session-liveness.sh`
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


## Scope pin (manager, 2026-08-06 — do not delete heavy-op-token.sh)

heavy-op-token.sh has TWO completely different uses; the human's "remove the lock" applies ONLY to ①:
1. **① 挂载互斥（session-liveness 借用）—— 去掉**（人已裁定）：session-liveness 调用点传
   `--root $SL_GLOBAL_DIR` 借 heavy-op-token 的锁。本任务只摘这一侧借用（session-liveness.sh 内
   ~10 处 acquire/lock_token/noop 引用）。
2. **② 重测试调度（原始用途）—— 保留**：scripts/test.sh 5 处调用，三项目共用四核、一次只跑一个
   重测试，与观测无关，不在本次裁定范围。
**不删 heavy-op-token.sh 本体**（否则打断 test.sh 调度）。人更早那句「单飞锁本机实验不该进产品化」
针对 heavy-op-token 整体，但人未明确裁定 ②，按原样保留等回复。
