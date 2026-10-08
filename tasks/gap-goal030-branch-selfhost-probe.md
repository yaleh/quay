---
id: gap-goal030-branch-selfhost-probe
title: GOAL-030 ③：分支自举探针——证明分支上运行的 promotion-driver / ready-pool-check
  加载的是分支代码，并在沙盒触发两类转移
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal030-promotion-writes-via-kernel-transition
goal_ac: AC-337
---
**type:** execution

## Proposal

GOAL-030 的第三块，也是本试点的核心验收：一个**分支自举探针**，证明「在分支上运行的 Quay driver 加载的是分支自己的代码，而不是主检出」，并在沙盒里实际触发晋升路径的两类转移。GOAL-030 的 AC-337 判据调用本探针，并**独立复核**探针输出里每条事件的代码路径（判据不信任探针自己报的「通过」）。

为什么必须有它：SPEC-goal-branch §4.10/§8 写明预览实例不跑 driver；另有两条实测记录表明 worktree 中的代码可能在运行时加载主检出代码（Core 的 plugin root 在 linked worktree 中重定位到主检出；quay-native 经 `node_modules` 软链解析 `quay/*` 到主检出）。plugin 侧 driver 的子脚本解析（`driver-runtime.ts` 的 `resolveKernelSibling`）锚在 driver 文件自身位置，但会被环境变量 `QUAY_PLUGIN_ROOT` 覆盖。⛔ `quay driver start` 不可用于此目的：anchor 只从主检出起。

探针 `scripts/branch-selfhost-probe.mjs`（`node scripts/branch-selfhost-probe.mjs --json [--keep] [--selftest]`），契约如下：
1. `root` = 探针文件所在 git 树的 toplevel 的 realpath；`main` = `git rev-parse --git-common-dir` 的上一级的 realpath。
2. 运行所有子进程时 ⛔ 删除环境变量 `QUAY_PLUGIN_ROOT`，并在输出 `env.QUAY_PLUGIN_ROOT` 记为 `null`；`TMPDIR=/tmp`。
3. 在 `/tmp` 下建沙盒 workspace：git 仓库（`develop` 与 `author` 两个分支指向同一提交、检出 `author`，提交身份用 `-c user.name/-c user.email`）、真 `.quay/config.yml`（native provider 指向 `<root>/packages/quay-native` 的绝对路径）、`tasks/` 下种入 2 个四件套齐全、带自引用 Touches 的 todo 任务和 1 个四件套不全的 ready 任务，全部已提交。
4. **晋升（默认子进程解析）**：`node --no-warnings --experimental-strip-types <root>/plugin/scripts/promotion-driver.ts --root <沙盒> --once --cap 2 --max-fix-retries 0 --json`，⛔ 不传 `--ready-pool-cmd`（验证 driver 自己解析出的子脚本是哪一份），输出 `promotion.childResolution: "default"` 与 `promotion.flips`（沙盒中实际 todo→ready 的任务数）。
5. **撤回**：`node --no-warnings --experimental-strip-types <root>/plugin/scripts/ready-pool-check.ts --root <沙盒> --revaluate-apply --json`，输出 `revaluation.flips`（实际 ready→todo 数）。
6. `events` = 沙盒 `.quay/task-status-events.jsonl` 的全部记录（原样）。
7. **负对照**（`root ≠ main` 时）：另建一个相同的沙盒，用 `<main>/plugin/scripts/promotion-driver.ts` 跑同样一轮，输出 `negativeControl: {evaluated, events, mainHasModule}`；`mainHasModule` = 主检出是否已有 `packages/quay/src/kernel/task-transition.ts`。
8. **生产不变**：运行前后对主检出 `.quay/` 下 `dispatch-record.jsonl`、`promotion-round.jsonl`、`promotion-outcome.jsonl`、`worker-round.jsonl`（存在者）的 sha256，以及 `git -C <main> status --porcelain -- tasks` 的输出做比较，输出 `production: {unchanged, diff?}`。
9. 退出码：0 = 全部运行完成（是否达标由判据复核）；1 = 运行完成但探针自检发现身份或转移问题（同时在 stderr 写 `CAUSE=`）；3 = 无法评估（沙盒建不起来、driver 启动失败等）。沙盒默认删除，`--keep` 保留并在输出里给出路径。
10. `--selftest`：不跑 driver，只用注入的路径对身份比较器做两面检查（一条写入模块位于 `main` 的事件必须判为 `loaded-main-checkout-code`；全部位于 `root` 的必须判通过），exit 0 / 1。

测试 `plugin/test/branch-selfhost-probe.test.mjs` 运行 `--selftest`（不起 driver，保持套件轻量）。

## AC

- [ ] 探针自检：`node scripts/branch-selfhost-probe.mjs --selftest` exit 0；`scripts/test.sh plugin/test/branch-selfhost-probe.test.mjs` exit 0
- [ ] 本任务 worktree 根（已含 goal 分支上的 kernel 模块与 ready-pool-check 接线）运行 GOAL-030 的 AC-337 判据（`quay goal show AC-337` 的 criterion，用 bash 执行）exit 0；完整输出与探针 JSON 进 Evidence
- [ ] 负对照有效：上条探针 JSON 中 `negativeControl.evaluated` 为 true 且 `negativeControl.events` 为 0（主检出尚无 kernel 模块）
- [ ] 生产不变：上条探针 JSON 中 `production.unchanged` 为 true；另在 Evidence 贴出运行前后 `git -C <main> status --porcelain -- tasks` 的输出
- [ ] 身份判据能取假：cp 备份后临时让探针把 `events` 中一条记录的 `writerModule` 改写为 `<main>` 下的同名路径，运行 AC-337 判据必须 exit 1 且 stderr 含 `CAUSE=loaded-main-checkout-code`；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）

## DoD

本任务经 goal/GOAL-030 分支落地，⛔ 不落 develop。落地后在 GOAL-030 的判据 worktree（goal 分支 tip）上 AC-337 判据 exit 0。若探针证明 driver 或其子脚本加载了主检出代码（`loaded-main-checkout-code`），⛔ 不得以 `--ready-pool-cmd` 钉死路径、改判据或改探针来绕过——那是 GOAL-030 定义的「分支不健康」信号，必须如实上报并停止扩大范围。

## Touches

- tasks/gap-goal030-branch-selfhost-probe.md
- scripts/branch-selfhost-probe.mjs
- plugin/test/branch-selfhost-probe.test.mjs

## 停放说明

本任务以 needs-human 状态立案，用于停放：在 GOAL-030 激活且 `goal/GOAL-030` 分支存在之前，⛔ 不得被派发。由立案会话在核验分支存在后改回 todo；依赖顺序由 frontmatter 的 depends_on 表达。
