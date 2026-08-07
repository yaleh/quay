---
id: gap-r1-cannot-see-tests-writing-into-the-live-task-store
title: R1 only sees __dirname/.tmp writes, so a test writing a fixed-name file into the
  real tasks/ went undetected until git swept it into a commit
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03，一个测试 fixture 被误提交进真实任务库（`tasks/M-FAKE-FRONTMATTER-SCOPE-M124.md`，
提交 `b505d3aa`，内层随即 revert `33f21599`）。内层记为发现并写明「R1 扫描器只认 dot-tmp 形态未捕获」，
处置留作待办。**外层独立复核确认了它，并把「为什么没被捕获」定位到具体谓词。**

### 实测一：写的是真实数据目录，不是临时目录

`experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs:390-392`：

```js
const taskId = "M-FAKE-FRONTMATTER-SCOPE-M124";
const taskPath = path.join(process.cwd(), "tasks", `${taskId}.md`);
fs.writeFileSync(taskPath, taskText);
```

`finally` 里有 `fs.rmSync(taskPath, {force:true})`，**所以它不是泄漏**——文件只在测试窗口内存在。
但它有两个后果，都已发生或可复现：

1. **固定名 ⇒ 两个并发套件互相踩**（这正是 R1 存在的理由，type specimen 是 relation-sync 的
   8 并发副本 7 个崩溃）
2. **窗口内任何 `git add -A` 都会把它扫进提交**——这次就是这样进的 master，
   而它进的是**任务库**：`task list`、web UI、`task-status-drift-check`、任务计数全部会看见它

### 实测二：R1 的谓词看不见这个形状（这才是要修的东西）

`plugin/scripts/test-isolation-check.ts:238-256` 的 `detectFixedPathWrites` 要求**两个条件同时成立**：

```js
const isCheckoutPath = codeRegionHas(..., /__dirname|import\.meta|fileURLToPath/);
const hasDotTmp      = codeStrings(...).some(s => /\.tmp(?:-|\b)/.test(s));
if (!isCheckoutPath || !hasDotTmp) continue;
```

而这次的写入是 `path.join(process.cwd(), "tasks", ...)` ——**`process.cwd()` 不在那个正则里，
路径里也没有 `.tmp`**，两个条件一个都不满足。

**规则的说明（同文件第 13 行）写的是「tests must write only to per-run-unique paths」，
而实现是「`__dirname` 拼一个 `.tmp` 字面」。** 说明覆盖的是一个类，实现覆盖的是一个**标本**——
`relation-sync` 那一个。这是本仓已命名的「名不符实」族
（`docs/analysis/instrument-failure-mode.md`），R1 是它的又一个成员。

### 实测三：类的规模——一个，不要夸大

外层用写操作 + 真实数据目录路径参数的方式扫过
`packages/*/test`、`plugin/test`、`experiments/*/test`（命令见下方 `invoke`），
其余命中全部是 `path.join(tmp, ...)` / `path.join(dir, ...)` 这类临时根，**目前只有这一个真实例**。
**所以这个任务的价值不在「批量修 N 个」，在于探测器覆盖的是标本还是类**——
下一个这样写的测试今天同样不会被报出来。

### 修的时候有一个陷阱：那个测试是故意写真实目录的

测试自己的注释写明：它需要**真实 frontmatter 代码路径**（fixture fallback 没有 `---` 块），
所以才在真实 `tasks/` 下建文件。**因此「改成 mkdtemp」不是无脑替换**——
要么让被测的 `run()` 接受一个 workspace root，要么在临时目录里造一个完整的工作区。
**如果修完之后它不再走真实 frontmatter 路径，那是把覆盖删掉了，不是把隔离修好了。**

## Contract

```
measure r1_hits = `node --no-warnings --experimental-strip-types plugin/scripts/test-isolation-check.ts --root . --json` 输出中 rule=fixed-path-write 的条目数字段
measure live_dir_writes = `node --no-warnings --experimental-strip-types plugin/scripts/test-isolation-check.ts --root . --json` 输出中新增的 liveDataDirWrites 条目数字段
band live_dir_writes = 0
invariant 探测器覆盖的是「非唯一路径写入」这个类，不是某一个字面形状；被测行为的覆盖不得因隔离修复而减少
invoke `node --no-warnings --experimental-strip-types plugin/scripts/test-isolation-check.ts --root . --json`
control 人造一个写 tasks/ 固定名的测试文件 ⇒ 必须报出；改成每运行唯一的工作区 ⇒ 必须不报
resume 先扩探测器并让它在现状下报出那一个真实例，再修那个测试；两步各自可验证
```

## Chosen mechanism

**先让探测器能看见，再修实例**——顺序不能反：先修实例的话，探测器仍然是瞎的，而且再也没有活标本可验证。

