export const meta = {
  name: 'fan-in-execute',
  description: 'AC78 fan-in 执行 workflow — 无锁段（merge develop → delta 断言面判定 → ts-typecheck → scoped 门+全量+doc）与持锁段（flip done → fan-in-ff-merge.sh）由本脚本生成的 subagent prompt 全权执行；全量 suite 的【等待】由阶段 2 agent 在本回合内多次 <600s Bash 循环承担（gap-subagent-turn-budget-13min-falsified：已证伪「subagent 回合预算硬超时」，真实限制仅 Bash 单次 600s 硬顶 + suite 实测 19+ min）；subagent 在 ff 成功后才返回。A6 只检查「是否走了本 workflow」（判据2 (a)(b)(c)）。gap-adr034-fan-in-lock-holder-supervised：fan-in 锁已收进 driver（worker-driver.ts acquireFanInLock 非分离 holder，随 driver 死自动释放）；本 workflow 不再持该锁（分离 holder + flag 释放协议已废除），ff-race 防护在机械 fan-in（driver）路径由 driver 持锁提供。gap-fan-in-driver-mechanical-orchestration：本 workflow 退役为【机械 fan-in 失败时的语义兜底】（happy-path primary = worker-driver.ts runMechanicalFanIn 机械驱动锁/merge/delta/typecheck/scoped门/suite/ff；机械失败 ⇒ 任务 exited-not-landed、worktree 保留，续做 prompt 以 scriptPath 调本 workflow 兜底）。',
  whenToUse: 'inner 对某任务执行 fan-in 时（A6）：以 scriptPath 调用本 workflow，args={task, worktree, root, runId, mergeTarget}。禁止 name:（M176 陷阱：同会话第二次 name: 派发可能取旧脚本体）。',
  phases: [{ title: 'FanIn', detail: '阶段1（预备+启动 detached suite，立即返回）→ 阶段2 agent 回合内循环 <600s Bash 等 suite →（红则 Fix agent 重启动）→ 入账+flip+ff+bracket，ff 成功后才返回' }],
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
//  ⑤ bracket-close（gap-fan-in-auto-close-telemetry-bracket）：step 5.5 在 ff 成功后、清理前关闭本任务的
//     telemetry bracket（closure-lag-check.sh --close-task，A16 统一闭合点，写 --task-end done）。只按
//     --taskId 关【本任务】的 bracket（inProgress[] 按 taskId 定位 runId），绝不 --reconcile 全局扫——判据2
//     能取假：在飞任务/未 land 任务的 bracket 必须保留。ff 失败 ⇒ 不执行 5.5。改本块必须同步
//     plugin/test/fan-in-execute-paths.test.mjs 的 bracket-close 组测试（真实 bash 闭 bracket + 在飞保留）。
//  ⑥ 自举（gap-fan-in-orchestration-bootstrap-self-fix）：fan-in 编排文件的调用一律从【任务 worktree】
//     解析（step 0 自举判定 + 各步 ${worktree} 前缀），不再 cwd 依赖、不再 ${root}——本任务若修改了
//     编排文件本身（fan-in-execute.js / select-static-checks-for-touches.ts / fan-in-ff-merge.sh /
//     per-task-suite-record.ts / full-suite-runner.ts），其 fan-in 必须用自己的修复被验证（取假一/取假二
//     钉在 plugin/test/fan-in-execute-paths.test.mjs）。step 0 命中时 echo FAN-IN-BOOTSTRAP=hit，且若
//     root 与 worktree 的 fan-in-execute.js 不一致（本次派发没用 worktree 版 scriptPath）echo WARN——
//     结构性缺口仍在。⑥b 自举同步（gap-bootstrap-worktree-stale-fan-in-execute）：worktree fork 可能早于
//     编排修复 land ⇒ 其 fan-in-execute.js/编排脚本陈旧。step 0 命中时【merge develop 前】先跑
//     select-static-checks-for-touches.ts --bootstrap-sync（A6 派发侧也先跑同一同步），把最新 develop
//     编排修复合入 worktree（保留本分支修改）——陈旧 worktree 的派发-time scriptPath 也被修到最新。
//     改本文件必须同步 plugin/workflows/fan-in-execute.js（双拷贝，workflows-dual-copy-
//     drift-check）与 A6 派发规则（fast-mode-tick-core.md：命中 ⇒ 先同步再以 worktree 版 scriptPath 派发）。
//  ⑦ suite 等待（gap-fan-in-turn-budget-suite-timeout 的 2026-08-20 证伪 → gap-subagent-turn-budget-
//     13min-falsified）：旧设计假设「subagent 有 ~10-13min 回合预算硬超时」⇒ 全量 suite ~14-25min 等
//     不完 ⇒ 把等待搬到脚本控制流（setTimeout + 每轮起一个新短命轮询 agent）。该前提已被证伪：①inner
//     (2b140e8a) 29 个直属 subagent 15 个 >10min、14 个 >13min、最长 38.7min，正常完成非截断；②官方
//     无 subagent 整体超时，真实硬顶只有 Bash 单次 600s（GitHub #61405）；③本仓库两份「~13min 实证」
//     打开后都不是超时（wf_c6f4d0ef-c6a 13.6min 正常完成 / wf_1072dc43-893 user interrupted）。
//     ⇒ 真实约束 = 全量 suite 实测 19+ min > Bash 单次 600s 硬顶 ⇒ 需要【跨多次 <600s Bash 调用】等待，
//     【不需要】每轮起一个新 agent。修复 = 【单个阶段 2 agent】在本回合内循环多次 <600s Bash 等 suite
//     （有界阻塞等待 timeout ${pollBlockSeconds} + sleep ${pollBlockSleep}，最多 ${maxSuitePolls} 次），
//     suite 绿后执行机械步骤；suite 红 ⇒ 返回 suite-red，脚本派 Fix agent 重启动 detached suite 后重派
//     阶段 2。detached（setsid+&+disown）仍成立（suite 生命周期不依赖 subagent）。证伪说明唯一保留处 =
//     tasks/gap-fan-in-turn-budget-suite-timeout.md「2026-08-20 证伪」。
//     阶段划分：
//       阶段 1（agent #1）：step 0-4 预备（merge/delta/typecheck/scoped/doc）+ 启动 detached suite +
//           写 pre-suite capture → 立即返回（outcome=suite-started / skipped / preverified）。
//       阶段 2（agent #2）：本回合内循环 <600s Bash 等 suite（最多 ${maxSuitePolls} 次，有界阻塞等待
//           timeout ${pollBlockSeconds} + sleep ${pollBlockSleep}）→ 补全 capture post 字段 → suite 绿则
//           机械步骤（step 4.5 入账 + step 5 flip+ff + step 5.5 bracket）；suite 红 ⇒ 返回
//           { outcome:'suite-red', suiteExit }（不执行机械步骤，脚本派 Fix agent）。
//       红 suite ⇒ Fix agent（读日志 → 修 → 重新启动 detached）→ 脚本再派阶段 2（有界 maxFixRounds）。
//       其中非 load-sensitive「other-task defer → 全量 relaunch」另有 defer 侧 anti-livelock 上限
//       （有界 maxDeferRelaunches，gap-fan-in-relaunch-retry-cap：确定性失败重跑零信息，连续纯 defer
//       ≥3 轮 ⇒ escalate → needs-human / 交 outer；与 releaseLivelockRounds / maxFfRetries 互补不冲突）。
//       ff 失败（develop 前进，窗口 = merge 到 ff 之间的整个 suite 时长）⇒ 回阶段 1 重跑
//       （有界 maxFfRetries，同 SPEC §7 防活锁阈值；阶段 1 首步 revert 上次 ff 失败遗留的 done 翻转）。
//     ⛔ 禁止 Bash(run_in_background:true)（subagent 退出被 harness 连带杀，execute-suite-fix.js
//        实证 runId f6b824b5）；⛔ 禁止前台 bash scripts/test.sh（suite 19+ min > Bash 单次 600s 硬顶）。
//     取假（plugin/test/fan-in-execute-paths.test.mjs）：构造 step2 code_delta 非空 ⇒ 阶段 1 启动
//     detached suite（setsid+&+disown）且立即返回；阶段 2 agent 的等待块循环 <600s Bash 到 suite 绿 ⇒
//     机械步骤（flip/ff/bracket）全执行。等待由阶段 2 agent 承担，脚本不派短命轮询 agent。
//  ⑩ 启动 suite 的 single-flight 锁等待（gap-single-flight-lock-timeout-double-value）：test.sh 原
//     FULL_SUITE_LOCK_TIMEOUT 默认 600 + 本文件 900 覆盖是同一把锁的两套值，且 600s 线已被常态化的
//     819-1619s full-bucket suite 跨越 ⇒ 活 suite 被 fail-closed「not starting」误杀 + 重试放大。修法：
//     test.sh 的锁等待改为【无界排队】（flock crash-autorelease 保证死持有者不泄漏槽；活卡死持有者由
//     跨 relaunch stuck-holder reaper + full-suite-runner 的 silence/max-runtime 兜底），本文件不再经 env
//     传 FULL_SUITE_LOCK_TIMEOUT（无双值、无 900 字面量）。改本块必须同步
//     plugin/test/fan-in-execute-paths.test.mjs 的锁等待负控制组（suite-launch 不带
//     FULL_SUITE_LOCK_TIMEOUT + REAL 槽忙→释放后获取而非 fail-closed）。ff 的 merge 锁（--lock-wait
//     ${mergeLockWaitSecs}s）是独立正确性锁（毫秒级 hold），与 suite 资源锁无关。
//  ⑪ 跨 relaunch 锁持有者卡死/失联检测（gap-suite-lock-holder-stuck-detection）：relaunch 前读上一轮
//     pidfile（`pid started_ms`）——上一轮 suite 在 relaunch 时刻【应已死亡】；若 pid 仍存活 ⇒ 卡死（hung
//     进程占着 single-flight 槽，flock 只在进程退出时自动释放、hung 永不退出）⇒ 跨 relaunch 无限持有。
//     单次 SUITE_MAX_RUNTIME_MS(45min)/SUITE_SILENCE_MS(15min) 在 full-suite-runner.ts（管不到本 detached
//     直跑路径），且每次 relaunch 新起进程、单次超时重置——本块专补「跨 relaunch 循环」这一半（在 relaunch
//     边界评估）。存活且持有 ≥ ${stuckHolderGraceSecs}s ⇒ SIGKILL 整进程组释放槽 + 告警（谁/多久/动作）。
//     改本块必须同步 plugin/test/fan-in-execute-paths.test.mjs 的 stuck-holder 组测试。
//
//  脚本层能力边界（同 manager-tick-core.js 实测）：globalThis 仅 log/phase/budget/setTimeout/
//  clearTimeout/agent/parallel/pipeline/workflow/args；无 require/process/fetch；import() 语法
//  检查即拒；export 仅允许 meta。⇒ 本脚本零 I/O，固定命令由 subagent 执行。
//
//  ⚠️ 改本文件后的验证：必须实际调用一次 Workflow（scriptPath），不要拿 node --check 当通过
//     （2026-08-07 21:5x 实测：未转义反引号让 node --check 通过而 Workflow 解析器报错）。
//     模板串内【不要用反引号】（统一用 $(...)），避免提前终止模板串。
//     模板串内 bash 的 printf 格式串要用 \\n（双反斜杠）——写 `\n` 会被 JS 展开成真换行，
//     发出的 prompt 里 bash 行断裂（2026-08-14 由 fan-in-execute-paths.test.mjs 首次实测捕到：
//     `printf '%s\n'` 在 prompt 里断成两行）。反引号 + \n 都是「模板字面量陷阱」。
//  ⚠️ 三条承重点（gap-fan-in-execute-three-unverified-paths）+ AC 完成闸（gap-fan-in-flip-no-
//     ac-completion-check）的真实路径测试 = plugin/test/fan-in-execute-paths.test.mjs：vm 实执行
//     本脚本（捕 prompt）+ 真实执行其发出的 bash（① code_delta 正则 / ② 自找 --agent-id /
//     ③ flip sed fail-closed / ④ flip AC 完成闸：未全勾不翻、全勾翻、段缺失 NOT-EVALUATED）。
//     改任一处必须同步那组测试。
//  ⚠️ per-task-suite 入账（gap-fan-in-suite-data-not-accounted）：step 4 的 # suite-capture-block
//     捕获 suite 起止/CPU（GNU time）/判定到 /tmp 临时 env；step 4.5 全绿后 # suite-record-block 写
//     per-task-suite-record（plugin/scripts/per-task-suite-record.ts）——含跳过全量（fullSuiteRan=
//     false + skipReason=doc-only-delta，判据2 能取假），写失败 HARD FAIL（AC1 判据1 义务）。
//  ⚠️ verification-round 入账（gap-fan-in-red-bucket-run-not-recorded，人裁定「定义正确机制并实现」）：
//     本 fan-in 桶路径改走 full-suite-runner.ts --buckets（SUITE_LAUNCH 里的 detached 形态），runner 是
//     verification-round.jsonl / full-suite-state.json / measure-history.jsonl / suite-load-<runId>.jsonl
//     的唯一 writer——green 与 red 都入账（旧的 `setsid bash scripts/test.sh` 平行 harness + pre-verified-
//     round-record 只认 green 的窄 writer 已删除，两套平行机制收敛为一）。red 桶轮次在 suite 退出时由
//     runner 直接记 state=red 进 verification-round.jsonl（/tests 趋势账本），不再只在 green 分支事后补记。
//     step 4.5 只剩 per-task-suite-record（runner 不写 per-task-suite-records.jsonl 那个独立账本）。
//     改本文件必须同步 plugin/workflows/fan-in-execute.js（双拷贝，workflows-dual-copy-drift-check）与
//     plugin/test/fan-in-execute-paths.test.mjs（--buckets 走 runner 的 wiring + red/green 对照）。
//  ⑧ land 前 anti-drift 重跑（gap-fan-in-fix-commit-delta-escapes-touches-coverage）：step 1 的
//     anti-drift 检查在 merge 后立即跑，fix-agent 的修复提交（suite-fix 重跑路径）在其后引入——其触碰
//     文件从未被 Touches 复核（实证 c2917261 改 full-suite-runner.test.mjs 不在 Touches，已 land 才
//     发现）。持锁段 step 5（flip done 前、ff 前）增补同一驱动重跑：git diff --name-only
//     ${mergeTarget}...HEAD 此刻已含 fix commits ⇒ 覆盖分支整体 delta。判定逻辑不变（AC3），只增调用点；
//     正常 fan-in（无 fix commit 或 fix 全在 Touches 内）重跑幂等（AC2）。改本块必须同步
//     plugin/test/fan-in-execute-paths.test.mjs 的 land-anti-drift 组测试（fix commit 越界触碰 HARD FAIL
//     幂等回归 + 真实 bash）。
//  ⑨ fix-scope gate（gap-fix-scope-gate-wired-to-wrong-path）：suite-fix 内联 subagent（本文件）的
//     fix 前判定——红是否本任务 Touches 内回归（inScope 修 / load-sensitive 释放 / 别任务 bug defer）。
//     上一版 gate 落在 execute-suite-fix.js（standalone 死工作流）零效果。实现见下方 FIX_SCOPE_GATE
//     常量（判定复用 touches-orthogonality-check.ts + known-load-sensitive.ts）。改本块必须同步
//     plugin/test/fan-in-execute-paths.test.mjs 的 fix-scope 组测试（内联 prompt 含 gate + 越界红 defer）。

// args 到达时是【字符串】不是对象（实测 wf_6f8cc053-f52）：直接 args.x 会静默 undefined。
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args ?? {}) } catch { return {} } })()
const task = A.task
const worktree = A.worktree
const root = A.root
const runId = A.runId ?? ''
const mergeTarget = A.mergeTarget ?? 'develop'
// 阶段 2 agent 的 suite 等待可调参数（生产用默认；测试经 args 覆盖，如 pollBlockSeconds=10、pollBlockSleep=0.2）。
const maxSuitePolls = A.maxSuitePolls ?? 60         // 阶段 2 agent 内循环等待的有界轮询数（60×(540s/次)=9h 上限；suite 实测 19min ⇒ ~3 次）
const maxFixRounds = A.maxFixRounds ?? 4            // 红 suite 的最大修复迭代
const maxFfRetries = A.maxFfRetries ?? 3            // ff 失败（develop 前进）的最大重试（同 SPEC §7 阈值）
const pollBlockSeconds = A.pollBlockSeconds ?? 540  // 阶段 2 agent 内单次 <600s Bash 有界阻塞等待的硬边界（gap-fan-in-execute-poll-bounded-blocking-wait）
const pollBlockSleep = A.pollBlockSleep ?? 15        // 阻塞等待的检查粒度（每 N 秒看一眼 exit marker）
const releaseLivelockRounds = A.releaseLivelockRounds ?? 3  // release 侧 anti-livelock（gap-gate-release-no-isolate-rerun-no-livelock）：同一 load-sensitive 红连续 release ≥3 轮 ⇒ escalate（SPEC §7「同一任务失败 ≥3 次 才谈防活锁」同阈值）
const maxDeferRelaunches = A.maxDeferRelaunches ?? 3  // defer 侧 anti-livelock（gap-fan-in-relaunch-retry-cap）：非 load-sensitive「other-task defer → 全量 relaunch」的连续纯 defer 轮数上限 ≥3 轮 ⇒ escalate → needs-human / 交 outer（⛔ 无限重跑；与 releaseLivelockRounds 互补不冲突——一个管 load-sensitive、一个管确定性失败）
const mergeLockWaitSecs = A.mergeLockWaitSecs ?? 30  // fan-in-ff-merge.sh 的 merge 锁等待（--lock-wait，秒）——正确性锁，覆盖毫秒级 ff（hold 是 git merge --ff-only），与 suite 的 single-flight 资源锁无关（后者现在是无界排队等待，见 test.sh full_suite_lock_acquire）。显式传递让 fan-in 流程拥有该语义（task Touches: fan-in-ff-merge.sh lock wait 语义）。
const stuckHolderGraceSecs = A.stuckHolderGraceSecs ?? 2700  // 跨 relaunch 锁持有者卡死阈值（秒，默认 45min = 2700s；gap-suite-lock-holder-stuck-detection）——relaunch 时上一轮 detached suite 若仍存活且已存活 ≥ 此阈值 ⇒ SIGKILL 整进程组释放 single-flight 槽 + 告警。⛔ 与单次 SUITE_MAX_RUNTIME_MS(45min)/SUITE_SILENCE_MS(15min)【不同机制】：那两者在 full-suite-runner.ts 管「单次 suite 卡死」，且管不到本 detached 直跑路径（不经 full-suite-runner）——每次 relaunch 新起进程、单次超时重置，管不到「上一轮 hung 进程跨 relaunch 无限持有」这一半。本阈值只在 relaunch 时刻评估（活着的上一轮 = 卡死，不是单次运行时长判定）。测试可经 args 覆盖。

