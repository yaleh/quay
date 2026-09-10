---
id: gap-goal-record-completeness-undefined
title: goal 记录「什么算写完整」从未被定义：goal_write 把出处 origin 设为必填、内容 body 设为可选，激励反向 ⇒ 8 个
  goal 里 5 个（62%）正文为空、论述全塞进 origin（GOAL-008 达 1130 字符）；task 侧有 shape-aware
  四件套闸，goal 侧零等价物、也无立条 skill
status: done
needs_human_cause: human-adjudication
labels:
  - gap
  - goal-store
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 对比 `/goal/GOAL-008` 与 `/goal/GOAL-001` `/goal/GOAL-003` 后追问
「GOAL-008 为什么和另外两个显著不同？是创建 goal 的方式有差异？这一创建 goal 的方式是否需要改进？」
查下来差异确实来自创建路径，但**根因不是"谁写的"，是写入契约把激励搞反了**。

**现象（YAML 解析读数，非目测）**：

| | frontmatter 行 | body 行 | origin 长度 | 有 labels |
|---|---|---|---|---|
| GOAL-001 | 15 | **59** | 323 | ✓（另有 `activatedAt`） |
| GOAL-003 | 14 | **42** | 295 | ✓ |
| **GOAL-008** | **34** | **0** | **1130** | ✗ |

**创建路径确实不同**（git 首次提交）：`GOAL-001` ← `e74e59f19`「SPEC-goal-mechanism-2026-09-06 + GOAL-001
自举立条」；`GOAL-003` ← `361d27e49`「migrate AC143-169 into goals/」；两者都是**人/迁移脚本直接写 markdown**。
`GOAL-008` ← `e6866ff50`「GOAL-008 **写盘即提交（goal-store）**」，经 `goal_write` 写入。

**⚠️ 但 GOAL-008 不是异类，是多数（这条比对比本身更重要）**：枚举 `goals/` 全部记录——

- `kind: goal`：**8 条，body 为空 5 条（62%）** —— GOAL-004 / 005 / 006 / 007 / 008 全空；
  有正文的恰好只有手写时代的 GOAL-001 / 002 / 003
- `kind: criterion`：57 条，body 为空 19 条（33%），但 `criterion` 字段非空 **57/57**

⇒ **凡是走 `goal_write` 创建的 goal，正文一律为空**（5/5）。这不是个别写入方偷懒，是路径的稳定产物。

**根因（读动词契约，逐字）**：`packages/quay-native/src/mcp-server.ts:365` 的 `goal_write` 描述写着

> "`origin` **is required** (empty origin writes nothing)"

而同处 inputSchema 里 **`body: z.string().optional()`**。

⇒ **出处（origin）必填、内容（body）可选**。一个要记录一段论述的写入方，路径最短的做法就是全塞进 `origin`
——GOAL-008 的 1130 字 origin + 0 字 body 正是这个契约的自然产物。
`origin` 的语义本是「这条 goal 从哪来的（人的裁定 / SPEC 引用）」，现在被当成正文用。

**第二个面：goal 侧没有任何完整性闸。**
task 侧有 shape-aware 四件套（`plugin/scripts/ready-pool-check.ts` 的 `SHAPE_REGISTRY` +
`MIN_SECTION_CHARS = 40` + `artifactsComplete()`），且有 `plugin/skills/quay-file-task` 立条 skill；
**goal 侧 grep 同类判据 = 0 命中，`plugin/skills/` 下也没有 goal 版立条 skill**（枚举 13 个 skill，无一个含 goal）。
没有任何机制会说「这个 goal 没有正文」。

**下游可见后果（人正是从这里发现的）**：详情页把 origin 整块塞进单个 `<p class="meta">`，
实测 `/goal/GOAL-008` 最长 `p.meta` **1138 字符**、`<article>` 文本长度 **0** ⇒ 页面目视就是一坨说明文字。
（呈现侧另由 `gap-webui-goal-list-sort-and-column-set` AC8 收拾；本任务修的是**产生侧**。）

