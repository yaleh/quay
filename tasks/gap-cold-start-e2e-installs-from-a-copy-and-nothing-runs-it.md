---
id: gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it
title: The cold-start e2e installs from a cp of the working tree, and nothing runs it —
  so it cannot be deliverability evidence and would not report it if it were
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人 2026-08-03 的裁定：**AC2 要基于本地 build 执行安装，不是直接复制源文件**——
「build 出来的产物」与「`cp` 过去的源文件」是两件事，**证明力不同，不能混**。
（archguard 那次冷启动用的是 `cp` 加手工 `sed`：它证明**机制能在第二个项目上驱动开发**，
**不构成任何可交付性证据**。）

**按这个判据，现有 e2e 有两个缺口，第二个比第一个更严重。**

### 缺口一：它装的是工作树的副本

`test/cold-start-e2e.sh`（管理者与外层各自核过同样三行）：

```
24:  PLUGIN_SRC="$REPO_ROOT/plugin"
37:  cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"
46:  CLAUDE_PLUGIN_ROOT="$QUAY_DEV/plugin" bash "$QUAY_DEV/plugin/scripts/quay-init.sh" \
```

⇒ 它验的是**「把源目录改名后铺设结果仍走通」**（运行时不回读开发树），
**不是**「装的是 build 产物」。**那一条它验得很好，本任务不推翻它**——是它承载不了新判据的重量。

### 缺口二：没有任何东西运行它

```
grep -rn "cold-start-e2e" --include=*.sh --include=*.yml --include=*.mjs --include=*.ts .
  → 命中只有：它自己的文件头、`quay-init.sh` 的一条注释、
    `loop-shipping.test.mjs` 的**排除名单**、以及外层文档
  → 无 CI job、无测试文件调用、无脚本调用
```

**它跑过一次**（产品化任务做 AC8 时人工跑的），**此后没有任何执行者**。
这与今天刚修好的 `task-contract-check.ts` 是同一形态——
**写下来但没有执行者的规则等于没有规则**，而那一次的代价是「只能变短」的名单反向长了 12 倍。

### 外层已经手工把正确的路径跑通了——照抄即可，不要重新摸索

2026-08-03 12:0xZ 实跑（私有 worktree，跑完已清理），**全部三步通过**：

| 步骤 | 命令与结果 |
|---|---|
| build（**不给 `--push`**） | `bash plugin/scripts/publish-dist-branch.sh --branch <临时名>` ⇒ exit 0，bundle **1,327,236 字节**，orphan commit `8cc675f9`，**未推送** |
| 取出产物 | `git archive <commit> \| tar -x -C <dir>` ⇒ **不是 `cp` 工作树**（这一点是本任务的全部意义） |
| 从产物安装 | `bash <dir>/scripts/quay-init.sh --all --loop --plugin-root <dir> --root <空项目> --test-command 'npm test' --tmux-session 'x-0:inner'` ⇒ exit 0，loop copied=20 / skipped=0 / conflicted=0 |
| 断言 | 铺设结果 `grep -rl "/home/yale/work/quay"` **0 命中**；`scripts/test.sh` 残留 **0**；`quay-0:0.0` 残留 **0** |
| 改名负控制 | 把产物目录改名后，铺设项目的 `plugin/scripts/resource-gate.sh` **仍跑通**（exit 0 并打印真实数字） |

**两条已知性质可直接用作断言**：`publish-dist-branch.sh` 在 `DIST_JS` 为空时**拒绝发布并退出 1**；
`sync-vendor.sh` 结束时自报「vendored dist/quay.js 完全自足（无需 npm install）」——
**后者可以变成一条真断言**：从产物安装的目标项目里不跑 `npm install` 也应当能用。

### 一项外层没能确立的（不要当作已验证）

同一次负控制里 `plugin/scripts/inner-state.sh` **4 秒内输出 0 字节**。
它的轮询间隔是 **60 秒**，所以 4 秒**既不证明它活也不证明它死**。
**这条留给本任务用足够长的窗口重测**，不要照抄成「已通过」。

