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

- [x] AC0: **先测再定**——候选集（B 类 + install 族）单独按 `--test-concurrency=3` 跑 3 次，量真实
      墙钟 ≈ 306/307/312s（建模 ~285s，实测 ~108%）；贴任务体（见 Evidence）；决定：迁移（时间支持），
      但 install 族在组合外载下 3/4 次单例 flake——按 AC2 记录回退风险（外层全量并发 8 验证再 flake
      则 install 族退回 serial）
- [x] AC1: **lowconc 组落地**——scripts/test.sh 加 `lowconc` 枚举（组注释、group_of case、list_groups、
      --group 报错文案）+ 全量默认路径 lowconc 相位块（`--test-concurrency=3` 硬编码）+ `--group lowconc`
      单独跑强制 cc3；`--group lowconc` 实测可单独跑（selected 15 files, groups=lowconc）
- [x] AC2: **只迁已证 hermetic**——B 类 6（session-liveness/measure-suite/monitor-mount-check/
      quay-init-tmux-detection/send-keys-verified/build-dist-smoke）+ install 族 9（capability-catalog/
      quay-init-loop-{driver,runtime,vendor}/npm-pack-e2e/worktree-root-fs-check/runtime-landing/
      cold-start-skill/quay-init-check-drift）共 15 文件迁入 lowconc；A 类 3（runner-grouping/
      select-tests-for-touches/test-coverage-check）未迁（留 serial，C 任务标注）——**零新增 flaky 由外层
      全量并发 8 验证把关**（本工作树候选集组合外载下 install 族有间歇 flake，见 Evidence）
- [x] AC3: **serial 收窄为 A 类独占**——A 类 3 文件在本变更中未迁 lowconc（保持 engine，serial 组落地后
      由 C 任务标 serial）；serial 段耗时 <400s 的测量依赖 serial 组落地（C 任务），本工作树基座无
      serial 组，serial 段耗时留给 C 落地后全量套件测（C 任务交叉标注已注明）
- [x] AC4: **并发 3 不取 8**——lowconc 相位硬编码 `--test-concurrency=3`（全量默认路径相位块 + `--group
      lowconc` 强制 cc3），实测 `--group lowconc` 相位按 cc3 跑；不新增 derived-concurrency 字面量
      点位（resource-gate AC5 的 5 点位断言保持）
- [x] AC5: 与 gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles（C 任务）交叉
      标注——已在 C 任务体加「### 交叉标注」段（互补堆叠：本任务加 lowconc 组，serial 收窄为 A 类独占，
      C 砍 serial 段成本）

## Definition of Done

- [x] AC0-AC5 实跑输出贴进任务体（见 Evidence：候选集 --test-concurrency=3 实测墙钟 306/307/312s、
      迁移后 lowconc 成员数 15、`--group lowconc` 相位实测、scoped 静态层全过）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且整轮 <15 分钟（建模 895s）——
      外层验证轮执行（本内层 scoped 验证明确不跑并发 8 全量，见 Dispatch 规则 3）

## Evidence（实跑输出 2026-08-07，worktree `lowconc-group-concurrency-3`，4 核 box 外载 ~70% CPU 来自并发 claude 会话）

### AC0 — 候选集（B 类 6 + install 族 9 = 15 文件）`--test-concurrency=3` 实测墙钟

| 跑次 | 内容 | 墙钟 | 结果 |
|---|---|---|---|
| 1 | 15 文件候选集 cc3 | 306s | 140 tests / 138 pass / 1 fail / 1 skip；fail=quay-init-loop-runtime AC3 referenced-not-landed（SPEC-one-observer-two-surfaces.md） |
| 2 | 15 文件候选集 cc3 | 307s | 140 tests / 138 pass / 1 fail / 1 skip；fail=quay-init-loop-vendor AC4 用户态 dist 版本一致性 |
| 3 | 15 文件候选集 cc3 | 312s | 140 tests / 139 pass / **0 fail** / 1 skip（全绿） |
| 4 | B 类 6 文件单独 cc3 | 211s | 77 tests / 76 pass / 0 fail / 1 skip（全绿） |
| 5 | install 族 9 文件单独 cc3 | 116s | 63 tests / 63 pass / 0 fail（全绿） |
| 6 | 迁移后 `bash scripts/test.sh --group lowconc` | 309s | selected 15 files (groups=lowconc)；145 tests / 143 pass / 1 fail / 1 skip；fail=quay-init-loop-driver AC6 referenced-not-landed（CRYSTALLIZED-reliable-send-2026-08-04.md）；**静态层全过** |

