---
id: gap-fan-in-push-silently-fails-no-detection
title: worker-driver fan-in 完成后 push 到 origin/develop
  悄悄失败——已发生两次，均靠人工/偶然核实发现，无任何机制主动检测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: plan
---

**type:** execution

## Proposal

**2026-09-16/17，同一类事故在本仓库发生了两次**：worker-driver（在主检出 `/home/yale/work/quay` 上跑）完成了一个任务的 fan-in（本地 `develop` 分支产生真实 commit），但 push 到 `origin/develop` 的步骤要么失败、要么根本没有真正被触发——本地 `develop` 领先 `origin/develop`，且这个"领先"状态本身**没有任何告警/日志明确指出**，任务的 `status` 字段却已经翻成 `done`，看起来完全正常。

**事故 1**：`gap-release-yml-missing-github-release-object` 与 `gap-closure-ratchet-stale-wire-into-precommit-guard` 两个任务的完整 fan-in 结果（含 `create-github-release` job 的代码改动）本地领先 origin 16 个提交，从未推送。根因疑似：另一个并行会话（tokyo-alpha self-hosted runner 部署）几乎同时做了一次直接 `git push`（commit `9f79bc17f`，author date `2026-09-16T14:57:25Z`——已核实这个 sha 与 tokyo-alpha runner 迁移相关：`gap-outer-tick-log-awk-mawk-interval-red` 任务体的 Evidence 段落逐字引用了同一个 commit `9f79bc17f` 作为触发 CI 跑的那次提交），其父提交是这两个任务 fan-in **之前**的 develop 快照，导致它抢先把 origin/develop 推进到了一个不包含这两个任务改动的点；worker-driver 随后若尝试 push 自己那条含这两个任务改动的本地 develop 历史，会因 non-fast-forward 被拒绝——但没有观察到任何这类失败的日志/告警，只发现本地领先 16 个提交且是干净的 fast-forward（是人工核实历史链条时发现的，不是任何检测机制报出来的）。

**事故 2**：`gap-dev-stats-collect-from-production-carriers` 任务标记 `done` 后，GOAL-021 的 AC-277 判据连续两轮（`2026-09-17T00:10:51Z` / `00:17:30Z`）报 `verdict: fail`，`CAUSE=stats-script-absent`——但该任务声称已产出的 `plugin/scripts/dev-stats-collect.ts` 脚本，实测确实以两条真实提交（`4abbe18d9`、`852e59b05`）存在于**本地** `develop` 分支，只是同样没有推送到 `origin/develop`（本次立案当场用 `Read` 核实：该文件在本地主检出磁盘上确实存在且内容完整，佐证 fan-in 已在本地真实发生）。这次是靠 GOAL-021 的 goal-driver 判据 fail 被一个独立的"stuck-goal-AC 黑洞监视" Monitor（本身设计用途是抓另一类问题——已认领 done/superseded 但判据仍失败的 goal-driver 去重盲区）间接、偶然地暴露出来的，不是任何专门针对"push 是否成功"的检测机制。

**共同模式**：①"任务 status=done" 与"代码真正到达远端共享仓库"完全脱钩——这比"疑似红需要重试"更危险，因为它在记录上与"一切正常"同形（硬规则 3b 的经典形态：读不出/检测不到的状态，不能与"合格"同形，但目前压根没有任何检测点，连"读不出"这个态都没有，是彻底的盲区）。②两次都是靠人工/偶然核实发现的，没有一次是被机制主动报出来的。③规模会越来越大：随着 self-hosted runner（tokyo-alpha）等更多并发写入 develop 的来源出现，这类竞态只会更频繁，不能继续依赖人工巧合发现。

**与既有机制的关系（区分，不是重复，已查重）**：`tasks/gap-doc-develop-sync-semantic-conflict-resolution.md`（done）与 `tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md`（done）处理的是 **author 分支落后 develop、或两者出现语义分叉后如何合并**的问题——这些机制假设"该往前推的动作已经执行"，只是产物之间不同步。**本任务要处理的是更前置的一层**：**push 这个动作本身悄悄失败/被抢先时，完全没有人/机制知道**——是"检测 push 是否真的落地"的缺口，不是"落地后怎么和解分叉"的缺口，两者互补不重叠。已查重「push」「non-fast-forward」「fan-in」「origin/develop」「worker-driver push develop」等关键词，无同机制在飞或历史任务。

## Plan

**①（核心）** 新增一个检测器（建议 `plugin/scripts/fan-in-push-lag-check.ts`，具体命名由实现者按仓库既有命名惯例确认）：机械检测本地 `develop`（或 worker-driver 实际工作的 checkout 所在分支）相对 `origin/develop` 的领先提交数 + 领先提交集合里**最老一条**的 committer date。若领先数 > 0 **且**最老一条领先提交的时间已经超过某个阈值，判定为"push 滞后"，输出结构化事件（枚举领先提交数、最老提交 sha、领先时长——不是布尔）。**阈值不得凭空定**：需读一段真实的 driver round 间隔数据作为参照并写清依据（若阈值依赖当前 driver 轮转节奏这类会变的量，优先从配置/常量读，留可调整入口，不要写死一个未来可能失效的字面量——硬规则 4 推论二）。