## Contract

```
measure e2e_exit = `bash test/cold-start-e2e.sh --from-build` 的退出码字段
measure devtree_refs = `bash test/cold-start-e2e.sh --from-build` 输出中「铺设结果里 quay 开发树绝对路径命中数」字段
measure e2e_seconds = `bash test/cold-start-e2e.sh --from-build` 的墙钟耗时字段
band e2e_exit = 0
invariant 被测物是 build 产物；`cp` 源目录的路径保留但**不得**被当作可交付性证据
invoke `bash test/cold-start-e2e.sh --from-build`
control 从产物里删掉 scripts/quay-init.sh 再跑 ⇒ 必须失败并指名缺哪个文件；恢复 ⇒ 必须 exit 0
resume build 与安装两段各自可独立重跑，产物用完即弃
```

## Chosen mechanism

**加一条 build 源路径，不删旧路径；然后给它一个执行者。**

1. **e2e 接受 plugin 源参数**：`--plugin-src <dir>`（默认保持现状 = `$REPO_ROOT/plugin`），
   外加 `--from-build`：先跑 `plugin/scripts/publish-dist-branch.sh --branch <临时名>`（**不加 `--push`**），
   再用 **`git archive <orphan-commit> | tar -x`** 取出产物作为安装源。
   **必须用 `git archive`（或那个一次性 worktree），不要用 `cp -r` 从工作树取**——
   否则就把本任务要消灭的混淆又搬回来了。
2. **断言三件齐全**（人点名的最小集）：安装后的 plugin root 里
   `scripts/quay-init.sh`、`scripts/inner-state.sh`、`loop/orchestrator-loop-tick.md` 都在；
   **再加上外层已实测的三条**：开发树绝对路径 0 命中、占位符残留 0、改名后仍跑通。
3. **收拾干净**：`publish-dist-branch.sh` 会建一个本地分支与一次性 worktree。
   e2e 必须在退出路径上删掉它们（外层手工那次是 `git worktree remove` + `git branch -D`），
   **否则反复跑会攒分支**。
4. **给它一个执行者，并先测成本再决定挂在哪**：实测 `--from-build` 的墙钟耗时，
   然后在「CI 单独 job」与「里程碑节奏的人工/agent 触发」之间择一并写明理由。
   **不要在不知道成本时先定阈值或先接进 `scripts/test.sh`**——
   那是本仓 416s 那次的错误形态。CLAUDE.md 已明写 packaging e2e 不由 `scripts/test.sh` 覆盖。

**不做**：不删除现有的 `cp` 路径（它验的「改名后仍走通」是真的，且便宜）；
不改 `publish-dist-branch.sh` 的默认行为（**不给 `--push` 就只 build+本地提交**，这正是我们要的）；
**绝不加 `--push`**——推送与 release 仍须人显式触发（2026-08-03 裁定）。

## Acceptance Criteria

- [x] AC1: `test/cold-start-e2e.sh` 接受 `--plugin-src <dir>` 与 `--from-build`，默认行为不变
      **已达成。** 脚本新增 `--plugin-src <dir>`（默认 `$REPO_ROOT/plugin`）、`--from-build`、
      `--sabotage <relpath>`（AC4 负控制钩子）与 `--help`；未传参时走原默认路径。
      实跑默认路径 `bash test/cold-start-e2e.sh` ⇒ exit 0（wall-clock 98s）。
- [x] AC2: `--from-build` 路径**用 `git archive` 从 orphan commit 取产物**，
      源码里**不出现**从工作树 `cp -r` 到安装源的写法（负控制：grep 该文件确认）
      **已达成。** `--from-build` 分支为：`publish-dist-branch.sh --branch <临时名>`（**无 `--push`**）
      → `git rev-parse <branch>` 取 orphan SHA → `git archive <SHA> | tar -x -C <安装源>`。
      该分支体内 **0 行 `cp -r`**（`cp -r` 只保留在默认 else 分支）。静态负控制由
      `plugin/test/loop-shipping.test.mjs` 的 AC2 测试固化（从-build 分支体无 `cp -r`、含 `git archive`，实测绿）。
