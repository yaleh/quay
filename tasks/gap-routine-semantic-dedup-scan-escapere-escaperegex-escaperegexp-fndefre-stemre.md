---
id: gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre
title: 'semantic-dedup-scan: All 12 bodies byte-identical
  (`s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`) under THREE names (escapeRe x3,
  escapeRegex x2, escapeRegExp x7); store.ts:116 docume'
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
All 12 bodies byte-identical (`s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`) under THREE names (escapeRe x3, escapeRegex x2, escapeRegExp x7); store.ts:116 documents itself as 'Mirrors ready-pool-check.ts's own escapeRegExp (same byte semantics  …

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790028867335` · ts `2026-09-21T22:14:27.335Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`escapeRe`、`escapeRegex`、`escapeRegExp`、`fnDefRe`、`stemRe`
- 涉及文件：
- `plugin/scripts/agent-panel-classify.ts:69`
- `plugin/scripts/deletion-closure-check.ts:66`
- `plugin/scripts/enum-surface-parity-check.ts:514`
- `plugin/scripts/identity-replication-check.ts:167`
- `plugin/scripts/manager-observation-runtime-check.ts:161`
- `plugin/scripts/prod-data-audit.ts:98`
- `plugin/scripts/ready-pool-check.ts:714`
- `plugin/scripts/repo-root-derivation-check.ts:64`
- `plugin/scripts/rhythm-consumer-check.ts:327`
- `plugin/scripts/task-ops.ts:76`
- `plugin/scripts/worker-driver.ts:635`
- `packages/quay-native/src/store.ts:116`
- `plugin/scripts/checker-count-drift-check.ts:70`
- `plugin/scripts/deletion-closure-check.ts:77`
- `plugin/scripts/deletion-closure-check.ts:68`
- `plugin/scripts/identity-replication-check.ts:169`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition

**复核结论：finding 属实，且逐字核对后与 finding 报的完全一致——12 处逐字节相同（escapeRe 3 + escapeRegex 2 + escapeRegExp 7 = 12），既没有夸大也没有漏报。** 逐字节比对用的是 fixed-string grep（`grep -F`），不是正则解释。

**处置 = 修掉（extract）**，不是「已注意到」，也不是「已有机制在管」。

- 实现落 **`packages/quay/src/kernel/regex-escape.ts`**（kernel 叶：零 import，故不参与任何 value/type 环，也满足 import-graph-check 的 kernel 边界第四规则）。
- plugin 侧入口 **`plugin/scripts/regex-escape.ts`** —— 纯 re-export，形态逐字照 `plugin/scripts/shape-sections.ts` / `write-json-atomic.ts`。
- 11 个 `plugin/scripts/*.ts` 检查器 + `packages/quay-native/src/store.ts` 改为 import 这一份（各自沿用原有本地名：`escapeRe`/`escapeRegex`/`escapeRegExp`，故调用点零改动；两处对外 export 的面用 `export { … }` 保住，签名不变）。
- **计数（本次最直接的一条）**：生产树里该 body 的副本 **12 → 1**。

**为什么落 kernel，而不是 `plugin/scripts/checker-lib.ts`（另一个「共享原语」库）**：`store.ts` 是产品层、kernel 是产品层的叶，方法学层可以 import 产品层，反过来不行——`packages/**` → `plugin/**` 是 import-graph-check 的 `reverseEdges` 棘轮（基线 0）明令的逆向边。kernel 是**两层唯一共同可达**的落点；同一个理由（`gap-shape-section-tables-dual-copy-no-single-source`）已经把这族判断搬过一次。

**这条 finding 的真正代价，是两处「同一判断的两份」只靠注释维持一致**：`store.ts` 原文写 *"Mirrors ready-pool-check.ts's own escapeRegExp (same byte semantics — the single-judge contract)"*，`ready-pool-check.ts` 侧也各自写着同一句话。**注释不会变红，判据会。** 现在两侧 import 的是同一个函数对象（新测试判据②直接断言 `===`）。

### 行为等价的取证（改动前后对拍）

受影响的检查器 CLI 各跑一次，stdout + stderr + exit code 全量 diff；「前」= 主检出（与本 worktree 同一 fork 点 `bf76ac6a7`）：

- `deletion-closure-check --check` / `enum-surface-parity-check --check` / `manager-observation-runtime-check --check`：**逐字节相同**。
- `repo-root-derivation-check --check`：判定相同（PASS），扫面计数 354 → 355 —— 新增的 `plugin/scripts/regex-escape.ts` 进了它**自己的**扫描面（同 fs-walk 一族已记录过的现象，非语义变化）。
- `identity-replication-check --check`：判定与退出码相同；`ready-pool-check.ts code=59→60 full=79→82`、`worker-driver.ts code=46→47 full=89→90` —— 本次改动在这两个文件里新增了一行 import（+ 注释），进了它的计数面。
- `rhythm-consumer-check --check`：退出码相同（0）；判据1 judged 227 → 228（新机制进了判定集，且**已接线**——有 13 个调用点，故不是「有声明无调用」）。

迁移测试：本次改动覆盖的 10 个测试文件 **125/125 绿**；`packages/quay-native/test/*.test.mjs` + `packages/quay/test/live-a-longform-headings.test.mjs` **103/103 绿**。

### 新增判据 + 红控制

`packages/quay/test/kernel-regex-escape.test.mjs`（5 条）：
- ① 生产树里该 body 只允许存在 1 处，且 12 个 former copies **不得再现**（点名清单，回退即红）；
- ② plugin 入口与 kernel 叶必须是**同一个函数对象**（复制出来的会是不同对象）；
- ③ 14 个元字符逐个转义、纯 section 名零改动、`AC (draft)` 正例 + **未转义的负控制**（否则正例是空转）。

**红控制（这条最要紧）**：把一个**逐字节相同**的副本临时注回 `task-ops.ts` ⇒ 判定①**实测变红并点名 `plugin/scripts/task-ops.ts`**；撤掉即绿。
⚠️ 诚实记录一次**无效的红控制**：第一次用 bash `printf` 注入时**没有变红**——`printf` 吞掉了一层反斜杠，注入的根本不是逐字节副本。该次红控制无效，已改为「从 kernel 文件本身取 body 行」的方式重做。判据的红控制本身也会取不到假，这一次是实例。

### 门

`capability-catalog.sh --entry-surface` rc=0（新 plugin 入口的五表已登记；**无 CONSUMER 行**——cadence 是 `每里程碑` 而非「按需」，故不适用判据2）；`rhythm-consumer-check --check` rc=0；`quay-init-closure-ratchet --gate` PASS（footprint 未增长：3 files / 1022 bytes，只是 laydown 源文件内容变了导致指纹过期 ⇒ 机械重锚，⛔ 不是放宽棘轮）。

### 5b 划界（同一原则的其它适用点，全部列出）

按该 body 全仓扫，除 kernel 外还有命中，**逐条给处置**：

- **2 处语义等价但逐字节不同**（char-by-char `Set` 循环）：`plugin/scripts/select-static-checks-for-touches.ts:192`、`plugin/scripts/precommit-guard.ts:199`。它们在 finding 的 `byte-identical-body` 判定**之外**（不同 body），也不在本任务 Touches 内。`select-static-checks` 那处注释自称理由是「TS type-stripper 在本文件里会 mis-parse 该字面量」——本机 Node v24.19.0 实测该字面量在独立模块里能正常 strip（kernel 叶本身就是活证），**该理由至少对字面量本身已不成立**。⛔ **本次不动它们**：把这两处收进来会同时扩大 `precommit-guard`（用户提交守卫）与 `driver-cli` 两个**手工维护**的依赖闭包面，收益（去重 2 行）与代价不成比例 ⇒ 留作下一次语义扫描的候选，理由写在这里而不是沉默地跳过。
- **2 处测试夹具内联**（`plugin/test/l1-delivery-surface-check.test.mjs`、`plugin/test/gate-staleness-check.test.mjs`）与 **1 处归档副本**（`archive/2026-09-07-zero-call-scripts/…`）—— 两者都在探针的扫描面之外（`test`/`archive` 段被排除），不属于本条的对象。

### 本条不声称什么

⛔ 本条**没有**消除全仓所有「转义正则元字符」的写法（见上 5b）。只把 finding 点名的 **12 处逐字节副本收敛为 1 处**，并把「store.ts 与 ready-pool-check.ts 是同一判断」从注释变成结构。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `escapere-escaperegex-escaperegexp-fndefre-stemre-escaperegex`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790028867335`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/agent-panel-classify.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/enum-surface-parity-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/manager-observation-runtime-check.ts`
- `plugin/scripts/prod-data-audit.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/repo-root-derivation-check.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/task-ops.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/regex-escape.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay/src/kernel/regex-escape.ts`
- `packages/quay/test/kernel-regex-escape.test.mjs`
- `plugin/scripts/checker-count-drift-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/scripts/quay-init.sh`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.md`
