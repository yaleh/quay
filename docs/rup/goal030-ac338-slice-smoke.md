# GOAL-030 AC-338 —— 六文件「整片」smoke 读数

**判据载体**：`goals/AC-338-*.md`（GOAL-030 的「测试与 smoke」整片验收）
**取证时刻**：2026-10-08T04:52:10Z（本机时区 +0800 = 12:52:10）
**取证主机**：VM-16-5-ubuntu（nproc=128）
**执行者**：任务 `gap-goal030-ac338-slice-smoke-verification`（worker，worktree `/home/yale/work/quay-worktrees/gap-goal030-ac338-slice-smoke-verification`）

本文件是 AC3「整片 smoke 读数已固化」的落盘载体：把 `scripts/test.sh <六文件>` 的**输出摘要**（`tests N ≥ 6`、`fail 0`、静态相位结论）与 **goal 判据树 tip sha** 从会被清理的 `/tmp` 固化进版本库。

---

## 1. 判据树与版本锚点

| 读数 | 值 |
|---|---|
| goal 分支 | `goal/GOAL-030` |
| goal 判据树路径 | `/home/yale/work/quay-worktrees/goal-GOAL-030` |
| **goal 判据树 tip sha** | **`e20ef12140bf3efef3c699b93044d84fcc83cde9`** |
| `git rev-parse goal/GOAL-030` | `e20ef12140bf3efef3c699b93044d84fcc83cde9`（与判据树 HEAD 一致） |
| 本任务 worktree HEAD | `e20ef12140bf3efef3c699b93044d84fcc83cde9`（= goal tip，任务分支 `task/gap-goal030-ac338-slice-smoke-verification` 从 goal/GOAL-030 开出） |
| goal 判据树最后提交 | `e20ef1214` · 2026-10-08 12:44:06 +0800 · `tasks: 翻 gap-goal030-promotion-writes-via-kernel-transition done（driver 机械 fan-in）` |

## 2. 六文件集齐备（AC2 读数）

六文件在 goal 判据树根逐个 `test -f` 全 `exit 0`：

```
OK   packages/quay/test/task-transition.test.mjs
OK   plugin/test/ready-pool-check-transition-writes.test.mjs
OK   packages/quay/test/lifecycle-edge-table.test.mjs
OK   plugin/test/carrier-registry-completeness.test.mjs
OK   packages/quay-native/test/characterization-store-write.test.mjs
OK   packages/quay/test/characterization-serve-routes.test.mjs
```

第 6 个文件（② 的产物）来自 ② 的 fan-in，且可在 `goal/GOAL-030` 上读出：

```
$ git -C /data/home/yale/work/quay log -1 --format=%H goal/GOAL-030 -- plugin/test/ready-pool-check-transition-writes.test.mjs
62f01fe135d0fa78ea757941de4659e20e8820ff
$ git -C /data/home/yale/work/quay merge-base --is-ancestor 62f01fe1… goal/GOAL-030   # ⇒ ancestor: YES
$ git -C /data/home/yale/work/quay show -s --format='%H %ci %s' 62f01fe1…
62f01fe135d0fa78ea757941de4659e20e8820ff 2026-10-08 11:55:27 +0800 GOAL-030 ②: promotion path writes status via kernel transition decision + event
```

⛔ 本任务**未新建**该文件（非目标），仅声明 `depends_on: gap-goal030-promotion-writes-via-kernel-transition` 并取其落地后的整片读数。

## 3. AC-338 判据执行读数（AC1 —— goal 判据树根）

判据以 bash 在 goal 判据树根执行（`root=$(git rev-parse --show-toplevel)` ⇒ `/home/yale/work/quay-worktrees/goal-GOAL-030`）：

| 项 | 值 |
|---|---|
| exit 码 | **0** |
| stdout | `PASS: scripts/test.sh on 6 files (kernel transition, ready-pool-check wiring, edge table, carrier registry, store-write golden, serve-route snapshot smoke): 26 tests, 0 fail` |
| stdout 含 `PASS:` | 是 |
| stderr | （空） |

