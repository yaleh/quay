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

- [x] AC1: 改前 A：单独跑 `plugin/test/driver-cli.test.mjs` 与 `plugin/test/driver-restart-busy-e2e.test.mjs` 后，本前缀 scope 计数 > 0（粘贴前后 `systemctl --user list-units` 读数）；若改前不复现，如实记录并说明触发条件。
- [x] AC2: 改后 B：同两文件单独跑（含人为让一个用例失败的一次）后，本前缀 scope 计数 = 0。
- [x] AC3: 两文件新增的末尾断言在零泄漏时通过；夹具中伪造一个残留 scope 时断言变红（可取假）。
- [x] AC4: `node --test plugin/test/driver-cli.test.mjs plugin/test/driver-restart-busy-e2e.test.mjs` 退出码 0。

## Definition of Done

AC1–AC4 带真实读数勾选；不回收任何非本测试起的 scope。落地后观测（不在 worker 内）：之后 24h 内的真实全量套件不再新增 `driver-cli-ac1-stop-*`、`e2e-restart-ac5-*` scope；现存 3 个遗留 scope 由人或运维步骤清理并记录。

## Disposition

**判据口径（先立，后面全部读数都用它）**：一个 scope 算「泄漏」当且仅当它的 **cgroup 里还有进程**（`systemctl --user show -p ControlGroup --value <unit>` → `/sys/fs/cgroup<cg>/cgroup.procs` 非空）。⛔ 不用「单元还在不在 `systemctl list-units --all` 表上」：实测 `--all` 会在一段时间内继续列出**已经停掉**的 scope（`dead`、cgroup 目录已删、不占任何成员、不计入 `listSharedHostScopes()`），拿它当判据两个方向都会误报（把收集延迟读成泄漏；把「表上没看到」读成干净）。

### AC1 — 改前 A（在从 develop fork 的 worktree 上，未改一行）

- **`driver-restart-busy-e2e.test.mjs` 单独跑：复现。**
  - 读数 1（带 1 s 轮询）：跑前 `quay-anchor-e2e-restart-*` 3 条；跑中新增 `-ac2a-zuSjUg-1792048575396.scope`、`-ac2a-xA7HHk-1792048613922.scope`。
  - 读数 2（跑前/跑后各列一次，8 条 → 8 条）：`7/7 pass, exit 0` 之后**新增** `quay-anchor-e2e-restart-ac2a-FkROLL-1792048717728.scope`。
  - 读数 3（clean-develop worktree 上把两个文件合跑 2 次后的在跑残留）：新增 **3 条**在跑的 `quay-anchor-e2e-restart-ac2a-*`（`OAFUou-1792050270621` / `PBT3pE-1792050334242` / `Zu6sxp-1792050300154`）。
  - **机制（直接读数，不是推断）**：新增 scope 的 `cgroup.procs` 里**唯一**成员是夹具自己的在飞子进程 `node -e setTimeout(()=>{},120000)`，`ps -o pid,ppid=` 显示其父已是 `systemd --user`（anchor 已死）；夹具 root `/tmp/e2e-restart-ac2a-*` **已被删除**（`fs.rmSync` 跑过）。⇒ 收尾确实执行了，缺的是「按 pid 杀 anchor ≠ 收掉 cgroup 里的子进程」。
- **`driver-cli.test.mjs` 单独跑：不复现（如实记录 + 触发条件）。** 1 s 轮询下 `quay-anchor-driver-cli-*` 计数 `1 → 2 → 1`，跑完 = 跑前。
  - **触发条件**：本文件起的 scope 里没有 anchor 之外的成员（夹具 `worker-driver.ts` 是 `setInterval`，不 spawn 子进程）⇒ 只剩「anchor 自己没被杀掉」一条路。机上那条遗留 `quay-anchor-driver-cli-ac1-stop-eEx6Ag-1791992934297.scope` 的盘上读数正好是这条：`.quay/anchor-desired.json` 的 `updatedBy=quay-driver-stop`（stop 已走到「写期望态」那一步）、`anchor.log` 有 `kind=worker loop stopped`、而 anchor 进程（pid 2224101）**至今活着**，且**夹具 root 仍在盘上**（`/tmp/driver-cli-ac1-stop-eEx6Ag` 存在）⇒ 最后一次 `fs.rmSync` 从未执行 ⇒ 进程是在 `await cli([...stop])` 期间被杀的 —— `cli()` 是**进程内** `run()`，`stopKindViaAnchor` 尾部那步 `SIGTERM anchor` 与被杀的测试进程同生共死，跑不到。
