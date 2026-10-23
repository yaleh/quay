---
id: gap-ac920-criterion-pipe-swallows-exit-code
title: AC-920 判据 `2>&1 | tail -6` 吞掉 node --test 退出码 ⇒ 结构上恒 pass；AC-922 已
  supersedes 但 AC-920 自身 supersededBy 为空、仍 active ⇒ 处置（改判据 vs 退役）需人裁定
status: todo
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

- [ ] AC1 AC-920 criterion 的「恒 pass」被对照实测钉住并写进 `## Evidence`：空沙箱里逐字跑 AC-920 criterion ⇒ exit 0，而同一条 `node --test plugin/test/unencapsulated-state-admission.test.mjs` 不经 pipe ⇒ exit 1；贴两条完整命令、stderr 首行与两个 exit code。
- [ ] AC2 记录不一致的三个读数逐字贴进 `## Evidence`：`quay goal show AC-920 --json` ⇒ `"status": "active"` + `"supersededBy": []` + criterion 含 `tail -6`；`quay goal show AC-922 --json` ⇒ `"status": "achieved"` + `"supersedes": ["AC-920"]`；`quay goal show GOAL-911 --json` 的退出条件 ④ 不含 AC-920。
- [ ] AC3 处置裁定请求落成 board-visible 的 META 记录：`node packages/quay/bin/quay.js meta write META-<NNN> --title "…" --body-file <path>`（正文含 a/b/c 三个选项、各自成本与不可逆点、AC-922 origin 的逐字约束；⛔ body 由脚本生成，不手打多行命令），随后 `node packages/quay/bin/quay.js meta get META-<NNN> --json` 读回并贴进 Evidence（含 `status` / `reply`）。
- [ ] AC4 裁定请求已投递到当前 live manager 会话：`ListAgents` → `SendMessage`（⛔ 不用 `supervisor-deliver.sh` 默认路径）；Evidence 记录目标会话名与消息摘要。若通道不可用，写明失败读数与已用的替代通道，⛔ 不静默。
- [ ] AC5 裁定前不改 AC-920 的 goal 记录：`git log --oneline -1 -- 'goals/AC-920-*.md'` 仍是立案前的 `fd9125e50`，且 `git status --porcelain goals/` 为空输出。
- [ ] AC6 scoped 门：`bash scripts/test.sh --for-task gap-ac920-criterion-pipe-swallows-exit-code --allow-thin` exit 0。

## DoD

- 裁定请求在真实载体上可被后续读到（META 记录 + manager 会话投递），⛔ 不是只在对话/任务体里；a/b/c 每项写明成本与不可逆点，并逐字引用 AC-922 origin 的「Retirement/rewording of AC-920 remains a human decision」。
- 本任务不替人处置 AC-920：`git status --porcelain goals/` 为空、`quay goal show AC-920 --json` 仍为 `active` 且 criterion 逐字未变；⛔ 本轮不出现任何改 AC-920 status/criterion 的 goal write 提交。
- 任务经 fan-in ff-merge 进入 develop，`tasks/gap-ac920-criterion-pipe-swallows-exit-code.md` 在 develop 可见且顶层 frontmatter 带 `goal_ac: AC-920`（driver 下一轮据此独立核验）。

## Touches

- `goals/AC-920-unencapsulated-state-端到端跑通-线索器只产-candidate-判断器拒绝-memoized-误报.md`
- `plugin/test/unencapsulated-state-admission.test.mjs`
- `tasks/gap-ac920-criterion-pipe-swallows-exit-code.md`

<!-- 说明：前两个文件本任务只读/只跑，不修改；Touches 用来说明裁定对象与 criterion 的承载者。 -->
