---
id: gap-provision-verify-worktree-step
title: '建「可跑 suite 的验证 worktree」没有共享步骤——A15 ④ 契约空白 ⇒ 今晚三次同族失败（11:12/11:31 AC4 config.yml 缺失、13:14 AC11 config.yml 缺失、13:03 esbuild/node_modules 缺失）；worktreeinclude 机制存在但从未接进验证路径；修= provision-verify-worktree.sh（compose worktree-include + node_modules symlink）+ A15 ④ 显式 substep'
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**「建一个能跑全量 suite 的验证 worktree」没有共享步骤。** A15 ④ 契约里没有「建验证 worktree 要配置什么」这一步——是空白不是疏漏。`git worktree add` 只放 tracked 文件;gitignored 但必需的文件(`.quay/config.yml`、`node_modules`)缺失,套件在环境 gap 上挂,不是在真缺陷上挂。

### 实证(manager 2026-08-10 家族裁定 + outer 复核)

- **三次同类失败,同一个族**:`11:12`/`11:31` — AC4 laid-down tick docs byte-identical;`13:14` — AC11 因 `.quay/config.yml` 缺失;`13:03` — esbuild ERR_MODULE_NOT_FOUND(node_modules 缺失)。**共同点:都是新建的验证/隔离 worktree 缺某项配置,而这项配置在【正常派发的 task worktree】里从来不缺。**
- **根因三层**:
  1. **worktree-include.sh 存在但接错面**:`.worktreeinclude`(2026-08-07)声明 config.yml + vendor dist,`scripts/worktree-include.sh` 机械复制——**但 task 里的 DoD 是全量套件门 DEFERRED**,机制从未被 A15 ④ 验证 worktree 路径调用(grep 无消费者)。task 标 done 但没接线 =「done but not integrated」。
  2. **node_modules 明确排除但无替代**:worktree-include.sh 注释「node_modules is always excluded (the build step symlinks/installs it)」——**这个 symlink 步骤从未存在**。task worktree 的 node_modules 是手搓 symlink(round5-red 实证),验证 worktree 没有。
  3. **无脚本拥有「建可跑验证 worktree」职责**:每次 subagent/主会话现场 `git worktree add` 后,缺什么现场补什么——知识不沉淀,下次原样重来。

**为什么重要**:这是 A15 ④(执行体)的环境前置缺陷。若不修,下一个新建验证 worktree(不管哪个 subagent 还是主会话接管)大概率撞同族另一个缺失项。

### 选定机制方向(实现归 outer 接管,判定归 manager)

1. **共享步骤** `plugin/scripts/provision-verify-worktree.sh`——compose 现有 worktree-include.sh(config.yml + vendor dist)+ node_modules symlink。**A15 ④ 两条路径(suite-fix subagent 正常路径 + outer 未绿退出接管路径)共用同一步。**
2. **A15 ④ 契约显式 substep**:新建验证 worktree 后必须先 provision,再跑 test.sh。
3. **枚举不补单字段**:`.worktreeinclude` 声明 tracked-copy 文件,脚本 link 清单声明 symlink 文件——未来新增文件按声明扩展。

**验证锚**:修后 (a) 新验证 worktree 用 provision-verify-worktree.sh 一次建好,config.yml + node_modules 在位;(b) 不再出现 AC4/AC11/node_modules 同族红;(c) A15 ④ 契约含显式 provision 步骤。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录三次同族失败(11:12/11:31 AC4、13:14 AC11、13:03 node_modules)+ worktree-include 未接线实证 + node_modules 排除无替代实证(本任务 Proposal 已含)
- [x] AC2: **共享脚本**——`provision-verify-worktree.sh` compose worktree-include(config.yml+vendor dist)+ node_modules symlink;幂等;`--dry-run`;fail-closed
- [x] AC3: **A15 ④ 契约接线**——执行核在「在自带 worktree 里跑 test.sh」前有显式 provision 步骤,两条路径共用
- [x] AC4: **枚举完整**——未来新增缺失文件按声明机制扩展(worktreeinclude 声明 copy / 脚本 link 清单声明 symlink),不现场补单字段
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑:provision-verify-worktree.sh 在真实 git worktree 上 config.yml + node_modules 在位(贴输出)
- [ ] 既有测试 + 新增测试全绿(`--for-task` scoped)
- [ ] 全量套件绿(`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`)——外层 verification-round 验证

## Touches

