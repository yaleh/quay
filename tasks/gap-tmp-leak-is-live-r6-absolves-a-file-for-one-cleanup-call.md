---
id: gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call
title: /tmp still leaks ~1800 dirs/hour into RAM — R6 clears a file for having one
  cleanup call, and its 28 baselined leakers are frozen by design
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 2026-08-03 报告 `/tmp` 泄漏仍是活的并给出计数。**外层独立复测确认，并把根因定位到两条机制上**——
两条都不是「某几个测试忘了删」，所以**再修一遍 top-5 前缀不会让它停下**（上一轮正是那样修的）。

### 实测一：是流量不是存量（外层独立复测，与管理者的数字一致）

| 量 | 管理者 | 外层复测 |
|---|---|---|
| 最近 1 小时新增 | 1,874 | **1,782** |
| 24 小时以上的存量 | 2,179 | **2,180** |
| `/tmp` 总条目 | — | **20,104** |
| tmpfs | 3.9G / 7.9G (50%) | **3.9G / 7.9G (50%)** |

**存量只有 2,180 ⇒ 其余约 18,000 是最近 24 小时产生且至今没被删。**
`/tmp` 是 tmpfs（RAM 支撑），所以这直接吃内存——今晚 swap 从 0 涨到 1.78 GB 的主因就是它
（`orchestration/tick-log.md` 06:22Z）。

最近 1 小时的前 5 名（外层复测）：`quay-qeng*` **544**、`quay-diagc*` **136**、
`quay-m29-i*` 96、`quay-gate-` 84、`quay-init-` 68。

### 实测二：R6 是**文件级存在性**判定——一处清理就赦免整个文件

`plugin/scripts/test-isolation-check.ts:344-381`，代码注释自己写明了这个设计
（"Per-file granularity … the sharpest low-false-positive static signal"）：
文件里只要有**任何一处** `rmSync|rm(|t.after|after|finally`，`detectMkdtempNoCleanup` 立即 `return []`。

```
packages/quay/test/gate-diagnostics.test.mjs   mkdtempSync ×7   清理构造 ×2
  → R6 判为干净 ⇒ 不在违规名单上 ⇒ 每小时漏 136 个（quay-diagc*）
```

**⇒ 一个建 7 个目录、只清 2 个的文件，在这条规则下与一个全清的文件不可区分。**
这与刚记录的 R1 是同一族（[[gap-r1-cannot-see-tests-writing-into-the-live-task-store]]）：
**规则名说的是一个类，实现测的是一个更窄的形状**；区别是 R1 看不见，R6 是看见了但只数存在性。

### 实测三：最大的两个产出者在名单上，而名单被设计成不会自己缩

`plugin/test-isolation-violations.txt` 共 50 条，其中 **28 条是 `mkdtemp-no-cleanup`**，
包括本小时的冠亚军：

```
packages/quay/test/driver.test.mjs:mkdtemp-no-cleanup   （quay-qeng4，mkdtempSync ×4）
packages/quay/test/gate.test.mjs:mkdtemp-no-cleanup     （quay-qeng1）
```

`bash plugin/scripts/test-isolation-check.sh .` 此刻**PASS**：
「all 50 violation(s) are baselined … the list can only get SHORTER」。

**机制在按设计工作，而设计本身就是问题**：棘轮阻止新增，**没有任何东西迫使它变短**。
上一轮任务（`gap-tests-never-clean-up-their-tmpdirs`）修掉当时的 top-5、把尾巴基线化，
tick-log 08:48Z 当时就写下了这一句——**「不会再涨，但也不会自己缩（设计如此）」**。
现在那条尾巴每小时 1,782 个。**这与今天 `## Contract` 棘轮 1→5「按裁定变长」是同一个教训的两面：
一个只能变短的名单，如果没有强制函数，就只是把债务记了下来。**

### 一个必须说清的测量限度

外层这次的每小时计数**是在一次全量套件运行期间取的**，其中可能包含尚会被清理的目录。
**不可动摇的那一半是存量对比**：24 小时内产生的约 18,000 个**此刻仍在盘上**，即它们没有被清理。
定范围时以「跑完一次套件后仍存在的数量」为准，不要用墙钟速率——
上一轮 AC3 用的就是 `leaked_after_suite`（围绕单次套件测量、自带活动量归一），
外层 08:44Z 差点用墙钟速率替代它并记下了为什么不行。**复用那个测法，不要另发明一个。**

