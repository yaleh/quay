---
id: gap-arch-review-cluster-ignores-detector-flag-predicate
title: 架构复核 cluster 阶段用裸 `hardcoded>0` 取代检测器自己的阈值判定——25 簇里 8
  簇是检测器已判清白的假簇（gate-script-base.ts 10/231 在列），且代码面把 build 生成的 gitignored
  `packages/quay/plugin/`（82/729）当源文件
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

架构复核 round 2016 把 `P2-identity-gate-script-base.ts` 判为 `coincidental`，但**这个簇根本不该存在**：
检测器自己的判定已经把它清白了，而 cluster 阶段没有消费那个判定。实测比判词举的那一个实例严重得多——
**25 个 `P2-identity-*` 簇里有 8 个（32%）是检测器已判清白的假簇。**

### 一、缺陷：cluster 阶段用的是裸计数，不是检测器的判定

`identity-replication-check.ts` 对「字面量复制度」有**两套**读数：

- `table[]` 行（每实体一行）：`{entity, full, code, accessor, hardcoded, codeFiles}`（`literalReplication`，`:424-431`）
- `sharedModuleControl`（**只对 `gate-script-base.ts` 一个实体**算，`:566`）：**多一个 `flagged`**

```ts
const flagged = r.hardcoded >= threshold && r.hardcoded > r.accessor;   // :522, threshold=5
```

cluster 阶段的逐实体分支（`architecture-review-cluster.ts:125-142`）只过滤 `(row.hardcoded ?? 0) > 0`：

```
$ grep -c 'flagged' plugin/scripts/architecture-review-cluster.ts
0
```

⇒ **阈值判定整个缺席**：只要 `hardcoded > 0` 就成簇，哪怕 `hardcoded < accessor`（即「大量文件走单一访问器引用、
少数硬编码」——正是负控制要放过的形态）。上游判过、下游没读（硬规则 3b 同族：下游不读上游的判定，
就产出与「查过且合格」同形的输出）。

⚠️ **一个必须点明的结构事实**（判词写作「consumer ignores `flagged`」，字面照做会踩坑）：
**`table[]` 行上根本没有 `flagged` 字段**——它只存在于 `sharedModuleControl`（单实体）。
所以修法**不是「读 `row.flagged`」**（读不到），而是**在 cluster 侧施加同一条阈值谓词**；
两个操作数 `hardcoded`/`accessor` 行上都有，⛔ 不需要改检测器的输出 schema。

**取证时的一个陷阱，已实测**：按 `row.flagged === false` 写的判据**恒真**——字段缺席 ⇒ `undefined === false`
为假 ⇒「无泄漏」恒成立。实测该写法的干跑输出：

```
flagged=false rows: 0 []        ← 字段不存在，不是「没有清白行」
LEAK: []        EXIT=0          ← 与「一切正常」同形（硬规则 4：结构上不可能取假的量不是测量）
```

用**谓词**（`hardcoded >= 5 && hardcoded > accessor`）改写后，同一份 `--json` 上立刻取到真值：

```
table rows hardcoded>0        : 25
  flagged=true                : 17
  flagged=false               : 8
P2-identity-* clusters emitted: 25
LEAK (cleared yet emitted)    : 8  ["P2-identity-gate-script-base.ts","P2-identity-gate-script-lib.sh",
   "P2-identity-repo-root.ts","P2-identity-task-schema.ts","P2-identity-touches-orthogonality-check.ts",
   "P2-identity-touches-parser.ts","P2-identity-driver-filters.ts","P2-identity-suite-lock-slots.ts"]
EXIT=1
```

### 二、第二个成因：代码面把 build 生成的 gitignored 树算成了「源文件」

`identity-replication-check.ts:114` 的 `SKIP_DIRS` 是手工名单，不含 `packages/quay/plugin/`：

```
const SKIP_DIRS = new Set(["node_modules","vendor","fixture",".git",".quay","dist","coverage"]);
```

`packages/quay/plugin/` 是 build 产物且 gitignored（`.gitignore:26`；实测 411 个常规文件、**0 个软链**），
它与 `plugin/` 是同一批文件的**第二份拷贝** ⇒ 同一实体被数两遍，直接抬高 `code`/`hardcoded`。实测：

```
distinct codeFiles (union over table[]) : 729
packages/quay/plugin/ 前缀命中          : 82      ← 修后应为 0
```

