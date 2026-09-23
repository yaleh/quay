---
id: gap-serve-labels-hardcode-mechanism-script-basenames
title: serve-system/serve-i18n 把机制层脚本 basename
  当产品层字面量硬编码：同一实体两次命名，方向为分层声明禁止的产品→机制（R3 / 簇 P2-identity-resource-gate.sh）
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

**来源**：架构复核 round 2030 簇 `P2-identity-resource-gate.sh`（verdict=abstract，actionable=true）。判词逐字：

> identity replication: "resource-gate.sh" named in 15 code file(s) without a single accessor
>
> reasoning：单一访问器存在（`observation.ts:3081 export const RESOURCE_GATE_REL`），但 basename 在它的**外面**仍被产品层表面硬编码（`serve-system.ts:112 <h2>resource-gate.sh</h2>`、`serve-i18n.ts:1364/1778` 的标签注释），而提案 R3 把这条产品→机制路径钉死点名为真缺陷——**因为方向恰是分层声明所禁止的那个**。
>
> suggestedAction：立案 R3：把 serve-system/serve-i18n 的标签改为经那一个解析器/访问器派生（或把依赖搬走），使每条机制脚本路径只被命名一次，且层方向不倒置。

**正本**：`docs/proposals/archguard-generation-era-primitives.md` 的「十条具名风险」表 R3 行：

| R3 | `observation.ts` 钉死 3 条机制层脚本相对路径 | `PROCESS_BUDGET_REL`/`RESOURCE_GATE_REL`/`SESSION_LIVENESS_REL` 三个 `../../../plugin/scripts/*` 常量；方向是分层声明所禁止的那个 |

**现场（立案当轮逐字 grep，cwd = 主检出 `/home/yale/work/quay`，2026-09-23）**：

```
$ grep -n "resource-gate\|process-budget" packages/quay/src/serve-system.ts
109:      <p class="meta">${fillLabel(L.dataSourceNote, { gate: "<code>resource-gate.sh --json</code>", budget: "<code>process-budget.sh --json</code>" })}</p>
112:      <h2>resource-gate.sh</h2>
120:      <h2>process-budget.sh</h2>

$ grep -n "resource-gate\|process-budget" packages/quay/src/serve-i18n.ts
1364://    machine's own word (the `verdict` field of `resource-gate.sh --json`), not copy, and it reads
1778://    - The two JSON field-name `<h2>`s (`resource-gate.sh` / `process-budget.sh`) and the meter
```

**缺陷的两个可证否断言**：

1. **同一实体被命名两次，而不是一次。** 这两条机制脚本路径的唯一访问器在
   `packages/quay/src/observation.ts:3081-3082`（`RESOURCE_GATE_REL = path.join("scripts","resource-gate.sh")`
   / `PROCESS_BUDGET_REL = "scripts/process-budget.sh"`），而 `/system` 页面把**同一个 basename** 又写成
   产品层字面量（`serve-system.ts:109/112/120`）。改一条 REL 不会改变页面标签 —— 这正是「复制」而非
   「提及」的可证否形态（与 `gap-identity-replication-requires-structural-relation` 保留的那条反向边界
   「文本里的裸 basename 仍是证据」一致：本处正是该判据存留下来的**真复制**实例，不是假阳性）。
2. **方向倒置。** 产品层（`packages/quay/src/serve-system.ts`）钉死了机制层脚本的路径知识；
   `observation.ts` 的注释自己声明那三个常量应当「经正规解析器解析，⛔ 不是模块相对 walk-up」，
   但页面标签那一半根本没经它们 —— 产品层对机制层路径的代表面被绕过了。

**修法（两条都允许，实现者择一并说明理由）**：

- (a) **经同一访问器派生**：在 `observation.ts` 的 REL 常量旁提供纯派生面（如
  `export function scriptBasename(rel: string): string`，或 `RESOURCE_GATE_NAME = path.basename(RESOURCE_GATE_REL)`），
  `serve-system.ts` 的 `<h2>` 与 `dataSourceNote` 的 `{gate}`/`{budget}` 参数改为插值它。
  ⇒ 产品层对每条机制脚本路径**只有一个命名点**。
