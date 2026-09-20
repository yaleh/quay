---
id: gap-fan-in-instrument-availability-self-check
title: 仪器可用性自检——driver 启动时与每次 fan-in 进 suite 之前探测分类器/reaper 是否可解析，结果作为事实记录并在
  driver status 与观测面可见（只记录、不拦截）
status: todo
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

- [ ] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例：有 registry 的 root ⇒ `classifier.evaluated=true`；无 registry 的 root ⇒ `evaluated=false` 且 detail 含尝试过的候选路径；reaper 解析不到 ⇒ `reaper.evaluated=false`（三个用例都断言与「可用」取值可区分）。
- [ ] `node --test plugin/test/worker-driver.test.mjs` exit 0，新增用例：探针在 suite 步骤**之前**执行（以 trace 顺序断言），探针 `evaluated=false` 时 suite **照常执行**（拦截不发生的负控制），且 outcome 记录含 `mechanical_fan_in.instruments`。
- [ ] `node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind worker` 在 fixture workspace 中输出两项仪器读数；探针失败时输出 `evaluated:false` 与 detail，退出码不变（不因此变非零）。
- [ ] `scripts/test.sh --for-task gap-fan-in-instrument-availability-self-check` exit 0。

## DoD

在一个真实的无 registry 外部项目上启动 worker driver，`driver status` 显示分类器 `evaluated:false`、reaper 读数如实；随后一个任务的 outcome 记录里带同样的 instruments 读数；driver 与任务的派发、重试、needs-human 行为与本任务前逐字相同。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/scripts/worker-driver.ts
- packages/quay/src/cli/driver.ts
- plugin/test/fan-in-ff-merge.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-fan-in-instrument-availability-self-check.md
