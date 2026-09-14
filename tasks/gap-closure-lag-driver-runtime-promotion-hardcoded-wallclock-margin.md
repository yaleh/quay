---
id: gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin
title: 三个测试文件的硬编码墙钟余量在负载下击穿（closure-lag-check / driver-runtime / promotion-driver）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**轮次**: 2026-09-13 round 3（worker，gap-goal-sufficiency-prompt-blind-to-scope 任务的 fan-in）
**结论**: 该轮 fan-in 全量 suite 的 3 条红与该任务的 delta 无关，是**负载相关的墙钟余量脆测**
（load-correlated wall-clock-margin flake）——三个测试文件各自把一个墙钟余量写成了硬字面值，
在高并发负载下文件自身运行时间变慢 2–3 倍即可击穿该余量。

### 1. 失败的三条（全部来自 `~wk-prod-1789139008~1789320730372-59df6c.log`）

| 测试文件 | 断言 | 失败文本 | 该文件本轮用时 | 同 lineage 绿跑用时 (ac252, 1789317948862) |
|---|---|---|---|---|
| `plugin/test/closure-lag-check.test.mjs:171` | `\|parsed.ranAt - nowEpoch\| < 60` | `trace timestamp is fresh` | 116s | 27s |
| `plugin/test/driver-runtime.test.mjs:617` | `start > Date.now() - 60_000` | `procStartTimeMs 合理` | 139s | 36s |
| `plugin/test/promotion-driver.test.mjs:636` | `r.exitCode === 3`（`spawnFixWorker(..., 5000)`） | `exit code recorded` | 222s | 70s |

三条形状完全相同：一个写死的墙钟余量（60s 模块加载余量 ×2、5000ms spawn 超时 ×1），被「文件本身
在并发下降速 2–3 倍」击穿。三条都不在触发该轮 fan-in 的原任务 Touches 内
（原 Touches = `goal-driver.ts` + 2 个 goal-sufficiency 测试）。

- `closure-lag-check.test.mjs:90` 的 `nowEpoch` 在模块加载时取值，断言要求 `--record` 的
  写入时刻落在其后 60s 内 ⇒ 该文件只要跑超过 60s 必红（本轮 116s，绿跑 27s）。
- `driver-runtime.test.mjs:617` 用 `procStartTimeMs(process.pid)` 与 `Date.now()-60_000` 比 ⇒
  测试进程自身存活超过 60s 必红（本轮文件 139s）。
- `promotion-driver.test.mjs:636` 给 `spawnFixWorker` 传死字面 `5000` ms 超时 ⇒ 并发下子进程
  超过 5s 即判超时，`exitCode` 不是 3（本轮文件 222s）。

### 2. 判别性对照（硬规则 4 推论四：造一个能区分的对照）

**对照 A（隔离运行，delta 在两条件中都存在 ⇒ delta 不可能是差异源）**
在同一个 worktree、同一个 delta 下单独跑这三个文件：

```
node --test plugin/test/closure-lag-check.test.mjs plugin/test/driver-runtime.test.mjs plugin/test/promotion-driver.test.mjs
⇒ exit 0，fail 0；三条具体测试全部 ✔
   ✔ AC3 — --record --flipped N writes timestamp + flip count; measure reads it fresh (2461ms)
   ✔ supervisor-stale — supervisorStaleness 三态 (8.26ms)
   ✔ gap-fix-worker-spawn-timeout-persists-post-fix AC4 — failure record carries argv + durationMs + exitCode (279ms)
```

⇒ 同一份代码，并发=22 时红、隔离时绿 ⇒ 差异源是负载，不是 delta。

**对照 B（跨轮次）** 同一 develop lineage 的近期 fan-in 跑：

| 跑 | tests | fail | closure-lag | driver-runtime | promotion-driver |
|---|---|---|---|---|---|
| ac252 `1789317948862` | 4760 | 0 | 27s | 36s | 70s |
| 触发本条 finding 的任务 `1789320730372` | 4760 | 3 | 116s | 139s | 222s |

同一 develop 内容、同一测试总数（4760），三条在 ac252 全绿。

**对照 C（跨任务：flake 非某单一任务独有）** 近期每次 fan-in 都至少一条红，且每次红的测试都不同：

