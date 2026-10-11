# ownership semantic review of a proposed_slice — design, readings, and the open question

**Task:** `gap-ownership-semantic-review-of-proposed-slice` · **Layer:** advisory (shadow) only · **Status of the admission bar: UNCHANGED.**

> 本文件是 DoD 要求的那一份报告。它记录：三分区设计与取舍、AC2b 的边界来源一致性读数、
> AC5 的逐案读数与混淆读数、成本、泄露审计、prompt sha，以及**留给人的未决判断**。

---

## 0. 为什么要有这一层（一句话）

准入闸（`ownership-active-limited-proposal.mjs::evaluateEntryBar`）只看四个**结构**条件：concern_kind、
由 ArchGuard 原语计算且负对照可证伪、provenance 一致、连续 3 次生产 run 一致。**结构正确 ≠ 归属正确**。
2026-10-11 的盲测反复收敛到 `gate/config/loader.ts → gate`（4→3，负对照证伪，provenance match）——
一个在结构上完全干净、在领域归属上错误的切法。今天人是唯一防线。本层补上**一层独立的领域归属语义审查**，
只产出给人看的可审计依据。

**⛔ 本层不改任何判据**：`evaluateEntryBar` 一字未动；`--review` 开与关时每个候选的
`eligible` / `reason` / `streak` / `matchedConditions` **逐字相同**（测试逐字段断言）。
是否把 `reject` 升格为准入条件 5，是**留给人**的未决判断（见 §7）。

---

## 1. 三分区设计，以及两处有意为之的取舍

沿用 archguard `arch-layer-review` 的「机械事实 / 声明规则 / LLM 解释」分区纪律——但那份 skill 是
**改动后、人驱动、会读提案文档与 `layers.yml` 草案**的审查；本层是**改动前、自动、零文档、不读
`layers.yml`** 的审查。两者不重复。

| 分区 | 实现 | LLM | 输入 | 输出 |
|---|---|---|---|---|
| 1 证据装配 | `assembleOwnershipEvidence` | 无 | 一个 **pinned commit** | `{id, kind, locator, sha256}` 读数束 |
| 2 机械事实 | `ownershipFacts` | 无 | bundle + 一份 ArchGuard moduleGraph | import 方向类事实 |
| 3 盲审 judge | `reviewOwnership` | 有（`--tools ""`） | **只有** bundle 与 facts | 逐 move 建议 + 可审计引用 |

### 取舍 A：import 方向事实交给 judge，SCC / cycle / delta **不交**

这不是「不让 judge 看依赖方向」，而是**禁止用环缩小代替归属判断**。二者是两个不同的判断：

- 「这些边指向哪、搬完会变成什么」= **归属证据** → 给 judge。
- 「SCC 从 4 变成 3」= **结构结论** → 由 ArchGuard 判，不进本层。

**机械保证**：一条 bundle **不得以任何名字**携带 `scc` / `cycle` / `delta` 类字段——
`assembleOwnershipEvidence` 在返回前调用 `assertBundleClean(bundle)`（键名扫描，含 `sccLeft`、
`slice_delta`、`expected_mechanical_delta` 等形态）；测试的负对照注入一个 `sccLeft` 字段，
调用**同一个** `assertBundleClean`，必须转红。

### 取舍 B：两个边界来源**比较并点名**，绝不取并集后默认完整

目标目录的观测边界有两个来源：

- **主来源** = 同一份 ArchGuard moduleGraph 快照中该目录节点的出边；
- **交叉核对** = Quay 自己对该目录各文件 `import` / `export … from` 语句的解析
  （复用 `plugin/scripts/import-graph-check.ts` 的 `extractImports` + `resolveSpecifier`）。

两者一致记 `agree`；不一致分别记 `graph_missing_edges` / `parse_missing_edges` / `both_differ`
**并列出差异边**；任一来源读不到记 `not-evaluated`（**绝不可能是 `agree`**）。

取并集会让「图漏边」静默消失——而漏边是这套图已知的真实形态（见 §3，实测到一例）。

### 另外两条不显眼但承重的规则

