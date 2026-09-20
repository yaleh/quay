---
id: gap-observation-loop-driver-check-rel-module-relative
title: observation.ts:3200 LOOP_DRIVER_CHECK_REL 仍是模块相对 walk-up 路径字面量——绕过
  plugin-root 解析器（同族另两个常量已迁）
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

- [x] AC1（复现固化）：贴出立案读数逐字（检测器"路径字面量常量"段只有 `observation.ts:3200` 一条），并贴出 `grep -n 'LOOP_DRIVER_CHECK_REL\|OBSERVER_REGISTRY_CONF' packages/quay/src/observation.ts` 的现场输出（须含 :3200/:3201 定义与 :3237/:3542 使用）。
- [x] AC2（位置判定·修后）：`grep -n '\.\./\.\./\.\./.*plugin/scripts' packages/quay/src/observation.ts` **零命中**；且 `LOOP_DRIVER_CHECK_REL` 的取值形态与同族常量一致（`path.join("scripts", …)` 或 `"scripts/…"` 等价形态）——贴出修后该行与 `RESOURCE_GATE_REL`/`PROCESS_BUDGET_REL` 三行并列输出。
- [x] AC3（**生产载体读数**·落地判据）：修后重跑 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts`，"路径字面量常量 (AC1)" 段对 `observation.ts` 的 `LOOP_DRIVER_CHECK_REL` **不再命中**（该段计数下降或为空），贴出修后整段输出。⛔ 不以"代码读起来对了"或"单测绿"代替这条生产读数。
- [x] AC4（负控制·双向）：修后在两个场景各跑一次 `runLoopDriverProbe` 或等价入口（可直接单测调用该函数；无 `plugin/` 的场景可复用既有第三方安装根 fixture，如 `/home/yale/work/ac207-third-party`，或新建等价空根）：①本仓 ⇒ 解析到真实 `loop-driver-check.sh`，行为与修前逐字一致；②无 `plugin/` ⇒ 走"缺失（产品安装无 methodology 层 → 未接入）"的**显式**路径，而不是 spawn 失败 / ENOENT。两次输出都贴出。
- [x] AC5（`OBSERVER_REGISTRY_CONF` 处置留痕）：贴出对 `:3201`/`:3542` 的最终处置——迁移后的解析调用点，**或**就地例外注释（含理由）加一条触发该分支的测试；二者必有其一且可复核（`grep -n` 输出 + 相应测试运行结果）。
- [x] AC6（回归）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0；`packages/quay/test/observation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-observation-loop-driver-check-rel-module-relative` 绿（或等价 scoped 静态门）。

## DoD

修后 `LOOP_DRIVER_CHECK_REL` 走正规解析器，且 `identity-replication-check.ts` 的**生产读数**不再报它（贴修前/修后两段）；AC4 的双向负控制（解析成功 vs 显式"未接入"）各贴一次真实输出；`OBSERVER_REGISTRY_CONF` 的处置（迁移或声明）有可复核的落点。⛔ 只改常量字符串、没跑过解析路径不算完成。

## Evidence（2026-09-20，AC1–AC6 读数 + 处置留痕）

### AC1（复现固化·修前）

立案读数（本条已由修前实跑复现，逐字）：

```
== 路径字面量常量 (AC1) — 1 个 *_REL 常量硬编码 plugin 脚本相对路径 ==
  packages/quay/src/observation.ts:3200  LOOP_DRIVER_CHECK_REL = ".../plugin/scripts/loop-driver-check.sh"
