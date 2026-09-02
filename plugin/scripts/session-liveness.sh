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
#   SESSION-IDLE / SESSION-RESUMED   相邻两轮 pane 的【形状】从空闲转忙/忙转闲；
#                                    忙闲判据 = classifyPaneState（底部区域形状分类，
#                                    ADR-016 Amendment / 裁定 D）——不是整屏哈希
#                                    （姊妹任务 gap-session-liveness-hashes-the-token-counter-
#                                    as-if-it-were-work 把假阳性源从哈希输入里去掉）
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
# 心跳源多源化（gap-outer-heartbeat-source-inverts-under-incident-handling，2026-08-05）：
# SESSION-OVERDUE 的【默认外层心跳】从 tick-log 单源改为【多源 max mtime】——红窗处置期间外层
# 写 queue-state / 分析记录 + 提交，但不写 tick-log；单源会把「越认真处理事故」读成「心跳越旧」
# （实测 71 分钟陈旧而 5 个提交 + 分诊记录已产出，同一信号一真阳一假阳、不可分）。多源集合 =
# max(HEAD commit 时间, queue-state mtime, tick-log mtime, docs/analysis 最新记录 mtime,
# verification-round.jsonl mtime)——任一在阈值内 ⇒ 外层 alive；全部陈旧 ⇒ SESSION-OVERDUE 仍报
# （真阳性保留）。与 D 分类器同源：单一代理信号不足以判定状态（see outer-rulings A-F）。
# 显式覆盖（SESSION_HEARTBEATS / SESSION_TRANSCRIPTS）保持单源语义——调用方已选定特定源。
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
# 用法：  plugin/scripts/session-liveness.sh [--once] [--selfcheck] [--mask] [--api-errors <t>] [--last-input <t>]
#   --once   跑一轮，打印每个目标的 SESSION-STATUS 行，退出（冷启动/安装后自检接缝，AC7）。
#   --selfcheck  诊断接缝：验证外层多源心跳判据（红窗处置保持新鲜 / 零产出报 OVERDUE），自包含，退出 0/1。
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
#       不按计数（实测管理者 4 次/内层 1 次——计数无意义）。
#       【2026-08-06 裁定 D 改判】忙闲判据不再用「mask 后整屏 md5」——那被判成
#       ADR-016 Amendment 禁止的整屏哈希，且正是 token 计数假阳性的来源。改用
#       `classifyPaneState`（plugin/scripts/pane-state-classify.ts，纯函数）：只读
#       底部区域（输入框 + 状态行）的【形状】，枚举五态（waiting-input /
#       permission-prompt / busy / error-banner / unknown）。busy / error-banner ⇒ 忙；
#       waiting-input ⇒ 闲；unknown ⇒ 闲（transcript 融合兜底）。
#       【2026-08-09 改判（gap-permission-prompt-merged-into-busy）】permission-prompt 不再并进
#       busy：它是「需要人/上层介入」的信号（busy=0 intervention=1），与「在干活」相反——卡权限框
#       与在干活在忙闲读数里必须可区分（同 ADR-033 读数无法表达关键区别源）。
#       转圈耗时行（✽）、token 计数行（`/clear to save …`）、`✻ …` 残留天然进不了
#       判据——形状分类读的是「有没有 esc/❯/权限框」这种结构，不是逐字节比较，
#       所以 chrome 的抖动永远不会被判成活动（本任务假阳性源在此吸收）。
#       屏蔽规则仍集中记录在 mask_pane()（AC1 的 chrome 行集合，--mask 接缝可测），
#       但忙闲判据不再依赖它。AC5（防过滤）：pane 捕获为空/区域为空 ⇒ 不判空闲，
#       显式告警（会话若在忙不会被静默漏掉）。
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
#       默认 LOOP_MIN=20 的噪声闸门（刚动过=正常收尾→观察者 stdout 静默；心跳陈旧/未知才报）。
#       2026-08-06 人裁定：阈值只作用于观察者自己的 stdout（自己的流），每个观察者各管各的——
#       manager 观 outer 的观察者可 LOOP_MIN=0 知悉全部，outer 观 inner 的观察者可 LOOP_MIN=20
#       抑噪，互不影响。AC21 的根因（共享文件 + 持有者阈值决定一切）已随共享文件移除。
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
#   - 屏幕（tmux capture-pane）：语义清晰、即时、是「人真正看的那几个标志」。判据 =
#     classifyPaneState 的底部区域【形状分类】（ADR-016 Amendment / 裁定 D）——不是整屏哈希：
#     枚举五态（waiting-input / permission-prompt / busy / error-banner / unknown），
#     busy/error-banner 判忙、waiting-input 判闲、unknown 判闲（transcript 融合兜底）。
#     permission-prompt 单列非忙（busy=0 intervention=1，gap-permission-prompt-merged-into-busy
#     2026-08-09：需要人/上层介入的信号，与「在干活」相反）。chrome（转圈耗时/token 计数/提示语/
#     ✻ 残留）天然进不了判据——形状分类读结构不读字节，chrome 的抖动不会再被判成活动（姊妹任务
#     确认的假阳性源在此吸收）。
#     仍依赖 tmux，且 TUI 布局/文案一改标志就失效——失效形态是【静默】；AC5 兜住
#     「捕获为空/区域为空」不让它静默判闲。
#     边界说明（gap-session-liveness-busy-mask-idle-with-subagents，2026-08-08 真根因 2c1d0c7c）：
#     【pane-only 配置 + 默认心跳（tick-log）不适合观测一个被上层驱动的目标】。pane-only
#     （无 SESSION_HEARTBEATS / SESSION_TRANSCRIPTS）时 heartbeat_for 回落默认外层心跳
#     = <root>/orchestration/tick-log.md（heartbeat_for:841，多源 max mtime）。tick-log 被
#     【每一个 outer/inner tick】追加 ⇒ mtime 恒新鲜 ⇒ hmin≈0-2min < LOOP_MIN ⇒ SESSION-IDLE
#     噪声闸门（:1131-1137）把停摆静默吞掉。实测（outer 2c1d0c7c）：pane-only + LOOP_MIN=1 →
#     IDLE_CONSEC 单调 1→7、IDLE_REPORTED 0→1（闸通过）但 SESSION-IDLE 零条；同配置 LOOP_MIN=0
#     → SESSION-IDLE 正常发出。忙闲分类（classifyPaneState）与 D5 报告门均无缺陷——「bypass 模式
#     常驻 esc to interrupt」假说也已被证伪（32c85b20：60 样本只前 9 busy 后 51 waiting-input）。
#     ⇒ pane-only 观测要么配显式心跳源（SESSION_HEARTBEATS / SESSION_TRANSCRIPTS，让心跳反映
#     目标会话自身活动），要么设 LOOP_MIN=0（管理者对 pane-only 观测的既有做法）。启动审计
#     （_sl_audit_pane_only_gate）对 pane-only + 默认心跳 + LOOP_MIN>0 的目标 WARN 一次。
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
#     候选闲辅助」（AC7）。
#
# 阶段三 D5 锐化（gap-session-liveness-busy-mask-idle-with-subagents，2026-08-08）：
# 带后台任务的停摆结构性失明的根因 = 旧报告门 `-eq N && SEEN_BUSY==1`：
#   * -eq 而非 -ge ⇒ 每段停摆只有【一次】触发机会（IDLE_CONSEC 恰好等于 2 的那一轮）。若那一轮
#     SEEN_BUSY 恰为 0（刚启动、或上一轮 alive=0 分支清掉），这次机会被消耗且永不重来（计数器
#     涨到 3、4…14 都不再匹配 -eq 2）——不是延迟上报，是【永久销毁该段停摆的上报权】。随后转忙
#     ⇒ SEEN_BUSY=1、IDLE_CONSEC=0、RESUMED 照常发 ⇒ 「N 条 RESUMED / 0 条 IDLE」不对称。
#   * SEEN_BUSY==1 门（「未见过忙就永不报」的防启动误报）把【挂载时已在进行的停摆】整类静默掉——
#     挂载即停在提示符的会话（inner 16 窗口 100% 漏报的形态）永远等不到第一个忙轮。
#   修法（人裁定 2026-08-08 13:2x，D5 锐化形式）：
#     1. -eq → -ge：计数器到达阈值后继续匹配（不再只匹配等于 N 的那一轮）。
#     2. per-spell 已报标志（IDLE_REPORTED）做边沿：每段空闲只报一次；忙轮清掉 → 新段可再报。
#        -ge 不再需要「每轮重报」的代价——边沿由 IDLE_REPORTED 承担。
#     3. SEEN_BUSY 的「防启动误报」意图改为「启动首轮不报」（ROUNDS 计数）而非「未见过忙就永不
#        报」——前者只丢一轮，后者丢整段。挂载时已在进行的停摆也必须可报（AC6）。
#     4. 首轮不报：监视器第 1 轮不报 IDLE/RESUMED（预热）；后续轮正常。SEEN_BUSY 保留为「已见过
#        忙段」的状态记录（busy 侧/外部诊断可查），不再进报告门。
#
# 阶段四（gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-take-input，2026-08-07）：
# 上下文饱和度——「活着但收不进新指令」的判据。前三个阶段回答「会话还动不动」；本阶段补上
# 「它还收不收得进东西」这一维。判据是复合形态（饱和且随后指令未被响应），不是一见高比率就告警：
#   * 结构化源（AC3，不重引 chrome 噪声）：transcript 里最近 assistant 消息的 usage.cache_read_input_tokens
#     （缓存前缀大小 = 上下文实际用量）。它与文件头里有意排除的「屏幕 token 计数行」无涉——那条排除
#     （token 计数行 /clear to save，见 mask_pane 注释）是为了不让 TUI chrome 抖动读成活动；本判据读
#     transcript 的 usage 结构字段，不是屏幕文本，不会把当初消灭的 chrome 噪声引回主判据。
#   * 复合判据（AC4/任务约束 2）：saturated = cache_read_input_tokens ≥ SATURATION_TOKENS 且最后一条
#     消息是未获回应的 user 输入（收到新指令但尚未应答 = 收不进）。饱和本身不是故障——auto-compact 是
#     正常机制；只有「饱和且随后指令未被响应」的形态才报 SESSION-DISABLED（区别于普通「忙」）。
#   * 事件：SESSION-DISABLED（会话面，边沿触发，见下节；gap-session-saturated-composite-condition-
#     emitter 选 A：事件名与实际断言一致——「失能」而非仅「饱和」，四条件全满足才发：饱和 &&
#     develop 静默 ≥ SATURATION_SILENCE_MIN && 在飞 worktree 集合无变化 && 在飞 worktree 无活进程
#     （忙时必假直接量，gap-session-disabled-fires-when-busy：最忙时不再误报）。只在配置了 transcript
#     （SESSION_TRANSCRIPTS）的目标上适用——tick 日志是 loop 写的，不是会话证据（同 AC9 的 CANT-SEND 适用面）。
#   * 已知盲区：cache_read_input_tokens 只在 assistant API 响应里出现（工具回执/纯元数据记录没有）；
#     取不到时饱和度判据静默（unknown），不猜。transcript 不携带模型上下文窗口大小，阈值
#     SATURATION_TOKENS 是对 fleet 实测标定的默认（45 万：外层 62.5 万仍在应答=未饱和、内层 31 万=
#     未饱和、48.3 万且未应答=饱和），跨机可用——机制随 quay-init 铺下，阈值可按机型调。
#
# 逐事件类别与阈值理由（AC5）：
#   SESSION-GONE              不可自愈（无界）→ 无阈值，立即报（宁可误报）
#   SESSION-IDLE              可自愈（上界=外层 20min tick）→ 从严：默认 LOOP_MIN=20
#                             噪声闸门，心跳陈旧/未知才报；LOOP_MIN=0（管理者显式配置）
#                             = 知悉全部（其明确选择，见 orchestration/session-liveness.env）。
#                             2026-08-06 人裁定：噪声闸门只作用于观察者自己的 stdout（自己的流）——
#                             谁挂的谁拥有，每个观察者的阈值只服务它自己的消费者。共享事件文件
#                             已移除（AC21 的根因随之消失），无需「记全量供订阅方自判」。
#   SESSION-RESUMED           可自愈但唯一正向信号 → 立即报、保留（便宜，且是唯一能确认
#                             会话还在按期活动的正向信号）
#   SESSION-OVERDUE           不可自愈（无界）→ 宁可误报：默认 OVERDUE_MIN=30（原 45），
#                             阶段一实测 transcript 最大间隙 20.5min，30min 早报 15min 且留余量
#   SESSION-IDLE-CANT-SEND    不可自愈（发不出请求不会自愈）→ 宁可误报：见即报（AC9）
#   SESSION-MARKER-STALE      检测类（标志失效）→ 无阈值、见即报，随事件流观察不一致率
#   SESSION-DISABLED          检测类（饱和 && develop 静默 ≥T && 在飞集合无变化 && 在飞 worktree
#                             无活进程，复合判据）→ 边沿触发；仅配置了 transcript 的目标适用；
#                             T=SATURATION_SILENCE_MIN 可配（非字面量 30）
#   REPO-STALL                仓库信号（非会话面，AC8 裁定承载）→ STALL_MIN=45 保持
# 环境：  INTERVAL / STALL_MIN / LOOP_MIN / OVERDUE_MIN / SATURATION_TOKENS / SATURATION_SILENCE_MIN（阈值）
#         SESSION_TARGETS / SESSION_HEARTBEATS / SESSION_TRANSCRIPTS（多目标覆盖；每行 "<名字> <值>"）
#         SESSION_ROOT（测试接缝：覆盖自定位的项目根）

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
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
# 阶段四新增阈值（2026-08-07）：上下文饱和度。SATURATION_TOKENS = 上下文用量代理（最近 assistant 消息
# 的 usage.cache_read_input_tokens）≥ 此值即视为「上下文接近/已满」——结构化源，非屏幕百分比（AC3）。
# 默认 45 万是对 fleet 实测的标定：外层 62.5 万仍在应答=未饱和、内层 31 万=未饱和、48.3 万且未应答输入=
# 饱和（正控制）。SATURATION_TOKENS 可在环境变量/配置文件里按机型调（跨机可用，AC5）。
SATURATION_TOKENS=${SATURATION_TOKENS:-450000}
# 阶段四复合条件（gap-session-saturated-composite-condition-emitter，2026-08-13）：SESSION-DISABLED
# 的「该层 develop 提交静默」子条件阈值 T。T 可配（env/配置文件，同 SATURATION_TOKENS 形态），
# 非字面量 30（manager 2026-08-13 裁定：「T 用现有配置或读宿主，不写字面量 30」）。语义：目标
# workspace 的 develop 分支最后一次提交距今 ≥ 此分钟数 = 该层静默。默认 10（> 实测非静默的 1 分钟，
# < OVERDUE_MIN=30 的「可能已死」），跨机可用按机型调。
# 复合判据全量（gap-idle-watch-session-disabled-false-positive-long-tasks 起为五元）：饱和 && develop
# 静默 ≥T && 在飞 worktree 集合无变化 && 在飞 worktree 无活进程（忙时必假直接量，见 _sl_worktree_idle）
# && 会话自身心跳 ≥T 未动（推进量合取项，长任务时必假——见 _sl_heartbeat_stale）。
SATURATION_SILENCE_MIN=${SATURATION_SILENCE_MIN:-10}
# 候选 B（gap-permission-prompt-vs-dismissable-prompt-classifier AC4，2026-08-08）：
# permission-prompt 持续 ≥PERM_PROMPT_WARN_ROUNDS 轮且 transcript 最近 PERM_PROMPT_TX_WINDOW 秒未写入
# ⇒ 报一次 WARN（不无限静默）。兜底判据：分类器候选 A 只排除已知可忽略提示（问卷带 (optional)/Dismiss）；
# 若出现新的可忽略提示变体漏网，假的 permission-prompt 会永久钉住 busy=1 ⇒ SESSION-IDLE 永不触发
# （D5 同族沉默）。WARN 只去观察者自己的 stderr，绝不改动忙闲判据（真权限框保持忙）。
PERM_PROMPT_WARN_ROUNDS=${PERM_PROMPT_WARN_ROUNDS:-3}   # 连续几轮 permission-prompt 才 WARN
PERM_PROMPT_TX_WINDOW=${PERM_PROMPT_TX_WINDOW:-60}       # transcript 最近写入窗口（秒）；窗口内有写=会话确实在动
# 文案常数（LOOP_MIN 含义拆分，2026-08-03）：OVERDUE 消息里的「预期周期」是固定描述，不是运行时
# 阈值——LOOP_MIN 可以被设成 0（管理者配置），而「预期周期 0 分钟」是文案 bug。两个含义拆开。
EXPECTED_CYCLE_MIN=20
declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE PREV_STATE PREV_IDLE PREV_HALTED UNHALT_TS \
  PREV_BUSY_SEM PREV_API_BLOCKED PREV_MARKER_STALE PREV_PANE_EMPTY IDLE_CONSEC SEEN_BUSY \
  PREV_SATURATED IDLE_REPORTED ROUNDS PERM_CONSEC PREV_PERM_WARNED \
  BUSY_CONSEC RESUME_PENDING RESUME_CAUSE RESUME_LASTIN PREV_INTERVENTION \
  PREV_WT_SET PREV_WT_KNOWN

