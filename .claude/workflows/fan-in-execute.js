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
//  ⑤ bracket-close（gap-fan-in-auto-close-telemetry-bracket）：step 5.5 在 ff 成功后、清理前关闭本任务的
//     telemetry bracket（closure-lag-check.sh --close-task，A16 统一闭合点，写 --task-end done）。只按
//     --taskId 关【本任务】的 bracket（inProgress[] 按 taskId 定位 runId），绝不 --reconcile 全局扫——判据2
//     能取假：在飞任务/未 land 任务的 bracket 必须保留。ff 失败 ⇒ 不执行 5.5。改本块必须同步
//     plugin/test/fan-in-execute-paths.test.mjs 的 bracket-close 组测试（真实 bash 闭 bracket + 在飞保留）。
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
# anti-drift-block-start
# anti-drift-touches 守卫（gap-anti-drift-touches-zero-coverage-fast-mode）：merge 后立即用【实际 diff】
# （git diff --name-only ${mergeTarget}...HEAD = fan-in 将要 land 的文件）对照声明 Touches 做事后核对。
# 越界触碰 / 声明过宽 ⇒ HARD FAIL（非建议）；判定逻辑在 anti-drift-touches-check.ts（本步即其 driver
# 输入面：--task --worktree --merge-target），不改判定逻辑，只喂实际 diff + 声明 Touches。
if ! node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}; then
  echo "FATAL: anti-drift-touches HARD FAIL——实际触碰超出声明 Touches（或声明过宽）⇒ 不翻 done、不 ff；不得改 Touches 绕过守卫" >&2
  exit 2
fi
# anti-drift-block-end

【无锁段 step 2 — delta 断言面判定（AC75）】
fork=$(git -C ${worktree} merge-base ${mergeTarget} HEAD)
delta=$(git -C ${worktree} diff --name-only "$fork" ${mergeTarget} 2>/dev/null || true)
# 承重点①（gap-fan-in-execute-three-unverified-paths）：code_delta 正则分类 doc/代码/测试断言面——
# 判错 ⇒ 该跑全量却跳过（漏检）或该跳却重跑（浪费）。改此行必须同步 plugin/test/fan-in-execute-paths.test.mjs。
code_delta=$(printf '%s\\n' "$delta" | grep -vE '^tasks/|^docs/|^[.]quay/|^plugin/loop/|^measurements/|^milestones/|^orchestration/archive/|[.]md$' | grep -v '^$' || true)
判定：
  - code_delta 非空 ⇒ develop 的 delta 触及代码/脚本/测试断言面 ⇒ 本回合【要】重跑全量 suite。
  - code_delta 为空且 delta 非空 ⇒ delta 全落 doc/任务体/telemetry 面 ⇒ 跳过全量 suite（只跑 doc 检查）。
  - 无法判定（git merge-base 失败 / delta 取不到）⇒ fail-closed：重跑全量 suite（硬规则 3b：判不出≠不需要）。
把 code_delta 记下来（返回时上报）。

【无锁段 step 3 — ts-typecheck 闸】
cd ${worktree} && node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task ${task} --worktree ${worktree} --merge-target ${mergeTarget}
  —— 闸自己判定 Touches 是否含新增/移动 .ts（无则直接 exit 0）。exit 非 0 ⇒ 丢弃 worktree 内未合状态、
     标 needs-human、停止本 tick 合并与派发——不要继续 ff。

【无锁段 step 4 — scoped 门 + （按 step 2 判定）全量 suite + doc 检查 + per-task-suite 捕获】
cd ${worktree} && bash scripts/test.sh --for-task ${task} --allow-thin
  —— scoped 门，必须绿；非绿 ⇒ 修到绿再继续。
