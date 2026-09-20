---
id: gap-fan-in-instrument-availability-self-check
title: 仪器可用性自检——driver 启动时与每次 fan-in 进 suite 之前探测分类器/reaper 是否可解析，结果作为事实记录并在
  driver status 与观测面可见（只记录、不拦截）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-classify-delta-registry-path-layout-aware
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（要求「解析不到 ⇒ 显式 not-evaluated」）。

**问题**：证书闸的分类器与 ff-merge 的 reaper 是否可解析，目前只在**suite 跑完之后**才被发现（`classifyDeltaVerdict` / `siblingScriptArgv` 返回 null），人和 driver 都看不到「这台安装里这两个仪器根本找不到」这个事实，直到任务被打成 needs-human。另一项目里 reaper 日志 `worktree-process-reaper not resolvable` 只出现在失败路径上，被当成无害噪声。

**为什么只记录、不拦截（设计取舍，必须留档）**：曾设想「suite 之前探针失败就 fail-fast」。但与 `gap-fan-in-cert-flip-commit-identity-inert` 交互后，外部项目里 flip 提交已按身份判惰性、并不需要分类器；一个无条件拦截的探针会让**没有 registry 的项目里每个任务都死在 suite 之前**，比现状更糟。人裁定（2026-09-20）：不自动停 driver、重试上限不变。故本任务只把探测结果作为**事实**暴露。如需拦截形态，须另行裁定并先给出「探针失败但 delta 本来不需要分类器」的发生率读数（硬规则 12）。

**做法**：① `ff-merge.ts` 导出 `probeInstruments(root, scriptsDir)`，返回 `{classifier: {evaluated: true|false, detail}, reaper: {evaluated, detail}}`（`evaluated:false` 是独立取值，不与「可用」共用，硬规则 3b）；分类器探针 = 对该 root 真跑一次 `--classify-delta` 探测路径，reaper 探针 = `siblingScriptArgv` 解析。② worker-driver 在每次机械 fan-in 进 suite 之前调用它，把结果写入该次 outcome 记录的 `mechanical_fan_in.instruments` 字段；driver 启动时也探一次并写日志。③ `quay driver status --kind worker` 输出这两项的当前读数。④ 不改任何派发、重试、needs-human 逻辑。

## AC

- [x] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例：有 registry 的 root ⇒ `classifier.evaluated=true`；无 registry 的 root ⇒ `evaluated=false` 且 detail 含尝试过的候选路径；reaper 解析不到 ⇒ `reaper.evaluated=false`（三个用例都断言与「可用」取值可区分）。
- [x] `node --test plugin/test/worker-driver.test.mjs` exit 0，新增用例：探针在 suite 步骤**之前**执行（以 trace 顺序断言），探针 `evaluated=false` 时 suite **照常执行**（拦截不发生的负控制），且 outcome 记录含 `mechanical_fan_in.instruments`。
- [x] `node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind worker` 在 fixture workspace 中输出两项仪器读数；探针失败时输出 `evaluated:false` 与 detail，退出码不变（不因此变非零）。
- [x] `scripts/test.sh --for-task gap-fan-in-instrument-availability-self-check` exit 0。

## DoD

在一个真实的无 registry 外部项目上启动 worker driver，`driver status` 显示分类器 `evaluated:false`、reaper 读数如实；随后一个任务的 outcome 记录里带同样的 instruments 读数；driver 与任务的派发、重试、needs-human 行为与本任务前逐字相同。

## Evidence

**交付物**：`ff-merge.ts` 导出 `probeInstruments()` + `InstrumentReading`/`InstrumentProbe`（分类器探针 = 对该 root **真跑**一次 `--classify-delta`，⛔ 不是存在性检查；reaper 探针 = `siblingScriptArgv` 解析；`siblingScriptCandidates()` 是「试过哪些候选路径」的单一真相源，故 detail 与解析器不可能各说各话——硬规则 5b）；worker-driver 在每次机械 fan-in **进 suite 之前**探针，读数写进该次 outcome 的 `mechanical_fan_in.instruments`（fan-in 在探针之前就失败 ⇒ 记 `instruments:null`，即「未评估」，⛔ 不伪造读数）；`quay driver status --kind worker` 经 `withInstrumentReadings()` 输出两项读数（`--json` 就地合并成单个对象）。⛔ **只记录**：探针不参与任何控制流——不改派发、不改重试上限、不改 needs-human、⛔ 不改退出码。