1. **扩 R1（或并列加一条规则，择一并写明理由）**：把判据从「`__dirname` + `.tmp` 字面」
   扩到「写操作的目标路径根不是每运行唯一（`mkdtemp`/`os.tmpdir()`/测试自建的临时 root 变量）」，
   **并对仓库的真实数据目录**（`tasks/`、`.quay/`、`.workflow-events/`、`adr/`）**单列一类**——
   写进这些目录比写进一个共享临时路径严重，因为它污染的是产品数据而不只是测试环境。
2. **让它在现状下报出那一个真实例**（活标本验证——探测器上线时必须至少报出它，否则无从判断它是否真的在看）。
3. **修 `it0-dod-check.test.mjs`**，保持它仍然走真实 frontmatter 代码路径（见上面的陷阱）。
4. **棘轮基线相应更新**，并记录基线为什么从 N 变成 N+1 再变回 N。

**不做**：不批量重写其它测试（只有一个真实例，见实测三）；不把 `process.cwd()` 一律判为违规
（`originalCwd = process.cwd()` 这种保存/恢复的用法有 14 处，全部无害，误报会直接把这条规则训练成噪声）；
不改 `git add -A` 的用法——**根因是测试写了不该写的地方，不是 git 扫得太宽**。

## Acceptance Criteria

- [x] AC1: 探测器扩到「非每运行唯一的写入根」，真实数据目录单列一类，理由写进文件头
- [x] AC2: **活标本验证**——扩完之后、修测试之前，跑一次必须报出
      `experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` 那一条（实跑输出贴任务体）
- [x] AC3: **负控制（正向）**——人造一个写 `tasks/` 固定名的测试文件 ⇒ 报出并指名文件与行号
- [x] AC4: **负控制（反向）**——把它改成每运行唯一的工作区 ⇒ 不报；
      且 `originalCwd = process.cwd()` 这类保存/恢复用法**不得**被报（现有 14 处，逐个确认零误报）
- [x] AC5: `it0-dod-check.test.mjs` 修完后**仍然覆盖真实 frontmatter 代码路径**——
      说明它现在怎么造那个工作区，并给出该用例仍然为真的证据（把断言跑绿的输出贴出来）
- [x] AC6: 棘轮基线更新，变化过程（N → N+1 → N）在提交里写明
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC2 的活标本输出与 AC4 的零误报清单都贴进任务体——
      **一个探测器如果从没在真实仓库里报出过任何东西，它与「永远返回空集」不可区分**
- [~] 完整套件连跑 2 次全绿——**如实标注：仅 1 次全量绿**（协调方 batch4，2094 tests / 2074 pass /
      0 fail / 0 cancelled，`/tmp/batch4-fanin-fullsuite.log`，2026-08-03 14:11Z，已含本任务合并代码）。
      非连跑 2 次；scoped 三文件 106 用例全绿。第二次全量未补跑（与上批 tph/monitor 同口径）
- [x] 任务体记录：这次是 `git add -A` 偶然把它扫进提交才被发现的，
      **不是任何检查报出来的**——这句话是 AC1 的理由本身

## 执行记录（2026-08-03，gap-r1 内层实现）

### AC1 — 探测器扩展：R7 live-data-dir-write（并列新规则，非扩 R1 谓词）

`plugin/scripts/test-isolation-check.ts` 新增第 7 条规则 **`live-data-dir-write`**（`RULE_KEYS` 加入
`"live-data-dir-write"`，`detectLiveDataDirWrites` 并入 `detectAll`，JSON 输出新增 `liveDataDirWrites`
计数字段）。**选「并列加一条规则」而非改 R1 谓词的理由**：
1. 契约 measure 把 `live_dir_writes` 作为独立 band（必须 = 0），独立 rule key 才有独立棘轮核算；
2. 写进 LIVE 产品数据目录（`tasks/`/`.quay/`/`.workflow-events/`/`adr/`）污染的是产品数据而非测试环境，
   比 R1 的共享 `.tmp` 路径严重——任务体「写进这些目录比写进一个共享临时路径严重」；
3. R1 的 12 条既有 `fixed-path-write` 全是 `__dirname/.tmp` dot-tmp 形态，并进一个新类要重审 12 条并混淆两种严重度。

判据：写操作（`writeFileSync`/`mkdirSync`/`appendFileSync`/`rmSync`/`unlinkSync`/`cpSync`/`createWriteStream`…）
目标路径解析进 LIVE 目录，且根是**非每运行唯一**（`process.cwd()`/`__dirname`/`import.meta` 或引用它们的
变量）。**每运行唯一根（`os.tmpdir()`/`mkdtemp`/`makeTmpDir` 派生的变量）永远不报**。`originalCwd =
process.cwd()` 保存/恢复不触发（无 LIVE 段）。理由写进了 `test-isolation-check.ts` 文件头、`test-isolation-
violations.txt` 头部、`docs/analysis/test-isolation-contract.md` R7 节。

