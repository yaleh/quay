export const meta = {
  name: 'manager-tick-readings',
  description: '管理者 tick 的快路径：固定命令块取数 + 自我审计 → 判读与提案（发现问题；深挖在 workflow 外）',
  whenToUse: '每次 manager tick 都跑。目标 ≤1 分钟——它是巡检，不是排查',
  phases: [
    { title: 'Gather', detail: '并行：一个固定命令块取全部读数 / 用 meta-cc 审计管理者自己' },
    { title: 'Judge', detail: '定向复核已知静默失效类 + 出动作提案' },
  ],
}

// 设计依据（人 2026-08-07 三次纠正，逐条记下来因为每条都推翻了我一个错误前提）：
//   ① workflow 结晶的是【重复的 agent 行为序列】——"哪一步不许跳"，不是多智能体扇出。
//   ② "判断需要我的上下文、不下放" 这个前提不成立：meta-cc 索引着管理者会话历史，
//      subagent 可以自己去查。所以判断类步骤同样下放。
//   ③ **tick workflow 本身就是快路径，它的职责是【发现问题】；深路径是 tick 里、workflow 外
//      的那部分**——发现之后的深挖由主循环做（熔态边缘）。
//      我曾把它写成探索式（每个 agent 自己读文档找命令）⇒ 121 次工具调用 ⇒ 十几分钟，
//      然后据此断言"workflow = 深路径"。**顺序反了：慢是写法的结果，不是它的性质。**
//
// 因此本文件的第一纪律：**每个 agent 拿到的是确切的命令块，不许自己发明命令。**
// 实测（探针 wf_af76a6df-2c3）：脚本层 globalThis 只有 log/phase/budget/setTimeout/
// clearTimeout/agent/parallel/pipeline/workflow/args —— 无 require/process/fetch，
// import() 在语法检查阶段即被拒 ⇒ 固定命令只能经 agent prompt 下发，不能在脚本层直接跑。

const MODEL = 'sonnet'   // 人 2026-08-07 裁定：先全部 sonnet
const ROOT = '/home/yale/work/quay'
const MGR_SESSION = 'b8dc91a6-64e8-4d70-a715-9ec8e16a4f11'

// args 分工（人确认）：高频/结构化/我已有的 ⇒ args 传；低频/需探查/我不一定记得的 ⇒ 让它自己用 meta-cc 查。
// 防御解析：args 到达时是【字符串】不是对象（实测 wf_6f8cc053-f52），直接 args.x 会静默 undefined。
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args ?? {}) } catch { return {} } })()
const PRIOR = A.prior ? `\n\n**上一轮读数（用于只报差异，不必重述未变项）**：\n${JSON.stringify(A.prior)}` : ''

// ── 固定命令块：这就是快路径的全部取数。改判据改这里，不改 prompt 叙述。 ──────────────
const READ_CMD = String.raw`cd ${ROOT}
echo "PC=$(git log --oneline --since='1 day ago' | wc -l)"
lat=$(gh release view --json tagName -q .tagName 2>/dev/null); echo "release=$lat ahead=$(git rev-list --count $lat..develop 2>/dev/null)"
python3 -c "import json;d=json.load(open('packages/quay/package.json'));print('plugin_in_files='+str('plugin' in d.get('files',[])))"
python3 -c "import json;print('manifest='+json.load(open('plugin/.claude-plugin/plugin.json'))['version'])"
grep -o 'avg10=[0-9.]*' /proc/pressure/cpu | head -1; echo "load1=$(cut -d' ' -f1 /proc/loadavg) node=$(pgrep -c node) mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
for p in quay archguard meta-cc; do [ -f /home/yale/work/$p/.halt ] && echo "halt:$p"; done
tmux list-panes -a -F '#{session_name}:#{window_name}=#{pane_current_command}' 2>/dev/null | grep quay-0 | tr '\n' ' '; echo
tail -40 orchestration/tick-log.md | grep -oE '^> \*\*[0-9]{2}:[0-9]{2}Z[^*]*\*\*' | tail -1
grep -m1 '^| 2026' orchestration/tick-log.md | cut -c1-90
python3 -c "
import json,os,time
d=json.load(open('.quay/full-suite-state.json'))
age=int(time.time()-os.path.getmtime('.quay/full-suite-state.json'))
print('suite=%s/%s dur=%ss age=%smin'%(d['state'],d.get('reason'),round(d.get('durationMs',0)/1000),age//60))"
git rev-list --left-right --count develop...integration | awk '{print "diverge="$1"/"$2}'
echo "commits30m_all=$(git log --oneline --all --since='30 minutes ago' | grep -vc '^[0-9a-f]* manager:')"
git log --oneline --all --since='30 minutes ago' | grep -v '^[0-9a-f]* manager:' | grep -iE 'done|fan-in|flip|task:' | head -4
if ps -eo args | grep -q '[q]uay-0:outer.0 -S -3'; then echo "mon_outer=alive"; else echo "mon_outer=DEAD"; fi
if ps -eo args | grep -q '[s]uite-state-trigger'; then echo "mon_suite=alive"; else echo "mon_suite=DEAD"; fi
for f in /home/yale/work/{quay,archguard,meta-cc}/orchestration/escalations.md; do [ -f "$f" ] && echo "esc_mtime $(basename $(dirname $(dirname $f)))=$(date -r $f +%m-%d) "; done`