- plugin/scripts/provision-verify-worktree.sh(新共享脚本)
- plugin/test/provision-verify-worktree.test.mjs(新测试)
- plugin/scripts/capability-catalog.sh(QUESTION + PUBLIC_ENTRYPOINTS 声明)
- orchestration/orchestrator-tick-core.md(A15 ④ provision 显式 substep)
- scripts/worktree-include.sh(交叉标注——现有机制,被 compose)
- tasks/gap-provision-verify-worktree-step.md(自身:勾 AC + 贴证据)

## Contract

measure   verify_worktree_provisioned = `bash plugin/scripts/provision-verify-worktree.sh --worktree <fresh-wt> --root "$REPO_ROOT" --dry-run` 的 stdout 中 `node_modules` 出现次数(≥1 即宣称;实跑验证靠 AC/DoD)
band      verify_worktree_provisioned = ≥ 1(dry-run 声明 node_modules symlink + worktree-include copy)
invariant a15_04_has_provision_step = 1(执行核 A15 ④ 含显式 provision 子步骤)
invariant enumerate_not_patch = 1(新缺失文件按声明机制扩展,不现场补单字段)
invoke    `bash plugin/scripts/provision-verify-worktree.sh --worktree <fresh-wt> --root "$REPO_ROOT" --dry-run`(贴输出)
control   共享步骤;A15 ④ 接线;枚举完整;既有不回归
resume    provision 脚本 / A15 ④ 接线 / 枚举扩展分步提交,任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 家族裁定(三次同族失败:11:12/11:31 AC4、13:14 AC11、13:03 node_modules)。实证:worktreeinclude 机制存在但接错面(DoD 全量门 DEFERRED,验证路径无消费者);node_modules 排除无替代(「build step symlinks」从未实现);无脚本拥有建验证 worktree 职责。立案:provision-verify-worktree.sh(compose worktree-include + node_modules symlink)+ A15 ④ 显式 substep。实现归 outer 接管(A15 ④ 未绿退出路径),判定归 manager

## Evidence (inner 2026-08-11)

实现说明:本任务机件实现已由 `feat/provision-verify-worktree` 分支落地并合入 develop/integration(script + test + catalog 声明 + A15 ④ provision substep 全在位)。inner 本次完成:在真实 git worktree 上实跑验证 + 跑 scoped 门 + 勾 AC + 贴证据。

**Contract invoke(dry-run,真实 fresh worktree)** —— `verify_worktree_provisioned` stdout 含 `node_modules` ≥1:

```
$ bash plugin/scripts/provision-verify-worktree.sh --worktree <wt> --root /home/yale/work/quay --dry-run
provision-verify-worktree: [dry-run] would run worktree-include.sh <wt> (config.yml + vendor dist)
provision-verify-worktree: [dry-run] would link /home/yale/work/quay/node_modules -> <wt>/node_modules
provision-verify-worktree: [dry-run] would build packages/quay/dist via npm run build --prefix packages/quay
# exit 0
```

**DoD 实跑(真实 git worktree 上 config.yml + node_modules 在位)**:

```
$ bash plugin/scripts/provision-verify-worktree.sh --worktree <wt> --root /home/yale/work/quay
provision-verify-worktree: running worktree-include.sh <wt> (config.yml + vendor dist)...
worktree-include: copied .quay/config.yml -> <wt>/.quay/config.yml
worktree-include: copied plugin/vendor/quay-native/dist/quay-native.js -> <wt>/plugin/vendor/quay-native/dist/quay-native.js
worktree-include: copied plugin/vendor/quay/dist/quay.js -> <wt>/plugin/vendor/quay/dist/quay.js
worktree-include: done — 3 file(s) copied into <wt>
provision-verify-worktree: linked /home/yale/work/quay/node_modules -> <wt>/node_modules
provision-verify-worktree: building packages/quay/dist (npm run build --prefix packages/quay)...
provision-verify-worktree: packages/quay/dist/quay.js built
# exit 0; 验证: .quay/config.yml 在位、node_modules 是 symlink(→ /home/yale/work/quay/node_modules)、packages/quay/dist/quay.js 在位
```

**幂等 re-run**: `node_modules already present, keeping` / `packages/quay/dist/quay.js already present, keeping`,exit 0(无错)。

**AC5 scoped 门**(`./scripts/test.sh --for-task gap-provision-verify-worktree-step`):

```
ℹ tests 20   ℹ pass 20   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
=== SCRIPT EXIT: 0 ===
(含 AC1 node_modules symlink / AC3 idempotent / AC4 dry-run / AC5 fail-closed / AC6 dist build 五条 + capability-catalog 接线全绿)
```
