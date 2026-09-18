---
id: gap-mirror-full-suite-state-retire-dead-cli-face
title: mirror-full-suite-state.ts 的模块面是活的、CLI
  入口面已死——退入口留模块；并纠正「pre-verified-round-record.ts 同形」这一误判（其 CLI 在
  fan-in-execute.js:496 仍被真调用）
status: ready
needs_human_cause: human-adjudication
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**结论先行**：`plugin/scripts/mirror-full-suite-state.ts` **不能整体退役**——它的**模块面是活的**；死的是它的 **CLI 入口面**（`main()` `:186` + 直接入口守卫 `:255`）。这两件事必须分开说，否则一动就出事。

### （一）模块面是活的（现场核实）

- `plugin/scripts/worker-driver.ts:231-232`：
  > （复用 `mirror-full-suite-state.ts` 的 build/write/skip 单一实现，⛔ 不另写一份 state shape）。
  > `import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";`
- 调用点 `worker-driver.ts:4940`（`mirrorMechanicalFanInSuiteState({…})`，机械 fan-in 的 suite 终态镜像写，定义在 `:5094`）。
- 产物被**下游 fail-closed 消费**：`/tests` 页读 `full-suite-state.json`；ff 闸 `packages/quay/src/fan-in/ff-merge.ts:421 readGreenMirrorCommit` 在 capture 缺失时回退读它（`:441`），要求 `state === "green"` ∧ `taskId` 匹配 ∧ `commit` 为 40-hex，否则返回 `""` ⇒ 闸 fail-closed（`:447` 另有 `git merge-base --is-ancestor` 祖先校验）。

**⇒ 模块一行都不能删。**

### （二）死的是 CLI 入口面（现场核实）

- 文件内有完整的 CLI：`const usage` `:172`、`export function main(argv)` `:186`、`if (isDirectEntry(import.meta, undefined, "mirror-full-suite-state"))` `:255`。
- **它没有活调用者**。本任务立案时对 `plugin/scripts/*.ts` 中含 `isDirectEntry(import.meta` 的 **125 个脚本**逐个做「是否有非注释的真调用者」扫描：`mirror-full-suite-state.ts` 的 invoked-by 集合为**空**。
- 据 `plugin/workflows/fan-in-execute.js:796-802` 的留痕，它的调用者是**已删除的 step 4.5 `# mirror-state-block`**——与 `gap-mirror-measure-history-retire-dead-writer` **同一根因、同一删除动作**。

### （三）⚠️ 一条必须先纠正的前提（否则会误删活代码）

立此项时有一个自然推断：「`pre-verified-round-record.ts` 完全同形，一并退」。**实测为假，且方向相反**：

- `plugin/workflows/fan-in-execute.js:496` **仍在真调用它的 CLI**——
  ```sh
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/pre-verified-round-record.ts \
    --task-id ${task} --run-id ${runId} … --preverified 0 --state red \
    --root ${worktree} --suite-log "$suite_log_file" …
  ```
  （红桶 suite 的 `verification-round` 入账路径；写在 `if [ "$full_suite_ran" = "true" ] && [ "$suite_exit" != "0" ]` 分支内。）
- 它的 `isDirectEntry` 守卫在 `:1056`、`main` 在 `:995`，**都是活的**。

**⇒ 这是硬规则 5b 的反向形态**：不是"修好一个漏了兄弟"，而是**"看到一个死了，就推断同族都死了"**。所以本任务的**兄弟集必须靠测量得出，不得靠形态推断**。

### （四）兄弟集的实测读数（立案时；供 AC1 复核）

125 个带直接入口守卫的脚本中，**16 个**在"非注释真调用者"意义下为孤岛：

```
claim-task.ts          derive-touches-heuristic.ts   mirror-full-suite-state.ts   mirror-measure-history.ts
outer-driver.ts        packaging-hygiene-check.ts    phase-declare.ts             quay-deliver.ts
red-window-triage.ts   server-partial-stop-verify.ts suite-bucket-attribution.ts  suite-bucket-hub-list.ts
suite-driver.ts        suite-lock-slots.ts           supervisor-preempt-candidates.ts  touches-parser.ts
```

