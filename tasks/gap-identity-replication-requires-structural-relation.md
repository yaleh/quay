---
id: gap-identity-replication-requires-structural-relation
title: identity-replication 判据是关键词在场计数：多行 import 结构性关系漏算 11 处、路径调用/注释行被计成
  hardcoded（ready-pool-check.ts 行 52 个「hardcoded」里 0 个是复制），且 17 簇里 14 簇判词在
  accessor>0 时仍断言 without a single accessor
status: done
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

- [x] AC1 多行 `import … from` 结构性关系被认成 accessor。命令（今天 `exit 1`，修后须 `exit 0`）：
      `node --experimental-strip-types -e 'import { accessorRegexSource } from "./plugin/scripts/identity-replication-check.ts"; const re = new RegExp(accessorRegexSource("ready-pool-check.ts")); const ml = "import {\n  a,\n  b,\n} from \"./ready-pool-check.ts\";"; console.log("multi-line import recognized:", re.test(ml)); process.exit(re.test(ml) ? 0 : 1);'`
- [x] AC2 只有路径调用的文件不再被计入。命令（今天 `exit 1`，修后须 `exit 0`）：
      `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const row=r.table.find(x=>x.entity==="ready-pool-check.ts");const pathOnly=["plugin/test/driver-filters.test.mjs","plugin/test/suite-bucket-select.test.mjs","plugin/test/direct-to-develop-bypass-check.test.mjs"];const still=pathOnly.filter(f=>(row.codeFiles||[]).includes(f));console.log("path-invocation-only files still counted:",still.length,still.join(" "));process.exit(still.length?1:0)})'`
- [x] AC3 注释行提及不再被计入（5 个逐字实例，今天 `exit 1`，修后须 `exit 0`）—— 同 AC2 的管道，断言 `plugin/scripts/task-ops.ts`、`plugin/scripts/strategic-doc-staleness-check.ts`、`plugin/scripts/touches-orthogonality-check.ts`、`packages/quay/scripts/build-plugin-dist.mjs` 均不在 `row.codeFiles` 里。
- [x] AC4 判词不再在 `accessor > 0` 时断言「without a single accessor」。命令（今天 **14** 条、`exit 1`，修后须 0 条、`exit 0`）：
      `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json > /tmp/ir.json && node --experimental-strip-types -e 'import fs from "node:fs"; import { clusterIdentityReport } from "./plugin/scripts/architecture-review-cluster.ts"; const r = JSON.parse(fs.readFileSync("/tmp/ir.json","utf8")); const rows = new Map((r.table||[]).map(x=>["P2-identity-"+x.entity,x])); const bad = clusterIdentityReport(r).filter(c=>c.clusterId.startsWith("P2-identity-") && /without a single accessor/.test(c.label) && ((rows.get(c.clusterId)?.accessor)??0) > 0); console.log("false-exclusivity labels:", bad.length); process.exit(bad.length?1:0);'`
- [x] AC5 负控制不退化：`sharedModuleControl`（`gate-script-base.ts`）仍 `flagged === false`，检测器 CLI 仍 `exit 0` 产出报告（observer 语义不变）。
- [x] AC6 存量读数对照（硬规则 2/3b：不许把「没有复制」与「没查成」混同）：修后重跑并把三个读数贴进本任务体 —— ①`isFlagged` 判红实体数（立案时 **17**）；②`ready-pool-check.ts` 行 `hardcoded`（立案时 **52**）；③**每一个存活判红行**都打印出 ≥1 个「无结构性关系的代码位字面量」样本（前 3 条实际内容）。
- [x] AC7 测试：`bash scripts/test.sh plugin/test/identity-replication-check.test.mjs plugin/test/architecture-review-cluster.test.mjs plugin/test/deletion-closure-check.test.mjs` `exit 0`；且新增用例对【修前】实现为红（负控制：证明它真的测到了这个缺陷，而不是断言一个恒真的量）。
- [x] AC8 同族耦合面核对：掩码/谓词改动后，`deletion-closure-check.ts`（P1）读数有无变化给出实测（有变化 ⇒ 记新值；无变化 ⇒ 贴出对比读数），并据此判断 `plugin/scripts/capability-catalog-declarations.json` 里 `identity-replication-check.ts` 的声明文本（当前写的是「literal-replication degree … import/source single-accessor distinguished from hardcoded string literals」）是否需要同步。