判据全文（criterion，`quay goal show AC-338 --json`）：

```sh
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
cd "$root"
files="packages/quay/test/task-transition.test.mjs plugin/test/ready-pool-check-transition-writes.test.mjs packages/quay/test/lifecycle-edge-table.test.mjs plugin/test/carrier-registry-completeness.test.mjs packages/quay-native/test/characterization-store-write.test.mjs packages/quay/test/characterization-serve-routes.test.mjs"
for f in $files; do [ -f "$f" ] || { echo "CAUSE=test-file-absent — $f (the slice's own tests must exist before this AC can pass)" >&2; exit 1; }; done
log=$(mktemp /tmp/goal030-tests.XXXXXX); trap 'rm -f "$log"' EXIT
scripts/test.sh $files >"$log" 2>&1; rc=$?
fail=$(grep -oE '^ℹ fail [0-9]+' "$log" | tail -1 | awk '{print $3}'); tests=$(grep -oE '^ℹ tests [0-9]+' "$log" | tail -1 | awk '{print $3}')
[ -n "$tests" ] || { echo "NOT-EVALUATED: scripts/test.sh printed no test summary (exit $rc): $(tail -2 "$log" | tr '\n' ' ')" >&2; exit 3; }
[ "$rc" -eq 0 ] && [ "${fail:-1}" -eq 0 ] && [ "$tests" -ge 6 ] || { echo "CAUSE=tests-red — scripts/test.sh exit $rc, tests $tests, fail ${fail:-?}: $(grep -E '^not ok|✖' "$log" | head -3 | tr '\n' ' ')" >&2; exit 1; }
echo "PASS: scripts/test.sh on 6 files (kernel transition, ready-pool-check wiring, edge table, carrier registry, store-write golden, serve-route snapshot smoke): $tests tests, 0 fail"
```

同一判据在本任务 worktree 根（同 tip `e20ef1214`）独立复跑，同得 `exit 0` / 同一 `PASS:` 行（26 tests, 0 fail）——两次读数一致，非单次偶然。

## 4. `scripts/test.sh <六文件>` 输出摘要（AC3）

直接跑六文件集（未经判据包装），`exit 0`：

```
$ scripts/test.sh packages/quay/test/task-transition.test.mjs \
    plugin/test/ready-pool-check-transition-writes.test.mjs \
    packages/quay/test/lifecycle-edge-table.test.mjs \
    plugin/test/carrier-registry-completeness.test.mjs \
    packages/quay-native/test/characterization-store-write.test.mjs \
    packages/quay/test/characterization-serve-routes.test.mjs
…
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3666.368
```

| 摘要读数 | 值 | 满足 AC-338 |
|---|---|---|
| `tests` | **26** | ≥ 6 ✔ |
| `fail` | **0** | ✔ |
| `pass` | 26 | — |
| `cancelled` | 0 | — |
| `skipped` | 0 | — |
| `scripts/test.sh` exit | **0** | ✔ |

逐文件命中（26 个测试按文件来源）：`task-transition.test.mjs`（kernel 转移决策 5×5 边表 + 事件写入 + `patchStatusField`）、`ready-pool-check-transition-writes.test.mjs`（promote/retreat 两条接线各恰好一条事件 + 「拒绝/不可判 ⇒ 不写字节不写事件」的真实闸）、`lifecycle-edge-table.test.mjs`（边表）、`carrier-registry-completeness.test.mjs`（载体注册表 completeness/staleness/structure/DRIVER_KINDS 四项）、`characterization-store-write.test.mjs`（store-write 金样 + 并发 CAS 写）、`characterization-serve-routes.test.mjs`（web 路由快照 route-set）。

### 4b. 静态相位结论（AC3，含 `scripts/test.sh` 的静态相位）

`scripts/test.sh` 在同一 `exit 0` 内跑完了其静态相位（`run_static_checks` 域）。要点：