# suite-capture-block-start
# per-task-suite 捕获（gap-fan-in-suite-data-not-accounted）：suite 起止/CPU/判定写入 /tmp 临时 env
# 文件，供【全绿后】的 step 4.5 入账块读取——bash 变量不跨调用持久，用文件跨调用传值。
# ⚠️ 跳过全量也要捕获（full_suite_ran=false + skip_reason=doc-only-delta）——跳过=被记录的决定，
# 判据2 能取假（不能靠时长反推「为什么 CPU 低」）。判定依据 step 2 已记下的 code_delta。
suite_capture="/tmp/fan-in-suite-${task}.env"
suite_start_iso=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
suite_start_ms=$(date +%s%3N)
# AC6 (gap-phase-boundary-differential-accounting)：数据源未接 ⇒ cpu_s=null + cpu_source=not-wired，
# ⛔ 不写 0（0 无法区分「仪器没接」与「真的 ~0 消耗」）。GNU time 跑出实数才置 gnu-time。
suite_cpu_s=null
suite_cpu_source=not-wired
if [ step 2 判定 code_delta 非空 ]; then
  # 全量 suite，只在 delta 触及断言面时跑（或判不出时 fail-closed 跑）。GNU time 捕获 CPU 秒数
  # （User+System，判据3 的 cpu_time_s）；GNU time 不可用 ⇒ cpu_s 保持 null + not-wired（AC6）。
  if command -v /usr/bin/time >/dev/null 2>&1; then
    /usr/bin/time -o /tmp/fan-in-suite-${task}.time -f '%U %S' bash scripts/test.sh
    suite_cpu_s=$(awk '{printf "%.3f", $1+$2}' /tmp/fan-in-suite-${task}.time 2>/dev/null || true)
    rm -f /tmp/fan-in-suite-${task}.time
    if [ -z "$suite_cpu_s" ] || [ "$suite_cpu_s" = "0.000" ]; then
      # GNU time 跑了但没产出可用读数 ⇒ 显式 null + not-wired（AC6：绝不写 0）。
      suite_cpu_s=null
      suite_cpu_source=not-wired
    else
      suite_cpu_source=gnu-time
    fi
  else
    bash scripts/test.sh
    # GNU time 不可用 ⇒ 显式 null + not-wired（AC6：绝不写 0）。
    suite_cpu_s=null
    suite_cpu_source=not-wired
  fi
  full_suite_ran=true
  skip_reason=
else
  full_suite_ran=false
  skip_reason=doc-only-delta
  # 跳过全量 ⇒ 没有任何 CPU 测量 ⇒ 显式 null + not-wired（AC6）。
  suite_cpu_s=null
  suite_cpu_source=not-wired
fi
suite_end_iso=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
suite_end_ms=$(date +%s%3N)
suite_wall_ms=$(( suite_end_ms - suite_start_ms ))
suite_load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
suite_lane_count=1
if [ "$full_suite_ran" = true ]; then suite_lane_count=$(nproc 2>/dev/null || echo 1); fi
printf 'full_suite_ran=%s\\nskip_reason=%s\\ncpu_s=%s\\ncpu_source=%s\\nstart_iso=%s\\nend_iso=%s\\nwall_ms=%s\\nload=%s\\nlane_count=%s\\n' \
  "$full_suite_ran" "$skip_reason" "$suite_cpu_s" "$suite_cpu_source" "$suite_start_iso" "$suite_end_iso" "$suite_wall_ms" "$suite_load" "$suite_lane_count" \
  > "$suite_capture"
# suite-capture-block-end
cd ${worktree} && bash scripts/test.sh --static-checks-doc
  —— doc 检查（ff 不触发任何钩子，AC63）；必须绿。
—— scoped 门 / 全量 / doc 任一非绿 ⇒ 修复并重跑对应项；全绿才进持锁段。

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
  if ! node --experimental-strip-types plugin/scripts/per-task-suite-record.ts \
    --task-id ${task} --run-id ${runId} --state green --lane-count "$lane_count" \
    --duration-ms "$wall_ms" --started-at "$start_iso" --finished-at "$end_iso" \
    --doc-checked true --doc-check-exit 0 \
    --full-suite-ran "$full_suite_ran" --skip-reason "$skip_reason" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
else
  if ! node --experimental-strip-types plugin/scripts/per-task-suite-record.ts \
    --task-id ${task} --run-id ${runId} --state green --lane-count "$lane_count" \
    --duration-ms "$wall_ms" --started-at "$start_iso" --finished-at "$end_iso" \
    --doc-checked true --doc-check-exit 0 \
    --full-suite-ran "$full_suite_ran" \
    --cpu-time-s "$cpu_s" --cpu-source "$cpu_source" --load "$load"; then
    echo "FATAL: per-task-suite-record 入账失败（AC1 判据1 义务）⇒ 不翻 done、不 ff" >&2
    exit 2
  fi