⚠️ 覆盖面按实测分列，⛔ 不照抄判词里那三个目录（硬规则 5：来源完备性）：`.claude/` 与 `.archguard/`
同样 gitignored，但**不在本扫描器的四个根**（`walkCodeFiles()` 只从 `plugin/ packages/ experiments/ scripts/`
起步）——实测两者命中均为 **0**；它们进的是**另一个**扫描器 `deletion-closure-check.ts`
（同款字面名单，`:94`），那半边已有任务认领，见下面的 `<!-- dedup-ref -->` 段。故本任务只补
`packages/quay/plugin/`。

### 三、修法（一处修，清 8 簇）

1. **把阈值谓词上收到单一实现**：在 `identity-replication-check.ts` 导出 `isFlagged(row, threshold = 5)`
   = `hardcoded >= threshold && hardcoded > accessor`，让 `sharedModuleControl`（`:522`）与 `clusterIdentityReport`
   **共用同一份**（⛔ 不各写一遍：两份副本正是本缺陷的成因形态，
   同 `gap-identity-accessor-regex-source-computed-path` 对正则副本的处理）。
2. `clusterIdentityReport` 的逐实体分支改用它过滤（`flagged === true` 才成簇），
   ⛔ **不是把 `hardcoded > 0` 的阈值调大**——调阈值仍会把「检测器判过清白」的行留在族里，
   同一缺陷换个数字复发。
3. `SKIP_DIRS` 补 `packages/quay/plugin/`。
4. **两侧都要有能取假的反向判据**（硬规则 9：可见性 ≠ 执行）：只做第 2 条而不做「`flagged=true` 侧仍成簇」，
   等于把检测器关掉——正是 `identity-replication-check.ts:167` 注释自己担心的那件事。

<!-- dedup-ref -->
**同族但不合并**：`gap-deletion-closure-walker-respects-gitignore`（status: needs-human）认领的是**另一个扫描器**
（`deletion-closure-check.ts` 的 walker 不认 `.gitignore`）的同类输入面缺陷；两者文件面不重叠、修法各自独立，
本任务既不依赖它、也不替代它。

## AC

