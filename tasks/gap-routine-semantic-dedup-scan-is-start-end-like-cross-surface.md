---
id: gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface
title: "semantic-dedup-scan: Both predicates are character-for-character
  identical across the plugin/packages boundary (eventKind short-circuit plus
  timing-marker presence); observation.ts"
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
Both predicates are character-for-character identical across the plugin/packages boundary (eventKind short-circuit plus timing-marker presence); observation.ts declares itself an EXACT mirror of fast-mode-telemetry but no source-level test names isStartLike/isEndLike, so the declared mirror is unpinned and can drift silently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791353789266` · ts `2026-10-07T06:16:29.266Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isStartLike`、`isEndLike`
- 涉及文件：
- `plugin/scripts/fast-mode-telemetry.ts:1370`
- `plugin/scripts/fast-mode-telemetry.ts:1375`
- `packages/quay/src/observation.ts:269`
- `packages/quay/src/observation.ts:275`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
move the pair into Core as the single definition and import it from the plugin, or add a source-parity assertion

## Disposition

**复核：属实（real-duplication 成立）。处置：修掉 —— 取 requested action 的【第一支】（搬进 Core 作为唯一定义，plugin 改为 import），并**同时**补上第二支的棘轮。**

**为什么取第一支而不是只加一个 parity assertion**：只加断言会让两份逐字节相同的函数体原样留着，
例程的 dedup 探针下一轮仍会以同一条 finding 立案（`semantic-dedup-scan` 是按字节体判重的）。
单一定义把重复本身消掉，断言则降级为「防止副本被粘回来」的棘轮 —— 所以本任务两支都做了：
重复被移除，且移除状态由一个**能取假**的判据守着。

**改动**：
1. 新增 `packages/quay/src/start-end-like.ts` —— 这两个谓词的唯一定义点（Core leaf，
   参数类型 `TimingMarked` 是两边消费者都能满足的最小结构型）。
2. `packages/quay/src/observation.ts` —— 删除本地副本，改为 `import` 该 leaf 并 re-export。
3. `plugin/scripts/fast-mode-telemetry.ts` —— 删除本地副本，经 `acquireCoreSrc` 取得该 leaf
   并 re-export。⛔ **不能**用裸 `../../packages/...` 字面量：本模块在 `quay driver` 的 kernel
   import graph 里（driver-runtime → driver-filters → concurrent-batch-scheduler → 本文件），
   裸字面量在 staged `packages/quay/plugin/` 副本里解析到不存在的路径 —— 这正是
   `plugin/scripts/core-src-import.ts` 头注释记录的 2026-09-14 事故形态。
4. 新增 `plugin/test/start-end-like-ssot.test.mjs` —— 守上述单一定义的棘轮。

⚠️ **`plugin/test/start-end-like-ssot.test.mjs` 必须同时进 `## Touches`（不只是 `## Test-Files`）**：
`## Test-Files` 只喂 `select-tests-for-touches.ts` 的选测（rule 4），
而 fan-in step 3 的 `anti-drift-touches-check.ts` 只看 `## Touches`，它的 arm (a) 对任何
「写了但未声明」的文件**硬失败**。实测：只挂 `## Test-Files` 时该检查
`ANTI-DRIFT HARD FAIL: out-of-declared: task wrote plugin/test/start-end-like-ssot.test.mjs`（exit 1）。

**顺带修正一个被这次复核暴露出来的文档缺陷**：两边原来的 doc comment 都把契约写成
「start-like = `eventKind === "start"` OR (timing 标记…)」，**漏掉了前置条件** ——
代码里 `if (!e || !e.timing) return false;` 排在 `eventKind` 短路**之前**，所以
`{eventKind: "start"}`（无 `timing`）**既不是** start-like **也不是** end-like。
写 ⑤ 的行为 oracle 时正是照那句错误措辞写的，**首跑就红**（`expected true, got false`），
这才发现措辞与实现不符。现已在 leaf 头注释里写明该前置条件并逐条 pin 住。
（行为上对真实 A1a 事件无影响 —— 每个 start/end 都带 `timing` —— 但契约就是契约。）

## Evidence

### AC1 — finding 复核（逐字对照 `.quay/routine-findings.jsonl`）

