export const meta = {
  name: 'manager-tick-readings',
  description: '管理者 tick 骨架：取数 / 升级项 / 目标复核 → 对抗复核 + 自我审计 → 综合提案（裁定仍归主循环）',
  whenToUse: '每次 manager tick 开始时跑；拿一份被复核过的读数 + 一份对我自己行为的审计 + 一份动作提案',
  phases: [
    { title: 'Gather', detail: '并行取数：AC16巡检 / 三项目升级项 / 阶段目标复核' },
    { title: 'Audit', detail: '并行审计：读数对抗证伪 / 用 meta-cc 审计管理者自己这轮的行为' },
    { title: 'Propose', detail: '综合成动作类 + tick-log 草稿 + 该升级什么' },
  ],
}

// 设计依据（人 2026-08-07 两次纠正）：
//   ① workflow 结晶的是【重复的 agent 行为序列】——"哪一步不许跳"。今晚三次跳步
//      （§1.b2 工具自查从没跑、KNOWN-LOAD-SENSITIVE 隔离重跑从没做、正控制靠人问出来）
//      都不是读数错，是步骤没被执行；散文里写"强制"拦不住，序列固化才拦得住。
//   ② 我曾以"判断需要我的上下文、不下放"为由只做 2 个取数 agent —— 那个前提不成立：
//      **meta-cc 索引着管理者会话历史，subagent 可以自己去查**。所以判断类步骤同样下放，
//      主循环只保留最终裁定（§1.5：范围/优先级/资源裁定才是人和我的）。

// 模型档位（人 2026-08-07 裁定：先全部 sonnet，后续再考虑按 agent 细化）。
// 实测（探针 wf_6f8cc053-f52）：opts.model 覆盖真生效，不声明则继承主会话模型（opus-5）。
// 细化时的已知取舍：'verify-readings' / 'self-audit' 两个 agent 是首轮 10 条可疑读数的唯一来源，
// 降档风险最高；取数/聚合/目标复核是机械活，降档最安全。
const MODEL = 'sonnet'

const ROOT = '/home/yale/work/quay'
// 管理者会话（供 subagent 用 meta-cc 审计我自己这轮的行为）
const MGR_SESSION = 'b8dc91a6-64e8-4d70-a715-9ec8e16a4f11'

const COMMON = `你在 ${ROOT} 为【管理者 tick】工作。**只读，不得写入或提交任何文件。**
判据的唯一来源是 ${ROOT}/orchestration/manager-loop-tick.md（步骤）与
${ROOT}/orchestration/manager-phase-goal.md（阶段目标与 AC）——**现读，不要凭常识替换它们的口径**。

**取数硬约束（每条都是 2026-08-07 实测栽过的坑，不许跳）**：
- **正控制先行**：\`git log --oneline --since='1 day ago' | wc -l\` 必须远大于 0；为 0 ⇒ 查询本身坏了。
- 时间窗一律用**全称** minutes/hours。**\`--since='30 min ago'\` 静默返 0 且不报错**
  （实测 '60 min ago'→0 而 '60 minutes ago'→13），据此报过一次错误的"系统全停"。
- \`plugin.json\` 有 3 份，只认真交付物 \`plugin/.claude-plugin/plugin.json\`；
  \`milestones/*/worktrees/*\` 下那份 2026-08-01 起停更（读错它连报过 9 轮不存在的版本不一致）。
- 会话身份用 \`tmux list-panes -a -F '#{pane_pid} #{pane_current_command}'\`，
  **不要 \`pgrep -P … | head -1\`**（取到的是任意子进程，实测是 MCP 服务器）。
- 存活类判断用条件式（\`if ps -eo args | grep -q '[模]式'\`），**绝不无条件 echo "有/在"**。
- 要退出码就不要管道（管道后读 \$? 读到的是最后一个管道命令的）。
- **零命中必须与"查询写错"区分**：先用一个已知非空的宽查询验证查询本身。`