⛔ 但**这 16 个不能一律当"死 CLI"**：其中多数是**纯库**（`touches-parser.ts` / `suite-lock-slots.ts` / `suite-bucket-attribution.ts` / `derive-touches-heuristic.ts` …），它们的直接入口守卫是**防御性的**、从来就不是给人跑的入口。判据须区分二者（见 Contract）。

## Contract

**判别式（本任务的核心产出）**——判为「死 CLI 入口面」须**同时**满足：

1. 文件含 `isDirectEntry(import.meta, …)` 守卫，**且**含一个真正的参数解析入口（`usage` 字符串 / `main(argv)`）；**且**
2. 该入口在所有非注释位置**零真调用者**（排除自身、自身测试、`capability-catalog.sh`、`select-static-checks-for-touches.ts`、`archive/`）；**且**
3. **有测试以子进程方式 spawn 它**（`spawnSync("node", [ … scripts/<name>.ts … ])`）——这是"它曾经是给人/给编排跑的入口"的物证。

**只满足 1+2 而 3 不满足者 ⇒ 判为「库上的防御性守卫」，不属本任务范围**（不得删除，可另立观察项）。

**处置（对判为死面的文件）＝ 退入口、留模块**：

- 删除 `usage` 常量 + `main()` + `isDirectEntry` 守卫，以及**仅为入口所用**的 import（如 `gate-script-base.ts` 的 `isDirectEntry` / `helpExit`——须确认模块面不再需要）。
- **保留**全部 `export`（`buildMirrorState` / `writeMirrorState` / `shouldSkipMirrorWrite` / `readCurrentState`）与文件头注释。
- 把该文件在 `select-static-checks-for-touches.ts` 的 `FAN_IN_ORCHESTRATION_FILES` 条目与 `capability-catalog.sh` 的对应行**改为如实描述**（"模块库，无 CLI 入口"）。⛔ **不得留一条声称存在调用者的「谁按」行**——那正是 `gap-mirror-measure-history-retire-dead-writer` 里 `:1946` 的缺陷形态。
- **它的测试须同步改造**：`plugin/test/mirror-full-suite-state.test.mjs:123` 用 `spawnSync` 跑 CLI（用例名 "AC1 — a running on-disk state makes the CLI mirror SKIP"）。退掉入口后该用例改为**进程内调用**（import `writeMirrorState` / `shouldSkipMirrorWrite`）或删除。⛔ 不得留一条 spawn 已删入口的用例（会让套件红），**更不得**把它改成"断言文件不存在"这种恒真/恒假断言（硬规则 3b）。

**⛔ 明确不在范围**：

- 模块本体任何 `export` 的行为。
- `pre-verified-round-record.ts`（**`:496` 活调用**，见（三））。
- 16 个孤岛中判为"防御性守卫"的那些。

## AC

