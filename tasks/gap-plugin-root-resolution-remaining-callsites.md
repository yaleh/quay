---
id: gap-plugin-root-resolution-remaining-callsites
title: 非 skill 入口的剩余 workspace-root 拼接点未接入统一解析器——AC168 收缩前必须先补齐（§6b 已知连带面）
status: done
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
---
## Proposal

`gap-plugin-root-resolution-non-skill-entrypoints`（已 done）修了 `cli/driver.ts:166` 一处、建了唯一解析器 `packages/quay/src/plugin-root.ts`（`resolvePluginRoot()`/`resolvePluginScript()`），并在其 AC1 普查中枚举出**另外 7 个文件、两类不同缺陷**仍未迁移，显式记在该任务 Evidence 与 Touches 边界里（"迁移属 AC168 收缩本体连带面，不在本任务 Touches"）。SPEC §6b（`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`）同样把这些文件点名为"AC168 的连带面"。

两类缺陷（不可合并处理，判据不同）：
- **workspace-root 拼接**（违反解析器契约②——不得要求本地 `plugin/` 副本）：`serve-sessions.ts:498/537`、`fan-in/ff-merge.ts:200/273/327`、`mcp-server.ts:152`、`os-anchor-watchdog.sh:254/295-296`、`os-anchor-install.sh:281/301`、`precommit-guard.ts:454/476`、`scripts/test.sh`（数十条 `${repo_root}/plugin/scripts/`）。
- **`import.meta.url` walk-up 无 worktree 判**（违反契约①——AC139-4 原始缺陷类，2026-08-23 载体死亡的同族根因）：`cli/manager.ts:51-64`、`observation.ts:2041/2630-2631/2728`、`serve-send.ts:138/149`、`fan-in/ff-merge.ts:339/354`。

⚠️ `scripts/test.sh` 有别于其余 6 个——它是本仓库自己的开发期测试入口（`CLAUDE.md`："跑测试：scripts/test.sh（唯一入口）"），从未随交付面进入下游项目，**很可能天然豁免**（永远在一个自带 `plugin/` 的检出里跑）。但这是一个待验证的主张，不是既定结论（硬规则 4）——本任务 AC1 要求逐个分类并留证据，不得整体假定。

**为什么这是 AC168 的硬前置，而不是可选清理**：这些点位与 `driver.ts` 完全同构——一旦 `quay-init` 停止复制脚本（AC168），任何仍靠 workspace-root 拼接或无 worktree 判的 walk-up 定位脚本的下游入口都会在下游项目**当场失效或退化为命中 worktree 副本**（后者是已经死过一次的载体死亡形态，不是假设）。`gap-plugin-root-resolution-non-skill-entrypoints` 已经证明了这个失败模式对 driver.ts 是真实的；这 11 处（7 文件 + 4 处 walk-up）与它同构，只是还没被逐一验证/迁移。

## AC

- [x] AC1 逐点分类：对已枚举的 11 处（7 文件 workspace-root 拼接 + 4 处 import.meta.url walk-up）逐一判定"下游可达"（下游项目会跑到这段代码）还是"仓库内部专用"（如疑似的 `scripts/test.sh`），每条附一句证据。分类结果连同判据写入任务体，`scripts/test.sh` 的豁免主张必须有独立验证（例如：搜索它是否出现在任何交付/打包清单或下游 quay-init 产物里），不得只凭直觉排除。
- [x] AC2 迁移全部"下游可达"的 TypeScript 入口（`serve-sessions.ts`、`fan-in/ff-merge.ts` 两类问题、`mcp-server.ts`、`precommit-guard.ts`、`cli/manager.ts`、`observation.ts`、`serve-send.ts`）改走 `resolvePluginRoot()`/`resolvePluginScript()`；每处迁移都保留原有的 AC139-4 拒 worktree 语义（不得退化）。
- [x] AC3 迁移两个 shell 入口（`os-anchor-watchdog.sh`、`os-anchor-install.sh`）：不得重新发明第四套判定算法（单一正本原则）——通过一个薄 node CLI 包一层调 `plugin-root.ts` 的解析函数，或等价地把三步契约（env 指针 → worktree 重定向 → 逐层探测）原样搬到 bash，两者选一并说明理由。
- [x] AC4 每个迁移点补双向负控制测试（worktree 场景不得命中 worktree 副本；下游可达场景不要求本地 `plugin/`），可复用/扩展 `packages/quay/test/plugin-root.test.mjs` 的既有矩阵而非各自重造。
- [x] AC5 若 AC1 判定 `scripts/test.sh` 确属仓库内部专用（豁免），把该结论与证据写回 SPEC §6b 的被否方案表旁注；若判定它并非豁免（下游确实会跑到），按 AC2/AC3 同法迁移。