**AC 逐条验证（2026-09-20，worktree `…/gap-fan-in-instrument-availability-self-check`）**
- **AC1** `node --test plugin/test/fan-in-ff-merge.test.mjs` → exit 0，**54 pass / 0 fail**，含两条新用例（有 registry ⇒ `classifier.evaluated=true`；无 registry ⇒ `false` 且 detail 列出试过的候选路径；reaper 同形）。
- **AC2** `node --test plugin/test/worker-driver.test.mjs` → exit 0，**103 pass / 0 fail**，含 AC2 两例（探针在 suite **之前**、读数落进结果、`evaluated=false` **不**拦截 suite）与 AC3 一例。
- **AC3** 同上的 AC3 用例：`quay driver status --kind worker` 打印两项读数；探针 NOT-evaluated 时退出码仍为 0（`evaluated:false` 与「可用」取值可区分）。
- **AC4** `bash scripts/test.sh --for-task gap-fan-in-instrument-availability-self-check --allow-thin` → exit 0，**242 pass / 0 fail**。附带 `npx tsc --noEmit -p packages/quay` exit 0。

**同时修掉的、由本任务 delta 引入的 suite 红（fan-in 第 2 轮 `exited-not-landed` 的真因）**
`packages/quay/test/serve.test.mjs` AC1 红了：`the refused second CLI start exits 0 … got 2; stderr=fan-in-ff-merge: --task <taskId> is required`。**隔离运行同样 red ⇒ 真实缺陷，不是负载敏感的 flake**（该文件虽带 `@load-sensitive child-spawn`，但那是提示不是判决；硬规则 4b）。

**真因**：`cli/driver.ts` 新 import 了 `fan-in/ff-merge.ts`，于是 `quay serve`（经 driver.ts）把 ff-merge 的模块体拉进**打包产物** `dist/quay.js`。ff-merge 原来的直入口守卫是 **URL 式**的（`import.meta.url === pathToFileURL(process.argv[1]).href`）——单文件 bundle 里**每个被内联的模块共享 bundle 自己的 `import.meta.url`**，因此它恒等于 `process.argv[1]`，守卫在**每次** `quay` 调用上都为真：它拿 serve 自己的 argv 去跑 `ffMerge`，没有 `--task` ⇒ 打印该 stderr 并把 `process.exitCode` 置 2，**覆盖了 serve 准入拒绝路径文档化的 exit 0**。

**修法**（提交 `760b38f4a`）：改用本仓库既有的**按文件名**形式——同款缺陷、同款修法见 `packages/quay/src/goal-store.ts:3107` 与 `plugin/scripts/worktree-process-reaper.ts:633`。Core ⛔ 不能 import `plugin/scripts/gate-script-base.ts` 的 `isDirectEntry`（self-contained-dist 不变量），故按 Core 侧先例内联 `.endsWith("ff-merge.ts")` 形式；顺手删掉随之无用的 `pathToFileURL` import。探针「只记录、不拦截」的行为一字未动。

**为何不新增单测**：在 `node --test` 下 `process.argv[1]` 是**测试文件**，URL 式旧守卫在该上下文里同样是 false ⇒ 任何 unit 级用例**恒真、空转**（硬规则 4c：判据恒真但什么也没验到）。能取假的只有**打包形态**，而 `serve.test.mjs` AC1 恰是这个形态：它在真缺陷上红、修好后绿——它已经是这条缺陷的判据。（Core 侧现已无 URL 式直入口守卫；`plugin/scripts/*` 那约 20 处同族 URL 守卫既不在本任务 Touches 内，Core 也不 import plugin，故不动，留作已知族。）

**判据取证（按位置，硬规则 2）**：新 bundle 上 `grep -c "fan-in-ff-merge" <stderr>` = **0**（修复前 = 1）；`grep -n 'endsWith("ff-merge.ts")' dist/quay.js` 命中守卫一行；`serve.test.mjs` 重跑时**无** `cli-entry: … STALE/MISSING` 回退告警 ⇒ 跑的确实是**新 bundle**，⛔ 没走「stale bundle 回落 `.ts` 源码」那条会假绿的路（该测试自己的注释正警告这一形态）。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/scripts/worker-driver.ts
- packages/quay/src/cli/driver.ts
- plugin/test/fan-in-ff-merge.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-fan-in-instrument-availability-self-check.md
