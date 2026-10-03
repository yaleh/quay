---
id: gap-routine-semantic-dedup-scan-git-helper-collector-gate
title: "semantic-dedup-scan: Identical 8-line git(args,cwd):GitResult (execSync,
  timeout 10_000, same ok/stdout/error shape) defined locally in two sibling
  scripts; neither imports a share"
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
Identical 8-line git(args,cwd):GitResult (execSync, timeout 10_000, same ok/stdout/error shape) defined locally in two sibling scripts; neither imports a shared one.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790995446200` · ts `2026-10-03T02:44:06.200Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git`
- 涉及文件：
- `plugin/scripts/build-evidence-collector.ts:78`
- `plugin/scripts/build-evidence-gate.ts:80`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `git-helper-collector-gate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790995446200`）所描述的问题被复核并处置 —— 已复核：该 runId 的记录逐字为 files=`[plugin/scripts/build-evidence-collector.ts:78, plugin/scripts/build-evidence-gate.ts:80]`、dupKind=`byte-identical-body`、verdict=`real-duplication`、suggestedAction=`extract`，与两处私有 `git(args,cwd):GitResult` 一致。已处置：提取到 `plugin/scripts/gate-script-base.ts` 的单一 `GitResult`+`git()`，两载体改为 import（`git diff --stat` = 两处各删 18 行私有副本、各 +6 行）。实现 commit `ce5edca45`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修掉，且产物可核：①`gate-script-base.test.mjs` 新增【契约键非名字键】单源 pin「defined exactly ONCE under plugin/scripts」+ 两载体 negative control（既不重定义、又确实 import）+ 三态语义（success / empty-diff / failure，硬规则 3b）+ `删除共享导出 ⇒ consumer 链接失败`机制控制；②mutation control：把副本粘回 `build-evidence-collector.ts` → 2 条 pin 变红（43 pass / 2 fail），`cp` 恢复后回绿 ⇒ pin 非恒真；③`node --test gate-script-base.test.mjs build-evidence-manifest.test.mjs` = 69/69（含 AC12 byte-identical 镜像断言）；④`npx tsc --noEmit` exit 0。

## Disposition

**修法**：`plugin/scripts/gate-script-base.ts`（本模块已是 `flagValue` 等同类提取的正本）新增 `export interface GitResult` + `export function git(args, cwd): GitResult`，**保持 fail-closed**：命令失败 = `ok:false`+`error`，与「合法空 diff」= `ok:true`+空 stdout 可区分（硬规则 3b；smoke 实测三态：`{ok:true,sha40}` / `{ok:true,""}` / `{ok:false,error}`）。`build-evidence-collector.ts` / `build-evidence-gate.ts` 删除私有副本并 import 共享实现，`execSync` 导入随之移除。

**镜像说明**：这两文件与 `experiments/quay-perpetual-stream/scripts/*` 是 **symlink 镜像**（非独立拷贝），故只改 `plugin/scripts/` 两处即同步；`build-evidence-manifest.test.mjs` 的 AC12「byte-identical mirrors」实测仍绿。

**规则 5b（同一载体其它适用点 —— 命中数与前 3 条）**：在 `plugin/scripts/` grep 该原语 `execSync(\`git ${args.join(" ")}\`, { cwd, …, timeout: 10_000 })` 得 **4 处 / 3 族**：
1. fail-closed（`(args,cwd):GitResult`）：`build-evidence-collector.ts:80` + `build-evidence-gate.ts:82` —— **本 finding，已修**。
2. 抛出式（`(args,cwd):string`）：`run-identity.ts:99` + `stage-receipt.ts:246` —— 契约不同（throw，非 `GitResult`），且是**同一次 run 的另一个 finding**（`real-duplication [run-identity.ts:98, …]`），⛔ 不在本任务 scope，改它会与兄弟任务抢同一写面。
3. spawnSync 式（`(cwd,args):Ran`，`status/stdout/stderr`）：`release-branch-janitor.ts:160` + `release-reading-sandbox.ts:101` —— 第三契约，同样非本 finding。

## DoD
- [x] 上面的判据实跑通过 —— 上述每条命令均实跑：`git diff`（提取，见 commit）、`node --test`（69/69）、mutation control（2 红后 `cp` 恢复回绿）、`npx tsc --noEmit`（exit 0）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 例程仅产出 finding 记录（ts `2026-10-03T02:44:06.200Z`）并经 `routine-file-gate.ts` 机械立案；提取与验证由本 worker（派发链）执行，例程未跑修复、未改代码。

## Touches
- `plugin/scripts/build-evidence-collector.ts`
- `plugin/scripts/build-evidence-gate.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-git-helper-collector-gate.md`