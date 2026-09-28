---
id: gap-routine-semantic-dedup-scan-p015
title: "semantic-dedup-scan: Byte-identical 4-line helper (writeHead
  application/json then end(JSON.stringify)) in the same package and same
  HTTP-handler idiom."
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
Byte-identical 4-line helper (writeHead application/json then end(JSON.stringify)) in the same package and same HTTP-handler idiom.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`writeJson`
- 涉及文件：
- `packages/quay/src/serve-git.ts:1073`
- `packages/quay/src/serve-sessions.ts:690`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract (one shared http-json util next to the serve-* modules)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `p015`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790592211995`）所描述的问题被复核并处置 —— 复核：该 runId 的记录逐字命中（`findingId:"p015"`、`symbols:["writeJson"]`、`files:["packages/quay/src/serve-git.ts:1073","packages/quay/src/serve-sessions.ts:690"]`、`verdict:"real-duplication"`、`suggestedAction:"extract …"`），且描述属实——两处函数体各自 4 行、`diff` 无输出、`sha256` 同为 `86a6e7621e716e40`。处置=**修掉（extract）**：新增 `packages/quay/src/serve-http-json.ts` 持唯一实现，`serve-git.ts` / `serve-sessions.ts` 删私有副本改 import（提交 `93fe2ec58`）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论=修掉，两条证据且可复跑：①**判据可取假**（硬规则 2：非零查命中、零查谓词对真样本）——谓词 `^function writeJson` 对这两文件在 `develop` 上命中 **2** 条、修复后命中 **0** 条（负控制证明它不是恒零读数）；②**行为保持**——`npx tsc --noEmit` 四个包全绿（`TYPECHECK_EXIT=0`），`serve-sessions-body-i18n` + `serve-git-history-body-i18n` + `serve-sessions-zh-chrome` 共 **31/31** 通过，且这三者 `JSON.parse` 的正是 `/git-history.json`、`/sessions/new`、`/sessions/resume`、`/sessions/driver`、`/session/<id>/earlier` 的响应体——即 `writeJson` 全部 7 个调用点。**5b 同载体扫描**（同包 `application/json` 写法）：全仓 `packages/quay/src/*.ts` 共 4 处 `writeHead`，其中 2 处是本次逐字节重复，另 3 处**不是**同一形状因而不并入——`serve.ts:266`（/health，body 是内联对象字面量而非 `JSON.stringify(obj)`）、`serve-dashboard.ts:1998/:2033`（两个 /cards，额外发 `Cache-Control: no-store` 且 body 已预序列化）；并入会改变 helper 契约而非去重。故抽取覆盖 2/2 逐字节实例、0/3 仅形似实例。

## DoD
- [x] 上面的判据实跑通过 —— 全部命令均已实跑：finding 记录逐字核对、两处函数体 `sha256` 对拍、谓词在 `develop`（2 条）与修复后（0 条）的负控制对拍、`for d in packages/*/; do npx tsc --noEmit -p "$d"; done`（EXIT=0）、`node --test` 三个测试文件（31/31 pass 0 fail）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 本任务的修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-p015`，分支 `task/gap-routine-semantic-dedup-scan-p015`，提交 `93fe2ec58`）；例程 `semantic-dedup-scan` 只往 `.quay/routine-findings.jsonl` 写了 finding 行（`filing-round` 记录里 p015 `accepted:true, state:"novel"`），未执行任何修复。

## Touches
- `packages/quay/src/serve-git.ts`
- `packages/quay/src/serve-sessions.ts`
- `packages/quay/src/serve-http-json.ts`
- `tasks/gap-routine-semantic-dedup-scan-p015.md`