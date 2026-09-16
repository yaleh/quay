---
id: gap-dashboard-driver-status-card-ci-red
title: gap-dashboard-driver-status-card.test.mjs 在 GitHub CI 上 5 个断言真实失败，本地未复现过
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-265
---
## Finding

2026-09-16 `develop` push 后的 CI run（`https://github.com/yaleh/quay/actions/runs/35054411272`，
job `test` id `104661434192`）里，`packages/quay/test/gap-dashboard-driver-status-card.test.mjs`
以 `passed=false` 收尾（`04:20:30.3591923Z`），5 个断言真实失败（发生在 25 分钟超时把整个 job 杀掉**之前**，
与超时无关）：

```
✖ AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (all kinds alive)
    AssertionError [ERR_ASSERTION]: one reading per KNOWN_KINDS
✖ AC1: ...（pid 缺失 → dead）
    AssertionError: reading for promotion must be present
✖ AC1: ... matches `driver-runtime.ts status --json`（kernel 子进程端到端）
    AssertionError: reading for promotion must be present
✖ AC7: 5 个存活 kind 渲染「运行中」...
    AssertionError: promotion must render 运行中
✖ AC7 负控制: 删 pid 文件 ⇒ ...
    AssertionError: quality must start 运行中
```

该测试文件本身是自包含的（`makeTmpDir` 隔离临时目录 + 手写 fixture pid/carrier 文件，`writeAllFixtures`
对 `KNOWN_KINDS` 逐一写好，不依赖任何环境里真实常驻的 driver 进程），所以"CI 环境没有本地那种常驻 driver
进程"这个最直观的猜测**站不住**——测试本来就不该依赖真实进程存活。

真正的信号是第一条断言：`readDriverStatus(root)` 返回的数组长度**少于** `KNOWN_KINDS.length`——
即至少有一个 kind 在这次调用里完全没有读数，而"缺的是哪个 kind"在不同断言里不一样（`promotion` 出现
两次，`quality` 出现一次），这更像**非确定性**（可能与 CI runner 的 CPU/并发限制相关——该测试对每个
KNOWN_KINDS 都会 `execFileSync` 起一个 `driver-runtime.ts status --json` 子进程，一个测试里就是六次
子进程调用，在共享/限流的 CI runner 上比本机更容易撞上时序问题），也可能是 `readDriverStatus`/
`aliveness`/`carrierStats` 遍历 `KNOWN_KINDS` 时的真实并发/遍历 bug——本任务不预判是哪一种，需要实测
区分（仓库里已有"负载相关 flake 不要往自己 delta 上找"的先例，但也不能不经复现就直接归为 flake）。

## AC

- [ ] 在人为限制 CPU/并发的本地环境（例如 `cpulimit`、Docker `--cpus`，或干脆并发跑多份同一测试文件制造资源争用）下重跑该测试 ≥5 次，统计"某个 kind 读数缺失"是否可复现，用来区分负载相关 flake 与确定性回归。
- [ ] 若确定性复现：定位 `readDriverStatus`（`packages/quay/src/observation.ts`）遍历 `KNOWN_KINDS` 时哪一步会漏掉某个 kind（例如子进程调用失败被吞掉却没有让对应 kind 落入返回数组），修复它。
- [ ] 若判定为负载相关 flake：不能只凭这一次 CI 红下结论——必须给出"同一份代码在低负载下必过"的负控制读数，并按仓库已有 flake 处理惯例登记（不是简单加 retry 掩盖）。
- [ ] 无论走哪条分支，`node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs` 单独重跑需要给出至少 5 次连续绿的读数（而不是 1 次）。

## DoD

下一次 `develop` 分支触发的 GitHub CI `test` job 日志里，`gap-dashboard-driver-status-card.test.mjs`
以 `passed=true` 出现；若判定为已知负载相关 flake，则任务体/载体里留一条可核的判定依据（复现率、负控制读数），
而不是仅凭一次绿就视为解决。

## Root cause（实测，2026-09-16）

**判定：不是负载相关 flake，是【状态相关】的确定性失败**——`readDriverStatus` 返回的是**空数组**
（不是"某个 kind 缺失"），CI 断言原文即 `0 !== 6`（`actual: 0, expected: 6`）。

失败的**直接量**是整个 kernel 没能载入，链条如下（每一步都有实测读数）：

