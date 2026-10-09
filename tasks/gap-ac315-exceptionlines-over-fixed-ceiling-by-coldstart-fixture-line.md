---
id: gap-ac315-exceptionlines-over-fixed-ceiling-by-coldstart-fixture-line
title: AC-315 回归（exceptionLines 7500→7501）：08e6209f7 给例外文件
  verify-deliver-coldstart.sh 加 1 有效行，顶破固定上限（唯一合法出口 = 把例外文件有效行总数减回 ≤7500）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-315
---
## Finding

**判据此刻为假（本轮复核，逐字非引述）**：把 `goals/AC-315-*.md` 的 `criterion` 逐字跑（cwd = 主检出 `/data/home/yale/work/quay`）⇒ **exit 1**。逐字 stderr：

```
CAUSE=exception-list-grew — exceptionLines=7501 >7500（例外清单被拿来逃棘轮）
```

（census 本体 `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 逐字：`evaluated:true`、`verdict.ok:true`、`verdict.over:[]`、`verdict.baselineRaised:[]` —— 两个【仅降不升】的棘轮本身没回升；破的是判据第三段的**固定上限** `totals.exceptionLines>7500`。）

**7 个例外文件逐行**（census `files[].exception===true`；`codeLines` = 去空行 / 去首个非空白字符为 `#` 的纯注释行）：

| 文件 | 本轮 codeLines | 校准值（origin 记的 2026-09-20 实测） |
|---|---|---|
| plugin/scripts/verify-deliver-coldstart.sh | **6294** | 6293 |
| plugin/scripts/supervisor-observe.sh | 297 | 297 |
| plugin/scripts/process-budget.sh | 207 | 207 |
| plugin/scripts/send-keys-reliable.sh | 194 | 194 |
| plugin/scripts/supervisor-deliver.sh | 192 | 192 |
| plugin/scripts/supervisor-preempt.sh | 171 | 171 |
| plugin/scripts/supervisor-bus.sh | 146 | 146 |
| **合计** | **7501** | **7500** |

⇒ 七个文件里**只有 `verify-deliver-coldstart.sh` 动了：+1 有效行**。

**这是回归而非恒红**：`goal_get AC-315` 逐字 —— `evidence.firstAt=2026-10-01T17:58:48.349Z`（首次失败）→ `activatedAt=2026-10-01T18:04:26.240Z` → `statusLog` 含 `active→achieved @ 2026-10-01T18:08:52.699Z`（**判据曾通过**）→ 本轮 `evidence.at=2026-10-09T12:00:57.539Z`、`verdict=fail`。⇒ 通过态存在过，现被打破。

### 根因（按位置，⛔ 不按关键词）：08e6209f7 给一个例外文件加了 1 个有效行

引入点 = `08e6209f7`（2026-10-07 23:11:05 +0800，`fix(verify-deliver-coldstart): fake-npm fixture must lay down plugin/bin/quay`）。该提交在合成 npm 夹具（`case install)` 段）新增一行：

```
printf '#!/usr/bin/env node\nconsole.log("0.6.1-fake");\n' > "$pkg/plugin/bin/quay"; chmod +x "$pkg/plugin/bin/quay"
```

并把 `mkdir -p` 行的目录表加了 `"$pkg/plugin/bin"`（同行，不增加行数）。**有效行计数逐提交可核**：

- `git show 08e6209f7^:plugin/scripts/verify-deliver-coldstart.sh` ⇒ **6293** 有效行
- `git show 08e6209f7:plugin/scripts/verify-deliver-coldstart.sh`（= 现工作树）⇒ **6294**

