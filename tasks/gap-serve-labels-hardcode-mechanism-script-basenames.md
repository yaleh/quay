---
id: gap-serve-labels-hardcode-mechanism-script-basenames
title: serve-system/serve-i18n 把机制层脚本 basename
  当产品层字面量硬编码：同一实体两次命名，方向为分层声明禁止的产品→机制（R3 / 簇 P2-identity-resource-gate.sh）
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

## AC

- [ ] AC1（派生，按位置核）：`grep -rn 'resource-gate\.sh\|process-budget\.sh' packages/quay/src/` 修后**只剩**单一命名点（`observation.ts` 的 REL 常量处，连同派生表达式所在行）；`serve-system.ts` 里零命中。贴出修前/修后两条 grep 的逐字输出（修前基线见 Proposal 现场段）。
- [ ] AC2（负控制 —— 区分「派生」与「恰好相等的第二份字面量」）：对派生面喂一个**不在**任何表里的 rel（如 `scripts/whatever.sh`），断言得到 `whatever.sh`；且对 `RESOURCE_GATE_REL` 断言得到 `resource-gate.sh`。两条断言都过 ⇒ 派生是通用函数而非查找表；若实现选了「查找表」，此 AC 必须判红。贴出测试文件与 exit 0。
- [ ] AC3（行为保持，真渲染）：`node packages/quay/test/serve-system-body-i18n.test.mjs` 与 `node packages/quay/test/serve-ac95-views.test.mjs` exit 0 —— 两文件现有的字面量断言（`serve-system-body-i18n.test.mjs:218` 的 `Data source: <code>resource-gate.sh --json</code> · …`、`serve-ac95-views.test.mjs:461` 的 `body.includes("resource-gate.sh")`）必须**仍然成立**。若不成立 ⇒ 派生结果与页面实际渲染不一致，是实现缺陷，不是判据缺陷。⛔ 不得靠删除/放宽这两条断言来「让它绿」。
- [ ] AC4（注释面同步）：`serve-i18n.ts:1364` 与 `:1778` 两条把 basename 当**标签来源**的注释改为描述派生形态（口径：`<h2>` 的文本来自单一访问器的派生，⛔ 不是本模块的第二份字面量）。贴出修后两行逐字。
- [ ] AC5（簇的产出侧读数 —— 判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json` 修后，`resource-gate.sh` 行的 `hardcoded` 读数**低于**立案基线 `code=15 accessor=0 hardcoded=15`（至少 −1：`serve-system.ts` 不再命名它）且 `accessor` > 0；`process-budget.sh` 行同向下降。⛔ **只跑不改**检测器 —— `plugin/scripts/identity-replication-check.ts` 与 `architecture-review-cluster.ts` 不在本任务 Touches。
- [ ] AC6（scoped 门）：`scripts/test.sh --for-task gap-serve-labels-hardcode-mechanism-script-basenames` exit 0，贴出退出码。

## DoD

真实落地 = 产品层对这两条机制脚本路径**只剩一个命名点**，且 `/system` 页面在**真实 HTTP 响应**里仍渲染出正确的两个 `<h2>`：启动 Web UI 对 `/system` 发一次真实请求（或跑 serve 侧既有的真实渲染点位），断言响应体同时含 `resource-gate.sh` 与 `process-budget.sh` 两个 `<h2>` —— 证明派生在**生产载体**上有效，而不只是在单测里。

⛔ 不是「改动做了、单测绿了」即算 done：**AC2 的负控制必须能把「查找表冒充派生」判红**，**AC5 必须给出检测器读数的下降**（立案读数 15 是基线，不是目标）。

## Touches

- `packages/quay/src/serve-system.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/serve-i18n.ts`
- `packages/quay/test/serve-system-body-i18n.test.mjs`
- `packages/quay/test/serve-ac95-views.test.mjs`
- `tasks/gap-serve-labels-hardcode-mechanism-script-basenames.md`
