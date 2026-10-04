---
id: gap-routine-semantic-dedup-scan-ident-fcdeccc5d81b054c
title: "semantic-dedup-scan: Identical execSync git args inline wrapper with
  same cwd/encoding/timeout, explicitly annotated same shape as
  build-evidence-gate.ts."
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
Identical execSync git args inline wrapper with same cwd/encoding/timeout, explicitly annotated same shape as build-evidence-gate.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791142275270` · ts `2026-10-04T19:31:15.270Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git`
- 涉及文件：
- `plugin/scripts/run-identity.ts:98`
- `plugin/scripts/stage-receipt.ts:245`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
**复核（finding 成立）**：`plugin/scripts/run-identity.ts:98` 与 `plugin/scripts/stage-receipt.ts:245` 各有一份签名与 body 均逐字相同的 `git(args: string[], cwd: string): string` —— 同一个 `execSync` 包装器、同一 `{ cwd, encoding: "utf8", timeout: 10_000 }` 配置；归一化（去注释/空白）后 body digest 相同，故 `byte-identical-body` / `real-duplication` 判定成立。

**处置（extract / 修掉，⛔ 非「已注意到」）**：该形态的单一正本**已存在** —— `plugin/scripts/gate-script-base.ts` 导出的 fail-closed `git(args: string[], cwd: string): GitResult`（先例 finding `git-helper-collector-gate`，同一 run 早前已据此收编 build-evidence-collector.ts / build-evidence-gate.ts 的逐字副本）。本次：
- 两文件的私有 `git()` 删除，改为 `import { git, gitLastCommitForPath } from "./gate-script-base.ts"`；
- 其归一化同体的兄弟 `deriveWorkflowSourceCommit(path, cwd)`（同一 carrier，硬规则 5b 命中）一并收编为 `gate-script-base.gitLastCommitForPath(cwd, relPath): string`（失败/无历史都返回 ""，语义逐字保持）；
- 调用点按 `GitResult` 契约改写：`deriveBaseCommit` 走 `if (!result.ok) throw`（错误码与文案逐字不变）；`workflowSourceCommit = gitLastCommitForPath(cwd, input.workflowSourcePath)`；stage-receipt selftest 里那次 `git(...)` 改走本模块 `deriveBaseCommit`。

**机制归属（上一轮为何漏网）**：`git-helper-collector-gate` 的 commit message 已把本族显式留给「separate finding in the SAME run」，但当时只迁了两台 build-evidence-* carrier，run-identity/stage-receipt 未随迁 —— 正是硬规则 5b「修一处 ≠ 只在那一处」的漏网。

**Rule-5b 余项（同 carrier 内其余归一化同体簇，判为 coincidental idiom，不改）**：机械复扫（去注释/空白后逐函数 body digest）两文件间仍有 3 簇 —— `identityError`/`receiptError`（单行 error factory）、`sha256OfBuffer`（单行 `createHash("sha256")` 惯用法）、`printJson`（单行 `console.log(JSON.stringify(x))`）。三者均无共享配置/语义，与「带 cwd/encoding/timeout 契约的 git wrapper」不同类；收编进 base 只增噪声（探针本轮亦只把 git wrapper 判为 real-duplication，其余留白）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `ident-fcdeccc5d81b054c`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791142275270`）所描述的问题被复核并处置 —— 复核：两份 `git(args,cwd):string` 归一化后逐字相同（byte-identical-body 成立）；处置：删本地副本、import `gate-script-base.ts` 的 fail-closed `git(args,cwd):GitResult`（commit `4eacdb4b9`）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修掉；探针复扫（去注释/空白后逐函数 body digest）两文件间归一化同体簇 5→3，`git` 与 `deriveWorkflowSourceCommit` 两簇消失；另有新单测把 throwing `git` 形态钉为全网 0 定义（可核：`node --test --test-name-pattern=git plugin/test/gate-script-base.test.mjs`）；细节见 `## Disposition`

## DoD
- [x] 上面的判据实跑通过 —— `node --experimental-strip-types plugin/scripts/run-identity.ts --selftest` 与 `plugin/scripts/stage-receipt.ts --selftest` 全 PASS；`node --test plugin/test/run-identity.test.mjs plugin/test/stage-receipt.test.mjs plugin/test/gate-script-base.test.mjs` 27/8/6 全绿
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 本修复由 worker 派发链（worker-driver → 本 task worktree `task/gap-routine-semantic-dedup-scan-ident-fcdeccc5d81b054c`）执行，例程仅立案

## Touches
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-ident-fcdeccc5d81b054c.md`