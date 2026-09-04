---
id: gap-web-board-needs-an-inconsistency-verdict-it-does-not-have
title: /board must join intent, execution and landing — and decide whether to
  reuse the drift checker or reimplement its judgment
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`docs/proposals/quay-web-observation-surface.md` §4 第一步的核心是 `/board`：
任务列表 + **意图 / 执行 / 落地三列** + 不一致高亮。

这比 [[gap-web-cannot-show-what-the-loop-is-doing-now]] 的两条路由难，因为它**要下判断**：

| 显示 | 判据 |
|---|---|
| `done 但未落地` | frontmatter `done` + `## Touches` 的代码根条目在 master 上不存在 |
| `已落地但未收尾` | 代码在 master + 遥测无 `--task-end` |
| `在飞超时` | `--task-start` 后超过阈值仍无 end |
| `孤儿` | 有 start 无 end 且进程已不存在 |

### 未决问题：复用还是重实现（提案 §7，人尚未裁定）

**前两条判据与 `plugin/scripts/task-status-drift-check.ts` 是同一个判断。**
那个检查器 2026-08-03 刚被修过（[[gap-reverse-drift-check-buries-true-positives-in-noise]]），
现在有 `BOOKKEEPING_ROOTS` 划分、`hasAnyCodeRootTouch()`、`stripTouchAnnotation()` 等
**踩过坑才得到的细节**——重实现几乎必然会漏掉其中几条，然后 `/board` 会显示与检查器**不同**的结论。

| 选项 | 代价 |
|---|---|
| **复用** `task-status-drift-check.ts` | Core（`packages/`）依赖 `plugin/scripts/` —— **架构上是倒置的**，Core 应当 provider-agnostic |
| **重实现** 在 `observation.ts` 里 | **双源**：同一个判断两份实现，必然漂移。今晚已被这种双源绊过一次（tick 文档重述 `VALID_BLOCKED_REASONS`） |
| **第三条路**：把判断抽到一个两边都能依赖的位置 | 需要决定那个位置在哪，成本未知 |

**本任务的第一步就是回答这个问题，并把依据写下来**——不是先写代码再补理由。

### 为什么这个判断值得单独一个任务

`/board` 的四条判据是**人用来判断「循环是否健康」的全部依据**。
它们如果与检查器不一致，人会同时看到两个互相矛盾的结论，
而**不知道该信哪个**——这比没有看板更糟。

## Contract

```
measure  board_flags = `curl -s http://127.0.0.1:4173/board` 输出中 data-flag 属性的计数字段
measure  checker_flags = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json` 输出的 suspects 与 reverse 字段长度之和
band     agreement = board_flags 与 checker_flags 必须逐个任务一致    # 不一致即本任务失败
invariant 被扫描的任务集合在两边一致                                  # 集合不同则计数不可比
invoke   `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`
control  人为把一个 done 任务的 Touches 指向不存在的代码文件 ⇒ 两边都必须标它，且标同一种
resume   n/a: 单次请求，无中途产物
```

## Chosen mechanism

**先决定复用还是重实现，写下依据，再实现。顺序不能反。**

### 第一步：回答架构问题（本任务的主要产出）

逐条回答，**依据是代码事实不是偏好**：

1. `task-status-drift-check.ts` 的判定逻辑是否是**纯函数**（无 I/O、无进程）？若是，抽取成本很低。
2. Core 现在是否**已经**依赖 `plugin/` 的任何东西？（若已有先例，倒置的代价就不是新增的）
3. 抽到哪里两边都能依赖？`packages/quay/src/` 下？还是一个新的共享位置？
4. 若重实现，**两份实现漂移时谁是权威**？答不出来就不该重实现。

**输出一段结论 + 依据**，写进任务体。

#### AC1 结论：复用，且以「子进程调用」复用——不 import，不重实现

**判定不是纯函数，但「子进程调用」让抽取成本归零。** `resolveSymbol()`
（task-status-drift-check.ts:142）`execFileSync("grep", ...)` 跑子进程，
`scanTasks()`（:450）`fs.readFileSync`/`readdirSync` 读文件系统——所以判定
**不是**「无 I/O、无进程」的纯函数。但那个模块**已经**是一个参数化的独立脚本
（`scanTasks({ repoRoot, tasksDir, ... })`），且 `--json` 输出就是权威结论。
因此**不需要把代码抽到任何新位置**——复用方只需把检查器当外部工具调用，就像
`observation.ts` 早就 `execFileSync("git", ...)`（observation.ts:214/391）一样。