## Contract

```
measure leaked_after_suite = `bash scripts/test.sh` 前后各跑一次 `ls -1 /tmp | wc -l` 的差值字段
measure r6_hits = `bash plugin/scripts/test-isolation-check.sh .` 输出中 rule=mkdtemp-no-cleanup 的条目数字段
measure baseline_len = `grep -c mkdtemp-no-cleanup plugin/test-isolation-violations.txt` 输出的计数字段
band baseline_len = <28  # 每修好一个文件就少一行；28 是本任务开工时的实测值
invariant 判据必须能区分「7 个建、2 个清」与「7 个建、7 个清」；已经干净的文件不得新增误报
invoke `bash plugin/scripts/test-isolation-check.sh .`
control 造一个 mkdtemp ×3 只清 ×1 的测试文件 ⇒ 必须报出；把三处都清干净 ⇒ 必须不报
resume 按实测泄漏量从大到小逐个文件修，每修完一个从基线名单删一行并重测
```

## Chosen mechanism

**先归因再修，按实测泄漏量排序——不要再按前缀名单修一轮。**

1. **按文件归因**：跑一次套件，统计每个前缀在套件前后的净增，映射回创建它的测试文件
   （前缀→文件的映射已可 grep，见实测二/三）。**产出一张「文件 → 每套件净增目录数」的表**，
   这是排序依据，也是修完之后证明有效的对照。
2. **按表从大到小修**，用**一个共享助手**（`makeTmpWorkspace(t)` 之类，在 `t.after` 里删）
   而不是 N 处各写各的 `finally`——上一轮就是各写各的，所以只覆盖了当时改到的那几个点。
3. **每修完一个文件，从 `plugin/test-isolation-violations.txt` 删掉那一行**。
   棘轮只有被人拿掉一行才会变短——这是本任务与上一轮的实质差别。
4. **收紧 R6**：从「文件里存在任一清理构造」改为能识别**部分清理**的判据。
   **必须带误报闸**：当前判为干净的文件里，不得出现新的报告，除非它确实是部分清理
   （逐个人工确认并在任务体列出）。**保住原设计的低误报意图，不是推翻它。**

**不做**：不加 `/tmp` 定时清理器（那是把泄漏藏起来，外层今晚已经手工清过一次 158,757 条，
清完 20 分钟就回填了 1,606 个）；不改 `claude-*` / `quay-wt-*` 的豁免（会删掉在用的会话数据与 worktree）；
**不按前缀清单修一轮**——本任务存在的理由就是那样修不住。

## Acceptance Criteria

- [x] AC1: 产出「文件 → 每套件净增目录数」的归因表（实跑输出贴任务体），覆盖本小时前 5 名前缀
- [x] AC2: 按该表修掉净增量最大的若干文件，**用共享助手**，并说明为什么选这个切点
- [x] AC3: **主判据**——修复前后各跑一次完整套件，`leaked_after_suite` 下降幅度贴出来；
      **用套件前后差值，不用墙钟速率**（理由见 Proposal 的测量限度一节）
- [x] AC4: `plugin/test-isolation-violations.txt` 的 `mkdtemp-no-cleanup` 条目数（即 `baseline_len`）**低于开工值 28**，
      删掉的每一行对应一个已修文件，逐条列出
- [x] AC5: R6 能区分部分清理——**正向负控制**：造一个 mkdtemp ×3 只清 ×1 的文件 ⇒ 报出
- [x] AC6: **反向负控制（防误报）**——当前 R6 判为干净的文件全量重跑，
      列出所有新增报告并逐个确认它们确实是部分清理；**误报数必须为 0**
- [x] AC7: `gate-diagnostics.test.mjs`（7 建 2 清，本小时 136 个）在收紧后**被报出**——
      它是这条判据的活标本
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC3 的套件前后对照与 AC6 的零误报清单都贴进任务体——
      **一个收紧了判据却没有误报清单的改动，与「把噪声调大」不可区分**
- [x] 完整套件连跑 2 次全绿
- [x] 任务体记录一句：上一轮修的是当时的 top-5 并把尾巴基线化，
      **本轮的判据是名单变短与 `leaked_after_suite` 下降，不是「又修了 5 个前缀」**