const READ_SCHEMA = {
  type: 'object',
  required: ['raw', 'positiveControlValid', 'anomalies'],
  properties: {
    raw: { type: 'string', description: '命令块的原始输出，原样贴回' },
    positiveControlValid: { type: 'boolean', description: 'PC 远大于 0 才为 true；false ⇒ 后续时间窗读数不可信' },
    anomalies: {
      type: 'array',
      description: '相对上一轮或相对常识的异常（这是快路径的产出：发现问题，不是解释问题）',
      items: {
        type: 'object', required: ['what', 'evidence'],
        properties: {
          what: { type: 'string' },
          evidence: { type: 'string' },
          needsDeepDive: { type: 'boolean', description: 'true ⇒ 建议主循环在 workflow 外深挖' },
        },
      },
    },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['violations', 'moltenActions'],
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object', required: ['rule', 'evidence'],
        properties: { rule: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    moltenActions: { type: 'array', items: { type: 'string' } },
  },
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  required: ['actionClass', 'tickLogDraft', 'deepDiveCandidates'],
  properties: {
    actionClass: { type: 'string', enum: ['no-action', 'arbitrate', 'escalate', 'correct'] },
    tickLogDraft: { type: 'string', description: '第2-6列；第六列格式 熔｜<动作名> 或 熔｜-' },
    deepDiveCandidates: { type: 'array', items: { type: 'string' }, description: '交给主循环在 workflow 外深挖的' },
    toRelayToOuter: { type: 'array', items: { type: 'string' }, description: '已验证、直接送 outer（§1.5：不问要不要送）' },
    toEscalate: { type: 'array', items: { type: 'string' } },
  },
}

phase('Gather')
const [readings, audit] = await parallel([
  () => agent(
    `你在 ${ROOT} 为管理者 tick 取数。**只跑下面这一个命令块，原样跑，不要自己发明命令、不要逐条拆开跑、不要额外探查。**
（这是快路径，目标 ≤1 分钟；把 45 次工具往返压成 1 次正是本纪律的全部目的。）

\`\`\`bash
${READ_CMD}
\`\`\`

跑完把原始输出放进 raw，然后**只做一件判断：有没有异常**。
异常的判准（不是解释异常，只是标出来）：
- \`PC\` 不远大于 0 ⇒ 查询本身坏了，positiveControlValid=false
- \`suite age\` 很大却仍被当现状引用 / \`mon_*=DEAD\` / \`halt:\` 出现在不该暂停的项目
- \`ahead\`、\`diverge\`、\`commits30m_all\` 与上一轮相比出现突变
- \`esc_mtime\` 多日未变（⇒ 该计数是噪声，不是信号）
- 两种格式的 outer tick 行时刻不一致（⇒ 其中一种读法已失效）${PRIOR}

**判不准的一律标 needsDeepDive=true 交出去，不要自己在这里深挖**——深挖是 workflow 外的事。`,
    { label: 'readings', phase: 'Gather', schema: READ_SCHEMA, model: MODEL }
  ),
  () => agent(
    `你审计【管理者自己】最近这一轮的行为。**用 meta-cc 查会话 \`${MGR_SESSION}\`**
（deferred 工具，先 ToolSearch 取 schema：\`mcp__meta-cc__query_session_content\`），
加 \`git log --oneline --since='40 minutes ago' -- ${ROOT}\`。**最多 4 次工具调用，够用即止。**

只查这四条，逐条给证据（来自 meta-cc 或 git，不得是印象）：
1. **§1.b2 工具使用**：跨会话发消息用的是 \`plugin/scripts/send-keys-reliable.sh\`，还是手搓裸 \`tmux send-keys\`？
2. **§1.5 该做却问人**：有没有把**自己已经有答案**的事推给人决定？
   （实例：已验证"批量合结构性跑不了"却问人"要不要提醒 outer"。）
3. **§0 边界回流**：有没有写任务体/AC/DoD、跑验证、替项目调试代码、直接改项目代码？
4. **§4 已知失效**：有没有重犯——把印象当测量 / 管道后读 \$? / 零命中当没发生 /
   \`--since='N min ago'\` 静默零 / 无条件 echo？

同时列出本轮骨架之外的临时动作短名（moltenActions，供 tick-log 第六列计数）。
**没发现就返回空数组，不要凑数。**`,
    { label: 'self-audit', phase: 'Gather', schema: AUDIT_SCHEMA, model: MODEL }
  ),
])

phase('Judge')
const proposal = await agent(
  `你为管理者 tick 出动作提案。**你提案，不裁定**——范围/优先级/资源裁定归人与主循环（§1.5）。
**最多 3 次工具调用**：只针对下面标了 needsDeepDive 的项做**定向**复核，不做开放探查。

读数：${JSON.stringify(readings)}
自审：${JSON.stringify(audit)}

定向复核只查这几类已知静默失效（其余一律相信读数）：
零命中当没发生 / 陈旧数被当现状 / 读错同名文件 / 无条件 echo / 管道后读 \$?。

规则：
- 动作类四选一：\`no-action\` / \`arbitrate\`（动了 .halt 或次序）/ \`escalate\`（攒给人）/
  \`correct\`（纠正外层的**做法**，不能是它的任务内容）。**audit.violations 非空 ⇒ \`correct\`**（对象是我自己）。
- **下"零推进"结论前必须确认 positiveControlValid 为 true**（2026-08-07 因此误报过一次全停）。
- **深挖不在这里做**：把该深挖的放进 deepDiveCandidates，交主循环在 workflow 外处理。
- tickLogDraft 写第 2-6 列，第六列 \`熔｜<动作名>\` 取自 audit.moltenActions，无则 \`熔｜-\`。`,
  { label: 'judge', phase: 'Judge', schema: PROPOSAL_SCHEMA, model: MODEL }
)

return { readings, audit, proposal }
