---
id: gap-routine-semantic-dedup-scan-parseargs-local-copies
title: "semantic-dedup-scan: 21 files declare their own parseArgs and only 3
  import the shared one, differing on argv slicing, unknown-arg handling and
  missing-value shape."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
21 files declare their own parseArgs and only 3 import the shared one, differing on argv slicing, unknown-arg handling and missing-value shape.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790503843524` · ts `2026-09-27T10:10:43.524Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:51`
- `plugin/scripts/gate-staleness-check.ts:38`
- `plugin/scripts/checked-in-write-check.ts:374`
- `plugin/scripts/loadbearing-test-gate.ts:214`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge onto gate-script-base parseArgs(argv, spec)

## Disposition
复核结论（2026-09-27）：finding 记录已逐字核实（`findingId: parseargs-local-copies` · runId
`semantic-dedup-scan-1790503843524` · `dupKind/verdict: divergent-implementation` ·
`suggestedAction: merge onto gate-script-base parseArgs(argv, spec)` · files 与本任务 Touches 的 4 条一致）。

结论：这**不是**「3 份同一函数的复制」，而是 3 份彼此不同的 CLI 契约 + 一个默认不校验未知参数的共享 parser。
处置 = 把能找到的那一条真的修掉，把剩下两条的阻塞点按实测写死在各文件里（⛔ 不是「已注意到」）。

### 一、修掉（commit `d4122b5ee`）
共享 parser 在**未知参数**这一轴上是短板 —— **实测，非推断**：
`parseArgs(["node","s","--bogus"], spec)` ⇒ `flags={"bogus":""}`、exit 0。
21 份私有副本**无一**如此，全部拒绝（throw / exit 2 / `error` 字段）。这正是它们无法收敛到 baseline 的原因：
照搬等于**删掉**它们各自的未知参数闸，此后一个打错的 `--rrot /tmp` 会落到调用方的 `?? default`，
把一个用户从未给过的值顶上去（硬规则 3b：「读不懂」不得返回与「合格」同形的值）。

- `plugin/scripts/gate-script-base.ts`：新增 `CliSpec.strict`（**opt-in**，默认 false）⇒ 未声明 flag 报
  `unknown argument: --<flag>` + exit 2。既有 3 个调用点（enum-surface-parity-check / prepare-admission-check /
  proposal-convergence）不传 `strict`，输入语言逐字不变。
- `plugin/scripts/gate-staleness-check.ts`：私有 `parseArgs` **退役**，改用共享 parser（`strict: true`）——
  3 个 exemplar 里唯一契约可被表达的一个。

### 二、写明阻塞点（⛔ 不合并，实测差异是承重的）
这两份都**不是**共享 parser 的复制；强行合并会静默改变判定：
- `plugin/scripts/checked-in-write-check.ts:374`：`--files a b c` 是**贪婪列表**。实测共享 parser 读成
  `files="a"` 并把 `b`,`c` 泄进 positionals ⇒ 合并会**丢掉 3 个输入里的 2 个**而检查器照常出结论。
- `plugin/scripts/loadbearing-test-gate.ts:214`：**库形** parser，坏参数**返回** `{error}` 交调用方决定；
  共享 parser 在 `--help` 与 minArgs 两条路径上都**自己 `process.exit`** ⇒ 合并会让一个参数笔误从
  「纯函数」内部直接杀进程。另有 `--import-root` 可重复，同样超出「一 flag 一 value」。

⇒ 要吸收这两者，baseline 需先长出「贪婪列表」与「非退出式错误」两种模式，属各自独立的改动，本 finding 不吞。

### 三、证据（可复核）
- 方向一：`git show d4122b5ee --stat`；`plugin/scripts/gate-staleness-check.ts` 已无 `function parseArgs`。
- 方向一的行为保持（走共享 parser 的 `.ts` 直调路径；suite 驱动的是 `.sh` 包装层，其 bash 独立解析、
  覆盖不到该路径，故单独实跑六个轴）：`unknown arg ⇒ exit 2 + "unknown argument: --bogus"`；
  `--timeout abc ⇒ exit 2`（报文含 `--timeout`）；`bare --root ⇒ 落到 repoRoot 而非 cwd`
  （对照：`cd /tmp` 下仍落 repoRoot，若误读作 `""` 会退化成 cwd 并报 not-a-workspace）；`--json` 形状不变；
  `--help ⇒ usage, exit 0`；fresh / never-ran 读数不变。
- 方向二：两个文件内的注释即实测读数（含 `parseArgs([...])` 的输入→输出）。
- scoped 门：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-parseargs-local-copies --allow-thin`
  ⇒ exit 0（121 tests / 0 fail，含 gate-script-base 与 gate-staleness-check 两条泳道 + scoped 静态检查）。

⚠️ 复核时顺带发现、**不在本 finding 范围故未动**：`plugin/scripts/gate-staleness-check.ts` 的入口守卫用
URL 相等判定（`path.resolve(argv[1]) === fileURLToPath(import.meta.url)`），经 `/home/yale` 符号链接调用时
恒假 ⇒ main 不跑、静默 exit 0（与 `loadbearing-test-gate.ts` 注释里已记录的 `gap-arch-duplicate-copies-zero`
同形；该文件的修法是已导出的 `isDirectEntry`）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parseargs-local-copies`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790503843524`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/gate-staleness-check.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/loadbearing-test-gate.ts`
- `tasks/gap-routine-semantic-dedup-scan-parseargs-local-copies.md`