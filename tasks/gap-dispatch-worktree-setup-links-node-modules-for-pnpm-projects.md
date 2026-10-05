---
id: gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects
title: dispatch-worktree-setup.sh 只会符号链接或 npm install，不认包管理器——pnpm
  项目（cantus）每个新任务 worktree 的 suite 步毫秒级失败并被误判成「无法归因」
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

**机制**（2026-10-05，cantus 项目的一个会话报告，【转引，本任务提出者未复现 pnpm 的拒绝】）：`plugin/scripts/dispatch-worktree-setup.sh:228-250` 的 node_modules 装配只有两条路——主检出有 `node_modules` ⇒ 符号链接进 worktree；没有 ⇒ 在 worktree 里 `npm install`（写死 npm）。它不认包管理器。

cantus 是 pnpm 项目。报告原文要点：worktree 的 node_modules 是指向主仓库的符号链接，pnpm 拒绝它；fan-in 的 suite 步在 6ms / 166ms 就 exit 1 / 2，日志为空，被 driver 判成「失败无法归因」并停派为 needs-human（任务文件里的 `## Needs-Human` 段：`step=suite: suite red`、阻碍原因「exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）」）；该会话把那个 worktree 的 node_modules 换成真实的 `pnpm install` 后，全量 `npm test` 退出 0。

**影响**：任何 pnpm（及其它拒绝共享符号链接的包管理器）项目，每个新派发的任务 worktree 都会同样失败，且失败形态（毫秒级、空日志）让 driver 把基建问题误判成「无法归因」。这与 quay 自己的仓库无关（npm），所以 quay 自己的 suite 永远测不到它。

**修法（方向，实现者可调）**：
1. 装配前判定项目的包管理器：优先读项目声明（`.quay/config.yml` 的 `loop:` 段新增一个可选键，声明 worktree 内的依赖安装命令；键名由实现者定，须在 `packages/quay/src/loop-params.ts` 声明并在 config 注释里文档化），其次探测 `pnpm-lock.yaml` 或 `package.json` 的 `packageManager` 字段。pnpm ⇒ 在 worktree 内装依赖（如 `pnpm install --frozen-lockfile --offline`，内容寻址存储下成本低，命令是否可用由实现者先实测）；npm 或无任何标记 ⇒ 行为**逐字不变**（仍是符号链接）。
2. 安装命令失败 ⇒ 脚本 exit 2 且输出点名原因（现有 npm 分支已是这个形态）；⛔ 不得退化成符号链接再让 suite 在毫秒级无声失败。
3. ⚠️ 约束：仓库的 sh-census 棘轮零余量，改该 .sh 须行数中性；若做不到，把装配逻辑迁到 TS、让 .sh 薄入口化（GOAL-026 的方向）。goal 分支的判据/预览/并入临时 worktree 也有一处依赖装配函数（`gap-goal-branch-worktrees-lack-node-modules` 落地），它同样只会链接——须与本任务用同一个包管理器判定，⛔ 不要两处各写一份。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-worktrees-lack-node-modules`（done）让 goal 分支的 worktree 有依赖，本任务让「有依赖」在 pnpm 项目里真的可用。

## AC

- [ ] `plugin/test/dispatch-worktree-setup.test.mjs` 新增用例（临时仓库，主检出建一个 `node_modules` 目录）：① 无 pnpm 标记 ⇒ 仍是符号链接（既有行为不变）；② 主检出含 `pnpm-lock.yaml` ⇒ 不建符号链接，而是调用配置的安装命令（测试里以一个记录调用的桩命令代替真实 pnpm，断言它被调用且 cwd 是该 worktree）；③ 安装命令非 0 退出 ⇒ 脚本 exit 2，且 worktree 里没有指向主检出的 `node_modules` 符号链接。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `plugin/scripts/` 与 `packages/quay/src/` 内 grep 其它创建 worktree 依赖的点（`symlinkSync` / `ln -s` 与 node_modules 同现，含 goal 分支 worktree 的那处装配函数），把命中数与前 3 条贴进 Evidence，逐条判断是否同样需要包管理器判定；需要且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [ ] `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 退出 0（sh 棘轮不回升）。
- [ ] `node --test plugin/test/dispatch-worktree-setup.test.mjs` 退出 0。

## DoD

真实落地判据：在 pnpm 项目里新派发的任务，其 worktree 得到真实的依赖安装，fan-in 的 suite 步不再因 node_modules 符号链接在毫秒级失败。生产读数看 cantus 的 `.quay/fan-in-step-trace.jsonl` 里随后派发的任务的 suite-end 耗时与结论；它依赖 cantus 的 driver 已加载含本修复的版本，落地时可能尚未满足，完成记录里须写明该读数是否已取得、以及当时 cantus driver 加载的版本。

## Touches

- plugin/scripts/dispatch-worktree-setup.sh
- plugin/scripts/goal-driver.ts
- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/loop-params.ts
- plugin/test/dispatch-worktree-setup.test.mjs
- tasks/gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects.md