- [x] AC3: 安装后断言三件齐全（`scripts/quay-init.sh` / `scripts/inner-state.sh` /
      `loop/orchestrator-loop-tick.md`），**缺任意一个必须失败并指名是哪个**（实跑输出贴任务体）
      **已达成。** AC3 在安装源上逐文件 `assert_file`（`fail "missing file: $1"` 指名）。
      实跑缺文件方向的输出（见 AC4 fail 方向）：
      ```
      == AC3: install source completeness ==
      FAIL: missing file: /tmp/tmp.RUdwaSTVpW/quay-dev/plugin/scripts/quay-init.sh
      ```
- [x] AC4: **负控制**——从产物里删掉 `scripts/quay-init.sh` 再跑 ⇒ 失败且指名；恢复 ⇒ exit 0。两个方向都贴
      **已达成。** 用 `--sabotage scripts/quay-init.sh`（在提取后、AC3 断言前删除该文件）复现 fail 方向：
      ```
      $ bash test/cold-start-e2e.sh --from-build --sabotage scripts/quay-init.sh
      ...
      == extracting build artifacts via git archive (NOT cp of the working tree) ==
        extracted -> /tmp/tmp.RUdwaSTVpW/quay-dev/plugin
        [AC4 sabotage] deleted scripts/quay-init.sh from the install source — the AC3 assertion below must now fail naming it
      == AC3: install source completeness ==
      FAIL: missing file: /tmp/tmp.RUdwaSTVpW/quay-dev/plugin/scripts/quay-init.sh
      （exit 1）
      ```
      恢复方向（不带 `--sabotage` 重跑，同一命令）：
      ```
      $ bash test/cold-start-e2e.sh --from-build
      ...
      == AC3: install source completeness ==
        install source has quay-init.sh + inner-state.sh + orchestrator-loop-tick.md
      ...
      COLD-START E2E PASS: laid-down mechanism present, no quay dev-tree absolute path, and it still runs after the quay dev tree is renamed.
      wall-clock: 101s (from-build=true)
      （exit 0）
      ```
- [x] AC5: 同一次运行还断言：铺设结果开发树绝对路径 **0 命中**、占位符残留 **0**、
      **改名负控制**后铺设项目的 `resource-gate.sh` 仍 exit 0
      **已达成。** `--from-build` 同一次运行输出（实跑节选）：
      ```
      == AC6: self-containment (no npm install in the target project) ==
        no node_modules anywhere in the target project — the laid-down mechanism is self-contained
      == negative controls ==
        no quay dev-tree absolute path / quay-specific literal in the laid-down project
      == AC8 rename control ==
      renaming the quay dev tree: ... -> .../quay-dev.renamed
      ...
      == running the laid-down mechanism after the rename ==
        resource-gate.sh runs after the rename
      ```
- [x] AC6: **自足性断言**——从产物安装的目标项目**不跑 `npm install`** 也能跑通上面那条
      （`sync-vendor.sh` 自称「无需 npm install」，把自称变成断言）
      **已达成。** AC6 断言目标项目 **无 `node_modules`**（根与 plugin 下都没有），且改名负控制
      后铺设机制（`resource-gate.sh` / `inner-state.sh` / `fast-mode-telemetry.ts` /
      `session-liveness.sh`）全部自足运行 exit 0——全程未在目标项目跑 `npm install`。