## DoD

判据改在**检测器本体**（`identity-replication-check.ts` 的 `accessorRegexSource` / `literalReplication` /
`replicationTable` / 位置掩码），外加 `architecture-review-cluster.ts` 的判词不再输出与读数矛盾的断言。
真实落地 = 修后按 AC1–AC4 的四条命令实跑，四条的读数分别是「recognized: true」「0 / 0 文件」「0 条
false-exclusivity」，且 AC6 的三个前后对照读数（17 → 新值、52 → 新值、每个存活行的样本）**贴进本任务体**；
AC7 的测试在修前实现上红、修后绿。仅有测试通过不算落地 —— 判据必须能把「查过且合格」与「没查成」
分开（硬规则 3b），AC4 就是那条判据的载体。

## Evidence

判据改在**检测器本体**（`identity-replication-check.ts`）与 **cluster 判词**（`architecture-review-cluster.ts`）。
以下读数全部实跑，命令逐字取自本任务的 AC 命令。

### AC1 多行命名导入被认成 accessor

    $ node --experimental-strip-types -e 'import { accessorRegexSource } from "./plugin/scripts/identity-replication-check.ts"; const re = new RegExp(accessorRegexSource("ready-pool-check.ts")); const ml = "import {\n  a,\n  b,\n} from \"./ready-pool-check.ts\";"; console.log("multi-line import recognized:", re.test(ml)); process.exit(re.test(ml) ? 0 : 1);'
    multi-line import recognized: true          # exit 0
    # 修前同一命令: false / exit 1

修法不是放宽正则，而是把行内锚点 `[^'"\n]` 换成**结构字符集** `CLAUSE = [\w$\s{}*,]*?`（标识符 / 空白 /
花括号 / 逗号 / `*` —— 命名导入子句的全部可能），并让判定跑在 `blankComments()` 抹平注释后的视图上。
两条结构性护栏仍在正则里且可证伪：**读不进引号**（⇒ 每个 import 语句的 specifier 都拦住一次，绝不
吞掉另一个 import 的 specifier）与**读不进 `;`**（语句边界）。新增 re-export 与无 `from` 的副作用
import 两族；`export function …` 不接（否则它会跨语句扫到下一个真 import 的 `from`）。

### AC2 / AC3 路径调用与注释行不再计入

    $ node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json | node -e '…'
    path-invocation-only files still counted: 0        # 修前 3 / 3
    comment-mention files still counted: 0             # 修前 4 / 4

AC3 的**实测根因**（本任务要求先定位再修，⛔ 不以假说当结论）：`tsCommentMask()` 不认识**正则字面量**。
`task-ops.ts:97` 的 `s.trim().replace(/^["']|["']$/g, "")` 里，`["']` 的两个引号被配成一对「字符串」后，
**紧跟的 `'` 打开了一个跨行的单引号串**，把其后所有注释（含 `:158` 那处 `/** … ready-pool-check.ts … */`）
都留在字符串态里 ⇒ 位置掩码把它们标成**代码**。四个 AC3 文件的**首次掩码分叉点逐一无例外**落在一个
含引号的正则字面量上（`task-ops.ts:97`、`strategic-doc-staleness-check.ts`、`touches-orthogonality-check.ts`
的 `match(/^role:\s*["']?…/)`、`build-plugin-dist.mjs` 的 `dirname \"\$0\"` 正则）。修法是给字面量扫描加
`regexLiteralEnd()`：**同行**找未转义、且不在 `[…]` 字符类内的闭合 `/`（ECMAScript 的正则字面量不含行
终止符 ⇒ 同行找不到闭合就说明判错了，退回普通字符，绝不跨行吞代码）。

按路径调用之所以**非证据**（§三）：一个实体被**调用**时必然要写出它住在哪 —— 那是位置知识，正是单一
访问器要收敛掉的那一半；「身份复制」问的是它被**独立命名/独立判定**了几次。两个形态：
A **路径尾**（`…/ready-pool-check.ts`，前一个字符是路径分隔符）；B **实参位**（实体名整段是一个字符串
字面量，且紧邻的前一个非空白字符是 `(` / `,` / `[` ⇒ 被**交给**某个调用：`path.join(root, "plugin",
"scripts", X)`、`resolveKernelSibling(X)`、spawn argv）。⛔ 反向边界同时钉住：**文本里的裸 basename 仍是
证据**（`echo "shared-lib.sh"`、`"Usage: node workflow-event-schema.mjs …"`、`<h2>resource-gate.sh</h2>`），
`plugin/test/identity-replication-check.test.mjs` 的 string-only / comment-tail 两条负控制钉的就是这一点。

