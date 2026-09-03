// ════════════════════════════════════════════════════════════════════════════════
// ⛔ SUPERSEDED / 已退役工作流（gap-wiring-A-fan-in-execute-suite-poller-impl-complete, 2026-08-20）。
// 本文件零生产调用者（全库仅测试/同步引用）——生产 suite-fix 在 fan-in-execute.js 的内联 subagent
// prompt（suite-fix 阶段，读 /tmp/fan-in-suite-<task>.log 修根因）。本文件曾承载的两条修复语义已
// 全部并入 fan-in-execute.js 内联 prompt（照 gap-fix-scope-gate-wired-to-wrong-path 先例）：
//   ① gap-suite-fix-workflow-no-load-sensitive-branch → fan-in-execute.js 的 FIX_SCOPE_GATE 常量
//     （fix 前机械分诊 inScope/outOfScope：load-sensitive 释放、checker 误报与别任务 bug defer）；
//   ② gap-suite-fix-relaunch-stale-tmux-snapshot → fan-in-execute.js 的 SUITE_LAUNCH 块显式
//     `tmux-leak-scan.sh --snapshot ${worktree}`（launch/relaunch 前落新鲜 before-run 快照）。
// 保留本文件（未删除，避免 plugin/sync.sh dual-copy / workflows-dual-copy-drift-check / quay-init.sh
// 引用清理）——但【不再是任何修复的承载路径】：不要把它当成生产 suite-fix 路径接线任何新 gate。
// 原实现与测试不动（历史可查）。history：前身为 DEAD 标注（gap-fix-scope-gate-wired-to-wrong-path
// AC3, 2026-08-18），wiring 审计 A 任务升级为 SUPERSEDED。
// ════════════════════════════════════════════════════════════════════════════════
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
  task,                // OPTIONAL: 任务 id —— fix-scope gate 判「红是否本任务 Touches 内回归」用它读 tasks/<id>.md 的 ## Touches。缺省 ⇒ 无 Touches 作用域，只做 machine-partition（in_family/staticCheck）分诊
  maxRounds = 4,       // 真实红轮的最大迭代次数（每次=一轮全量，慢是接受的，不完整不可以）
  envMaxRuntimeMs = 7_200_000, // 120 min（manager 建议 ≥7200000；默认 45min 会截断最坏 77min 的轮次）
  envSilenceMs = 3_600_000,     // 60 min（默认 15min）
  envRedGraceMs = 180_000,      // 3 min（默认 30s；给红 suite 时间收集完整失败汇总）
  systemdRunLimits = "MemoryMax=4G TasksMax=200", // 人 2026-08-11 06:4x 裁定：取消 CPU 配额 + 保持内存 4G（01:07 OOM 护栏）+ TasksMax 200；gap-systemd-run-cancel-cpuquota-keep-memory-guardrail AC3。⛔ CPUQuota 已于 2026-08-16 移除——400% 是当年 4 核机的「等价不限制」字面值，换 16 核机后静默变成 4/16 核（硬规则④推论二），实测制造 CPU 饥饿假红（e2e/install 族 ~4-5x 慢 + 5 条超时失败，execute-suite-fix 69.6min vs 历史全 None 配额最坏 22.2min）。要表达「不限制」就在机制上不传该参数，不换成另一个字面值。
} = args ?? {}

if (!worktree || !stateDir || !root) {
  return { outcome: 'bad-args', message: 'worktree/stateDir/root are required', args }
}
// logFile is OPTIONAL (the runner defaults to <state-dir>/full-suite.log) — but the launch
// template below ALWAYS passes `--log-file ${resolvedLogFile}`, so an unset logFile would emit the literal
// `undefined` and the runner's path.resolve("undefined") would write the round log to ./undefined at
// the checkout root (bug: 2026-08-12 17:15, a 300KB round log landed in ./undefined). Default it here
// so the template never emits the undefined literal.
const resolvedLogFile = logFile ?? `${stateDir}/full-suite.log`

