---
id: gap-identity-replication-requires-structural-relation
title: identity-replication 判据是关键词在场计数：多行 import 结构性关系漏算 11 处、路径调用/注释行被计成
  hardcoded（ready-pool-check.ts 行 52 个「hardcoded」里 0 个是复制），且 17 簇里 14 簇判词在
  accessor>0 时仍断言 without a single accessor
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

架构复核 round 2023 把 `P2-identity-ready-pool-check.ts` 判为 `coincidental`，判词的判据逐字是
「identity replication: "ready-pool-check.ts" named in 52 code file(s) without a single accessor」。
**这条判据是关键词在场计数，不是身份复制测量** —— 它里面的两个可证否断言，立案时实跑都不成立。
修的是**判据的产地（检测器）**，⛔ 不是在聚类侧打补丁。判词给的方向：**要求结构性关系
（import / re-export），并把「按路径调用」「测试/夹具字符串」「注释与文档」降为非证据。**
一个修法覆盖全部 `P2-identity-*` 簇：立案时 `isFlagged`（`hardcoded>=5 && hardcoded>accessor`）
判红实体数 = **17**，与复核产出的 17 个 `P2-identity-*` 簇一致。

### 一、「without a single accessor」是写死的字面量，与行上的 `accessor` 无关

`plugin/scripts/architecture-review-cluster.ts:167`：

    label: `identity replication: "${entity}" named in ${row.hardcoded} code file(s) without a single accessor`

`${row.hardcoded}` 是变量，**「without a single accessor」不是**。实测（AC4 的命令）：
**17 个 `P2-identity-*` 簇里有 14 个在 `accessor > 0` 时照样这么断言** —— 最极端的是
`P2-identity-driver-runtime.ts`（`accessor=26`），`P2-identity-ready-pool-check.ts` 自己 `accessor=8`。
⇒ 读数与判词矛盾时仍输出同一句话（硬规则 3b 同形：判「查过且合格」与「没查成」共用输出）。

### 二、被计成 `hardcoded` 的文件里，结构性关系与「使用形态」混在一起