```
$ python3 -c "…读 findingId == 'is-start-end-like-cross-surface'…"
{"ts":"2026-10-07T06:16:29.266Z","routine":"semantic-dedup-scan","runId":"semantic-dedup-scan-1791353789266",
 "findingId":"is-start-end-like-cross-surface","dupKind":"byte-identical-body",
 "symbols":["isStartLike","isEndLike"],
 "files":["plugin/scripts/fast-mode-telemetry.ts:1370","plugin/scripts/fast-mode-telemetry.ts:1375",
          "packages/quay/src/observation.ts:269","packages/quay/src/observation.ts:275"],
 "verdict":"real-duplication"}
```
修前两侧四个行号逐一对照属实：两段函数体逐字节相同（含 `eventKind` 短路 + timing 标记判定）。

### AC2 — 处置可核（修后读数 + 变异负控制）

**① 声明点恰好一处（按位置判定，非关键词）**
```
$ grep -rn "^\(export \)\?function isStartLike\|^\(export \)\?function isEndLike" plugin/scripts/*.ts packages/quay/src/*.ts
packages/quay/src/start-end-like.ts:50:export function isStartLike(e: TimingMarked | null | undefined): boolean {
packages/quay/src/start-end-like.ts:61:export function isEndLike(e: TimingMarked | null | undefined): boolean {
$ grep -rln "^\(export \)\?function isStartLike" plugin/scripts/*.ts packages/quay/src/*.ts | wc -l   ⇒ 1
$ grep -rln "^\(export \)\?function isEndLike"   plugin/scripts/*.ts packages/quay/src/*.ts | wc -l   ⇒ 1
```

**② 两个消费者是 import/re-export，不是副本**
```
plugin/scripts/fast-mode-telemetry.ts:141:const { isStartLike, isEndLike } = await acquireCoreSrc(
plugin/scripts/fast-mode-telemetry.ts:1383:export { isStartLike, isEndLike };
packages/quay/src/observation.ts:43:import { isStartLike, isEndLike } from "./start-end-like.ts";
packages/quay/src/observation.ts:275:export { isStartLike, isEndLike };
```

**③ 运行时跨边界同一性（实测，非 import 层回声）**
```
$ node --experimental-strip-types -e '…同时 import leaf / observation.ts / fast-mode-telemetry.ts…'
tel.isStartLike === core.isStartLike : true
obs.isStartLike === core.isStartLike : true
tel.isEndLike   === core.isEndLike   : true
obs.isEndLike   === core.isEndLike   : true
```

**④ 负控制（棘轮能取假 —— 把本地副本粘回 plugin 消费者）**
`cp` 备份 → 在 `plugin/scripts/fast-mode-telemetry.ts` 里写回 `isStartLike`/`isEndLike` 两段本地函数体 ⇒
```
✖ ② SSOT — isStartLike is DECLARED in exactly one place
AssertionError: isStartLike must have exactly ONE declaration point — actual declarations:
  ["packages/quay/src/start-end-like.ts","plugin/scripts/fast-mode-telemetry.ts"]
✖ ③ … 7 tests / 1 pass / 7 fail（① 除外全部转红）
```
`cp` 复原后 md5 与变异前一致（`b174cd829db9470a69fdcf675a172e11`），8/8 绿。

**⑤ 产出的 dist 里 leaf 确实被内联（staged 布局实跑，非推断）**
```
$ cp -R plugin packages/quay/plugin && node packages/quay/scripts/build-plugin-dist.mjs packages/quay/plugin
build-plugin-dist: 112 bundled entrypoints → …/packages/quay/plugin/scripts/dist   （exit 0）
$ grep -n "start-end-like" packages/quay/plugin/scripts/dist/fast-mode-telemetry.js
7425:// packages/quay/src/start-end-like.ts
7442:  "packages/quay/src/start-end-like.ts"() {
8162  "start-end-like.ts"        ← 模块表，已内联（shipped bundle 自包含）
```
**负控制**：从 staged 目录直接 import 那个裸字面量 ⇒ `ERR_MODULE_NOT_FOUND`（证实字面量在 staged
布局里确实坏掉，而 `acquireCoreSrc` 的 walk-up 兜底把它救回来）：
```
$ node --experimental-strip-types packages/quay/plugin/scripts/zz-acquire-probe.ts   （探针，跑完即删）
FALLBACK OK — isStartLike: function | isEndLike: function
behaves: true
```
⚠️ 从 staged 目录裸跑**原始** `.ts` 仍会失败，但**与本改动无关且是本改动之前就有的**：先在
`./regex-escape.ts`（一个未用 `acquireCoreSrc` 的 shim）上炸。逐字对照 develop 版本同法执行 ⇒
报同一个 `…/packages/quay/packages/quay/src/kernel/regex-escape.ts` ERR_MODULE_NOT_FOUND。
shipped 形态不受影响（package.sh 构建 bundle 后删除原始 `.ts`，见 ⑤ 的内联读数）。