- [x] AC1（兄弟集测量，先做）：复扫 + 16 个孤岛逐个分类 + 逐个判定证据 —— 见 §执行记录 AC1（表 + 命令 + 输出）。
- [x] AC2（负控制，硬规则 4 推论四）：对 `touches-parser.ts` 给出「若它其实是死入口，结论会不同」的对照读数，并说明它为何落到另一格 —— 见 §执行记录 AC2。
- [x] AC3：`pre-verified-round-record.ts` **不动**（`git status` 该文件为空），任务体记明理由 + `fan-in-execute.js:496` 调用现场；`node --test plugin/test/pre-verified-round-record.test.mjs` **70/70 绿** —— 见 §执行记录 AC3。
- [x] AC4：`mirror-full-suite-state.ts` 退入口留模块——删 `usage` / `main()` / `isDirectEntry` 守卫及入口专用 import；4 个 `export` 签名不变（git diff 见 §执行记录 AC4）。
- [x] AC5：`plugin/test/mirror-full-suite-state.test.mjs` 的 spawn 用例改为进程内调用，**不残留恒真/恒假断言**；该文件 **7/7 绿**、`spawnSync` 计数 0 —— 见 §执行记录 AC5。
- [x] AC6：`capability-catalog.sh` + `select-static-checks-for-touches.ts` 的登记行改为"模块库，无 CLI 入口"的如实描述；`node --test plugin/test/capability-catalog.test.mjs plugin/test/select-static-checks-for-touches.test.mjs` **38/38 绿**、catalog `0 unclassified` —— 见 §执行记录 AC6。
- [ ] AC7：`bash scripts/test.sh` 全量套件绿；命令与结果贴进任务体。⛔ **worker 侧结构上取不到本读数**（派发指令明确要求 worker 不跑全量 suite）⇒ 保持未勾 + 本注解；fan-in flip 闸实测判 `pass-external`（`total:7 / checked:6 / unchecked:1`，unchecked 即本条）。**2026-09-18 复派更新 —— 阻断已解除**：原全 loop 阻断因（develop 既有直投 `2d3a6fa35` 未入 `RULED_HISTORICAL_COMMITS` ⇒ 静态阶段 fail-closed ⇒ 三份在飞 fan-in suite 逐字同红）已由 `2e6e7a26c` 修复（登入 ruled 表，人 2026-09-18 裁定 ruled one-off）；本轮 worktree 内实测 `node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root $PWD` → **exit 0**，worktree 已干净 `git merge --no-edit develop`。本分支可执行的证据面全绿：scoped 门 `bash scripts/test.sh --for-task gap-mirror-full-suite-state-retire-dead-cli-face --allow-thin` → **exit 0**（45/45 测试 + delta 静态检查全 PASS：`mirror-pair-drift` / `superseded-capability` / `test-file-snapshot` / `capability-catalog` / `select-static-checks-for-touches` 等）；typecheck 门 **ADMITTED**（本 delta 无 new/moved .ts）。⇒ 三态区分：「全量 suite 跑了且绿」由 fan-in 的 mechanical suite 在 flip **之前**产出（suite 红 ⇒ 不落地 ⇒ 勾上不产生假的 done），但 worker **未观测** ⇒ ⛔ 不勾（勾上即把未观测的绿记成绿，硬规则 3b/4）。原阻断读数见 §执行记录 AC7（历史）。 —— 本项属外层验证（待外部）

## DoD

- **退入口**：`grep -c 'isDirectEntry\|export function main' plugin/scripts/mirror-full-suite-state.ts` → **0**。
- **留模块**：`grep -cE '^export function (buildMirrorState|writeMirrorState|shouldSkipMirrorWrite|readCurrentState)' plugin/scripts/mirror-full-suite-state.ts` → **4**。
- **无残留 spawn**：`grep -c 'spawnSync' plugin/test/mirror-full-suite-state.test.mjs` → **0**。
- **反例对照**：`node --test plugin/test/pre-verified-round-record.test.mjs` 仍绿（证明"退一个"没有波及活着的同族）。
- `bash scripts/test.sh` 一次真实全量套件绿的命令与结果贴进任务体。⛔ **worker 侧不可达**（派发指令明确要求不跑全量 suite）——该读数由外层机械 fan-in 的 mechanical suite 在 flip 之前产出。**2026-09-18 复派更新**：原阻断因（develop 既有直投 `2d3a6fa35` ⇒ `direct-to-develop-bypass-check` fail-closed ⇒ 全 loop 同红）已由 `2e6e7a26c` 修复，本轮 worktree 内该检查 **exit 0**。三态区分——「全量 suite 跑了且绿」本轮在 worker 侧**没发生过**，⛔ 不得读成「绿」。

## 执行记录（2026-09-18，worktree `/home/yale/work/quay-worktrees/gap-mirror-full-suite-state-retire-dead-cli-face`，base develop `b407fb1db`）

### AC1 —— 兄弟集复扫与逐个分类

**复扫命令与读数**（工作树内）：`grep -l "isDirectEntry(import.meta" plugin/scripts/*.ts | wc -l` → **124**（立案时记 125，**差 1**）。