⇒ 该提交动机良性（调用点切到 `<pkg>/plugin/bin/quay` 后夹具少铺一条路径，致 14 个 selfcheck 红），但它把一个【被 7500 上限冻结的例外文件】净增 1 个有效行，恰好顶破上限。**7500 是【固定】常量**（`goal_get AC-315` 的 `origin` 逐字：`7500 = 2026-09-20 例外清单 7 个文件的 exceptionLines 实测（6293+207+194+146+192+297+171），用来堵「把文件加进例外清单以逃棘轮」`）—— 它同时冻结了例外文件的【总有效行】，而例外文件是活代码、会合法增长 ⇒ **零余量**：下一次任何 1 行编辑都会让它再度转红。

<!-- dedup-ref -->
**与开着的同文件任务的关系（仅溯源，⛔ 非合并、⛔ 非关系边声索）**：`gap-ac214-tenth-crossing-producer-callsite-missing-init-verb`（`todo`，`goal_ac: AC-214`）也 Touches `plugin/scripts/verify-deliver-coldstart.sh`，但机制不同 —— 它修的是 `:1456`/`:4583` 两个调用点缺 `init` 子命令（产出者写不出 freshness 记录），落点与验收（AC-214 判据）独立；本条的对象是**`exceptionLines` 固定上限被夹具 +1 行顶破**。决定 = **separate**（独立验收；同文件由调度器按 Touches 串行，无并行损失）。

## Requested action

1. **把 `totals.exceptionLines` 降回 ≤7500（至少 −1）**，通过**真正减少例外文件的有效行**达成。立即目标 = 撤掉 08e6209f7 引入的那 1 行净增：那行写出的内容 `#!/usr/bin/env node\nconsole.log("0.6.1-fake");\n` 与它上方两行为 `$pkg/bin/quay` 写出的字面量**完全相同** ⇒ 可直接复用 `$pkg/bin/quay`，把它并入相邻既有行（例如用 `;` 接在 `: > "$pkg/plugin/scripts/quay-init.sh"` 那一行后写成 `cp "$pkg/bin/quay" "$pkg/plugin/bin/quay"`），净 −1。**优先**找真正冗余/死行删除（真减债）；找不到再对上行做最小折叠。
2. **留余量**：目标 ≤7490（多减 ~10 行）。零余量上限下，下一次例行 1 行编辑会立刻再度转红（本轮即活例）。
3. **⛔ 三条禁止路径（正是 AC-315 要防的逃逸）**：① 改 `goals/AC-315-*.md` 的 `criterion` 常量 `7500`；② 改 `plugin/sh-census-exceptions.txt`（增删条目或理由）；③ 抬高任何 census 基线（`plugin/sh-census-baseline.json` 等）。
4. **负控制**：改完 `bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` 必须仍 `exit 0` —— 证明减行没有把 08e6209f7 修的那个 fixture 行为再弄坏。
5. **重跑 AC-315 判据本体，直到 exit 0。**

## AC

- [x] AC1 改前读数（可假，复跑非引述）：逐字跑 `goals/AC-315-*.md` 的 `criterion` ⇒ **exit 1** 且 stderr 逐字含 `CAUSE=exception-list-grew — exceptionLines=7501 >7500`；贴 `sh-census-check --json` 的 `evaluated`/`verdict.ok`/`verdict.over`/`verdict.baselineRaised`/`totals`，及 7 个例外文件的 codeLines 表 + 合计 = 7501。
- [x] AC2 回归而非恒红：贴 `goal_get AC-315` 的 `evidence.firstAt`、`activatedAt`、`statusLog` 中 `active→achieved @ 2026-10-01T18:08:52.699Z` 与本轮 `verdict=fail` 的 `evidence.at`，给出「通过态存在过、现被打破」。
- [x] AC3 根因按位置 + 可核计数：贴 `git show 08e6209f7 -- plugin/scripts/verify-deliver-coldstart.sh` 的 hunk，与 `08e6209f7^` 对 `08e6209f7` 的 `countCodeLines` 读数（**6293 → 6294**）逐字。
- [x] AC4 修复后判据（能取假）：逐字跑 AC-315 判据 ⇒ **exit 0**；贴 `sh-census-check --json` 的 `totals.exceptionLines` 实际值（须 ≤7500）。
- [x] AC5 未走禁止路径（负控制）：`git show --stat <fix-commit>` 证明改动**不含** `goals/AC-315-*.md`、`plugin/sh-census-exceptions.txt`、`plugin/sh-census-baseline.json`（或任一 census 基线）；贴该 `--stat`。
- [x] AC6 减行未弄坏行为：`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` **exit 0**，贴尾部逐字（14 个 selfcheck 测试仍过）。