- **跨 move 的符号覆盖**：`utils.ts` 从 `./types.ts` 取 `GateConfig`，只有在**清空 `types.ts` 的那条
  move 命名了 `GateConfig`** 时才算「随切法一起搬走」。按单条 move 判会把 GOAL-034 的干净切法误报成
  依赖转移（实测：不这么做时 P1 会凭空多出一条 `./types.ts → gate/config` 的「转移依赖」）。
- **grep 命中行按注释块位置 redact**：`git grep -w GateConfig` 会命中 `types.ts:4` 那条**注释**
  （它就是 GOAL-034 的裁定原文）。命中行的文本必须与该文件的决策引用注释块比对后整行替换，
  文件读不到时**整行作废**（fail-closed）。这是实测发现的一个真实泄露路径，见 §6。

---

## 2. 证据装配：commit 锁定 / scope 限定 / deny-list / redact / 预算

- **只用 pinned commit**：`git show <commit>:<path>`、`git grep <commit> -- <scopeRoot>`。
  **工作树从不被读取**——读工作树等于描述另一棵树（硬规则 4b）。
- **scope 限定**：所有路径都锚在 `scope_root` 下；调用者只统计落在 scope 内的行。
- **deny-list**：`DENY_PATH_PATTERNS`（共享正本）逐条套用；被拒路径**记入 `bundle.denied`**，
  不静默丢弃。
- **redact**：每一条交给 judge 的文本先过 `redactDecisionReferences`，并记 `redacted_blocks`；
  `text_sha256` 按**实际交给 judge 的文本**计算。
- **章程（charter）按注释块起止位置提取**：目标目录各文件的**头部**注释块（裸 `//` 视作段落分隔，
  仍属头部）。**提到某文件名的注释不产生依赖类证据**——依赖只来自语句解析。测试专门钉住这一点。
- **预算**：复用 `DEFAULT_BUDGET.max_total_evidence_bytes`（90 000 B）；超限时**截断并逐条记入
  `bundle.truncations`**（`dropped_bytes` / `total_bytes`），不静默裁剪。

---

## 3. AC2b 读数：边界来源一致性（真实 commit）

图来自**与 commit 严格对应**的 ArchGuard 快照（分析树 = 该 commit 的 `packages/quay/src`）：

| commit | 目录节点 | agreement | boundary_source | graph 出边 | parse 出边 | 差异 |
|---|---|---|---|---|---|---|
| `162f8c380` | `gate/config` | **agree** | archguard_module_graph | 3 | 3 | — |
| `162f8c380` | `gate` | agree | archguard_module_graph | — | — | — |
| `add3e7318` | `gate/config` | **agree** | archguard_module_graph | 4 | 4 | — |
| `add3e7318` | `kernel` | agree | archguard_module_graph | 0 | 0 | — |
| `add3e7318` | `gate` | agree | archguard_module_graph | 4 | 4 | — |
| `1ac06fd85` | `cli` | agree | archguard_module_graph | 4 | 4 | — |
| `1ac06fd85` | `""`（scope 根） | **graph_missing_edges** | archguard_module_graph | 4 | 5 | `primitives` |

**任务原假设的落点**：AC2b 问的是「`gate/config` 在 `add3e7318` 的图是否缺 `kernel` 重导出边」。
**实测答案为「不缺」**——ArchGuard 0.1.40 在该树上把 `gate/config → kernel` 记成一条边，
`importedNames` 恰为 `[GateConfig, RunnerOptions, shQuote, resolveRunnerOptions]`，即
`gate/config/index.ts:6,15` 的两条 `export … from "../../kernel/gate-run-options.ts"`。
因此该读数是 AC 允许的 `agree` 分支，**不是** `graph_missing_edges`。
（两种都合法；AC 禁的是「缺边却报 agree」。）

**但 `graph_missing_edges` 在别处实测到了**：`1ac06fd85` 的 scope 根目录 `""`，源解析发现
`./primitives/*.mjs` 的边，而 ArchGuard 的内部节点集合里**根本没有 `primitives` 这个节点**：

```
internal nodes = ["" , cli, fan-in, gate, gate/config, gate/factories, kernel, ts-demo]
packages/quay/src/observation.ts:52   import { readTranscriptMtime } from "./primitives/session-liveness.mjs";
packages/quay/src/serve-send.ts:52    import { appendAuditRecord, … } from "./primitives/delivery-audit.mjs";
```