### AC2 — 活标本验证（扩完之后、修测试之前的实跑输出）

```
$ node plugin/scripts/test-isolation-check.ts --root . --json
{
  "ok": false,
  "files": 166,
  "violations": [
    ...
    { "rel": "experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs",
      "rule": "live-data-dir-write", "line": 391,
      "snippet": "const taskPath = path.join(process.cwd(), \"tasks\", `${taskId}.md`);" },
    { "rel": "plugin/test/workflow-event-schema.test.mjs",
      "rule": "live-data-dir-write", "line": 445,
      "snippet": "const logPath = path.join(REPO_ROOT, \".workflow-events\", `${event.runId}.jsonl`);" }
  ],
  "liveDataDirWrites": 2
}
```

**探测器上线后报出 2 条，不是 1 条**：外层「实测三」的 size-1 扫描以创建类写操作为主，漏掉了
`workflow-event-schema.test.mjs:445` 的 `unlinkSync`（删除类写操作）——`path.join(REPO_ROOT,
".workflow-events", "M248.jsonl")` + `unlinkSync`，固定名 `M248` 的写+删，CLI `--emit-event` 默认写 LIVE
`.workflow-events/`，并发下互相踩。探测器是 unlink/rm 感知的，故发现它。两个实例都按同类修复（见下）。

### AC3 — 负控制（正向）：人造写 tasks/ 固定名的测试文件 ⇒ 报出并指名文件与行号

```
$ node plugin/scripts/test-isolation-check.ts <scratch> --json
liveDataDirWrites: 1
REPORTED: packages/quay/test/deliberately-live-write.test.mjs line 5 |
  const taskPath = path.join(process.cwd(), "tasks", "M-FAKE-FIXED.md");
```

### AC4 — 负控制（反向）：每运行唯一工作区 ⇒ 不报；originalCwd 零误报

同一个 `deliberately-live-write.test.mjs` 改成 mkdtemp 工作区后：

```
liveDataDirWrites: 0
R7 reports: 0
```

**零误报清单**：`live-data-dir-write` 在真实仓库最终为 **0**。逐个确认无 R7 误报：
- `originalCwd = process.cwd()` 保存/恢复用法（serve.test.mjs、serve-adr.test.mjs、
  serve-github.test.mjs、web-ui-browser.test.mjs、serve-browser-render.test.mjs、provider-env-symmetry
  .test.mjs、core-three-way-symmetry.test.mjs、serve-adversarial-eval.test.mjs ×3 等，跨 12 处直接赋值 /
  9 文件）——**零误报**（R7 只报「写 + LIVE 段 + 共享根」，保存/恢复无写）。
- `fs.mkdirSync(path.join(workspaceRoot, ".quay"))` / `path.join(*WorkspaceRoot, ".quay", "config.yml")`
  这类 **mkdtemp/makeTmpDir 根**（serve.test.mjs、mcp-server.test.mjs、mcp-adr.test.mjs、it0-gates.test.mjs、
  gate-ergonomics.test.mjs、serve-adr.test.mjs、serve-github.test.mjs、web-ui-browser.test.mjs 等约 30 处）——
  **零误报**（`tmpRootVars` 识别 const 与裸赋值两种 mkdtemp/makeTmp 根）。
- `path.join(REPO_ROOT, "tasks"/"adr"/".quay")` **只读**（mechanism-count、adr-gate、document-gate-fixture、
  ts-typecheck-gate 等）——**零误报**（R7 只看写操作）。

### AC5 — it0-dod-check.test.mjs 修后仍走真实 frontmatter 代码路径

`runDodCheck` 新增可选 `tasksDir` 参数（纯函数 API；CLI 不传则两个默认根 `process.cwd()/tasks` 与
`__dirname` 遍历不变）。测试现在**用 mkdtemp 工作区 + `tasks/` 子目录 + `tasksDir` 传入**：真实的
`---` frontmatter 文件仍写在磁盘上、经同一 `fs.readFileSync` + frontmatter 扫描路径解析，只是不再落进
LIVE `tasks/`。**真实路径为真的证据**：新增断言 pass 消息包含 `milestone:M5`——只有读到了真实文件的
frontmatter label 才会出现；fixture 回退文本没有 `milestone:M<N>` label，会报「no milestone label found」，
两者可区分。断言跑绿：

