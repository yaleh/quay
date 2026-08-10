export const meta = {
  name: 'execute-suite-fix',
  description: 'A15 ④ suite-fix chain as a workflow: Fix(agent) → Verify(script-owned setTimeout poll of full-suite-state.json) → Merge(agent fan-in + batch-merge). Waiting is decided by script control flow, never by an agent (ab380c5e structural fix). Full suite only — no partial execution, no premature abort.',
  whenToUse: 'A15 ④ takeover (subagent exited without scope=worktree+green): outer dispatches this workflow to run the full suite, read ALL failures, fix, rerun until green, then fan-in + batch-merge. Also the normal suite-fix shape once subagent exits.',
  phases: [
    { title: 'Fix', detail: 'diagnose + fix root cause, commit in worktree, launch full suite with env overrides' },
    { title: 'Verify', detail: 'script-owned poll of full-suite-state.json every 60s until terminal' },
    { title: 'Merge', detail: 'fan-in + verify clean + batch-merge develop to verifiedCommit' },
  ],
}

// ══ 本文件的设计（人 2026-08-10 14:0x 裁定 + manager 15:3x 五闸枚举）═══════════════════
//
//  ab380c5e 静默悬挂根因 = 「诊断+等待」被塞进同一个 agent 的一轮对话；agent 自己判断
//  「要不要等、用什么机制等」，判断错了就悬挂。本 workflow 把等待搬进脚本控制流：
//  setTimeout + 轮询 agent 读 state.json，循环由脚本决定，不存在一个需要做等待决策的 agent。
//
//  manager 15:3x 五闸（.halt 接管期间必须完整跑 suite，禁止部分执行/提前中止）：
//    [1] SUITE_MAX_RUNTIME_MS 默认 45min —— 修好 kill-on-red 后轮次会跑完全程，最坏 77min
//        > 45min ⇒ 会被 reason=timeout 杀掉 ⇒ 接管期间必须 QUAY_TEST_SUITE_MAX_RUNTIME_MS ≥ 7200000。
//    [2] 静态检查红 = tests=0 —— 不是 suite 结果，是 suite 没跑 ⇒ 静态红先修再重跑全量。
//    [3] resource-gate WAIT / single-flight lock ⇒ 未跑即 abort ⇒ 等待并重跑，不计入迭代。
//    [4] scoped/--group/--for-task 不是验证信号 ⇒ 判绿只认全量。
//    [5] 不得自行发明提前退出（只跑失败文件/首败即停/按组当一轮/中途改树）。
//
//  验证轮判据（manager 15:3x 建议写进 A15 ④）：verification-round.jsonl 的记录满足其一才算
//  「一轮验证」：· tests ≥ 2900（main 主体真的跑了），或 · reason ∈ {static-check,aborted,timeout}
//  且明确标注「非验证轮，需重跑」，不计入迭代。本 workflow 的 Verify 轮询结果做同样分类。

// ── state.json 轮询 schema（每个 agent 只读这一个文件，返回判据字段）─────────────
const STATE_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['running', 'green', 'red'] },
    reason: { type: 'string' },
    scope: { type: 'string' },
    tests: { type: 'number' },
    runId: { type: 'string' },
    verifiedCommit: { type: 'string' },
  },
  required: ['state', 'reason', 'scope'],
}

// 判据：是否为「一轮验证」红轮（tests≥2900 的失败是真实红；否则是 suite 没跑完的非验证轮）
function isRealRedRound(s) {
  return s.state === 'red' && s.reason === 'failed' && (s.tests ?? 0) >= 2900
}

// 判据：是否为非验证终态（static-check / aborted / timeout / 其它 tests<2900 的截断）
function isNonVerificationTerminal(s) {
  if (s.state === 'green') return false
  return !isRealRedRound(s)
}

const {
  worktree,            // 被测 verify worktree（frozen during round）
  stateDir,            // main checkout 的 .quay（runner 写 state.json 到这里）
  logFile,             // main checkout 的 .quay/full-suite.log
  root,                // main checkout（plugin/scripts/full-suite-runner.ts + integration-batch-merge.sh 所在）
  maxRounds = 4,       // 真实红轮的最大迭代次数（每次=一轮全量，慢是接受的，不完整不可以）
  envMaxRuntimeMs = 7_200_000, // 120 min（manager 建议 ≥7200000；默认 45min 会截断最坏 77min 的轮次）
  envSilenceMs = 3_600_000,     // 60 min（默认 15min）
  envRedGraceMs = 180_000,      // 3 min（默认 30s；给红 suite 时间收集完整失败汇总）
} = args ?? {}

if (!worktree || !stateDir || !root) {
  return { outcome: 'bad-args', message: 'worktree/stateDir/root are required', args }
}

const launchEnv = `QUAY_TEST_SUITE_MAX_RUNTIME_MS=${envMaxRuntimeMs} QUAY_TEST_SUITE_SILENCE_MS=${envSilenceMs} QUAY_TEST_RED_GRACE_MS=${envRedGraceMs}`

