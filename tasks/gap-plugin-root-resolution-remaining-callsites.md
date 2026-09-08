---
id: gap-plugin-root-resolution-remaining-callsites
title: 非 skill 入口的剩余 workspace-root 拼接点未接入统一解析器——AC168 收缩前必须先补齐（§6b 已知连带面）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`gap-plugin-root-resolution-non-skill-entrypoints`（已 done）修了 `cli/driver.ts:166` 一处、建了唯一解析器 `packages/quay/src/plugin-root.ts`（`resolvePluginRoot()`/`resolvePluginScript()`），并在其 AC1 普查中枚举出**另外 7 个文件、两类不同缺陷**仍未迁移，显式记在该任务 Evidence 与 Touches 边界里（"迁移属 AC168 收缩本体连带面，不在本任务 Touches"）。SPEC §6b（`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`）同样把这些文件点名为"AC168 的连带面"。

两类缺陷（不可合并处理，判据不同）：
- **workspace-root 拼接**（违反解析器契约②——不得要求本地 `plugin/` 副本）：`serve-sessions.ts:498/537`、`fan-in/ff-merge.ts:200/273/327`、`mcp-server.ts:152`、`os-anchor-watchdog.sh:254/295-296`、`os-anchor-install.sh:281/301`、`precommit-guard.ts:454/476`、`scripts/test.sh`（数十条 `${repo_root}/plugin/scripts/`）。
- **`import.meta.url` walk-up 无 worktree 判**（违反契约①——AC139-4 原始缺陷类，2026-08-23 载体死亡的同族根因）：`cli/manager.ts:51-64`、`observation.ts:2041/2630-2631/2728`、`serve-send.ts:138/149`、`fan-in/ff-merge.ts:339/354`。

⚠️ `scripts/test.sh` 有别于其余 6 个——它是本仓库自己的开发期测试入口（`CLAUDE.md`："跑测试：scripts/test.sh（唯一入口）"），从未随交付面进入下游项目，**很可能天然豁免**（永远在一个自带 `plugin/` 的检出里跑）。但这是一个待验证的主张，不是既定结论（硬规则 4）——本任务 AC1 要求逐个分类并留证据，不得整体假定。

**为什么这是 AC168 的硬前置，而不是可选清理**：这些点位与 `driver.ts` 完全同构——一旦 `quay-init` 停止复制脚本（AC168），任何仍靠 workspace-root 拼接或无 worktree 判的 walk-up 定位脚本的下游入口都会在下游项目**当场失效或退化为命中 worktree 副本**（后者是已经死过一次的载体死亡形态，不是假设）。`gap-plugin-root-resolution-non-skill-entrypoints` 已经证明了这个失败模式对 driver.ts 是真实的；这 11 处（7 文件 + 4 处 walk-up）与它同构，只是还没被逐一验证/迁移。

## AC

- [ ] AC1 逐点分类：对已枚举的 11 处（7 文件 workspace-root 拼接 + 4 处 import.meta.url walk-up）逐一判定"下游可达"（下游项目会跑到这段代码）还是"仓库内部专用"（如疑似的 `scripts/test.sh`），每条附一句证据。分类结果连同判据写入任务体，`scripts/test.sh` 的豁免主张必须有独立验证（例如：搜索它是否出现在任何交付/打包清单或下游 quay-init 产物里），不得只凭直觉排除。
- [ ] AC2 迁移全部"下游可达"的 TypeScript 入口（`serve-sessions.ts`、`fan-in/ff-merge.ts` 两类问题、`mcp-server.ts`、`precommit-guard.ts`、`cli/manager.ts`、`observation.ts`、`serve-send.ts`）改走 `resolvePluginRoot()`/`resolvePluginScript()`；每处迁移都保留原有的 AC139-4 拒 worktree 语义（不得退化）。
- [ ] AC3 迁移两个 shell 入口（`os-anchor-watchdog.sh`、`os-anchor-install.sh`）：不得重新发明第四套判定算法（单一正本原则）——通过一个薄 node CLI 包一层调 `plugin-root.ts` 的解析函数，或等价地把三步契约（env 指针 → worktree 重定向 → 逐层探测）原样搬到 bash，两者选一并说明理由。
- [ ] AC4 每个迁移点补双向负控制测试（worktree 场景不得命中 worktree 副本；下游可达场景不要求本地 `plugin/`），可复用/扩展 `packages/quay/test/plugin-root.test.mjs` 的既有矩阵而非各自重造。
- [ ] AC5 若 AC1 判定 `scripts/test.sh` 确属仓库内部专用（豁免），把该结论与证据写回 SPEC §6b 的被否方案表旁注；若判定它并非豁免（下游确实会跑到），按 AC2/AC3 同法迁移。

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
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-plugin-root-resolution-remaining-callsites.md