- (b) **搬走依赖**：把这条路径知识整体移到机制层提供者（`plugin/` 侧）经产品层已有的读面暴露，
  产品层不再认识 basename。

⛔ 两种修法都**不得**改成「另建一张 basename 查找表」——那是把复制从一个文件搬到另一个文件；
AC2 的负控制会把这种实现判红。

<!-- dedup-ref --> 机制相邻但**不同**的两个已 done 任务（追溯用，非前置）：`gap-identity-replication-requires-structural-relation` 修的是**检测器判据**（关键词在场计数 → 结构性关系），它明确把 `<h2>resource-gate.sh</h2>` 作为「真复制形态」保留下来而未修它；`gap-plugin-root-resolution-remaining-callsites` 修的是**运行期解析点**（`resolvePluginScript` vs workspace-root 拼接），不涉及展示标签。本任务的机制是**产品层展示面的重复命名**，两者都不是。

**实现选择（worker，2026-09-23）：选 (a) 派生**，理由：命名点本来就该在 `observation.ts`（REL 常量是产品层认识这些脚本的**唯一**入口，AC1 也把它定为唯一命名点），(b) 会把路径知识搬去 `plugin/` 侧、让产品层改用一条新的读面，改面更大而收益相同；且 (a) 让 REL 与标签之间的因果关系**可被一条真实请求证否**（见 DoD 的红控制）。派生面是**纯函数** `scriptBasename(rel)`（不是按 rel 建的表）——AC2 的负控制专门把这两种实现分开。

## AC

- [x] AC1（派生，按位置核）：`grep -rn 'resource-gate\.sh\|process-budget\.sh' packages/quay/src/` 修后**只剩**单一命名点（`observation.ts` 的 REL 常量处，连同派生表达式所在行）；`serve-system.ts` 里零命中。贴出修前/修后两条 grep 的逐字输出（修前基线见 Proposal 现场段）。

  **修前——13 行**（可复现：`for f in serve-dashboard.ts serve-i18n.ts observation.ts serve-system.ts; do git show HEAD:packages/quay/src/$f | grep -n 'resource-gate\.sh\|process-budget\.sh' | sed "s|^|packages/quay/src/$f:|"; done`，HEAD = 分叉点 3bf60dbb3）：

  ```
  packages/quay/src/serve-dashboard.ts:1596:// dashboard's last two UN-cached probes — they shell out to resource-gate.sh / process-budget.sh /
  packages/quay/src/serve-i18n.ts:1364://    machine's own word (the `verdict` field of `resource-gate.sh --json`), not copy, and it reads
  packages/quay/src/serve-i18n.ts:1778://    - The two JSON field-name `<h2>`s (`resource-gate.sh` / `process-budget.sh`) and the meter
  packages/quay/src/observation.ts:2961://   system       → resource-gate.sh + process-budget.sh (text output)
  packages/quay/src/observation.ts:3053:   *  resource-gate.sh from nproc — never a host-derived literal. The UI displays this value. */
  packages/quay/src/observation.ts:3081:export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");
  packages/quay/src/observation.ts:3082:export const PROCESS_BUDGET_REL = "scripts/process-budget.sh";
  packages/quay/src/observation.ts:3090:/** Parse resource-gate.sh --json's single JSON document into structured fields. Pure. */
  packages/quay/src/observation.ts:3107:/** Parse process-budget.sh --json's single JSON document into structured fields. Pure. */
  packages/quay/src/observation.ts:3119:/** System view: resource-gate.sh --json + process-budget.sh --json parsed to structured fields. */
  packages/quay/src/serve-system.ts:109:      <p class="meta">${fillLabel(L.dataSourceNote, { gate: "<code>resource-gate.sh --json</code>", budget: "<code>process-budget.sh --json</code>" })}</p>
  packages/quay/src/serve-system.ts:112:      <h2>resource-gate.sh</h2>
  packages/quay/src/serve-system.ts:120:      <h2>process-budget.sh</h2>
  ```

  **修后——2 行 = 唯一定名点；`serve-system.ts` 零命中**（在任务分支上实跑 `grep -rn 'resource-gate\.sh\|process-budget\.sh' packages/quay/src/`）：

  ```
  packages/quay/src/observation.ts:3082:export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");
  packages/quay/src/observation.ts:3083:export const PROCESS_BUDGET_REL = "scripts/process-budget.sh";
  ```

  派生的两行（`RESOURCE_GATE_NAME = scriptBasename(RESOURCE_GATE_REL)` / `PROCESS_BUDGET_NAME = …`）**不含任何字面量**，所以不出现在 grep 里 —— 这正是「派生」与「第二份字面量」在文本上的分界（AC2 把它变成可判红的）。修前的 6 处**注释**命中也一并改为指向该访问器（`serve-dashboard.ts:1596`、`serve-i18n.ts:1364/1778`、`observation.ts` 的 4 处 doc 注释）——同一原则的兄弟实例，不是只修被报出来的那两处（硬规则 5b）。