const launchEnv = `QUAY_TEST_SUITE_MAX_RUNTIME_MS=${envMaxRuntimeMs} QUAY_TEST_SUITE_SILENCE_MS=${envSilenceMs} QUAY_TEST_RED_GRACE_MS=${envRedGraceMs} QUAY_TEST_SYSTEMD_RUN_LIMITS='${systemdRunLimits}'`

// ⚠️ 启动必须 DETACH（实证 15:54:06→15:54:22, runId f6b824b5）：workflow subagent 里用
// `Bash(run_in_background:true)` 起的后台任务会在 subagent 退出时被 harness 连带杀掉（SIGTERM →
// onSignal → state=aborted, runner 死于 Fix agent 返回的同一秒）。detach（setsid + & + disown）
// 让 runner 活在独立 session，subagent 退出不影响它；等待仍由 workflow 脚本轮询 state.json 决定，
// 不违背「等待由脚本控制流决定」。subagent 侧只做：前台 Bash 跑这条（立即返回）+ 短促确认。
// gap-suite-fix-relaunch-stale-tmux-snapshot：relaunch 前【显式】生成 tmux-leak before-run 快照。
// 标准 SUITE_LAUNCH（fan-in-execute.js 的 `bash scripts/test.sh`）在 test.sh 的 FULL_SUITE_DEFAULT
// 分支内生成快照；本 relaunch 走 full-suite-runner.ts --root <worktree>（不 provision one-shot），
// 快照同样落在 <worktree>/.quay/tmux-leak-scan.snapshot。显式 --snapshot 把该保证搬到 workflow 层
// （不依赖 test.sh 深层分支），并在 launch 前落一份新鲜快照，覆盖 refresh-worktree-quay.sh 从 main
// checkout 拷进来的陈旧 .quay/tmux-leak-scan.snapshot（陈旧/缺失快照 ⇒ suite 收尾 --check
// fail-closed「no before-run snapshot」RED 的成因）。--snapshot 失败不阻断 launch（fail-open；
// --check 本身 fail-closed 兜底）。worktree 恒为真实 worktree（≠ main checkout）⇒ runner 不触发
// one-shot provisioning ⇒ <worktree>/.quay 快照路径与 test.sh 的 --check 一致。
const launchCmd = `cd ${root} && bash plugin/scripts/tmux-leak-scan.sh --snapshot ${worktree}; cd ${root} && ${launchEnv} setsid node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${worktree} --state-dir ${stateDir} --log-file ${resolvedLogFile} >/dev/null 2>&1 & disown; sleep 2; echo detached-pid=$!`

// ── 通用指令片段（发给每个 agent 的执行上下文，固定命令块，不靠探索）─────────────────
const CONTEXT = `
repo main checkout root: ${root}
verify worktree: ${worktree}   (frozen during a verification round — do NOT fast-forward/checkout/reset it mid-round)
LAUNCH (detached, survives subagent exit): ${launchCmd}
  — run this as a FOREGROUND Bash call (it returns immediately via &+disown); then poll state.json up to ~20s until state=running appears (短促确认), THEN return.
  — do NOT use Bash(run_in_background:true): a background task from a subagent is killed at subagent exit (实证 runId f6b824b5 died 16s after launch).
state file: ${stateDir}/full-suite-state.json  (script-owned polling reads this)
verification-round log: ${stateDir}/verification-round.jsonl
integration-batch-merge: cd ${root} && bash plugin/scripts/integration-batch-merge.sh --deliver  (DIR-123: --deliver launches develop-deliver-tgz.sh DETACHED after land closure — fresh .tgz to B/C + verify; best-effort, never blocks/fails the merge)
resource gate: cd ${root} && bash plugin/scripts/resource-gate.sh --for full-suite
FAILURES are ALL recorded in state.json's failures[] (MAX_RECORDED_FAILURES=200) + the archived log ${resolvedLogFile} — read EVERY failure line, never just the first.
`