const READINGS_SCHEMA = {
  type: 'object',
  required: ['positiveControl', 'ac16', 'resources', 'liveness', 'progress', 'monitors'],
  properties: {
    positiveControl: {
      type: 'object', required: ['dayWindowCount', 'valid'],
      properties: {
        dayWindowCount: { type: 'integer' },
        valid: { type: 'boolean', description: 'false ⇒ 后续时间窗读数一律不可信' },
      },
    },
    ac16: {
      type: 'object', required: ['releaseTag', 'developAhead', 'filesHasPlugin'],
      properties: {
        releaseTag: { type: 'string' }, developAhead: { type: 'integer' },
        filesHasPlugin: { type: 'boolean' },
        manifestVersion: { type: 'string', description: '真交付物那份的 version' },
        criterion3Evidence: { type: 'string', description: 'B/C 上 clone 的两份是否用 release 装出的 quay 跑通；无证据写"无"' },
      },
    },
    resources: {
      type: 'object', required: ['cpuSomeAvg10', 'load1', 'nodeCount'],
      properties: {
        cpuSomeAvg10: { type: 'number' }, cpuSomeAvg300: { type: 'number' },
        load1: { type: 'number' }, nodeCount: { type: 'integer' }, memAvailMb: { type: 'integer' },
        halted: { type: 'array', items: { type: 'string' } },
      },
    },
    liveness: {
      type: 'array',
      items: {
        type: 'object', required: ['target', 'state'],
        properties: {
          target: { type: 'string' },
          state: { type: 'string', enum: ['claude', '窗口在但非claude', '窗口不存在'] },
          panePid: { type: 'string' },
        },
      },
    },
    progress: {
      type: 'object', required: ['nonManagerCommits30m', 'latestOuterTickLine'],
      properties: {
        nonManagerCommits30m: { type: 'integer' },
        taskStateChanges: { type: 'array', items: { type: 'string' }, description: '真任务收口，区别于 tick 记账' },
        latestOuterTickLine: { type: 'string' },
        latestInnerActivity: { type: 'string' },
        suiteState: { type: 'string' },
        divergence: { type: 'string' },
      },
    },
    monitors: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'alive'],
        properties: { id: { type: 'string' }, alive: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
  },
}

const ESCALATION_SCHEMA = {
  type: 'object',
  required: ['counts', 'needsHuman', 'newSinceLastTick'],
  properties: {
    counts: { type: 'object', properties: { quay: { type: 'integer' }, archguard: { type: 'integer' }, metacc: { type: 'integer' } } },
    needsHuman: { type: 'array', items: { type: 'string' }, description: '去重排序后真正需要人裁定的（不含已转达过的）' },
    newSinceLastTick: { type: 'array', items: { type: 'string' } },
    duplicates: { type: 'array', items: { type: 'string' }, description: '跨项目重复的同一条' },
  },
}

const GOAL_SCHEMA = {
  type: 'object',
  required: ['staleACs', 'achievedButUnticked'],
  properties: {
    achievedButUnticked: { type: 'array', items: { type: 'string' }, description: '判据已满足但没勾' },
    staleACs: { type: 'array', items: { type: 'string' }, description: '已失效/前提已变但没改' },
    staleNumbers: { type: 'array', items: { type: 'string' }, description: '目标文件里写死的数字与实测不符' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['trustworthy', 'suspects'],
  properties: {
    trustworthy: { type: 'boolean' },
    suspects: {
      type: 'array',
      items: {
        type: 'object', required: ['field', 'why'],
        properties: { field: { type: 'string' }, why: { type: 'string' }, klass: { type: 'string' } },
      },
    },
  },
}

const SELFAUDIT_SCHEMA = {
  type: 'object',
  required: ['violations', 'moltenActions'],
  properties: {
    violations: {
      type: 'array',
      description: '管理者本轮违反自己规则的实例；空数组=未发现',
      items: {
        type: 'object', required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: '§0边界 / §1.b2工具使用 / §1.5该做却问人 / §4已知失效表某行' },
          evidence: { type: 'string', description: '来自 meta-cc 或 git 的具体证据，不得是印象' },
        },
      },
    },
    moltenActions: { type: 'array', items: { type: 'string' }, description: '本轮骨架之外的临时动作短名（供第六列与上浮计数）' },
    skippedSteps: { type: 'array', items: { type: 'string' }, description: '文档要求但本轮没做的步骤' },
  },
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  required: ['actionClass', 'tickLogDraft', 'toEscalate', 'toRelayToOuter'],
  properties: {
    actionClass: { type: 'string', enum: ['no-action', 'arbitrate', 'escalate', 'correct'] },
    actionClassWhy: { type: 'string' },
    tickLogDraft: { type: 'string', description: '第2-6列的内容（不含时刻列），第六列格式 熔｜<动作名>,<动作名> 或 熔｜-' },
    toEscalate: { type: 'array', items: { type: 'string' }, description: '要攒给人的' },
    toRelayToOuter: { type: 'array', items: { type: 'string' }, description: '已验证、可直接送 outer 的事实（§1.5：不要问要不要送）' },
    arbitrationNeeded: { type: 'boolean', description: '是否需要动 .halt' },
  },
}

