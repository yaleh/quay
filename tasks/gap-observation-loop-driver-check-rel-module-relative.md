---
id: gap-observation-loop-driver-check-rel-module-relative
title: observation.ts:3200 LOOP_DRIVER_CHECK_REL 仍是模块相对 walk-up 路径字面量——绕过
  plugin-root 解析器（同族另两个常量已迁）
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

`packages/quay/src/observation.ts:3200` 有一条**模块相对 walk-up** 的路径字面量：

```ts
export const LOOP_DRIVER_CHECK_REL = "../../../plugin/scripts/loop-driver-check.sh";
```

它在 `:3237` 被直接喂给 `runPluginScript(root, LOOP_DRIVER_CHECK_REL, ["--check","--json",root], 15_000)`，而 `runPluginScript`（`:3029`）第一行就是 `const p = resolvePluginScript(rel);`——即 `plugin-root.ts` 的**唯一正规解析器**（`plugin-root.ts:176`）。同一文件里两个**同族**常量在早前的插件根解析轮次里已经迁到正规形态：

```ts
// :3068 / :3069，注释逐字说明："resolved via the canonical resolver, SPEC §6b — NOT a
// module-relative `import.meta.url` walk-up"
export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");
export const PROCESS_BUDGET_REL = "scripts/process-budget.sh";
```

⇒ `LOOP_DRIVER_CHECK_REL` 是**漏网的第三处**：它的形态与解析器期望的 rel 形状不一致（`resolvePluginScriptUnder` 在各层探测 `plugin/scripts/…` 与 `scripts/…`，不是 `../../../plugin/scripts/…`），且它是产品源码里对 `plugin/scripts` 的**硬编码相对路径**——import 图看不见它，所以任何"反向边/依赖面"检查都不会报它。

现场实跑（立案时 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts`，逐字）：

```
== 路径字面量常量 (AC1) — 1 个 *_REL 常量硬编码 plugin 脚本相对路径 ==
  packages/quay/src/observation.ts:3200  LOOP_DRIVER_CHECK_REL = ".../plugin/scripts/loop-driver-check.sh"
```

（本类别**只剩这一条**——同族另外 4 条（`DRIFT_CHECKER_REL` / `RESOURCE_GATE_REL` / `PROCESS_BUDGET_REL` / `TRANSCRIPT_CHECKER_REL`）已在 [[gap-plugin-root-resolution-remaining-callsites]] 及其兄弟轮次里迁完，本任务不重开它们。）

**同段落第二条同类**：`:3201 OBSERVER_REGISTRY_CONF = "../../../orchestration/observer-registry.conf"`，在 `:3542` 用 `fileURLToPath(new URL(OBSERVER_REGISTRY_CONF, import.meta.url))` 解析——同样绕过正规解析器。但它指向 `orchestration/`（**方法论层，不在 plugin/ 树内**），plugin-root 解析器按构造找不到它。⇒ 本任务对它的要求是**显式二选一并在代码里留痕**：要么给它一个单一解析器（同一 plugin-root 家族的兄弟解析，或在 observation.ts 内建一个有名字的 `resolveOrchestrationFile`），要么就地声明为**有理由的例外**（注释写明为何不适用 plugin-root 解析，并有一条断言覆盖"文件存在/缺失"两种行为）。⛔ 不允许既不解析也不声明地留着。

## AC

- [ ] AC1（复现固化）：贴出立案读数逐字（检测器"路径字面量常量"段只有 `observation.ts:3200` 一条），并贴出 `grep -n 'LOOP_DRIVER_CHECK_REL\|OBSERVER_REGISTRY_CONF' packages/quay/src/observation.ts` 的现场输出（须含 :3200/:3201 定义与 :3237/:3542 使用）。
- [ ] AC2（位置判定·修后）：`grep -n '\.\./\.\./\.\./.*plugin/scripts' packages/quay/src/observation.ts` **零命中**；且 `LOOP_DRIVER_CHECK_REL` 的取值形态与同族常量一致（`path.join("scripts", …)` 或 `"scripts/…"` 等价形态）——贴出修后该行与 `RESOURCE_GATE_REL`/`PROCESS_BUDGET_REL` 三行并列输出。
- [ ] AC3（**生产载体读数**·落地判据）：修后重跑 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts`，"路径字面量常量 (AC1)" 段对 `observation.ts` 的 `LOOP_DRIVER_CHECK_REL` **不再命中**（该段计数下降或为空），贴出修后整段输出。⛔ 不以"代码读起来对了"或"单测绿"代替这条生产读数。
- [ ] AC4（负控制·双向）：修后在两个场景各跑一次 `runLoopDriverProbe` 或等价入口（可直接单测调用该函数；无 `plugin/` 的场景可复用既有第三方安装根 fixture，如 `/home/yale/work/ac207-third-party`，或新建等价空根）：①本仓 ⇒ 解析到真实 `loop-driver-check.sh`，行为与修前逐字一致；②无 `plugin/` ⇒ 走"缺失（产品安装无 methodology 层 → 未接入）"的**显式**路径，而不是 spawn 失败 / ENOENT。两次输出都贴出。
- [ ] AC5（`OBSERVER_REGISTRY_CONF` 处置留痕）：贴出对 `:3201`/`:3542` 的最终处置——迁移后的解析调用点，**或**就地例外注释（含理由）加一条触发该分支的测试；二者必有其一且可复核（`grep -n` 输出 + 相应测试运行结果）。
- [ ] AC6（回归）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0；`packages/quay/test/observation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-observation-loop-driver-check-rel-module-relative` 绿（或等价 scoped 静态门）。

## DoD

修后 `LOOP_DRIVER_CHECK_REL` 走正规解析器，且 `identity-replication-check.ts` 的**生产读数**不再报它（贴修前/修后两段）；AC4 的双向负控制（解析成功 vs 显式"未接入"）各贴一次真实输出；`OBSERVER_REGISTRY_CONF` 的处置（迁移或声明）有可复核的落点。⛔ 只改常量字符串、没跑过解析路径不算完成。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/plugin-root.ts
- packages/quay/test/observation.test.mjs
- tasks/gap-observation-loop-driver-check-rel-module-relative.md