- [x] AC1（消费者施加阈值谓词，判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json > /tmp/ir.json 2>/dev/null` 之后跑
      `node --experimental-strip-types --input-type=module -e 'import { clusterIdentityReport } from "./plugin/scripts/architecture-review-cluster.ts"; import fs from "node:fs"; const r=JSON.parse(fs.readFileSync("/tmp/ir.json","utf8")); const ids=new Set(clusterIdentityReport(r).map(c=>c.clusterId)); const isFlagged=(x)=>(x.hardcoded??0)>=5&&(x.hardcoded??0)>(x.accessor??0); const leak=(r.table??[]).filter(x=>(x.hardcoded??0)>0&&!isFlagged(x)).map(x=>"P2-identity-"+x.entity).filter(id=>ids.has(id)); console.log("LEAK",leak.length,JSON.stringify(leak)); process.exit(leak.length?1:0);'`
      —— **修前 exit 1 / 修后 exit 0**，两次输出都贴进证据。⛔ 判据用**谓词**而非 `row.flagged`（后者字段不存在 ⇒ 恒真，见上）。
      实测（同一根 `/home/yale/work/quay`，扫 `--root` 指到含 build 生成树的主检出）：修前 `LEAK 8 ["P2-identity-gate-script-base.ts",…,"P2-identity-suite-lock-slots.ts"]` **EXIT=1**；修后 `LEAK 0 []` **EXIT=0**，8 个 id 与上文清单逐字一致。
- [x] AC2（具体读数）：修后 `P2-identity-*` 簇数 = **17**（修前 25）；上列 8 个已判清白的簇逐一不出现；对照 `P2-identity-quay-init.sh`（实测 59/62，`flagged=true`）**仍出现**。
      实测：修前 25 / 修后 17；8 个 id 在 `clusterIdentityReport` 输出里命中 **0**；`P2-identity-quay-init.sh` **仍在**（`table` 行 `hardcoded=59, accessor=3`）。
- [x] AC3（检测器没被关掉）：`--json` 里 `sharedModuleControl` 仍为 `{"entity":"gate-script-base.ts","importAccessor":231,"hardcoded":10,"flagged":false}`（逐字比对，判据本身未被放宽/改动），且 `table` 里满足 `isFlagged` 的行数 **= 17 > 0**。
      实测：`table` 里 `isFlagged` 行数 = **17**（>0，未被关掉）；`hardcoded` = **10**、`flagged` = **false** 逐字不变。
      ⚠️ **`importAccessor` 是 230 而非 231，差的 1 个正是 AC4 修法的正确后果**：被排除的 build 生成树里有**同一 accessor 引用的重复拷贝**（实测：只施加该前缀排除、其余不动，`accessor` 233→232、移除 193 个文件全部落在该前缀下、其中 4 个提及 `gate-script-base.ts` 的副本在源树 `plugin/scripts/` 均有同名对照）。**阈值谓词本身逐字未动**（`isFlagged` + `threshold=5`），⛔ 判据未被放宽。
- [x] AC4（代码面不再含 build 生成树）：`--json` 全部 `table[].codeFiles` 取并集后 `packages/quay/plugin/` 前缀命中 **= 0**（实测修前 82）；佐证 `git ls-files packages/quay/plugin | wc -l` = 0（该树是 gitignored 产物而非源）。
      实测：修后命中 **= 0**（修前 82）；并集 729 → **655**；`git ls-files packages/quay/plugin | wc -l` = **0**。
- [x] AC5（回归有守卫，能取假）：`plugin/test/identity-replication-check.test.mjs` 新增 `isFlagged` 的直接单测（真样本两态：`{hardcoded:10,accessor:231}` → false、`{hardcoded:59,accessor:3}` → true）；`plugin/test/architecture-review-cluster.test.mjs` 新增两条——(a) `hardcoded=10,accessor=231` 的行**不产出**该簇；(b) `hardcoded=59,accessor=3` 的行**产出**该簇。**红/绿两次实跑**：(a) 的断言在删除/反转 `isFlagged` 过滤时必须变红——把两次输出贴进证据。
      实测：新增 4 条（`isFlagged` 真样本两态 + cluster 侧 (a)/(b) + 一条「只动 `accessor`、成簇与否必须翻转」的差分反向控制）。**红**：把过滤换回旧的裸 `(row.hardcoded ?? 0) > 0` ⇒ **2 条变红**（AC5(a) 与差分反向控制），(b) **仍绿**——正是「只过滤、不加固 flagged=true 侧」的形态；**绿**：恢复后 `15/15`、`13/13` 全绿。
- [x] AC6（单一实现的对称性）：`grep -c 'hardcoded > .*accessor' plugin/scripts/identity-replication-check.ts` 命中只为 `isFlagged` 一处（`sharedModuleControl` 与 cluster 侧都经它，不再各写一份）。
      实测：`grep -c` = **1**，唯一命中是 `isFlagged` 的实现行（`return hardcoded >= threshold && hardcoded > accessor;`）。为使这个裸计数真的等于「实现份数」，把两处**注释**里对该谓词的逐字复述改写为等义表述——否则裸计数会把**文档**算成第二个实现（硬规则 2：按位置判定，注释不是代码位置）。

## DoD

- `identity-replication-check.ts` 导出并用上 `isFlagged`（`sharedModuleControl` 与 cluster 侧共用一份），
  `architecture-review-cluster.ts` 的逐实体分支以它为判据，`SKIP_DIRS` 含 `packages/quay/plugin/`——三处均提交。
- **真实载体上验过**（DIR-026 Reading A：fixture 必要不充分，⛔ 不是「测试绿了」）：下一次架构复核轮写入
  `.quay/architecture-review-round.jsonl` 的记录里，`clusters[]` **不含**上列 8 个已清白簇，且该轮
  `clusterCount` **< 27**（round 2016 实测值）。给出该轮的 `round` 号 + `clusterCount` 两个实际读数。
- AC5(b) 的反向控制与 AC5(a) 的红同批留痕：只过滤不加固 `flagged=true` 侧 = 关掉检测器。
- 收尾在 `tasks/<id>.md` 记录修前/修后两组读数（25→17、82→0），并向 `docs/epistemology-casebook.md`
  追加同族锚点：**上游判过、下游不读 ⇒ 输出与「查过且合格」同形**（硬规则 3b）。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/identity-replication-check.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- docs/epistemology-casebook.md
- tasks/gap-arch-review-cluster-ignores-detector-flag-predicate.md

## 收尾记录（2026-09-21）

### 修前 / 修后两组读数（同一份输入：`--root /home/yale/work/quay`，该树含 gitignored 的 build 生成树）

| 量 | 修前 | 修后 |
|---|---|---|
| AC1 `LEAK`（已判清白却仍成簇） | **8**（exit 1） | **0**（exit 0） |
| AC2 `P2-identity-*` 簇数 | **25** | **17** |
| AC3 `table` 中 `isFlagged` 行数 | 17 | 17 |
| AC3 `sharedModuleControl` | `importAccessor=231, hardcoded=10, flagged=false` | `importAccessor=230, hardcoded=10, flagged=false`（⚠️ 见 AC3 注） |
| AC4 `packages/quay/plugin/` 前缀命中 | **82** | **0** |
| AC4 `table[].codeFiles` 并集 | 729 | 655 |
| AC6 `grep -c 'hardcoded > .*accessor'` | 2（1 实现 + 1 注释） | **1**（只实现） |

### 真实载体（DIR-026 Reading A）

用**修后的**三检测器（worktree 的 `plugin/scripts`）+ **注入 judge**（被测对象是机械聚类与判词载体，
LLM 措辞不在其列；其余每一环都是生产路径）跑了一次真正的架构复核轮：扫描面 = 主检出
（`--root /home/yale/work/quay`，那里才有 build 生成树），判词载体写在 worktree 的
`.quay/architecture-review-round.jsonl`。该轮记录的实际读数：

- `round` = **0**，`state` = **judged**，`clusterCount` = **19**（< 27，即判词引用的 round 2016 值）
- `clusters[]` 里 `P2-identity-*` = **17**；上列 **8 个已判清白的簇命中 0**；`P2-identity-quay-init.sh` **在场**
- 说明：`round` 读的是 `.quay/verification-round.jsonl` 的行数，该 worktree 是全新载体（无此文件）⇒ 0；
  主检出当前为 2016（即本任务判词引用的那一轮），故生产上的下一轮应为 2017 且 `clusters[]` 同构
  （输入与代码同，只差计数器）。

### casebook 锚点

已向 `docs/epistemology-casebook.md` 追加同族锚点
`### 3b-2 上游判过、下游不读 ⇒ 输出与「查过且合格」同形（2026-09-21）`（归 `## rule-3`）：
含实测规模（25 簇里 8 簇）、`row.flagged` 字段不存在 ⇒ 判据恒真的第二层陷阱（硬规则 4 同源）、
「谓词单一实现 + 两侧都要能取假」的共同修法、第二个成因（按**路径前缀**而非裸名排除，
裸名 `plugin` 会过度剪枝）、以及「AC 里逐字写死的读数可能本身就是缺陷的产物」（231→230）这一记。

