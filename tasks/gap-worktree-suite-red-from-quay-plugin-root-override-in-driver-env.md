---
id: gap-worktree-suite-red-from-quay-plugin-root-override-in-driver-env
title: worktree 全量套件结构性恒红 —— driver 环境带的 `QUAY_PLUGIN_ROOT` 覆盖指针 +
  一条把【断言者所在树】当【kernel 安装树】的断言（loop 自 2026-09-14T06:40Z 起零落地）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

**直接读数（2026-09-14 06:40Z 起，两次独立 fan-in 全量轮）**：`plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs`
的 `AC3a'` 在 **worktree 里**恒红 ⇒ 全量套件红 ⇒ fan-in 不落地：

```
.quay/verification-round.jsonl r1688 (06:40:42Z, task gap-abi-task-list-times-out-at-2000-tasks-…)
  perFile plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs passed=false
r1689 (06:56:20Z, task gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config)  同上 passed=false
同一文件 r1686 (05:42Z) 及此前**每一轮** passed=true
```

断言逐字（`:190`）：`assert.ok(cfgPath.startsWith(REPO_ROOT), "配置路径必须落在 quay 安装树下（⛔ 非 workspace root）")`，
其中 `REPO_ROOT = path.resolve(__dirname, "..", "..")`（= **该测试文件所在的那棵树**），
`cfgPath = kernelConfigPath("scripts/drivers.yml")`。

**根因（两条读数并列，不是自洽说法）**：

1. **运行时探针**（在 worktree 内直调生产函数）：
   ```
   process.env.QUAY_PLUGIN_ROOT = "/home/yale/work/quay/plugin"
   resolveQuayCodeRoot()                = /home/yale/work/quay          ← 主检出，⛔ 不是 worktree
   kernelConfigPath("scripts/drivers.yml") = /home/yale/work/quay/plugin/scripts/drivers.yml
   ```
   ⇒ `cfgPath.startsWith(<worktree root>)` 为假 ⇒ 断言必红。
2. **两向对照（区分性检查，一条命令）**：
   ```
   env -u QUAY_PLUGIN_ROOT node --test plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
     ⇒ ✔ AC3a' 通过
   同一命令在不 unset 的环境下跑 ⇒ ✖ AC3a' 失败
   ```
   ⇒ **触发量已确证是环境变量**，与代码改动无关（本任务分支未触碰 `driver-runtime.ts`：`git diff develop -- plugin/scripts/driver-runtime.ts` 为空）。

**它怎么进来的**：全仓 grep 确认**没有任何生产代码设置** `QUAY_PLUGIN_ROOT`（只有测试与 `packages/quay/src/plugin-root.ts` 的读取侧）。
它是**启动 driver 的那个进程**的环境里的值。driver 六个 kind 于 `2026-09-14T06:33:06-06:33:25Z` 被整体重启，
重启后的 supervisor/driver 环境含该键：

```
$ tr '\0' '\n' < /proc/2781865/environ | grep QUAY_PLUGIN_ROOT     ≈ /home/yale/work/quay/plugin   (promotion supervisor)
$ ps -o lstart= -p 2781865  ⇒ Mon Sep 14 06:33:06 2026
```

`plugin/scripts/suite-driver.ts:180`（`spawnSuiteAndWait`）以 `env: { ...process.env, ...(env ?? {}), QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT: "1" }`
spawn 全量 suite ⇒ 该键被**继承进每一轮 worktree 套件** ⇒ `resolveQuayCodeRoot()` 指主检出。
时间线自洽：05:42Z 的 r1686 仍绿（重启前），06:40Z 的 r1688 起红（重启后），中间正是 06:33Z 的那次重启。