⚠️ 差额已核，**不是代码变化**：以立案 commit `63b4f1bad` 为基线逐文件比对（对当时每个含守卫的 `plugin/scripts/*.ts` 跑 `git show <filing>:<path> | grep isDirectEntry` 再看今天盘上是否仍有），**没有任何文件丢过守卫、也没有文件被删**；递归 `--include=*.ts` 计数同为 124；无子目录守卫。⇒ 差额是立案时那次扫描的仪器偏差（+1），本记录基于实测的 124。

**扫描器**（两轴分开，⛔ 不把「模块 import」与「进程启动」混成一列）：
- **c2 轴一 · 模块 import** = 非注释行匹配 `\bfrom\s+["']…/<stem>.ts["']`；
- **c2 轴二 · 进程启动** = 非注释行同时含文件名与 `--experimental-strip-types` / `node` / `bash` / `spawnSync` / `spawn(` / `execFileSync` / `execSync`，且排除 `assert.` / `expect(` / `includes(` / `.has(` / `readFileSync` 这类**匹配式**（它们不是调用）。
- 注释行按位置排除（`//`、`*`、`/*`、`#`）；再排除自身、自身测试、`capability-catalog.sh`、`select-static-checks-for-touches.ts`、`archive/`、`node_modules`、`.git`。

**16 个孤岛逐个判定**（c1 守卫行 / c1 入口行 / c2 非注释真调用者 / c3 有子进程跑它的测试）：

| # | 文件 | c1 守卫 / 入口 | c2 真调用者 | c3 子进程测试 | 判定 |
|---|---|---|---|---|---|
| 1 | `claim-task.ts` | `:170` / `main :126` | **有** `plugin/scripts/claim-task.sh:148`（`node --no-warnings --experimental-strip-types "$SCRIPT_DIR/claim-task.ts"`） | 有 `plugin/test/claim-task.test.mjs:152,161` | 不属本任务（CLI 活） |
| 2 | `derive-touches-heuristic.ts` | `:175` / `main :149` | 仅模块 import（`plugin/scripts/concurrent-batch-scheduler.ts:33` 等 3 处）；进程启动 **0** | 无 | 库上的防御性守卫 |
| 3 | **`mirror-full-suite-state.ts`** | `:255` / `usage :172` + `main :186` | 进程启动 **0**（模块 import 1：`worker-driver.ts:232`） | **有** `plugin/test/mirror-full-suite-state.test.mjs:127-129`（`spawnSync("node", [… mirror-full-suite-state.ts …])`） | **死 CLI 入口面 ← 本任务动作对象** |
| 4 | `mirror-measure-history.ts` | `:151` / `usage :53` + `main :67` | 进程启动 0；唯一 import 是**自身测试** `:29`，且它以 **in-process** 调 `main()`，不是子进程 | 无 | c1∧c2 成立、c3 不成立 ⇒ 按 Contract 归**库上的防御性守卫格**（⇒ 本任务不动它） |
| 5 | `outer-driver.ts` | `:545` / `main :488` | 进程启动 0（单行 grep）；**真引用在注册表**：`driver-runtime.ts:172-181` `DRIVER_KINDS.outer.driver = "outer-driver.ts"`，通用 spawner 按表取文件名 | 无 | 不属本任务（有真引用：驱动 kind 注册表） |
| 6 | `packaging-hygiene-check.ts` | `:251` / `main :218` | 进程启动 0（单行 grep）；**间接真调用**：`quality-gate-driver.ts:215-218 defaultPackagingCheckArgv()` 组装 `node --no-warnings --experimental-strip-types <root>/plugin/scripts/packaging-hygiene-check.ts --root … --json`，调用点 `:309` | 无 | 不属本任务（⚠️ 调用点**跨行拼装**，单行 grep 必然漏） |
| 7 | `phase-declare.ts` | `:370` / `main :300` | 进程启动 0、import 0 | 无 | 库上的防御性守卫格 |
| 8 | `quay-deliver.ts` | `:31` / **无入口**（无 `usage` / `main`） | 进程启动 0 | 无 | 不属本任务（c1 不成立） |
| 9 | `red-window-triage.ts` | `:266` / `usage :175` + `main :185` | 进程启动 0；唯一 import 是自身测试 `:36` | **有** `plugin/test/red-window-triage.test.mjs:42-43`（`runCli` → `spawnSync`，`:189/:210/:222/:236/:239/:246` 六处调用） | **同为死 CLI 入口面（1+2+3 全成立）——但不在本任务 Touches，且 `orchestration/fast-mode-tick-core.md:72` C11 逐字教人用 `red-window-triage.ts --partition`、`orchestration/manager-phase-goal.md:3539` 写「不能退役」⇒ 记观察项，本任务不动** |
| 10 | `server-partial-stop-verify.ts` | `:677` / `main :475` | 模块 import 1（`server-restart-inflight-verify.ts:80`）；进程启动 0 | 无 | 库上的防御性守卫 |
| 11 | `suite-bucket-attribution.ts` | `:407` / `usage :368` + `main :380` | 模块 import 10；进程启动 0 | 无（初判有、**读行后否**：`plugin/test/suite-bucket-reattr-ratchet-check.test.mjs:98` 是写进 fixture 的**字符串字面量**，不是 spawn） | 库上的防御性守卫 |
| 12 | `suite-bucket-hub-list.ts` | `:174` / `usage :120` + `main :141` | 模块 import 3；进程启动 0 | 无 | 库上的防御性守卫 |
| 13 | `suite-driver.ts` | `:395` / `main :328` | 模块 import 6（`worker-driver.ts:228` 等）；进程启动 0 | 无 | 库上的防御性守卫 |
| 14 | `suite-lock-slots.ts` | `:180` / `usage :132` + `main :146` | 模块 import 15；进程启动 0 | 无（初判有、**读行后否**：`plugin/test/fan-in-workflow-lock.test.mjs:149` 是 `node -e` 里**import 模块**，不是启动 CLI） | 库上的防御性守卫 |
| 15 | `supervisor-preempt-candidates.ts` | `:329` / `main :286` | 进程启动 0（单行 grep）；**间接真调用**：`supervisor-preempt.sh:88` 的 `CANDIDATES_TS` 默认值 + `:206` `node --no-warnings --experimental-strip-types "$CANDIDATES_TS" "$@"` | 有（经 `supervisor-preempt.sh`） | 不属本任务（有真调用者，经 shell 变量间接） |
| 16 | `touches-parser.ts` | `:236` / **无入口** | 模块 import 18（`plugin/scripts` + `experiments/…` 双侧镜像）；进程启动 0 | 无 | 不属本任务（c1 不成立）—— AC2 负控制样本 |