// ── fix-scope gate（fix 前判定红是否本任务 Touches 内回归，gap-suite-fix-workflow-no-load-
//    sensitive-branch）──────────────────────────────────────────────────────────────────────
// suite-fix 曾是「红 ⇒ fix ALL failures + rerunning」的无分支路径，见啥修啥、越界到非 Touches
// 文件（4 次：inner-blocked-signal / outer-cron-registry / session-observation+tmux-leak-scan
// （load-sensitive 族）/ fan-in-ff-protocol-check（checker 跨任务误报））。本 gate 在 fix 前把
// failures[] 机械分诊为 inScope（本任务 Touches 内回归，修）vs outOfScope（越界红，defer）：
//   in_family    ⇒ load-sensitive ⇒ 释放（隔离重跑），不修；
//   staticCheck  ⇒ checker 误报 ⇒ defer 独立任务，不修；
//   file ∈ ## Touches ⇒ 本任务回归 ⇒ 修；file ∉ ## Touches（或无 file）⇒ 别任务 bug ⇒ defer，不修。
// 无 task（无 Touches 作用域）⇒ 只做 machine-partition（in_family/staticCheck），其余照修。
// gate 无法评估（task 文件/state.json 读失败）⇒ fail-closed：不修，全部 defer（硬规则 3b）。
const taskId = task ?? null
const touchesFile = taskId ? `${worktree}/tasks/${taskId}.md` : ''
const fixScopeGate = `【fix-scope gate —— fix 前必须先跑，得到 FIX_SCOPE_VERDICT 再动手修】
# fix-scope-gate-block-start
fix_scope_out=$(node --no-warnings --experimental-strip-types --input-type=module -e 'import fs from "node:fs";
import { parseTouches, matchGlob, normalizePath } from "${worktree}/plugin/scripts/touches-orthogonality-check.ts";
const taskFile = process.argv[1];
const stateFile = process.argv[2];
let globs = null;
try { const taskBody = fs.readFileSync(taskFile, "utf8"); const p = parseTouches(taskBody); if (p.hasSection) globs = p.globs; } catch (e) { globs = null; }
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const failures = Array.isArray(state.failures) ? state.failures : [];
const inScope = [];
const outOfScope = [];
for (const f of failures) {
  const file = f && f.file;
  if (f && f.in_family) { outOfScope.push({ file: file ?? null, reason: "load-sensitive" }); continue; }
  if (f && f.staticCheck) { outOfScope.push({ file: file ?? null, reason: "checker-misreport" }); continue; }
  if (!file) { outOfScope.push({ file: null, reason: "no-file" }); continue; }
  if (globs === null) { inScope.push(file); continue; }
  const within = globs.some((g) => matchGlob(normalizePath(g), normalizePath(file)));
  if (within) { inScope.push(file); } else { outOfScope.push({ file, reason: "other-task" }); }
}
process.stdout.write(JSON.stringify({ scoped: globs !== null, inScope, outOfScope }));' "${touchesFile}" "${stateDir}/full-suite-state.json" 2>&1) || { echo "FIX_SCOPE_NOT_EVALUATED=1"; fix_scope_out=""; }
echo "FIX_SCOPE_VERDICT=$fix_scope_out"
# fix-scope-gate-block-end
判定（读上面的 FIX_SCOPE_VERDICT JSON）：
- inScope 里的失败 = 本任务 Touches 内的回归 ⇒ 只修这些文件；禁止触碰 outOfScope 里列出的任何文件。
- outOfScope 里的失败 = 越界红，一律不修：
    * reason=load-sensitive（in_family）⇒ 释放：不修，隔离重跑确认（isolated rerun），结论写进 note。
    * reason=checker-misreport（staticCheck）⇒ defer：不修，note 里要求 defer 独立任务。
    * reason=other-task / no-file ⇒ 别任务 bug / 无文件归属：不修，note 里要求 defer 独立任务。
- FIX_SCOPE_NOT_EVALUATED=1 ⇒ fail-closed：本任务不修任何失败，全部 defer（无法评估 ≠ 合格）。
修完 inScope 后照常重跑全量 suite。返回的 failuresFixed 只列 inScope 修复；越界 defer 写进 note。`