- **`quay-serve-dbg-serve-ws-71sgS2` 核实为与本任务无关**：cmdline = `…/quay-worktrees/gap-serve-host-…/packages/quay/bin/quay.ts serve`，两个测试文件都不起 serve 宿主 ⇒ 不回收、不加断言。

### AC2 — 改后 B

| 跑法 | 结果 | 本前缀**在跑** scope |
|---|---|---|
| 单跑 `driver-cli.test.mjs` | 10/10，rc=0 | 0 |
| 单跑 `driver-restart-busy-e2e.test.mjs` | 8/8，rc=0 | 0 |
| 单跑 driver-cli + 注入一次失败（ac1-stop 主体末尾 `assert.equal(1,2,…)`） | 9 pass / 1 fail，rc=1 | 0 |
| 单跑 e2e + 注入一次失败（AC2a 主体末尾同上） | 7 pass / 1 fail，rc=1 | 0 |
| 合跑 ×3（**归属化**：给两文件的夹具 root 加唯一前缀 `attr1-`/`attr2-`，只数带该前缀的单元 ⇒ 排除同机别的进程造的 scope） | rc=0 / rc=0 / rc=1（第 3 次的红见 AC4 说明） | **0 / 0 / 0** |
| 单跑 AC2a 一条 ×3 | 3× pass | 0 |

回收机制除了「最后一道末尾闸」，还进了**每个夹具 root 的统一收尾**（`teardownRoot` / `cleanup`），且顺序固定为「停 kind → **按单元名整组停 scope** → 最后 rmSync」；`teardownRoot` 对**所有** root 生效（⛔ 不再有「这个用例碰巧没起 anchor 所以只 rmSync」的分支）。每一次跑都没有打印过 `per-case … missed` 行 ⇒ 逐个用例的收尾自己就收干净了，末尾闸是零成本兜底。

### AC3 — 可取假

两文件各新增一条控制用例 `零泄漏断言可取假 — 夹具伪造一个本前缀的残留 scope 时…`，三段都在同一次运行里出现：
1. 零残留时 `assertNoOwnScopes` 通过（**负控制**：证明这条用例不是靠「断言恒抛」通过）；
2. 用**真的** systemd scope 伪造一个残留（`systemd-run --user --scope --unit=quay-anchor-<probe 的 root 基名>-<ts>.scope sleep 60`，先由 `readOwnScopes(...).liveUnits` 确认它真在跑），`assertNoOwnScopes` 抛 `/仍有 1 个/`；
3. `reclaimOwnScopes` 之后 `remainingLive` 为空、断言再次通过。

⇒ 同一个断言在同一进程里红过也绿过，取值随被测量变化。两文件的全套跑里这两条都绿（18/18 的组成部分）。两文件的末尾 `after()` 闸在每一次跑里都通过。

### AC4

`node --test plugin/test/driver-cli.test.mjs plugin/test/driver-restart-busy-e2e.test.mjs` 多次 **rc=0（18/18）**，含归属化 3 次里的 2 次；scoped gate（`bash scripts/test.sh --for-task <本任务> --allow-thin`）**rc=0（18/18，0 fail）**。

⚠️ **如实登记一条与本任务无关的既有抖动**：该合跑命令**偶发** rc=1（`AC2b` / `AC2a-real` 交替，报 `the dispatch record is cleared once the outcome is written` 一类）。**改前控制**：在 clean develop 的 worktree 上、一行未改，合跑 2 次里 1 次 `AC2a-real` 红 —— 同样的形态。**两文件单跑各自恒绿**（10/10、8/8，多次；`AC2a` 单跑 ×3 全绿）。⇒ 这是两文件并行（各一个 child 进程）在共享宿主高载荷下的既有抖动，本任务未引入也未修复它（不在 Touches 内）。

### DoD — 不回收任何非本测试起的 scope

回收只按 `SHARED_HOST_SCOPE_PREFIXES`（`quay-anchor-` / `quay-serve-`）× **本文件自己的夹具 root 基名**圈定 —— ⛔ 不按 pid、⛔ 不按裸前缀。3 次归属化合跑 + 各次单跑之后，机上与本任务无关的 9 条 scope（cantus / claudecodeui×2 / quay×2 / quay-fleet / serve-cantus / serve-claudecodeui.service / serve-quay-fleet / serve-dbg-*）**前后逐条比对无变化**。A 阶段实验自己造出的 3 条 `e2e-restart-ac2a-*` 已随其夹具子进程到期自行收集，复查为 0。

## Touches

- plugin/test/driver-cli.test.mjs
- plugin/test/driver-restart-busy-e2e.test.mjs
- plugin/test/helpers/anchor-scope-reaper.mjs
- tasks/gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5.md
