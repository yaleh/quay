export const meta = {
  name: 'manager-tick-readings',
  description: '管理者 tick 的机械读数骨架：取数 + 独立复核（判断与记账仍在主循环）',
  whenToUse: '每次 manager tick 开始时，拿一份被复核过的结构化读数，替代手敲一串 bash 块',
  phases: [
    { title: 'Read', detail: '按 AC 导出的巡检项取数，每项自带正控制' },
    { title: 'Verify', detail: '对抗复核：静默零 / 陈旧数 / 读错文件 / 无条件 echo' },
  ],
}

// 为什么是 workflow 而不是脚本（人 2026-08-07 裁定）：
//   workflow 结晶的是【重复的 agent 行为序列】——"哪一步不许跳"。
//   今晚三次跳步都不是读数错，是步骤没被执行：
//     · §1.b2 工具自查连续多轮一次没跑
//     · KNOWN-LOAD-SENSITIVE 隔离重跑从没做过
//     · 正控制直到我自己想起来才做
//   散文里写"强制"拦不住，序列固化才拦得住。
//   读数【正确性】另由脚本固化（manager-tick-readings.ts，现卡在待合的 15 条里）。

const READINGS_SCHEMA = {
  type: 'object',
  required: ['positiveControl', 'ac16', 'resources', 'liveness', 'progress', 'monitors', 'escalations'],
  properties: {
    positiveControl: {
      type: 'object',
      required: ['dayWindowCount', 'valid'],
      properties: {
        dayWindowCount: { type: 'integer', description: "git log --oneline --since='1 day ago' | wc -l" },
        valid: { type: 'boolean', description: '远大于 0 才算查询本身有效；false ⇒ 后续时间窗读数一律不可信' },
      },
    },
    ac16: {
      type: 'object',
      required: ['releaseTag', 'developAhead', 'filesHasPlugin'],
      properties: {
        releaseTag: { type: 'string' },
        developAhead: { type: 'integer' },
        filesHasPlugin: { type: 'boolean' },
        criterion3Evidence: { type: 'string', description: 'B/C 上 clone 的两份是否用 release 装出的 quay 跑通；无证据就写“无”' },
      },
    },
    resources: {
      type: 'object',
      required: ['cpuSomeAvg10', 'load1', 'nodeCount'],
      properties: {
        cpuSomeAvg10: { type: 'number' },
        cpuSomeAvg300: { type: 'number' },
        load1: { type: 'number' },
        nodeCount: { type: 'integer' },
        memAvailMb: { type: 'integer' },
        halted: { type: 'array', items: { type: 'string' }, description: '有 .halt 的项目名' },
      },
    },
    liveness: {
      type: 'array',
      description: '按窗口名寻址；报 pane_pid + pane_current_command，cmd=claude 才算认出会话',
      items: {
        type: 'object',
        required: ['target', 'state'],
        properties: {
          target: { type: 'string' },
          state: { type: 'string', enum: ['claude', '窗口在但非claude', '窗口不存在'] },
          panePid: { type: 'string' },
        },
      },
    },
    progress: {
      type: 'object',
      required: ['nonManagerCommits30m', 'latestOuterTickLine'],
      properties: {
        nonManagerCommits30m: { type: 'integer', description: "务必用全称 minutes；'30 min ago' 会静默返 0" },
        latestOuterTickLine: { type: 'string' },
        suiteState: { type: 'string' },
        divergence: { type: 'string', description: 'develop 独有 / integration 独有' },
      },
    },
    monitors: {
      type: 'array',
      description: '§1.4e：本会话临时 Monitor 是否真存活（进程本体 + 轮询子进程 etime 与间隔相符）',
      items: {
        type: 'object',
        required: ['id', 'alive'],
        properties: { id: { type: 'string' }, alive: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
    escalations: {
      type: 'object',
      description: '三项目 escalations.md 的条数',
      properties: { quay: { type: 'integer' }, archguard: { type: 'integer' }, metacc: { type: 'integer' } },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['trustworthy', 'suspects'],
  properties: {
    trustworthy: { type: 'boolean', description: '全部读数是否可直接用于判断' },
    suspects: {
      type: 'array',
      description: '可疑读数；空数组表示未发现问题',
      items: {
        type: 'object',
        required: ['field', 'why'],
        properties: {
          field: { type: 'string' },
          why: { type: 'string' },
          klass: { type: 'string', description: '静默零 / 陈旧数 / 读错文件 / 无条件echo / 管道后读$? / 截断当全貌' },
        },
      },
    },
  },
}

const ROOT = '/home/yale/work/quay'

phase('Read')
const readings = await agent(
  `你在 ${ROOT} 为管理者 tick 取一份机械读数。**只取数，不做判断、不改任何文件、不给建议。**

先读 ${ROOT}/orchestration/manager-loop-tick.md 的 §1-AC16 与 §1.a/§1.b/§1.c，按其中写死的巡检项取数
（那份文档是判据的唯一来源，不要凭常识替换它的口径）。

**强制顺序，第一步不许跳**：
1. 正控制先行：\`git log --oneline --since='1 day ago' | wc -l\`。它必须远大于 0。
   若为 0 ⇒ 查询本身坏了，把 positiveControl.valid 置 false，后续时间窗读数全部标记不可信。
2. 时间窗一律用全称（minutes / hours）。**\`--since='30 min ago'\` 会静默返 0 且不报错**
   （2026-08-07 实测：'60 min ago'→0 而 '60 minutes ago'→13），据此报过一次错误的"系统全停"。
3. AC16 三条**实跑**，不读文件里的旧数字。判据②的 plugin 清单要读**真交付物**
   \`plugin/.claude-plugin/plugin.json\`，**不是** \`milestones/*/worktrees/*\` 下的陈旧副本
   （读错那份曾连报 9 轮不存在的版本不一致）。
4. 会话身份用 \`tmux list-panes -a -F '#{pane_pid} #{pane_current_command}'\`，
   **不要用 \`pgrep -P ... | head -1\`**（取到的是任意子进程，实测是 MCP 服务器，不是 claude）。
5. 临时 Monitor 存活：用条件判断（\`if ps -eo args | grep -q '[模]式'\`），
   **绝不无条件 echo "有输出"**——2026-08-07 就这么误报过一次。
6. 要退出码就不要管道（管道后读 \$? 读到的是最后一个管道命令的）。

只读操作，不得写入或提交任何文件。返回结构化读数。`,
  { label: 'read', phase: 'Read', schema: READINGS_SCHEMA }
)

phase('Verify')
const verdict = await agent(
  `你在 ${ROOT} 做对抗复核。下面是管理者 tick 刚取的读数：

${JSON.stringify(readings, null, 2)}

**你的任务是尝试证伪它们，不是确认。** 逐条问：这个数字有没有可能是下列失效之一？

- **静默零**：查询写错与真的没发生不可区分（\`--since='N min ago'\`、grep 模式太窄、路径不存在）
- **陈旧数**：读的是文件里记的旧值而不是重跑判据；或读到了 worktree 里的陈旧副本
- **读错文件**：同名文件有多份（\`plugin.json\` 有 3 份，其一是 2026-08-01 停更的 milestone worktree 副本）
- **无条件 echo**：命令本身没输出，但脚本无条件打印了"有/在"
- **管道后读 \$?**、**截断显示当全貌**

对每条可疑读数，**自己实跑一条独立命令去核**（正控制优先：用一个已知非空的宽窗口验证查询本身）。
只读，不得写入。默认怀疑：拿不准就列进 suspects，宁可多列。
若全部可信，suspects 返回空数组。`,
  { label: 'verify', phase: 'Verify', schema: VERDICT_SCHEMA }
)

return { readings, verdict }