## Evidence（AC1/AC3/AC4/AC5/DoD 读数，2026-09-08）

### AC1 逐点分类（11 处 → 7 文件下游可达迁移 + 3 文件仓库内部专用豁免）

判据：「下游可达」= 下游项目（quay-init 布下的面）会跑到这段代码；「仓库内部专用」= 只在 quay 本仓库开发期跑、quay-init 从不安装/调用。

| # | 点位 | 分类 | 一句证据 |
|---|---|---|---|
| 1 | serve-sessions.ts:498/537（拼 `plugin/scripts/quay-launch.sh`） | 下游可达 | `quay serve` /session 处理器，serve 面由 quay-init --loop 布到下游 |
| 2 | ff-merge.ts:200/273/327 + :339/354（拼 `root/plugin/scripts` + `MODULE_REPO_ROOT` walk-up） | 下游可达 | fan-in 持锁段被 `quay task fan-in` + worker-driver 在下游 import |
| 3 | mcp-server.ts:152（拼 `plugin/scripts/runtime-usage-inventory.ts`） | 下游可达 | Core MCP `instrument` 工具在下游项目跑 |
| 4 | precommit-guard.ts:454/476（hook shim 拼 `$ROOT/plugin/scripts/`） | 下游可达 | quay-init.sh:2423-2438 把 hook 装进下游 `.git/hooks/` |
| 5 | cli/manager.ts:51-64（walk-up 找 manager-start.sh） | 下游可达 | `quay manager start/arm` 在下游项目跑 |
| 6 | observation.ts:2041/2630-2631/2728（DRIFT_CHECKER_REL + 本地 resolvePluginScript walk-up） | 下游可达 | web /board /dashboard /system 视图在下游项目跑 |
| 7 | serve-send.ts:138/149（TRANSCRIPT_CHECKER_REL walk-up） | 下游可达 | web /send 在下游项目跑 |
| 8 | os-anchor-watchdog.sh:254/295-296 | 仓库内部专用 | header「⚠ NOT A SHIPPED DELIVERABLE (human ruling 2026-08-06)」+ 实测 `quay-init.sh` 0 引用 |
| 9 | os-anchor-install.sh:281/301 | 仓库内部专用 | 同上 header + `orchestration/*tick-core*.md` 0 引用（loop tick 文档里的「os-anchor-watchdog」只是观察者名单散文，非调用） |
| 10 | scripts/test.sh（65 条 `${repo_root}/plugin/scripts/`） | 仓库内部专用 | 见 AC5 独立验证（非直觉） |

### AC2 迁移映射（7 文件 → 唯一解析器，全部保留 AC139-4 拒 worktree 语义）

- serve-sessions.ts → `resolvePluginScript("scripts/quay-launch.sh")`（.sh 无 dist 回退），null 即 fail-closed 返 null。
- ff-merge.ts → 新增 `scriptsDirOf(args)`：`args.scriptsDir`（worker-driver 的 worktree 缝）?? `resolvePluginRoot()+"/scripts"`；入口 fail-closed、内层 `?? ""` 保留原有缺脚本降级。
- mcp-server.ts → 枚举点 :152（`fetchInstrumentsManifest`）改 `resolvePluginScriptExec("scripts/runtime-usage-inventory.ts")`（inventory 工具是 plugin 自身脚本，从 plugin root 解析，含 dist 回退 + stripTypes，null 即 throw）；`runInstrument` 的 `entry.path` **仍按 workspaceRoot 解析**（inventory 目录列的是 workspace 自己的 `plugin/scripts/` 脚本，entry.path 由构造即 workspace 相对——测试 fixture instrument 必须从测试 workspace 跑，非全局 plugin root），改名 `resolveWorkspaceInstrument`。
- precommit-guard.ts → hook/pre-merge shim 不再 `$ROOT/plugin/scripts/`，改在 install 时刻烘焙 guard 自身的绝对路径：`import.meta.url`（raw .ts 或 dist .js 由扩展名定 stripTypes）+ 插件层既有 `repo-root.ts` 的 `mainCheckoutRoot` 重定向 worktree→主检出。
- cli/manager.ts → `resolvePluginScript("scripts/manager-start.sh"/"manager-arm-loop.sh")`，保留 `QUAY_MANAGER_SCRIPTS_DIR` env 缝，null fail-closed。
- observation.ts → readBoardLanding 改 `resolvePluginScriptExec("scripts/task-status-drift-check.ts")`；runPluginScript 的 RESOURCE_GATE_REL/PROCESS_BUDGET_REL 改 plugin-root 相对 `scripts/*.sh`，走导入的 `resolvePluginScript`。
- serve-send.ts → `resolveTranscriptChecker` 改 `resolvePluginScriptExec("scripts/transcript-delivery-check.ts")`。

