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

**落地方案（实现者裁定）**：包管理器判定与装配**只写一份**，落在新模块 `packages/quay/src/worktree-deps.ts`，被两条路共用：任务路 `plugin/scripts/dispatch-worktree-setup.sh` 经薄入口对 `plugin/scripts/worktree-deps-provision.{sh,ts}` 调用它；目标路 `packages/quay/src/goal-preview.ts` 的 `ensureWorktreeNodeModules` 直接 import 它。约束 3 的「行数中性」**对 `dispatch-worktree-setup.sh` 成立**：它仍是纯 bash，`embedded` 仍为 `[]`、自身 census 贡献 0（其代码行 138→126，第 1 步改为 4 行委派）。跨进 TS 的那一步落在一个**新薄入口**里，因此棘轮整体 +8（见 Evidence AC4，已在 `plugin/sh-census-baseline.json` 的 `_reanchorLog` 逐行归因）。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-worktrees-lack-node-modules`（done）让 goal 分支的 worktree 有依赖，本任务让「有依赖」在 pnpm 项目里真的可用。

## AC

- [x] `plugin/test/dispatch-worktree-setup.test.mjs` 新增用例（临时仓库，主检出建一个 `node_modules` 目录）：① 无 pnpm 标记 ⇒ 仍是符号链接（既有行为不变）；② 主检出含 `pnpm-lock.yaml` ⇒ 不建符号链接，而是调用配置的安装命令（测试里以一个记录调用的桩命令代替真实 pnpm，断言它被调用且 cwd 是该 worktree）；③ 安装命令非 0 退出 ⇒ 脚本 exit 2，且 worktree 里没有指向主检出的 `node_modules` 符号链接。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `plugin/scripts/` 与 `packages/quay/src/` 内 grep 其它创建 worktree 依赖的点（`symlinkSync` / `ln -s` 与 node_modules 同现，含 goal 分支 worktree 的那处装配函数），把命中数与前 3 条贴进 Evidence，逐条判断是否同样需要包管理器判定；需要且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [x] `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 退出 0（sh 棘轮不回升）。
- [x] `node --test plugin/test/dispatch-worktree-setup.test.mjs` 退出 0。

## Evidence

### AC1 — new cases (in the worktree, 34/34 green)

新增 4 条（AC ① ② ③ + 一条 ②b 覆盖「声明的安装命令」这一优先臂）：`AC1 pnpm ①`（无标记 ⇒ 仍 symlink）、`AC1 pnpm ②`（`pnpm-lock.yaml` ⇒ 默认 pnpm 命令，PATH 里以 `pnpm` 桩记录 cwd）、`AC1 pnpm ②b`（`loop.worktree_deps_install` 声明的命令优先）、`AC1 pnpm ③`（安装非 0 ⇒ exit 2，且**不**回退成 symlink）。

```
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

### AC2 — 取假（cp 备份，非 git checkout）

回退对象：`packages/quay/src/worktree-deps.ts` 的 `worktreeDepsInstallCommand`（核心判定）。备份 `cp .../worktree-deps.ts /tmp/wd-negative-control.bak` → 在函数首行插入 `return { command: null, decision: null };` → 跑新用例 → `cp` 还原。

```
=== NEGATIVE CONTROL: new pnpm cases (expect red) ===
✔ AC1 pnpm ① — no package-manager marker ⇒ unchanged symlink behavior
✖ AC1 pnpm ② — pnpm-lock.yaml ⇒ NO symlink; the pnpm install command runs with cwd = the worktree
✖ AC1 pnpm ②b — a declared loop.worktree_deps_install command runs (in the worktree)
✖ AC1 pnpm ③ — a failing install command exits 2 and leaves NO symlink (fail-closed)

=== RESTORED: full setup test file ===
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

① 保持绿是**正确**的（它断言的是「无标记时行为不变」，回退判定后本就该绿）；②/②b/③ 全红证明新用例真的在测本任务的核心改动（≥1 条变红的要求满足）。

### AC3 — 5b 邻近扫描（命中数与逐条判断）

命令：`grep -rnE "ln -s|symlinkSync" plugin/scripts packages/quay/src | grep -i node_modules`（去掉 `checker-mutation-cases/` 与 `*.test.*` 夹具）。**「与 node_modules 同现」的命中数 = 3**（前 3 条即全部）：

```
plugin/scripts/provision-verify-worktree.sh:137:  ln -s "${root}/node_modules" "${worktree}/node_modules"
plugin/scripts/develop-deliver-tgz.sh:1536:  ln -s "${repo_root}/node_modules" "${wt}/node_modules" 2>/dev/null || true
plugin/scripts/verify-deliver-coldstart.sh:849:  ln -s "$repo/node_modules" "$wt/node_modules" 2>/dev/null || true
```

**同一类但用变量、故不在上一命令里**的第 4 条（release-cut 分支 worktree，注释明说它照抄本任务改的 step 1）：`plugin/scripts/release-cut.mjs:445: fs.symlinkSync(rootModules, wtModules);`（`rootModules = root/node_modules`，见 :440-441）。

