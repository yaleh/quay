---
id: gap-routine-semantic-dedup-scan-root-resolveroot
title: "semantic-dedup-scan: Four different root semantics under one name; only
  fan-in-runid + inner-idle-log are genuinely foldable into a
  resolveRoot(rootArg, defaultRoot)."
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
Four different root semantics under one name; only fan-in-runid + inner-idle-log are genuinely foldable into a resolveRoot(rootArg, defaultRoot).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792847536579` · ts `2026-10-24T13:12:16.579Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveRoot`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:300`
- `plugin/scripts/fan-in-runid-check.ts:50`
- `plugin/scripts/inner-idle-log.ts:35`
- `packages/quay/src/driver-control.ts:33`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:12:16.579Z

## Disposition（处置结论，可核）

**结论：可折叠的 2 处已修；另 2 处判定为「同名不同概念」，理由写在各自代码旁（不是「已注意到」）。**

### 已修（提交 ed31e69d6）
共享的是**规则**「`--root` 给了就用它，否则用默认值」；**默认值本身是调用方的局部决定**，因此成为第二参数。
- `plugin/scripts/gate-script-base.ts`：`resolveRoot(rootArg, defaultRoot = process.cwd())` —— 五个原有调用方的读数不变（arity-1 等价性已 pinning）。
- `plugin/scripts/fan-in-runid-check.ts`：删掉私有 `resolveRoot(rootArg)` → `resolveRoot(flagValue(args, "--root"), repoRoot())`。
- `plugin/scripts/inner-idle-log.ts`：删掉私有 `resolveRoot(argv)`（含自带的 `argv.indexOf("--root")` 解析）→
  `resolveRoot(flagValue(argv, "--root"), REPO_ROOT)`。
- 唯一行为变化，已写进两处注释与测试：`--root ""` 在 inner-idle-log 原本回落到 `REPO_ROOT`（已退役的 falsy 形态），
  现在与其余所有 `--root` 调用方一致解析为 cwd —— `flagValue` 自己的契约（`""` 不得被读成「没给」）。

### 不折叠（不同概念，不是「同名不同默认」）
- `plugin/scripts/gate-script-base.ts`：它**就是**共享家，cwd 默认已降级为参数默认值，没有第二份可折叠。
- `packages/quay/src/driver-control.ts:33` 的 `resolveRoot(rootFlag)`：**发现**工作区根（`findConfig` 向上走，
  找不到返回 `null` —— 失败是合法的三态取值，返回 `string|null`）；共享版只把已点名的值转成绝对路径，失败不可能发生。
  另加包边界：product core 不得 import `plugin/scripts/`。判定与理由已写在该函数 docstring 旁。
- `plugin/scripts/crystallization-half-life.ts` 的 `resolveRoot`（旧注释里的第三处）：返回带种子的
  `{root}|{error,code}` 判别联合，是**评估结果**而非路径转换，同样不折叠。

### 判据（实跑）
- `node --no-warnings --test --experimental-strip-types plugin/test/gate-script-base.test.mjs` → 74/74 pass
  （新增 `defaultRoot` 四态 pinning；调用方棘轮 5 → 7，且对两个新调用方另加「旧私有语句不得复现 + 不得本地声明同名函数」）。
- `plugin/test/inner-idle-log.test.mjs` 6/6、`plugin/test/fan-in-runid-check.test.mjs` 15/15 pass。
- `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-root-resolveroot --allow-thin` → exit 0（232 tests, 0 fail）。
- 两个 CLI 无 `--root` 冒烟：`inner-idle-log.ts --counts`、`fan-in-runid-check.ts --json` 均 exit 0（默认根仍解析到仓根）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `root-resolveroot`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792847536579`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/fan-in-runid-check.ts`
- `plugin/scripts/inner-idle-log.ts`
- `packages/quay/src/driver-control.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-root-resolveroot.md`

## ADR-007 暗轴
- 该轴仍暗,理由:本次是 plugin/scripts 内的 root 解析去重（同层函数抽取），未改 packages/ 的依赖结构，未跑 archguard。