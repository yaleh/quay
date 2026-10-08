---
id: gap-routine-semantic-dedup-scan-is-ancestor-pair
title: "semantic-dedup-scan: The same git merge-base --is-ancestor predicate
  (false on any git error) implemented twice with different plumbing; a shared
  git-util would single-source it."
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
The same git merge-base --is-ancestor predicate (false on any git error) implemented twice with different plumbing; a shared git-util would single-source it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791442852793` · ts `2026-10-08T07:00:52.793Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isAncestor`
- 涉及文件：
- `plugin/scripts/cross-machine-verify.ts:508`
- `plugin/scripts/direct-to-develop-bypass-check.ts:870`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
**extract 已落地**（与 finding 的 `suggestedAction: extract` 逐字一致），落点选在**同一条例程此前为同一缺陷类**已建成的共享模块 `plugin/scripts/git-runner.ts`（它本身就是 semantic-dedup-scan finding `ident-c4a3817c65503261` 的产物）——⛔ 不新建 `git-util.ts`，因为该模块已是全仓 git 调用的唯一正本。

- `plugin/scripts/git-runner.ts` 新增 `ancestry(root, ancestor, descendant): boolean | null`：**三态**（exit 0 ⇒ true / exit 1 ⇒ false / exit ≥2 或进程未跑 ⇒ null）。两处调用方此前都把「读不懂」折叠成 false；本模块文件头明令**不得把「读不懂」折进取值**（硬规则 3b），且两个调用方折叠同一个 null 的**理由不同**（一处要「读不出 ⇒ 非前向 ⇒ 计入 nonForwardRefMoves 可见」的保守方向，另一处要「归不到分支 ⇒ 走 unattributed 面」），故折叠留在各自调用点，库只给三态。
- `cross-machine-verify.ts` / `direct-to-develop-bypass-check.ts` 均改为 `import { ancestry } from "./git-runner.ts"`；两文件代码位置**不再出现** `--is-ancestor` 调用。
- 新 `plugin/test/git-runner.test.mjs` 钉住三态（含「未知对象 ⇒ null」「非仓库目录 ⇒ null」两臂）并带**位置判定**回归守卫（`buildNonCodeMask`，注释不计）：任何调用方不得再自带 `--is-ancestor` 调用。

**硬规则 5b 扫掠读数**（`plugin/scripts/*.ts`，按代码位置）：9 个文件仍出现 `--is-ancestor`；除本任务修掉的两处外，**语义同族（布尔折叠成 false）的还有 3 处、但符号/管线各异** —— `ready-pool-check.ts:2954` `isAncestorCommit`（try/catch ⇒ false，1 个调用点）、`fast-mode-telemetry.ts:398` `isBranchMerged`（try/catch ⇒ false，含 2 次 git 调用）、`task-status-drift-check.ts:759`（`gitTry` 结果对象，读 `!ok`）。**其余刻意不同**：`worker-driver.ts` `isShaAncestorOfBranch` 在 git 错误时返回 `null`（三态，硬规则 3b）、`goal-driver.ts` `gitExit` 区分 exit 1 与 ≥2、`integration-batch-merge.ts` / `suite-state-trigger.ts` / `worker-fan-in.ts` 是各自流程内的内联用法。这些**不在本 finding 的符号范围**（它点名的是符号 `isAncestor` 的两个文件），逐条记明以便后续轮次各自判定——⛔ 不以「已注意到」结案，本任务实际修掉了被点名的两处。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `is-ancestor-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791442852793`）所描述的问题被复核并处置 ——复核：该 runId 下 `findingId: "is-ancestor-pair"`、`verdict: "real-duplication"`、`suggestedAction: "extract"`、`files: ["plugin/scripts/cross-machine-verify.ts:508","plugin/scripts/direct-to-develop-bypass-check.ts:870"]`（逐字命中）；处置：按 extract 落地，见 ## Disposition
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 ——修掉可核：`plugin/scripts/git-runner.ts` 导出 `ancestry(...): boolean | null`；两载体的**代码位置** `--is-ancestor` 命中数各为 0 且各自 `from "./git-runner.ts"` 导入（读数：`buildNonCodeMask` 下 cross-machine-verify.ts=0 / direct-to-develop-bypass-check.ts=0 / exports ancestry=true）；`node --experimental-strip-types --test plugin/test/git-runner.test.mjs` 8/8 绿（含位置判定回归守卫）

## DoD
- [x] 上面的判据实跑通过 ——`plugin/test/git-runner.test.mjs` 8/8 pass；两载体的既有特征化测试同跑 95/95 pass（cross-machine-verify-characterization + direct-to-develop-bypass-check + git-runner）；`capability-catalog.sh --json` exit 0；`import-graph-check.ts --json` verdict ok（valueSccs/typeSccs/reverseEdges 均 0，未新增环）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 ——本例程（probe `semantic-dedup-scan`）只写了 `.quay/routine-findings.jsonl` 的 `finding` 与 `filing-round` 记录；本任务的复核与修复由派发链（worker）执行，例程未跑任何修复命令

## Touches
- `plugin/scripts/git-runner.ts`
- `plugin/scripts/cross-machine-verify.ts`
- `plugin/scripts/direct-to-develop-bypass-check.ts`
- `plugin/test/git-runner.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-semantic-dedup-scan-is-ancestor-pair.md`