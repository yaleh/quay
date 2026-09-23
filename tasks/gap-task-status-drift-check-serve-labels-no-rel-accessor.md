---
id: gap-task-status-drift-check-serve-labels-no-rel-accessor
title: task-status-drift-check.ts 的 basename 在 serve-board/serve-i18n 硬编码 10
  处、且无 REL 访问器（簇 P2-identity-task-status-drift-check.ts ——
  gap-serve-labels-hardcode-mechanism-script-basenames 的 Touches 漏掉的兄弟实例）
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

**来源**：架构复核 round 2031 簇 `P2-identity-task-status-drift-check.ts`（verdict=abstract，actionable=true）。判词逐字：

> identity replication: "task-status-drift-check.ts" named in 12 code file(s) without a single accessor
>
> reasoning：Verified code=19/accessor=7/hardcoded=12；`experiments/` 那一处是指向 plugin 源码的 symlink（单一来源，不是副本）、11 处是测试，但 `serve-board.ts:126/128/133/134` 把 `<code>task-status-drift-check.ts</code>` 硬编码四次、`serve-i18n.ts:1037-1041` 把 basename 嵌进用户可见字符串 —— 正是刚为 resource-gate.sh 在 serve-system/serve-i18n 修掉的那条 product→mechanism 字面量缺陷，落在一份已落地任务的 Touches 没覆盖的文件里（硬规则 5b）。
>
> suggestedAction：立案——给 `task-status-drift-check.ts` 一个 `*_REL` 常量（observation.ts）+ `scriptBasename()` 派生 serve-board/serve-i18n 的标签，即 `gap-serve-labels-hardcode-mechanism-script-basenames` 的兄弟实例。

**兄弟实例（已 done 的那个）**：`gap-serve-labels-hardcode-mechanism-script-basenames` 把 `resource-gate.sh` / `process-budget.sh` 的 basename 收敛成了 `observation.ts` 的 `RESOURCE_GATE_REL` / `PROCESS_BUDGET_REL`（`:3082-3083`）+ `scriptBasename()` 派生（`RESOURCE_GATE_NAME` / `PROCESS_BUDGET_NAME`，`:3101-3102`）。它**没有**覆盖 `task-status-drift-check.ts` —— 那是同一原则在另外两个文件上的适用点（硬规则 5b）。本任务就是那半边。

**现场（立案当轮逐字，cwd = 主检出 `/home/yale/work/quay`，2026-09-23）**：

本仓检测器读数（`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json --limit 400`，**只跑不改**）：

```
=== task-status-drift-check.ts full=32 code=19 accessor=7 hardcoded=12
```

产品层逐字 grep（`grep -rn 'task-status-drift-check\.ts' packages/quay/src/`）：

```
packages/quay/src/serve-board.ts:126:    ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · ${fillLabel(L.scanTasks, { n: board.landing.scanned })}</span>`
packages/quay/src/serve-board.ts:128:      ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.noData}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
packages/quay/src/serve-board.ts:133:        ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.readTimeout}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
packages/quay/src/serve-board.ts:134:        : html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.readFailed}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`;
packages/quay/src/serve-i18n.ts:1037:    en: "the landing source (task-status-drift-check.ts) read timed out",
packages/quay/src/serve-i18n.ts:1038:    zh: "落地源（task-status-drift-check.ts）读取超时",
packages/quay/src/serve-i18n.ts:1041:    en: "the landing source (task-status-drift-check.ts) is unavailable",
packages/quay/src/serve-i18n.ts:1042:    zh: "落地源（task-status-drift-check.ts）不可用",
packages/quay/src/serve-i18n.ts:1045:    en: "the landing source (task-status-drift-check.ts) read failed",
packages/quay/src/serve-i18n.ts:1046:    zh: "落地源（task-status-drift-check.ts）读失败",
packages/quay/src/observation.ts:2494:    const resolved = resolvePluginScriptExec(path.join("scripts", "task-status-drift-check.ts"));
packages/quay/src/observation.ts:2498:        reason: "landing 判断源缺失（plugin/scripts/task-status-drift-check.ts/dist bundle 不存在 — 产品安装无 methodology 层）",
```

**缺陷的两个可证否断言**：

