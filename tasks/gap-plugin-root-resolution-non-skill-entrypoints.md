---
id: gap-plugin-root-resolution-non-skill-entrypoints
title: 非 skill 入口无法定位 plugin 脚本——cli/driver.ts:166 从 workspace root 拼
  plugin/scripts/driver-runtime.ts，AC168 停止复制后下游 quay driver start 必失效（SPEC
  未覆盖的承重前提）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**发现（2026-09-05 直接量，读码 + 行号核对，非推测）**：`packages/quay/src/cli/driver.ts:166` 把驱动内核解析为
`path.join(<workspace root>, "plugin/scripts/driver-runtime.ts")`，文件缺失即 `driver runtime kernel not found` 退出（:167-169）。
而 `:16-20` 的注释写明**这是 AC139-4 故意为之**——明确不能用 `import.meta.url` walk-up，因为它会命中 worktree 副本，
那正是 2026-08-23「常驻 supervisor 挂在短命 worktree 上」的载体死亡根因。

⇒ **今天下游项目能跑两层循环，恰恰依赖 quay-init 复制进去的 117–131 个脚本。**
`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 的 AC168 一旦把安装写入收缩到 §6 闭集
（只建 quay 项目文件 + 写 Claude Code 侧配置、不复制任何脚本），`quay driver start` 在**每一个**下游项目都会失败。
SPEC §9-T1 实测的 `${CLAUDE_PLUGIN_ROOT}` **只在 skill 载入时做文本级展开**，救不了 CLI / cron / OS anchor 这类非 skill 入口。

**这是 SPEC 未覆盖的一个承重前提，是 AC168 的硬前置。** 本任务只答「怎么解析」，**不做 AC168 的收缩本身**
（收缩在 W3 的 quay-init 瘦身任务，体量在 2443 行与约 25 个 `quay-init*.test.mjs` 上）。

解析器契约须同时满足三条，缺一即不成立：
① 从 worktree 调用时**永不**命中 worktree 副本（AC139-4 的原始约束不得被推翻，它有一次真实载体死亡作背书）；
② **不要求**目标项目本地存在 `plugin/` 副本（否则等于没废除复制）；
③ npm-global 安装（`packages/quay/package.json` 的 `files` 白名单含 `plugin`，实测打包出 `packages/quay/plugin/`，gitignored 的暂存）
与 plugin marketplace 安装两条路径**都**能解析到。

⛔ 本任务不新增常驻 `plugin/scripts/*` 脚本：入口普查是一次性动作，产出写进任务体与 SPEC，
避免再造一个「造好了、测试绿了、从没接进生产」的对象——那正是 SPEC §12d 记录的死集里 56/94 的成因。

## AC

- [ ] AC1 入口普查（**按位置判定，不按关键词**）：枚举全部「从 workspace root 拼 `plugin/scripts/` 或 `plugin/` 路径」的非 skill 入口（至少覆盖 `packages/quay/src/cli/` 下各 handler、cron/OS anchor 安装物、precommit hook、`scripts/test.sh`）；**命中条数 + 前 3 条实际内容（文件:行 + 原文）写进本任务体**。对已知真样本 `packages/quay/src/cli/driver.ts:166` 干跑必须命中——命中数为 0 判谓词写错，⛔ 不判「无此问题」。
- [ ] AC2 负控制复现（读生产形态，非 fixture）：建一个只有 `.quay/config.yml`、**无 `plugin/` 目录**的临时 workspace，跑 `node packages/quay/bin/quay.ts driver status --kind promotion`，当前必须复现 kernel-not-found；**该输出逐字入任务体**（这就是 AC168 落地后下游项目的形态）。
- [ ] AC3 契约成文：在 SPEC 新增的 §6b 中回填**选定方案**与**被否方案及其理由**，三条约束逐条对应可执行判据。
- [ ] AC4 解析器 + 双向测试：选定方案实现为**单一**解析器（`packages/quay/src/plugin-root.ts`）；`cli/driver.ts` 改走它；测试须含负控制——**从一个 worktree cwd 调用时解析结果不得指向该 worktree 的副本**（把返回值改成 worktree 路径即红），且无本地 `plugin/` 时仍能解析（把解析器改回 workspace-root 拼接即红）。

## DoD

真实操作过一次，而不是仅有文件：在 AC2 那个**无 `plugin/` 的临时 workspace** 里，经新解析器 `quay driver status --kind promotion`
返回真实状态（不再 kernel-not-found），输出留读数；且负控制测试在把解析器改回 workspace-root 拼接时**实际跑出红**并留读数。
⛔ 仅新增 `plugin-root.ts` 与测试文件、或只在本仓库（自带 `plugin/`）验证通过，均不算达成——本仓库恰好总能解析成功，
在这里绿是结构上不可能取假的量（硬规则 4）。

## Touches

- packages/quay/src/plugin-root.ts（新，唯一解析器）
- packages/quay/src/cli/driver.ts（内核路径解析改走新解析器，保留 AC139-4 的拒 worktree 语义）
- packages/quay/test/plugin-root.test.mjs（新，双向负控制：worktree 不得命中、无本地 plugin 仍可解析）
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md（回填 §6b 选定方案与被否理由）
- tasks/gap-plugin-root-resolution-non-skill-entrypoints.md（自身）