### AC4 判词不再与读数矛盾

    false-exclusivity labels: 0                          # 修前 14（17 个 P2-identity-* 簇里）

判词改成两态：`accessor === 0` 才输出「without a single accessor」；`accessor > 0` 时输出两侧真实读数。
**两半都留了否证**（`plugin/test/architecture-review-cluster.test.mjs`）：accessor>0 **不得**断言独占，
accessor=0 **必须**断言 —— 后者否证「把这句话删掉」冒充修法。

### AC5 负控制不退化

    sharedModuleControl: {"entity":"gate-script-base.ts","importAccessor":233,"hardcoded":4,"flagged":false}
    detector CLI exit=0         # observer 语义不变

### AC6 存量读数对照（三个读数，前 3 条实际内容）

修后命令：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json`
（与立案时同一读数面、同一默认 `--limit 25`）：

| 读数 | 立案时 | 修后 |
|---|---|---|
| ① `isFlagged` 判红实体数（= 默认表里的 P2-identity-* 簇数） | **17** | **5** |
| ② `ready-pool-check.ts` 行 `hardcoded`（`code`／`accessor`） | **52**（code=60／accessor=8） | **5**（code=15／accessor=10） |

③ **每一个存活判红行都取出了 ≥1 个样本**（`hardcodedSamples`，随计数同源产出，cap 3）：

    -- quay-init.sh code=22 accessor=2 hardcoded=20
         packages/quay/scripts/build-plugin-dist.mjs:810  const isQuayInit = path.basename(f) === "quay-init.sh";
         packages/quay/src/cli/help.ts:238  default for <name>: it is supplied by the caller (the shipped quay-init.sh
         packages/quay/src/cli/init.ts:56  default for <name>: it is supplied by the caller (the shipped quay-init.sh
    -- runner-static-gate.ts code=16 accessor=1 hardcoded=15
         packages/quay/scripts/package.sh:180  find "${PLUGIN_DEST}/scripts" … -name '*.ts' ! -name 'runner-static-gate.ts' -delete
         plugin/scripts/checker-mutation-check.sh:603  echo "…: RED — the manifest source (runner-static-gate.ts / scripts/test.sh / …
         plugin/scripts/crystallization-half-life.ts:774  `…（scripts/test.sh / runner-static-gate.ts / .quay/config.yml）: ` +
    -- resource-gate.sh code=15 accessor=0 hardcoded=15
         packages/quay/src/serve-system.ts:109  …{ gate: "<code>resource-gate.sh --json</code>", budget: …
         packages/quay/src/serve-system.ts:112  <h2>resource-gate.sh</h2>
         packages/quay/test/serve-ac95-views.test.mjs:524  test("AC99 — resource-gate.sh/process-budget.sh --json are valid production JSON…
    -- quay-launch.sh code=15 accessor=0 hardcoded=15
         packages/quay/src/init.ts:606  "# 裸机 / 未迁移目标没有 dev-tree 根 .quay/profiles.yml 时，quay-launch.sh 回退到本文件（同 settings 的",
         packages/quay/src/init.ts:651  "    # 三个 role 各写一份（⛔ 不用 YAML 锚点——本文件被 quay-launch.sh 的 python3+yaml 与 TS 的",
         packages/quay/test/serve-handlers.test.mjs:1921  assert.equal(spec.argv[2], "task-worker", "profile = quay-launch.sh role (first positional)");
    -- task-status-drift-check.ts code=19 accessor=7 hardcoded=12
         experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh:75  ok "stranded-branch check unavailable (task-status-drift-check.ts --stranded silent or errored)"
         experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts:1064  …helpExit("usage: node task-status-drift-check.ts [--json] …
         packages/quay/src/serve-board.ts:126  …html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · …

取不出样本的判红行数 = **0**（若出现即判据故障，报告里也会就地打出这一行）。剩下 5 行的样本都是
产品文案 / UI 标签 / 用法串 / shell 脚本里对**另一个**脚本的命名，是真复制的形态。

**如实更正立案叙述里的两处数字**（硬规则 2：引用计数前先看命中的是不是我要的）：本仓真正经结构性
关系引用 `ready-pool-check.ts` 的文件是 **10** 个（修前检测器认 8 个），**不是** 表里写的 19；被
「多行命名导入读不进去」这一条漏算的是 **2** 个（`plugin/scripts/slot-refill.ts` 那个 30+ 行、内部夹
注释的导入块，与 `plugin/test/helpers/ready-pool-check-harness.mjs`），**不是 11**。立案时把「文件里有
import 语句（任意）」当成了「该实体被 import」——那是个更宽的谓词（实测 59 个文件）。判据本身（结构性
关系 vs 使用形态）不受影响，被更正的是这段叙述的基数。

### AC7 测试

    $ bash scripts/test.sh plugin/test/identity-replication-check.test.mjs plugin/test/architecture-review-cluster.test.mjs plugin/test/deletion-closure-check.test.mjs
    ℹ tests 45   ℹ pass 45   ℹ fail 0        # exit 0（新增 7 条）

修前红控制（把两个源文件 `git stash` 回修前版本后实跑）：

    AC1 命令: multi-line import recognized: false / exit 1
    AC2 命令: path-invocation-only files still counted: 3
    AC3 命令: comment-mention files still counted: 4
    AC4 命令: P2-identity clusters: 17 | false-exclusivity labels: 14
    AC6②: ready-pool-check.ts hardcoded = 52；hardcodedSamples = undefined（字段缺席）
    逐例探针（只用修前就有的导出）: 块注释里的提及 mask = 0（当作代码）；多行导入 false；
      只按路径调用的文件 code/hardcoded = 1/1
    测试文件本身: SyntaxError — module does not provide an export named 'blankComments'（新增导出在修前不存在）

### AC8 同族耦合面

`deletion-closure-check.ts`（P1）复用 `tsCommentMask`，读数**跟着变了**（同一组构件、只换掩码）：

| 字段 | 修前 | 修后 |
|---|---|---|
| `counts.code` | 135 | **133** |
| `counts.comment` | 222 | **228** |
| `counts.call` | 120 | **118** |
| `counts.ratio` | 6.9333 | **7.0508** |
| `dcTotal` / `doc` / `literal` / `schema` / `fixture` / `touches` | 832 / 570 / 15 / 112 / 75 / 195 | 不变 |

方向正确：原先被幻影字符串吞进「代码」的注释回到「注释」，靠它们的结构调用随之回到「注释」。
`deletionClosureComponents(3)` 也从 `["ready-pool-check.ts","quay-init.sh","full-suite-runner.ts"]`
变为 `["quay-init.sh","runner-static-gate.ts","resource-gate.sh"]`（P1 选的构件随 P2 判定一起变，符合预期）。

`capability-catalog-declarations.json` 的 QUESTION 文本**需要同步**并已改：旧文写的是「import/source
single-accessor distinguished from hardcoded string literals」，而修后 accessor 含 re-export 与多行子句、
且「hardcoded」已排除**按路径调用**这一类，故改写为「non-evidence = comment/doc positions AND by-path
invocation …；structural relation (import / re-export / require / source — including multi-line named
import blocks, matched on a comment-blanked view) distinguished from those code-position name mentions」。

### 一处如实记录的代价

检测器全仓跑墙钟从 14.5s 升到 ~24s（`quality-gate-driver` 的 `ROUTINE_TIMEOUT_MS` = 180000，余量充足）。
成因是 accessor 正则现在跑在抹平注释后的视图上：注释里的引号不再截断子句，惰性匹配多探了一些位置。
这是**正确性换来的**（抹平前那些引号本身就让多行导入块读不进去）。已用「样本收满即停」与按段抹平
压过一轮；未再为它引入任何数值上限（硬规则 4 推论二：写死的上限会静默变成真限制）。

## Touches

- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/architecture-review-cluster.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/identity-replication-check.test.mjs`
- `plugin/test/architecture-review-cluster.test.mjs`
- `plugin/test/deletion-closure-check.test.mjs`
- `tasks/gap-identity-replication-requires-structural-relation.md`