- **阻断相位结论**：整跑 `exit 0` ⇒ 静态相位无阻断违规。
- 三条报告阻断违规数的检查均为 0：`violations: 0`（tmp-leak pairing / checked-in-tree write / import-graph-sh-census 域内）。
- `checker-mutation-check --selftest: ALL PASS`；`checker-count-drift-check: PASS — every declared registry count matches its function body (3/3 evaluated)`；`PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.`
- 一处形如 `exit=1  FAIL: 1 处「脚本目录常量向上两级」手搓仓根 …` 的行是 `repo-root-derivation-check` 的 **mutation 自检 arm 2 RED**（**故意植入的缺陷**以证检查器能取假）：其后紧跟 `== arm 3 GREEN (unmutated object restored) == exit=0` 与 `case OK: repo-root-derivation-check took all three values (0/1/3) …`——**不是**本次六文件集的失败。
- 任务文件语法类违规（19 条，grow-only 台账）**明示非阻断**：`task-file syntax does NOT block the verification round (gap-task-file-static-syntax-should-not-block-product-verification)`。

> 注（如实）：`worktree-node-modules-check` 在该次 `scripts/test.sh` 输出中曾打印一行 `MISSING node_modules`（report-only、不阻断）。该行指向的是**当时另一个处于 provision 中途的 peer `task/*` worktree**，与本任务 worktree 无关——本任务 worktree 该检查复跑为 `OK symlink -> /data/home/yale/work/quay/node_modules`，且复查时 MISSING 集合为空。

## 5. 判据强度负对照（AC4 —— cp 移走 / cp 还原，⛔ 不用 `git checkout`）

在本任务 worktree（同 goal tip）上，`cp` 移走 `packages/quay/test/lifecycle-edge-table.test.mjs` 后重跑判据：

| 步骤 | exit 码 | 关键输出 |
|---|---|---|
| 基线（文件在位） | **0** | `PASS: … 26 tests, 0 fail` |
| `cp` 移走 `lifecycle-edge-table.test.mjs` 后重跑 | **1** | stderr `CAUSE=test-file-absent — packages/quay/test/lifecycle-edge-table.test.mjs (the slice's own tests must exist before this AC can pass)` |
| `cp` 还原后重跑 | **0** | `PASS: … 26 tests, 0 fail` |

还原完整性：`md5sum packages/quay/test/lifecycle-edge-table.test.mjs` 移走前后均为 `c9c12c76d726c86e969c28d6b6108211`；`git status --short` 对该文件为空（字节级还原，无残留）。

⇒ 判据**能取假**（不是恒真）：文件缺失被独立取值 `CAUSE=test-file-absent` + `exit 1` 捕获，与「合格」不共用输出（硬规则 3b）。

## 6. DoD 可见性（不落 develop 的判据）

本任务经 `goal/GOAL-030` 落地（mergeTarget 由 `goal_ac: AC-338` ⇒ GOAL-030 解析），GOAL-030 并入前本文件**不应**出现在 develop 上：

```
$ git show develop:docs/rup/goal030-ac338-slice-smoke.md
  ⇒ ABSENT（GOAL-030 尚未并入 develop，符合 DoD）
```

## 7. 健康度信号（AC5 —— 红即如实上报）

本次判据 **`exit 0`（绿）**，未触发 GOAL-030 §停止扩大范围的任何健康度信号（分支自举身份 / 架构 / 基线漂移 / 生产污染）。

⇒ 无「伪造 PASS、改判据、放宽断言、`--override` 换绿」发生（硬规则 4：不做未发生的解释；此处直接量 = 判据 exit 码 0 与 `fail 0`）。

## 8. 非目标遵守

- ⛔ 未新建 ② 的产物 `plugin/test/ready-pool-check-transition-writes.test.mjs`（沿用 ② fan-in 后 goal 树上的文件）。
- ⛔ 未改 AC-338 判据本身。
- ⛔ 未为取绿放宽任何测试断言。
- 负对照唯一临时改动为 `cp` 移走 / `cp` 还原（不落盘、不留痕）。