**规则必须按 kind 分开定（不能一刀切，否则会误伤 57 条 criterion）**：

- `kind: goal` —— 正文（背景 / 范围与非目标 / 退出条件）是它的本体，**body 应为必填**；
  `origin` 回归「出处引用」，可给长度上限或至少不再充当正文。
- `kind: criterion` —— 内容天然在 `criterion` + `expect` 字段里（实测 57/57 都有 `criterion`），
  **body 保持可选**；该 kind 的必填项应是 `criterion` + `expect` + `goal`。

**修法方向**：

1. `goal_write` 的必填项按 kind 分流：`goal` ⇒ `body` 必填且 ≥N 非空白字符；
   `criterion` ⇒ `criterion`/`expect`/`goal` 必填，body 可选。拒绝时给出**可区分的原因**（哪个 kind、缺哪个字段），
   不与其它失败同形（硬规则 3b）。
2. `packages/quay/src/goal-store.ts` 的 `write()` 侧同样校验——ABI 与 store 两层不得各说各话。
3. 存量 5 条空正文 goal：**本任务不批量回填**（内容需要人写），但要**产出清单**并留在提交信息里，
   让后续可见（硬规则 3 枚举不布尔）。
4. `origin` 的语义在动词描述里写清楚：出处引用，不是正文。

**不在本任务范围**：文件名 slug 抹掉非 ASCII（`slugify` 的 ASCII-only 缺陷，波及 goals/adr/meta/doc 四个 store、
实测 16/101 退化）——那是**文件名生成**机制，与「内容算不算完整」无关，另立
`gap-frontmatter-slugify-drops-non-ascii`。

## Acceptance Criteria

- [x] AC1 契约按 kind 分流且能取假：单测对 `goal_write` 喂四个输入——
      (a) `kind:goal` + 有 origin 无 body、(b) `kind:goal` + 有 body、
      (c) `kind:criterion` + 有 criterion/expect 无 body、(d) `kind:criterion` + 缺 criterion——
      断言 (a) 与 (d) **被拒**、(b) 与 (c) **被接受**。四个方向都断言，不只断言接受的那两个。
      取假：当前实现对 (a) 与 (d) 都接受（GOAL-008 即 (a) 的产物）。
- [x] AC2 拒绝原因可区分（硬规则 3b）：断言 (a) 与 (d) 的错误信息**互不相同**，且各自含所缺字段名；
      断言二者都不等于「写入失败」这类裸文案。
- [x] AC3 ABI 与 store 两层一致：对同一组输入分别经 MCP `goal_write` 与直接调
      `packages/quay/src/goal-store.ts` 的 `write()`，断言**接受/拒绝的判定逐条相同**；
      不同则打印分歧输入清单与两侧判定。
- [x] AC4 存量清单（枚举不布尔）：产出并在提交信息中贴出「当前 `kind:goal` 且 body 为空」的**完整 id 清单与条数**
      （2026-09-08 实测为 5 条：GOAL-004/005/006/007/008；实现时以当时重算为准）。
      清单为空或只给条数不给 id ⇒ 不算达成。
- [x] AC5 不误伤 criterion（负控制）：对 `goals/` 里**落地当时现存的全部 criterion** 逐条跑新校验，
      断言**被拒条数 == 0 且通过数 == 当时重算的 criterion 总数**（其中 body 为空的子集必须非空、且必须仍通过）。
      任一条被拒 ⇒ 规则定错了。⛔ 不得把某一时刻的条数冻结成字面量——`goals/` 是持续增长的活载体：
      2026-09-08 实证 AC-200 在本任务 fan-in 前 2 分 26 秒落地，把 57 顶成 58、空正文 19 顶成 20，
      判据红在字面量而非规则缺陷上（同 AC4 已有的「实现时以当时重算为准」限定，紧邻的 AC5 漏了）。
      2026-09-08 读数 57/19 只作基线棘轮下界，不作等式。
- [x] AC6 动词描述已改：断言 `packages/quay-native/src/mcp-server.ts` 的 `goal_write` description 中
      出现 `body` 对 `kind:goal` 必填的表述，且不再把 `origin` 描述成唯一必填的散文字段。
