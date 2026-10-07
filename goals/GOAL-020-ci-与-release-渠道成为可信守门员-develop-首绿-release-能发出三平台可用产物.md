---
id: GOAL-020
title: CI 与 release 渠道成为可信守门员：develop 首绿 + release 能发出三平台可用产物
status: active
kind: goal
origin: 人 2026-09-15 裁定：以 GitHub CI 与 release 为目标建 GOAL 并持续驱动；并逐条拍板 (a) 接受 5 条
  AC 的范围、(b) 接受 AC-268 需在本 GOAL 期内真发一次版本（workflow_dispatch）。立案读数见 body：develop
  92 次 run 零成功、release 连续 6 版失败。
activatedAt: 2026-09-15T11:46:30.733Z
statusLog:
  - at: 2026-09-15T11:46:30.734Z
    from: draft
    to: active
    actor: manager
    reason: AC-265..269 五条已全部 active（265 经人工双向控制后 --force，judge 超时不可读）；退出条件三项由这五条覆盖
  - at: 2026-09-16T14:36:10.963Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
  - at: 2026-09-24T08:18:10.451Z
    from: achieved
    to: active
    actor: human
    reason: 人 2026-09-24 裁定重开：hosted runner 账单闸挡住发布链（run 35966264609 annotation『The
      job was not started because recent account payments have failed…』）；新增长期保证
      AC-319（全 job self-hosted）/ AC-320（切版留痕落主台账）
---
## 背景（2026-09-15 实测，全部为直接量）

### 一、CI 在 develop 上从未绿过（不是退化，是从未达成）

`gh run list --workflow ci.yml --branch develop`：**92 次 run（2026-08-16 → 2026-09-15），零成功**
——52 failure / 40 cancelled，decisive 绿率 **0/52**。全分支 203 次 run 中 72 次成功**全部在 master**，
且最后一次任何分支的绿是 **2026-08-03T08:31（master）**，6 周前。
⇒ **「CI 在 develop 上绿」必须当作一个待达成的新状态，不是待恢复的旧状态。**
⚠️ 40/92（43%）的 develop run 是 `cancelled`（被后续 push 顶替，不代表红）
⇒ 任何数「连续 N 次绿」的判据都会因决定性样本不足而饿死，**判据只计 decisive（success|failure）run**。

### 二、Release 连续 6 个版本失败，且是两个独立的结构缺陷

25 次 run：18 failure / 6 success / 1 cancelled。**最后一次成功是 2026-07-24 的 v0.3.13**，
其后 v0.4.0 / v0.5.0 / v0.6.0 / v0.6.1(cancelled) / v0.6.2 / v0.6.3 连续失败，跨度 7 周。
v0.6.2（run 34843029988）与 v0.6.3（run 34845477762）**失败形态逐字相同**，由两个互不相关的缺陷叠加：

- **缺陷 1｜`release` job 撞 30m 超时（实测 30m21s / 30m17s）。** hang 在 `Run tests`：
  输出停在 `FAIL: task_list via quay mcp (provider=github)` →
  `TypeError: Cannot read properties of undefined (reading 'tasks')`（`mcp-server.test.mjs:530`），
  紧跟 `gh: ...set the GH_TOKEN environment variable`，此后 **26 分钟零输出**直到超时被杀，
  清理时终结了 7 个孤儿进程。`release.yml:71-79` 的注释**故意**不传 GH_TOKEN（发布闸应验产物、
  不验线上 store 状态），但该注释的前提「live-GitHub 测试在未经 `QUAY_TEST_LIVE_GITHUB` opt-in 时自 skip」
  **对 `mcp-server.test.mjs` 为假**——它在 glob 内且无 self-skip 守卫，无 token 跑挂后泄漏 MCP server 子进程，
  `node --test` 因而永不退出。⇒ **两层**：self-skip 覆盖缺口 + 失败退化成 HANG
  （本仓库已知的 `detached-test-child-leak-hangs-suite` 形态）。该 job 按设计绕过 `scripts/test.sh`
  （更窄的 glob，`release.yml:60-63`）⇒ **runner 的进程回收结构上不适用于它**。

- **缺陷 2｜`sea-verify-node-free` 三平台全挂，是真实产品 bug。** 步骤「Run quay serve and curl it」：
  `quay --help` 通过，而 `quay serve` 一起手即崩——
  `TypeError [ERR_INVALID_ARG_TYPE] ... at fileURLToPath ... (quay-bundle.cjs:8607)`，
  调用链 `goal-store → gate/factories/goal → gate/factories/index → gate/config/loader`。
  根因是 `packages/quay/src/plugin-root.ts:33` 的
  `const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));`
  **在模块顶层求值**，故 import 即执行，而 SEA 的 CJS bundle 里 `import.meta.url` 是 undefined。
  `--help` 不拉这条链所以看着是好的；`serve` 拉。curl 得 `http_code:000`，exit 7。
  v0.5.0 / v0.6.2 / v0.6.3 反复复现。⇒ **发出去的 SEA 二进制核心功能不可用。**