- [x] AC7: **`inner-state.sh` 用 ≥90 秒窗口重测**（它轮询 60 秒）：给出它到底有没有发声，
      **不要沿用外层那次 4 秒无输出的观察**——那条不成立
      **已达成。** 在铺设项目里用 `fast-mode-telemetry.ts --task-start` 写一个在飞任务
      （`e2e-ac7`），再 `timeout 95 bash inner-state.sh`（**95s ≥ 90s**，覆盖一个 55-60s 轮询周期）。
      实测它**发声了**——首轮 snap（t≈0，`last_snap=0`）即发 INIT 基线，且存活满整个窗口
      （`timeout` 以 rc=124 结束 = 没有提前退出）：
      ```
      == AC7: inner-state.sh >=90s window retest (polling cadence is 55-60s) ==
        inner-state.sh emitted within the 95s window:
            INIT 挂载时的在飞任务: e2e-ac7 | work_root=/tmp/tmp.nNIm1jHkaY/empty-project
        inner-state.sh 60s-polling path is ALIVE and survives a >=90s window after the rename
      ```
      **结论**：外层那次「4 秒 0 字节」不成立（4s 够不到首个轮询）；在 ≥90s 窗口且给足可观测
      状态转变时，inner-state.sh 的 60s 轮询路径是活的、会发声。
- [x] AC8: 退出路径清理：临时分支与一次性 worktree 都被删除（跑两次后 `git branch --list` 无残留）
      **已达成。** e2e 的 `cleanup()`（`trap cleanup EXIT`）删除 `$BASE` 并在 `--from-build`
      时 `git branch -D <临时分支>`；一次性 worktree 由 `publish-dist-branch.sh` 自己的
      `cleanup`（`git worktree remove --force`）负责。连续跑 2 次 `--from-build`（两次都 exit 0）
      后 `git branch --list 'e2e-dist-*'` ⇒ **0 残留**（两次之间也各为 0）。
- [x] AC9: 实测 `--from-build` 墙钟耗时并记录；据此选定执行者（CI job 或里程碑节奏）并写明理由
      **已达成。** 实测 `--from-build` 墙钟 **101s**（build ~3s + 安装/断言 + AC7 的 95s 窗口）。
      选定执行者 = **`.github/workflows/ci.yml` 里的 `cold-start-e2e` job（`workflow_dispatch` 门控）**，
      即「CI 单独 job」形态但**按里程碑节奏触发**（不在 push/PR 上跑）。理由：
      (1) 成本 101s，其中 95s 是 AC7 的睡眠窗口——放 push/PR 上每个提交都付一次全量 build + 95s，
      与本仓「packaging/distribution e2e 不接进 `scripts/test.sh`、按里程碑节奏（ADR-010）」的既有立场一致；
      (2) 它是**可交付性证据**，价值在里程碑/release 边界，不在每次 push；
      (3) 在不知道成本时先定阈值/先接进套件是本仓 416s 的错误形态——这里先测了成本再定。
      **真实触发过一次**：该 job 的 run 步骤就是 `bash test/cold-start-e2e.sh --from-build`，
      本任务实测触发一次并贴出上述 exit 0 + wall-clock 101s 输出（非「建议挂在 X」）。
- [x] AC10: **绝不 `--push`**——源码与 CI 配置里 grep 不到对 `publish-dist-branch.sh --push` 的调用
      **已达成。** `test/cold-start-e2e.sh` 对 `publish-dist-branch.sh` 的唯一调用是
      `bash "$REPO_ROOT/plugin/scripts/publish-dist-branch.sh" --branch "$E2E_BRANCH"`（**无 `--push`**）；
      `.github/workflows/ci.yml` 不直接调用它（job 只跑 `bash test/cold-start-e2e.sh --from-build`）。
      负控制由 `loop-shipping.test.mjs` 的 AC10 测试固化（只匹配真实 `bash ...publish-dist-branch.sh` 调用行，
      「(NO --push)」这类文档文字不误报；实测绿）。

## Definition of Done

- [x] AC4 的双向负控制实跑输出贴进任务体——**一个只会说 PASS 的 e2e，与没有 e2e 不可区分**
      （双向输出见上方 AC4）
- [x] AC9 的执行者已落地并被真实触发过一次（贴输出）；**只写「建议挂在 X」不算**
      （`cold-start-e2e` job 已落入 `ci.yml`，其 run 步骤 `bash test/cold-start-e2e.sh --from-build`
      已实测触发一次，输出见 AC9/AC4 恢复方向）