**合计**：死 CLI 入口面 **2**（#3 本任务动作对象、#9 观察项）；库上的防御性守卫 **8**（#2/#4/#7/#10/#11/#12/#13/#14）；不属本任务 **6**（#1/#5/#6/#8/#15/#16）= **16**。

**典型真调用者读数原文**（`mirror-full-suite-state.ts`，排除自身与自身测试后）：
```
plugin/scripts/worker-driver.ts:232: import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";
（进程启动面：0 行 —— 这就是「入口死、模块活」的读数本身）
```

**本表暴露的两个仪器教训**（都已在上面按行标注）：① **跨行拼装的调用点会被单行 grep 漏掉**（#6、#15 —— 文件名与 `node` 不在同一行）；② **「同窗口出现 spawnSync + 文件名」不是 spawn**（#11 是 fixture 字符串、#14 是 `node -e` 里的模块 import），这两处若不读行就会把 c3 报成 YES、把库上的防御性守卫误升格成「死 CLI 入口面」。

### AC2 —— 负控制（`touches-parser.ts`）

```
$ grep -n 'isDirectEntry(import.meta' plugin/scripts/touches-parser.ts
236:if (isDirectEntry(import.meta, undefined, "touches-parser")) {
$ grep -cE '^(export )?(async )?function main\(|^const usage = ' plugin/scripts/touches-parser.ts
0
```
⇒ **c1 的「真正的参数解析入口」不成立**：这个文件根本没有任何 argv 解析面，`:236` 那个守卫是**防御性的**（被当脚本执行时保持安静）。**它落在「不属本任务」格与它的调用者计数无关**。

