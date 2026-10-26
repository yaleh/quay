---
id: gap-routine-semantic-dedup-scan-pad2
title: "semantic-dedup-scan: serve-render.ts:1009 is the serve-layer canonical
  pad2 and serve-dashboard.ts already imports from it yet redeclares one; only
  the sparklineSvg inner copy is f"
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
serve-render.ts:1009 is the serve-layer canonical pad2 and serve-dashboard.ts already imports from it yet redeclares one; only the sparklineSvg inner copy is forced because its source is serialized via Function#toString.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793051606259` · ts `2026-10-26T21:53:26.259Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pad2`
- 涉及文件：
- `packages/quay/src/observation.ts:1307`
- `packages/quay/src/serve/view/serve-dashboard.ts:200`
- `packages/quay/src/serve/view/serve-dashboard.ts:609`
- `packages/quay/src/serve/view/serve-render.ts:1009`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge - import pad2 in serve-dashboard.ts:200 and share a core-layer leaf with observation.ts; leave :609.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:53:26.259Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `pad2`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793051606259`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置（AC1/AC2）：修掉，不是「已注意到」。** finding 点名的四处里，三处是同一格式的多余副本，
一处（sparklineSvg 内联体）是**机制强制的**，finding 自己也判 `leave :609`：

- 新增**零 import 的核心层叶子** `packages/quay/src/pad.ts`（`export function pad2`），
  体为 `String(n).padStart(2, "0")` —— 与被删的 `observation.ts` / `serve-dashboard.ts` 两处副本逐字相同，
  且与 `serve-render.ts` 的旧体在**每一个真实调用点**上等价（小时/分/秒/month+1/day，全为非负整数 < 100）；
  顺带不再把负数格式化成 `0-1`。Core 不能 import view 层，所以共享的家只能是核心层叶子
  （同 `packages/quay/src/relative-time.ts` 对 "X ago" 的处置先例）。
- `serve-render.ts` 改为 `export { pad2 } from "../../pad.ts"`：**纯再导出、不在模块作用域绑定**
  （已核：该文件内无 pad2 调用点），因此 `serve-git.ts` / `serve-tests.ts` / `serve-dashboard.ts`
  三个 `from "./serve-render.ts"` 导入方的名字与路径全部不变。
- `serve-dashboard.ts` 删掉 :200 的重复声明，改为从 `./serve-render.ts` 导入（即 finding 建议的原话）。
- `observation.ts` 删掉模块私有副本，改为从 `./pad.ts` 导入。
- **`serve-dashboard.ts` 的 sparklineSvg 内联 `pad2` 保留（:609）**：该函数体经
  `Function.prototype.toString()` 序列化进浏览器，必须自包含（不得闭包模块级 helper），删掉会让
  客户端脚本 ReferenceError。⇒ 不是遗漏。

**同族清扫（硬规则 5b）**：`grep -rn 'padStart(2, "0")' packages/quay/src/` 现在只命中 `pad.ts`
自身（正文 1 条 + 注释 2 条）；`grep -rn 'function pad2' packages/quay/src/` 只剩叶子与 sparklineSvg
内联体两处。`plugin/vendor/quay/dist/quay.js` 里的 `pad2*` 是**构建产物**（构建期由 `sync-vendor.sh`
重打），不手改。

**验证读数（均为本轮实跑）**：
- 类型检查（`.quay/config.yml` 的 ts-typecheck 同一命令）：`npx tsc --noEmit -p packages/quay/` ⇒ exit 0。
- 驱动 fan-in 跑的**同一条 scoped 门**：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-pad2 --allow-thin`
  ⇒ `tests 165 / pass 165 / fail 0`，exit 0。
- 模块装载 + 再导出同一性：`serve-render.pad2 === leaf.pad2` 为 `true`；
  `pad2(0)=00`、`pad2(7)=07`、`pad2(12)=12`、`pad2(100)=100`。
- ADR-007 暗轴读数（本 worktree 实跑）：
- L_D import-graph-check: files=518 edges=1564 valueEdges=1423 typeEdges=141 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 verdict.ok=true
- L_D 本任务 diff（`git diff --numstat develop...HEAD`）: codeAdded=36 codeDeleted=12 files=4（净 +24 行，新增叶子占 21 行含注释）

## Touches
- `packages/quay/src/pad.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/serve/view/serve-dashboard.ts`
- `packages/quay/src/serve/view/serve-render.ts`
- `tasks/gap-routine-semantic-dedup-scan-pad2.md`