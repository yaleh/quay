---
id: gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7
title: "NEW uncovered category: tests depend on real wall-clock timing for
  sequencing — session-liveness.test.mjs's two noise-gate tests use real
  sleep(2500) + 10-25s wait windows to judge a real polling process flips state,
  which fails under load (scheduling delay exceeds the window); same pattern in
  send-keys-verified/monitor-mount-check/measure-suite (4 files);
  test-isolation-contract.md R1-R7 cover ONLY filesystem/process isolation, NOT
  wall-clock — propose R8: tests must not depend on wall-clock timing for
  sequencing (use controlled fake-clock/events); this is the root cause of the
  KNOWN-LOAD-SENSITIVE family's persistent concurrency failures (blocks the
  concurrency-8 strategy)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**测试依赖真实挂钟计时判定时序——test-isolation-contract.md 的 R1-R7 完全没覆盖这个类别。**

### 实测（管理者 2026-08-07 09:4x，并发 8 恒红根因分析）

`session-liveness.test.mjs` 的两条 **noise-gate** 测试：
- 用**真 `sleep(2500)` + 10-25 秒等待窗口**判定一个真实轮询进程翻转状态；
- 负载下调度延迟导致**等待窗口不够** ⇒ 断言失败（并发 8 恒红，偶尔并发 1 也红）。

**同款写法**：`send-keys-verified.test.mjs` / `monitor-mount-check.test.mjs` / `measure-suite.test.mjs`
（共 4 个文件）。**人裁定后扩展到 6 个文件**（B类：另加 `quay-init-tmux-detection` / `build-dist-smoke`，
管理者机械识别 2026-08-07 10:2x）。

### 为什么是新类别（未被任何现有规则覆盖）

`test-isolation-contract.md` 的 **R1-R7 全部关于文件系统/进程隔离**（mkdtemp 位置、进程生命周期、
共享检出写入等），**没有一条覆盖「挂钟计时依赖」**。⇒ 这是一个**全新的设计缺陷类别**，现有规则
机制上无法捕获。

### 人裁定覆盖（2026-08-07 10:2x——本任务 AC2 的修复方向被覆盖）

**人裁定：并发 8 不降，为不能并发跑的测试应用相应机制，并发拿真绿。** 管理者落点建议：serial 组
（复用 scripts/test.sh 的 --group 机制）。**B类现有测试（6 个）通过 serial 组串行路由解决**——不再用
假时钟逐文件重写（本任务原 AC2 被此覆盖）。**R8 规则本身仍有效**（新测试不得依赖挂钟计时判定时序，
须受控假时钟/事件）——serial 组是处理既有测试的机制，R8 是约束新测试的原则，两者互补。
落地任务：`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`。

### 交叉标注（2026-08-07，serial 组已落地）

`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests` 已落地：6 个 B类文件
（session-liveness / measure-suite / monitor-mount-check / quay-init-tmux-detection /
send-keys-verified / build-dist-smoke）与 A 类、KNOWN-LOAD-SENSITIVE 族一起声明 `@test-group serial`，
由 `scripts/test.sh` 的 serial 阶段在并发主体之后以 concurrency 1 单独串行跑——B类挂钟等待不再被
并发主体 CPU 饥饿击穿（本任务 AC2 的"既有 B类经 serial 组隔离"已由落地任务完成）。本任务的 R8 规则
（约束**新**测试不得依赖挂钟计时）仍是独立的后续工作。

## Contract

