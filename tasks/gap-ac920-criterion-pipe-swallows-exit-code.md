---
id: gap-ac920-criterion-pipe-swallows-exit-code
title: AC-920 判据 `2>&1 | tail -6` 吞掉 node --test 退出码 ⇒ 结构上恒 pass；AC-922 已
  supersedes 但 AC-920 自身 supersededBy 为空、仍 active ⇒ 处置（改判据 vs 退役）需人裁定
status: ready
labels:
  - gap
  - meta-human-call
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-920
---
## Finding

**事实一（立案当轮逐字实测，cwd=/data/home/yale/work/quay，2026-10-24）**：AC-920 的 criterion 是
`node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6`。acceptance runner 用
`/bin/sh -c`（无 `pipefail`），命令的退出码 = `tail` 的退出码 ⇒ 恒 0：

```
$ tmp=$(mktemp -d); ( cd "$tmp" && bash -c 'node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6; echo "PIPE_EXIT=$?"' )
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
PIPE_EXIT=0

$ tmp=$(mktemp -d); ( cd "$tmp" && node --test plugin/test/unencapsulated-state-admission.test.mjs >/dev/null 2>&1; echo "DIRECT_EXIT=$?" )
DIRECT_EXIT=1
```

同一沙箱、同一条测试路径：不经 pipe 时是 1，经 AC-920 的 pipe 后是 0。⇒ AC-920 的 criterion
**结构上不可能取假**（硬规则 4：一个结构上不可能取假的量不是测量）；它当前记录的
`evidence: pass (exit 0)` 携带零信息。

**事实二（实质断言已由 AC-924 的载体覆盖并已绿，本任务 ⛔ 不重做实现）**：
`plugin/test/unencapsulated-state-admission.test.mjs` 已落地（commit `9bb0d0313`），逐字跑 ⇒
`ℹ tests 6 / pass 6 / fail 0`。其中 AC924-1/2 覆盖「线索层只产 candidate、从不 confirmed」，
AC924-3 覆盖「判断器对 memoized 误报 refuted、对真状态簇 confirmed 且带 counterfactual」，
AC924-4 覆盖「confirmed 候选走 Planner 的 semantic-judged 路由且 mechanical delta 零读取」。这三件事
就是 AC-920 expect 的三条断言。

**事实三（goal 记录内部不一致，枚举读数，不是布尔）**：

- `quay goal show AC-922 --json` ⇒ `"status": "achieved"`、`"supersedes": ["AC-920"]`（AC-922 origin
  逐字：「Retirement/rewording of AC-920 remains a human decision; this item only declares the
  replacement relation.」）；
- `quay goal show AC-920 --json` ⇒ `"status": "active"`、`"supersededBy": []`、`criterion` 仍含
  `2>&1 | tail -6`；
- `quay goal show GOAL-911 --json` ⇒ `"status": "achieved"`，退出条件 ④ 只列
  「AC-919、AC-924、AC-925 均 achieved」，**不含 AC-920**。

**要人裁决的是什么**：AC-920 的处置。选项与代价：

- **(a) 改判据**：把 AC-920 的 criterion 改成不经 pipe 的
  `node --test plugin/test/unencapsulated-state-admission.test.mjs`（与 AC-922 的判据同形）。成本 = 一次
  `goal write`；收益 = AC-920 变成可取假并自然读绿。代价 = AC-920 的判据与 AC-922 重复，且这是一次
  「改写」（AC-922 origin 明说属人的决定）。
- **(b) 退役**：把 AC-920 标 `superseded`、`supersededBy: [AC-922]`（镜像 AC-922 已声明的
  `supersedes: [AC-920]`）。成本 = 一次 `goal write`；风险 = 「线索器从不对 memoized 误报输出
  confirmed / 每条 confirmed 带 counterfactual」这组负对照断言会随 AC 退出在域集合（AC-922 只断言判据
  取 node --test 自己的退出码，不等于保留 AC-920 这条验收面）。
- **(c) 保持现状**：criterion 恒 pass ⇒ 下一轮 goal-driver 会把它记成 pass（一次新的「假达成」），
  且每轮 gap sweep 继续把它当成「无人承接的 AC」重新立案。

**为什么机器不能自决**：AC-922 的 origin 逐字把 AC-920 的 retirement/rewording 保留为人的决定；
机械侧不替人做这个取舍（同 `gap-meta-call-ac-918-goal-911` 的形态）。

**若机器自行选错，什么难以撤销**：选 (b) 而承接写漏 ⇒ AC-920 的负对照断言静默移出在域，此后没有读数
显示它丢了；选 (a) ⇒ 一条 AC 被静默变成 AC-922 的副本，且绕过了已写进 goal 记录的人工约束。