```

`git show develop:packages/quay/src/observation.ts | grep -n 'LOOP_DRIVER_CHECK_REL\|OBSERVER_REGISTRY_CONF'`（修前现场，逐字）：

```
3200:export const LOOP_DRIVER_CHECK_REL = "../../../plugin/scripts/loop-driver-check.sh";
3201:export const OBSERVER_REGISTRY_CONF = "../../../orchestration/observer-registry.conf";
3237:  const r = await runPluginScript(root, LOOP_DRIVER_CHECK_REL, ["--check", "--json", root], 15_000);
3542:    const conf = fileURLToPath(new URL(OBSERVER_REGISTRY_CONF, import.meta.url));
```

**立案时未测到的一件事实（修前实测，硬规则 4 推论三的「生产载体」读数）**：这条不只是「形态不正规」，它是一条**活缺陷**——`resolvePluginScript(rel)` 把 rel 对 **plugin root** 解析，`<repo>/plugin/` 再拼 `../../../plugin/scripts/…` 指向仓库之外，所以**在任何一个仓库（含本仓）loopDriver 探针恒报「未接入」**：

```
readManager(<worktree>) 修前 = {"status":"empty","reason":"../../../plugin/scripts/loop-driver-check.sh 缺失（产品安装无 methodology 层 → 未接入）","verdict":null,"exitCode":null,"detail":null}
```

⇒ AC4① 的「行为与修前逐字一致」在本条**结构上不可能逐字成立**（修前没有任何可对齐的「行为」：它从未解析成功）。修后的**调用面**与修前逐字一致（同一 `runPluginScript`、同一 args、同一 15s 超时、同一 JSON 解析路径），差异只在「解析成功」这一件事上——而那正是本任务要的修复，其读数即 AC3 的生产载体读数。

### AC2（位置判定·修后）

`grep -n '\.\./\.\./\.\./.*plugin/scripts' packages/quay/src/observation.ts` → **零命中**（exit 1）。三行并列（修后）：

```
3078:export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");
3079:export const PROCESS_BUDGET_REL = "scripts/process-budget.sh";
3212:export const LOOP_DRIVER_CHECK_REL = path.join("scripts", "loop-driver-check.sh");
```

使用点修后仍是一处、但走解析器：`3261: const r = await runPluginScript(root, LOOP_DRIVER_CHECK_REL, …)`（`runPluginScript` 首行 `resolvePluginScript(rel)`）。

⛔ 注：常量注释**不得**逐字复写旧字面量——否则上面这条 grep 会被注释命中而永远非零。注释按位置描述该形态，不复写它（首轮实现即踩到这条，已改）。

### AC3（生产载体读数）

修后重跑 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts`：

```
== 路径字面量常量 (AC1) — 0 个 *_REL 常量硬编码 plugin 脚本相对路径 ==
  (none)
```

**零计数非空转的对照（硬规则 2 的另一半）**：同一谓词对**已知为真**的样本仍命中——`plugin/test/identity-replication-check.test.mjs` 的 `findPathConstants` 用例把 `export const RESOURCE_GATE_REL = "../../../plugin/scripts/resource-gate.sh";` 作为正样本并断言命中。⇒ 上面的 0 是「查过且没有」，不是「谓词坏了」。

生产载体读数（修后 `readManager(<worktree>)`，本仓）：

```
{"status":"ok","reason":null,"verdict":"STALLED","exitCode":3,"detail":"loop-driver: STALLED (0) — no loop driver registered; the loop will never tick"}
```

（同根下直跑 `bash plugin/scripts/loop-driver-check.sh --check --json <root>` 得同一 JSON、exit 3 ⇒ 读数来自脚本本身，不是解析层编的。）

### AC4（负控制·双向）

① 本仓（`runLoopDriverProbe(<worktree>)`，修后逐字）：

```
{"status":"ok","reason":null,"verdict":"STALLED","exitCode":3,"detail":"loop-driver: STALLED (0) — no loop driver registered; the loop will never tick"}
resolvePluginScript(LOOP_DRIVER_CHECK_REL) = /home/yale/work/quay/plugin/scripts/loop-driver-check.sh
```

② 无 `plugin/`（`QUAY_PLUGIN_ROOT=<空根>` 密封 seam——与 `packages/quay/test/plugin-root.test.mjs` 已用的同一入口；本机无 `/home/yale/work/ac207-third-party`，故走 AC 允许的「新建等价空根」一支）：

```
{"status":"empty","reason":"scripts/loop-driver-check.sh 缺失（产品安装无 methodology 层 → 未接入）","verdict":null,"exitCode":null,"detail":null}
```

⇒ 走**显式「未接入」**值（`verdict`/`exitCode` 皆 null），**不是** spawn 失败值（`… 未能运行（spawn 失败或超时被杀）`）——两者在输出词表里可区分（硬规则 3b）。两条都已固化为 `packages/quay/test/observation.test.mjs` 的测试（AC4①/AC4② 各一条）。

### AC5（`OBSERVER_REGISTRY_*` 处置：选「迁移」一支，非例外声明）

- `packages/quay/src/observation.ts:3220 export const OBSERVER_REGISTRY_REL = "observer-registry.conf";`（原 `OBSERVER_REGISTRY_CONF` 的模块相对字面量删除。该常量全仓**零外部消费者**：grep 只有定义点 + 原使用点）。
- 新解析器 **`packages/quay/src/plugin-root.ts::resolveOrchestrationFile(rel)`**：`orchestration/` 是 `plugin/` 的**兄弟目录**，plugin-root rel 按构造到不了它；故按「plugin root 的兄弟」解析，并**组合** `resolvePluginRoot()` ⇒ 三条 SPEC §6b 约束（worktree→主检出 / 不要求目标项目有 `plugin/` / 两种安装形态）随继承而非重写。
- 使用点 `:3569 const conf = resolveOrchestrationFile(OBSERVER_REGISTRY_REL);`，读面变**三值**：`缺失（orchestration 树未随安装落地 → 未接入）` / `不可读（<err>）` / `为空`。修前的 catch 分支（「不可读」）**被紧随其后的「为空」赋值覆盖**⇒ 该诊断曾是死代码（硬规则 3b 的镜像半边），本轮一并修正。
- 双向读数（与测试同款两态）：本仓 ⇒ 真实路径 `<repo>/orchestration/observer-registry.conf` + 3 行真实 rows；空根 ⇒ `{"status":"empty","reason":"observer-registry.conf 缺失（orchestration 树未随安装落地 → 未接入）","rows":[]}`。

