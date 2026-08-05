#!/usr/bin/env bash
# 会话存活监视：看【任意一个 Claude Code 会话】（外层或内层）活不活、闲不闲、心跳逾期没有。
#
# 泛化（SPEC-outer-liveness-productization.md AC10-13，2026-08-03）：原名 outer-liveness.sh，
# 名字取窄了——进程存活、pane 忙闲、心跳逾期这套逻辑对任何 Claude Code 会话都成立，与「外层」
# 无关。内层更需要它：内层跑重活、死掉代价更大，而 inner-state.sh 只看工作产出，内层死了它只会
# 看到「没有新遥测」，与「在思考难题」完全同形。AC10 的判据：outer-* 的字样只出现在默认值里，
# 不出现在概念里——事件名 SESSION-*、环境变量 SESSION_*、文件名 session-liveness.sh 都是通用的；
# 唯一「外层」残留是默认心跳路径（orchestration/tick-log.md，那是外层的 tick 日志）。
#
# 事件与它们的信号源（AC7，规格 AC14）——每个事件到底在看什么，哪些是会话面、哪些不是：
#   SESSION-GONE / SESSION-BACK      tmux pane 里 claude 进程的存在性        —— 会话面
#   SESSION-IDLE / SESSION-RESUMED   相邻两轮 pane 哈希相同=空闲；转换后一轮内报 —— 会话面
#                                    （但哈希输入含 chrome 等易变区，见姊妹任务
#                                    gap-session-liveness-hashes-the-token-counter-as-if-it-were-work）
#   REPO-STALL                       仓库 ≥STALL_MIN 分钟无新提交              —— 仓库信号，不是会话面
#   SESSION-OVERDUE                  心跳源 mtime ≥OVERDUE_MIN 未动             —— 会话面（心跳源=transcript）
#   SESSION-STATUS                   --once 接缝：每目标一行（名字/活/pid）
#
# AC8（规格 AC15）——原 SESSION-STALL 的重新裁定：它测的是【仓库提交】，不是会话面。
# 外层判定：改名为 REPO-STALL、不改源、不移出，理由：
#   1. 本工具已经按项目轮询（每轮每个目标一次），多带一个仓库信号边际成本为零；
#   2. 改成会话面信号只会与 SESSION-IDLE 重复（同是「会话在不动」的另一测法）；
#   3. 移出需要另造一个常驻宿主，当前没有。
# 因此它作为仓库信号由本工具承载；事件名从 SESSION-STALL 改为 REPO-STALL，明示它不是会话信号。
#
# 心跳源（AC1/AC16，2026-08-03 实测选定）：内层会话的心跳源从【工作产出】换为【会话 transcript】。
#   - 工作产出（.workflow-events/）为什么不行：每个任务一个 .jsonl，每任务只写 1-2 行
#     （--task-start / --task-end），任务进行中完全冻结；目录 mtime 只在文件增删时变（POSIX），
#     追加写不动它。⇒ 长任务中「正在干活」与「中途死掉」同形——这正是监视器存在的理由所在。
#   - transcript（~/.claude/projects/<项目slug>/<会话id>.jsonl）：每次工具调用都写，任务进行中
#     持续前进。外层本班全程用它判内层活跃（inner-forensics.mjs 已有先例读它）。
#   - 配置：每目标经 SESSION_TRANSCRIPTS（给会话 id 或绝对路径）或 SESSION_HEARTBEATS（给路径）
#     指定。会话 id 是【配置，不去推断】——pid→transcript 映射经 /clear 与 --resume 把进程寿命
#     与文件寿命解耦，启发式不可靠；若保留自动探测必须标明它是启发式。
#   - 已知盲区（AC1 要求写明，任何心跳源都有盲区，可接受的是盲区已知的那个）：
#     * transcript 只在【工具调用】时写；会话在读代码/纯思考/等 subagent 时不写主 transcript。
#       内层把工作派给 subagent 时写的是 <会话id>/subagents/*.jsonl——本脚本的 transcript 心跳
#       取「主文件 + subagents 目录」的最大 mtime。
#     * 停泊/停机期间 transcript 不写：那是 .halt 停机守卫管的事（停机时 OVERDUE/REPO-STALL 被抑制），
#       见下一条的停机基线。
#   - 停机基线（协调方 2026-08-03 样本）：解除停机那一刻若没有重置心跳基线，停泊期间累积的陈旧
#     会让 OVERDUE 在解除停机同一轮误报（archguard 停泊 310 分钟后删 .halt，同一轮打出 OVERDUE）。
#     修法：陈旧度 = now - max(心跳 mtime, 解除停机时刻)。监视器每轮自己观察 .halt 从存在→不存在
#     的时刻并打基线，不需要额外状态源。同一基线也作用于 REPO-STALL（停泊期间的仓库提交年龄
#     不应在解除停机后立即算作停滞）。
#
# 心跳（AC11，可参数化）：SESSION_HEARTBEATS 按名字给心跳路径；默认心跳是
# `$REPO_ROOT/orchestration/tick-log.md`（外层 tick 日志）。内层用 transcript（见上）。
# `stat -c %Y` 对文件与目录都成立；transcript 心跳还并上 subagents 目录的最大 mtime。
#
# 产品化要点（AC1/AC2/AC3/AC9）：
#   - 本项目根自定位（同 inner-state.sh 的 BASH_SOURCE 惯例），不硬编码任何绝对仓库路径；
#     SESSION_ROOT 是测试接缝（同 INNER_STATE_WORK_ROOT），生产调用方不设它。
#   - 默认目标的目标会话名优先级（gap-quay-init-rewrites-an-executable-instead-of-generating-config
#     AC1；gap-init-guesses-the-tmux-session 删除了第 3 级）：
#       1. 环境变量 SESSION_TMUX_SESSION（显式设置，最高）
#       2. orchestration/session-liveness.env（quay-init --loop 安装时生成/更新的每项目配置）
#       3. 无配置时 FAIL-CLOSED（绝不猜一个会话名）——旧的回退是「项目根 basename + "-0"」，
#          那与 quay-init 曾写进配置的猜测值是同一形态：对「被开发出来的那个项目」恰好成立，
#          对别处静默错误——监视器瞄向不存在的会话，会把活着的内层误报成 gone（假阴性）。
#          宁可装不上，不要装上一个骗人的监视器：没配置会话就明确报错并退出，而不是猜。
#     原则：可执行文件一律原样复制，只生成配置——quay-init --loop 已不再改写本脚本
#     （安装期占位符机制已移除），会话名经上面的 env/配置/默认值解析；运行时不做
#     任何配置解析——不碰 YAML。
#   - 管理者的多目标配置落在 orchestration/session-liveness.env（管理者的东西，不进 plugin）。
#     显式设置的环境变量 SESSION_TARGETS 优先于该文件；generic 项目没有该文件 → 零配置默认。
#   - 阈值（INTERVAL/STALL_MIN/LOOP_MIN/OVERDUE_MIN）含义与默认值见随包的两份 tick 文档（AC5）。
#
# 用法：  plugin/scripts/session-liveness.sh [--once] [--mask] [--api-errors <t>] [--last-input <t>]
#   --once   跑一轮，打印每个目标的 SESSION-STATUS 行，退出（冷启动/安装后自检接缝，AC7）。
#   --mask   测试接缝：从 stdin 读 pane 文本，打印屏蔽易变区后的内容（AC1 单测直接调用）。
#   --api-errors <t>  测试接缝：打印 transcript <t> 最近 API_ERROR_WINDOW 条记录里
#                     isApiErrorMessage 结构字段计数（AC9 单测）。
#   --last-input <t>  测试接缝：打印 transcript <t> 最近 type=user 记录时间戳的 epoch（AC7 单测）。
# 环境：  INTERVAL / STALL_MIN / LOOP_MIN / OVERDUE_MIN / FRESH_SECS / API_ERROR_WINDOW / API_ERROR_MIN（阈值）
#
# ─────────────────────────────────────────────────────────────────────────────
# 阶段二（gap-session-liveness-stage-2-screen-signal-and-payload，2026-08-03）：
# 屏幕语义标志 + 屏蔽易变区 + 交叉正控制 + payload + 每类阈值。承接前任务未完成的
# AC9-AC14（阶段一 = 信号源 + 基线，见上）。各 AC 的实现点：
#   AC1（原AC10/规格AC18）主信号改语义标志：`esc to interrupt` 按【存在性】判忙，
#       不按计数（实测管理者 4 次/内层 1 次——计数无意义）。屏蔽转圈耗时行（✽）、
#       token 计数行（`/clear to save …`）、提示语行；`✻ …` 残留不得作为忙的判据。
#       判忙 = esc 标志存在 或 屏蔽易变区后的内容区有变化——后者保住非 TUI 探针 /
#       subagent 输出这类真活动（TUI 之外还有内容在变）。屏蔽规则集中在 mask_pane()，
#       逐条附「为什么它不是活动信号」（见函数注释）。
#   AC2（原AC11/规格AC18正控制）标志失效必须可发现：屏幕与 transcript 交叉正控制——
#       transcript 刚写过（会话确定在动）而屏幕判空闲 ⇒ 报 SESSION-MARKER-STALE。
#       只对「心跳源是 transcript」的目标成立（tick 日志是 loop 写的，不是会话活动的证据）。
#       不是造人工忙会话。不一致率基线：脚本不统计，由观察者从事件流里数（全忙会话同时
#       报 = TUI 文案变了，比率跳到 100%）。
#   AC3（原AC12）假阳性可解释：每个事件带成因——是屏上哪一部分造成的（哪个标志 / 哪个区）。
#   AC4（原AC9/规格AC17）屏幕与 transcript 的取舍写在下文「两种信号」节。
#   AC5（原AC13/损失函数结论一）两类漏报反向调参：不可自愈类（GONE/OVERDUE/CANT-SEND）
#       宁可误报、可自愈类（IDLE/RESUMED）从严。当前默认曾调反（IDLE 60s 即报、
#       OVERDUE 等 45min）；改后 OVERDUE_MIN 默认 45→30（不可自愈，早报 15min；阶段一
#       实测 transcript 长任务最大间隙 20.5min，30min 仍留 ≥9min 余量）；IDLE 从严 =
#       默认 LOOP_MIN=20 的噪声闸门（刚动过=正常收尾→持有者 stdout 静默；心跳陈旧/未知才报）。
#       AC21：静默只发生在持有者自己的 stdout，共享 events.jsonl 仍记全量（含 hmin）。
#       逐事件类别与阈值理由见下节。
#   AC6（原AC14/损失函数结论二）SESSION-RESUMED 带成因 payload（哪个标志/哪个区变了）：
#       判据是「收到事件后无需再采样即可判真假」——原来外层每次 3-4 次调用，改后 1 次。
#   AC7（原AC14b）事件还带「会话最后一次收到输入的时刻」（transcript 最近 type=user 记录
#       的时间戳）：紧贴恢复→外部唤醒、远早→自身 loop。取不到时明说「取不到」，不省略
#       （省略与「不是外部唤醒」同形）。
#   AC9（盲点13，2026-08-03 17:4xZ）区分「空闲因为没活干」与「空闲因为发不出请求」：
#       判据是【结构性】字段 isApiErrorMessage（顶层 JSON 键 `"isApiErrorMessage":true`，
#       只有 API 被拒记录才有——archguard 被 429 拒绝会话最近 200 条为 6，健康/陈旧会话为 0）。
#       不用 429 文案（绑死供应商文案，换端点即失效）；不用「transcript 是否增长」
#       （429 也会被写进 transcript——archguard 被拒期间最新写入 17:44:31，增长分不开两种
#       空闲，而记录的类型可以）。空闲会话最近 API_ERROR_WINDOW 条记录含 ≥API_ERROR_MIN
#       条 ⇒ 报 SESSION-IDLE-CANT-SEND，按不可自愈类处理（宁可误报，立即升级给人）；
#       无该标记的空闲仍走常规 SESSION-IDLE。
#
# 两种信号（AC4/规格AC17）：各自的盲区与同时用时以谁为准
#   - 屏幕（tmux capture-pane）：语义清晰、即时、是「人真正看的那几个标志」；但依赖 tmux，
#     且 TUI 布局/文案一改标志就失效——失效形态是【静默】（找不到 esc to interrupt 就永远
#     判空闲）。易变区（转圈耗时/token 计数/提示语/✻ 残留）必须屏蔽，否则把 chrome 的抖动
#     读成活动（姊妹任务确认的假阳性源）。
#   - transcript（~/.claude/projects/<slug>/<id>.jsonl）：不依赖 tmux、不受重绘影响、stat 便宜；
#     但只在【工具调用】时写（读代码/纯思考/等 subagent 时主 transcript 不写——subagent 写
#     在 <id>/subagents/，heartbeat_mtime 并上），且 pid→文件映射受 /clear 与 --resume 解耦，
#     会话 id 是【配置不去推断】（SESSION_TRANSCRIPTS）。
#   同时用时以谁为准：忙闲以屏幕为准（即时、语义）；心跳/逾期以 transcript 为准（不依赖
#   TUI）；二者冲突（transcript 刚写过而屏幕判空闲）⇒ 屏幕标志存疑，报 SESSION-MARKER-STALE。
#
# 阶段三（gap-session-idle-true-idle-via-transcript-fusion-and-debounce，2026-08-05）：
# 真空闲 vs 工具间隙。管理者实测：pane 哈希只答「屏幕 60 秒内变没变」，分不清「真空闲」与
# 「两次工具调用间的正常间隙」（间隙通常几秒到几十秒，真空闲是 8.5 分钟级）——单轮 pane 不变
# 判空闲是假判据。外层裁定采纳：把 transcript 最后一条【消息】的【类型】接入 idle 判据，并对
# 候选闲去抖。人的风险偏好：可接受误报（持续降低概率），强烈不希望漏报。
#   * transcript_last_message_type()：最后一条消息（type=assistant|user，跳过 system/mode/
#     last-prompt/file-history-* 等元数据）的类型。assistant 且 content 含 tool_use 块 =
#     pending-tool-use（回合进行中，确定忙）；assistant 且无 tool_use（纯文本）= pure-text
#     （候选闲）；user = user-input（刚收到输入或工具回执，模型即将应答，按忙处理）。
#     transcript 是【已发生事实的日志】（故障 5/6 结晶的结论：唯一可信信号族，不是 pane 那样
#     的代理）——AC7 把这一族接入 idle 判据。
#   * 融合（AC1/AC5）：fused_busy = pane_busy || transcript_busy。transcript 侧优先级更高——
#     pending-tool-use / user-input ⇒ 无论 pane 如何（含 pane 恰好不动）都判忙，绝不报 idle。
#     忙判据零漏报（AC5）是硬上限：transcript 有挂起 tool_use ⇒ 任何情况下不得报 idle。
#   * 去抖（AC2）：候选闲（fused idle）要求【连续 2 轮】都为闲才报 SESSION-IDLE（IDLE_CONSEC
#     计数，2 轮 = 2×INTERVAL，默认 120s）。单轮转换不报——只延迟 ≤1 轮询周期（真空闲下一轮
#     还是闲，不造成漏报），远在 20 分钟 cron 兜底之内。pane 哈希从「唯一判据」降级为「去抖的
#     候选闲辅助」（AC7）；忙→闲后须见过忙轮（SEEN_BUSY）才报，避免监视器启动时把一直闲着的
#     会话误报成「转入空闲」。
#
# 逐事件类别与阈值理由（AC5）：
#   SESSION-GONE              不可自愈（无界）→ 无阈值，立即报（宁可误报）
#   SESSION-IDLE              可自愈（上界=外层 20min tick）→ 从严：默认 LOOP_MIN=20
#                             噪声闸门，心跳陈旧/未知才报；LOOP_MIN=0（管理者显式配置）
#                             = 知悉全部（其明确选择，见 orchestration/session-liveness.env）。
#                             AC21（gap-a-log-already-filtered-by-one-consumers-threshold-cannot-
#                             serve-a-second）：噪声闸门只作用于持有者自己的 stdout——共享
#                             events.jsonl 无条件记全量（含 hmin 原始量），订阅方自己决定报不报。
#   SESSION-RESUMED           可自愈但唯一正向信号 → 立即报、保留（便宜，且是唯一能确认
#                             会话还在按期活动的正向信号）
#   SESSION-OVERDUE           不可自愈（无界）→ 宁可误报：默认 OVERDUE_MIN=30（原 45），
#                             阶段一实测 transcript 最大间隙 20.5min，30min 早报 15min 且留余量
#   SESSION-IDLE-CANT-SEND    不可自愈（发不出请求不会自愈）→ 宁可误报：见即报（AC9）
#   SESSION-MARKER-STALE      检测类（标志失效）→ 无阈值、见即报，随事件流观察不一致率
#   REPO-STALL                仓库信号（非会话面，AC8 裁定承载）→ STALL_MIN=45 保持
# 环境：  INTERVAL / STALL_MIN / LOOP_MIN / OVERDUE_MIN（阈值）
#         SESSION_TARGETS / SESSION_HEARTBEATS / SESSION_TRANSCRIPTS（多目标覆盖；每行 "<名字> <值>"）
#         SESSION_ROOT（测试接缝：覆盖自定位的项目根）