**反事实对照（若它其实是死入口，结论会不同）**：把**同一个谓词**对 `mirror-full-suite-state.ts` 干跑，退入口前取到 `usage :172` + `main :186`（c1 成立）⇒ 同一扫描下它进候选；`touches-parser.ts` 在同一列取 **0** ⇒ 落到另一格。这正是硬规则 2 的**零计数半边**要求的动作——**零计数的配套动作是把谓词对着一个已知为真的样本干跑一次**（否则零计数既可能是「真没有」也可能是「谓词写错了」）。

**第二条对照 —— c3 是 A/B 格的判据，且本扫描器在这一格出过一次假阳性**：`suite-lock-slots.ts` 满足 c1∧c2（守卫 `:180` + `usage :132`/`main :146`；进程启动 0；15 处模块 import）。**若 c3 也成立，它就是死 CLI 入口面、就该退入口**——它落在 B 格的**唯一**依据是 c3 = 否；而**同窗口式 spawn 检测器最初对它报的就是 YES**，读行后才发现 `plugin/test/fan-in-workflow-lock.test.mjs:149` 是在 `node -e` 里 `import { suiteLockSlotCount } from "…/suite-lock-slots.ts"`（**import 模块**），不是启动 CLI。⇒ 判据可**两个方向取假**（既曾把库报成入口候选，也会把真入口漏成库），不是恒真/恒假量。

### AC3 —— `pre-verified-round-record.ts` 不动（反例对照）

```
$ git status --short plugin/scripts/pre-verified-round-record.ts      → （空）
$ node --test plugin/test/pre-verified-round-record.test.mjs          → tests 70 / pass 70 / fail 0
```
**理由（留给后来者，⛔ 别顺手把同族删干净）**：它的 CLI 面是**活的**——`plugin/workflows/fan-in-execute.js:496` 逐字调用现场（红桶 suite 的 `verification-round` 入账路径，写在 `if [ "$full_suite_ran" = "true" ] && [ "$suite_exit" != "0" ]` 分支内）：
```sh
if [ "$full_suite_ran" = "true" ] && [ "$suite_exit" != "0" ]; then
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/pre-verified-round-record.ts \
    --task-id ${task} --run-id ${runId} --started-at "$start_iso" --duration-ms "$wall_ms" \
    --lane-count "$lane_count" --load "$load" --commit "$suite_head" --preverified 0 --state red \
    --root ${worktree} \
    --suite-log "$suite_log_file" --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" …
```
它的守卫 `:1056` / `main :995` 都是活的。它与 `mirror-full-suite-state.ts` **形态同族而结论相反**，所以「判死/判活」必须逐文件测量。

### AC4 —— 退入口留模块（`git diff --stat` + DoD 三条）

```
$ git diff develop...HEAD --stat
 plugin/scripts/capability-catalog.sh               |   8 +-
 plugin/scripts/mirror-full-suite-state.ts          | 150 ++++-----------------
 plugin/scripts/select-static-checks-for-touches.ts |   2 +-
 plugin/test/mirror-full-suite-state.test.mjs       |  36 +++--
 4 files changed, 44 insertions(+), 152 deletions(-)
```
- 删：`usage` 常量、`export function main(argv)`、`getArgValue`、`if (isDirectEntry(import.meta, undefined, "mirror-full-suite-state"))`，以及**仅为入口所用**的 import —— `gate-script-base.ts` 的 `isDirectEntry`、`node:path`、`per-task-suite-record.ts` 的 `resolveSharedCheckout`（逐个确认模块面不再需要；`fs` / `toIsoTimestamp` / `writeJsonAtomic` 保留，模块面在用）。
- 留：4 个 `export` 签名逐字不变，文件头注释保留（它是这份 state shape 的正本）；头注释里描述 CLI argv / exit 2 的段落改为模块契约（`buildMirrorState` 返回 `{error}`，调用方不写）。
- 有意**未改** `#!/usr/bin/env node`：同目录的纯库 `suite-lock-slots.ts` 也带 shebang，且 shipped-entry 一族检查动的是 shipped 入口面——改它不在本任务判据内，属"顺手改"风险。
- DoD 三条实测：`isDirectEntry|export function main` = **0**；4 个 export = **4**；测试文件 `spawnSync` = **0**。