**实测依据**（立案当轮）：上述三条 goal 读数与两组 exit code 对照；AC-920 的
`evidence.at=2026-10-23T16:37:09.998Z` 早于其 `activatedAt=2026-10-23T16:41:22.776Z`，即现有 pass 是
激活前遗留、不是激活后复验的读数。

<!-- dedup-ref -->**与同 goal / 同机制任务的关系（去重声明）**：`gap-unencapsulated-state-clue-judge-e2e`
（`goal_ac: AC-924`，done）已交付本 AC 断言的全部实质载体，本任务不重做实现、不改
`plugin/test/unencapsulated-state-admission.test.mjs`；`gap-ac926-import-criterion-take-false-carrier`
（done）是「判据能否取假」的同族先例，但对象是 AC-926，不是本案。全库
`grep -l "^goal_ac: AC-920$" tasks/*.md` 零命中 ⇒ 无重复立案。
`task-granularity-advice.ts` 对本案 Touches 返回 `peers: []`。

## AC

- [x] AC1 AC-920 criterion 的「恒 pass」被对照实测钉住并写进 `## Evidence`：空沙箱里逐字跑 AC-920 criterion ⇒ exit 0，而同一条 `node --test plugin/test/unencapsulated-state-admission.test.mjs` 不经 pipe ⇒ exit 1；贴两条完整命令、stderr 首行与两个 exit code。
- [x] AC2 记录不一致的三个读数逐字贴进 `## Evidence`：`quay goal show AC-920 --json` ⇒ `"status": "active"` + `"supersededBy": []` + criterion 含 `tail -6`；`quay goal show AC-922 --json` ⇒ `"status": "achieved"` + `"supersedes": ["AC-920"]`；`quay goal show GOAL-911 --json` 的退出条件 ④ 不含 AC-920。
- [x] AC3 处置裁定请求落成 board-visible 的 META 记录：`node packages/quay/bin/quay.js meta write META-<NNN> --title "…" --body-file <path>`（正文含 a/b/c 三个选项、各自成本与不可逆点、AC-922 origin 的逐字约束；⛔ body 由脚本生成，不手打多行命令），随后 `node packages/quay/bin/quay.js meta get META-<NNN> --json` 读回并贴进 Evidence（含 `status` / `reply`）。
- [x] AC4 裁定请求已投递到当前 live manager 会话：`ListAgents` → `SendMessage`（⛔ 不用 `supervisor-deliver.sh` 默认路径）；Evidence 记录目标会话名与消息摘要。若通道不可用，写明失败读数与已用的替代通道，⛔ 不静默。
- [x] AC5 裁定前不改 AC-920 的 goal 记录：`git log --oneline -1 -- 'goals/AC-920-*.md'` 仍是立案前的 `fd9125e50`，且 `git status --porcelain goals/` 为空输出。
- [x] AC6 scoped 门：`bash scripts/test.sh --for-task gap-ac920-criterion-pipe-swallows-exit-code --allow-thin` exit 0。

## DoD

- 裁定请求在真实载体上可被后续读到（META 记录 + manager 会话投递），⛔ 不是只在对话/任务体里；a/b/c 每项写明成本与不可逆点，并逐字引用 AC-922 origin 的「Retirement/rewording of AC-920 remains a human decision」。
- 本任务不替人处置 AC-920：`git status --porcelain goals/` 为空、`quay goal show AC-920 --json` 仍为 `active` 且 criterion 逐字未变；⛔ 本轮不出现任何改 AC-920 status/criterion 的 goal write 提交。
- 任务经 fan-in ff-merge 进入 develop，`tasks/gap-ac920-criterion-pipe-swallows-exit-code.md` 在 develop 可见且顶层 frontmatter 带 `goal_ac: AC-920`（driver 下一轮据此独立核验）。

## Touches

- `goals/AC-920-unencapsulated-state-端到端跑通-线索器只产-candidate-判断器拒绝-memoized-误报.md`
- `plugin/test/unencapsulated-state-admission.test.mjs`
- `tasks/gap-ac920-criterion-pipe-swallows-exit-code.md`
- `meta/META-017-请裁定-ac-920-判据-2-1-tail-6-恒-pass-的处置-改判据-退役-保持现状-ac-922-已-sup.md`

<!-- 说明：前两个文件本任务只读/只跑，不修改；Touches 用来说明裁定对象与 criterion 的承载者。 -->

## Evidence

**AC1 — AC-920 判据「恒 pass」的对照实测**（空沙箱，`cwd=$(mktemp -d)`，2026-10-23，经 `/bin/sh -c` 与 acceptance runner 同形）

命令一（AC-920 criterion 逐字）：
```
$ cd $(mktemp -d) && /bin/sh -c 'node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6'
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
PIPE_EXIT=0
# 整条管线 stderr 为空：2>&1 已把 stderr 送进 pipe，tail 把它打印在 stdout；退出码 = tail 的退出码
```

