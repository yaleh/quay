---
id: gap-retire-halt-file-driver-based
title: 按 driver-based 原则退役 .halt 的晋升/执行角色——driver 面 .halt 读点迁到 control-state/heartbeat，正交面（跨项目/session/metric）另立案
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源（人 2026-08-29 裁定）**：本项目的任务晋升/执行**就应基于 `*-driver` 实现**——promotion → promotion-driver、
execution → worker-driver。`.halt`（repo 根哨兵文件）是【非 driver】的晋升/执行暂停机制，按此原则应退役其
晋升/执行角色，残留读点迁到 driver 的 control-state / heartbeat / accounting。

**已成立的前置（不重复做）**：
- 停派发已迁到 control-state——`driver-shared.ts:14`、`worker-driver.ts:79-83` 明说 driver 不读 `.halt`
  （单一真相源 = `.quay/<kind>-control.json`，`quay driver drain/resume`）。
- inner 旧派发环死层挂载已立案——`gap-retire-slot-refill-halt-mount`（slot-refill `checkHaltSentinel` +
  slot-free-trigger import；promotion-driver 已机械晋升 todo→ready）。

**本任务范围：driver 面残留的 `.halt` 读点**（这些读点仍在【晋升/执行】路径上，是 `.halt` 残留的晋升/执行角色）：

| 消费者 | 现读法 | 迁移去向（driver-based） |
|---|---|---|
| `outer-driver.ts:208` A3 `haltStatusRoutine` | 读 `<root>/.halt` 报 halted | stall 判据改读 driver 活性（round heartbeat / worker-outcome 新鲜度）；`.halt` 存在性不再是「停摆 vs 未标记停摆」的分母 |
| `halt-check.sh`（三层统一检查点） | `--for outer/inner/manager` 读 `.halt` + stall 组合判据 | inner 已退役 ⇒ 三层变两层；`--for inner` 死；stall 判据改 driver 产出；脚本退役或重定范围 |
| `suite-execution-form-counter.ts:62` `DEFAULT_HALT_REL` | `.halt` 接管期豁免主会话直跑 | 接管期豁免改读 driver control-state `halted`，不读 `.halt` |
| `a15-ruling5-counter.ts` | 心跳缺失 ≥3 ⇒ 「应 .halt」 | 升级动作改「应 `quay driver drain`」（driver 心跳缺失 ⇒ halt driver），不再写 `.halt` |
| `supervisor-preempt.sh` `halt-check` 子命令 | 读 `.halt` fail-closed | 退役或重指向 control-state（与 driver 停机真相源一致） |
| `config-wiring-check.ts` | 校验 `.halt` 文档一致性 | 改为校验「停派发 = drain/resume」的文档一致性 |
| `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`（DIR-027 人闸） | 解除 `.halt` 前 go/no-go | 改目标为「`quay driver resume` 前 driver 可安全恢复」的 go/no-go（检查内容仍是 git 树安全） |

**prose 同步**（不留「写 .halt 停一切」的旧语义）：`CLAUDE.md`、`plugin/skills/manager/SKILL.md`、
`plugin/loop/fast-mode-loop-tick.md`、`plugin/loop/fast-mode-tick-core.md`、`plugin/loop/orchestrator-loop-tick.md`、
`plugin/loop/orchestrator-tick-core.md`、`plugin/invariant-ownership.md`——「.halt 暂停循环/派发」措辞改为
「停派发 = `quay driver drain/resume`」。

**⛔ 正交面显式脱钩（不在本任务范围，各自另立案；本任务不静默带过、也不删 `.halt` 文件本体）**：
- `manager-tick-readings.ts:144` 跨项目读（manager 观察 quay/archguard/meta-cc 三项目的停泊态——manager 层机制，
  非本 repo 的晋升/执行）。
- `os-anchor-watchdog.sh:304` 会话活性（守 outer/manager/inner 会话，非晋升/执行）。
- `fast-mode-telemetry.ts` `haltedHours`（throughput 指标，随 inner 退役后 metric 自身命运定）。
⇒ `.halt` 文件本体是否删除，取决于这三者后续的去留；本任务只退 `.halt` 的晋升/执行角色。

## Plan

1. 复核消费者枚举（grep `.halt` / `checkHalt` / `haltSentinel` 按位置判定，排除注释/任务名引用），把 7 个
   driver 面读点 + 3 个正交面读点的处置列成退役映射表（迁移去向 or 退役 or 另立案）。
2. 逐脚本迁移/退役（按 Proposal 表）；stall 判据与「接管期豁免」改 driver 活性/control-state。
3. prose 同步（7 个文档的「.halt 暂停」→「drain/resume」）。
4. 同步测试（6 个 test 文件里对 `.halt` 的断言）。
5. scoped 绿 → fan-in land。

## Acceptance Criteria

- [ ] AC1（driver 面迁移）: 7 个脚本的 `.halt` 读点全部处置完（迁移到 control-state/heartbeat 或退役），
  退役映射表逐条勾；`grep -rn '\.halt' plugin/scripts/outer-driver.ts plugin/scripts/suite-execution-form-counter.ts plugin/scripts/a15-ruling5-counter.ts` 的【晋升/执行】读点归零。
- [ ] AC2（真相源单一）: 停派发唯一真相源 = `*-control.json`（`quay driver drain/resume`）；迁移后的 driver 面不再引 `.halt`。
- [ ] AC3（正交面脱钩）: 退役映射表显式列出 manager-tick-readings / os-anchor-watchdog / fast-mode-telemetry
  三者为「另立案」，不静默带过。
- [ ] AC4（prose 一致）: CLAUDE.md / manager SKILL / tick-core / invariant-ownership 无「.halt 暂停循环/派发」旧语义。
- [ ] AC5（测试绿）: 6 个受影响 test 文件 scoped 绿，`.halt` 断言同步。

## Definition of Done

- [ ] 退役映射表 + 迁移/退役 + prose 同步 + scoped 绿；AC1-5 全勾；land 到 develop。

## Touches

- plugin/scripts/outer-driver.ts
- plugin/scripts/halt-check.sh
- plugin/scripts/suite-execution-form-counter.ts
- plugin/scripts/a15-ruling5-counter.ts
- plugin/scripts/supervisor-preempt.sh
- plugin/scripts/config-wiring-check.ts
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- plugin/test/outer-driver.test.mjs
- plugin/test/halt-check.test.mjs
- plugin/test/suite-execution-form-counter.test.mjs
- plugin/test/a15-ruling5-counter.test.mjs
- plugin/test/supervisor-preempt.test.mjs
- plugin/test/restart-readiness-check.test.mjs
- tasks/gap-retire-halt-file-driver-based.md