**为什么这是"结构性"而不是一条 flaky**：`scripts/test.sh` 的 worktree 套件路径**必然**继承 driver 环境，
而 `QUAY_PLUGIN_ROOT` 是 `plugin-root.ts` 文档化的**显式指针/测试缝**（operator override），
设计上允许被设置 ⇒ 只要 driver 环境里有它，**每一个任务的 fan-in 全量套件都会红**，与本任务改了什么无关。
观测到的直接后果：**自 06:40Z 起 0 个任务落地**（r1688/r1689 两轮 fan-in 全部 `exited-not-landed`）。

**两个候选修法（判定权不在本条立案者，需 owning layer 显式选定并留理由）**：

- **(a) 环境面**：六个 kind 从**不含该键**的环境重启（该键是 operator override，不是生产配置）。
  零代码改动；修完的判据见 AC3。
- **(b) 代码/测试面**：承认「operator 可以合法地把 kernel root 指向别处」是本机制的设计语义，
  则 `AC3a'` 的 `REPO_ROOT` 是**代理量**（它假定"断言者所在树 == kernel 安装树"，即假定 override 不存在），
  应换成直接量（如 `cfgPath.startsWith(<resolveQuayCodeRoot() 解析出的那棵树>)`，或显式断言
  「`cfgPath` 落在 `resolveQuayCodeRoot()` 所指的安装树下，且**不**落在 `REPO_ROOT` 的 `plugin/scripts` 之外」）。
  ⛔ **不得**改成"只要 existsSync 就算过"——那会把本测试存在的理由（driver 不得按 workspace root 解析）一起删掉。

⚠️ 两条修法**互斥地解决同一个现象**；(b) 若被选中，必须补**两向控制**（有/无 `QUAY_PLUGIN_ROOT` 两种环境下都断言同一语义），
否则 (b) 会把 (a) 这类真实异常也一起放行。

**与既有条目的关系**：`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（done）修的是
「归因不出测试文件时仍重派」的**派发策略**；本条有**明确可归因**的测试文件与**已确证**的触发量，是另一个机制，
⛔ 不视为重复。`gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin`（ready）是墙钟余量击穿，
与本条差一个量（那条是负载相关、本条是环境相关）。

## Acceptance Criteria

- [ ] **AC1 根因判定带对照（⛔ 不接受自洽解释）**：贴出**两向对照**读数 —— 同一测试文件在
      `env -u QUAY_PLUGIN_ROOT` 与含该键两种环境下各跑一次，前者 `AC3a'` 通过、后者失败；
      并贴出修法选定的**理由**（(a) 还是 (b)，以及为什么另一条不选）。
- [ ] **AC2 修法落地且可核**：若选 (a)，贴出重启后 **driver 进程环境**的直接读数
      （`tr '\0' '\n' < /proc/<driver_pid>/environ | grep QUAY_PLUGIN_ROOT` ⇒ 空）与六个 kind 的重启时刻；
      若选 (b)，贴出改动后**两向控制**（有/无该键两种环境下 `AC3a'` 都通过），
      且证明它仍能取假（在真正的"按 workspace root 解析"的红夹具上必须失败）。
- [ ] **AC3 生产读数（硬规则 4 推论三：读生产载体，⛔ 不是夹具）**：修复后**至少一轮 worktree 全量套件**
      在 `.quay/verification-round.jsonl` 里对该文件留 `perFile … passed=true` 的记录
      （贴 round 号 + startedAt + commit），且该轮之后**至少一个任务落地**（fan-in 走完 ff）。

## Definition of Done

上一条 AC3 的两项读数都在**真实生产轮**里出现（worktree 全量轮的 perFile 绿 + 其后至少一个任务落地），
且 AC1/AC2 的对照读数贴在该条任务体里。⛔ 「本地跑一次绿」不算达成——本条的现象只在
「driver 进程环境 + worktree 套件」这个组合下出现，夹具复现不出。

## Touches

- plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
- plugin/scripts/suite-driver.ts

（若选 (a) 环境面，则本任务零代码改动，Touches 保留为「两条候选修法的落点」并在任务体注明实际未改。）