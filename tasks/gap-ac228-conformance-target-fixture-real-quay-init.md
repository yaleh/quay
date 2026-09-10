---
id: gap-ac228-conformance-target-fixture-real-quay-init
title: C域一致性目标夹具 conformance-target-fixture：真 quay-init 生成 + 三轴不像本仓库 +
  双向负控制，接入常规套件（AC-228）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-228
---
## Proposal

正本判据 `goals/AC-228-一致性夹具接入常规套件且沿三轴不像本仓库-含双向负控制-goal-012-退出条件③.md`（goal=GOAL-012，2026-09-10 人裁定三条后授权激活）。exit 0 = 两个断言都过：`grep -q 'conformance-target' scripts/test.sh`（夹具接入常规套件，非手工一次性脚本）∧ `node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs`（hermetic 单测绿）。

- **①由真实 quay-init 现场生成**：⛔ 不是提交进仓库的快照、⛔ 不是手写 `.quay/config.yml` 的 `makeWorkspace()` 形态。手写夹具匹配「测试作者以为的布局」而非「quay-init 实际产出的布局」——今晚 `profiles.yml 缺 worker roles` 正是二者漂移；夹具 spawn `bash plugin/scripts/quay-init.sh`（`CLAUDE_PLUGIN_ROOT` 环境）则结构上不可能藏。
- **②两个配置**：P-real（三轴全不像本仓库：无 `plugin/`、工作分支非 `author`、无 `scripts/test.sh` 只有 `loop.test_command`）做闸；P-self（本仓库形态）做负控制——断言降级不回流、行为逐字不变。
- **③双向负控制**：把任一域解析退回旧形态（A 域锚 target root / B 域字面量分支名 / C 域无条件调 dev-tree 专属脚本）⇒ 夹具先红；退回前 ⇒ 绿。

**现状（实测，位置判定）**：判据命名的 `plugin/test/conformance-target-fixture.test.mjs` 不存在；`scripts/test.sh` 无 `conformance-target` 字面；criterion exit 1。既有 `gap-third-party-fixture-smoke-test-driver-family`（done）的 `plugin/test/driver-third-party-fixture.test.mjs` 用手写 `MINIMAL_CONFIG`（⛔ 非真 quay-init，正是本 AC 禁止的形态），无双向负控制、未接 `conformance-target` 字面。无任务认领 `goal_ac: AC-228`（grep tasks/ = 0）。

**修法**：建 `plugin/test/conformance-target-fixture.test.mjs`（真 quay-init 现场生成 P-real/P-self 两配置）+ `scripts/test.sh` 落 `conformance-target` 字面 + 三域双向负控制 seam。

**与既有任务的关系（机制去重）**：与 `gap-third-party-fixture-smoke-test-driver-family`（done）非重复——它手写 config（本 AC 禁止）、无双向负控制、未接套件；与 `gap-ac227-third-party-capability-degradation`（C 域降级取值）互补——它测降级函数、本 AC 测「沿三轴不像本仓库」端到端一致性目标在常规套件里先红；与 AC-224/225/226（A/B 域静态检查器）非重复——本 AC 是 C 域夹具（GOAL-012 范围：C 域强制力来自夹具，不来自检查器）。`scripts/test.sh` 与 AC-224/226 共享 Touches，派发时注意重叠（dispatch-order-by-touches-overlap-direction 纪律）。

## Plan