**②** 这个检测应挂载到现有的常驻例行机制（driver 自己每轮附带检查、或 `.quay/config.yml` 的 `loop.routines` 一个新条目、或本项目已有的例行/quality 轨道——由实现者读代码后确定挂载点，不凭空新建一整套独立循环）。检测到滞后时：优先尝试**机械重试 push**（`git fetch` + rebase-or-ff-retry，解决网络瞬时失败或短暂 non-fast-forward）；重试仍失败（真正的 non-fast-forward，如被并发直接 push 抢先）则升级到既有的"语义同步兜底"机制（`gap-doc-develop-sync-semantic-conflict-resolution` 记录的第 1 层流程：develop 权威 wins + 语义合并）——**不在本任务重新发明合并策略**，只负责"检测到滞后并触发既有兜底机制"。

**③ 负控制（可证伪，必须做，真实 git 操作，不是伪造 JSON 输入）**：
- 构造"本地领先 origin 若干个提交，且最老一条已超过阈值"的场景 ⇒ 验证检测器报出滞后（正例）。
- 构造"本地领先 origin，但最老一条领先提交在阈值以内（刚刚发生）"的场景 ⇒ 验证**不**报警（避免把正常的、短暂的、driver 下一轮就会自己推送掉的领先窗口污染成噪音——这是本检测器最容易犯的假阳性方向，必须有对照）。
- 构造"本地与 origin 完全同步（领先数=0）"的场景 ⇒ 验证不报警（基线负控制）。

**④** 告警形态要能让人/manager 会话看到——参考现有的 needs-human / 告警载体惯例，不发明新通知渠道；具体接入点（写进某个 `.quay/*.jsonl` 载体供人核对，还是直接触发 needs-human 类任务，还是别的）由实现者判断，但必须给出理由。

## Acceptance Criteria

- [ ] AC1（正例，真实构造）：用真实 git 操作（本地仓库 + 一个真实的本地"origin"远端，或等价的可控双仓库夹具）构造一个本地领先 origin 且最老领先提交已超过阈值的场景，检测器报出滞后事件，包含领先提交数、最老提交 sha、领先时长三个字段。
- [ ] AC2（负控制1，假阳性方向）：领先但最老一条领先提交在阈值内（刚发生）⇒ 检测器不报警（真跑，不是推理）。
- [ ] AC3（负控制2，基线）：本地与 origin 完全同步（领先数=0）⇒ 检测器不报警（真跑）。
- [ ] AC4（阈值依据）：阈值的选择有实测依据——读一段真实的 driver round 间隔数据作为参照，写清楚为什么选这个数字；阈值从配置/常量读出而非写死字面量，给出该配置项的位置。
- [ ] AC5（重试路径）：构造一个可通过简单机械重试解决的滞后场景（如短暂 non-fast-forward，重新 fetch 后可 ff），验证机械重试确实成功把本地 develop 推送到 origin/develop。
- [ ] AC6（升级路径）：构造一个机械重试无法解决的真实 non-fast-forward 场景（如两个仓库对同一父提交产生了不同的后续提交），验证检测流程正确识别"重试不可解"并触发/移交既有语义同步兜底机制（不要求本任务重新实现该机制本身，只要求触发点被真实调用到）。
- [ ] AC7（挂载与告警形态）：给出检测器实际挂载点的 file:line 证据（driver 轮转脚本 / `.quay/config.yml` routines 等），以及告警形态的落地证据（`.quay/*.jsonl` 追加记录，或 needs-human 触发，或其它），并说明选择理由。
- [ ] AC8：`bash scripts/test.sh --for-task gap-fan-in-push-silently-fails-no-detection` 退出 0。

## Definition of Done

验收对象是"下次同类事故（fan-in 完成但 push 静默失败）会被机制主动报出来，不需要人恰好去核对某个 goal AC 或恰好去翻 commit 历史才发现"——不是"写了一个检测脚本"就算完成。负控制必须证明这个检测器在真实场景下能取真也能取假，不是恒报警或恒沉默（硬规则 4：一个结构上不可能取假的量不是测量）。AC1-AC8 全部带真实读数（命令 + 输出），不是自述结论。

## Touches

- plugin/scripts/fan-in-push-lag-check.ts (new)
- plugin/test/fan-in-push-lag-check.test.mjs (new)
- plugin/probes/fan-in-push-lag.md (new)
- plugin/scripts/sync-lag-check.sh（既有的本地-vs-origin 滞后测量 + push 实现，检测器复用/扩展它）
- plugin/scripts/worker-driver.ts（机械 fan-in 的 driver 轮转，挂载候选）
- tasks/gap-fan-in-push-silently-fails-no-detection.md（自身）
