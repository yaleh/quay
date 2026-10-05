---
id: gap-routine-semantic-dedup-scan-assert-safe-id-quad
title: "semantic-dedup-scan: frontmatter-store-base.ts already abstracts
  makeAssertSafeStatus for the four stores, but assertSafeId was left as four
  near-identical locals (differing only i"
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
frontmatter-store-base.ts already abstracts makeAssertSafeStatus for the four stores, but assertSafeId was left as four near-identical locals (differing only in regex + kind word); native store's same-named function is a coincidental path-traversal-guarded variant.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791238550062` · ts `2026-10-05T22:15:50.062Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`assertSafeId`
- 涉及文件：
- `packages/quay/src/adr-store.ts:82`
- `packages/quay/src/document-store.ts:70`
- `packages/quay/src/meta-store.ts:99`
- `packages/quay/src/goal-store.ts:1741`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract makeAssertSafeId(kind, re) into frontmatter-store-base.ts mirroring makeAssertSafeStatus; do not merge native store

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `assert-safe-id-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791238550062`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

### AC1 —— finding 逐字复核（先取来源，再判）

来源记录（`.quay/routine-findings.jsonl:1814`，逐字）：

```
{"ts":"2026-10-05T22:15:50.062Z","kind":"finding","routine":"semantic-dedup-scan", … "findingId":"assert-safe-id-quad",
 "dupKind":"same-symbol-multi-file","symbols":["assertSafeId"],
 "files":["packages/quay/src/adr-store.ts:82","packages/quay/src/document-store.ts:70","packages/quay/src/meta-store.ts:99","packages/quay/src/goal-store.ts:1741"],
 "verdict":"divergent-implementation", …}
```

复核（动手前，在 worktree 的 `develop` 基线上逐点核对，不是转述）：四个坐标**命中且确为**同形局部函数 ——
`adr-store.ts:82` / `document-store.ts:70` / `meta-store.ts:99` / `goal-store.ts:1741` 各有一个
`function assertSafeId(id)`，函数体逐字同构，只有三处 per-kind 输入不同：

| store | kind 词 | id 形状 | 错误尾巴 |
|---|---|---|---|
| adr | `ADR` | `/^ADR-\d{3,}$/` | `ADR-NNN (>=3 digits)` |
| document | `document` | `/^DOC-\d{3,}$/` | `DOC-NNN (>=3 digits)` |
| meta | `meta` | `/^META-\d{3,}$/` | `META-NNN (>=3 digits)` |
| goal | `goal` | `/^GOAL-\d{3,}$/` ∨ `/^AC-\d{3,}$/` | `GOAL-NNN or AC-NNN (>=3 digits)` |

⇒ 与 finding 的 `divergent-implementation` 判词一致（不是 `identical`：goal 的 disjunction 与四处 kind 词确为差异）。

### AC2 —— 处置：**修掉**（不是「已注意到」）

新增共享机件 `packages/quay/src/frontmatter-store-base.ts:83` `makeAssertSafeId(kind, idRe, expected)`，
紧接在既有 `makeAssertSafeStatus` 之后（同一抽象手法）：`idRe` 收单个 RegExp 或数组（goal 的
`GOAL ∨ AC` 用数组表达），`expected` 逐字进错误消息 ⇒ **四处错误文本字节不变**（各 store 的既有测试按它匹配）。

四处局部函数就地替换为一行调用（`grep -rn "function assertSafeId" packages/quay/src/` 现**只有 1 处命中**，
即 frontmatter-store-base 内的工厂本身；四个 store 的局部定义**归零**）：

```
packages/quay/src/adr-store.ts:83        const assertSafeId = makeAssertSafeId("ADR", ADR_ID_RE, "ADR-NNN (>=3 digits)");
packages/quay/src/document-store.ts:71   const assertSafeId = makeAssertSafeId("document", DOCUMENT_ID_RE, "DOC-NNN (>=3 digits)");
packages/quay/src/meta-store.ts:100      const assertSafeId = makeAssertSafeId("meta", META_ID_RE, "META-NNN (>=3 digits)");
packages/quay/src/goal-store.ts:1742     const assertSafeId = makeAssertSafeId("goal", [GOAL_ID_RE, AC_ID_RE], "GOAL-NNN or AC-NNN (>=3 digits)");
```

⛔ **native store 未并入**（finding 明确要求）：`packages/quay-native/src/store.ts:438` 的 `assertSafeId`
仍是它自己的局部实现（路径穿越守卫变体），本任务未触碰。

**实跑证据**（`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`，理由是 suite 内的既知 env 污染，见下）：

```
$ node --test packages/quay/test/frontmatter-store-base.test.mjs \
              packages/quay/test/adr-store.test.mjs packages/quay/test/document-store.test.mjs \
              packages/quay/test/meta-store.test.mjs packages/quay/test/goal-store.test.mjs
ℹ tests 145
ℹ pass 145
ℹ fail 0
```

`npx tsc --noEmit -p packages/quay` ⇒ EXIT=0。

新增 5 条针对共享 helper 的单测（`frontmatter-store-base.test.mjs`）：单形状 / 多形状 disjunction /
错形状·错 kind·位数不足·路径穿越串（`../../etc/x`）被拒并给出 kind + 形状文本 / 非字符串
（`null`/`undefined`/`42`/`{}`）同样被拒 / 四种 kind 词在消息里互不串味。

### DoD2 —— 执行者归因

本条由**派发链**（worker `gap-routine-semantic-dedup-scan-assert-safe-id-quad`，worktree
`/data/home/yale/work/quay-worktrees/gap-routine-semantic-dedup-scan-assert-safe-id-quad`，
分支 `task/gap-routine-semantic-dedup-scan-assert-safe-id-quad`）执行；例程只在 `.quay/routine-findings.jsonl`
立案，未执行任何修复。

### 本次未改动 Touches 之外任何文件

分支 delta（相对 develop）恰为下列 7 条 Touches；`packages/quay-native/**` 与其余 store 均不在其中。

## Touches
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/meta-store.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/frontmatter-store-base.ts`
- `packages/quay/test/frontmatter-store-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-assert-safe-id-quad.md`
