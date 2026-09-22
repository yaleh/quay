---
id: gap-routine-semantic-dedup-scan-readjsonlines-seven-defs-three-behaviors
title: "semantic-dedup-scan: 7 private definitions, none imported, no canonical
  jsonl reader in gate-script-base.ts/checker-lib.ts/kernel; they collapse to 3
  runtime behaviors differing on"
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
7 private definitions, none imported, no canonical jsonl reader in gate-script-base.ts/checker-lib.ts/kernel; they collapse to 3 runtime behaviors differing on split(/\r?\n/) vs split("\n") and on the non-object guard, so a CRLF ledger yields different rows per caller and psi-failure-correlation-check.ts:96 already imports windowMeanStall from psi-window-join.ts (a live half-finished extraction).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readJsonLines`
- 涉及文件：
- `plugin/scripts/obligation-ledger.ts:109`
- `plugin/scripts/obligation-ledger-check.ts:48`
- `plugin/scripts/psi-failure-correlation-check.ts:310`
- `plugin/scripts/psi-window-join.ts:53`
- `plugin/scripts/freshness-producer-coverage-check.ts:235`
- `plugin/scripts/ready-pool-check.ts:1596`
- `plugin/scripts/trend-check.ts:100`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `readjsonlines-seven-defs-three-behaviors`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Resolution

**处置 = 修掉（extract）**，不是「已注意到」。

**① 复核（先复核载体，再动手）**：finding 记录逐字核对 — `.quay/routine-findings.jsonl` 中
`kind:"finding"` 记录 `findingId=readjsonlines-seven-defs-three-behaviors`、`runId=semantic-dedup-scan-1790118332027`、
`verdict=real-duplication`、`suggestedAction=extract`，其 `files[]` 七条与本任务 Finding 区逐条一致（含行号）。
七份私有定义全部读过：确实收敛为 **3 种运行时行为**，差异恰在 **2 条轴**上 —
轴1 行切分 `split("\n")`(5) vs `split(/\r?\n/)`(2)；轴2 非对象守卫 无(4) | `v && typeof v === "object"`(2，**真值判断，故数组也算对象**) | 严格非数组对象(1)。

**② 一条被复核推翻的 finding 断言（硬规则 4 推论四：能解释 ≠ 被检验）**：
finding 正文说「**a CRLF ledger yields different rows per caller**」。**实测不成立** — `JSON.parse` 把行尾 `\r`
当 JSON 空白（grammar 的 ws 含 CR），空行判定又是 `.trim()` 基的 ⇒ 两种切分**行集完全相同**。
已作为 CONTROL 用例钉进测试（对 6 个 CRLF 输入逐一对拍两种切分），并在 `gate-script-base.ts` 的注释里写明
选 `/\r?\n/` 是因为**严格更宽且零代价**，⛔ 不是因为它在修一个已发生的行集分叉。
**真正可复现的分叉只有轴2**：`null`/`42`/`"x"`/`[1,2]` 在 6 份宽松副本里是**行**、在第 7 份里被丢。

**③ 落地（extract）**：
- 唯一实现落在 `plugin/scripts/gate-script-base.ts`（finding 点名的三个候选家之一；已有 `fs`/`path`，且 `readFileSafe` 这座「读不到 ⇒ 空」原语已在其中）。
- 7 处私有副本删除，全部改为 import。`ready-pool-check.ts` / `trend-check.ts` **保留符号名但改为 re-export**（⛔ 不是第二份定义）——`plugin/test/helpers/ready-pool-check-harness.mjs` 按名 blanket-import 它，删名会让该 harness 链接失败。
- 语义明文固化：缺文件 ⇒ `[]`（fail-open，**刻意**）；空行/坏行跳过；**顶层非对象行跳过**（轴2 取最严的一支，因为它与七份声明了 `Record<string, unknown>[]` 的返回类型一致，而每处消费方都在行上取字段 —— `null` 行是 TypeError 不是数据）。**对照**：五处载体写入方全部 `JSON.stringify(对象)`，故该守卫对真实载体惰性，只丢损坏输入。
- **fail-open 的 3b 边界写进注释**：要区分「载体缺席（NOT-EVALUATED）」与「载体为空（PASS）」的调用方必须自己 `existsSync` —— `freshness-producer-coverage-check.ts` 正是如此，且原副本「无 try/catch」的抛错路径在该调用点**结构性不可达**（上游已 existsSync 拦截），故统一后其行为不变。

**④ 产物（使「修掉」可核，不是靠自觉）**：`plugin/test/gate-script-base.test.mjs` 新增 8 例
（本文件由 scoped 门的 basename 配对经 `Touches` 的 `gate-script-base.ts` 选中）：
单定义 ratchet · 七处无副本且必须 import 的负控制 · 「删共享导出 ⇒ 消费者链接失败」的机制反证 · 语义四例 · 两条 CONTROL（轴2 分叉 / 轴1 不分叉）。
**红控制已实测**：往 `psi-window-join.ts` 注入一份私有副本后 ratchet 报红 2 例（`found: gate-script-base.ts, psi-window-join.ts`），回滚后复绿 —— 即该判定**能取假**，非恒绿。

**⑤ 硬规则 5b（修一处 ≠ 只此一处）——同轮同族候选已枚举**：同一 runId 的 filing-round 记录里
52 个候选中 **35 个仅因 rate 闸（3/窗口）未立案，⛔ 非因 quality/dedup 判假**。与本 finding 同族的三个已逐个读过：
- `readjsonllines-load-bearing-unparseable-sentinel`（**不同符号** `readJsonlLines`，2 份）——**刻意分叉且承重**：缺文件返回 `null`（非 `[]`）、坏行推入 `{__unparseable:true}` 哨兵，4 处调用点消费它。该 finding **自己的 rationale 就写明**：折进「丢坏行」的读法会让 unparseable 恒假、**静默放过两个检查器**（硬规则 3b）。⇒ **已核实未被我改动**（两文件均不在本任务 diff 内），且已加 **BOUNDARY 用例**看守：将来若有 dedup 轮把这对折进来，会在此报红而不是悄悄解除两个检查器的武装。
- `ratchet-baseline-reader-seven-copies`（`readBaseline`/`readRatchet` 家族，7 份字节相同）与
  `readfile-empty-ignores-readfilesafe`（绕过**已存在**的 `readFileSafe`，2 份）—— **不同家族，本任务不改**（不在 Touches，属独立 finding）。按 rate 闸机制它们会由后续窗口重新候选；此处只记「已枚举、未处置」。

**⑥ 旁证（⛔ 不作为本任务判据，仅记录现场读数）**：
- `mirror-pair-drift-check` 报 `0 pairs`，我按硬规则 4 推论二核过**它是真零不是坏仪器**：`experiments/.../scripts/` 116 项 = 57 常规文件（实验层独有）+ 59 符号链接（同 inode，按设计不可漂移）⇒ 无同基名「两侧都是常规文件」的配对。`experiments/.../scripts/gate-script-base.ts` 是**符号链接**，本改动经同一 inode 自动同步（md5 两侧相同已验）。该 checker 的头注释仍写「40 are REAL-FILE copies」，与今日实测不符（陈旧散文，非本任务范围）。
- `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` 是**另一份更旧的独立测试文件**（458 行，自带 `Run: node --test experiments/...` 头），与本任务改的 `plugin/test/` 那份**在我改动之前就已不同**（HEAD~2 两 md5 即已相异），且无任何 checker 覆盖 test 目录镜像 ⇒ 非本任务引入、非本任务范围。

## Touches
- `plugin/scripts/obligation-ledger.ts`
- `plugin/scripts/obligation-ledger-check.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/trend-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-readjsonlines-seven-defs-three-behaviors.md`