## 执行记录（2026-08-03）

### AC1 — 归因表：文件 → 每套件净增目录数

围绕一次完整套件（`bash scripts/test.sh`）测 `/tmp` 前缀差值（`ls -1 /tmp` 前后各一次，套件前后差值，
不用墙钟速率；基线套件另有 6 个与本次无关的并发 flaky 失败——test-framework-policy 3 个、隔离检查 3 个，
隔离运行均绿）：

```
总 delta = 418（quay-* 前缀）；完整套件 leaked_after_suite = 464（21045 → 21509）
前缀           每套件净增   创建文件                          处置
quay-qeng3       48        packages/quay/test/lifecycle.test.mjs              ✓ 修（基线化）
quay-qeng2       44        packages/quay/test/acceptance.test.mjs             ✓ 修（新报出）
quay-diagc       34        packages/quay/test/gate-diagnostics.test.mjs       ✓ 修（新报出）
quay-qeng4       29        packages/quay/test/driver.test.mjs                 ✓ 修（基线化）
quay-qeng1       29        packages/quay/test/gate.test.mjs                   ✓ 修（基线化）
quay-m29         24        packages/quay/test/gap002-create-ergonomics.test.mjs ✓ 修（基线化）
quay-gate        21        packages/quay/test/gate-config-loader.test.mjs     ✓ 修（基线化）
quay-dodgateset  20        packages/quay/test/dod-gate-set.test.mjs           基线化（未修）
quay-init        17        packages/quay/test/init.test.mjs                   ✓ 修（基线化）
quay-doc         14        packages/quay/test/document-gate.test.mjs          基线化（未修）
quay-dir046      14        packages/quay/test/gate-ergonomics.test.mjs        ✓ 修（新报出）
quay-m39         13        packages/quay/test/it0-gates.test.mjs              基线化（未修）
quay-m43         12        packages/quay/test/dir022-remaining-gates.test.mjs 基线化（未修）
quay-glv         10        packages/quay/test/gate-list-verbose.test.mjs      基线化（未修）
quay-e3          10        packages/quay/test/adr-gate.test.mjs               ✓ 修（新报出）
quay-backlog     10        packages/quay-backlog/test/backlog-client.test.mjs 基线化（未修）
quay-migrate      9        packages/quay/test/cli-migrate.test.mjs            基线化（未修）
quay-dir099c      9        packages/quay/test/dir032-audit-independence.test.mjs 基线化（未修）
```

本小时前 5 名前缀全部覆盖：`quay-qeng*`（qeng1/2/3/4 → gate/acceptance/lifecycle/driver）、
`quay-diagc*`（gate-diagnostics）、`quay-m29-i*`（gap002-create-ergonomics）、`quay-gate-`（gate-config-loader）、
`quay-init-`（init）——**全部已修**。非 `quay-*` 前缀的泄漏者（`adr-mcp-*`/`adr-serve-*`/
`quay-backlog-mcp-fixture`/`dir126c-fixtures` 等）由收紧后的 R6 扫描逐一报出（见 AC6 清单），
同样已修。

### AC2 — 修哪些文件、为什么这个切点

切点 = **收紧判据后新报出的 12 个部分清理泄漏者（棘轮 C1 强制）** + **每套件净增 ≥ 17 的基线化
no-cleanup 生产者**（driver/gate/lifecycle/gap002-create-ergonomics/gate-config-loader/init，
即 qeng1-4、m29、gate、init 前缀；这些是每小时 1,782 个新目录的主力）。全部用**共享助手**
`plugin/test/helpers/tmp-workspace.mjs` 的 `makeTmpDir(tag)` / `makeTmpWorkspace(tag, {nativeBin,
nativeProviderDir})` 修——助手把 `mkdtemp` 与删除注册成一对（文件级 `after()` 钩子），替换掉各处
手写 `finally { rmSync }`（上一轮正是各写各的、只覆盖到当时改的点的教训）。每个已修文件原有的
`fs.mkdtempSync(...)` 全部归零。未修的是每套件净增 ≤ 14 且仍留在名单上的（dod-gate-set、document-gate、
it0-gates、dir022、gate-list-verbose、backlog-client、cli-migrate、dir032 等 21 条基线化条目）。

### AC3 — leaked_after_suite（套件前后差值，非墙钟速率）