- [x] AC2（负控制 —— 区分「派生」与「恰好相等的第二份字面量」）：对派生面喂一个**不在**任何表里的 rel（如 `scripts/whatever.sh`），断言得到 `whatever.sh`；且对 `RESOURCE_GATE_REL` 断言得到 `resource-gate.sh`。两条断言都过 ⇒ 派生是通用函数而非查找表；若实现选了「查找表」，此 AC 必须判红。贴出测试文件与 exit 0。

  **测试文件**：`packages/quay/test/serve-ac95-views.test.mjs`（新增 `test("AC2: scriptBasename is a general derivation — a rel in NO table yields its basename (negative control)")`；同文件 import 面新增 `scriptBasename` / `RESOURCE_GATE_REL` / `PROCESS_BUDGET_REL` / `RESOURCE_GATE_NAME` / `PROCESS_BUDGET_NAME`）。三臂：
  (a) **查找表过不去的那一臂** —— `scriptBasename("scripts/whatever.sh") === "whatever.sh"`（任何常量/表里都没有的 rel；查找表在此返回 undefined 或抛）、同 basename 任意前缀、非 `.sh` 的 rel；
  (b) 真标签来自同一访问器 —— `scriptBasename(RESOURCE_GATE_REL) === "resource-gate.sh"`、`scriptBasename(PROCESS_BUDGET_REL) === "process-budget.sh"`、两个派生常量等值；
  (c) **第二份字面量不可能有的性质** —— 标签跟随 rel（`scriptBasename("scripts/renamed-gate.sh") === "renamed-gate.sh"`、`RESOURCE_GATE_NAME === scriptBasename(RESOURCE_GATE_REL)`）。

  **exit 0**：`node packages/quay/test/serve-ac95-views.test.mjs` → `tests 22 / pass 22 / fail 0`，**exit 0**（含该新测试的 ✔）。
  **红侧说明**：把 `scriptBasename` 换成「按两个已知 rel 建的表」时，(a) 的第一条断言即失败 —— 这是本 AC 的判红形态（未实跑该红态：它要求改实现代码，属 AC3 禁止的「改实现让它红/绿」操作；判红形态由断言的输入面本身保证）。
- [x] AC3（行为保持，真渲染）：`node packages/quay/test/serve-system-body-i18n.test.mjs` 与 `node packages/quay/test/serve-ac95-views.test.mjs` exit 0 —— 两文件现有的字面量断言（`serve-system-body-i18n.test.mjs:218` 的 `Data source: <code>resource-gate.sh --json</code> · …`、`serve-ac95-views.test.mjs:461` 的 `body.includes("resource-gate.sh")`）必须**仍然成立**。若不成立 ⇒ 派生结果与页面实际渲染不一致，是实现缺陷，不是判据缺陷。⛔ 不得靠删除/放宽这两条断言来「让它绿」。

  **两个文件都 exit 0**：`serve-system-body-i18n.test.mjs` → `tests 11 / pass 11 / fail 0`；`serve-ac95-views.test.mjs` → `tests 22 / pass 22 / fail 0`。
  两条既有断言**逐字未动**且仍成立（它们断言的是**实渲染的 HTTP 响应体**，en 行那条在 `lang=en` 的真实响应上过）。可证否的「没靠放宽让它绿」读数：`git diff` 对 `serve-ac95-views.test.mjs` 的**删除行数 = 0**（`git diff … | grep -c "^-[^-]"` → `0`），即该文件本任务只**新增**（AC2 的 import + 测试）；`serve-system-body-i18n.test.mjs` 本任务**零改动**（它不在本任务的 diff 里）。
