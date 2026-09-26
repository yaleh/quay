---
id: gap-routine-semantic-dedup-scan-resolve-carrier-root-three-byte-identical-silent
title: "semantic-dedup-scan: three digest-identical copies with the same name,
  one already exported so the others could import it today, and the consumer
  fails closed only for an ABSENT ca"
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
three digest-identical copies with the same name, one already exported so the others could import it today, and the consumer fails closed only for an ABSENT carrier so a wrong-but-existing root yields an empty baseline silently

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveCarrierRoot`
- 涉及文件：
- `plugin/scripts/perfile-failure-rate.ts:154`
- `plugin/scripts/psi-failure-correlation-check.ts:214`
- `plugin/scripts/psi-window-join.ts:141`
- kind：`byte-identical-body`
- verdict：`real-duplication`
- 复发史：同一符号此前已被本探针立案 5 次（runId `…1789499338327` / `…1789723686226` / `…1790028867335` / `…1790118332027` / `…1790306065833`），前 5 次均被 rate 闸挡下、从未落成任务 —— 本任务是第一次走到处置。

## Requested action
merge - both other sites import the exported resolveCarrierRoot

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `resolve-carrier-root-three-byte-identical-silent-zero`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/perfile-failure-rate.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/test/perfile-failure-rate.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-resolve-carrier-root-three-byte-identical-silent.md`

## Evidence

### AC1 — 复核（finding 的两半分开验，不整段照抄）

**前半（重复）成立，已修掉。** 三处 `resolveCarrierRoot` 是同一 4 行约定
（`--root` → `QUAY_MAIN_CHECKOUT` → `repoRoot()`）：`perfile-failure-rate.ts` 的**导出版**，加上
`psi-failure-correlation-check.ts` / `psi-window-join.ts` 的私有副本。处置 = finding 请求的 merge：
两份私有副本删除，两个 psi 站点改为 `import { resolveCarrierRoot } from "./perfile-failure-rate.ts"`。
- 改名不改义：被删副本的签名是 `argRoot: string`，共享版是 `argRoot?: string` —— 全部调用点传
  `args.root`（缺 flag 时为 `""`），而 `""` 在函数体里为假 ⇒ 落到下一级回落，行为不变（有单测钉住）。
- 不是假说式理由：`psi-window-join.ts` 自己的头注释原文写着「the SAME resolution convention as
  psi-failure-correlation-check.ts（AC2: 不新造一套解析规则）」—— 即**故意照抄**，这正是「一份规则
  三个家」的形态；抄写期的漂移也真实发生过一次（`psi-failure-correlation-check.ts` 头注释称末级回落
  是 `cwd`，而三份函数体写的是 `repoRoot()`），一并订正。

**后半（rationale 的静默空基线）实测不成立**，两条反证（实测，非推理）：
- 「错的但存在的 root」：carrier 本就是 root **之下**的路径（`<root>/.quay/verification-round.jsonl`），
  root 错 ⇒ carrier 同样缺失 ⇒ 与「carrier 缺失」走**同一条** fail-closed 路。`--file` 模式同样
  `exit 2` + stderr `载体未找到`，不打出任何 classification —— 不是「静默的空基线」。
- 「carrier 在场、但查不到该 file 的记录」：输出 `insufficient`（`classifyFailure` 里 `runs < MIN_RUNS`
  在 `fails === 0` **之前**判定），是与 `new-event` **不同的取值**（硬规则 3b），不是静默的「从没失败过」。
- **一处诚实的残留**（写明，不当作已解决）：`--root` 若指向**另一个自带合法 carrier** 的 checkout，
  脚本无从分辨 —— 但 `--root` 是调用方的断言，且 summary 模式第一行恒打印 `carrier: <解析出的绝对路径>`，
  解析结果始终可见，故不作阻塞、不改行为（改行为会动 fan-in 的 FIX_SCOPE_GATE 消费者）。

### AC2 — 处置可核：每条结论都有一个**能取假**的检查

- **ratchet**（`plugin/test/perfile-failure-rate.test.mjs`，与 `gate-script-base.test.mjs` 里
  `readJsonLines` / `resolveRoot` 的三段式同形）：① `plugin/scripts` 下 `resolveCarrierRoot` 定义**恰好一处**；
  ② 两个 psi 站点**不得内联**那 3 行函数体**且**必须 import 共享版（两半都要，否则「删了但没 import」也过）；
  ③ 负控制：删掉导出后消费者 import 必须**链接失败**，导出恢复后必须链接成功。
- **双向变异已实跑**（证明不是恒真判据）：把私有副本重新内联回 `psi-window-join.ts` ⇒ ①② 转红；
  反转 `readCarrierPerFile` 的 `found` 取值、并反转 `classifyFailure` 的判定顺序 ⇒ 两条 rationale 测试转红；
  还原后 16/16 绿。
- **行为逐条实跑**：
  - `perfile-failure-rate.ts --root <错但存在的目录> --file <f>` ⇒ `exit 2` + `载体未找到`；
  - `perfile-failure-rate.ts --root <空 carrier> --file <f> --json` ⇒ `classification: "insufficient"`；
  - `psi-window-join.ts` 经 `QUAY_MAIN_CHECKOUT` 回落解析到 `<root>/.quay/verification-round.jsonl`（import 生效）；
  - `psi-failure-correlation-check.ts --source passive --root <无 carrier>` ⇒ `carrierFound:false` + `exit 2`。

### 产物

- 提交 `9e27a5c92`（task 分支 `task/gap-routine-semantic-dedup-scan-resolve-carrier-root-three-byte-identical-silent`）。
- `plugin/scripts/import-graph-check.ts` 复跑：`valueSccs=0 / typeSccs=0 / reverseEdges=0`，与 baseline 一致（未新增环）。
- DoD2：修复由派发链（worker）执行；例程探针只读 `plugin/scripts` 立案，未代跑任何产出者。