### 第二轮（2026-09-21，suite 红修复）：谓词落地暴露了一条**陈旧 fixture**，已改 fixture 而非改期望

上一轮 `exited-not-landed`，真因是 suite 红（非环境）：`plugin/test/quality-gate-driver.test.mjs` 两条断言
`3 !== 4`。**直接成因是本任务的谓词修复**——该文件的 fake identity 行原写作：

```
table:[{entity:"session-liveness.sh", code:5, hardcoded:4, ...}]
```

`hardcoded:4` **低于** `isFlagged` 的阈值 5 ⇒ 修后该行被判清白 ⇒ `P2-identity-session-liveness.sh`
不再成簇 ⇒ `judgedCount` 4→3、`actionabilityNotEvaluated` 4→3。**这条 fixture 正是本缺陷的样本**：
它过去只因旧的裸 `hardcoded > 0` 判据才成簇。

**为什么修 fixture 而不是把期望改成 3**：同文件的 judge fixture 仍按 `P2-identity-session-liveness.sh`
给判词，且 `submittedKeys` 断言依赖它——下调期望会连带削掉该测试对 P2 簇的覆盖面，是把缺陷固化成期望。
改后取真实读数形态（对照生产 `P2-identity-quay-init.sh` 实测 59 hardcoded / 3 accessor）：

```
table:[{entity:"session-liveness.sh", code:62, hardcoded:59, accessor:3, ...}]
```

**读数**：该文件修前 `29 pass / 2 fail` ⇒ 修后 **`31 pass / 0 fail`**（确定性复现，⛔ 非 flaky）。

**兄弟实例已按硬规则 5b 逐一排查**（同一谓词的其它适用点）：`grep` 全部 emit identity `table` 行的 fixture——
本任务自己的 `architecture-review-cluster.test.mjs:53` 已是 `hardcoded:5, accessor:0`（越过阈值，正确）；
`probe-routine.test.mjs` 与 `driver-config.test.mjs` 的注入命令 emit 空行/无输出 ⇒ 不受影响。
**全库唯一受影响的消费点就是上面那一处。**

⛔ 本文件**不被** `## Touches` 原先覆盖，故本轮把它补进 Touches（anti-drift 硬失败实测：
`out-of-declared: task wrote plugin/test/quality-gate-driver.test.mjs`）。