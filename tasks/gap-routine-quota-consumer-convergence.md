---
id: gap-routine-quota-consumer-convergence
title: routine 限流②：probe-routine.ts / meta-driver.ts 真实调用点收敛到独立 Policy 函数 +
  真实全局天花板生效（依赖①落地）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-routine-quota-canonical-config-and-policy-gate
---
**type:** execution

## Proposal

`gap-routine-quota-canonical-config-and-policy-gate` 落地了配置面 + 独立纯 Policy 函数（`routineQuotaDecision`），但过渡期把 `globalCeiling` 硬编码为 `Infinity`，保证那一步零行为改变。本任务是**真正的 consumer convergence**：让两个真实调用点（`probe-routine.ts`/`meta-driver.ts`）都换成读配置得到的**有限**全局天花板，并证明"全部 consumer 真正收敛"而不是"接了线但只有一个用"（搬壳陷阱，`docs/references/ownership-first-refactoring-methodology.md` §2 的三条判据——单一定义处、调用方真的改口、新实现不反向依赖旧写原语）。

**⛔ 明确排除**：不碰"历史立案计数 vs 板压力"的混淆（同上一个任务，仍是独立待裁定问题）；不重启生产 driver 进程。

## Plan

1. **`plugin/scripts/probe-routine.ts`**：`selectFilings`（消费 `countRecentFilings`/`gateFinding` 的真实调用点）改为：① 用 `routineK(root, routine)`（上一任务新增）替代硬编码/透传的 `DEFAULT_RATE`；② 额外读一次 `countRecentFilings(carrier, now, window, null)`（全局汇总，已有能力，只是没被消费）；③ 把 `{perRoutine, global}` 一并喂给 `routineQuotaDecision`（不再调 `gateFinding` 里那条过渡期 `globalCeiling:Infinity` 的硬编码路径——即 `gateFinding` 本身此时应接一个新的可选参数,或本调用点直接调 `routineQuotaDecision` 后再走 `gateFinding` 原有的 quality/dedup 两道闸，具体接法由实现者选，但**两道闸的执行顺序不能变**：quality → dedup → rate/global-rate，顺序错了会把"重复"误判成"超额"或反之）。
2. **`plugin/scripts/meta-driver.ts`**：`driveItems` 里 `gateFinding(... { existingKeys: [], recentCount: filed, K: opts.cap })` 这一调用同样接上真实全局读数——⚠️ 注意 `recentCount: filed` 当前传的是**本轮函数内局部计数**（不是跨轮读 carrier），核实它与 `probe-routine.ts` 的 `recentCount` 语义是否一致（若不一致，必须在本任务里写清楚两条调用链各自喂的是什么量，⛔ 不能假装两者同构）；全局读数接法与①一致。
3. **两个调用点的 routine 命名口径对齐一个已发现的既存分歧（供本任务记录，择一处理）**：`probe-routine.ts` 走 `fileRoutineTask(..., ["gap","routine-filed", decl.name], ...)` 的标签含 routine 名；`meta-driver.ts` 的 `createAutoDriveTask` 走 `createTask(root, id, item.title, ["meta-driver","driver-candidate"], body)`，**不带 routine 名标签**。全局计数不受此影响（`countRecentFilings` 读的是 `.quay/routine-findings.jsonl` 的 `filing-round` 记录而非任务标签），但若后续要做"按 routine 名查询真实在办任务数"（即被明确列为下一步待裁定的板压力问题），这条标签分歧会挡路。**本任务只需记录该分歧（写进 `## Evidence`，引用具体行号），不要求本任务修它**——那是板压力设计任务的前置输入，不是本任务范围。

## Acceptance Criteria

- [ ] `probe-routine.ts` 真实调用 `routineK`/`routineQuotaDecision`（grep 到真实调用，非仅 import）；旧的 `DEFAULT_RATE` 硬编码在该调用路径上消失（`grep -n "DEFAULT_RATE" plugin/scripts/probe-routine.ts` 的命中要么为 0，要么只剩无关用途，须在 Evidence 里逐条交代每个剩余命中）
- [ ] `meta-driver.ts` 同上，`driveItems` 真实调用新 Policy 路径
- [ ] **真实全局天花板生效的取假（核心判据）**：构造一个 fixture（`.quay/routine-findings.jsonl` 等效临时载体），两个不同 routine 各自远低于自己的 per-routine K，但**合计**触及 `global_ceiling`（如 `drivers.yml` 测试 fixture 设 `global_ceiling: 4`，routine A 填 2、routine B 填 2）⇒ 第三个候选（无论来自 A 还是 B）必须被 `global-rate:` 拒绝，即便发起方自己的 per-routine 窗口远未满——这正是人裁定③要堵的"K×R 无上限增长"场景，必须用真实调用链（不是单测直接调 `routineQuotaDecision`，上一个任务已经测过那个）复现
- [ ] 正反对照：同一 fixture，把 `global_ceiling` 调大到不会被触及的值（如 100）重跑 ⇒ 第三个候选被接受——证明红不是闸恒红
- [ ] 两条调用链的 `recentCount`/本轮计数语义差异（Plan 第②点）已在 `## Evidence` 写明且不是靠猜测——读两处实际代码逐行核对
- [ ] 回归：`plugin/test/probe-routine.test.mjs`、`plugin/test/meta-driver.test.mjs`、`plugin/test/quality-gate-driver.test.mjs`、`plugin/test/routine-file-gate.test.mjs`、`plugin/test/driver-config.test.mjs` 全绿
- [ ] ⛔ 本任务不重启任何生产 driver 进程；如果实现过程中判断需要重启生产 driver 才能生效，必须在任务体里**只报告**准备情况与影响（哪个 driver、读哪个配置、重启后行为会怎样变化、当前生产読数现状），**不执行重启**，交回给调用方（待外部裁定，本任务不得自行重启）

## Definition of Done

两个真实生产调用点（`probe-routine.ts`/`meta-driver.ts`）都已收敛到同一个独立 Policy 函数，全局天花板在真实调用链上可被真实触发（非仅单元测试里的纯函数调用），既有测试全绿，生产 driver 进程未被重启（若需要重启，报告而非执行，等待裁定）。

## Touches

- plugin/scripts/probe-routine.ts
- plugin/scripts/meta-driver.ts
- plugin/test/probe-routine.test.mjs
- plugin/test/meta-driver.test.mjs
- tasks/gap-routine-quota-consumer-convergence.md
