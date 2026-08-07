---
id: gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive
title: "Human proposal 15:5x: add a lowconc group (concurrency 3) alongside
  serial — serial stays untouched (protects only must-exclusive A-class that
  spawns its own worker pools:
  runner-grouping/select-tests-for-touches/test-coverage-check); lowconc
  collects hermetic-but-load-sensitive (B-class session observation +
  install/quay-init family, each mkdtemp/private-socket); change surface already
  tested (4 enum/case places + ~12-line phase block copying serial with
  --test-concurrency=1→3); conditions: ①only migrate PROVEN-hermetic (49
  hermetic signals in session-liveness, mkdtemp in install family; no-evidence
  stays serial) ②concurrency 3 not 8 (B-class wait-type needs timely
  scheduling); MEASURE FIRST (run candidate set alone at --test-concurrency=3,
  real wall-clock, before committing — don't set thresholds first); modeled
  23min→15min, +C1→10min, +C2→7.6min"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 15:5x 新提案（此前未进队列）：除现有 serial 组外，再加一个 `lowconc` 组（并发 3）。**
serial 原样保留（不动 scripts/test.sh:646 的"serial 并发硬编码 1、串行隔离是机制不变量、永不可配"），
只把「需要机器有余量、但彼此已隔离」的那批挪进新组。拆开后语义更准：**serial 只保护【必须独占】的**
（自己会派生 worker 池的 A 类：runner-grouping / select-tests-for-touches / test-coverage-check）；
**lowconc 收【hermetic 但负载敏感】的**（B 类会话观测 + install/quay-init 族，各自 mkdtemp 工作区或
私有 socket）。

### 改动面（管理者已实测，无数据结构重构）

组值是硬编码枚举 + 一个 case 分支，共 **4 处**：scripts/test.sh 第 21 行注释、428 行注释、437 行 case、
736 行报错文案；再加一段约 12 行的阶段块（照抄 641-660 的 serial 阶段，把 `--test-concurrency=1` 改成
`3`）；然后给要迁移的文件改 `// @test-group` 标注。

### 收益估算（建模非实测——**先测再定，不要先定阈值**）

只加这一组：serial 1049s → serial 321s + lowconc 约 285s，整轮 1368s → 约 895s（23min → 15min）。
叠加 C1（flags-only 改 --list-files）：整轮约 603s（10min）。再叠加 C2（install 共享 laydown 模板）：
整轮约 458s（7.6min）。**注意**：这比早先"改 serial 并发只省 110 秒"的估算高得多——那个只算了 B 类挪
并发，漏了 install 族（415s，占大头）也能并行，**那条估算作废**。

**去风险很便宜（先测再定）**：把候选集单独按 `--test-concurrency=3` 跑一次，量真实墙钟，再决定值不值。
教训（C2 上刚吃过）：按"一次 laydown 7.8s"估，直方图才显示真实是 5.0-7.0s 平台（70 条/414.6s，占
serial 40%），比按关键词圈的 353.9s 大。

### 两个必须写进任务的条件（人裁定）

1. **只迁移【已证明 hermetic】的**：session-liveness 有 49 处 makeHermeticProbe/私有 socket/mkdtemp
   信号，install 族各自 mkdtemp 工作区；**没有隔离证据的一律留在 serial**，宁可少省也不要把 flaky
   放回来。
2. **并发取 3 不取 8**：B 类是等待型需要被及时调度，并发太高会让它们又开始饿——那正是它们当初被
   踢出主体的原因。

### 候选集（低并发可并行的）

- **B 类会话观测**：session-liveness / measure-suite / monitor-mount-check / quay-init-tmux-detection /
  send-keys-verified / build-dist-smoke（各有 hermetic 信号）
- **install/quay-init 族**：capability-catalog（Wiring）/ quay-init-loop-{driver,runtime,vendor} /
  npm-pack-e2e / worktree-root-fs-check / runtime-landing / cold-start-skill / quay-init-check-drift
  （各自 mkdtemp 工作区）
- **A 类留在 serial**：runner-grouping / select-tests-for-touches / test-coverage-check

## Contract

measure lowconc_members = `grep -rlE '@test-group[[:space:]]+lowconc' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（迁移后 >0）
measure serial_members = `grep -rlE '@test-group[[:space:]]+serial' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（迁移后 ≈ A 类 3）
measure serial_segment_s = `grep -A1 "selected .* files (groups=serial)" .quay/full-suite.log | grep "duration_ms" | tail -1` stdout 数字段（目标 <400s）
band serial_segment_s = < 400（serial 段从 1049s 降到 A 类独占）
invoke `bash scripts/test.sh --group lowconc 2>&1 | tail -3`
control 只迁移有隔离证据的文件（hermetic 信号），无证据的留 serial；低并发 3 不取 8；候选集 --test-concurrency=3 先测真实墙钟再定
resume 若中断，先跑 measure 读 serial/lowconc 成员数与 serial 段耗时

## Acceptance Criteria

- [ ] AC0: **先测再定**——候选集（B 类 + install 族）单独按 `--test-concurrency=3` 跑一次，量真实
      墙钟；把实测数字贴任务体，与建模（~285s）对照，再决定是否迁移（不要先定阈值）
- [ ] AC1: **lowconc 组落地**——scripts/test.sh 加 `lowconc` 枚举（4 处）+ 约 12 行阶段块（照抄
      serial 阶段，`--test-concurrency=3`）；`--group lowconc` 可单独跑
- [ ] AC2: **只迁已证 hermetic**——B 类（session-liveness 等 49 处 hermetic 信号）+ install 族
      （mkdtemp 工作区）迁入 lowconc；**无隔离证据的一律留 serial**（宁可少省不放 flaky）
- [ ] AC3: **serial 收窄为 A 类独占**（runner-grouping / select-tests-for-touches / test-coverage-check，
      约 3 文件）；serial 段耗时 <400s
- [ ] AC4: **并发 3 不取 8**——lowconc 相位硬编码 `--test-concurrency=3`；B 类等待型不被饿
- [ ] AC5: 与 gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles（C 任务：C1
      --list-files + C2 install 模板，叠加）交叉标注——本任务与 C 互补

## Definition of Done

- [ ] AC0-AC5 实跑输出贴进任务体（含候选集 --test-concurrency=3 实测墙钟、迁移前后 serial/lowconc
      段耗时）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且整轮 <15 分钟（建模 895s）

## Touches
- scripts/test.sh（lowconc 枚举 4 处 + 阶段块）
- plugin/test/session-liveness.test.mjs / measure-suite / monitor-mount-check / quay-init-tmux-detection /
  send-keys-verified / build-dist-smoke（B 类 → lowconc）
- plugin/test/capability-catalog / quay-init-loop-{driver,runtime,vendor} / npm-pack-e2e /
  worktree-root-fs-check / runtime-landing / cold-start-skill / quay-init-check-drift（install 族 → lowconc）
- tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T16:0xZ
changed: 人 15:5x 新提案（15:1x 转达后才成形，从未进队列）：加 lowconc 组（并发 3），serial 原样护 A 类
  独占、lowconc 收 hermetic 但负载敏感。两条件（只迁已证 hermetic + 并发 3 不取 8）+ 先测再定
  （候选集 --test-concurrency=3 实测墙钟）。管理者已实测改动面（4 处 + 阶段块，无重构）。