**Core 目前没有任何对 plugin/ 的依赖，所以「import 复用」是新倒置。** 事实：
`grep -rn "from \"\.\./\.\./\.\./plugin" packages/quay/src/` 返回空；`packages/quay/src`
里所有 `plugin/` 字样都是注释/字符串（mcp-server.ts 的 instrument 发现），不是 import。
反向（plugin/scripts → packages/quay/src）倒是存在（config-wiring-check.ts 动态
`await import(pathToFileUrl(...))`）。所以 Core→plugin 的**静态 import** 是新边，
应当避免。

**结论：第三条路即「复用 + 子进程调用」。** 检查器留在 `plugin/scripts/`（唯一权威），
`observation.ts::readBoardLanding()` 用 `execFileP("node", ["--experimental-strip-types",
<checker>, "--json"])` 调它（observation.ts:497），解析 suspects/reverse，映射成
`done-unlanded`/`landed-not-closed` 两个 data-flag。这不是重实现（没有第二份判定逻辑），
也不是模块级 import（没有 Core→plugin 静态边）——它就是 `observation.ts` 已经对 `git`
做的事，只不过这次对方是检查器脚本。**因此 AC2 的逐任务一致是构造性的**：/board 的落地列
直接消费检查器自己的 `--json` 输出，两边不可能不一致。

**AC4：没有重实现，所以「漂移时谁是权威」问题不存在。** 权威就是 `task-status-drift-check.ts`
本身——它 2026-08-03 刚修过（BOOKKEEPING_ROOTS/hasAnyCodeRootTouch/stripTouchAnnotation），
是踩过坑的单一判断源。/board 是它的投影，不是第二份实现。若未来真有人重实现，权威仍是检查器
（更老、被 fixture 钉住、gate 测试过的那个），但本任务**不**走那条路。

**代价与降级（AC6）：** 子进程调用意味着 plugin/scripts 缺失时落地列降级为「无数据/读失败」，
/board 仍 200（测试 AC6 覆盖）。这是「复用」而非「重实现」的必然——Core 不拥有判断，所以
产品安装无 methodology 层时那一列诚实地说「读失败」，而不是给一个可能不同的结论。

### 第二步：按结论实现 `/board`

三列：**意图**（任务库的 status/labels）· **执行**（遥测的 start/end）· **落地**（git 里代码是否存在）。
四条判据按第一步的结论接线。

### 第三步：一致性回归

`/board` 的标记必须与 `task-status-drift-check.ts` 在**同一份任务库上逐个任务一致**。
不一致即失败——这是 AC2，也是本任务存在的理由。

**不做**：不新增判据（四条就是四条，不借机扩充）；不做写操作；
不因为「看板上不好看」而调整判据的阈值——那是把判断迁就展示。

## Acceptance Criteria

- [x] AC1: 架构问题的四问逐条回答，**依据是代码事实**（grep/实跑），结论写进任务体
      （见上方「AC1 结论」：复用 + 子进程调用，不 import 不重实现）
- [x] AC2: `/board` 的标记与 `task-status-drift-check.ts` 在真实任务库上**逐个任务一致**；
      不一致的任务逐个列出并说明原因（应为 0 个）——由构造保证（落地列消费检查器
      自己的 `--json` 输出）；serve-board.test.mjs 的 AC2 用例逐任务断言 0 个不一致
- [x] AC3: **负控制**——人为构造一个 `done` 但 Touches 指向不存在代码的任务，
      两边都必须标它且标同一种；移除后两边都不标（serve-board.test.mjs 的 AC3 用例）
- [x] AC4: 未选择重实现（选择复用），且任务体写明：权威是 `task-status-drift-check.ts`
      本身；若未来重实现，权威仍是检查器（更老、被 fixture 钉住、gate 测试过的那个）
- [x] AC5: 三列（意图/执行/落地）各自的数据源在页面上可见，读者能判断某一列为空是「无数据」还是「读失败」
- [x] AC6: 数据源缺失时 `/board` 仍返回 200 并降级，不 500（serve-board.test.mjs 的 AC5/AC6 用例）
- [x] AC7: 现有路由行为不变，既有测试全绿（serve.test.mjs + live-state.test.mjs 复跑全绿）
- [x] AC8: 测试带 `// @test-group product` 声明（serve-board.test.mjs 首行）

