---
id: gap-suite-concurrency-ff-gate-and-slot-ssot
title: suite 并发量三个互不一致定义点 + ff 判据范畴错误——ff 闸收窄到本任务 suite + 槽数由 S 生成 + 记录面真实化 + 行为层不变量（人 2026-08-18 裁定「把系统真正做对」）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**人裁定（2026-08-18，逐字，manager 转达）**：「把 ff 的判据从『任何 suite 在跑』收窄到『本任务自己的 suite 在跑』。然后再把槽联动逻辑改对。注意：**不要只关心修单个现象，而是要把系统真正做对。**」

**缺陷面（manager 枚举 + outer 独立核实，2026-08-18 01:4xZ）**：一个量「能跑几个 suite」有**三个互不一致的定义点 + 一处范畴错误**，三者靠散文（`:1067` 注释）维系，**零可执行不变量**：

```
lane 除数说 = S（=2，读 S，正确）  槽数说 = 2（写死，不读 S）  ff 闸说 = 0（任一槽被持即拒，全局）
```

- **正确读 S（5 处）**：`full-suite-runner.ts:1566 defaultLaneCount()` / `:1667 DEFAULT_SERIAL_CONCURRENCY` / `:1668 DEFAULT_LOWCONC_CONCURRENCY` / `scripts/test.sh:963` 资源闸 / `:1002 serial_lowconc_host_default()`。
- **不读 S / 写死槽路径（4 处错误面，manager 换谓词重扫补全）**：
  - `scripts/test.sh:1103-1104` `FULL_SUITE_LOCK_0/_1` **写死两个文件**（`:1067` 注释断言「slot count IS the QUAY_MAX_CONCURRENT_SUITES knob」——断言与实现不符，硬规则③b）。
  - `fan-in-ff-merge.sh:208/239/249` 遍历写死 `.0/.1`，**且判据范围错**（全局 vs 本任务）。
  - `fan-in-execute.js:153` `lane_count=$(nproc)` —— **记录面伪造**（实跑 concurrency=8 记成 16）。
  - **`full-suite-runner.ts:1598-1613 suiteLockPaths()`** 返回定长 `[base.0, base.1]`（**:1632 docstring 逐字「(0..S, S = concurrentSuiteSlots())」——与 test.sh:1067 同形，注释断言 S 联动而实现没有，硬规则③b 第二实例**）；`:1640 countHeldSuiteLocks()` 解构恰两个 ⇒ **`concurrentSuitesRunning` 最多数到 2，S=3 时 AC101 对照轮的自变量记录再次失真**（与 laneCount 伪造同族）。
  - **`worktree-process-reaper.ts:259-267 fullSuiteLockFiles()`** 返回 `.0/.1` ⇒ S=3 时 `.2` 上的陈旧持锁**永远无人回收**（stale-lock reclaim 路径 `fan-in-ff-merge.sh:231-235` 正依赖它）。
  - **⚠️ 枚举谓词教训（manager 自认，硬规则⑤ 第四例）**：我最初用「谁读 S」（grep QUAY_MAX_CONCURRENT_SUITES）枚举出 5+3，而缺陷长在「谁写死槽路径」（grep 槽文件名模式）真值 4 处——**两个谓词覆盖同一容器里两类 population，只用一个判「枚举完整」会漏**。验收同理：层 4 不变量若也只按「读 S」写会漏 ③④。
- **可执行不变量：0 个**。

**范畴错误（根本）**：同一个对象表达了两种语义不同的锁——
- **资源锁（限流）**：「机器上最多几个 suite」——配额，与正确性无关，天然全局。
- **正确性锁（互斥）**：「ff 必须与产出该绿色证书的那一次 suite 互斥」——证书钉住待 ff 的树，**每任务的因果关系**。
ff 闸拿资源锁去表达正确性约束 ⇒ 收窄不是「缩小范围」而是「换一个对象」。**正确的对象已存在**：`/tmp/fan-in-suite-<task>.exit` marker + capture 的 `suite_head`——ff 要问「本任务的 suite 是否已终结、且 `suite_head` == 待 ff 的 HEAD」，**每任务直接量，无需任何全局锁**。

