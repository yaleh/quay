export const meta = {
  name: 'manager-tick-readings',
  description: '管理者 tick 的不可约核：独立自我审计（读数与判读都已移出到主循环）',
  whenToUse: '每次 manager tick。主循环跑固定命令块取数(~1s)+自己判读，本 workflow 只做一件事：审计管理者自己',
  phases: [{ title: 'Audit', detail: '用 meta-cc 独立审计管理者本轮行为，含"判准有没有真被应用"' }],
}

// ── 成本实测（三轮，逐轮把瓶颈往下推一层）─────────────────────────────────────
//   轮1 探索式（agent 自己读文档找命令）：121 次工具调用，677s
//   轮2 固定命令块下发给 agent：            12 次工具调用，334s
//   轮3（本版）读数移出 workflow：          见下
//
//   轮2 拆解暴露了两个真瓶颈，都不是"调用次数"：
//   (a) **固定命令根本不该进 workflow**。同一批命令主循环直接跑 = 102ms～1.3s；
//       包进 agent = 46s。命令本身 1.7s 就返回了，多出来的 44s 全是
//       "读 prompt→决定跑什么→读结果→生成结构化输出"。固定命令不需要任何判断，
//       把最便宜的部分放进了最贵的容器里。
//   (b) **self-audit 的 222s 里，meta-cc 只占 27s，167s 是模型读完 14,715 字符
//       结果后的纯推理**。⇒ 驱动量是【返回结果的体积】，不是调用次数、不是 meta-cc 慢。
//       故本版对 meta-cc 查询强制 content_summary + 收紧 limit/preview_length。
//
// 人的框定（2026-08-07，三次纠正后定型）：
//   · workflow 结晶的是重复的 agent 行为序列——"哪一步不许跳"。
//   · subagent 不缺上下文：meta-cc 索引着管理者会话历史，它可以自己查。
//   · **tick workflow 本身就是快路径，职责是发现问题；深路径在 tick 里、workflow 外。**
//   · args 分工：高频/结构化/我已有的 ⇒ args 传；低频/需探查/我不一定记得的 ⇒ 让它自己查。
//     ⇒ 读数正是"我已有的"，必须走 args，不该让 subagent 重新去取。

const MODEL = 'sonnet'
const ROOT = '/home/yale/work/quay'
const MGR_SESSION = 'b8dc91a6-64e8-4d70-a715-9ec8e16a4f11'

// args 到达时是【字符串】不是对象（实测 wf_6f8cc053-f52），直接 args.x 会静默 undefined。
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args ?? {}) } catch { return {} } })()
const READINGS = A.readings || '(主循环未传入读数——这本身是缺陷，必须在提案里报出来)'
const PRIOR = A.prior ? `\n\n**上一轮读数（只报差异，不重述未变项）**：\n${A.prior}` : ''