**⑥ scoped 门（与 fan-in 同一条命令）+ 其它**
```
$ bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface --allow-thin
== scoped static checks (change-relevant tier…) ==   （20+ 个 checker 实跑，非跳过）
  mirror-pair-drift-check: PASS — every mirror pair matches or is allow-listed…
  import-graph-check: files=450 edges=1239 (value 1124 / type 115)
    PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0
  NOT-EVALUATED: it0-split-or-commit-check --changed — no task file in this delta（⛔ 明示不与 PASS 混同）
⇒ 256 tests / 256 pass / 0 fail，exit 0
$ npx tsc --noEmit                                        ⇒ exit 0
$ node --test plugin/test/start-end-like-ssot.test.mjs    ⇒ 8 tests / 8 pass / 0 fail
```
选测（`select-tests-for-touches.ts --json`）除本任务测试外，还按 basename 配对选入
`plugin/test/fast-mode-telemetry.test.mjs` 与 `packages/quay/test/observation.test.mjs`，
并按 cross-cut 规则选入 `plugin/test/plugin-packaging.test.mjs` / `build-dist` / `npm-pack-e2e` / `adr-*`
—— 因为改动触及 `packages/quay/src`。

**⑦ fan-in 前置自检（实跑，提前暴露而非等 fan-in 烧掉整轮）**
```
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface --worktree "$PWD" --merge-target develop
（首次仅挂 ## Test-Files 时）ANTI-DRIFT HARD FAIL: out-of-declared: task wrote
  plugin/test/start-end-like-ssot.test.mjs (matches no declared Touches glob)   ← exit 1
（把该测试文件补进 ## Touches 并 merge develop 后）ANTI-DRIFT OK            ← exit 0
```

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `is-start-end-like-cross-surface`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791353789266`）所描述的问题被复核并处置 —— 复核：属实（两侧四个行号逐字节相同，见 Evidence ①）；处置：按 requested action 第一支搬进 Core 单一定义（`packages/quay/src/start-end-like.ts`），两个消费者改为 import/re-export
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**，且留下**能取假**的棘轮：`^function isStartLike` / `^function isEndLike` 在 `plugin/scripts` + `packages/quay/src` 下各恰好 1 处（`start-end-like.ts:50/61`）+ 跨边界运行时同一性 + 行为 oracle（17 条）；变异实跑（把本地副本粘回 plugin 消费者）⇒ 7/8 转红并报出第二个声明点，`cp` 复原后 8/8 绿（见 Evidence ④）

## DoD
- [x] 上面的判据实跑通过 —— `bash scripts/test.sh --for-task … --allow-thin` ⇒ 256/256、exit 0（含 scoped 静态检查实跑）；`node --test plugin/test/start-end-like-ssot.test.mjs` ⇒ 8/8；`npx tsc --noEmit` exit 0；staged 布局 dist 内联与 `acquireCoreSrc` 兜底、anti-drift 前置自检各取一次实读数（Evidence ⑤⑦）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 例程只读 `plugin/scripts` + `packages/quay/src` 立案，未代跑任何产出者；修复与上面全部实跑读数由本任务的派发链（worker）执行

## Test-Files

- `plugin/test/start-end-like-ssot.test.mjs`

## Touches
- `plugin/scripts/fast-mode-telemetry.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/start-end-like.ts`
- `plugin/test/start-end-like-ssot.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface.md`