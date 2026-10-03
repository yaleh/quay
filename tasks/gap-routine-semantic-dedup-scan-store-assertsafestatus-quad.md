---
id: gap-routine-semantic-dedup-scan-store-assertsafestatus-quad
title: "semantic-dedup-scan: Four near-identical bodies differing only in the
  VALID_* status-constant name and the kind word; the shared
  frontmatter-store-base.ts already exists and is imp"
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
Four near-identical bodies differing only in the VALID_* status-constant name and the kind word; the shared frontmatter-store-base.ts already exists and is imported by all four stores but does not factor this validator.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790995446200` · ts `2026-10-03T02:44:06.200Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`assertSafeStatus`
- 涉及文件：
- `packages/quay/src/adr-store.ts:88`
- `packages/quay/src/document-store.ts:76`
- `packages/quay/src/goal-store.ts:1561`
- `packages/quay/src/meta-store.ts:105`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `store-assertSafeStatus-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790995446200`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置：修掉（extract）。** 四个 sibling store 各自持有的 `assertSafeStatus(status)` 函数体逐字相同，只有 kind 词与 `VALID_*` 集合不同。把检查本体提取进四个 store 已经 import 的 `packages/quay/src/frontmatter-store-base.ts`，新增 `makeAssertSafeStatus(kind, validStatuses)` 工厂；每个 store 改为 `const assertSafeStatus = makeAssertSafeStatus("<kind>", VALID_<KIND>_STATUSES);`。schema（哪些 status 合法 + 报错里的 kind 词）仍按 kind 独立，只有 mechanics 共享 —— 与该模块 header 的「shared MECHANICS, SCHEMAS 独立」规则一致。

错误消息逐字保留（kind 词 `ADR` / `document` / `goal` / `meta`），故 `test/adr-store.test.mjs:40-41`、`test/document-store.test.mjs:43-44` 的 `/invalid ... status/` 断言不受影响。

`## Finding` 里列出的 `adr-store.ts:88` 等行号是提取**前**的位置；提取后四个本地定义消失，只剩 base 里唯一一处。

**处置可核（AC2 证据）**

1. 四个 store 里本地定义归零，且**同一谓词对已知为真的样本命中**（硬规则 2 的零计数配套动作）：
   - `grep -c "function assertSafeStatus"` → adr-store 0 / document-store 0 / goal-store 0 / meta-store 0
   - 已知为真对照：同一 `grep -n "function assertSafeStatus" packages/quay/src/frontmatter-store-base.ts` → `58:  return function assertSafeStatus(status) {`（谓词不空转）
2. 共享定义唯一 + 四个绑定调用点：

```
packages/quay/src/frontmatter-store-base.ts:57:export function makeAssertSafeStatus(kind, validStatuses) {
packages/quay/src/frontmatter-store-base.ts:58:  return function assertSafeStatus(status) {
packages/quay/src/adr-store.ts:89:  const assertSafeStatus = makeAssertSafeStatus("ADR", VALID_ADR_STATUSES);
packages/quay/src/document-store.ts:77:  const assertSafeStatus = makeAssertSafeStatus("document", VALID_DOCUMENT_STATUSES);
packages/quay/src/goal-store.ts:1562:  const assertSafeStatus = makeAssertSafeStatus("goal", VALID_GOAL_STATUSES);
packages/quay/src/meta-store.ts:106:  const assertSafeStatus = makeAssertSafeStatus("meta", VALID_META_STATUSES);
```

3. 变异对照（mutation control，证明共享 guard 承重、不是空转）：把 `makeAssertSafeStatus` 的 `if (status !== undefined && !validStatuses.includes(status))` 改成 `if (false)`（cp 备份，不用 `git checkout`），`node --test test/adr-store.test.mjs test/document-store.test.mjs` → 24 tests / 22 pass / **2 fail**（正是两条 `/invalid ... status/` 断言）；随后从 cp 备份逐字还原，`git diff --stat` 为空。
4. 相关 store 单测：`adr-store` / `document-store` / `meta-store` 全绿。`goal-store.test.mjs` 有 8 条既有红灯（I5 `checkAchievedFailing` / AC-242 successor），**未修改的主检出跑同一文件得到逐条相同的 8 条红灯** ⇒ 是 develop 上既有的红，与本改动无关（既有红不在本任务 Touches 内）。
5. scoped 门：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-store-assertsafestatus-quad --allow-thin` → `ℹ tests 168 / pass 168 / fail 0`（merge develop 后跑）。scoped-gate cache 已写（developSha `fcd753dd0725113a487a3e211c1cd952596ff323`）。

**硬规则 5b（同一载体里的其它适用点）**：`grep -rn "function assertSafeId"` 在四个 store 里亦有 4 处（adr:82 / document:70 / goal:1553 / meta:99），同样近似。**本次不动**：goal 变体结构上不同（`GOAL_ID_RE.test(id) || AC_ID_RE.test(id)`，双正则 OR，报错语法为 "GOAL-NNN or AC-NNN"），不是同一 clone 家族；其余三处是另一个候选 finding，不在本 finding 点名的 `assertSafeStatus` 符号内。

**Touches 增补（anti-drift 修复）**：首轮 fan-in 的 `anti-drift-touches-check` 报 1 violation ——
`out-of-declared: task wrote packages/quay/src/frontmatter-store-base.ts (matches no declared Touches glob)`。
该文件正是本 finding 点名的提取落点（`Requested action: extract` 的目标载体），属「声明过窄」而非越界写；
按检查器自身 header 的指引补进 `## Touches`，未回退任何合法改动。

## Touches
- `packages/quay/src/frontmatter-store-base.ts`
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/meta-store.ts`
- `tasks/gap-routine-semantic-dedup-scan-store-assertsafestatus-quad.md`