**为什么现有守卫没守住（重要）**：`concurrency-literal-check.ts`（catalog 自述按 POSITION 扫 scripts/*.sh）**本该抓到这个但没抓到，不是它坏了**——它的五个位置 P1-P5 都要求**数值字面量**（`const NAME=<num>` / CLI flag 后数字 / CPUQuota / 对象键），而**槽数 2 在源码里从未以数字 2 出现**——被编码成「恰好两个变量 `_0`/`_1`」+「恰好两个 flock 分支」。**结构性编码而非数值编码，字面量扫描器按构造看不见**（硬规则⑤：同一容器两类 population，只用覆盖其一的工具判空——今晚第三例）。⇒ 再加字面量检查没用，**不变量必须在行为层陈述**。

**影响**：①S=1 无法真正设置（槽仍 2 ⇒ 32-lane 超订）⇒ ②`gap-ac101-lane-concurrency-control-round` 测错对象；②两 fan-in 同时 suite ⇒ ff 互 REFUSE ⇒ livelock 必然（矛盾 B，今晚 3 retreat 实证）；③`laneCount` 记录伪造污染 util 分析与对照轮判定（硬规则③b）。

## Plan（四层，人「把系统真正做对」约束——缺任一层都会再漂一次）

1. **拆语义（层 1，核心）**：ff 闸不再读任何全局 suite 锁；改读**本任务** capture——`.exit` marker 存在 ∧ `suite_exit=0` ∧ `suite_head == 待 ff 的 HEAD`。**副产品**：矛盾 B 自动消失（两 suite 并存不再互 REFUSE）、R1（防 suite 并发）自动成立、无需独立加闸。
2. **单一定义点（层 2）**：**槽路径解析集中到唯一实现，四处消费者全部改读它**（`scripts/test.sh` 的 `FULL_SUITE_LOCK_*` / `full-suite-runner.ts:1598 suiteLockPaths()` / `worktree-process-reaper.ts:259 fullSuiteLockFiles()` / `fan-in-ff-merge.sh` 遍历）；槽数由 S **生成**（按 S 循环建 `.0..S-1`、FD 动态分配），不再写死两个；lane 除数已读 S ✓。**否则改完 test.sh，另外三处仍各自写死，单一定义点没建成。**
3. **记录面真实化（层 3）**：`fan-in-execute.js:153` `lane_count` 改取 suite 日志 `__GROUP__ concurrency=`；补记实际并发数——**否则不变量不可核**。⚠️ 与 `gap-fan-in-verification-round-thin-schema-phase-gap` 同批（lane_count 真实化已在该任务体，勿分开做）。**⚠️ `lane_count` 与 `concurrentSuitesRunning` 两个字段同源**（都该取自 suite 日志/唯一槽实现，而非 `nproc`/定长解构）——它们是同一「记录面伪造」缺陷的两半，别只修 lane_count 漏 concurrentSuitesRunning。
4. **可执行不变量（层 4，行为层）**——「做对」与「再修一遍」的分界：
   - 观测到的槽文件数 == `concurrentSuiteSlots()`（**设 S=1 跑断言只出现 `.0`；设 S=3 断言 `.0/.1/.2`**——能取假）。
   - `lane × S ≤ nproc × oversub`（资源不超订）。
   - **ff 闸不引用任何跨任务 suite 状态**（按位置：`fan-in-ff-merge.sh` 不得出现 `full-suite.lock` 读取）。
   - **全仓不得存在除唯一槽路径实现外的 `full-suite.lock.<数字>` 字面量**（按位置 grep 槽文件名模式——直接对着表现形式，不依赖谁读 S；能同时抓住 test.sh:1067 与 full-suite-runner.ts:1632 两处注释断言同形）。
   前两条若早存在，`:1067` 的漂移当天就会红；第三条把 ③④ 也纳入。

**顺带解掉（记进任务体）**：
- **S=1 现在可真正设出**（层 2 落地后）——②的实施前提随之满足，**但执行顺序**：层 2 必须先落，否则设 S=1 得到的仍是「2 槽 × 16 lane = 32 lane 超订」，对照轮测错对象。
- **R1 不独立立案**（层 1 落地后自动成立）；若仍要独立闸，须写明是「层 1 未落地期间的临时闸，落地后删」，否则留下第四个「能跑几个 suite」定义点，破坏单一定义点。

## Acceptance Criteria

- [x] AC1: ff 闸判据收窄到本任务 suite（读 `.exit` marker ∧ `suite_exit=0` ∧ `suite_head==待 ff HEAD`）；`fan-in-ff-merge.sh` 不再读取任何跨任务 suite 锁。
- [x] AC2: 槽数由 S 生成（S=1 ⇒ 仅 `.0`，S=3 ⇒ `.0/.1/.2`），`scripts/test.sh` 不再写死两个；`:1067` 注释与实现一致。
- [x] AC3: `lane_count` 取 suite 日志 `__GROUP__ concurrency=`（真实 lane），与 thin-schema 任务同批落地；记录不再伪造（16 vs 8 问题消失）。
- [x] AC4: 行为层不变量落地且能取假——槽文件数 == concurrentSuiteSlots()、lane×S ≤ nproc×oversub、ff 闸无 `full-suite.lock` 读取（按位置断言）。
- [x] AC5: 两 fan-in 同时 suite 不再互 REFUSE（矛盾 B 消失，对照：S=2 两 suite 并存各自可 ff）；R1 无需独立闸。
- [x] AC6: `gap-ac101-lane-concurrency-control-round` 的 S=1 对照轮前提满足（设 S=1 真正单槽单 lane 集）。
- [x] AC7: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] 一个量一个定义点：槽数由 S 生成、ff 闸读本任务 capture（不碰全局锁）、lane 记录真实、行为层不变量守着——矛盾 B 消失、S=1 可设、②对照轮测到正确对象，scoped + 全量绿。

## Touches

- plugin/scripts/suite-lock-slots.ts（**新增**——TS 侧 suite 槽路径唯一实现：suiteLockSlotCount / suiteLockSlotPaths / suiteLockBase）
- plugin/scripts/suite-slot-lib.sh（**新增**——bash 侧 suite 槽路径唯一实现：suite_slot_count / suite_slot_paths，被 test.sh source）
- plugin/scripts/suite-slot-ssot-check.ts（**新增**——行为层不变量检查器：I1 ff 闸无 full-suite.lock / I2 无硬编码槽字面量 / I3 消费者读唯一实现 / I4 bash==TS 槽数）
- plugin/scripts/fan-in-ff-merge.sh（ff 闸收窄：移除 full-suite.lock 全局读取 + stale-lock reaper 调用；改读本任务 suite capture——suite_exit=0 ∧ suite_head==待 ff tip；新增 --suite-capture 参数）
- plugin/workflows/fan-in-execute.js（lane_count 取 suite 日志 `__GROUP__ concurrency=`；capture 保留到 ff 之后清理）
- .claude/workflows/fan-in-execute.js（dual-copy 副本，byte-identical）
- scripts/test.sh（槽数由 S 生成——循环建 `.0..S-1`、FD 动态分配；source suite-slot-lib.sh；full_suite_lock_acquire/release 改 S 槽；接线 suite-slot-ssot-check）
- plugin/scripts/full-suite-runner.ts（suiteLockPaths() 改读 suite-lock-slots.ts 唯一实现；countHeldSuiteLocks() 探测 S 槽；concurrentSuiteSlots() 委托 suiteLockSlotCount()）
- plugin/scripts/worktree-process-reaper.ts（fullSuiteLockFiles() 改读 suite-lock-slots.ts 唯一实现——S=3 时 `.2` 陈旧持锁可回收）
- plugin/scripts/retired-clause-check.ts（R30 历史 marker 加 suite-slot-ssot-exception 声明例外——引用旧 suite 锁命名作退役文本匹配，非槽路径）
- plugin/scripts/capability-catalog.sh（三个新脚本的 capability 声明——QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照重生成——新脚本计数 260→263）
- plugin/scripts/checker-mutation-cases/suite-slot-ssot-check.sh（**新增**——suite-slot-ssot-check 的 mutation case：GREEN→注入硬编码槽形→RED→恢复）
- plugin/test/fan-in-ff-merge.test.mjs（ff 闸测试改写：capture 缺失/非绿/HEAD 不符 → exit 2；AC5 两 fan-in 各自可 ff 不再互 REFUSE）
- plugin/test/fan-in-execute-paths.test.mjs（lane_count 取 `__GROUP__ concurrency=` 真实化 REAL 测试；capture 保留到 ff 的断言）
- plugin/test/suite-slot-ssot-check.test.mjs（**新增**——行为层不变量测试：槽文件数==concurrentSuiteSlots、lane×S≤nproc×oversub、concurrentSuitesRunning 随 S、检查器每条能取假）
- plugin/test/inner-blocked-signal.test.mjs（AC4 load-fragile fix 5c51da41——concurrency-8 负载下 spawnSync 阻塞事件循环致 AC4「活跃阶段」误触 block，改 async spawn 解耦 background writer 与 CLI poll；本任务并发变更暴露的负载敏感测试修复）
- plugin/test/outer-cron-registry.test.mjs（fixture 硬编码陈旧——inner cron 重锚换 id 后 cronId 09fabf33 判据②恒假 + nowMs 05:00Z < live verifiedAt 判据③恒假；bc6b6b08 改动态化 real.layers.inner.cronId + nowMs 取 live verifiedAt，与 outer 7263b1b3 互补）
- tasks/gap-ac101-lane-concurrency-control-round.md（执行顺序注记：层 2 先落再设 S=1）
- tasks/gap-fan-in-verification-round-thin-schema-phase-gap.md（lane_count 真实化同批注记）
- tasks/gap-suite-concurrency-ff-gate-and-slot-ssot.md（自身）
