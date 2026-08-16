---
id: gap-ac91-delivery-core-refs-undelivered-files
title: "AC91: 交付的执行核不得指向【未交付】的文件——全量枚举引用解析（非只修两条抽样）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC91`。

**实测（manager 已跑过）**：交付的 `plugin/loop/orchestrator-tick-core.md` 在 `:39` 引用
`.claude/workflows/execute-suite-fix.js`、在 `:70` 引用 `.claude/workflows/pool-quality-judge.js`；
而 `plugin/workflows/` 只有 3 个双拷贝（drain-directives / fan-in-execute / run-routines），
`quay-init --workflows` 也只从 `plugin/workflows/` 铺（`quay-init.sh:23`）⇒ **装完 tgz 的目标机上，
这两步指向不存在的文件**。

**⇒ 这正是 `referenced-not-landed` 类，但它逃过了那个 guard**（`quay-init.sh:1131` 的三条件 AND 里
「在 init/SKILL.md 声明过」这条会豁免掉——**⛔ 需实读确认是哪条豁免的，别猜**，读完判定分支再下结论）。

## Plan

> **排期建议（非前置，depends_on 已拆，manager 2026-08-16 裁定）**：建议在 AC90 land 之后做
> （派发顺序，人手执行）；无真前置——AC91 的引用解析不依赖 AC90 的漂移闸产出（AC90 是 diff 闸，
> 不产出「交付集」机械枚举；交付集来自 package.json files + package.sh，非 AC90 实现）。

1. **实读** `quay-init.sh:1131` 附近三条件 AND 的判定分支，确认哪条豁免了 execute-suite-fix /
   pool-quality-judge 的 referenced-not-landed。
2. 对**交付面全体**（`plugin/` 内所有 .md/.sh/.ts→dist）做一次引用解析，枚举「引用了一个不在
   交付集里的路径」的**全部条目**（枚举，不是布尔，硬规则③）——先给全量条数。
3. 条数降到 0 或每条有显式豁免记录。
4. 有一个会被执行的检查守住它。
5. ⛔ 不得只修 :39/:70 这两条了事——必须先给出全量条数，否则修的是抽样。

## Acceptance Criteria

- [x] AC1: 交付面全体的引用解析枚举出全部「引用未交付路径」条目（全量条数，非抽样）。
- [x] AC2: 条数降到 0 或每条有显式豁免记录。
- [x] AC3: 存在一个会被执行的检查守住它（不会再次漏）。
- [x] AC4: 实读了 quay-init.sh:1131 的判定分支，记录哪条豁免了 referenced-not-landed（非猜测）。

## Definition of Done

- [x] 交付的执行核不再指向未交付的文件（全量枚举归零 + 守住检查 + 豁免理由记录）。

## Evidence

**AC4 —— 实读 quay-init.sh 判定分支（非猜测，manager 假设被证否）**。
实读 `verify_referenced_landed`（`quay-init.sh` 内，FAIL 点在 `:1131` `[ ! -e "$ws/$r" ]`、豁免判定在
`:1128` `printf '%s\n' "$selfcreate" "$refdoc" | grep -qxF "$r"`）之后确认：
**豁免点不在 init/SKILL.md 声明条款（:1128），而在引用集提取的正则**。`refs=` 的 alternation 是
`(plugin/scripts|plugin/loop|orchestration|docs/analysis)/[a-zA-Z0-9._-]+`——**`.claude/workflows/`
前缀根本不在 alternation 里**，所以 `.claude/workflows/execute-suite-fix.js` / `pool-quality-judge.js`
**从未进入 `$refs`**，`grep -qxF`（声明判定）与 `[ ! -e ]`（落地判定）都轮不到它们。
manager 的「三条件 AND 里『在 init/SKILL.md 声明过』这条会豁免掉」**是错的**——它不是在声明条款被
豁免，而是引用集提取阶段就隐形了（硬规则③ 的教科书形状：布尔化的存在性检查把「对象没进集」伪装成
「检查通过」）。修法：把 alternation 扩到 `.claude/workflows|.claude/agents`，并把
`plugin/workflows/*.js` 加入引用集扫描源。

**AC1 —— 全量条数（交付面全体引用解析，check 语义 + `.claude/` 类，枚举非抽样）= 5 条**：
| # | 引用 | 来源 | 处置 |
|---|---|---|---|
| 1 | `.claude/workflows/execute-suite-fix.js` | `loop/orchestrator-tick-core.md:39` | **修**：镜像进 `plugin/workflows/`（byte-identical），`--loop` 现隐含 `--workflows` ⇒ 落地 |
| 2 | `.claude/workflows/pool-quality-judge.js` | `loop/orchestrator-tick-core.md:70` | **修**：同上 |
| 3 | `plugin/scripts/per-task-suite-record.ts` | `workflows/fan-in-execute.js` | **修**：derive_loop_scripts 现在扫 `plugin/workflows/*.js` ⇒ 自动入派生落地集 |
| 4 | `plugin/scripts/fan-in-ac-completion-gate.ts` | `workflows/fan-in-execute.js` | **修**：同上 |
| 5 | `plugin/scripts/anti-drift-touches-check.ts` | `workflows/fan-in-execute.js` | **修**：同上 |