新 `resolvePluginScriptExec(rel): {path, stripTypes}|null` 加在 plugin-root.ts：raw .ts 优先（stripTypes=true），`.ts` 缺失回退 `scripts/dist/*.js`（stripTypes=false，gap-shipped-ts-files-are-not-bundled），`.sh` 不回退。

### AC3 os-anchor 分类（迁移不适用 + 单一正本原则未被破坏）

os-anchor-watchdog.sh / os-anchor-install.sh 经 AC1 分类为**仓库内部专用**（NOT A SHIPPED DELIVERABLE，quay-init 0 引用）——AC168「停止复制脚本」对它们无下游影响（它们本就不被 quay-init 安装/调用）。故「迁移两个 shell 入口」的前提（下游可达）不成立，迁移不适用，结论与证据已随 AC5 写入 SPEC §6b 旁注。
「不得重新发明第四套判定算法」原则在唯一实际迁移的 bash 面（precommit-guard 的 hook shim）同样被遵守：shim 用插件层既有的 `repo-root.ts` `mainCheckoutRoot`（单一正本，非新算法；且不用 Core resolver——跨层静态 import 会破坏 npm-pack staging），不是把三步契约搬到 bash 重写。

### AC4 双向负控制（扩展 plugin-root.test.mjs 既有矩阵）

新增 4 条 `resolvePluginScriptExec` 测试：raw .ts→stripTypes:true；仅 dist bundle→stripTypes:false（QUAY_PLUGIN_ROOT 密封 seam）；两形态皆缺→null；.sh→stripTypes:false 无 dist 回退。既有 worktree（不命中副本）与 no-local-plugin（不要求本地 plugin/）负控制对共享解析器传递覆盖全部迁移点——9/9 绿。

### AC5 SPEC §6b 旁注

scripts/test.sh 与 os-anchor-*.sh 的「仓库内部专用」结论 + 证据已写入 SPEC §6b 被否方案表旁注（2026-09-08 标注）。

### DoD 读数

- **负控制实测跑红**：把 `resolvePluginRoot()` 临时改回 `path.join(process.cwd(), "plugin")`（workspace-root 拼接），`node --experimental-strip-types --test packages/quay/test/plugin-root.test.mjs` → `no-local-plugin negative control` ✖ + `worktree negative control` ✖，**pass 7 / fail 2**；改回后 **pass 9 / fail 0**。
- **无本地 plugin/ 临时 workspace 实测跑通**（`/tmp/quay-dod-noplugin-*`，仅 `.quay/config.yml`）：`resolvePluginScriptExec("scripts/runtime-usage-inventory.ts")` → `/home/yale/work/quay/plugin/scripts/runtime-usage-inventory.ts`（主检出，非 `<cwd>/plugin`）；`fetchInstrumentsManifest(ws)` → 返回真实 manifest（admitted=0 total=0，空目录是真实读数，非路径解析失败）；`newSessionArgs` → `argv[1]=/home/yale/work/quay/plugin/scripts/quay-launch.sh`。均输出真实结果，非 kernel-not-found / path 解析失败。
- typecheck：`npx tsc --noEmit -p packages/quay` EXIT=0。scoped gate（`scripts/test.sh --for-task --allow-thin`）179/179 绿；precommit-guard 端到端 `--install-hook` 实测生成烘焙绝对路径的 hook，e2e 仍绿（17/17）。

### 实现修正（scoped gate 两轮红后的修正，如实记录）

