---
id: gap-promotion-driver-blind-to-unsatisfiable-ac-block
title: todo→ready 被判「执行者结构上勾不了的 AC 未标注」拦下时，promotion-driver 既不记原因、也结构上永不
  needs-human ⇒ 该 todo 无限空转（实测 11h12m / 750 轮 / 全库唯一 todo）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**机制（两半，同一根因）**：`unsatisfiableUnannotatedAc` 这道闸在 **ready-pool-check** 侧认得——`plugin/scripts/ready-pool-check.ts:3476` 把它连同**命中项原文**写进 `intercepted[]`；但 **promotion-driver** 侧的 `classifyCandidate`（`plugin/scripts/promotion-driver.ts:276-285`）两张名单都不含它：`missing` 四类（fourArtifacts / selfTouchOk / touchesResolve / touchesNarrow）与 `unfixable` 五类（depsReady / retiredMechanism / superseded / compound / prosePrereqGap）。⇒ 命中该闸的候选 `missing=[]` ∧ `unfixable=[]`。

由此派生两个后果：

- **半 1（台账无名）**：`promotion-driver.ts:704` 的 `detail` 是 `f.unfixable.join(";") || "ineligible-not-fixed"`——空数组落进 fallback ⇒ 台账记下的「原因」是一个不含任何信息的常量串。这**与该文件头注释的承诺相反**（"a no-promotion is a traceable decision, not a silent skip"）。
- **半 2（结构上永不升级）**：`fixable = missing.length > 0 && unfixable.length === 0` = false ⇒ 不 spawn fix worker ⇒ `fixes[].spawned` 恒为 false ⇒ `fixedIds` 为空 ⇒ `promotion-driver.ts:862` 的 `if (fixedIds.length > 0)` 永不进入 ⇒ `advanceRetryCap`（`:869`）永不调用 ⇒ **该任务永不被标 needs-human**。

⇒ 合起来是「**无限重试 + 无升级 + 无名**」：一个作者侧的措辞问题被机制表现为一个永远在转、且不留可读原因的循环。

**生产读数（本仓，均为实测）**

- `.quay/promotion-outcome.jsonl` 中该 task 的行：首条 `2026-10-09T14:53:28Z`、末条 `2026-10-10T01:57:43Z`（11h12m），共 **750** 行，**全部**是 `{"gate":{"eligible":false,"missing":[]},"action":"skip","result":{"ok":false,"detail":"ineligible-not-fixed"}}`；`action:"fix"` **0** 行、`action:"needs-human"` **0** 行。
- 真实原因**在另一层存在**：`ready-pool-check --targeted <id>` 给出 `checks.unsatisfiableUnannotatedAc = {evaluated:true, status:"hit", hits:[<命中项原文>]}`，其余 12 项 checks 全 `true`。⇒ 原因没丢，**只是没进驱动台账**。
- 空转面：近 2 小时台账 139 行而 **distinct task = 1**；当时全库分布 done 2577 / superseded 75 / **todo 1**——被拦的那条就是唯一的 todo，整个晋升循环压在它身上。
- 因果确认（负控制，已观测）：人力裁定把该任务被点名的 DoD 项拆分改写（执行者可完成的那半留在原项、driver 次轮复验那半单列并带 `（待外部）`）后，**常驻晋升驱动在约 13 秒内把它 todo→ready 自动晋升** ⇒ 措辞是唯一阻碍。

**存量发生率（硬规则 12：发生率已有读数，不是凭空设的）**：2026-10-10 用 `judgeUnsatisfiableUnannotatedAc` 跑全量 `tasks/*.md`：可评估 2579、未评估 74，**18 条**任务至少含一个「执行者结构上勾不了、又没带 `（待外部）`」的 AC/DoD 项（done 6 / superseded 12）。它们今天是终态，但**任何一条被退回 todo 就会复现同样的空转** ⇒ 这是一类会复发的缺陷，不是一次性事件。

**修法（方向，实现者取一并写明理由）**

- a. `classifyCandidate` 收编这一类：进 `unfixable` 并**带上命中项原文**（台账 `detail` 因此点名真实原因），同时给它一条**升级**路径——使一个结构上不可能 spawn fix worker 的拦截也能走到升级（而不是只经那条永远不会进入的 reverify 路径）。
- b. 只修台账、不修升级：接受无限重试，但至少台账点名原因。

两案共同要求：⛔ 不削弱闸本身的 fail-closed 默认；⛔ 不让 worker 给自己的 AC 加 `（待外部）`（那是自我豁免）；⛔ 不把「无法评估」折进「合格」（硬规则 3b）。

**粒度判定**：`task-granularity-advice.ts --touches plugin/scripts/promotion-driver.ts --touches plugin/test/promotion-driver-s06.test.mjs` 返回 `peers: []`（无合并候选）⇒ 单独立案。参考：`plugin/scripts/promotion-driver.ts` 是返工热点（28 条已落地任务动过它，中位改动 268.5 行）。

