---
id: gap-drivers-yml-interval-not-honored-for-routine-kinds
title: drivers.yml 声明的 interval_ms 对例程型 kind 未生效 —— 声明 30 秒，实际是 supervisor 每 5 秒重启一次
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-13 实测，在 ad-arm1 的 archguard 上）**：`plugin/scripts/drivers.yml` 为 `goal`/`quality`/`meta` 三个例程型 kind 声明 `interval_ms: 30000`，而 `.quay/goal-driver-supervisor.log` 的实际节奏是 `driver exited code=0` → `respawning driver in 5s`，每 5 秒一次。

**根因（本任务实测定位，与立案时的两个候选**都不同**，本机已可复现且与 ad-arm1 逐字一致）**：**被打进 `plugin/scripts/dist/` 的例程型 driver bundle 跑的不是它自己的 main，而是被 inlined 的 `pool-quality-judge` 的 main。**

机制：一个模块的「我是入口吗」守卫写成**文件身份**（`realpath(argv[1]) === import.meta.url`、`fileURLToPath(import.meta.url) === argv[1]`、无第三参数的 `isDirectEntry(import.meta)`）在源码布局下正确，但**在 bundle 里对每个 inlined 模块都为真**（它们共享 bundle 的 `import.meta.url`）；esbuild 把 import 排在 importer 之前 ⇒ **第一个这样的 inlined 守卫胜出**，bundle 跑错工具的 main。

实测（本机 `build-plugin-dist.mjs` 产物）：

```
dist/goal-driver.js        --help -> pool-quality-judge.ts — pool 任务质量语义闸…
dist/quality-gate-driver.js --help -> pool-quality-judge.ts — pool 任务质量语义闸…
dist/meta-driver.js        --help -> pool-quality-judge.ts — pool 任务质量语义闸…
dist/outer-driver.js       --help -> outer-driver — AC143…      （正确）
dist/promotion-driver.js   --help -> promotion-driver — AC130…  （正确）
dist/worker-driver.js      --help -> worker-driver — SPEC §5…   （正确）
```

进程 <1s `exit 0` ⇒ supervisor 按 `--restart-delay`（缺省 5s）重启 ⇒ **声明的 `interval_ms` 从未进入节奏**——不是「值没被读到」，而是**读它的那个进程从未跑起来**。

⇒ 立案时的两个候选都不是：`interval_ms` **有**消费者（AC2），那 5 秒**不是**新的轮询节奏而是 supervisor 的**崩溃退避**（AC4）。**仓库自己早已认识这个机制**（`gate-script-base.ts` 的注释与 `gap-shipped-ts-files-are-not-bundled-…` 早就写明「bundler-friendly」的三参数形式），只是有 **25 处**没跟上迁移，另有 **4 处手搓了等价的文件身份守卫**（我的第一个检测器只扫 `isDirectEntry`，漏掉手搓形态——两个独立读法互校才发现）。

**顺带查到、本任务一并接线的第二处**：`meta-driver.ts` 的 `intervalMs` 是**硬编码字面量 `30_000`** ⇒ `drivers.yml meta.interval_ms` 对 meta 这个 kind **确实零消费者**（goal/quality 早已读）。已接成与兄弟同款。

**顺带撞到的不对称（只记录读数，⛔ 不在本任务内实现控制态）**：例程型三个 kind **没有独立的控制态文件**——`goal-control.json` / `quality-control.json` / `meta-control.json` 均不存在，而 `promotion-control.json` / `worker-control.json` 存在 ⇒ 这三个 kind 可能**无法被 halt / drain / resume**（`driver-shared.ts` 的 `isHalted` 只认后两者的载体）。若确认为缺口应另立。

## Plan