另有一条非失败但未显式声明：`orchestration/session-liveness.env`（quay-init `--loop` 安装时由
`write_session_env` 生成，:772 附近；check 通过因为它先于 check 落地）——**补声明**为
`<!-- self-create: orchestration/session-liveness.env -->`（AC8 本义：首轮自建本地态）。

**AC2 —— 归零**：修后重跑同一枚举（同一 source 面 + 同一 delivery 集 + 同一声明集）⇒ **defects = 0**；
全部 `.claude/workflows/` 引用（execute-suite-fix / pool-quality-judge / fan-in-execute）均 lands。
显式豁免记录：`experiments/`、`tasks/`、`adr/`、`packages/`、`.quay/`、`.claude/projects/` 前缀的
引用为 quay 本层实例态/运行时路径（非目标机机制交付物），check 的 alternation 本就不覆盖——按设计
不外铺（与 init/SKILL.md 既有 reference-doc 声明集同族）。

**AC3 —— 守住检查（两条都会被执行）**：
- 安装路径：`verify_referenced_landed` 现覆盖 `.claude/workflows|.claude/agents` 前缀 + `plugin/workflows/*.js`
  引用源。负控制（测试）：在 shipped doc 加 `.claude/workflows/ghost-workflow.js` ⇒ `--loop` 安装
  FAIL，stderr 报 `referenced-not-landed` + 点名路径。
- suite 路径：`plugin/test/quay-init-loop-consumer-doc-refs.test.mjs` 新增 3 条 AC91 测试
  （shipped doc 引用必须镜像于 `plugin/workflows/`；真实 `--loop` 落地两个 workflow + 三个 fan-in
  脚本；负控制 FAIL）。`plugin/test/plugin-packaging.test.mjs` M143 把 workflow 镜像集扩到 5
  （drain-directives / run-routines / fan-in-execute / execute-suite-fix / pool-quality-judge，
  byte-identical 断言）。
- 既有双副本漂移闸 `workflows-dual-copy-drift-check.ts`（每轮 gate，`scripts/test.sh:716`）的
  pinned 对集从 3 扩到 5（execute-suite-fix / pool-quality-judge 加入），mutation case 同步扩——
  未来任一 workflow 的「改正本不改落地副本」漂移继续 RED。`capability-catalog.sh` 描述同步。
- `--loop` 现隐含 `--workflows`（执行核引用 workflows，装 loop 即装其 workflows——否则 --loop-only
  目标的 inner 执行核 `fast-mode-tick-core.md:41` 引用 `.claude/workflows/fan-in-execute.js`
  同样指向不存在）。

**测试**：`quay-init-loop-consumer-doc-refs.test.mjs` 7/7、`quay-init-loop-core.test.mjs` 12/12、
`quay-init-laydown-closure.test.mjs` 5/5、`quay-init-drift-report.test.mjs` 6/6、
`quay-init-loop-runtime.test.mjs` 14/14、`plugin-packaging.test.mjs` M143 7/7、
`workflow-metadata-conformance.test.mjs` 23/23、`verify-delivery-surface.test.mjs` 25/25、
`l1-delivery-surface-check.test.mjs` 6/6、`delivery-inventory-drift-gate.test.mjs` 17/17 全绿。
`verify-delivery-surface.ts --write-inventory` 把 §6 `workflows=3→5` 刷新（`inventory_drift=0`）。

## Touches

- plugin/workflows/execute-suite-fix.js（新镜像：交付被引用而此前未交付的 workflow）
- plugin/workflows/pool-quality-judge.js（新镜像：交付被引用而此前未交付的 workflow）
- plugin/scripts/quay-init.sh（引用集 alternation 扩到 `.claude/workflows|.claude/agents`；引用源加 `plugin/workflows/*.js`；`--loop` 隐含 `--workflows`；derive_loop_scripts 扫 workflow 文件）
- plugin/sync.sh（workflow 同步集 2→5）
- plugin/skills/init/SKILL.md（`orchestration/session-liveness.env` 声明 self-create）
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（3 条 AC91 测试：正+负+真实安装）
- plugin/test/plugin-packaging.test.mjs（M143 workflow 镜像集 2→5 + byte-identity）
- plugin/scripts/workflows-dual-copy-drift-check.ts（双副本漂移闸 pinned 对集 3→5）
- plugin/test/workflows-dual-copy-drift-check.test.mjs（双副本漂移闸 pinned 对集 3→5）
- plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh（双副本漂移闸 pinned 对集 3→5）
- plugin/scripts/capability-catalog.sh（双副本漂移闸 pinned 对集 3→5）
- scripts/test.sh（双副本漂移闸 pinned 对集 3→5）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY workflows=3→5，`--write-inventory` 刷新）
- tasks/gap-ac91-delivery-core-refs-undelivered-files.md（自身）
