---
id: GOAL-030
title: 晋升写入经 kernel 转移决策并留痕——goal 分支首个真实试点：证明分支上运行的 Quay 加载的是分支自己的代码
status: active
kind: goal
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:36:17.793Z
statusLog:
  - at: 2026-10-08T02:36:17.793Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08「现在开始执行…正式立项并进入该小 goal」：7 条 AC（AC-336…342，并入前 5 条、并入后 2
      条）已激活且判据在 dash 下逐条实测（含负对照）；3 个承接任务已立并停放（needs-human），激活本 GOAL 即从 develop
      tip 懒建 goal/GOAL-030
branch: true
---
## 背景

**这是 goal 分支机制的第一个真实开发方向试点，主要目的不是架构收益，而是验证“在分支上运行 Quay、并验证 Quay”这条自举路径。** 人 2026-10-08 裁定：先用一个相对小、但足以验证机制的重构走完 goal branch 全流程；只有它完整走完且健康度达标，才进入更大规模的重构 goal。

迄今开过分支的 goal（GOAL-901…905）全是演练；GOAL-905（真实大小的并入）的 goal→develop 并入跑了 6 次 suite 才通过。SPEC-goal-branch §4.10/§8 写明预览实例不跑 driver、改 driver 的 goal 得不到并入前试用；另有两条实测记录表明 worktree 里的代码可能在运行时加载主检出的代码（Core plugin root 重定位、quay-native 经 node_modules 软链解析）。本 goal 因此把“分支上跑的确实是分支自己的代码”作为显式验收，⛔ 不允许用表面成功替代。

重构切片（OO/领域所有权分析的阶段 A 的最小子集）：晋升路径上两条任务状态写入——`plugin/scripts/ready-pool-check.ts` 的 `applyPromotions`（todo→ready，promote 边）与 `applyRevaluations`（ready→todo，retreat 边）——改走 kernel 层的转移决策（基于 `LIFECYCLE_EDGES`），并为每次转移写一条结构化事件。前置读数见已完成任务 gap-status-flip-history-and-parser-diff-readings（历史翻转回放）与 docs/rup/architecture-views.md §6（ArchGuard 重构前基线，develop @97d17da6b：目录环 1 个、plugin/scripts→kernel 强度 14、→非 kernel 44、packages→plugin 0）。

## 范围与非目标

范围：
- kernel 新模块 `packages/quay/src/kernel/task-transition.ts`：`LIFECYCLE_EDGES` 的唯一定义（从 `gate/lifecycle.ts` 下沉，后者改为 re-export）、`decideTransition`（三态：allow / refuse / not-evaluated）、`patchStatusField`（从 `plugin/scripts/task-ops.ts` 下沉，后者改为 re-export，四个现有调用方不改）、状态转移事件写入 `.quay/task-status-events.jsonl`（每条事件记录写入模块与入口进程的 realpath，作为代码身份的直接量）。
- `ready-pool-check.ts` 两处写入改走 kernel。
- 分支自举探针 `scripts/branch-selfhost-probe.mjs`。

非目标（⛔ 有意排除）：
- ⛔ 不碰 fan-in 的 4 处状态写入（`worker-fan-in.ts`）、不碰 needs-human 与分支同步状态对齐的 2 处写入（`driver-filters.ts`）——AC-336 以计数钉死。
- ⛔ 不让 promotion-driver 新增自动撤回行为：生产上目前没有任何调用方传 `--revaluate-apply`，ready→todo 由同一分支的 `ready-pool-check --revaluate-apply` 直接触发验证，⛔ 不新增驱动调用方（那会是新的生产行为）。
- ⛔ 不改 `gate/lifecycle.ts` 的 `runPromote`/`runRetreat` 行为（CLI 路径），只让它们与 kernel 共用同一份边表数据，⛔ 不造第三套实现。
- ⛔ 不决定“状态写入走 ABI 还是 kernel”，本试点用 kernel 写函数。
- ⛔ 不做目录环清理、不拆大文件、不动 goal-driver / worker-driver 机制本身。

## 判据形态

