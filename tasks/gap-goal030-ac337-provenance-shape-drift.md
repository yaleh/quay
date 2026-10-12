---
id: gap-goal030-ac337-provenance-shape-drift
title: GOAL-030 ③ 读数漂移：状态事件 v0→v1 把 writerModule/entry 移入 producer，AC-337 判据与
  branch-selfhost-probe 仍读顶层字段 ⇒ 3/3 事件被误判 loaded-main-checkout-code
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-337
---
**type:** execution

## Proposal

GOAL-030 的 AC-337 判据与它调用的探针在 2026-10-13 的主检出上取 `exit 1 / CAUSE=loaded-main-checkout-code`，但**被它点名的 3 条事件实际全部由本树代码写出** —— 这是**读数侧的字段路径漂移**（reader 未随状态事件契约 v0→v1 迁移），不是自举失败。分支代码身份没有被破坏；坏的是那个读身份的量。

### 事实链（可直接复跑）

1. 判据（`goals/AC-337-*.md` 第 22 行）与探针自检（`scripts/branch-selfhost-probe.mjs:135` 的 `classifyEventIdentities`）都从**原始 JSONL 记录**上重新推导 `inTree(e.writerModule) && inTree(e.entry)` —— 判据刻意不复用探针的结论（它不信任探针自己报的「通过」，这是 AC-337 的设计前提，⛔ 不许在本次修复中削弱）。
2. 状态事件契约已 v0→v1：`packages/quay/src/kernel/task-transition.ts:223-238` 明确记载 v1「**moves the provenance triple under `producer`**」；v0 的顶层 `writerModule`/`entry` 不再出现在新记录上（v0 旧行仍按 v0 读，`readTaskStatusEventCarrier` 逐行按 `schema` 键分类）。迁移提交：`685ec7415`（task-status-events contract v1）、`083b4a644`（Provider-ABI 写路径也发 v1）。
3. 上面两个 reader 没有随之迁移：v1 记录上 `e.writerModule` 是 `undefined` ⇒ `inTree(undefined) === false` ⇒ 3/3 事件被判「本树外」。
4. 当前读数（2026-10-13，主检出 = author @`d1e0bb744`）：`node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-337 --dry-run --timeout 120000 --json` ⇒ `event.verdict: "fail"`，理由引用的正是一条 `"schema":"task-status-event/v1"` 记录；同一批事件的 `producer.writerModule` = `/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts`、`producer.entry` = `/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts` —— **都在被求值的树内**。两类转移（promote 2 / retreat 1）、`childResolution: "default"`、`production.unchanged: true`、`env.QUAY_PLUGIN_ROOT: null` 本来就全部成立；先跑 `scripts/branch-selfhost-probe.mjs --json` 可直接复现。

### 为什么它一直没被发现

`plugin/test/branch-selfhost-probe.test.mjs` 把漂移**钉住**了：它同时断言判据正文与探针源码含 `e.writerModule`/`e.entry`（第 146/168 行），而它喂给 `classifyEventIdentities` 的合成事件是最新 v0 形态（第 61-62 行 `event(writerModule, entry)`），**从未喂过一条 v1 记录** ⇒ 测试始终是绿的。硬规则 3b 的形态：读不懂的输入与「不合格」共用一个 spelling，于是「读错字段」与「真的加载了主检出代码」不可区分。

### 修法（只修 reader，⛔ 不动 kernel 写侧）