// ── Gather ───────────────────────────────────────────────────────────────────
phase('Gather')
const [readings, escalations, goalReview] = await parallel([
  () => agent(
    `${COMMON}

**你的任务：取本轮 tick 的机械读数。只取数，不做判断、不给建议。**
按 manager-loop-tick.md 的 §1-AC16（三条巡检项）、§1.a（三项目+资源）、§1.b（各层身份+各外层最新 tick 行）、
§1.4e（临时 Monitor 是否真存活）逐条实跑。**推进判据要区分"tick 记账"和"真任务收口"**——
前者是 tick-log 提交，后者是任务状态翻转/fan-in，只有后者算推进。`,
    { label: 'readings', phase: 'Gather', schema: READINGS_SCHEMA, model: MODEL }
  ),
  () => agent(
    `${COMMON}

**你的任务：§1.c 聚合升级项。读三个项目各自的 orchestration/escalations.md
（/home/yale/work/{quay,archguard,meta-cc}），只做三件事：去重、排序、判断哪些需要人。
不解决它们**——解决是各项目外层的活。

**关键**：用 meta-cc 查管理者会话（session_id \`${MGR_SESSION}\`）确认**哪些已经转达过人了**，
已转达的不要重复列进 needsHuman——重复播报同一条是 2026-08-03 被外层当面批评过的噪声形态。`,
    { label: 'escalations', phase: 'Gather', schema: ESCALATION_SCHEMA, model: MODEL }
  ),
  () => agent(
    `${COMMON}

**你的任务：§0.5 阶段目标复核。**读 manager-phase-goal.md，逐条问：
**有没有 AC 已达成而没勾、或已失效而没改？目标文件里写死的数字与实测是否已经不符？**

**这一步有实测代价的先例**：2026-08-07 04:5x 首次按新口径跑，立刻查出目标文件两处过期
（记"落后 2461 提交"实测 v0.4.0 落后 568；记"files 不含 plugin"实测已含）——
**此前连报数轮"AC16 三条无变化"，是在读文件里的旧数字而非重跑判据**。
所以：**凡目标文件里出现的数字，一律自己重跑判据核对，不许照抄。**`,
    { label: 'goal-review', phase: 'Gather', schema: GOAL_SCHEMA, model: MODEL }
  ),
])