# ── classifyPaneState 消费者（ADR-016 Amendment 2026-08-04 / 裁定 D）───────────────────────────
# 忙闲判据读 pane 的【底部区域形状】（纯函数 pane-state-classify.ts），不是整屏哈希。SL_CLASSIFY /
# SL_NODE 是测试接缝（分别覆盖分类器路径与 node 命令）；生产用 BASH_SOURCE 自定位到同目录的
# pane-state-classify.ts，不硬编码绝对路径。放在文件前部（L0/函数/接缝之前），因为 --pane-state
# 接缝与 _sl_pane_verdict 都要用到。
_sl_pane_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || echo .)"
SL_CLASSIFY="${SL_CLASSIFY:-$_sl_pane_dir/pane-state-classify.ts}"
SL_NODE="${SL_NODE:-node}"

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

# mask_pane —— chrome 行集合的【记录 + --mask 诊断接缝】（AC1：每条附「为什么它不是活动信号」）。
# 【2026-08-06 裁定 D 改判】忙闲判据不再消费 mask_pane 的输出（它不再流向 md5sum——ADR-016
# Amendment 禁止 capture-pane→md5 一族）。判据改由 classifyPaneState 的底部区域形状分类承担：
# chrome 天然进不了判据（形状分类读结构不读字节）。本函数保留为 AC1 的 chrome 行集合文档与
# --mask 可测接缝（`bash session-liveness.sh --mask < pane.txt` 打印剥离后的内容区）：
#   * `/clear to save …`（token 计数行）：停泊会话唯一会变的东西——本任务确认的假阳性源
#     （archguard 停泊 pane 只有 150.2k→151.2k 变，被判成一堆事件）。这是提示语行的 chrome。
#   * 含 ✽ 的行（转圈耗时行）：活跃 spinner，每秒跳——「人不看的部分」。
#   * 含 ✻ 的行（`✻ Baked for …` 残留）：上一次动作留在屏上的字，五个会话全部存在（含空闲的），
#     不能当忙的判据（外层实测：两个停泊 pane 各 2/1，而它们 esc=0）。
# 注意：不按关键词 `tokens` 一刀切——subagent 任务行 `◯ general-purpose … ↓ 57.3k tokens`
# 是真内容，随真实工作而变，必须保留（滤掉它=把假阳性换成假阴性，后者静默、更糟）。
# 防过滤（AC5）由主循环承担：pane 捕获为空 / 分类器区域为空 ⇒ 不判空闲、显式 WARN，
# 不依赖 mask_pane 输出是否为空。
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