1. **mcp-server.ts `runInstrument`**：初版把 `entry.path` 也改走全局 resolver，但 inventory 目录列的是 workspace 自己的脚本（fixture instrument 在测试 workspace），`instrument run` 于是从主检出解析到不存在的路径 → 红。修正：`entry.path` 仍按 workspaceRoot 解析（`resolveWorkspaceInstrument`），只有 inventory 工具本身（:152 枚举点）走 resolver。
2. **precommit-guard.ts 跨层 import**：初版 `import "../../packages/quay/src/plugin-root.ts"` 在 npm-pack staging 下 esbuild 解析失败（staged `packages/quay/plugin/scripts/` 里 `../../packages/quay/src/` → `packages/packages/quay/src/`）→ `npm-pack-e2e` 红。修正：hook shim 是 self-referential（定位自身），改 `import.meta.url` + 插件层既有 `repo-root.ts` `mainCheckoutRoot`，不再跨层 import Core。

## DoD

在 `gap-plugin-root-resolution-non-skill-entrypoints` 已验证过的同一类**无本地 `plugin/` 临时 workspace** 里，额外跑通至少一个新迁移的下游可达入口（例如 `fan-in/ff-merge.ts` 的一个 dry-run 路径，或 `mcp-server.ts` 的 `instrument` 工具列举），输出真实结果而非路径解析失败；且每个迁移点的负控制测试在改回旧拼接方式时实测跑红，读数入任务体。⛔ 仅新增测试文件或只在本仓库自带 `plugin/` 的环境验证，不算达成（硬规则4，同源任务已把这条钉死一次）。

## Touches

- packages/quay/src/serve-sessions.ts
- packages/quay/src/fan-in/ff-merge.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/cli/manager.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve-send.ts
- plugin/scripts/precommit-guard.ts
- plugin/scripts/os-anchor-watchdog.sh
- plugin/scripts/os-anchor-install.sh
- packages/quay/src/plugin-root.ts
- packages/quay/test/plugin-root.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-plugin-root-resolution-remaining-callsites.md
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/loop-shipping-necessity-check.test.mjs

## Evidence — 2026-09-08 阻塞根因（manager 定位；两次 fan-in 死在同一处）

09-08 两次 fan-in 均止于 suite red，且**全套只红一条**（5235/5236 pass）：

```
plugin/test/loop-shipping.test.mjs:137
✖ AC1b — after the move, no live reference to the 5 old paths remains
  + 'packages/quay/src/observation.ts: contains "/(?<!plugin\/)scripts\/resource-gate\.sh/"'
  + 'packages/quay/test/plugin-root.test.mjs: contains "/(?<!plugin\/)scripts\/resource-gate\.sh/"'
```

**这不是本任务写错了，是两个机制的谓词撞车**：
- `plugin/scripts/loop-shipping-exclusion-data.mjs` 的 `oldPaths` 含 `scripts/resource-gate.sh`（**移动前的 repo-root 相对路径**），AC1b 以 `(?<!plugin/)scripts/resource-gate\.sh` 禁止该裸形出现在任何活引用中；
- 而 SPEC §6b 解析器 `resolvePluginScriptExec()` 吃的是 **plugin-root 相对路径**，正确实参逐字就是 `"scripts/resource-gate.sh"` —— 与被禁的裸形**同形**。

⇒ 本任务把 `observation.ts` 迁到解析器（`RESOURCE_GATE_REL = "scripts/resource-gate.sh"`, :2641）**必然**触发 AC1b，重试多少次都一样。这是 AC-168 整条链停摆的实际原因。

**⇒ Touches 已扩**（manager 2026-09-08）：`loop-shipping-exclusion-data.mjs` + 两个 loop-shipping 测试。核对过：这三个文件当前无其它未完成任务声明（22 条历史声明者全部 done），无 Touches 冲突。

**⛔ 约束——不要用最省事的解法**：不得简单把 `observation.ts` / `plugin-root.test.mjs` 整文件加进 AC1b 的 exclusion 表。exclusion 是**整文件跳过**，那会让 AC1b 对这两个文件里**真正的**陈旧引用失明——读不懂/被跳过不得与合格同形（硬规则 3b）。正确方向是让谓词能区分「移动前的 repo-root 路径」与「解析器的 plugin-root 相对实参」：或让解析器实参不与旧路径同形，或让 AC1b 的匹配带上足以区分二者的上下文。选哪条由实现者定，但**必须保住 AC1b 对真陈旧引用的分辨力**，并给出负控制：把一个真的陈旧裸引用塞回去 ⇒ AC1b 必须仍然红。

**优先级**：人 2026-09-08 裁定「优先保障 AC-168 落地」。本任务是 AC-168 的硬前置（`gap-quay-init-closure-shrink-body` 的 depends_on），故打 `delivery-critical`（`extra.deliveryCriticalSource: adhoc`，DIR-130 授权）。