1. **定位消费者** → `interval_ms` 对 goal/quality 有真实读取点（AC2 打印命中内容）；对 **meta** 零消费者（`30_000` 硬编码）⇒ 已接线。
2. **定位那个 5 秒** → supervisor 的 `restartDelaySecs`（`--restart-delay`，缺省 5）＝**崩溃退避**，不是轮询节奏（AC4）。
3. **决定正确形态** → **(b) driver 自身常驻、按 interval 循环**。理由：既有设计本就是 (b)（`runResidentQualityGateLoop`），且前驱任务 `gap-drain-on-routine-driver-empties-round-and-respawn-loops` 已把「例程型 driver 常驻、halt 是**轮内闸**不是退出条件」定为设计意图；(a)（supervisor 按 interval 定时重启单轮进程）会让「重启」同时承担节奏与恢复两种语义，把崩溃退避压成轮询，且一旦 driver 真崩溃就无法与正常节奏区分。**⛔ 未实现 (a)，⛔ 两种都实现。**
4. **接线** → ①消除 inlined 入口守卫劫持：25 处无第三参数的 `isDirectEntry(import.meta)` → 具名形式，4 处手搓文件身份守卫 → 走共享机制；②`gate-script-base.isDirectEntry` 的 `expectedBase` 改为**必填**（裸守卫从此是类型错误——机制而非提醒）；③`build-plugin-dist.mjs` 加**构建期 fail-closed 闸** `findEntryGuardHijacks`（有劫持即拒绝打包，带正向/负向控制测试）；④meta 的硬编码缺省改读 `drivers.yml`。
5. **⛔ 未改 promotion/worker** → 两个 bundle 的入口守卫清单 before/after **签名逐字相同**（AC3），源码零改动。
6. **镜像对** → `gate-script-base.ts` 有 `experiments/quay-perpetual-stream/scripts/` 的逐字节镜像对（`mirror-pair-drift-check` 强制），改动已同步到镜像侧（首次 scoped 门因此报 RED，已修）。

## Acceptance Criteria

- [x] AC1 能取假：把某个例程型 kind 的 `interval_ms` 从 30000 改成 90000 ⇒ 实际轮次间隔**随之改变**。**实测对照（本任务留档）**：
  - **改前**：30000 与 90000 **都**是 supervisor 每 5 秒重启一次（`respawning driver in 5s`，两种取值逐字相同、各 5 轮）——即「改它不影响节奏」，与 ad-arm1 报的症状一致。
  - **改后**：`goal.interval_ms=30000` ⇒ 轮间隔 33/34/35/33s（第 1–5 轮，**同一 pid**，`respawn=0`、`started=1`）；`goal.interval_ms=90000` ⇒ 94/93s（第 1–3 轮，同一 pid，`respawn=0`）。比值 3.0×，与声明值之比一致（每轮多出的 ~3–4s 是 goal 环自身的工作时间）。
  - 复现：构建 `plugin/scripts/dist/` → `node dist/driver-runtime.js __supervise --kind goal --root <root> --restart-delay 5`；root 的 `plugin/scripts/drivers.yml` 声明 `goal.interval_ms`；读 `<root>/.quay/goal-round.jsonl` 的 `ts` 与 `goal-driver-supervisor.log`。
- [x] AC2 零消费者已消除：`interval_ms` 对三个例程型 kind 各有至少一个真实读取点（打印命中内容）：
  - `goal` → `goal-driver.ts:3104  : loadDriverConfig(rootDir).goal.intervalMs;`
  - `quality` → `quality-gate-driver.ts:1190  const interval = intervalRaw !== undefined && isNonNegInt(intervalRaw) ? Number(intervalRaw) : loadDriverConfig(rootDir).quality.intervalMs;`
  - `meta` → **本任务接的线**（此前零消费者：`let intervalMs = 30_000;` 硬编码）→ `meta-driver.ts` `const intervalMs = intervalRaw !== undefined && /^\d+$/.test(intervalRaw) ? Number(intervalRaw) : loadDriverConfig(root).meta.intervalMs;`
  - 回归测试：`plugin/test/driver-config.test.mjs` 的「AC2 — the three routine kinds CONSUME drivers.yml <kind>.interval_ms」（三个 kind 各声明 `interval_ms: 1` ⇒ 各 3 轮 ~1s 完成）。**红控制已验**：把 meta 换回 `30_000` ⇒ 该测试 RED（33s 超预算）。