<!-- dedup-ref --> 相关的**不同**机制（不覆盖本条）：`gap-executor-unsatisfiable-ac-unannotated-burns-rounds`（done）修的是**撰写侧**（在 todo→ready 拦下这一类），全文不提 promotion-driver / classifyCandidate / 升级路径；`DIR-062-C` 里的 `classifyCandidate()` 是**另一个函数**（select-preflight 的 human-steered 分类器）；`tasks/DIR-132.md:70` 记录的是同一条闸在**另一个项目**拦下 `gap-effective-capacity-cgroup-cpu-memory-probe`，并指出闸源码把修法保留给作者/人——同样只在撰写侧，未覆盖本条的驱动侧。

## AC

- [x] AC1（收编 + 台账点名）：`classifyCandidate` 对一条 `unsatisfiableUnannotatedAc.hits.length > 0` 的候选返回**非空** `unfixable`，其中至少一条含命中项原文；由此经 `computeOutcomeRecords` 产出的记录 `result.detail` **非空**、**含**该原因文本、且 `!== "ineligible-not-fixed"`。用例落在 `plugin/test/promotion-driver-s03.test.mjs`（已直接测 `classifyCandidate`，15 处引用）与 `plugin/test/promotion-driver-s06.test.mjs`（已直接测 `computeOutcomeRecords`，6 处引用）；`node --test <这两个文件>` 退出 0。

- [x] AC2（升级路径，能取假）：喂 `RETRY_CAP_DEFAULT`（=3，`plugin/scripts/driver-filters.ts:229`）轮同一「不 spawn fix worker」的拦截 ⇒ 第 3 轮产出 `action:"needs-human"` 记录，且其 `result.detail` 点名原因。取假：恢复 `if (fixedIds.length > 0)` 旧守卫 ⇒ 同一用例转红（红/绿两次输出都贴进 `## Evidence`）。

- [x] AC3（负控制：不得把所有不合格都升级）：一条属于既有「可修三类」的不合格（样本：`fourArtifacts=false`）仍走原路径——产出 `action:"fix"`（spawn fix worker），**不**被新升级路径判成 `needs-human`。用例断言。

- [x] AC4（未评估态不与合格同形，硬规则 3b）：新引入的任何分类字段/取值，在任务体没有可识别 AC/DoD 段时取一个与「合格」**不同**的取值；用例断言两个取值不相等。（若实现不引入新字段，本 AC 记为 N/A 并写明理由。）

- [x] AC5（存量读数，硬规则 2）：对全仓库 `tasks/*.md` 跑一次 `judgeUnsatisfiableUnannotatedAc`，把命中条数与前 3 条实际内容贴进 `## Evidence`。零命中时，先对着一条**已知为真**的样本干跑一次证明谓词能命中（拼一条含封闭枚举词的未勾项），⛔ 不拿生产任务体当样本改。

- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-promotion-driver-blind-to-unsatisfiable-ac-block --allow-thin` 退出 0，且确实执行了 ≥1 个测试文件。（`--allow-thin` 是本仓 `.quay/config.yml` `scoped_command` 的生产 argv 形态。）

## DoD

真实落地判据不是「fixture 用例绿」：新的分类与升级路径在**本仓真实任务库**上跑过一次并留下存量读数；且**取假读数在案**——把新分支撤掉后，同一输入重新落回 `detail:"ineligible-not-fixed"` 且永不产生 `needs-human`（撤掉前后的台账/输出对照贴进 `## Evidence`）。⛔ 只加注释、只改文档不算。⛔ 不削弱 `judgeUnsatisfiableUnannotatedAc` 的 fail-closed 默认，也不给 worker 任何自我豁免加标注的路径。

## Touches

- plugin/scripts/promotion-driver.ts
- plugin/test/promotion-driver-s03.test.mjs
- plugin/test/promotion-driver-s06.test.mjs
- tasks/gap-promotion-driver-blind-to-unsatisfiable-ac-block.md

## Evidence

立案当轮的起点读数（供实现与验收对照）：

```
$ grep -c '"gap-ac264-fleet-project-scope-deployment-rotted"' .quay/promotion-outcome.jsonl   # 该 task 的台账行数
750
$ # 全部 750 行的形态（去重后只有一种）：
{"task_id":"gap-ac264-fleet-project-scope-deployment-rotted","gate":{"eligible":false,"missing":[]},"action":"skip","result":{"ok":false,"detail":"ineligible-not-fixed"},"ts":"…"}
$ # action 直方图：promote 0 · fix 0 · skip 750 · needs-human 0

$ node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --targeted gap-ac264-fleet-project-scope-deployment-rotted
"checks": {
  "fourArtifacts": true, "missingArtifacts": [], "depsReady": true, "touchesResolve": true,
  "touchesNarrow": true, "prosePrereqGap": [], "notFixture": true, "notParked": true,
  "superseded": false, "retiredMechanism": false, "compound": false, "selfTouchOk": true,
  "unsatisfiableUnannotatedAc": { "evaluated": true, "status": "hit", "hits": ["**判据在生产上真的翻 pass**：… criterion 在本轮落地后 exit 0 …"] }
}
"reason": "… · unsatisfiable-ac UNANNOTATED(<命中项原文>)"
```

