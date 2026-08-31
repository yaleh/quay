---
id: gap-suite-knobs-config-file-priority
title: suite 级旋钮配置化——config.yml `suite:` 节承载（config 优先、env 备用、driver 重启不丢）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（director 2026-08-31 实证）**：全部 suite 级旋钮都是 env（QUAY_PHASE_OVERLAP / QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION / QUERY_MAIN_TAIL_OVERLAP）。driver 重启即丢 env：2026-08-31 04:53 有人执行 `driver stop` → 新 supervisor 由 systemd 启动（无 env）→ A 的 `QUERY_MAIN_TAIL_OVERLAP=12` 丢失 → round 775 全量轮 A 未触发（round 773 触发时 driver 带 env，效果 main 225s、省 ~88s）。**driver 重启是常态（本项目持续开发中），env 注入不可靠。director 裁定：配置优先（quay 配置文件）、env/CLI 只作备用（调试/临时）。**

**根因**：`.quay/config.yml` 只有 providers/gates/loop 三节，full-suite-runner 与 test.sh 都不读它（DIR-120 Phase 2 后 config.yml 是 terminal 配置源）。suite 旋钮无配置文件承载 ⇒ 全部依赖启动时刻 env。

**方案（系统性，同族一次解决）**：`.quay/config.yml` 加顶层 `suite:` 节（与 providers/gates/loop 平级），承载 6 个 suite 旋钮；新增 loader（复用 loop-params.ts 的 DIR-050/120 模式，schema 封闭）；test.sh 与 full-suite-runner 读配置作默认值，env 覆盖（调试）。**三级优先级：config.yml < env < CLI**。

**配置键映射**：
| config 键 | env 键 | 消费点 |
|---|---|---|
| suite.phase_overlap | QUAY_PHASE_OVERLAP | test.sh PHASE_OVERLAP |
| suite.serial_concurrency | QUAY_SERIAL_CONCURRENCY | test.sh SERIAL_CONCURRENCY |
| suite.lowconc_concurrency | QUAY_LOWCONC_CONCURRENCY | test.sh LOWCONC_CONCURRENCY |
| suite.max_concurrent_suites | QUAY_MAX_CONCURRENT_SUITES | full-suite-runner |
| suite.max_oversubscription | QUAY_MAX_OVERSUBSCRIPTION | full-suite-runner |
| suite.main_tail_overlap_lanes | QUERY_MAIN_TAIL_OVERLAP | test.sh MAIN_TAIL_OVERLAP |

**与 A 的关系**：A（gap-suite-main-overlaps-load-sensitive-tail-experiment）已 done；本任务把 A 的旋钮（及全族）配置化，解决「driver 重启丢 env」。配置化落地前 A 用 env 注入作临时手段。

## Plan

1. `.quay/config.yml` 加 `suite:` 节 + `suite-params.ts` loader（复用 loop-params.ts 的 branch-A/B + schema 校验模式；schema 封闭，非法键拒绝）。
2. test.sh：启动时读 suite 节设各旋钮默认值（`VAR="${VAR:-$config_value}"` 形态，env 覆盖 config）；消费逻辑不变。
3. full-suite-runner.ts：读 suite 节注入 suiteEnv（max_concurrent_suites / max_oversubscription / phase_overlap 等 runner 侧消费的）。
4. 验证 6 旋钮 config vs env 优先级 + driver 重启后 config 生效。

## Acceptance Criteria

- [x] AC1（能取假，接线）：config.yml `suite:` 节存在且被 test.sh 与 full-suite-runner 读取——设配置值（无 env）行为与设同名 env 相同（grep 读取逻辑可见；实测一档）。
- [x] AC2（能取假，优先级）：env 覆盖 config——同键 env 与 config 设不同值，生效的是 env（实测）；CLI 覆盖 env（test.sh --test-concurrency 等现有 CLI 优先逻辑不回归）。
- [ ] AC3（能取假，持久，硬规则 4 推论三）：实现落地后时间窗内，**driver 重启后** suite 轮仍用 config 值（不依赖 env）——实测：driver stop/start 后跑一轮，verification-round/日志显示 config 值生效（N 只计落地后轮次）（待外部）
- [x] AC4（能取假，无回归）：6 旋钮配置化后默认行为（无 config 无 env）与现状一致（pass/fail-neutral）；`--test-concurrency` 等 CLI 显式值仍优先。
- [x] AC5（能取假，schema 封闭）：suite 节非法键/类型被 loader 拒绝（fixture 测试），与 DIR-050 providers/gates 同 schema 纪律。

## Definition of Done

config.yml `suite:` 节 + loader + test.sh/full-suite-runner 接线；AC1-AC5 全勾；6 旋钮 config/env/CLI 三级优先级实测；driver 重启后 config 生效实测；全量 suite 绿。

## Touches

- .quay/config.yml（加 `suite:` 节）
- plugin/scripts/suite-params.ts（新，loader + schema，closed schema fail-closed）
- plugin/test/suite-params.test.mjs（新，fixture 测试）
- scripts/test.sh（读 suite 节设默认值 + env 覆盖）
- plugin/scripts/full-suite-runner.ts（读 suite 节注入 suiteEnv + runner 侧派生）
- plugin/scripts/capability-catalog.sh（suite-params.ts 六表注册）
- plugin/scripts/quay-init.sh（suite-params.ts 显式 laydown 条目）
- tasks/gap-suite-knobs-config-file-priority.md（自身）