1. **探针**：加 `provenanceOf(rec)` —— 顶层 `writerModule` 存在则按 v0 取，否则取 `rec.producer`（v1）；`classifyEventIdentities` 改用它。**缺值仍必须判失败**（硬规则 3b：读不到的来源不得与「在树内」同形；`null`/缺 `entry` 的 arm 必须继续保持红）。
2. **判据**：经 `node --experimental-strip-types packages/quay/bin/quay.ts goal write AC-337 --criterion '<新正文>'` 把同一 tolerance 内联进那段 `node -e` 读取器（⛔ 不手改 `goals/*.md`，goal store 的唯一写路径是 goal write）。除字段路径外，判据契约保持不变：读哪些顶层字段、三态退出码、`CAUSE=` 词表都照旧，仍是对**原始记录**的独立复核。**这不是挪动球门**：AC-337 断言的保证（每条事件的写入模块与入口 realpath 在被求值的树内）一字未改，改的只是该保证在当前已发布的 v1 契约上应从哪个字段路径取 —— 即使按 v1 记录算，判据也仍然能取假（见下面第 5 条 AC 的变异负对照）。
3. **测试**：`plugin/test/branch-selfhost-probe.test.mjs` 增加 **v1 形态**的 arm（`producer` 在树内 ⇒ `ok:true`；`producer` 指向树外 ⇒ `ok:false`），并更新第 146/168 行的字段名钉子。这两个 arm 必须能当**回归锁**：把 `provenanceOf` 的 v1 分支拿掉后测试转红。
4. **探针 `--selftest`** 同样加一条 v1 arm（`--selftest` 是判据之外的第二道自检）。
5. ⛔ 非目标：不改 `packages/quay/src/kernel/task-transition.ts` 的写侧记录形态，不改 v1 契约，不新增事件字段，不扩大 AC-337 的范围。若在核对中发现 `negativeControl` 在已并入主检出的树上被 `mainHasModule===true` 短路为 n/a，那是判据自己写明的逃生门，**如实在 Evidence 记下即可，本次不修**。

<!-- dedup-ref --> 归属与去重：本条是 GOAL-030 的第三条承接链 —— 前两条是 `gap-goal030-promotion-writes-via-kernel-transition` 与 `gap-goal030-branch-selfhost-probe`（均 done），本条针对的是它们落地**之后**发生的契约迁移所造成的读数漂移，机制不同；`task-granularity-advice.ts` 对本任务的 Touches 报 `peers: []`，无在飞任务重叠。

## AC

- [x] `node --no-warnings scripts/branch-selfhost-probe.mjs --json` 退出码 0，且 stdout JSON 里 `selfCheck.ok === true`、`selfCheck.causes` 为空数组、`events.length === 3`。
- [x] 同一次运行的输出里，3 条事件各自带 `producer.writerModule` 与 `producer.entry`，且二者的 realpath 均以被测树的 toplevel 开头（即 `inTree` 对 v1 记录取真，`identity.bad` 为空）。
- [x] `node --no-warnings scripts/branch-selfhost-probe.mjs --selftest` 退出码 0，且其中至少一条 arm 的事件记录带 `producer`（v1 形态）：在树内 ⇒ 通过，指向树外 ⇒ 报 `CAUSE=loaded-main-checkout-code`。
- [x] `node --test plugin/test/branch-selfhost-probe.test.mjs` 退出码 0。
- [x] **变异负对照（证明判据仍能取假、不是恒真）**：临时把 `provenanceOf` 改成只读顶层 `writerModule`/`entry`，`node --no-warnings scripts/branch-selfhost-probe.mjs --json` 必须退出 1 且 stderr 含 `CAUSE=loaded-main-checkout-code`；恢复实现后转绿。两次退出码与 stderr 首行写进 Evidence。
- [x] `node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-337 --dry-run --timeout 120000 --json` 的 `event.verdict === "pass"`（判据本体经唯一正本路径求值）。
- [x] 集群核对（硬规则 5b）：`grep -rn 'e\.writerModule\|e\.entry\|producer\.writerModule' scripts/ goals/ plugin/test/branch-selfhost-probe.test.mjs` 的全部命中都已按 v0/v1 双形态处理，把命中数与前 3 条内容贴进 Evidence（不得再有会把 v1 记录判错的读取点）。

## DoD

