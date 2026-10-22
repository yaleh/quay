---
id: gap-adr008-phase-declaration-staleness-reading
title: ADR-008 phase 声明自 2026-09-13 以来未变而无人可见——加一个只读的「距上次声明」读数（提交数 / 新 goal 数 /
  天数）进既有 quality-round Fact；不做自动切换（观察项）
status: ready
labels:
  - gap
  - observation
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是观察项，不是阻塞项**（硬规则 12：「phase 声明长期不更新」已发生的次数 = 1，就是当前这一次；单例不足以支撑任何强制机制）。本任务只把一个已有、但没人读的量变成可见读数。

**事实**（2026-10-22 实测）：
- `.quay/two-phase-state.json`（`plugin/scripts/phase-declare.ts` 的载体，受 git 跟踪，唯一一次提交 f57807f5c）只有一条声明：`phase: convergence`，`declaredAt: 2026-09-13T20:35:47.187Z`，`history` 长度 1。
- 此后：`git rev-list --count --since=2026-09-13T20:35:47Z HEAD` ⇒ **10,339** 个提交（develop 10,338）；新 goal：`git log --since=2026-09-13T20:35:47Z --diff-filter=A --name-only --format= -- goals/` 去重后为 **30 个**——GOAL-018…GOAL-037（20 个）+ GOAL-901…GOAL-910（10 个，其中 901–905 是标题自述的演练 drill）。所以「只多了 GOAL-906..910」的粗读低估了；首个新增是 GOAL-018（2026-09-14T04:01Z）。
- 期间没有任何 phase 变更。`phase-declare.ts` 的设计**有意**不做自动切换（gap-adr008-phase-state-mechanization-minimal AC3：唯一写入口是人显式带 `--reason` 的调用）——这一点本任务不改。
- **没有任何读者**：`grep -n "two-phase-state\|phase-declare" plugin/scripts/*.ts`（排除 `phase-declare.ts` 自身）⇒ 0 个代码读者。声明是否已经过期，只能靠人记得去打开这个文件。

**承载处**：`design-evolution-readings` 例程（`plugin/scripts/design-evolution-readings.ts`，经 `plugin/scripts/quality-gate-driver.ts` 调度，`.quay/config.yml` `loop.design_evolution_readings.enabled: true`）已经是只读 git 读数，并在生产上写 quality-round Fact（`.quay/quality-round.jsonl` 最近两次 2026-10-21T23:14Z、2026-10-22T00:40Z）。把 phase 新旧读数放进它的 Fact，不新开例程或载体。

## Plan

1. **计算放在载体的主人那里**：在 `phase-declare.ts` 中导出纯函数 `readPhaseStaleness(root)`，返回 `{evaluated, reason, phase, declaredAt, declarations, commitsSince, newGoalsSince:[ids], daysSince}`。`commitsSince` 用 `git rev-list --count --since=<declaredAt> HEAD`；`newGoalsSince` 用 `goals/` 下 `--diff-filter=A` 的新增文件去重得到 GOAL id。载体缺失、不可解析或 git 读失败 ⇒ `evaluated:false` + reason，⛔ 不返回 0（硬规则 3b）。
2. **CLI 只读面**：`phase-declare.ts --staleness [--json]` 打印上述读数，不写任何文件。
3. **接入既有 Fact**：`design-evolution-readings` 例程的 Fact value 增加 `phaseStaleness` 字段（原样嵌入 `readPhaseStaleness` 的返回）。它是附加信息，⛔ 不改变该 Fact 现有 state 的判定，⛔ 不触发立案。
4. **明确排除**：不做自动切换、不设阈值、不把读数接进任何门或派发计算；ADR-008 文本不改。

## Acceptance Criteria

- [ ] AC1 读真实载体：在主检出运行 `node --experimental-strip-types plugin/scripts/phase-declare.ts --staleness --json`，输出 `evaluated:true`、`phase:"convergence"`、`declaredAt:"2026-09-13T20:35:47.187Z"`、`declarations:1`，`commitsSince` 等于同一时刻 `git rev-list --count --since=2026-09-13T20:35:47Z HEAD` 的值，`newGoalsSince` 含 GOAL-018 与 GOAL-910（贴出两条命令的输出）。
- [ ] AC2 只读：AC1 运行前后 `md5sum .quay/two-phase-state.json` 一致，`git status --porcelain .quay/two-phase-state.json` 为空（贴出前后读数）。
- [ ] AC3 未评估不伪装成「新鲜」（负对照）：在临时工作区中，载体缺失 ⇒ `evaluated:false` 且 `commitsSince` 为 `null`（不是 0）；载体为非法 JSON ⇒ 同样 `evaluated:false`，reason 与「缺失」可区分（贴出两次输出）。
- [ ] AC4 进入既有 Fact（生产载体）：在主检出由 `plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once` 跑一轮且该例程 due（未 due 时贴出 `.quay/routine-last-run.json` 中该键的读数，等下一个常驻轮次产出后再取），`.quay/quality-round.jsonl` 新增一条 round 记录，其中 `design-evolution-readings` Fact 的 `value.phaseStaleness.evaluated` 为 `true` 且 `commitsSince` 与 AC1 同量级（差值等于两次运行之间的新提交数）。贴出该 Fact 的 `phaseStaleness` 片段。
- [ ] AC5 没有自动切换：`grep -nE "phase:\s*(opts\.to|\"expansion\"|\"convergence\")" plugin/scripts/phase-declare.ts` 的命中仍只在人显式声明的写入路径上，`readPhaseStaleness` 函数体内 0 处写文件调用（`writeFileSync`/`appendFileSync`/`renameSync`）——贴出 grep 输出与函数体行范围。

## Definition of Done

- [ ] AC1–AC5 全绿，`scripts/test.sh` 相关泳道与 `--for-task` scoped 静态检查通过，合并进 develop。
- [ ] 读数只出现在既有 Fact 中，没有新载体、新例程、新门、新阈值。
- [ ] `phase-declare.ts` 的 capability-catalog 声明补充 `--staleness` 只读面。

## Touches

- tasks/gap-adr008-phase-declaration-staleness-reading.md
- plugin/scripts/phase-declare.ts
- plugin/scripts/design-evolution-readings.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/phase-declare.test.mjs
- plugin/test/design-evolution-readings.test.mjs
