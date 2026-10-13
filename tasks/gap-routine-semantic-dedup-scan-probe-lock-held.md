---
id: gap-routine-semantic-dedup-scan-probe-lock-held
title: "semantic-dedup-scan: Identical flock -n fail-open lock probe; the second
  site's own comment names the first as its source."
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Identical flock -n fail-open lock probe; the second site's own comment names the first as its source.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791908616513` · ts `2026-10-13T16:23:36.513Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`probeLockHeld`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:663`
- `plugin/scripts/pre-verified-round-record.ts:576`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition（复核结论：**已修掉**，不是「已注意到」）

**复核**：finding 属实。`probeLockHeld` 在 develop 上有**两个逐字节相同**的路径
（`full-suite-runner.ts:664` 与 `pre-verified-round-record.ts:577`，两处都在 `plugin/scripts/`，非生成物），
且第二个的注释**自己写明了来源**（`the same fail-open as full-suite-runner.probeLockHeld`）—— 正是 finding 的 rationale。
⇒ 一个 fail-open 探针两个家：任一侧的槽位解析 / seam / fail-open 改动都会让另一侧静默漂移，且**记录里没有任何检查盯这个同一性**
（`suite-slot-ssot-check` 的 I3 只盯 `suite-lock-slots.ts` 的消费者；发现它的正是 semantic-dedup-scan 例程本身）。

**处置（requested action: `extract` → 单一定义点）**：把探针**上提到 `plugin/scripts/suite-lock-slots.ts`** ——
即两个消费者**本来就 import** 的「suite 槽位唯一实现」模块（只依赖 node builtins + gate-script-base，轻量；
这很重要：pre-verified 之所以本地复写，正是为了不 import 重的 full-suite-runner hub）。
- `suite-lock-slots.ts` 新增 `probeLockHeld()` 与其归约 `countHeldSuiteLocks()`（唯一函数体）。
- `full-suite-runner.ts` / `pre-verified-round-record.ts` 删除本地函数体，改为
  `import { countHeldSuiteLocks } from "./suite-lock-slots.ts"` + `export { countHeldSuiteLocks }`
  —— **import 出真绑定再 export，不是 `export { … } from` 纯转发**：pre-verified 模块内部
  `record.concurrentSuitesRunning = … countHeldSuiteLocks(lockRoot) …` 仍在调用它，纯转发只绑导出表、
  不绑模块作用域，本模块自己的调用点会 `ReferenceError`（同族前例：已 done 的
  `gap-routine-semantic-dedup-scan-hostparallelism-missed-import` 记录的运行时臂）。
  两个模块的公开导出面逐字不变（同名、同签名），既有 import 者与测试拿到的都是**同一个函数对象**。
- `pre-verified-round-record.ts` 的本地 `suiteLockPaths()` 一并删除 ⇒ `execFileSync` 在该模块再无用途，import 随删。

**顺带修掉同一段里的兄弟缺陷（不是范围蔓延：它与被删的两行同生共死）**：pre-verified 的副本
**解构恰好两个槽**（`const [l0, l1] = suiteLockPaths(root)`），而 full-suite-runner 的版本按 S 探测
—— 同一个量两个答案：S>2 且 `.2` 被持有时 runner 记 1、pre-verified 记 0。收敛到
`suiteLockSlotPaths(suiteLockBase(root))` 后两侧恒同。这**不改任何字段的公式**（仍是
`min(1 + countHeldSuiteLocks(root), slots)`），只把被计的数修成 S 正确的。

