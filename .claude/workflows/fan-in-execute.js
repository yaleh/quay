export const meta = {
  name: 'fan-in-execute',
  description: 'AC78 fan-in 执行 workflow — 无锁段（merge develop → delta 断言面判定 → ts-typecheck → scoped 门+全量+doc）与持锁段（flip done → fan-in-ff-merge.sh）由本脚本生成的自足 subagent prompt 全权执行；subagent 在 ff 成功后才返回。A6 只检查「是否走了本 workflow」（判据2 (a)(b)(c)）。',
  whenToUse: 'inner 对某任务执行 fan-in 时（A6）：以 scriptPath 调用本 workflow，args={task, worktree, root, runId, mergeTarget}。禁止 name:（M176 陷阱：同会话第二次 name: 派发可能取旧脚本体）。',
  phases: [{ title: 'FanIn', detail: 'subagent 自足执行无锁段 + 持锁段，ff 成功后才返回' }],
}

// ══ 本文件的设计（AC78 判据1/判据5/判据6，tasks/gap-ac78-fan-in-workflow-a6-check）══════════
//
//  ① fan-in 四步正身（git merge develop → delta 断言面判定/全量 suite → doc 检查 → flip done +
//     fan-in-ff-merge.sh）从 A6 的「步骤清单」迁入本脚本的 subagent prompt。A6 只留检查。
//  ② 判据5（/clear 稳定性）：模板文本、参数来源、调用方式全部落盘于本脚本；subagent 需要的一切
//     （task/worktree/root/runId/mergeTarget）都由调用方经 args 传入，或由 subagent 自己定位
//     （agent 标识）。逐项问「/clear 之后这一项还在吗」——脚本在盘上、args 由调用方给，皆在。
//  ③ 判据6（prompt 自足）：prompt 不引用「协调者说/见上文/上一条消息」——所有上下文逐字内联。
//     凡需 subagent 自身标识（--agent-id），prompt 写成【让它自己去找】的指令
//     （定位 subagents/agent-<自己>.jsonl），不由调用方填值、不给可误抄的示例值。
//  ④ 弱判据（SPEC-fan-in-ff-merge-lock-2026-08-14 §1-§7 实现）：本脚本即 SPEC 的实现；改本脚本的
//     提交必须在提交信息点名对应 SPEC 节。
//
//  脚本层能力边界（同 manager-tick-core.js 实测）：globalThis 仅 log/phase/budget/setTimeout/
//  clearTimeout/agent/parallel/pipeline/workflow/args；无 require/process/fetch；import() 语法
//  检查即拒；export 仅允许 meta。⇒ 本脚本零 I/O，固定命令由 subagent 执行。
//
//  ⚠️ 改本文件后的验证：必须实际调用一次 Workflow（scriptPath），不要拿 node --check 当通过
//     （2026-08-07 21:5x 实测：未转义反引号让 node --check 通过而 Workflow 解析器报错）。
//     模板串内【不要用反引号】（统一用 $(...)），避免提前终止模板串。

// args 到达时是【字符串】不是对象（实测 wf_6f8cc053-f52）：直接 args.x 会静默 undefined。
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args ?? {}) } catch { return {} } })()
const task = A.task
const worktree = A.worktree
const root = A.root
const runId = A.runId ?? ''
const mergeTarget = A.mergeTarget ?? 'develop'

if (!task || !worktree || !root) {
  return { outcome: 'bad-args', message: 'task / worktree / root are required', args }
}