// 主循环该跑的固定命令块（单一来源；改判据改这里，主循环照抄）。
// 本 workflow 不跑它——脚本层无 I/O 能力（探针 wf_af76a6df-2c3：globalThis 仅
// log/phase/budget/setTimeout/clearTimeout/agent/parallel/pipeline/workflow/args），
// 且即便能跑，包进 agent 也要 46s 而主循环只要 1.3s。
const READ_CMD = String.raw`cd /home/yale/work/quay
echo "PC=$(git log --oneline --since='1 day ago' | wc -l)"
lat=$(gh release view --json tagName -q .tagName 2>/dev/null); echo "release=$lat ahead=$(git rev-list --count $lat..develop 2>/dev/null)"
python3 -c "import json;d=json.load(open('packages/quay/package.json'));print('plugin_in_files='+str('plugin' in d.get('files',[])))"
python3 -c "import json;print('manifest='+json.load(open('plugin/.claude-plugin/plugin.json'))['version'])"
grep -o 'avg10=[0-9.]*' /proc/pressure/cpu | head -1; echo "load1=$(cut -d' ' -f1 /proc/loadavg) node=$(pgrep -c node)"
for p in quay archguard meta-cc; do [ -f /home/yale/work/$p/.halt ] && echo "halt:$p"; done
tmux list-panes -a -F '#{session_name}:#{window_name}=#{pane_current_command}' 2>/dev/null | grep quay-0 | tr '\n' ' '; echo
tail -40 orchestration/tick-log.md | grep -oE '^> \*\*[0-9]{2}:[0-9]{2}Z[^*]*\*\*' | tail -1
python3 -c "
import json,os,time
d=json.load(open('.quay/full-suite-state.json'))
print('suite=%s/%s age=%smin'%(d['state'],d.get('reason'),int(time.time()-os.path.getmtime('.quay/full-suite-state.json'))//60))"
git rev-list --left-right --count develop...integration | awk '{print "diverge="$1"/"$2}'
echo "commits30m=$(git log --oneline --all --since='30 minutes ago' | grep -vc '^[0-9a-f]* manager:')"
ps -eo args | grep -q '[q]uay-0:outer.0 -S -3' && echo mon_outer=alive || echo mon_outer=DEAD
ps -eo args | grep -q '[s]uite-state-trigger' && echo mon_suite=alive || echo mon_suite=DEAD`

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

// READ_CMD 是主循环该跑的固定命令块的单一来源；这里打出它的指纹，
// 让主循环能核对自己抄的那份有没有漂移（判据单一来源，不靠人记得同步）。
log(`READ_CMD 行数=${READ_CMD.trim().split('\n').length}`)

phase('Audit')
const audit = await agent(
    `你审计【管理者自己】最近这一轮的行为。用 meta-cc 查会话 \`${MGR_SESSION}\`
（deferred 工具，先 ToolSearch 取 schema：\`mcp__meta-cc__query_session_content\`）
加 \`git log --oneline --since='40 minutes ago' -- ${ROOT}\`。

**⚠️ 硬性预算（2026-08-07 实测教训：上一版此 agent 耗 222s，其中 meta-cc 只占 27s，
167s 是模型读完 14,715 字符结果后的纯推理——驱动量是【返回体积】不是调用次数）**：
- **最多 3 次工具调用**
- **meta-cc 查询必须带 \`content_summary: true\`、\`preview_length: 120\`、\`limit: 15\`**，
  绝不拉全文；宁可少看也不要把大段 transcript 读进来

只查这四条，逐条给证据（来自 meta-cc 或 git，不得是印象）：
1. **§1.b2 工具使用**：跨会话发消息用的是 \`plugin/scripts/send-keys-reliable.sh\`，还是手搓裸 \`tmux send-keys\`？
2. **§1.5 该做却问人**：有没有把**自己已经有答案**的事推给人决定？
3. **§0 边界回流**：有没有写任务体/AC/DoD、跑验证、替项目调试代码、直接改项目代码？
4. **§4 已知失效**：把印象当测量 / 管道后读 \$? / 零命中当没发生 / \`--since='N min ago'\` 静默零 / 无条件 echo。
5. **判准有没有被真的应用（本条 2026-08-07 新增，因为 judge 从 workflow 移到了主循环）**：
   管理者本轮的 tick-log 行里，异常判准是否被逐条应用过——尤其
   \`PC 有效性\` / \`suite age\` / \`mon_*=DEAD\` / \`同一事实两种读法是否一致\`。
   **judge 在 workflow 里时判准是被强制执行的；移出后就变回"记得应用"，
   而今晚已证明散文里的"强制"拦不住跳步** ⇒ 这条是那次移动的补偿性检查，不许略过。

同时列出本轮 workflow 之外的临时动作短名（moltenActions，供 tick-log 第六列计数）。
**没发现就返回空数组，不要凑数。**`,
    { label: 'self-audit', phase: 'Audit', schema: AUDIT_SCHEMA, model: MODEL }
)

return { audit }