if (!task || !worktree || !root) {
  return { outcome: 'bad-args', message: 'task / worktree / root are required', args }
}

// ── 跨 relaunch 锁持有者卡死/失联检测（gap-suite-lock-holder-stuck-detection AC1/AC2）──────────────
// relaunch 前读上一轮 pidfile（`pid started_ms`，SUITE_LAUNCH/ISOLATE_LAUNCH 的 wrapper 自写）。
// relaunch 只在上一轮 suite 已 red / 静默死亡 / ff-retry 后发生 ⇒ 上一轮【应已死亡】；若 pid 仍
// 【存活】⇒ 上一轮 detached suite 卡死（hung，写不出 exit marker 却占着 single-flight 槽——flock 只在
// 进程退出时自动释放，hung 进程永不退出）⇒ 跨 relaunch 无限持有。单次 SUITE_MAX_RUNTIME_MS/SUITE_SILENCE_MS
// 在 full-suite-runner.ts（管不到本 detached 直跑路径），且每次 relaunch 新起进程、单次超时重置——本块
// 专补「跨 relaunch 循环」这一半（在 relaunch 边界评估，活着的上一轮 = 卡死）。存活且持有 ≥
// ${stuckHolderGraceSecs}s ⇒ SIGKILL 整个进程组（setsid session leader 的 pgid = pid，杀掉 wrapper +
// scripts/test.sh + 测试子进程）释放槽 + 告警（谁/多久/动作，stdout + 持久 ledger）；存活但未超阈值 ⇒
// 告警不杀（仍在正常收尾的上一轮不得误杀）；已死 ⇒ 陈旧 pidfile，随下方 rm 清理（正常路径，非持有，
// 不告警——失联/静默死亡已由 wait 块 suite-pid-dead 覆盖）。改本块必须同步
// plugin/test/fan-in-execute-paths.test.mjs 的 stuck-holder 组测试。
const STALE_HOLDER_REAP = `
# suite-stale-holder-reap-block-start
suite_stuck_file="/tmp/fan-in-stuck-holder-${task}.log"
if [ -f "$suite_pid_file" ] && [ -s "$suite_pid_file" ]; then
  _holder_pid=$(cut -d' ' -f1 "$suite_pid_file" 2>/dev/null | tr -cd '0-9')
  _holder_start=$(cut -d' ' -f2 "$suite_pid_file" 2>/dev/null | tr -cd '0-9')
  if [ -n "$_holder_pid" ] && kill -0 "$_holder_pid" 2>/dev/null; then
    _stuck_now=$(date +%s%3N)
    _stuck_held_s=0
    if [ -n "$_holder_start" ]; then
      _stuck_held_s=$(( (_stuck_now - _holder_start) / 1000 ))
    fi
    if [ "$_stuck_held_s" -ge "${stuckHolderGraceSecs}" ]; then
      kill -9 -"$_holder_pid" 2>/dev/null || kill -9 "$_holder_pid" 2>/dev/null || true
      _stuck_line="__FANIN_STUCK_LOCK_HOLDER__ task=${task} pid=$_holder_pid held_s=$_stuck_held_s threshold_s=${stuckHolderGraceSecs} action=SIGKILL-released"
      echo "$_stuck_line"
      printf '%s\\n' "$_stuck_line" >> "$suite_stuck_file" 2>/dev/null || true
    else
      _stuck_line="__FANIN_STUCK_LOCK_HOLDER__ task=${task} pid=$_holder_pid held_s=$_stuck_held_s threshold_s=${stuckHolderGraceSecs} action=alive-under-grace-not-killed"
      echo "$_stuck_line"
      printf '%s\\n' "$_stuck_line" >> "$suite_stuck_file" 2>/dev/null || true
    fi
  fi
fi
# suite-stale-holder-reap-block-end`

// ── 共享的 detached suite 启动核心（阶段 1 与 Fix agent 复用，字节一致）─────────────────────────
// setsid + & + disown 让 suite 活在独立 session，subagent 退出不影响它；exit marker 是完成信号，
// 由 workflow 脚本控制流轮询（等待不占任何 subagent 回合，gap-fan-in-turn-budget-suite-timeout）。
const SUITE_LAUNCH = `
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_log_file="/tmp/fan-in-suite-${task}.log"
rm -f "$suite_exit_marker" "$suite_time_file"
suite_start_iso=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
suite_start_ms=$(date +%s%3N)
suite_head_now=$(git -C ${worktree} rev-parse HEAD 2>/dev/null || echo unknown)
# gap-fan-in-suite-log-cross-relaunch-reuse: 每轮 relaunch 轮转日志。旧轮内容移到 .prev（诊断可查）；
# 当前轮日志由 full-suite-runner.ts 的 --log-file 以 "w" 截断重写（runner 拥有日志，每轮天然只含当前轮，
# 不再需要 __FANIN_SUITE_START__ 标记切片——读者按整份读即当前轮；FIX_SCOPE_GATE / parsePerFileLines
# 的标记切片回退到整份，等价正确）。
if [ -f "$suite_log_file" ]; then mv -f "$suite_log_file" "\${suite_log_file}.prev" 2>/dev/null || true; fi
printf 'full_suite_ran=true\\nskip_reason=\\nstart_iso=%s\\nstart_ms=%s\\nsuite_head=%s\\nsuite_log_file=%s\\n' \\
  "$suite_start_iso" "$suite_start_ms" "$suite_head_now" "$suite_log_file" > "$suite_capture"
# gap-suite-fix-relaunch-stale-tmux-snapshot：launch/relaunch 前【显式】落新鲜 tmux-leak before-run 快照。
# 生产 suite-fix（本 workflow 内联 Fix agent 的 relaunch）复用本 SUITE_LAUNCH ⇒ 此处即「relaunch 前生成
# 新鲜快照」的 workflow 层保证——不依赖 scripts/test.sh FULL_SUITE_DEFAULT 深层分支；覆盖
# refresh-worktree-quay.sh 从 main checkout 拷入的陈旧/缺失 .quay/tmux-leak-scan.snapshot（陈旧/缺失快照
# ⇒ suite 收尾 --check fail-closed「no before-run snapshot」RED 的成因）。fail-open（--check 本身
# fail-closed 兜底）。
bash ${worktree}/plugin/scripts/tmux-leak-scan.sh --snapshot ${worktree} >/dev/null 2>&1 || true
# GNU time 捕获 CPU（判据3 的 cpu_time_s）；GNU time 不可用 ⇒ 保持 null + not-wired（AC6，绝不写 0）。
# gap-suite-wait-bash-stale-pid-poll 修正（生产实测 2026-08-21，负控制 3 行确认）：$! 是 setsid 父进程 PID——
# setsid 检测到调用方是进程组组长即 fork，父进程立即退出（负控制实测 $! 恒 DEAD、wrapper $$ 恒 ALIVE）
# ⇒ kill -0 $! 恒失败，误报 suite-pid-dead（真实 suite 存活而 poller 判死，阻塞全部 fan-in）。
# 改由 wrapper 首行自写 $$（session leader，生命周期=整个 suite）到 pidfile 作为 suite_pid——poller 核验
# 它才是真实存活信号；pidfile 读不到 ⇒ suite_pid 空，poller 退回纯 .exit 轮询（安全兜底）。
suite_pid_file="/tmp/fan-in-suite-${task}.pid"
${STALE_HOLDER_REAP}
rm -f "$suite_pid_file"
# gap-fan-in-red-bucket-run-not-recorded AC1/AC2 — the fan-in bucket path runs through
# full-suite-runner.ts --buckets <task> (the CORRECT runner — the single writer of verification-round.jsonl
# green AND red, full-suite-state.json, measure-history.jsonl and suite-load-<runId>.jsonl), NOT a parallel
# setsid-bash-scripts-test.sh harness + a green-only writer. The runner is the one place that records a
# RED bucket round into the trend ledger (/tests) — the old detached direct run left a red round with ZERO
# records (硬规则 3b: 「没跑过」与「跑了但红」同形). --root <worktree> is the tested checkout (test.sh runs
# in the worktree); --state-dir <root>/.quay lands state/log/verification-round/measure-history/suite-load in
# the SHARED checkout (the /tests read location; the same --state-dir split gap-suite-state-split-across-
# worktree-and-gate documents). --runner inner is explicit (matches the derived worktree⇒inner default).
# --log-file <suite_log_file> tees the suite stream (__BUCKETS__/__GROUP__/__PERFILE__ markers) into the
# fan-in's own /tmp log so SUITE_WAIT_BASH (lane_count) + FIX_SCOPE_GATE (__PERFILE__) keep reading it; the
# runner's OWN load sampler (suite-load-<runId>.jsonl) is spawned by the runner itself (state-driven stop),
# so the manual sampler spawn is gone — the runner is the single spawner again (converged, not parallel).
# ISOLATE_LAUNCH (below) is NOT bucket-wired: it is the C11 isolate rerun of an explicit load-sensitive
# file list — --buckets would override that list (it still runs scripts/test.sh directly, NOT the runner).
# ⛔ ATOMIC PUBLICATION of both the pidfile ($5) and the exit marker ($4) — '> "$N.tmp" && mv -f "$N.tmp" "$N"'.
# gap-fan-in-marker-exists-before-write-reads-empty: 'printf ... > "$N"' is open(O_TRUNC) FIRST and
# write() SECOND, so a reader that opens the path inside that gap gets a 0-byte file — and under heavy
# suite load the scheduling gap widens, so the reader loses that race more often. The completion event of
# a marker is "the file has been WRITTEN", never "the file exists"; rename(2) publishes the target path
# only once its content is complete ⇒ every existence-only reader is correct without touching the reader
# (this block's own poller, the suite-wait block's '[ ! -f ]', the test harness). Measured incidence of
# the non-atomic shape: 1/56 fan-in suite logs overall, 3/18 in the 09-12 window. A leftover "$N.tmp" is
# harmless and needs no cleanup: nothing ever opens a .tmp path, and '> "$N.tmp"' truncates before
# every rename. Reverting this to the single-redirect shape re-reds fan-in-execute-paths-s12's AC3 test.
setsid bash -c 'printf "%s %s\\n" "$$" "$(date +%s%3N)" > "$5.tmp" && mv -f "$5.tmp" "$5"; cd "$1" && { if command -v /usr/bin/time >/dev/null 2>&1; then /usr/bin/time -o "$2" -f "%U %S" node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --buckets ${task} --root "$1" --state-dir "${root}/.quay" --runner inner --log-file "$3"; else node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --buckets ${task} --root "$1" --state-dir "${root}/.quay" --runner inner --log-file "$3"; fi; } >> "$3" 2>&1; rc=$?; printf "exit=%s\\nend_ms=%s\\nend_iso=%s\\n" "$rc" "$(date +%s%3N)" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" > "$4.tmp" && mv -f "$4.tmp" "$4"' _ "${worktree}" "$suite_time_file" "$suite_log_file" "$suite_exit_marker" "$suite_pid_file" & disown
suite_pid=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if [ -s "$suite_pid_file" ]; then suite_pid=$(cut -d' ' -f1 "$suite_pid_file" 2>/dev/null); break; fi
  sleep 0.1
done
printf 'suite_pid=%s\\n' "$suite_pid" >> "$suite_capture"`