| | 完整套件前 `ls -1 /tmp` | 完整套件后 `ls -1 /tmp` | leaked_after_suite |
|---|---|---|---|
| 修复前（基线） | 21,045 | 21,509 | **464** |
| 修复后 run 1 | 21,530 | 21,689 | **159** |
| 修复后 run 2 | 21,689 | 21,849 | **160** |

下降幅度：**464 → 159/160，约 −65.7%**。两次修复后套件均全绿（rc=0，2,057 tests / 2,038 pass / 0 fail /
19 skipped）。基线 run 有 6 个与本次无关的并发 flaky 失败（test-framework-policy 3 个、隔离检查 3 个，
隔离运行均绿），泄漏量仍以套件前后 `/tmp` 差值计量，不掺墙钟速率。

### AC4 — `baseline_len`（`grep -c mkdtemp-no-cleanup`）低于开工值 28

开工值 **28**（含 1 行注释）→ 完成值 **22**。删掉的每一行对应一个已修文件：

| 删除的名单条目 | 对应已修文件 | 修掉的每套件净增 |
|---|---|---|
| `packages/quay/test/driver.test.mjs:mkdtemp-no-cleanup` | driver.test.mjs | quay-qeng4 +29 |
| `packages/quay/test/gate.test.mjs:mkdtemp-no-cleanup` | gate.test.mjs | quay-qeng1 +29 |
| `packages/quay/test/lifecycle.test.mjs:mkdtemp-no-cleanup` | lifecycle.test.mjs | quay-qeng3 +48 |
| `packages/quay/test/gap002-create-ergonomics.test.mjs:mkdtemp-no-cleanup` | gap002-create-ergonomics.test.mjs | quay-m29 +24 |
| `packages/quay/test/gate-config-loader.test.mjs:mkdtemp-no-cleanup` | gate-config-loader.test.mjs | quay-gate +21 |
| `packages/quay/test/init.test.mjs:mkdtemp-no-cleanup` | init.test.mjs | quay-init +17 |

12 个新报出泄漏者**从未上过名单**（它们被旧 R6 放行），修掉后不涉及删行；名单因此从 50 条缩到 44 条。

### AC5 — 正向负控制（R6 能区分部分清理）

`plugin/test/test-isolation-r6-partial-cleanup.test.mjs`（`// @test-group governance`）：
`const a/b/c = mkdtemp(...)` ×3、只 `t.after(() => rmSync(a))` ×1 ⇒ **报出**；三个都 `rmSync` ⇒ **不报**。
`plugin/scripts/test-isolation-check.ts` 的 `--selftest` 亦含同样控制（3 建 1 清报、3 建 3 清不报、
空 `finally` 报、`finally` 内 `rmSync` 不报），42/42 通过。

### AC6 — 反向负控制（零误报清单）

收紧后对全量 `scripts/test.sh` glob 重跑，**新增报告 12 个，全部逐个人工确认为真实部分清理**（误报 0）：

| 新增报告（收紧后报出、旧 R6 放行） | 部分清理形态 |
|---|---|
| gate-diagnostics.test.mjs | 7 建 2 清：两个 finally 只恢复 process.stderr.write，unlinkSync 只删日志文件，不碰 fixture 目录 |
| acceptance.test.mjs | tmpCwd/makeWorkspace 返回目录，无调用点清理（quay-qeng2） |
| acceptance-env.test.mjs | 同上（quay-acceptance-env） |
| adr-gate.test.mjs | makeWorkspace 返回 tasksDir/workspaceRoot，finally 只删 fixturePath |
| build-dist.test.mjs | tempTree 返回 root，调用点只取 out、从不删 root |
| build-dist-smoke.test.mjs | 模块级 bundleRoot 从不删 |
| document-gate-fixture.test.mjs | loadFixtureIntoTmpDocsDir 返回 dir，从不删 |
| gate-ergonomics.test.mjs | makeWorkspace + 多个 worktree/workspaceRoot 从不删 |
| mcp-adr.test.mjs | before() 建 3 目录，after() 只 close 客户端 |
| serve-adr.test.mjs | 同上 |
| backlog/mcp-server.test.mjs | makeFixtureBoard 返回 dir，finally 只 close 客户端 |
| proposal-convergence.test.mjs | 模块级 FIXTURES_DIR（dir126c/dir126d/m207/checkpoint/epoch）从不删 |