```
$ node --test --test-name-pattern="frontmatter" experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
✔ clause8: a real frontmatter label below cutover is NOT polluted by a higher milestone-shaped string
  in the task's own body prose (763.48ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

（同一测试文件 45 用例全绿；`finally { fs.rmSync(workspaceRoot, {recursive:true, force:true}) }` 保证 R6
不泄漏。）

**第二个实例 workflow-event-schema.test.mjs 的修法（同类）**：CLI `--emit-event` 增加 `WORKFLOW_EVENTS_DIR`
环境变量覆盖（默认仍是 `repoRoot/.workflow-events`）；测试把输出重定向到 `mkdtemp` 目录并 `finally`
删除——CLI 创建→读→校验的端到端覆盖保留。两个 script 镜像（plugin/ 与 experiments/）都改了。

### AC6 — 棘轮基线：N → N+1 → N（44 → 45 → 44）

- **44 → 45**：AC2 活标本验证期间为 `it0-dod-check.test.mjs:live-data-dir-write` 基线化一条，使探测器
  上线、测试未修时的检查仍绿（AC2「扩完之后、修测试之前」状态）。
- **45 → 44**：两个 R7 实例都修完后，两条都删——名单回到 44。`# baseline-count` 封顶永久不变（51）。
- 数据文件头部（`plugin/test-isolation-violations.txt`）记录了这个过程与 R7 规则说明。

### AC7 — node:test + @test-group

R7 的 RED/GREEN 测试加在既有 `plugin/test/test-isolation-check.test.mjs`（`// @test-group engine`，
`import { test } from "node:test"`）内；未新建测试文件（新文件的 governance tag 要求不适用）。

## 交叉标注（2026-08-07，B 类任务 disable 裁定）

- → **gap-assert-clean-tree-premise-void-under-concurrent-writers（B）——本任务是 R7 规则的来源，
  B（suite-after clean-tree 断言）是这条 R7 静态规则的「不认拼法只认结果」形态。** 2026-08-07 人
  17:1x 裁定 B 的前提（协调者在干净树上跑）已作废（三层并发写入造成 r4/r5/r6 三次假红），外层裁定
  **disable（非 delete）**：B 的调用已从全量套件路径摘掉，代码保留。
  **AC4 已知让渡（直接影响本任务抓的类）**：B 是唯一能抓「测试真写进验证树」的网（不认拼法只认结果，
  当年 R1/R7 都漏掉 `.quay-tmp-test-` 靠它抓到）。disable 期间，**靠 B 抓泄漏的能力暂缺**——即本任务
  R7 那类「一个测试把 M-FAKE-*.md 写进真实 tasks/」不再由 suite-after 断言兜底。**复原路径**：
  验证 worktree 运行期单写入者达成（`git worktree lock`）时重新接回；复原时 B 的差量版（--snapshot/
  --check，integration 174badc0）为正确形态。tmux-leak-scan 仍抓 tmux 类。R7 静态探测器本身
  （test-isolation-check）不受影响，仍在线。

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
- docs/analysis/test-isolation-contract.md
- plugin/test-isolation-violations.txt（R7 头部说明 + N→N+1→N 记录）
- experiments/quay-perpetual-stream/scripts/it0-dod-check.ts（`runDodCheck` 新增可选 `tasksDir`）
- plugin/scripts/workflow-event-schema.mjs + experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs
  （`--emit-event` 新增 `WORKFLOW_EVENTS_DIR` 覆盖——R7 第二个实例的同类修复）
- plugin/test/workflow-event-schema.test.mjs（symlink 指向它；重定向到 mkdtemp 目录）
- tasks/gap-r1-cannot-see-tests-writing-into-the-live-task-store.md（本任务体，AC 证据）

## Dispatch review

reviewer: outer
at: 2026-08-03T10:50:00Z
changed: 内层已独立发现同一件事并写进队列文件（处置留作「建任务或修，待办」），外层复核后建任务承载它，
不重复发现。**外层加了三样内层没写的**：(a) 未被捕获的**具体谓词**（`detectFixedPathWrites` 要求
`__dirname|import.meta|fileURLToPath` 与 `.tmp` 字面同时成立，而这次是 `process.cwd()` + `tasks/`，两条都不沾）；
(b) **类的规模实测为 1**，并把扫描命令写进任务体——**明确写下「不要按批量修 N 个来估工作量」**，
因为价值在探测器覆盖类而非标本；(c) **修复陷阱**：那个测试是**故意**写真实 `tasks/` 的（需要真实 frontmatter
代码路径，注释里写了），无脑换 mkdtemp 会把覆盖删掉，故 AC5 单列。
**顺序被写进机制第 1/2 条**：先扩探测器并用活标本验证，再修实例——反过来做就没有标本可验证探测器是否真在看。
**不派发**：在飞已 2（产品化 + contract-ratchet），两者的 DoD 都要求全量连跑 2 次；4 核上再加一个
会把三个任务的套件推进资源闸队列。排在它们之后，与 `gap-tasksperhour-counts-halted-time-as-slow-work` 同批候选。
