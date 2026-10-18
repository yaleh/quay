---
id: gap-routine-semantic-dedup-scan-maskfor-dispatcher-duplicate
title: "semantic-dedup-scan: Both are the identical three-line sh/ts
  comment-mask dispatcher, and deletion-closure-check already imports both masks
  from identity-replication-check, leaving"
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
Both are the identical three-line sh/ts comment-mask dispatcher, and deletion-closure-check already imports both masks from identity-replication-check, leaving only the dispatcher duplicated.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792287725786` · ts `2026-10-18T01:42:05.786Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`maskFor`
- 涉及文件：
- `plugin/scripts/deletion-closure-check.ts:84`
- `plugin/scripts/identity-replication-check.ts:193`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `maskfor-dispatcher-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792287725786`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
处置 = 修掉（extract to single source）：

- `plugin/scripts/identity-replication-check.ts` 导出 `maskFor`（本模块即 `tsCommentMask` / `shCommentMask` 的拥有者，deletion-closure-check 本就从此处 import 两个 mask）。
- `plugin/scripts/deletion-closure-check.ts` 删除本地三行副本，改为 `import { maskFor } from "./identity-replication-check.ts"`。
- 机械复核：对 `plugin/scripts/*.{ts,mjs,js}` 全部函数体做「去注释+空白归一化」后按 body digest 计数，`maskFor` 的函数体在归一化后**只出现 1 次**（identity-replication-check.ts），修复前为 2 次。
- 回归：`node --no-warnings --experimental-strip-types --test plugin/test/identity-replication-check.test.mjs plugin/test/deletion-closure-check.test.mjs` → 40 pass / 0 fail；两个 CLI 的 `--help` 冒烟通过（import 解析正常）。

## Touches
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-maskfor-dispatcher-duplicate.md`

## Blocker

**2026-10-18T01:50:53.863Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/4，剩余未勾 4）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：67594614-53a0-48f4-a5d2-76eeca360eb7