## Execution record

invoke 入口路径（Contract invoke 的 executable 入口）：`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`（web-board serve 路由，由 serve-board.test.mjs 覆盖真实 HTTP 端点；scoped + 全量绿证实）。

invoke 证据（scoped，`scripts/test.sh --for-task ... --allow-thin`，2026-08-05）：

```
scripts/test.sh: --for-task gap-web-board-needs-an-inconsistency-verdict-it-does-not-have — test-selection-thin (selector exit 1); re-run with --allow-thin to suppress
# --allow-thin 复跑：
warning: test-selection-thin: task gap-web-board-needs-an-inconsistency-verdict-it-does-not-have resolved tests for 1/4 Touches entries (0.25) < 0.5; pass --allow-thin to run anyway
PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

thin 是预期的：4 条 Touches 里 3 条是源文件（observation.ts / serve-handlers.ts /
任务文件本身），只有 serve-board.test.mjs 是测试文件，所以测试选择比例 1/4 < 0.5。

四个用例逐一对应 AC2/AC3/AC5+AC6/AC7 执行列：
- AC2: /board data-flag agrees with the drift checker per-task (reuse by construction)
- AC3: negative control — done task with Touches→nonexistent code is flagged by BOTH;
  fixing the touch unflags BOTH
- AC5/AC6: three data sources visible; a missing source degrades to 200 (never 500)
- AC7/execution column: /board renders the execution (telemetry) column with in-flight + timeout flags

既有路由回归（AC7）：`node --test packages/quay/test/serve.test.mjs
packages/quay/test/live-state.test.mjs` → 全绿（serve 5 用例 pass / 0 fail）。

AC2 逐任务一致对照（来自测试实际断言，0 个不一致）：
- BD-1（done，Touches→不存在的 `packages/quay/src/never-exists.ts`）→ 检查器 reverse，
  /board `data-flag="done-unlanded"` ✓ 同一种
- BD-2（todo，Touches→存在的 `packages/quay/src/board-symbol.ts`，符号可解析）→ 检查器
  suspects，/board `data-flag="landed-not-closed"` ✓ 同一种
- BD-3（ready，无独特符号）→ 两边都不标 ✓
- count(data-flag) == suspects.length + reverse.length ✓

**re-dispatch 复核（2026-08-05，inner agent 验证，非重实现）：** 该任务此前已在
`fb1fd520`（master 祖先提交）完整落地（observation.ts::readBoardLanding +
serve-handlers.ts::handleBoard + serve-board.test.mjs），任务体 AC 已勾选。本次
re-dispatch 复核为**验证性**——在干净 worktree 复跑 scoped 集与既有路由回归，
实现未改动：

```
bash scripts/test.sh --for-task gap-web-board-needs-an-inconsistency-verdict-it-does-not-have --allow-thin
✔ AC2: /board data-flag agrees with the drift checker per-task (reuse by construction)
✔ AC3 negative control: done task with Touches→nonexistent code is flagged by BOTH (same kind); fixing the touch unflags BOTH
✔ AC5/AC6: three data sources visible; a missing source degrades to 200 (never 500)
✔ AC7/execution column: /board renders the execution (telemetry) column with in-flight + timeout flags
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ cancelled 0
```

既有路由回归（AC7，复核）：`node --test packages/quay/test/serve.test.mjs
packages/quay/test/live-state.test.mjs` → serve 5 pass / 0 fail；live-state 4 pass / 0 fail。
核对结论：落地实现与任务体 AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8 逐条相符，无缺漏、无重实现漂移。

## Definition of Done

- [ ] AC1 的四问回答与 AC2 的逐任务一致性对照贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**看板与检查器给出不同结论，比没有看板更糟**——
      人会同时看到两个矛盾的答案且不知道该信哪个

## Touches

- tasks/gap-web-board-needs-an-inconsistency-verdict-it-does-not-have.md（自身文件：勾 AC + 贴 invoke 证据授权）
- packages/quay/src/observation.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve-board.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:46:00Z
changed: 把提案 §7 那个我提过、人未裁定的开放问题（复用 drift checker 还是重实现）**提升为本任务的第一步且是主要产出**，而不是留在实现里临时决定；并加 AC4——若选重实现必须先写明漂移时谁是权威，因为今晚已被同类双源绊过一次（tick 文档重述 VALID_BLOCKED_REASONS）