- [x] AC3 不回归：`promotion`/`worker` 的轮询行为与改动前一致。**结构性证据（比时间戳更强）**：三个 bundle 的入口守卫清单 before/after 签名**完全相同**（`promotion-driver 656f3eb7b7ca`、`worker-driver 56641598310c`、`outer-driver b2d5e80e1b87`，`import.meta.url` 行数亦相同）⇒ 本改动对其入口行为零影响；`dist/{promotion,worker,outer}-driver.js --help` 改前/改后都打印自己的 main（改前本就未被劫持）。生产侧时间戳：promotion 轮 3440–3443 = 03:12:26 / 03:13:09 / 03:13:53 / 03:14:36（~43s，同一 pid 1957242）；worker 轮 2326–2329 = 02:58:42 / 03:03:30 / 03:08:34 / 03:13:06（~4–5min，同一 pid 2474258）——均常驻、节奏与改动前一致。
- [x] AC4 那 5 秒有归属：**被保留**，是 supervisor 的**崩溃退避**（`--restart-delay`，缺省 5s），与「正常轮询节奏」是两回事；若被**取代**则等于把恢复语义压成节奏语义。分工已写进代码：`driver-runtime.ts` 的 `SupervisorOptions.restartDelaySecs` 字段注释 + respawn 处注释，含诊断口诀——**supervisor 日志里重启间隔恒等于 `restartDelaySecs` 时，先怀疑「driver 没有进入常驻循环」，而不是「interval_ms 没生效」**。正常 driver 常驻、在自身循环里 sleep `<kind>.interval_ms` 后继续，进程不退出 ⇒ 该退避永不触发。

## Definition of Done

- 四条 AC 满足，AC1/AC3 的时间戳对照有实际留档（见上）。
- ⛔ 不得通过删除 `drivers.yml` 里的 `interval_ms` 声明来「消除不一致」——那是把单一真相源变成没有源。**未删**（`drivers.yml` 本任务零改动）。
- 交付面的回归闸：`findEntryGuardHijacks` 在**构建期** fail-closed（有劫持即 `throw`、拒绝打包），并有正向控制（合成 inlined 裸守卫被捕获）+ 负向控制（具名形式/自研守卫不被误报）+ 产品面行为测试（6 个 driver bundle 各跑自己的 main）。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/gate-script-base.ts
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts
- experiments/quay-perpetual-stream/test/gate-script-base.test.mjs
- plugin/scripts/driver-runtime.ts
- plugin/scripts/meta-driver.ts
- plugin/scripts/pool-quality-judge.ts
- plugin/scripts/dispatch-preference-check.ts
- plugin/scripts/outer-anchor-check.ts
- plugin/scripts/identity-replication-check.ts
- plugin/scripts/task-contract-check.ts
- plugin/scripts/ac56-recommended-deordered-check.ts
- plugin/scripts/check-set-after-change-check.ts
- plugin/scripts/config-key-consumer-check.ts
- plugin/scripts/external-dogfooding-check.ts
- plugin/scripts/inner-wakeup-heartbeat-check.ts
- plugin/scripts/inner-wakeup-heartbeat.ts
- plugin/scripts/instrument-failure-check.ts
- plugin/scripts/judgment-consumer-check.ts
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/scripts/main-thread-edit-check.ts
- plugin/scripts/manager-observation-runtime-check.ts
- plugin/scripts/manager-tick-readings.ts
- plugin/scripts/no-manager-tick-doc-check.ts
- plugin/scripts/provider-binding-resolvability-check.ts
- plugin/scripts/quay-deliver.ts
- plugin/scripts/quay-session.ts
- plugin/scripts/red-on-omission-audit.ts
- plugin/scripts/red-window-triage.ts
- plugin/scripts/semantic-observer-judge.ts
- plugin/scripts/state-worded-clause-check.ts
- plugin/scripts/suite-execution-form-counter.ts
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/scripts/threshold-scope-check.ts
- plugin/scripts/tick-core-static-check.ts
- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- plugin/test/driver-config.test.mjs
- tasks/gap-drivers-yml-interval-not-honored-for-routine-kinds.md
