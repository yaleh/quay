---
id: gap-relation-sync-load-flake-child-spawn-under-suite
title: relation-sync.test.mjs(手写 harness,spawn 2 真实 node 子进程做文件锁
  cross-reparent)全量套件上下文 load-flake——round-209 静默 passed=false(1932ms 比 solo 快,零
  harness 输出行=子进程 spawn 失败/被杀非断言失败)；solo+CPU 负载全绿；同
  create-mcp/proposal-convergence 并发子进程族未收编(@test-group product 非
  KNOWN-LOAD-SENSITIVE)
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**`packages/quay-native/test/relation-sync.test.mjs` 在全量套件上下文 load-flake——手写 harness（legacy，非 node:test）spawn 2 个真实 node 子进程做并发 cross-reparent（`execFileAsync` + 真实文件锁），套件内静默 `passed=false`（1932ms，比 solo 还快），零 harness 输出行——子进程 spawn 失败/被杀，非断言失败。与 create-mcp / proposal-convergence（并发子进程族）同族，但它是 `@test-group product`（主相）且不在 KNOWN-LOAD-SENSITIVE。**

### 实证（outer 2026-08-10 00:39 红窗分诊）

- **round-209 early-red**（161s，唯一失败）：`__PERFILE__ duration_ms=1932.968434 relation-sync.test.mjs passed=false`。
- **solo 全绿**：`node --test packages/quay-native/test/relation-sync.test.mjs` → 19/19 PASS、exit 0、2197ms。
- **CPU 负载下全绿**：4× busy-loop 烧 CPU 后仍 19/19 PASS、exit 0。
- **套件内静默失败**：1932ms（**比 solo 2197ms 更快**）+ **零 harness 输出行**（无 PASS/FAIL）。对比：同日志其它手写 harness（lock.test.mjs 等）的 41 条 PASS 行都在——说明 harness 输出会被捕获，relation-sync 的缺失是「进程在输出前就被杀/崩」，不是断言失败（断言失败必写 `FAIL:` 到 fd 2，同步、不可丢——文件注释明示）。
- **根因候选**：harness spawn 2 个真实 node 子进程（`reparent-writer.mjs`）做文件锁 cross-reparent；套件 ~17 并发 node 进程 + systemd-run TasksMax=200 下，子进程 spawn 在并发瞬间可能 EMFILE/TasksMax/被杀 → `execFileAsync` 拒绝 → 顶层 await 未捕获 → 文件静默失败（无 harness FAIL 行）。
- **同族先例**：create-mcp（MCP 子进程并发，round-188 红）→ `@test-group serial` + KNOWN-LOAD-SENSITIVE；proposal-convergence（20 并发 child，round-164 红）→ serial + KNOWN-LOAD-SENSITIVE。relation-sync 是同一族但**未收编**。
- **与既有机制正交**：verified-commit 活锁修复（fdab9558）只动 full-suite-runner.ts + integration-batch-merge.sh，不碰 relation-sync——本 flake 与活锁无关。
- **不在 KNOWN-LOAD-SENSITIVE**（`plugin/scripts/known-load-sensitive.ts` 无条目）；`@test-group product`（主并发相）。

**为什么重要**：round-209 是活锁修复端到端首跑，却被一个未收编的 load-flake 挡红——每挡一次就是一次完整重跑（~30min）。收编它（serial + KNOWN-LOAD-SENSITIVE）消除轮换红，与 create-mcp/proposal-convergence 同构。

### 选定机制方向（实现归内层，接法留执行时）

1. **收编**（主修法，同 create-mcp/proposal-convergence 先例）：`relation-sync.test.mjs` 加 `// @test-group serial` + `// @load-sensitive child-spawn` + `// KNOWN-LOAD-SENSITIVE` 声明（进 `known-load-sensitive.ts`）→ runner 路由到 serial 相位（cc=1），消除套件并发下子进程 spawn 竞争。
2. **失败诊断加固**（不削弱断言核心）：harness 顶层 `await testConcurrentCrossReparentNoDeadlockNoCorruption()` 包 try/catch，spawn 失败/顶层异常写 `FAIL: <err>` 到 fd 2（同步）——下次再红能看到真实原因，不静默。
3. **家族交叉标注**：与 create-mcp / proposal-convergence / install 家族同族（并发子进程 spawn 竞争）。