- [x] AC7 `bash scripts/test.sh --for-task gap-goal-record-completeness-undefined` 退出码 0。

## Definition of Done

用**真实的 `goal_write` 调用**（不是单测里的假 store）尝试创建一条 `kind:goal` 且无 body 的记录，
被实际拒绝并给出指名道姓的原因；再补上 body 后创建成功——两次调用的完整输入输出贴进提交信息。
同时贴上 AC4 的存量空正文 goal 清单。**「加了校验函数 + 单测绿」不算达成**——
本仓库已有先例（`gap-phase-boundary-differential-accounting` 5/5 AC 全绿而生产载体 0 条记录）。

## Touches

- `packages/quay-native/src/mcp-server.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/goal-gate.test.mjs`
- `packages/quay/test/provider-abi-conformance.test.mjs`
- `packages/quay/test/gap-goal-record-completeness-undefined.test.mjs`
- `packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs`
- `tasks/gap-goal-record-completeness-undefined.md`
## Needs-Human

**执行 2026-09-08T11:03:36.270Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=scoped-gate: test-isolation-check — 586 glob file(s), 24 current violation(s) [fixed-path-write=12 shared-build-artifact-write=1 spawns-test-sh=5 process-exit-1=6 mkdtemp-no-cleanup=0 live-data-dir-write=0 shared-root-mkdtemp=0]
  packages/quay-native/test/gate-checked-state.test.mjs:fixed-path-write  (line 26) const tasksDir = path.join(__dirname, ".tmp-gate-checked-state-test");
PASS: all 24 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
test-impl-census: checked 586 test files · clean 586 · impl-deleted 0
TOUCHES-DIR-GLOB-HINT: 1 directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
PASS: task_check('gh-3') via quay-github mcp is byte-identical to the direct CLI's own `task check gh-3 --json` output (mcp: {"id":"gh-3","gate":"execute->done","ok":false,"acTotal":1,"acChecked":0,"reason":"0/1 AC checkboxes checked"}, cli: {"id":"gh-3","gate":"execute->done","ok":false,"acTotal":1,"acChecked":0,"reason":"0/1 AC checkboxes checked"})
PASS: task_check('gh-4') via quay-github mcp is byte-identical to the direct CLI's own `task check gh-4 --json` output (mcp: {"id":"gh-4","gate":"execute->done","ok":true,"acTotal":1,"acChecked":1,"reason":"all AC checkboxes checked; eligible to move to done"}, cli: {"id":"gh-4","gate":"execute->done","ok":true,"acTotal":1,"acChecked":1,"reason":"all AC checkboxes checked; eligible to move to done"})
✖ AC5 — re-running the new validation over all production criteria rejects none (empty-body ones included) (2081.119455ms)
PASS: task_check via quay mcp (provider=github) reports ok:false for gh-3's real, currently-unchecked AC state (got {"id":"gh-3","gate":"execute->done","ok":false,"acTotal":4,"acChecked":0,"reason":"0/4 AC checkboxes checked"})
PASS: gate_run on GATE-FAIL (failing meter) is NOT isError -- a gate FAIL is a normal successful call
PASS: gate_run on GATE-FAIL returns ok:false (got: {"ok":false,"reason":"acceptance failed (exit 1)","event":{"id":"110bfe70-28f6-4dfe-92e8-ce46ef5c34ac","item_id":"GATE-FAIL","pipeline_id":"GATE-FAIL","gate":"acceptance","actor":"quay-cli","verdict":"fail","timestamp":"2026-09-08T11:03:24.726Z","payload":{"reason":"acceptance failed (exit 1)"}}})
PASS: gate_run without cwd on GATE-CWD-EXPLICIT returns ok:false (ran in gateWorkspaceRoot, not worktreeDir) (got: {"ok":false,"reason":"acceptance failed (exit 1)","event":{"id":"ef141aeb-5ed4-4071-a645-0699be053a2d","item_id":"GATE-CWD-EXPLICIT","pipeline_id":"GATE-CWD-EXPLICIT","gate":"acceptance","actor":"quay-cli","verdict":"fail","timestamp":"2026-09-08T11:03:24.781Z","payload":{"reason":"acceptance failed (exit 1)"}}})
PASS: gate_log on GATE-FAIL returns the prior gate_run's fail GateEvent (got: [{"id":"110bfe70-28f6-4dfe-92e8-ce46ef5c34ac","item_id":"GATE-FAIL","pipeline_id":"GATE-FAIL","gate":"acceptance","actor":"quay-cli","verdict":"fail","timestamp":"2026-09-08T11:03:24.726Z","payload":{"reason":"acceptance failed (exit 1)"}}])
PASS: lifecycle_adjudicate on GATE-FAIL returns no error
PASS: lifecycle_adjudicate on GATE-FAIL reports ok:true (its check is the AC/DoD-checkbox gate, not the acceptance meter -- got: {"ok":true,"reason":"all AC and DoD checkboxes checked; eligible to move to done","exitCode":0})
PASS: lifecycle_adjudicate never writes status -- GATE-FAIL is still 'ready'
PASS: lifecycle_promote on GATE-TODO (todo, AC/DoD checked) advances to 'ready' (got: {"ok":true,"reason":"all required artifacts present; eligible to move to ready","to":"ready","exitCode":0})
PASS: lifecycle_promote on GATE-FAIL (ready, failing meter) returns no error (a normal ok:false result)
PASS: lifecycle_promote on GATE-FAIL reports ok:false, to:null (delegates to complete, meter fails) (got: {"ok":false,"reason":"acceptance failed (exit 1)","exitCode":1,"to":null})
PASS: DIR-086 lifecycle_complete on GATE-FAIL returns no error
PASS: DIR-086 lifecycle_complete on GATE-FAIL returns ok:fals
- run_id：wk-prod-1788779505
- session_id：3ca567b7-5f28-4157-a5e3-c7fde94d3d15
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-goal-record-completeness-undefined-wk-prod-1788779505.log

