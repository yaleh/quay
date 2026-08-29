---
id: gap-retire-halt-file-driver-based
title: 退役已死的 .halt 消费者——6 个死脚本/死读点删除 + restart-readiness-check.sh 重定向到 driver resume；正交面（跨项目/session/metric）另立案
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

**来源（人 2026-08-29 裁定）**：本项目的任务晋升/执行**就应基于 `*-driver` 实现**（promotion → promotion-driver、
execution → worker-driver）。`.halt`（repo 根哨兵）是【非 driver】的晋升/执行暂停机制，其晋升/执行角色已死——
停派发早迁到 control-state（`driver-shared.ts:14`、`worker-driver.ts:79-83`，driver 不读 `.halt`）。

**活性复核（manager 2026-08-29，三条独立判据）**：把 `.halt` 的 driver 面读点当「要迁移的活消费者」是错的——
逐个查活性，**7 个里 6 个是死脚本/死读点**：
① 7 个**全不在 `scripts/test.sh`**；② **全不在 `runner-static-gate.ts` 的 `@static-object` 检查面**；
③ 除 `capability-catalog.sh` 条目 + tick-core prose + 注释 + 报错字符串外，**零活代码调用者**。
`outer-driver` 更是**注册未部署**（无进程、无 `outer-control.json`、无 `outer-round.jsonl`；只有
worker/promotion 两个 control-state 活着）。

**⛔ 上一版本任务把「死」误判成「活」，默认迁移到 control-state/heartbeat——错。正解是退役（删），不是迁移。**

**退役映射表（6 删/删读 + 1 保留重定向）**：

| 消费者 | 处置 | 判死依据 |
|---|---|---|
| `halt-check.sh`（三层统一检查点） | **整脚本删** + `halt-check.test.mjs` | 三层循环死，`--for inner` 死；零活调用者 |
| `a15-ruling5-counter.ts` | **整脚本删** + `a15-ruling5-counter.test.mjs` | 失效前提「执行面 API 化不再依赖 Agent tool_use」已满足；零活调用者 |
| `suite-execution-form-counter.ts:62` `DEFAULT_HALT_REL` | **.halt 读删**（counter 自身命运另议，A19 已「恒报/取证判失效」） | `full-suite-runner.ts:309`「绝不驱动其 signal」 |
| `supervisor-preempt.sh` `halt-check` 子命令 | **子命令删**（preempt/preempt-all 另议） | 只被 slot-refill 报错字符串引用（随 B 类 `gap-retire-slot-refill-halt-mount` 死） |
| `config-wiring-check.ts` `.halt` 条款 | **.halt 条款删**（其余 config 字段校验保留） | `.halt` 文档一致性校验的对象（.halt 语义）已死 |
| `outer-driver.ts:208` A3 `haltStatusRoutine` | **.halt 读删**，stall 判据换 driver 活性（round heartbeat / outcome 新鲜度） | outer-driver 注册未部署；A3 的 `.halt` 读是旧三层 stall |
| `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`（DIR-027 人闸） | **保留 + 重定向**：从「解除 `.halt` 前 go/no-go」改「`quay driver resume` 前可安全恢复」；检查内容（git 树安全）保留 | **唯一真实用户是人**（manual，非 loop-wired） |

**stale 面清理**：`capability-catalog.sh` 里这 7 个的「每轮」条目 + tick-core prose
（`orchestrator-loop-tick.md` / `fast-mode-loop-tick.md` / `fast-mode-tick-core.md` / `orchestrator-tick-core.md` /
`CLAUDE.md` / `plugin/invariant-ownership.md` / `plugin/skills/manager/SKILL.md`）里的「.halt 暂停循环/派发」措辞——
它们**记录的是已退役的三层 loop，本身也是 stale 的**，清除或标注退役。

**⛔ 正交面显式脱钩（不在本任务范围，各自另立案；本任务不删 `.halt` 文件本体）**：
- `manager-tick-readings.ts:144` 跨项目读（manager 观察 quay/archguard/meta-cc 三项目停泊态——manager 层**活**机制）
- `os-anchor-watchdog.sh:304` 会话活性（守 outer/manager/inner 会话——**活**）
- `fast-mode-telemetry.ts` `haltedHours`（throughput 指标——**活**，随 metric 自身命运）
⇒ 这三个与上面 6 个不同：它们**还活着**，只是顺带读了 `.halt`；它们的迁移是独立决策，不是「删死代码」。

## Plan

1. 复核消费者枚举（grep `.halt`/`checkHalt`/`haltSentinel` 按位置判定，排除注释/任务名引用），把 6 死 + 1 保留 +
   3 正交的处置列成退役映射表（删 / 删读 / 重定向 / 另立案）。
2. 删两个整脚本（halt-check.sh、a15-ruling5-counter.ts）+ 对应 test。
3. 删 4 个死读点（suite-execution-form-counter `.halt`、supervisor-preempt `halt-check` 子命令、
   config-wiring-check `.halt` 条款、outer-driver A3 `.halt` 读 + stall 换 driver 活性）。
4. 重定向 restart-readiness-check.sh（`.halt` → `quay driver resume`）。
5. 清 stale catalog/prose（7 个「每轮」条目 + 「.halt 暂停」措辞）。
6. 同步受影响 test；scoped 绿 → fan-in land。

## Acceptance Criteria

- [ ] AC1（死脚本删除）: `halt-check.sh` + `a15-ruling5-counter.ts` 及其 test 删除；`grep -rn` 无残留引用（除退役记录）。
- [ ] AC2（死读点删除）: `suite-execution-form-counter.ts` / `supervisor-preempt.sh` / `config-wiring-check.ts` /
  `outer-driver.ts` 的 `.halt` 读点归零（grep）；outer-driver 的 stall 判据改 driver 活性。
- [ ] AC3（stale 面清理）: `capability-catalog.sh` 无这 7 个的「每轮」stale 条目；tick-core prose /
  CLAUDE.md / invariant-ownership / manager SKILL 无「.halt 暂停循环/派发」旧语义。
- [ ] AC4（人闸重定向）: `restart-readiness-check.sh` 目标改「`quay driver resume` 前可安全恢复」，git 树检查保留。
- [ ] AC5（正交面脱钩）: 退役映射表显式列出 manager-tick-readings / os-anchor-watchdog / fast-mode-telemetry 为「另立案」。
- [ ] AC6（测试绿）: 受影响 test 文件 scoped 绿，`.halt` 断言同步。

## Definition of Done

- [ ] 退役映射表 + 删脚本/删读点 + 重定向 + stale 清理 + scoped 绿；AC1-6 全勾；land 到 develop。

## Touches

- plugin/scripts/halt-check.sh
- plugin/scripts/a15-ruling5-counter.ts
- plugin/scripts/suite-execution-form-counter.ts
- plugin/scripts/supervisor-preempt.sh
- plugin/scripts/config-wiring-check.ts
- plugin/scripts/outer-driver.ts
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- plugin/test/halt-check.test.mjs
- plugin/test/a15-ruling5-counter.test.mjs
- plugin/test/suite-execution-form-counter.test.mjs
- plugin/test/supervisor-preempt.test.mjs
- plugin/test/outer-driver.test.mjs
- plugin/test/restart-readiness-check.test.mjs
- plugin/scripts/capability-catalog.sh
- tasks/gap-retire-halt-file-driver-based.md