- 并入前 AC（AC-336…340）在判据 worktree / 预览实例上求值；并入后全部 AC 在主检出上照常求值，所以每条并入前判据在两种树上都必须成立（各判据已按两种树写）。
- 退出码三态：0 达成；1 未达成，同行带 `CAUSE=`；3 未评估（前提未落地、预览未起、载体缺席）。
- 落笔当轮读数（2026-10-08，主检出 = develop @c8461f5f）：AC-336/338 exit 1（模块与测试尚不存在）；AC-337/339/341/342 exit 3（前提未落地）；AC-340 在主检出 exit 0（生产 serve 跑主检出自身代码）。负对照：AC-340 在一个登记了主检出 serve 的临时 worktree 上判 `serve-runs-foreign-code`；AC-337 对一条写入模块位于主检出的伪造事件判 `loaded-main-checkout-code`；AC-339 在临时分支上实跑 archguard，加 kernel import 时 14→15 判绿、去掉 import 时判 `kernel-edge-not-observed`。
- AC-338 经 `scripts/test.sh` 跑 6 个文件；4 个现存文件实测 18.6 s，判据默认 60 s 上限，新增文件须控制体量。

## 验证步骤（分支上必须执行，命令与原始读数记入各任务 Evidence 与复盘）

1. 激活前：ArchGuard 前基线（同一 archguard 构建、单根复制、中立 cwd、读 `moduleGraph`）。
2. 激活后：核验 `goal/GOAL-030` 从 develop tip 懒创建；任务派发记录的 mergeTarget 为该分支；任务 worktree 从该分支开出；落地前追平 develop；develop 的 first-parent 链上不出现这些提交；落地后不再被派发。
3. 分支 tip 上：类型检查、`import-graph-check`、载体注册表、特征化测试（AC-336/338）。
4. 预览：`quay goal preview GOAL-030 start --port <n>`，AC-340 证明预览进程跑的是分支自己的入口。
5. 沙盒驱动自举（AC-337）：按文件路径启动分支的 promotion-driver（默认子进程解析，清掉 `QUAY_PLUGIN_ROOT`）对 /tmp 沙盒跑一轮触发 todo→ready；分支的 `ready-pool-check --revaluate-apply` 触发 ready→todo；每条事件的写入模块与入口 realpath 必须位于分支树内；同一沙盒用主检出驱动跑负对照须写 0 条事件；生产 `.quay/` 与 `tasks/` 不变。
6. 后基线：AC-339 在分支 tip 上实跑 archguard 前后对比。
7. 人在预览上试用后 `quay goal merge GOAL-030 --reason …`；记录并入 suite 尝试次数与每次红集。
8. 并入后：主检出追上 develop；AC-341 取生产读数；AC-342 核对并入形态。

## 停止扩大范围的信号（任一出现 ⇒ 不加范围、不进入下一个 goal，先把机制缺口立案修复；无法恢复则按裁定⑨放弃并丢弃分支）

- **代码身份**：沙盒或预览证明跑的不是分支代码（AC-337 `loaded-main-checkout-code`、AC-340 `serve-runs-foreign-code`），或负对照失效；**自举或模块解析落到主检出 ⇒ 分支不健康。**
- **生产污染**：沙盒运行改动了生产 `.quay/` 或 `tasks/`；生产派发记录被沙盒驱动接管；生产 serve 被重启或端口改变。
- **隔离失效**：本 goal 任务提交出现在 develop first-parent 链上；任务落地后被再次派发；goal 在并入前被翻为 achieved。
- **追平漂移**：追平反复冲突；anti-drift 因基准不对误报；分支落后 develop 持续增大。
- **并入不稳**：goal→develop 并入 suite 尝试次数超过 GOAL-905 的 6 次，或红集含本 goal 触及的文件；需要 `--override` 才能并入。
- **预览不可用**：预览 serve 起不来或被孤儿回收器杀掉。
- **架构**：目录环增加；需要往 layers.yml 的 allowed 加边；出现 packages→plugin 边；前后文件数差额对不上；`import-graph-check` 的 kernel 越界。
- **基线漂移**：特征化快照或金样出现本切片无法解释的变化。
- **人工干预**：任务机制之外的手工修补持续增加。

## 退出条件

晋升路径的两条状态写入（todo→ready、ready→todo）经 kernel 转移决策落盘并留下结构化事件，fan-in 与 needs-human 写入原样不动；并且 goal 分支全流程走通：分支上运行的 Quay（沙盒中的 promotion-driver 与 ready-pool-check、预览 serve）被证明加载的是分支自己的代码，测试、smoke、`import-graph-check` 与分层约束通过，ArchGuard 前后读数可比且无新的结构债；goal 以恰好一个合并提交并入 develop，并入后生产上的晋升翻转都带有事件。对应 AC-336（结构与范围护栏）、AC-337（分支自举身份与两类转移）、AC-338（测试与 smoke）、AC-339（ArchGuard 前后可比）、AC-340（预览运行分支代码）、AC-341（并入后生产读数）、AC-342（并入形态）。