// ── Audit ────────────────────────────────────────────────────────────────────
phase('Audit')
const [verdict, selfAudit] = await parallel([
  () => agent(
    `${COMMON}

**你的任务：对抗复核下面这份读数——尝试证伪，不是确认。**

${JSON.stringify(readings, null, 2)}

逐条问：这个数字是否可能是——**静默零**（查询写错与真没发生不可区分）/ **陈旧数**（读了文件里的旧值
或 worktree 陈旧副本）/ **读错文件**（同名多份）/ **无条件 echo** / **管道后读 \$?** / **截断当全貌**？

对每条可疑读数**自己实跑一条独立命令去核**（正控制优先）。默认怀疑：拿不准就列进 suspects，宁可多列。
全部可信则 suspects 返回空数组。`,
    { label: 'verify-readings', phase: 'Audit', schema: VERDICT_SCHEMA, model: MODEL }
  ),
  () => agent(
    `${COMMON}

**你的任务：审计【管理者自己】本轮的行为。这是本 workflow 最重要的一个 agent——
今晚管理者的每一个实质缺陷都是人当场问出来的，没有一个是它自己的巡检查出来的。**

用 **meta-cc** 查管理者会话（session_id \`${MGR_SESSION}\`，工具如
\`mcp__meta-cc__query_session_content\` / \`query_session_signals\`；**它们是 deferred 工具，
先用 ToolSearch 取 schema 再调**），以及 \`git log\`，检查最近这一轮里：

1. **§1.b2 工具使用**：跨会话发消息用的是 \`plugin/scripts/send-keys-reliable.sh\`（transcript 验证送达），
   还是手搓裸 \`tmux send-keys\`？后者是 ADR-016 明令禁止的形态，2026-08-07 踩过（丢 Enter）。
   更根本的：有没有"该有现成工具却没查就自己搓"的动作？
2. **§1.5 该做却问人**：有没有把**自己已经有答案的事**推给人决定？
   实例：已验证"批量合结构性跑不了"却问人"要不要提醒 outer"——事实已验证、送达无副作用、
   不改变任何范围或优先级，**问就是越界把判断推回去**。
3. **§0 边界回流**：有没有写任务体/AC/DoD、跑验证、替项目调试代码、直接改项目代码？
4. **§4 已知失效表**：有没有重犯表里任何一行（把印象当测量 / 管道后读 \$? / 截断当全貌 /
   零命中当没发生 / 手搓代替现成工具 / \`--since='N min ago'\` 静默零）？
5. **跳步**：manager-loop-tick.md 要求的步骤，本轮有没有哪条没做？

**证据必须来自 meta-cc 或 git，不得是印象。** 同时列出本轮骨架之外的临时动作短名
（moltenActions，供 tick-log 第六列与上浮计数）。**没发现问题就返回空数组——不要为凑数编造。**`,
    { label: 'self-audit', phase: 'Audit', schema: SELFAUDIT_SCHEMA, model: MODEL }
  ),
])

// ── Propose ──────────────────────────────────────────────────────────────────
phase('Propose')
const proposal = await agent(
  `${COMMON}

**你的任务：把下面四份材料综合成本轮 tick 的动作提案。你提案，不裁定——
范围/优先级/资源裁定归人和管理者主循环（§1.5）。**

读数：${JSON.stringify(readings)}
复核：${JSON.stringify(verdict)}
升级项：${JSON.stringify(escalations)}
目标复核：${JSON.stringify(goalReview)}
自我审计：${JSON.stringify(selfAudit)}

规则：
- **动作类只有四种**：\`no-action\` / \`arbitrate\`（动了 .halt 或次序）/ \`escalate\`（攒给人）/
  \`correct\`（纠正某个外层的**做法**，不能是它的任务内容——纠正任务内容就是越界）。
  **若 selfAudit.violations 非空，动作类应为 \`correct\`**（对象是我自己）。
- **§2 停下叫人的条件**：连续 3 个 tick 没有任何项目推进任何**任务状态**（tick 记账不算）/
  任一项目外层进程消失（立即报）/ \`.halt\` 解除条件已满足但没人解除。
  **下"零推进"结论前必须确认 positiveControl.valid 为 true**——2026-08-07 因此误报过一次全停。
- **已转达过的不要重复列**（escalations.newSinceLastTick 之外的不再播报）。
- tickLogDraft 写第 2-6 列，**第六列格式 \`熔｜<动作名>,<动作名>\` 或 \`熔｜-\`**，
  内容取自 selfAudit.moltenActions。`,
  { label: 'propose', phase: 'Propose', schema: PROPOSAL_SCHEMA, model: MODEL }
)

return { readings, verdict, escalations, goalReview, selfAudit, proposal }