// ── 通用指令片段（发给每个 agent 的执行上下文，固定命令块，不靠探索）─────────────────
const CONTEXT = `
repo main checkout root: ${root}
verify worktree: ${worktree}   (frozen during a verification round — do NOT fast-forward/checkout/reset it mid-round)
runner: cd ${root} && ${launchEnv} node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${worktree} --state-dir ${stateDir} --log-file ${logFile}
state file: ${stateDir}/full-suite-state.json  (script-owned polling reads this)
verification-round log: ${stateDir}/verification-round.jsonl
integration-batch-merge: cd ${root} && bash plugin/scripts/integration-batch-merge.sh
resource gate: cd ${root} && bash plugin/scripts/resource-gate.sh --for full-suite
FAILURES are ALL recorded in state.json's failures[] (MAX_RECORDED_FAILURES=200) + the archived log ${logFile} — read EVERY failure line, never just the first.
`

phase('Fix')
const fix = await agent(
  `你是 A15 ④ suite-fix 链的 Fix 阶段。
${CONTEXT}
任务：
1. 读 ${stateDir}/full-suite-state.json 与 ${stateDir}/verification-round.jsonl 末尾：当前是否已有 suite 在跑（state=running）？上一轮红的话 failures[] 是什么？
2. 若上一轮是真实红轮（reason=failed 且 tests>=2900）：读【全部】failures[] 与归档日志，逐条诊断根因并修复，在 worktree 里 commit。
3. 若上一轮是非验证终态（static-check/aborted/timeout/截断）：修掉阻塞它的东西（静态检查红先修静态检查；resource-gate WAIT/single-flight lock 则等待）。
4. 然后【启动】全量 suite：cd ${root} && ${launchEnv} node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${worktree} --state-dir ${stateDir} --log-file ${logFile}
   —— 用 Bash(run_in_background:true) 启动；启动后做一次短促确认（几秒内 state.json 出现 state=running 或 runId 更新）即返回，不要长等。
5. 若 suite 已经在跑（state=running），直接返回，不重复启动。
返回 { launched: bool, runId, worktreeHead: 当前 worktree HEAD, failuresFixed: string[], note }。
不要做任何等待决策——等待由 workflow 脚本控制。`,
  { schema: { type: 'object', properties: { launched: { type: 'boolean' }, runId: { type: 'string' }, worktreeHead: { type: 'string' }, failuresFixed: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['launched', 'worktreeHead'] } }
)
log(`Fix done: launched=${fix.launched} head=${fix.worktreeHead} fixed=${(fix.failuresFixed ?? []).length} note=${fix.note ?? ''}`)

// ── 脚本控制流的等待：不把等待决策交给任何 agent ─────────────────────────────────
let lastState = null
let realRedCount = 0

while (realRedCount <= maxRounds) {
  let s
  do {
    await new Promise((r) => setTimeout(r, 60_000))
    s = await agent(
      `Read ${stateDir}/full-suite-state.json and return its state, reason, scope, tests, runId, verifiedCommit. Do not infer — return exactly what the file says. If the file is missing, return {state:'missing'}.
      Also run: git -C ${worktree} rev-parse HEAD  (the worktree HEAD at this instant) and return it as worktreeHead.`,
      { schema: { type: 'object', properties: { state: { type: 'string' }, reason: { type: 'string' }, scope: { type: 'string' }, tests: { type: 'number' }, runId: { type: 'string' }, verifiedCommit: { type: 'string' }, worktreeHead: { type: 'string' } }, required: ['state'] } }
    )
  } while (s.state === 'running')

  lastState = s
  if (s.state === 'green') break

  if (isNonVerificationTerminal(s)) {
    // 非验证终态：suite 没跑完/没跑（static-check / aborted / timeout / 截断 / 门 WAIT）。
    // 不算迭代，修阻塞后重跑全量。这是「等待并重跑」，不是把截断当一轮验证。
    log(`Non-verification terminal: reason=${s.reason} tests=${s.tests ?? 0} — fixing blocker + rerunning full suite (not counted as an iteration)`)
    phase('Fix')
    await agent(
      `你是 A15 ④ suite-fix 链的 Fix 阶段。上一轮是【非验证终态】reason=${s.reason} tests=${s.tests ?? 0} —— 这不是 suite 跑完后的结果，是 suite 没跑完/没跑。
${CONTEXT}
任务：
1. reason=static-check：读 ${logFile} 的静态检查失败详情（run_static_checks 阶段），修静态检查（不是绕过），然后重跑全量 suite。
2. reason=aborted 且是 resource-gate WAIT / single-flight lock：检查 "resource-gate.sh --for full-suite"，等它放行，然后重跑全量 suite。
3. 其它：读日志找阻塞根因，修掉，重跑全量 suite。
4. 启动全量 suite：cd ${root} && ${launchEnv} node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${worktree} --state-dir ${stateDir} --log-file ${logFile}
   用 Bash(run_in_background:true) 启动；做短促确认（几秒内 state=running）即返回。
返回 { blocker: string, relaunched: bool }。不要做等待决策——等待由 workflow 脚本控制。`,
      { schema: { type: 'object', properties: { blocker: { type: 'string' }, relaunched: { type: 'boolean' } }, required: ['blocker', 'relaunched'] } }
    )
    continue
  }

  // 真实红轮（reason=failed 且 tests≥2900）：读全部失败，修，重跑。计入迭代。
  realRedCount++
  if (realRedCount > maxRounds) {
    log(`Real red round exceeded maxRounds=${maxRounds} — giving up, returning red`)
    break
  }
  log(`Real red round ${realRedCount}/${maxRounds}: tests=${s.tests} — fixing ALL failures + rerunning`)
  phase('Fix')
  await agent(
    `你是 A15 ④ suite-fix 链的 Fix 阶段。上一轮是真实红轮（reason=failed, tests=${s.tests}）。
${CONTEXT}
任务：
1. 读 ${stateDir}/full-suite-state.json 的 failures[]（现在记录【全部】失败，最多 200 条）+ 归档日志 ${logFile}，逐条列出失败，诊断每一条的根因。
2. 修复所有根因，在 worktree 里 commit（一次提交可以含多个修复，但必须是真实的修复，不是删测试/改判据绕过）。
3. 重跑全量 suite：cd ${root} && ${launchEnv} node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${worktree} --state-dir ${stateDir} --log-file ${logFile}
   用 Bash(run_in_background:true) 启动；做短促确认（几秒内 state=running）即返回。
返回 { failureCount, rootCauses: string[], relaunched: bool, worktreeHead, note }。
不要做任何等待决策——等待由 workflow 脚本控制。`,
    { schema: { type: 'object', properties: { failureCount: { type: 'number' }, rootCauses: { type: 'array', items: { type: 'string' } }, relaunched: { type: 'boolean' }, worktreeHead: { type: 'string' }, note: { type: 'string' } }, required: ['failureCount', 'relaunched'] } }
  )
}

if (!lastState || lastState.state !== 'green') {
  return { outcome: 'red', lastState, realRedCount, message: 'suite did not reach green', note: lastState?.reason === 'failed' && (lastState?.tests ?? 0) < 2900 ? 'last round was a non-verification terminal, not a real red' : '' }
}

// 冻结规则 ③ 检查：起跑时记 HEAD，终态前再读一次，不一致 ⇒ 该轮不算证据。
const freezeCheck = await agent(
  `run: git -C ${worktree} rev-parse HEAD  and read ${stateDir}/full-suite-state.json verifiedCommit.
Return { worktreeHeadNow, verifiedCommit }. The suite is green; if worktreeHeadNow !== verifiedCommit the round is a mixed-tree run (4402fee5/0960e00d class) and must NOT be trusted.`,
  { schema: { type: 'object', properties: { worktreeHeadNow: { type: 'string' }, verifiedCommit: { type: 'string' } }, required: ['worktreeHeadNow', 'verifiedCommit'] } }
)
if (freezeCheck.worktreeHeadNow !== freezeCheck.verifiedCommit) {
  return { outcome: 'infra-error', message: `worktree moved during round: head=${freezeCheck.worktreeHeadNow} verifiedCommit=${freezeCheck.verifiedCommit} — round is mixed-tree evidence, not trusted`, lastState }
}

phase('Merge')
const merge = await agent(
  `你是 A15 ④ suite-fix 链的 Merge 阶段。上一轮 suite 已 green（scope=worktree, state=green, verifiedCommit=${lastState.verifiedCommit}）。
${CONTEXT}
任务：
1. fan-in：把 verify worktree 的 branch（${worktree} 当前分支）合回 integration。冲突按「机械 union / per-hunk 判断」处置；不要用 --ours/--theirs 抹掉任何一方的真实内容。先 git reset --hard HEAD 清 staged/working-tree 残留（rebase-abort 残留纪律）。
2. 验证 integration 干净、worktree 已清理。
3. batch-merge：把 develop 推到那个确切 verifiedCommit（${lastState.verifiedCommit}）——cd ${root} && bash plugin/scripts/integration-batch-merge.sh 的正确调用形式（--dry-run 先验证，再实际执行）。
4. 返回合并结果与最终 develop/integration HEAD。
返回 { fanIn: string[], batchMergeOk: bool, developHead, integrationHead, note }。`,
  { schema: { type: 'object', properties: { fanIn: { type: 'array', items: { type: 'string' } }, batchMergeOk: { type: 'boolean' }, developHead: { type: 'string' }, integrationHead: { type: 'string' }, note: { type: 'string' } }, required: ['batchMergeOk'] } }
)
log(`Merge done: batchMergeOk=${merge.batchMergeOk} develop=${merge.developHead} integration=${merge.integrationHead} note=${merge.note ?? ''}`)

return {
  outcome: merge.batchMergeOk ? 'green' : 'merge-failed',
  lastState,
  merge,
  message: merge.batchMergeOk
    ? 'full suite green + batch-merged develop to verifiedCommit'
    : `suite green but batch-merge reported failure — inspect ${merge.note ?? ''}`,
}