phase('FanIn')
const result = await agent(
  `你是 fan-in 执行 subagent。任务 ${task} 的 fan-in 由你在自己的回合内完整执行（无锁段+持锁段全在自回合内，ff 成功后才返回）。以下所有上下文已逐字内联，不需要询问任何人，也不要引用「上一条消息」。

执行上下文（你直接使用，无需探查）：
- 任务 worktree（你的工作目录，所有代码操作都在这里）：${worktree}
- 主检出（develop / merge target 所在的 checkout，fan-in-ff-merge.sh 的 --root）：${root}
- merge target（ff 目标分支）：${mergeTarget}
- runId：${runId ? runId : '（无，ff 时省略 --run-id）'}

步骤（严格按序；每步都先 cd ${worktree} 或显式用 -C）：

【无锁段 step 1 — merge develop】
cd ${worktree} && git merge ${mergeTarget}
—— 冲突【只可能在这】出现：慢慢解，不占任何人（AC75：必须 merge 不得 rebase）。解完 git add + git commit。

【无锁段 step 2 — delta 断言面判定（AC75）】
fork=$(git -C ${worktree} merge-base ${mergeTarget} HEAD)
delta=$(git -C ${worktree} diff --name-only "$fork" ${mergeTarget} 2>/dev/null || true)
code_delta=$(printf '%s\n' "$delta" | grep -vE '^tasks/|^docs/|^[.]quay/|^plugin/loop/|^measurements/|^milestones/|^orchestration/archive/|[.]md$' | grep -v '^$' || true)
判定：
  - code_delta 非空 ⇒ develop 的 delta 触及代码/脚本/测试断言面 ⇒ 本回合【要】重跑全量 suite。
  - code_delta 为空且 delta 非空 ⇒ delta 全落 doc/任务体/telemetry 面 ⇒ 跳过全量 suite（只跑 doc 检查）。
  - 无法判定（git merge-base 失败 / delta 取不到）⇒ fail-closed：重跑全量 suite（硬规则 3b：判不出≠不需要）。
把 code_delta 记下来（返回时上报）。

【无锁段 step 3 — ts-typecheck 闸】
cd ${worktree} && node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}
  —— 闸自己判定 Touches 是否含新增/移动 .ts（无则直接 exit 0）。exit 非 0 ⇒ 丢弃 worktree 内未合状态、
     标 needs-human、停止本 tick 合并与派发——不要继续 ff。

【无锁段 step 4 — scoped 门 + （按 step 2 判定）全量 suite + doc 检查】
cd ${worktree} && bash scripts/test.sh --for-task ${task} --allow-thin
  —— scoped 门，必须绿；非绿 ⇒ 修到绿再继续。
if [ step 2 判定要重跑全量 ]; then cd ${worktree} && bash scripts/test.sh; fi
  —— 全量 suite，只在 delta 触及断言面时跑（或判不出时 fail-closed 跑）。
cd ${worktree} && bash scripts/test.sh --static-checks-doc
  —— doc 检查（ff 不触发任何钩子，AC63）；必须绿。
—— scoped 门 / 全量 / doc 任一非绿 ⇒ 修复并重跑对应项；全绿才进持锁段。

【持锁段 step 5 — flip done + ff-merge】
cd ${worktree}
sed -i 's/^status: ready/status: done/' tasks/${task}.md
git add tasks/${task}.md && git commit -m "tasks: 翻 ${task} done（AC78 fan-in-execute workflow）"
—— 先 flip 后 merge（人 2026-08-14 裁定：flip 要动的记录也用 git 跟踪；flip 在后则 merge 后还要再修改+merge）。
# 自找你的 agent 标识（判据6：不由调用方填值、不给示例值）——定位你自己的 transcript：
#   此刻正在被写入的 subagents/agent-<自己>.jsonl = 最近修改 + 内容提到本任务的那个。
self=$(ls -t ~/.claude/projects/*/subagents/agent-*.jsonl 2>/dev/null | while read f; do grep -l '${task}' "$f" 2>/dev/null; done | head -1)
agent_id=$(basename "$self" .jsonl 2>/dev/null | sed 's/^agent-//')
if [ -z "$agent_id" ]; then echo "FATAL: 未能定位自身 subagents/agent-<自己>.jsonl（--agent-id 不能由调用方填）" >&2; exit 2; fi
bash ${root}/plugin/scripts/fan-in-ff-merge.sh --task ${task} --run-id ${runId} --agent-id "$agent_id" --root ${root} --merge-target ${mergeTarget}
  —— 锁只包 git merge --ff-only，毫秒级，成/败都解锁。ff 失败（develop 前进了）⇒ 回 step 1 重跑
     （重 merge develop、重判 delta、重跑 suite、重 ff），同一任务 ff 失败 ≥3 次才谈防活锁。
ff 成功后清理：cd ${root} && git worktree remove ${worktree} --force && git branch -d task/${task}

返回 { outcome: 'green' | 'needs-human' | 'red', ffOk, developHead, worktreeHead, agentIdUsed, codeDelta, note }。
outcome=green 仅当 ff 成功（develop fast-forward 到 task tip）。needs-human 仅当冲突解不了/选中集非绿/ts-typecheck 阻断。red = 其它失败。`,
  {
    schema: {
      type: 'object',
      properties: {
        outcome: { type: 'string' },
        ffOk: { type: 'boolean' },
        developHead: { type: 'string' },
        worktreeHead: { type: 'string' },
        agentIdUsed: { type: 'string' },
        codeDelta: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['outcome', 'ffOk'],
    },
  }
)
log(`FanIn done: outcome=${result.outcome} ffOk=${result.ffOk} agent=${result.agentIdUsed ?? '?'} develop=${result.developHead ?? '?'}`)

return {
  outcome: result.outcome === 'green' ? 'green' : result.outcome === 'needs-human' ? 'needs-human' : 'red',
  ffOk: result.ffOk,
  task,
  message: result.ffOk
    ? `fan-in landed for ${task} (via 'fan-in-execute' workflow)`
    : `fan-in did not land for ${task}: ${result.note ?? 'unknown'}`,
}