// ── C11 隔离重跑启动（gap-gate-release-no-isolate-rerun-no-livelock AC1）────────────────────────────
// load-sensitive release 的【隔离重跑】launch——只重跑 fix-scope gate 分诊出的 load-sensitive 家族
// 失败文件（低并发：scripts/test.sh 在低核机推导串行），【非全量 relaunch】。高 load 常驻下全量
// relaunch 不减 load，load-sensitive 族反复红 ⇒ 收敛失败（2026-08-19 ac101 fan-in 实证：3 RED + 3
// 全量 relaunch，靠低 load 单飞侥幸收敛）。文件列表由 gate 机械写入
// /tmp/fan-in-scope-isolate-${task}.files（每行一个 worktree 相对路径；文件缺失/为空 ⇒ 本块不应被
// 使用，调用方应退回全量 relaunch）。与 SUITE_LAUNCH 共享同一 exit marker / capture，脚本控制流
// waitForSuite 无需感知区别；capture 标 full_suite_ran=false + skip_reason=isolate-rerun-load-sensitive
// （诚实的记录面：本 fan-in 最终验证是隔离重跑而非全量 suite）。不捕获 CPU（full_suite_ran=false 时
// per-task-suite-record 拒绝非空 cpu_time_s —— AC6「skip 不消耗 CPU」），GNU time 不可用问题不存在。
const ISOLATE_LAUNCH = `
# isolate-launch-block-start
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_log_file="/tmp/fan-in-suite-${task}.log"
rm -f "$suite_exit_marker" "$suite_time_file"
suite_start_iso=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
suite_start_ms=$(date +%s%3N)
suite_head_now=$(git -C ${worktree} rev-parse HEAD 2>/dev/null || echo unknown)
# gap-fan-in-suite-log-cross-relaunch-reuse: 同 SUITE_LAUNCH——轮转旧轮 + 起始标记（round=isolated）。
if [ -f "$suite_log_file" ]; then mv -f "$suite_log_file" "\${suite_log_file}.prev" 2>/dev/null || true; fi
printf '__FANIN_SUITE_START__ iso=%s ms=%s head=%s round=isolated\\n' "$suite_start_iso" "$suite_start_ms" "$suite_head_now" > "$suite_log_file"
printf 'full_suite_ran=false\\nskip_reason=isolate-rerun-load-sensitive\\nstart_iso=%s\\nstart_ms=%s\\nsuite_head=%s\\nsuite_log_file=%s\\n' \\
  "$suite_start_iso" "$suite_start_ms" "$suite_head_now" "$suite_log_file" > "$suite_capture"
isolate_files=$(tr '\\n' ' ' < "/tmp/fan-in-scope-isolate-${task}.files" 2>/dev/null || true)
# gap-suite-wait-bash-stale-pid-poll 修正同 SUITE_LAUNCH：$! 是 setsid 父进程 PID（fork 即退），kill -0 恒
# 失败误报死进程 ⇒ 改由 wrapper 首行自写 $$ 到 pidfile（session leader）作为 suite_pid（硬规则 5b 全实例）。
suite_pid_file="/tmp/fan-in-suite-${task}.pid"
${STALE_HOLDER_REAP}
rm -f "$suite_pid_file"
# Same atomic publication as SUITE_LAUNCH (硬规则 5b: this is the sibling instance of the SAME shape —
# 'printf ... > "$N"' for the pidfile ($4) and the exit marker ($3)); fixing only SUITE_LAUNCH would have
# left the isolate-rerun path reading empty exactly the same way.
setsid env SUITE_ISOLATE_FILES="$isolate_files" bash -c 'printf "%s %s\\n" "$$" "$(date +%s%3N)" > "$4.tmp" && mv -f "$4.tmp" "$4"; cd "$1" && { bash scripts/test.sh $SUITE_ISOLATE_FILES; } >> "$2" 2>&1; rc=$?; printf "exit=%s\\nend_ms=%s\\nend_iso=%s\\n" "$rc" "$(date +%s%3N)" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" > "$3.tmp" && mv -f "$3.tmp" "$3"' _ "${worktree}" "$suite_log_file" "$suite_exit_marker" "$suite_pid_file" & disown
suite_pid=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if [ -s "$suite_pid_file" ]; then suite_pid=$(cut -d' ' -f1 "$suite_pid_file" 2>/dev/null); break; fi
  sleep 0.1
done
printf 'suite_pid=%s\\n' "$suite_pid" >> "$suite_capture"
# isolate-launch-block-end`