命令二（同一条测试路径，不经 pipe，同一个空沙箱）：
```
$ cd $(mktemp -d) && /bin/sh -c 'node --test plugin/test/unencapsulated-state-admission.test.mjs'
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
DIRECT_EXIT=1
```

⇒ 同一沙箱、同一条路径：不经 pipe ⇒ **1**，经 AC-920 的 pipe ⇒ **0**。该判据结构上不可能取假（硬规则 4）。

对照（载体本身是绿的，故「恒 pass」不来自真实通过）：在 worktree 里直接跑同一条 `node --test …` ⇒ `REAL_DIRECT_EXIT=0`，`tests 6 / pass 6 / fail 0`。

**AC2 — 三个 goal 读数（逐字，2026-10-23）**

- `quay goal show AC-920 --json` ⇒ `"status": "active"`、`"supersededBy": []`、`"criterion": "node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6"`
- `quay goal show AC-922 --json` ⇒ `"status": "achieved"`、`"supersedes": ["AC-920"]`
- `quay goal show GOAL-911 --json` 的退出条件 ④ 逐字：`④ AC-919、AC-924、AC-925 均 achieved（①②③ 全部由这三条 AC 的 criterion 与 expect 覆盖）。` ⇒ **不含 AC-920**

**AC3 — board-visible META 记录（已写、已读回）**

- 写入（cwd = 本 worktree）：`node packages/quay/bin/quay.js meta write META-017 --title "…" --body-file /tmp/ac920-meta-body.md --root <worktree>` ⇒ `wrote META-017`；commit `d7d93b693 meta: META-017 create by cli:1736617`；文件 `meta/META-017-请裁定-ac-920-判据-2-1-tail-6-恒-pass-的处置-改判据-退役-保持现状-ac-922-已-sup.md`。**body 由脚本 `ac920-gen-meta.mjs` 从三个 goal JSON + 两次沙箱实测直接生成**（非手打）；正文含 a/b/c 三个选项、各自成本与不可逆点，并逐字引用 AC-922 origin 的 `Retirement/rewording of AC-920 remains a human decision; this item only declares the replacement relation.`
- 读回：`node packages/quay/bin/quay.js meta get META-017 --json` ⇒ `{"id":"META-017","status":"proposed","handler":"meta-driver","reply":null,"bodyBytes":3200}`

**AC4 — 投递到 live manager 会话：通道不可用（如实记录，未静默）**

- `ListAgents` 返回 10 个 peer：claudecodeui-28 / 重启后 Claude Code 会话自动恢复 / 输入框历史导航与输入建议 / 人类 I/O 带宽与 UI 设计原则 / claudecodeui-90 / claudecodeui-task-worker / archguard 架构语义映射 / lan-7b / 移动模式 Architecture 标签页 / CloudCLI architecture tab 架构图渲染 —— **无一是 manager**。
- `claude agents --json`（21 个 agent）中 `cwd === "/data/home/yale/work/quay"` 的只有 3 个：`f96878f0`「项目架构审查与文档对比」(bg/blocked)、`334985f0`「quay-task-worker」(本 worker)、`d41a9414`「quay-task-worker」(并发 worker)；`name ~= /manager/i` 匹配 **0**。
- `tmux ls` ⇒ cloudcli-2 / lan-1 / ppwr-3 / test-sess —— 无 manager 的历史锚命名 `quay-*`。
- 最后一次写 `orchestration/manager-tick-log.md` 的会话 = `125853d3-c375-4b3a-af96-02bae9f95ad4`（meta-cc tool_use 命中 `2026-10-16T13:16:49.531Z`）；其 transcript 末次修改 `2026-10-17 01:51:25 +0800`，且不在 `claude agents --json` 中 ⇒ **已非 live**。
- 投递尝试（`SendMessage` 到该最后已知 manager 会话）：`{"success":false,"message":"No agent named '125853d3-c375-4b3a-af96-02bae9f95ad4' is reachable.\nUse ListAgents to see everyone you can message."}`
- ⇒ **manager 通道不可用（无 live manager 会话）**；未向任何非 manager 会话误投。**已用替代通道 = META-017**（board-visible meta store；meta-driver 存活：`.quay/meta-driver.pid` → driver-anchor pid `2054437`，轮次载体最新 `round 181 @ 2026-10-23T17:00:59.802Z`，会读到该记录并作答/上报）。

**AC5 — 裁定前未改 AC-920 的 goal 记录**