phase('Fix')
const fix = await agent(
  `你是 A15 ④ suite-fix 链的 Fix 阶段。
${CONTEXT}
任务：
1. 读 ${stateDir}/full-suite-state.json 与 ${stateDir}/verification-round.jsonl 末尾：当前是否已有 suite 在跑（state=running）？上一轮红的话 failures[] 是什么？
${fixScopeGate}
2. 若上一轮是真实红轮（reason=failed 且 tests>=2900）：读【全部】failures[] 与归档日志，按上面的 fix-scope gate verdict 只修 inScope 里的失败（本任务 Touches 内回归），逐条诊断根因并修复，在 worktree 里 commit；outOfScope 的越界红一律不修（load-sensitive 释放 / checker 误报与别任务 bug defer 独立任务）。
3. 若上一轮是非验证终态（static-check/aborted/timeout/截断）：修掉阻塞它的东西（静态检查红先修静态检查；resource-gate WAIT/single-flight lock 则等待）。
4. 若上一轮为绿（state=green）：仍需在 worktree 启动一轮全量 suite，以产出 scope=worktree 的验证记录（batch-merge 闸的唯一数据源）。
5. 然后【启动】全量 suite：${launchCmd} —— 前台 Bash 跑（&+disown 立即返回），然后轮询 state.json 最多 ~20s 直到 state=running 出现（短促确认），再返回。禁止 Bash(run_in_background:true)。
6. 若 suite 已经在跑（state=running），直接返回，不重复启动。
返回 { launched: bool, runId, worktreeHead: 当前 worktree HEAD, failuresFixed: string[], note }。
不要做任何等待决策——等待由 workflow 脚本控制。`,
  { schema: { type: 'object', properties: { launched: { type: 'boolean' }, runId: { type: 'string' }, worktreeHead: { type: 'string' }, failuresFixed: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['launched', 'worktreeHead'] } }
)
log(`Fix done: launched=${fix.launched} head=${fix.worktreeHead} fixed=${(fix.failuresFixed ?? []).length} note=${fix.note ?? ''}`)

// ── 脚本控制流的等待：不把等待决策交给任何 agent ─────────────────────────────────
let lastState = null
let realRedCount = 0
let pollCount = 0  // bounded-poll safety (manager 02:4x: advance on process-exit, capped)

while (realRedCount <= maxRounds) {
  let s
  do {
    await new Promise((r) => setTimeout(r, 60_000))
    s = await agent(
      `Read ${stateDir}/full-suite-state.json and return its state, reason, scope, tests, runId, verifiedCommit, durationMs, pid. Do not infer — return exactly what the file says. If the file is missing, return {state:'missing'}.
      Also run: git -C ${worktree} rev-parse HEAD  (the worktree HEAD at this instant) and return it as worktreeHead.
      Also run: ps -p <pid> (if pid is present and non-null) to check whether the runner process is still alive — return processAlive as true/false.`,
      { schema: { type: 'object', properties: { state: { type: 'string' }, reason: { type: 'string' }, scope: { type: 'string' }, tests: { type: 'number' }, runId: { type: 'string' }, verifiedCommit: { type: 'string' }, durationMs: { type: 'number' }, pid: { type: 'number' }, processAlive: { type: 'boolean' }, worktreeHead: { type: 'string' } }, required: ['state'] } }
    )
    // ⚠️ ADVANCE CRITERION (manager 02:4x): advance only when the RUNNER PROCESS HAS EXITED, NOT when
    // state≠running. state=red is written WHILE the process is still alive (collecting all failures —
    // kill-on-red conditioning 5d69e21f + runner AC2 "mark RED immediately while run in progress").
    // Advancing on state≠running lets the next Fix agent edit the worktree while the previous round is
    // STILL collecting failures ⇒ failures[] crosses two tree states ⇒ wrong attribution (r265: Fix#2
    // started 8m16s before the runner exited). "Process exited" = durationMs present (terminal record
    // only written at exit) OR pid gone (ps -p returns non-zero / processAlive=false). This restores the
    // worktree-freeze rule ③'s INTENT: Fix must not touch a still-collecting round's tree.
    const processExited =
      (s.durationMs != null && s.durationMs > 0) ||
      (s.pid != null && s.processAlive === false)
    if (processExited) break
    // SAFETY (bounded polls): if the state file has neither durationMs nor pid (malformed/edge), do not
    // spin forever — cap at 2× the expected round length (~60min at 60s polls). The downstream
    // isNonVerificationTerminal/isRealRedRound classification still handles the state correctly; this
    // only bounds the wait when the exit signal is undetectable.
    if (++pollCount > 60) {
      log(`WARN: no process-exit signal after ${pollCount} polls (state=${s.state}) — advancing on state to avoid infinite wait`)
      break
    }
  } while (true)

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
1. reason=static-check：读 ${resolvedLogFile} 的静态检查失败详情（run_static_checks 阶段），修静态检查（不是绕过），然后重跑全量 suite。
2. reason=aborted 且是 resource-gate WAIT / single-flight lock：检查 "resource-gate.sh --for full-suite"，等它放行，然后重跑全量 suite。
3. 其它：读日志找阻塞根因，修掉，重跑全量 suite。
4. 启动全量 suite：${launchCmd} —— 前台 Bash 跑（&+disown 立即返回），然后轮询 state.json 最多 ~20s 直到 state=running（短促确认）再返回。禁止 Bash(run_in_background:true)。
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
1. 读 ${stateDir}/full-suite-state.json 的 failures[]（现在记录【全部】失败，最多 200 条）+ 归档日志 ${resolvedLogFile}，逐条列出失败，诊断每一条的根因。
${fixScopeGate}
2. 按上面的 fix-scope gate verdict：只修 inScope 里的失败（本任务 Touches 内回归），在 worktree 里 commit（一次提交可以含多个修复，但必须是真实的修复，不是删测试/改判据绕过）；outOfScope 的越界红一律不修（load-sensitive 释放 / checker 误报与别任务 bug defer 独立任务）。
3. 重跑全量 suite：${launchCmd} —— 前台 Bash 跑（&+disown 立即返回），然后轮询 state.json 最多 ~20s 直到 state=running（短促确认）再返回。禁止 Bash(run_in_background:true)。
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
2. worktree 清理（AC3 落地形式，gap-worktree-leak-after-fan-in-occupies-slot-permanently）：fan-in 合并后**实际执行** \`git -C ${root} worktree remove ${worktree} && git -C ${root} worktree prune\`——不是「验证已清理」，是执行清理；分支已合，只删工作副本，提交不丢。remove 失败（脏树）⇒ 标出未提交残留、不要 --force，写进 note 报出来。未清理 ⇒ 该 fan-in 不算完成（每合一个任务永久吃一槽）。
3. 验证 integration 干净。
4. batch-merge：把 develop 推到那个确切 verifiedCommit（${lastState.verifiedCommit}）——cd ${root} && bash plugin/scripts/integration-batch-merge.sh --deliver 的正确调用形式（--dry-run 先验证，再实际执行；--deliver 使 land closure 后自动投递新鲜 .tgz 到 B/C，best-effort 不阻塞 merge）。
5. 返回合并结果与最终 develop/integration HEAD。
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
