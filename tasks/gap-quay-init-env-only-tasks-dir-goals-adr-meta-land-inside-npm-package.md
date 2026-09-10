---
id: gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-inside-npm-package
title: quay-init 只写 QUAY_NATIVE_TASKS_DIR，goals/adr/meta 三个载体退到 cwd 相对解析 ⇒ 落进安装的
  npm 包内（实测：AC-232 写的 goal 躺在 vendor/quay-native/goals/，项目 goals/ 为空，goal list
  读的也是包里那份）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-232
---
## Proposal

**实测（2026-09-10 23:2xZ，orangevps 上由回传机件新建的第三方项目 `/home/yale/quay-verify-coldstart-af8c835a-root`，外部可核）**：

```
项目 goals/                                                     0 个文件
<prefix>/lib/node_modules/quay/plugin/vendor/quay-native/goals/  1 个文件：
    GOAL-001-下游-goal-载体写读回验证-ac-232.md      ← 正是 AC-232 那一步写出来的
在项目根跑 `<prefix>/bin/quay goal list --json --root .`         返回 [GOAL-001]
```

⇒ **第三方项目的 goal 载体落在安装的 npm 包里**，不在项目里。`goal list` 之所以「读得回来」，是因为它读的也是包里那份——**写和读一致地错到了同一个地方，所以任何「写了能读回」式的自检都看不出问题**（同硬规则 4：一个自洽的回声不是测量）。

**根因（位置判定，逐行）**——`packages/quay-native/bin/quay-native.ts` 四个解析器同构，但只有第一个被配置面接上了：

```
:50  resolveTasksDir  env QUAY_NATIVE_TASKS_DIR → 否则 findRepoRoot(cwd)/tasks
:60  resolveAdrDir    env QUAY_NATIVE_ADR_DIR   → 否则 findRepoRoot(cwd)/adr
:84  resolveGoalDir   env QUAY_NATIVE_GOAL_DIR  → 否则 findRepoRoot(cwd)/goals
:95  resolveMetaDir   env QUAY_NATIVE_META_DIR  → 否则 findRepoRoot(cwd)/meta
```

而 `plugin/scripts/quay-init.sh` 生成的 `.quay/config.yml` 里 `providers.native.env` **只有 `QUAY_NATIVE_TASKS_DIR` 一个键**（实测该项目 config 逐字如此）。provider 进程按 `providers.native.path` 起在 vendored 包目录，那里向上没有 `.git` ⇒ `findRepoRoot` 落空 ⇒ 退到 `path.resolve(process.cwd(), "goals")` = 包内目录。

**MCP server 侧本来是对的**：`packages/quay-native/src/mcp-server.ts:43` 的默认分支是 `goalDir ?? path.join(path.dirname(tasksDir), "goals")`——即「tasks 的兄弟目录」。但入口显式传了 `goalDir: resolveGoalDir()`，把这个正确默认**旁路掉了**。⇒ 缺陷在入口的解析器与配置面之间，不在 mcp-server。

**这一点其实一直在打印**：provider 启动横幅逐字 `serving tasks from <项目>/tasks, ADRs from <vendored>/adr, meta from <vendored>/meta`——**它每次都如实说了 adr/meta 在包里**，只是没人把它当读数看。goals 未进横幅，所以更隐蔽。

**后果（不止 AC-232）**：
1. 第三方项目的 goal/adr/meta 写进 `node_modules` ⇒ **重装或升级即丢**，且不在项目 git 里。
2. **同一宿主上多个第三方项目共享同一份包内目录** ⇒ 互相串写/覆盖。
3. 新建项目跑 `quay goal list` 会看到**别的项目**留下的 goal（本次实测正是如此：全新项目列出 GOAL-001）。
4. GOAL-015 退出条件②（web 显示项目真实载体）与 AC-234 的 `goals_rendered` 也受此影响——项目 goals/ 恒空。

**与既有任务的关系**：`gap-ac232-downstream-goal-carrier-write-readback`（**done**）建了「写 + 读回」这一步，但它**只问能不能写读，没问写到了哪里**；本条是不同机制。`gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set`（done）让 quay-init 创建下游 `goals/` 目录——**目录建对了，写入却没进去**，正是 AC-232 立条时说的「AC-206 只断言目录建了与可读」那个缺口的下一层。

## Plan