1. **同一实体在同一层被命名 10 次，而它的具名 REL 常量在 `observation.ts` 里根本不存在。** 对照：`resource-gate.sh` / `process-budget.sh` 有 `RESOURCE_GATE_REL` / `PROCESS_BUDGET_REL` 作具名点；`task-status-drift-check.ts` 没有 —— `observation.ts:2494` 反倒是**就地内联**拼 `path.join("scripts", "task-status-drift-check.ts")`。产品层展示面（serve-board 的 4 个 `<code>`、serve-i18n 的 6 条标签）各自独立拼出同一个 basename，而 `observation.ts:2494` 的第三份拼写决定**真正 spawn 的是哪个文件**。改展示面不会改运行面，改运行面不会改展示面 —— 三份互不约束。
2. **改一处不会改变另一处 —— 这就是「复制」而不是「提及」的可证否形态。** 它们之间没有共同来源。而派生面在同一个包里**已有先例**：`serve-board.ts:5` 已经 `import { ... } from "./observation.ts"`，`serve-system.ts:4` 已经 import `RESOURCE_GATE_NAME` / `PROCESS_BUDGET_NAME` —— 零新机制。

**修法（镜像已落地的兄弟实例；实现者照做，除非能给出更强理由）**：

1. `observation.ts`：新增具名点 `export const TASK_STATUS_DRIFT_CHECK_REL = path.join("scripts", "task-status-drift-check.ts")` 与 `export const TASK_STATUS_DRIFT_CHECK_NAME = scriptBasename(TASK_STATUS_DRIFT_CHECK_REL)`（`scriptBasename` 已存在，`observation.ts:3096`）；`:2494` 的内联 `path.join` 与 `:2498` 的 reason 串改用 `TASK_STATUS_DRIFT_CHECK_REL`。
2. `serve-board.ts`：4 处 `<code>task-status-drift-check.ts</code>` 改为 `<code>${TASK_STATUS_DRIFT_CHECK_NAME}</code>`。
3. `serve-i18n.ts`：`srcLandingTimeout` / `srcLandingUnavailable` / `srcLandingFailed` 三条标签改为**带占位符的模板**（如 `"the landing source ({source}) read timed out"` / `"落地源（{source}）读取超时"`），由 `serve-board.ts:544-549` 的调用点用 `fillLabel(boardLabel(key, lang), { source: TASK_STATUS_DRIFT_CHECK_NAME })` 填充。⛔ **不得**让 `serve-i18n.ts` import `observation.ts` —— 该模块**零 import 是设计约束**（`serve-i18n.ts:6` 逐字：「attribute must not have to import 15 label pairs, and a test of the DECISION TABLE must not ...」）；占位符 + 调用点 fill 是该约束下唯一可行形态。
4. `observation.ts` 里 4 处把 basename 当散文列出的 doc 注释（`:2394` / `:2430` / `:2432` / `:2468`）改为指向该访问器（硬规则 5b：同一原则的其它适用点）。

⛔ 修法**不得**改成「另建一张按 rel 建的表」——那是把复制从一个文件搬到另一个文件；AC2 的负控制会把这种实现判红。
⛔ 检测器（`plugin/scripts/identity-replication-check.ts` / `architecture-review-cluster.ts`）**只跑不改**，不在本任务 Touches。

<!-- dedup-ref --> 追溯用（非前置）：`gap-serve-labels-hardcode-mechanism-script-basenames`（done）修的是同一条原则在 `serve-system.ts` 上的实例，本任务是它 Touches 漏掉的兄弟；`gap-task-status-drift-check-timeout`（done）修的是 8s 超时 fail-open，与本任务的命名点无关。本任务的机制是**产品层展示面 + 运行面的重复命名**。

## AC

- [x] AC1（单一命名点，按位置核）：修后 `grep -rn 'task-status-drift-check\.ts' packages/quay/src/` 在 `serve-board.ts` 与 `serve-i18n.ts` **零命中**；在 `observation.ts` **只剩** REL 常量那一行（`:2494` 改为用常量、`:2498` 的 reason 串改为插值、4 处 doc 注释改为指向访问器）。贴出修前/修后两条 grep 的逐字输出（修前基线见 Proposal 现场段）。 〈证据：修后该 grep 共 4 行 —— `observation.ts:3091: export const TASK_STATUS_DRIFT_CHECK_REL = path.join("scripts", "task-status-drift-check.ts");`（REL 定义行本身，即「只剩那一行」），另 3 行是 `task-parsing.ts:4/18/90`。⛔ 范围声明（硬规则 5b 的披露面）：`task-parsing.ts` 的 3 处是「本函数从 task-schema.ts / task-status-drift-check.ts **迁来**」的溯源散文（`countAcCheckboxes` 等三个函数的出处），不是命名点 —— 它们不参与展示也不决定 spawn 哪个文件，且 `task-parsing.ts` **不在本任务 Touches**（改它必然触发 anti-drift 越界红）。它与兄弟任务留下的同一处一致（`gap-serve-labels-hardcode-mechanism-script-basenames` 同样未动它），故按「不同机制」处理而非遗漏；若判为同一机制，应另立案。修前 22 行（Proposal 现场段逐字）→ 修后 4 行。〉

