---
id: gap-driver-anchor-memory-envelope-live-sibling-enumeration-load-flake
title: driver-anchor-memory-envelope 的「真实枚举 my own scope」用例是共享 host 时序形状的红：改有界轮询
  + 具名超时读数
status: ready
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 全红里，`plugin/test/driver-anchor-memory-envelope.test.mjs` 的
「REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens」是一条**共享 host 枚举 + 时序**形状的红，不是产品回归：

- run 38700638546 该用例 15.0s 后红，断言逐字：
  `AssertionError [ERR_ASSERTION]: quay-anchor-sibling-probe-1792050245495-2003237-0.scope must appear in the real enumeration: ["quay-anchor-cantus-…` ——
  即「我自己刚建的探针 scope 必须出现在真实枚举里」，而枚举到的是**别的项目**的 scope（cantus / claudecodeui / litellm / quay-fleet / terrain-pack）。
- 成因：`systemd-run --user --scope` 的单元注册与 cgroup 枚举之间存在 10-15s 量级的时间窗；runner 上同时有多个项目的 anchor scope，枚举是**共享 host 的全局读**。
- ⛔ 判定红线：不许靠**削弱断言**（改成「枚举非空即可」/跳过枚举）来消抖——本条要测的正是「真的数到了同居 scope」。修法只能是**有界等待 + 具名超时读数**。

## Plan

1. 复现：本机在「已有多个 `quay-anchor-*` scope 同居」的形状下反复跑该用例，记录红/绿与耗时（A 侧读数）。
2. 改成**有界轮询**：直到本探针 scope 出现在真实枚举里，或到上限后**带具名单据**失败（列出上限、最后的枚举快照、探针单元名）。
3. B 侧读数：同一形状下连跑 ≥3 次全绿。
4. 负控：人造「枚举里永远没有自己」（例如把期望的单元名改错一位 / 让探针单元不创建），断言必须在有界时间内红，并打印具名原因，⛔ 不得静默通过或永久挂起。

## AC

- [ ] AC1: 该用例改为有界轮询（粘贴改动前后的实现片段），上限是**显式常量**且失败时打印上限值 + 最后一次枚举快照 + 期望单元名。
- [ ] AC2: A/B 读数：改动前在「多 scope 同居」形状下至少复现一次红（粘贴原文断言与枚举快照）；改动后同一形状连跑 3 次 `node --test plugin/test/driver-anchor-memory-envelope.test.mjs` 均退出码 0（粘贴三次 `ℹ tests/pass/fail`）。
- [ ] AC3: 负控：让期望单元名错一位（或让探针不建 scope）后，该用例必须在**有界时间内**红且报出只名原因（粘贴原文）；⛔ 不得出现「永久挂起到 harness 超时」或静默绿。
- [ ] AC4: 断言强度未被削弱：改动后仍要求枚举里含**本探针**的 scope，且至少一条**别的项目**的 `quay-anchor-*` scope（粘贴改动后的枚举读数）。
- [ ] AC5: 改动只落在该测试文件（`git diff --name-only` 只有它）。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中该用例不再是失败项（粘贴 run id + 结论）。
- 本机连续 3 轮全量套件里该文件不再出现红（粘贴读数）。
- ⛔ 不引入新的 CI 失败项。

## Touches

- plugin/test/driver-anchor-memory-envelope.test.mjs
- tasks/gap-driver-anchor-memory-envelope-live-sibling-enumeration-load-flake.md


ADR-007 逐里程碑暗轴记录（本任务的声明）
该轴仍暗,理由: 本任务改的是那条用例如何等共享 host 的 scope 枚举出现（有界轮询 + 具名超时），是时序/环境耦合的修复，不量架构面（依赖图 / 文档比 / 变异存活都没测），没有可解析的读数可贴。