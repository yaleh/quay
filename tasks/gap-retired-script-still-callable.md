---
id: gap-retired-script-still-callable
title: 退休脚本仍可调用——send-keys-verified.sh 是 Layered retirement
  范式原型(NEVER_LAYDOWN)但没退干净:①仍可调用(2026-08-10 我调用发错指引)②测试泄漏 tmux(144
  孤儿进程/round-210 红);capability-catalog 管入口、gate-scripts-retirement
  管出口单案例,缺「被取代机件是否仍有调用者」检查;加 superseded 表+三检查(不进 laydown/不教学/静态调用者 0)
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（2026-08-10 人裁定：删除——A-E 完整计划，先定目标态再对照）

**结晶阶段删除是必要的——遗留残骸污染上下文，已经引起了错误的行为（今晚实证：读到 send-keys-verified.sh、指错工具、误判 false-done）。目标态：①一个能力=一个实现，同名第二份即污染源；②被取代的实现**不存在于仓库**（不是「不铺设」是不存在），因此不可能被调用/被读到/被带进上下文；③历史留在**记录层**（ADR/任务体/结晶文档），不留在**可执行层**（plugin/scripts、plugin/test、packages/*/plugin vendored 副本）；④入口文档指向机件不复述规程（CLAUDE.md:204/207 已改 ✓）；⑤一道机械检查保证①-④不回潮。**

### 实证（人 2026-08-10 裁定 + outer 复核）

- **目标态①直接证据**：plugin 版（3457B,有统一 --help）与 vendored 版（3038B,无）**已漂移 7 行**——同名同能力两份实现已经分叉。
- **目标态②的反面**：quay-init-check-drift.test.mjs:212 断言「must still exist in the plugin tree (layered retirement keeps the file)」——正是「存在但不铺设」的反面,须改成「不存在」。
- **四类实体清点**：
  - **A 删除（4 实体）**：plugin/scripts/send-keys-verified.sh (3457B)、packages/quay/plugin/scripts/send-keys-verified.sh (3038B)、plugin/test/send-keys-verified.test.mjs (13204B)、docs/analysis/send-keys-verified-test-leaks-tmux-servers.md (2461B)。删 test.mjs 顺带解决 gap-send-keys-verified-leaks-tmux-servers-unincorporated（144 孤儿/700MB,round-210 红）。
  - **B 必须同步改否则删了就红**：quay-init-check-drift.test.mjs:211-216（「存在但不铺设」→「不存在」）、quay-init-drift-report.test.mjs:203、install-config-driven-e2e.test.mjs:575（写进临时工作区当夹具）、adr016-screen-use-check.test.mjs:107/160/163（断言 retired>=1）、adr016-screen-use-check.ts:74（KNOWN RETIRED 表含它）、capability-catalog.sh:207（声明行）、quay-init.sh:816（NEVER_LAYDOWN,文件没了不需要）。
  - **C 保留（记录层,正确历史）**：adr/ADR-016、CRYSTALLIZED-reliable-send-2026-08-04.md、outer-rulings-2026-08-04-A-F.md、tasks/*.md、send-keys-reliable.sh 头注释里「为什么取代它」那几行。
  - **D 悬空命名重命名**：退休范式「Layered retirement (**send-keys-verified precedent**)」在 quay-init.sh:30 / plugin-packaging.test.mjs:513 / gate-scripts-retirement.test.mjs:7——删了文件这名字悬空;范式改名（建议「分层退休」,或改以 gate-scripts 为存活范例）。
  - **E 目标态⑤检查**：capability-catalog 加 superseded 表（与声明表单正本同构）+ 检查：superseded 实现不得存在于 plugin/scripts、plugin/test、packages/*/plugin;且不得出现在 SKILL/README 教学位置。载体 = 本任务（gap-retired-script-still-callable）。

**为什么重要**：删除是结晶的收尾——不删则残骸持续污染上下文（今晚已实证）。A-E 完整计划保证删除后不红、历史保留在记录层、范式改名不悬空、机械检查不回潮。

### 选定机制方向（实现归内层，接法留执行时）