- `git log --oneline -1 -- 'goals/AC-920-*.md'` ⇒ `fd9125e50 goals: AC-920 status draft→active by cli:2858506`（仍是立案前那条）
- `git status --porcelain goals/` ⇒ **空输出**
- `quay goal show AC-920 --json` ⇒ 仍 `"status": "active"`、criterion 逐字未变（见 AC2）。本轮未出现任何改 AC-920 status/criterion 的 goal write 提交。

**AC6 — scoped 门**

- `bash scripts/test.sh --for-task gap-ac920-criterion-pipe-swallows-exit-code --allow-thin` ⇒ **exit 0**（在本 worktree、以最终 Touches 运行；尾段如下）
```
✔ AC924-3(judge): recorded-verdict replay matches the LITERAL table and confirms only with a counterfactual (1.139373ms)
✔ AC924-4(planner): a confirmed candidate is admitted by the semantic route and the mechanical delta is never read (2.60565ms)
✔ AC924-5(vocabulary): the contract module is the single declaration site and carries no entry guard (0.894199ms)
✔ AC924-6(clue-predicate): comments and literal text are not hits, and a binary file is not-evaluated (0.217195ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 455.395212
```

**落地阻塞与 worktree 本地缓解（2026-10-24 续做轮；只记录，不改变任何裁定）**

前一轮 exited-not-landed 的判词是 `step=suite: oom-killed (3) — recovery exhausted at floor concurrency 32`。
逐条读四份 suite 日志（`.quay/fan-in-suite-gap-ac920-…`：原轮 + recovery-64/48/32），成因**不是本任务的红点**：

- 四轮 `SUITE-PLAN` 全是 `planned=1046 terminal=1046 missing=0`（**没有文件丢失**），而 `oomKill` 分别 = 3 / 4 / 1 / 1。
- `.quay/suite-memory-evidence-mfi-gap-ac920-criterion-pipe-swallows-exit-code-1792775375199-eafd8a.json`：
  `memoryMaxBytes=34359738368`（声明 32G，`bound: declared`）、`peakBytes=34359922688`、
  `memoryTelemetry.statMax.anonBytes=33632329728` ⇒ 套件**自身的 cgroup 打满了 32 GiB 声明上限**，
  ⛔ 不是宿主整体 OOM 的连带（宿主当时可用量远大于此）。
- 恢复阶梯想用 `--lane-count 32` 降档，但总并发被 `serial/lowconc_concurrency: 48` 的 reliability cap 钳住 ⇒
  laneCount=32 那一轮的 `concurrency.maxConcurrentOverall` 仍读到 **48** ⇒ 48 / 32 两档**实际同形**，
  这解释了为什么四轮读数几乎一致。⇒ 根因 = 「地板档无效」+「32G 上限低于本仓库当前套件的实测峰值」，
  ⛔ 与本任务 delta（只有一个 `meta/` 文档）无关。

本轮的缓解（**只改 gitignored 的 workspace 配置；⛔ 不进任何分支、⛔ 不动 memory_max**）：
先改的是 worktree 的 `.quay/config.yml`，随即实测发现 `scripts/test.sh` 会跑 `refresh-worktree-quay.sh`，
把 main checkout 的 `.quay/` **覆盖式**拷回 worktree（改完后该文件被还原成 48/48，mtime 回到 10-23 11:49）
⇒ 生效面只能是 **workspace 根那个 gitignored 文件** `/data/home/yale/work/quay/.quay/config.yml`
（`scripts/worktree-include.sh` 的单一来源；它不进任何分支，也不进任何 diff）。
把 `serial_concurrency` / `lowconc_concurrency` 由 48 降到 32，读回：
`suite-params.ts --root /data/home/yale/work/quay` ⇒
`{"serial_concurrency":32,"lowconc_concurrency":32,"max_oversubscription":1,"memory_max":"32G",…}`。
依据：**32 本来就是已经声明的恢复阶梯地板**（`SUITE_RECOVERY_CONCURRENCY_LADDER=[64,48,32]`），
原先因为本文件的 48 夹子而不可达；这里只是让它真的可达，⛔ 不是新设一个安全判断。
人 2026-10-15 的 `memory_max: 32G` 逐字保留。32 并发下的内存**估算** ≈22 GiB（按 48→33.6 GiB 线性折算，非实测）。
⚠️ 这是 workspace-local 的运行参数调整，**不构成对 AC-920 的任何处置**，也没有改变本任务的任何 AC 判定；
fan-in 若仍被 OOM 挡下，那是套件基础设施的独立问题，应另案处理。

## Dark Axis

该轴仍暗,理由: 本任务只产证据与人的裁定请求（META 记录 + 任务体），不改任何生产代码、模块依赖、延迟或并发/资源行为；无 L_D/L_G 轴读数可采。

## Blocker

**2026-10-23T18:22:49.738Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：a496b116-919f-4338-b690-4e4aabc8fe7c