- 在主检出上跑 `scripts/branch-selfhost-probe.mjs`，**每条真实事件**的 `producer.writerModule`（kernel 模块 realpath）与 `producer.entry`（driver 子进程入口 realpath）都落在被求值的树内 —— 这是对生产载体（`.quay/task-status-events.jsonl` 形态）的真实读数，不是 fixture 回声。
- AC-337 经 `quay goal gate` 取到 `pass`，`quay goal check --achieved-failing` 不再含 AC-337。
- 判据的健全性由变异负对照证明（去掉 v1 分支 ⇒ 报 `loaded-main-checkout-code`），即它仍是一个**能取假**的判据。
- ⛔ 未改 kernel 写侧记录形态、未改 v1 契约、未削弱判据「独立复核原始记录」的设计。

## Touches

- scripts/branch-selfhost-probe.mjs
- plugin/test/branch-selfhost-probe.test.mjs
- goals/AC-337-分支自举-按文件路径启动的分支-promotion-driver-默认子进程解析-在沙盒中触发-todo-ready-分.md
- tasks/gap-goal030-ac337-provenance-shape-drift.md

## Evidence

落笔当轮读数（2026-10-13，主检出 = author @`d1e0bb744`）：

- `scripts/branch-selfhost-probe.mjs --json` ⇒ `rc=1`，stderr `CAUSE=loaded-main-checkout-code`。
- 该次运行的 3 条事件均为 `"schema":"task-status-event/v1"`；`producer.writerModule` 三条同值 `/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts`，`producer.entry` 三条同值 `/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts` —— realpath 均在 `/data/home/yale/work/quay` 内。
- `promotion.flips=2` 且 promote 事件 2 条；`revaluation.flips=1` 且 retreat 事件 1 条；`childResolution="default"`；`production.unchanged=true`；`env.QUAY_PLUGIN_ROOT=null`。
- `quay goal gate AC-337 --dry-run --timeout 120000 --json` ⇒ `event.verdict="fail"`，`payload.reason` 引用的正是一条 v1 记录（`{"schema":"task-status-event/v1",...`）。

——

### 修复后读数（2026-10-13，worktree `/data/home/yale/work/quay-worktrees/gap-goal030-ac337-provenance-shape-drift`）

**实现落点**：`scripts/branch-selfhost-probe.mjs` 新增导出 `provenanceOf(e)` —— 按 `schema` 标签**位置**分类（有 ⇒ v1 取 `e.producer`；无 ⇒ v0 取顶层 `e.writerModule`/`e.entry`），`classifyEventIdentities` 改用它；读不到仍返回 `undefined` ⇒ `inTree` 仍判 false（硬规则 3b：读不懂不得与「在树内」同形）。同一 dispatch 也接上了 `childEntry`（同一载体上的**第二个**未迁移 v0 字段路径，原样读在 v1 记录上恒为 `null`）。

> **对 Plan 第 1 条的一处细化（同一 tolerance，不是放宽）**：Plan 写的是「顶层 `writerModule` 存在则按 v0，否则取 `rec.producer`」；实现改成「有 `schema` 键 ⇒ v1，否则 v0」。理由是**这是 kernel 自己的读者所用的同一条规则**（`task-transition.ts`：v0 旧行「is READ as v0 … classifies per line, positionally, by the presence of the `schema` key」），reader 与 writer 的分类依据因此是同一个；而按「正在读的那个字段是否存在」分类是自指的，且对 `producer` 整个缺失的记录会直接取 `undefined.writerModule`。两种写法对**所有真实记录形态**（v0 / v1 / 撕裂行 sentinel）给出同一答案；差别只在一个不存在的混合形态上，且新写法在那里仍然 fail-closed。

**AC1/AC2**（`env -u QUAY_PLUGIN_ROOT node --no-warnings scripts/branch-selfhost-probe.mjs --json`，cwd=worktree）：

- `rc=0`，`selfCheck = {"ok":true,"causes":[],"badEvents":[]}`，`events.length = 3`。
- 三条事件全部 `"schema":"task-status-event/v1"`；三条的 `producer.writerModule` 同值
  `…/gap-goal030-ac337-provenance-shape-drift/packages/quay/src/kernel/task-transition.ts`，
  `producer.entry` 同值 `…/gap-goal030-ac337-provenance-shape-drift/plugin/scripts/ready-pool-check.ts`
  —— 两条 realpath 均以被测树 toplevel 开头，`identity.bad` 为空。