## DoD

- 主检出上 `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 逐字报 `totals.exceptionLines ≤ 7500`，且 AC-315 判据本体（`goals/AC-315-*.md` 的 `criterion` 逐字）**exit 0** —— 这是【真对象被真机制读出】的落地，⛔ 不是「改了一行 shell」。
- 改动落在 `plugin/scripts/verify-deliver-coldstart.sh` 本体并**合入 develop**；`git show develop:plugin/scripts/verify-deliver-coldstart.sh` 的有效行 ≤7499（develop 上的读数也过）。
- 禁止路径三者在 `git show <fix-commit>` 里**均不出现**。
- 负控制（`--selfcheck` 绿）逐字入 `## Evidence`。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac315-exceptionlines-over-fixed-ceiling-by-coldstart-fixture-line.md

## Evidence

### AC1 改前读数（逐字复跑，exit 1）

```
$ bash <AC-315 criterion>          # cwd = 主检出 /data/home/yale/work/quay
CAUSE=exception-list-grew — exceptionLines=7516 >7500（例外清单被拿来逃棘轮）
CAUSE=sh-ratchet-violated-or-not-evaluated — shell 层棘轮回升/例外清单增长，或 census 未评估
EXIT=1
```

`sh-census-check --json`（改前）：`evaluated:true`、`verdict.ok:true`、`verdict.over:[]`、`verdict.baselineRaised:[]`、`totals.exceptionLines = 7516`。

> ⚠️ **前提漂移（如实记录，非引述）**：立案时（`evidence.at=2026-10-09T12:00:57.539Z`）读数是 **7501**（verify-deliver-coldstart.sh = 6294）；本轮复核已是 **7516**（该文件 6309）。成因可定位：立案后同文件又落两个提交 —— `8d382f8a1`（2026-10-09 20:27:42 +0800，该文件 6294→6293）与 `bea88e2fd`（2026-10-09 21:08:54 +0800，6293→6309），即本任务 dedup-ref 里那条 AC-214 任务（`gap-ac214-tenth-crossing-producer-callsite-missing-init-verb`，现已 done）落地所致。⇒ 硬要求仍是 `totals.exceptionLines ≤ 7500`；「立即目标 −1」相应变为 **−16**，外加「留余量」共 **−26**。

7 个例外文件改前 codeLines（census `files[].exception===true`）：

| 文件 | 改前 codeLines |
|---|---|
| plugin/scripts/verify-deliver-coldstart.sh | 6309 |
| plugin/scripts/supervisor-observe.sh | 297 |
| plugin/scripts/process-budget.sh | 207 |
| plugin/scripts/send-keys-reliable.sh | 194 |
| plugin/scripts/supervisor-deliver.sh | 192 |
| plugin/scripts/supervisor-preempt.sh | 171 |
| plugin/scripts/supervisor-bus.sh | 146 |
| **合计** | **7516** |

### AC2 回归而非恒红（`goal_get AC-315` 逐字）

- `evidence.firstAt = 2026-10-01T17:58:48.349Z`（首次失败）
- `activatedAt = 2026-10-01T18:04:26.240Z`
- `statusLog`: `draft→active @ 2026-10-01T18:04:26.240Z`、`active→achieved @ 2026-10-01T18:08:52.699Z`
- 本轮 `evidence.at = 2026-10-09T15:03:29.776Z`、`verdict = fail`、`reading = acceptance failed (exit 1) — CAUSE=exception-list-grew — exceptionLines=7516 >7500…`
- `firstEvidenceAt = 2026-10-01T17:58:48.349Z`

