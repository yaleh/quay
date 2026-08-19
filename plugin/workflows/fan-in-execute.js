export const meta = {
  name: 'fan-in-execute',
  description: 'AC78 fan-in 执行 workflow — 无锁段（merge develop → delta 断言面判定 → ts-typecheck → scoped 门+全量+doc）与持锁段（flip done → fan-in-ff-merge.sh）由本脚本生成的 subagent prompt 全权执行；全量 suite 的【等待】由脚本控制流承担（setTimeout + 轮询 agent，gap-fan-in-turn-budget-suite-timeout），不占任何 subagent 回合预算；subagent 在 ff 成功后才返回。A6 只检查「是否走了本 workflow」（判据2 (a)(b)(c)）。',
  whenToUse: 'inner 对某任务执行 fan-in 时（A6）：以 scriptPath 调用本 workflow，args={task, worktree, root, runId, mergeTarget}。禁止 name:（M176 陷阱：同会话第二次 name: 派发可能取旧脚本体）。',
  phases: [{ title: 'FanIn', detail: '阶段1（预备+启动 detached suite，立即返回）→ 脚本控制流等 suite（回合预算承载）→ 阶段2（入账+flip+ff+bracket），ff 成功后才返回' }],
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
//     结构性缺口仍在。改本文件必须同步 plugin/workflows/fan-in-execute.js（双拷贝，workflows-dual-copy-
//     drift-check）与 A6 派发规则（fast-mode-tick-core.md：命中 ⇒ scriptPath 用 worktree 版）。
//  ⑦ 回合预算承载（gap-fan-in-turn-budget-suite-timeout）：step4 全量 suite ~14-25min > subagent
//     回合预算 ⇒ 旧设计中 subagent 等 suite 时回合耗尽被强制收尾（capture 未写/flip/ff/bracket 全缺，
//     release-timeout 实证 + AC95 第 2 次复发；AC101 达成不缓解——fan-in 的 suite 因 CPU 争用仍超预算）。
//     修复 = 把 suite 交给【长生命周期载体】（detached setsid 进程，subagent 退出不影响它），把
//     【等待】从 subagent 回合搬到【脚本控制流】——setTimeout + 轮询 agent 读 exit marker
//     （ab380c5e 同源：等待由脚本控制流决定，不存在需要做等待决策的 agent；execute-suite-fix.js 前例）。
//     阶段划分：
//       阶段 1（agent #1）：step 0-4 预备（merge/delta/typecheck/scoped/doc）+ 启动 detached suite +
//           写 pre-suite capture → 立即返回（outcome=suite-started / skipped / preverified）。
//       脚本控制流：setTimeout + 轮询 agent（短促只读 exit marker；命中则补全 capture post 字段）。
//       红 suite ⇒ Fix agent（读日志 → 修 → 重新启动 detached）→ 脚本再等（有界 maxFixRounds）。
//       ff 失败（develop 前进，窗口 = merge 到 ff 之间的整个 suite 时长）⇒ 回阶段 1 重跑
//       （有界 maxFfRetries，同 SPEC §7 防活锁阈值；阶段 1 首步 revert 上次 ff 失败遗留的 done 翻转）。
//       阶段 2（agent #2）：step 4.5 入账 + step 5 flip+ff + step 5.5 bracket → 返回。
//     ⛔ 禁止 Bash(run_in_background:true)（subagent 退出被 harness 连带杀，execute-suite-fix.js
//        实证 runId f6b824b5）；⛔ 禁止前台 bash scripts/test.sh（>10min 前台 Bash 上限 + 回合窗）。
//     取假（plugin/test/fan-in-execute-paths.test.mjs）：构造 step2 code_delta 非空 ⇒ 阶段 1 启动
//     detached suite（setsid+&+disown）且立即返回；脚本轮询到 suite 绿 ⇒ 阶段 2 机械步骤（flip/ff/
//     bracket）全执行。等待由脚本控制流决定，不占任何 subagent 回合。
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
//  ⚠️ verification-round 入账（gap-preverified-suite-bypasses-verification-round-ledger +
//     gap-fan-in-realsuite-bypasses-verification-round-ledger）：本 fan-in 的 suite 走了【本 workflow
//     内的 detached 直跑】（9327056a 的 setsid `bash scripts/test.sh`，不经 full-suite-runner.ts——后者
//     是唯一写 verification-round 的 full-suite 入口）或 pre-verified 复用（ec434eb8，capture 在回合外
//     已跑绿）⇒ 两分支都从不触发 full-suite-runner 的 verification-round 写入，趋势账本（/tests + 成本
//     分析数据源）对最新落地路径变盲。step 4 在复用 capture 时追加 suite_preverified=1 标记；step 4.5
//     # preverified-round-block 的【共用判定】是 full_suite_ran=true（有真跑——本 fan-in 直跑或复用），
//     preverified 布尔由 suite_preverified 标记决定（1=复用，0=本 fan-in 真跑），两分支共用同一 writer
//     （plugin/scripts/pre-verified-round-record.ts --preverified <0|1>），写失败 HARD FAIL（AC1 判据1
//     义务）。doc-only 跳过（full_suite_ran=false）无 suite 可记账，不写。正常全量路径由
//     full-suite-runner 写 verification-round，fan-in 不重复写。
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
// 回合预算承载的脚本控制流可调参数（生产用默认；测试经 args 覆盖，如 pollIntervalMs=0）。
const pollIntervalMs = A.pollIntervalMs ?? 60_000   // 脚本 setTimeout 的轮询间隔
const maxSuitePolls = A.maxSuitePolls ?? 60         // 单次 suite 等待的有界轮询数（60×60s=60min 上限）
const maxFixRounds = A.maxFixRounds ?? 4            // 红 suite 的最大修复迭代
const maxFfRetries = A.maxFfRetries ?? 3            // ff 失败（develop 前进）的最大重试（同 SPEC §7 阈值）

if (!task || !worktree || !root) {
  return { outcome: 'bad-args', message: 'task / worktree / root are required', args }
}

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
suite_head_now=$(git rev-parse HEAD 2>/dev/null || echo unknown)
printf 'full_suite_ran=true\\nskip_reason=\\nstart_iso=%s\\nstart_ms=%s\\nsuite_head=%s\\nsuite_log_file=%s\\n' \\
  "$suite_start_iso" "$suite_start_ms" "$suite_head_now" "$suite_log_file" > "$suite_capture"
# GNU time 捕获 CPU（判据3 的 cpu_time_s）；GNU time 不可用 ⇒ 保持 null + not-wired（AC6，绝不写 0）。
setsid bash -c 'cd "$1" && { if command -v /usr/bin/time >/dev/null 2>&1; then /usr/bin/time -o "$2" -f "%U %S" bash scripts/test.sh; else bash scripts/test.sh; fi; } > "$3" 2>&1; rc=$?; printf "exit=%s\\nend_ms=%s\\nend_iso=%s\\n" "$rc" "$(date +%s%3N)" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" > "$4"' _ "${worktree}" "$suite_time_file" "$suite_log_file" "$suite_exit_marker" & disown
suite_pid=$!
printf 'suite_pid=%s\\n' "$suite_pid" >> "$suite_capture"`

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
const FIX_SCOPE_GATE = `【fix-scope gate —— 修任何失败前必须先跑，得到 FIX_SCOPE_VERDICT 再动手修】
# fix-scope-gate-block-start
fix_scope_log="/tmp/fan-in-suite-${task}.log"
fix_scope_touches="${worktree}/tasks/${task}.md"
fix_scope_release="/tmp/fan-in-scope-release-${task}.json"
fix_scope_out=$(node --no-warnings --experimental-strip-types --input-type=module -e 'import fs from "node:fs";
import { parseTouches, matchGlob, normalizePath } from "${worktree}/plugin/scripts/touches-orthogonality-check.ts";
import { scanFamily, kindForFile } from "${worktree}/plugin/scripts/known-load-sensitive.ts";
const taskFile = process.argv[1]; const wt = process.argv[2]; const logFile = process.argv[3]; const releaseLedger = process.argv[4];
let globs = null;
try { const tb = fs.readFileSync(taskFile, "utf8"); const p = parseTouches(tb); if (p.hasSection) globs = p.globs; } catch (e) { globs = null; }
const family = scanFamily(wt);
let logText = ""; try { logText = fs.readFileSync(logFile, "utf8"); } catch (e) { logText = ""; }
let prior = {}; try { if (releaseLedger) prior = JSON.parse(fs.readFileSync(releaseLedger, "utf8")); } catch (e) { prior = {}; }
const inScope = []; const outOfScope = []; const seen = new Set();
const re = /^__PERFILE__ duration_ms=[0-9.]+ (.+) passed=false$/gm;
let m;
while ((m = re.exec(logText)) !== null) {
  let rel = m[1];
  if (rel.startsWith(wt + "/")) rel = rel.slice(wt.length + 1);
  rel = normalizePath(rel);
  if (seen.has(rel)) continue;
  seen.add(rel);
  const kind = kindForFile(family, rel);
  if (kind !== undefined) { const rounds = (typeof prior[rel] === "number" ? prior[rel] : 0) + 1; prior[rel] = rounds; outOfScope.push({ file: rel, reason: "load-sensitive", kind, releasedRounds: rounds }); continue; }
  if (globs === null) { inScope.push(rel); continue; }
  if (globs.some((g) => matchGlob(normalizePath(g), rel))) inScope.push(rel); else outOfScope.push({ file: rel, reason: "other-task" });
}
if (/tmux-leak-scan: FAIL/.test(logText)) outOfScope.push({ file: null, reason: "leak-residual" });
if (inScope.length === 0 && outOfScope.length === 0 && /run_static_checks|static-check/i.test(logText)) outOfScope.push({ file: null, reason: "checker-misreport" });
try { if (releaseLedger) fs.writeFileSync(releaseLedger, JSON.stringify(prior)); } catch (e) {}
process.stdout.write(JSON.stringify({ scoped: globs !== null, inScope, outOfScope }));' "$fix_scope_touches" "${worktree}" "$fix_scope_log" "$fix_scope_release" 2>&1) || { echo "FIX_SCOPE_NOT_EVALUATED=1"; fix_scope_out=""; }
echo "FIX_SCOPE_VERDICT=$fix_scope_out"
# fix-scope-gate-block-end
判定（读上面的 FIX_SCOPE_VERDICT JSON）：
- inScope 里的失败 = 本任务 Touches 内的回归 ⇒ 只修这些文件；禁止触碰 outOfScope 里列出的任何文件。
- outOfScope 里的失败 = 越界红，一律不修：
    * reason=load-sensitive（in_family，kind 已标注，携带 releasedRounds = 已连续 release 的轮数含本轮）⇒ 释放：不修。⛔ 幂等持久：同一 load-sensitive 红无论 relaunch 几轮都【继续 release】，任何一轮都不得转 fix——relaunch 后仍红 ⇒ 仍 release（不是「重跑确认后改修」）。releasedRounds ≥ 1 的项本轮仍 release，note 里写「load-sensitive 释放（第 N 轮，幂等持久），⛔ 不得转 fix」，N = releasedRounds 的值。release 落账由 gate 自动持久化到 fix_scope_release ledger（跨 relaunch 轮次递增），下一轮 gate 会读到 releasedRounds 递增——这是机制保证，不是靠记性。
    * reason=checker-misreport ⇒ defer：不修，note 里要求 defer 独立任务。
    * reason=other-task / leak-residual ⇒ 别任务 bug / 环境残留：不修，note 里要求 defer 独立任务。
- FIX_SCOPE_NOT_EVALUATED=1 ⇒ fail-closed：本任务不修任何失败，全部 defer（无法评估 ≠ 合格）。
修完 inScope 后照常重新启动全量 suite。返回的 failuresFixed 只列 inScope 修复；越界 defer/release 写进 note。relaunch 后 suite 仍红的 load-sensitive 红 ⇒ 仍按本 gate release，⛔ 绝不转 fix。`

// ── 脚本控制流的 suite 等待：不把等待决策交给任何 agent（ab380c5e / execute-suite-fix.js）──────
// 轮询 agent 只读 exit marker；命中则补全 capture 的 post 字段。等待间隔由脚本 setTimeout 决定。
async function pollSuite() {
  return agent(
    `你是 fan-in suite 等待轮询（workflow 脚本控制流调用，短促只读，一回合内返回）。任务 ${task} 的 suite 以 detached 方式运行。运行下面命令并返回结果——不要做任何等待决策（等待由 workflow 脚本控制）。
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_log_file="/tmp/fan-in-suite-${task}.log"
if [ ! -f "$suite_exit_marker" ]; then
  echo 'POLL=not-done'
  exit 0
fi
. "$suite_capture"
suite_exit=$(sed -n 's/^exit=//p' "$suite_exit_marker" | tail -1)
[ -n "$suite_exit" ] || suite_exit=1
# 真实结束时刻由 detached suite 在退出时刻写入 marker（gap-fan-in-suite-duration-poll-
# granularity-inflation）：poll 只读不重算 ⇒ wall_ms 不再含轮询发现延迟（round232 +65.1s 虚高）。
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
if [ -f "$suite_time_file" ]; then
  cpu=$(tail -1 "$suite_time_file" 2>/dev/null | awk '{printf "%.3f", $1+$2}' || true)
  if [ -n "$cpu" ] && [ "$cpu" != "0.000" ]; then cpu_s=$cpu; cpu_source=gnu-time; fi
fi
printf 'cpu_s=%s\\ncpu_source=%s\\nend_iso=%s\\nend_ms=%s\\nwall_ms=%s\\nload=%s\\nlane_count=%s\\nsuite_exit=%s\\n' \\
  "$cpu_s" "$cpu_source" "$end_iso" "$end_ms" "$wall_ms" "$load" "$lane_count" "$suite_exit" >> "$suite_capture"
echo "POLL=done SUITE_EXIT=$suite_exit"
返回 { done: bool（POLL=done ⇒ true）, suiteExit: int|null }。marker 存在但读不出 suite_exit ⇒ done=true, suiteExit=null（fail-closed，脚本按非绿处理）。`,
    {
      schema: {
        type: 'object',
        properties: {
          done: { type: 'boolean' },
          suiteExit: { type: 'number' },
        },
        required: ['done'],
      },
    }
  )
}

async function waitForSuite() {
  let done = false
  let exit = null
  let polls = 0
  while (!done) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    const p = await pollSuite()
    done = !!p.done
    exit = p.suiteExit ?? null
    if (++polls > maxSuitePolls) {
      log(`WARN: suite poll cap reached (${maxSuitePolls} polls) — advancing on last poll state (done=${done}, exit=${exit})`)
      break
    }
  }
  return { done, exit }
}

// ── 重试循环：阶段 1（预备+启动 suite）→ 脚本等 suite（红则 Fix）→ 阶段 2（入账+flip+ff+bracket）──
// ff 失败（develop 前进）⇒ 回阶段 1 重跑（有界 maxFfRetries）。整个循环由脚本控制流驱动。
phase('FanIn')
let finalResult = null
let ffAttempts = 0
while (finalResult == null) {
  const prep = await agent(
    `你是 fan-in 执行 subagent（阶段 1/2：无锁段预备 + 启动 suite）。任务 ${task} 的 fan-in 分两阶段完成：
- 阶段 1（你，本轮）：无锁段 step 0-4 —— merge develop → delta 断言面判定 → ts-typecheck → scoped 门 + doc 检查 → 启动全量 suite（detached，立即返回，【不等它】）。
- 阶段 2（后续 agent，suite 绿后）：step 4.5 per-task-suite 入账 + 持锁段（flip done → fan-in-ff-merge.sh → bracket close）。
⛔ 你在本回合【不等待 suite】——全量 suite ~14-25min 超过 subagent 回合预算（release-timeout 实证 + AC95 复发）；等待由 workflow 脚本控制流承担（setTimeout 轮询 exit marker，ab380c5e 同源）。suite 以 detached 方式启动（setsid + & + disown = 长生命周期载体），你启动 + 短促确认后立即返回。

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
  # 自举警示（取假一能取假）：命中而 root 与 worktree 的 fan-in-execute.js 不一致 ⇒ 本次派发没用
  # worktree 版 scriptPath ⇒ 本任务运行的 workflow 是主检出版（未含本分支修改）⇒ 修复未被自己验证。
  if [ -f "${worktree}/.claude/workflows/fan-in-execute.js" ]; then
    if ! cmp -s "${worktree}/.claude/workflows/fan-in-execute.js" "${root}/.claude/workflows/fan-in-execute.js" 2>/dev/null; then
      echo "FAN-IN-BOOTSTRAP-WARN: 本分支修改了 fan-in-execute.js 但本次 fan-in 运行的 workflow 是主检出版（A6 自举规则要求以 worktree 版 scriptPath 派发）——本任务的修复未被自己验证" >&2
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
# 回合预算承载（gap-fan-in-turn-budget-suite-timeout）：把 code_delta 落盘，step 4 的 suite 启动块
# 据此判定（bash 变量不跨 Bash 调用持久）。
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
# bash scripts/test.sh（~14-25min 超过单次前台 Bash 10min 上限 + 回合窗）。等待由 workflow 脚本
# 控制流决定（setTimeout 轮询 exit marker）。本块判定依据 /tmp/fan-in-code-delta-${task}.txt
# （step 2 落盘）：非空 ⇒ 启动全量 suite；空 ⇒ 跳过（doc-only）；已有 pre-verified capture ⇒ 复用。
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_exit_marker="/tmp/fan-in-suite-${task}.exit"
suite_time_file="/tmp/fan-in-suite-${task}.time"
suite_head_now=$(git rev-parse HEAD 2>/dev/null || echo unknown)
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

  // ── 脚本控制流的 suite 等待（回合预算承载的核心）────────────────────────────────────────────
  let suiteDone = prep.outcome !== 'suite-started'
  let suiteExit = null
  if (prep.outcome === 'suite-started') {
    const waited = await waitForSuite()
    suiteDone = waited.done
    suiteExit = waited.exit
  }

  // ── 红 suite：Fix agent（读日志 → 修 → 重新启动 detached）→ 脚本再等（有界 maxFixRounds）────
  let fixRounds = 0
  while (suiteDone && suiteExit !== 0) {
    if (fixRounds >= maxFixRounds) {
      return { outcome: 'red', ffOk: false, task, message: `fan-in suite red after ${fixRounds} fix rounds (last exit ${suiteExit}) — not landing` }
    }
    fixRounds++
    const fix = await agent(
      `你是 fan-in 执行 subagent（suite-fix 阶段）。任务 ${task} 的全量 suite 上一轮退出码 ${suiteExit}（RED）——你读失败日志、按 fix-scope gate 判红是否本任务 Touches 内回归，修根因、以 detached 方式重新启动 suite，然后【立即返回】（等待由 workflow 脚本控制流承担，不在你本回合内等）。
执行上下文：
- 任务 worktree（你的工作目录）：${worktree}
- suite 日志：/tmp/fan-in-suite-${task}.log
- 上一轮 exit：${suiteExit}
${FIX_SCOPE_GATE}
任务：
1. 读 /tmp/fan-in-suite-${task}.log 的【全部】失败行（__PERFILE__ passed=false 行 + spec 失败摘要），先跑上面的 fix-scope gate 得到 FIX_SCOPE_VERDICT。
2. 按 fix-scope gate verdict：只修 inScope 里的失败（本任务 Touches 内回归），在 ${worktree} 里 git add + git commit（真实修复，不是删测试/改判据绕过）；outOfScope 的越界红一律不修（load-sensitive 释放 / checker 误报与别任务 bug defer 独立任务）。
3. 重新启动全量 suite（detached）：${SUITE_LAUNCH}
   ⛔ 禁止 Bash(run_in_background:true)（subagent 退出被连带杀）；⛔ 禁止前台 bash scripts/test.sh。
   启动后短促确认（~3s）exit marker 未立刻出现，然后返回。
4. 返回 { relaunched: bool, worktreeHead, failuresFixed: string[], note }。failuresFixed 只列 inScope 修复；越界 defer/release 写进 note。
不要做任何等待决策——等待由 workflow 脚本控制。`,
      {
        schema: {
          type: 'object',
          properties: {
            relaunched: { type: 'boolean' },
            worktreeHead: { type: 'string' },
            failuresFixed: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['relaunched'],
        },
      }
    )
    log(`FanIn fix round ${fixRounds}/${maxFixRounds}: relaunched=${fix.relaunched} fixed=${(fix.failuresFixed ?? []).length} note=${fix.note ?? ''}`)
    if (!fix.relaunched) {
      return { outcome: 'red', ffOk: false, task, message: `fan-in fix agent did not relaunch: ${fix.note ?? 'unknown'}` }
    }
    const waited = await waitForSuite()
    suiteDone = waited.done
    suiteExit = waited.exit
  }

  if (!suiteDone) {
    return { outcome: 'red', ffOk: false, task, message: `fan-in suite did not finish within poll cap for ${task}` }
  }
  if (suiteExit !== 0) {
    return { outcome: 'red', ffOk: false, task, message: `fan-in suite red (exit ${suiteExit}) for ${task} — not landing` }
  }

  // ── 阶段 2（机械步骤）：入账 + flip + ff + bracket（ff 失败 ⇒ ff-retry，脚本回阶段 1）────────
  const result = await agent(
    `你是 fan-in 执行 subagent（阶段 2/2：入账 + 持锁段）。任务 ${task} 的 suite 已绿（或 suite-skipped / suite-preverified），由 workflow 脚本控制流等完；现在你执行机械步骤（全部快操作，你的回合内完成）。以下所有上下文已逐字内联，不需要询问任何人，也不要引用「上一条消息」。

执行上下文（你直接使用，无需探查）：
- 任务 worktree（你的工作目录，所有代码操作都在这里）：${worktree}
- 主检出（develop / merge target 所在的 checkout，fan-in-ff-merge.sh 的 --root）：${root}
- merge target（ff 目标分支）：${mergeTarget}
- runId：${runId ? runId : '（无，ff 时省略 --run-id）'}
- codeDelta（step 2 上报，最终返回时带上）：${prep.codeDelta ?? ''}

步骤（严格按序；每步都先 cd ${worktree} 或显式用 -C）：

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
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
else
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/per-task-suite-record.ts \
    --task-id ${task} --run-id ${runId} --state green --lane-count "$lane_count" \
    --duration-ms "$wall_ms" --started-at "$start_iso" --finished-at "$end_iso" \
    --doc-checked true --doc-check-exit 0 \
    --full-suite-ran "$full_suite_ran" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
fi
# verification-round 入账（gap-preverified-suite-bypasses-verification-round-ledger AC1/AC2 +
#   gap-fan-in-realsuite-bypasses-verification-round-ledger AC1/AC2）：本 fan-in 的 suite 走了【本
#   workflow 内的 detached 直跑】（不经 full-suite-runner.ts——唯一写 verification-round 的 full-suite
#   入口）或 pre-verified 复用（capture 在回合外已跑绿）⇒ 写 verification-round.jsonl，不让趋势账本
#   （/tests + 成本分析数据源）对最新落地路径变盲。共用判定：full_suite_ran=true ⇒ 有真跑（本 fan-in
#   直跑 或 复用），两分支共用同一 writer；preverified 布尔由 suite_preverified 标记决定（1=复用，
#   0=本 fan-in 真跑）。doc-only 跳过（full_suite_ran=false）无 suite 可记账，不写。
# 写失败 ⇒ HARD FAIL（AC1 判据1 义务）。
# preverified-round-block-start
if [ "$full_suite_ran" = "true" ]; then
  preverified_flag="\${suite_preverified:-0}"
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/pre-verified-round-record.ts \
    --task-id ${task} --run-id ${runId} --started-at "$start_iso" --duration-ms "$wall_ms" \
    --lane-count "$lane_count" --load "$load" --commit "$suite_head" --preverified "$preverified_flag" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" --suite-log "\${suite_log_file:-}"; then
    echo "FATAL: verification-round 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
fi
# preverified-round-block-end
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
bash ${worktree}/plugin/scripts/fan-in-ff-merge.sh --task ${task} --run-id ${runId} --agent-id "$agent_id" --root ${root} --merge-target ${mergeTarget} --worktree ${worktree}
ff_rc=$?
# 本任务 suite capture 的使命已尽（ff 闸已在 fan-in-ff-merge.sh 内读过它）——清理掉；若 ff 失败重试，
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

返回 { outcome: 'green' | 'needs-human' | 'red' | 'ff-retry', ffOk, developHead, worktreeHead, agentIdUsed, codeDelta, note, bracketClosed }。
outcome=green 仅当 ff 成功（develop fast-forward 到 task tip）。outcome=ff-retry 仅当 ff 失败（develop 前进，
exit 1/3）——脚本将回阶段 1 重跑，你【不得】重试 ff、【不得】执行 step 5.5。outcome=needs-human 仅当
flip/入账等持锁段前置失败（如 AC 闸拒绝/入账 HARD FAIL）。red = 其它失败。
bracketClosed = step 5.5 的闭合结果（true=已闭合 / false=闭合失败 / null=ff 未成功未执行 5.5）。
note 必须标注 bracketClose=OK 或 bracketClose=FAILED。`,
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
          bracketClosed: { type: 'boolean' },
        },
        required: ['outcome', 'ffOk'],
      },
    }
  )
  log(`FanIn final: outcome=${result.outcome} ffOk=${result.ffOk} agent=${result.agentIdUsed ?? '?'} develop=${result.developHead ?? '?'}`)

  if (result.ffOk) {
    finalResult = result
    break
  }
  if (result.outcome !== 'ff-retry') {
    finalResult = result
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