set -uo pipefail
INTERVAL=${INTERVAL:-60}
STALL_MIN=${STALL_MIN:-45}          # 未暂停的项目超过这么久没有新提交 = 停滞（REPO-STALL）
LOOP_MIN=${LOOP_MIN:-20}            # SESSION-IDLE 静默判据的边界（抑制阈值；见 EXPECTED_CYCLE_MIN）
OVERDUE_MIN=${OVERDUE_MIN:-30}      # 超过它就认为会话没在动。AC5（原AC13）不可自愈类宁可误报：
                                    # 默认 45→30（阶段一实测 transcript 长任务最大间隙 20.5min，
                                    # 30min 早报 15min 且仍留 ≥9min 余量）。
# 阶段二新增阈值（AC2/AC9）：
FRESH_SECS=${FRESH_SECS:-15}        # SESSION-MARKER-STALE 的「刚写过」窗口：transcript mtime 距 now
                                    # ≤ 此秒数 = 会话确定在动（工具调用刚发生）。
API_ERROR_WINDOW=${API_ERROR_WINDOW:-200}  # AC9：扫最近多少条 transcript 记录找 isApiErrorMessage
API_ERROR_MIN=${API_ERROR_MIN:-1}          # AC9：窗口内 ≥ 此条即判「发不出请求」（宁可误报一侧）
# 阶段三（2026-08-05）：候选闲去抖轮数。SESSION-IDLE 要求连续 IDLE_DEBOUNCE_ROUNDS 轮 fused-idle
# 才报（AC2——2 轮 × INTERVAL 60s = 120s 结构下界）；单轮转换不报，只延迟 ≤1 轮询周期。
IDLE_DEBOUNCE_ROUNDS=${IDLE_DEBOUNCE_ROUNDS:-2}
# 文案常数（LOOP_MIN 含义拆分，2026-08-03）：OVERDUE 消息里的「预期周期」是固定描述，不是运行时
# 阈值——LOOP_MIN 可以被设成 0（管理者配置），而「预期周期 0 分钟」是文案 bug。两个含义拆开。
EXPECTED_CYCLE_MIN=20
declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE PREV_HASH PREV_IDLE PREV_HALTED UNHALT_TS \
  PREV_BUSY_SEM PREV_API_BLOCKED PREV_MARKER_STALE IDLE_CONSEC SEEN_BUSY