`primitives/` 下全部是 `.mjs` / `.d.ts`（无 `.ts`），所以它没有成为包图节点——**这是一条真实的漏边，
且成因可核对**。若两个来源被取并集，这条漏边会静默消失，恰好落在「缺边却报 agree」的反面样本上。

**负对照（测试内）**：从图中删掉 `gate/config → kernel` → 状态必须变为 `graph_missing_edges` 且
差异清单点名 `kernel`；从**解析结果**里删掉一条边 → 必须变为 `parse_missing_edges`（实测通过）。

---

## 4. AC2 / AC2b 机械事实读数（真实 commit）

`dest_boundary_violation` = 目标目录的**观测边界为空集**、而被搬文件带来了不随迁的越界依赖。
`null` = 边界读不到（**不是 false**）。

| 案例 | commit | violation | transferred | io_pull.pulled | 边界 agreement |
|---|---|---|---|---|---|
| **P1** GOAL-034 已落地切法 | `162f8c380` | **false** | 0 | — | `gate/config`=agree, `kernel`=agree |
| **N1** GOAL-034 被否决的宽移动 | `162f8c380` | **true** | 5 | `node:fs`, `yaml`, … | `gate/config`=agree, `kernel`=agree |
| **U1** stores→kernel | `add3e7318` | 3/7 moves true | 14 | 4 moves | `""`=graph_missing_edges, `gate`=agree, `kernel`=agree |
| **U2** gate/contract 两新目录 | `354ea7c8` | 5/8 moves true | 19 | 5 moves | 4 个目录全部 `not-evaluated`（无图） |
| **D1/D2/D3** 生产 `loader → gate` | `ec00fcc00` / `755bda59` / `138c99d2` | 全部 **false** | 4 / 4 / 5 | 1 move | `not-evaluated`（无图） |

**AC2 逐条比对**：

- ✅ P1 `dest_boundary_violation=false`。
- ✅ N1 `dest_boundary_violation=true` 且 `io_pull` 非空（`pulled` 含 `node:fs`）。
- ✅ `live:2026-10-11T11-03-06-609Z:1`（stores→kernel，U1 的第 1 条 move `goal-store.ts → kernel`）
  `dest_boundary_violation=true`。
- ✅ 生产候选 record 91（`live:2026-10-11T09-28-34-622Z:1`，carrier 第 91 行）move 3
  `gate/config/loader.ts → gate`：`transferred_dependencies` 含 `../../config.ts`，
  `resolved_path = packages/quay/src/config.ts`（**core-root**），`resolved_dir = ""`。

### 一条需要如实标注的读数：`io_pull` 的第二半在 162f8c380 **不成立**

任务 Proposal 写「`io_pull`：被搬文件 import `node:fs`/`node:child_process`/`yaml` 等 I/O，
**而目标目录现无此类 import**」。实测：`162f8c380` 的 `kernel/` **已经** import `node:fs`
（`control-state.ts:46`、`proc-identity.ts:42`、`task-transition.ts:60`、`write-json-atomic.ts:32`）。
所以 N1 的 `io_pull.is_pull = false`——本层如实记录：`pulled` 非空（被搬文件确实 import I/O），
`dest_has_io = true`（目标目录本来就有 I/O），因此**这一条事实对 N1 没有区分力**；
N1 的信号完全来自 `dest_boundary_violation` 与 `transferred_dependencies`。
（`is_pull` 的组合语义另有一条真实用例钉住：把一个 import `node:fs` 的文件搬进一个纯目录 ⇒ `is_pull=true`。）

### 第二条需要如实标注的读数：`dest_boundary_violation` 是一个**窄形状**

它只在目标目录的观测边界**为空**时才会点火。D1/D2/D3（三次 `loader → gate`）的 violation **全是 `false`**
——因为 `gate` 本身有 4 条出边。也就是说：**对生产里那三次真正危险的候选，本层的机械信号不是
"violation"，而是 `transferred_dependencies` + `io_pull`**。judge 拿到的是全部事实，不只有 violation。
（这恰好是「机械事实 ≠ 结论」的一个实例：形状不匹配不等于没问题。）