1. **A 删除**：4 实体删除（含 vendored 副本）。
2. **B 同步改**：8 处断言/声明从「存在但不铺设」→「不存在」或移除。
3. **D 范式改名**：「分层退休」或 gate-scripts 存活范例,3 处。
4. **E superseded 表 + 检查**：capability-catalog,接线 run_static_checks。
5. **C 保留**：记录层不动。

**验证锚**：修后 (a) 4 实体不存在;(b) B 处不红（scoped 门）;(c) 范式改名无悬空;(d) E 检查在档。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 A-E 四类清点 + 目标态①②证据（本任务 Proposal 已含）
- [x] AC2: **A 删除**——4 实体删除（plugin/vendored/test/docs）
- [x] AC3: **B 同步改**——8 处断言「存在」→「不存在」或移除,删除后 scoped 门不红
- [x] AC4: **D 范式改名**——「分层退休」或 gate-scripts 范例,3 处无悬空
- [x] AC5: **E superseded 表 + 检查**——capability-catalog 加表 + 接线 run_static_checks
- [x] AC6: **C 保留**——记录层（ADR/结晶/任务）不动
- [x] AC7: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC7 全部勾上
- [x] 修后实跑：4 实体不存在 + B 处绿 + 范式无悬空 + E 检查在档（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-10）

**A 删除（git rm）**：`plugin/scripts/send-keys-verified.sh`、`plugin/test/send-keys-verified.test.mjs`、`docs/analysis/send-keys-verified-test-leaks-tmux-servers.md` 已 git rm。vendored 副本 `packages/quay/plugin/scripts/send-keys-verified.sh` 是 gitignored 的 pack-time 生成快照（`packages/quay/plugin/` 在 .gitignore，源 = repo-root plugin/ 树，sync-vendor.sh/package.sh 镜像）——本 worktree 中该目录不存在、无 git 跟踪；源已删 ⇒ 重新 sync/package 不会再生。删除 test.mjs 顺带消除了 tmux 泄漏源（144 孤儿/700MB 任务）。

**B 同步改（8 处「存在但不铺设」→「不存在」）**：
- `plugin/test/quay-init-check-drift.test.mjs` L_G：断言改为 `assert.ok(!fs.existsSync(...))`（文件必须不存在），测试名/头部注释同步。
- `plugin/test/quay-init-drift-report.test.mjs` L_G：同上翻转。
- `packages/quay/test/install-config-driven-e2e.test.mjs:575`：corrupted 夹具从 send-keys-verified.sh 换为 quay-init.sh（删除后唯一 NEVER_LAYDOWN 脚本，verify-installed-executables 仍 fail-closed）。
- `plugin/test/adr016-screen-use-check.test.mjs`：删除「retired 不计数」测试；AC3/AC7 断言 retired.length 从 >=1 改为 ==0；移除 RETIRED_FILES 导入。
- `plugin/scripts/adr016-screen-use-check.ts:74`：RETIRED_FILES 清空（保留机制作维护钩子，注释更新）。
- `plugin/scripts/capability-catalog.sh:207`：send-keys-verified 声明行移除。
- `plugin/scripts/quay-init.sh:816`：NEVER_LAYDOWN 改为 `"quay-init.sh"`（注释同步）+ 漂移报告头注释(:1348)去掉命名 + :806 示例列表去掉。

**D 范式改名（5 处，无悬空）**：退休范式统一命名为「分层退休（Layered retirement）」。quay-init.sh:30、plugin-packaging.test.mjs:513、gate-scripts-retirement.test.mjs:7（任务列明 3 处）**+** plugin/skills/init/SKILL.md:32 与 plugin/README.md:81（E 检查强制——SKILL/README 教学位不得再教被取代能力）。未用「gate-scripts precedent」是因为 plugin-packaging.test.mjs 断言 quay-init.sh 含零 `gate-scripts`。

