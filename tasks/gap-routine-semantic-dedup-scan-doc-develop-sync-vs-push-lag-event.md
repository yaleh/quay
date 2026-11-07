---
id: gap-routine-semantic-dedup-scan-doc-develop-sync-vs-push-lag-event
title: "semantic-dedup-scan: Byte-identical including the {ts, ...record} prefix
  and the 'utf8' arg; only the REL path constant differs, and
  fan-in-push-lag-check already calls driver-filt"
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
Byte-identical including the {ts, ...record} prefix and the 'utf8' arg; only the REL path constant differs, and fan-in-push-lag-check already calls driver-filters' writer on another path

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794036444725` · ts `2026-11-07T07:27:24.725Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`writeDocDevelopSyncEvent`、`appendPushLagEvent`
- 涉及文件：
- `plugin/scripts/driver-filters.ts:757`
- `plugin/scripts/fan-in-push-lag-check.ts:389`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T07:27:24.725Z

## Disposition

**处置 = 修掉（extract）**，⛔ 不是「已注意到」。

- **复核（本轮实读源码）**：`driver-filters.writeDocDevelopSyncEvent`（原 `:759`）与
  `fan-in-push-lag-check.appendPushLagEvent`（原 `:391`）函数体逐字节相同——
  `const file = path.join(root, REL)` → `fs.mkdirSync(path.dirname(file), { recursive: true })` →
  `fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n", "utf8")` →
  `return file`；唯一差异是 REL 常量（`.quay/doc-develop-sync.jsonl` vs `.quay/fan-in-push-lag.jsonl`）。
  **finding 的描述成立**。
- **修法**：在既有的 JSONL 原语正本 `plugin/scripts/gate-script-base.ts` 新增
  `appendJsonlLineStrict(file, entry): string`（create dir + 单条 `JSON.stringify(entry) + "\n"` +
  返回写入的文件路径），两个 carrier 保留历史导出名、函数体退化为一行委托
  （`driver-filters.ts:766` / `fan-in-push-lag-check.ts:397`）。
- **⛔ 没有复用同文件的 `appendJsonlLine`**：那个原语的契约是 best-effort（catch 全吞、返回 `void`），
  而这两个 carrier 正是「同步 / 推送失败落痕」的写入面——`escalateToSemanticSync` 依赖
  `writeDocDevelopSyncEvent` **抛错**才能返回 `{ok:false, ledger:null}`。换成 best-effort 会把
  「ledger 写不进去」与「一切正常」在盘上变成同一形态（硬规则 3b）。所以抽取的是 **fail-loud 兄弟**，
  调用方可见的契约与行为逐字不变。

**可核读数（本轮实测；谓词先对着【已知为真】的样本干跑过 —— 硬规则 2）**

- 抽取前（`git show HEAD~1:<file>`，同一谓词）：原样重复行在 **2 个文件各 1 处 = 2 处**。
- 抽取后（工作树）：同一原样重复行 = **0 处**；strict 原语
  `fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8")` = **1 处，位于
  `plugin/scripts/gate-script-base.ts:594`**（定义在 `:592`）。
- 两个 carrier 各调用一次共享原语，carrier 内不再持有 append 实现。

复跑命令：
```
grep -rn 'fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\\n", "utf8")' plugin/scripts | wc -l   # 期望 0
grep -rn 'fs.appendFileSync(file, JSON.stringify(entry) + "\\n", "utf8")' plugin/scripts | wc -l                                      # 期望 1
```

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `doc-develop-sync-vs-push-lag-event`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794036444725`）所描述的问题被复核并处置 —— **已复核**（两函数体逐字节相同、仅 REL 常量不同，描述成立）；**已处置**（抽取为 `gate-script-base.appendJsonlLineStrict`，两个 carrier 委托）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **修掉**：原样重复行 **2 处 → 0 处**，strict 原语 **1 处**（读数与复跑命令见 `## Disposition`）；行为不变由 `plugin/test/driver-filters.test.mjs`（93 pass）与 `plugin/test/fan-in-push-lag-check.test.mjs`（14 pass）覆盖。

## DoD
- [x] 上面的判据实跑通过 —— 两个测试文件在 worktree 内实跑：93/93 与 14/14 全绿；scoped 门 `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-doc-develop-sync-vs-push-lag-event --allow-thin` exit 0（classification green）。
- [x] ⛔ 探针只立案不执行：本任务的复核与修复由派发链（worker）执行，例程只立案。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务只是把两处纯 I/O 包装归一到既有 gate-script-base 的 JSONL 原语，不新增模块、不新增依赖边（两个 carrier 原本就已 import 该模块），包/依赖结构量不变，本轮未取 L_D/L_G 读数。

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/fan-in-push-lag-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `tasks/gap-routine-semantic-dedup-scan-doc-develop-sync-vs-push-lag-event.md`