**验证锚**：修后 (a) 连续 2 轮全量 relation-sync 不红；(b) solo 恒绿；(c) 若再红，失败诊断有真实 FAIL 原因（非静默）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-209 实证 + solo/负载全绿 + 套件内静默失败签名（本任务 Proposal 已含）
- [x] AC2: **收编**——`relation-sync.test.mjs` 加 `// @test-group serial` + `// @load-sensitive child-spawn` + `// KNOWN-LOAD-SENSITIVE` 声明 + `known-load-sensitive.ts` 条目
- [x] AC3: **失败诊断**——harness 顶层 try/catch，spawn 失败/顶层异常写 `FAIL:` 到 fd 2（同步不静默）
- [x] AC4: **家族交叉标注**——create-mcp / proposal-convergence / install 家族同族标注
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿；solo 恒绿；断言核心不削弱

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：solo 绿（贴任务体）；连续 2 轮全量 relation-sync 不红
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay-native/test/relation-sync.test.mjs（`@test-group serial` + KNOWN-LOAD-SENSITIVE + 顶层 try/catch 失败诊断）
- plugin/scripts/known-load-sensitive.ts（新增 relation-sync 条目）
- plugin/test/known-load-sensitive.test.mjs（AC2 收编条目测试）
- tasks/gap-create-mcp-suite-context-flake-after-speedup-rework.md（交叉标注——同族：套件级子进程 spawn 竞争）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（交叉标注——同族：20 并发 child）
- tasks/gap-install-family-tests-rotate-flakes-under-full-suite.md（交叉标注——同族：负载敏感旋转 flake）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（交叉标注——收编进 serial 相是串行相扩容的来源之一）
- tasks/gap-phase-order-serial-lowconc-before-main.md（交叉标注——serial 相排在末尾放大红成本）
- tasks/gap-relation-sync-load-flake-child-spawn-under-suite.md（自身：勾 AC + 贴证据）

## Contract

measure   relation_sync_red_rounds_after_fix = `grep -c "relation-sync.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      relation_sync_red_rounds_after_fix = 0（连续 2 轮不红）
invariant relation_sync_solo_green = 1（单独跑 19/19 恒绿）
invariant harness_core_assertions_preserved = 1（cross-reparent 死锁/损坏断言核心不削弱）
invoke    `node --no-warnings --experimental-strip-types --test packages/quay-native/test/relation-sync.test.mjs`（单独跑贴回）
control   连续 2 轮全量不红；solo 绿；断言核心保留
resume    收编 serial / 失败诊断 / 家族标注分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: round-209 early-red 分诊（relation-sync 唯一失败）——solo + CPU 负载全绿、套件内静默 passed=false（1932ms 比 solo 快、零 harness 输出行）⇒ 并发子进程 spawn 竞争 load-flake，同 create-mcp/proposal-convergence 族未收编。修：@test-group serial + KNOWN-LOAD-SENSITIVE 收编 + 顶层 try/catch 失败诊断。实现归内层

## Evidence（内层实现 2026-08-10）

### 实现

1. **AC2 收编**——`packages/quay-native/test/relation-sync.test.mjs` 头改 `// @test-group product` → `// @test-group serial`，加 `// @load-sensitive child-spawn` + `// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族")` 声明（child-spawn 杀族 + round-209 静默签名 + solo/CPU 负载全绿 + 与 create-mcp/proposal-convergence/install 同构）。
2. **known-load-sensitive.ts**——`KINDS` 加 `child-spawn`（收编机制是标注驱动扫描——`listTestFiles` 按 `// @load-sensitive <kind>` 自动收进家族，无手工成员表；`--check` 强制「有 KNOWN-LOAD-SENSITIVE 头声明 ⇒ 必有 @load-sensitive」，两者齐备）。AC2 的「known-load-sensitive.ts 条目」即 KINDS 扩展，非重复手工列表。
3. **AC3 失败诊断**——harness 顶层 5 个测试调用包 try/catch；spawn 失败/顶层异常写同步 `FAIL: <err.stack>` 到 fd 2 并置 `process.exitCode = 1`（同 writeErr 同步契约，node --test 异步 stderr 管道不可丢）；断言核心不削弱。成功消息只在无故障时打印（`process.exitCode === undefined` 守卫）。
4. **AC4 家族交叉标注**——create-mcp / proposal-convergence / install-family / load-sensitive-serial-phase / phase-order 五个任务 Touches 各加本任务交叉标注行。

### 验证

- **solo**：`node --no-warnings --experimental-strip-types --test packages/quay-native/test/relation-sync.test.mjs` → 19/19 PASS、`All M35-native-relation-sync tests passed.`、exit 0。
- **scanFamily**：`kindForFile(f, 'packages/quay-native/test/relation-sync.test.mjs')` → `child-spawn`。
- **known-load-sensitive --check**：`ok — every KNOWN-LOAD-SENSITIVE header claim carries @load-sensitive <kind>`；`--list` 含 `packages/quay-native/test/relation-sync.test.mjs\tchild-spawn`。
- **known-load-sensitive.test.mjs**（solo）：14/14 PASS（无 family-count 回归）。
- **scoped 门**：`bash scripts/test.sh --for-task gap-relation-sync-load-flake-child-spawn-under-suite --allow-thin` → exit 0、fail 0、cancelled 0（relation-sync + known-load-sensitive 全绿）。
- **失败诊断实测**：在 try 内注入 `throw new Error("SIMULATED_SPAWN_FAILURE")` → 写 `FAIL: Error: SIMULATED_SPAWN_FAILURE` + stack 到 fd 2、exit 1（不再静默 passed=false）。