**E superseded 表 + 检查（AC5）**：capability-catalog.sh 新增 `declare -A SUPERSEDED`（send-keys-verified.sh → REMOVED 记录）与 `--superseded-check` 模式：断言被取代实现不存在于 plugin/scripts、plugin/test、packages/*/plugin vendored 副本，且不出现在 SKILL/README 教学位。接线 `run_static_checks`（`# @static-tier always`，每轮都跑）。新增 mutation case `plugin/scripts/checker-mutation-cases/capability-catalog.sh`（baseline GREEN → 注入 superseded 文件 RED → 还原 GREEN，case 实测 exit 0）。`checker-mutation-check --list` 显示 uncovered: none。

**C 记录层保留（未动）**：adr/ADR-016、CRYSTALLIZED-reliable-send-2026-08-04.md、outer-rulings-2026-08-04-A-F.md、tasks/*.md、send-keys-reliable.sh 头注释。

**实跑**：`bash plugin/scripts/capability-catalog.sh --superseded-check` → PASS；直接触碰测试全绿：adr016 15/15、plugin-packaging+gate-scripts-retirement 39/39、capability-catalog 12/12、quay-init-check-drift 4/4、quay-init-drift-report 6/6、install-config-driven-e2e 12/12。scoped 门 `bash scripts/test.sh --for-task gap-retired-script-still-callable --allow-thin` → **exit 0，88 tests / 88 pass / fail 0 / cancelled 0**（AC7 绿）。

## Touches

- plugin/scripts/send-keys-verified.sh（A 删）
- packages/quay/plugin/scripts/send-keys-verified.sh（A 删,vendored）
- plugin/test/send-keys-verified.test.mjs（A 删——顺带解决泄漏任务）
- docs/analysis/send-keys-verified-test-leaks-tmux-servers.md（A 删）
- plugin/test/quay-init-check-drift.test.mjs:211-216（B 改「存在」→「不存在」）
- plugin/test/quay-init-drift-report.test.mjs:203（B 改）
- packages/quay/test/install-config-driven-e2e.test.mjs:575（B 改,夹具引用）
- plugin/test/adr016-screen-use-check.test.mjs:107/160/163（B 改）
- plugin/scripts/adr016-screen-use-check.ts:74（B 改,KNOWN RETIRED 表）
- plugin/scripts/capability-catalog.sh:207 + E（B 改声明 + E superseded 表）
- plugin/scripts/quay-init.sh:816（B 改,NEVER_LAYDOWN 移除）+ :30（D 改名）
- plugin/test/plugin-packaging.test.mjs:513（D 改名）
- plugin/test/gate-scripts-retirement.test.mjs:7（D 改名）
- tasks/gap-retired-script-still-callable.md（自身：勾 AC + 贴证据）
- tasks/gap-send-keys-verified-leaks-tmux-servers-unincorporated.md（A 删后关闭——泄漏源消失）

## Contract

measure   skv_entities_remaining = `ls plugin/scripts/send-keys-verified.sh packages/quay/plugin/scripts/send-keys-verified.sh plugin/test/send-keys-verified.test.mjs docs/analysis/send-keys-verified-test-leaks-tmux-servers.md 2>&1 | wc -l` 的 stdout 数字
band      skv_entities_remaining = 0（4 实体全删）
invariant b_assertions_not_red = 1（B 处改后 scoped 门绿）
invariant paradigm_renamed_no_dangling = 1（D 范式改名无悬空）
invariant superseded_check_wired = 1（E superseded 表 + run_static_checks 接线）
invariant record_layer_preserved = 1（C 记录层不动）
invoke    `bash scripts/test.sh --for-task gap-retired-script-still-callable`（scoped 门绿贴回）+ `bash plugin/scripts/capability-catalog.sh`（superseded 表贴回）
control   4 实体不存在；B 处绿；范式无悬空；E 检查在档；记录层保留
resume    A 删 / B 改 / D 改名 / E 表分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人裁定删除（结晶收尾——残骸污染上下文已实证:读到/指错工具/误判 false-done）。A-E 完整计划:①能力=一实现,同名第二份即污染源（A 两版已漂移 7 行=证据）;②被取代实现不存在于仓库;③历史留记录层;④入口文档指向机件（已改✓）;⑤机械检查不回潮。A 删 4 实体+B 改 8 断言+D 范式改名+E superseded 表+C 记录层保留。实现归内层
