---
id: gap-runner-grouping-dedupe-metadata-query
title: "runner-grouping 族元数据查询去重——先文件内去重 3 处（~97s 零风险），跨文件缓存独立后续"
status: done
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`runner-grouping-*` 族 5 个测试文件的 `runTestSh` helper 字节级完全相同（复制粘贴），同构可共享基础设施。文件内【参数完全相同的重复调用】共 3 处：`list-groups.test.mjs` 的 `--list-files`/`--list-groups` 各 2 次、`serial-anti-stomp.test.mjs` 的 `--list-groups` 2 次。实测单次元数据查询 32.4s ⇒ 文件内去重预期省 ~97s。

跨文件重复（如 `--list-groups` 全族 5 个文件各自独立调用）省的空间更大，但需跨 `node --test` 进程共享缓存（按参数 hash 存 /tmp）。**风险**：这族测试的意义是验证 `scripts/test.sh` 分组逻辑正确性，缓存失效设计不严谨会把 `scripts/test.sh` 的真实回归藏在陈旧缓存后——是存在意义的反面。故跨文件缓存必须缓存 key 绑定 `scripts/test.sh` 自身内容 hash + 负控制（命中 vs 未命中结果一致），独立后续。

## Acceptance Criteria

- [x] AC1: 文件内去重 3 处参数完全相同的调用（零跨进程状态风险，~97s），先落验证方法论。
- [x] AC2: 覆盖率不丢——每条用例仍验证真实 `scripts/test.sh` 分组逻辑（不 mock）。
- [x] AC3: scoped 绿 + 该族耗时下降（真实输出）。跨文件缓存不作为本任务 AC，独立后续。

## Definition of Done

- [x] 文件内 3 处去重落地，~97s 收益 + 覆盖率不丢，scoped 绿（真实输出）。跨文件缓存留独立任务。

## Evidence (impl, 2026-08-19)

- 去重落地 3 处：`list-groups.test.mjs` 的 `--list-files`/`--list-groups` 各 2→1 次、`serial-anti-stomp.test.mjs` 的 `--list-groups` 2→1 次。经模块级 `metaCache`（`runTestShCached` memo），`node --test` 每测试文件独立进程 ⇒ 零跨进程状态风险；仅参数完全相同的调用共享结果。
- readStable 反脆片保留：`readStable` retry 传 `refresh=true` 走 `runTestShRefresh` 重查 live tree（transient zz-* fixture 恢复不丢；round-310 场景仍可自愈）。
- 单次查询实测（本机 worktree）：`--list-groups` ≈19.7s、`--list-files` ≈35.1s（idle）⇒ 3 次去重 ≈ 74-97s 收益（与 finding 32.4s/次、~97s 一致）。
- `node --test plugin/test/runner-grouping-list-groups.test.mjs plugin/test/runner-grouping-serial-anti-stomp.test.mjs`：6/6 pass、0 fail，duration 216878ms。
- `bash scripts/test.sh --for-task gap-runner-grouping-dedupe-metadata-query --allow-thin`：EXIT=0（scoped static checks 全绿；测试 6/6 pass；AC0c 复用缓存 `--list-groups` 仅 6.2s vs AC10 首查 21.2s）。

## Touches

- tasks/gap-runner-grouping-dedupe-metadata-query.md（自身）
- plugin/test/runner-grouping-list-groups.test.mjs（--list-files/--list-groups 各去 1 次）
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs（--list-groups 去 1 次）