1. 建 `plugin/test/conformance-target-fixture.test.mjs`（`node:test`，`import { test } from "node:test"`；`// @test-group` 声明——spawn 真 quay-init 子进程，参照 quay-init 家族负载敏感归类，⛔ 不跑真 npm install 安装物，人 2026-09-10 裁定暂缓）。helper：`mkdtempSync(path.join(os.tmpdir(), ...))` 建临时目标目录（⛔ 落在仓库树外，不得被 `ready-pool-check` 当真项目发现），spawn `bash plugin/scripts/quay-init.sh`（`CLAUDE_PLUGIN_ROOT=plugin/` 环境，参照 `plugin/test/quay-init.test.mjs` 的 runInit）生成 P-real 目标，再改 `.quay/config.yml` 写 `loop.test_command`、工作分支 checkout 非 author（布局由真 quay-init 产出，仅定制 config 值/分支）。自带 teardown（`after` 清 mkdtemp 目录）。
2. **正向前向（P-real 做闸）**：对 P-real 目标调三域解析/命令构造函数——A 域 `resolveKernelSibling`/`resolveKernelPluginRoot`（`plugin/scripts/driver-runtime.ts`）与 `resolvePluginScript`（`packages/quay/src/plugin-root.ts`）；B 域 `resolveDocBranch`（`plugin/scripts/driver-filters.ts`）读 target 实时 git 状态；C 域 `docCheckCommandFor`/`resolveScopedGateCommand`/`defaultMechanicalSuiteCommand`（`plugin/scripts/worker-driver.ts`）。断言：不锚本仓库 `plugin/`、分支非 `author` 字面量、无 `scripts/test.sh` ⇒ 委托 `loop.test_command` / 独立「能力不存在」取值、argv 不含 `exit 127`。⛔ 核心断言是「解析产物在 P-real 上真实存在且正确」——旧形态（锚 target root / 字面量分支名 / 无条件调 `scripts/test.sh`）在 P-real 上解析到不存在或错误对象。
3. **P-self 负控制（降级不回流）**：同一 fixture 在 P-self（本仓库形态：有 `plugin/`、工作分支 `author`、有 `scripts/test.sh`）上断言三步命令与迁移前逐字一致（doc-check=`bash <dir>/scripts/test.sh --static-checks-doc`、scoped-gate=`bash <dir>/scripts/test.sh --for-task <task> --allow-thin`、suite=full-suite-runner argv），⛔ 断言降级不回流、行为逐字不变。
4. **双向负控制**：为三域各留一个「退回旧形态」seam——A 域改锚 target root、B 域注入字面量分支名（`DOC_BRANCH="author"`）、C 域无条件调 dev-tree 专属脚本——断言夹具在旧形态下**先红**（gate 断言失败）、正确形态下绿。⛔ 三个域逐条断言，⛔ 不止一种形态（GOAL-012 风险 4：突变用例须覆盖多种拼接形态）。
5. `scripts/test.sh` 落 `conformance-target` 字面（把夹具接入常规套件，非手工一次性脚本），以 `grep -q 'conformance-target' scripts/test.sh` 为准；全量 glob `plugin/test/*.test.mjs` 已自动收录新文件（以 suite 实测为准）。
6. 干跑 AC-228 criterion 至 exit 0：`grep -q 'conformance-target' scripts/test.sh && node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs`。

## Touches

- `plugin/test/conformance-target-fixture.test.mjs`
- `scripts/test.sh`
- `tasks/gap-ac228-conformance-target-fixture-real-quay-init.md`

## Acceptance Criteria

- [x] AC1 判据前件：`grep -q 'conformance-target' scripts/test.sh` exit 0；贴命中的行（含行号与上下文）。
- [x] AC2 判据后件：`node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs` exit 0；贴完整输出（含 P-real 正向 + P-self 负控制 + 双向负控制全部断言名）。
- [x] AC3 P-real 由真 quay-init 生成：夹具 spawn `bash plugin/scripts/quay-init.sh`（⛔ 非手写 config、非提交快照）；断言 P-real 三轴成立——无 `plugin/` 目录、工作分支非 `author`、无 `scripts/test.sh` 而 `loop.test_command` 在 `.quay/config.yml`；贴三轴断言片段。
- [x] AC4 P-real 做闸（正向）：三域解析/命令构造函数在 P-real 上不锚本仓库 `plugin/`、分支读 target、无 `scripts/test.sh` ⇒ 委托 `test_command` / 独立「能力不存在」取值、无 `exit 127`；贴断言名与通过片段。
- [x] AC5 P-self 负控制（降级不回流）：P-self（本仓库形态）上三步命令与迁移前逐字一致，⛔ 降级不回流污染本仓库；贴断言名与通过片段。
- [x] AC6 双向负控制（三域逐条）：A 域退回「锚 target root」、B 域退回「字面量分支名」、C 域退回「无条件调 dev-tree 专属脚本」各使夹具**先红**（gate 断言失败），正确形态下绿；贴三个域的 RED→GREEN 断言片段。
- [x] AC7 卫生：夹具 mkdtemp 生成、teardown 清理、不落在仓库树内（`find . -name 'conformance-target-*'` 在仓库树 = 0）、无提交进仓库的夹具快照；贴 teardown 与检查读数。

## Definition of Done

AC1–AC7 全绿；AC-228 criterion exit 0（`grep -q 'conformance-target' scripts/test.sh` ∧ 单测绿）。一致性目标夹具落地：真 quay-init 现场生成（非手写快照）、P-real 沿三轴不像本仓库做闸、P-self 负控制证降级不回流、三域双向负控制证「退回旧形态 ⇒ 先红」，接入常规 `scripts/test.sh`。⛔ 不跑真 npm install 安装物（人 2026-09-10 裁定暂缓，dist 布局盲区归 AC-224/225 静态检查器 + 真实远程周期复证兜底）；⛔ 夹具卫生（mkdtemp、teardown、不在仓库树内）。