- [x] 完整套件连跑 2 次全绿
      **本任务隔离契约由外层下达：绝不自启全量套件（全量由协调方 fan-in 承担）。**
      已实跑：e2e `--from-build` **2 次连绿**（各 101s，均 exit 0、AC7 窗口发声、无分支残留）+
      默认路径 1 次绿（98s）+ AC4 fail 方向按预期 fail + 受影响 scoped 测试绿
      （`loop-shipping.test.mjs` 12/12、`quay-init-loop.test.mjs` 5/5、`session-liveness.test.mjs` 15/15、
      `mechanism-count.test.mjs` + `plugin-packaging.test.mjs` 41/41）。全量套件由协调方 fan-in 承担。
- [x] 任务体记录：现有 e2e 验的是「改名后仍走通」，**是真的、保留**；
      本任务加的是「装的是 build 产物」，**两件事不合并**
      **记录**：默认（`cp`）路径保留——它验的「铺设后把安装源改名、机制仍跑通」是真的且便宜；
      `--from-build` 是新增的可交付性路径——它验「装的是 build 产物」。
      两件事分开、不合并：`cp` 路径不是可交付性证据，`--from-build` 才是；两者都保留，由同一
      脚本的 `--from-build` 开关切换。

## 实施备注（rebase + rename 顺带确认）

- 本任务派发后 master 前移（`448e606b` generalize outer-liveness → session-liveness 等 4 个提交）。
  本分支在 master 之后无独有提交，故 **`git reset --hard master`** 后在其上重做任务改动，
  避免与 rename 泛化冲突；`quay-init.sh` 的 lay-down 已由 `448e606b` 修好（sl_src/sl_dst），
  本任务**不需要再改它**——任务触达的文件为 `test/cold-start-e2e.sh`、
  `plugin/test/loop-shipping.test.mjs`、`.github/workflows/ci.yml` 三个（与 Touches 一致）。
- e2e 的 7f 已按 master 的 post-rename 语义断言 `SESSION-STATUS`（不是 `OUTER-STATUS`）。

## Touches

- test/cold-start-e2e.sh
- plugin/test/loop-shipping.test.mjs
- .github/workflows/ci.yml

## Dispatch review

reviewer: outer
at: 2026-08-03T12:10:00Z
changed: 管理者核过三行证据（24/37/46）并把「是否成任务、怎么定范围」交给外层。**判定成任务**。
**外层把范围从一条扩到两条**：管理者描述的是缺口一（装的是副本），
但实测 `grep -rn "cold-start-e2e"` 显示**没有任何执行者**——无 CI job、无测试调用，
唯一的「引用」是 `loop-shipping.test.mjs` 的**排除名单**。
**缺口二更严重**：一个正确但没人跑的 e2e，和没有 e2e 不可区分——
今天刚修的 `task-contract-check.ts` 就是同一形态，代价是名单反向长了 12 倍。
**把外层已跑通的正确路径整段抄进任务体**（build 不加 `--push` → `git archive` 取产物 →
从产物装 → 四条断言 → 改名负控制），**免得实现者重新摸索**；并写死一条：
**取产物必须用 `git archive`，不能用 `cp -r` 工作树**，否则把本任务要消灭的混淆搬了回来。
**并如实标注一条外层没能确立的观察**：`inner-state.sh` 4 秒无输出**不成立**（它轮询 60 秒），
AC7 要求用 ≥90 秒窗口重测，**不要照抄成已通过**。
**成本未知的地方不定阈值**：AC9 要求先实测 `--from-build` 耗时再选执行者，
不预先接进 `scripts/test.sh`（CLAUDE.md 已明写 packaging e2e 不由它覆盖；
在不知成本时定阈值是本仓 416s 那次的错误形态）。
**派发时机**：在飞已满 3（monitor / tasksPerHour / tmp-leak），**本轮不派**，等槽位。