- [x] AC2（负控制 —— 区分「派生」与「恰好相等的第二份字面量」）：测试断言 `TASK_STATUS_DRIFT_CHECK_NAME === scriptBasename(TASK_STATUS_DRIFT_CHECK_REL)` 且 `TASK_STATUS_DRIFT_CHECK_NAME === "task-status-drift-check.ts"`；并断言一个**不在任何表里**的 rel 仍得到它自己的 basename（`scriptBasename("scripts/whatever.sh") === "whatever.sh"`）⇒ 派生是通用纯函数而非查找表。贴出测试文件与 exit 0；若实现选了「查找表」，此 AC 必须判红。 〈证据：`packages/quay/test/observation.test.mjs` 末尾两条 —— `AC2: TASK_STATUS_DRIFT_CHECK_NAME is scriptBasename(TASK_STATUS_DRIFT_CHECK_REL) — derived, not a second literal` 与 `AC2: scriptBasename is a PURE function of its input, not a lookup table (the negative control)`；`node packages/quay/test/observation.test.mjs` **exit 0**，`tests 60 / pass 60 / fail 0`。负控制用了**三个**不在任何表里的 rel（`scripts/whatever.sh` / `scripts/never-heard-of-this.ts` / `/abs/path/to/another-thing.ts`）+ 一条「两个不同 rel 不得塌成同一个名字」的断言 ⇒ 查找表实现（或把复制搬到另一张表）在此必红。〉

- [x] AC3（红控制 —— 「第二份字面量」在生产载体的同一渲染点上可区分）：把 `TASK_STATUS_DRIFT_CHECK_REL` 临时改为 `path.join("scripts","task-status-drift-check-renamed.ts")` 后重跑既有渲染路径，`<code>` 与三条 `srcLanding*` 标签的**实际输出文本**必须**一起**跟随新 basename（第二份字面量不可能有这种行为）；随后还原并复核 `git status` 干净（红控制不得进入任何提交）。贴出红控制前/后两条输出逐字。 〈证据（真实 HTTP 载体：`startServer({port:0})` + `http.get /board?lang=zh`，两次都是 HTTP 200）：
  ① 修前/基线 —— `includes("<code>task-status-drift-check.ts</code>") = true`；`includes("<code>task-status-drift-check-renamed.ts</code>") = false`；页面逐字 `<span>落地: <code>task-status-drift-check.ts</code> · 扫描 0 任务</span>`。
  ② 红控制（REL 改为 `...-renamed.ts`）—— 同一个响应里 `<code>task-status-drift-check-renamed.ts</code>` = true、旧名 = false，且 banner 逐字 `执行源（.workflow-events/）无数据 · 落地源（task-status-drift-check-renamed.ts）不可用 读不到（无数据 / 读失败 / 读取超时）…`；`board_default_view=unfiltered-source-incomplete`。
  ③ 三条 `srcLanding*` 标签（无法从 HTTP 单次请求同时命中三态 —— 它们由同一个三元 key + 同一个 `boardLabel(...)` 表达式产出）经**生产渲染表达式**逐字对比，两种 REL 下 en/zh 各三条共 6 行文本一起改变：`"the landing source (task-status-drift-check-renamed.ts) read timed out"` / `"落地源（…-renamed.ts）读取超时"` / `…is unavailable` / `…不可用` / `…read failed` / `…读失败`（基线同 6 行去掉 `-renamed`）。
  ④ 还原后 `git status --porcelain` **为空** —— 红控制未进入任何提交。〉

- [x] AC4（行为保持，真渲染）：`node packages/quay/test/serve-board.test.mjs` exit 0，且 `:324` 的 `board.body.includes("task-status-drift-check.ts")` 与 `:707` 的同款断言**逐字成立**（它们断言的是**实渲染的板面 HTML**）。⛔ 不得靠删除/放宽这两条断言来「让它绿」：`git diff` 对 `serve-board.test.mjs` 的删除行数必须为 0（`git diff … -- packages/quay/test/serve-board.test.mjs | grep -c "^-[^-]"` → `0`）。贴出 exit 码与删除行数读数。 〈证据：`node packages/quay/test/serve-board.test.mjs` **exit 0**，`tests 16 / pass 16 / fail 0 / cancelled 0`；两条断言所在的测试（`AC5/AC6: three data sources visible; a missing source degrades to 200 (never 500)` 含 `:324`、`AC2 negative control: a cache-hit /board request does NOT cold-run the checker` 含 `:707`）逐字未改且通过。`git diff -- packages/quay/test/serve-board.test.mjs | grep -c "^-[^-]"` = **0**（该文件 +101 行，纯追加 —— 新增测试所需的符号一律走动态 `import()`，与文件内既有的 AC-292 测试同法，因此没有改任何既有行）。〉

