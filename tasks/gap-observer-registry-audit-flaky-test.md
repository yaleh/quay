---
id: gap-observer-registry-audit-flaky-test
title: observer-registry AC3 audit 断言 flake（并发 suite 下偶发 stale）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：inner 报 test-detail-load fan-in 撞 `observer-registry.test.mjs:100` AC3 断言（`audit exit 0 when every consumer is fresh` 得 `1 !== 0`）→ anti-livelock needs-human。**我实测该测试隔离跑 3/3 全绿（fail=0）** ⇒ 是并发 suite 下的 flake，非稳定回归。

**疑点（⛔ 未定根因）**：AC3 用 `makeTmp` + `fixtureRegistry` 隔离 registry 文件，但 4 个消费者（watchdog/session-liveness/topology）可能把「已跑过」的报告写到**共享位置**而非 tmp dir ⇒ 并发 suite 下其它测试/真实 monitor 的写与 AC3 的 audit freshness 判定互相污染。

## Plan

1. 定位 AC3 在并发 suite 下 stale 的来源（消费者报告落点是否共享、freshness 窗口是否太窄）。
2. 修 flake（隔离消费者报告落点，或放宽/锚定 freshness 判据）。

## Resolution（根因定位 + 修法）

**根因 = 消费者报告落点共享（Proposal 疑点命中）**：`session-liveness.sh` 启动时自注册一个「已跑过」报告到 `$REPO_ROOT/.quay/session-liveness.<pid>.json`（`gap-sweeptmp` 候选 D 的观测者注册），除非 `SL_NO_REGISTER=1`。该 seam 的既有注释明言「`spawnMonitor` 默认关，防测试污染真实 `.quay`」——但 AC3 测试与 `do_audit` 都**直接** `bash session-liveness.sh --once`（绕过 `spawnMonitor`），于是每次调用都 `mkdir` + 写 + trap-rm 一次**共享** `<repo>/.quay/`，与真实驻留监视器（主检出的 `session-liveness.2351458.json`）落在同一目录。并发 16 泳道下这些瞬时写与真实 monitor 的注册文件互相竞争——正是「消费者把已跑报告写到共享位置而非 tmp」的 flake 源。审计的 freshness 判定本身无时间窗口（每次现跑消费者 grep `decommissioned`），故「窗口过窄」半边不适用。

**修法 = 在调用侧钉死隔离 seam**（不改 `session-liveness.sh` 本体，其行为正确）：
1. `observer-registry.sh` `do_audit` 的 session-liveness 消费者调用加 `SL_NO_REGISTER=1`（audit 是 READ-type 检查，不得自注册观测者）。
2. `observer-registry.test.mjs` AC3/AC2 的 `--once` 直调 env 加 `SL_NO_REGISTER: "1"`。
验证：`SL_NO_REGISTER=1` 时 `--once` 完全不建 `.quay/`（对照无 flag 时建+删）；`--scoped` 静态检查全绿 + observer-registry 5/5 绿。

## Acceptance Criteria

- [x] AC1：observer-registry AC3 在并发 suite（16 泳道）下稳定绿（⛔ 偶发 stale ⇒ 假）。

## Definition of Done

- [x] observer-registry AC3 flake 根因定位（消费者报告落点共享/窗口过窄）+ 并发 suite 稳定绿；AC1 全勾；land 到 develop。

## Retires

- 无（修 flake）

## Touches

- plugin/scripts/observer-registry-check.sh（audit freshness 逻辑，若根因在此）
- plugin/scripts/observer-registry.sh（若涉消费者报告落点）
- plugin/test/observer-registry.test.mjs（AC3 隔离修）
- tasks/gap-observer-registry-audit-flaky-test.md（自身）