- `promotion.flips=2`（promote 事件 2 条）、`revaluation.flips=1`（retreat 事件 1 条）、
  `childResolution="default"`、`production.unchanged=true`（`byteIdentical=true`）、`env.QUAY_PLUGIN_ROOT=null`。
- 修复后 `promotion.childEntry` 重新取到真实值 `…/plugin/scripts/ready-pool-check.ts`（修复前该字段在 v1 记录上恒为 `null`）。
- **负对照如实记录（非目标 5，本次不修）**：主检出已并入 kernel 模块，故
  `negativeControl = {"evaluated":true,"events":2,"mainHasModule":true,"exit":0,"reason":"ran"}` —— 主检出 driver 在同样沙盒上**写了 2 条事件**；判据正文写明的逃生门（仅当 `rroot!==rmain && nc.mainHasModule!==true` 才校验负对照）因此短路为 n/a。

**AC3**（`--selftest`，判据之外的第二道自检）：`rc=0`、`SELFTEST PASS`，`arms` 7 条全绿；其中 v1 三条：`v1-in-tree`（`producer` 在树内 ⇒ 通过）、`v1-foreign`（`producer` 指向树外 ⇒ 记为 bad）、`v1-no-producer`/`v1-null-entry`（读不到 ⇒ 仍红）。
AC3 要求的「指向树外 ⇒ 报 `CAUSE=loaded-main-checkout-code`」**直接取到**：在同一变异（去掉 v1 分支）下 `--selftest` ⇒ `rc=1`、stdout `SELFTEST FAIL`、stderr
`  FAIL v1-in-tree: v1 (producer) in-tree event was flagged: [{"schema":"task-status-event/v1",…` 与
`CAUSE=loaded-main-checkout-code — selftest: v1-in-tree: …`；还原后 `SELFTEST PASS`（rc=0）。即 v1 形态一旦读错，第二道自检就用同一词表拒绝。

**AC4**：`node --test plugin/test/branch-selfhost-probe.test.mjs` ⇒ `tests 4 / pass 4 / fail 0`，退出码 0。

**AC5 变异负对照**（证明判据仍能取假）：把 `provenanceOf` 改成只读顶层 `writerModule`/`entry`（删掉 v1 分支）后，

- `scripts/branch-selfhost-probe.mjs --json` ⇒ **rc=1**，stderr 首行
  `CAUSE=loaded-main-checkout-code — {"promotion":{"childResolution":"default","childEntry":null,…
- 同一变异下 `node --test plugin/test/branch-selfhost-probe.test.mjs` ⇒ **`fail 3`**（`--selftest exits 0` / `identity comparator…` / `AC-337's criterion fields…`）—— 回归锁成立。
- 用 `cp` 还原（sha256 与变异前一致 `e0f315ec5b774b6cd5710561fd1bfd828272edf08936783f3eec617b29a3d0f6`）后 ⇒ probe rc=0、测试 `pass 4 / fail 0`。

