---
id: gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5
title: 回归：测试起的 driver anchor scope 再次活过套件（driver-cli
  ac1-stop、driver-restart-busy-e2e ac5），被计入多 scope 护栏
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**回归**：`gap-ac3-live-test-fixture-leaks-supervised-driver-processes`（done，2026-09-14）修过 `plugin/test/driver-cli.test.mjs` 的 `ac1-stop` 泄漏，但 2026-10-15 实测仍有测试起的 driver 活过套件。

**真实读数（2026-10-15T06:5xZ，`systemctl --user list-units 'quay-anchor-*'` + 各 scope `cgroup.procs` + `/proc/<pid>/cmdline`）**
- `quay-anchor-driver-cli-ac1-stop-eEx6Ag-1791992934297.scope`：pid 2224101，`--root /tmp/driver-cli-ac1-stop-eEx6Ag`，自 2026-10-14 23:48:54 CST 起常驻 —— 来源 `plugin/test/driver-cli.test.mjs`。
- `quay-anchor-e2e-restart-ac5-7GBhQ9-1791992913087.scope`：pid 2209755，`--root /tmp/e2e-restart-ac5-7GBhQ9`，自 2026-10-14 23:48:33 CST；`quay-anchor-e2e-restart-ac5-GqvD6m-1792046052338.scope`：pid 3874216，`--root /tmp/e2e-restart-ac5-GqvD6m`，自 2026-10-15 14:34:12 CST —— 来源 `plugin/test/driver-restart-busy-e2e.test.mjs`。
- 另有 `quay-serve-dbg-serve-ws-71sgS2-1791292456894.scope`（pid 2913800）同族泄漏，来源待实现时核实。

**影响**：这些 scope 被 `listSharedHostScopes()` 计入（当前 N=17），参与多 scope 分摊护栏的计算并占用进程；每次全量套件都可能再留下一个。

**方案**：两个测试文件的 teardown 在 `after`/`finally` 里按**自己起的 scope 单元名**回收（`systemctl --user stop <unit>`，失败则写 `cgroup.kill`，见既有 reaper），并在文件末尾断言「本文件前缀的 `quay-anchor-*`/`quay-serve-*` scope 数为 0」。⛔ 不按 pid 猜、不回收别的文件或别的项目的 scope。

## Plan

1. 复现：单独跑两个测试文件各一次，前后各列一次本前缀 scope，确认泄漏（改前 A）。
2. 修 teardown（含测试失败路径），加末尾零泄漏断言。
3. 改后同法复测（B）。

## Acceptance Criteria

- [ ] AC1: 改前 A：单独跑 `plugin/test/driver-cli.test.mjs` 与 `plugin/test/driver-restart-busy-e2e.test.mjs` 后，本前缀 scope 计数 > 0（粘贴前后 `systemctl --user list-units` 读数）；若改前不复现，如实记录并说明触发条件。
- [ ] AC2: 改后 B：同两文件单独跑（含人为让一个用例失败的一次）后，本前缀 scope 计数 = 0。
- [ ] AC3: 两文件新增的末尾断言在零泄漏时通过；夹具中伪造一个残留 scope 时断言变红（可取假）。
- [ ] AC4: `node --test plugin/test/driver-cli.test.mjs plugin/test/driver-restart-busy-e2e.test.mjs` 退出码 0。

## Definition of Done

AC1–AC4 带真实读数勾选；不回收任何非本测试起的 scope。落地后观测（不在 worker 内）：之后 24h 内的真实全量套件不再新增 `driver-cli-ac1-stop-*`、`e2e-restart-ac5-*` scope；现存 3 个遗留 scope 由人或运维步骤清理并记录。

## Touches

- plugin/test/driver-cli.test.mjs
- plugin/test/driver-restart-busy-e2e.test.mjs
- tasks/gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5.md