# ── L0（gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX，AC3）──
# 本监视器必须读【真实默认服务端】上的会话，所以不走 tmux-isolated.sh（那会指向一个没有真实
# 会话的私有 socket，读不到任何 pane）。改用 AC3 的「等价显式形态」：`env -u TMUX tmux -S <socket>`。
#   - 显式 `-S` 钉死 socket（压过任何继承的 $TMUX）；`env -u TMUX` 剥掉 $TMUX，使其无法经
#     TMUX_TMPDIR 混淆重新注入 socket（L0 证据：$TMUX 压过 TMUX_TMPDIR，仅设 TMUX_TMPDIR 不隔离）。
#   - 生产：socket = ${TMPDIR:-/tmp}/tmux-$(id -u)/default（真实默认服务端，承载 quay-0 等会话）。
#   - 测试：SESSION_TMUX_SOCKET 显式覆盖（hermetic 测试把探针指向隔离 socket，不碰真实服务端）；
#     向后兼容既有测试的 TMUX_TMPDIR 机制（TMUX_TMPDIR 已设 → socket = $TMUX_TMPDIR/tmux-$(id -u)/default）。
SL_TMUX_SOCKET="${SESSION_TMUX_SOCKET:-}"
if [ -z "$SL_TMUX_SOCKET" ] && [ -n "${TMUX_TMPDIR:-}" ]; then
  # 既有测试的 hermetic 机制：TMUX_TMPDIR 设了、无显式 -S 时，tmux 把 socket 放在
  # $TMUX_TMPDIR/tmux-$(id -u)/default（实测 2026-08-04，不是 $TMUX_TMPDIR/default）。
  SL_TMUX_SOCKET="${TMUX_TMPDIR}/tmux-$(id -u)/default"
fi
if [ -z "$SL_TMUX_SOCKET" ]; then
  SL_TMUX_SOCKET="${TMPDIR:-/tmp}/tmux-$(id -u)/default"
fi
_sl_tmux=(env -u TMUX tmux -S "$SL_TMUX_SOCKET")

# ── 版本可见性（2026-08-03 管理者建议，非规格）──
# 启动时打一行指纹到 stderr——「跑的是哪个版本」可从外部查：对比这行的 md5 与当前文件的 md5，
# 不同即此实例载入的是旧代码（进程握着旧 inode，从外部看不出）。同一族失效今天第四次：
# 进程握旧文件、pgrep 写死旧路径、盯错层的监视器、旧日志报绿。比再加一个事件更有价值。
printf 'session-liveness: starting pid=%s file=%s md5=%s\n' \
  "$$" "$(basename "${BASH_SOURCE[0]}")" "$(md5sum "${BASH_SOURCE[0]}" 2>/dev/null | cut -c1-16)" >&2

# ── 阶段二新增的纯函数（在 case 之前定义，供测试接缝直接调用）────────────────────────────

# mask_pane —— 屏蔽「不是会话内容」的易变区（AC1/规格 AC18）。每条屏蔽规则附「为什么它不是
# 活动信号」：
#   * `/clear to save …`（token 计数行）：停泊会话唯一会变的东西——姊妹任务确认的假阳性源
#     （archguard 停泊 pane 只有 150.2k→151.2k 变，被判成一堆事件）。这是提示语行的 chrome。
#   * 含 ✽ 的行（转圈耗时行）：活跃 spinner，每秒跳——「人不看的部分」。
#   * 含 ✻ 的行（`✻ Baked for …` 残留）：上一次动作留在屏上的字，五个会话全部存在（含空闲的），
#     不能当忙的判据（外层实测：两个停泊 pane 各 2/1，而它们 esc=0）。
# 注意：不按关键词 `tokens` 一刀切——subagent 任务行 `◯ general-purpose … ↓ 57.3k tokens`
# 是真内容，随真实工作而变，必须保留（滤掉它=把假阳性换成假阴性，后者静默、更糟）。
# 输出保留真内容；剥离后内容区为空时主循环的 busy_sem（esc 标志）仍能独立判忙，
# 不会静默判空闲（AC1 的「剥离后内容区不得为空」防过滤保障）。
mask_pane() {
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *'/clear to save'*) continue ;;   # token 计数行（chrome）
      *'✽'*) continue ;;                # 转圈耗时行（活跃 spinner，每秒跳）
      *'✻'*) continue ;;                # `✻ …` 残留（上一次动作的字，空闲会话也有）
      *) printf '%s\n' "$line" ;;
    esac
  done
}

# transcript_api_error_count —— 最近 API_ERROR_WINDOW 条记录里「结构性」isApiErrorMessage 字段
# 的计数（AC9）。结构字段 = 顶层 JSON 键 `"isApiErrorMessage":true`（只有 API 被拒记录才有，
# 实测 archguard 被 429 拒绝会话最近 200 条为 6、健康/陈旧会话为 0）。
# 不用 429 文案（绑死供应商文案，换端点即失效）；不用「transcript 是否增长」（429 也会被写进
# transcript，增长分不开两种空闲——被拒会话实测仍在增长，而记录的类型可以）。
# grep 模式 `"isApiErrorMessage":…true` 只命中顶层键：content 里文字提及该字段的形式是
# `isApiErrorMessage: true` 或转义键 `\"isApiErrorMessage\":…`，前导不是裸 `"`，不会误命中。
transcript_api_error_count() {
  local t=$1 n
  n=$(tail -n "$API_ERROR_WINDOW" "$t" 2>/dev/null | grep -c '"isApiErrorMessage"[[:space:]]*:[[:space:]]*true' 2>/dev/null || true)
  [ -z "$n" ] && n=0
  printf '%s\n' "$n"
}