```
measure wall_clock_tests = `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（当前 3：session-liveness 拆分后三文件 signals/events/heartbeat，全部在 lowconc 组；其余 B类 sleep 已缩至 <2000ms 不再命中、build-dist-smoke 已删。棘轮方向：此计数不得因新测试上升）
band wall_clock_tests = 0（R8 落地后，挂钟依赖测试清零）
invariant 测试不得依赖挂钟计时判定时序；时序判定必须用受控假时钟/事件驱动
invoke `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/`
control 人为在负载下跑 session-liveness noise-gate ⇒ 必须不因调度延迟失败（serial 组隔离后）；改回真 sleep ⇒ 必须复现负载失败
resume 若中断，先跑 measure 读当前挂钟依赖测试数
```

## Acceptance Criteria

- [x] AC1: **R8 规则写入**——`test-isolation-contract.md` 加 R8（不得依赖挂钟计时判定时序，须受控假时钟/事件）。
      落地为 **R9**（R8 已被 mkdtemp-root 规则占用）：`docs/analysis/test-isolation-contract.md` 新增
      「R9 · 不得依赖挂钟计时判定时序」节，含来源实例、规则、扫描信号（`sleep(N≥2000)` 的
      `real-wall-clock-wait` 判据 + `Date.now()` 断言）、既有测试的隔离处置说明
- [x] AC2: **既有 B类测试经 serial/lowconc 组隔离**（人裁定覆盖原"假时钟逐文件重写"方向；落地见
      `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`）。验证：B类 6 个挂钟依赖
      文件全部声明隔离组（session-liveness 拆分三文件 + measure-suite + monitor-mount-check +
      send-keys-verified + quay-init-tmux-detection → `@test-group lowconc`；build-dist-smoke 已删）；
      `--list-groups` 确认它们不在默认并发主体；低并发隔离跑绿（见 Evidence）
- [x] AC3: **负控制**——B类测试本就是真 sleep（从未改掉）；**不隔离**（并发主体 + CPU 负载）⇒ 复现失败，
      **隔离**（lowconc 单独跑）⇒ 绿。见 Evidence：历史红基线（2026-08-07 并发 8 恒红，本任务 Proposal
      实测）+ 本次隔离绿 + 负载复现尝试
- [x] AC4: 与 `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`（落地任务）、
      `gap-test-isolation-backlog-44-violations-unmeasured`（A/D 类另一面）、
      `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`（族分诊机械化）交叉标注——三个
      任务体均已含指向本任务的交叉标注段，本任务体补 `### 交叉标注` 汇总段

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（见 Evidence）
- [x] 并发 8 下套件不再因挂钟依赖恒红（serial/lowconc 隔离后 B类测试过：历史并发 8 红 → 隔离后绿）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——留给外层验证轮（worktree 资源门 WAIT，
      全量连跑 2 次超出 worktree 验证预算；机制已机械证明，见 Evidence，与落地任务同款处理）

## Touches
- docs/analysis/test-isolation-contract.md（R9 规则；原写 docs/references/ 系路径漂移，已修正）
- plugin/test/session-liveness-signals.test.mjs / session-liveness-events.test.mjs /
  session-liveness-heartbeat.test.mjs 等 B类测试（lowconc 隔离路由，见落地任务）
- tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md（自身文件）
- tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md（AC4 交叉标注）

## 交叉标注（2026-08-08，本任务落地）

- `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`（落地任务）：B类挂钟依赖文件的
  serial/lowconc 隔离由它落地；本任务补 R9 规则（约束新测试），两者互补。
- `gap-test-isolation-backlog-44-violations-unmeasured`（A/D 类另一面）：A 类嵌套 spawn（R3）与 D 类共享
  目录竞态是并发红的另一半根因，与本任务 B 类挂钟依赖同源（并发 8 恒红），修复方向不同。
- `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`（族分诊机械化）：KNOWN-LOAD-SENSITIVE
  族标记需 `@load-sensitive <kind>` 区分根因——wall-clock 正是本任务的 kind；R9 落地后该 kind 有契约
  规则支撑。

## Evidence（实跑输出 2026-08-08）

### measure（Contract 的 wall_clock_tests）

```
$ grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/ | wc -l
3
$ grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/
plugin/test/session-liveness-signals.test.mjs
plugin/test/session-liveness-heartbeat.test.mjs
plugin/test/session-liveness-events.test.mjs
```

当前 3（session-liveness 拆分后三文件，全部 `@test-group lowconc`）。其余 B类文件 sleep 已缩至
<2000ms（measure-suite 120ms fixture / monitor-mount-check 25ms 轮询 / send-keys-verified 300ms），
`build-dist-smoke` 已删。棘轮方向：此计数不得因新测试上升。