fi
rm -f "$suite_capture"
# suite-record-block-end

【持锁段 step 5 — flip done + ff-merge】
cd ${worktree}
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
if ! node --experimental-strip-types plugin/scripts/fan-in-ac-completion-gate.ts --task ${task}; then
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
bash ${root}/plugin/scripts/fan-in-ff-merge.sh --task ${task} --run-id ${runId} --agent-id "$agent_id" --root ${root} --merge-target ${mergeTarget}
  —— 锁只包 git merge --ff-only，毫秒级，成/败都解锁。ff 失败（develop 前进了）⇒ 回 step 1 重跑
     （重 merge develop、重判 delta、重跑 suite、重 ff），同一任务 ff 失败 ≥3 次才谈防活锁。
     ff 成功（exit 0）后才执行 step 5.5；ff 失败（exit 1/3）⇒ 回 step 1，绝不执行 step 5.5。

【持锁段 step 5.5 — 关闭本任务的 telemetry bracket（仅 ff 成功后）】
# bracket-close-block-start
# gap-fan-in-auto-close-telemetry-bracket (occurrence 3: ac76/ac81+touches/ac85 land 后留 stale bracket):
# dispatch 的 --task-start 从不在 land 时闭合 ⇒ 每次 land 留一个 stale bracket（reconcile_compliant=false）
# 直到下一次手动/外层 --reconcile。ff 已成功（${mergeTarget} 已 ff 到 task/${task} tip）⇒ 本任务 executor
# observably done ⇒ 经 closure-lag-check.sh --close-task（A16 统一闭合点）写 --task-end done。
# 只关【本任务】的 bracket（--taskId ${task} 在 telemetry report 的 inProgress[] 按 taskId 定位 runId）——
# 绝不 --reconcile 全局扫（判据2 能取假：在飞任务/未 land 任务的 bracket 必须保留）。
# 幂等：无 open bracket（已闭合/从未 --task-start）⇒ --close-task exit 0，无写入。
if ! bash ${root}/plugin/scripts/closure-lag-check.sh --close-task --taskId ${task} --outcome done --root ${root}; then
  echo "FATAL: telemetry bracket 闭合失败（${task} ff 已成功但 --close-task 非 0）——landing 完成但 bracket 未闭合（stale bracket 将留到下一轮 reconcile）" >&2
  exit 1
fi
# bracket-close-block-end

—— step 5.5 结果：exit 0 ⇒ bracket 已闭合（返回 note 标注 bracketClose=OK）。
    exit 1 ⇒ bracket 闭合失败（FATAL 已打印）——ff 已成功、task 已 done、landing 完成；
    【不得】重试 ff、【不得】把 outcome 判为失败/needs-human、【不得】跳过清理；
    照常执行下方清理，返回时 note 必须标注 bracketClose=FAILED（让外层可见闭合失败）。

ff 成功后清理：cd ${root} && git worktree remove ${worktree} --force && git branch -d task/${task}

返回 { outcome: 'green' | 'needs-human' | 'red', ffOk, developHead, worktreeHead, agentIdUsed, codeDelta, note, bracketClosed }。
outcome=green 仅当 ff 成功（develop fast-forward 到 task tip）。needs-human 仅当冲突解不了/选中集非绿/ts-typecheck 阻断。red = 其它失败。
bracketClosed = step 5.5 的闭合结果（true=已闭合 / false=闭合失败 / null=ff 未成功未执行 5.5）。note 必须标注 bracketClose=OK 或 bracketClose=FAILED。`,
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
log(`FanIn done: outcome=${result.outcome} ffOk=${result.ffOk} agent=${result.agentIdUsed ?? '?'} develop=${result.developHead ?? '?'}`)

return {
  outcome: result.outcome === 'green' ? 'green' : result.outcome === 'needs-human' ? 'needs-human' : 'red',
  ffOk: result.ffOk,
  task,
  bracketClosed: typeof result.bracketClosed === 'boolean' ? result.bracketClosed : null,
  message: result.ffOk
    ? `fan-in landed for ${task} (via 'fan-in-execute' workflow)`
    : `fan-in did not land for ${task}: ${result.note ?? 'unknown'}`,
}