- [x] AC5（簇的产出侧读数 —— 判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json --limit 400` 修后，`task-status-drift-check.ts` 行的 `hardcoded` 读数**低于**立案基线 `code=19 accessor=7 hardcoded=12`（至少 −8：serve-board 4 处 + serve-i18n 6 处不再命名它）。贴出修前/修后两行逐字。⛔ 只跑不改检测器。 〈证据（检测器只跑不改）：修前 `entity=task-status-drift-check.ts full=32 code=19 accessor=7 hardcoded=12` → 修后 `full=30 code=17 accessor=7 hardcoded=10`。**核心判据成立**：`hardcoded` 严格下降（12 → 10），且 `codeFiles` 里 `packages/quay/src/serve-board.ts` 与 `packages/quay/src/serve-i18n.ts` **双双消失**（这两个文件已完全不再包含该字符串 ⇒ `full` 32→30）。
  ⚠️ **判据文本更正（worker，2026-09-23）**：括号里的「至少 −8」**取不到，是立案时的算术错误** —— 它把 `hardcoded` 当成**出现次数**（4 + 6 = 10），而检测器**按文件计**：`plugin/scripts/identity-replication-check.ts:804-821` 的 `for (const f of files) { … if (m.accessor) accessor++; else { hardcoded++; … } }`，每个文件**至多 +1**。那 10 处命名分布在 2 个文件里 ⇒ 读数只能降 2（实测正是 2）。这不是实现没做到：其余仍命名该 basename 的 10 个文件（`plugin/scripts/{quay-init.sh,ready-pool-check.ts,slot-refill.ts,task-status-drift-check.ts}`、`plugin/test/*` 7 个、`packages/quay/test/{build-plugin-dist,gap-ac292-board-request-path-cold-build}.test.mjs`、`experiments/…/restart-readiness-check.sh`）**都不在本任务 Touches**（产品层展示面 + 运行面的重复命名才是本任务的机制）。DoD 自己也逐字写了「立案读数 `hardcoded=12` 是**基线，不是目标**」。判据的取假能力保留：未修 ⇒ 12/19，修了 ⇒ 10/17，可区分。〉

- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-task-status-drift-check-serve-labels-no-rel-accessor` exit 0，贴出退出码与用例计数。若该 invocation 报 thin，同命令加 `--allow-thin` 亦须 exit 0。 〈证据：先 `git merge --no-edit develop`（Merge made by the 'ort' strategy，无冲突）再跑门 —— **exit 0**，`tests 167 / suites 0 / pass 167 / fail 0 / cancelled 0 / skipped 0 / todo 0`（未报 thin，故未加 `--allow-thin`）。〉

## DoD

真实落地 = `/board` 页面在**真实 HTTP 响应**里仍渲染出正确的落地源名，且该名字只由 `observation.ts` 的**一个** REL 常量决定：启动 Web UI 对 `/board` 发一次真实请求（或跑 serve 侧既有的真实渲染点位），断言响应体含 `task-status-drift-check.ts`；再对同一个真实载体做一次红控制（改 REL 常量 → 重启 → 同一个响应里的名字跟随）—— 证明派生在**生产载体**上有效，而不只是在单测里。

⛔ 不是「改动做了、单测绿了」即算 done：**AC2 的负控制必须能把「查找表冒充派生」判红**，**AC3/DoD 的红控制必须在生产载体上把「第二份字面量」判红**，**AC5 必须给出检测器读数的下降**（立案读数 `hardcoded=12` 是基线，不是目标）。

〈DoD 证据（2026-09-23，真实载体 = `startServer({port:0})` 起的真 Web UI + 真 `http.get`）：① 基线一次真实请求 → HTTP 200，响应体逐字含 `<span>落地: <code>task-status-drift-check.ts</code> · 扫描 0 任务</span>`；② 改 REL 常量 → 重启（新进程）→ **同一个** `/board?lang=zh` 响应里 `<code>` 与落地源标签一起变成 `task-status-drift-check-renamed.ts`（banner 逐字 `落地源（task-status-drift-check-renamed.ts）不可用`）⇒ 名字确实只由那一个常量决定；③ 还原后 `git status` 干净。检测器读数的下降见 AC5。〉

## Touches

- `packages/quay/src/observation.ts`
- `packages/quay/src/serve-board.ts`
- `packages/quay/src/serve-i18n.ts`
- `packages/quay/test/serve-board.test.mjs`
- `packages/quay/test/observation.test.mjs`
- `tasks/gap-task-status-drift-check-serve-labels-no-rel-accessor.md`
