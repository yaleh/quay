---
id: gap-routine-semantic-dedup-scan-resolveroot
title: "semantic-dedup-scan: Five byte-identical bodies (path.resolve(rootArg ??
  process.cwd())); all five already import flagValue/helpExit from
  gate-script-base.ts, so a shared home exis"
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
Five byte-identical bodies (path.resolve(rootArg ?? process.cwd())); all five already import flagValue/helpExit from gate-script-base.ts, so a shared home exists. …

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790028867335` · ts `2026-09-21T22:14:27.335Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveRoot`
- 涉及文件：
- `plugin/scripts/concurrency-literal-check.ts:362`
- `plugin/scripts/instrument-failure-check.ts:333`
- `plugin/scripts/landing-target-check.ts:273`
- `plugin/scripts/suite-slot-ssot-check.ts:380`
- `plugin/scripts/task-file-bypass-check.ts:281`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
**结论：已修掉（extract），⛔ 非「已注意到」。**

- **复核**：finding `resolveroot` 记录 `kind: byte-identical-body` / `verdict: real-duplication` /
  `suggestedAction: extract`，五处 body 逐字相同 —— 逐条核对属实。判据取证两半都做：非零侧确认
  「命中的就是我（`resolveRoot` 的 body）」；零侧把同一谓词对着**已知为真**的样本（`git show HEAD:<f>`
  的五份改动前拷贝）干跑，各命中 1 次，故改动后的 0 是测量而非盲谓词。
- **处置**：body 上收到五者**本就已 import** 的 `plugin/scripts/gate-script-base.ts`（新 export
  `resolveRoot`，:147）；五处调用点改为 `resolveRoot(flagValue(args, "--root"))`——token 来源留在调用点，
  符合 `flagValue` 自身声明的契约；只为该私有拷贝而存在的 arity-1 `flagVal` 闭包随之删除。
- **可核读数**（谓词 = 精确行 `^  return path.resolve(rootArg ?? process.cwd());$`）：改动前 **5** 处
  （每个调用者 1 处），改动后 **1** 处（仅 base）。全仓无第二份拷贝、无镜像副本。
- **行为等价**：HEAD vs 改动后，**20** 组 mode/argv（`--help`；各调用者的 `--scan` / `--gate` / `--json`；
  `--root <绝对>`；第三个 cwd 下的 `--root <相对>`；`--root` 缺省=cwd）的 stdout 与退出码**逐字节相同** ——
  相对路径走 `path.resolve` 臂、缺省走 `?? process.cwd()` 臂，两臂都被真实走到；负控制确认该对照本身
  能报出差异（非空转）。
- **回归守卫**：`plugin/test/gate-script-base.test.mjs` 新增 5 条，含机械判据「五调用者私有拷贝数 = 0 ∧
  base = 1 ∧ 各自确已从 base import」（只删不引也会红）。
- **落地**：commit `e005a81b4`（提交信息内附完整处置结论与普查）。
- **5b 同原则普查**（`--root` → 绝对路径）：`pool-quality-judge.ts:481` 行为等价但拼写与 helper 元数不同
  （未被立案，本轮不改 —— 其 arity-2 `flagVal` 收敛是另一件事）；`checker-count-drift-check.ts:191` 与
  `suite-execution-form-counter.ts:373` 的缺省是**仓库根**（`path.resolve(__dirname,"..","..")` /
  `repoRoot()`）而非 cwd，属**另一种行为**；`inner-wakeup-heartbeat.ts:256` /
  `inner-wakeup-heartbeat-check.ts:658` 根本不做 `path.resolve`。缺省为仓库根的三处已另案
  `resolveroot-2`，并在新 export 的注释里显式声明「与本函数不是同一件事」。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `resolveroot`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790028867335`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/concurrency-literal-check.ts`
- `plugin/scripts/instrument-failure-check.ts`
- `plugin/scripts/landing-target-check.ts`
- `plugin/scripts/suite-slot-ssot-check.ts`
- `plugin/scripts/task-file-bypass-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-resolveroot.md`