### AC6（回归）

- `node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` → **exit 0**（本分支实现当刻 8/8；merge develop 后 9/9，见「二次收尾」）
- `packages/quay/test/observation.test.mjs` → **58/58 pass**（含新增 4 条）
- `packages/quay/test/plugin-root.test.mjs` → 20/20；`packages/quay/test/serve-manager-body-i18n.test.mjs` → 11/11
- reader 邻接面：`gap-dashboard-parallelize` 13/13、`serve-ac95-views` 21/21、`serve-system-body-i18n` 11/11、`gap-ac136-web-truth-source` 3/3
- `npx tsc --noEmit -p packages/quay` → exit 0

### 二次收尾（merge develop 后重测 + scoped 门 + 缓存记录）

develop 在本轮窗口内前进（`699565759` → `c7ab1b586`），其中一条**直接改动了本任务 AC3 所依赖的仪器**：`fadb16f45 fix(identity-replication-check): AC3 byte-pair scan skips symlinks`（`plugin/scripts/identity-replication-check.ts` + 其测试）。⇒ 收尾不是仪式，是**对着新仪器重测**：

- 检测器重跑（merge 后，逐字）：`== 路径字面量常量 (AC1) — 0 个 *_REL 常量硬编码 plugin 脚本相对路径 ==` ⇒ AC3 的 0 是在**当前**检测器上测出的，不是立案时那版。
- 检测器自测：**9/9 pass**（develop 侧新增一条用例）。
- scoped 门重跑（`--for-task … --allow-thin`，对 merge 进来的 tip）：**174 tests / 174 pass / 0 fail**，scoped 静态层逐条 PASS（`it0-split-or-commit-check --changed` 报 **NOT-EVALUATED**——本分支相对 develop 没改任务体，该 delta 判据无对象可归属，⛔ 与 PASS 分开取值，硬规则 3b）。无 `selected 0 test files`（该形态 = 假绿）。
- **scoped-gate 缓存**：首写按 prompt 原样用 `$(git rev-parse develop)` 记成 `c7ab1b586`，而那时门跑的树是 merge 的 `^2` = `699565759` ⇒ 一条把**未评估的 tip** 记成 `ok:true` 的假记录（false-skip 方向）。处置：**再 merge develop（把 `c7ab1b586` 真的合进来）→ 再跑一次门 → 显式传该 tip**。自检三项全过：`记录值 == HEAD^2 == develop == c7ab1b586`、`git merge-base --is-ancestor c7ab1b586 HEAD` = TRUE、缓存文件读回 `key = gap-observation-loop-driver-check-rel-module-relative\tc7ab1b586…` 且 `ok:true`。⇒ 这一条缓存是**对着一棵真的评估过的树**写的（同一 sha 从「假」变「真」，判别式必须是写入那一刻记录值与 HEAD 的关系，不是跨轮比 sha 值）。

### 连带修正（同一 diff 内，原因如实记录）

`packages/quay/test/serve-manager-body-i18n.test.mjs` 有一条断言把 **loop-driver 的「缺失（… 未接入）」note** 当作「reader 产出的中文串」这一排除类的**见证**（`mgr.loopDriver.reason` 非 null 且出现在 en 页上）。本条修复恰好把该 note 从页面上**消灭**（这正是修复的可见生产效果：en 页不再渲染 `— …loop-driver-check.sh 缺失（…）`），于是见证改挂在**同一类**的另一个真实成员上——`orchestration/observer-registry.conf` 的 `note` 列（该 fixture 的其余刻意中文载体，本修复后仍从**真实** conf 读出）。残差断言（en 页本页中文 = 0）未放宽，仍绿。该文件因此写入 Touches。

### 5b（同一载体的兄弟实例：报数，不擅自扩面）

`packages/quay/src/observation.ts` 内 `../…` 形态的字面量修后剩 1 处：

```
3713:export const VERIFICATION_ROUND_REL = "../../../.quay/verification-round.jsonl";
```

同为模块相对 walk-up，但**目标类不同**（指向**工作区运行日志**，不是 plugin 脚本），且真正的读点是 `path.join(root, ".quay", "verification-round.jsonl")`，该常量是**死导出**（零消费者）。**不在本任务 Touches 内，未改动**；记录于此供后续立案。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/plugin-root.ts
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-manager-body-i18n.test.mjs
- tasks/gap-observation-loop-driver-check-rel-module-relative.md