**误报候选被排除（不报）**——`makeFakeGhBin`/`makeFakeGhPathDir` 返回目录、调用点捕获进
`fakeBinDir`/`fakeGhDir` 且清理（github 六文件）、`makeTempPackageCopy`→`tempPkg` 清理（npm-pack-e2e）、
`tmpPluginRoot`→`pluginRoot` 清理（read-probe-spec）、`makeGitWorkspace`→`ws` 清理（task-status-drift）：
这些是「helper 返回被调用者清理」，不是泄漏，收紧判据刻意不报（selftest 有对照用例）。

### AC7 — gate-diagnostics（7 建 2 清，本小时 136 个）被报出

收紧后扫描确认 `packages/quay/test/gate-diagnostics.test.mjs:mkdtemp-no-cleanup` 被报出
（旧 R6 因两个 finally 放行）。`plugin/test/test-isolation-r6-partial-cleanup.test.mjs` 的 AC7 用例
复现其形态（helper 返回目录、无调用点清理 ⇒ 报出）。

### AC8 — 测试用 node:test 且带 `// @test-group governance`

新增测试文件 `plugin/test/test-isolation-r6-partial-cleanup.test.mjs`：`node:test` + `// @test-group
governance`。`plugin/test/test-isolation-check.test.mjs` 内的 R6 断言更新亦为 `node:test`（该文件
原本就是 `engine` 组；新用例放在新 governance 文件）。

### 判据记录（DoD 第三句）

上一轮（`gap-tests-never-clean-up-their-tmpdirs`）修的是当时的 top-5 并把尾巴基线化，**本轮判据是
名单变短（28 → 22）与 `leaked_after_suite` 下降（464 → 159/160，约 −65.7%），不是「又修了 5 个前缀」**——因为本小时
冠亚军已在名单上被基线化、第三名根本没上名单，再按前缀修一轮修不住；本轮修的是让 R6 看见部分清理，
从而把「看不见的泄漏」逼出来并逐一修掉。

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- plugin/test-isolation-violations.txt
- packages/quay/test/driver.test.mjs
- packages/quay/test/gate.test.mjs
- packages/quay/test/gate-diagnostics.test.mjs
- docs/analysis/test-isolation-contract.md

## Dispatch review

reviewer: outer
at: 2026-08-03T11:20:00Z
changed: 管理者只给了计数并明确把「是否成任务、怎么定范围」交给外层。外层独立复测确认了数字
（存量 2,180 与管理者的 2,179 逐位一致，1 小时新增 1,782 vs 1,874，同量级），
**并把范围从「再修一遍 top-5 前缀」改掉**——因为实测表明本小时的冠亚军
（`driver.test.mjs`/`gate.test.mjs`）**已经在违规名单上被基线化**，第三名
（`gate-diagnostics.test.mjs`，7 建 2 清）则因 R6 的文件级存在性判定而**根本没上名单**。
⇒ 再按前缀修一轮，修完的下一小时就是下一批前缀。**判据因此定为两条可核对的量**：
名单里 `mkdtemp-no-cleanup` 条目数变少、`leaked_after_suite` 下降。
**并预先堵一个口子**：收紧 R6 会有误报风险，而它原本的文件级设计是**刻意的低误报选择**，
所以 AC6 要求零误报清单——否则这个修改与「把噪声调大」不可区分。
**测量方法沿用上一轮的 `leaked_after_suite`**，不用墙钟速率（外层 08:44Z 记过为什么）。
**优先级建议**：在产品化之后、`gap-tasksperhour-*` 与 `gap-r1-*` 之前——
它是这三个里唯一在**消耗循环自身赖以运行的机器**的（tmpfs 吃 RAM → swap → 今晚反复咬人的 CPU 饥饿）。
最终排序由管理者定。

reviewer: inner
at: 2026-08-03T12:00:00Z
changed: 闸口结果——task-contract-check **0 新增**（violations 5 / ceiling 5 / new since baseline 0）；
checkTouchesPair（规范化 expand）与 gap-tasksperhour-*、gap-nothing-checks-monitor **两两 DISJOINT**，
可同批派发。判定两条可核对量：mkdtemp-no-cleanup 名单条目数变少（开工值 28）+ leaked_after_suite
下降（套件前后差值，非墙钟速率）。