---

## 5. AC5 真实评估运行（默认 launcher、真 judge、全集跑一遍）

**运行**：`ownership-semantic-review-eval.mjs --cases plugin/fixtures/ownership-semantic-eval/cases.json --root <worktree> --repeat`
**launcher**：`launchArgv("meta-driver", prompt, root)` + `--tools "" --disable-slash-commands --no-session-persistence --strict-mcp-config`（与投研环**同一条**无工具接缝）
**model**：`v4.1flash-anthropic`（`model_runtime.role = "meta-driver"`）
**cases.json sha256**：`ce45e64e44f928267b7b48c78bd7ed510ec63d7bb8d04aa09286304e0c87b73f`
**结果产物**：`.quay/ownsem-eval-run1.json`（gitignored 的运行落痕）

### 5.1 prompt sha256 —— **运行前记录**，且运行后逐案复核一致

每个 case 的 prompt sha 由 `buildReviewPrompt` 在**调用 judge 之前**算出并写进记录。
运行结束后，用**同一份提交的代码 + 同一份 fixture**、**不调用 judge** 重算一遍：

```
MATCH  P1   14c8d48e569107e731d04587f2eeb62007e5cef9ffa6d6480c5450faa422e034
MATCH  P2   bd990d7bee7850e4be676a6d15460c3ec357d72af32c7f88739d842901c79389
MATCH  N1   b56c42c131ccfa90bdeea40f039ce064f0962b3f416e2c71470f533318347566
MATCH  D1   9292fb822d144a891cd5090ea34025805a81af4a92a5054664bc8a5491ea413c
MATCH  D2   e211d12395dd8c0679c5f4f64032fcef601b11df22fa3e299b863bf96c455780
MATCH  D3   9e018611f985b28054e0a0e623ab56d1357d501ee78cce1f1493d998a40914ee
MATCH  U1   ed6452d737e2ec27241ff9b9f3e3de750ca041bc694b04850673292eee3da78c
MATCH  U2   2379f49f945198fa713c984587d303458ef13a29f473d2b0d5ba757417091cdc
mismatches: 0
```

**⇒ 看到结果之后 prompt 一字未改**（8 个 sha 与运行完全一致）。因此不需要「全集重跑并同时报告两次」。

### 5.2 逐案读数

| # | case | label_source | state | overall | conf | judge calls | bundle bytes | 耗时 ms | outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 | P1 GOAL-034 已落地切法 | human-approved | evaluated | **review** | medium | 1 | 15 642 | 52 292 | correct |
| 2 | P2 GOAL-033 已落地切法 | human-approved | evaluated | **review** | medium | 1 | 24 941 | 57 178 | correct |
| 3 | N1 GOAL-034 被否决宽移动 | human-rejected | evaluated | **reject** | high | 1 | 12 922 | 11 700 | correct |
| 4 | D1 生产 `loader → gate`（09-28-34） | derived | evaluated | review | medium | 1 | 13 727 | 34 484 | 与派生标签不一致 |
| 5 | D2 生产 `loader → gate`（10-11-51，pinned） | derived | evaluated | **reject** | medium | 1 | 13 739 | 47 711 | 与派生标签一致 |
| 6 | D3 生产 `loader → gate`（10-24-36） | derived | evaluated | review | medium | 1 | 18 075 | 26 820 | 与派生标签不一致 |
| 7 | U1 stores→kernel | unlabeled | evaluated | **reject** | medium | 1 | 42 646 | 59 838 | 未计分 |
| 8 | U2 gate/contract 两新目录 | unlabeled | evaluated | **reject** | medium | 1 | 36 889 | 26 468 | 未计分 |

`abstain` 与 `not-evaluated`：**8 个 case 全为 0**（所有 case 都产出了可用判决，没有一次是靠弃权混过去的）。

**judge 的引用全部落在 bundle 内**（`UNGROUNDED_CITATION` 0 次）；**边界违例降级规则触发 0 次**
（N1 的 judge 主动用 `counter=3` 回答了反证并给出 `reject`——正是该规则想引导的行为）。

**N1 的判词（high confidence，节选）**：

