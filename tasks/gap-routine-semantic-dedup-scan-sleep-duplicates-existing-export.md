---
id: gap-routine-semantic-dedup-scan-sleep-duplicates-existing-export
title: "semantic-dedup-scan: Three plugin copies are the same one-liner new
  Promise(r => setTimeout(r, ms)) while driver-runtime.ts:280 already EXPORTS
  the identical sleep, so they duplica"
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
Three plugin copies are the same one-liner new Promise(r => setTimeout(r, ms)) while driver-runtime.ts:280 already EXPORTS the identical sleep, so they duplicate an existing export rather than an absent one

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794036444725` · ts `2026-11-07T07:27:24.725Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sleep`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:676`
- `plugin/scripts/psi-failure-correlation-check.ts:318`
- `plugin/scripts/suite-load-sampler.ts:45`
- `plugin/scripts/driver-runtime.ts:280`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T07:27:24.725Z

## Disposition

**已修掉**（⛔ 不是「已注意到」）。单一定义 = `plugin/scripts/gate-script-base.ts` 的 `sleep`（它本来就持
有逐字相同的 body，且在依赖图上位于 `driver-runtime.ts` **之下** —— driver-runtime import base，反向从不
发生；让 184 行的 `suite-load-sampler.ts` 去 import 5252 行的 kernel 会把分层倒过来）。三个载体改为从 base
import；`driver-runtime.ts` 改为 `import { sleep } from "./gate-script-base.ts"` + `export { sleep };`
—— **re-export 同一函数对象**，该 kernel 的公开面与既有调用点不变。原「3 份私有拷贝 + 1 份导出」的 4 份
逐字相同 body 收敛为 1 份。

机械证据（可复跑，`plugin/test/gate-script-base.test.mjs` 新增四例）：
① 一行式谓词先在 4 份 pre-extraction body 上**干跑命中**、在一个异形样本上不命中（防空转，硬规则 4c）；
② 四个 former carrier 都**不再声明** `sleep`、且**都 import** base 的那一个（提取 ≠ 删除）；
③ `driver-runtime.sleep === gate-script-base.sleep`（运行时同一对象 ⇒ 是 re-export，不是第四份拷贝）；
④ 行为：`sleep(20)` 返回 Promise 并在 ≥10ms 后 resolve（只设下界，不设受负载影响的上界）。

实跑：`node --test plugin/test/gate-script-base.test.mjs` → 87/87 pass；`driver-runtime-s01..s12` +
`driver-runtime-control-plane` + `source-text-lib` → 93/93 pass。落地提交 `3a21bbc4b`。

硬规则 5b 扫描（同 idiom，`plugin/scripts/*.ts` 8 命中，Core 另 1）：除上述 4 份外还有
`start-drivers.ts:491`（参数名 `resolve`，不在已核实的 byte-identical 簇内）、
`full-suite-runner.ts:2983`（`leakSweepDelay`，另一个具名 bounded-wait 契约）、
`open-semantic-discovery-routine.ts:3922`（内联 `opts.sleepFn ??` fallback，非声明）、
`packages/quay/src/cli/server.ts:495`（Core 包，不能 import plugin/scripts）。逐条记录在测试文件的注释块里，
本轮**不折叠**（不同符号 / 不同契约 / 跨包边界）。⛔ 若后续轮判定它们同属一个概念，从这份清单起扫。

- 该轴仍暗,理由:本任务只把一条单行 helper 归并到既有 base 导出（不新增/删除模块、不引入此前不存在的依赖边：三个载体本来就 import gate-script-base），L_D/L_G 读数不因它改变，且 archguard 全仓扫描不在本轮执行预算内。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `sleep-duplicates-existing-export`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794036444725`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/suite-load-sampler.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-sleep-duplicates-existing-export.md`

## Blocker

**2026-11-07T08:11:47.774Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging plugin/scripts/gate-script-base.ts
Auto-merging plugin/test/gate-script-base.test.mjs
CONFLICT (content): Merge conflict in plugin/test/gate-script-base.test.mjs
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：0d73490a-3aee-47d5-953e-469225f5f404
