---
id: gap-routine-semantic-dedup-scan-parse-touch-paths
title: "semantic-dedup-scan: The 8-step bullet→path pipeline is copied verbatim
  and only the annotation half is single-sourced; parseTouchPaths has one caller
  and is not covered by touches"
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
The 8-step bullet→path pipeline is copied verbatim and only the annotation half is single-sourced; parseTouchPaths has one caller and is not covered by touches-parser-parity.test.mjs, so the mirror is pinned only by prose comments.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792940684375` · ts `2026-10-25T15:04:44.375Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseTouchPaths`、`parseTouchEntries`、`stripTouchAnnotation`
- 涉及文件：
- `packages/quay/src/observation/blocking.ts:78`
- `plugin/scripts/touches-parser.ts:61`
- `packages/quay/src/kernel/touches-annotation.ts:1`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:04:44.375Z

## Disposition（复核 + 处置，2026-10-25）

**复核（finding 是真的，且与盘上代码一致）**：`.quay/routine-findings.jsonl` 里 findingId
`parse-touch-paths`（同样 runId）的记录为 `verdict:"real-duplication"` / `suggestedAction:"extract"`；
修复前 `packages/quay/src/observation/blocking.ts` 的 `parseTouchPaths` 与
`plugin/scripts/touches-parser.ts` 的 `parseTouchEntries` 是逐字相同的八步管线，两者之间没有 import 边
（只有注释声称「mirrors」）。

**处置 = 修掉（extract），commit `c0ea8074c`**：

- 单一定义移入 kernel 叶 `packages/quay/src/kernel/touches-annotation.ts`：`stripTouchQuotes`（引号/反引号剥离）、
  `normalizeTouchEntry`（标记之后的五步 = 引号 → 注解 → 掩蔽反引号 → `./` → trim）、
  `parseTouchBulletPaths`（整条八步管线）。
- 两层改为 **re-export 同一个函数对象**：`parseTouchEntries`（plugin 唯一解析器）与 `parseTouchPaths`
  （Core display 面）。判据是 **identity（`===`）而非 behavior**：一个逐字重写的本地副本会被
  `packages/quay/test/kernel-pure-judges.test.mjs` 的 ② 断言判红（硬规则 4 推论三）。
- **5b（同一载体里的兄弟副本，一并修）**：`plugin/scripts/touches-parser.ts` 的
  `parseTouchEntriesWithTags` 原先内联同五步 + 引号剥离，现调用 kernel 的 `stripTouchQuotes` /
  `normalizeTouchEntry`；它文档里「path extraction is byte-identical to parseTouchEntries」由散文变成结构。
- **覆盖（finding 的后半句）**：`plugin/test/touches-parser-parity.test.mjs` 的 `PARSERS` 现在包含 Core 的
  `parseTouchPaths`；`packages/quay/test/kernel-pure-judges.test.mjs` 增加 ①单一定义 ②同一对象 ③行为 +
  负对照（无 bullet 的正文 / 空串 ⇒ `[]`，而不是「返回所有行」）。

**读数（可复跑）**：

- `grep -rn 'replace(/^[-*]\s+/' --include=*.ts packages/quay/src plugin/scripts scripts`
  ⇒ `pipeline_defs=1`（kernel/touches-annotation.ts:153；修复前 = 2）
- `grep -rn '[`"' --include=*.ts plugin/scripts packages/quay/src scripts`
  ⇒ `quote_strip_sites=2`：kernel:128（唯一实现）+ `touches-one-entry-one-path-check.ts:66`
  （**判定期**归一化，去掉【所有】注解，与解析器的尾部注解契约语义不同 ⇒ 保持不动，理由进 commit）
- `node --no-warnings --experimental-strip-types --test packages/quay/test/kernel-pure-judges.test.mjs plugin/test/touches-parser-parity.test.mjs`
  ⇒ 30 pass / 0 fail
- `for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done` ⇒ exit 0

**未处置，如实记录（不声称已修）**：Core 的 `extractTouchesSection` 仍是 plugin 版的本地简化
（first-match vs exact-heading-wins + level tie-break）。当前 task store 里没有一个 body 能让两者给出不同结果
（差异只在「早 `### Touches` 子标题」形态上显现），而改它会改变 display 的行集合 ⇒ 需要独立的前后对照证据；
它不在本 finding 的符号集合内。

**ADR-007 暗轴记录**：

- L_G：该轴仍暗,理由:本任务 worktree 无 archguard 索引——`archguard_detect_duplicates(projectRoot=<worktree>)` 返回「No query data and no src/ directory found … Run `archguard analyze` first」，按硬规则 3b 这是「读不出」而非「0 组」，故不记数值；重复面读数改用上面可复跑的 grep 计数（pipeline_defs 2→1）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-touch-paths`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792940684375`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/observation/blocking.ts`
- `plugin/scripts/touches-parser.ts`
- `packages/quay/src/kernel/touches-annotation.ts`
- `packages/quay/test/kernel-pure-judges.test.mjs`
- `plugin/test/touches-parser-parity.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-touch-paths.md`