### AC1 落地：R9 规则写入

`docs/analysis/test-isolation-contract.md` 在 R8（mkdtemp-root）之后新增 **「R9 · 不得依赖挂钟计时判定
时序」**节：来源实例（本任务 + session-liveness noise-gate）、规则（时序判定须受控假时钟/事件，结果
不得因负载翻转）、扫描信号（`sleep(N≥2000)` 的 `real-wall-clock-wait` + `Date.now()` 断言）、既有测试
的隔离处置说明（B类不逐文件重写，经 lowconc/serial 隔离）。注：任务 AC1 原文称「加 R8」，但 R8 已被
mkdtemp-root 规则占用（2026-08-03），故本规则落地为 R9。

### AC2 验证：B类隔离路由已生效

```
$ bash scripts/test.sh --list-groups
product:    93
engine:     69
governance: 81
serial:     3
lowconc:    20
total:      266 (deduped by realpath)
```

wall-clock 三文件全部声明 `@test-group lowconc`，默认并发主体（product,engine）机械排除；`--group
lowconc` 阶段以 concurrency 3 单独跑。A类嵌套 spawn（runner-grouping 等）在 `serial` 组（concurrency 1）。

### AC3 负控制（复现成功）

**隔离（正控制）**——`session-liveness-heartbeat.test.mjs` 单独跑（无负载，隔离态）：

```
ℹ tests 14   ℹ pass 14   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
ℹ duration_ms 56412   EXIT=0
```

含两条 noise-gate（8.1s / 9.2s），全绿。

**不隔离 + 负载（负控制）**——7 个 `yes > /dev/null` 忙等进程模拟并发 8 的 CPU 饥饿，跑历史失败的
`noise gate — an idle transition with an OLD tick log IS reported`：

```
✖ noise gate — an idle transition with an OLD tick log IS reported (idle but no tick = anomaly) (28889ms)
AssertionError [ERR_ASSERTION]: RESUMED must fire on busy:
  code: 'ERR_ASSERTION',  actual: false,  expected: true,
NODE_EXIT=1（node --test 非零）
```

负载下监视器轮询被调度延迟拖慢，RESUMED 信号在 25s 等待窗口内未翻转 ⇒ 断言失败。**同一份测试代码、
真 sleep 从未改掉——隔离⇒绿、不隔离+负载⇒红，证明隔离（lowconc/serial 路由）是修复**。与历史
并发 8 恒红基线（本任务 Proposal 引管理者 2026-08-07 实测 + 落地任务 Evidence 的 7 个失败含
session-liveness noise-gate ×2）一致。

### AC4 交叉标注

- `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`：B类隔离由它落地；本任务补 R9。
- `gap-test-isolation-backlog-44-violations-unmeasured`：补「B类挂钟依赖是并发红另一半根因」段。
- `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`：补「wall-clock kind 已有契约规则支撑」段。

### scoped 门禁

```
$ bash scripts/test.sh --for-task gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7 --allow-thin
$ echo $?
0
```

change-relevant 静态检查全过：test-framework-policy（无新文件）、test-isolation（44 基线全部 PASS，
无新增）、test-impl-census（266 clean）、task-contract-check strict-subset（0 违规，两个触碰任务文件）。
测试集为空因 Touches 全是文档/任务文件（未触碰任何测试文件），`--allow-thin` 放行。

## Dispatch review

reviewer: none
at: 2026-08-07T09:5xZ
changed: 管理者 2026-08-07 根因分析（挂钟依赖 + 4 文件），请外层判断 → 裁定立案 R8：新类别（R1-R7
  未覆盖）、负载敏感族根因、阻塞并发 8 策略。
追加 2026-08-07 10:3xZ：人裁定覆盖 AC2 修复方向——B类 6 个文件走 serial 组（不逐文件假时钟重写），
  R8 规则本身保留（约束新测试）。落地任务已立。
