---
id: gap-routine-semantic-dedup-scan-is-direct-arrow
title: "semantic-dedup-scan: Byte-identical 'am I the entry point' arrow
  (process.argv[1] vs fileURLToPath(import.meta.url) with try/catch) in the two
  probe servers; confirmed by both the "
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
Byte-identical 'am I the entry point' arrow (process.argv[1] vs fileURLToPath(import.meta.url) with try/catch) in the two probe servers; confirmed by both the body-digest scan and archguard.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793251416079` · ts `2026-10-29T05:23:36.079Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isDirect`
- 涉及文件：
- `plugin/scripts/channel-probe-server.ts:281`
- `plugin/scripts/peer-identity-probe.ts:648`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:23:36.079Z

## Disposition

**结论：修掉了（extract 完成）。** 复核确认 finding 描述属实——两个文件各带一份**逐字节相同**的私有入口守卫：

```ts
const isDirect = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return path.resolve(a1) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isDirect) main();
```

**已有机制在管、失败在哪一步**：`plugin/scripts/gate-script-base.ts:786` 的 `isDirectEntry(import.meta,
argv1, expectedBase)` 早已是这一族的共享实现（名称身份判定、`expectedBase` 必填、bundler-safe——URL 相等
在打包后会让所有被内联模块的守卫同时为真，见该函数上方的事故注释）。失败的一步是**采纳**：全仓库 176 处
调用点已在用它，这两个探针是漏网的两处，没有任何检查会因「少用一次共享守卫」而变红。

**处置**（commit `de1f56a00`）：
- 两处私有箭头 → `isDirectEntry(import.meta, process.argv[1], "<own basename>")`；顺带删掉因此不再使用的
  `import { fileURLToPath } from "node:url"`（`path` 在别处仍在用，保留）。
- 新增棘轮 `plugin/test/entry-guard-adoption.test.mjs`（6 test，双向）：谓词先在 fixture 上取两个值
  （私有副本 → true，委托 → false，**且**一行式变体 → false 以钉死本文件的覆盖边界），再对 `plugin/scripts`
  全量扫描；两个载体必须 import 共享守卫并以**自己的** basename 调用；运行时两侧都验——直接调用 `--help`
  跑 `main()`，被另一个 entry 脚本 import 时**不**跑。

**可核读数**（本 worktree 实测）：
- 该箭头在 `plugin/scripts` 的残留：`grep -rn "const isDirect = (() => {" plugin/scripts/ | wc -l` → **0**（处置前 2）。
- 共享守卫调用点：`grep -rn "isDirectEntry(import.meta" plugin/scripts/ | wc -l` → **178**（处置前 176）。
- `node --no-warnings --experimental-strip-types --test plugin/test/entry-guard-adoption.test.mjs` → 6/6 pass。
- 既有回归：`channel-probe-server.test.mjs` + `peer-identity-probe.test.mjs` + `gate-script-base-adoption.test.mjs`
  → 52/52 pass。
- 端到端：两个脚本 `--help` 退出 0 并打印各自 usage；`peer-identity-probe.ts` 被另一个 entry 脚本 import 时
  退出 0 且不打印 usage（守卫取到了假值，不是恒真）。

**⛔ 明确未覆盖的邻域**（硬规则 3b，不让一次绿读成「全仓库已收敛」）：`plugin/scripts` 里仍有约 38 处
**一行式**私有入口守卫（`const isDirect = process.argv[1] && fileURLToPath(… ) === path.resolve(process.argv[1])`
等），形态与本 finding 的箭头不同，**本次未动**；该覆盖面已写进新测试文件头注释，且测试用 fixture 负控制
钉死「一行式变体不计入本文件」。收敛它们是一次独立改动（要逐个核对各自 CLI 的调用形态），应由后续 finding/任务承接。

- L_G archguard-runner（本 worktree，`--root .`）: PASS，六 scope 全 evaluated，scope=scripts entitySccCount=0 directoryCycleCount=0 entities=4772 relations=10795

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `is-direct-arrow`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793251416079`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/channel-probe-server.ts`
- `plugin/scripts/peer-identity-probe.ts`
- `plugin/test/entry-guard-adoption.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-is-direct-arrow.md`
