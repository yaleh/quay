---
id: gap-plugin-root-resolution-non-skill-entrypoints
title: 非 skill 入口无法定位 plugin 脚本——cli/driver.ts:166 从 workspace root 拼
  plugin/scripts/driver-runtime.ts，AC168 停止复制后下游 quay driver start 必失效（SPEC
  未覆盖的承重前提）
status: done
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

- [x] AC1 入口普查（**按位置判定，不按关键词**）：枚举全部「从 workspace root 拼 `plugin/scripts/` 或 `plugin/` 路径」的非 skill 入口（至少覆盖 `packages/quay/src/cli/` 下各 handler、cron/OS anchor 安装物、precommit hook、`scripts/test.sh`）；**命中条数 + 前 3 条实际内容（文件:行 + 原文）写进本任务体**。对已知真样本 `packages/quay/src/cli/driver.ts:166` 干跑必须命中——命中数为 0 判谓词写错，⛔ 不判「无此问题」。
- [x] AC2 负控制复现（读生产形态，非 fixture）：建一个只有 `.quay/config.yml`、**无 `plugin/` 目录**的临时 workspace，跑 `node packages/quay/bin/quay.ts driver status --kind promotion`，当前必须复现 kernel-not-found；**该输出逐字入任务体**（这就是 AC168 落地后下游项目的形态）。
- [x] AC3 契约成文：在 SPEC 新增的 §6b 中回填**选定方案**与**被否方案及其理由**，三条约束逐条对应可执行判据。
- [x] AC4 解析器 + 双向测试：选定方案实现为**单一**解析器（`packages/quay/src/plugin-root.ts`）；`cli/driver.ts` 改走它；测试须含负控制——**从一个 worktree cwd 调用时解析结果不得指向该 worktree 的副本**（把返回值改成 worktree 路径即红），且无本地 `plugin/` 时仍能解析（把解析器改回 workspace-root 拼接即红）。

## Evidence（AC1/AC2/AC4/DoD 读数）

### AC1 入口普查（按位置判定，非 skill 入口从 workspace root 拼 plugin/ 路径）

命中 **8 个文件**（Core 产品 4 + 安装物/钩子 4；`scripts/test.sh` 单文件内即 ~60 条引用）。前 3 条实际内容：

1. `packages/quay/src/cli/driver.ts:166`（本任务已修）`const kernel = path.join(root, DRIVER_RUNTIME_REL);` —— `:31` `const DRIVER_RUNTIME_REL = path.join("plugin", "scripts", "driver-runtime.ts");`。**已知真样本，干跑命中**（AC2 复现 kernel-not-found，见下）。
2. `packages/quay/src/serve-sessions.ts:498` + `:537` `path.join(input.root, "plugin", "scripts", "quay-launch.sh"),`
3. `packages/quay/src/fan-in/ff-merge.ts:200`（同形 `:273` `:327`）`const scriptsDir = args.scriptsDir ?? path.join(root, "plugin", "scripts");`

其余 5 文件：`packages/quay/src/mcp-server.ts:152`（`path.join("plugin", "scripts", "runtime-usage-inventory.ts")` 按 workspaceRoot 解析）、`plugin/scripts/os-anchor-watchdog.sh:254/:295-296`（`$root/plugin/scripts/supervisor-deliver.sh` / `observer-registry.sh`）、`plugin/scripts/os-anchor-install.sh:281/:301`（`[ -d "$ADD_PROJECT/plugin/scripts" ]` / `die "--add-project … has no plugin/scripts"`）、`plugin/scripts/precommit-guard.ts:454/:476`（`"$ROOT/plugin/scripts/${HOOK_FINGERPRINT}"`）、`scripts/test.sh`（`:183/:206-207/:220/:268/:296/…` 数十条 `${repo_root}/plugin/scripts/`）。

**同族但不同谓词**（`import.meta.url` walk-up，非 workspace-root 拼，不在此 AC 计数内）：`packages/quay/src/cli/manager.ts:51-64`、`packages/quay/src/observation.ts:2041/:2630-2631/:2728`、`packages/quay/src/serve-send.ts:138/:149`、`packages/quay/src/fan-in/ff-merge.ts:339/:354`——它们违反约束 ①（worktree 副本），但 AC168 下不违反 ②；迁移属 AC168 收缩本体连带面，不在本任务 Touches。

### AC2 负控制（逐字，改前）

建 `/tmp/quay-ac2-noplugin`（仅 `.quay/config.yml`，**无 `plugin/`**），跑 `node <worktree>/packages/quay/bin/quay.ts driver status --kind promotion`：

```
fatal: not a git repository (or any of the parent directories): .git
quay driver: driver runtime kernel not found at /tmp/quay-ac2-noplugin/plugin/scripts/driver-runtime.ts
```
EXIT=1。首行 `fatal:` 是 `isWorktreeRoot` 的 `git worktree list` 在非 git 目录的既有 stderr 泄漏（与本修复无关）；关键行是第二行的 kernel-not-found。

### DoD 读数（同一无 plugin/ workspace，改后）

```
fatal: not a git repository (or any of the parent directories): .git
promotion-driver: kind=promotion · supervisor pid=none alive=0 · driver pid=none alive=0 · running=0 · carrier_path=/tmp/quay-ac2-noplugin/.quay/promotion-outcome.jsonl · carrier_records=0 · last_record_ts=null
```
EXIT=0——不再 kernel-not-found；内核经 worktree 重定向解析到主检出 `/home/yale/work/quay/plugin/scripts/driver-runtime.ts`（正是约束 ① 的 worktree 安全在起作用）。

**负控制实测跑红**：把 `resolvePluginRoot()` 临时改回 `path.join(process.cwd(), "plugin")`（workspace-root 拼接），`node --no-warnings --experimental-strip-types --test packages/quay/test/plugin-root.test.mjs` → `no-local-plugin negative control` **✖ 红**（`worktree negative control` 亦红），pass 3 / fail 2；改回后 **pass 5 / fail 0**。typecheck：`npx tsc --noEmit -p packages/quay` EXIT=0。

## DoD

真实操作过一次，而不是仅有文件：在 AC2 那个**无 `plugin/` 的临时 workspace** 里，经新解析器 `quay driver status --kind promotion`
返回真实状态（不再 kernel-not-found），输出留读数；且负控制测试在把解析器改回 workspace-root 拼接时**实际跑出红**并留读数。
⛔ 仅新增 `plugin-root.ts` 与测试文件、或只在本仓库（自带 `plugin/`）验证通过，均不算达成——本仓库恰好总能解析成功，
在这里绿是结构上不可能取假的量（硬规则 4）。

## Touches

- packages/quay/src/plugin-root.ts（新，唯一解析器）
- packages/quay/src/cli/driver.ts（内核路径解析改走新解析器，保留 AC139-4 的拒 worktree 语义）
- packages/quay/test/plugin-root.test.mjs（新，双向负控制：worktree 不得命中、无本地 plugin 仍可解析）
- packages/quay/test/serve-handlers.test.mjs（改：AC1 驱动的 mock kernel 原靠 workspace-root 拼 plugin/scripts 命中——driver.ts 改走 plugin-root 后该 mock 被绕过、真内核输出 not-running 而红；改经 QUAY_PLUGIN_ROOT 环境 seam 指向 mock）
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md（回填 §6b 选定方案与被否理由）
- tasks/gap-plugin-root-resolution-non-skill-entrypoints.md（自身）