1. `packages/quay/test/delivery-standalone-smoke.sh:51-56`（由 `delivery-standalone-smoke-gate.test.mjs`
   驱动，该文件在 CI 失败窗口内**正在运行**：`__PERFILE__` 显示其生命周期 140428ms 覆盖了 04:20:27–30）
   在**共享检出**里把 `plugin/` 拷成 `<repo>/packages/quay/plugin` —— raw `.ts` 齐全，**没有 `scripts/dist/`**，
   pack 完再 `rm -rf` 删掉。CI 日志里看不到这一步的输出（该脚本 55 行把 `npm pack` 重定向掉了）。
2. 该窗口内 `plugin-root.ts::resolvePluginRootFrom(<repo>/packages/quay/src)` 在**第 1 层**就锚定到
   `packages/quay/plugin`（比第 3 层的真 source checkout `<repo>/plugin` **更近**）。
3. 暂存树不是 source checkout ⇒ `resolvePluginScriptExec` 先找 `scripts/dist/driver-runtime.js`（不存在）
   ⇒ 回落到那份 raw `.ts`；而暂存树缺它的兄弟 `.mjs` 与 `../../packages/quay/src/*.ts` 再导出 ⇒
   `import()` 抛 `ERR_MODULE_NOT_FOUND`（实测原文：`Cannot find module
   '<…>/packages/quay/plugin/scripts/workflow-event-schema.mjs' imported from <…>/fast-workflow-event…`）。
4. `observation.ts::loadDriverRuntime` 的 `catch {}` 把它吞成 `null` ⇒ `readDriverStatus` 返回 `[]`
   ⇒ 卡片渲染「Driver 状态未接入」⇒ 就是那 5 条断言。

**读数（全部本地实测，fresh clone @ CI 同一 commit `52de0abb4d`，`mainCheckoutRoot` 为 null 故走 walk-up）**：

| 条件 | pre-fix | post-fix |
|---|---|---|
| 暂存快照在（`packages/quay/plugin`，无 dist） | **5/5 红**（`pass 6 / fail 5`，与 CI 同签名） | 5/5 绿 |
| 干净树 | 绿（8/8 并发下亦全绿） | 5/5 绿 |
| 状态逐轮交替（clean/snapshot 交替 6 轮） | 绿/红/**严格交替 3+3** | — |
| 全量套件 `--test-concurrency=8`（CI 同一路径） | **复现**（同一文件、同一 `0 !== 6`） | — |

**负控制（反驳"负载/并发"假设）**：pre-fix 代码 + 干净树 + **8 份并发**同跑该文件 ⇒ **8/8 全绿**
（`ℹ pass 11 ℹ fail 0`）。故资源争用本身不产生该失败；"间歇"来自那个**暂存窗口本身是瞬时的**
（谁并发跑到窗口里谁红），这也解释了为什么单文件本地重跑从不复现。

**修法两处**（Touches 已列）：
- `packages/quay/src/plugin-root.ts`：walk-up 优先**source checkout** 候选，⛔ 不再让更近的**派生快照**
  （pack-time staging snapshot）压过它；八个层级内无 source checkout（npm-global / marketplace / vendored
  等出厂布局）时回落到**最近的锚定候选**，即改动前的行为不变。
- `packages/quay/src/observation.ts`：`loadDriverRuntime` 的两种失败不再共用 `null` 一个取值——记入
  `driverRuntimeLoadError`（硬规则 3b：「读不懂 ⇒ 伪装成合格」）。形状与渲染（`DriversReading` 数组、
  「未接入」）不变，只是失败从此**可诊断**；本任务因此不再需要"从一条 `0 !== 6` 反推是哪种失败"。

**遗留（本任务不修）**：`delivery-standalone-smoke.sh` 往**共享检出**写 `packages/quay/plugin` 属
test-isolation R2 类（共享构建产物写）——它已被 `plugin/test-isolation-violations.txt` 记为已知项一族，
本任务只消除它对**读取方**的杀伤（resolver 不再被派生快照误导），staging 侧是否改为临时树另案。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/plugin-root.ts
- packages/quay/test/gap-dashboard-driver-status-card.test.mjs
- packages/quay/test/plugin-root.test.mjs
- tasks/gap-dashboard-driver-status-card-ci-red.md
