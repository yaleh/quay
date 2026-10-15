---
id: gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5
title: 回归：测试起的 driver anchor scope 再次活过套件（driver-cli
  ac1-stop、driver-restart-busy-e2e ac5），被计入多 scope 护栏
status: ready
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

**实现时核实/修正的两点（改前 A 阶段的实测）**
1. **`quay-serve-dbg-serve-ws-71sgS2` 不是本任务的来源**：其 cmdline 是 `<worktree gap-serve-host-…>/packages/quay/bin/quay.ts serve`（一次手工/开发态的 serve 宿主），两个测试文件都**不起 serve 宿主** ⇒ 本任务不回收它，也不为它加断言（它属于另一条线）。
2. **泄漏的机制比 Proposal 假设的更宽——scope 的成员不只是 anchor**：anchor 把各 kind 的循环跑在**自己进程内**，而那些循环 `spawn` 子进程（worker 调度的在飞 worker、以及每个把它当夹具的用例）。**子进程继承 anchor 的 cgroup**，而 `--collect` 只收**空** scope ⇒ **只按 pid 杀 anchor 不足以收掉 scope**。实测（2026-10-15）：一次**全绿**的 `node --test plugin/test/driver-restart-busy-e2e.test.mjs`（7/7，exit 0）留下 `quay-anchor-e2e-restart-ac2a-FkROLL-1792048717728.scope`，其**唯一**成员是 AC2a 夹具自己的在飞子进程 `node -e setTimeout(()=>{},120000)`（父进程已死、被 systemd --user 收养）。⇒ 回收判据必须是**单元名**（整组停 scope），不是 anchor 的 pid。

## Plan

1. 复现：单独跑两个测试文件各一次，前后各列一次本前缀 scope，确认泄漏（改前 A）。
2. 修 teardown（含测试失败路径），加末尾零泄漏断言。
3. 改后同法复测（B）。

**实现落点**：回收/断言机制做成**单一实现** `plugin/test/helpers/anchor-scope-reaper.mjs`（两个文件共用；`plugin/test/helpers/` 是本仓库既有的共享夹具家，见 `tmp-workspace.mjs` / `driver-runtime-harness.mjs`），⛔ 不在两个文件里各抄一份（硬规则 5b）。单元名前缀取自 `SHARED_HOST_SCOPE_PREFIXES`（= 多 scope 护栏数的同一份），命名/可用性原语取自 Core 叶子 `packages/quay/src/systemd-scope.ts`，⛔ 不新写第三份前缀表或第二份 sanitize 规则。

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
- plugin/test/helpers/anchor-scope-reaper.mjs
- tasks/gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5.md