立案时实跑 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json`，
`ready-pool-check.ts` 行：`full=82  code=60  accessor=8  hardcoded=52`。
对它 `codeFiles` 的 60 个文件逐个按「与 ready-pool-check.ts 的关系」分类：

| 类别 | 数 | 与「同一运行时实体被独立命名/独立判定」的关系 |
|---|---|---|
| A 有 `import … from` / `require`（结构性关系） | **19** | 正是该实体被**单一访问器**引用；检测器只认其中 **8** 个 = `accessor` |
| B 全文件无任何 import，只有引号内路径字面量 | **36** | spawn argv / `path.resolve(__dirname, …, "scripts", "ready-pool-check.ts")` / 测试夹具字符串 —— 该脚本被**调用**的形态 |
| C 逐行核过后提及全在注释行 | 4（+1 见下） | 位置掩码该剔而没剔 |
| D 其它 | 1 | `plugin/scripts/runner-static-gate.ts` |

**A 的 11 个结构性关系为什么漏算**：`accessorRegexSource()` 的 import 分支写成
`import\s+[^'"\n]*?from\s*["']…` —— `[^'"\n]` **排除换行**，于是本仓主流的多行命名导入读不进去。
实测（AC1 的命令）：单行 `import { x } from "./ready-pool-check.ts";` → `true`；
多行 `import {\n  a,\n  b,\n} from "./ready-pool-check.ts";` → **`false`**。

**C 的实例（逐字，每处都在注释行，却全部被计进 `codeFiles`）**：

- `plugin/scripts/task-ops.ts`（第 5/19/26/158 行）
- `plugin/scripts/strategic-doc-staleness-check.ts`（19/55/209）
- `plugin/scripts/touches-orthogonality-check.ts`（161/407/420/451/475）
- `packages/quay/scripts/build-plugin-dist.mjs`（141/145）

上表 C 记 4 是因为分类正则把 `task-ops.ts` 归进了 B（第 158 行 `…\`delivery-critical\` label (moved from ready-pool-check.ts…` 里的反引号被当成引号）——**逐行核后这 4 处提及也全在注释行，故注释行实例实为 5 个**。
其中 `task-ops.ts:158` 落在 `/** … */` 块注释内，而 `tsCommentMask()` 在该处返回 **0（当代码算）**；
**根因未诊断**（该掩码被 `deletion-closure-check.ts:38` 复用，P1 面可能同病）。⇒ 本任务要求
**先定位再修**，⛔ 不以「疑似反引号/模板串让词法器失步」这类假说当结论（硬规则 4 推论四）。

### 三、修法方向（判词给的方向，实现细节归实现者）

`hardcoded` 的定义要改成：**该文件含对该实体的代码位字面量，且【全文件不存在】指向同一实体的结构性关系
（import / re-export / require）**。相应地：

- 结构性判定要能跨行 —— 把 `[^'"\n]` 这类行内锚点换成结构判定，⛔ 不是把正则放宽到吞掉一切；
- 按路径调用（spawn argv、`path.resolve` 拼出的脚本路径）、测试/夹具字符串 ⇒ 非证据；
- 注释与文档 ⇒ 非证据，且位置掩码要能**取假**：`task-ops.ts:158` 这类漏计修掉后该文件不得再进 `codeFiles`；
- 逐文件的「结构性关系 vs 硬编码」二选一，只有在掩码与正则都判对时才成立（上面三处都会把它判错）。

⚠️ 同族耦合（硬规则 5b：修一处 ≠ 只此一处）：掩码/谓词被 `deletion-closure-check.ts`（P1）与
`architecture-review-cluster.ts` 复用，修后要核这两面读数有没有跟着变（**会变是对的，静默不变才是漏修**）。

<!-- dedup-ref -->
同族已 done 任务，**不是本任务的前提**，只作溯源：`gap-archguard-p2-identity-replication-checker`
（检测器首版落地）、`gap-identity-accessor-regex-source-computed-path`（accessor 正则补 shell 的
`source` / 变量两族写法，与本条修的「import 结构性判定」不同面）、
`gap-arch-review-cluster-ignores-detector-flag-predicate`（cluster 侧改用 `isFlagged`；本条修的是
检测器侧判据本身）。

## AC

- [ ] AC1 多行 `import … from` 结构性关系被认成 accessor。命令（今天 `exit 1`，修后须 `exit 0`）：
      `node --experimental-strip-types -e 'import { accessorRegexSource } from "./plugin/scripts/identity-replication-check.ts"; const re = new RegExp(accessorRegexSource("ready-pool-check.ts")); const ml = "import {\n  a,\n  b,\n} from \"./ready-pool-check.ts\";"; console.log("multi-line import recognized:", re.test(ml)); process.exit(re.test(ml) ? 0 : 1);'`
- [ ] AC2 只有路径调用的文件不再被计入。命令（今天 `exit 1`，修后须 `exit 0`）：
      `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const row=r.table.find(x=>x.entity==="ready-pool-check.ts");const pathOnly=["plugin/test/driver-filters.test.mjs","plugin/test/suite-bucket-select.test.mjs","plugin/test/direct-to-develop-bypass-check.test.mjs"];const still=pathOnly.filter(f=>(row.codeFiles||[]).includes(f));console.log("path-invocation-only files still counted:",still.length,still.join(" "));process.exit(still.length?1:0)})'`
- [ ] AC3 注释行提及不再被计入（5 个逐字实例，今天 `exit 1`，修后须 `exit 0`）—— 同 AC2 的管道，断言 `plugin/scripts/task-ops.ts`、`plugin/scripts/strategic-doc-staleness-check.ts`、`plugin/scripts/touches-orthogonality-check.ts`、`packages/quay/scripts/build-plugin-dist.mjs` 均不在 `row.codeFiles` 里。
- [ ] AC4 判词不再在 `accessor > 0` 时断言「without a single accessor」。命令（今天 **14** 条、`exit 1`，修后须 0 条、`exit 0`）：
      `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json > /tmp/ir.json && node --experimental-strip-types -e 'import fs from "node:fs"; import { clusterIdentityReport } from "./plugin/scripts/architecture-review-cluster.ts"; const r = JSON.parse(fs.readFileSync("/tmp/ir.json","utf8")); const rows = new Map((r.table||[]).map(x=>["P2-identity-"+x.entity,x])); const bad = clusterIdentityReport(r).filter(c=>c.clusterId.startsWith("P2-identity-") && /without a single accessor/.test(c.label) && ((rows.get(c.clusterId)?.accessor)??0) > 0); console.log("false-exclusivity labels:", bad.length); process.exit(bad.length?1:0);'`
- [ ] AC5 负控制不退化：`sharedModuleControl`（`gate-script-base.ts`）仍 `flagged === false`，检测器 CLI 仍 `exit 0` 产出报告（observer 语义不变）。
- [ ] AC6 存量读数对照（硬规则 2/3b：不许把「没有复制」与「没查成」混同）：修后重跑并把三个读数贴进本任务体 —— ①`isFlagged` 判红实体数（立案时 **17**）；②`ready-pool-check.ts` 行 `hardcoded`（立案时 **52**）；③**每一个存活判红行**都打印出 ≥1 个「无结构性关系的代码位字面量」样本（前 3 条实际内容）。
- [ ] AC7 测试：`bash scripts/test.sh plugin/test/identity-replication-check.test.mjs plugin/test/architecture-review-cluster.test.mjs plugin/test/deletion-closure-check.test.mjs` `exit 0`；且新增用例对【修前】实现为红（负控制：证明它真的测到了这个缺陷，而不是断言一个恒真的量）。
- [ ] AC8 同族耦合面核对：掩码/谓词改动后，`deletion-closure-check.ts`（P1）读数有无变化给出实测（有变化 ⇒ 记新值；无变化 ⇒ 贴出对比读数），并据此判断 `plugin/scripts/capability-catalog-declarations.json` 里 `identity-replication-check.ts` 的声明文本（当前写的是「literal-replication degree … import/source single-accessor distinguished from hardcoded string literals」）是否需要同步。

## DoD

判据改在**检测器本体**（`identity-replication-check.ts` 的 `accessorRegexSource` / `literalReplication` /
`replicationTable` / 位置掩码），外加 `architecture-review-cluster.ts` 的判词不再输出与读数矛盾的断言。
真实落地 = 修后按 AC1–AC4 的四条命令实跑，四条的读数分别是「recognized: true」「0 / 0 文件」「0 条
false-exclusivity」，且 AC6 的三个前后对照读数（17 → 新值、52 → 新值、每个存活行的样本）**贴进本任务体**；
AC7 的测试在修前实现上红、修后绿。仅有测试通过不算落地 —— 判据必须能把「查过且合格」与「没查成」
分开（硬规则 3b），AC4 就是那条判据的载体。

## Touches

- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/architecture-review-cluster.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/identity-replication-check.test.mjs`
- `plugin/test/architecture-review-cluster.test.mjs`
- `plugin/test/deletion-closure-check.test.mjs`
- `tasks/gap-identity-replication-requires-structural-relation.md`
