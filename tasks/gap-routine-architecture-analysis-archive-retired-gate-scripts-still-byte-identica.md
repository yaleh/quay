---
id: gap-routine-architecture-analysis-archive-retired-gate-scripts-still-byte-identica
title: "architecture-analysis: md5 comparison run today: drain-scheduler.ts
  (6526 B), drain-dispose-corruption-check.ts (7355 B), it0-ceiling-check.sh
  (4036 B), it0-ceiling-line-budget-che"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
md5 comparison run today: drain-scheduler.ts (6526 B), drain-dispose-corruption-check.ts (7355 B), it0-ceiling-check.sh (4036 B), it0-ceiling-line-budget-check.sh (6776 B), it0-dashboard-line-budget-check.sh (2095 B) and it0-gate-hash-check.sh (7603 B) are all IDENTICAL between the live experiments dir and archive/2026-10-28-retired-gate-scripts-orphan/, i.e. the retirement archive holds code that is still in production use (it0-dod-check.sh is invoked per CLAUDE.md:150).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793965687346` · ts `2026-11-06T11:48:07.346Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`drain-scheduler.main`、`drain-dispose-corruption-check.checkBodyIntegrity`、`it0-ceiling-check`
- 涉及文件：
- `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/drain-scheduler.ts:85`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts:85`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts:67`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh:1`
- kind：`duplication`
- verdict：`CONFIRMED — 6 byte-identical live↔'orphan' archive pairs`

## Requested action
delete the 6 archive copies (experiments/quay-perpetual-stream/scripts is authoritative); the 2 same-named files that genuinely diverged — it0-dod-check.sh and it0-dogfood-evidence-gate.sh — are correct frozen snapshots and must stay.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T11:48:07.346Z

## 复核（2026-11-06，本任务实跑，非转抄）

**观察成立**：逐文件 md5（今日实测）——6 对逐字节相同，正是 finding 点名的那 6 个；另 2 个确已分叉
（`it0-dod-check.sh` live 427 B vs archive 1324 B；`it0-dogfood-evidence-gate.sh` live 5414 B vs archive 4467 B），
其余 6 个无同名 live 副本或与 live 不同。`archive/INDEX.tsv` 的 14 行逐行对盘复核：**0 处不符**。

**但 requested action 被三条独立载体驳回**：

1. **关系早已声明，不是「无人看守」**。`archive/INDEX.tsv` 2026-10-28 建档时就把这 6 行写成
   `byte_identical=yes`（另 8 行 `byte_identical=no`），并带 `live_copy=<路径>` 与捕获 `commit=`。
   finding 在 **9 天前**已被逐文件记录过，它把已声明的关系重读成「沉默的第二份副本」。
2. **它自己的举证反证它自己的清单**。`it0-dod-check.sh` 是它用来证明「仍在生产使用」的文件，
   而它把该文件列进 **keep** 名单；被点名删除的 6 个，按 `docs/analysis/runtime-usage-inventory.json`
   （72h 窗口）分别是 `executed=1/4/0/0/2/0`，其中 1 与 4 全部来自**它自己的测试**（import 而非生产调用）
   —— 即 §12d 明确不算生产调用者的那一类。
3. **删除会让一条可执行不变量变红**。`plugin/test/gate-scripts-retirement.test.mjs` 要求 14 个归档
   文件全部存在且各有 INDEX 行；**实测**删掉 1 个（`drain-scheduler.ts`）即 4 pass / 1 fail，文件已还原。
   归档的完整性是判据，不是可回收的空间。

**逐字节相同的成因是构造性的**：这 6 个 live 文件的最后一次改动是 2026-07-18 ~ 2026-07-31，**早于**
2026-10-28 的捕获 —— 快照拍下后活文件从未移动过，因此「今天仍相同」不是漂移，是归档在正常工作。

## 处置（修机制，不删文件）

**失败点不在归档，在「哪一面没有接线」。** SPEC §12c 接线的五个排除面**全是走树的代码**
（capability-catalog / runtime-usage-inventory / test.sh glob / laydown 闭包 / version-consistency-check）；
`plugin/scripts/` 下的 drift/dup 检查器（8 个，含 `mirror-pair-drift-check.ts`、
`identity-replication-check.ts`）`archive` 引用数**均为 0** —— 单侧只扫 `plugin/scripts` × `experiments/*/scripts`，
`archive/**` 从不在人口内。**唯一没有排除的第六类面不是代码，而是探针规格本身**：
`plugin/probes/architecture-analysis.md` 的 body 就是分析员收到的 prompt，一次自由扫描就把归档面读成可分析面。

修复（源码层，可执行）：

- `plugin/probes/architecture-analysis.md` — 新增第三条约束段
  ``**`archive/**` IS OUT OF DUPLICATION SCOPE — LIVE↔ARCHIVE BYTE-IDENTITY IS NOT A DEFECT.**``
  （与既有的「cycle-constrained hubs」「load-bearing flat surfaces」两段同族），点名 `archive/INDEX.tsv`、
  ⛔ 禁「删归档副本」这条补救、以及钉住它的可执行判据。
- `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` — 新增 **§12c-ii 分析员指令面**
  （§12c 五面之外的单列一条，⛔ 不改 §12c 的「五面」表述，避免与已 achieved 的 AC-157 判据漂移）。
- `plugin/test/archive-exclusion-wiring.test.mjs` — 新增该面的判据，**经真实 `readProbeSpec` 加载器**取
  objective 断言（证明子句真的到达被派发的分析员，而不只是文件里有字），**两条负控制**：①把该段从 objective
  里剪掉 ⇒ 谓词为假；②保留段头但抹掉 `archive/INDEX.tsv` ⇒ 谓词为假（每个合取项都承重）。

**判据可假（实测两臂）**：子句在 ⇒ `7 pass / 0 fail`；`git checkout -- plugin/probes/architecture-analysis.md`
（子句不在）⇒ 该条 `✖`，`6 pass / 1 fail`；还原后再跑回 7/7。

**5b 同族排查（修一处 ≠ 只修这一处）**：`plugin/probes/` 中提及 duplication/byte-identical 的规格共 3 个 ——
`architecture-analysis`（**有此缺口，已修**）、`semantic-dedup-scan`（扫描面被枚举钉死为
`plugin/scripts/` + `packages/*/src/`，`archive/**` 不在其中 ⇒ 无此缺口，不改）、`meta-driver`（讲 AC 措辞，
不扫文件 ⇒ 不适用）。drift/dup 检查器 8 个：`grep -c archive` 全为 0。

**Set-B 说明**：本次不删任何归档文件 ⇒ `plugin/test/gate-scripts-retirement.test.mjs` 保持绿（已实跑 5/5）。

## Dark axis（ADR-007）
- L_G archguard-runner: entitySccCount=0 directoryCycleCount=0 scopesEvaluated=6/6 (source=packages/quay/src,plugin/scripts,quay-native-src,quay-github-src,quay-backlog-src,experiments-scripts)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `archive-retired-gate-scripts-still-byte-identical-to-live`（routine `architecture-analysis`，runId `architecture-analysis-1793965687346`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/probes/architecture-analysis.md`
- `plugin/test/archive-exclusion-wiring.test.mjs`
- `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`
- `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh`
- `tasks/gap-routine-architecture-analysis-archive-retired-gate-scripts-still-byte-identica.md`