> kernel/ is the dependency-free foundational mechanism layer: its own boundary charter states it may
> import nothing outside kernel/ except bare specifiers … and its observed boundary is empty (ev-12)

即：judge **仅凭** bundle + 机械事实，独立复现了「把真实 config 加载逻辑搬进 kernel 是归属错误」这个
GOAL-034 人写下的结论。

**D1/D3 的判词（与派生标签不一致的那两个，节选）**：

> gate/config is a subdirectory of gate, so this cut re-homes the gate-config loader **inside the same
> gate domain** rather than across a domain boundary.

这是一个**可辩护的第二种意见**：搬到父目录 `gate` 与搬到 `kernel` 是两回事。

### 5.3 一致性（P1 / N1 各重复 1 次，另含 P2）

| case | 第一次 | 第二次 | 第二次置信度 |
|---|---|---|---|
| P1 | review | review | medium |
| P2 | review | review | medium |
| N1 | reject | reject | high |

**3/3 完全一致**。（重复轮自身的耗时未记录在产物里——`repeat` 行只带判决与置信度，这是一个记录缺口，
不影响结论，如实标注。）

### 5.4 混淆读数（**只对人工标注案例**）

```
n = 3   correct = 3   FP = 0   FN = 0   abstain = 0   not-evaluated = 0
  positives (human-approved, n=2):  FP = 0, abstain = 0
  negatives (human-rejected, n=1):  FN = 0, abstain = 0
rates_reported = false   ← n=3 只报读数、不报比率
```

**派生 / 无标签案例单列，不进混淆读数**：

- `derived`（n=3，标签来自 GOAL-034 正文对**这一类**的裁定）：**1/3 与标签一致**（D2）。
  D1、D3 被判 `review`。⇒ 若采信该派生标签，本层对这三次生产 `loader → gate` 候选是 **2 次漏报**。
- `unlabeled`（n=2）：**2/2 被判 `reject`**（U1、U2）。这两条正是没有任何人裁定过的候选——
  也是本层第一次给出读数的对象。

---

## 6. AC6 泄露审计

对**8 个实际发送的 bundle**（每个案例一次）用 `auditHoldoutLeakage` 扫描 holdout 词汇
（`GOAL-034`、`ownership-wrong`、`宽移动`、`Holdout B`、`not config-loading`）：

**全部 0 命中**（`leak=0`，逐案见 §5 表）。

**正对照**：同一份装配、把 redactor 换成恒等 seam（`deps.redact = (t) => ({text: t, redacted_blocks: 0})`），
对 `add3e7318` 上一条搬进 `gate/config` 的 move ⇒ 审计**必须报警**：命中 `GOAL-034` 与
`not config-loading`（两条都来自 `gate/config/types.ts` 的头部注释）。同一 slice 走真实 redactor ⇒ 0 命中。
测试同时钉住这两半。

**过程中发现并修掉的一条真实泄露路径**（不是测试跑通后才想到的，是 AC6 把 D3 判红暴露出来的）：

`git grep` 的命中行**携带该行文本**；`git grep -w GateConfig … -- packages` 会命中
`packages/quay/src/gate/config/types.ts:4`，而那正是 GOAL-034 的裁定原文。修法：
命中行按所在文件的**决策引用注释块位置**整行替换为 `// [redacted: decision reference]`，
文件读不到时整行作废（fail-closed）。顺带修掉同一处的第二个缺陷：`git grep <rev> -- <path>`
输出形如 `<rev>:<path>:<line>:<content>`，原解析把 rev 当成路径 ⇒ 行号 `NaN`、行被归到不存在的文件。

---

## 7. 留给人的未决判断

**问题一（本层是否升格为准入条件 5？）**——**不建议现在升格**，理由是本层**已经实测到自己的漏报**：

- 对两个**人工标注正例**（P1/P2）与一个**人工标注负例**（N1）：3/3 正确、0 弃权、0 未评估。
  N1 的判词是 high confidence，且**独立复现了 GOAL-034 的裁定**。这一面看起来是能用的。
- 但对**三次生产 `loader → gate` 候选**（任务自己指认的「三次独立盲测反复收敛到的危险切法」）：
  若采信 GOAL-034 正文推出的派生标签，本层 **1/3 一致、2/3 漏报**（D1、D3 判 `review`）。