# _sl_pane_verdict —— 完整 pane 判定的【共享实现】（主循环与 --pane-state 接缝共用）。入参：$1 =
# pane 原始文本。结果写到五个全局：_sl_pane_state / _sl_pane_busy / _sl_pane_intervention /
# _sl_pane_work_in_flight / _sl_pane_region。
# 判据在 pane-state-classify.ts 的 classifyPaneVerdict（gap-session-liveness-decision-import-refactor
# 决策层 import 化——同一份判定 import 直调可测、零真实时间/负载免疫）：
#   input_state ∈ busy|error-banner ⇒ busy=1（真在干活 / 报错，忙闲轴上的忙）；
#   permission-prompt ⇒ busy=0 + intervention=1（需要人/上层介入——不再并进 busy，
#     gap-permission-prompt-merged-into-busy 的修复：卡权限框与在干活必须可区分）；
#   waiting-input/unknown ⇒ busy=0 + intervention=0；
#   work_in_flight 独立存到 _sl_pane_work_in_flight（MARKER-STALE 抑制用：transcript 动 + input
#     空闲 + agents>0 是自洽组合，非异常——本任务根因）；
#   空捕获（$1 为空）或分类器区域为空 ⇒ busy=1（AC5：无内容可判不得静默判空闲）。
# --pane-verdict 输出 "state=..\nbusy=..\nintervention=..\nwork_in_flight=..\nregion_empty=.."（纯
# 文本）。用 bash 字符串切分（${var%%$'\n'*} / ${var#*$'\n'}）而不是再开几个 $(...) 子 shell——每轮
# 只多一个 node 子进程，压住 mount-count 测试的瞬态进程竞争（M3 注释记录过同类竞争）。
_sl_pane_verdict() {
  local raw=$1 cls
  _sl_pane_state="unknown"; _sl_pane_busy=0; _sl_pane_intervention=0; _sl_pane_work_in_flight=0; _sl_pane_region=""
  if [ -z "$raw" ]; then
    _sl_pane_busy=1
    return 0
  fi
  cls=$(printf '%s\n' "$raw" | "$SL_NODE" --no-warnings --experimental-strip-types "$SL_CLASSIFY" --pane-verdict 2>/dev/null || printf 'state=unknown\nbusy=1\nintervention=0\nwork_in_flight=0\nregion_empty=1\n')
  _sl_pane_state=${cls%%$'\n'*}; _sl_pane_state=${_sl_pane_state#state=}; cls=${cls#*$'\n'}
  _sl_pane_busy=${cls%%$'\n'*}; _sl_pane_busy=${_sl_pane_busy#busy=}; cls=${cls#*$'\n'}
  _sl_pane_intervention=${cls%%$'\n'*}; _sl_pane_intervention=${_sl_pane_intervention#intervention=}; cls=${cls#*$'\n'}
  _sl_pane_work_in_flight=${cls%%$'\n'*}; _sl_pane_work_in_flight=${_sl_pane_work_in_flight#work_in_flight=}; cls=${cls#*$'\n'}
  # line 5 = region_empty（0|1）：区域为空 ⇒ _sl_pane_region 置空（AC5 空区域 WARN 用），否则置非空占位。
  _sl_pane_region=${cls%%$'\n'*}; _sl_pane_region=${_sl_pane_region#region_empty=}
  if [ "$_sl_pane_region" = "0" ]; then _sl_pane_region="nonempty"; else _sl_pane_region=""; fi
  [ -z "$_sl_pane_state" ] && _sl_pane_state="unknown"
  [ "$_sl_pane_work_in_flight" != "1" ] && _sl_pane_work_in_flight=0
  # classifyPaneVerdict 已把 region_empty ⇒ busy=1；这里再守一道（与分类器同判据，兜底 parse 失败）。
  [ "$_sl_pane_region" = "" ] && _sl_pane_busy=1
}

# _sl_perm_prompt_warn_verdict —— 候选 B 的【纯判据】（gap-permission-prompt-vs-dismissable-prompt-
# classifier AC4）：permission-prompt 持续 N 轮且 transcript 未写入 ⇒ 报 WARN（不无限静默）。
# 入参：$1 = 连续 permission-prompt 轮数（≥1）；$2 = transcript 最近写入距今秒数；-1 = 无 transcript。
# 输出：warn（N ≥ PERM_PROMPT_WARN_ROUNDS 且 transcript 陈旧/不可用）| ok（否则）。
#   交叉正控制：transcript 最近写入 ≤ PERM_PROMPT_TX_WINDOW ⇒ 会话确定在动，不 WARN（真忙）。
#   无 transcript 配置 ⇒ 交叉控制无从确认，不 WARN（pane-only 观察者已有 D5 pane-only 审计 WARN）。
# 判定逻辑在 pane-state-classify.ts 的 permPromptWarnVerdict（决策层 import 直调覆盖）。
_sl_perm_prompt_warn_verdict() {
  local rounds=$1 tx_age=$2
  "$SL_NODE" --no-warnings --experimental-strip-types "$SL_CLASSIFY" --perm-warn-verdict "$rounds" "$tx_age" \
    --warn-rounds "${PERM_PROMPT_WARN_ROUNDS:-3}" --tx-window "${PERM_PROMPT_TX_WINDOW:-60}" 2>/dev/null \
    || echo "ok"
}

# transcript_api_error_count —— 「当前被 429 卡住」的计数（AC9 结构性字段 + AC7/D4 时效）。
# 结构字段 = 顶层 JSON 键 `"isApiErrorMessage":true`（只有 API 被拒记录才有，实测 archguard
# 被 429 拒绝会话最近 200 条为 6、健康/陈旧会话为 0）。不用 429 文案（绑死供应商文案，换端点
# 即失效）；不用「transcript 是否增长」（429 也会被写进 transcript，增长分不开两种空闲）。
#
# AC7/D4 时效（gap-session-liveness-busy-mask-idle-with-subagents）：**只数【尾随】的错误记录**
# ——从尾向前扫最近 API_ERROR_WINDOW 条，数连续的 isApiErrorMessage 记录，遇到第一条非错误
# 消息（最近一次成功应答）即停。一次瞬时 429 被后续正常应答覆盖后就不再计数：D4 复现（manager
# 三次实测）13:04:47 错误 → 13:08:47 正常应答，但记录仍在 200 条窗口内（12:43→13:09=26min），
# 旧判据「最近 200 条含 ≥1」让 13:06/13:09/13:11 连报三条 CANT-SEND——一次瞬时网络错误把此后
# 26 分钟的每次空闲都升级成叫人告警。尾随计数让「已恢复」的空闲回到普通 SESSION-IDLE。
# grep 模式 `"isApiErrorMessage":…true` 只命中顶层键：content 里文字提及该字段的形式是
# `isApiErrorMessage: true` 或转义键 `\"isApiErrorMessage\":…`，前导不是裸 `"`，不会误命中。
# 元数据行（非 assistant/user 消息）跳过、不作为「成功应答」边界（与 transcript_last_message_type
# 同源；真实 transcript 尾部常有 mode/summary 等元数据）。
# ── 决策层 import 化（gap-session-liveness-decision-import-refactor，2026-08-13）──────────────────
# 以下 transcript 判定（last_message_type / api_error_count / cache_read_tokens /
# context_saturation / last_user_input_epoch）的【判定逻辑】已迁入 pane-state-classify.ts（纯函数，
# import 直调可测，零真实时间/负载免疫——AC1）。本 shell 保留判定【调用】分类器：每个判定函数委托
# `node pane-state-classify.ts --transcript <file>` 读同一份 JSONL、一次算出全部判定（一个 node
# 子进程同时出五个值），再把各值送回。行为与原 bash grep/tail 实现逐字段一致（tail 窗口语义相同：
# 文件尾 newline 不产生额外空行；last_message 的 tail-500+兜底全扫 ≡ 从尾全扫）。
# 主循环每轮一次 `_sl_transcript_batch` 填全局，各判定函数与接缝复用这些全局——一个 transcript 目标
# 每轮只多一个 node 子进程（而非每判定一次 grep/tail 派生，M3 瞬态进程竞争教训）。
_sl_tx_last_mt=""; _sl_tx_api_n=""; _sl_tx_cache=""; _sl_tx_sat=""; _sl_tx_lep=""
_sl_transcript_batch() {
  local file=$1 out
  _sl_tx_last_mt="unknown"; _sl_tx_api_n="0"; _sl_tx_cache="unknown"; _sl_tx_sat="unknown"; _sl_tx_lep="unknown"
  [ -n "$file" ] || return 0
  out=$("$SL_NODE" --no-warnings --experimental-strip-types "$SL_CLASSIFY" --transcript "$file" \
    --saturation-tokens "${SATURATION_TOKENS:-450000}" --api-error-window "${API_ERROR_WINDOW:-200}" 2>/dev/null) \
    || return 0
  _sl_tx_last_mt=${out%%$'\n'*}; out=${out#*$'\n'}
  _sl_tx_api_n=${out%%$'\n'*}; out=${out#*$'\n'}
  _sl_tx_cache=${out%%$'\n'*}; out=${out#*$'\n'}
  _sl_tx_sat=${out%%$'\n'*}; out=${out#*$'\n'}
  _sl_tx_lep=${out%%$'\n'*}
}

# transcript_api_error_count —— 「当前被 429 卡住」的计数（AC9 结构性字段 + AC7/D4 时效）。
# 结构字段 = 顶层 JSON 键 `"isApiErrorMessage":true`（只有 API 被拒记录才有，实测 archguard
# 被 429 拒绝会话最近 200 条为 6、健康/陈旧会话为 0）。不用 429 文案（绑死供应商文案，换端点
# 即失效）；不用「transcript 是否增长」（429 也会被写进 transcript，增长分不开两种空闲）。
# AC7/D4 时效：只数【尾随】的错误记录——从尾向前扫最近 API_ERROR_WINDOW 条，数连续的
# isApiErrorMessage 记录，遇到第一条非错误消息（最近一次成功应答）即停。一次瞬时 429 被后续
# 正常应答覆盖后就不再计数（D4 复现：13:04 错误→13:08 正常应答，旧判据让 13:06/13:09/13:11
# 连报三条 CANT-SEND——一次瞬时网络错误把此后 26 分钟的每次空闲都升级成叫人告警）。判定逻辑在
# pane-state-classify.ts 的 trailingApiErrorCount（决策层 import 直调覆盖）。
transcript_api_error_count() {
  _sl_transcript_batch "$1"
  printf '%s\n' "$_sl_tx_api_n"
}

# transcript_last_message_type —— transcript 最后一条【消息】的类型（阶段三 AC1）。决定「候选闲」
# 还是「确定忙」；输出：pending-tool-use / pure-text / user-input / unknown。判定逻辑在
# pane-state-classify.ts 的 transcriptLastMessageType（import 直调覆盖）。
transcript_last_message_type() {
  _sl_transcript_batch "$1"
  printf '%s\n' "$_sl_tx_last_mt"
}

# last_user_input_epoch —— transcript 里最近一条 type=user 记录的时间戳转 epoch（AC7）。
# 会话收到输入（打字 / send-keys / loop 注入的提示）都会写 type=user 记录；「最后一次收到输入
# 的时刻」= 最近一条这种记录的 timestamp。返回空 = 取不到（无匹配/解析失败）。判定逻辑在
# pane-state-classify.ts 的 lastUserInputEpoch。
last_user_input_epoch() {
  _sl_transcript_batch "$1"
  [ "$_sl_tx_lep" != "unknown" ] && [ -n "$_sl_tx_lep" ] || return 1
  printf '%s\n' "$_sl_tx_lep"
  return 0
}

# ── 阶段四：上下文饱和度（gap-session-liveness-cannot-see-context-saturation-...，2026-08-07）──
# 判定全部读 transcript 的结构字段，不碰屏幕百分比文本（AC3）；判定逻辑在 pane-state-classify.ts。

# transcript_cache_read_tokens —— 最近 assistant API 响应的 usage.cache_read_input_tokens（缓存前缀
# 大小 = 上下文实际用量）。结构化源：该字段只在 assistant 响应的 usage 对象里出现，工具回执/元数据
# 记录没有。返回 "unknown" = 取不到（无 transcript / 无 usage 记录）。判定逻辑在
# pane-state-classify.ts 的 transcriptCacheReadTokens。
transcript_cache_read_tokens() {
  _sl_transcript_batch "$1"
  printf '%s\n' "$_sl_tx_cache"
}

# last_message_is_unanswered_input —— 最后一条【消息】是否未获回应的 user 输入（收到新指令但模型尚未
# 应答）。复用 transcript_last_message_type 的消息定位（跳过 system/mode 等元数据）：最后一条是 user =
# yes（收进了但没答出来）；最后一条是 assistant = no（还在应答/已应答）。
last_message_is_unanswered_input() {
  _sl_transcript_batch "$1"
  [ "$_sl_tx_last_mt" = "user-input" ] && echo "yes" || echo "no"
}

# transcript_context_saturation —— 上下文饱和度的复合判据（AC4/任务约束 2：饱和≠故障，见即报的是
# 「饱和且随后指令未被响应」）：saturated / unsaturated / unknown。判定逻辑在
# pane-state-classify.ts 的 transcriptContextSaturation。
transcript_context_saturation() {
  _sl_transcript_batch "$1"
  printf '%s\n' "$_sl_tx_sat"
}

# transcript_saturation_report —— --saturation 接缝（AC1：一条命令报出目标会话的上下文饱和度）。
# 打印判据 + 原始代理值，供观察者/测试直接读。格式化留在本 shell（表述层），判据来自分类器。
transcript_saturation_report() {
  local t=$1
  [ -e "$t" ] && [ -r "$t" ] || { echo "unknown (no readable transcript)"; return 1; }
  _sl_transcript_batch "$t"
  case "$_sl_tx_sat" in
    saturated)   echo "saturated cache_read_input_tokens=${_sl_tx_cache} (context ≥ ${SATURATION_TOKENS} + last message unanswered user input)" ;;
    unsaturated) echo "unsaturated cache_read_input_tokens=${_sl_tx_cache}" ;;
    *)           echo "unknown (no assistant usage record)" ;;
  esac
}

# ── 阶段四复合条件子判据（gap-session-saturated-composite-condition-emitter，2026-08-13）────────────
# SESSION-DISABLED 发射端把 manager 的三条件逐条判搬进判断本身（选 A）：饱和 && develop 静默 ≥ T
# && 在飞 worktree 集合无变化。两个子判据 + 一个复合判定（纯函数）。

# _sl_develop_silent —— 该层 develop 分支提交静默 ≥ SATURATION_SILENCE_MIN 分钟？按目标的 workspace
# 解析（git -C "$root" log -1 --format=%ct develop）。输出 1=静默（子条件 pass）/ 0=活跃（block）。
# 无 git 仓库 / 无 develop 分支 / git 失败 ⇒ 无法证明「该层在动」⇒ 视为静默（pass，不挡发射）。
_sl_develop_silent() {
  local root=$1 dev_ts now age_min
  dev_ts=$(git -C "$root" log -1 --format=%ct develop 2>/dev/null)
  [ -n "$dev_ts" ] || { echo 1; return 0; }
  now=$(date +%s)
  age_min=$(( (now - dev_ts) / 60 ))
  [ "$age_min" -ge "$SATURATION_SILENCE_MIN" ] && echo 1 || echo 0
}

# _sl_worktree_set —— 目标 workspace 的【在飞 worktree 名字集合】：git worktree list --porcelain 的
# worktree 路径 basename，排序去重；非 git 仓库 ⇒ 空。集合差 = 有变化（复用 manager 判据6 的集合差
# 手法，不用时间戳——「没变化」必须跨两轮同集合才成立）。
_sl_worktree_set() {
  local root=$1 p
  git -C "$root" worktree list --porcelain 2>/dev/null | awk -F' ' '/^worktree /{print $2}' \
    | while read -r p; do basename "$p"; done | sort
}

# _sl_worktree_idle —— 直接量：在飞【链接】worktree 内是否有活进程（忙时必假合取项，AC1/判据1，
# gap-session-disabled-fires-when-busy）。忙 = 任一进程的 cwd 落在某链接 worktree 路径下（外部可核：
# /proc/<pid>/cwd 解析，非自产：进程是 OS 对象，不是 session-liveness 自写的心跳——硬规则 4b 推荐的
# 直接量）。忙 ⇒ 该合取项取假（不报 DISABLED）；无活进程 ⇒ 取真（失能放行）。返回 1=无活进程
# （idle/pass）/ 0=有活进程（busy/block）。
# 只扫【链接】worktree（排除主 checkout）：主 checkout 是目标会话自己的工作目录，恒有进程落在其中，
# 扫它会让该合取项永不取假（与硬规则 4 同形态的恒真合取项贡献零）。非 git 仓库 / 无链接 worktree ⇒
# 无活进程（idle=1，不挡发射——与 _sl_worktree_set 的「非 git ⇒ 空」同源）。
_sl_worktree_idle() {
  local root=$1 main pid wt cwd wts
  main=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)
  wts=$(git -C "$root" worktree list --porcelain 2>/dev/null | awk -F' ' '/^worktree /{print $2}' \
    | while read -r wt; do [ "$wt" = "$main" ] && continue; readlink -f "$wt" 2>/dev/null; done)
  [ -n "$wts" ] || { echo 1; return 0; }
  for pid in /proc/[0-9]*; do
    [ "${pid##*/}" = "$$" ] && continue   # 跳过监视器自身
    cwd=$(readlink "$pid/cwd" 2>/dev/null) || continue
    while IFS= read -r wt; do
      case "$cwd" in
        "$wt"|"$wt"/*) echo 0; return 0 ;;   # 有活进程 ⇒ busy ⇒ 合取项取假
      esac
    done <<< "$wts"
  done
  echo 1
}

# _sl_heartbeat_stale —— 推进量合取项（AC1/判据1，gap-idle-watch-session-disabled-false-positive-long-tasks）。
# 「失能」与「长任务」的真正区别 = 有没有推进；推进量的最可靠直接量 = 会话自己的心跳最后写入时刻
# （候选 C：inner 心跳持续自驱）。心跳 = 该目标生效的 transcript + subagents 目录最大 mtime
# （heartbeat_mtime 已并上——长 suite 由 subagent 驱动时写的是 <会话>/subagents/，仍在推进）。
# 心跳在 T = SATURATION_SILENCE_MIN 分钟内被写过（age < T）⇒ 会话在推进 ⇒ 返回 0（block，合取项取假）；
# 心跳 ≥ T 未动 ⇒ 返回 1（stale/pass，失能放行）。无心跳/不可读 ⇒ 无法证明推进 ⇒ 视为陈旧（pass，
# 不挡发射——与 _sl_develop_silent 的「无法证明在动 ⇒ 静默」同源，不引入新的恒真项）。
_sl_heartbeat_stale() {
  local hb=$1 m now
  m=$(heartbeat_mtime "$hb")
  if [ "$m" = "0" ] || [ -z "$m" ]; then echo 1; return 0; fi
  now=$(date +%s)
  if [ "$(( now - m ))" -ge "$(( SATURATION_SILENCE_MIN * 60 ))" ]; then echo 1; else echo 0; fi
}

# _sl_sat_disabled_verdict —— 复合判定（纯函数）：五条件全满足 ⇒ emit，否则 hold。
# $1 = sat（$_sl_tx_sat，分类器 transcriptContextSaturation 输出）；
# $2 = dev_silent（_sl_develop_silent：0|1）；$3 = wt_unchanged（0|1，在飞集合连续两轮无变化）；
# $4 = wt_idle（0|1，_sl_worktree_idle：在飞链接 worktree 无活进程=1 / 忙=0，忙时必假直接量）；
# $5 = hb_stale（_sl_heartbeat_stale：会话自身心跳 ≥T 未动=1 / 新鲜=0——推进量合取项，长任务时必假）。
_sl_sat_disabled_verdict() {
  if [ "$1" = "saturated" ] && [ "$2" = "1" ] && [ "$3" = "1" ] && [ "$4" = "1" ] && [ "$5" = "1" ]; then
    echo emit
  else
    echo hold
  fi
}

# ── 外层多源心跳（gap-outer-heartbeat-source-inverts-under-incident-handling，2026-08-05）────────────
# outer_heartbeat_mtime —— 默认外层心跳 = 多源 max mtime。红窗处置期间外层写 queue-state / 分析记录
# + 提交但不写 tick-log；单源 tick-log 会把「越认真处理事故」读成「心跳越旧」（实测 71min 陈旧而 5 个
# 提交已产出，真阳/假阳不可分）。多源集合 = max(HEAD commit 时间, queue-state mtime, tick-log mtime,
# docs/analysis 最新记录 mtime, verification-round.jsonl mtime)。任一在阈值内 ⇒ alive；全部陈旧 ⇒
# SESSION-OVERDUE 仍报（真阳性保留）。与 D 分类器同源：单一代理信号不足以判定状态。
# 返回 epoch；0 = 所有源都不存在/不可读。
outer_heartbeat_mtime() {
  local root=$1 max=0 ts f src
  # 1. HEAD commit 时间（提交 = 产出；git log 失败 = 非 git 仓库 = 0）
  ts=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)
  [ -n "$ts" ] && [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
  # 2. queue-state / 3. tick-log / 5. verification-round（文件 mtime）
  for src in \
    "$root/docs/analysis/batch2-queue-state.md" \
    "$root/orchestration/tick-log.md" \
    "$root/.quay/verification-round.jsonl"
  do
    if [ -e "$src" ]; then
      ts=$(stat -c %Y "$src" 2>/dev/null || echo 0)
      [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
    fi
  done
  # 4. 分诊/分析记录：docs/analysis/ 下最新的 .md（红窗分诊记录落在这里，见 ROUND 2 RED triage record）
  for f in "$root"/docs/analysis/*.md; do
    [ -e "$f" ] || continue
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
  done
  echo "$max"
}


# ── 事件发出（2026-08-06 人裁定：观测是树，每观察者自己的流）──────────────────────────────
# 观测拓扑是树（manager→N 个 outer、outer_i→inner_i），每条边是独立的 (观察者,目标) 对：只读、
# 无交集。事件只走观察者自己的 stdout（谁挂的谁拥有）——挂载方（Monitor 工具）的事件流就是这条边
# 的事件流。不再有共享事件文件（那是把 N 条独立流合并成一条、再让每个消费者过滤回自己要的——
# 严格劣于 N 条独立流，零收益）；不再有互斥锁（观测对目标纯只读，只读天然不排他，重复挂载无害）。
# AC21（gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second）的根因
# （共享文件 + 持有者阈值决定一切）随之消失：每个观察者的阈值（LOOP_MIN/STALL_MIN/OVERDUE_MIN）
# 只作用于它自己的 stdout、只服务它自己的消费者——manager 观 outer 的观察者可以 LOOP_MIN=0 知悉
# 全部，outer 观 inner 的观察者可以 LOOP_MIN=20 抑噪，互不影响、互不知情。
sl_emit() {
  echo "$*"
}

# ── 外层多源心跳（gap-outer-heartbeat-source-inverts-under-incident-handling，2026-08-06）──────
# SESSION-OVERDUE 的原判据 = 单个心跳路径的 mtime（默认 orchestration/tick-log.md）。红窗处置时
# 外层写 docs/analysis/batch2-queue-state.md + 提交、不写 tick-log ⇒ 越认真处置心跳越旧（实测：
# 2026-08-05 心跳 71 分钟未更新，期间 5 次提交 + 分诊记录全在做，假阳性）。修法：外层心跳 =
# 多源 max mtime：
#   max(HEAD 提交时间, queue-state mtime, tick-log mtime, docs/analysis/*.md max mtime,
#       .quay/verification-round.jsonl mtime)
# 任一源在阈值内 ⇒ alive（红窗处置写 queue-state+提交 ⇒ 心跳仍新鲜，反向失效消除）。
# 真阳性保留：所有源都 ≥OVERDUE_MIN 未动 ⇒ 仍报 SESSION-OVERDUE（「红着没人碰」必须被抓）。
# 与 D 分类器同源（tasks/gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable）：
# 单一代理信号不足，多源融合。只在【默认外层心跳】（无 SESSION_HEARTBEATS / SESSION_TRANSCRIPTS
# 覆盖）时启用——显式配置的心跳仍是用户指认的单源，不悄悄改成多源。
_outer_heartbeat_max_mtime() {
  local root=$1 max=0 ts=0 f
  # 1. HEAD 提交时间（git，红窗处置的最强产出信号）
  ts=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)
  [ "${ts:-0}" -gt "$max" ] 2>/dev/null && max=$ts
  # 2. queue-state（红窗分诊的主产出）
  for f in "$root/docs/analysis/batch2-queue-state.md" "$root/docs/analysis/batch-queue-state.md"; do
    [ -e "$f" ] || continue
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
  done
  # 3. tick-log（原单源）
  f="$root/orchestration/tick-log.md"
  if [ -e "$f" ]; then
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
  fi
  # 4. 分诊/分析记录（docs/analysis/*.md：红窗分诊记录、热修说明；任一最近 mtime 即算产出）
  if [ -d "$root/docs/analysis" ]; then
    while IFS= read -r f; do
      [ -e "$f" ] || continue
      ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
      [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
    done < <(find "$root/docs/analysis" -maxdepth 1 -name '*.md' 2>/dev/null)
  fi
  # 5. verification-round.jsonl（外层异步收尾轮次记录；gitignored 运行时态，存在才用）
  f="$root/.quay/verification-round.jsonl"
  if [ -e "$f" ]; then
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$ts" -gt "$max" ] 2>/dev/null && max=$ts
  fi
  echo "$max"
}

# heartbeat_is_outer_default —— 该心跳路径是否就是【默认外层心跳】（未被 SESSION_HEARTBEATS /
# SESSION_TRANSCRIPTS 覆盖）。覆盖了 ⇒ 单源 heartbeat_mtime；默认 ⇒ 多源 _outer_heartbeat_max_mtime。
heartbeat_is_outer_default() {
  local name=$1 root=$2 hb=$3 n v
  [ "$hb" = "$root/orchestration/tick-log.md" ] || return 1
  if [ -n "${SESSION_HEARTBEATS:-}" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      [ "$n" = "$name" ] && return 1
    done <<< "$SESSION_HEARTBEATS"
  fi
  if [ -n "${SESSION_TRANSCRIPTS:-}" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      [ "$n" = "$name" ] && return 1
    done <<< "$SESSION_TRANSCRIPTS"
  fi
  return 0
}

# effective_heartbeat_mtime —— 判 SESSION-OVERDUE / SESSION-IDLE 噪声闸门用的心跳陈旧度。
# 默认外层心跳 = 多源 max mtime；显式配置的心跳 = 单源 heartbeat_mtime。
effective_heartbeat_mtime() {
  local name=$1 root=$2 hb=$3
  if heartbeat_is_outer_default "$name" "$root" "$hb"; then
    _outer_heartbeat_max_mtime "$root"
  else
    heartbeat_mtime "$hb"
  fi
}

# --selfcheck（本任务 ## Contract 的 invoke）—— 诊断接缝，验证外层多源心跳判据 + 上下文饱和度判据，
# 自包含（临时目录，不碰真实仓库/会话）：
#   1. 红窗处置（最近提交 + 新 queue-state + 旧 tick-log）⇒ 心跳新鲜（不报 OVERDUE，AC2）；
#   2. 30 分钟零产出（旧提交 + 旧 tick-log + 无 queue-state）⇒ 心跳陈旧（真阳性保留，AC3）；
#   3. 上下文饱和度复合判据（阶段四）：高 cache_read + 未应答输入 ⇒ saturated；同上下文但已应答 ⇒
#      unsaturated（负控制：auto-compact 是正常机制）；低上下文 + 未应答 ⇒ unsaturated（负控制）。
# --json 变体（$1=1）：只打一行 JSON（含 saturation 字段），供 Contract measure
# `--selfcheck --json 2>&1 | grep -c 'saturated'` 读取。
selfcheck() {
  local tmp ws now fresh stale fmin smin rc=1 json=${1:-0} sat_dir sat_green sat_answering sat_healthy sat_ok=1 _now_iso
  tmp=$(mktemp -d 2>/dev/null) || { echo "session-liveness selfcheck: FAIL 无法创建临时目录" >&2; return 1; }
  # 控制 1（反向失效消除）：红窗处置 = 最近提交 + 新 queue-state + 旧 tick-log ⇒ 心跳新鲜
  ws="$tmp/fresh"
  mkdir -p "$ws/orchestration" "$ws/docs/analysis" "$ws/.quay"
  git -C "$ws" init -q -b master >/dev/null 2>&1
  git -C "$ws" config user.email t@t >/dev/null 2>&1
  git -C "$ws" config user.name t >/dev/null 2>&1
  echo x > "$ws/a.txt"
  git -C "$ws" add -A >/dev/null 2>&1
  git -C "$ws" commit -qm "red-window triage commit" >/dev/null 2>&1
  echo "# queue-state" > "$ws/docs/analysis/batch2-queue-state.md"
  echo "# tick" > "$ws/orchestration/tick-log.md"
  touch -d "3 hours ago" "$ws/orchestration/tick-log.md"   # tick-log 不动
  fresh=$(_outer_heartbeat_max_mtime "$ws")
  # 控制 2（真阳性保留）：30 分钟零产出 ⇒ 全源旧 ⇒ 心跳陈旧
  ws="$tmp/stale"
  mkdir -p "$ws/orchestration" "$ws/docs/analysis" "$ws/.quay"
  git -C "$ws" init -q -b master >/dev/null 2>&1
  git -C "$ws" config user.email t@t >/dev/null 2>&1
  git -C "$ws" config user.name t >/dev/null 2>&1
  echo x > "$ws/a.txt"
  git -C "$ws" add -A >/dev/null 2>&1
  GIT_AUTHOR_DATE="2000-01-01T00:00:00Z" GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" \
    git -C "$ws" commit -qm "old" >/dev/null 2>&1
  echo "# tick" > "$ws/orchestration/tick-log.md"
  touch -d "3 hours ago" "$ws/orchestration/tick-log.md"
  stale=$(_outer_heartbeat_max_mtime "$ws")
  now=$(date +%s)
  fmin=$(( (now - fresh) / 60 ))
  smin=$(( (now - stale) / 60 ))
  # 控制 3（阶段四，AC2/AC4）：饱和复合判据三 fixture（饱和正控制 / 同上下文已应答负控制 / 健康负控制）
  sat_dir="$tmp/sat"
  mkdir -p "$sat_dir"
  _now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s\n%s\n' \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]},\"usage\":{\"input_tokens\":89,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":600000,\"output_tokens\":111},\"timestamp\":\"$_now_iso\"}" \
    "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"new instruction\"},\"timestamp\":\"$_now_iso\"}" \
    > "$sat_dir/saturated.jsonl"
  printf '%s\n%s\n' \
    "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"},\"timestamp\":\"$_now_iso\"}" \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]},\"usage\":{\"input_tokens\":89,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":600000,\"output_tokens\":111},\"timestamp\":\"$_now_iso\"}" \
    > "$sat_dir/answering.jsonl"
  printf '%s\n%s\n' \
    "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]},\"usage\":{\"input_tokens\":89,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":50000,\"output_tokens\":111},\"timestamp\":\"$_now_iso\"}" \
    "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"new instruction\"},\"timestamp\":\"$_now_iso\"}" \
    > "$sat_dir/healthy.jsonl"
  sat_green=$(transcript_context_saturation "$sat_dir/saturated.jsonl")
  sat_answering=$(transcript_context_saturation "$sat_dir/answering.jsonl")
  sat_healthy=$(transcript_context_saturation "$sat_dir/healthy.jsonl")
  [ "$sat_green" = "saturated" ] || sat_ok=0
  [ "$sat_answering" = "unsaturated" ] || sat_ok=0
  [ "$sat_healthy" = "unsaturated" ] || sat_ok=0

  if [ "$json" = "1" ]; then
    printf '{"red-window-heartbeat_min":%s,"zero-output-heartbeat_min":%s,"OVERDUE_MIN":%s,"saturation":"%s","saturation_ok":%s}\n' \
      "$fmin" "$smin" "$OVERDUE_MIN" "$sat_green" "$sat_ok"
    rm -rf "$tmp"
    [ "$fmin" -lt "$OVERDUE_MIN" ] && [ "$smin" -ge "$OVERDUE_MIN" ] && [ "$sat_ok" = "1" ]
    return $?
  fi

  echo "session-liveness selfcheck: red-window-heartbeat_min=${fmin} zero-output-heartbeat_min=${smin} OVERDUE_MIN=${OVERDUE_MIN}"
  if [ "$fmin" -lt "$OVERDUE_MIN" ] && [ "$smin" -ge "$OVERDUE_MIN" ]; then
    echo "session-liveness selfcheck: PASS — 红窗处置（queue-state+提交）保持心跳新鲜；零产出触发 OVERDUE（真阳性保留）"
    rc=0
  else
    echo "session-liveness selfcheck: FAIL — fresh_min=${fmin} (<${OVERDUE_MIN} 应为真) stale_min=${smin} (≥${OVERDUE_MIN} 应为真)" >&2
    rc=1
  fi
  if [ "$sat_ok" = "1" ]; then
    echo "session-liveness selfcheck: saturation composite PASS — saturated=${sat_green} answering=${sat_answering} healthy=${sat_healthy}（饱和判据与普通忙/健康可区分）"
  else
    echo "session-liveness selfcheck: saturation FAIL — saturated=${sat_green} answering=${sat_answering} healthy=${sat_healthy}" >&2
    rc=1
  fi
  rm -rf "$tmp"
  return $rc
}

# intervention_selfcheck —— --check 接缝（gap-permission-prompt-merged-into-busy ## Contract 的
# measure/invoke：`bash plugin/scripts/session-liveness.sh --check`）。自包含（纯字符串 fixture，
# 无 tmux / 无文件）验证三条契约带：
#   1. permission_prompt_class：构造 permission-prompt pane ⇒ 分类为 intervention-required
#      （raw state=permission-prompt，busy=0 intervention=1）——非 busy，与「在干活」可区分（AC2）；
#   2. intervention_triggered：permission-prompt ⇒ 上层动作触发（SESSION-INTERVENTION-REQUIRED 事件
#      立即发出，非等 3 次 busy）（AC3）；
#   3. busy_true_work_not_flagged：构造真忙 pane（esc to interrupt）⇒ busy=1 intervention=0，
#      不触发 intervention（负控制，AC4）。
# 输出逐键 key=value 行（外层可 grep），退出 0 = 全部契约带成立；1 = 任一违反。
intervention_selfcheck() {
  local perm busy idle perm_state perm_busy perm_int busy_state busy_busy busy_int rc=0
  perm="Quick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder ✔\n  2. No, exit\nEnter to confirm · Esc to cancel"
  busy="───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage"
  idle="───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage"
  _sl_pane_verdict "$(printf '%b\n' "$perm")"
  perm_state="$_sl_pane_state"; perm_busy="$_sl_pane_busy"; perm_int="$_sl_pane_intervention"
  _sl_pane_verdict "$(printf '%b\n' "$busy")"
  busy_state="$_sl_pane_state"; busy_busy="$_sl_pane_busy"; busy_int="$_sl_pane_intervention"
  _sl_pane_verdict "$(printf '%b\n' "$idle")"
  # 契约带 1/2：permission-prompt ⇒ 非 busy + intervention（新状态，可区分于在干活）
  if [ "$perm_state" = "permission-prompt" ] && [ "$perm_busy" = "0" ] && [ "$perm_int" = "1" ]; then
    echo "permission_prompt_class=intervention-required (raw ${perm_state}; busy=${perm_busy} intervention=${perm_int})"
    echo "intervention_triggered=1 (permission-prompt ⇒ SESSION-INTERVENTION-REQUIRED 事件立即发出，非等 3 次 busy)"
  else
    echo "permission_prompt_class=FAIL (raw ${perm_state}; busy=${perm_busy} intervention=${perm_int}——permission-prompt 必须非 busy 且标 intervention)" >&2
    echo "intervention_triggered=0" >&2
    rc=1
  fi
  # 契约带 3（负控制）：真忙 ⇒ busy=1 intervention=0，不触发 intervention
  if [ "$busy_state" = "busy" ] && [ "$busy_busy" = "1" ] && [ "$busy_int" = "0" ]; then
    echo "busy_true_work_not_flagged=1 (busy ⇒ busy=${busy_busy} intervention=${busy_int}——正常忙碌不误报)"
  else
    echo "busy_true_work_not_flagged=0 (raw ${busy_state}; busy=${busy_busy} intervention=${busy_int})" >&2
    rc=1
  fi
  # 附带正控制：waiting-input ⇒ 闲 + 不干预（分类器未回归）
  if [ "$_sl_pane_state" = "waiting-input" ] && [ "$_sl_pane_busy" = "0" ] && [ "$_sl_pane_intervention" = "0" ]; then
    : # 正常闲：契约带之外的正控制，静默通过
  else
    echo "waiting_input_class=FAIL (raw ${_sl_pane_state}; busy=${_sl_pane_busy} intervention=${_sl_pane_intervention})" >&2
    rc=1
  fi
  [ "$rc" = "0" ] && echo "session-liveness --check: PASS — permission-prompt 单列非 busy + 触发 intervention；正常忙仍 busy"
  return $rc
}

ONE_SHOT=false
# AC99 — `--once --json` emits ONE JSON document ({ "sessions": [ {name, alive, pid, halted, …} ] })
# instead of SESSION-STATUS text rows (the Manager view's machine-readable interface). Text output
# is unchanged when `--json` is absent.
JSON_ONCE=false
# AC99 --once --json accumulation buffer: tab-separated rows, one per target, emitted as one JSON
# document after the one-shot loop breaks. Rows: `STATUS\t<name>\t<alive>\t<pid>\t<halted>` or
# `DECOMMISSIONED\t<name>` (offline per observer-registry — criteria invalid for that target).
JSON_ONCE_ROWS=""
case "${1:-}" in
  --once)
    ONE_SHOT=true
    if [ "${2:-}" = "--json" ]; then JSON_ONCE=true; fi
    ;;
  --selfcheck)
    # Contract measure `--selfcheck --json 2>&1 | grep -c 'saturated'`（阶段四）：--json 变体只打一行
    # JSON（含 saturation 字段）；无 --json = 原人类可读自检。
    if [ "${2:-}" = "--json" ]; then selfcheck 1; exit $?; fi
    selfcheck; exit $? ;;
  --states)
    # 状态词汇表（阶段四 Contract measure `--states | grep -c 'saturated'`）：含 saturated。
    echo "SESSION-GONE / SESSION-BACK — 会话进程消失 / 恢复"
    echo "SESSION-IDLE / SESSION-RESUMED — 转入空闲 / 恢复活动"
    echo "SESSION-OVERDUE — 心跳逾期（会话可能已死）"
    echo "SESSION-MARKER-STALE — 屏幕标志可能失效"
    echo "SESSION-IDLE-CANT-SEND — 空闲且发不出请求"
    echo "REPO-STALL — 仓库信号（非会话面）"
    echo "SESSION-STATUS — --once 接缝状态行"
    echo "SESSION-DISABLED — 会话已失能（disabled：饱和(saturated)&& develop 静默 ≥SATURATION_SILENCE_MIN && 在飞 worktree 集合无变化 && 在飞 worktree 无活进程 && 会话心跳 ≥SATURATION_SILENCE_MIN 未动（推进量））"
    echo "SESSION-INTERVENTION-REQUIRED — 需要人/上层介入（permission-prompt 卡权限框，非 busy，单列可检测）"
    exit 0 ;;
  --saturation)
    [ -n "${2:-}" ] || { echo "用法: $0 --saturation <transcript>" >&2; exit 2; }
    transcript_saturation_report "$2"; exit 0 ;;
  --mask) mask_pane; exit 0 ;;
  --pane-state)
    # 诊断接缝（AC4/AC5 单测直接调用）：从 stdin 读 pane 文本，跑与主循环相同的
    # _sl_pane_verdict（classifyPaneStateOrthogonal + AC5 守卫），打印
    # "state=<s> busy=<0|1> intervention=<0|1> work_in_flight=<0|1>"。busy 字段保持向后兼容；
    # intervention 是 gap-permission-prompt-merged-into-busy 新增的独立标志（permission-prompt ⇒
    # intervention=1）；work_in_flight 是 gap-pane-classify-needs-two-orthogonal-dimensions 的两正交
    # 字段之二（后台 agent 是否在跑——独立于 input_state，非 busy）。
    _sl_pane_verdict "$(cat)"
    echo "state=$_sl_pane_state busy=$_sl_pane_busy intervention=$_sl_pane_intervention work_in_flight=$_sl_pane_work_in_flight"
    exit 0 ;;
  --check)
    # ## Contract measure/invoke 接缝（gap-permission-prompt-merged-into-busy）：自包含自检。
    # 构造 permission-prompt / busy / waiting-input 三种 pane，验证三条契约带（见
    # intervention_selfcheck）。退出 0 = 全部通过。
    intervention_selfcheck; exit $? ;;
  --perm-warn-verdict)
    # 候选 B 纯判据接缝（gap-permission-prompt-vs-dismissable-prompt-classifier AC4 单测直接调用）：
    # 打印 _sl_perm_prompt_warn_verdict 的输出（warn|ok）。入参 <连续轮数> <transcript 陈旧秒数|-1>。
    [ $# -ge 3 ] || { echo "用法: $0 --perm-warn-verdict <rounds> <tx_age_secs|-1>" >&2; exit 2; }
    _sl_perm_prompt_warn_verdict "$2" "$3"; exit 0 ;;
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
  -h|--help) echo "用法: $0 [--once] [--selfcheck [--json]] [--states] [--saturation <t>] [--mask] [--pane-state] [--check] [--api-errors <t>] [--last-input <t>] [--last-message-type <t>] [--perm-warn-verdict <rounds> <tx_age>] [--resolve-transcript <name> <root> <pid>] [--dynamic-transcript <name> <root> <pid>]"; exit 0 ;;
esac

# ── 本项目根：自定位（同 inner-state.sh）。SESSION_ROOT 是测试接缝，生产不设。 ──────────────
REPO_ROOT="${SESSION_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  _sl_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_sl_script_dir/../.." && pwd)"
fi

# ── 管理者的多目标配置（AC9）：orchestration/session-liveness.env 存在则 source。
#    shell KEY=VALUE，不是 YAML。显式环境变量优先——SESSION_TARGETS 经 source 守卫、
#    SESSION_TMUX_SESSION / SESSION_TRANSCRIPTS / SESSION_HEARTBEATS 经先钉后回。
#    gap-session-liveness-ignores-unknown-transcript-names：管理者挂载时显式传
#    SESSION_TRANSCRIPTS="outer <outer transcript>" 但未设 SESSION_TARGETS，env 文件的
#    SESSION_TRANSCRIPTS（"quay …"）会把「outer」静默覆盖 ⇒ 配置接线审计
#    （_sl_audit_config_wiring）看不到调用方的名字 ⇒ 名字不匹配目标表零告警、盯错对象
#    （outer 216s 无人观测）。先钉后回让调用方显式值存活，审计才能对「不在目标表的名字」告警。 ──
_sl_transcripts_env="${SESSION_TRANSCRIPTS:-}"
_sl_heartbeats_env="${SESSION_HEARTBEATS:-}"
_sl_session_env="${SESSION_TMUX_SESSION:-}"
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
# 钉住动作在第一个 source 块前完成（上面的 _sl_*_env）；这里做回写。
if [ -n "$_sl_session_env" ]; then
  SESSION_TMUX_SESSION="$_sl_session_env"
fi
# 先钉后回（与 SESSION_TMUX_SESSION 同模式）：调用方显式设的 SESSION_TRANSCRIPTS /
# SESSION_HEARTBEATS 在 env 文件 source 后回写——显式值存活，_sl_audit_config_wiring 才能对
# 不在目标表的名字告警（gap-session-liveness-ignores-unknown-transcript-names）。
if [ -n "$_sl_transcripts_env" ]; then
  SESSION_TRANSCRIPTS="$_sl_transcripts_env"
fi
if [ -n "$_sl_heartbeats_env" ]; then
  SESSION_HEARTBEATS="$_sl_heartbeats_env"
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
# 按角色解析目标窗口（AC2/AC3/AC4，gap-session-liveness-session-pid-blind-to-claude-as-pane-process）：
#   SESSION_TMUX_SESSION 带【命名窗口】后缀（<会话>:inner / <会话>:outer）⇒ 直接用该窗口作为目标——
#     外层监视器盯 inner、管理者盯 outer；会话名 env 值（<会话>）本就该配上角色窗口。
#   带【数字 pane】后缀（quay-init 写的 ol-cold:0.0 是 pane 引用、指明会话）⇒ 剥到会话基名，
#     走零配置默认的 <base>:outer（本项目自己的外层）。
#   无后缀（quay-0）⇒ <base>:outer（零配置默认）。
case "$_sl_session" in
  *:*)
    case "${_sl_session#*:}" in
      *[!0-9.]*) DEFAULT_TARGET="$_sl_session" ;;      # 命名窗口后缀 → 直接作为目标
      *) DEFAULT_TARGET="${_sl_session_base}:outer" ;; # 数字 pane 引用 → base:outer
    esac
    ;;
  *) DEFAULT_TARGET="${_sl_session_base}:outer" ;;
esac

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
  # 默认外层心跳 = <目标根>/orchestration/tick-log.md。用 $root 而非 $REPO_ROOT：生产零配置下
  # 两者相等（targets() 的零配置默认 root=REPO_ROOT），但用 $root 让多目标配置与测试能控制它，
  # 且多源融合（_outer_heartbeat_max_mtime）正是以 $root 为根的。
  echo "$root/orchestration/tick-log.md"
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

# heartbeat_mtime_for —— 按目标选心跳源并算 mtime（gap-outer-heartbeat-source-inverts-...，2026-08-05）。
# 三种情形（与 heartbeat_for 同序）：
#   1. SESSION_TRANSCRIPTS 给了该名字 → 单源 transcript（+ subagents，heartbeat_mtime 处理）；
#   2. SESSION_HEARTBEATS 给了该名字 → 单源显式路径（调用方已选定特定源，保持单源语义）；
#   3. 默认外层心跳（tick-log）→ 多源 max mtime（outer_heartbeat_mtime）——红窗处置不反向失效。
# 返回 epoch；0 = 无源/不可读。
heartbeat_mtime_for() {
  local name=$1 root=$2 t p
  if t=$(transcript_for "$name" "$root"); then
    heartbeat_mtime "$t"; return 0
  fi
  if [ -n "${SESSION_HEARTBEATS:-}" ]; then
    while read -r n p; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$name" ]; then heartbeat_mtime "$p"; return 0; fi
    done <<< "$SESSION_HEARTBEATS"
    echo 0; return 0
  fi
  outer_heartbeat_mtime "$root"
}

_is_claude_pid() {
  local pid=$1 comm argv0 base
  comm=$(cat "/proc/$pid/comm" 2>/dev/null || true)
  case "$comm" in claude*) return 0 ;; esac
  argv0=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | head -1)
  [ -n "$argv0" ] || return 1
  base="${argv0##*/}"
  case "$base" in *claude*) return 0 ;; esac
  return 1
}

session_pid() {  # 按窗口名寻址；pane 索引会漂。找 pane 本体或其任一子进程里的 claude 进程。
  local t=$1 ppid cpid
  ppid=$("${_sl_tmux[@]}" list-panes -t "$t" -F '#{pane_pid}' 2>/dev/null | head -1) || true
  [ -n "${ppid:-}" ] || { echo ""; return; }
  # pane_pid 自身就是 claude（claude-as-pane-process：3 窗格拓扑里 pane 前台进程就是 claude）——
  # 旧实现只查子进程，inner/outer 恒 alive=0（SESSION-GONE 永不触发，监视器永久沉默）。
  if _is_claude_pid "$ppid"; then echo "$ppid"; return; fi
  # 后代遍历（与 topology-check.sh 的 has_claude_child 同遍历）：找第一个 claude 后代。
  for cpid in $(pgrep -P "$ppid" 2>/dev/null); do
    if _is_claude_pid "$cpid"; then echo "$cpid"; return; fi
  done
  echo ""
}

# ── 动态 transcript 解析（observer-blind-fix，2026-08-12）────────────────────────────────
# 缺陷：观察者把每个目标的 transcript 路径绑到【挂载时配置】（SESSION_TRANSCRIPTS，见 transcript_for）。
# 会话【重启】（新会话 id = 新 transcript 路径，如 ~/.claude/projects/<slug>/<新id>.jsonl）后观察者
# 继续盯旧路径 ⇒ 恒假 SESSION-OVERDUE（旧文件不再动），且真死时反而无事件（已经狼来了）。tmux 窗口名
# 不随重启变（pane 在同一窗口里重生）⇒ 窗口名是稳定键、会话 id / transcript 路径是变化值。
#
# 修法：每轮从目标窗口的【当前进程】重新解析 transcript（不缓存）。优先级：
#   动态（confident）> 配置；low/none → 配置（「会话 id 是配置不去推断」的既有单源语义保持）。
#   /clear 与 --resume 这类「进程寿命与文件寿命解耦」的已知不可靠情形（文件头 :166-167 注释）——
#   同一进程的 env 会话 id 可能不随 /clear 轮换、--resume 是旧文件新进程 —— 动态解析不自信，
#   按配置走。真正的【重启】= 新进程 + 新会话 id ⇒ 动态 confident ⇒ 自愈。
#
# 解析方法（按可靠度排序，见 _sl_dynamic_transcript）：
#   A. ~/.claude/sessions/<pid>.json（PRIMARY / 权威，2026-08-12）：CC 自己维护的 pid→sessionId 映射。
#      生产环境 claude 进程不导出 CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR（实测 /proc/<pid>/environ
#      无这两个键）⇒ env 路径恒 none ⇒ 观察者回落到配置的（重启前）transcript ⇒ 恒假 OVERDUE / IDLE。
#      sessions/<pid>.json 重启后立即正确（manager 曾用它做 --resume）。读 sessionId →
#      transcript = $HOME/.claude/projects/<slug>/<id>.jsonl。防御性读取：文件缺失 / JSON 畸形 /
#      无 sessionId ⇒ 落到 B。cwd（存在时）realpath 必须等于目标 root——防止把别的项目窗口的 claude
#      会话 id 误当成此目标的（按 root 的 slug 拼会指向不存在的文件 ⇒ 心跳恒 0 ⇒ OVERDUE 永久静默 =
#      假阴性，与本任务消灭的盲同类）。
#   B. 进程 env 的 CLAUDE_CODE_SESSION_ID（SECONDARY / confident，存在时）：claude 进程启动时把绑定的
#      会话 id 写进 env。读 /proc/<pid>/environ 得会话 id → transcript = $HOME/.claude/projects/<slug>/<id>.jsonl。
#      交叉核对 CLAUDE_PROJECT_DIR（存在时）的 realpath 必须等于目标 root 的 realpath——防止把别的
#      项目窗口的 claude 会话 id 误当成此目标的。env 给出会话 id 且项目匹配 ⇒ confident。
#   C. newest .jsonl 启发式（弱信号 / low，绝不覆盖配置）：项目目录下最近的 .jsonl。多会话同目录时
#      无法可靠区分哪个属于本窗口（除非经 env，而 env 已经由 B 查过）⇒ 只在【恰好一个】候选且 mtime
#      新时才报 low；多候选歧义 ⇒ none（任务要求：多候选/无法消歧 ⇒ 配置赢）。
# 置信度语义：confident → 覆盖配置（restart 自愈）；low / none → 配置赢（单源语义保持）。

# _sl_dynamic_transcript —— 从目标窗口当前 claude 进程解析 transcript。入参：$1=名字 $2=项目根 $3=pid
# （pid 由调用方 session_pid 解析，避免重复 tmux 调用）。输出两行：第一行置信度（confident|low|none），
# 第二行候选路径（low/none 时可为空）。
_sl_dynamic_transcript() {
  local name=$1 root=$2 pid=$3 sid projdir slug recent_cnt recent_newest now m f p1 p2 cwd sessions_file
  [ -n "${pid:-}" ] || { echo "none"; echo ""; return 0; }
  slug=$(printf '%s' "$root" | tr '/' '-')

  # 方法 A：~/.claude/sessions/<pid>.json（PRIMARY / 权威，CC 维护的 pid→sessionId 映射）。
  # 生产环境 claude 进程不导出 CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR，env 路径恒 none ⇒
  # 观察者回落到配置的（重启前）transcript ⇒ 恒假 OVERDUE/IDLE。sessions/<pid>.json 重启后立即
  # 正确。防御性读取：文件缺失 / JSON 畸形 / 无 sessionId ⇒ 落到方法 B。
  sessions_file="$HOME/.claude/sessions/$pid.json"
  if [ -r "$sessions_file" ]; then
    sid=$(grep -o '"sessionId":"[^"]*"' "$sessions_file" 2>/dev/null | head -1 | cut -d'"' -f4)
    if [ -n "$sid" ]; then
      cwd=$(grep -o '"cwd":"[^"]*"' "$sessions_file" 2>/dev/null | head -1 | cut -d'"' -f4)
      if [ -n "$cwd" ]; then
        # 项目交叉核对（realpath 兼容符号链接）：cwd 不匹配 ⇒ 该进程属于别的项目，不是本目标。
        p1=$(realpath "$cwd" 2>/dev/null || printf '%s' "$cwd")
        p2=$(realpath "$root" 2>/dev/null || printf '%s' "$root")
        if [ "$p1" != "$p2" ]; then
          echo "none"; echo ""; return 0
        fi
      fi
      echo "confident"; echo "$HOME/.claude/projects/$slug/$sid.jsonl"; return 0
    fi
  fi

  # 方法 B：进程 env 的 CLAUDE_CODE_SESSION_ID（SECONDARY，存在时权威）
  if [ -r "/proc/$pid/environ" ]; then
    sid=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^CLAUDE_CODE_SESSION_ID=//p' | head -1)
    if [ -n "$sid" ]; then
      projdir=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^CLAUDE_PROJECT_DIR=//p' | head -1)
      if [ -n "$projdir" ]; then
        # 项目交叉核对（realpath 兼容符号链接）：不匹配 ⇒ 该进程属于别的项目，不是本目标。
        p1=$(realpath "$projdir" 2>/dev/null || printf '%s' "$projdir")
        p2=$(realpath "$root" 2>/dev/null || printf '%s' "$root")
        if [ "$p1" != "$p2" ]; then
          echo "none"; echo ""; return 0
        fi
      else
        # 无 CLAUDE_PROJECT_DIR 可核对 ⇒ 不敢置信（怕取到别项目 ⇒ 假阴性）⇒ 低置信，配置赢。
        echo "low"; echo "$HOME/.claude/projects/$slug/$sid.jsonl"; return 0
      fi
      echo "confident"; echo "$HOME/.claude/projects/$slug/$sid.jsonl"; return 0
    fi
  fi
  # 方法 C：newest .jsonl（弱；多候选歧义 → none）。只取「恰好一个且 mtime 近」的候选报 low。
  recent_cnt=0; recent_newest=""
  now=$(date +%s)
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    m=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    # 「近」= 最近 OVERDUE_MIN 分钟内有写入（新 transcript 刚创建即近；旧会话的陈旧 transcript 不算）。
    if [ "$m" -ge "$(( now - OVERDUE_MIN * 60 ))" ] 2>/dev/null; then
      recent_cnt=$((recent_cnt + 1))
      [ -n "$recent_newest" ] || recent_newest="$f"
    fi
  done < <(ls -t "$HOME/.claude/projects/$slug/"*.jsonl 2>/dev/null)
  if [ "$recent_cnt" -eq 1 ]; then
    echo "low"; echo "$recent_newest"; return 0
  fi
  echo "none"; echo ""; return 0
}

# _sl_configured_transcript_like —— 该目标【配置】的 transcript 形心跳路径：SESSION_TRANSCRIPTS 优先
# （transcript_for 解析），其次 *.jsonl 的 SESSION_HEARTBEATS。空 = 目标心跳不是 transcript（目录/自定义
# 文件/默认多源外层心跳）→ 不做动态覆盖（调用方已选定特定源，单源语义保持，见文件头 :61）。
_sl_configured_transcript_like() {
  local name=$1 root=$2 v
  if t=$(transcript_for "$name" "$root"); then printf '%s\n' "$t"; return 0; fi
  if [ -n "${SESSION_HEARTBEATS:-}" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$name" ]; then
        case "$v" in
          *.jsonl) printf '%s\n' "$v"; return 0 ;;
        esac
      fi
    done <<< "$SESSION_HEARTBEATS"
  fi
  return 1
}

# _sl_heartbeat_is_transcript —— 该目标「心跳源」是否就是 transcript（MARKER-STALE 交叉正控制的
# 适用面，gap-session-liveness-marker-stale-fires-on-tick-log）。与 _sl_configured_transcript_like
# 同判据（SESSION_TRANSCRIPTS 优先，其次 *.jsonl 的 SESSION_HEARTBEATS；默认 tick-log / 自定义
# 非 jsonl 心跳都不是 transcript）。marker-stale 只对「心跳是 transcript」的目标成立——tick 日志
# 是 loop 写的，不是会话活动的证据。返回 0 = 心跳源是 transcript；1 = 不是（或无法判定，fail-closed
# 不 fire marker-stale）。
_sl_heartbeat_is_transcript() {
  local name=$1 root=$2 cfg
  cfg=$(_sl_configured_transcript_like "$name" "$root" || true)
  [ -n "$cfg" ]
}

# _sl_effective_transcript —— 每轮生效的 transcript 路径（observer-blind-fix 的优先级落点）。
# 只对「配置了 transcript 形心跳」的目标做动态覆盖；输出到全局 _sl_eff_transcript，并把动态解析的
# 置信度/候选路径存 _sl_dyn_conf / _sl_dyn_path 供诊断。
#   置信度 precedence（任务要求，注释在此钉死）：
#     confident（窗口当前 claude 进程经 ~/.claude/sessions/<pid>.json（主）或其 env 的
#       CLAUDE_CODE_SESSION_ID（次）+ 项目匹配解析出会话 id）⇒ 动态路径赢——
#       重启自愈：新会话 id 的新 transcript 在下一轮被拾起（生产 env 不导出 CLAUDE_*，主路径
#       就是 sessions/<pid>.json）；
#     low / none（无进程 / sessions 文件缺失或畸形 / env 无 id / 项目不匹配 / 无项目可核对 /
#       多候选歧义 / 启发式）⇒ 配置赢——/clear 与 --resume 等已知不可靠情形保持既有单源语义。
_sl_effective_transcript() {
  local name=$1 root=$2 pid=$3 cfg dynout
  cfg=$(_sl_configured_transcript_like "$name" "$root" || true)
  _sl_dyn_conf="none"; _sl_dyn_path=""
  if [ -n "$cfg" ]; then
    dynout=$(_sl_dynamic_transcript "$name" "$root" "$pid")
    _sl_dyn_conf=${dynout%%$'\n'*}
    _sl_dyn_path=${dynout#*$'\n'}
  fi
  if [ "$_sl_dyn_conf" = "confident" ] && [ -n "$_sl_dyn_path" ]; then
    _sl_eff_transcript="$_sl_dyn_path"
  else
    _sl_eff_transcript="$cfg"
  fi
}

# _sl_effective_heartbeat —— 每轮生效的心跳路径（observer-blind-fix）：目标的心跳源是 transcript 形
# 且 _sl_eff_transcript 已被 confident 动态解析覆盖（restart 自愈）⇒ 心跳用动态路径——否则 OVERDUE /
# IDLE 噪声闸门仍盯旧 transcript（盲）。自定义目录心跳 / 默认多源外层心跳不在此列（单源语义保持）。
_sl_effective_heartbeat() {
  local name=$1 root=$2 hb cfg
  hb=$(heartbeat_for "$name" "$root")
  if [ -n "${_sl_eff_transcript:-}" ] && [ "$hb" != "$_sl_eff_transcript" ]; then
    if cfg=$(_sl_configured_transcript_like "$name" "$root") && [ "$cfg" = "$hb" ]; then
      hb="$_sl_eff_transcript"
    fi
  fi
  printf '%s\n' "$hb"
}

# 诊断/单测接缝（observer-blind-fix；放在函数定义之后，因 _sl_effective_transcript 依赖 transcript_for）：
if [ "${1:-}" = "--resolve-transcript" ]; then
  # 打印给定目标在给定 pid（窗口当前 claude 进程）下的【生效 transcript 路径】——confident 动态 > 配置。
  # 空 = 无 transcript 形心跳配置 / 无法解析。用法：--resolve-transcript <name> <root> <pid>
  [ $# -ge 4 ] || { echo "用法: $0 --resolve-transcript <name> <root> <pid>" >&2; exit 2; }
  _sl_effective_transcript "$2" "$3" "$4"
  printf '%s\n' "$_sl_eff_transcript"
  exit 0
fi
if [ "${1:-}" = "--dynamic-transcript" ]; then
  # 打印 _sl_dynamic_transcript 的原始输出（第一行置信度 confident|low|none，第二行候选路径）。
  [ $# -ge 4 ] || { echo "用法: $0 --dynamic-transcript <name> <root> <pid>" >&2; exit 2; }
  _sl_dynamic_transcript "$2" "$3" "$4"
  exit 0
fi

# ── 无挂载门（2026-08-06 人裁定：彻底去掉互斥锁）──────────────────────────────────────────
# 观测对目标【纯只读】（只有 tmux capture-pane / git log / stat，零写入）——只读天然不排他，
# 两个观察者盯同一 pane 的代价只是每周期多一次 capture-pane，互不影响也不需要互相知情。互斥锁
# 存在的唯一理由 = 保护那个共享事件文件；共享文件不该存在（见 sl_emit 上方注释），锁就没有
# 存在理由。挂载不再取任何锁、不再区分「第一个/第二个挂载」：谁挂谁拥有自己的 stdout 事件流，
# 多观察者并行挂载天然无冲突。谁先启动无关——每个观察者的状态完全是进程内的（PREV_* 关联数组），
# 观察者之间互不知情、不共享任何写点。

# ── 配置接线审计（gap-session-liveness-monitor-watches-self-not-inner，2026-08-08）────────────
# 失败形态：SESSION_TRANSCRIPTS / SESSION_HEARTBEATS 的名字与 SESSION_TARGETS 的目标名不一致 ⇒
# transcript_for 按名匹配不到 ⇒ tr_path 静默为空 ⇒ 该目标的心跳回落默认外层多源心跳——以为配了
# transcript 实际没有，transcript 相关判据（MARKER-STALE / CANT-SEND / SATURATED /
# OVERDUE-on-transcript）全部不生效：监视器「看内层进程、按外层心跳判」的静默半盲。这就是
# 12:2x 版本把 SESSION_TRANSCRIPTS 写成 "inner"（目标名却是 "quay"）时发生的事。启动时对每个
# 配置的 transcript/heartbeat 名字，若不属于任一 SESSION_TARGETS 目标名，WARN 一次（每名字一次，
# stderr）——宁可启动时响一声，不要运行期静默半盲。
_sl_audit_config_wiring() {
  [ -n "${SESSION_TRANSCRIPTS:-${SESSION_HEARTBEATS:-}}" ] || return 0
  local -A target_names=()
  local name root target n v src
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    target_names["$name"]=1
  done < <(targets)
  for src in SESSION_TRANSCRIPTS SESSION_HEARTBEATS; do
    [ -n "${!src:-}" ] || continue
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      [ "${target_names[$n]:-0}" = "1" ] || \
        echo "session-liveness: WARN ${src} 的名字「${n}」不匹配任何 SESSION_TARGETS 目标名（targets: ${!target_names[*]}）——transcript_for 按名匹配会找不到它，该目标的心跳不会用这个源；名字必须与 SESSION_TARGETS 的目标名一致" >&2
    done <<< "${!src}"
  done
}
_sl_audit_config_wiring

# ── pane-only 默认心跳闸门审计（gap-session-liveness-busy-mask-idle-with-subagents，2026-08-08）──
# 真根因（outer 2c1d0c7c）：pane-only 目标（无显式 SESSION_HEARTBEATS / SESSION_TRANSCRIPTS）的
# 心跳回落默认外层多源（tick-log 等），而 tick-log 被【每一个 outer/inner tick】追加 ⇒ mtime 恒
# 新鲜 ⇒ hmin < LOOP_MIN ⇒ SESSION-IDLE 噪声闸门把停摆静默吞掉（实测：pane-only + LOOP_MIN=1 →
# IDLE_CONSEC 单调但 IDLE 零条；LOOP_MIN=0 → IDLE 正常发出）。忙闲分类与 D5 报告门均无缺陷——
# 缺的是边界认识 + 显式心跳源/LOOP_MIN 调整。启动时对每个「pane-only + 默认心跳 + LOOP_MIN>0」
# 的目标 WARN 一次（stderr）——宁可启动时响一声，不要运行期静默半盲（同 _sl_audit_config_wiring
# 的同一原则）。pane-only 观测要么配显式心跳源，要么设 LOOP_MIN=0。
_sl_audit_pane_only_gate() {
  [ "${LOOP_MIN:-0}" -gt 0 ] 2>/dev/null || return 0
  local name root target hb
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    hb=$(heartbeat_for "$name" "$root")
    [ -n "$hb" ] || continue
    if heartbeat_is_outer_default "$name" "$root" "$hb"; then
      echo "session-liveness: WARN 目标「${name}」是 pane-only（无显式 SESSION_HEARTBEATS / SESSION_TRANSCRIPTS），心跳回落默认外层多源（tick-log 等）。默认心跳由【主循环 tick】刷新、不反映该目标会话自身活动——若该目标正被上层驱动，LOOP_MIN=${LOOP_MIN} 的噪声闸门会把 SESSION-IDLE 静默吞掉（停摆失明）。pane-only 观测请设 LOOP_MIN=0 或配显式心跳/transcript。" >&2
    fi
  done < <(targets)
}
_sl_audit_pane_only_gate
# ── 观测者自注册（gap-sweeptmp-pkill-kills-live-observers-two-layer-blind 候选 D / AC5）─────────
# 「观测者被杀」要有观测者：常驻监视器启动时在 $REPO_ROOT/.quay/ 写一个 pid 注册文件、退出时移除
# （trap），让外层/manager 能发现「本该在跑的实例没了」——不靠「Monitor 报 failed」这种被动、且会
# 随会话一起死的通道。文件按 pid 唯一（.quay/session-liveness.<pid>.json），多实例互不冲突；
# 检查器（plugin/scripts/observer-registry-check.sh）读注册表 + 对照 /proc，发现已注册但进程已
# 消失的实例。SIGKILL 无法 trap ⇒ 被杀时注册文件留下 = 死亡可被检测（这正是事故要的可观测性）。
# SL_NO_REGISTER=1 关闭（测试接缝：spawnMonitor 默认关，防测试污染真实 .quay）。
if [ "${SL_NO_REGISTER:-0}" != "1" ]; then
  _sl_reg_dir="$REPO_ROOT/.quay"
  mkdir -p "$_sl_reg_dir" 2>/dev/null || true
  _sl_reg_file="$_sl_reg_dir/session-liveness.$BASHPID.json"
  if [ -w "$_sl_reg_dir" ] || [ -w "$REPO_ROOT" ]; then
    printf '{"pid":%d,"started":"%s","root":"%s","targets":"%s"}\n' \
      "$BASHPID" "$(date -Is 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)" \
      "$REPO_ROOT" "${SESSION_TARGETS:-${SESSION_TMUX_SESSION:-}}" \
      > "$_sl_reg_file" 2>/dev/null || true
    _sl_unregister() { rm -f "$_sl_reg_file" 2>/dev/null || true; }
    trap _sl_unregister EXIT INT TERM
  fi
fi

while true; do
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    # 首轮预热（D5 锐化，2026-08-08）：该目标被观察的轮数。启动第 1 轮不报 IDLE/RESUMED
    # （原 SEEN_BUSY「未见过忙就永不报」的防启动误报意图改由它承担——前者只丢一轮，后者丢
    # 整段）。alive=0 分支把它清 0，会话恢复后重新预热一轮。
    ROUNDS[$name]=$(( ${ROUNDS[$name]:-0} + 1 ))
    # observer-registry (gap-observer-registry-target-decommission-and-criterion-invalidation):
    # a target registered OFFLINE is deliberately decommissioned — its criteria ("is the session
    # alive? / is it stalled? / is it being watched?") are INVALID. Report "decommissioned" and
    # evaluate NO events for it (no SESSION-GONE / REPO-STALL / SESSION-OVERDUE / SESSION-IDLE).
    # This is the class-level fix for consumers #2/#3 (git-staleness kept reporting REPO-STALL and
    # session-liveness-coverage kept reporting NOT-WATCHED for decommissioned targets).
    _sl_reg="${_sl_pane_dir}/observer-registry.sh"
    if [ -x "$_sl_reg" ] && "$_sl_reg" --is-offline "$name" >/dev/null 2>&1; then
      if [ "$ONE_SHOT" = true ]; then
        if [ "$JSON_ONCE" = true ]; then
          JSON_ONCE_ROWS+="DECOMMISSIONED\t${name}\n"
        else
          echo "SESSION-STATUS $name decommissioned (offline per observer-registry)"
        fi
      fi
      continue
    fi
    pid=$(session_pid "$target")
    alive=$([ -n "$pid" ] && echo 1 || echo 0)
    halted=$([ -f "$root/.halt" ] && echo 1 || echo 0)
    resumed=0   # 本轮该目标是否已报 SESSION-RESUMED（OVERDUE 与 RESUMED 不得同轮同目标同发）

    # 该目标的 transcript 路径（AC2/AC7/AC9 用）：SESSION_TRANSCRIPTS 配置了才有；
    # 没有 → tr_path 空，AC2 交叉正控制与 AC9 发不出请求检查对该目标不适用（tick 日志不是会话证据）。
    # observer-blind-fix：每轮从窗口当前进程动态解析（restart 自愈）；confident 动态 > 配置，
    # low/none → 配置（优先级见 _sl_effective_transcript）。
    tr_path=""
    _sl_effective_transcript "$name" "$root" "${pid:-}"
    tr_path="$_sl_eff_transcript"
    # 决策层 import 化（gap-session-liveness-decision-import-refactor）：transcript 判定一次批量算出，
    # 本轮各判定读取 _sl_tx_* 全局（一个 node 子进程出一份全部判定，而非每判定一次派生）。
    if [ -n "$tr_path" ]; then
      _sl_transcript_batch "$tr_path"
    fi

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

    # --once 接缝：每轮每个目标报一行状态（冷启动/安装后自检用，AC7）。--once --json 变体
    # 累积结构化行，循环结束后一次性输出 ONE JSON document（AC99 — Manager 视图的机读接口）。
    if [ "$ONE_SHOT" = true ]; then
      if [ "$JSON_ONCE" = true ]; then
        JSON_ONCE_ROWS+="STATUS\t${name}\t${alive}\t${pid:-0}\t${halted:-0}\n"
      else
        echo "SESSION-STATUS $name alive=$alive${pid:+ pid=$pid}${halted:+ halted=$halted}"
      fi
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
    # 判据（裁定 D / ADR-016 Amendment 2026-08-04）：屏幕信号 = classifyPaneState 的
    #   底部区域【形状分类】——不是整屏哈希（md5(capture-pane) 一族已被 ADR 禁止，无论是否
    #   先 mask）。忙 = 形状是 busy（esc to interrupt 在状态区）/ error-banner；闲 =
    #   waiting-input / unknown（unknown 由 transcript 融合兜底，AC5 只兜「捕获为空/区域为空」
    #   不静默判闲）。permission-prompt 单列：非忙 + intervention（gap-permission-prompt-merged-
    #   into-busy 2026-08-09——需要人/上层介入的信号，与「在干活」相反，触发
    #   SESSION-INTERVENTION-REQUIRED）。chrome（转圈耗时 ✽ / token 计数 /clear to save /
    #   ✻ 残留）天然进不了判据——形状分类读结构不读字节，所以「停泊会话只有 token 计数器
    #   在变」不会判忙（本任务假阳性源在此吸收）。不用 /proc CPU 增量：空闲的 Claude Code
    #   TUI 本身也在烧 CPU（实测 10 vs 132 jiffies，分离度太弱）。
    if [ "$alive" = "1" ]; then
      raw=$("${_sl_tmux[@]}" capture-pane -p -t "$target" 2>/dev/null)
      _sl_pane_verdict "$raw"
      pane_state="$_sl_pane_state"; busy_sem="$_sl_pane_busy"; region="$_sl_pane_region"
      # AC0 观测（先观测再修）：SL_PANE_STATE_LOG=1 时每轮每目标打一行 `pane_state=<state>`
      # 到 stdout，让「抖动形状」可观测（契约 measure pane_state_logged：运行 ≥15min 后日志
      # 出现每轮 pane_state=<state> 行 ≥1）。默认不打印，事件流干净（同 SL_ROUND_MARKER 接缝）。
      [ "${SL_PANE_STATE_LOG:-0}" = "1" ] && echo "pane_state=$pane_state round=${ROUNDS[$name]:-0}"
      if [ -z "${raw:-}" ] || [ -z "$region" ]; then
        # AC5（防过滤）：pane 捕获为空（tmux 失败 / pane 不可读）或分类器区域为空 ⇒ 不判空闲
        # ——忙会话若读到空屏会被永远报成空闲（静默）。显式 WARN 一次 + 判非闲（_sl_pane_verdict
        # 已把 busy 置 1）。
        if [ "${PREV_PANE_EMPTY[$name]:-0}" = "0" ]; then
          echo "session-liveness: WARN $name 的 pane 内容为空/区域为空——不判空闲（AC5 防过滤）" >&2
          PREV_PANE_EMPTY[$name]=1
        fi
      else
        PREV_PANE_EMPTY[$name]=0
      fi
      if [ -n "${PREV_STATE[$name]:-}" ]; then
        pane_busy=$busy_sem
        pane_idle=$(( 1 - pane_busy ))
        # 阶段三（AC1）：transcript 最后一条消息类型接入忙闲判据。transcript 侧优先级更高——
        # pending-tool-use / user-input ⇒ 确定忙，无论 pane 如何（AC5 忙判据零漏报）。
        # 判定来自本轮 _sl_transcript_batch 的 _sl_tx_last_mt（分类器 transcriptLastMessageType）。
        transcript_busy=0
        if [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
          case "$_sl_tx_last_mt" in
            pending-tool-use|user-input) transcript_busy=1 ;;
            *) transcript_busy=0 ;;
          esac
        fi
        fused_busy=$(( pane_busy || transcript_busy ))
        idle=$(( 1 - fused_busy ))
        # AC2 去抖：连续 fused-idle 轮数计数；忙轮清零。pane 形状分类是候选闲的辅助
        # （AC7）——transcript 最后一条消息类型是忙闲的结构信号。
        # AC2/D3 同阶去抖（gap-session-liveness-busy-mask-idle-with-subagents）：RESUMED 与 IDLE
        # 用同一去抖深度。IDLE 要连续 ≥IDLE_DEBOUNCE_ROUNDS 轮才报（下面 counter 分支）；RESUMED
        # 原先单轮沿即报（不对称硬事实）。BUSY_CONSEC 计数连续忙轮，RESUMED 也要求忙态被确认
        # ≥IDLE_DEBOUNCE_ROUNDS 轮才报（事件对语义成立：一段空闲的确认深度与一段忙的确认深度
        # 相同，1 轮忙 blip 不产生无配对 IDLE 的孤立 RESUMED）。
        if [ "$idle" = "1" ]; then
          IDLE_CONSEC[$name]=$(( ${IDLE_CONSEC[$name]:-0} + 1 ))
          BUSY_CONSEC[$name]=0
          RESUME_PENDING[$name]=0
        else
          IDLE_CONSEC[$name]=0
          BUSY_CONSEC[$name]=$(( ${BUSY_CONSEC[$name]:-0} + 1 ))
          SEEN_BUSY[$name]=1
          # per-spell 边沿（D5 锐化）：忙轮开启新段 → 该段空闲尚未报过，允许再报一次。
          IDLE_REPORTED[$name]=0
        fi
        # 首轮预热（D5 锐化）：第 1 轮不报 RESUMED（PREV_IDLE 未置位已兜底；ROUNDS 门显式化）。
        if [ "${ROUNDS[$name]:-0}" -gt 1 ] && [ "${PREV_IDLE[$name]:-unset}" != "unset" ] && [ "${PREV_IDLE[$name]}" != "$idle" ]; then
          if [ "$idle" = "1" ]; then
            # 忙→闲【单轮转换不报】——去抖（AC2）持有：只延迟 ≤1 轮询周期（真空闲下一轮还是闲，
            # 不造成漏报），远在 20 分钟 cron 兜底之内。真正的 SESSION-IDLE 由下面 counter 分支报。
            :
          else
            # idle→busy 转换：捕获成因并挂起，待忙态被确认 ≥IDLE_DEBOUNCE_ROUNDS 轮再报
            # （AC2/D3 同阶去抖）。RESUME_PENDING 在空闲轮清 0——1 轮忙 blip 不报 RESUMED。
            RESUME_PENDING[$name]=1
            # AC6/AC7：SESSION-RESUMED 带成因 payload（哪个标志/哪个区变了）+ 上次收到输入时刻。
            # 判据：收到事件后无需再采样即可判真假（原外层 3-4 次调用，改后 1 次）。
            cause_parts=()
            if [ "$busy_sem" = "1" ] && [ "${PREV_BUSY_SEM[$name]:-0}" = "0" ]; then
              case "$pane_state" in
                busy) cause_parts+=("esc to interrupt 标志出现（底部区域分类器判忙）") ;;
                permission-prompt) cause_parts+=("权限确认框出现") ;;
                error-banner) cause_parts+=("错误横幅出现") ;;
                *) cause_parts+=("屏幕形状判忙（$pane_state）") ;;
              esac
            fi
            RESUME_CAUSE[$name]=""
            for part in "${cause_parts[@]:-}"; do
              [ -n "$part" ] || continue
              [ -n "${RESUME_CAUSE[$name]}" ] && RESUME_CAUSE[$name]="${RESUME_CAUSE[$name]} + $part" || RESUME_CAUSE[$name]="$part"
            done
            [ -n "${RESUME_CAUSE[$name]}" ] || RESUME_CAUSE[$name]="状态变化"
            RESUME_LASTIN[$name]="取不到"
            if [ -n "$tr_path" ] && [ -r "$tr_path" ]; then
              # 判定来自本轮 _sl_transcript_batch 的 _sl_tx_lep（分类器 lastUserInputEpoch）。
              if [ -n "$_sl_tx_lep" ] && [ "$_sl_tx_lep" != "unknown" ]; then
                lmin=$(( ( $(date +%s) - _sl_tx_lep ) / 60 ))
                [ "$lmin" -lt 0 ] && lmin=0
                RESUME_LASTIN[$name]="${lmin} 分钟前"
              fi
            fi
          fi
        fi
        PREV_IDLE[$name]=$idle
        # AC2/D3 同阶去抖的 RESUMED 报告：忙态确认 ≥IDLE_DEBOUNCE_ROUNDS 轮（与 IDLE 同深度）
        # 且本段未报过（RESUME_PENDING 边沿）且非启动首轮（ROUNDS 预热）才报。
        if [ "${RESUME_PENDING[$name]:-0}" = "1" ] \
           && [ "${BUSY_CONSEC[$name]:-0}" -ge "$IDLE_DEBOUNCE_ROUNDS" ] \
           && [ "${ROUNDS[$name]:-0}" -gt 1 ]; then
          RESUME_PENDING[$name]=0
          resumed=1
          sl_emit "SESSION-RESUMED $name 的会话恢复活动（此前空闲；成因：${RESUME_CAUSE[$name]:-状态变化}；上次收到输入：${RESUME_LASTIN[$name]:-取不到}）"
        fi
        # 去抖后的 SESSION-IDLE 报告（AC2 + D5 锐化，2026-08-08）：连续 ≥IDLE_DEBOUNCE_ROUNDS
        # 轮 fused-idle 且本段未报过（IDLE_REPORTED 边沿）且非启动首轮（ROUNDS 预热）才报。
        #   * -ge 而非 -eq：计数器越过阈值后继续匹配——每段停摆不再只有「等于 2 的那一轮」一次
        #     触发机会（-eq 会把 SEEN_BUSY=0 那一轮的失配变成永久销毁，见文件头 D5 注释）。
        #   * IDLE_REPORTED：-ge 的边沿由它承担，每段空闲只报一次；忙轮清掉 → 新段可再报。
        #   * ROUNDS>1：原 SEEN_BUSY「防启动误报」意图（启动首轮不报），挂载时已在进行的停摆
        #     不再被「未见过忙就永不报」静默掉（AC6）。
        if [ "$idle" = "1" ] \
           && [ "${IDLE_CONSEC[$name]:-0}" -ge "$IDLE_DEBOUNCE_ROUNDS" ] \
           && [ "${IDLE_REPORTED[$name]:-0}" = "0" ] \
           && [ "${ROUNDS[$name]:-0}" -gt 1 ]; then
          IDLE_REPORTED[$name]=1
          hmin="?"
          hmod=$(heartbeat_mtime_for "$name" "$root")
          hb=$(_sl_effective_heartbeat "$name" "$root"); hmin="?"
          hmod=$(effective_heartbeat_mtime "$name" "$root" "${hb:-/nonexistent}")
          [ "$hmod" != "0" ] && hmin=$(( ( $(date +%s) - hmod ) / 60 ))
          halt_msg=$([ "$halted" = "1" ] && echo "（该项目已暂停，空闲是预期状态）" || echo "")
          # AC9（盲点13）：空闲且发不出请求（最近 transcript 记录带结构性 isApiErrorMessage）。
          # 这是「不可自愈类」——发不出请求不会自己好，按 AC5 宁可误报一侧，见即报（升级给人）。
          # 与常规 IDLE 互斥：能发请求才谈「没活干」，故这里直接二选一。
          api_n=0; api_blocked=0
          if [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
            # 判定来自本轮 _sl_transcript_batch 的 _sl_tx_api_n（分类器 trailingApiErrorCount）。
            api_n=$_sl_tx_api_n
            api_blocked=$([ "$api_n" -ge "$API_ERROR_MIN" ] 2>/dev/null && echo 1 || echo 0)
          fi
          PREV_API_BLOCKED[$name]=$api_blocked
          if [ "$api_blocked" = "1" ]; then
            sl_emit "SESSION-IDLE-CANT-SEND $name 的会话空闲且发不出请求（transcript 尾部连续 ${api_n} 条 isApiErrorMessage 结构字段，未被后续应答覆盖——AC7/D4 时效）——不可自愈类，立即升级给人"
          elif [ "$hmin" = "?" ] || [ "$hmin" -ge "$LOOP_MIN" ]; then
            # 噪声标定（管理者 3 个完整周期实测，2026-08-03）：健康循环是「刚动过（写了心跳）才转
            # 空闲」（心跳时距 ~1 分钟），每 20 分钟一对事件、三项目满载 18 次/小时，全是「一切正常」。
            # hmin < LOOP_MIN 的空闲 = 正常收尾 → 观察者 stdout 静默；hmin ≥ LOOP_MIN 或未知
            # （无心跳文件）=「空闲了但没动」，会话可能跑一半就停 / 已死 → 观察者 stdout 报。
            # SESSION-RESUMED 保留不静默（它便宜，且是唯一能确认会话还在按期活动的正向信号）。
            sl_emit "SESSION-IDLE $name 的会话转入空闲等输入；心跳 ${hmin} 分钟前更新${halt_msg}"
          else
            # hmin < LOOP_MIN（正常收尾）——观察者自己的 stdout 静默（噪声闸门，服务它自己的消费者）。
            # 2026-08-06 人裁定：不再有共享事件文件「记全量供订阅方自判」——每个观察者的阈值只
            # 作用于自己的流。想要知悉健康空闲的消费者（如 manager 观 outer）挂 LOOP_MIN=0 的观察者
            # 即可，AC21 的根因（共享文件 + 持有者阈值决定一切）已随共享文件移除。
            :
          fi
        fi
        # AC2（交叉正控制）：transcript 刚写过（会话确定在动）而【屏幕】判空闲 ⇒ 屏幕标志可能失效。
        # 只对「心跳是 transcript」的目标成立——tick 日志是 loop 写的，不是会话活动的证据；gating
        # 用 _sl_heartbeat_is_transcript 显式判「心跳源是 transcript」，而非仅 tr_path 非空（tr_path
        # 非空是代理量，心跳源是 transcript 才是正判据，gap-session-liveness-marker-stale-fires-on-tick-log）。
        # 假→真沿报一次；不一致率基线由观察者从事件流里数（全忙会话同时报 = TUI 文案变了）。
        # 判据用 pane_idle（屏幕判定）——transcript 侧确定忙时不该报「屏幕判空闲」。
        # work_in_flight 抑制（gap-pane-classify-needs-two-orthogonal-dimensions 根因）：屏幕空闲 +
        # 后台 agent 在跑 + transcript 在动是【自洽组合】（输入空闲 ≠ 会话死了，agent 还在跑）——
        # 这正是单枚举装不下的 {input空闲+agents在跑} 形态；有 work_in_flight 时 MARKER-STALE 是
        # 误报，不发出。
        if [ "$pane_idle" = "1" ] && [ "$halted" = "0" ] && [ "${_sl_pane_work_in_flight:-0}" != "1" ] && _sl_heartbeat_is_transcript "$name" "$root" && [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
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
          # 判定来自本轮 _sl_transcript_batch 的 _sl_tx_api_n（分类器 trailingApiErrorCount）。
          api_n2=$_sl_tx_api_n
          api_blocked2=$([ "$api_n2" -ge "$API_ERROR_MIN" ] 2>/dev/null && echo 1 || echo 0)
          if [ "$api_blocked2" = "1" ] && [ "${PREV_API_BLOCKED[$name]:-0}" = "0" ]; then
            sl_emit "SESSION-IDLE-CANT-SEND $name 的会话空闲且发不出请求（transcript 尾部连续 ${api_n2} 条 isApiErrorMessage 结构字段，未被后续应答覆盖——AC7/D4 时效）——不可自愈类，立即升级给人"
          fi
          PREV_API_BLOCKED[$name]=$api_blocked2
        else
          PREV_API_BLOCKED[$name]=0
        fi
      fi
      PREV_STATE[$name]=$pane_state
      PREV_BUSY_SEM[$name]=$busy_sem

      # 事件 5b：SESSION-INTERVENTION-REQUIRED（gap-permission-prompt-merged-into-busy）——
      # permission-prompt 单列后的上层动作触发（AC3）。permission-prompt = 需要人/上层裁决或授权，
      # 与「在干活」相反（busy=0 intervention=1）。出现即触发 escalate/报告——边沿触发（每段介入只报
      # 一次，PREV_INTERVENTION 承担边沿；离开 permission-prompt 清 0 → 新段可再报），不是等 3 次 busy，
      # 也不依赖 transcript 陈旧度（permission-prompt 本身就是要介入的信号）。启动首轮也报：一个
      # 挂载时就卡在权限框的会话此刻就要介入，不是预热噪声。
      if [ "$_sl_pane_intervention" = "1" ]; then
        if [ "${PREV_INTERVENTION[$name]:-0}" = "0" ]; then
          sl_emit "SESSION-INTERVENTION-REQUIRED $name 的会话需要人/上层介入：pane 显示权限确认框（permission-prompt，busy=0 intervention=1）——卡权限框 ≠ 在干活；上层应立即 escalate/报告，而不是当作忙碌推进"
        fi
        PREV_INTERVENTION[$name]=1
      else
        PREV_INTERVENTION[$name]=0
      fi

      # 候选 B（gap-permission-prompt-vs-dismissable-prompt-classifier AC4）：permission-prompt 持续
      # ≥PERM_PROMPT_WARN_ROUNDS 轮且 transcript 最近 PERM_PROMPT_TX_WINDOW 秒未写入 ⇒ 报一次 WARN
      # （不无限静默）。兜底：分类器候选 A 只排除已知可忽略提示（问卷带 (optional)/Dismiss）；新变体
      # 漏网时，假的 permission-prompt 会反复触发 SESSION-INTERVENTION-REQUIRED（噪声，而非阻断
      # SESSION-IDLE——permission-prompt 已单列非忙，gap-permission-prompt-merged-into-busy）。WARN 只去
      # stderr、每段一次（PREV_PERM_WARNED 边沿），绝不改动忙闲判据。
      if [ "$pane_state" = "permission-prompt" ]; then
        PERM_CONSEC[$name]=$(( ${PERM_CONSEC[$name]:-0} + 1 ))
      else
        PERM_CONSEC[$name]=0
        PREV_PERM_WARNED[$name]=0
      fi
      if [ "${PERM_CONSEC[$name]:-0}" -ge "$PERM_PROMPT_WARN_ROUNDS" ] \
         && [ "${PREV_PERM_WARNED[$name]:-0}" = "0" ]; then
        perm_tx_age=-1
        if [ -n "$tr_path" ] && [ -e "$tr_path" ]; then
          perm_hmt=$(heartbeat_mtime "$tr_path")
          [ "$perm_hmt" != "0" ] && perm_tx_age=$(( $(date +%s) - perm_hmt ))
        fi
        if [ "$(_sl_perm_prompt_warn_verdict "${PERM_CONSEC[$name]}" "$perm_tx_age")" = "warn" ]; then
          echo "session-liveness: WARN $name 的 pane 连续 ${PERM_CONSEC[$name]} 轮 permission-prompt 且 transcript 最近 ${perm_tx_age}s 未写入（窗口 ${PERM_PROMPT_TX_WINDOW}s）——可能是可忽略提示（问卷）被误判，反复触发 SESSION-INTERVENTION-REQUIRED 属噪声；若属实应让分类器识别为可忽略（AC4 兜底，不无限静默）" >&2
          PREV_PERM_WARNED[$name]=1
        fi
      fi

      # 事件 6：SESSION-DISABLED（阶段四，gap-session-saturated-composite-condition-emitter，2026-08-13）——
      # 复合条件发射端（选 A，manager 2026-08-13）：把 manager 的「三条件逐条判」搬进发射端，事件名
      # 与实际断言一致（「失能」而非仅「饱和」）。五条件全满足才发（gap-session-disabled-fires-when-busy
      # 2026-08-14 起加第④条忙时必假直接量——原三合取的最忙时误报：develop 静默与集合无变化在多任务
      # 实现中同时翻真，只有第④条把「忙」与「失能」分开；gap-idle-watch-session-disabled-false-positive-
      # long-tasks 2026-08-14 起加第⑤条推进量——原四元在【任何长任务】期间同真：cache_read 单调恒真、
      # develop 必然静默、worktree 集合必然不变、活进程也不总能被 /proc/cwd 看到（主 checkout 恒排除），
      # 四项无一项测「有没有推进」，只有第⑤条把「长任务在推进」与「失能没推进」分开）：
      #   ① 饱和（现有：最近 assistant 消息 usage.cache_read_input_tokens ≥ SATURATION_TOKENS
      #      且最后一条是未获回应的 user 输入——结构化源，非屏幕百分比，AC3；分类器判定来自本轮
      #      _sl_transcript_batch 的 _sl_tx_sat）；
      #   ② 该层 develop 提交静默 ≥ SATURATION_SILENCE_MIN（T 可配，非字面量 30）；
      #   ③ 在飞 worktree 集合无变化（集合差手法，不用时间戳；首轮无基线 ⇒ 判「有变化」，不误发）；
      #   ④ 在飞【链接】worktree 无活进程（_sl_worktree_idle：/proc/<pid>/cwd 解析，忙时必假——有活
      #      进程在 worktree 内 = 多任务实现中 = 该条取假，不报 DISABLED）；
      #   ⑤ 会话自身心跳 ≥ T 未动（_sl_heartbeat_stale：推进量合取项——心跳在 T 内被写过 = 会话在推进
      #      = 该条取假，长任务不误报；心跳 ≥T 未动 = 真停摆 = 放行。心跳源 = transcript + subagents，
      #      长 suite 由 subagent 驱动时写的是 <会话>/subagents/，仍在推进）。
      # 饱和不是故障（auto-compact 是正常机制）；只有「饱和且静默且冻结且无活进程且无推进」的失能形态
      # 才报（AC4 不关事件，真饱和到失能仍报）。区别于普通「忙」（AC2）：busy 会话若还在应答（最后一条
      # 是 assistant）不报 saturated；busy 会话若在飞 worktree 里有活进程，第④条直接取假；长任务若还在
      # 自驱写心跳，第⑤条直接取假。
      # 仅配置了 transcript（SESSION_TRANSCRIPTS）的目标适用——tick 日志不是会话证据。
      # 边沿触发（PREV_SATURATED 承担；按【复合判定】置位，非按裸饱和——复合首次为真才发一次）。
      if [ -n "$tr_path" ] && [ -r "$tr_path" ]; then
        sat=$_sl_tx_sat
        if [ "$sat" = "saturated" ]; then
          dev_silent=$(_sl_develop_silent "$root")
          wt_set=$(_sl_worktree_set "$root")
          if [ "${PREV_WT_KNOWN[$name]:-0}" = "1" ] && [ "$wt_set" = "${PREV_WT_SET[$name]:-}" ]; then
            wt_unchanged=1
          else
            wt_unchanged=0
          fi
          PREV_WT_SET[$name]=$wt_set
          PREV_WT_KNOWN[$name]=1
          wt_idle=$(_sl_worktree_idle "$root")   # 忙时必假直接量（AC1/判据1，gap-session-disabled-fires-when-busy）
          hb_stale=$(_sl_heartbeat_stale "$tr_path")   # 推进量合取项（AC1/判据1，长任务时必假——心跳在 T 内被写过）
          verdict=$(_sl_sat_disabled_verdict "$sat" "$dev_silent" "$wt_unchanged" "$wt_idle" "$hb_stale")
          if [ "$verdict" = "emit" ]; then
            if [ "${PREV_SATURATED[$name]:-0}" = "0" ]; then
              sl_emit "SESSION-DISABLED $name 的会话已失能（disabled：cache_read_input_tokens ≥ ${SATURATION_TOKENS} && develop 静默 ≥ ${SATURATION_SILENCE_MIN}min && 在飞 worktree 集合无变化 && 在飞 worktree 无活进程 && 会话心跳 ≥ ${SATURATION_SILENCE_MIN}min 未动（推进量，长任务时必假））——活着但收不进新指令且无推进；区别于普通「忙」（AC2）"
            fi
            PREV_SATURATED[$name]=1
          else
            PREV_SATURATED[$name]=0
          fi
        else
          PREV_SATURATED[$name]=0
          PREV_WT_KNOWN[$name]=0
          PREV_WT_SET[$name]=""
        fi
      else
        PREV_SATURATED[$name]=0
        PREV_WT_KNOWN[$name]=0
        PREV_WT_SET[$name]=""
      fi
    else
      PREV_STATE[$name]=""; PREV_IDLE[$name]="unset"; PREV_API_BLOCKED[$name]=0; PREV_MARKER_STALE[$name]=0
      PREV_PANE_EMPTY[$name]=0
      IDLE_CONSEC[$name]=0; SEEN_BUSY[$name]=0; PREV_SATURATED[$name]=0
      PREV_WT_SET[$name]=""; PREV_WT_KNOWN[$name]=0
      IDLE_REPORTED[$name]=0; ROUNDS[$name]=0
      PERM_CONSEC[$name]=0; PREV_PERM_WARNED[$name]=0
      PREV_INTERVENTION[$name]=0
    fi

    # 事件 4：心跳逾期——会话活着、项目未暂停，但心跳源超过 OVERDUE_MIN 未被更新。
    # 心跳源默认是外层多源 max mtime（提交/queue-state/tick-log/分诊记录/verification-round，见
    # outer_heartbeat_mtime）；内层是 transcript（AC1/AC16，见文件头）。用文件 mtime 而不是解析
    # 表内时刻：本仓的 tick 时刻本身就写成 "12:0xZ" 这类模糊值，解析不可靠。陈旧度 =
    # now - max(心跳 mtime, 解除停机时刻)——停泊期间累积的陈旧在解除停机那一刻清零（协调方样本）。
    # 默认外层心跳 = 多源 max mtime（effective_heartbeat_mtime：git 提交 / queue-state /
    # tick-log / 分诊记录 / verification-round.jsonl 任一最新即活）——红窗处置写 queue-state+提交
    # 不写 tick-log 仍保持心跳新鲜（gap-outer-heartbeat-source-inverts-under-incident-handling）。
    hb=$(_sl_effective_heartbeat "$name" "$root")
    if [ "$alive" = "1" ] && [ "$halted" = "0" ] && [ -n "${hb:-}" ]; then
      hmod=$(effective_heartbeat_mtime "$name" "$root" "$hb")
      if [ "$hmod" != "0" ]; then
        eff=$hmod; [ "$base_ts" -gt "$eff" ] && eff=$base_ts
        omin=$(( ( $(date +%s) - eff ) / 60 ))
        overdue=$([ "$omin" -ge "$OVERDUE_MIN" ] && echo 1 || echo 0)
        # 同一轮已报 RESUMED ⇒ 会话可证明在动（pane 哈希变了），OVERDUE 是自相矛盾
        # （协调方样本：RESUMED 与 OVERDUE 不得同轮同目标同发）。直接证据优先，压制 OVERDUE。
        if [ "$overdue" = "1" ] && [ "${PREV_OVERDUE[$name]:-0}" = "0" ] && [ "$resumed" = "0" ]; then
          if heartbeat_is_outer_default "$name" "$root" "$hb"; then
            # AC4（信号可区分）：默认外层心跳的 OVERDUE 自带多源说明——假阳性（有产出但 tick-log 旧）
            # 不会报 OVERDUE，能报出来就说明所有产出源都 ≥OVERDUE_MIN 没动，无需手工查提交历史。
            sl_emit "SESSION-OVERDUE $name 的会话活着，但多源心跳（git提交/queue-state/tick-log/分诊记录/verification-round 任一）${omin} 分钟未更新（阈值 ${OVERDUE_MIN} 分钟，预期周期 ${EXPECTED_CYCLE_MIN} 分钟）——会话可能已死，它会静默地永远空闲"
          else
            sl_emit "SESSION-OVERDUE $name 的会话活着，但心跳 ${omin} 分钟未更新（阈值 ${OVERDUE_MIN} 分钟，预期周期 ${EXPECTED_CYCLE_MIN} 分钟）——会话可能已死，它会静默地永远空闲"
          fi
        fi
        PREV_OVERDUE[$name]=$overdue
      fi
    else
      PREV_OVERDUE[$name]=0
    fi
  done < <(targets)
  [ "$ONE_SHOT" = true ] && break
  # 测试接缝 SL_ROUND_MARKER：每轮打一行 `# ROUND` 到 stdout，作为轮次刻度（替代旧的共享文件
  # HEARTBEAT 行——那是「看门的心跳」的载体，已随共享文件移除）。生产不设 → 不打印，事件流干净。
  [ "${SL_ROUND_MARKER:-0}" = "1" ] && echo "# ROUND"
  sleep "$INTERVAL"
done

# AC99 — --once --json: emit ONE JSON document with every target's status row collected above.
if [ "$JSON_ONCE" = true ]; then
  printf '%b' "$JSON_ONCE_ROWS" | python3 -c '
import json, sys
sessions = []
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        continue
    parts = line.split("\t")
    if parts[0] == "DECOMMISSIONED":
        sessions.append({"name": parts[1], "alive": False, "pid": None, "halted": False, "decommissioned": True})
    elif parts[0] == "STATUS" and len(parts) >= 5:
        sessions.append({
            "name": parts[1],
            "alive": parts[2] == "1",
            "pid": None if parts[3] in ("0", "") else int(parts[3]),
            "halted": parts[4] == "1",
        })
print(json.dumps({"sessions": sessions}, ensure_ascii=False))
'
  exit 0
fi
