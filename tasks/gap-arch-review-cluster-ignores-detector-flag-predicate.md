---
id: gap-arch-review-cluster-ignores-detector-flag-predicate
title: 架构复核 cluster 阶段用裸 `hardcoded>0` 取代检测器自己的阈值判定——25 簇里 8
  簇是检测器已判清白的假簇（gate-script-base.ts 10/231 在列），且代码面把 build 生成的 gitignored
  `packages/quay/plugin/`（82/729）当源文件
status: todo
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
   = `hardcoded >= threshold && hardcoded > accessor`，让 `sharedModuleControl`（`:522`）与
   `clusterIdentityReport` **共用同一份**（⛔ 不各写一遍：两份副本正是本缺陷的成因形态，
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

- [ ] AC1（消费者施加阈值谓词，判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json > /tmp/ir.json 2>/dev/null` 之后跑
      `node --experimental-strip-types --input-type=module -e 'import { clusterIdentityReport } from "./plugin/scripts/architecture-review-cluster.ts"; import fs from "node:fs"; const r=JSON.parse(fs.readFileSync("/tmp/ir.json","utf8")); const ids=new Set(clusterIdentityReport(r).map(c=>c.clusterId)); const isFlagged=(x)=>(x.hardcoded??0)>=5&&(x.hardcoded??0)>(x.accessor??0); const leak=(r.table??[]).filter(x=>(x.hardcoded??0)>0&&!isFlagged(x)).map(x=>"P2-identity-"+x.entity).filter(id=>ids.has(id)); console.log("LEAK",leak.length,JSON.stringify(leak)); process.exit(leak.length?1:0);'`
      —— **修前 exit 1 / 修后 exit 0**，两次输出都贴进证据。⛔ 判据用**谓词**而非 `row.flagged`（后者字段不存在 ⇒ 恒真，见上）。
- [ ] AC2（具体读数）：修后 `P2-identity-*` 簇数 = **17**（修前 25）；上列 8 个已判清白的簇逐一不出现；对照 `P2-identity-quay-init.sh`（实测 59/62，`flagged=true`）**仍出现**。
- [ ] AC3（检测器没被关掉）：`--json` 里 `sharedModuleControl` 仍为 `{"entity":"gate-script-base.ts","importAccessor":231,"hardcoded":10,"flagged":false}`（逐字比对，判据本身未被放宽/改动），且 `table` 里满足 `isFlagged` 的行数 **= 17 > 0**。
- [ ] AC4（代码面不再含 build 生成树）：`--json` 全部 `table[].codeFiles` 取并集后 `packages/quay/plugin/` 前缀命中 **= 0**（实测修前 82）；佐证 `git ls-files packages/quay/plugin | wc -l` = 0（该树是 gitignored 产物而非源）。
- [ ] AC5（回归有守卫，能取假）：`plugin/test/identity-replication-check.test.mjs` 新增 `isFlagged` 的直接单测（真样本两态：`{hardcoded:10,accessor:231}` → false、`{hardcoded:59,accessor:3}` → true）；`plugin/test/architecture-review-cluster.test.mjs` 新增两条——(a) `hardcoded=10,accessor=231` 的行**不产出**该簇；(b) `hardcoded=59,accessor=3` 的行**产出**该簇。**红/绿两次实跑**：(a) 的断言在删除/反转 `isFlagged` 过滤时必须变红——把两次输出贴进证据。
- [ ] AC6（单一实现的对称性）：`grep -c 'hardcoded > .*accessor' plugin/scripts/identity-replication-check.ts` 命中只为 `isFlagged` 一处（`sharedModuleControl` 与 cluster 侧都经它，不再各写一份）。

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
- docs/epistemology-casebook.md
- tasks/gap-arch-review-cluster-ignores-detector-flag-predicate.md