# transcript_last_message_type —— transcript 最后一条【消息】的类型（阶段三 AC1）。决定「候选闲」
# 还是「确定忙」；输出：
#   pending-tool-use  最后一条消息是 assistant 且 content 含 tool_use 块 = 回合进行中，确定忙
#   pure-text         最后一条消息是 assistant 且 content 无 tool_use（纯文本/思考）= 候选闲
#   user-input        最后一条消息是 user（新输入或 tool_result 回执）= 模型即将应答，按忙处理
#   unknown           取不到/无消息记录
# 扫描只认顶层 type=assistant|user 的记录（跳过 system/mode/last-prompt/file-history-* 等元数据），
# 从尾部向前找最后一条消息——「最后一条消息」才是忙闲判据，不是「文件最后一行」（那常是元数据，
# 实测距文件尾 ≤2 行的元数据会盖住真正的最后消息）。grep 模式 `"type":"assistant"` 只命中顶层：
# content 块的类型是 text/thinking/tool_use/tool_result，message 对象的类型是 message，都不是
# assistant；同理 `"type":"user"` 只命中顶层 user 记录（tool_result 块的类型是 tool_result）。
# tail 界 500 行提速（最后一条消息实测距文件尾 ≤2 行）；无匹配再全扫兜底。
transcript_last_message_type() {
  local t=$1 line
  line=$(tail -n 500 "$t" 2>/dev/null | grep -E '"type":"(assistant|user)"' | tail -1)
  [ -n "$line" ] || line=$(grep -E '"type":"(assistant|user)"' "$t" 2>/dev/null | tail -1)
  [ -n "$line" ] || { echo "unknown"; return 0; }
  case "$line" in
    *'"type":"user"'*)
      echo "user-input" ;;
    *)
      if printf '%s' "$line" | grep -q '"type":"tool_use"'; then
        echo "pending-tool-use"
      else
        echo "pure-text"
      fi ;;
  esac
}

# last_user_input_epoch —— transcript 里最近一条 type=user 记录的时间戳转 epoch（AC7）。
# 会话收到输入（打字 / send-keys / loop 注入的提示）都会写 type=user 记录；「最后一次收到输入
# 的时刻」= 最近一条这种记录的 timestamp。返回空 = 取不到（无匹配/解析失败）。
last_user_input_epoch() {
  local t=$1 line ts
  line=$(grep '"type":"user"' "$t" 2>/dev/null | tail -1)
  [ -n "$line" ] || return 1
  ts=$(printf '%s' "$line" | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ts" ] || return 1
  date -d "$ts" +%s 2>/dev/null || return 1
}

# ── 共享事件文件与心跳（AC20c/AC7，2026-08-03）──────────────────────────────────────────────
# AC20c：事件写进共享文件（$QUAY_GLOBAL_DIR/session-liveness/events.jsonl），订阅与挂载分离——
# 要看事件的人不必自己挂一个。AC7：共享事件文件带心跳/时间戳，订阅方能据此判定「看门的已经不在了」，
# 且该判定不依赖任何人恰好去尝试挂载。持有者每轮往 events.jsonl 追加一条 HEARTBEAT 事件，订阅方
# 取最后一条的 ts（或文件 mtime）与当前时间比对，超过阈值即判定持有者已死——即使没有任何人去试挂。
# 状态目录（含锁、事件、心跳）在 $QUAY_GLOBAL_DIR 之外每个仓库共享，删任何仓库都不能删掉别的状态。
sl_now_ms() {
  local out s n
  out="$(date +%s%N 2>/dev/null || echo 0000000000000000000)"
  case "$out" in ''|*[!0-9]*) out="0000000000000000000" ;; esac
  s="${out:0:10}"
  n="${out:10:9}"
  case "$n" in ''|*[!0-9]*) n="000000000" ;; esac
  printf '%s%03d' "${s:-0}" "$(( 10#${n:0:3} ))"
}

# sl_json_append —— 把一行事件追加进共享 events.jsonl（JSON 行；事件行不换行，python3 负责转义）。
sl_json_append() {
  local line="$1" event name ts line_json
  event="${line%% *}"
  name="${line#* }"; name="${name%% *}"
  ts=$(sl_now_ms)
  line_json=$(printf '%s' "$line" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || { printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g'; })
  printf '{"ts":%s,"event":%s,"name":%s,"msg":%s}\n' \
    "$ts" "$(printf '"%s"' "$event")" "$(printf '"%s"' "$name")" "$line_json" \
    >> "${SL_EVENTS_FILE:-/dev/null}" 2>/dev/null || true
}

# sl_emit_shared —— 只写共享 events.jsonl（订阅方读取），不走 stdout。AC21（gap-a-log-already-
# filtered-by-one-consumers-threshold-cannot-serve-a-second）：共享文件记全量，阈值只作用于持有者
# 自己的 stdout——被持有者阈值静默的事件（如 hmin < LOOP_MIN 的健康空闲）仍须进入共享文件，让订阅方
# 自己决定报不报。写共享文件失败（目录不可写）只回落到无操作，绝不 crash（与令牌 fail-open 同源：
# 调度角色不是安全检查）。
sl_emit_shared() {
  [ -n "${SL_EVENTS_FILE:-}" ] || return 0
  [ -d "${SL_GLOBAL_DIR:-}" ] && [ -w "$SL_GLOBAL_DIR" ] || return 0
  sl_json_append "$*"
}

# sl_emit —— 事件同时走 stdout（Monitor 事件流）与共享 events.jsonl（订阅方读取）。stdout 是持有者
# 自己的通知流，受持有者阈值门控；共享文件由 sl_emit_shared 无条件记全量（AC21：记录与判断分开）。
sl_emit() {
  echo "$*"
  sl_emit_shared "$*"
}

# sl_heartbeat —— 持有者每轮追加一条 HEARTBEAT（只进共享文件，不污染 stdout/Monitor 事件流）。
# 订阅方取最后一条 ts 判「看门的不在了」——这是 AC7 的判据，不依赖任何人去试挂。
sl_heartbeat() {
  [ -n "${SL_EVENTS_FILE:-}" ] || return 0
  [ -d "${SL_GLOBAL_DIR:-}" ] && [ -w "$SL_GLOBAL_DIR" ] || return 0
  printf '{"ts":%s,"event":"HEARTBEAT","name":%s,"msg":"holder alive"}\n' \
    "$(sl_now_ms)" "$(printf '"%s"' "${SL_OWNER:-unknown}")" \
    >> "$SL_EVENTS_FILE" 2>/dev/null || true
}

ONE_SHOT=false
case "${1:-}" in
  --once) ONE_SHOT=true ;;
  --mask) mask_pane; exit 0 ;;
  --api-errors)
    [ -n "${2:-}" ] || { echo "用法: $0 --api-errors <transcript>" >&2; exit 2; }
    transcript_api_error_count "$2"; exit 0 ;;
  --last-input)
    [ -n "${2:-}" ] || { echo "用法: $0 --last-input <transcript>" >&2; exit 2; }
    if last_user_input_epoch "$2"; then :; else echo "取不到"; fi
    exit 0 ;;
  --last-message-type)
    [ -n "${2:-}" ] || { echo "用法: $0 --last-message-type <transcript>" >&2; exit 2; }
    transcript_last_message_type "$2"; exit 0 ;;
  -h|--help) echo "用法: $0 [--once] [--mask] [--api-errors <t>] [--last-input <t>] [--last-message-type <t>]"; exit 0 ;;
esac

# ── 本项目根：自定位（同 inner-state.sh）。SESSION_ROOT 是测试接缝，生产不设。 ──────────────
REPO_ROOT="${SESSION_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  _sl_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_sl_script_dir/../.." && pwd)"
fi