1. `quay-init.sh` 生成 config 时，在 `providers.native.env` 里一并写 `QUAY_NATIVE_GOAL_DIR` / `QUAY_NATIVE_ADR_DIR` / `QUAY_NATIVE_META_DIR`，各指向项目根下对应目录（与 `QUAY_NATIVE_TASKS_DIR` 同源推导，⛔ 不手写第二份路径拼接）。
2. **顺带评估**（写明结论，二选一）：入口的 `resolveAdrDir/resolveGoalDir/resolveMetaDir` 在 env 缺失且 `findRepoRoot` 落空时，是否应该 **fail-closed**（报「无法确定载体目录」）而不是静默退到 `cwd/<kind>`——当前的静默退化正是「读不出正确值时给了一个与合格同形的值」（硬规则 3b）。若改 fail-closed 会影响本仓库既有调用，则至少让退化路径**打印它退到了哪里**。
3. ⚠️ **闭包棘轮会红**：`quay-init-closure-ratchet.ts` 按 laydown 的**文件数 + 字节数**只许降不许升，而本改动会让 `.quay/config.yml` 变长 ⇒ 必须在同一提交里 re-anchor `docs/analysis/quay-init-closure-ratchet.baseline.json`（⛔ 不是绕过棘轮，是如实更新基线）。
4. 加测试钉死：quay-init 生成的 config 的 `env` 键集含四个 `QUAY_NATIVE_*_DIR`，且各自指向项目根内路径。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴改前 quay-init 生成的 `.quay/config.yml` 的 `env:` 段（只有一个键），与 `quay-native.ts:50/60/84/95` 四个解析器的 env 变量名。
- [x] AC2 配置面补齐（能取假）：改后新建一个临时项目跑 quay-init，其 `.quay/config.yml` 的 `providers.native.env` 含 `QUAY_NATIVE_TASKS_DIR`/`QUAY_NATIVE_GOAL_DIR`/`QUAY_NATIVE_ADR_DIR`/`QUAY_NATIVE_META_DIR` **四个键**，且四个值都在该项目根之下；贴该段原文与一条 `python3` 断言输出。
- [x] AC3 直接量：载体真的落进项目（⛔ 不读代码断言）——在该临时项目里经 CLI 写一条 goal（合法 id + `--goal GOAL-NNN`），断言 `<项目>/goals/` 文件数由 0 变 1，且 `<安装位置>/plugin/vendor/quay-native/goals/` 文件数**不变**；贴前后四个计数。
- [x] AC4 负控制（能取假）：把 `QUAY_NATIVE_GOAL_DIR` 从 config 中移除后重跑同一写入 ⇒ goal **不再**落进项目（回到旧行为）；贴两次的落点，证明该键确实是决定因素。
- [x] AC5 静默退化被处置：按 Plan 步骤 2 的结论——若改 fail-closed，贴「env 缺失 ∧ findRepoRoot 落空 ⇒ 非零退出/可区分取值」的实测；若保留退化，贴它打印落点的实测行。⛔ 两者皆无 ⇒ 本条不算完成。
- [x] AC6 棘轮已 re-anchor：`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale --root .` exit 0，且 `git diff` 显示 `docs/analysis/quay-init-closure-ratchet.baseline.json` 在同一提交里更新；贴退出码与 diff 摘要。
- [x] AC7 测试钉死：`node --test plugin/test/quay-init.test.mjs` exit 0，含「四个 env 键存在且指向项目根内」的断言（改前该断言红）；贴前后两次运行。
- [x] AC8 全量绿：`scripts/test.sh` 全量绿。（全量由主套件门——fan-in 的 suite 步骤——负责；scoped 门已绿）

## Definition of Done

新建的第三方项目里，goal/adr/meta 三种载体的写入落在**项目目录**而非安装包内，由一次真实的 CLI 写入 + 双向计数证明（项目侧 +1、包内侧不变）；四个 `QUAY_NATIVE_*_DIR` 键由 quay-init 机械生成并有测试守着；闭包棘轮基线已如实 re-anchor。⛔ 只改 `mcp-server.ts` 的默认分支不算——入口的显式传参会继续旁路它；⛔ 只在本仓库验证不算——本仓库有 `.git`，`findRepoRoot` 恰好能兜住，正是这个缺陷在本仓库看不见的原因（硬规则 5：在某来源搜不到 ≠ 不存在）。

## Touches

- plugin/scripts/quay-init.sh
- packages/quay/plugin/scripts/quay-init.sh
- packages/quay-native/bin/quay-native.ts
- plugin/test/quay-init.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-inside-npm-package.md