### 三、判据设计的两条直接依据（⛔ 不是风格偏好，是机制约束）

1. **`achieved` 永久锁定。** 全仓 `writeGoalStatus` 仅 2 个调用点、都写 `"achieved"`，
   **没有任何路径把 achieved 翻回 active**（`goal-driver.ts:214` 注释逐字）。故「CI 保持绿」
   这类会回退的活性判据一旦翻 achieved，该记录将永久声称一件已不成立的事（AC-181 即此类）。
   ⇒ **本 GOAL 名下 AC-265/266/267/269 全部写 `long-term: true`**，进 AC-216 复验域每轮重跑，
   回归时 `standing-violated` 自动立案；AC-268（一次性发版）不带。
   ⚠️ **2026-09-24 更正：此前提已过期。** 2026-09-10 起 achieved→active 的重开路径被允许（人裁定，
   `50ed1cbc8`；`goal-store.ts` activation 注释逐字「Reopen paths — achieved→active … are activations
   too」），本 GOAL 即经该路径重开。`long-term: true` 的设计理由仍成立（重开是人的动作，不是自动回退）。
2. **criterion 只有 pass/fail 两态**（`acceptance-runner.ts:213` `const ok = r.status === 0`），
   **没有 NOT-EVALUATED 通道**，且总预算 **60s**（`goal-store.ts` gate 的 `timeoutMs: 60000`）。
   ⇒ ①criterion **不现场调 `gh`**（网络+认证+限流都会被记成「CI 红」，而 `gh` 在非标准的
   `~/.local/bin`，criterion 经 `runAcceptance` 的 spawnSync **不覆盖 env**、继承 driver 的 PATH）
   ——改为读本地载体 `.quay/ci-runs.jsonl`，与 AC-262 读 `.quay/goal-round.jsonl` 同范式；
   ②不实跑测试/不构建 SEA（都远超 60s），改为静态直接量 + 载体读数；
   ③仪器不可用与真红用 stderr 的 `CAUSE=` 前缀区分（`echo …>&2` 与 `exit 1` 同一行，
   `criterion-failure-attribution-check.ts` 逐行判）。

### 四、反作弊锚点（⛔ 防「靠少跑测试换绿」）

CI 日志自带 `__GROUP__ concurrency=8 files=631` 读数。按 `test-file-baseline.ts` 定的规矩，
断言必须是**关系而非快照**：AC-265 要求绿的那次 run 的 `files` **≥ 紧邻的前一次 decisive run 的 `files`**
（只比相邻一次 ⇒ 不引入窗口大小魔数，且恰好抓住「为了绿而删/跳测试」这个动作发生的区间）。
⛔ 永不写 `== 631` 这类快照形态。

## 范围（在域 AC = AC-265、AC-269、AC-270、AC-271、AC-272、AC-274、AC-319，共 7 条）

- **AC-265** develop 首绿，且绿不是靠少跑测试换来的（long-term）
- **AC-269** CI 红有机械归因：真缺陷 / 基础设施 / 已知 flake（long-term）
- **AC-270** master 的值域不变式：化石值，或一个 Release 全绿的 tag（long-term）
- **AC-271** release 分支 tip 逐字停在同名 tag 上（long-term）
- **AC-272** 滚动渠道自证版本：`-dev` 后缀，或等于同名 tag 的构建（long-term）
- **AC-274** 首次真实全绿发布 + master 已 ff 到它（一次性，时间窗限定立案之后）
- **AC-319** 全部 workflow 的全部 job 都在 self-hosted runner 上——计量式 hosted runner 的账单闸不再能挡住 CI/发布（long-term，2026-09-24 重开时新增）

⛔ 已退役、不再计入范围（均 `superseded`）：**AC-266 / AC-267 / AC-268**——主体（SEA/npm 产物线）经人 2026-09-16 裁定取消（SPEC §11.4）；**AC-273**——由 AC-284 / AC-285 取代（默认分支改回 master 后「origin/HEAD 指向 develop」不再成立）；**AC-320**——人 2026-10-07 裁定取消：判据要求 `form=tagged` 记录，而规范切版路径（`release-cut.sh` → `release-branch-finish.sh --cut`）落台账的是 `form=cut`，取值词表对不上 ⇒ 判据结构上不可能绿；台账里 v0.13.0 / v0.14.0 / v0.15.0 / v0.16.0 四条 `form=cut exit=0` 记录都带 tag、都落在主检出，「切版留痕可读回」这件事本身已满足。