- [x] AC4（注释面同步）：`serve-i18n.ts:1364` 与 `:1778` 两条把 basename 当**标签来源**的注释改为描述派生形态（口径：`<h2>` 的文本来自单一访问器的派生，⛔ 不是本模块的第二份字面量）。贴出修后两行逐字。

  `serve-i18n.ts:1364-1366`（修前 1364 那一行的 basename 已换掉，逐字）：
  ```
  //    machine's own word (the `verdict` field of the resource gate's `--json` — the script's name
  //    itself is DERIVED on the page from the single accessor in observation.ts, never re-spelled
  //    here), not copy, and it reads the same in both languages.
  ```
  `serve-i18n.ts:1779-1784`（原 1778 行所在块，逐字）：
  ```
  //    - The two JSON field-name `<h2>`s and the meter labels are /system's (ROW 14 ④) and are
  //      untouched from this side too. ⚠️ Those two `<h2>`s are named NOWHERE in this module: their
  //      text is DERIVED from the single accessor (observation.ts's REL constants →
  //      `scriptBasename`), so neither basename is a dictionary literal here — a second literal would
  //      be exactly the copy this table exists to prevent
  //      (gap-serve-labels-hardcode-mechanism-script-basenames).
  ```
  口径落实：两处都写明「文本来自单一访问器的派生」且「本模块不再有第二份字面量」；grep 佐证见 AC1 的修后读数（`serve-i18n.ts` 在修后 grep 里零命中）。