⇒ **一个在危险类上只有 1/3 命中的层，作为阻塞条件会把 2/3 的该类候选放行，却给整条管线增加一个
「已被审查过」的外观**——这比不加它还危险（硬规则 3b 的同形问题：把「没拦住」伪装成「审过了」）。
**建议：先积累读数**，尤其是**人工对 D1/D2/D3、U1、U2 这五条给出真正的所有权裁定**，
把 `derived` / `unlabeled` 变成 `human-*`，再看混淆读数。

**问题二（若将来升格，用哪个值当条件？）**——三选一，各有代价：

| 候选条件 | 本次读数 | 代价 |
|---|---|---|
| `overall === "reject"` | 会拦下 N1（对）+ U1/U2（未知对错）+ D2（对）；**放行 D1/D3（漏）** | 漏报已知存在 |
| `overall !== "review"`（即 reject **或** abstain） | 本次 8 案无一 abstain ⇒ 与上一条**读数完全相同** | 弃权率一旦上升，会变成「什么都不放行」 |
| 要求**逐 move** 无 `reject` | 比整体更严，但 U1/U2 会出现「部分 move reject」的灰区 | 需要新的合成语义 |

**问题三（本层没测到的东西）**：`dest_boundary_violation` 只覆盖「目标目录观测边界为空」这一种形状。
三次生产候选的 violation **全是 false**。是否需要一个**更宽的机械事实**（例如
「搬完后目标目录的出边集合会新增哪些、其中哪些指向与目标语义无关的域」）来覆盖这一类，
本层**没有回答**——这需要先有 D1/D2/D3 的人工裁定才知道该往哪个方向加。

**问题四（标签来源）**：本次的 `derived` 标签是从 GOAL-034 正文的「非目标 / 停止扩大范围的信号」
**离线推导**的。judge 给出的相反意见（同域搬迁）说明**这类标签本身有争议**。
在拿到人工裁定之前，`derived` 读数**只能当参考，不能当准确率的分母**——本报告就是这么用的。

---

## 8. 成本

| 量 | 读数 |
|---|---|
| judge 调用 | **11 次**（全集 8 + 重复 3）。每案恰好 1 次；无重试、无多轮 |
| bundle 字节 | 逐案 12 922 – 42 646 B；8 案合计 178 581 B（**无一次触发 90 000 B 上限**，`truncations` 全 0） |
| 耗时 | 逐案 11.7 – 59.8 s（含装配 + 一次 judge 调用）；8 案合计 **316.5 s** |
| 装配本身 | `assembleOwnershipEvidence` 每案约 90–470 ms（用 `git` 实测；含 `git grep` + `git ls-tree`） |
| 模型 | `meta-driver` 角色，`--tools ""`，无 session 持久化 |

**没有为成本设阈值**（硬规则 4 推论：成本结构未知前不设数值阈值）。上面是读数，不是指标。

---

## 9. 本层**没有**做的事（DoD 逐条）

- ⛔ 不改准入判据：`ENTRY_BAR_STREAK` 仍为 3，`evaluateEntryBar` / `evaluateCarrier` 一字未动。
- ⛔ 不创建 / 不激活任何 Goal：`--review` 单独运行不写任何东西；`--write` 写出的仍是 `draft`，
  且 `status` 在 `buildDraftGoal` 里是硬编码的 `draft`。
- ⛔ 不向投研器暴露评估集：`plugin/fixtures/ownership-semantic-eval/` 已加入共享 `DENY_PATH_PATTERNS`
  （负对照：`validateRequest({kind:"read_file", path:…})` ⇒ `PATH_DENIED`）。
- ⛔ 不从 GOAL 正文为审查器取材：GOAL-034 正文只用于**离线**给评估集打标签（`cases.json` 的
  `label_note` / `derived_from`），审查器的唯一输入是 bundle + facts（结构测试断言签名里没有 label，
  行为测试断言多传一个 label 不改变任何输出）。
- ⛔ 不读、不改 `docs/layers.yml` 草案（结构测试断言模块源码里没有该字符串）。