### AC5 —— 测试改造（进程内）

原 `:123` 用例是**唯一**以子进程跑 CLI 的用例（物证「它曾经是给人/给编排跑的入口」）。入口退掉后改为**进程内**：把 `running` 态写到盘上 → `readCurrentState(file)` → `shouldSkipMirrorWrite(cur)` 必须为 true → 盘上状态未被覆盖。保留的正是原用例真正想钉的那条链（**盘上态 → 读 → 跳过决策**），⛔ 不是"断言文件不存在"那种恒真/恒假形状。

```
$ node --test plugin/test/mirror-full-suite-state.test.mjs
ℹ tests 7 / pass 7 / fail 0
```

### AC6 —— 登记面改为如实描述

- `capability-catalog.sh` **CONSUMER（谁按）行**原文写「谁按：fan-in-execute workflow step 4.5 的 `# mirror-state-block` …」——**该调用者已不存在**；改为「【模块库，无 CLI 入口】」（含原入口面死因 + 活的调用者 `worker-driver.ts` 的 `mirrorMechanicalFanInSuiteState` 于 `:5094`、import 于 `:232`、调用点 `:4940`）。⛔ 不留任何指向不存在调用者的「谁按」行。
- 同表 QUESTION 行补「MODULE LIBRARY 无 CLI 入口」；INVALIDATION 行把「本 workflow 内」改为「机械 fan-in（worker-driver.ts）」；LAST_REAFFIRMED `2026-08-18` → `2026-09-18`。
- `select-static-checks-for-touches.ts` `FAN_IN_ORCHESTRATION_FILES:283` 注释同步为「mirror MODULE LIBRARY, no CLI entry（条目本身保留：动这个文件仍应触发 fan-in 编排面静态检查）」。
- 实测：`node --test plugin/test/capability-catalog.test.mjs plugin/test/select-static-checks-for-touches.test.mjs` → **tests 38 / pass 38 / fail 0**；`bash plugin/scripts/capability-catalog.sh --summary` → `341 scripts | 341 declared | 0 unclassified | 336 ship`；`--json` 里该文件的 `consumer` 字段即上述如实描述。

### AC7 / DoD 尾条 —— 全量 suite 的真实读数（⛔ 当时未达成；2026-09-18 复派：阻断已由 `2e6e7a26c` 解除，见 AC7）

```
$ bash scripts/test.sh          # worktree 内，2026-09-18
…
RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore
PASS — AC56 判据1/2/3: recommended (1) is de-ordered …
STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): direct-to-develop-bypass-check(exit=1)
__OVERHEAD__ lock_overhead_ms=26 partial=1
EXIT=1
```
**红在静态检查阶段的 fail-closed，套件在进入 node 测试泳道之前就中止** ⇒ 本轮**没有任何测试泳道的结论**（不得读成"测试全挂"）。红因逐字指名：

```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root <worktree>   → exit 1
direct-to-develop-bypass-check: evaluated=true ok=false (direct-commit-bypasses-fan-in)
  RED 2d3a6fa3580947889d42f8234e9d2fe389386f18 — mem: 修掉 quay serve host 泄漏链 + --orphan-serves 回收模式 + serve 堆上限
```