- [x] AC5（簇的产出侧读数 —— 判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json` 修后，`resource-gate.sh` 行的 `hardcoded` 读数**低于**立案基线 `code=15 accessor=0 hardcoded=15`（至少 −1：`serve-system.ts` 不再命名它）且 `accessor` > 0；`process-budget.sh` 行同向下降。⛔ **只跑不改**检测器 —— `plugin/scripts/identity-replication-check.ts` 与 `architecture-review-cluster.ts` 不在本任务 Touches。

  **`hardcoded` 下降：达成。`accessor` > 0：实测不可达 —— 本 AC 拆成「已达成半」+「不可达半（保留为观察项）」，两半都给出读数，不删任何一半。**
  a) **默认视图**（`node --experimental-strip-types plugin/scripts/identity-replication-check.ts`，`top 25`）逐字：
  ```
    resource-gate.sh                             code= 14  full= 49  accessor=0  hardcoded=14  <<FLAGGED
  ```
  b) **两行都在表内的读数**（`--limit 100`；`process-budget.sh` 在默认 25 行切面外，必须显式给 limit 才读得到）：
  | 实体 | 立案基线 | 修后 |
  |---|---|---|
  | `resource-gate.sh` | full=52 **code=15** **accessor=0** **hardcoded=15** | full=49 **code=14** **accessor=0** **hardcoded=14** |
  | `process-budget.sh` | **code=10** **accessor=0** **hardcoded=10** | **code=9** **accessor=0** **hardcoded=9** |
  两行同向下降 −1，`serve-system.ts` 从两行的 `codeFiles` 里**消失**（`git diff --stat plugin/scripts/` 空 —— 检测器**只跑未改**）。
  c) **「`accessor` > 0」为何不可达（读数 + 判据源码，不是猜测）**：`accessor` 的判定族是 `import` / `re-export` / `require` / `source` 的 **specifier 含词干**（`accessorRegexSource()`，`identity-replication-check.ts:291-305`），而这两条是**只被 spawn 的 CLI**：产品层对它们的唯一结构关系是 `resolvePluginScript(rel)` 的运行期解析，检测器不认识该形态。本 AC 与 AC1 共同指定的两条修法**都不产生 import**：(a) 命名点留在 `observation.ts`，`serve-system.ts` 只 import `./observation.ts`（specifier 不含词干）；(b) 路径知识移到 `plugin/` 侧，同样不产生含词干的 specifier。实测 (a) 修后两行 `accessor` 均为 **0**。⇒ 这是本 AC 落笔时未取读数（硬规则 4c：判据若声称「某字段应为 Y」，落笔当轮就要取一次真实读数）造成的**预测错误**，不是实现缺陷；task 自己的 DoD 对该 AC 也只要求「**检测器读数的下降**（立案读数 15 是基线，不是目标）」，那半已达成并附读数。**这一半句保留在此并标为不可达** —— 删掉它会让「查过且不可达」与「没查」在报告上同形（硬规则 3b）。
- [x] AC6（scoped 门）：`scripts/test.sh --for-task gap-serve-labels-hardcode-mechanism-script-basenames` exit 0，贴出退出码。

  `bash scripts/test.sh --for-task gap-serve-labels-hardcode-mechanism-script-basenames`（cwd = 任务 worktree，develop 已并入）→ **exit 0**，`ℹ tests 186 / pass 186 / fail 0`。同一条命令加 `--allow-thin`（worker pre-merge 步骤的写法）亦 **exit 0 / 186 pass**。

## DoD

真实落地 = 产品层对这两条机制脚本路径**只剩一个命名点**，且 `/system` 页面在**真实 HTTP 响应**里仍渲染出正确的两个 `<h2>`：启动 Web UI 对 `/system` 发一次真实请求（或跑 serve 侧既有的真实渲染点位），断言响应体同时含 `resource-gate.sh` 与 `process-budget.sh` 两个 `<h2>` —— 证明派生在**生产载体**上有效，而不只是在单测里。

⛔ 不是「改动做了、单测绿了」即算 done：**AC2 的负控制必须能把「查找表冒充派生」判红**，**AC5 必须给出检测器读数的下降**（立案读数 15 是基线，不是目标）。

**落地证据（worker，2026-09-23，cwd = 任务 worktree `…/quay-worktrees/gap-serve-labels-hardcode-mechanism-script-basenames`）**：

- 启动生产载体：`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 41989`；`curl -s http://127.0.0.1:41989/system` → **HTTP 200**，响应体逐字含：
  ```
  <h2>resource-gate.sh</h2>
  <h2>process-budget.sh</h2>
  Data source: <code>resource-gate.sh --json</code> · <code>process-budget.sh --json</code> (stable machine-readable JSON output)
  ```
  同一次请求带 `Cookie: lang=zh` 亦含这两个 `<h2>`（标签是机制的 basename，不随语言字典变化）。
- **红控制（让「派生」与「第二份字面量」在【生产载体】上可区分）**：把**唯一定名点**改为 `resource-gate-renamed.sh` 后重启同一入口，**同一个真实响应**同时变成
  ```
  <h2>resource-gate-renamed.sh</h2>
  Data source: <code>resource-gate-renamed.sh --json</code> · <code>process-budget.sh --json</code>
  ```
  —— 两个渲染位点**一起**跟随该常量（`<h2>` 与 `dataSourceNote` 参数），第二份字面量不可能有这种行为。随后已还原并复核：`grep -n 'RESOURCE_GATE_REL = ' packages/quay/src/observation.ts` 回到 `resource-gate.sh`，`git status` 干净（红控制**未**进入任何提交）。

## Touches

- `packages/quay/src/serve-system.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/serve-i18n.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/serve-system-body-i18n.test.mjs`
- `packages/quay/test/serve-ac95-views.test.mjs`
- `tasks/gap-serve-labels-hardcode-mechanism-script-basenames.md`

（`packages/quay/src/serve-dashboard.ts` 是本轮**新增**的 Touches 条目：它有一处同形注释（`:1596` 把两个 basename 当散文列出），按硬规则 5b「同一原则的其它适用点」一并指向访问器；该文件其余零改动，且 `serve-system-body-i18n.test.mjs` 只作 AC3 的回归对象、本任务未改它。）