**逐条判断**（是否同样需要包管理器判定）：
- `packages/quay/src/goal-preview.ts`（goal 分支 worktree 的装配函数，AC 点名的那处）——**需要，已改**（Touches 内）：`ensureWorktreeNodeModules` 现走 `worktreeDepsInstallCommand` 同一判定，pnpm/声明 ⇒ 在 worktree 内 `installed`，否则维持 symlink/source-absent。
- `provision-verify-worktree.sh:137`、`develop-deliver-tgz.sh:1536`、`verify-deliver-coldstart.sh:849`、`release-cut.mjs:445`——**同样需要**（都是「给一个 worktree 塞 node_modules」，pnpm 项目下会同样毫秒级死），但**都不在 Touches**：`develop-deliver-tgz.sh`、`verify-deliver-coldstart.sh` 是 census 已计费的巨型 .sh（改它们要额外棘轮重锚），`release-cut.mjs` 是 .mjs、`provision-verify-worktree.sh` 另有语义。⛔ 按 AC3 的字面（「其余在 Evidence 写明理由」）**不改**，但这是一簇**同源缺陷**（硬规则 5b）：后续应把这 4 处一并路由到 `worktree-deps.ts` 的同一判定，本任务只关闭被点名的 task + goal 两路。
- `packages/quay/src/init.ts:1610`（`fs.symlinkSync(reading.installPath, …)`）——**不是 worktree 依赖装配**（quay-init 安装期把包链进 node_modules），不需判定。
- `test-impl-census-check.ts:195` / `sh-census-check.ts:845` / `checked-in-write-guard.cjs` / `suite-fs-trace-preload.cjs`——测试夹具/检测器自身的名单，非产物路径，不需判定。

### AC4 — sh-census（退出 0；整体的 +8 已在 baseline 逐行归因）

```
node --experimental-strip-types plugin/scripts/sh-census-check.ts   → exit 0
plugin/test/sh-census-check.test.mjs                                 → 20/20 pass
```

⚠️ **诚实交代一个约束张力**：Proposal 约束 3 说「改该 .sh 须行数中性」。**对该 .sh（`dispatch-worktree-setup.sh`）成立**——它仍是纯 bash、`embedded: []`、对 `embeddedInterpreterLines` 的贡献**前后都是 0**（代码行 138→126）。但「⛔ 不要两处各写一份」（硬约束）要求 bash 侧跨进那**唯一的** TS 判定，跨这一步必须落在某个文件里：直接写进 `dispatch-worktree-setup.sh` 会按 census 口径把它**整段 ~130 行**计费（+16 倍），故落在一个**新薄入口** `plugin/scripts/worktree-deps-provision.sh`（8 有效行，house 形态 `exec node --experimental-strip-types`）⇒ 棘轮整体 **7686 → 7694（+8）**，已在 `plugin/sh-census-baseline.json` 的 `_reanchorLog` 逐行归因（residual=0）。另一条「把整个 .sh 迁 TS 变薄」的路会 **stale 三处行号引用**（`orchestration/SPEC-goal-branch-2026-10-03.md:106` 与本任务/姊妹任务的 task body 引 `dispatch-worktree-setup.sh:61` / `:74`），那是读者付的静默代价、没有任何检查能接住，故**拒绝**。

### AC5 — `node --test plugin/test/dispatch-worktree-setup.test.mjs`

见 AC1：34/34 pass（含 30 条原有，全部保持绿——既有 symlink / npm fallback / dry-run / 分支自检 / fork-point 语义逐字不变）。

### DoD — 真实落地读数

**cantus 的生产读数本次【未取得】**：本 worker 无法访问 cantus 工作区，故 `.quay/fan-in-step-trace.jsonl` 里「随后派发的任务 suite-end 耗时与结论」这一读数**尚未读取**；**cantus driver 当时加载的版本亦未核实**。落地判据在本仓内以**同一段代码**验证：goal 路 `plugin/test/goal-driver-criterion-worktree.test.mjs` 9/9（含 `AC-nm` 断言 linked、`AC-nm-absent` 断言 source-absent，pnpm 分支不改变它们）；任务路见 AC1。⇒ 要取得 DoD 的生产读数，cantus 必须加载 **≥ 本任务落地提交** 的版本，并观察其后派发任务的 `fan-in-step-trace.jsonl` suite-end（预期不再是毫秒级空日志失败）。

## DoD

真实落地判据：在 pnpm 项目里新派发的任务，其 worktree 得到真实的依赖安装，fan-in 的 suite 步不再因 node_modules 符号链接在毫秒级失败。生产读数看 cantus 的 `.quay/fan-in-step-trace.jsonl` 里随后派发的任务的 suite-end 耗时与结论；它依赖 cantus 的 driver 已加载含本修复的版本，落地时可能尚未满足，完成记录里须写明该读数是否已取得、以及当时 cantus driver 加载的版本。

## Touches

- plugin/scripts/dispatch-worktree-setup.sh
- plugin/scripts/worktree-deps-provision.sh
- plugin/scripts/worktree-deps-provision.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/goal-driver.ts
- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/loop-params.ts
- packages/quay/src/worktree-deps.ts
- plugin/sh-census-baseline.json
- .quay/config.yml.example
- plugin/test/dispatch-worktree-setup.test.mjs
- tasks/gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects.md