**5b 扫描（同一原则在本载体的其它落点）**：`grep -rn "^\(export \)\?function <sym>" plugin/scripts/*.ts`
扫同族符号 —— 本任务只处置 finding 点名的 `probeLockHeld`（及与它同生共死的 `countHeldSuiteLocks` /
`suiteLockPaths`）。同族的另两个（`hostParallelism` → runner-concurrency.ts、`effectiveParallelism` →
suite-accounting.ts）已由两条**已 done** 的姊妹任务收敛；`concurrentSuiteSlots` 的本地版是**一行委托**
（不是被复制的表达式），按原样保留。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `probe-lock-held`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791908616513`）所描述的问题被复核并处置 —— 复核：属实（byte-identical-body，两个家，其中一家的注释自认来源）；处置：按 requested action `extract` 上提到 `suite-lock-slots.ts`，两个消费者改为 re-export **同一 binding**
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**，且留下**能取假**的棘轮：`plugin/test/pre-verified-round-record.test.mjs` 按位置断言 `probeLockHeld` / `countHeldSuiteLocks` 在 `plugin/scripts` 下**各恰好一处声明**（含「无 export 的裸 function」形态）+ 两个消费者必须 `===` 规范函数对象 + scanner 负控制；变异实跑（把删掉的私有副本写回）⇒ 该条 RED

## DoD
- [x] 上面的判据实跑通过 —— `node --test plugin/test/pre-verified-round-record.test.mjs` ⇒ **73/73 pass**；`node --test plugin/test/suite-slot-ssot-check.test.mjs` ⇒ 20/20；`full-suite-runner-phases` 71/71；`full-suite-runner-cgroup` 40/40；变异 ⇒ 棘轮 RED（见 Evidence）；S>2 负控制实跑（见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由本任务的派发链（worker 会话，独立 worktree）执行；例程只读 `plugin/scripts` 立案，未代跑任何产出者，任务体的提交也由 worker 侧完成

## Evidence

### AC1 — 复核与处置（修前 / 修后都是实打实跑出来的读数）

**修前（finding 的形态，逐字对照 develop）**：
```
$ git show develop:plugin/scripts/full-suite-runner.ts | grep -n "^function probeLockHeld"
664:function probeLockHeld(lockFile: string): boolean {
$ git show develop:plugin/scripts/pre-verified-round-record.ts | grep -n "^function probeLockHeld"
577:function probeLockHeld(lockFile) {
```
第二处的 docstring 逐字：`the same fail-open as full-suite-runner.probeLockHeld`（自认来源）。

**修后 —— 声明点只剩一个（按位置，非关键词）**：
```
$ grep -rn "^\(export \)\?function probeLockHeld" plugin/scripts/*.ts
plugin/scripts/suite-lock-slots.ts:159:export function probeLockHeld(lockFile: string): boolean {
$ grep -rln "^\(export \)\?function probeLockHeld" plugin/scripts/*.ts | wc -l
1
$ grep -rn "^\(export \)\?function countHeldSuiteLocks" plugin/scripts/*.ts
plugin/scripts/suite-lock-slots.ts:179:export function countHeldSuiteLocks(root: string): number {
```
（`suiteLockPaths` 在 `plugin/scripts` 下已零声明 —— 仅在注释里作为「被删掉的那个」被提及。）

**同一性 + 内部调用点仍读同一绑定（运行时，不是 import 层回声）**：
```
$ node --experimental-strip-types -e '… import slots, runner, pvr …'
slots.countHeldSuiteLocks === runner: true
slots.countHeldSuiteLocks === pvr:    true
probeLockHeld exported: function
probe of nonexistent dir (fail-open FREE): false
```

**S>2 负控制（收敛带来的行为修正，能取假）**：
```
$ RESOURCE_GATE_CONCURRENT_SUITES=3 FULL_SUITE_LOCK_FILE=<tmp>/full-suite.lock （真实 flock 持住 .2）
S = 3
held (S=3, .2 held) => 1
$ RESOURCE_GATE_CONCURRENT_SUITES=2 （同一持锁状态）
held (S=2, .2 out of range) => 0
```
（修前 pvr 侧恒读 0 —— 它解构的恰是 `.0/.1`。）

**棘轮实跑 + 变异负控制（cp 备份，非 git checkout）**：
```
$ node --experimental-strip-types --test plugin/test/pre-verified-round-record.test.mjs
✔ SSOT — probeLockHeld has exactly ONE definition point (suite-lock-slots.ts) and BOTH countHeldSuiteLocks consumers re-export that module's binding
ℹ tests 73 / pass 73 / fail 0
变异：把删掉的私有副本写回 ⇒
✖ AssertionError: probeLockHeld must be DECLARED in exactly one place — actual declarations:
   [{"file":"pre-verified-round-record.ts","line":560},{"file":"suite-lock-slots.ts","line":159}]
cp 复原后 md5 66fb832bd4d691402e77a3f19d5a6563 与变异前一致，73/73 复绿。
```

**import-graph 棘轮复跑**（确认 re-export 未引入环 / 未加深 kernel）：
```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json
valueSccs=0 / typeSccs=0 / reverseEdges=0, verdict.ok=true
```

### AC2 — 处置可核

- 判据载体：`plugin/test/pre-verified-round-record.test.mjs` 的 SSOT 用例（① 两个符号各恰好一处声明
  ② 两个消费者 `===` 规范函数对象 ③ scanner 负控制**同时**覆盖「裸 function」与「export function」两种形态
  —— 本任务删掉的那份正是**裸 function**，只认 `export function` 的扫描器对它结构性失明，硬规则 4c）。
- 三个读数：修后全绿（73/73）；私有副本回归 ⇒ RED 并打印声明清单；import-graph 不升（0/0/0）。

## Touches
- `plugin/scripts/suite-lock-slots.ts`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/test/pre-verified-round-record.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-probe-lock-held.md`

## Test-Files
- `plugin/test/pre-verified-round-record.test.mjs`
- `plugin/test/suite-slot-ssot-check.test.mjs`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `plugin/test/full-suite-runner-cgroup.test.mjs`