// ── fix-scope gate（fix 前判定红是否本任务 Touches 内回归，gap-fix-scope-gate-wired-to-wrong-path）──
// 上一版 fix-scope gate（gap-suite-fix-workflow-no-load-sensitive-branch）落在 execute-suite-fix.js
// （standalone 死工作流）零效果——生产 suite-fix 是本文件内联 subagent（:391 prompt），它直接修根因、
// 不经 execute-suite-fix.js。越界修已复发第 8+ 例（b0aa31c2 修 quay-init.sh / eb77b17e 修
// supervisor-observe.test.mjs / 43153e58 修 session-liveness-helpers.mjs——全不在各自任务 Touches）。
// 本 gate 把判定落到内联 prompt：fix 前把 suite 日志里 __PERFILE__ passed=false 的失败文件机械分诊为
// inScope（本任务 Touches 内回归，修）vs outOfScope（越界红，defer/release）：load-sensitive
// （known-load-sensitive.ts 的 in_family）⇒ 释放不修；file ∉ ## Touches ⇒ 别任务 bug defer 不修；
// 无 file（tmux-leak 环境残留 / 静态检查）⇒ defer 不修。无法评估（task 文件/日志读失败）⇒
// fail-closed：不修，全部 defer（硬规则 3b）。判定复用 touches-orthogonality-check.ts 的
// parseTouches/matchGlob/normalizePath（与 execute-suite-fix.js 同源）。改本块必须同步
// plugin/test/fan-in-execute-paths.test.mjs 的 fix-scope 组测试。
// release 持久化（gap-fix-scope-gate-release-not-persistent）：load-sensitive release 曾是一次性
// relaunch——relaunch 后仍红，第二轮 suite-fix 转越界 fix（第 9+ 例 a76959c8）。修法：gate 把每个
// load-sensitive 红的连续 release 轮数 releasedRounds 持久化到 fix_scope_release ledger（/tmp 文件，
// 跨 fix-round agent 调用存活），下一轮读到递增；内联 prompt 显式写「releasedRounds ≥ 1 的 load-
// sensitive 红一律继续 release，⛔ 不得转 fix」。幂等持久 = 机制（ledger）+ 指令（prompt）双保险。
// release 动作三态（gap-gate-release-no-isolate-rerun-no-livelock，delivery-critical）：release 侧
// 此前是【全量 relaunch】——高 load 常驻下全量 relaunch 不减 load，load-sensitive 族反复红 ⇒ 收敛
// 失败（2026-08-19 ac101 实证 3 RED + 3 全量 relaunch）且无 anti-livelock 兜底（无界）。修法：gate
// 额外产出 isolateRerun 命令 + 把 load-sensitive 文件列表机械写入 /tmp/fan-in-scope-isolate-${task}.files；
// 纯 load-sensitive 释放（无 inScope 修复）⇒ 【C11 隔离重跑】用 ISOLATE_LAUNCH（只重跑失败家族文件、
// 低并发，非全量 relaunch）；同一 load-sensitive 红 releasedRounds ≥ ${releaseLivelockRounds}（SPEC §7
// attempt≥3 同阈值）⇒ FIX_SCOPE_VERDICT.livelock=true ⇒ 【anti-livelock 兜底】escalate（relaunched:false、
// quiet-window/needs-human），不再无界 relaunch。
const FIX_SCOPE_GATE = `【fix-scope gate —— 修任何失败前必须先跑，得到 FIX_SCOPE_VERDICT 再动手修】
# fix-scope-gate-block-start
fix_scope_log="/tmp/fan-in-suite-${task}.log"
fix_scope_touches="${worktree}/tasks/${task}.md"
fix_scope_release="/tmp/fan-in-scope-release-${task}.json"
fix_scope_isolate="/tmp/fan-in-scope-isolate-${task}.files"
fix_scope_defer="/tmp/fan-in-scope-defer-${task}.json"
rm -f "$fix_scope_isolate"
fix_scope_out=$(node --no-warnings --experimental-strip-types --input-type=module -e 'import fs from "node:fs";
import { parseTouches, matchGlob, normalizePath } from "${worktree}/plugin/scripts/touches-orthogonality-check.ts";
import { scanFamily, kindForFile } from "${worktree}/plugin/scripts/known-load-sensitive.ts";
import { TMUX_LEAK_FAIL_RE } from "${worktree}/plugin/scripts/tmux-leak-fail-re.ts";
import { readCarrierPerFile, groupByFile, baselineOf, classifyFailure } from "${worktree}/plugin/scripts/perfile-failure-rate.ts";
const taskFile = process.argv[1]; const wt = process.argv[2]; const logFile = process.argv[3]; const releaseLedger = process.argv[4]; const isolateFile = process.argv[5];
const livelockRounds = Number(process.argv[6] || 3);
const deferLedger = process.argv[7]; const deferLivelockRounds = Number(process.argv[8] || 3);
let globs = null;
try { const tb = fs.readFileSync(taskFile, "utf8"); const p = parseTouches(tb); if (p.hasSection) globs = p.globs; } catch (e) { globs = null; }
const family = scanFamily(wt);
// per-file failure-rate baseline (gap-perfile-failure-rate-baseline-step-change): read the gitignored
// carrier from --root/QUAY_MAIN_CHECKOUT (argv[9]=${root}) or the QUAY_PERFILE_RATE_ROOT test seam; an
// absent carrier ⇒ empty history ⇒ classifyFailure returns "insufficient" (fail-closed: never a
// fabricated "new-event" — a fresh worktree must not escalate every red on a missing carrier).
const carrierRoot = process.env.QUAY_PERFILE_RATE_ROOT || process.env.QUAY_MAIN_CHECKOUT || process.argv[9] || "";
const carrier = carrierRoot ? readCarrierPerFile(carrierRoot) : { found: false, path: "", recs: [] };
const byFile = carrier.found ? groupByFile(carrier.recs) : new Map();
const baselines = {};
const baselineFor = (rel) => { const history = byFile.get(rel) ?? []; const b = baselineOf(history); const out = { runs: b.runs, fails: b.fails, rate: b.rate, classification: classifyFailure(history) }; baselines[rel] = out; return out; };
let logText = ""; try { logText = fs.readFileSync(logFile, "utf8"); } catch (e) { logText = ""; }
// gap-fan-in-suite-log-cross-relaunch-reuse: 按当前轮起始标记切片——只读最后一个 __FANIN_SUITE_START__
// 之后的内容（当前轮），不整份线性 grep 旧轮；无标记（full-suite-runner/测试手写日志）⇒ 整份（向后兼容）。
// gap-fan-in-fix-scope-gate-slice-line-anchor: 行首锚定（与 pre-verified-round-record.lastSuiteStartOffset /
// gap-wiring-B 断言一致）——裸 lastIndexOf 会命中测试输出里【行内】提及标记的文本（gap-wiring-B 测试名含
// __FANIN_SUITE_START__ 字样），把其后的真实 __PERFILE__ passed=false 行切掉 ⇒ 假 checker-misreport。
const _roundMkRe = /^__FANIN_SUITE_START__[^\\n]*$/gm;
let _roundMk = -1; let _rm;
while ((_rm = _roundMkRe.exec(logText)) !== null) _roundMk = _rm.index;
if (_roundMk !== -1) logText = logText.slice(_roundMk);
let prior = {}; try { if (releaseLedger) prior = JSON.parse(fs.readFileSync(releaseLedger, "utf8")); } catch (e) { prior = {}; }
const inScope = []; const outOfScope = []; const loadSensitiveFiles = []; let livelock = false; const seen = new Set();
const re = /^__PERFILE__ duration_ms=[0-9.]+ (.+) passed=false(?: end_ms=[0-9]+)?$/gm; // gap-test-detail-timeline: reporter 行尾多 end_ms=<epoch-ms>，$ 锚定需容忍该可选后缀（否则失败文件提取恒空）
let m;
while ((m = re.exec(logText)) !== null) {
  let rel = m[1];
  if (rel.startsWith(wt + "/")) rel = rel.slice(wt.length + 1);
  rel = normalizePath(rel);
  if (seen.has(rel)) continue;
  seen.add(rel);
  const b = baselineFor(rel);
  const kind = kindForFile(family, rel);
  if (kind !== undefined) { const rounds = (typeof prior[rel] === "number" ? prior[rel] : 0) + 1; prior[rel] = rounds; loadSensitiveFiles.push(rel); if (rounds >= livelockRounds) livelock = true; outOfScope.push({ file: rel, reason: "load-sensitive", kind, releasedRounds: rounds, livelock: rounds >= livelockRounds, baseline: b }); continue; }
  if (globs === null) { inScope.push(rel); continue; }
  if (globs.some((g) => matchGlob(normalizePath(g), rel))) { inScope.push(rel); continue; }
  const escalate = b.classification === "new-event" || b.classification === "step-change";
  outOfScope.push({ file: rel, reason: escalate ? "new-event" : "other-task", baseline: b });
}
if (TMUX_LEAK_FAIL_RE.test(logText)) outOfScope.push({ file: null, reason: "leak-residual" });
if (inScope.length === 0 && outOfScope.length === 0 && /run_static_checks|static-check/i.test(logText)) outOfScope.push({ file: null, reason: "checker-misreport" });
try { if (releaseLedger) fs.writeFileSync(releaseLedger, JSON.stringify(prior)); } catch (e) {}
if (loadSensitiveFiles.length > 0) { try { fs.writeFileSync(isolateFile, loadSensitiveFiles.join("\\n") + "\\n"); } catch (e) {} }
const isolateRerun = loadSensitiveFiles.length > 0 ? "bash scripts/test.sh " + loadSensitiveFiles.join(" ") : null;
// defer 侧 anti-livelock（gap-fan-in-relaunch-retry-cap）：纯 defer 轮 = inScope 空 + 无 load-sensitive +
// 有 outOfScope（other-task/leak-residual/checker-misreport）——这类轮【无根因可修】，「照旧全量 relaunch」
// 是对确定性失败（别任务 bug / flake）的无界重跑。连续纯 defer 轮数持久化到 defer ledger（跨 fix-round
// 调用存活，同 fix_scope_release）；有 inScope 修复或 load-sensitive 释放 ⇒ 视为有进展，计数归零。
let deferRounds = 0;
if (deferLedger) { try { const dp = JSON.parse(fs.readFileSync(deferLedger, "utf8")); if (typeof dp.rounds === "number") deferRounds = dp.rounds; } catch (e) {} }
const isPureDefer = inScope.length === 0 && loadSensitiveFiles.length === 0 && outOfScope.length > 0;
if (isPureDefer) { deferRounds += 1; } else { deferRounds = 0; }
let deferLivelock = deferRounds >= deferLivelockRounds;
if (deferLedger) { try { fs.writeFileSync(deferLedger, JSON.stringify({ rounds: deferRounds })); } catch (e) {} }
process.stdout.write(JSON.stringify({ scoped: globs !== null, inScope, outOfScope, baselines, isolateRerun, livelock, deferRounds, deferLivelock }));' "$fix_scope_touches" "${worktree}" "$fix_scope_log" "$fix_scope_release" "$fix_scope_isolate" "${releaseLivelockRounds}" "$fix_scope_defer" "${maxDeferRelaunches}" "${root}" 2>&1) || { echo "FIX_SCOPE_NOT_EVALUATED=1"; fix_scope_out=""; }
echo "FIX_SCOPE_VERDICT=$fix_scope_out"
# fix-scope-gate-block-end
判定（读上面的 FIX_SCOPE_VERDICT JSON）：
- inScope 里的失败 = 本任务 Touches 内的回归 ⇒ 只修这些文件；禁止触碰 outOfScope 里列出的任何文件。
- outOfScope 里的失败 = 越界红，一律不修：
    * reason=load-sensitive（in_family，kind 已标注，携带 releasedRounds = 已连续 release 的轮数含本轮）⇒ 释放：不修。⛔ 幂等持久：同一 load-sensitive 红无论重跑几轮都【继续 release】，任何一轮都不得转 fix——重跑后仍红 ⇒ 仍 release（不是「重跑确认后改修」）。releasedRounds ≥ 1 的项本轮仍 release，note 里写「load-sensitive 释放（第 N 轮，幂等持久），⛔ 不得转 fix」，N = releasedRounds 的值。release 落账由 gate 自动持久化到 fix_scope_release ledger（跨重跑轮次递增），下一轮 gate 会读到 releasedRounds 递增——这是机制保证，不是靠记性。⛔ release 动作三态（见下方「重新启动 suite」步骤）：有 inScope 修复 ⇒ 全量 relaunch；纯 load-sensitive 释放且 FIX_SCOPE_VERDICT.livelock=false ⇒ 【C11 隔离重跑】（只重跑失败家族文件、低并发，非全量 relaunch）；FIX_SCOPE_VERDICT.livelock=true（任一 load-sensitive 项 releasedRounds ≥ ${releaseLivelockRounds}）⇒ 【anti-livelock 兜底】：不再 relaunch、escalate（relaunched:false）。
    * reason=checker-misreport ⇒ defer：不修，note 里要求 defer 独立任务。
    * reason=other-task / leak-residual ⇒ 别任务 bug / 环境残留：不修，note 里要求 defer 独立任务。
    * reason=new-event（baseline.classification ∈ new-event|step-change 的越界红——该文件历史从未失败过、或失败率发生阶跃，见 baselines 字段）⇒ 【升级语义分析】：不修、也不 defer-retry，note 里要求把「一个一直全绿的文件开始红了」这件事升级到语义层分析（可能是一个真实的偶现 bug——defer 会把真实缺陷静默归进环境性；本 gate 造出这个类别正是为了不再这么做）。
    * FIX_SCOPE_VERDICT.deferLivelock=true（连续纯 defer 轮数 ≥ ${maxDeferRelaunches}——inScope 空、无 load-sensitive、只有 other-task/leak/checker defer）⇒ 【defer anti-livelock 兜底】：不再 relaunch、escalate（relaunched:false，note 写「other-task defer anti-livelock（deferRounds≥${maxDeferRelaunches}）」）——确定性失败重跑零信息，⛔ 不得无限重跑。
- FIX_SCOPE_NOT_EVALUATED=1 ⇒ fail-closed：本任务不修任何失败，全部 defer（无法评估 ≠ 合格）。
修完 inScope 后照常重新启动全量 suite。返回的 failuresFixed 只列 inScope 修复；越界 defer/release 写进 note。重跑后 suite 仍红的 load-sensitive 红 ⇒ 仍按本 gate release，⛔ 绝不转 fix。`

// ── 阶段 2 agent 的 suite 等待：单 agent 循环多次 <600s Bash，不每轮起新 agent ────────────────────────
// （gap-subagent-turn-budget-13min-falsified：2026-08-20 证伪「subagent ~13min 回合预算硬超时」——
// 旧设计「每轮起一个新短命轮询 agent + 脚本 setTimeout」唯一依据就是这个假数字。真实限制只有 Bash
// 单次 600s 硬顶 + suite 实测 19+ min ⇒ 阶段 2 agent 在本回合内多次运行下面的自足等待块（单次有界
// 阻塞等待 timeout ${pollBlockSeconds} + sleep ${pollBlockSleep}，< 600s 硬边界），POLL=not-done 就再跑
// 一次（最多 ${maxSuitePolls} 次）。detached suite 不受影响（setsid+&+disown，SUITE_LAUNCH）。）
// ── agent() 无 timeout 旋钮的局限（gap-agent-no-timeout-option 2026-08-20 外层裁定）─────────────
// Workflow 工具 agent() 的 opts 仅 {label, phase, schema, model, effort, isolation, agentType}——
// 没有 timeout/bashTimeout 旋钮。「加旋钮」是 Claude Code 特性请求，本仓库改不了。
// ⇒ 有界阻塞等待（timeout ${pollBlockSeconds}，见 pollBlockSeconds 默认）落在【Bash 工具】的时限上，
// 而「Bash 执行时限须设大于 ${pollBlockSeconds}s」是纯语言请求、非代码保证——阶段 2 agent 的 Bash 可能
// 被默认 120s kill、提前返回 not-done。
// ⇒ 兜底 = suite 以 detached 方式运行（setsid + & + disown，见 SUITE_LAUNCH）：等待块的超时只界它
// 【自己看 marker】的时长、不界 suite 生命周期；即使 Bash 提前超时返回 not-done，suite 继续跑，阶段 2
// agent 重跑等待块即可。detached 让「agent 内长阻塞」成为纯优化（空转轮询压到 ~3 次），而非正确性要求。
// ⇒ 覆盖判据（AC1，取代旧 firstDelayMs+pollBlockSeconds）：maxSuitePolls × pollBlockSeconds ≥ suite
//   时长（实测 19+ min ≈ 1140s）。默认 60×540=32400s ≫ 1140s；不得把单次收窄到 < Bash 默认 120s 去
//   「让等待落在默认时限内」还指望一次覆盖 suite（b187d84a 已回退，7d973c40）。
const SUITE_WAIT_BASH = `
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_log_file="/tmp/fan-in-suite-${task}.log"
# 存活核验的 pid（gap-suite-wait-bash-stale-pid-poll）：从 capture 读 suite_pid（SUITE_LAUNCH 启动时写）。
# marker 出现前用 kill -0 核验进程存活——detached suite 若在写 .exit 前静默死亡（信号/OOM/异常），poller
# 立即发现并写可区分失败态，不再以「.exit 不存在 ⇒ 进程还在跑」的假假设空转满 ${pollBlockSeconds}s。
suite_pid=""
if [ -f "$suite_capture" ]; then
  suite_pid=$(sed -n 's/^suite_pid=//p' "$suite_capture" | tail -1)
fi
if [ ! -f "$suite_exit_marker" ]; then
  # 有界阻塞等待（gap-fan-in-execute-poll-bounded-blocking-wait）：最多 ${pollBlockSeconds}s 硬边界
  # （< Bash 600s 上限），每 ${pollBlockSleep}s 看一眼 marker。决策权在固定命令——这个 timeout 是脚本给的
  # 硬边界、maxSuitePolls 是循环上限，agent 不自决「等多久」，只是重跑同一个固定命令（ab380c5e 是
  # agent 自决等待，这里是固定命令的有界等待）。
  # 内层循环每次醒来先 kill -0 核验 suite_pid 存活（gap-suite-wait-bash-stale-pid-poll AC1）；进程已死
  # 且 marker 未写 ⇒ exit 42（sentinel）提前返回，不等满 ${pollBlockSeconds}s 空转（AC2：写可区分失败态）。
  poll_rc=0
  timeout ${pollBlockSeconds} bash -c '
    while [ ! -f "$1" ]; do
      if [ -n "$2" ] && ! kill -0 "$2" 2>/dev/null; then
        exit 42
      fi
      sleep ${pollBlockSleep}
    done
  ' _ "$suite_exit_marker" "$suite_pid" || poll_rc=$?
fi
if [ ! -f "$suite_exit_marker" ]; then
  if [ "$poll_rc" = "42" ]; then
    printf 'suite_pid_dead=1\\nsuite_pid_dead_ts=%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" >> "$suite_capture"
    echo "POLL=suite-pid-dead pid=$suite_pid"
    exit 0
  fi
  echo 'POLL=not-done'
  exit 0
fi
. "$suite_capture"
suite_exit=$(sed -n 's/^exit=//p' "$suite_exit_marker" | tail -1)
[ -n "$suite_exit" ] || suite_exit=1
# 真实结束时刻由 detached suite 在退出时刻写入 marker（gap-fan-in-suite-duration-poll-
# granularity-inflation）：等待块只读不重算 ⇒ wall_ms 不再含轮询发现延迟（round232 +65.1s 虚高）。
# 旧格式 marker 无 end_ms/end_iso ⇒ fallback 到 poll-discovery 时刻（backward compat，不报错）。
marker_end_ms=$(sed -n 's/^end_ms=//p' "$suite_exit_marker" | tail -1)
marker_end_iso=$(sed -n 's/^end_iso=//p' "$suite_exit_marker" | tail -1)
end_ms=\${marker_end_ms:-$(date +%s%3N)}
end_iso=\${marker_end_iso:-$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)}
wall_ms=$(( end_ms - \${start_ms:-0} ))
load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
# AC3 记录面真实化 (gap-suite-concurrency-ff-gate-and-slot-ssot): lane_count 取 suite 日志的
# __GROUP__ concurrency= 行（真实 lane, measure-suite-reporter 每 phase 一行; 主 phase 跑最后 ⇒
# 取最后一行 = 套件真实 lane）。旧实现记 nproc（实跑 concurrency=8 记成 16 — 记录面伪造）。
# 日志缺失/无 __GROUP__ 行 ⇒ fallback nproc（向后兼容, 不报错）。
lane_count=1
if [ "$full_suite_ran" = "true" ]; then
  lane_count=$(grep -oE '__GROUP__ concurrency=[0-9]+' "$suite_log_file" 2>/dev/null | tail -1 | grep -oE '[0-9]+$' || true)
  [ -n "$lane_count" ] || lane_count=$(nproc 2>/dev/null || echo 1)
fi
cpu_s=null
cpu_source=not-wired
cpu_user_s=null
cpu_sys_s=null
if [ "$full_suite_ran" = "true" ] && [ -f "$suite_time_file" ]; then
  cpu_user=$(tail -1 "$suite_time_file" 2>/dev/null | awk '{printf "%.3f", $1}' || true)
  cpu_sys=$(tail -1 "$suite_time_file" 2>/dev/null | awk '{printf "%.3f", $2}' || true)
  cpu=$(tail -1 "$suite_time_file" 2>/dev/null | awk '{printf "%.3f", $1+$2}' || true)
  if [ -n "$cpu" ] && [ "$cpu" != "0.000" ]; then
    cpu_s=$cpu
    cpu_source=gnu-time
    # gap-verification-round-cpu-split-not-recorded AC1/AC3 — the SAME gnu-time "%U %S" line split into
    # its user/sys columns (cpu_time_s = their sum). 0.000 components stay 0.000 (the writer normalizes
    # 0 → omitted, AC6); a missing column reads as 0.000 by awk. Real gnu-time output, never estimated.
    cpu_user_s=$cpu_user
    cpu_sys_s=$cpu_sys
  fi
fi
printf 'cpu_s=%s\\ncpu_source=%s\\ncpu_user_s=%s\\ncpu_sys_s=%s\\nend_iso=%s\\nend_ms=%s\\nwall_ms=%s\\nload=%s\\nlane_count=%s\\nsuite_exit=%s\\n' \\
  "$cpu_s" "$cpu_source" "$cpu_user_s" "$cpu_sys_s" "$end_iso" "$end_ms" "$wall_ms" "$load" "$lane_count" "$suite_exit" >> "$suite_capture"
# gap-verification-round-static-fail-no-record AC1/AC2 — a RED suite (suite_exit != 0) must ALSO write a
# verification-round record (state=red + reason + failures + taskId) so the /tests ledger is not blind to a
# failed round (previously only the green path wrote). Best-effort: a write failure is WARNed, never blocks
# the suite-red verdict (the Fix agent still gets dispatched by the主循环).
if [ "$full_suite_ran" = "true" ] && [ "$suite_exit" != "0" ]; then
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/pre-verified-round-record.ts \
    --task-id ${task} --run-id ${runId} --started-at "$start_iso" --duration-ms "$wall_ms" \
    --lane-count "$lane_count" --load "$load" --commit "$suite_head" --preverified 0 --state red \
    --root ${worktree} \
    --suite-log "$suite_log_file" --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" \
    --cpu-user-s "$cpu_user_s" --cpu-sys-s "$cpu_sys_s"; then
    echo "WARN: verification-round red-record 入账失败（不挡 suite-red 判定 / Fix agent 派发）" >&2
  fi
fi
echo "POLL=done SUITE_EXIT=$suite_exit"`