⇒ 通过态存在过（achieved @ 18:08:52.699Z）、现被打破 ⇒ **回归**，⛔ 非恒红。

### AC3 根因（按位置 + 逐提交 countCodeLines）

`git show 08e6209f7 -- plugin/scripts/verify-deliver-coldstart.sh` 的 hunk（`case install)` 段）：

```
-    mkdir -p "$prefix/bin" "$pkg/bin" "$pkg/scripts" "$pkg/plugin/scripts" "$pkg/plugin/.claude-plugin"
+    mkdir -p "$prefix/bin" "$pkg/bin" "$pkg/scripts" "$pkg/plugin/scripts" "$pkg/plugin/bin" "$pkg/plugin/.claude-plugin"
     printf '#!/usr/bin/env node\nconsole.log("0.6.1-fake");\n' > "$pkg/bin/quay"; chmod +x "$pkg/bin/quay"
     ...
     : > "$pkg/plugin/scripts/quay-init.sh"
+    printf '#!/usr/bin/env node\nconsole.log("0.6.1-fake");\n' > "$pkg/plugin/bin/quay"; chmod +x "$pkg/plugin/bin/quay"
```

`countCodeLines`（`plugin/scripts/sh-census-check.ts` 本体）逐字读数：

- `git show 08e6209f7^:plugin/scripts/verify-deliver-coldstart.sh` ⇒ **6293**
- `git show 08e6209f7:plugin/scripts/verify-deliver-coldstart.sh` ⇒ **6294**
- `git show 8d382f8a1:…` ⇒ 6293；`git show bea88e2fd:…` ⇒ 6309；`git show develop:…` ⇒ 6309

### AC4 修复后判据（exit 0）

```
$ bash <AC-315 criterion>          # 修复后
EXIT=0
```

`sh-census-check --json`（修复后）：`totals.exceptionLines = 7490`（≤7500）；`evaluated:true`、`verdict.ok:true`、`verdict.over:[]`、`verdict.baselineRaised:[]`；`verify-deliver-coldstart.sh codeLines = 6283`。

### AC5 未走禁止路径（负控制）

`git show --stat 0f839f56a`：

```
 plugin/scripts/verify-deliver-coldstart.sh | 86 +++++++++++-------------------
 1 file changed, 32 insertions(+), 54 deletions(-)
```

⇒ 不含 `goals/AC-315-*.md`、`plugin/sh-census-exceptions.txt`、`plugin/sh-census-baseline.json`（或任一 census 基线）。减行方式**均为真减债**：抽出两处重复副本（`VC_JSON_PRE` JSON 读取前导 ×7、`ac_files_non_bookkeeping`「非记账」判定 ×3），删死代码（`ac258_plugins_json` 零调用者；`task_exists`、`ac203_kind_line` 死赋值），并把合成 npm 夹具的第二次 `printf` 换成 `cp "$pkg/bin/quay"`。

### AC6 减行未弄坏行为（负控制逐字）

```
$ bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck
EXIT=0
selfcheck: ac-record-schema(AC1 whole-row-removed) rc=1 unregistered=1 (expect non-0/1 — 少一行声明会打印全绿报告, 故须由【产出侧反查】兜住)
selfcheck: PASS — AC2 direct measures can take false …（145 条断言全部 PASS）
```

改前/改后 `--selfcheck` 输出 diff **只剩随机临时目录名与 sentinel 的 sha256**（后者内含临时路径）——145 条 `selfcheck:` 断言的取值逐字不变，14 个原 selfcheck 测试仍过。

补充（同一负控制的层面）：`node --test plugin/test/verify-deliver-coldstart.test.mjs` ⇒ **31/31 pass**；合并 develop 后的 scoped gate `bash scripts/test.sh --for-task gap-ac315-exceptionlines-over-fixed-ceiling-by-coldstart-fixture-line --allow-thin` ⇒ **exit 0**。