存量读数（2026-10-10，全量 `tasks/*.md`，实现者须自行复跑并贴出）：

```
evaluated: 2579   not-evaluated(no AC/DoD): 74
tasks with >=1 unannotated executor-unsatisfiable item: 18   (done 6 / superseded 12)
```

### 实现与取假读数（2026-10-10；task branch `ccd8cc039`，合并 develop 后 `5b8ce285c`）

**AC1 命名台账（s06 直测 `computeOutcomeRecords`）**——由 `classifyCandidate` 产出的 `unfixable` 经台账落盘：

```
{"status":"hit","fixable":false,
 "unfixable":["unsatisfiableUnannotatedAc=[AC6 落地后复查：合入 develop 之后 sqlite3 agent 档不再增长]"],
 "ledgerDetail":"unsatisfiableUnannotatedAc=[AC6 落地后复查：合入 develop 之后 sqlite3 agent 档不再增长]"}
```
⇒ `result.detail` 非空、含原因文本、`!== "ineligible-not-fixed"`。

**AC2 升级路径（能取假）**——喂 3 轮（`RETRY_CAP_DEFAULT`）同一「不 spawn fix worker」的拦截：

- 绿：`--max-fix-retries 3 --max-rounds 3` ⇒ 第 3 轮 outcome `action:"needs-human"`，`result.detail` 含 `落地后复查`；磁盘 `status: todo → needs-human`；fix worker 计数文件**不存在**（0 spawn）。
- 红（取假：把新升级块放回 `if (fixedIds.length > 0)` 旧守卫内）：
  ```
  ✖ AC2 — a structurally-unspawnable block is ESCALATED to needs-human after RETRY_CAP_DEFAULT rounds (取假)
    AssertionError: AC2: the 3rd consecutive interception escalates to needs-human
  ℹ pass 0 / fail 1
  ```

**AC3 负控制**——`fourArtifacts=false`（可修三类）仍走原路径：

```
有 outcome `action:"fix"`（spawn fix worker，3 轮各 1 次，计数=3）；0 条 `action:"needs-human"`
```
⇒ 新升级路径**未**认领既有的可修类。

**AC4 三态（硬规则 3b）**——新字段 `unsatisfiableAcStatus ∈ {hit,clean,not-evaluated}`：无 AC/DoD 段（或闸输出缺该字段，硬规则 6）⇒ `"not-evaluated"`，与合格态 `"clean"` 断言 `notEqual`（s03）。⇒ 本 AC **非 N/A**：引入了新分类字段。

**AC5 存量读数（硬规则 2）**——`judgeUnsatisfiableUnannotatedAc` 跑全量 `tasks/*.md`（worktree 与主检出 store 读数一致）：

```
files 2654 · evaluated 2580 · not-evaluated(no AC/DoD) 74 · tasks with >=1 unannotated item = 18
前 3 条命中原文（命中即「执行者勾不了且无（待外部）」）：
- [done]       DIR-130 :: DoD2: **双证据可持久核验**——…（只计落地后的时间窗，硬规则 4 推论三）
- [done]       gap-ac282-runner-prereqs-already-present :: **AC5｜生产载体上有读数，且 AC-282 真的 exit 0。** 核法：…
- [superseded] gap-addressedtasks-conflates-topic-label-with-routing-…:: **落地后重启 meta-driver 并确认新语义出现在真实轮记录里**——…
```

**DoD 前后对照（撤掉新分类分支）**——同一注入输入（命中候选）：

| | `unsatisfiableAcStatus` | `unfixable` | 台账 `result.detail` | AC2 用例 |
|---|---|---|---|---|
| BEFORE（撤分支） | `not-evaluated` | `[]` | `ineligible-not-fixed` | **red**（永不 needs-human） |
| AFTER（本实现） | `hit` | `["unsatisfiableUnannotatedAc=[…]"]` | `unsatisfiableUnannotatedAc=[…]` | **green**（第 3 轮 needs-human） |

⇒ 撤掉前后分别为「空原因 + 永不升级」与「点名原因 + 第 3 轮升级」，对照在案。

**AC6 scoped 门**——`bash scripts/test.sh --for-task gap-promotion-driver-blind-to-unsatisfiable-ac-block --allow-thin` ⇒ `EXIT=0`，执行 2 个测试文件（`promotion-driver-s03` / `-s06`），16 pass / 0 fail。

**不变量**：⛔ 未削弱 `judgeUnsatisfiableUnannotatedAc` 的 fail-closed 默认（闸源码未改）；⛔ 未给 worker 任何自我豁免加 `（待外部）` 的路径（命中类仍拦截、不 spawn fix worker，仅升级给人）；⛔ `not-evaluated` 未折进 `clean`（硬规则 3b）。