**「与本分支无关」的三条对照（硬规则 4 推论四：附一个若前提为假则结果会不同的对照）**：
1. **主检出同红**（同一份 `.git`、develop 树）：在主检出 `--root /home/yale/work/quay` 跑同一条命令 → **exit 1、同一条 RED sha**。⇒ 不是 worktree 上下文造成的。
2. **该 sha 是 develop 的既存祖先**：`git merge-base --is-ancestor 2d3a6fa35 develop` → true；`git log -1` 报 `2026-09-18 04:11:28 +0000  Yale Huang  mem: 修掉 quay serve host 泄漏链…`——它**早于本分支的创建**，且不在 `direct-to-develop-bypass-check.ts:234 RULED_HISTORICAL_COMMITS` 里（`grep -c 2d3a6fa35` 该文件 = 0）。
3. **与本任务 delta 面零交集**：本分支 delta 只有 4 个文件（见 AC4 的 `--stat`），没有一个是该提交的产物面（`plugin/scripts/worktree-process-reaper.ts` 等）；该检查的分类面是 reflog + 提交内容，不看工作树。

**这不是本任务一家的红**：`.quay/fan-in-suite-*.log` 里在飞任务的三份 fan-in suite 日志（`gap-suite-bash-lpt-forwarder-dead-on-default-path` / `gap-mirror-mechanical-fanin-fail-open-posture-undocumented` / `gap-mirror-measure-history-retire-dead-writer`）**逐字同一条** `STATIC_CHECK_FAILED: direct-to-develop-bypass-check` + `# suite red static-check` ⇒ **全 loop 阻断**。

**最小可行动修法（留给有裁定权的一层，⛔ 本任务不动它）**：把 `2d3a6fa35` 按既有 ruled 惯例登进 `plugin/scripts/direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS`（带一行定案理由），或由裁定层 revert/改走 fan-in；两条路都要求「谁有权裁定一次直投」这个判断，**不属于 per-task worker 的授权面**（本任务 Touches 也不含该 checker），故只报告、不代裁。

**本分支自身可执行的证据面**（全绿）：scoped 门 `bash scripts/test.sh --for-task gap-mirror-full-suite-state-retire-dead-cli-face --allow-thin` → **exit 0**（45 项测试 + 全套 delta 静态检查 PASS：`superseded-capability` / `mirror-pair-drift` / `test-file-snapshot` / `capability-catalog` / `select-static-checks-for-touches` 等）；外加 `mirror-full-suite-state` 7/7、`pre-verified-round-record` 70/70、`capability-catalog` + `select-static-checks-for-touches` 38/38。

### 交付面小结

| 项 | 状态 |
|---|---|
| 退 CLI 入口面（`mirror-full-suite-state.ts`） | ✅ `isDirectEntry`/`main` 计数 0，import 面已按需收缩 |
| 留模块（4 个 export） | ✅ 计数 4，签名不变；活的消费者 `worker-driver.ts:232/4940/5094` 未动 |
| 测试改造为进程内 | ✅ 7/7 绿，`spawnSync` 计数 0 |
| 登记面如实描述 | ✅ catalog `0 unclassified`；CONSUMER 行不再指不存在的调用者 |
| 反例对照（`pre-verified-round-record.ts` 不动） | ✅ 70/70 绿 |
| 全量 suite 绿（AC7） | ⏳ **worker 侧不可达（外层验证）**：阻断已于 2026-09-18 由 `2e6e7a26c` 解除（本轮 worktree 内 `direct-to-develop-bypass-check` exit 0）；读数由 fan-in 的 mechanical suite 在 flip 前产出，见 AC7 |
| 观察项（本任务不动） | `red-window-triage.ts` 同样满足 1+2+3，但不在 Touches 且有 tick 文档的操作性指令；`mirror-measure-history.ts` / `phase-declare.ts` 等 8 个落 B 格 |

## Touches

- plugin/scripts/mirror-full-suite-state.ts（退 CLI 入口面，留模块）
- plugin/test/mirror-full-suite-state.test.mjs
- plugin/scripts/capability-catalog.sh
- plugin/scripts/select-static-checks-for-touches.ts
- tasks/gap-mirror-full-suite-state-retire-dead-cli-face.md

## Needs-Human

**执行 2026-09-18T05:27:01.237Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 45
- run_id：wk-prod-anchor
- session_id：285d4b48-05fe-496a-8e8c-4373035722cf
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-mirror-full-suite-state-retire-dead-cli-face~wk-prod-anchor~1789708968875-dea557.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-mirror-full-suite-state-retire-dead-cli-face-wk-prod-anchor.log