```
ac252                                → 0 fail
quay-init-profiles 1789305506637     → packages/quay/test/install-config-driven-e2e.test.mjs:300
observation-hard  1789293616079      → plugin/test/driver-runtime.test.mjs:716   ← 同一文件、另一条断言
goal-driver-ring  1788723279654      → packages/quay-native/test/relation-sync.test.mjs
closure-ratchet   1788712293864      → serve.test.mjs + cap-from-gate-{cli,bands,config-budget,hysteresis}
writestate-atomic 1788699165902      → plugin/test/writestate-atomicity-split.test.mjs
```

不同的测试每次失败是负载相关 flake 的签名；`driver-runtime.test.mjs` 在别的任务的跑里
（:716，另一条断言）也红过 ⇒ 与触发本条 finding 的那个具体任务的 delta 无关，可由第三方任务复现。

### 3. 机械 delta-relatedness 与实测一致

该轮 driver 给出的提示判这三个文件对触发任务 = `UNRELATED`（不在 Touches/diff，direct import
不相交）。上面的对照 A/B/C 独立证实了这个提示——没有采信提示本身。

### 4. 现状核查（立案时补做，`known-load-sensitive.ts` 注册表当前未覆盖这三个文件）

```
$ node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list | grep -E "closure-lag-check|driver-runtime|promotion-driver"
（无输出，exit 1）
```

三个文件头部均无 `// @load-sensitive` 或 `// KNOWN-LOAD-SENSITIVE` 注解。三条断言把墙钟余量写成
了硬字面，与 CLAUDE.md 硬规则 4 推论二同族（「依赖宿主/负载状态的字面值」）。

## AC

- [ ] `closure-lag-check.test.mjs` 的 fresh-timestamp 断言（现 `:171` 附近）不再依赖固定 60s 模块
      加载余量——`nowEpoch`（或等价基准）改为在断言前取值，或改为 `parsed.ranAt <= Date.now()`
      一类不设余量上限的比较，语义（"记录是刚刚写的"）不变；`node --test plugin/test/closure-lag-check.test.mjs` 单独跑 exit 0
- [ ] `driver-runtime.test.mjs` 的 procStartTimeMs 断言（现 `:617` 附近）改为与测试进程实际启动
      时刻比较，不再使用硬编码 `Date.now() - 60_000`；`node --test plugin/test/driver-runtime.test.mjs` 单独跑 exit 0
- [ ] `promotion-driver.test.mjs` 传给 `spawnFixWorker` 的超时字面值（现 `:636` 附近的 `5000`）
      改为在正常负载下不会误触发超时的宽松值，或断言改为「exitCode===3 或 timedOut 均可、但
      argv 逐字校验」；`node --test plugin/test/promotion-driver.test.mjs` 单独跑 exit 0
- [ ] 三个文件的最终状态在 `known-load-sensitive.ts --list` 输出与 DoD 里的落地方式一致——若选择
      「消除硬编码墙钟依赖」（AC 前三条）则三个文件可以不进入该注册表；若改为「登记为已知负载
      敏感」则三个文件头部须新增 `// @load-sensitive wall-clock`，且
      `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --check` exit 0
- [ ] 落地后至少一次全量 fan-in suite 跑（`verification-round.jsonl` 等价载体，落地提交之后的轮次，
      按硬规则「推论三」窗口约束）里，这三个测试文件不再出现在该轮失败列表中——若立案时尚无
      该轮次，在 DoD 里明确记录「待下一次 fan-in 验证」并给出如何核验的命令，不得用隔离跑代替

## DoD

真实落地 = 上述三个测试文件（或注册表二选一路径里被登记的文件头部）的改动实际合入 develop
（`git show develop:plugin/test/closure-lag-check.test.mjs` 等命令能看到改动后的内容），而不仅
是本任务体里写了修复方案。落地后必须有至少一次真实 fan-in 全量 suite 跑经过这三个文件且不再
因本条描述的墙钟余量问题失败（隔离跑绿只是必要非充分条件，不能替代生产载体上的验证——同硬
规则「推论三」：只能被 fixture/单独隔离满足的判据不是测量）。

## Touches

- `plugin/test/closure-lag-check.test.mjs`
- `plugin/test/driver-runtime.test.mjs`
- `plugin/test/promotion-driver.test.mjs`
- `plugin/scripts/known-load-sensitive.ts`（仅当选择注册表路径）
- `tasks/gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin.md`