## 非目标 / 与 GOAL-019 的边界

⛔ 本 GOAL **不**管 plugin cache / marketplace 渠道的交付自足——那是 GOAL-019。
两者在 `packages/quay/src/plugin-root.ts` 上相邻但**失效模式不同**：
GOAL-019 管 cache 里的**解析路径**（`KERNEL_RELS` / `resolvePluginRootFrom` 的 walk-up），
GOAL-020 管 SEA bundle 里的**顶层求值时机**（`MODULE_DIR` 在 import 时就执行）。
⚠️ 两个 GOAL 的任务会在该文件的 Touches 互斥上互相阻塞，立案时需显式错开 Touches 粒度。

⛔ 本 GOAL 不追求「CI 绿率达到 X%」——绿率的成本结构此刻未知（decisive 样本 0/52），
**先拿到第一次 decisive 绿，再用它产出的数据谈稳定性阈值**（硬规则 4 推论：成本结构未知前不设数值阈值）。

## 退出条件

① **develop 上的 CI 能绿，且该次绿不是靠少跑测试换来的**——存在一次 decisive 的 `success`，
   且其跑过的测试文件数不低于紧邻的前一次 decisive run。
② **release 渠道能发出一个真能起来的产物**——`.quay/ci-runs.jsonl` 里存在一次
   `workflow=Release` 且 `conclusion=success` 的 run，且 master 已 ff 到它的 tag；
   「发出去的产物真能起来」由该 run 的**全绿**承载：`advance-master.needs` 必须覆盖
   `.github/workflows/release.yml` 内其余每一个 job（`release-master-advance-needs-check.ts`，
   每轮跑，见 `plugin/scripts/runner-static-gate.ts:958`），而该 gate job 本身就是 plugin 渠道的
   真实安装验证（marketplace 装得上 → `quay-init` → `quay driver start` / `quay serve` 在隔离环境
   alive，见 SPEC §11.2）。
③ **红有机械归因**——CI 转红时，载体里有一条区分「真缺陷 / 基础设施 / 已知 flake」的记录，
   不需要人肉读 15000 行日志来定性（2026-09-15 为定性这一批红花掉的人力，正是立本 GOAL 的直接动因）。

## 重开（2026-09-24，人裁定）

**直接量**：run `35966264609`（develop CI）的 `version-consistency` / `dist-verify-node-floor` 两个 job
`runner_name=""`、`steps=0`，check-run annotation 逐字 *"The job was not started because recent account
payments have failed or your spending limit needs to be increased"*；同形挡住 `release.yml` 全部 3 个 job 与
`publish-plugin-dist.yml` ⇒ v0.12.0（tag 已切，`5e373be`）的 release run 不可执行，master 停在 v0.11.0
——**按 AC-270 这是正确输出**（master 只随全绿 release run 的 `advance-master` 前进，⛔ 不手推）。

**为什么挂本 GOAL 而不新立**：本 GOAL 退出条件 ②「release 渠道能发出产物」在账单闸下已不成立，而它的
long-term AC 全部判为通过——它们读的是**已发生的** run，结构上看不见「下一次 run 起不来」。缺的保证
是「交付链不依赖计量式 runner」（AC-319）与「切版可重复且留痕在主台账」（AC-320）。

**⛔ 不新增**「master = 最近一次全绿 release tag」一条：AC-270 已覆盖 master 值域，而全绿 run 自带
`advance-master` ⇒ 增量近零（硬规则 5 去重）。

**执行任务**：runner 迁移 + 防回漂静态闸（`goal_ac: AC-319`）；切版载体 + 主台账落点（`goal_ac: AC-320`）；
采集器「未启动」独立取值（正文关联 AC-269 的归因正确性）；CI 并发下红的 `serve-sessions-body-i18n.test.mjs`
（正文关联 AC-265）。

## 收口（2026-10-07，人裁定）

在域 AC 7 条全部 achieved；唯一未成的 AC-320 经人裁定取消（判据取值词表陈旧，理由见 `## 范围` 的退役行）。
本 GOAL 的退出条件 ① / ② / ③ 分别由 AC-265 / AC-274 / AC-269 承载，三条均已 achieved。
充足性判官在本轮改前的裁决为 `covered`；改动会换掉 `sufficiencyCacheKey`，由下一轮按新 key 重判。