**裁定 2026-09-08 — 重派（needs-human → ready）**

- 阻塞的红经实跑核实**不是规则缺陷，是判据腐烂**：AC5 测试对活载体 `goals/` 冻结了两个快照字面量
  （`criteria.length == 57`、`emptyBodyIds.length == 19`）。时间线（提交时刻实测）：`8c06b1630`
  「goals: AC-200 写盘即提交」于 11:00:56 落 develop（criterion 57→58、空正文 19→20）→ worker
  11:01:10 把 develop 合入任务分支 → 11:03:36 打 needs-human，间隔 2 分 26 秒。实测现值 58 / 20，
  两个字面量都已越过；只修前一个的话后一个会立刻接着红。
- AC5 的实质判定本就通过：`rejected == []` 与 `passes == criteria.length` 排在快照断言之前、两条都过
  ⇒ 新校验对全部 58 条生产 criterion 零误拒，负控制要验的性质已经成立。
- 已改棘轮并提交 `9273e6974`（分支 `task/gap-goal-record-completeness-undefined`）：
  `criteria.length >= 57` / `emptyBodyIds.length > 0`，两条实质断言原样保留。
  能取假对照（硬规则④）：同一谓词对空库 ⇒ criteria=0 (`>=57` false)、emptyBody=0 (`>0` false)；
  对生产 goals/ ⇒ 58 (true) / 20 (true)。该测试文件读数 5 tests / 5 pass / 0 fail。
- 实现与 DoD 证据此前已完备：`80d12fe42` 提交信息含真实 `goal_write` 调用的拒绝+接受双向输入输出，
  以及 AC4 存量 5 条空正文 goal 清单（GOAL-004/005/006/007/008）。后续 `3b11f3c4a`（校验限定
  create-only，修 goal-driver 机械翻转被误伤）与 `5d6e17697`（slugify fixture 补 body）已修掉连带伤。
- 分支落后 develop 9 提交，合并交机械 fan-in。