# ── 管理者的多目标配置（AC9）：orchestration/session-liveness.env 存在则 source。
#    shell KEY=VALUE，不是 YAML。显式环境变量 SESSION_TARGETS 优先。 ───────────────────────
if [ -z "${SESSION_TARGETS:-}" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/orchestration/session-liveness.env" \
    || echo "session-liveness: WARN 无法解析 $REPO_ROOT/orchestration/session-liveness.env，回落到默认" >&2
  set +a
fi

# ── 默认目标（零配置）：本项目自己的会话。会话名优先级见文件头（env → 配置 → 默认值）。 ──
# 注意（两个已踩过的坑，历史）：占位符曾经必须作为【裸赋值】出现、不能嵌在 ${} 里——替换后的
# 会话值（含 :/.）会变成参数展开语法静默产出垃圾目标；「是否已替换」的判据也不能用完整占位符做
# 字面比较。2026-08-03 起脚本不再被 quay-init 改写（可执行文件原样复制、只生成配置），这两个坑
# 随之失去存在前提——会话名一律经 env / orchestration/session-liveness.env / 默认值解析。
# 环境变量显式设置优先（先钉住，避免被配置文件 source 覆盖）：env > 配置 > 默认值。
_sl_session_env="${SESSION_TMUX_SESSION:-}"
if [ -z "${SESSION_TARGETS:-}" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/orchestration/session-liveness.env" \
    || echo "session-liveness: WARN 无法解析 $REPO_ROOT/orchestration/session-liveness.env，回落到默认" >&2
  set +a
fi
if [ -n "$_sl_session_env" ]; then
  SESSION_TMUX_SESSION="$_sl_session_env"
fi
_sl_session="${SESSION_TMUX_SESSION:-}"
if [ -z "$_sl_session" ]; then
  # gap-init-guesses-the-tmux-session: NO guess. The old fallback was "<basename>-0" — the same
  # guessed value that aimed a live monitor at a nonexistent session and reported a LIVE inner as
  # GONE (the false-negative this monitor must never emit). When no session is configured (env +
  # env-file both absent) the zero-config default target CANNOT be formed: fail-closed rather than
  # monitor a made-up session. SESSION_TARGETS (the manager's explicit multi-target topology) is
  # exempt — it does not need the default target at all.
  if [ -z "${SESSION_TARGETS:-}" ]; then
    echo "session-liveness: ERROR 未配置任何 tmux 会话（SESSION_TMUX_SESSION 未设，且 orchestration/session-liveness.env 不存在或未含 SESSION_TMUX_SESSION）。" >&2
    echo "       quay-init --loop 会把检测到的真实会话写进 orchestration/session-liveness.env；检测不到时安装会失败。" >&2
    echo "       请显式设置 SESSION_TMUX_SESSION（或 SESSION_TARGETS）——监视器绝不猜一个会话名。" >&2
    exit 2
  fi
  _sl_session_base=""
else
  _sl_session_base="${_sl_session%%:*}"
fi
DEFAULT_TARGET="${_sl_session_base}:outer"

# 可被 SESSION_TARGETS 覆盖——存在的理由是【可测】（handoff rule 2：不能靠「干跑没有输出」
# 证明监视器会报，那与「它永远不报」同形）。用测试控制的探针 pane 做正控制，才是证据。
targets() {
  if [ -n "${SESSION_TARGETS:-}" ]; then printf '%s\n' "$SESSION_TARGETS"; return; fi
  # 零配置默认：本项目自己（名字=项目名、根=项目根、目标=<会话>:outer 窗口）。
  # gap-init-guesses-the-tmux-session：_sl_session_base 为空 = 无会话配置，上面的 fail-closed
  # 应在进入循环前就已退出；这里再守一道，绝不把 ":outer" 这样的残缺目标喂给监视器。
  [ -n "$_sl_session_base" ] || {
    echo "session-liveness: ERROR 零配置目标无会话名（$_sl_session_base）——请配置 SESSION_TMUX_SESSION 或 SESSION_TARGETS" >&2
    return 1
  }
  echo "$(basename "$REPO_ROOT") $REPO_ROOT $DEFAULT_TARGET"
}

# 各目标的【心跳】文件路径（AC11 可参数化）。心跳 = 这个会话活着时会定期写的东西：
# 外层是 tick 日志，内层是它的工作产出（.workflow-events/ 之类）。心跳信号是【有没有按期在动】，
# 不是【有没有新提交】——2026-08-03 实测：会话空闲等输入时，进程活着且刚提交过，前三个事件全部
# 静默，而「空闲等下一个心跳」与「会话已死、永远不会再动」在那个事件集里完全同形。
# 可被 SESSION_HEARTBEATS 覆盖（每行 "<名字> <心跳路径>"）——与 SESSION_TARGETS 同理，为可测；
# 无匹配时返回空（判据不触发）。默认是外层 tick 日志（这是唯一保留的「外层」字样：默认值）。
# transcript_for —— 每目标的 transcript 选择器（AC16，外层建议：会话 id 是配置，不去推断）。
# SESSION_TRANSCRIPTS 每行 "<名字> <会话id|绝对路径>"：
#   绝对路径 → 直接用；会话 id（uuid）→ 解析为 $HOME/.claude/projects/<root-slug>/<id>.jsonl。
# 解析出的 transcript 心跳取「主文件 + <id>/subagents/」的最大 mtime（内层派 subagent 时写后者）。
transcript_for() {
  local name=$1 root=$2 v
  if [ -n "${SESSION_TRANSCRIPTS:-}" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$name" ]; then
        case "$v" in
          /*) printf '%s\n' "$v"; return 0 ;;  # 绝对路径
          *) printf '%s/.claude/projects/%s/%s.jsonl\n' \
               "$HOME" "$(printf '%s' "$root" | tr '/' '-')" "$v"; return 0 ;;
        esac
      fi
    done <<< "$SESSION_TRANSCRIPTS"
  fi
  return 1
}

heartbeat_for() {
  local name=$1 root=$2 t
  if t=$(transcript_for "$name" "$root"); then printf '%s\n' "$t"; return 0; fi
  if [ -n "${SESSION_HEARTBEATS:-}" ]; then
    while read -r n p; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$name" ]; then printf '%s\n' "$p"; return 0; fi
    done <<< "$SESSION_HEARTBEATS"
    return 1
  fi
  echo "$REPO_ROOT/orchestration/tick-log.md"
}

# heartbeat_mtime —— 心跳源的 mtime（epoch）。对 transcript（*.jsonl）还并上
# <会话>/subagents/*.jsonl 的最大 mtime：内层把工作派给 subagent 时写的是那里，
# 只看主文件会把「正忙于委派」误判成「冻结」。返回 0 = 源不存在/不可读。
heartbeat_mtime() {
  local p=$1 max=0 ts f subdir
  if [ -e "$p" ]; then
    ts=$(stat -c %Y "$p" 2>/dev/null || echo 0)
    max=$ts
  fi
  case "$p" in
    *.jsonl)
      subdir="${p%.jsonl}/subagents"
      if [ -d "$subdir" ]; then
        for f in "$subdir"/*.jsonl; do
          [ -e "$f" ] || continue
          ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
          [ "$ts" -gt "$max" ] && max=$ts
        done
      fi
      ;;
  esac
  echo "$max"
}

session_pid() {  # 按窗口名寻址；pane 索引会漂。找 pane shell 的第一个 claude 子进程。
  local t=$1 ppid cpid
  ppid=$("${_sl_tmux[@]}" list-panes -t "$t" -F '#{pane_pid}' 2>/dev/null | head -1) || true
  [ -n "${ppid:-}" ] || { echo ""; return; }
  cpid=$(pgrep -P "$ppid" 2>/dev/null | head -1) || true
  # 只认 claude 进程，避免把 shell 当成会话本体
  if [ -n "${cpid:-}" ] && tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null | grep -q claude; then
    echo "$cpid"
  else
    echo ""
  fi
}

# ── 单飞挂载门（AC20a/b/d/AC5/AC6，管理者 AC20 判据逐字照搬，不改写）──────────────────────────
# 「谁需要谁自己起一个」对单飞资源是错的默认；正确的默认是「谁需要谁去订阅」，挂载是一个有主的、
# 可接管的角色。这与令牌同理，区别只在于令牌天然排他、监视器看起来不排他——看起来不是，所以
# 没人给它加锁。这里补上那把锁：
#   AC20a 单飞锁：挂载前取锁，**复用 heavy-op-token.sh 已验证的那套**（wx 原子创建 + mtime 陈旧
#         AND pid 不存活才回收，绝不裸覆盖、绝不永久锁死）。不新写一套——那套锁今天已在真实死
#         持有者上回收了 17 次，是本仓唯一被实战验证过的锁。复用点：对同一把锁文件调用
#         `heavy-op-token.sh --acquire <owner> --root <dir> [--timeout N]`。
#   AC20b 第二个挂载是空操作：检测到活持有者 ⇒ 打印属主与 pid，**退出 0**。报错会让人去 kill，
#         而 kill 正是这一整摊事的来源。
#   AC20d 接管负控制：持有者被 kill -9 后，下一次挂载必须接管（陈旧回收），否则单飞就变单点故障。
#   AC5  反向负控制：持有者活着时再挂 ⇒ 绝不接管、不 kill 任何进程。把「重复挂载」换成「互相抢夺」
#        是更坏的交易。
# 状态目录：${QUAY_GLOBAL_DIR:-$HOME/.quay-global}/session-liveness/（测试接缝 SESSION_LIVENESS_GLOBAL_DIR）。
SL_GLOBAL_DIR="${SESSION_LIVENESS_GLOBAL_DIR:-${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}/session-liveness}"
SL_EVENTS_FILE="${SL_GLOBAL_DIR}/events.jsonl"
# 属主 = 挂载这个监视器的会话身份（管理者的多目标配置里 SESSION_LIVENESS_OWNER 可显式给出）。
SL_OWNER="${SESSION_LIVENESS_OWNER:-$(basename "$REPO_ROOT")}"
SL_MOUNT_STALE_S="${SESSION_LIVENESS_MOUNT_STALE_S:-3}"   # 死持有者多久可回收（pid 活着永不回收，只影响接管速度）
SL_MOUNT_WAIT_S=$(( SL_MOUNT_STALE_S + 3 ))               # 接管的有界等待上限（覆盖陈旧窗口 + 余量）
_sl_lock_holder=0

_sl_release_mount_lock() {
  [ "$_sl_lock_holder" = "1" ] || return 0
  local hot="$REPO_ROOT/plugin/scripts/heavy-op-token.sh"
  if [ -x "$hot" ]; then
    HEAVY_OP_STALE_TIMEOUT_S="$SL_MOUNT_STALE_S" bash "$hot" --release "$SL_OWNER" --root "$SL_GLOBAL_DIR" >/dev/null 2>&1 || true
  fi
  _sl_lock_holder=0
}

# _sl_acquire_or_noop —— 单飞门的一次性判定。返回：
#   0 = 已取得锁（本进程成为持有者，继续跑监视器）；1 = 有活持有者（空操作，调用方退出 0）；
#   2 = fail-open（状态目录不可写，无锁继续——调度角色不是安全检查，与令牌同源）。
_sl_acquire_or_noop() {
  local hot="$REPO_ROOT/plugin/scripts/heavy-op-token.sh"
  local lock_token="$SL_GLOBAL_DIR/heavy-op/token"
  local start_ms holder_pid acq_out err_file rc took out_file howner
  if [ ! -x "$hot" ]; then
    echo "session-liveness: WARN 找不到 $hot，跳过单飞锁（fail-open）" >&2
    return 2
  fi
  local preexisting=0; [ -e "$lock_token" ] && preexisting=1
  start_ms=$(sl_now_ms)
  # 关键：必须把 heavy-op-token 的 stdout 重定向到文件再读，不能用命令替换 `$(...)`——命令替换会
  # 引入一个瞬态子 shell 作为 heavy-op-token 的父进程，而 heavy-op-token 记录的是 $PPID，于是锁会
  # 记下子 shell 的 pid（随即退出）而非监视器自身的 pid；下一个挂载看到「死 pid」就会误回收活持有者
  # （实测踩中：锁 pid 是命令替换子 shell，不是监视器进程）。
  out_file=$(mktemp 2>/dev/null) || out_file="/tmp/sl-mount-out-$$"
  err_file=$(mktemp 2>/dev/null) || err_file="/tmp/sl-mount-err-$$"
  HEAVY_OP_STALE_TIMEOUT_S="$SL_MOUNT_STALE_S" bash "$hot" \
    --acquire "$SL_OWNER" --root "$SL_GLOBAL_DIR" --timeout 0 >"$out_file" 2>"$err_file"
  rc=$?
  acq_out=$(cat "$out_file")
  if [ "$rc" = "0" ]; then
    case "$acq_out" in
      *acquired=yes*)
        rm -f "$out_file" "$err_file"
        if [ "$preexisting" = "1" ]; then
          took=$(( $(sl_now_ms) - start_ms ))
          echo "session-liveness-mount: 接管成功 takeover_ms=${took}（陈旧锁被回收，前一持有者已死）"
        else
          echo "session-liveness-mount: 成为挂载持有者（属主 ${SL_OWNER}，pid $$）"
        fi
        _sl_lock_holder=1
        trap _sl_release_mount_lock EXIT
        return 0 ;;
      *acquired=no*)   # fail-open：状态目录不可写/不可达，无锁继续
        echo "session-liveness: WARN 单飞锁 fail-open（$(cat "$err_file" 2>/dev/null || true)），无锁继续运行监视器" >&2
        rm -f "$out_file" "$err_file"
        return 2 ;;
      *) echo "session-liveness: WARN 单飞锁返回异常（$acq_out），无锁继续" >&2
        rm -f "$out_file" "$err_file"
        return 2 ;;
    esac
  fi
  # 未取得：区分「活持有者」与「死持有者待接管」。
  holder_pid=$(awk -F= '$1=="pid"{print $2; exit}' "$lock_token" 2>/dev/null || true)
  if [ -n "$holder_pid" ] && kill -0 "$holder_pid" 2>/dev/null; then
    # AC20b：第二个挂载是空操作，退出 0——报错会让人去 kill，而 kill 正是这一整摊事的来源。
    howner=$(awk -F= '$1=="holder"{print $2; exit}' "$lock_token" 2>/dev/null || echo unknown)
    echo "session-liveness-mount: 已有活持有者（属主 ${howner}，pid ${holder_pid}）——第二个挂载是空操作（exit 0），不新增进程"
    rm -f "$out_file" "$err_file"
    return 1
  fi
  # 死持有者（kill -9 后）→ 有界等待接管（AC20d 负控制）。`--timeout N` 会每秒重查回收条件，
  # 一旦 mtime 越过陈旧阈值就回收并取得——这本身就是接管，takeover_ms 从第一次尝试起算。
  HEAVY_OP_STALE_TIMEOUT_S="$SL_MOUNT_STALE_S" bash "$hot" \
    --acquire "$SL_OWNER" --root "$SL_GLOBAL_DIR" --timeout "$SL_MOUNT_WAIT_S" >"$out_file" 2>"$err_file"
  rc=$?
  acq_out=$(cat "$out_file")
  rm -f "$out_file" "$err_file"
  if [ "$rc" = "0" ] && [[ "$acq_out" == *acquired=yes* ]]; then
    took=$(( $(sl_now_ms) - start_ms ))
    echo "session-liveness-mount: 接管成功 takeover_ms=${took}（前一持有者已死，锁被回收）"
    _sl_lock_holder=1
    trap _sl_release_mount_lock EXIT
    return 0
  fi
  echo "session-liveness-mount: 无法接管单飞锁（$acq_out）——空操作（exit 0）" >&2
  return 1
}

# 单飞门只在长跑模式生效（--once / --mask / --api-errors / --last-input 是诊断接缝，不取锁）。
# 关键：必须【直接调用】_sl_acquire_or_noop，不能用 `case "$( _sl_acquire_or_noop )" in` 的命令替换——
# 命令替换会把函数放进一个瞬态子 shell，heavy-op-token 记录的 $PPID 就变成子 shell 的 pid（随即退出），
# 且子 shell 的 EXIT trap 会在函数返回时立刻释放锁——锁被取到后瞬间释放，单飞直接失效（实测踩中）。
if [ "$ONE_SHOT" != true ]; then
  _sl_acquire_or_noop
  _sl_gate_rc=$?
  if [ "$_sl_gate_rc" = "1" ]; then
    exit 0   # 有活持有者：空操作（exit 0，不是失败）
  fi
  # 0=持有 / 2=fail-open：继续跑监视器。
fi

while true; do
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    pid=$(session_pid "$target")
    alive=$([ -n "$pid" ] && echo 1 || echo 0)
    halted=$([ -f "$root/.halt" ] && echo 1 || echo 0)
    resumed=0   # 本轮该目标是否已报 SESSION-RESUMED（OVERDUE 与 RESUMED 不得同轮同目标同发）

    # 该目标的 transcript 路径（AC2/AC7/AC9 用）：SESSION_TRANSCRIPTS 配置了才有；
    # 没有 → tr_path 空，AC2 交叉正控制与 AC9 发不出请求检查对该目标不适用（tick 日志不是会话证据）。
    tr_path=""
    tr_path=$(transcript_for "$name" "$root" || true)

    # 停机基线（协调方 2026-08-03 样本）：解除停机那一刻重置陈旧度起点。监视器每轮自己观察
    # .halt 从存在→不存在，不需要额外状态源。archguard 停泊 310 分钟后删 .halt，同一轮打出
    # OVERDUE 误报——根因是基线没重置，不是源选错也不是缺抑制。
    if [ "$halted" = "1" ]; then
      PREV_HALTED[$name]=1
    else
      if [ "${PREV_HALTED[$name]:-0}" = "1" ]; then
        UNHALT_TS[$name]=$(date +%s)
      fi
      PREV_HALTED[$name]=0
    fi
    base_ts=${UNHALT_TS[$name]:-0}   # 解除停机时刻；0 = 本监视器运行期间未经历过停机

    # --once 接缝：每轮每个目标报一行状态（冷启动/安装后自检用，AC7）。
    if [ "$ONE_SHOT" = true ]; then
      echo "SESSION-STATUS $name alive=$alive${pid:+ pid=$pid}${halted:+ halted=$halted}"
    fi

    # 事件 1/2：消失与恢复
    if [ "${PREV_ALIVE[$name]:-unset}" != "unset" ] && [ "${PREV_ALIVE[$name]}" != "$alive" ]; then
      if [ "$alive" = "0" ]; then
        sl_emit "SESSION-GONE $name 的会话进程消失（目标 $target）——立即报"
      else
        sl_emit "SESSION-BACK $name 的会话已恢复（pid $pid）"
      fi
    fi
    PREV_ALIVE[$name]=$alive

    # 事件 3：REPO-STALL（原 SESSION-STALL，AC8 改名）——活着但不推进（仓库信号，不是会话面）。
    # 只对未暂停的项目判；暂停期间不推进是正常的。陈旧度同样以解除停机时刻为下界——停泊期间的
    # 提交年龄不应在解除停机后立即算作停滞。
    if [ "$alive" = "1" ] && [ "$halted" = "0" ]; then
      last=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)
      if [ "$last" != "0" ]; then
        eff=$last; [ "$base_ts" -gt "$eff" ] && eff=$base_ts
        mins=$(( ( $(date +%s) - eff ) / 60 ))
        stalled=$([ "$mins" -ge "$STALL_MIN" ] && echo 1 || echo 0)
        if [ "$stalled" = "1" ] && [ "${PREV_STALL[$name]:-0}" = "0" ]; then
          sl_emit "REPO-STALL $name 的会话活着但仓库 ${mins} 分钟无新提交（未暂停）——仓库信号：不是会话面"
        fi
        PREV_STALL[$name]=$stalled
      fi
    else
      PREV_STALL[$name]=0
    fi

    # 事件 5：转入空闲 / 恢复忙碌 —— 这是【及时】信号，事件 4 是 OVERDUE_MIN 分钟后的兜底。
    #
    # 人 2026-08-03 指出：「我可以接受让 outer 等待，但应当是你及时知道发生了什么并决定让它等待。」
    # 原来的事件集只有滞后指标：会话跑完一次操作转入空闲时，进程活着、刚提交过，全部静默。
    #
    # 判据（阶段二，AC1/规格 AC18）：屏幕信号改为【语义标志 + 屏蔽易变区】，不是整屏哈希。
    #   忙 = `esc to interrupt` 存在（按【存在性】判，不按计数——实测管理者 4 次/内层 1 次，
    #   计数无意义）或 屏蔽易变区后的内容区有变化（保住非 TUI 探针 / subagent 输出这类真活动）。
    #   闲 = 两样都没有。易变区（转圈耗时 ✽ / token 计数 /clear to save / ✻ 残留）被 mask_pane
    #   剥离，所以「停泊会话只有 token 计数器在变」不会判忙（姊妹任务的假阳性源在此吸收）。
    # 不用 /proc CPU 增量：空闲的 Claude Code TUI 本身也在烧 CPU（实测 10 vs 132 jiffies，分离度太弱）。
    if [ "$alive" = "1" ]; then
      raw=$("${_sl_tmux[@]}" capture-pane -p -t "$target" 2>/dev/null)
      busy_esc=$(printf '%s\n' "$raw" | grep -c 'esc to interrupt' 2>/dev/null || true)
      [ -z "$busy_esc" ] && busy_esc=0
      busy_sem=$([ "$busy_esc" -ge 1 ] 2>/dev/null && echo 1 || echo 0)
      masked=$(printf '%s\n' "$raw" | mask_pane)
      h=$(printf '%s' "$masked" | md5sum | cut -c1-16)
      if [ -n "${PREV_HASH[$name]:-}" ]; then
        content_changed=$([ "$h" = "${PREV_HASH[$name]}" ] && echo 0 || echo 1)
        pane_busy=$(( busy_sem || content_changed ))
        pane_idle=$(( 1 - pane_busy ))
        # 阶段三（AC1）：transcript 最后一条消息类型接入忙闲判据。transcript 侧优先级更高——
        # pending-tool-use / user-input ⇒ 确定忙，无论 pane 如何（AC5 忙判据零漏报）。
        transcript_busy=0
        if [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
          ttype=$(transcript_last_message_type "$tr_path")
          case "$ttype" in
            pending-tool-use|user-input) transcript_busy=1 ;;
            *) transcript_busy=0 ;;
          esac
        fi
        fused_busy=$(( pane_busy || transcript_busy ))
        idle=$(( 1 - fused_busy ))
        # AC2 去抖：连续 fused-idle 轮数计数；忙轮清零。pane 哈希降级为候选闲辅助（AC7）。
        if [ "$idle" = "1" ]; then
          IDLE_CONSEC[$name]=$(( ${IDLE_CONSEC[$name]:-0} + 1 ))
        else
          IDLE_CONSEC[$name]=0
          SEEN_BUSY[$name]=1
        fi
        if [ "${PREV_IDLE[$name]:-unset}" != "unset" ] && [ "${PREV_IDLE[$name]}" != "$idle" ]; then
          if [ "$idle" = "1" ]; then
            # 忙→闲【单轮转换不报】——去抖（AC2）持有：只延迟 ≤1 轮询周期（真空闲下一轮还是闲，
            # 不造成漏报），远在 20 分钟 cron 兜底之内。真正的 SESSION-IDLE 由下面 counter 分支报。
            :
          else
            resumed=1
            # AC6/AC7：SESSION-RESUMED 带成因 payload（哪个标志/哪个区变了）+ 上次收到输入时刻。
            # 判据：收到事件后无需再采样即可判真假（原外层 3-4 次调用，改后 1 次）。
            cause_parts=()
            [ "$busy_sem" = "1" ] && [ "${PREV_BUSY_SEM[$name]:-0}" = "0" ] && cause_parts+=("esc to interrupt 标志出现")
            [ "$content_changed" = "1" ] && cause_parts+=("屏蔽易变区后的屏幕内容区变化")
            cause=""
            for part in "${cause_parts[@]:-}"; do
              [ -n "$part" ] || continue
              [ -n "$cause" ] && cause="$cause + $part" || cause="$part"
            done
            [ -n "$cause" ] && cause="$cause" || cause="状态变化"
            lastin="取不到"
            if [ -n "$tr_path" ] && [ -r "$tr_path" ]; then
              if lep=$(last_user_input_epoch "$tr_path") && [ -n "$lep" ]; then
                lmin=$(( ( $(date +%s) - lep ) / 60 ))
                [ "$lmin" -lt 0 ] && lmin=0
                lastin="${lmin} 分钟前"
              fi
            fi
            sl_emit "SESSION-RESUMED $name 的会话恢复活动（此前空闲；成因：${cause}；上次收到输入：${lastin}）"
          fi
        fi
        PREV_IDLE[$name]=$idle
        # 去抖后的 SESSION-IDLE 报告（AC2）：连续 IDLE_DEBOUNCE_ROUNDS 轮 fused-idle 且此前见过
        # 忙轮（SEEN_BUSY，防启动误报）才报。单轮转换不报（上面）；counter==N 精确触发一次。
        if [ "$idle" = "1" ] && [ "${IDLE_CONSEC[$name]:-0}" -eq "$IDLE_DEBOUNCE_ROUNDS" ] && [ "${SEEN_BUSY[$name]:-0}" = "1" ]; then
          hb=$(heartbeat_for "$name" "$root"); hmin="?"
          hmod=$(heartbeat_mtime "${hb:-/nonexistent}")
          [ "$hmod" != "0" ] && hmin=$(( ( $(date +%s) - hmod ) / 60 ))
          halt_msg=$([ "$halted" = "1" ] && echo "（该项目已暂停，空闲是预期状态）" || echo "")
          # AC9（盲点13）：空闲且发不出请求（最近 transcript 记录带结构性 isApiErrorMessage）。
          # 这是「不可自愈类」——发不出请求不会自己好，按 AC5 宁可误报一侧，见即报（升级给人）。
          # 与常规 IDLE 互斥：能发请求才谈「没活干」，故这里直接二选一。
          api_n=0; api_blocked=0
          if [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
            api_n=$(transcript_api_error_count "$tr_path")
            api_blocked=$([ "$api_n" -ge "$API_ERROR_MIN" ] 2>/dev/null && echo 1 || echo 0)
          fi
          PREV_API_BLOCKED[$name]=$api_blocked
          if [ "$api_blocked" = "1" ]; then
            sl_emit "SESSION-IDLE-CANT-SEND $name 的会话空闲且发不出请求（最近 ${API_ERROR_WINDOW} 条 transcript 记录含 ${api_n} 条 isApiErrorMessage 结构字段）——不可自愈类，立即升级给人"
          elif [ "$hmin" = "?" ] || [ "$hmin" -ge "$LOOP_MIN" ]; then
            # 噪声标定（管理者 3 个完整周期实测，2026-08-03）：健康循环是「刚动过（写了心跳）才转
            # 空闲」（心跳时距 ~1 分钟），每 20 分钟一对事件、三项目满载 18 次/小时，全是「一切正常」。
            # hmin < LOOP_MIN 的空闲 = 正常收尾 → 持有者 stdout 静默；hmin ≥ LOOP_MIN 或未知
            # （无心跳文件）=「空闲了但没动」，会话可能跑一半就停 / 已死 → 持有者 stdout 报。
            # SESSION-RESUMED 保留不静默（它便宜，且是唯一能确认会话还在按期活动的正向信号）。
            sl_emit "SESSION-IDLE $name 的会话转入空闲等输入；心跳 ${hmin} 分钟前更新${halt_msg}"
          else
            # AC21（gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second）：
            # hmin < LOOP_MIN（正常收尾）——持有者自己的 stdout 静默（噪声闸门），但共享 events.jsonl
            # 照记全量（含 hmin 原始量），让订阅方（管理者）自己决定报不报。这就是 AC21c 的负控制：
            # 持有者 LOOP_MIN=20 时，共享文件里仍须出现 hmin < 20 的 IDLE 记录——出现即通过。
            sl_emit_shared "SESSION-IDLE $name 的会话转入空闲等输入；心跳 ${hmin} 分钟前更新${halt_msg}"
          fi
        fi
        # AC2（交叉正控制）：transcript 刚写过（会话确定在动）而【屏幕】判空闲 ⇒ 屏幕标志可能失效。
        # 只对「心跳是 transcript」的目标成立——tick 日志是 loop 写的，不是会话活动的证据。
        # 假→真沿报一次；不一致率基线由观察者从事件流里数（全忙会话同时报 = TUI 文案变了）。
        # 判据用 pane_idle（屏幕判定）——transcript 侧确定忙时不该报「屏幕判空闲」。
        if [ "$pane_idle" = "1" ] && [ "$halted" = "0" ] && [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
          hmod2=$(heartbeat_mtime "$tr_path")
          if [ "$hmod2" != "0" ]; then
            age=$(( $(date +%s) - hmod2 ))
            fresh=$([ "$age" -le "$FRESH_SECS" ] 2>/dev/null && echo 1 || echo 0)
            if [ "$fresh" = "1" ] && [ "${PREV_MARKER_STALE[$name]:-0}" = "0" ]; then
              sl_emit "SESSION-MARKER-STALE $name 的屏幕标志可能失效：transcript ${age}s 前刚写过（会话确定在动）但屏幕判空闲——检查 esc to interrupt 是否还在渲染"
            fi
            PREV_MARKER_STALE[$name]=$fresh
          fi
        else
          PREV_MARKER_STALE[$name]=0
        fi
        # AC9（盲点13）每轮复查：覆盖「早已空闲、随后才被 429」的情形（转换时已查一次并钉住
        # PREV_API_BLOCKED；这里对持续空闲会话每轮复查，假→真沿再报一次）。
        if [ "$idle" = "1" ] && [ "$halted" = "0" ] && [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
          api_n2=$(transcript_api_error_count "$tr_path")
          api_blocked2=$([ "$api_n2" -ge "$API_ERROR_MIN" ] 2>/dev/null && echo 1 || echo 0)
          if [ "$api_blocked2" = "1" ] && [ "${PREV_API_BLOCKED[$name]:-0}" = "0" ]; then
            sl_emit "SESSION-IDLE-CANT-SEND $name 的会话空闲且发不出请求（最近 ${API_ERROR_WINDOW} 条 transcript 记录含 ${api_n2} 条 isApiErrorMessage 结构字段）——不可自愈类，立即升级给人"
          fi
          PREV_API_BLOCKED[$name]=$api_blocked2
        else
          PREV_API_BLOCKED[$name]=0
        fi
      fi
      PREV_HASH[$name]=$h
      PREV_BUSY_SEM[$name]=$busy_sem
    else
      PREV_HASH[$name]=""; PREV_IDLE[$name]="unset"; PREV_API_BLOCKED[$name]=0; PREV_MARKER_STALE[$name]=0
      IDLE_CONSEC[$name]=0; SEEN_BUSY[$name]=0
    fi

    # 事件 4：心跳逾期——会话活着、项目未暂停，但心跳源超过 OVERDUE_MIN 未被更新。
    # 心跳源默认是 tick 日志；内层是 transcript（AC1/AC16，见文件头）。用文件 mtime 而不是解析
    # 表内时刻：本仓的 tick 时刻本身就写成 "12:0xZ" 这类模糊值，解析不可靠。陈旧度 =
    # now - max(心跳 mtime, 解除停机时刻)——停泊期间累积的陈旧在解除停机那一刻清零（协调方样本）。
    hb=$(heartbeat_for "$name" "$root")
    if [ "$alive" = "1" ] && [ "$halted" = "0" ] && [ -e "${hb:-/nonexistent}" ]; then
      hmod=$(heartbeat_mtime "$hb")
      if [ "$hmod" != "0" ]; then
        eff=$hmod; [ "$base_ts" -gt "$eff" ] && eff=$base_ts
        omin=$(( ( $(date +%s) - eff ) / 60 ))
        overdue=$([ "$omin" -ge "$OVERDUE_MIN" ] && echo 1 || echo 0)
        # 同一轮已报 RESUMED ⇒ 会话可证明在动（pane 哈希变了），OVERDUE 是自相矛盾
        # （协调方样本：RESUMED 与 OVERDUE 不得同轮同目标同发）。直接证据优先，压制 OVERDUE。
        if [ "$overdue" = "1" ] && [ "${PREV_OVERDUE[$name]:-0}" = "0" ] && [ "$resumed" = "0" ]; then
          sl_emit "SESSION-OVERDUE $name 的会话活着，但心跳 ${omin} 分钟未更新（阈值 ${OVERDUE_MIN} 分钟，预期周期 ${EXPECTED_CYCLE_MIN} 分钟）——会话可能已死，它会静默地永远空闲"
        fi
        PREV_OVERDUE[$name]=$overdue
      fi
    else
      PREV_OVERDUE[$name]=0
    fi
  done < <(targets)
  # AC7 心跳：每轮追加一条 HEARTBEAT（只进共享 events.jsonl）。订阅方据此判定「看门的不在了」，
  # 不依赖任何人恰好去尝试挂载。持有者一死，心跳线停止增长 → 订阅方看最后一条 ts 即知。
  # --once 不是持有者（不取锁），不写心跳——诊断接缝不冒充长跑持有者。
  [ "$ONE_SHOT" = true ] && break
  sl_heartbeat
  sleep "$INTERVAL"
done