// 等待块的内部输出语义（阶段 2 prompt 里跟随在 ${SUITE_WAIT_BASH} 之后说明；不是 agent 的最终返回）：
//   返回 { done: bool（POLL=done ⇒ true）, suiteExit: int|null }。marker 存在但读不出 suite_exit ⇒
//   done=true, suiteExit=null（fail-closed，阶段 2 按非绿处理）。

// ── 重试循环：阶段 1（预备+启动 suite）→ 阶段 2（单 agent 回合内循环 <600s Bash 等 suite + 机械步骤）──
// suite 红 ⇒ Fix agent 重启动 detached suite 后重派阶段 2（有界 maxFixRounds）。ff 失败（develop 前进）⇒
// 回阶段 1 重跑（有界 maxFfRetries）。等待由阶段 2 agent 承担（gap-subagent-turn-budget-13min-falsified）。
phase('FanIn')
let finalResult = null
let ffAttempts = 0
while (finalResult == null) {
  const prep = await agent(
    `你是 fan-in 执行 subagent（阶段 1/2：无锁段预备 + 启动 suite）。任务 ${task} 的 fan-in 分两阶段完成：
- 阶段 1（你，本轮）：无锁段 step 0-4 —— merge develop → delta 断言面判定 → ts-typecheck → scoped 门 + doc 检查 → 启动全量 suite（detached，立即返回，【不等它】）。
- 阶段 2（后续 agent，suite 绿后）：step 4.5 per-task-suite 入账 + 持锁段（flip done → fan-in-ff-merge.sh → bracket close）。
⛔ 你在本回合【不等待 suite】——suite 以 detached 方式启动（setsid + & + disown = 长生命周期载体），你启动 + 短促确认后立即返回；等待由阶段 2 agent 在本回合内多次 <600s Bash 循环承担（Bash 单次 600s 硬顶 + suite 实测 19+ min，需跨多次调用等待；gap-subagent-turn-budget-13min-falsified 证伪「subagent 回合预算超时」）。

执行上下文（你直接使用，无需探查）：
- 任务 worktree（你的工作目录，所有代码操作都在这里）：${worktree}
- 主检出（develop / merge target 所在的 checkout，fan-in-ff-merge.sh 的 --root）：${root}
- merge target（ff 目标分支）：${mergeTarget}
- runId：${runId ? runId : '（无，ff 时省略 --run-id）'}

步骤（严格按序；每步都先 cd ${worktree} 或显式用 -C）：

【重试遗留翻转处理（gap-fan-in-turn-budget-suite-timeout，在 step 0 自举检查之前）】
# 若上一次 ff 失败重试，tasks/${task}.md 可能已被阶段 2 翻成 done。先精确 revert 回 ready
# （仅当存在精确 'status: done' 行；正常首轮为 ready ⇒ 本步 no-op）：
if grep -q '^status: done$' tasks/${task}.md; then
  sed -i 's/^status: done$/status: ready/' tasks/${task}.md
  git add tasks/${task}.md && git commit -- tasks/${task}.md -m "tasks: revert ${task} done→ready（ff 失败重试，fan-in 重跑）"
  echo "STALE_FLIP_REVERTED=1"
fi

【无锁段 step 0 — fan-in 编排自举检查（gap-fan-in-orchestration-bootstrap-self-fix）】
# 自举判定：本分支是否修改了 fan-in 编排文件自身（fan-in-execute.js / select-static-checks-for-
# touches.ts / fan-in-ff-merge.sh / per-task-suite-record.ts / full-suite-runner.ts）？命中 ⇒ 本任务的
# fan-in 必须用自己的修复被验证 ⇒ 后续每个编排脚本调用一律显式从 ${worktree} 解析（不依赖 cwd、
# 不用 ${root}）。检测机件 = select-static-checks-for-touches.ts --bootstrap-orchestration（同一文件
# 集合，单一来源，不在本 prompt 复制清单）。
bootstrap_fork=$(git -C ${worktree} merge-base ${mergeTarget} HEAD 2>/dev/null || true)
bootstrap_delta=$(git -C ${worktree} diff --name-only "$bootstrap_fork" HEAD 2>/dev/null || true)
bootstrap_hit=""
if [ -n "$bootstrap_delta" ]; then
  bootstrap_hit=$(node --experimental-strip-types ${worktree}/plugin/scripts/select-static-checks-for-touches.ts --bootstrap-orchestration --root ${worktree} $bootstrap_delta 2>/dev/null || echo "__BOOTSTRAP_CLASSIFY_FAILED__")
fi
if [ -n "$bootstrap_hit" ]; then
  echo "FAN-IN-BOOTSTRAP=hit（本分支修改 fan-in 编排文件：）"
  echo "$bootstrap_hit"
  echo "⇒ 编排脚本一律从 worktree 解析"
  # 自举同步（gap-bootstrap-worktree-stale-fan-in-execute，AC1）：worktree fork 可能早于某些 fan-in
  # 编排修复 land（实证 full-suite-state-stale 的 worktree fork e29e5de9 < poll-bounded 23a75eba ⇒ 其
  # fan-in-execute.js 缺 timeout 540 阻塞等待）。在 merge develop（step 1）前【先同步】：git merge
  # ${mergeTarget} 把最新 develop 编排修复合入 worktree（保留本分支自己的修改——自举 self-validation 语义）。
  # 冲突 ⇒ 脚本 abort 并留干净工作树（step 1 的 merge 会再撞并慢慢解）；脏树/ref 缺失 ⇒ skip（step 1
  # 处理）。幂等：派发侧已合 ⇒ "Already up to date"。脚本从 worktree 解析（本分支自带此模式，先于 land），
  # root 兜底（fork 早于本模式 land 的 worktree 自身跑不了它）。
  sync_helper="${worktree}/plugin/scripts/select-static-checks-for-touches.ts"
  [ -f "$sync_helper" ] || sync_helper="${root}/plugin/scripts/select-static-checks-for-touches.ts"
  node --experimental-strip-types "$sync_helper" --bootstrap-sync --worktree ${worktree} --merge-target ${mergeTarget} --root ${root} 2>&1 || echo "FAN-IN-BOOTSTRAP-SYNC-FAILED rc=$?"
  # 自举警示（取假一能取假）：同步后若 worktree 与主检出的 fan-in-execute.js 仍不一致 ⇒ 本分支修改了它
  # ⇒ 自举要求派发用 worktree 版 scriptPath（若本次派发误用了主检出版，本任务对 fan-in-execute.js 的
  # 修复未被自己验证）。同步已让未修改的 fan-in-execute.js 与主检出一致 ⇒ 此警示只在本分支确实改了它时触发。
  if [ -f "${worktree}/plugin/workflows/fan-in-execute.js" ]; then
    if ! cmp -s "${worktree}/plugin/workflows/fan-in-execute.js" "${root}/plugin/workflows/fan-in-execute.js" 2>/dev/null; then
      echo "FAN-IN-BOOTSTRAP-WARN: worktree 与主检出的 fan-in-execute.js 不一致（本分支修改了它 ⇒ 须用 worktree 版 scriptPath；若派发误用主检出版，本任务修复未被自己验证）" >&2
    fi
  fi
else
  echo "FAN-IN-BOOTSTRAP=miss（本分支未修改 fan-in 编排文件，编排脚本从主检出解析）"
fi

【无锁段 step 1 — merge develop】
cd ${worktree} && git merge ${mergeTarget}
—— 冲突【只可能在这】出现：慢慢解，不占任何人（AC75：必须 merge 不得 rebase）。解完 git add + git commit。
# anti-drift-block-start
# anti-drift-touches 守卫（gap-anti-drift-touches-zero-coverage-fast-mode）：merge 后立即用【实际 diff】
# （git diff --name-only ${mergeTarget}...HEAD = fan-in 将要 land 的文件）对照声明 Touches 做事后核对。
# 越界触碰 / 声明过宽 ⇒ HARD FAIL（非建议）；判定逻辑在 anti-drift-touches-check.ts（本步即其 driver
# 输入面：--task --worktree --merge-target），不改判定逻辑，只喂实际 diff + 声明 Touches。
if ! node --experimental-strip-types ${worktree}/plugin/scripts/anti-drift-touches-check.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}; then
  echo "FATAL: anti-drift-touches HARD FAIL——实际触碰超出声明 Touches（或声明过宽）⇒ 不翻 done、不 ff；不得改 Touches 绕过守卫" >&2
  exit 2
fi
# anti-drift-block-end

【无锁段 step 2 — delta 断言面判定（AC75 + gap-fan-in-delta-scope-doc-only-skip）】
# delta 看【分支整体相对 develop 的变更】，不是单轮 develop-side delta——代码经更早分支历史静默进
# develop（AC97：fae3322f 改 serve-handlers.ts 在分支，fan-in 最终合并时单轮 develop-side delta 只见
# 5 个 tasks/*.md ⇒ 旧闸门判 doc-only 跳过全量）必须被判为需全量。语义：merge-base 之后 HEAD（分支）
# 相对 develop 引入的全部文件 = fan-in 将 land 的全部文件（与 anti-drift Touches 核对同源）。
fork=$(git -C ${worktree} merge-base ${mergeTarget} HEAD)
delta=$(git -C ${worktree} diff --name-only "$fork" HEAD 2>/dev/null || true)
# 承重点①（gap-fan-in-execute-three-unverified-paths + gap-fan-in-delta-scope-doc-only-skip）：
# doc 判定用【可计算定义】（select-static-checks-for-touches.ts --classify-delta：解析 scripts/test.sh
# 里每个 change/full 层检查器的 @static-object 声明 = 检查器读的路径集合；delta ∩ 该集合 = ∅ 且落在
# 任务体/doc/telemetry 面才 doc，非手写正则表；orchestration/*-tick-core.md 被 tick-core-static-check
# 等读取 ⇒ 非 doc）。判错 ⇒ 该跑全量却跳过（漏检）或该跳却重跑（浪费）。改此行必须同步
# plugin/test/fan-in-execute-paths.test.mjs。分类脚本失败 ⇒ fail-closed（判不出 ≠ 不需要）。
# 自举（gap-fan-in-orchestration-bootstrap-self-fix）：classify 脚本与 registry（--root）都从 worktree
# 解析（非 cwd、非 ${root}）——本任务若修改了 select-static-checks-for-touches.ts / scripts/test.sh 的
# @static-object 注解，其 fan-in 必须用自己的版本判定（取假二：旧正则判 doc、worktree 版判 code）。
code_delta=$(node --experimental-strip-types ${worktree}/plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root ${worktree} $delta) || code_delta="__CLASSIFY_FAILED__"
# suite 等待（gap-fan-in-turn-budget-suite-timeout / gap-subagent-turn-budget-13min-falsified）：把
# code_delta 落盘，step 4 的 suite 启动块据此判定（bash 变量不跨 Bash 调用持久）。
printf '%s' "$code_delta" > /tmp/fan-in-code-delta-${task}.txt
判定：
  - code_delta 非空 ⇒ 分支整体变更触及代码/脚本/测试断言面（或被检查器读取的路径）⇒ 本回合【要】重跑全量 suite。
  - code_delta 为空且 delta 非空 ⇒ delta 全落 doc/任务体/telemetry 面 ⇒ 跳过全量 suite（只跑 doc 检查）。
  - 无法判定（分类脚本失败 / git merge-base 失败）⇒ fail-closed：重跑全量 suite（硬规则 3b：判不出≠不需要）。
把 code_delta 记下来（返回时上报）。

【无锁段 step 3 — ts-typecheck 闸】
cd ${worktree} && node --experimental-strip-types ${worktree}/plugin/scripts/fan-in-ts-typecheck-gate.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}
  —— 闸自己判定 Touches 是否含新增/移动 .ts（无则直接 exit 0）。exit 非 0 ⇒ 丢弃 worktree 内未合状态、
     标 needs-human、停止本 tick 合并与派发——不要继续启动 suite、不要 ff。

【无锁段 step 4 — scoped 门 + doc 检查 + 全量 suite 启动（detached，不等待）】
cd ${worktree} && bash scripts/test.sh --for-task ${task} --allow-thin
  —— scoped 门，必须绿；非绿 ⇒ 修到绿再继续。
cd ${worktree} && bash scripts/test.sh --static-checks-doc
  —— doc 检查（ff 不触发任何钩子，AC63）；必须绿。
# suite-launch-block-start
# 全量 suite 启动（gap-fan-in-turn-budget-suite-timeout）：把 suite 交给长生命周期载体（detached
# setsid 进程，subagent 退出不影响它），不在本回合等待。⛔ 禁止 Bash(run_in_background:true)
# （subagent 退出时被 harness 连带杀掉，execute-suite-fix.js 实证 runId f6b824b5）；⛔ 禁止前台
# bash scripts/test.sh（suite 19+ min > Bash 单次 600s 硬顶）。等待由阶段 2 agent 在本回合内多次
# <600s Bash 循环承担（gap-subagent-turn-budget-13min-falsified）。本块判定依据
# /tmp/fan-in-code-delta-${task}.txt（step 2 落盘）：非空 ⇒ 启动全量 suite；空 ⇒ 跳过（doc-only）；
# 已有 pre-verified capture ⇒ 复用。
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_head_now=$(git -C ${worktree} rev-parse HEAD 2>/dev/null || echo unknown)
code_delta=$(cat /tmp/fan-in-code-delta-${task}.txt 2>/dev/null || true)
suite_preverified=0
if [ -f "$suite_capture" ] && grep -q '^full_suite_ran=true$' "$suite_capture" && grep -q '^suite_exit=0$' "$suite_capture" && grep -q "^suite_head=$suite_head_now$" "$suite_capture"; then
  echo "PRE-VERIFIED-SUITE: capture 已存在且 suite_head=$suite_head_now 与当前 worktree HEAD 一致（full_suite_ran=true, suite_exit=0）⇒ 跳过全量重跑"
  printf 'suite_preverified=1\\n' >> "$suite_capture"
  suite_preverified=1
fi
if [ "$suite_preverified" = "1" ]; then
  echo "SUITE_OUTCOME=preverified"
elif [ "$code_delta" != "" ]; then
${SUITE_LAUNCH}
  echo "SUITE_OUTCOME=started"
  # 短促确认（~3s）：suite 应已在跑（exit marker 未出现）；若 marker 立刻出现 ⇒ 瞬间崩，脚本轮询会读到。
  sleep 3
  if [ -f "$suite_exit_marker" ]; then echo "SUITE_NOTE=exit-marker-already-present(instant-crash)"; fi
else
  suite_start_iso=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  suite_load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
  # gap-fan-in-suite-log-cross-relaunch-reuse: doc-only 轮也轮转旧日志 + 打 skipped 标记——本轮的
  # /tmp/fan-in-suite-<task>.log 不得残留上一轮全量 suite 的内容（读者按标记切片会读到 round=skipped）。
  if [ -f "$suite_log_file" ]; then mv -f "$suite_log_file" "\${suite_log_file}.prev" 2>/dev/null || true; fi
  printf '__FANIN_SUITE_START__ iso=%s ms=%s head=%s round=skipped\\n' "$suite_start_iso" "$suite_start_ms" "$suite_head_now" > "$suite_log_file"
  printf 'full_suite_ran=false\\nskip_reason=doc-only-delta\\ncpu_s=null\\ncpu_source=not-wired\\nstart_iso=%s\\nend_iso=%s\\nwall_ms=0\\nload=%s\\nlane_count=1\\nsuite_exit=0\\nsuite_head=%s\\n' \\
    "$suite_start_iso" "$suite_start_iso" "$suite_load" "$suite_head_now" > "$suite_capture"
  echo "SUITE_OUTCOME=skipped"
fi
# suite-launch-block-end
—— scoped 门 / doc / suite 启动任一失败 ⇒ 修复并重跑对应项（suite 启动失败指 detached 进程未起）；
   全绿（或已 detached 启动）才返回阶段 1。

返回 { outcome: 'suite-started' | 'suite-skipped' | 'suite-preverified' | 'needs-human' | 'red', suitePid, codeDelta, worktreeHead, note }。
outcome=needs-human 仅当冲突解不了 / ts-typecheck 阻断 / scoped 门或 doc 修不到绿（返回前已尽力）。outcome=red = 其它失败。
suite-started ⇒ 全量 suite 已 detached 启动（脚本控制流将轮询等它，你已返回，不等）。
suite-skipped ⇒ code_delta 空（doc-only），capture 已写 skip_reason=doc-only-delta。
suite-preverified ⇒ 复用了调用方回合外已跑绿的 capture（已追加 suite_preverified=1）。
codeDelta = step 2 记下的 code_delta。worktreeHead = 当前 worktree HEAD（git rev-parse HEAD）。`,
    {
      schema: {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          suitePid: { type: 'number' },
          codeDelta: { type: 'string' },
          worktreeHead: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['outcome'],
      },
    }
  )
  log(`FanIn prep: outcome=${prep.outcome} suitePid=${prep.suitePid ?? '?'} codeDelta=${(prep.codeDelta ?? '').slice(0, 40) || '(empty)'} note=${prep.note ?? ''}`)

  if (prep.outcome === 'needs-human' || prep.outcome === 'red') {
    return { outcome: prep.outcome, ffOk: false, task, message: `fan-in prep failed for ${task}: ${prep.note ?? prep.outcome}` }
  }
  if (!['suite-started', 'suite-skipped', 'suite-preverified'].includes(prep.outcome)) {
    return { outcome: 'red', ffOk: false, task, message: `fan-in prep returned unexpected outcome: ${prep.outcome}` }
  }

  // ── 阶段 2：单 agent 循环等 suite + 机械步骤（suite 红 ⇒ suite-red，脚本派 Fix agent 重派阶段 2）──
  // gap-subagent-turn-budget-13min-falsified：旧「脚本 setTimeout + 每轮起一个新短命轮询 agent」已删——
  // 阶段 2 agent 在本回合内循环 <600s Bash 等 suite（等待块在下方 prompt 顶部）。
  const suiteNeedsWait = prep.outcome === 'suite-started'
  let stage = null
  let fixRounds = 0
  while (true) {
    stage = await agent(
    `你是 fan-in 执行 subagent（阶段 2：等 suite + 入账 + 持锁段）。任务 ${task} 的 suite 已以 detached 方式启动（或 suite-skipped / suite-preverified）；你在【本回合内】等 suite（多次 <600s Bash 循环），suite 绿后执行机械步骤。以下所有上下文已逐字内联，不需要询问任何人，也不要引用「上一条消息」。

${suiteNeedsWait ? `【等待 suite（单 agent 循环多次 <600s Bash，不每轮起新 agent）】
任务 ${task} 的 suite 以 detached 方式运行（setsid+&+disown，SUITE_LAUNCH）。你在本回合内等它：运行下面
的【等待块】（自足 bash，单次有界阻塞等待最多 ${pollBlockSeconds}s < Bash 600s 硬顶；gap-subagent-turn-
budget-13min-falsified：无 subagent 回合预算超时）。运行后看输出：
  - POLL=not-done ⇒ 再运行一次同一等待块（最多 ${maxSuitePolls} 次，每次独立 Bash 调用，单次 < 600s）。
  - POLL=done SUITE_EXIT=N ⇒ 停止等待，按 N 分支：N=0 ⇒ 继续机械步骤；N!=0 ⇒ 直接返回
    { outcome:'suite-red', suiteExit:N }（不执行机械步骤，等待 Fix agent 修复后重派你）。
  - POLL=suite-pid-dead ⇒ suite 进程在写 .exit 前静默死亡（kill -0 核验失败，非正常退出）⇒ 立即返回
    { outcome:'suite-pid-dead', suiteExit:null }（不执行机械步骤、不再空转——等待主循环派 Fix agent 重新启动 suite）。
⛔ 单次 Bash 调用不得超过 600s——上面的 timeout ${pollBlockSeconds} 已是硬边界，绝不自行加大等待。
⛔ 不要做任何等待决策——每次等待的时长由上面的 timeout ${pollBlockSeconds} 硬边界决定、循环次数由最多
${maxSuitePolls} 次决定；你只是重跑同一个固定命令，绝不自行选择等待更久/更短。
⛔ 若某次 Bash 调用被中断/超时 kill（工具报错而非 POLL 输出），suite 仍在 detached 跑——照常再运行一次
同一等待块，直到 POLL=done 或达到最多 ${maxSuitePolls} 次。
${SUITE_WAIT_BASH}
返回 { done: bool（POLL=done ⇒ true）, suiteExit: int|null }（等待块的内部输出语义，不是你的最终返回——
你的最终返回见文末 schema）。若 ${maxSuitePolls} 次后仍 POLL=not-done ⇒ 返回 { outcome:'suite-not-done', suiteExit:null }（不执行机械步骤）。收到 POLL=suite-pid-dead ⇒ 立即返回 { outcome:'suite-pid-dead', suiteExit:null }（不执行机械步骤、不再空转——等待主循环派 Fix agent 重新启动 suite）。`
: `（suite 已 skipped / preverified —— capture 已含 suite_exit，无需等待，直接执行机械步骤。）`}

执行上下文（你直接使用，无需探查）：
- 任务 worktree（你的工作目录，所有代码操作都在这里）：${worktree}
- 主检出（develop / merge target 所在的 checkout，fan-in-ff-merge.sh 的 --root）：${root}
- merge target（ff 目标分支）：${mergeTarget}
- runId：${runId ? runId : '（无，ff 时省略 --run-id）'}
- codeDelta（step 2 上报，最终返回时带上）：${prep.codeDelta ?? ''}

步骤（严格按序；每步都先 cd ${worktree} 或显式用 -C）：

【无锁段 step 4.4 — 写 impl-complete 事件（幂等回退；gap-inflight-states-missing-impl-complete-event / gap-impl-complete-event-written-by-fan-in-not-build）】
# impl-complete-block-start
# 第三个生命周期事件把 start→end 拆成 start→impl-complete（实现）与 impl-complete→end（待落地）
# 两段——Build 派发读前者、落地单飞读后者（不再读 worktree）。**PRIMARY 写入方是 Build subagent
# 完成时**（gap-impl-complete-event-written-by-fan-in-not-build：Build 完成即写，排队待 fan-in 的
# 任务不占 Build 槽）；本步是**幂等回退**——Build 路径已写 ⇒ fast-mode-telemetry 的
# hasImplCompleteEvent 跳过重写（ff-retry 重跑 phase 2 同幂等）；Build 路径漏写（异常）⇒ 本步补写。
# runId 为空（未走 --task-start 留痕）⇒ 跳过。|| true：回退是 best-effort，不因漏写拦 fan-in。
if [ -n "${runId}" ]; then
  # gap-wiring-A-fan-in-execute-suite-poller-impl-complete：诚实报告写入路径——Build 已写 ⇒ 幂等跳过
  # （IMPL-COMPLETE=build-wrote，正常主路径）；本步实际写入 ⇒ Build 漏写（IMPL-COMPLETE=backstop-wrote，
  # ⚠️ 异常路径——事件在 suite-green 时刻写入，字段语义退化为「suite 完成」；派发 brief 已要求 Build
  # 完成时调用 --impl-complete，此路径应只出现在 Build 未遵循派发词约定的异常）。|| true：回退是
  # best-effort，不因漏写拦 fan-in。
  ic_out=$(node --experimental-strip-types ${worktree}/plugin/scripts/fast-mode-telemetry.ts --impl-complete --taskId ${task} --runId ${runId} --root ${root} 2>&1) || ic_out="\${ic_out:-IMPL-COMPLETE-BACKSTOP-FAILED}"
  case "$ic_out" in
    *"already marked impl-complete"*) echo "IMPL-COMPLETE=build-wrote（幂等跳过——Build 完成时已写）";;
    *"impl-complete event written"*) echo "IMPL-COMPLETE=backstop-wrote（⚠️ Build 未写，异常路径：事件在 suite-green 时刻写入）";;
    *) echo "IMPL-COMPLETE=unknown ($ic_out)";;
  esac
fi
# impl-complete-block-end

【无锁段 step 4.5 — per-task-suite 入账（全绿后；跳过也写）】
# suite-record-block-start
# per-task-suite 入账（gap-fan-in-suite-data-not-accounted）：每次 fan-in 写一条——含跳过全量。
# 读 step 4 捕获值；追加到【共享检出】.quay/per-task-suite-records.jsonl（本 writer 经 git common-dir
# 从 worktree 解析主检出，不写 worktree 的 fork 副本——AC72 判据2 eac3ee98 现象）。
# 写失败/读失败 ⇒ HARD FAIL：入账是 AC1 判据1 义务，不是可跳过的最佳努力。
suite_capture="/tmp/fan-in-suite-${task}.env"
if [ ! -f "$suite_capture" ]; then
  echo "FATAL: per-task-suite 捕获文件缺失（step 4 未跑 suite？）⇒ 不翻 done、不 ff" >&2
  exit 2
fi
. "$suite_capture"
if [ -n "$skip_reason" ]; then
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/per-task-suite-record.ts \
    --task-id ${task} --run-id ${runId} --state green --lane-count "$lane_count" \
    --duration-ms "$wall_ms" --started-at "$start_iso" --finished-at "$end_iso" \
    --doc-checked true --doc-check-exit 0 \
    --full-suite-ran "$full_suite_ran" --skip-reason "$skip_reason" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" \
    --cpu-user-s "$cpu_user_s" --cpu-sys-s "$cpu_sys_s" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
else
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/per-task-suite-record.ts \
    --task-id ${task} --run-id ${runId} --state green --lane-count "$lane_count" \
    --duration-ms "$wall_ms" --started-at "$start_iso" --finished-at "$end_iso" \
    --doc-checked true --doc-check-exit 0 \
    --full-suite-ran "$full_suite_ran" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" \
    --cpu-user-s "$cpu_user_s" --cpu-sys-s "$cpu_sys_s" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
fi
# verification-round / full-suite-state / measure-history 入账（gap-fan-in-red-bucket-run-not-recorded
# AC1/AC2）：已由 SUITE_LAUNCH 的 full-suite-runner.ts --buckets 统一写入（green+red 皆入账）——runner 是
# verification-round.jsonl / full-suite-state.json / measure-history.jsonl / suite-load-<runId>.jsonl 的唯一
# writer。旧的三段 mirror 写（pre-verified-round-record / mirror-full-suite-state / mirror-measure-history）
# 是「绕开 runner 的平行 harness」的嫁接，已删除（两套平行机制收敛为一）。red 桶轮次现在由 runner 在
# suite 退出时直接记 state=red 进 verification-round.jsonl（不再只在 green 分支事后补记）。doc-only 跳过
# （full_suite_ran=false）无 suite 可记账——runner 从未跑，各账本自然无新增。
# ⚠️ 本步【不】rm "$suite_capture"——ff 闸 (fan-in-ff-merge.sh AC1 收窄) 要读本任务 capture 的
# suite_exit/suite_head；capture 保留到 ff 之后（step 5 持锁段末）再清理（gap-suite-concurrency-
# ff-gate-and-slot-ssot）。旧实现在此删除 capture，ff 无证可查。
# suite-record-block-end

【持锁段 step 5 — flip done + ff-merge】
cd ${worktree}
# anti-drift-land-block-start
# anti-drift land 前重跑（gap-fan-in-fix-commit-delta-escapes-touches-coverage）：step 1 的 anti-drift
# 检查在 merge 后立即跑，而 fix-agent 的修复提交（suite 红 → suite-fix 补丁 commit → 重跑）发生在其后
# ——其触碰文件从未被 Touches 复核（实证：gap-worktree-remove-orphans-probes 的 fix commit c2917261 改了
# plugin/test/full-suite-runner.test.mjs 不在 Touches，已 land 才被发现）。此处【land 前】（持锁段、flip
# done 之前、ff 之前）重跑同一驱动——git diff --name-only ${mergeTarget}...HEAD 此刻已含 fix commits，
# 覆盖分支整体 delta（merge + fix）。判定逻辑与 step 1 同一驱动（anti-drift-touches-check.ts），只增
# 调用点不改判定（AC3）；正常 fan-in（无 fix commit 或 fix 全在 Touches 内）重跑幂等（AC2）。
if ! node --experimental-strip-types ${worktree}/plugin/scripts/anti-drift-touches-check.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}; then
  echo "FATAL: anti-drift land 前重跑 HARD FAIL——实际触碰超出声明 Touches（含 fix-agent 提交引入的文件）⇒ 不翻 done、不 ff；不得改 Touches 绕过守卫" >&2
  exit 2
fi
# anti-drift-land-block-end

【suite 绿后回勾依赖 suite/fan-in 结果的 AC/DoD 复选框（gap-fan-in-subagent-satisfy-then-check）】
本 fan-in 的 suite 已绿（或 preverified 复用绿）、anti-drift 已过 ⇒ 在运行下方 AC 完成闸（fan-in-ac-
completion-gate.ts，step 5 flip 块内）【之前】做「满足后勾框」收尾：编辑 tasks/${task}.md，把
【依赖 suite/fan-in 结果、且已被本次绿 suite / 完成的 fan-in 真实满足】的复选框从 '- [ ]' 勾为 '- [x]'
——典型如「全量 suite 绿」「真实 fan-in 走新路径绿」「tmux-leak-scan clean」「AC3: 真实 fan-in 一次」等，
条件已达，仅缺勾选动作。
⛔ 只勾【真满足】的框：任何条件【未满足】的复选框必须保持 '- [ ]' 未勾（fail-closed 语义不变）。
⛔ 绝不伪造勾选——本步是补齐「满足后勾框」的收尾动作，不是放宽 AC 完成闸（该闸仍要求全勾才翻 done）。

# flip-block-start
# flip done（承重点③，gap-fan-in-execute-three-unverified-paths）：行形不匹配 ⇒ 报错而非静默绿——
# sed 对不匹配行静默改 0 行且 exit 0；锚定 $ 只翻 frontmatter 的精确 'status: ready'，
# body 里 'status: ready——注解' 不误翻。前自检：恰 1 行精确匹配；后自检：'status: done' 存在。
flip_count=$(grep -c '^status: ready$' tasks/${task}.md || true)
if [ "$flip_count" != "1" ]; then
  echo "FATAL: flip 失败——tasks/${task}.md 应恰有 1 行精确 '^status: ready$'（frontmatter），实得 '$flip_count'；行形不匹配（前导空格/大小写/非首行/body 也有精确行）⇒ 不静默翻 done" >&2
  exit 2
fi
# AC 完成闸（gap-fan-in-flip-no-ac-completion-check）：翻转前跑 AC47 谓词（countCompletionCheckboxes /
# isLandedCodeComplete，同源不新造）——AC 未全勾（剩余含非待外部项）或 AC/DoD 段缺失（NOT-EVALUATED，
# 硬规则 3b：无法评估 ≠ 合格）⇒ 不翻 done。与承重点③ 行形检查并列，两检查都过才翻。
if ! node --experimental-strip-types ${worktree}/plugin/scripts/fan-in-ac-completion-gate.ts --task ${task} --worktree ${worktree}; then
  echo "FATAL: flip 拒绝——tasks/${task}.md AC 完成闸未通过（AC 未全勾或段缺失）⇒ 未翻 done" >&2
  exit 2
fi
sed -i 's/^status: ready$/status: done/' tasks/${task}.md
if ! grep -q '^status: done$' tasks/${task}.md; then
  echo "FATAL: flip 后校验失败——tasks/${task}.md 无精确 '^status: done$' 行" >&2
  exit 2
fi
# flip-block-end
git add tasks/${task}.md && git commit -m "tasks: 翻 ${task} done（AC78 fan-in-execute workflow）"
—— 先 flip 后 merge（人 2026-08-14 裁定：flip 要动的记录也用 git 跟踪；flip 在后则 merge 后还要再修改+merge）。
# 自找你的 agent 标识（判据6：不由调用方填值、不给示例值）——定位你自己的 transcript：
#   你的 transcript 此刻正在被写入的落点 = ~/.claude/projects/<project>/<session>/subagents/workflows/<本次 run>/agent-<自己>.jsonl
#   （workflow-run 子代理真实落点——本 workflow 由 agent() 派发你 ⇒ 你的文件必在这里）。
#   承重点②（gap-fan-in-execute-three-unverified-paths）：只查 workflows/<run>/ 落点，不扫平铺 subagents/——
#   平铺里有别的（实现/核查）子代理，并发下 ls -t + grep 任务名会误选（DIR-127/DIR-128 实证：
#   DIR-127 ff 取到 DIR-128 实现者 a017ce6b）。当前 run 正在被写入 ⇒ 在提到本任务的所有 workflow-run
#   子代理中它必然最近修改 ⇒ 确定性取最新；候选为零 ⇒ fail-closed（不猜）。
# selfloc-block-start
candidates=$(grep -l '${task}' ~/.claude/projects/*/*/subagents/workflows/*/agent-*.jsonl 2>/dev/null)
count=$(printf '%s\\n' "$candidates" | grep -c . || true)
if [ "$count" -eq 0 ]; then
  echo "FATAL: 未能定位自身 subagents/workflows/<run>/agent-<自己>.jsonl（--agent-id 不能由调用方填）" >&2
  exit 2
fi
self=$(printf '%s\\n' "$candidates" | xargs ls -t 2>/dev/null | head -1)
if [ -z "$self" ]; then
  echo "FATAL: 无法确定自身 transcript 文件（候选：$candidates）" >&2
  exit 2
fi
agent_id=$(basename "$self" .jsonl 2>/dev/null | sed 's/^agent-//')
if [ -z "$agent_id" ]; then echo "FATAL: 未能从 $self 提取 agent id（--agent-id 不能由调用方填）" >&2; exit 2; fi
# selfloc-block-end
node --experimental-strip-types ${worktree}/packages/quay/src/fan-in/ff-merge.ts --task ${task} --run-id ${runId} --agent-id "$agent_id" --root ${root} --merge-target ${mergeTarget} --worktree ${worktree} --lock-wait ${mergeLockWaitSecs} --token "$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo fan-in-fallback-token)"
ff_rc=$?
# 本任务 suite capture 的使命已尽（ff 闸已在 ff-merge.ts 内读过它）——清理掉；若 ff 失败重试，
# step 4 会重写新 capture（gap-suite-concurrency-ff-gate-and-slot-ssot）。不在此 exit：step 5.5（仅 ff
# 成功时执行）与清理仍需按序运行。ff_rc 由你在返回时上报（0=green, 1/3=ff-retry, 2=red）。
rm -f "$suite_capture" 2>/dev/null || true
  —— 锁只包 git merge --ff-only，毫秒级，成/败都解锁。ff 失败（develop 前进了，窗口 = merge 到 ff 之间
     的整个 suite 时长）⇒ 返回 { outcome: 'ff-retry' }（脚本将回阶段 1 重跑：重 merge develop、重判 delta、
     重跑 suite、重 ff），同一任务 ff 失败 ≥3 次才谈防活锁（脚本侧 maxFfRetries 兜底）。ff 成功（exit 0）
     后才执行 step 5.5；ff 失败（exit 1/3）⇒ 不执行 step 5.5。exit 2（usage/env）⇒ outcome='red'。

【持锁段 step 5.5 — 关闭本任务的 telemetry bracket（仅 ff 成功后）】
# bracket-close-block-start
# gap-fan-in-auto-close-telemetry-bracket (occurrence 3: ac76/ac81+touches/ac85 land 后留 stale bracket):
# dispatch 的 --task-start 从不在 land 时闭合 ⇒ 每次 land 留一个 stale bracket（reconcile_compliant=false）
# 直到下一次手动/外层 --reconcile。ff 已成功（${mergeTarget} 已 ff 到 task/${task} tip）⇒ 本任务 executor
# observably done ⇒ 经 closure-lag-check.sh --close-task（A16 统一闭合点）写 --task-end done。
# 只关【本任务】的 bracket（--taskId ${task} 在 telemetry report 的 inProgress[] 按 taskId 定位 runId）——
# 绝不 --reconcile 全局扫（判据2 能取假：在飞任务/未 land 任务的 bracket 必须保留）。
# 幂等：无 open bracket（已闭合/从未 --task-start）⇒ --close-task exit 0，无写入。
if ! bash ${worktree}/plugin/scripts/closure-lag-check.sh --close-task --taskId ${task} --outcome done --root ${root}; then
  echo "FATAL: telemetry bracket 闭合失败（${task} ff 已成功但 --close-task 非 0）——landing 完成但 bracket 未闭合（stale bracket 将留到下一轮 reconcile）" >&2
  exit 1
fi
# bracket-close-block-end

【持锁段 step 5.5b — 补写 complete pass GateEvent（仅 ff 成功后）】
# complete-gate-event-block-start
# gap-complete-gateevent-coverage-has-a-residual-gap（残留缺口，逐条追因见任务体 ## Finding）：
# 本 workflow 的 flip 块（上方 sed -i s/^status: ready$/status: done/）此前【只翻 status + commit】，
# 全文零 GateEvent ⇒ 这条落地路径的每一次 done 在生产载体 .quay/gate-events.jsonl 上都不留痕。
# 实测（09-04~09-14，git log develop × carrier 按【落地】= 每任务最后一次翻 X done 提交 join）：
#   机械 fan-in 路径 386/388 有事件；本路径 2/2 无事件（0%）——即残留缺口里唯一【仍在生产的】那一条。
# 与机械 fan-in 的 9.4b 写侧同源：⛔ 不手搓 JSON，经 worker-driver.ts --append-complete-gate-event
# 调 appendCompleteGateEvent（内部就是 gate-event-store 的 appendGateEvent，与 CLI/loop 同一载体）。
# 只在 ff 成功后写（同机械路径：flip 先发生，ff 失败会 reset 回 ready ⇒ 那次不是落地，不该写事件）。
# actor 标 "quay-fan-in-workflow" 以区别于 "quay-driver"（机械路径）/"quay-cli"/"outer"。
# ⚠️ 写失败**不致命**（只告警、⛔ 不 exit）：与机械 fan-in 的 9.4b 逐字同款语义——那边
# appendCompleteGateEvent 的契约就是「best-effort：写失败返回 ok:false，不抛——fan-in 已 landed，
# 观测写不得阻塞主执行」。这里若改成 exit 1，就等于**只在兜底路径上**新增一条阻塞前置
# （硬规则 12：要求一个新前置之前先给出它的发生率——给不出就不作阻塞），且两条路径对同一个失败
# 给出相反后果。漏记不靠这一步静默：日覆盖率判据 gate-event-coverage-check 会在次日把它报出来
# （这正是它存在的理由），所以告警 + 可检测 = 该失败不可能与「一切正常」同形。
if ! node --no-warnings --experimental-strip-types ${worktree}/plugin/scripts/worker-driver.ts --append-complete-gate-event --task ${task} --root ${root} --actor quay-fan-in-workflow; then
  echo "WARN: complete GateEvent 补写失败（${task} ff 已成功但事件未落盘）——landing 照常完成；该漏记会由 gate-event-coverage-check 在次日覆盖率判据上报出（⛔ 不在此阻塞 landing，与机械 fan-in 的 best-effort 契约一致）" >&2
fi
# complete-gate-event-block-end

—— step 5.5 结果：exit 0 ⇒ bracket 已闭合（返回 note 标注 bracketClose=OK）。
    exit 1 ⇒ bracket 闭合失败（FATAL 已打印）——ff 已成功、task 已 done、landing 完成；
    【不得】重试 ff、【不得】把 outcome 判为失败/needs-human、【不得】跳过清理；
    照常执行下方清理，返回时 note 必须标注 bracketClose=FAILED（让外层可见闭合失败）。

ff 成功后清理（gap-worktree-remove-orphans-probes：拆除前先扫 worktree 路径下的活 claude-probe 探针 / 挂死 runner 并清理，防止 worktree 先删而子进程孤儿化）：
cd ${root}
reaper="${worktree}/plugin/scripts/worktree-process-reaper.ts"
[ -f "$reaper" ] || reaper="${root}/plugin/scripts/worktree-process-reaper.ts"
node --no-warnings --experimental-strip-types "$reaper" --worktree ${worktree} --root ${root} --json >/dev/null 2>&1 || true
git worktree remove ${worktree} --force && git branch -d task/${task}

返回 { outcome: 'green' | 'needs-human' | 'red' | 'ff-retry' | 'suite-red' | 'suite-pid-dead' | 'suite-not-done', ffOk, suiteExit, developHead, worktreeHead, agentIdUsed, codeDelta, note, bracketClosed }。
outcome=suite-not-done 仅当等待达到 ${maxSuitePolls} 次上限仍无 exit marker（不执行机械步骤，脚本 fail-closed 红）。outcome=suite-red 仅当 suite 退出码非 0（读等待块补全的 capture 的 suite_exit）——不执行机械步骤，脚本派 Fix agent 修复后重派你。outcome=suite-pid-dead 仅当 suite 进程在写 .exit 前静默死亡（等待块 kill -0 核验失败，无 exit marker）——不执行机械步骤，脚本派 Fix agent 重新启动 suite 后重派你。outcome=green 仅当 ff 成功（develop fast-forward 到 task tip）。outcome=ff-retry 仅当 ff 失败（develop 前进，exit 1/3）——脚本将回阶段 1 重跑，你【不得】重试 ff、【不得】执行 step 5.5。outcome=needs-human 仅当 flip/入账等持锁段前置失败（如 AC 闸拒绝/入账 HARD FAIL）。red = 其它失败。
bracketClosed = step 5.5 的闭合结果（true=已闭合 / false=闭合失败 / null=ff 未成功未执行 5.5）。
note 必须标注 bracketClose=OK 或 bracketClose=FAILED。`,
    {
      schema: {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          ffOk: { type: 'boolean' },
          suiteExit: { type: ['number', 'null'] },
          developHead: { type: 'string' },
          worktreeHead: { type: 'string' },
          agentIdUsed: { type: 'string' },
          codeDelta: { type: 'string' },
          note: { type: 'string' },
          bracketClosed: { type: 'boolean' },
        },
        required: ['outcome', 'ffOk'],
      },
    }
  )
  if (stage.outcome === 'suite-not-done') {
    return { outcome: 'red', ffOk: false, task, message: `fan-in suite did not finish within poll cap for ${task}` }
  }
  if (stage.outcome === 'suite-red' || stage.outcome === 'suite-pid-dead') {
    const pidDead = stage.outcome === 'suite-pid-dead'
    if (fixRounds >= maxFixRounds) {
      return { outcome: 'red', ffOk: false, task, message: pidDead
        ? `fan-in suite process died before exit marker after ${fixRounds} fix rounds — not landing`
        : `fan-in suite red after ${fixRounds} fix rounds (last exit ${stage.suiteExit}) — not landing` }
    }
    fixRounds++
    const fix = await agent(
      `${pidDead
        ? `你是 fan-in 执行 subagent（suite-relaunch 阶段）。任务 ${task} 的全量 suite 进程在写 .exit 前【静默死亡】（等待块 kill -0 核验失败，退出码未知——信号/OOM/异常，非正常退出；无 exit marker 可读）——`
        : `你是 fan-in 执行 subagent（suite-fix 阶段）。任务 ${task} 的全量 suite 上一轮退出码 ${stage.suiteExit}（RED）——`}你读失败日志、按 fix-scope gate 判红是否本任务 Touches 内回归，修根因、以 detached 方式重新启动 suite，然后【立即返回】（等待由阶段 2 agent 在本回合内多次 <600s Bash 循环承担，不在你本回合内等；gap-subagent-turn-budget-13min-falsified）。
执行上下文：
- 任务 worktree（你的工作目录）：${worktree}
- suite 日志：/tmp/fan-in-suite-${task}.log
- 上一轮 exit：${pidDead ? 'unknown（进程死亡，无 exit marker——读日志末段判因）' : stage.suiteExit}
${FIX_SCOPE_GATE}
任务：
1. 读 /tmp/fan-in-suite-${task}.log 的【全部】失败行（__PERFILE__ passed=false 行 + spec 失败摘要），先跑上面的 fix-scope gate 得到 FIX_SCOPE_VERDICT。日志已按轮轮转：当前文件 = 上一轮（本次失败的这轮）的内容，第一行是 __FANIN_SUITE_START__ 起始标记；上一轮更早的内容在 /tmp/fan-in-suite-${task}.log.prev（诊断用，勿当当前轮）。读当前轮请从最后一个 __FANIN_SUITE_START__ 之后切片。
2. 按 fix-scope gate verdict：只修 inScope 里的失败（本任务 Touches 内回归），在 ${worktree} 里 git add + git commit（真实修复，不是删测试/改判据绕过）；outOfScope 的越界红一律不修（load-sensitive 释放 / checker 误报与别任务 bug defer 独立任务）。
3. 重新启动 suite（detached）。⛔ 禁止 Bash(run_in_background:true)（subagent 退出被连带杀）；⛔ 禁止前台 bash scripts/test.sh。启动后短促确认（~3s）exit marker 未立刻出现，然后返回。按 fix-scope gate verdict 选启动方式（release 侧三态，gap-gate-release-no-isolate-rerun-no-livelock）：
   a. inScope 非空（本任务有要修的回归）⇒ 修完 inScope 后【全量 relaunch】：用上面的 ${SUITE_LAUNCH} 块（重跑整个套件验证代码改动）。
   b. inScope 为空 且 FIX_SCOPE_VERDICT.livelock = true（同一 load-sensitive 红已连续 release ≥ ${releaseLivelockRounds} 轮）⇒ 【anti-livelock 兜底】：⛔ 不再 relaunch（不跑全量也不跑隔离）。escalate：返回 { relaunched: false, ... }，note 写「load-sensitive anti-livelock（releasedRounds≥${releaseLivelockRounds}）：停止无界 relaunch，escalate → quiet-window / needs-human」。
   c. inScope 为空 且只有 load-sensitive 释放、FIX_SCOPE_VERDICT.livelock = false ⇒ 【C11 隔离重跑】：用下面的 ${ISOLATE_LAUNCH} 块（只重跑 gate 分诊出的 load-sensitive 家族失败文件、低并发，非全量 relaunch）——高 load 常驻下全量 relaunch 不减 load、load-sensitive 反复红（ac101 实证 3 RED + 3 全量 relaunch）。
   其余情形（inScope 为空、outOfScope 只有 other-task/leak/checker defer，非 load-sensitive）：
     d. FIX_SCOPE_VERDICT.deferLivelock = true（连续纯 defer 轮数 ≥ ${maxDeferRelaunches}）⇒ 【defer anti-livelock 兜底】：⛔ 不再 relaunch（defer 无根因可修，确定性失败重跑零信息）。escalate：返回 { relaunched: false, rerunMode: null, escalate: 'defer-livelock', ... }，note 写「other-task defer anti-livelock（deferRounds≥${maxDeferRelaunches}）：停止无界 relaunch，escalate → needs-human / 交 outer」。
     e. 否则 ⇒ 照旧全量 relaunch（上面的 ${SUITE_LAUNCH}）。
   ${ISOLATE_LAUNCH}
4. 返回 { relaunched: bool, rerunMode: 'full' | 'isolated' | null, escalate: 'defer-livelock' | null, worktreeHead, failuresFixed: string[], note }。failuresFixed 只列 inScope 修复；越界 defer/release 写进 note。relaunched=false 仅当 anti-livelock 兜底 (b)/(d) 或启动失败；rerunMode=isolated 仅当走了 (c) 隔离重跑；rerunMode=full 仅当走了 (a) 或 (e) 全量 relaunch；escalate='defer-livelock' 仅当走了 (d) defer anti-livelock 兜底。
不要做任何等待决策——每次等待的时长由阶段 2 的等待块 timeout 硬边界决定。`,
      {
        schema: {
          type: 'object',
          properties: {
            relaunched: { type: 'boolean' },
            rerunMode: { type: 'string' },
            escalate: { type: 'string' },
            worktreeHead: { type: 'string' },
            failuresFixed: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['relaunched'],
        },
      }
    )
    log(`FanIn fix round ${fixRounds}/${maxFixRounds}: relaunched=${fix.relaunched} rerunMode=${fix.rerunMode ?? '?'} fixed=${(fix.failuresFixed ?? []).length} note=${fix.note ?? ''}`)
    if (!fix.relaunched) {
      if (fix.escalate === 'defer-livelock') {
        return { outcome: 'needs-human', ffOk: false, task, message: `fan-in non-load-sensitive defer anti-livelock (${maxDeferRelaunches} consecutive pure-defer rounds, other-task/flake) — retreating to needs-human; hand to outer: ${fix.note ?? 'unknown'}` }
      }
      return { outcome: 'red', ffOk: false, task, message: `fan-in fix agent did not relaunch (${fix.note?.includes('anti-livelock') ? 'release anti-livelock' : 'abort'}): ${fix.note ?? 'unknown'}` }
    }
    continue   // 重派阶段 2（等 Fix 重启动的 detached suite 再机械步骤）
  }
  break   // stage 是真实 phase-2 结果
  }
  log(`FanIn final: outcome=${stage.outcome} ffOk=${stage.ffOk} agent=${stage.agentIdUsed ?? '?'} develop=${stage.developHead ?? '?'}`)

  if (stage.ffOk) {
    finalResult = stage
    break
  }
  if (stage.outcome !== 'ff-retry') {
    finalResult = stage
    break
  }
  // ff 失败（develop 前进）⇒ 回阶段 1 重跑。有界（maxFfRetries，同 SPEC §7 防活锁阈值）。
  ffAttempts++
  if (ffAttempts >= maxFfRetries) {
    return { outcome: 'red', ffOk: false, task, message: `fan-in ff failed after ${ffAttempts} attempts (develop kept advancing) — anti-livelock; not landing` }
  }
  log(`FanIn ff-retry ${ffAttempts}/${maxFfRetries}: develop advanced during suite — re-running phase 1 (re-merge develop)`)
}

return {
  outcome: finalResult.outcome === 'green' ? 'green' : finalResult.outcome === 'needs-human' ? 'needs-human' : 'red',
  ffOk: finalResult.ffOk,
  task,
  bracketClosed: typeof finalResult.bracketClosed === 'boolean' ? finalResult.bracketClosed : null,
  message: finalResult.ffOk
    ? `fan-in landed for ${task} (via 'fan-in-execute' workflow)`
    : `fan-in did not land for ${task}: ${finalResult.note ?? 'unknown'}`,
}