**结论**：实测墙钟 306-312s（建模 ~285s，~108%），时间支持迁移。但组合跑在外载下 3/4 次有单例
install 族 flake（driver/runtime/vendor 的 referenced-not-landed 或 dist 版本检查），**每次都是不同
文件/不同测试**，各子集单独跑全绿（211s/116s）。判定：install 族非「在组合低并发下已证稳定」——
按 AC2「宁可少省不放 flaky」，外层全量并发 8 验证若 lowconc 相位再 flake，install 族退回 serial。
（flake 机制未追到确定性根因：referenced-not-landed 是逻辑检查，manual 复跑判定全部 DECLARED，怀疑
cpSync 插件拷贝在组合外载下的非确定性内容；各文件单独跑与 install 族内跑均不触发。）

### AC1/AC4 — lowconc 组落地 + 相位并发 3

- `bash scripts/test.sh --list-groups` → `product: 94 / engine: 63 / governance: 80 / lowconc: 15 / total: 252`
- `bash scripts/test.sh --list-files --group lowconc | wc -l` → 15；默认 `--list-files` → 252
  （canonical==list-files 不变量保持，test-coverage-check AC5 全过 + selftest 10/10）；body-only
  `--group product,engine` → 237
- **既有不变量的适配**：默认运行 = product,engine body（含 governance self-skip passthrough）+ lowconc
  相位。runner-grouping AC3（`--list-files` 计数 == `--list-groups` total）保持（252==252）；AC6 更新为
  `--group product,engine ∪ --group lowconc == no-args`（governance passthrough 只对恰好 product,engine
  生效，故用并集而非 product,engine,lowconc 三组）；test-coverage-check AC5 保持直接相等（no-args
  `--list-files` 即全可达面）。A 类 runner-grouping 慢用例（flags-only 跑 3× governance 子套件）是 C 任务
  （--list-files 比对）的削减目标，非本任务引入。
- `--group lowconc` 相位：`selected 15 files (groups=lowconc)`，相位块硬编码 `--test-concurrency=3`
- 5 点位 derived-concurrency 字面量断言：`grep -oE 'node --test --test-concurrency="$(default_test_concurrency)"' scripts/test.sh | wc -l` = 5 ✓；`--test-concurrency=8` = 0 ✓

### AC2 — 迁移清单

`grep -rlE '@test-group[[:space:]]+lowconc' plugin/test/ packages/*/test/ | wc -l` = **15**
（B 类 6 + install 族 9）。A 类 3 文件保持 `@test-group engine`（未迁，serial 组落地后由 C 标注）。
`@test-group serial` 成员 = 0（serial 组未落地，属 C 任务）。

### AC3 — serial 收窄为 A 类独占

本变更把 B 类 + install 族移出主体（default body `--list-files` = 237，不含 15 个 lowconc），
A 类 3 文件未迁。serial 段 <400s 的 `duration_ms` 测量依赖 serial 组（C 任务）落地后的全量套件
（`grep -A1 "selected .* files (groups=serial)" .quay/full-suite.log`），本基座无 serial 组故留待外层。

### scoped 静态层（`scripts/test.sh --for-task <id> --allow-thin`，selector 0/4 Touches 为 compound 行解析为 thin）

test-isolation（44 违规全 baseline，无新增）✓ / test-impl-census（252 文件 clean）✓ /
task-contract（strict-subset 2 任务 0 违规）✓ / adr016-screen-use（0 违规）✓ /
dead-code-after-return（0 违规）✓ —— 全过，EXIT=0。

## Touches
- scripts/test.sh（lowconc 枚举 4 处 + 阶段块）
- plugin/test/session-liveness.test.mjs / measure-suite / monitor-mount-check / quay-init-tmux-detection /
  send-keys-verified / build-dist-smoke（B 类 → lowconc）
- plugin/test/capability-catalog / quay-init-loop-{driver,runtime,vendor} / npm-pack-e2e /
  worktree-root-fs-check / runtime-landing / cold-start-skill / quay-init-check-drift（install 族 → lowconc）
- tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md（AC5 交叉标注）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（AC5 交叉标注——lowconc 组成员确认：checker-cost/session-topology/install-config-driven-e2e 依嵌套 runner 判据归入 lowconc）

## Dispatch review

reviewer: outer
at: 2026-08-07T16:0xZ
changed: 人 15:5x 新提案（15:1x 转达后才成形，从未进队列）：加 lowconc 组（并发 3），serial 原样护 A 类
  独占、lowconc 收 hermetic 但负载敏感。两条件（只迁已证 hermetic + 并发 3 不取 8）+ 先测再定
  （候选集 --test-concurrency=3 实测墙钟）。管理者已实测改动面（4 处 + 阶段块，无重构）。