**AC6**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE … quay.ts goal gate AC-337 --dry-run --timeout 120000 --json`（cwd=worktree）⇒ 退出码 0，`event.verdict === "pass"`、`payload.reason = "acceptance passed (exit 0)"`，全程 9s（判据内 `timeout 55` 余量充裕）。判据正文经 `goal write` 落盘（commit `a6725c5ad`），**只改了那段 `node -e` 读取器**：`CAUSE=` 行数 8→8、失败退出 8→8，`expect`/`origin`/三态退出码/读哪些顶层字段全部未动。

**判据本体的 A/B（同一批真实 v1 事件，旧读法 vs 新读法）** —— 把旧判据与新判据各自的 `node -e` 读取器抽出来，喂同一份 `probe --json` 输出（worktree 上那 3 条真事件）：

- 旧读取器 ⇒ `rc=1`，`CAUSE=loaded-main-checkout-code — 3 event(s) written by code outside <tree>: {"schema":"task-status-event/v1",…}`
- 新读取器 ⇒ `rc=0`，`PASS: branch code proven (3 events, all writerModule/entry under <tree>); promote 2, retreat 1; negative control n/a (main already carries the module); production unchanged`

同一输入、同一树、只换字段路径 —— 漂移与修复各自被独立取到一次。

**AC7 集群核对**（硬规则 5b）：`grep -rn 'e\.writerModule\|e\.entry\|producer\.writerModule' scripts/ goals/ plugin/test/branch-selfhost-probe.test.mjs` ⇒ **命中 7 条**，全部已按 v0/v1 双形态处理。前 3 条：

1. `scripts/branch-selfhost-probe.mjs:149:  return { writerModule: e.writerModule, entry: e.entry };` —— `provenanceOf` 的 **v0 分支**（其上三行即 `schema` 位置判定）。
2. `scripts/goal-032-selfhost-probe.mjs:407:    resolved: Object.fromEntries(identity.entries.map((e) => [e.entry, e.loadedFrom ?? null])),` —— **对象形态不同，非本簇**：该文件的 `identity.entries` 是子进程 `import.meta.resolve`/`realpath` 出来的**模块入口记录**（`readIdentity()` 返回 `{root, ...JSON.parse(line)}`，`line` 是子脚本打印的 `{cwd, results}`），与状态事件无关；该文件通篇不读 `task-status-events`、不含 `writerModule` ⇒ 没有会读错 v1 记录的读取点。
3. `goals/AC-337-…md:23:  const provOf=(e)=>{…if(typeof e.schema!=="string")return{writerModule:e.writerModule,entry:e.entry};…` —— 判据正文里新内联的**同一个 v0/v1 dispatch**。

其余 4 条是 `plugin/test/branch-selfhost-probe.test.mjs:194/195/220/221` 的字段名钉子（`"e.writerModule"`/`"e.entry"`），已与新增的 `"e.schema"`/`"e.producer"`/`"p.writerModule"`/`"p.entry"` 并列 —— 钉子本身即 v0/v1 成对。`producer.writerModule` 这一形式全仓 0 命中（判据与探针都经 `p.writerModule` 取值）。

### 与 DoD 的逐条对照（含两处「读数其实是空的」的如实标注）

- **「在主检出上跑 `scripts/branch-selfhost-probe.mjs`，每条真实事件的 producer 两条 realpath 都落在被求值的树内」**：
  在**主检出**（`/data/home/yale/work/quay`，`root==main`，仍跑修复前的读法）实跑 ⇒ `rc=1`、`selfCheck.causes=["CAUSE=loaded-main-checkout-code"]`，而**三条事件全部是 v1 记录、顶层 `writerModule` 全为 `undefined`**，`producer.writerModule` 三条同值 `/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts`、`producer.entry` 三条同值 `/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts` —— **全在被求值的树内**；`production.unchanged=true`。即：主检出当下这条红**完全**由读数漂移造成，不是自举失败；这正是本任务要修的量。修复后的等价读数就是上面 worktree 的那次运行（同一份代码、同一份契约、真实 driver 进程写入真实 `.quay/task-status-events.jsonl`，不是 fixture 回声）；fan-in 落地后主检出会读到同一个 `pass`。
- **「`quay goal check --achieved-failing` 不再含 AC-337」—— 如实标注：这条读数是空的（硬规则 4）。**
  实跑 ⇒ `{"achievedButFailing":["AC-242"],"evaluated":true,"scopeSize":34}`，AC-337 **不在**其中；但它**本来也不会**在其中：`checkAchievedFailing` 的 in-scope 谓词是「**active GOAL 之下**的 achieved AC，或显式 `long-term: true`」（`goal-store.ts:2072-2086`），而 GOAL-030 已是 `achieved`、AC-337 未声明 `long-term` ⇒ 它随 GOAL-030 一起离开了 reverify 作用域（`inScope` 34 条里没有它）。**故这条 DoD 判据既不能取假也不能取真**；能取假的对偶读数是 AC6 的 `goal gate --dry-run` 结论与上面那段旧/新读取器的 A/B。`AC-242` 的 achieved-but-failing 与本 delta 无关（本 delta 只碰 `scripts/branch-selfhost-probe.mjs`、它的测试、AC-337 的判据正文）。
- **「判据健全性由变异负对照证明」**：见 AC5（去掉 v1 分支 ⇒ `CAUSE=loaded-main-checkout-code`，测试 3 red）。
- **「⛔ 未改 kernel 写侧记录形态 / 未改 v1 契约 / 未削弱判据独立复核」**：`packages/quay/src/kernel/task-transition.ts` 零改动（不在本任务 delta 内）；判据仍是对**原始 JSONL 记录**的独立 `node -e` 复核，未复用探针自己报的结论；`expect`/`origin`/三态退出码未动。

### 收尾（pre-merge / 门 / anti-drift）

- `git -C <wt> merge --no-edit develop` ⇒ `Already up to date.`（develop 未动，无冲突）。分支两个实现提交：`a6725c5ad`（判据重锚）、`5d5b7eb95`（探针 + 测试）。
- scoped 门 `bash scripts/test.sh --for-task gap-goal030-ac337-provenance-shape-drift --allow-thin` ⇒ **`RC=0`**（其中 `plugin/test/branch-selfhost-probe.test.mjs` 4/4 pass）。随后 `worker-driver.ts --write-scoped-gate-cache …` ⇒ `{"event":"scoped-gate-cache-written","task":"gap-goal030-ac337-provenance-shape-drift","developSha":"038c271d2c8f672352b13f5ceff7e6febf6b39f1",…}`。
- anti-drift（`--merge-target develop`）⇒ `ANTI-DRIFT OK: … 3 actual file(s), all within declared Touches (4 glob(s))`。

### 顺带实测到的一个 store 缺口（不在本任务 Touches 内，未修，仅记录）

第一次 `goal write AC-337 --criterion … --root /home/yale/work/quay-worktrees/…`（**走 `/home/yale` 别名路径**）落盘成功但自提交失败：`goal-store: commit of "AC-337" failed — the file was written to disk but is not on any branch's history`。

根因可复现：`packages/quay/src/store-commit.ts` 的 `commitKindFile` 用
`path.relative(resolveGitRoot(dir), path.join(dir, fileName))` 算 relPath，而 `git rev-parse --show-toplevel` 会 **realpath**（本机 `/home/yale` → `/data/home/yale`），`--root` 侧的别名路径没被 realpath ⇒ relPath 变成 `../link/goals/<f>.md` ⇒ `git add` 退出 128 ⇒ `commitStoreWrite` 返回 `"failed"`。最小复现（/tmp 内真目录 + 符号链接）实测：`path.relative(<git toplevel>, <linkdir>/goals/x.md)` = `../link/goals/x.md`，`git -C <root> add -- <rel>` ⇒ `exit 128`。改用 realpath 路径（或不传 `--root`）后同一写入正常自提交。

**补记（同轮，收尾之后）**：上一条「`Already up to date.`」只描述**那一刻**的读数 —— 随后 develop 前移了：本任务的 `task_write` 提交 `90618c9a9` 被常驻 driver 的 author→develop 同步带走（`self-only` 也会在几分钟后被 `propagateDocBranchToDevelop` 带上 develop，见 `.quay/store-commit-propagation.jsonl`），另有一个其它任务的写入 `9b9f7993d`。worktree 因此**再**做一次 `git merge --no-edit develop` ⇒ 合并提交 `9ed444347`，develop 成为 HEAD 的祖先；合并后重跑 scoped 门 ⇒ **`RC=0`**，anti-drift ⇒ **OK（3 file(s)，全在 Touches 内）**，且 `tasks/<id>.md` 在 worktree 与 `develop` 两侧字节一致、各 7 个 `- [x]`（fan-in 的 ac-precheck 读两者的并集，两侧都已就位）。
