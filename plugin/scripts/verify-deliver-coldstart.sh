#!/usr/bin/env bash
# @instrument "AC88 三步交付验证机制：① 干净目录全新 .tgz 安装 → ② 项目内 quay-init → ③ 冷启动活性（outer 窗口 + inner 层，直接量：git 提交 / /proc cwd / worktree）"
# verify-deliver-coldstart.sh — AC88 前置机制 (gap-ac88-verification-mechanism-extend-deliver, 人 2026-08-16 裁定).
#
# 目标：把 AC88 的跨主机验证从「装 tgz + 端口 HTTP 探活」的手工一次性形态，升级为【可重复的机制】——
#   三步顺序完整 (AC1)；冷启动活性判据是【直接量】(AC2)；B/C 干净宿主可运行（B 干净目录全新安装 / C
#   从零全新安装，AC3/AC4）；产出【可机械核对】的证据 (AC5)：验证所用 tgz 由该次验证自己从 develop-tip
#   现 build（--build-root），记录该 build 的 `git rev-parse HEAD`（commit sha）+ 产物 sha256，
#   达成 = 该 sha 新于 2026-08-16 阶段切换。
#   ⛔ 判据只锚定【事后仍可核】的对象（commit sha / 内容 sha256 / ISO 提交时间），
#      不引用生命周期短于判据的对象（worktree 内产物 / AC85 产物路径——后者随 worktree 已消失）。
#
# 三步：
#   ① 安装   — package.sh 产出的 quay-*.tgz + quay-native-*.tgz 全新安装进一个【隔离的 npm 前缀】
#               （默认全新临时前缀，证明「干净安装」——绝不复用 sync.sh git 开发树，那是 AC88
#               「⛔ 非 git clone」排除的形态，AC3）。装完断言 quay --version 与 quay-native --version。
#   ② 初始化 — 在干净空项目目录里跑【安装包里 shipped 的】quay-init.sh --all --loop
#               （安装源 = 本机 .tgz 产物内的插件包，非 dev 树），验证项目文件铺到位 (L1)：
#               L1 = SPEC §6 安装写入闭集（orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
#               的 QUAY-INIT-CLOSED-SET:BEGIN/END 块逐条解析），逐条 ∈ 项目根。⛔ 不在本脚本复制闭集清单
#               —— 闭集在 SPEC 里是机器可读契约，脚本只解析不抄写（硬规则 4c；复制一份就是制造漂移）。
#   ③ 冷启动 — 活性验证（outer 窗口 + inner 层），判据是【直接量】(AC2 / CLAUDE.md 硬规则 4b)：
#               · git 提交时间戳     —— loop 产出过提交（外部可核：git 对象）
#               · /proc/<pid>/cwd   —— 会话进程落在项目内（内核态），【且已通过启动信任弹窗】
#                                      （复用 pane-state-classify 的 permission-prompt 识别——
#                                      gap-verify-deliver-coldstart-l2-proc-ok-false-positive：
#                                      进程刚 spawn 卡在 "Quick safety check" 弹窗 6.2h 时
#                                      proc_ok 不得单独撑起，硬规则 4b）
#               · git worktree       —— inner 派发过在飞任务（git 态）
#               【不用】层自己的心跳自报（硬规则 4b：自报在停摆时恰好也停更，与「一切正常」同形）；
#               【不是】仅 quay serve 端口 HTTP 探活（AC2）。另接 shipped L2 判据
#               dead-loop-check.sh --check-running 作为佐证（复用，不新造）。
#
#   硬规则 4b 在③的具体化：git 提交直接量【排除 quay-init 自己的 auto-commit】
#   （`chore(quay-init):` 前缀）——那是一个「对『没在转』也成立」的提交（quay-init 铺完即提交），
#   若把它当活性信号，fresh 安装后不冷启动也会恒绿。只有【非 chore(quay-init) 的近期提交】才算
#   loop 产出过工作。这是把「量必须对『没在干』能取假」写进判据。
#
# 与 cold-start skill 的分工：本脚本做【验证】，不做第二次冷启动实现。真正的冷启动按 shipped 的
#   plugin/skills/cold-start/SKILL.md（/quay:cold-start）执行——那是 agent 驱动的（Monitor / CronCreate /
#   send-keys 驱动 inner）。本脚本的 --cold-start-drive 只【编排 shipped 的脚本】（loop-driver 注册 +
#   send-keys-reliable.sh 驱动 + task-start 遥测），绝不复制 cold-start 的实现。
#   典型流程：先跑本脚本（①②③，③报 not-live 基线）→ 按 cold-start skill 起双层 →
#   重跑本脚本 --verify-only --require-live 确认 COLDSTART_LIVE=yes。
#   判据能取假：冷启动没做/没活 ⇒ AC88_VERIFY=not-live（非恒绿）。
#
# 运行形态：本脚本在【目标宿主上】运行（B/C 机 local 模式）；跨主机驱动由 develop-deliver-tgz.sh
#   --verify-coldstart 承担：scp 本脚本 + 两个 .tgz 到目标机 → 远端以显式 --ac89 <远端临时路径>
#   执行（--build-sha/--build-date/--host 由驱动方传入）→ scp 该证据文件回本地 → 追加进驱动方仓库
#   .quay/productization-verification.jsonl（按 (ts,ac,host,project_root) 去重；远端无证据 ⇒
#   NOT-EVALUATED + 非零退出，硬规则 3b）。
#
# 产物 (AC5，可机械核对 + 达成条件 = 该 build 的 commit sha 新于 2026-08-16 阶段切换)：
#   1) stdout 可解析字段（STEP1_OK / STEP2_OK / L1_* / L2_* / COLDSTART_LIVE / AC5_OK / AC88_VERIFY）
#   2) 证据 JSON（--evidence <path>，默认 <cwd>/.quay/verify-deliver-evidence.json，含 ts）
#   3) AC89 记录（--ac89 <path>，默认 <cwd>/.quay/productization-verification.jsonl）追加一行
#      {"ts","ac":"AC88","ok","artifact","evidence","detail","host"?,stepInstall,stepInit,stepColdstart}
#      （同 per-task-suite-records 形态；--host <B|C> 把跨主机机器名写进 host 字段——AC89 AC4 B/C 两机）
#
# 用法：
#   bash plugin/scripts/verify-deliver-coldstart.sh \
#       --tgz quay-0.4.0.tgz --tgz-native quay-native-0.3.13.tgz \
#       [--build-sha <sha>] [--build-date <ISO>] \
#       [--prefix <dir>] [--project <name>] [--root <dir>] [--worktree-root <dir>] \
#       [--test-command <cmd>] [--tmux-session <sess>] \
#       [--wait <s>] [--liveness-window <min>] \
#       [--skip-cold-start-drive] [--cold-start-drive] [--verify-only] [--require-live] \
#       [--evidence <path>] [--ac89 <path>] [--host <B|C>] [--spec <path>] [--channel npm-global|marketplace] [--ac205-session] [--ac207-e2e] [--ac239-e2e] [--ac247-takeover --takeover-root <dir>] [--ac248-adr-flip --target-root <dir>] [--ac249-complete-change --target-root <dir> --task-id <id>] [--selfcheck] [--help] \
#       [--target-launcher <l>] [--target-model <m>] [--target-auth <a>] [--driving-profiles <p>]
#
#   --build-root <repo> 该次验证【自己】从 <repo> 的 develop-tip 现 build quay+quay-native tgz
#                       （AC5 主路径：build_sha/日期/产物 sha256 全由本脚本取，不引用外部产物），
#                       然后继续 ①②③；与 --tgz/--tgz-native 二选一。
#   --build-sha <sha>   现 build 所用 tgz 对应的 develop commit（跨主机驱动时由 build 方传入；
#                       --build-root 时自动取，无需传）。
#   --build-date <ISO>  该 commit 的提交时间（--build-root 时自动取；跨主机时由 build 方传入）。
#   --spec <path>       SPEC §6 闭集来源（L1 判据解析的 SPEC 文件）。显式给出但文件缺失 ⇒
#                       L1_NOT_EVALUATED=1（不静默回退）。缺省：--build-root <repo>/orchestration/，
#                       再退回脚本 dev-tree 相对路径。
#   --channel <c>      step① 验证哪条安装路径：npm-global（默认，向后兼容）| marketplace。
#                      marketplace 分支 = npm install -g 获得可解包内容后，跑 shipped 的
#                      register-plugin.mjs（QUAY_SKIP_PLUGIN_CLI=1）并断言 ~/.claude/settings.json
#                      落地 extraKnownMarketplaces.quay → 已安装路径、enabledPlugins 无用户级 quay 键
#                      （AC-161/162 契约的跨主机版本，SPEC §6b 约束③ 两条安装路径都能解析到）。
#                      两条通道的段① 都【对操作者真实 ~/.claude 零写入】：隔离 HOME（${PREFIX}.home）
#                      + QUAY_SKIP_PLUGIN_CLI=1（postinstall 的 settings 直写与 CLI materialization 两条
#                      写路径同时关掉）；读数 STEP1_HOME_ISOLATED / STEP1_REAL_SETTINGS_UNCHANGED
#                      落在最终 summary。背景见下方 step1_guard_* 注释（gap-ac161-user-scope-enable-
#                      repolluted-by-cli-materialization：此前只堵了脚本直接写，没堵脚本调用的 CLI）。
#   --verify-only    只跑③（对已存在的 --root 重验冷启动活性；①②被调用方声明已验）。
#   --ac205-session  ⑦ 会话投递（GOAL-009-AC-205）：用安装物 dist/send-to-session.js 给同址目标会话
#                    发 probe，读目标 transcript（transcript-delivery-check.js --check）判 delivered
#                    ⇒ 写 AC-205 记录（transcript_confirmed=true）。opt-in：需同址 live 目标会话。
#   --require-live   ③ 若 COLDSTART_LIVE != yes 则 exit 1（严格验证——冷启动确认跑用）。
#   --selfcheck      全 hermetically 自检（AC2 直接量正/负控制 + L1 闭集解析/未评估正负控制 + AC5 判据正/负控制 + 目标项目 profiles 配置正/负/覆盖控制 + AC161/AC3 段① 零写入正/取假控制 + AC-247 八件读数正/负控制），不碰真实安装。exit 0/1。
#   --ac207-e2e      ⑤ 端到端（GOAL-009-AC-207）：第三方项目里用 shipped CLI 建真实任务、起 *-drivers
#                    驱动到 done、读直接量写 AC-207 记录。昂贵（worker-driver spawn claude -p）——
#                    opt-in；缺任一读数不写（fail-closed）。⛔ 产品文档/skill 文案不得声称 quay 会启动会话。
#                    ⑤ 同时为【它自己的 $ROOT】补探 AC-203 的 driver 存活直接量（GOAL-009-AC-240：
#                    闭环须由同一次运行自证——step④ 那个紧接 start 的 30 秒窗口会错过真正驱动出 done
#                    的那个项目），并在最终 summary 打印运行级取值
#                    `E2E_CLOSURE_SELF_EVIDENCED=1|0|not-evaluated`（三态可区分，硬规则 3b）。
#   --ac239-e2e      （与 --upgrade-existing 同用）⑦ 的【动态】半边（GOAL-009-AC-239）：升级动作跑完
#                    并 AC238_EVALUATED=1 之后，在【同一个 project_root】上用该项目自己的 runtime 建一条
#                    **真实缺陷修复任务**（内容 = 执行者可查的真实 bug，含可机械验收的测试类 AC），起它
#                    自己的 promotion/worker drivers 驱动到 done，再读直接量写 AC-239 记录。
#                    ⛔ 与 AC-238 同 root 才写（AC-239 判据自己会再核这层关联）——另起新项目冒充「升级后」
#                    被机制挡住，而不是被文案挡住。缺任一读数不写（fail-closed，硬规则 3b）。
#                    昂贵（worker 做完整实现→fan-in，受 AC239_POLL_SECS 约束，缺省 3600s）。
#   --target-launcher/--target-model/--target-auth  配置目标项目 profiles 的 CLI 覆盖
#                    （gap-verify-coldstart-does-not-configure-target-profiles）。缺省由驱动方仓库
#                    .quay/profiles.yml 的 worker-default 派生（单一真相源，⛔ 不写第二份字面量）；
#                    --driving-profiles <p> 显式指定该来源。launcher/model 任一缺 ⇒
#                    target-profiles: not-configured（可区分取值，⛔ 不静默跳过，硬规则 3b）。
#   --ac247-takeover  ⑧ AC-247（GOAL-016）：当前 build 干净接管一个【停摆 ≥14 天】的存量 quay 项目。
#                    与 ② 的「rm -rf 后全新 quay-init」是两条本质不同的路径。顺序固定：读 pre 三件
#                    （task 数 / HEAD 时刻 / status 载体）→ 段① 的隔离前缀安装已完成 → 用目标项目自己的
#                    root 起 promotion driver → 读 `driver status --json` → 重读 task 数 → 八件读数
#                    全部有效才写 ac=GOAL-016-AC-247 记录。任缺 ⇒ ⛔ 不写记录 + 可区分 NOT-EVALUATED
#                    + 退出非 0（缺值≠合格；⛔ 不写 driver_alive=0 的记录）。liveness 一律读载体
#                    （`quay driver status --json`），⛔ 不从 `driver start` 的退出码或 ps 进程表派生。
#   --takeover-root <path>  被接管项目根（目标机上的绝对路径；须已存在 .quay/config.yml，⛔ 非本仓库）。
#   --ac248-adr-flip  ⑨ AC-248（GOAL-016）：把【目标项目自己的】ADR 检查器在一个真实实现的
#                    parent 修订与实现修订上的**检出行为**读成一对读数（before / after），
#                    翻转方向必须是 false → true。⛔ 检查器的判定不由 quay 拥有：两个读数都由
#                    【目标项目自己的】checker 产生（其命令原文 = 该项目 package.json 的 check:adr），
#                    quay 只搬运读数（⛔ 不在 quay 侧写任何「等价」的 ADR 判定——那会变成自己给自己打分）。
#                    两次运行只差【修复本身】：两个修订都用 `git archive` 物化到独立临时路径再跑，
#                    ⛔ 不改活树、不靠 stash 往返。任一件读不出 ⇒ ⛔ 不写记录 + 可区分
#                    NOT-EVALUATED + 退出非 0（未测量 ≠ 不合格；⛔ 不写 adr_check_after_detects=false）。
#   --ac249-complete-change  ⑨b AC-249（GOAL-016）：量「被驱动的【那一个】任务有没有做【成套】修改」——
#                    代码修复（`src/`|`scripts/`）与 ADR-007 文档同步（路径含 `ADR-007` 或以 `docs/adr`
#                    开头）必须【同时】非空，单边不算。判据读的唯一字段是 `commit_files`，其值必须是
#                    **同一 task_id 名下全部提交的文件并集**（按【位置】归属，⛔ 不按提交信息文本），
#                    ⛔ 不是「最新一条实现提交」——既有 `ac207_select_implementation_commit` 返回单条，
#                    一个把代码与文档拆成两个提交的【完全合格】任务在它下面必然只看到一半 ⇒ 两个方向
#                    都恒假（硬规则 4c：判据点名的量到不了验收那一刻）。任一侧为空 ⇒ ⛔ 零记录 +
#                    可区分 `AC249-INCOMPLETE-CHANGE` + 退出非 0；并集读不出 ⇒ ⛔ 零记录 + `NOT-EVALUATED`
#                    （未测量 ≠ 不合格，硬规则 3b）。
#                    与 AC-248 共用 `--target-root` / `--task-id`：两条绑在【同一次驱动产出】上，
#                    是同一个被驱动任务的两条读数（各自能独立 pass/fail，⛔ 不互相冒充）。
#   --target-root <path>  被取证项目根（目标机上的绝对路径；须已存在 .quay/config.yml，⛔ 非本仓库）。
#                         AC-248 / AC-249 共用（两条量的是同一个被驱动任务）。
#   --ac250-web-observe  ⑩ AC-250（GOAL-016，观察面）：量「目标项目的 web 是否真反映进展」。三步读数，
#                    缺一不可（GOAL-016 风险 3：「serve 起来 / 端口在听 / HTTP 200」与「有个 web 活着」同形）：
#                    ① bind_host ← 目标机 `ss -ltnp` 上该端口的【真实监听地址】且 == 该机 tailscale0 的真实
#                    地址（推导，⛔ 不硬编码）；② probe_from_host = 判读侧（本机）hostname，探测/解析/组装
#                    全在判读侧完成 ⇒ 跨机可达是结构性质；③ 同一 observed_task_id 在两个时刻的页面渲染
#                    状态【互不相等】且与直接读 store 的值一致（⛔ 不判单点渲染）。任一件读不出 ⇒ ⛔ 不写
#                    记录 + 可区分 NOT-EVALUATED + 退出非 0；窗口内状态【未变化】是另一个取值 no-change
#                    （⛔ 不与「没测成」同形，也⛔ 都不写成合格记录）。
#                    ⚠️ 本模式【不跑 step①】：它观测的是【目标机上已安装的】产物，而 step① 装的是判读侧
#                    的前缀 —— 与「目标机上那个 web 绑了什么地址」无关。产物身份经 quay_path/quay_sha256
#                    留档（非判据字段），可独立复算。
#   --ac250-ssh <dest>       目标机 ssh 目的地（BatchMode；须与判读侧是【两台机器】，否则 not-evaluated）
#   --ac250-root <dir>       目标机上的目标项目根（cwd=它，使 serve 解析该项目的 .quay/config.yml）
#   --ac250-task <id>        被观察的 task id（两点读数必须同一 id —— ⛔ 不取「最新一条」）
#   --ac250-quay <path>      目标机上 quay CLI 入口（缺省 = <root>/.quay/runtime/bin/quay.js）
#   --ac250-node <path>      目标机上 node 解释器（缺省 = 目标机 PATH 上的 node；须能跑起上面那份 quay）
#   --ac250-port <p>         目标机上 serve 绑的端口（缺省 4173）
#   --ac250-window <s>       观察窗口秒数（缺省 600；窗口内无变化 ⇒ no-change，⛔ 不写记录）
#   --help           用法在前、退出 0、无副作用（gap-scripts-sprawl 约定）。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 默认值 ─────────────────────────────────────────────────────────────────────────────
QUAY_TGZ=""
QN_TGZ=""
PREFIX=""
PROJECT="verify-coldstart"
ROOT=""
WORKTREE_ROOT=""
TEST_CMD=""
TMUX_SESSION=""
TMUX_SESSION_EXPLICIT=0       # --tmux-session 显式传入（区分默认 `${PROJECT}-0:0.0` 猜测 vs 用户指定）
WAIT=30
LIVENESS_WINDOW=30          # 分钟；与 dead-loop-check.sh 默认窗口同量级（周期锚点 20 分钟）
COLD_START_DRIVE=0          # 默认不驱动（冷启动是 agent 驱动的 skill；本脚本默认只验证）
REQUIRE_LIVE=0
VERIFY_ONLY=0
DO_SELFCHECK=0
EVIDENCE=""
AC89=""
HOST=""                      # AC89 记录的主机字段（B|C，跨主机验证时由驱动方传入）
SPEC_PATH=""                 # SPEC §6 闭集来源（--spec <path> 显式；缺省由 --build-root/dev-tree 推导）
CHANNEL="npm-global"         # step① 验证哪条安装路径：npm-global（默认）| marketplace（SPEC §6b 约束③）
CWD="$(pwd)"
VC_NODE="${VC_NODE:-node}"                    # 启动弹窗探针的 node 接缝（测试可覆盖）
VC_TMUX_SOCKET="${VC_TMUX_SOCKET:-}"          # 启动弹窗探针的 tmux 套接字覆盖（测试可覆盖）

# ── AC5 锚（人 2026-08-16 裁定：达成 = 该 build 的 commit sha 新于本次阶段切换 2026-08-16）──
# 判据只锚定事后仍可核的对象：commit sha / 内容 sha256 / ISO 提交时间 —— 不引用 worktree 产物路径。
AC5_MIN_BUILD_DATE="2026-08-16T00:00:00Z"   # 阶段切换日（AC85-89 产品化 build 阶段）；>= 该时刻 = 达成
BUILD_ROOT=""                               # 给出时：本脚本自己从 <repo> develop-tip 现 build
BUILD_SHA=""                                # tgz 对应的 develop commit（--build-root 时自动取）
BUILD_DATE=""                               # 该 commit 的提交时间 ISO（--build-root 时自动取）
SHA256_QUAY=""                              # quay tgz 的内容 sha256（机制内计算，不引用外部产物）
SHA256_QN=""
AC5_EVALUATED=0                             # 1 = AC5 判据有输入可判；0 = 缺输入（无法评估 ≠ 通过）
AC5_OK=0
AC201_WRITTEN=0                             # 1 = append_ac201_record 写了一条 ac=GOAL-009-AC-201 记录

# ── AC-203（GOAL-009）：driver 在无 plugin/ 的第三方项目里真活 ───────────────────────────
# 判据读载体（driver_alive / carrier_records），⛔ 不读 start 退出码（今天 start 就 exit 0 而系统是死的）。
# 记录字段：host（目标宿主 hostname；criterion 要求 host≠本机）· project_root（第三方项目绝对路径；
# ∉ 本仓库）· has_plugin_dir=false（AC168 后第三方项目本就不该有 plugin/）· driver_alive=1 ·
# carrier_records>0。缺任一有效读数不写（硬规则 3b：缺值 ≠ 合格）。
AC203_HOST=""                                # 目标宿主 hostname（跨主机验证时 = B/C 机 hostname）
AC203_PROJECT_ROOT=""                        # 第三方项目绝对路径
AC203_HAS_PLUGIN_DIR=1                       # 1 = 项目根有 plugin/（安装拷贝残留）；0 = 无（AC168 应达成）
AC203_DRIVER_ALIVE=0                         # 读自 status 载体
AC203_CARRIER_RECORDS=-1                     # -1 = 未读（缺值 ≠ 合格）
AC203_EVALUATED=0                            # 1 = status 载体读成（driver_alive + carrier_records 都读出）
# ── AC-240（GOAL-009）：闭环须由【同一次运行】自证——本运行自己写了哪条、写给谁 ────────────────
# ⛔ 取值只来自【本次运行自己写的记录】（下面的 *_WRITTEN_THIS_RUN flag），⛔ 不回读载体反推——
# 反推会把「别次运行写的」当成「本次运行写的」，而那正是 AC-240 origin 的形态（AC-203 与 AC-207
# 各自成立，但 project_root 互不相交）。
AC203_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-203（step④ 或 step⑤ 任一处）
AC203_WRITTEN_ROOT=""                        # 写出时的 project_root（配对判据比它，⛔ 不是「非空即可」）
AC207_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-207
AC207_WRITTEN_ROOT=""                        # 写出时的 project_root
E2E_CLOSURE_SELF_EVIDENCED="not-evaluated"   # 1 | 0 | not-evaluated（三态可区分，硬规则 3b）
E2E_CLOSURE_NOTE=""                          # 该取值的理由（0/not-evaluated 时非空）

# ── AC-204（GOAL-009）：quay-init 禁复制面（mcp/commands/hooks）补全 + 成对落账 ────────────
# 判据读 FORBIDDEN_PREFIXES（quay-init-closure-assertion.ts）要求含 .mcp.json/.claude/commands//
# .claude/hooks/ 三项，并要求载体存在 ac=GOAL-009-AC-204 记录（host≠本机 ∧ project_root∉本仓库 ∧
# forbidden_count=0 ∧ enable_declared=true）。「禁列为空」单独成立可被「什么都不铺」满足 ⇒ 必须与
# 「启用声明存在」（enabledPlugins 非空 ∧ permissions.allow 含 mcp__plugin_quay_quay__*）成对判定。
AC204_HOST=""                                # 目标宿主 hostname（criterion 要求 host≠本机）
AC204_PROJECT_ROOT=""                        # 第三方项目绝对路径（criterion 要求 ∉ 本仓库）
AC204_FORBIDDEN_COUNT=-1                     # 枚举 $ROOT 落地路径算出的 forbidden 拷贝数（-1 = 未读）
AC204_ENABLE_DECLARED=""                     # 读 $ROOT/.claude/settings.json 判的启用声明（0/1；空 = 未读）
AC204_EVALUATED=0                            # 1 = forbidden_count + enable_declared 都读成

# ── AC-205（GOAL-009）：会话投递通道——安装物 dist/send-to-session.js 真投 + transcript 外部可核 ──
# 判据读载体（host/shipped_from_installed_artifact/transcript_confirmed）。⛔ 不采信发送方自述
# （硬规则 4b + AC-205 正文）：send-to-session 走 Unix socket 返回 0 字节、无 ack，退出码 0 不代表
# 对方真收到。transcript_confirmed 必须由读目标会话 transcript 得出（transcript-delivery-check.ts
# --check —— 单一定义源，⛔ 不手搓 grep，硬规则①）。shipped_from_installed_artifact=true 表示所用
# send-to-session 出自安装物 dist（$(npm root -g)/quay/plugin/scripts/dist/），非 dev 树。
AC205_HOST=""                                # 目标宿主 hostname（criterion 要求 host≠本机）
AC205_SHIPPED_FROM_INSTALLED_ARTIFACT=0      # 1 = 所用 send-to-session 出自安装物 dist
AC205_TRANSCRIPT_CONFIRMED=0                 # 1 = transcript-delivery-check 判 delivered（读 transcript）
AC205_EVALUATED=0                            # 1 = send 已发 + transcript 已读
AC205_SESSION=0                              # 1 = --ac205-session 触发（需同址目标会话，opt-in）

# ── 目标项目 profiles 配置（gap-verify-coldstart-does-not-configure-target-profiles）────────
# verify-deliver-coldstart 要证明「目标项目自己的 drivers 能驱动真实提交」，就必须先把目标项目配置到
# 在该宿主上真的能起 worker 的状态——否则它测的是「宿主碰巧有没有可用的裸 claude 凭据」（实证
# 2026-09-10 orangevps：全新 quay-init 项目 shipped worker-default launcher=claude/model=null ⇒
# 模型名落到宿主全局 claude 配置的 deepseek-v4-pro（无后缀）⇒ 400 fallback 组缺失 ⇒ worker 秒死）。
# 单一真相源 = 驱动方仓库自己的 .quay/profiles.yml worker-default（⛔ 不在本脚本写第二份字面量，
# 硬规则 4c）；可选 CLI 覆盖 --target-launcher/--target-model/--target-auth。launcher 或 model 任一缺
# ⇒ TARGET_PROFILES_STATUS=not-configured（可区分取值，⛔ 不静默跳过——硬规则 3b「没配」≠「配好了」）。
TARGET_LAUNCHER=""                          # --target-launcher 覆盖（缺省由驱动方 profiles 派生）
TARGET_MODEL=""                             # --target-model 覆盖
TARGET_AUTH=""                              # --target-auth 覆盖
DRIVING_PROFILES=""                         # --driving-profiles 显式路径；缺省由 --build-root/dev-tree 推导
TARGET_PROFILES_STATUS="not-configured"     # configured | not-configured（缺输入 ≠ 配置好了）
TARGET_PROFILES_LAUNCHER=""                 # 实际写入目标项目的 launcher（证据/AC3 可核）
TARGET_PROFILES_MODEL=""                    # 实际写入目标项目的 model
TARGET_PROFILES_AUTH=""                     # 实际写入目标项目的 auth

# ── AC-207（GOAL-009）：端到端——第三方项目自己的 *-drivers 驱动出真实开发提交且任务翻 done ──────
# 判据读载体（host/project_root/commit_sha/commit_files/task_id/task_status/gate_events/
# produced_by_driver），⛔ 不采信驱动方自述（硬规则 4b）：commit_sha 取第三方项目 git 历史的【实现
# 提交】（经共享裸仓库镜像可核）、commit_files 是该提交触及的文件（criterion 按位置判「非记账」——
# gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit）、gate_events 取
# .quay/gate-events.jsonl 计数、task_status 取目标项目 task store。produced_by_driver
# 最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，不能完全排除
# 人在会话手敲——该半判据属人裁定口证，不冒充测量（AC-207 正文逐字）。⛔ 产品/夹具边界：允许
# claude --bg / -p 作验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话。
AC207_HOST=""
AC207_PROJECT_ROOT=""
AC207_COMMIT_SHA=""
AC207_COMMIT_FILES_JSON=""                  # 实现提交触及的文件列表（JSON 数组；criterion 按位置判定，非空非全记账）
AC207_TASK_ID=""
AC207_TASK_STATUS=""
AC207_GATE_EVENTS=-1
AC207_PRODUCED_BY_DRIVER=0
AC207_EVALUATED=0
AC207_E2E=0                                  # 1 = --ac207-e2e 触发端到端段（昂贵，opt-in）
AC207_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-207（见 AC-240 块）
AC207_WRITTEN_ROOT=""                        # 写出时的 project_root（AC-240 配对判据比它）

# ── AC-238（GOAL-009）：【既有旧痕迹第三方项目】的升级路径（gap-aged-third-party-project-quay-upgrade-verification）
# 与 ② 的区别是本质的：② 的 $ROOT 是 `rm -rf` 后新建的一次性靶子（全新 quay-init，GOAL-009 已有 9 条 AC
# 全是这个形态）；本模式的 $ROOT 是一个**已经跑过 quay-native、带真实存量数据与旧版本 vendored runtime**
# 的真实第三方项目。测四件事，全部取直接量（硬规则 4b：不用被测对象自报的量）：
#   ① 存量不丢   pre/post 的 tasks/*.md 计数与逐文件 sha256 集合（磁盘直接数，非任务板自报）
#   ② 旧 runtime 被本次真实交付物替换（.quay/runtime/bin/*.js 的 sha256 == 本次交付物 ∧ != 升级前）——
#      两个方向都要成立：只「变了」可能是别的东西改的，只「等于交付物」可能本来就是新装的
#   ③ 新 CLI 能读出旧存量（文件还在 ≠ 读得出）：fresh CLI 的 task list 计数 == pre ∧ 抽样 task view 内容一致
#   ④ build_sha 非空（可溯源到具体 develop 提交）
# ⛔ 任一读不出 ⇒ 对应字段留空/负值、AC238_EVALUATED 保持 0、记录不写（缺值≠合格，硬规则 3b/6）。
UPGRADE_EXISTING=0                           # 1 = --upgrade-existing：$ROOT 是【非空】真实第三方项目
UPGRADE_SOURCE=""                            # 非空 = 先从这个真实项目做隔离副本（⛔ 只读，不碰本体）
AC238_EVALUATED=0
AC238_PROJECT_ROOT=""
AC238_PRE_TASK_COUNT=-1
AC238_POST_TASK_COUNT=-1
AC238_RUNTIME_AGE_DAYS=""
AC238_RUNTIME_REPLACED=0
AC238_TASK_LIST_OK=0
AC238_SAMPLE_TASK=""
AC238_PRE_RUNTIME_SHA=""
AC238_FRESH_RUNTIME_SHA=""
AC238_TASKSET_STABLE=0
# 当前升级语义（裁定 c / ba960f503）多出来的三个读数：退休备份路径 / 它是否逐字等于升级前那份 /
# 项目此刻绑定到的 bundle。⛔ 它们不是诊断装饰——runtime_replaced 由它们三者合取得出，且记录里带上
# 它们才能把「旧语义升级出来的 root」与「新语义升级出来的 root」区分开（同一字段名下两代语义会让
# 读者分不清 runtime_replaced=true 指的是哪一种替换）。
AC238_RETIRED_DIR=""
AC238_RETIRED_MATCHES_PRE=0
AC238_BOUND_ENTRY=""
# 升级动作是否**携带了显式采纳决定**（`--adopt-branch-model`）。存在的唯一理由：升级动作跑完之后，
# 「这个副本的 `develop` 现在接主线了」有两种成因——①它本来就在主线上（compatible，无事发生）；
# ②它是一条不接主线的旧分叉，本轮**被采纳决定重指到主线**（旧 tip 保留为 `<branch>-pre-quay-init-<sha>`）。
# 两者在升级后的磁盘状态上同形（都是 compatible），但描述的是两件不同的事 ⇒ 记录里必须可区分，
# 否则「adopt 过的副本」会被读成「天生就正常」，而后者正是本任务反复禁止的那种冒充。
AC238_ADOPT_DECISION=0

# ── AC-239（GOAL-009）：升级【后】的闭环——已升级的旧项目自己的 *-drivers 还能不能接着干 ───────────
# 与 AC-238 的分工是刻意的、不可互掩（人 2026-09-11 裁定拆条）：AC-238 是【静态/存量】维度（数据没丢、
# CLI 读得出、runtime 被换掉）；本 AC 是【动态】维度——升级动作成功 ≠ 升级后的项目还能被驱动。
# 判据形状复用 AC-207（commit_sha / task_id / task_status=done / gate_events>0 / produced_by_driver=true），
# 但多一层**不可自证的关联**：本条的 project_root 必须是 AC-238 已经证明升级成功的【同一个】root
# （判据在 goals/AC-239-*.md 里读载体做集合判定）。⇒ 本步骤只在 AC238_EVALUATED=1 ∧ 同一 $root 上运行，
# ⛔ 绝不在没升级成功的 root 上写 AC-239 记录（那正是「另起新项目冒充升级后」的形态）。
# 被测对象不是本仓库代码，而是【升级后的那个第三方项目自己的 drivers】——而它的 runtime 在当前语义下
# 就是本次交付物（quay plugin 是 runtime 的单一交付面；project-local `.quay/runtime/` 已被 quay-init
# 退休，见 AC-238 第 ④ 步）。故 ⑦b 用交付物 CLI 配 `--root $root` 驱动，⛔ 不再走项目本地
# `.quay/runtime/bin/quay.js`（该布局此刻已不存在）。
# ⛔ 任一读不出 ⇒ 对应字段留空/负值、AC239_EVALUATED 保持 0、记录不写（缺值≠合格，硬规则 3b/6）。
AC239_E2E=0                                  # 1 = --ac239-e2e（须与 --upgrade-existing 同用）
AC239_EVALUATED=0
AC239_HOST=""
AC239_PROJECT_ROOT=""
AC239_TASK_ID=""
AC239_TASK_STATUS=""
AC239_COMMIT_SHA=""
AC239_COMMIT_FILES_JSON=""
AC239_GATE_EVENTS=-1
AC239_PRODUCED_BY_DRIVER=0
AC239_TASK_CREATED=0                         # 1 = 任务创建成功（⛔ 与「驱动到 done」分开记账，缺值可区分）
AC239_DRIVERS_STARTED=0                      # 1 = promotion+worker driver start 均返回 0
AC239_PROFILES_STATUS="not-attempted"        # configured | not-configured | not-attempted（三态，⛔ 不同形）
AC239_TOOLCHAIN_STATUS="not-attempted"       # resolved | go-absent | not-attempted —— 目标项目是 Go 项目
                                             # （① 的任务体 AC3/AC4 就是 go build/go test）⇒ worker 的
                                             # 进程 env 里必须有 go，否则本步骤以「与 driver 坏了同形」
                                             # 的长轮询超时收场（实测 2026-09-11 07:1xZ）
AC239_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-239 记录（⚠️ 必须在此声明：本脚本
                                             # set -u，未声明的变量在末尾 summary 处会 unbound 而炸掉
                                             # 整轮——实测 2026-09-11 06:0x 就是这么丢掉整次运行的证据的）
AC239_WRITTEN_ROOT=""
AC239_BASELINE_STATUS="not-attempted"        # ⑦b 的前置读数：compatible | divergent | absent | unreadable |
                                             # not-attempted。四态（+未尝试）——⛔ 不是两态：`unreadable`
                                             # 是独立取值，既不算合格也不算不合格（硬规则 3b）。成因与
                                             # 后果见 ⑦b 的 ⓪c。

# ── ⑧ AC-247（GOAL-016）：当前 build 干净接管【停摆 ≥14 天】的存量项目，且 driver 真活 ─────────────
# 判据（goals/AC-247-*.md，⛔ 本步骤不改判据文件）读载体 .quay/productization-verification.jsonl 里
# `ac=GOAL-016-AC-247` 的一条记录，要求 host≠本机 ∧ project_root realpath ∉ 驱动方仓库 ∧
# pre_task_count>0 ∧ post_task_count==pre ∧ stale_days≥14 ∧ build_sha 非空 ∧ driver_alive==1 ∧
# carrier_records>0。缺任一 ⇒ 不写记录（缺值 ≠ 合格，硬规则 3b/6）。
#
# 与 GOAL-009 四条近亲步骤（AC-203/207/238/239）的分工是【字段】层面的：那四条各自产出的字段集都
# 不含 stale_days / pre_task_count / post_task_count 三个量（实测：这三个字段名在整个 carrier 的历史
# 记录里一次都没出现过），也没有一条针对「停摆 ≥14 天的存量项目做从零安装 + 接管」。
#
# ⚠️ 三个量各自的【直接量】来源（硬规则 4b：⛔ 不用被测对象自报的量、⛔ 不用代理量）：
#   · stale_days      ← 目标项目 HEAD 的 git 提交时刻（git 对象，外部可核），到【接管动作之前】那一刻
#                       为止的天数。⛔ 必须在起 driver 之前取：任何接管动作都会让「距今」变成 ~0。
#                       这也正是「⛔ 非当天现造」能取假的地方——当天 quay-init 出来的项目结构上过不了。
#   · pre/post_task_count ← 目标项目【自己的 task store】条目数，同一实现读两次（接管前 / driver 起来后）。
#                       读数走交付物 CLI 的 `task list --json`（经项目自己的 config/provider），数 JSON
#                       数组长度——⛔ 不数 `<root>/tasks/*.md`：那是【路径猜测】，而 tasks_dir 是项目
#                       config 里的可配置项（ad-arm1 的 archguard 实测就把它写成一条绝对路径）。
#                       读不出 ⇒ 空 + 非 0，调用方据此走 NOT-EVALUATED（⛔ 不写 0 —— 那会把
#                       「没查成」伪装成「查过且不合格」，硬规则 3b 的镜像半边）。
#   · driver_alive / carrier_records ← `quay driver status --kind promotion --root <root> --json`，
#                       经既有唯一解析器 probe_ac203_driver_status（⛔ 不从 `driver start` 的退出码派生：
#                       GOAL-009 AC-203 已实证 start 今天就会打印 exit=0 而系统是死的）。
# pstale/ps 读数（AC247_PS_STALE_PROCS）是【诊断量】：它存在的唯一理由是留档「进程表读数」与
# 「status 读数」在同一时刻的【分歧】（AC4），⛔ 任何判据字段都不得由它派生（硬规则 4b 的反面教材）。
AC247_TAKEOVER=0                             # 1 = --ac247-takeover 触发（opt-in）
AC247_ROOT=""                                # --takeover-root：被接管项目根（目标机上，⛔ 非本仓库）
AC247_HOST=""                                # 目标机 hostname（目标机读，⛔ 不由驱动方传入）
AC247_PROJECT_ROOT=""                        # 被接管项目根的 realpath（目标机读）
AC247_PRE_TASK_COUNT=""                      # 接管【前】的 task store 条目数（空 = 未读成）
AC247_POST_TASK_COUNT=""                     # driver 起来后重读（同一实现）
AC247_STALE_DAYS=""                          # HEAD 提交时刻 → 接管前那一刻，天数（3 位小数）
AC247_HEAD_EPOCH=""                          # HEAD 提交时刻（epoch，上面那个量的产生处，一并留档）
AC247_PRE_TS_EPOCH=""                        # 「接管前那一刻」（epoch）
AC247_DRIVER_ALIVE=0                         # ← probe_ac203_driver_status，⛔ 非 start 退出码
AC247_CARRIER_RECORDS=-1                     # ← 同一 status JSON；-1 = 未读（缺值 ≠ 合格）
AC247_CARRIER_RECORDS_PRE=-1                 # 接管前的同一读数（差值 = 本次 driver 真的写了载体）
AC247_LAST_RECORD_TS=""                      # status JSON 的 last_record_ts（留档：⛔ 只报计数分不清「在长」与「停更」）
AC247_PS_STALE_PROCS=-1                      # ps 代理量（⛔ 诊断用，不参与任何判定）
AC247_DRIVER_START_RC=""                     # `driver start` 退出码（⛔ 诊断用，只用于决定轮询窗宽）
AC247_USER_INSTALL_PRE="not-evaluated"       # 接管前目标机的 user-scope 安装读数：absent|present|not-evaluated
AC247_EVALUATED=0                            # 1 = 八件读数全成立并已写出记录
AC247_POLL_SECS="${AC247_POLL_SECS:-120}"    # 轮询 driver 写首条载体记录的窗宽（秒）
AC247_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-247 记录
AC247_WRITTEN_ROOT=""                        # 写出时的 project_root

# ── ⑨ AC-248（GOAL-016）：目标项目自己的 ADR 检查器的检出行为必须前后翻转 ──────────────────────
# ⚠️ 八个字段的来源（硬规则 4b：全部在【目标机】上读，且由【目标项目自己的】检查器产生）：
#   · adr_check_before_detects / adr_check_after_detects ← 同一个检查器在【两个修订】上的两次真实运行：
#       before 在【实现提交的 parent】上跑，after 在【实现提交自己】上跑。两个修订都用 `git archive`
#       物化到独立临时路径（⛔ 不改活树、⛔ 不 stash 往返）⇒ 两次运行的输入形态只差【修复本身】。
#       「检出」= 该工具名是否进入检查器的**候选集**（它自己 scan 出来的 MCP 工具名集合）——这正是
#       缺陷的形态：漏检的工具名从不进候选集 ⇒ 检查器输出 ADR-007: OK 与合格同形（硬规则 3b）。
#       ⛔ 不读单次退出码：那个量今天就已经是绿的，零信息。
#   · adr_check_probe_tool ← **差分本身**推出的工具名：after 的候选集 ∖ before 的候选集 里取一个。
#       读不出（差集为空 = 修复没有让任何工具新进入候选集）⇒ ⛔ 不写记录。
#   · 其余八件（host / project_root / commit_sha / commit_files / task_id / task_status / gate_events /
#       produced_by_driver）与 AC-207 同源同读法（复用 ac207_* 通用辅助与同一组直接量）。
# ⛔ quay 侧【不】实现任何等价的 ADR 判定：候选集与运行输出都由目标项目自己的检查器产生。
AC248_ADR_FLIP=0                             # 1 = --ac248-adr-flip 触发（opt-in）
AC248_ROOT=""                                # --target-root：被取证项目根（目标机上，⛔ 非本仓库）
AC248_HOST=""
AC248_PROJECT_ROOT=""
AC248_TASK_ID=""
AC248_COMMIT_SHA=""
AC248_COMMIT_FILES_JSON=""
AC248_TASK_STATUS=""
AC248_GATE_EVENTS=-1
AC248_PRODUCED_BY_DRIVER=0
AC248_PRE_REV=""                             # 修复前修订（实现提交的 parent；⛔ 非字面量）
AC248_PROBE_TOOL=""                          # 差分推出的工具名（候选集之差）
AC248_BEFORE_DETECTS=""                      # "false"/"true"/""（空 = 未读出）
AC248_AFTER_DETECTS=""
AC248_BEFORE_TOOLS_JSON=""                   # before 修订上的完整候选集（原始读数留档）
AC248_AFTER_TOOLS_JSON=""                    # after 修订上的完整候选集
AC248_BEFORE_CLI=""                          # before 修订上检查器 CLI 的 stdout+stderr 原文
AC248_AFTER_CLI=""                           # after 修订上检查器 CLI 的 stdout+stderr 原文
AC248_CLI_SOURCE=""                          # 上面两条读数用的命令形态（目标项目 package.json 的 check:adr 脚本体）
AC248_BEFORE_CLI_RC=""                       # 两次检查器运行的退出码（⛔ 诊断留档量，不是判据字段）
AC248_AFTER_CLI_RC=""
AC248_TASK_ID_ARG=""                         # --task-id：被取证任务（⛔ 不猜、不取最新一条）
AC248_PRE_REV_ARG=""                         # --pre-rev：落档的 pre-head（默认由记账边界推出，⛔ 不是 <impl>^）
AC248_EVALUATED=0                            # 1 = 全部读数成立并已写出记录
AC248_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-248 记录
AC248_WRITTEN_ROOT=""

# ── ⑨b AC-249（GOAL-016）：同一任务的改动必须【成套】—— 代码面与 ADR-007 文档面同时非空 ──────────
# ⚠️ 与 AC-248 的区别（两条不能互相冒充，各自的读数各写各的记录）：
#   AC-248 判「修对了」（目标项目自己的检查器从看不见变看见一个工具）；AC-249 判「修全了」
#   （同一 task 名下 commit_files 并集里，代码路径与 ADR-007 文档路径**同时**存在）。
#   ⇒ 一个只改 `src/` 的完美修复满足 AC-248、⛔ 不满足 AC-249。
# 唯一的判据字段是 `commit_files`（criterion 只读它），其值 = 同一 task_id 名下【全部提交的文件并集】。
# ⛔ 不复用 AC248_* 变量，否则两条 AC 无法分别 pass/fail。
AC249_COMPLETE_CHANGE=0                      # 1 = --ac249-complete-change 触发（opt-in）
AC249_HOST=""
AC249_PROJECT_ROOT=""
AC249_TASK_ID=""
AC249_COMMIT_FILES_JSON=""                   # 并集（JSON 数组，仓库相对路径原样）
AC249_UNION_SHAS=""                          # 并集用到的提交（空格分隔；留档：可独立复算）
AC249_CODE_HITS=""                           # 代码面命中（`src/`|`scripts/` 前缀）——判据的一侧
AC249_DOC_HITS=""                            # 文档面命中（含 ADR-007 | `docs/adr` 前缀）——判据的另一侧
AC249_OUTCOME=""                             # ok | incomplete-change:<side> | not-evaluated:<why>（三态可区分）
AC249_EVALUATED=0                            # 1 = 并集读出且两侧谓词都成立并已写出记录
AC249_WRITTEN_THIS_RUN=0                     # 1 = 本次运行写出了 AC-249 记录
AC249_WRITTEN_ROOT=""
AC249_SPAN_STATE=""                          # D 来源的区间状态（留档：span/too-long/not-an-ancestor/unreadable）

# ── ⑩ AC-250（GOAL-016 观察面）：CLI 旋钮 ──────────────────────────────────────────────────
# ⚠️ 这些【必须】在参数解析【之前】声明：解析循环上面写的是 `VAR=1`/`VAR="$2"`，而本文件的
# 声明块若排在解析之后，就会把解析出来的值【覆盖回默认值】——2026-09-12 实测踩过一次：
# `--ac250-web-observe` 被解析成 1，随后被后面的 `AC250_WEB_OBSERVE=0` 覆盖回 0 ⇒ 脚本静默落进
# 主流程、报了一句与本模式无关的 `--tgz required` 并以 exit 2 结束（「参数不生效」与「参数没传」
# 在输出上同形）。AC247_*/AC248_* 都在这一区，本条同规矩。
AC250_WEB_OBSERVE=0                          # 1 = --ac250-web-observe 触发（opt-in 模式）
AC250_SSH=""                                 # --ac250-ssh：目标机 ssh 目的地
AC250_ROOT=""                                # --ac250-root：目标机上的目标项目根
AC250_TASK_ID_ARG=""                         # --ac250-task：被观察的 task id（两点读数必须同一 id）
AC250_QUAY_ARG=""                            # --ac250-quay：目标机 quay CLI 入口（缺省 = 从目标机推导）
AC250_NODE_ARG=""                            # --ac250-node：目标机 node 解释器（缺省 = 目标机 PATH 上的 node）
AC250_PORT="${AC250_PORT_OVERRIDE:-4173}"    # --ac250-port
AC250_WINDOW=600                             # --ac250-window：观察窗口秒数
AC250_POLL_INTERVAL=5                        # 轮询间隔（秒）
AC250_SSH_TIMEOUT=10                         # 单次 ssh 连接超时（秒）

while [ $# -gt 0 ]; do
  case "$1" in
    --tgz) QUAY_TGZ="$2"; shift 2 ;;
    --tgz-native) QN_TGZ="$2"; shift 2 ;;
    --build-root) BUILD_ROOT="$2"; shift 2 ;;
    --build-sha) BUILD_SHA="$2"; shift 2 ;;
    --build-date) BUILD_DATE="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    --worktree-root) WORKTREE_ROOT="$2"; shift 2 ;;
    --test-command) TEST_CMD="$2"; shift 2 ;;
    --tmux-session) TMUX_SESSION="$2"; TMUX_SESSION_EXPLICIT=1; shift 2 ;;
    --wait) WAIT="$2"; shift 2 ;;
    --liveness-window) LIVENESS_WINDOW="$2"; shift 2 ;;
    --skip-cold-start-drive) COLD_START_DRIVE=0; shift ;;
    --cold-start-drive) COLD_START_DRIVE=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --require-live) REQUIRE_LIVE=1; shift ;;
    --evidence) EVIDENCE="$2"; shift 2 ;;
    --ac89) AC89="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --spec) SPEC_PATH="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --ac207-e2e) AC207_E2E=1; shift ;;
    --ac239-e2e) AC239_E2E=1; shift ;;
    --ac205-session) AC205_SESSION=1; shift ;;
    --target-launcher) TARGET_LAUNCHER="$2"; shift 2 ;;
    --target-model) TARGET_MODEL="$2"; shift 2 ;;
    --target-auth) TARGET_AUTH="$2"; shift 2 ;;
    --driving-profiles) DRIVING_PROFILES="$2"; shift 2 ;;
    --upgrade-existing) UPGRADE_EXISTING=1; shift ;;
    --upgrade-source) UPGRADE_SOURCE="$2"; shift 2 ;;
    --ac247-takeover) AC247_TAKEOVER=1; shift ;;
    --takeover-root) AC247_ROOT="$2"; shift 2 ;;
    --ac248-adr-flip) AC248_ADR_FLIP=1; shift ;;
    # --target-root / --task-id 是 AC-248 与 AC-249【共用】的两个入参：两条量的是同一个被驱动任务
    # （AC-249 正文逐字：两条绑在同一次驱动产出上）。⛔ 不给 AC-249 再开一份同义旋钮——那会让「同一个
    # task_id」变成调用方可以拧出分歧的两个旋钮（硬规则 3b 的同族：看起来覆盖了，实际可以不同）。
    --target-root) AC248_ROOT="$2"; shift 2 ;;
    --task-id) AC248_TASK_ID_ARG="$2"; shift 2 ;;
    --pre-rev) AC248_PRE_REV_ARG="$2"; shift 2 ;;
    --ac249-complete-change) AC249_COMPLETE_CHANGE=1; shift ;;
    --ac250-web-observe) AC250_WEB_OBSERVE=1; shift ;;
    --ac250-ssh) AC250_SSH="$2"; shift 2 ;;
    --ac250-root) AC250_ROOT="$2"; shift 2 ;;
    --ac250-task) AC250_TASK_ID_ARG="$2"; shift 2 ;;
    --ac250-quay) AC250_QUAY_ARG="$2"; shift 2 ;;
    --ac250-node) AC250_NODE_ARG="$2"; shift 2 ;;
    --ac250-port) AC250_PORT="$2"; shift 2 ;;
    --ac250-window) AC250_WINDOW="$2"; shift 2 ;;
    --selfcheck) DO_SELFCHECK=1; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── --channel 取值校验（fail-closed：未知取值 = 用法错误，不静默当 npm-global 跑）──
case "$CHANNEL" in
  npm-global|marketplace) ;;
  *) echo "ERROR: --channel must be npm-global|marketplace (got: $CHANNEL)" >&2; exit 2 ;;
esac

# ── 直接量探测（AC2 / 硬规则 4b）────────────────────────────────────────────────────────
# 用【外部可核】的直接量判双层活性，不用层自己的心跳自报：
#   L2_GIT_COMMIT_AGE_MIN    --all 最近提交时刻距今分钟数（"-"=无提交）—— loop 产出过工作
#   L2_GIT_IS_QUAYINIT_COMMIT 该提交是否 `chore(quay-init):` 前缀（硬规则 4b：排除安装自己的 auto-commit）
#   L2_INNER_WORKTREE_COUNT  项目 worktree 里在飞 task worktree 数 —— inner 派发过任务
#   L2_LAYER_PROCESS_CWD     /proc/<pid>/cwd 解析到项目根的 claude/node 进程数 —— 两层进程活着在项目里
#   L2_STARTUP_PROMPT        outer 窗口 pane 是否卡在启动信任弹窗（permission-prompt；复用
#                             pane-state-classify.ts 的 permission-prompt 识别，经 --pane-verdict
#                             接缝——AC1「不新造」；1 = 有 pane 卡弹窗 ⇒ proc_ok 不得单独撑起，
#                             硬规则 4b，gap-verify-deliver-coldstart-l2-proc-ok-false-positive）
#   L2_DEAD_LOOP_STATE       shipped L2 判据 cold_start_state（佐证；复用不新造）
L2_GIT_COMMIT_AGE_MIN="-"
L2_GIT_IS_QUAYINIT_COMMIT=0
L2_INNER_WORKTREE_COUNT=0
L2_LAYER_PROCESS_CWD=0
L2_STARTUP_PROMPT=0
L2_DEAD_LOOP_STATE="unknown"

# L2_STARTUP_PROMPT —— 「已通过启动弹窗」直接量（gap-verify-deliver-coldstart-l2-proc-ok-false-positive）。
# /proc/<pid>/cwd 只证明「进程活着在项目里」，不证明「进程过了启动信任弹窗进入 tick 循环」——
# B/C 实测 4 个 claude 进程从 spawn 起卡在 "Quick safety check" 弹窗 6.2h，coldstart_live=yes 完全由
# proc_ok 撑起，git_recent/wt_recent 均为 0（AC107 任务体取假条件 (c)「⛔不得用『进程存在』代理量」被
# 自己的实现违反）。本探针复用 pane-state-classify.ts 的 permission-prompt 分类器
# （pane-state-classify.ts:101 PERMISSION_PROMPT_RE，特征串 Quick safety check / trust this folder /
# Enter to confirm …；pane-state-classify.ts 的 --pane-verdict 已把该弹窗归类为
# intervention=1——session-liveness.sh 已于 2026-09-03 随 gap-retire-session-liveness 删除），
# 经 --pane-verdict 接缝（同一判定源 pane-state-classify.ts 的 classifyPaneVerdict）分类 outer 窗口 pane：
#   outer 窗口 pane 分类为 permission-prompt ⇒ L2_STARTUP_PROMPT=1（进程卡在启动弹窗）。
# 捕获不到 pane（无 tmux / 会话未建 / 窗口缺失）⇒ L2_STARTUP_PROMPT=0 —— 无法观测弹窗，不据此推翻
# proc_ok；这不是恒真项（能观测到弹窗时仍会置 1），git/wt 直接量仍独立判活。
probe_startup_prompt() {
  local root="$1" sess cap verdict socket role
  L2_STARTUP_PROMPT=0
  # 会话名解析（绝不猜会话名）：
  #   显式 --tmux-session > SESSION_TMUX_SESSION env > session-liveness.env（quay-init 写入的每项目
  #   权威配置）> 默认 `${PROJECT}-0:0.0` 的会话部分（猜测，仅 full 模式兜底）。
  #   ⚠️ 默认 `${PROJECT}-0:0.0` 是猜测：quay-init --loop 写进 session-liveness.env 的才是真实会话名，
  #   B/C 验证时若默认猜测与真实会话不符，探针会盯错 pane（miss 掉弹窗）——所以非显式时优先读 env 文件。
  sess=""
  if [ "$TMUX_SESSION_EXPLICIT" = 1 ]; then sess="${TMUX_SESSION%%:*}"; fi
  if [ -z "$sess" ]; then sess="${SESSION_TMUX_SESSION:-}"; fi
  if [ -z "$sess" ] && [ -f "$root/orchestration/session-liveness.env" ]; then
    sess="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$root/orchestration/session-liveness.env" 2>/dev/null | head -1)"
  fi
  if [ -z "$sess" ]; then sess="${TMUX_SESSION%%:*}"; fi
  [ -n "$sess" ] || return 0   # 无会话名（冷启动未建拓扑）⇒ 无法观测弹窗，不推翻 proc_ok
  # tmux 控制套接字解析（VC_TMUX_SOCKET 为测试接缝；默认 socket 推导 = TMUX_TMPDIR 或 /tmp 下的 uid socket）。
  socket="${VC_TMUX_SOCKET:-}"
  if [ -z "$socket" ] && [ -n "${TMUX_TMPDIR:-}" ]; then socket="${TMUX_TMPDIR}/tmux-$(id -u)/default"; fi
  if [ -z "$socket" ]; then socket="${TMPDIR:-/tmp}/tmux-$(id -u)/default"; fi
  # outer 窗口（外层会话）——probe 只观测该窗口 pane 是否卡启动弹窗（outer 独立会话角色已退役，
  # 此处仅保留 pane 观测，不再依赖已删除的拓扑工厂脚本）。
  for role in outer; do
    cap="$(env -u TMUX tmux -S "$socket" capture-pane -p -t "$sess:$role" 2>/dev/null || true)"
    [ -n "$cap" ] || continue
    verdict="$(printf '%s\n' "$cap" | "$VC_NODE" --no-warnings --experimental-strip-types \
      "$SCRIPT_DIR/pane-state-classify.ts" --pane-verdict 2>/dev/null \
      || echo 'state=unknown busy=1 intervention=0 work_in_flight=0 region_empty=0')"
    if printf '%s' "$verdict" | grep -Eq '^intervention=1$' 2>/dev/null; then
      L2_STARTUP_PROMPT=1
      break
    fi
  done
}

probe_direct_measures() {
  local root="$1" now ct subject
  now="$(date +%s)"
  ct="$(git -C "$root" log --all -1 --format=%ct 2>/dev/null || echo 0)"
  subject="$(git -C "$root" log --all -1 --format=%s 2>/dev/null || echo '')"
  L2_GIT_COMMIT_AGE_MIN="-"
  if [ "$ct" != "0" ] && [ -n "$ct" ]; then
    L2_GIT_COMMIT_AGE_MIN=$(( (now - ct) / 60 ))
    [ "$L2_GIT_COMMIT_AGE_MIN" -lt 0 ] && L2_GIT_COMMIT_AGE_MIN=0
  fi
  case "$subject" in
    chore\(quay-init\):*) L2_GIT_IS_QUAYINIT_COMMIT=1 ;;
    *) L2_GIT_IS_QUAYINIT_COMMIT=0 ;;
  esac
  L2_INNER_WORKTREE_COUNT="$(git -C "$root" worktree list 2>/dev/null | grep -cE '/task-[a-zA-Z0-9._-]+' || true)"
  L2_LAYER_PROCESS_CWD=0
  local pid cwd bin
  # 直接扫 /proc/*/cmdline 判「可执行文件是 claude/node」——不用 pgrep -f（自匹配，instrument-failure
  # FAMILY-1 / C4），也不用按 comm 精确匹配 pgrep（node 的 comm 依宿主/Node 版本变化）。
  # cmdline 第一个元素 = 可执行路径，basename 精确匹配 —— 外部可核（内核态 /proc）。
  for proc in /proc/[0-9]*; do
    pid="${proc#/proc/}"
    [ -r "$proc/cmdline" ] || continue
    bin="$(cat "$proc/cmdline" 2>/dev/null | tr '\0' ' ' | awk '{print $1}')" || continue
    case "$(basename -- "$bin")" in
      claude|node)
        cwd="$(readlink "$proc/cwd" 2>/dev/null || true)"
        [ "$cwd" = "$root" ] && L2_LAYER_PROCESS_CWD=$((L2_LAYER_PROCESS_CWD + 1))
        ;;
    esac
  done
  # 已通过启动弹窗？(proc_ok 非充分条件化 —— 复用 pane-state-classify 的 permission-prompt 识别)
  probe_startup_prompt "$root"
  if [ -f "$root/plugin/scripts/dead-loop-check.sh" ]; then
    L2_DEAD_LOOP_STATE="$(bash "$root/plugin/scripts/dead-loop-check.sh" --check-running --root "$root" 2>/dev/null \
      | sed -n 's/^cold_start_state=//p' | head -1 || true)"
    [ -n "$L2_DEAD_LOOP_STATE" ] || L2_DEAD_LOOP_STATE="unknown"
  fi
}

# ③ 双层活性判定（L1 铺到位 && L2 直接量任一）
# L1 = SPEC §6 闭集（机器可读标记块解析，非硬编码副本——硬规则 4c）
SPEC_FILE="SPEC-plugin-lifecycle-single-bundle-2026-09-02.md"
L1_NOT_EVALUATED=0              # 1 = SPEC 标记块读不到（未评估 ≠ 合格，硬规则 3b）
L1_CLOSED_SET_COUNT=0           # 闭集条目数（解析自 SPEC 标记块）
L1_CLOSED_SET_PRESENT=0         # 项目根里存在的闭集条目数
L1_CLOSED_SET_MISSING=""        # 缺失条目（空格分隔；空 = 无缺失）
L1_CLOSED_SET=""                # 闭集成员（空格分隔；供证据/记录，逐条 ∈ SPEC §6）
L1_OK=0; L2_OK=0; COLDSTART_LIVE=no
coldstart_verdict() {
  # L1_OK 由 probe_l1 从 SPEC §6 闭集计算；此处只加「未评估 ⇒ 不合格」守卫（硬规则 3b：
  # L1_NOT_EVALUATED=1 时 L1_OK 不得取 1，即便残留旧值）。
  [ "$L1_NOT_EVALUATED" = 1 ] && L1_OK=0
  # 自包含判定：函数必须重算而非继承上次调用的旧值（selfcheck 多次调用，旧值泄漏会把
  # L2_OK=0 的判负伪装成 COLDSTART_LIVE=yes——同一函数即判定器，输出不得依赖调用历史）。
  COLDSTART_LIVE=no
  local git_recent=0 wt_recent=0 proc_ok=0
  # git 活性：近期提交 且 非 quay-init auto-commit（硬规则 4b —— 排除「没在转也成立」的量）
  if [ "$L2_GIT_COMMIT_AGE_MIN" != "-" ] && [ "$L2_GIT_COMMIT_AGE_MIN" -le "$LIVENESS_WINDOW" ] \
     && [ "$L2_GIT_IS_QUAYINIT_COMMIT" = 0 ]; then
    git_recent=1
  fi
  [ "$L2_INNER_WORKTREE_COUNT" -ge 1 ] 2>/dev/null && wt_recent=1
  # proc_ok 不再单独充分（gap-verify-deliver-coldstart-l2-proc-ok-false-positive，硬规则 4b）：
  # 进程存在(>=2)【且】已通过启动弹窗（L2_STARTUP_PROMPT=0）才算活性信号。进程刚 spawn 卡在
  # "Quick safety check" 信任弹窗时 L2_STARTUP_PROMPT=1 ⇒ proc_ok=0 —— B/C 实测 4 个 claude 进程
  # 卡弹窗 6.2h，coldstart_live 曾由 proc_ok 单独撑起（git_recent/wt_recent 均 0）。
  if [ "$L2_LAYER_PROCESS_CWD" -ge 2 ] 2>/dev/null && [ "$L2_STARTUP_PROMPT" = 0 ]; then
    proc_ok=1
  fi
  L2_OK=$(( git_recent || wt_recent || proc_ok ))
  if [ "$L1_OK" = 1 ] && [ "$L2_OK" = 1 ]; then COLDSTART_LIVE=yes; fi
}

# ── AC5 证据：验证所用 tgz 由该次验证自己从 develop-tip 现 build ─────────────────────────
# 产物锚（事后仍可核）：build commit sha + 产物 sha256 + build 提交 ISO 时间。
# 达成 = build_sha 是 40-hex 且 build_date >= AC5_MIN_BUILD_DATE 且两 tgz 的 sha256 已计算。
sha256_file() {
  local f="$1"
  if [ -f "$f" ]; then sha256sum "$f" | awk '{print $1}'; else echo ""; fi
}

# build_from_develop_tip(): 在 <repo> 的 develop-tip 建 detached worktree，现 build quay+quay-native tgz。
# 复用 develop-deliver-tgz.sh 的 build 手法（detached worktree at develop tip + node_modules symlink
# + package.sh + quay-native build-dist + npm pack）。产出 tgz 路径写入 QUAY_TGZ/QN_TGZ，
# build_sha/build_date 从 <repo> 的 develop 分支取。
# ⛔ 产物必须【拷出】detached worktree 到持久 staging（<repo>/.quay/，gitignored，非 /tmp tmpfs）——
#    worktree 在 build 后即被 remove（连同其内文件），若 tgz 只留在 worktree 路径里，
#    主流程 `[ -f "$QUAY_TGZ" ]` 必然命中「missing .tgz file」（AC107 实证 2026-08-20：
#    修复前 --build-root 模式 build OK 后即报 missing .tgz file）。
build_from_develop_tip() {
  local repo="$1" tip sha date wt stage
  tip="$(git -C "$repo" rev-parse refs/heads/develop 2>/dev/null || echo "")"
  [ -n "$tip" ] || { echo "  FAIL: cannot resolve refs/heads/develop in $repo" >&2; return 1; }
  sha="$tip"
  date="$(git -C "$repo" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  [ -n "$date" ] || date="$(git -C "$repo" log -1 --format=%cI "$sha" 2>/dev/null || echo "")"
  wt="$repo/.quay/ac88-build-${sha:0:12}"
  stage="$repo/.quay/ac88-artifacts-${sha:0:12}"
  rm -rf "$stage"; mkdir -p "$stage"
  if [ -e "$wt" ]; then git -C "$repo" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"; fi
  echo "  build: detached worktree at develop tip ${sha:0:12}"
  git -C "$repo" worktree add --detach "$wt" "$sha" >/dev/null 2>&1 || { echo "  FAIL: git worktree add" >&2; return 1; }
  ln -s "$repo/node_modules" "$wt/node_modules" 2>/dev/null || true
  local build_ok=0
  if (cd "$wt" && bash packages/quay/scripts/package.sh) >/dev/null 2>&1; then
    local qt qnt staged_q staged_qn
    qt="$(ls -1t "$wt/packages/quay/"quay-*.tgz 2>/dev/null | head -1 || true)"
    if [ -n "$qt" ] && [ -f "$qt" ]; then
      if (cd "$wt/packages/quay-native" && bash scripts/build-dist.sh && npm pack --pack-destination "$wt/packages/quay-native/") >/dev/null 2>&1; then
        qnt="$(ls -1t "$wt/packages/quay-native/"quay-native-*.tgz 2>/dev/null | head -1 || true)"
        if [ -n "$qnt" ] && [ -f "$qnt" ]; then
          staged_q="$stage/$(basename "$qt")"
          staged_qn="$stage/$(basename "$qnt")"
          if cp -f "$qt" "$staged_q" && cp -f "$qnt" "$staged_qn" && [ -f "$staged_q" ] && [ -f "$staged_qn" ]; then
            QUAY_TGZ="$staged_q"; QN_TGZ="$staged_qn"; build_ok=1
          else
            echo "  FAIL: cannot persist tgz out of worktree to $stage" >&2
          fi
        fi
      fi
    fi
  fi
  git -C "$repo" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"
  if [ "$build_ok" = 1 ]; then
    BUILD_SHA="$sha"; BUILD_DATE="$date"
    echo "  build OK: quay=$(basename "$QUAY_TGZ") quay-native=$(basename "$QN_TGZ")"
    echo "  build_sha=${BUILD_SHA} (develop tip)"
    echo "  build_date=${BUILD_DATE}"
    return 0
  fi
  echo "  FAIL: tgz build from develop-tip failed (see worktree $wt)" >&2
  return 1
}

# ac5_evaluate(): 机械判定 AC5。缺输入 ⇒ AC5_EVALUATED=0（可区分「未评估」≠「不合格」——硬规则 3b）。
ac5_evaluate() {
  SHA256_QUAY="$(sha256_file "$QUAY_TGZ")"
  SHA256_QN="$(sha256_file "$QN_TGZ")"
  AC5_EVALUATED=0; AC5_OK=0
  if [ -z "$BUILD_SHA" ] || [ -z "$BUILD_DATE" ]; then
    return 0
  fi
  AC5_EVALUATED=1
  local hex_ok=0 newer_ok=0 sha_ok=0
  printf '%s' "$BUILD_SHA" | grep -Eq '^[0-9a-f]{40}$' && hex_ok=1
  if [ -n "$BUILD_DATE" ]; then
    # ISO-8601 UTC（同形前 19 字符）可字面比较：! (build < min) ⇒ build >= min（达成 = 新于阶段切换）
    if [ ! "$(printf '%s\n' "$BUILD_DATE" | cut -c1-19)" \< "$(printf '%s\n' "$AC5_MIN_BUILD_DATE" | cut -c1-19)" ]; then newer_ok=1; fi
  fi
  if [ -n "$SHA256_QUAY" ] && [ -n "$SHA256_QN" ]; then sha_ok=1; fi
  if [ "$hex_ok" = 1 ] && [ "$newer_ok" = 1 ] && [ "$sha_ok" = 1 ]; then AC5_OK=1; fi
  # 函数始终返回 0：AC5 的判定结果是【数据】，不是控制流失败（set -e 不得因 AC5 判负中断三步机制）
  return 0
}

# ── AC-201 产物可溯源记录（gap-ac201-productization-verification-build-sha-tgz-sha256-record）──
# 在 --ac89 载体追加一条 ac="GOAL-009-AC-201" 记录，top-level 字段 {ts, ac, build_sha, tgz_sha256}
# （字段在顶层，非 detail 字符串——AC-201 criterion 只读 top-level build_sha/tgz_sha256）。
# build_sha=BUILD_SHA（来自 build_from_develop_tip 的 `git rev-parse refs/heads/develop` ⇒ 天然是
# develop 祖先，满足 criterion 的 merge-base --is-ancestor）、tgz_sha256=SHA256_QUAY。
# ⛔ 仅当 BUILD_SHA 与 SHA256_QUAY 都非空才 append——缺输入不写、不冒充合格（硬规则 3b）。
# ⛔ 不引用已归档零调用的 productization-verification-record.ts / -check.ts（AC-201 origin 明令）。
# 返回 0；AC201_WRITTEN=1 表示写了一条（selfcheck 正/负控制据此判定）。
append_ac201_record() {
  AC201_WRITTEN=0
  [ -n "${AC89:-}" ] || return 0
  [ -n "${BUILD_SHA:-}" ] && [ -n "${SHA256_QUAY:-}" ] || return 0
  mkdir -p "$(dirname "$AC89")"
  printf '{"ts":"%s","ac":"GOAL-009-AC-201","build_sha":"%s","tgz_sha256":"%s"}\n' \
    "${TS:-}" "$BUILD_SHA" "$SHA256_QUAY" >> "$AC89"
  AC201_WRITTEN=1
  return 0
}

# ── GOAL-009 载体型证据记录共享锚（gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207）──
# AC-214 新鲜度元判据（goals/AC-214-*.md）对 AC-201/203/205/207 四条载体记录读 top-level `build_sha`
# （= 本仓库 BUILD_SHA，build 时刻 develop-tip，天然 develop 祖先），只认 `build_sha`/`commit` 两个字段名。
# 此前只有 AC-201 带 top-level `build_sha`；AC-203/205 落账字段契约不含它、AC-207 只有异仓库 `commit_sha`
# （且 `git rev-list <异仓库 sha>..develop` 会 fatal）⇒ 三条各自达成并落账后，AC-214 对它们 `sha` 恒取不到
# ⇒ 恒 exit 1（与它要防的「一旦转绿即永久绿」相反的同形）。本函数是唯一 choke point：每条 GOAL-009-AC-*
# 记录统一由它补 top-level `build_sha` + `ts`，sibling tasks（AC-201/203/205/207）各自保留 AC 专属字段
# （host/driver_alive/commit_sha 等），锚字段经本函数统一。
# 入参 $1 = 该条记录除 build_sha/ts 外的 JSON 片段（以 "," 开头，如 `,"ac":"GOAL-009-AC-203","host":"B"`）。
# fail-closed（硬规则 3b）：BUILD_SHA 非 40-hex ⇒ 不写该记录且 return 非 0（缺值≠合格，也≠静默跳过）；
#   AC89 路径空 ⇒ 不写且 return 非 0。⛔ 不引用已归档零调用的 productization-verification-record.ts/-check.ts。
ac89_append_goal009() {
  local fragment="$1"
  if ! printf '%s' "${BUILD_SHA:-}" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "ac89_append_goal009: BUILD_SHA not 40-hex (got '${BUILD_SHA:-}') — GOAL-009 record NOT written (fail-closed)" >&2
    return 1
  fi
  [ -n "${AC89:-}" ] || { echo "ac89_append_goal009: AC89 path empty — GOAL-009 record NOT written (fail-closed)" >&2; return 1; }
  mkdir -p "$(dirname "$AC89")"
  printf '{"build_sha":"%s","ts":"%s"%s}\n' "$BUILD_SHA" "${TS:-}" "$fragment" >> "$AC89"
}

# ── AC-207 记账提交判定（硬规则 ② 按位置：看【触及的文件】，⛔ 不看提交信息文本）──────────────
# gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit：原实现取「最新一条非
# chore(quay-init): 提交」，而一次 e2e 里 driver/Provider ABI 的机械提交（`tasks: …` / `goals: …`）
# 恰恰是【多数】（实测 9 条里 7 条）⇒ 选中「翻 done」的记账提交，而 criterion 只查 commit_sha 非空
# ⇒ 一个零实现、只发生状态翻转的项目同样通过（硬规则 4b：代理量与它要代表的东西脱节）。
# 判定改为按位置：提交触及的文件【全部】落在 tasks/ goals/ .quay/ 之下 ⇒ 记账提交，不作为实现提交
# 证据。⇒ 把记账提交改名绕不过去（DoD 逐字禁止关键词判定），因为判的是文件不是文本。
# chore(quay-init): 例外地【不】全在记账路径下（它写 .gitignore / .claude/*），故【前缀排除照留】——
# 记账路径（case 字面量：tasks/* | goals/* | .quay/*）与机械前缀（chore(quay-init): / tasks: / goals:）
# 两条判据并行，前者是主体（绕不过），后者覆盖「不落在这三棵子树」的安装 auto-commit。

# 该提交触及的文件（每行一条，去空行）。读不出（merge 合并差分 / 非提交对象）⇒ 空输出。
ac207_commit_files() {
  git -C "$1" show --pretty=format: --name-only "$2" 2>/dev/null | sed '/^[[:space:]]*$/d'
}

# 0 = 记账提交（触及文件全在记账路径下，或一个文件都读不出）；1 = 至少一个文件在记账路径之外。
ac207_is_bookkeeping_commit() {
  local root="$1" sha="$2" f found=0 files
  files="$(ac207_commit_files "$root" "$sha" || true)"
  [ -n "$files" ] || return 0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    found=1
    case "$f" in
      tasks/*|goals/*|.quay/*) ;;
      *) return 1 ;;
    esac
  done <<EOF
$files
EOF
  [ "$found" = "1" ] || return 0
  return 0
}

# 文件列表 → JSON 数组（node 收 argv，⛔ 不拼字符串——空路径/特殊字符不产生非法 JSON）。
ac207_files_to_json() {
  local -a files=("$@")
  "$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${files[@]}" 2>/dev/null || true
}

# 选【实现提交】：从新到旧扫 --all，跳过机械前缀与记账提交，打印第一条真正的实现提交 sha。
# 筛不出任何实现提交 ⇒ 空输出 + 非 0（调用方据此 fail-closed，⛔ 不退化成写记账提交充数）。
# ⛔ 单独成函数（不放内联在 probe 里）：selfcheck 直接调【这个产品函数】做正/负控制，而不是让夹具
# 复刻一遍判定逻辑（硬规则 4 推论三：只能被夹具复刻满足的判据不算被测）。
ac207_select_implementation_commit() {
  local root="$1" cand subj
  while IFS= read -r cand; do
    [ -n "$cand" ] || continue
    subj="$(git -C "$root" log -1 --format='%s' "$cand" 2>/dev/null || true)"
    case "$subj" in
      "chore(quay-init):"*|"tasks: "*|"goals: "*) continue ;;
    esac
    ac207_is_bookkeeping_commit "$root" "$cand" && continue
    printf '%s\n' "$cand"
    return 0
  done < <(git -C "$root" log --all --format='%H' 2>/dev/null)
  return 1
}

# ── AC-207 记录写（fail-closed，硬规则 3b）────────────────────────────────────────────────
# 写 GOAL-009-AC-207 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 缺任一有效读数 ⇒ 不写 return 1（缺值≠合格，也≠静默跳过）。字段逐字满足 criterion 过滤：
#   host 非空（≠本机由 criterion 判）、project_root 非空（∉本仓库由 criterion 判）、
#   commit_sha 非空（异仓库【实现】提交 sha，⛔ 非新鲜度锚——AC-214 只认 top-level build_sha）、
#   commit_files 非空 JSON 数组 ∧ 至少一条路径不在 tasks/goals/.quay 之下（硬规则 ② 按位置——
#     本字段是本缺陷的核心：criterion 靠它区分「实现提交」与「记账提交」，⛔ 不收自述布尔量）、
#   task_id 非空、task_status="done"、gate_events>0（整数）、produced_by_driver=true（JSON 字面 true）。
write_ac207_record() {
  local host="$1" project_root="$2" commit_sha="$3" task_id="$4" task_status="$5" gate_events="$6" produced_by_driver="$7" commit_files_json="${8:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$commit_sha" ] || return 1
  [ -n "$task_id" ] || return 1
  [ "$task_status" = "done" ] || return 1
  [ "$gate_events" -gt 0 ] 2>/dev/null || return 1
  [ "$produced_by_driver" = "true" ] || return 1
  [ -n "$commit_files_json" ] || return 1
  # 记账自证（按位置）：文件列表必须至少含一条【不在 tasks/goals/.quay 之下】的路径。
  printf '%s' "$commit_files_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let f; try { f=JSON.parse(s); } catch { process.exit(1); }
      if (!Array.isArray(f) || f.length===0) process.exit(1);
      process.exit(f.some(p => !/^(tasks|goals|\.quay)\//.test(String(p))) ? 0 : 1);
    });' || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-207\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"commit_sha\":\"$commit_sha\",\"commit_files\":$commit_files_json,\"task_id\":\"$task_id\",\"task_status\":\"$task_status\",\"gate_events\":$gate_events,\"produced_by_driver\":$produced_by_driver"
}

# ── AC-239 记录写（fail-closed，硬规则 3b）─────────────────────────────────────────────────
# 写 GOAL-009-AC-239 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 字段逐字满足 criterion 过滤（goal 的 criterion 与本函数是同一组谓词的两侧，改动须同步）：
#   host 非空、project_root 非空、commit_sha 非空（异仓库【实现】提交）、task_id 非空、
#   task_status="done"、gate_events>0（整数）、produced_by_driver=true（JSON 字面 true）。
# commit_files 与 AC-207 同用【按位置】的「非记账」判定：本 AC 的新任务是一条**真实缺陷修复**任务，
# 其实现提交必然触及源码（.go）——「文件全在 tasks/goals/.quay 之下」意味着只翻了状态、没有实现，
# 正是「闭环是假的」的形态。⛔ 因此该字段不是装饰：它把「翻了个 done」与「真的干了活」分开。
# ⛔ 本函数【不】自证 project_root 与 AC-238 同源——那是 criterion 的集合判定（upgraded set）；
#    调用方另有一道同源门（AC239_PROJECT_ROOT = AC238_PROJECT_ROOT ∧ AC238_EVALUATED=1），两层不互替。
write_ac239_record() {
  local host="$1" project_root="$2" commit_sha="$3" task_id="$4" task_status="$5" gate_events="$6" produced_by_driver="$7" commit_files_json="${8:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$commit_sha" ] || return 1
  [ -n "$task_id" ] || return 1
  [ "$task_status" = "done" ] || return 1
  [ "$gate_events" -gt 0 ] 2>/dev/null || return 1
  [ "$produced_by_driver" = "true" ] || return 1
  [ -n "$commit_files_json" ] || return 1
  printf '%s' "$commit_files_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let f; try { f=JSON.parse(s); } catch { process.exit(1); }
      if (!Array.isArray(f) || f.length===0) process.exit(1);
      process.exit(f.some(p => !/^(tasks|goals|\.quay)\//.test(String(p))) ? 0 : 1);
    });' || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-239\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"commit_sha\":\"$commit_sha\",\"commit_files\":$commit_files_json,\"task_id\":\"$task_id\",\"task_status\":\"$task_status\",\"gate_events\":$gate_events,\"produced_by_driver\":$produced_by_driver"
}

# ── AC-239 直接量读取（硬规则 4b：全部外部可核，⛔ 不采信驱动方自述）──────────────────────
# 与 AC-207 的读数同形（同一组直接量：实现提交 sha / 任务状态 / gate 事件计数 / 提交出处），差别只在
# 被测对象是【升级后的那个项目自己的 runtime】。复用 ac207_select_implementation_commit /
# ac207_commit_files / ac207_files_to_json 三个【与 AC 编号无关】的通用辅助（⛔ 不复刻一份：复刻出来的
# 绿不证明产品绿，硬规则 4 推论三），但写入自己的 AC239_* 变量——⛔ 不借用 AC207_* 变量，否则 AC-207
# 的写入路径与 E2E_CLOSURE_SELF_EVIDENCED 判定会被本条污染（两条 AC 必须可分别 pass/fail）。
probe_ac239_measures() {
  local root="$1" task_id="$2" qrl="$3" status_json _ac239_files
  AC239_EVALUATED=0; AC239_COMMIT_SHA=""; AC239_COMMIT_FILES_JSON=""
  AC239_TASK_STATUS=""; AC239_GATE_EVENTS=-1; AC239_PRODUCED_BY_DRIVER=0
  [ -n "$root" ] || return 0
  [ -n "$task_id" ] || return 0
  [ -n "$qrl" ] || return 0
  AC239_COMMIT_SHA="$(ac207_select_implementation_commit "$root" || true)"
  if [ -n "$AC239_COMMIT_SHA" ]; then
    mapfile -t _ac239_files < <(ac207_commit_files "$root" "$AC239_COMMIT_SHA")
    AC239_COMMIT_FILES_JSON="$(ac207_files_to_json "${_ac239_files[@]}")"
  fi
  # task_status：用【升级后项目自己的 runtime】读它自己的任务板（⛔ 不是本次安装前缀的 CLI——本 AC 测的
  # 正是「这个被升级过的项目还能不能自己干活」，用外部 CLI 读会把被测对象换掉）。
  status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --root "$root" --json) 2>/dev/null || true)"
  AC239_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
  ' 2>/dev/null)"
  if [ -f "$root/.quay/gate-events.jsonl" ]; then
    AC239_GATE_EVENTS="$(wc -l < "$root/.quay/gate-events.jsonl" 2>/dev/null | tr -d ' ' || echo 0)"
  else
    AC239_GATE_EVENTS=0
  fi
  # produced_by_driver：done ∧ gate>0 ∧（任务分支仍在 ∨ 全历史提交信息提到该 task_id）。
  # ⚠️ 【先取回文本再 case 匹配】，⛔ 不用 `git … | grep -q`（本脚本 set -o pipefail，命中即 SIGPIPE ⇒
  #    判据恰在【命中时】取假——AC-207 实测踩过一次，见那边注释）。
  if [ "$AC239_TASK_STATUS" = "done" ] && [ "$AC239_GATE_EVENTS" -gt 0 ] 2>/dev/null && [ -n "$AC239_COMMIT_SHA" ]; then
    local ac239_branches ac239_subjects
    ac239_branches="$(git -C "$root" branch --list "task/$task_id" 2>/dev/null || true)"
    ac239_subjects="$(git -C "$root" log --all --format='%s' 2>/dev/null || true)"
    case "$ac239_branches" in *"task/$task_id"*) AC239_PRODUCED_BY_DRIVER=1 ;; esac
    case "$ac239_subjects" in *"$task_id"*) AC239_PRODUCED_BY_DRIVER=1 ;; esac
  fi
  AC239_EVALUATED=1
}

# ── AC-207 直接量读取（硬规则 4b：全部外部可核，⛔ 不采信驱动方自述）──────────────────────
#   commit_sha  = 第三方项目 git 历史中最新的【实现提交】——按位置排除记账提交（触及文件全在
#                 tasks/goals/.quay 之下）与机械前缀（chore(quay-init): / tasks: / goals:）。
#                 ⛔【不取最新一条】——本缺陷正是「取最新一条」来的（选中的是翻 done 记账提交）。
#                 筛不出任何实现提交 ⇒ 空 ⇒ 上游 fail-closed 不写记录（⛔ 不退化成写记账提交充数）。
#   commit_files = 该实现提交触及的文件（JSON 数组；criterion 用它按位置判「非记账」）
#   task_status = 目标项目 task store（installed quay CLI task view，cwd=第三方项目根）
#   gate_events = .quay/gate-events.jsonl 行数（载体计数，缺文件 = 0）
#   produced_by_driver = task_status=done ∧ gate_events>0 ∧ 实现提交出自 task/<id> 分支或
#                 develop 已含该 task_id（时间线交错）。最强可得直接量，非机械证明（AC-207 正文）。
probe_ac207_measures() {
  local root="$1" task_id="$2" qrl="$3" status_json _ac207_files
  AC207_EVALUATED=0; AC207_COMMIT_SHA=""; AC207_COMMIT_FILES_JSON=""
  AC207_TASK_STATUS=""; AC207_GATE_EVENTS=-1; AC207_PRODUCED_BY_DRIVER=0
  [ -n "$root" ] || return 0
  [ -n "$task_id" ] || return 0
  # commit_sha：从新到旧扫 --all（覆盖 task/<id> 分支与 develop——fan-in 后分支删了、提交进 develop），
  # 跳过机械前缀与记账提交，取第一条真正的实现提交。⛔ 不用「取最新一条」。
  AC207_COMMIT_SHA="$(ac207_select_implementation_commit "$root" || true)"
  if [ -n "$AC207_COMMIT_SHA" ]; then
    mapfile -t _ac207_files < <(ac207_commit_files "$root" "$AC207_COMMIT_SHA")
    AC207_COMMIT_FILES_JSON="$(ac207_files_to_json "${_ac207_files[@]}")"
  fi
  # task_status：installed CLI 读目标项目 task store（.quay/config.yml 的 provider）
  status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --json) 2>/dev/null || true)"
  AC207_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
  ' 2>/dev/null)"
  # gate_events：载体行数（缺文件 = 0，与「无 gate 事件」同形——但 criterion 判 >0，0 恒不满足）
  if [ -f "$root/.quay/gate-events.jsonl" ]; then
    AC207_GATE_EVENTS="$(wc -l < "$root/.quay/gate-events.jsonl" 2>/dev/null | tr -d ' ' || echo 0)"
  else
    AC207_GATE_EVENTS=0
  fi
  # produced_by_driver 直接量：done ∧ gate>0 ∧（任务分支仍在 ∨ 全历史提交信息提到该 task_id）
  # ⚠️ 【先取回文本再 case 匹配】，⛔ 不用 `git … | grep -q`：本脚本 `set -o pipefail`，而 grep -q
  #    【命中即退出】会给 git 送 SIGPIPE ⇒ 管道返回 141 ⇒ 判据恰在【命中时】取假。实测 2026-09-11
  #    （gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit 的跨机 e2e）：实现
  #    提交 6f35389c、gate 事件 1 条、task_status=done 全部成立，却因这一条把 produced_by_driver 判成 0
  #    ⇒ 记录不写（fail-closed 方向正确，但它拒的是一个【真的合格】的读数——硬规则 4 的同族：读数在
  #    条件成立时取假）。⛔ 也不要把 grep -q 换成 grep -c：SIGPIPE 依旧。
  #    分支一条是短输出（无 SIGPIPE 面），但同样统一成 case 匹配以免两处两制。
  if [ "$AC207_TASK_STATUS" = "done" ] && [ "$AC207_GATE_EVENTS" -gt 0 ] 2>/dev/null && [ -n "$AC207_COMMIT_SHA" ]; then
    local ac207_branches ac207_subjects
    ac207_branches="$(git -C "$root" branch --list "task/$task_id" 2>/dev/null || true)"
    ac207_subjects="$(git -C "$root" log --all --format='%s' 2>/dev/null || true)"
    case "$ac207_branches" in *"task/$task_id"*) AC207_PRODUCED_BY_DRIVER=1 ;; esac
    case "$ac207_subjects" in *"$task_id"*) AC207_PRODUCED_BY_DRIVER=1 ;; esac
  fi
  AC207_EVALUATED=1
}

# ── AC-207 读数 → 判定 → 写记录（fail-closed 单点）────────────────────────────────────────────
# 从 step5_e2e 抽出：这段逻辑既要被端到端段调用，也要能被 selfcheck 用夹具【直接驱动产品函数】
# （⛔ 不让夹具复刻一遍判定——复刻出来的绿不证明产品绿，硬规则 4 推论三）。返回 0；是否落账看载体
# 行数变化 + 下面两条互斥的痕迹行（可区分，⛔ 不静默）。
ac207_read_and_write() {
  local root="$1" task_id="$2" qrl="$3"
  probe_ac207_measures "$root" "$task_id" "$qrl"
  AC207_TASK_ID="$task_id"
  echo "  task_status=$AC207_TASK_STATUS commit_sha=${AC207_COMMIT_SHA:0:12} commit_files=$AC207_COMMIT_FILES_JSON gate_events=$AC207_GATE_EVENTS produced_by_driver=$AC207_PRODUCED_BY_DRIVER evaluated=$AC207_EVALUATED host=$AC207_HOST"
  # 可区分痕迹（硬规则 3b）：筛不出实现提交【单独一行】报出，与「任务没跑完」区分开——⛔ 不静默，
  # ⛔ 不退化成写记账提交充数（那正是本缺陷）。载体行数不变即此处不写。
  if [ "$AC207_EVALUATED" = "1" ] && [ -z "$AC207_COMMIT_SHA" ] && [ "$AC207_TASK_STATUS" = "done" ]; then
    echo "  AC207-NO-IMPLEMENTATION-COMMIT: $root 的提交历史里筛不出任何实现提交（触及文件全在 tasks/ goals/ .quay/ 之下，或只有 chore(quay-init):/tasks:/goals: 机械提交）⇒ 记录 NOT written（fail-closed，硬规则 3b；⛔ 不拿记账提交充数）"
  fi
  if [ "$AC207_EVALUATED" = "1" ] && [ "$AC207_TASK_STATUS" = "done" ] \
     && [ -n "$AC207_COMMIT_SHA" ] && [ "$AC207_GATE_EVENTS" -gt 0 ] 2>/dev/null \
     && [ "$AC207_PRODUCED_BY_DRIVER" = "1" ]; then
    write_ac207_record "$AC207_HOST" "$AC207_PROJECT_ROOT" "$AC207_COMMIT_SHA" "$AC207_TASK_ID" "done" "$AC207_GATE_EVENTS" "true" "$AC207_COMMIT_FILES_JSON"
    # AC-240：本次运行写出了 AC-207（配对判据的另一半；root 与 AC-203 的比对是「同一 project_root」
    # 那一半，⛔ 不是「都非空」就算数）。
    AC207_WRITTEN_THIS_RUN=1
    AC207_WRITTEN_ROOT="$AC207_PROJECT_ROOT"
    echo "  ac207 record written → $AC89"
    return 0
  fi
  echo "  NOTE: AC-207 record NOT written (task not driven to done / no implementation commit / no gate events — 缺值≠合格)"
  return 0
}

# ── ⑤ 端到端（AC-207）：第三方项目自己的 *-drivers 驱动出真实开发提交且任务翻 done ─────────
# 用 shipped CLI 在第三方项目（$ROOT，无 plugin/）建一条真实任务（goals+tasks 双载体），由其自身
# promotion-driver → worker-driver 驱动到 done，读直接量写 AC-207 记录。缺任一读数不写（fail-closed）。
# ⛔ 昂贵（worker-driver spawn claude -p worker 跑完整实现）——仅 --ac207-e2e 触发。产品/夹具边界：
# 允许 claude -p 作验证手段，但产品文档与 skill 文案不得声称 quay 会启动会话（SPEC-tmux-retirement）。
step5_e2e() {
  local root="$1" qrl task_id goal_id bodyfile i status_json
  qrl="${STEP1_PREFIX}/bin/quay"; qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  AC207_HOST="$(hostname 2>/dev/null || echo '')"
  AC207_PROJECT_ROOT="$root"
  task_id="e2e-verify-207"
  goal_id="GOAL-E2E-207"
  AC207_TASK_ID="$task_id"
  echo "== ⑤ end-to-end (AC-207): third-party project's own *-drivers drive a real commit → task done =="
  if ! command -v claude >/dev/null 2>&1; then
    echo "  SKIP: claude not on PATH (worker-driver needs it to spawn a worker)"
    return 0
  fi
  # ① 双载体：goal + task（真实任务，4-artifact，promotion 闸需各 ≥40 非空白字符）
  bodyfile="$(mktemp -t ac207-task-body.XXXXXX.md)" || return 0
  cat > "$bodyfile" <<'BODY'
## Proposal

在项目根新增一个 e2e-marker.txt（内容 ac207），证明第三方项目自身的 worker-driver 能产出真实实现提交——GOAL-009-AC-207 端到端自证的最小实现目标，不依赖本仓库任何代码。

## Plan

1. 新增 e2e-marker.txt（一行 ac207）。
2. 提交（提交主题排除 chore(quay-init): 前缀，硬规则 4b）。

## Acceptance Criteria

- [ ] AC1 e2e-marker.txt 存在于项目根，内容恰为一行 "ac207"，且该提交主题不含 chore(quay-init): 前缀（区分自动落盘提交与真实开发提交）。
- [ ] AC2 该提交可在本项目 git log 中查到，commit sha 非空。

## Definition of Done

- [ ] e2e-marker.txt 已提交且为一条非 chore(quay-init) 提交，git log 可见该提交对应的真实 commit sha。

## Touches

- e2e-marker.txt
- tasks/e2e-verify-207.md
BODY
  if ! (cd "$root" && node "$qrl" goal write "$goal_id" --origin "AC-207 端到端自证" --title "e2e target goal" --goal "GOAL-E2E" --criterion "true") >/dev/null 2>&1; then
    echo "  NOTE: goal write failed — 双载体 goal 侧未落地（不阻塞任务侧；AC-207 记录只读 task 侧）"
  fi
  if ! (cd "$root" && node "$qrl" task create "$task_id" --title "e2e target task (AC-207)" --body-file "$bodyfile" --status todo --goal-ac "$goal_id") >/dev/null 2>&1; then
    echo "  FAIL: task create failed — AC-207 record NOT written (fail-closed)"
    rm -f "$bodyfile"
    return 1
  fi
  rm -f "$bodyfile"
  # ② 起 *-drivers（promotion 晋升 todo→ready；worker 派发 claude -p worker 实现）
  node "$qrl" driver start --kind promotion --root "$root" >/dev/null 2>&1 || true
  node "$qrl" driver start --kind worker --root "$root" >/dev/null 2>&1 || true
  # ③ 轮询 done（至多 AC207_POLL_SECS，缺省 1800s=30min——worker 完整实现（worktree→开发→fan-in→suite）
  # 需较长时间；fail-closed 不无限等，超时即不写记录）
  # AC-240 生成侧：同一轮询路径里为【本次运行自己的 $root】补探 AC-203 的 driver 存活直接量——
  # driver 起后至 task done 之间，首次读到 driver_alive=1 ∧ carrier_records>0 即写一次（每次运行至多
  # 一条）。⛔ 这不是为了「多写一条记录」，而是让同一次运行能自证闭环：驱动出 done 的项目 = 最强的
  # 「driver 真活」直接量，step④ 那个 30 秒窗口（紧接 start 之后）会错过它。
  # ⚠️ 采样间隔 ac240_probe_every 秒（默认 10s）：每条探测都要起一个 node 读 status 载体，逐秒探
  # 会把 3600 轮的轮询变成 3600 次 spawn。间隔只影响「多快探到」，不影响是否探到（driver 一旦落盘就一直在）。
  local ac240_probe_every=10 ac240_hpd=1 ac240_status=""
  [ -d "$root/plugin" ] || ac240_hpd=0
  AC203_HOST="${AC203_HOST:-$(hostname 2>/dev/null || echo '')}"
  for i in $(seq 1 "${AC207_POLL_SECS:-1800}"); do
    if [ "$AC203_WRITTEN_THIS_RUN" != "1" ] && [ "$ac240_hpd" = "0" ] \
       && [ $(( (i - 1) % ac240_probe_every )) -eq 0 ]; then
      # 当场 probe（⛔ 非字面量）：driver_alive / carrier_records 由 probe_ac203_driver_status 解析
      # status 载体 JSON 得出；has_plugin_dir 由上面 stat $root/plugin 得出。
      ac240_status="$(node "$qrl" driver status --kind promotion --root "$root" --json 2>/dev/null || true)"
      probe_ac203_driver_status "$ac240_status"
      echo "  [⑤ e2e] AC-203 probe (same run, same root): driver_alive=$AC203_DRIVER_ALIVE carrier_records=$AC203_CARRIER_RECORDS has_plugin_dir=$ac240_hpd evaluated=$AC203_EVALUATED"
      if [ "$AC203_EVALUATED" = "1" ] && [ "$AC203_DRIVER_ALIVE" = "1" ] && [ "$AC203_CARRIER_RECORDS" -gt 0 ] 2>/dev/null; then
        # 入参来源（⛔ 非字面量）：$AC203_DRIVER_ALIVE / $AC203_CARRIER_RECORDS ← probe_ac203_driver_status
        # 当场解析的 status 载体；$ac240_hpd ← 当场 stat 的 $root/plugin。复用唯一写入点
        # write_ac203_record（它经 ac89_append_goal009 统一补 top-level build_sha）——⛔ 不新造第二个写入者。
        if write_ac203_record "$AC203_HOST" "$root" "$ac240_hpd" "$AC203_DRIVER_ALIVE" "$AC203_CARRIER_RECORDS"; then
          AC203_WRITTEN_THIS_RUN=1
          AC203_WRITTEN_ROOT="$root"
          echo "  [⑤ e2e] ac203 record written (same run, same root=$root) → $AC89"
        else
          echo "  [⑤ e2e] NOTE: AC-203 record NOT written (fail-closed: BUILD_SHA missing/non-40-hex or AC89 path empty — 缺值≠合格)"
        fi
      fi
    fi
    status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --json) 2>/dev/null || true)"
    AC207_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
    ' 2>/dev/null)"
    [ "$AC207_TASK_STATUS" = "done" ] && break
    sleep 1
  done
  # ④ 读直接量 + 写记录（缺任一读数不写；判定/痕迹在 ac207_read_and_write 单点——selfcheck 直接驱动它）
  ac207_read_and_write "$root" "$task_id" "$qrl"
  return 0
}

# ── ⑦ 既有旧痕迹项目的升级路径（GOAL-009-AC-238）───────────────────────────────────────────
# 四件要测的事与「为什么两个方向都要取」见顶部 --upgrade-existing 的变量块注释。本函数只做
# 「取直接量 + 写记录」；升级动作本身 = 跑【本次交付物自带的】quay-init（SPEC §5 的部署/升级入口：
# 已有 config ⇒ 配置保留分支，⛔ 不是空仓库重写），再把项目本地 runtime 换成本次交付物。
# ⛔ 每个前置不成立都 return 0 且【不改 AC238_EVALUATED】——「读不出」是一个独立取值，不与「合格」同形
# （硬规则 3b：恒绿的检查比没有检查更贵）。

# binding_state <project-root> — the provider binding state word for a project, read by the mechanical
# checker plugin/scripts/provider-binding-resolvability-check.ts. ⛔ 刻意【不】注入任何 $PATH 辅助。
#
# WHY THIS EXISTS (tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected): the reading at
# ⑥ below used to be the ONLY thing asking "can the upgraded project read its own board?", and it ran
# the CLI as `PATH="$PREFIX/bin:$PATH" node …` — an external $PATH assist that SUPPLIES exactly the
# resolution a pre-ba960f503 project's bare `mcp_entry: [quay-native, mcp]` depends on. That reading
# was therefore structurally incapable of taking the false value (硬规则 4): "the upgrade succeeded"
# and "the upgraded project is unusable" produced the SAME reading. Measured 2026-09-11 on two real
# upgraded projects (orangevps), whose own CLI answers `Error: spawn quay-native ENOENT` the moment the
# assist is removed. This reading takes the binding's FORM, never "does it happen to resolve here".
#
# Returns one of: path-resolved (合格) · bare-path-name / dangling-absolute / dangling-relative (RED) ·
# no-mcp-entry / unrecognized-shape (NOT-EVALUATED) · unreadable (the checker could not run at all —
# ⛔ a distinct word, never confused with 合格).
binding_state() {
  local r="$1" out
  out="$(node --no-warnings --experimental-strip-types \
    "$SCRIPT_DIR/provider-binding-resolvability-check.ts" --root "$r" --json 2>/dev/null)"
  printf '%s' "$out" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("unreadable"); raise SystemExit
rows = [p for p in (d.get("providers") or []) if p.get("enabled", True)]
if not rows:
    print("no-provider"); raise SystemExit
for p in rows:
    if p.get("state") in ("bare-path-name", "dangling-absolute", "dangling-relative"):
        print(p["state"]); raise SystemExit
print(rows[0].get("state", "unrecognized-shape"))
' 2>/dev/null || echo "unreadable"
}

step_upgrade_existing() {
  local root="$1" npmroot qinit fresh_quay fresh_qn rtbin
  local pre_q pre_qn post_q post_qn fresh_q fresh_qn_sha
  local old_epoch now_epoch init_rc=0 pre_set post_set tl_json tl_count sample_id sample_json
  AC238_PROJECT_ROOT="$root"

  # ⓪ 前置：目标必须真的是一个【非空、带旧 runtime】的 quay 项目。
  # ⚠️ 顺序：给出 --upgrade-source 时 **$root 由 ① 的 cp 创建，此刻本就不存在** —— 所以这里查的是
  # 【源】而不是 root（2026-09-11 本地实测抓到：先前在 cp 之前查 root 是否存在的版本，在带
  # --upgrade-source 的正常路径上必然早退成 NOT-EVALUATED，即「正确输入被当成读不懂」的恒假形态）。
  if [ -n "$UPGRADE_SOURCE" ] && [ "$UPGRADE_SOURCE" != "$root" ]; then
    if [ ! -d "$UPGRADE_SOURCE" ]; then
      echo "  NOT-EVALUATED: --upgrade-source is not a directory: $UPGRADE_SOURCE" >&2; return 0
    fi
    if [ ! -f "$UPGRADE_SOURCE/.quay/config.yml" ]; then
      echo "  NOT-EVALUATED: no .quay/config.yml under --upgrade-source $UPGRADE_SOURCE — 本模式测的是【升级】既有项目,不是新装" >&2; return 0
    fi
  else
    if [ -z "$root" ] || [ ! -d "$root" ]; then
      echo "  NOT-EVALUATED: --root is not a directory: ${root:-<empty>}" >&2; return 0
    fi
    if [ ! -f "$root/.quay/config.yml" ]; then
      echo "  NOT-EVALUATED: no .quay/config.yml under $root — 本模式测的是【升级】既有项目,不是新装" >&2; return 0
    fi
  fi
  npmroot="$(npm root -g --prefix "$PREFIX")"
  qinit="${npmroot}/quay/plugin/scripts/quay-init.sh"
  fresh_quay="${npmroot}/quay/dist/quay.js"
  fresh_qn="${npmroot}/quay-native/dist/quay-native.js"
  for f in "$qinit" "$fresh_quay" "$fresh_qn"; do
    [ -f "$f" ] || { echo "  NOT-EVALUATED: fresh deliverable missing: $f" >&2; return 0; }
  done
  echo "== ⑦ upgrade-existing: $root =="
  echo "  fresh deliverable: $(basename "$fresh_quay") + $(basename "$fresh_qn") (from $PREFIX)"

  # ① 隔离副本 —— ⛔ 只读复制，绝不碰 UPGRADE_SOURCE 本体（真实活项目的 102 个任务/backlog 不动）。
  if [ -n "$UPGRADE_SOURCE" ] && [ "$UPGRADE_SOURCE" != "$root" ]; then
    rm -rf "$root"
    mkdir -p "$(dirname "$root")"
    if ! cp -a "$UPGRADE_SOURCE" "$root"; then
      echo "  NOT-EVALUATED: cp -a '$UPGRADE_SOURCE' -> '$root' failed" >&2; return 0
    fi
    echo "  isolated copy: $UPGRADE_SOURCE -> $root (source opened read-only, never written)"
    if [ ! -f "$root/.quay/config.yml" ]; then
      echo "  NOT-EVALUATED: copy at $root has no .quay/config.yml (cp incomplete?)" >&2; return 0
    fi
  fi

  # ② 升级【前】直接量（磁盘直接数，非任务板自报 —— 硬规则 4b）
  AC238_PRE_TASK_COUNT="$(find "$root/tasks" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  rtbin="$root/.quay/runtime/bin"
  if [ ! -d "$rtbin" ]; then
    echo "  NOT-EVALUATED: no $rtbin — 目标没有旧 vendored runtime,不是本 AC 的形态" >&2; return 0
  fi
  if [ ! -f "$rtbin/quay.js" ] || [ ! -f "$rtbin/quay-native.js" ]; then
    echo "  NOT-EVALUATED: $rtbin lacks quay.js/quay-native.js — 旧 runtime 形态不可识别" >&2; return 0
  fi
  # 同 ⑥ 的 `|| true` 理由：`| head -1` 在 pipefail 下可让管道整体非 0（head 提前关闭 ⇒ 上游 SIGPIPE），
  # 赋值失败会被 set -e 直接放大成整个脚本退出。空值由下面紧跟的 `[ -n "$old_epoch" ]` 判定。
  old_epoch="$(find "$rtbin" -maxdepth 1 -type f -name '*.js' -printf '%T@\n' 2>/dev/null | sort -n | head -1 || true)"
  now_epoch="$(date +%s)"
  [ -n "$old_epoch" ] || { echo "  NOT-EVALUATED: cannot read old runtime mtime under $rtbin" >&2; return 0; }
  AC238_RUNTIME_AGE_DAYS="$(python3 -c "print(round((${now_epoch} - float('${old_epoch}'))/86400.0, 3))" 2>/dev/null || echo "")"
  pre_q="$(sha256sum "$rtbin/quay.js" | awk '{print $1}')"
  pre_qn="$(sha256sum "$rtbin/quay-native.js" | awk '{print $1}')"
  # 存量指纹：逐文件 sha 的聚合（相对路径 + sort，故与本机绝对路径无关）。用于证明升级【没动】存量。
  pre_set="$(cd "$root" && find tasks -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  echo "  pre: tasks=$AC238_PRE_TASK_COUNT runtime_age_days=$AC238_RUNTIME_AGE_DAYS taskset=$(printf '%.12s' "$pre_set")"

  # ②b 【升级前】绑定可解析性直接量（无 $PATH 辅助）。这是本项目【本来就有】的存量读数：一个从
  #     ba960f503 之前升级过来的现场，此刻停在裸名绑定上 ⇒ 本读数取 RED，而 ⑥（带 $PATH 辅助）照样绿。
  #     ⛔ 信息量读数，不参与 AC238_EVALUATED 判定——源项目本来就可能是已迁移的（post 才是门）。
  AC238_PRE_BINDING="$(binding_state "$root")"
  echo "  pre binding: pre_binding=$AC238_PRE_BINDING (read with NO \$PATH assistance — the stale-inventory reading)"

  # ③ 升级动作 = 跑【本次交付物自带的】quay-init。已有 config ⇒ 配置保留分支（migrate_stale_mcp_entry
  #    + ensure_loop_config），⛔ 不是空仓库重写；任务目录只 mkdir -p，不删不覆盖。
  # ⛔ 刻意【不】把退出码捕获写成「命令 ... 或运算 赋给 rc」的一行形式：instrument-failure-check 的
  # FAMILY-3 规则是 raw indexOf 找第一个竖线字符（不区分单竖线与双竖线），那种写法会被读成
  # 「管道后读退出码」并往该族新增一条实例，而那一族的门是 shrink-only。本实现落地时被 pre-commit
  # guard 实测拦下（计数 15→16）；⚠️ 该检测器是【行扫描器】，连注释里出现同形字面量也计入——
  # 本条注释本身第一次就是这么被计进去的。改用本文件既有的 set +e / 取 rc / set -e 形
  # （同 :973/:2116/:2156）。
  # ⓪-bm 落地基线的【采纳决定】必须由本步骤给出 —— 2026-09-11 ④ 落地后这条不再可选：
  #   `gap-upgrade-entry-never-establishes-branch-model`（done）把 shipped `quay-init.sh` 改成
  #   **fail-closed**：目标项目的 `develop` 若不接主线（真实 meta-cc 副本就是这个形态，
  #   `merge-base --is-ancestor main develop` = FALSE），默认升级动作**拒绝并 exit 1、什么都不写**。
  #   ⇒ 不传该旗标时 `init_rc≠0` ⇒ AC-238 的门（含 `[ "$init_rc" = "0" ]`）结构上不成立 ⇒
  #   `AC239` 的前置（`AC238_EVALUATED=1` ∧ 同一 root）永不成立。
  #   ⛔ 这不是「绕过」：adopt 正是 ④ 为真实用户交付的那条 remedy（`quay-init.sh --adopt-branch-model`），
  #   旧 tip 零销毁地保留为 `<branch>-pre-quay-init-<sha>`。升级动作**就是**操作者那一步，故采纳决定
  #   落在它身上；⑦b 的 ⓪c 前置仍是**只读**判定（`--dry-run`），只报告不替项目做决定。
  #   负控制（本机夹具实测）：compatible 项目上传该旗标 ⇒ `[REUSED]`、`develop`/`main` 逐字不变、
  #   0 个 backup ref（该旗标在不需要采纳时是 no-op，故可以无条件传）。
  set +e
  CLAUDE_PLUGIN_ROOT="$(dirname "$(dirname "$qinit")")" \
    bash "$qinit" --root "$root" --repo-root "$root" \
      --worktree-root "$(dirname "$root")/$(basename "$root")-worktrees" \
      --adopt-branch-model \
      --auto-commit-skip >"$root/.quay-upgrade-init.log" 2>&1
  init_rc=$?
  set -e
  AC238_ADOPT_DECISION=1
  echo "  upgrade action: shipped quay-init (config-preserving branch) rc=$init_rc → $root/.quay-upgrade-init.log"

  # ④ 升级【后】的 runtime 绑定 = 当前语义（裁定 c / ba960f503「quay-init: migrate the retired
  #    project-local runtime on upgrade」）：**quay plugin 是 runtime 的单一交付面**，故升级一个旧项目
  #    的动作是——把 project-local .quay/runtime/ **退休**到 .quay/quay-init-backups/<ts>/runtime/
  #    （先备份、⛔ 不静默删），并把 config 的 providers.native.mcp_entry 改成指向【本次交付物】的
  #    vendored bundle 的绝对路径。
  #    ⛔ 旧实现（本函数 2026-09-11 03:0x 落地时）在这里 `cp -f` 覆盖 $rtbin/quay.js，那条路径现在
  #    【正是 quay-init 要退休的】——继续覆盖等于把一个已被 SPEC 退休的机制复活，与裁定 c 相反；而且
  #    quay-init 之后 $rtbin 已不存在，cp 必然失败（实测 2026-09-11 06:05 于 develop@9044f97a：
  #    `cp: cannot create regular file .../runtime/bin/quay.js: No such file or directory` ⇒ 整条
  #    AC-238 步骤 NOT-EVALUATED。这不是「升级坏了」，是**验证器没跟着裁定的语义改**。）
  #    ⇒ 在新语义下「旧 vendored runtime 被本次交付物真实换掉」是【三个方向】，缺一不可：
  #       ① 退休备份里那份逐字 == 升级前 live 的那份（退休动作没篡改旧 runtime——「换掉了」不是「丢了」）
  #       ② live 位置不再有 .quay/runtime（旧 runtime 确实离开了被使用的路径）
  #       ③ 项目此刻绑定到的 bundle 逐字 == 本次交付物（换上去的确实是本次交付物，不是别的东西）
  #    ⛔ 只取 ②③ 会把「备份被篡改/丢失」读成合格；只取 ①③ 会把「退休了但 config 没改」读成合格。
  local retired_dir retired_q="" retired_qn="" bound_entry="" bound_sha="" fresh_q fresh_qn_sha
  retired_dir="$(find "$root/.quay/quay-init-backups" -maxdepth 2 -type d -name runtime 2>/dev/null | sort | tail -1 || true)"
  if [ -n "$retired_dir" ] && [ -f "$retired_dir/bin/quay.js" ] && [ -f "$retired_dir/bin/quay-native.js" ]; then
    retired_q="$(sha256sum "$retired_dir/bin/quay.js" | awk '{print $1}')"
    retired_qn="$(sha256sum "$retired_dir/bin/quay-native.js" | awk '{print $1}')"
  fi
  bound_entry="$(config_native_mcp_entry "$root")"
  if [ -n "$bound_entry" ] && [ -f "$bound_entry" ]; then
    bound_sha="$(sha256sum "$bound_entry" | awk '{print $1}')"
  fi
  fresh_q="$(sha256sum "$fresh_quay" | awk '{print $1}')"
  fresh_qn_sha="$(sha256sum "$fresh_qn" | awk '{print $1}')"
  AC238_FRESH_RUNTIME_SHA="${bound_sha}"
  AC238_BOUND_ENTRY="$bound_entry"
  AC238_RETIRED_DIR="$retired_dir"
  [ -n "$retired_q" ] && [ "$retired_q" = "$pre_q" ] && [ "$retired_qn" = "$pre_qn" ] && AC238_RETIRED_MATCHES_PRE=1
  if [ "$AC238_RETIRED_MATCHES_PRE" = "1" ] && [ ! -e "$rtbin" ] \
     && [ -n "$bound_sha" ] && [ "$bound_sha" = "$fresh_qn_sha" ]; then
    AC238_RUNTIME_REPLACED=1
  fi
  echo "  post-binding: retired_to=${retired_dir:-<none>} retired_matches_pre=$AC238_RETIRED_MATCHES_PRE live_rt_gone=$([ -e "$rtbin" ] && echo 0 || echo 1) bound=${bound_entry:-<unread>} bound_sha=$(printf '%.12s' "${bound_sha:-<none>}") delivered_qn_sha=$(printf '%.12s' "$fresh_qn_sha")"
  if [ "$AC238_RUNTIME_REPLACED" != "1" ]; then
    echo "  NOTE: runtime_replaced=0 —— 三个方向未同时成立（① retired_matches_pre=$AC238_RETIRED_MATCHES_PRE ② live_rt_gone=$([ -e "$rtbin" ] && echo 0 || echo 1) ③ bound==delivered:$([ -n "$bound_sha" ] && [ "$bound_sha" = "$fresh_qn_sha" ] && echo 1 || echo 0)）；⛔ 不退化成写一条 runtime_replaced=true 的记录" >&2
  fi

  # ⑤ 升级【后】直接量
  AC238_POST_TASK_COUNT="$(find "$root/tasks" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  post_set="$(cd "$root" && find tasks -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  [ -n "$post_set" ] && [ "$post_set" = "$pre_set" ] && AC238_TASKSET_STABLE=1
  echo "  post: tasks=$AC238_POST_TASK_COUNT taskset_stable=$AC238_TASKSET_STABLE runtime_replaced=$AC238_RUNTIME_REPLACED"

  # ⑤b 【升级后】绑定可解析性直接量（⛔ 无 $PATH 辅助）。这是本 AC 的门：升级动作若没能把 provider
  #     绑定迁到一条项目自己控制的路径上（migrate_stale_mcp_entry 不生效 / 被回归掉），post 会停在
  #     bare-path-name——而带 $PATH 辅助的读法会把它盖成绿。取值可区分（develop 侧新增的判据）。
  AC238_POST_BINDING="$(binding_state "$root")"
  echo "  post binding: post_binding=$AC238_POST_BINDING (read with NO \$PATH assistance — the gate below)"

  # ⑥ 新 CLI 能读出旧存量（文件还在 ≠ 读得出）。⛔ 不再 PATH 前置本次安装前缀、也⛔不用
  #    `$rtbin/quay.js`：升级后的 config mcp_entry 是**绝对路径**（本次交付物的 vendored bundle），
  #    而 project-local `.quay/runtime/` 已被 quay-init 退休（裁定 c / ba960f503）⇒ $rtbin 此刻
  #    已不存在，拿它当被测 CLI 是对一个已被退休的布局的复活。解析这条绑定【不应】依赖 $PATH——
  #    依赖 $PATH 正是 ba960f503 修掉的那个缺陷形态（裸 `quay-native` 由「$PATH 恰好有什么」决定），
  #    也正是上面 `binding_state` 那道门单独承担的东西（两层不互替：这里证「读得出存量」，那里证
  #    「绑定的形态本身可解析」）。故此处刻意**不给 PATH 辅助**。
  tl_json="$(cd "$root" && node "$fresh_quay" task list --root "$root" --json 2>/dev/null)"
  tl_count="$(printf '%s' "$tl_json" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(len(d))' 2>/dev/null || echo "")"
  # 抽样 task_get：取存量里字典序第一个**真实既有**任务。候选集来自与上面同一个磁盘枚举 ⇒ 它必然是
  # 升级前就存在的任务，而不是本步骤新造的。
  # ⛔ 刻意【不】写死 `[ -f "$root/tasks/DIR-001.md" ]` 这类具体任务文件路径：task-file-bypass-check
  # 把「`tasks/` 路径字面量出现在文件操作命令行上」判为绕过 Provider ABI 的新站点（同名先例：
  # claim-task.sh / l1-delivery-surface-check.ts / verify-delivery-surface.ts 各在 ALLOWLIST 里带一条
  # 理由）。本脚本是新文件，加 ALLOWLIST 条目是单向扩大该 ratchet，而这里**根本不需要**指名某个任务
  # ——本判据要证的是「新 CLI 读得出旧存量」，与选中哪一个无关。取值语义与原写死 DIR-001 时相同
  # （C 序下大写在前，meta-cc 上仍选中 DIR-001）。
  # ⛔ 也刻意【不】用 `| grep -E '^DIR-' | head -1` 去"优先某族"：`grep` 无匹配时 exit 1，而
  # `x="$(... | grep ...)"` 在 `set -e`（本脚本 :107）下会因该赋值失败**直接退出整个脚本**——无
  # DIR- 族的项目实测正踩到这个（脚本在 'post:' 之后静默消失、exit 1）。而该"优先"在 C 序下本就是
  # 空转（大写恒排在小写前）。少一个分支即少一个失败形态。
  sample_id="$(find "$root/tasks" -maxdepth 1 -type f -name '*.md' -printf '%f\n' 2>/dev/null | sed 's/\.md$//' | sort | head -1 || true)"
  AC238_SAMPLE_TASK="$sample_id"
  sample_json=""
  if [ -n "$sample_id" ]; then
    sample_json="$(cd "$root" && node "$fresh_quay" task view "$sample_id" --root "$root" --json 2>/dev/null)"
  fi
  local sample_ok=0
  if [ -n "$sample_json" ] && printf '%s' "$sample_json" | grep -q "\"$sample_id\""; then sample_ok=1; fi
  if [ -n "$tl_count" ] && [ "$tl_count" = "$AC238_PRE_TASK_COUNT" ] && [ "$sample_ok" = "1" ] && [ "$AC238_TASKSET_STABLE" = "1" ]; then
    AC238_TASK_LIST_OK=1
  fi
  echo "  cli read-back: list_count=${tl_count:-<unreadable>} sample=$sample_id sample_ok=$sample_ok task_list_ok=$AC238_TASK_LIST_OK"

  # ⑦ 判定 + 记录（全部读数量都成立才写；⛔ 缺任一 ⇒ 不写并如实打印缺的是哪个）
  local age_ok=0
  if [ -n "$AC238_RUNTIME_AGE_DAYS" ]; then
    age_ok="$(python3 -c "print(1 if float('${AC238_RUNTIME_AGE_DAYS}') >= 1 else 0)" 2>/dev/null || echo 0)"
  fi
  # ⚠️ init_rc 是门的一部分，不是诊断字段：**升级动作本身失败（rc≠0）却记录升级成功**是本 AC 最贵
  # 的那类失败（「装好了」与「没装」在记录上同形）。实测 2026-09-11 本地夹具：quay-init 因目标无
  # go.mod/package.json/scripts/test.sh 而 exit 2（闭集只写了一半），而只按「存量没丢 + runtime 换了」
  # 判定会照样写出一条 runtime_replaced=true 的记录 —— 那条记录描述的是「我们手动换了两个文件」，
  # 不是「quay-init 把项目接管了」。⇒ rc≠0 时留空，不写。
  if [ "$AC238_PRE_TASK_COUNT" -gt 0 ] 2>/dev/null \
     && [ "$AC238_POST_TASK_COUNT" = "$AC238_PRE_TASK_COUNT" ] \
     && [ "$age_ok" = "1" ] && [ "$AC238_RUNTIME_REPLACED" = "1" ] \
     && [ "$AC238_TASK_LIST_OK" = "1" ] && [ -n "${BUILD_SHA:-}" ] \
     && [ "$AC238_POST_BINDING" = "path-resolved" ] \
     && [ "$init_rc" = "0" ]; then
    AC238_EVALUATED=1
  fi
  if [ "$AC238_EVALUATED" = "1" ]; then
    mkdir -p "$(dirname "$AC89")"
    # ⛔ `binding`/`retired_runtime_backup`/`retired_backup_matches_pre` 三个字段存在的唯一理由：
    # runtime_replaced=true 在今天有【两代语义】（旧：cp 覆盖 project-local runtime；新：退休它并把
    # config 绑定到交付物）。字段名相同时代不同 ⇒ 读者分不清这个 true 指的是哪一种替换
    # （硬规则同族：一个字段承载两个成因就等于没有区分维度）。判据侧只读老字段，这三个是给人看的。
    # ⛔ 字段并集：两代语义各有自己的可区分载体，⛔ 任一都不删（删掉任一半都让「哪个 true」重新变得
    # 不可分）：`binding`/`retired_runtime_backup`/`retired_backup_matches_pre` 是【退休式】替换
    # （新语义：旧 runtime 退休到备份 + config 绑定到交付物）；`pre_binding`/`post_binding` 是
    # 【绑定形态】的前后读数（bare-path-name ⇒ 升级没把绑定迁到项目自己控制的路径上）。
    printf '{"ts":"%s","ac":"GOAL-009-AC-238","host":"%s","project_root":"%s","pre_upgrade_task_count":%s,"post_upgrade_task_count":%s,"pre_upgrade_runtime_age_days":%s,"runtime_replaced":true,"task_list_ok":true,"build_sha":"%s","upgrade_source":"%s","upgrade_init_rc":%s,"isolated_copy":%s,"taskset_stable":true,"sample_task":"%s","fresh_runtime_sha256":"%s","pre_binding":"%s","post_binding":"%s","host_key":"%s","binding":"delivered-vendor","retired_runtime_backup":"%s","retired_backup_matches_pre":true,"bound_mcp_entry":"%s","adopt_decision":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname 2>/dev/null || echo '')" "$AC238_PROJECT_ROOT" \
      "$AC238_PRE_TASK_COUNT" "$AC238_POST_TASK_COUNT" "$AC238_RUNTIME_AGE_DAYS" \
      "$BUILD_SHA" "${UPGRADE_SOURCE:-none}" "$init_rc" \
      "$([ -n "$UPGRADE_SOURCE" ] && [ "$UPGRADE_SOURCE" != "$root" ] && echo true || echo false)" \
      "$AC238_SAMPLE_TASK" "$AC238_FRESH_RUNTIME_SHA" "${AC238_PRE_BINDING:-unreadable}" \
      "${AC238_POST_BINDING:-unreadable}" "${HOST:-}" \
      "$AC238_RETIRED_DIR" "$AC238_BOUND_ENTRY" \
      "$([ "$AC238_ADOPT_DECISION" = "1" ] && echo true || echo false)" >> "$AC89"
    echo "  ac238 record written → $AC89"
  else
    echo "  AC-238 record NOT written — 缺值≠合格 (pre_count=$AC238_PRE_TASK_COUNT post_count=$AC238_POST_TASK_COUNT age_days=${AC238_RUNTIME_AGE_DAYS:-<unread>} replaced=$AC238_RUNTIME_REPLACED task_list_ok=$AC238_TASK_LIST_OK post_binding=${AC238_POST_BINDING:-<unread>} build_sha=${BUILD_SHA:-<empty>} upgrade_init_rc=$init_rc)" >&2
  fi
  return 0
}

# ac239_baseline_state <delivered-init-stdout> <rc> — classify the target project's LANDING baseline from
# the delivered `quay init --dry-run --adopt-branch-model` report. Pure text→word: ⛔ no git of its own, no
# second judgment (ADR-004 单一来源——分类本身在 packages/quay/src/branch-model.ts，这里只**读**它打出来
# 的那一行)。⛔ 单独成函数是为了让 --selfcheck 能用合成报文直接驱动它、证明它能取到【每一个】值——
# 一个只会返回 compatible 的解析器就是硬规则 4 的「结构上不可能取假的量」，比没有检查更贵。
#
#   compatible  — [REUSED]  landing-baseline：`develop` 已含默认分支 ⇒ 本副本可用作落地基线
#   divergent   — [ADOPTED]/[BLOCKED] landing-baseline：`develop` 是不接主线的远古分叉 ⇒ 当前不可用
#   absent      — [CREATED] landing-baseline：`develop` 不存在 ⇒ 当前不可用（fan-in 的 merge 直接失败）
#   unreadable  — rc≠0，或交付物的报告里没有 landing-baseline 行 ⇒ ⛔ 既不算合格也不算不合格
ac239_baseline_state() {
  local out="$1" rc="$2" line
  [ "$rc" = "0" ] || { printf 'unreadable'; return 0; }
  line="$(printf '%s\n' "$out" | grep -m1 'landing-baseline' || true)"
  case "$line" in
    *"[REUSED] landing-baseline"*) printf 'compatible' ;;
    *"[ADOPTED] landing-baseline"*) printf 'divergent' ;;
    *"[BLOCKED] landing-baseline"*) printf 'divergent' ;;
    *"[CREATED] landing-baseline"*) printf 'absent' ;;
    *) printf 'unreadable' ;;
  esac
  return 0
}

# ── ⑦b 升级【后】的动态闭环（GOAL-009-AC-239）─────────────────────────────────────────────
# 人 2026-09-11 裁定把 AC-238 原范围拆成两条互不掩盖的 AC：AC-238 管【静态/存量】（升级机制本身有
# 没有丢数据、CLI 读不读得出、旧 runtime 换没换掉），本函数管【动态】——刚被升级过的那个项目，还能
# 不能像 AC-207 那样被它自己的 *-drivers 接着驱动出新任务到 done。「装得上」与「还能接着干」是两件
# 事，一条判据里塞两件会让人分不清是升级坏了还是 driver 坏了。
#
# ⛔ 前置（缺一即 not-evaluated：本函数直接 return 0，AC239_EVALUATED 保持 0）：
#   ① AC239_E2E=1（opt-in，昂贵：worker 做完整实现 → fan-in → 全量 suite）
#   ② AC238_EVALUATED=1 ∧ AC238_PROJECT_ROOT 逐字 == $root
#      —— 「升级成功」与「升级后还能干活」必须落在【同一个 root】上。这是本 AC 防自证的全部机制：
#      另起一个全新项目跑一遍 e2e 是很容易的，但那证明的是「新项目能跑」，不是「升级没把项目弄坏」。
#      判据侧（goals/AC-239-*.md）另有独立的载体集合判定，两层不互替（硬规则 2 按位置 + 不靠单一处）。
#   ③ AC-238 本轮的「runtime 绑定」读数成立（AC238_RUNTIME_REPLACED=1）—— ② 已保证同一个 root，
#      ③ 保证这个 root 的升级确实换掉了旧 runtime、绑到了本次交付物。
# ⚠️ 被测对象是**哪个 CLI**：⛔ 不是 project-local `.quay/runtime/bin/quay.js`。那个布局在当前语义下
#    已被 SPEC-plugin-lifecycle-single-bundle-2026-09-02 / 裁定 c 退休（quay plugin 是 runtime 的单一
#    交付面），AC-238 步骤刚刚亲眼看着它被退休到 backup。⇒ 「这个项目自己的 runtime」在当前语义下
#    **就是本次交付物**（config 的 mcp_entry 指过去的正是它）——所以本步骤用交付物 CLI 配 `--root $root`
#    驱动，与 AC-207 同一形态；被测的「项目自身」由 `--root` + 它升级后的 config/loop/profiles 承载。
step_upgrade_drive_continue() {
  local root="$1" qrl task_id goal_id bodyfile i status_json
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  AC239_PROJECT_ROOT="$root"
  AC239_HOST="$(hostname 2>/dev/null || echo '')"
  echo "== ⑦b post-upgrade continuation (AC-239): the upgraded project's OWN drivers drive a NEW task to done =="
  if [ "$AC239_E2E" != "1" ]; then
    echo "  not-evaluated: --ac239-e2e 未传入（未尝试 ≠ 不合格）"
    return 0
  fi
  if [ "$AC238_EVALUATED" != "1" ] || [ "$AC238_PROJECT_ROOT" != "$root" ]; then
    echo "  not-evaluated: AC-238 未在【这个 root】上评估通过（evaluated=${AC238_EVALUATED} ac238_root=${AC238_PROJECT_ROOT:-<none>} root=$root）⇒ ⛔ 不写 AC-239 记录（若在此处写，AC-239 就退化成「另起一个项目也能跑」）"
    return 0
  fi
  if [ "$AC238_RUNTIME_REPLACED" != "1" ]; then
    echo "  not-evaluated: 本轮 AC-238 的 runtime 绑定读数未成立（AC238_RUNTIME_REPLACED=$AC238_RUNTIME_REPLACED）⇒ 这个 root 还不能算「已升级」，驱动它证明不了 AC-239 要证的事"
    return 0
  fi
  if [ ! -f "$qrl" ]; then
    echo "  not-evaluated: 交付物 CLI 不在 $qrl ⇒ 无驱动入口（被测项目的 runtime 在当前语义下就是本次交付物，见上方注释）"
    return 0
  fi
  if ! command -v claude >/dev/null 2>&1; then
    echo "  not-evaluated: claude 不在 PATH（worker-driver 需要它 spawn worker）"
    return 0
  fi

  # ⓪ 目标项目 profiles：worker-default 的 launcher/model 必须能解析，否则 worker 起不来（起不来会
  #    表现为「轮询超时」这类与「实现失败」同形的结果，故先在门口把它变成一个可区分取值）。
  configure_target_profiles "$root" "$(resolve_driving_profiles || true)" "$TARGET_LAUNCHER" "$TARGET_MODEL" "$TARGET_AUTH" || true
  AC239_PROFILES_STATUS="$TARGET_PROFILES_STATUS"
  echo "  [⑦b] target-profiles: $AC239_PROFILES_STATUS (launcher=${TARGET_PROFILES_LAUNCHER:-<none>} model=${TARGET_PROFILES_MODEL:-<none>})"
  if [ "$AC239_PROFILES_STATUS" != "configured" ]; then
    echo "  not-evaluated: 目标项目 profiles 未配置 ⇒ worker 无法 spawn，本步骤不做（可区分取值，⛔ 不与「驱动失败」同形）"
    return 0
  fi

  # ⓪b 目标项目的【工具链】前置：本步骤刻意建的是一条**真实 Go 缺陷修复任务**（见 ① 的任务体——AC3/AC4
  #     就是 `go build ./...` / `go test ./...`，worker-driver 派发时给的 scoped 门也是 `go test ./...`），
  #     而 worker 的 Bash 工具继承的是**进程 env**，⛔ 不是 login shell。实测 2026-09-11 07:1xZ（本次真机
  #     e2e，直接读活 worker 进程的 /proc/<pid>/environ）：worker PATH 里没有 go ⇒ `go test ./...` 报
  #     `go: command not found`，而这一缺失会以【与「driver 坏了」同形】的长轮询超时收场（硬规则 3b）。
  #     ⛔ 不硬编码 `$HOME/go-sdk/bin`（硬规则 4 推论二：依赖宿主的字面量换台机器即失效且静默）——从
  #     login shell 解析 go 所在的 bin 目录（本机实测 ⇒ /home/yale/go-sdk/bin，go1.24.x）；解析不到就
  #     如实报一个【可区分】的 not-evaluated，⛔ 不静默地放 worker 去撞。
  local go_bin_dir=""
  go_bin_dir="$(dirname "$(bash -lc 'command -v go' 2>/dev/null || true)" 2>/dev/null || true)"
  case "$go_bin_dir" in ""|"."|"/") go_bin_dir="" ;; esac
  if [ -z "$go_bin_dir" ]; then
    AC239_TOOLCHAIN_STATUS="go-absent"
    echo "  not-evaluated: login shell 解析不到 go，而目标项目是 Go 项目（见 ① 的任务体）⇒ worker 跑不了 'go test ./...'，本步骤不做（可区分取值，⛔ 不与「driver 起不来」同形）"
    return 0
  fi
  AC239_TOOLCHAIN_STATUS="resolved"
  export PATH="$go_bin_dir:$PATH"
  echo "  [⑦b] go toolchain: $go_bin_dir ($(go version 2>/dev/null || echo 'version-unreadable'))"

  # ⓪c 落地基线前置（read-only，5 秒）。本步骤要证的是「升级后的项目能驱动新任务到 done」，而 done
  #     由该项目自己的 worker-driver 机械 fan-in 判定，其**落地基线是协议固定 ref `develop`**
  #     （worker-driver.ts `opts.mergeTarget ?? "develop"`，项目侧无旋钮——见
  #     tasks/gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing 的取证）。若该副本的
  #     `develop` 是一条**不接主线**的远古分叉，anti-drift 的 `git diff --name-only develop...HEAD`
  #     拿到的是【主线的整个分叉】而非本任务的改动（真机实测 2026-09-11：**1566** 文件），
  #     **任何 `## Touches` 都盖不住** ⇒ 落地结构上不可能；而症状会以「轮询一小时仍未 done」这种
  #     与「worker 实现失败」同形的形态收场（硬规则 3b）。
  #     ⇒ 先用【交付物自己的】判定把这件事变成一个当场可归因的读数：`quay init --dry-run
  #     --adopt-branch-model` 走 `ensureBranchModel` 的 dryRun 全路径——只判定，**不改任何 ref、不写任何
  #     文件**（branch-model.ts 的每个变异点前都有 `if (dryRun)` 分支）。
  #     ⚠️ 2026-09-11 ④ 落地后本段的理由已更新：先前「不代项目做 adopt 决定」是因为**该 remedy 当时对
  #     真实用户不可达**（shipped `quay-init.sh` 对 `adopt` 的 grep 命中数 = 0）——在那种世界里替项目
  #     adopt 等于掩盖产品缺陷。④（`gap-upgrade-entry-never-establishes-branch-model`，done）把该 remedy
  #     交付到了 shipped 入口 ⇒ 现在「升级动作携带采纳决定」（见上方 ⓪-bm）**就是真实用户的那条路**，
  #     ⛔ 不是绕过。本前置仍是**只读**判定（`--dry-run`，不改任何 ref/文件）：它报告的是升级【之后】
  #     这条基线到底可不可以用 —— 采纳成功 ⇒ `compatible`（并可据 `adopt_decision` 与「天生正常」区分）。
  local bl_out="" bl_rc=0
  set +e
  bl_out="$(cd "$root" && node "$qrl" init --dry-run --adopt-branch-model --root "$root" 2>/dev/null)"
  bl_rc=$?
  set -e
  AC239_BASELINE_STATUS="$(ac239_baseline_state "$bl_out" "$bl_rc")"
  echo "  [⑦b] landing-baseline pre-flight: state=$AC239_BASELINE_STATUS (delivered init --dry-run rc=$bl_rc) :: $(printf '%s\n' "$bl_out" | grep -m1 'landing-baseline' || echo '<no landing-baseline line in the delivered init report>')"
  if [ "$AC239_BASELINE_STATUS" = "divergent" ] || [ "$AC239_BASELINE_STATUS" = "absent" ]; then
    echo "  not-evaluated: 升级后副本的落地基线 'develop' 当前【不可用】（state=$AC239_BASELINE_STATUS —— divergent 指它仍是不接主线的远古分叉，absent 指它不存在）⇒ 该项目自己的机械 fan-in 会在 anti-drift 处结构上必然失败，'任务驱动到 done' 这一结果不可达。⛔ 不烧那一小时的轮询（它只会以与「实现失败」同形的形态收场），⛔ 也不写 AC-239 记录（缺值≠合格）。⚠️ 读到 divergent ⇒ 升级动作（⓪-bm）没能把基线采纳成主线，这是**升级侧**的失败读数，⛔ 不是「项目天生如此」。" >&2
    return 0
  fi
  if [ "$AC239_BASELINE_STATUS" = "unreadable" ]; then
    echo "  [⑦b] NOTE: 落地基线前置读数 unreadable（交付物 init --dry-run 报不出 landing-baseline 行 / rc≠0）——⛔ 不据此判不合格（读不懂与不合格不同形，硬规则 3b），照常进入下面的驱动链；真结论由那一轮的实际结果给。" >&2
  fi

  # ① 建一条**真实缺陷修复任务**。⛔ 不是占位标记文件：升级后的项目用它自己的任务板去修它自己的
  #    真实 bug，证据价值高于「能跑通一条空任务」（同 meta-cc 历史上 AC118 的形态）。任务内容就是
  #    本仓库 CLAUDE.md 硬规则 1 记过、2026-09-11 用当前安装版本重新复现过的那个缺陷。
  task_id="ac239-subagent-session-id-scan"
  goal_id="GOAL-E2E-239"
  AC239_TASK_ID="$task_id"
  bodyfile="$(mktemp -t ac239-task-body.XXXXXX.md)" || return 0
  cat > "$bodyfile" <<'BODY'
## Proposal

meta-cc 的 MCP 查询工具在【显式传入 `session_id`】时，`include_subagents` 参数静默失效：磁盘上
`<session-id>/subagents/agent-*.jsonl` 里明明有目标内容，查询却返回 0 条，**且不报错、不告警**——
「查过且合格」与「根本没查」在返回值上同形。

实测（可复现，非推断）：取一根只存在于某会话 `subagents/agent-*.jsonl`、不在该会话主 `.jsonl` 里的
针，先用 `grep -rl` 在文件系统上确认两侧计数（主会话文件 0 次、子代理文件 ≥1 次），再对同一会话调用
`query_session_content(session_id=<sid>, include_subagents=true, contains=<针>)` ⇒ 返回 0 条；
而同一次查询若改走 `scope=session`（不传 `session_id`），同一根针能被找到。
⇒ 差异被定位在**传参形态**上，不是「那根针不存在」。

`internal/mcp/query/query.go` 的注释只承诺了两种取值（`scope=session` 与 `scope=project` 配
`includeSubagents=true` 时的文件展开），**显式 `session_id` 是第三种取值，注释里没有它**——
这与实测形态一致：该路径很可能没有接上 `GetQueryFiles` 的 subagent 目录展开。

⛔ 上面是**待确认的线索，不是结论**。根因与修法必须在实现时到源码里实际定位（`query.go` /
`stage.go` / `query_files_test.go` 与 `executor/handlers.go` 的调用链），不得照抄本段的猜测。

## Plan

1. 复现并定位：构造「主会话文件无针 ∧ `<sid>/subagents/agent-*.jsonl` 有针」的最小 fixture，
   断言显式 `session_id` + `include_subagents=true` 时能查到 ⇒ 先看到它 FAIL。
2. 在 `internal/mcp/query/` 的对应读取路径上把 subagent 目录展开接上（具体落点由第 1 步的定位决定）。
3. 让第 1 步的测试转 PASS；`go build ./...` 与相关包既有测试保持通过。

## Acceptance Criteria

- [ ] AC1 新增/修改的 Go 测试在【修复前】失败、在【修复后】通过；两条命令与真实输出贴进本任务
      （修复前的失败证据 = 把修复改动反向应用或 `git stash` 后跑同一条测试命令）。
- [ ] AC2 该测试的判据是**按位置**的：针只存在于 `<session>/subagents/*.jsonl`，在主会话文件里
      一次都不出现（夹具自己先断言这一点，⛔ 不靠文件名或注释声称）。
- [ ] AC3 `go build ./...` 通过。
- [ ] AC4 本次改动涉及的既有测试通过（至少 `go test ./internal/mcp/query/... ./internal/mcp/executor/...`）。

## Definition of Done

- [ ] 缺陷在源码层面被修复（不是把测试改成绕过它），修复落在 `internal/mcp/` 的查询路径上，改动可在 git log 中查到。
- [ ] AC1 要求的「修复前失败 / 修复后通过」两条真实输出已贴进任务记录或提交信息。
- [ ] 未被改坏的行为：显式传 `include_subagents=false` 时依旧不展开 subagent 目录。

## Touches

- internal/mcp/query/query.go
- internal/mcp/query/stage.go
- internal/mcp/query/query_files_test.go
- tasks/ac239-subagent-session-id-scan.md
BODY
  if ! (cd "$root" && node "$qrl" goal write "$goal_id" --origin "AC-239 升级后闭环自证" --title "e2e post-upgrade target goal" --goal "GOAL-E2E" --criterion "true") >/dev/null 2>&1; then
    echo "  [⑦b] NOTE: goal write 失败（不阻塞任务侧；AC-239 记录只读 task 侧）"
  fi
  if ! (cd "$root" && node "$qrl" task create "$task_id" --title "修复 include_subagents 在显式 session_id 上传参时静默失效" --body-file "$bodyfile" --status todo --goal-ac "$goal_id") >/dev/null 2>&1; then
    rm -f "$bodyfile"
    echo "  [⑦b] not-evaluated: task create 失败 ⇒ 记录 NOT written（fail-closed）"
    return 0
  fi
  rm -f "$bodyfile"
  AC239_TASK_CREATED=1
  echo "  [⑦b] real defect-fix task created in the upgraded project: $task_id"

  # ② 起【它自己的】promotion/worker drivers（⛔ 不是本仓库的 drivers）。
  # ⛔ 刻意【不】把退出码捕获写成「命令 … 或运算 赋给 rc」的一行形式：instrument-failure-check 的
  # FAMILY-3 规则是 raw indexOf 找第一个竖线字符（不区分单竖线与双竖线），那种写法会被读成
  # 「管道后读退出码」并往该族新增一条实例，而那一族的门是 shrink-only。同本文件 ③ 升级动作那里的
  # set +e / 取 rc / set -e 既有形（该处注释记着同一件事，落地时被 pre-commit guard 实测拦下过）。
  local d_rc_p=0 d_rc_w=0
  set +e
  (cd "$root" && node "$qrl" driver start --kind promotion --root "$root") >/dev/null 2>&1
  d_rc_p=$?
  (cd "$root" && node "$qrl" driver start --kind worker --root "$root") >/dev/null 2>&1
  d_rc_w=$?
  set -e
  if [ "$d_rc_p" = "0" ] && [ "$d_rc_w" = "0" ]; then AC239_DRIVERS_STARTED=1; fi
  echo "  [⑦b] driver start: promotion rc=$d_rc_p worker rc=$d_rc_w started=$AC239_DRIVERS_STARTED"
  if [ "$AC239_DRIVERS_STARTED" != "1" ]; then
    echo "  [⑦b] not-evaluated: 升级后项目的 driver 起不来 ⇒ 记录 NOT written（这本身就是 AC-239 要测的失败，如实记，⛔ 不写成「未评估」以外的结论）"
  fi

  # ③ 轮询 done（至多 AC239_POLL_SECS，缺省 3600s）。fail-closed：超时不写记录。
  #    本任务比 AC-207 的 marker 任务重得多（真实 Go 缺陷修复 + fan-in 全量 suite），故轮询窗更宽；
  #    ⛔ 不放宽到无限——「等不到」必须留下可核的痕迹，而不是一个永不返回的步骤。
  #    ⚠️ start 报了非 0 时把窗口收窄到 120s：`driver start` 的退出码不是「活没活」的直接量（AC-203 的
  #    教训正是「start exit 0 而系统是死的」；反向也同形——已常驻时 restart 会报非 0 而 driver 是活的），
  #    所以这里【不】据此判 not-evaluated，只据它决定「值不值得等一小时」。真起不来时 120s 足够让
  #    「没派发」与「派发了但实现失败」在痕迹上分得开（前者 status 恒为 todo）。
  local ac239_poll="${AC239_POLL_SECS:-3600}"
  if [ "$AC239_DRIVERS_STARTED" != "1" ]; then ac239_poll=120; fi
  for i in $(seq 1 "$ac239_poll"); do
    status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --root "$root" --json) 2>/dev/null || true)"
    AC239_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
    ' 2>/dev/null)"
    [ "$AC239_TASK_STATUS" = "done" ] && break
    sleep 1
  done
  echo "  [⑦b] poll finished: task_status=${AC239_TASK_STATUS:-<unreadable>} (poll window ${ac239_poll}s)"

  # ④ 读直接量 → 判定 → 写记录（单点，fail-closed）。⛔ 判据不是「本步骤跑完了」，而是四个外部可核量。
  probe_ac239_measures "$root" "$task_id" "$qrl"
  echo "  [⑦b] task_status=$AC239_TASK_STATUS commit_sha=${AC239_COMMIT_SHA:0:12} commit_files=$AC239_COMMIT_FILES_JSON gate_events=$AC239_GATE_EVENTS produced_by_driver=$AC239_PRODUCED_BY_DRIVER evaluated=$AC239_EVALUATED host=$AC239_HOST"
  if [ "$AC239_EVALUATED" = "1" ] && [ -z "$AC239_COMMIT_SHA" ] && [ "$AC239_TASK_STATUS" = "done" ]; then
    echo "  AC239-NO-IMPLEMENTATION-COMMIT: $root 的提交历史里筛不出实现提交（触及文件全在 tasks/ goals/ .quay/ 之下）⇒ 记录 NOT written（fail-closed；⛔ 不拿记账提交充数）"
  fi
  if [ "$AC239_EVALUATED" = "1" ] && [ "$AC239_TASK_STATUS" = "done" ] \
     && [ -n "$AC239_COMMIT_SHA" ] && [ "$AC239_GATE_EVENTS" -gt 0 ] 2>/dev/null \
     && [ "$AC239_PRODUCED_BY_DRIVER" = "1" ]; then
    if write_ac239_record "$AC239_HOST" "$AC239_PROJECT_ROOT" "$AC239_COMMIT_SHA" "$AC239_TASK_ID" "done" "$AC239_GATE_EVENTS" "true" "$AC239_COMMIT_FILES_JSON"; then
      AC239_WRITTEN_THIS_RUN=1
      AC239_WRITTEN_ROOT="$AC239_PROJECT_ROOT"
      echo "  ac239 record written → $AC89 (same root as AC-238: $root) ✓"
    else
      echo "  [⑦b] NOTE: AC-239 record NOT written (fail-closed: BUILD_SHA missing/non-40-hex or AC89 path empty — 缺值≠合格)" >&2
    fi
  else
    echo "  [⑦b] NOTE: AC-239 record NOT written (task not driven to done / no implementation commit / no gate events — 缺值≠合格)" >&2
  fi
  return 0
}

# ── ⑧ AC-247 直接量读取（全部在【目标机】上读，硬规则 4b：外部可核，⛔ 不自报）──────────────────
# 下面四个小函数各自【只做一件事】，且都被 step_ac247_takeover 与 --selfcheck 同时驱动——
# ⛔ 不让夹具复刻一遍读数逻辑（硬规则 4 推论三：只能被夹具复刻满足的判据不算被测）。

# 目标项目自己的 task store 条目数。**同一实现读 pre 与 post 两次**（Plan 6 的判据要的是
# 「同一读法在两个时刻的两个值」，两次用不同读法得来的「相等」什么也不能证明）。
# 读数路径 = 交付物 CLI 的 `task list --json`（经项目自己的 config/provider 解析 store）⇒ 数 JSON
# 数组长度。⇒ 打印条目数、返回 0；读不出（CLI 报错 / 输出不是 JSON 数组 / 空）⇒ 不打印、返回 1
# ——⛔ 不返回 0（「没查成」与「查了是 0 条」必须不同形，硬规则 3b）。
ac247_task_store_count() {
  local root="$1" qrl="$2" out
  out="$( (cd "$root" && node "$qrl" task list --root "$root" --json) 2>/dev/null || true)"
  [ -n "$out" ] || return 1
  # ⛔ 用 process.stdout.write 而【不是】console.log：本仓库的套件环境里 FORCE_COLOR 已置位，而
  # console.log 会对【数字】加 ANSI 颜色（实测本机 `console.log(61)` ⇒ "\033[33m61\033[39m"）⇒
  # 命令替换拿到的不是 "61"，一切按字符串比较的判据当场恒假（既有教训：force-color-breaks-node-
  # console-log-read-parsing）。write 不走那一层格式化。
  printf '%s' "$out" | "$VC_NODE" --no-warnings -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s); if (Array.isArray(j)) { process.stdout.write(String(j.length) + "\n"); process.exit(0); } } catch { /* not JSON */ }
      process.exit(1);
    });'
}

# 项目 HEAD 的提交时刻（epoch）。这是 stale_days 的【产生处】——因为下游只看得见天数，
# 把原始 epoch 一并带回留档，事后可复算（⛔ 不可复算的读数无法被独立核对）。
# 非 git 仓库 / 无提交 ⇒ 不打印、返回 1。
ac247_head_epoch() {
  local root="$1" epoch
  epoch="$(git -C "$root" log -1 --format=%ct 2>/dev/null || true)"
  case "$epoch" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$epoch"
}

# stale_days = (接管前时刻 - HEAD 提交时刻) / 86400，3 位小数。任一侧读不出 / 非数字 ⇒ 不打印、返回 1。
# ⛔ 用 awk（POSIX）而不是 python3：本步骤要在目标机上跑，python3 不是每个宿主都有，而 awk 是。
ac247_stale_days() {
  local head_epoch="$1" now_epoch="$2" out
  case "$head_epoch" in ''|*[!0-9]*) return 1 ;; esac
  case "$now_epoch" in ''|*[!0-9]*) return 1 ;; esac
  out="$(awk -v h="$head_epoch" -v n="$now_epoch" 'BEGIN{ printf "%.3f", (n - h)/86400.0 }' 2>/dev/null || true)"
  case "$out" in ''|*[!0-9.]*) return 1 ;; esac
  printf '%s\n' "$out"
}

# 接管【前】目标机的 user-scope quay 安装读数（三态，⛔ 不是布尔——硬规则 3）：
#   present       两个独立读法里有一个说「装了」；
#   absent        两个独立读法【都】说「没装」（`command -v quay` 无 ∧ npm 全局 root 下无 quay/）；
#   not-evaluated 连 npm 都问不到 ⇒ 读不懂 ⇒ 独立取值，不冒充 absent（硬规则 3b）。
# ⚠️ 它【不是】判据字段（AC-247 的判据不读它）——它存在的理由是让「接管前安装为缺」这条**负控制**
#   留下可核痕迹（AC3 要求留档「install 缺」），否则「我们装了一个本来就在的东西」无从分辨。
ac247_probe_user_install() {
  local npmroot
  if command -v quay >/dev/null 2>&1; then printf 'present\n'; return 0; fi
  npmroot="$(npm root -g 2>/dev/null || true)"
  if [ -n "$npmroot" ] && [ -d "$npmroot/quay" ]; then printf 'present\n'; return 0; fi
  if [ -n "$npmroot" ]; then printf 'absent\n'; return 0; fi
  printf 'not-evaluated\n'
}

# ps 代理量读数：全机 `quay` 命中的进程数。⛔ 只作 AC4 的【分歧留档】——它证明「进程表」与
# 「status 载体」是两种确实不同的读法（目标机实测：ps=4 条 21–26 天的陈旧进程，而同刻 status 报
# driver_alive=0）。⛔ 任何判据字段都不得由它派生（同 AC-203/AC-234 的教训，硬规则 4b）。
# 读不出 ⇒ 打印 -1（⛔ 不打印 0 —— 0 是「读了，没有」，-1 是「没读成」）。
ac247_ps_stale_procs() {
  local n
  n="$(ps -eo pid,args 2>/dev/null | grep -c '[q]uay' || true)"
  case "$n" in ''|*[!0-9]*) printf -- '-1\n' ;; *) printf '%s\n' "$n" ;; esac
}

# 读 status 载体（复用既有唯一解析器）→ 复制进 AC247_* 并【原样保留】AC203_* 的取值。
# ⛔ 不新造第二套 status 解析（本项目已因「同一个载体面两套读法」吃过一次亏）；⛔ 也不把
# AC203_* 留给调用方当输出用——那会把「⑧ 的读数」与「④ 的读数」混成同一个变量。
ac247_read_driver_status() {
  local root="$1" qrl="$2" status_json
  status_json="$( (cd "$root" && node "$qrl" driver status --kind promotion --root "$root" --json) 2>/dev/null || true)"
  AC247_LAST_RECORD_TS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s); console.log(typeof j.last_record_ts === "string" ? j.last_record_ts : ""); } catch { console.log(""); }
    });' 2>/dev/null || true)"
  probe_ac203_driver_status "$status_json"
  AC247_DRIVER_ALIVE="$AC203_DRIVER_ALIVE"
  AC247_CARRIER_RECORDS="$AC203_CARRIER_RECORDS"
}

# ── AC-247 记录写（fail-closed，硬规则 3b）──────────────────────────────────────────────────
# 经 ac89_append_goal009 统一补 top-level build_sha/ts（AC-214 唯一补锚 choke point）——⛔ 本函数体内
# 不出现 `build_sha` 字面量：多一个补锚点 = 下次改锚格式必漏一处（该 choke point 的注释逐字禁止）。
# 八件读数逐字满足 criterion 过滤（goal 的 criterion 与本函数是同一组谓词的两侧，改动须同步）：
#   host 非空（≠本机由 criterion 判）· project_root 非空（∉本仓库由 criterion 判）·
#   pre 正整数 · post == pre · stale ≥ 14 · driver_alive == 1 · carrier_records > 0。
# ⛔ 缺任一条 ⇒ return 1、一条都不写——包括「读不出就写 0」这个形态：它会把「没查成」伪装成
#    「查过且不合格」，比不写更贵（硬规则 3b 的镜像半边）。
# ⚠️ `14` 是 criterion 里的阈值（stale_days≥14），此处与判据文件是同一组常数的两侧，不是「字段默认值」。
write_ac247_record() {
  local host="$1" project_root="$2" pre="$3" post="$4" stale="$5" alive="$6" recs="$7"
  local extra="${8:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ "$pre" -gt 0 ] 2>/dev/null || return 1
  [ "$post" = "$pre" ] || return 1
  case "$stale" in ''|*[!0-9.]*) return 1 ;; esac
  awk -v s="$stale" 'BEGIN{ exit !(s >= 14) }' 2>/dev/null || return 1
  [ "$alive" = "1" ] || return 1
  [ "$recs" -gt 0 ] 2>/dev/null || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-016-AC-247\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"pre_task_count\":$pre,\"post_task_count\":$post,\"stale_days\":$stale,\"driver_alive\":$alive,\"carrier_records\":$recs${extra}"
}

# ── ⑧ 接管（GOAL-016-AC-247）──────────────────────────────────────────────────────────────
# 顺序固定（Plan 2）：(a) 读 pre 三件并原样打印 → (b) 既有的从零安装段已完成（step① 的隔离前缀）
# → (c) 用【目标项目自己的】runtime 起 promotion driver → (d) 读 `driver status --json`
# → (e) 重读 task 数 → (f) 八件读数全部有效才写记录；任缺 ⇒ 不写 + 可区分的 NOT-EVALUATED + 退出非 0。
# ⛔ (a) 必须在 (c) 之前：stale_days 的第二个时刻是「接管前那一刻」——起 driver 之后再算，
#    「距今」会变成 ~0，判据当场恒假（Plan 的已知陷阱 ③）。
# ⛔ 前置缺一即 not-evaluated（return 0 由调用方按取值报，⛔ 不 crash、也不写记录）。
step_ac247_takeover() {
  local root="$1" qrl pre_count head_epoch i
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  echo "== ⑧ AC-247 takeover: current build takes over a ≥14-day-stalled legacy project =="
  if [ "$AC247_TAKEOVER" != "1" ]; then
    echo "  not-evaluated: --ac247-takeover 未传入（未尝试 ≠ 不合格）"
    return 0
  fi
  if [ -z "$root" ] || [ ! -d "$root" ]; then
    echo "  not-evaluated: --takeover-root 不是目录: ${root:-<empty>}" >&2
    return 0
  fi
  if [ ! -f "$root/.quay/config.yml" ]; then
    echo "  not-evaluated: $root 下没有 .quay/config.yml —— 本步骤测的是【接管存量 quay 项目】，不是新装" >&2
    return 0
  fi
  if [ ! -x "$qrl" ] && [ ! -f "$qrl" ]; then
    echo "  not-evaluated: 交付物 CLI 不在 $qrl ⇒ 无接管入口（段① 未完成？）" >&2
    return 0
  fi

  AC247_ROOT="$root"
  AC247_HOST="$(hostname 2>/dev/null || echo '')"
  AC247_PROJECT_ROOT="$(cd "$root" && pwd -P)"
  AC247_PRE_TS_EPOCH="$(date +%s)"
  AC247_USER_INSTALL_PRE="$(ac247_probe_user_install)"
  AC247_PS_STALE_PROCS="$(ac247_ps_stale_procs)"

  # (a) pre 三件 —— 原样打印（可核），且【此刻】就把 stale_days 的两个时刻之一固定下来。
  # `|| true` 的理由：读不出时函数不打印且返回非 0，set -e 不得因此中断整个脚本——缺值要走到
  # 下面的 fail-closed 分支留下可区分痕迹，而不是让脚本静静死掉（那与「没跑」同形）。
  pre_count="$(ac247_task_store_count "$root" "$qrl" || true)"
  head_epoch="$(ac247_head_epoch "$root" || true)"
  AC247_HEAD_EPOCH="$head_epoch"
  AC247_STALE_DAYS="$(ac247_stale_days "$head_epoch" "$AC247_PRE_TS_EPOCH" || true)"
  AC247_PRE_TASK_COUNT="$pre_count"
  ac247_read_driver_status "$root" "$qrl"
  AC247_CARRIER_RECORDS_PRE="$AC247_CARRIER_RECORDS"
  echo "  [⑧a] PRE (taken BEFORE the takeover action) host=$AC247_HOST project_root=$AC247_PROJECT_ROOT"
  echo "  [⑧a] PRE user-scope quay install=$AC247_USER_INSTALL_PRE (absent|present|not-evaluated —— 三态, ⛔ 非布尔)"
  echo "  [⑧a] PRE task_store_count=${pre_count:-<unreadable>} head_epoch=${head_epoch:-<unreadable>} stale_days=${AC247_STALE_DAYS:-<unreadable>} (at epoch $AC247_PRE_TS_EPOCH)"
  echo "  [⑧a] PRE driver_alive=$AC247_DRIVER_ALIVE carrier_records=$AC247_CARRIER_RECORDS last_record_ts=${AC247_LAST_RECORD_TS:-<none>} (source: quay driver status --kind promotion --json)"
  # AC-247 AC4 的分歧留档：同刻的【进程表】读数 vs 【status 载体】读数。⛔ 记录用的是后者。
  echo "  [⑧a] PRE ps-proxy quay_procs=$AC247_PS_STALE_PROCS (⛔ 代理量, 仅供与上面的 status 读数对照; 本步骤任何字段都不由它派生)"

  # (b) 从零安装段（step①）已完成 —— 安装落在隔离前缀里，⛔ 不碰目标机的 user-scope。
  echo "  [⑧b] install segment done: delivered CLI = $qrl (isolated prefix ${STEP1_PREFIX:-<none>}, 目标机 user-scope 未被写入)"

  # (c) 接管动作：用【目标项目自己的 root】起 promotion driver。
  # ⛔ rc 只作诊断/轮询窗宽，⛔ 不作为 driver_alive 的来源（GOAL-009 AC-203 已实证 start 会
  #    打印 exit=0 而系统是死的；反向也同形——已常驻时 restart 报非 0 而 driver 是活的）。
  # ⛔ 刻意不写「命令 … 或运算 赋给 rc」的一行形（instrument-failure-check 的 FAMILY-3 是行扫描器，
  #    会把那种写法读成「管道后读退出码」并往 shrink-only 的那一族新增一条实例）；用本文件既有的
  #    set +e / 取 rc / set -e 形（同 :973/:1454 与 step_upgrade_existing 的落地基线处）。
  echo "  [⑧c] takeover action: start the project's OWN promotion driver against $root"
  set +e
  (cd "$root" && node "$qrl" driver start --kind promotion --root "$root") >/dev/null 2>&1
  AC247_DRIVER_START_RC=$?
  set -e
  echo "  [⑧c] driver start rc=$AC247_DRIVER_START_RC (⛔ 诊断量, 不是 liveness 读数)"

  # (d) 读 status 载体，轮询到 driver_alive=1 ∧ carrier_records>0（首个 round 心跳落盘需要几秒）。
  # ⛔ 不放宽到无限：「等不到」必须留下可核痕迹，而不是一个永不返回的步骤（同 ⑦b 的轮询纪律）。
  for i in $(seq 1 "$AC247_POLL_SECS"); do
    ac247_read_driver_status "$root" "$qrl"
    if [ "$AC247_DRIVER_ALIVE" = "1" ] && [ "$AC247_CARRIER_RECORDS" -gt 0 ] 2>/dev/null; then break; fi
    sleep 1
  done
  echo "  [⑧d] POST driver_alive=$AC247_DRIVER_ALIVE carrier_records=$AC247_CARRIER_RECORDS (pre=$AC247_CARRIER_RECORDS_PRE) last_record_ts=${AC247_LAST_RECORD_TS:-<none>} (poll window ${AC247_POLL_SECS}s)"

  # (e) 重读 task 数（同一实现）——接管动作不许破坏存量：post == pre。
  AC247_POST_TASK_COUNT="$(ac247_task_store_count "$root" "$qrl" || true)"
  echo "  [⑧e] POST task_store_count=${AC247_POST_TASK_COUNT:-<unreadable>} (pre=${pre_count:-<unreadable>})"

  # (f) 判定 —— 八件读数全部有效才写。每一项各自打印（⛔ 不静默跳过任何一项）。
  local ok=1 why=""
  [ -n "$AC247_HOST" ] || { ok=0; why="$why host-empty;"; }
  [ -n "$AC247_PROJECT_ROOT" ] || { ok=0; why="$why project-root-empty;"; }
  case "$pre_count" in ''|*[!0-9]*) ok=0; why="$why pre-task-count-unreadable;"; ;;
    *) [ "$pre_count" -gt 0 ] 2>/dev/null || { ok=0; why="$why pre-task-count-not-positive($pre_count);"; } ;; esac
  [ "$AC247_POST_TASK_COUNT" = "$pre_count" ] 2>/dev/null && [ -n "$pre_count" ] \
    || { ok=0; why="$why post-task-count-differs(pre=${pre_count:-<unreadable>},post=${AC247_POST_TASK_COUNT:-<unreadable>});"; }
  case "$AC247_STALE_DAYS" in ''|*[!0-9.]*) ok=0; why="$why stale-days-unreadable;"; ;;
    *) awk -v s="$AC247_STALE_DAYS" 'BEGIN{ exit !(s >= 14) }' 2>/dev/null || { ok=0; why="$why stale-days-below-14($AC247_STALE_DAYS);"; } ;; esac
  [ "$AC247_DRIVER_ALIVE" = "1" ] || { ok=0; why="$why driver-not-alive($AC247_DRIVER_ALIVE);"; }
  [ "$AC247_CARRIER_RECORDS" -gt 0 ] 2>/dev/null || { ok=0; why="$why carrier-records-not-positive($AC247_CARRIER_RECORDS);"; }

  if [ "$ok" = "1" ]; then
    if write_ac247_record "$AC247_HOST" "$AC247_PROJECT_ROOT" "$pre_count" "$AC247_POST_TASK_COUNT" \
        "$AC247_STALE_DAYS" "$AC247_DRIVER_ALIVE" "$AC247_CARRIER_RECORDS" \
        ",\"carrier_records_pre\":$AC247_CARRIER_RECORDS_PRE,\"stale_processes_ps\":$AC247_PS_STALE_PROCS,\"driver_start_rc\":$AC247_DRIVER_START_RC,\"last_record_ts\":\"${AC247_LAST_RECORD_TS}\",\"user_install_pre\":\"$AC247_USER_INSTALL_PRE\",\"head_epoch\":$AC247_HEAD_EPOCH"; then
      AC247_EVALUATED=1
      AC247_WRITTEN_THIS_RUN=1
      AC247_WRITTEN_ROOT="$AC247_PROJECT_ROOT"
      echo "  [⑧f] ac247 record written → $AC89 ✓ (host=$AC247_HOST project_root=$AC247_PROJECT_ROOT pre=$pre_count post=$AC247_POST_TASK_COUNT stale_days=$AC247_STALE_DAYS driver_alive=$AC247_DRIVER_ALIVE carrier_records=$AC247_CARRIER_RECORDS)"
    else
      echo "  [⑧f] AC247-NOT-EVALUATED: record NOT written (fail-closed: BUILD_SHA missing/non-40-hex or AC89 path empty —— 缺值≠合格)" >&2
    fi
  else
    echo "  [⑧f] AC247-NOT-EVALUATED: record NOT written (缺值≠合格):$why" >&2
    echo "        ⛔ 特别是没有写出 driver_alive=0 的记录：那会把「没查成」伪装成「查过且不合格」（硬规则 3b）" >&2
  fi
  return 0
}

# ── ⑨ AC-248 直接量读取（全部在【目标机】上读，硬规则 4b：外部可核，⛔ 不自报）──────────────────
# 下面几个小函数各自【只做一件事】，且都被 step_ac248_adr_flip 与 --selfcheck 同时驱动——
# ⛔ 不让夹具复刻一遍读数逻辑（硬规则 4 推论三：只能被夹具复刻满足的判据不算被测）。
# ⛔ 更关键的一条：**quay 侧不拥有 ADR 判定**。候选集与检查器输出一律由【目标项目自己的】
#    `scripts/check-adr.ts` 产生；quay 只做「取两个修订 → 调它的函数 → 求差集」这三件搬运工的事。
#    任何形如「quay 自己写一段正则判这个工具合不合 ADR-007」的实现都会变成自己给自己打分（硬规则 4）。

# 目标项目自己的检查器脚本（相对项目根）。⛔ 不硬编码绝对路径：路径随项目而定，这里是相对量。
ac248_checker_relpath() { printf '%s\n' 'scripts/check-adr.ts'; }

# 把某个修订物化到独立临时路径（Plan 逐字要求：`git worktree add` / `git archive` 物化，
# ⛔ 不改活树、⛔ 不靠 `git stash` 往返——stash 往返会污染活树且失败面与判据无关）。
# 物化后【必须】看到 checker 本体，否则算读不出（返回 1）：物化"成功"但缺输入 = 读不懂，
# ⛔ 不得与「跑出了结果」同形（硬规则 3b）。
ac248_materialize_rev() {
  local root="$1" rev="$2" dest="$3" rel
  [ -n "$root" ] && [ -n "$rev" ] && [ -n "$dest" ] || return 1
  rm -rf "$dest"
  mkdir -p "$dest" || return 1
  git -C "$root" archive --format=tar "$rev" 2>/dev/null | tar -x -C "$dest" 2>/dev/null || return 1
  rel="$(ac248_checker_relpath)"
  [ -f "$dest/$rel" ] || return 1
  return 0
}

# 目标项目自己的检查器 CLI 跑一次（该项目的 npm script `check:adr` 正文逐字就是这一条 node 命令）。
# cwd = 物化树 ⇒ 读的是【该修订】的输入。运行输出落到 $2.stdout / $2.stderr，命令形态写到 $2.source。
# ⛔ 不走 `npm run`：物化树里没有 node_modules，npm 的间接层只引入与该判据无关的失败面；
#    脚本体本身即那一条命令，把它逐字记进 source 字段（读数因此可被独立复算）。
# ⛔ 退出码在这里【只是留档的诊断量】，⛔ 不是判据字段——本 AC 的靶子缺陷正是「exit 0 与合格同形」。
ac248_run_checker_cli() {
  local tree="$1" outp="$2" rc=0
  if ( cd "$tree" && "$VC_NODE" --no-warnings --experimental-strip-types scripts/check-adr.ts ) \
       >"$outp.stdout" 2>"$outp.stderr"; then rc=0; else rc=$?; fi
  printf '%s\n' 'node --experimental-strip-types scripts/check-adr.ts' > "$outp.source"
  printf '%s\n' "$rc"
}

# 检查器【自己的】候选集 = 它 scan 出来的 MCP 工具名集合。
# ⛔ quay 侧不重新实现 ADR-007 的扫描：直接调用目标项目检查器脚本里那个【决定候选集的导出函数】
#    （`check-adr.ts` 的 `extractMcpToolNames`），读数即该函数的返回值——这就是「谁的判定谁拥有」。
# 读不出（脚本缺 / 该导出不存在 / 模块加载失败 / 输出不是 JSON 数组）⇒ ⛔ 不打印、返回 1
# （硬规则 3b：读不懂 ≠ 合格，也 ≠ 空集——空集会让差集算法安静地少算一个工具）。
# ⚠️ 必须【在物化树里跑】（cd "$tree"）：真实检查器按 `process.cwd()` 定位它要扫的目录，在别处跑
#    会安静地扫到【另一个项目】（或什么都扫不到）⇒ 空候选集与「该修订没有工具」同形。实测 2026-09-12：
#    第一版漏了 cd，对 archguard 的真实检查器读到 0 个工具（而工作树里是 32 个），且退出码 0。
ac248_candidate_set() {
  local tree="$1" rel out
  rel="$(ac248_checker_relpath)"
  [ -n "$tree" ] && [ -f "$tree/$rel" ] || return 1
  out="$( cd "$tree" && AC248_CHECKER="$tree/$rel" "$VC_NODE" --no-warnings --experimental-strip-types \
            --input-type=module -e '
    const m = await import(process.env.AC248_CHECKER);
    if (typeof m.extractMcpToolNames !== "function") process.exit(3);
    process.stdout.write(JSON.stringify(m.extractMcpToolNames()));
  ' 2>/dev/null )" || return 1
  printf '%s' "$out" | "$VC_NODE" --no-warnings -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s);
            if (!Array.isArray(j)) process.exit(1);
            process.stdout.write(JSON.stringify(j)); process.exit(0); } catch {}
      process.exit(1);
    });' || return 1
}

# JSON 布尔字面量的【取值集合校验】（fail-closed）：criterion 用 `is False` / `is True`，
# 故 0 / 1 / "false" / "true"（带引号的字符串）/ 空 / 缺字段 / null 全都取不到真 ⇒ 一律拒收。
# ⛔ 本函数只【校验调用方传来的读数】，⛔ 不产生任何值、更不是「字段默认值」。
ac248_json_bool_ok() { [ "$1" = true ] || [ "$1" = false ]; }

# 翻转方向判据：只接受 false → true。⛔ 反向（true → false）不是「翻转」而是「修坏了」，
# 必须拒收（Plan 负控制 a：反向 ⇒ 零记录）。字面量只出现在这两个判定助手里，
# `write_ac248_record` 体内因此不含任何字面量默认值（AC2 的 grep 判据就钉在这里）。
ac248_flip_is_forward() { [ "$1" = false ] && [ "$2" = true ]; }

# produced_by_driver 的取值校验（契约同 AC-207/AC-239：只有 JSON 字面量 true 才算「出自 driver 的产出」）。
# ⛔ 单独成函数是为了让 `write_ac248_record` 体内【不含任何 true/false 字面量】——AC2 要求写入路径上
# 不存在硬编码默认值；字面量只允许出现在判定助手里（自检 `ac248-writer-literal-hits=0` 钉住这一点）。
ac248_produced_by_driver_ok() { [ "$1" = true ]; }

# 把 1/0 读数映射成 JSON 布尔字面量（调用点因此不必写死 `"true"`——AC2：写入路径上每个字段都是读数，
# ⛔ 没有常量）。⛔ 单独成函数同上：字面量只在这一个映射点出现。
ac248_produced_by_driver_json() { if [ "$1" = "1" ]; then printf '%s' true; else printf '%s' false; fi; }

# ── ⑨ AC-248 修复前修订（落档 pre-head）─────────────────────────────────────────────────────
# ⛔【不取 <impl>^】——实测 2026-09-12（ad-arm1 的 archguard TASK-88）：一次修复由【多个提交】组成时，
#    `ac207_select_implementation_commit` 选中的是最新一条（`886f40f4`，只改了测试文件），而它的 parent
#    `eeadae3a` 已经带着真正的修复 ⇒ 两个修订的候选集【逐字相同】⇒ 差集为空 ⇒ 无探针 ⇒ 无记录。
#    fail-closed 的方向是对的，但它拒的是一个【真实完成且确实让检查器翻转】的修复 —— 判据把合格读成
#    不合格（硬规则 4 的同族：读数在条件成立时取假）。
# ⇒ pre 取【整段修复序列之前】那个修订：从实现提交沿第一父回溯，走过的都是【非记账】提交（与 AC-207
#    同一套按位置判据），停在第一条【记账】提交上 —— 那条就是 pre（在 quay 驱动的项目里，driver 每轮
#    都落记账提交，故修复段与历史之间必有这样一条边界）。
# ⛔ 这是一条【事先声明】的确定性规则，不是「取那个能算出差集的」（那是挑答案，硬规则 4）。
# ⛔ 上界 50 步：找不到记账边界 ⇒ 返回非 0，调用方退化成 `<impl>^` 并【如实记录来源】（可区分，不静默）。
AC248_PRE_REV_SPAN=0                         # pre..impl 之间的提交数（留档：pre 是整段修复之前还是紧邻）
AC248_PRE_REV_SOURCE=""                      # fix-series-boundary | recorded-pre-head | parent-fallback | not-an-ancestor
ac248_pre_rev() {
  local root="$1" sha="$2" cur prev span=0 limit=50
  [ -n "$root" ] && [ -n "$sha" ] || return 1
  cur="$sha"
  while [ "$span" -lt "$limit" ]; do
    prev="$(git -C "$root" rev-parse --verify --quiet "${cur}^" 2>/dev/null || true)"
    [ -n "$prev" ] || return 1
    if ac207_is_bookkeeping_commit "$root" "$prev"; then
      printf '%s\n' "$prev"
      return 0
    fi
    cur="$prev"
    span=$((span + 1))
  done
  return 1
}

# ── ⑨ AC-248 翻转读数（git 树 in → 三个直接量 out）─────────────────────────────────────────
# 入参 $1 = 项目根、$2 = 实现提交 sha、$3 = 临时工作目录（调用方负责清理）。
# 产出（全部由【目标项目自己的】检查器产生，⛔ 无一个字面量）：
#   AC248_PRE_REV            = 修复前修订（默认 = 修复序列之前那条【记账】边界；见 ac248_pre_rev）
#   AC248_BEFORE_TOOLS_JSON / AC248_AFTER_TOOLS_JSON = 两个修订上的候选集原文（原始读数留档）
#   AC248_BEFORE_CLI_RC / AC248_AFTER_CLI_RC / AC248_BEFORE_CLI / AC248_AFTER_CLI / AC248_CLI_SOURCE
#                            = 两次检查器运行的退出码与 stdout+stderr 原文（「这两条布尔来自真实读数」的证据）
#   AC248_PROBE_TOOL         = after 候选集 ∖ before 候选集 里取一个（排序后第一个 ⇒ 确定、可复算）
#   AC248_BEFORE_DETECTS / AC248_AFTER_DETECTS = 探针【是否在各自候选集里】的两个读数
# ⛔ 恒返回 0：读不出体现在取值为空，由调用方走 fail-closed 分支留下可区分痕迹
#    （set -e 下中途 return 非 0 会让脚本静静死掉，那与「没跑」同形）。
ac248_adr_flip_reading() {
  local root="$1" sha="$2" tmp="$3" prerev_arg="${4:-}"
  local pre_t post_t
  AC248_PRE_REV=""; AC248_BEFORE_TOOLS_JSON=""; AC248_AFTER_TOOLS_JSON=""
  AC248_PROBE_TOOL=""; AC248_BEFORE_DETECTS=""; AC248_AFTER_DETECTS=""
  AC248_BEFORE_CLI=""; AC248_AFTER_CLI=""; AC248_CLI_SOURCE=""
  AC248_BEFORE_CLI_RC=""; AC248_AFTER_CLI_RC=""
  AC248_PRE_REV_SPAN=0; AC248_PRE_REV_SOURCE=""
  [ -n "$root" ] && [ -n "$sha" ] && [ -n "$tmp" ] || return 0
  pre_t="$tmp/pre"; post_t="$tmp/post"
  # 修复前修订：⛔ 不取 <impl>^（见 ac248_pre_rev 的头注释），默认取【整段修复序列之前】的记账边界。
  if [ -n "$prerev_arg" ]; then
    AC248_PRE_REV="$prerev_arg"
    AC248_PRE_REV_SOURCE="recorded-pre-head"
  else
    AC248_PRE_REV="$(ac248_pre_rev "$root" "$sha" || true)"
    if [ -n "$AC248_PRE_REV" ]; then
      AC248_PRE_REV_SOURCE="fix-series-boundary"
    else
      AC248_PRE_REV="$(git -C "$root" rev-parse --verify --quiet "${sha}^" 2>/dev/null || true)"
      if [ -n "$AC248_PRE_REV" ]; then AC248_PRE_REV_SOURCE="parent-fallback"; fi
    fi
  fi
  [ -n "$AC248_PRE_REV" ] || return 0
  # pre 必须是 impl 的祖先（⛔ 传入的 pre-head 不采信：不是祖先 ⇒ 视为读不出，不写记录）。
  if ! git -C "$root" merge-base --is-ancestor "$AC248_PRE_REV" "$sha" 2>/dev/null; then
    AC248_PRE_REV=""; AC248_PRE_REV_SOURCE="not-an-ancestor"; return 0
  fi
  AC248_PRE_REV_SPAN="$(git -C "$root" rev-list --count "${AC248_PRE_REV}..${sha}" 2>/dev/null || true)"
  case "$AC248_PRE_REV_SPAN" in ''|*[!0-9]*) AC248_PRE_REV_SPAN=0 ;; esac
  mkdir -p "$tmp" || return 0
  ac248_materialize_rev "$root" "$AC248_PRE_REV" "$pre_t" || return 0
  ac248_materialize_rev "$root" "$sha" "$post_t" || return 0
  AC248_BEFORE_TOOLS_JSON="$(ac248_candidate_set "$pre_t" || true)"
  AC248_AFTER_TOOLS_JSON="$(ac248_candidate_set "$post_t" || true)"
  AC248_BEFORE_CLI_RC="$(ac248_run_checker_cli "$pre_t" "$tmp/before" || true)"
  AC248_AFTER_CLI_RC="$(ac248_run_checker_cli "$post_t" "$tmp/after" || true)"
  AC248_CLI_SOURCE="$(cat "$tmp/before.source" 2>/dev/null || true)"
  AC248_BEFORE_CLI="$(cat "$tmp/before.stdout" "$tmp/before.stderr" 2>/dev/null || true)"
  AC248_AFTER_CLI="$(cat "$tmp/after.stdout" "$tmp/after.stderr" 2>/dev/null || true)"
  [ -n "$AC248_BEFORE_TOOLS_JSON" ] && [ -n "$AC248_AFTER_TOOLS_JSON" ] || return 0
  # 差分：新进入候选集的工具名（确定化：排序后取第一个）。
  AC248_PROBE_TOOL="$(AC248_B="$AC248_BEFORE_TOOLS_JSON" AC248_A="$AC248_AFTER_TOOLS_JSON" python3 -c '
import json, os
b = set(json.loads(os.environ["AC248_B"])); a = set(json.loads(os.environ["AC248_A"]))
new = sorted(a - b)
print(new[0] if new else "")
' 2>/dev/null || true)"
  [ -n "$AC248_PROBE_TOOL" ] || return 0
  AC248_BEFORE_DETECTS="$(AC248_S="$AC248_BEFORE_TOOLS_JSON" AC248_P="$AC248_PROBE_TOOL" python3 -c '
import json, os
print("true" if os.environ["AC248_P"] in set(json.loads(os.environ["AC248_S"])) else "false")
' 2>/dev/null || true)"
  AC248_AFTER_DETECTS="$(AC248_S="$AC248_AFTER_TOOLS_JSON" AC248_P="$AC248_PROBE_TOOL" python3 -c '
import json, os
print("true" if os.environ["AC248_P"] in set(json.loads(os.environ["AC248_S"])) else "false")
' 2>/dev/null || true)"
  return 0
}

# ── ⑨ AC-248 八件直接量读取（与 AC-207 同源同读法；复用【AC 编号无关的】通用辅助）──────────────
# ⛔ 不复刻 ac207_select_implementation_commit / ac207_commit_files / ac207_files_to_json——复刻出来的绿
#    不证明产品绿（硬规则 4 推论三）；⛔ 也不借用 AC207_* 变量，否则两条 AC 无法分别 pass/fail。
probe_ac248_measures() {
  local root="$1" task_id="$2" qrl="$3" status_json _ac248_files tmp
  AC248_EVALUATED=0
  AC248_COMMIT_SHA=""; AC248_COMMIT_FILES_JSON=""; AC248_TASK_STATUS=""
  AC248_GATE_EVENTS=-1; AC248_PRODUCED_BY_DRIVER=0
  AC248_PRE_REV=""; AC248_PROBE_TOOL=""; AC248_BEFORE_DETECTS=""; AC248_AFTER_DETECTS=""
  [ -n "$root" ] || return 0
  [ -n "$task_id" ] || return 0
  # commit_sha / commit_files：与 AC-207 同一读法（按位置排除记账提交与机械前缀）。
  AC248_COMMIT_SHA="$(ac207_select_implementation_commit "$root" || true)"
  if [ -n "$AC248_COMMIT_SHA" ]; then
    mapfile -t _ac248_files < <(ac207_commit_files "$root" "$AC248_COMMIT_SHA")
    AC248_COMMIT_FILES_JSON="$(ac207_files_to_json "${_ac248_files[@]}")"
  fi
  status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --json) 2>/dev/null || true)"
  AC248_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
  ' 2>/dev/null)"
  if [ -f "$root/.quay/gate-events.jsonl" ]; then
    AC248_GATE_EVENTS="$(wc -l < "$root/.quay/gate-events.jsonl" 2>/dev/null | tr -d ' ' || echo 0)"
  else
    AC248_GATE_EVENTS=0
  fi
  if [ "$AC248_TASK_STATUS" = "done" ] && [ "$AC248_GATE_EVENTS" -gt 0 ] 2>/dev/null && [ -n "$AC248_COMMIT_SHA" ]; then
    local ac248_branches ac248_subjects
    ac248_branches="$(git -C "$root" branch --list "task/$task_id" 2>/dev/null || true)"
    ac248_subjects="$(git -C "$root" log --all --format='%s' 2>/dev/null || true)"
    case "$ac248_branches" in *"task/$task_id"*) AC248_PRODUCED_BY_DRIVER=1 ;; esac
    case "$ac248_subjects" in *"$task_id"*) AC248_PRODUCED_BY_DRIVER=1 ;; esac
  fi
  tmp="$(mktemp -d 2>/dev/null || true)"
  if [ -n "$tmp" ]; then
    ac248_adr_flip_reading "$root" "$AC248_COMMIT_SHA" "$tmp" "${AC248_PRE_REV_ARG:-}"
    rm -rf "$tmp"
  fi
  AC248_EVALUATED=1
}

# ── ⑨ AC-248 记录写（fail-closed，硬规则 3b）──────────────────────────────────────────────
# 经 ac89_append_goal009 统一补 top-level build_sha/ts（AC-214 唯一补锚 choke point）——⛔ 本函数体内
# 不出现 `build_sha` 字面量，也【不出现 adr_check_* 三个字段的字面量默认值】：两个布尔必须原样来自
# ac248_adr_flip_reading 的两次真实读数（`$before` / `$after` 不加引号地写进 JSON ⇒ JSON 布尔），
# probe tool 必须来自候选集差集。任一无效 ⇒ 不写、return 1（缺值≠合格，也≠静默跳过）。
write_ac248_record() {
  local host="$1" project_root="$2" commit_sha="$3" task_id="$4" task_status="$5" gate_events="$6"
  local produced_by_driver="$7" commit_files_json="${8:-}" before="${9:-}" after="${10:-}"
  local probe="${11:-}" extras_json="${12:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$commit_sha" ] || return 1
  [ -n "$task_id" ] || return 1
  [ "$task_status" = "done" ] || return 1
  [ "$gate_events" -gt 0 ] 2>/dev/null || return 1
  ac248_produced_by_driver_ok "$produced_by_driver" || return 1
  [ -n "$commit_files_json" ] || return 1
  ac248_json_bool_ok "$before" || return 1
  ac248_json_bool_ok "$after" || return 1
  ac248_flip_is_forward "$before" "$after" || return 1
  [ -n "$probe" ] || return 1
  # 记账自证（按位置，与 AC-207/AC-239 同一判定）：文件列表必须至少含一条【不在 tasks/goals/.quay
  # 之下】的路径——否则「只翻了状态、没有实现」会被写成一次「能让外部判据翻转的修复」。
  printf '%s' "$commit_files_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let f; try { f=JSON.parse(s); } catch { process.exit(1); }
      if (!Array.isArray(f) || f.length===0) process.exit(1);
      process.exit(f.some(p => !/^(tasks|goals|\.quay)\//.test(String(p))) ? 0 : 1);
    });' || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-016-AC-248\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"commit_sha\":\"$commit_sha\",\"commit_files\":$commit_files_json,\"task_id\":\"$task_id\",\"task_status\":\"$task_status\",\"gate_events\":$gate_events,\"produced_by_driver\":$produced_by_driver,\"adr_check_before_detects\":$before,\"adr_check_after_detects\":$after,\"adr_check_probe_tool\":\"$probe\"${extras_json}"
}

# ── ⑨ AC-248 步骤（GOAL-016-AC-248）──────────────────────────────────────────────────────
# 顺序固定：① 读八件（与 AC-207 同源）→ ② 由实现提交推出 pre 修订 → ③ 两个修订各自物化到独立临时
# 路径 → ④ 各跑一次目标项目自己的检查器（候选集 + CLI 原文）→ ⑤ 求差集得 probe tool → ⑥ 十一件
# 全部有效才写记录；任缺 ⇒ ⛔ 不写 + 可区分 NOT-EVALUATED + 退出非 0。
# ⛔ 不产生记录的那些形态各自留一行可区分的痕迹（尤其「差集为空」= 修复没有让任何工具新进入候选集
#    ⇒ 无探针 ⇒ 无记录），⛔ 不退化成写一条 adr_check_after_detects=false 的记录充数。
step_ac248_adr_flip() {
  local root="$1" qrl extras ok=1 why=""
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  echo "== ⑨ AC-248 adr-check flip: the target project's OWN checker must newly see a tool it used to miss =="
  if [ "$AC248_ADR_FLIP" != "1" ]; then
    echo "  not-evaluated: --ac248-adr-flip 未传入（未尝试 ≠ 不合格）"
    return 0
  fi
  if [ -z "$root" ] || [ ! -d "$root" ]; then
    echo "  not-evaluated: --target-root 不是目录: ${root:-<empty>}" >&2
    return 0
  fi
  if [ ! -f "$root/.quay/config.yml" ]; then
    echo "  not-evaluated: $root 下没有 .quay/config.yml —— 本步骤测的是【被 quay 驱动的存量项目】，不是新装" >&2
    return 0
  fi
  if [ -z "${AC248_TASK_ID_ARG:-}" ]; then
    echo "  not-evaluated: --task-id 未传入 ⇒ 不知道该读哪条任务的产出（⛔ 不猜、不取最新一条）" >&2
    return 0
  fi
  AC248_ROOT="$root"
  AC248_HOST="$(hostname 2>/dev/null || echo '')"
  AC248_PROJECT_ROOT="$(cd "$root" && pwd -P)"
  AC248_TASK_ID="$AC248_TASK_ID_ARG"
  echo "  [⑨] host=$AC248_HOST project_root=$AC248_PROJECT_ROOT task_id=$AC248_TASK_ID"
  probe_ac248_measures "$root" "$AC248_TASK_ID" "$qrl"

  echo "  [⑨a] 八件（与 AC-207 同源）: task_status=${AC248_TASK_STATUS:-<unreadable>} commit_sha=${AC248_COMMIT_SHA:0:12} gate_events=$AC248_GATE_EVENTS produced_by_driver=$AC248_PRODUCED_BY_DRIVER"
  echo "  [⑨a] commit_files=$AC248_COMMIT_FILES_JSON"
  echo "  [⑨b] 修复前修订 pre_rev=${AC248_PRE_REV:0:12} source=${AC248_PRE_REV_SOURCE:-<unreadable>} span=${AC248_PRE_REV_SPAN} commit(s) （默认 = 实现提交之前那条【记账】边界，⛔ 不是 <impl>^：一次修复可由多个提交组成）"
  echo "  [⑨c] before 候选集（目标项目自己的检查器在 pre 修订上 scan 出的工具名，${#AC248_BEFORE_TOOLS_JSON} 字节）: $AC248_BEFORE_TOOLS_JSON"
  echo "  [⑨c] after  候选集（同一检查器在实现提交上）                                            : $AC248_AFTER_TOOLS_JSON"
  echo "  [⑨d] 检查器 CLI（${AC248_CLI_SOURCE:-<unreadable>}）: before rc=${AC248_BEFORE_CLI_RC:-<unreadable>} after rc=${AC248_AFTER_CLI_RC:-<unreadable>}"
  echo "  [⑨d] before stdout+stderr 原文:"; printf '%s\n' "${AC248_BEFORE_CLI:-<unreadable>}" | sed 's/^/        | /'
  echo "  [⑨d] after  stdout+stderr 原文:"; printf '%s\n' "${AC248_AFTER_CLI:-<unreadable>}" | sed 's/^/        | /'
  echo "  [⑨e] probe_tool=${AC248_PROBE_TOOL:-<none>} before_detects=${AC248_BEFORE_DETECTS:-<unreadable>} after_detects=${AC248_AFTER_DETECTS:-<unreadable>}"

  # ⑨f 判定 —— 十一件读数全部有效才写。每一项各自打印（⛔ 不静默跳过任何一项）。
  [ -n "$AC248_HOST" ] || { ok=0; why="$why host-empty;"; }
  [ -n "$AC248_PROJECT_ROOT" ] || { ok=0; why="$why project-root-empty;"; }
  [ -n "$AC248_TASK_ID" ] || { ok=0; why="$why task-id-empty;"; }
  [ "$AC248_TASK_STATUS" = "done" ] || { ok=0; why="$why task-not-done(${AC248_TASK_STATUS:-<unreadable>});"; }
  [ "$AC248_GATE_EVENTS" -gt 0 ] 2>/dev/null || { ok=0; why="$why gate-events-not-positive($AC248_GATE_EVENTS);"; }
  [ "$AC248_PRODUCED_BY_DRIVER" = "1" ] || { ok=0; why="$why not-produced-by-driver;"; }
  [ -n "$AC248_COMMIT_SHA" ] || { ok=0; why="$why no-implementation-commit;"; }
  [ -n "$AC248_PRE_REV" ] || { ok=0; why="$why pre-rev-unreadable;"; }
  [ -n "$AC248_PROBE_TOOL" ] || { ok=0; why="$why no-probe-tool(候选集差集为空——修复没让任何工具新进入候选集，或某一侧候选集读不出);"; }
  ac248_json_bool_ok "$AC248_BEFORE_DETECTS" || { ok=0; why="$why before-detects-unreadable;"; }
  ac248_json_bool_ok "$AC248_AFTER_DETECTS" || { ok=0; why="$why after-detects-unreadable;"; }
  ac248_flip_is_forward "$AC248_BEFORE_DETECTS" "$AC248_AFTER_DETECTS" \
    || { ok=0; why="$why flip-not-forward(before=${AC248_BEFORE_DETECTS:-<unreadable>},after=${AC248_AFTER_DETECTS:-<unreadable>});"; }

  if [ "$ok" = "1" ]; then
    # 附加留档字段（⛔ 非判据）：两次候选集原文 / 两次检查器运行原文与退出码 / 命令形态 / pre 修订。
    # 经 python3 组 JSON（⛔ 不拼字符串）：运行原文含换行与引号，手拼必产生非法 JSON。
    extras="$(AC248_PRE="$AC248_PRE_REV" AC248_SRCSRC="$AC248_PRE_REV_SOURCE" AC248_SPAN="$AC248_PRE_REV_SPAN" \
              AC248_B="$AC248_BEFORE_TOOLS_JSON" AC248_A="$AC248_AFTER_TOOLS_JSON" \
              AC248_SRC="$AC248_CLI_SOURCE" AC248_BRC="$AC248_BEFORE_CLI_RC" AC248_ARC="$AC248_AFTER_CLI_RC" \
              AC248_BC="$AC248_BEFORE_CLI" AC248_AC="$AC248_AFTER_CLI" python3 -c '
import json, os
def cut(s, n=4000):
    return s if len(s) <= n else s[:n] + "\n…[truncated]"
e = [("adr_check_pre_rev", os.environ["AC248_PRE"]),
     ("adr_check_pre_rev_source", os.environ["AC248_SRCSRC"]),
     ("adr_check_pre_rev_span", int(os.environ["AC248_SPAN"] or "0")),
     ("adr_check_before_tools", json.loads(os.environ["AC248_B"] or "[]")),
     ("adr_check_after_tools", json.loads(os.environ["AC248_A"] or "[]")),
     ("adr_check_checker_command", os.environ["AC248_SRC"]),
     ("adr_check_before_cli_rc", os.environ["AC248_BRC"]),
     ("adr_check_after_cli_rc", os.environ["AC248_ARC"]),
     ("adr_check_before_cli", cut(os.environ["AC248_BC"])),
     ("adr_check_after_cli", cut(os.environ["AC248_AC"]))]
print("," + ",".join(json.dumps(k) + ":" + json.dumps(v) for k, v in e))
' 2>/dev/null || true)"
    if write_ac248_record "$AC248_HOST" "$AC248_PROJECT_ROOT" "$AC248_COMMIT_SHA" "$AC248_TASK_ID" \
         "done" "$AC248_GATE_EVENTS" "$(ac248_produced_by_driver_json "$AC248_PRODUCED_BY_DRIVER")" "$AC248_COMMIT_FILES_JSON" \
         "$AC248_BEFORE_DETECTS" "$AC248_AFTER_DETECTS" "$AC248_PROBE_TOOL" "$extras"; then
      AC248_EVALUATED=1
      AC248_WRITTEN_THIS_RUN=1
      AC248_WRITTEN_ROOT="$AC248_PROJECT_ROOT"
      echo "  [⑨f] ac248 record written → $AC89 ✓ (probe_tool=$AC248_PROBE_TOOL before=$AC248_BEFORE_DETECTS after=$AC248_AFTER_DETECTS pre_rev=${AC248_PRE_REV:0:12} commit_sha=${AC248_COMMIT_SHA:0:12})"
    else
      echo "  [⑨f] AC248-NOT-EVALUATED: record NOT written (fail-closed: BUILD_SHA missing/non-40-hex 或 AC89 路径空 或 记账提交/字段无效 —— 缺值≠合格)" >&2
    fi
  else
    echo "  [⑨f] AC248-NOT-EVALUATED: record NOT written (缺值≠合格):$why" >&2
    echo "        ⛔ 特别是没有写出 adr_check_after_detects=false 的记录：那会把「没查成」伪装成「查过且未翻转」（硬规则 3b）" >&2
  fi
  return 0
}

# ── ⑩ AC-250（GOAL-016）：观察面 —— serve 真绑目标机 tailscale0、跨机探测、两点差分 ────────────
# 判据（goals/AC-250-*.md；本文件 ⛔ 不改判据）：载体存在 ac="GOAL-016-AC-250" 记录，且
#   host 非空 ≠ 本机 ∧ project_root ∉ 本仓库 ∧ bind_host 非空 == tailscale0_ip 且非 127./0.0.0.0/::/localhost
#   ∧ probe_from_host 非空 ≠ host ∧ http_status == 200 ∧ observed_task_id 非空 ∧
#   observed_status_before/after 均非空且【互不相等】 ∧ store_status_after == observed_status_after。
# ⛔ 与最近的近亲 AC-234（write_ac234_record）【形态逐条相反】⇒ 不复用它、也不借它的变量/字段：
#   AC-234 用 `--host 127.0.0.1`（bind_host 结构上不可能等于 tailscale0 IP——这同时是一条现成负控制）、
#   只读一次页面（单点计数）、全程同机自探（无 probe_from_host）。判据正文「⛔ 不判单点渲染」正是把
#   那种机制排除在外 ⇒ AC-234 的绿不携带本条的【任何】信息。
# 三层各堵一类伪证（GOAL-016 风险 3：只证明「serve 起来 / 端口在听 / HTTP 200」与「有个 web 活着」同形）：
#   ① 绑对地址：bind_host ← 目标机 `ss -ltnp` 上该端口的【真实监听地址】（⛔ 不是 --host 实参——
#      实参是意图、监听地址是观测值，硬规则 4b），且必须 == 该机 `ip -4 addr show tailscale0`
#      推出的地址（⛔ 不硬编码 100.100.148.48：判据逐字要求「推导而非复制副本」）。
#   ② 跨机真可达：探测、页面解析、记录组装全部在【判读侧】（本机）完成，probe_from_host = 本机 hostname
#      ⇒ probe_from_host≠host 是机制的结构性质，⛔ 不是靠自觉。
#   ③ 反映进展：同一 observed_task_id 在两个时刻的【页面渲染状态】互不相等（⛔ 不同任务天然不同，
#      故必须同一 id —— 这是对判据的【加强】，⛔ 不改判据文件），且 store_status_after（直接读目标
#      store）与页面读数一致（堵「页面显示了一个静态快照 / 陈旧缓存」那一类）。
# 三态可区分（硬规则 3b）：AC250_OUTCOME ∈ { ok, no-change, not-evaluated:<why> } ——
#   「测了、状态未变」(no-change) 与「没测成」(not-evaluated:*) 是两种【不同】的失败，⛔ 都不得写成
#   合格记录，也⛔ 不得共用同一个取值（否则「没测成」与「测了没变化」在输出上同形）。
# ⛔ 本模式【不跑 step①】：它观测的是【目标机上已安装的】产物（--ac250-quay 指定 / 从目标机推导），
#   而 step① 装的是【判读侧】的前缀——与「目标机上那个 web 绑了什么地址」无关。产物身份经
#   quay_path/quay_sha256 两个【非判据】字段如实留档，可被独立复算。
# ⚠️ CLI 旋钮（AC250_WEB_OBSERVE / AC250_SSH / AC250_ROOT / AC250_TASK_ID_ARG / AC250_QUAY_ARG /
#    AC250_NODE_ARG / AC250_PORT / AC250_WINDOW / AC250_POLL_INTERVAL / AC250_SSH_TIMEOUT）在参数解析
#    【之前】声明（本文件上半部分，紧邻 AC248_*）——⛔ 不要在这里再写一遍：那会把解析出来的值覆盖回
#    默认值（2026-09-12 实测的静默失效）。下面是【运行期读数】变量，只在函数里被赋值/读取。
AC250_HOST=""                                # 目标机 hostname（经 ssh 读）
AC250_TAILSCALE0_RAW=""                      # `ip -4 addr show tailscale0` 输出原文（直接量）
AC250_TAILSCALE0_IP=""                       # 由上面原文【推导】出的地址（⛔ 不硬编码）
AC250_SS_RAW=""                              # `ss -ltnp` 上该端口那几行的原文（直接量）
AC250_BIND_HOST=""                           # 该端口的真实监听地址（⛔ 非 --host 实参）
AC250_PROBE_FROM_HOST=""                     # 判读侧自己的 hostname（探测必须由非目标机发起）
AC250_HTTP_STATUS=""                         # 时刻①的 HTTP 状态码（-1 = 读不出）
AC250_HTTP_STATUS_T2=""                      # 时刻②（观测到变化那一次）的 HTTP 状态码
AC250_OBSERVED_TASK_ID=""                    # 页面里被观察行的 id（= AC250_TASK_ID_ARG）
AC250_BEFORE=""                              # 该 id 在时刻①的页面渲染状态
AC250_AFTER=""                               # 该 id 在时刻②的页面渲染状态
AC250_ROW_BEFORE_RAW=""                      # 时刻①该行 HTML 原文（两行合起来证明「同一 id」）
AC250_ROW_AFTER_RAW=""                       # 时刻②该行 HTML 原文
AC250_STORE_STATUS_AFTER=""                  # 直接读目标 store 得到的该 id 状态
AC250_STORE_SOURCE=""                        # 上面那个量的来源（abi:task-view | file:tasks/<id>.md）
AC250_QUAY_RESOLVED=""                       # 目标机上实际使用的 quay CLI 路径（推不出 = 空）
AC250_NODE_RESOLVED=""                       # 目标机上实际使用的 node 解释器
AC250_QUAY_SHA256=""                         # 上面那个 quay 文件的 sha256（非判据留档）
AC250_SERVE_PID=""                           # 目标机上本步骤起的 serve 进程号（收尾用）
AC250_PAGE_URL=""                            # 被探测的 URL（留档）
AC250_T2_ELAPSED=""                          # 从时刻①到观测到变化的秒数
AC250_ROW_STATUS=""                          # ac250_lookup_row 的当前命中状态（空 = 未命中该 id）
AC250_ROW_RAW=""                             # ac250_lookup_row 的当前命中行原文
AC250_T0=""                                  # 时刻①的 UTC 时刻（留档）
AC250_OUTCOME="not-evaluated:not-run"        # ok | no-change | not-evaluated:<why>
AC250_EVALUATED=0                            # 1 = 九件读数全部取到（⛔ 与 ok 不同形，硬规则 3b）
AC250_WRITTEN_THIS_RUN=0                     # 1 = 本次真的写了一条记录
AC250_WRITTEN_ROOT=""                        # 记录写到的目标项目根（留档）

# shell 单引号转义：把任意字符串变成一个 ssh 远端可安全内插的词（⛔ 不拼裸路径）。
ac250_shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# 在目标机上跑一条命令（BatchMode：⛔ 不交互、⛔ 不挂在提示符上）。stdout 原样返回。
# `timeout` 是【防线】不是装饰：任何一次 ssh 卡住都会让整个验证静静停在某一层，而「卡住」与
# 「在跑」在输出上同形（本文件的 stdout 是唯一的进度面）。实测 2026-09-12：起 serve 的那次 ssh
# 因远端后台进程继承了 ssh 的 stdout 管道而不返回 ⇒ 脚本停在 ⑩b 之后、日志不再增长。
ac250_target() {
  [ -n "$AC250_SSH" ] || return 1
  timeout "${AC250_SSH_CMD_TIMEOUT:-30}" \
    ssh -o BatchMode=yes -o ConnectTimeout="$AC250_SSH_TIMEOUT" "$AC250_SSH" "$1" 2>/dev/null
}

# 目标机身份 + tailscale0 真实地址。两者都是直接量；地址由 `ip -4 addr show` 的原文【推导】。
# 读不出网卡 / 无 inet 行 ⇒ 地址留空（调用方 fail-closed），⛔ 不退回任何默认地址。
ac250_read_target_identity() {
  AC250_HOST=""; AC250_TAILSCALE0_RAW=""; AC250_TAILSCALE0_IP=""
  [ -n "$AC250_SSH" ] || return 0
  AC250_HOST="$(ac250_target 'hostname' | head -n1 | tr -d '\r' || true)"
  AC250_TAILSCALE0_RAW="$(ac250_target 'ip -4 addr show tailscale0' || true)"
  AC250_TAILSCALE0_IP="$(printf '%s\n' "$AC250_TAILSCALE0_RAW" \
    | sed -n 's/^[[:space:]]*inet[[:space:]]\{1,\}\([0-9][0-9.]*\)\/.*/\1/p' | head -n1)"
  return 0
}

# 目标机上 quay CLI 与 node 解释器的解析。缺省 quay = 目标项目自己的 runtime（quay-init 装进项目的那份，
# 相对项目根推导，⛔ 不写死任何宿主专属绝对路径）；两者都必须在目标机上【真实存在】（node 还要可执行），
# 否则视同读不出——⛔ 不拿一个不存在的路径去起进程（「路径拼对了」≠「文件在」）。
ac250_resolve_target_tools() {
  AC250_QUAY_RESOLVED=""; AC250_NODE_RESOLVED=""
  [ -n "$AC250_SSH" ] || return 0
  if [ -n "$AC250_NODE_ARG" ]; then
    AC250_NODE_RESOLVED="$AC250_NODE_ARG"
  else
    AC250_NODE_RESOLVED="$(ac250_target 'command -v node' | head -n1 | tr -d '\r' || true)"
  fi
  if [ -n "$AC250_QUAY_ARG" ]; then
    AC250_QUAY_RESOLVED="$AC250_QUAY_ARG"
  elif [ -n "$AC250_ROOT" ]; then
    local cand="$AC250_ROOT/.quay/runtime/bin/quay.js"
    # `|| true`：set -e 下「测试为假」这一布尔结果不得杀死脚本（缺位是正常取值，由调用方 fail-closed）。
    if [ -n "$(ac250_target "test -f $(ac250_shq "$cand") && echo yes" || true)" ]; then
      AC250_QUAY_RESOLVED="$cand"
    fi
  fi
  if [ -n "$AC250_NODE_RESOLVED" ]; then
    [ -n "$(ac250_target "test -x $(ac250_shq "$AC250_NODE_RESOLVED") && echo yes" || true)" ] || AC250_NODE_RESOLVED=""
  fi
  if [ -n "$AC250_QUAY_RESOLVED" ]; then
    [ -n "$(ac250_target "test -f $(ac250_shq "$AC250_QUAY_RESOLVED") && echo yes" || true)" ] || AC250_QUAY_RESOLVED=""
  fi
  return 0
}

# 从 `ss -ltnp` 原文里取【该端口】的真实监听地址（⛔ 不是 --host 实参：实参是意图，监听是观测值）。
# 只认 LISTEN 行里以 `:<port>` 结尾的那个本地地址字段；读不出 ⇒ 空。
ac250_listen_addr() {
  printf '%s\n' "$1" | awk -v p=":$2" '
    /^LISTEN/ {
      for (i = 1; i <= NF; i++) {
        if (length($i) > length(p) && substr($i, length($i) - length(p) + 1) == p) {
          a = substr($i, 1, length($i) - length(p))
          gsub(/^\[/, "", a); gsub(/\]$/, "", a)   # [::] → ::（同一地址的显示形态，⛔ 非改写取值）
          print a; exit
        }
      }
    }'
}

# 目标机上该端口的 LISTEN 行原文（直接量；留档用）。
ac250_read_listen() {
  ac250_target "ss -ltnp 2>/dev/null" | awk -v p=":$AC250_PORT" '
    /^LISTEN/ { for (i = 1; i <= NF; i++) if (length($i) > length(p) && substr($i, length($i) - length(p) + 1) == p) { print; next } }'
}

# 在目标机上起 quay serve：绑【该机 tailscale0 的真实地址】、cwd = 目标项目根（使 serve 解析该项目的
# .quay/config.yml）。pid 落 AC250_SERVE_PID（收尾 kill 用）。
ac250_start_serve() {
  local cmd
  AC250_SERVE_PID=""
  [ -n "$AC250_QUAY_RESOLVED" ] && [ -n "$AC250_NODE_RESOLVED" ] || return 0
  [ -n "$AC250_TAILSCALE0_IP" ] && [ -n "$AC250_ROOT" ] || return 0
  # ⚠️ 三个 fd 的重定向必须挂在【子 shell 分组】上（`( … ) >/dev/null 2>&1 </dev/null &`），
  # ⛔ 不能只挂在分组内的那条命令上：把 `&` 直接跟在 `… serve … >/dev/null 2>&1 </dev/null` 后面时，
  # 子 shell 自身仍持有 ssh 的 stdout 管道 ⇒ 长命的 serve 让 ssh 【永不返回】（实测 2026-09-12：
  # 脚本停在 ⑩b 之后、日志不再增长，而目标机上 serve 确实已经绑好地址在听——「卡住」与「在跑」同形）。
  # 分组形态实测 RETURN，且 `$!` 仍是那个长命进程的 pid（收尾 kill 用它）。
  cmd="( cd $(ac250_shq "$AC250_ROOT") && setsid nohup $(ac250_shq "$AC250_NODE_RESOLVED") $(ac250_shq "$AC250_QUAY_RESOLVED") serve --host $(ac250_shq "$AC250_TAILSCALE0_IP") --port $(ac250_shq "$AC250_PORT") ) >/dev/null 2>&1 </dev/null & echo \$!"
  AC250_SERVE_PID="$(ac250_target "$cmd" | head -n1 | tr -d '\r' || true)"
  case "$AC250_SERVE_PID" in ''|*[!0-9]*) AC250_SERVE_PID="" ;; esac
  return 0
}

# 收尾：杀掉本步骤在目标机上起的 serve（⛔ 不留给下一轮；也⛔ 不杀别人的进程）。
ac250_stop_serve() {
  [ -n "$AC250_SERVE_PID" ] || return 0
  ac250_target "kill $(ac250_shq "$AC250_SERVE_PID") 2>/dev/null; true" >/dev/null 2>&1 || true
  AC250_SERVE_PID=""
  return 0
}

# 判读侧对 `http://<tailscale0_ip>:<port>/tasks?pageSize=500` 发一次真实 HTTP 请求（⛔ 不由目标机 curl
# 自己——那会让 probe_from_host==host 成为可能）。body 落 $2，状态码落 AC250_HTTP_STATUS。
# 读不出 ⇒ -1（⛔ 不是 0、也⛔ 不是 200：缺值不该与任何一种真实状态同形）。
ac250_fetch_page() {
  AC250_HTTP_STATUS="$(curl -s -o "$2" -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo -1)"
  case "$AC250_HTTP_STATUS" in ''|*[!0-9]*) AC250_HTTP_STATUS=-1 ;; esac
  return 0
}

# 从真实渲染 HTML 里解析 (id, status) 行 —— 状态码只证明「有个 web 活着」，反映的是【内容】。
# 输出：每行 `<id>\t<status>`；无行 ⇒ 空（⛔ 不是「零个任务」这种正常态：空输出由调用方 fail-closed）。
ac250_parse_rows() {
  printf '%s' "$1" | "$VC_NODE" --no-warnings -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      const re = /<a href="\/task\/([^"?]+)[^"]*"[^>]*>[^<]*<\/a><\/td>\s*<td>([^<]*)</g;
      const out = [];
      let m;
      while ((m = re.exec(s)) !== null) {
        let id = m[1];
        try { id = decodeURIComponent(id); } catch (e) { /* 保留原文 */ }
        out.push(id + "\t" + m[2].trim());
      }
      process.stdout.write(out.join("\n"));
    });' 2>/dev/null || true
}

# 在某次页面读数里查某 id 那一行。命中 ⇒ AC250_ROW_STATUS / AC250_ROW_RAW 就位；未命中 ⇒ 两者空。
ac250_lookup_row() {
  local line
  AC250_ROW_STATUS=""; AC250_ROW_RAW=""
  line="$(printf '%s\n' "$1" | awk -F'\t' -v id="$2" '$1 == id { print; exit }')"
  [ -n "$line" ] || return 0
  AC250_ROW_RAW="$line"
  AC250_ROW_STATUS="${line#*	}"
  return 0
}

# 直接读【目标 store】得到的该任务状态（⛔ 不以页面缓存为准）。
# 读法 = 目标项目【自己的 Provider ABI】（`task view <id> --json`，经它自己的 config/provider）。
# ⛔ 不退回「猜 tasks/<id>.md 路径」：tasks_dir 是项目 config 里的可配置项（ad-arm1 的 archguard
# 实测就把它写成一条绝对路径），按文件路径猜既是错的、也是 task-file-bypass-check 判定的 ABI 绕过
# （2026-09-12 由本任务的 scoped 门当场抓到：`new bypass site`）。读不出 ⇒ 空（缺值 ≠ 合格，
# 调用方 fail-closed 走 NOT-EVALUATED）。
ac250_read_store_status() {
  local out
  AC250_STORE_STATUS_AFTER=""; AC250_STORE_SOURCE=""
  [ -n "$1" ] && [ -n "$AC250_QUAY_RESOLVED" ] || return 0
  out="$(ac250_target "cd $(ac250_shq "$AC250_ROOT") && $(ac250_shq "$AC250_NODE_RESOLVED") $(ac250_shq "$AC250_QUAY_RESOLVED") task view $(ac250_shq "$1") --json" || true)"
  AC250_STORE_STATUS_AFTER="$(printf '%s' "$out" | "$VC_NODE" --no-warnings -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s); process.stdout.write(j && typeof j.status === "string" ? j.status : ""); }
      catch (e) { process.stdout.write(""); }
    });' 2>/dev/null || true)"
  if [ -n "$AC250_STORE_STATUS_AFTER" ]; then AC250_STORE_SOURCE="abi:task-view"; fi
  return 0
}

# 回环/通配地址判定（criterion 逐字排除 127./0.0.0.0/::/localhost）。⛔ 单独成函数：`write_ac250_record`
# 体内因此不含任何【地址字面量默认值】（AC2 的 grep 判据钉在这里）。
ac250_not_loopback() {
  case "$1" in
    127.*|0.0.0.0|::|localhost) return 1 ;;
    *) return 0 ;;
  esac
}

# http_status 取值校验（criterion 算 `int(r.get("http_status") or 0) != 200` ⇒ 只有 JSON 数字 200 取到真）。
# ⛔ 先做【纯数字】校验再比 200：写成 `[ "$1" = "200" ]` 会被任何非数字的字面量字符串绕过（`http_200`），
#    而字段在记录里以【不加引号】的形态写出 ⇒ 非数字值会产出非法 JSON（真跑一次才发现，2026-09-12）。
# ⛔ 这是【校验】不是默认值：本函数不产生任何值，只拒收调用方传来的读数 —— 字面量只允许出现在这里。
ac250_http_status_ok() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -eq 200 ]
}

# ── ⑩ AC-250 记录写（fail-closed，硬规则 3b）────────────────────────────────────────────────
# 经 ac89_append_goal009 统一补 top-level build_sha/ts（AC-214 唯一补锚 choke point）——⛔ 本函数体内
# 不出现 `build_sha` 字面量（多一个补锚点 = 下次改锚格式必漏一处）。
# 七个判据字段与 goal 的 criterion 是【同一组谓词的两侧】（改动须同步）：
#   host 非空 · project_root 非空 · bind_host 非空 == tailscale0_ip 且非回环 · probe_from_host 非空 ≠ host ·
#   http_status == 200 · observed_task_id 非空 · before/after 非空且互不相等 · store_status_after == after。
# ⛔ 任一条不成立 ⇒ 一条都不写、return 1。特别是：⛔ 不写一条「状态未变」的记录充数——那会把
#    「测了没变化」与「合格」在载体上同形（硬规则 3b 的镜像半边，本 AC 的 Plan 逐字点名）。
write_ac250_record() {
  local host="$1" project_root="$2" bind_host="$3" ts_ip="$4" probe_from="$5"
  local http_status="$6" task_id="$7" before="$8" after="$9" store_after="${10}" extras_json="${11:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$bind_host" ] || return 1
  [ -n "$ts_ip" ] || return 1
  [ "$bind_host" = "$ts_ip" ] || return 1
  ac250_not_loopback "$bind_host" || return 1
  [ -n "$probe_from" ] || return 1
  [ "$probe_from" != "$host" ] || return 1
  ac250_http_status_ok "$http_status" || return 1
  [ -n "$task_id" ] || return 1
  [ -n "$before" ] || return 1
  [ -n "$after" ] || return 1
  [ "$before" != "$after" ] || return 1
  [ "$store_after" = "$after" ] || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-016-AC-250\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"bind_host\":\"$bind_host\",\"tailscale0_ip\":\"$ts_ip\",\"probe_from_host\":\"$probe_from\",\"http_status\":$http_status,\"observed_task_id\":\"$task_id\",\"observed_status_before\":\"$before\",\"observed_status_after\":\"$after\",\"store_status_after\":\"$store_after\"${extras_json}"
}

# 非判据留档字段（两段原文 / URL / 两次读数行 / store 来源 / 产物身份 / 窗口）。经 python3 组 JSON
# （⛔ 不拼字符串：原文含换行与引号，手拼必产生非法 JSON）。
ac250_extras_json() {
  AC250_T0="$AC250_T0" AC250_TSIP="$AC250_TAILSCALE0_IP" AC250_TSRAW="$AC250_TAILSCALE0_RAW" \
  AC250_SSRAW="$AC250_SS_RAW" AC250_URL="$AC250_PAGE_URL" AC250_H1="$AC250_HTTP_STATUS" \
  AC250_H2="$AC250_HTTP_STATUS_T2" AC250_R1="$AC250_ROW_BEFORE_RAW" AC250_R2="$AC250_ROW_AFTER_RAW" \
  AC250_SSRC="$AC250_STORE_SOURCE" AC250_QP="$AC250_QUAY_RESOLVED" AC250_QH="$AC250_QUAY_SHA256" \
  AC250_NP="$AC250_NODE_RESOLVED" AC250_WIN="$AC250_WINDOW" AC250_EL="$AC250_T2_ELAPSED" \
  AC250_PF="$AC250_PROBE_FROM_HOST" python3 -c '
import json, os
def cut(s, n=4000):
    s = s or ""
    return s if len(s) <= n else s[:n] + "\n…[truncated]"
def num(s, d=None):
    try: return int(s)
    except Exception: return d
e = [("ac250_tailscale0_addr", os.environ["AC250_TSIP"]),
     ("ac250_tailscale0_ip_addr_raw", cut(os.environ["AC250_TSRAW"])),
     ("ac250_listen_raw", cut(os.environ["AC250_SSRAW"])),
     ("ac250_page_url", os.environ["AC250_URL"]),
     ("ac250_http_status_t1", num(os.environ["AC250_H1"])),
     ("ac250_http_status_t2", num(os.environ["AC250_H2"])),
     ("ac250_row_before", os.environ["AC250_R1"]),
     ("ac250_row_after", os.environ["AC250_R2"]),
     ("ac250_store_read_source", os.environ["AC250_SSRC"]),
     ("ac250_quay_path", os.environ["AC250_QP"]),
     ("ac250_quay_sha256", os.environ["AC250_QH"]),
     ("ac250_node_path", os.environ["AC250_NP"]),
     ("ac250_probe_host", os.environ["AC250_PF"]),
     ("ac250_window_seconds", num(os.environ["AC250_WIN"], 0)),
     ("ac250_seconds_to_change", num(os.environ["AC250_EL"]))]
print("," + ",".join(json.dumps(k) + ":" + json.dumps(v) for k, v in e))
' 2>/dev/null || true
}

# ── ⑩ AC-250 步骤（GOAL-016-AC-250）──────────────────────────────────────────────────────
# 顺序固定（Plan 2）：(a) 目标机身份 + tailscale0 地址 → (b) 解析目标机 quay/node 并验它真能跑
# → (c) 用【该机自己的 tailscale0 地址】起 serve（cwd=目标项目根）→ (d) 读 `ss -ltnp` 取真实监听地址
# → (e) 判读侧取回真实 HTML、解析出被观察行的状态（时刻①）→ (f) 轮询【同一个 id】直到它的渲染状态
# 变化（时刻②）→ (g) 直接读目标 store 交叉核对 → (h) 九件全部有效才写记录。
# 任缺 ⇒ ⛔ 不写 + 可区分 NOT-EVALUATED + 退出非 0（由主流程的判定块落 exit 1）。
step_ac250_web_observe() {
  local tmp rows1 rows2 deadline now flipped=0 i why=""
  echo "== ⑩ AC-250 web observe: target serve bound to ITS tailscale0, probed from THIS host, two readings of ONE task =="
  AC250_OUTCOME="not-evaluated:not-run"; AC250_EVALUATED=0; AC250_WRITTEN_THIS_RUN=0
  AC250_HOST=""; AC250_TAILSCALE0_RAW=""; AC250_TAILSCALE0_IP=""
  AC250_SS_RAW=""; AC250_BIND_HOST=""; AC250_PROBE_FROM_HOST=""
  AC250_HTTP_STATUS=""; AC250_HTTP_STATUS_T2=""
  AC250_OBSERVED_TASK_ID=""; AC250_BEFORE=""; AC250_AFTER=""
  AC250_ROW_BEFORE_RAW=""; AC250_ROW_AFTER_RAW=""
  AC250_STORE_STATUS_AFTER=""; AC250_STORE_SOURCE=""
  AC250_QUAY_RESOLVED=""; AC250_NODE_RESOLVED=""; AC250_QUAY_SHA256=""
  AC250_SERVE_PID=""; AC250_PAGE_URL=""; AC250_T2_ELAPSED=""

  if [ "$AC250_WEB_OBSERVE" != "1" ]; then
    echo "  not-evaluated: --ac250-web-observe 未传入（未尝试 ≠ 不合格）"
    return 0
  fi
  if [ -z "$AC250_SSH" ]; then
    AC250_OUTCOME="not-evaluated:no-target-ssh"
    echo "  AC250-NOT-EVALUATED: --ac250-ssh 未传入 ⇒ 不知道该在哪台机器上读 tailscale0 / 起 serve（⛔ 不默认本机：那会让 probe_from_host==host）" >&2
    return 0
  fi
  if [ -z "$AC250_ROOT" ]; then
    AC250_OUTCOME="not-evaluated:no-target-root"
    echo "  AC250-NOT-EVALUATED: --ac250-root 未传入 ⇒ 不知道 web 指向哪个目标项目" >&2
    return 0
  fi
  if [ -z "$AC250_TASK_ID_ARG" ]; then
    AC250_OUTCOME="not-evaluated:no-observe-task"
    echo "  AC250-NOT-EVALUATED: --ac250-task 未传入 ⇒ 两点读数会各取一行，拿【不同任务】天然不同冒充进展（⛔ 不取「最新一条」）" >&2
    return 0
  fi
  tmp="$(mktemp -d 2>/dev/null || true)"
  if [ -z "$tmp" ]; then
    AC250_OUTCOME="not-evaluated:no-tmp"
    echo "  AC250-NOT-EVALUATED: 无法创建临时目录" >&2
    return 0
  fi
  AC250_PROBE_FROM_HOST="$(hostname 2>/dev/null || echo '')"
  AC250_T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # (a) 目标机身份 + tailscale0 真实地址
  ac250_read_target_identity
  echo "  [⑩a] target ssh=$AC250_SSH host=${AC250_HOST:-<unreadable>} root=$AC250_ROOT probe_from=${AC250_PROBE_FROM_HOST:-<unreadable>}"
  echo "  [⑩a] ip -4 addr show tailscale0 原文:"; printf '%s\n' "${AC250_TAILSCALE0_RAW:-<unreadable>}" | sed 's/^/        | /'
  echo "  [⑩a] tailscale0_ip=${AC250_TAILSCALE0_IP:-<unreadable>} （由上面原文推导，⛔ 非硬编码：判据要求「推导而非复制副本」）"
  if [ -z "$AC250_HOST" ] || [ -z "$AC250_TAILSCALE0_IP" ]; then
    AC250_OUTCOME="not-evaluated:target-identity-unreadable"
    echo "  AC250-NOT-EVALUATED: 目标机 hostname 或 tailscale0 地址读不出（ssh 不通 / 该机无此网卡）—— 缺值 ≠ 合格（硬规则 3b）" >&2
    rm -rf "$tmp"; return 0
  fi
  if [ "$AC250_PROBE_FROM_HOST" = "$AC250_HOST" ]; then
    AC250_OUTCOME="not-evaluated:probe-side-is-target"
    echo "  AC250-NOT-EVALUATED: 判读侧 hostname == 目标机 hostname ⇒ 本机就是目标机，跨机可达性【结构上】无法成立（Plan 2 两层判读结构）" >&2
    rm -rf "$tmp"; return 0
  fi

  # (b) 目标机工具链：路径必须在目标机上真实存在，且必须真能出版本号（⛔ 不拿一个不存在的路径去起进程）
  ac250_resolve_target_tools
  echo "  [⑩b] target tools: node=${AC250_NODE_RESOLVED:-<unreadable>} quay=${AC250_QUAY_RESOLVED:-<unreadable>}"
  if [ -z "$AC250_NODE_RESOLVED" ] || [ -z "$AC250_QUAY_RESOLVED" ]; then
    AC250_OUTCOME="not-evaluated:target-quay-unresolved"
    echo "  AC250-NOT-EVALUATED: 目标机上 quay CLI / node 解析不出（--ac250-quay 未给且项目 runtime 缺位）—— 缺值 ≠ 合格" >&2
    rm -rf "$tmp"; return 0
  fi
  local ver
  ver="$(ac250_target "$(ac250_shq "$AC250_NODE_RESOLVED") $(ac250_shq "$AC250_QUAY_RESOLVED") --version" | head -n1 | tr -d '\r' || true)"
  AC250_QUAY_SHA256="$(ac250_target "sha256sum $(ac250_shq "$AC250_QUAY_RESOLVED") 2>/dev/null | cut -d' ' -f1" | head -n1 | tr -d '\r' || true)"
  echo "  [⑩b] '$AC250_NODE_RESOLVED $AC250_QUAY_RESOLVED --version' → '${ver:-<no output>}' quay_sha256=${AC250_QUAY_SHA256:0:16}…"
  if [ -z "$ver" ]; then
    AC250_OUTCOME="not-evaluated:target-quay-unusable"
    echo "  AC250-NOT-EVALUATED: 目标机上该 quay+node 组合跑不出 --version（⛔ 路径存在 ≠ 能跑）—— 缺值 ≠ 合格" >&2
    rm -rf "$tmp"; return 0
  fi

  # (c) 起 serve：绑【该机 tailscale0 的真实地址】，cwd = 目标项目根
  AC250_PAGE_URL="http://${AC250_TAILSCALE0_IP}:${AC250_PORT}/tasks?pageSize=500"
  ac250_start_serve
  echo "  [⑩c] started on target: pid=${AC250_SERVE_PID:-<none>} bind=${AC250_TAILSCALE0_IP}:${AC250_PORT} cwd=$AC250_ROOT"
  # 等它真的在听（⛔ 不看 start 的退出码：后台进程的退出码不携带「在听」这个信息，硬规则 4b）
  for i in $(seq 1 30); do
    sleep 1
    AC250_SS_RAW="$(ac250_read_listen || true)"
    if [ -n "$AC250_SS_RAW" ]; then break; fi
  done
  AC250_BIND_HOST="$(ac250_listen_addr "$AC250_SS_RAW" "$AC250_PORT")"
  echo "  [⑩c] ss -ltnp 该端口原文:"; printf '%s\n' "${AC250_SS_RAW:-<no listener>}" | sed 's/^/        | /'
  echo "  [⑩c] bind_host=${AC250_BIND_HOST:-<unreadable>} （⛔ 非 --host 实参：实参是意图，这里是观测值）"
  if [ -z "$AC250_BIND_HOST" ]; then
    AC250_OUTCOME="not-evaluated:no-listener-on-port"
    echo "  AC250-NOT-EVALUATED: 目标机 $AC250_PORT 上读不到监听行 ⇒ web 没起来（⛔ 不拿 --host 实参充数）" >&2
    ac250_stop_serve; rm -rf "$tmp"; return 0
  fi

  # (d) 时刻①：判读侧真实 HTTP + 真实渲染 HTML 解析出的该 id 状态
  ac250_fetch_page "$AC250_PAGE_URL" "$tmp/p1.html"
  rows1="$(ac250_parse_rows "$(cat "$tmp/p1.html" 2>/dev/null || true)")"
  ac250_lookup_row "$rows1" "$AC250_TASK_ID_ARG"
  AC250_OBSERVED_TASK_ID="$AC250_TASK_ID_ARG"
  AC250_BEFORE="$AC250_ROW_STATUS"
  AC250_ROW_BEFORE_RAW="$AC250_ROW_RAW"
  echo "  [⑩d] T1 from ${AC250_PROBE_FROM_HOST:-<unreadable>} GET $AC250_PAGE_URL → http=$AC250_HTTP_STATUS bytes=$(wc -c < "$tmp/p1.html" 2>/dev/null | tr -d ' ' || echo '?')"
  echo "  [⑩d] T1 row 原文: ${AC250_ROW_BEFORE_RAW:-<页面里没有该 id 这一行>}"
  if [ "$AC250_HTTP_STATUS" != "200" ] || [ -z "$AC250_BEFORE" ]; then
    AC250_OUTCOME="not-evaluated:first-reading-unreadable"
    echo "  AC250-NOT-EVALUATED: 时刻①读不出（http=$AC250_HTTP_STATUS, 该 id 行=${AC250_ROW_BEFORE_RAW:-<absent>}）—— 缺值 ≠ 合格" >&2
    ac250_stop_serve; rm -rf "$tmp"; return 0
  fi

  # (e) 轮询【同一个 id】直到它的渲染状态变化（时刻②）。窗口内没有变化 ⇒ no-change（可区分），⛔ 不写记录。
  deadline=$(( $(date +%s) + AC250_WINDOW ))
  while :; do
    sleep "$AC250_POLL_INTERVAL"
    ac250_fetch_page "$AC250_PAGE_URL" "$tmp/p2.html"
    rows2="$(ac250_parse_rows "$(cat "$tmp/p2.html" 2>/dev/null || true)")"
    ac250_lookup_row "$rows2" "$AC250_TASK_ID_ARG"
    if [ -n "$AC250_ROW_STATUS" ] && [ "$AC250_ROW_STATUS" != "$AC250_BEFORE" ]; then
      AC250_AFTER="$AC250_ROW_STATUS"
      AC250_ROW_AFTER_RAW="$AC250_ROW_RAW"
      AC250_HTTP_STATUS_T2="$AC250_HTTP_STATUS"
      flipped=1
      break
    fi
    now="$(date +%s)"
    [ "$now" -lt "$deadline" ] || break
  done
  AC250_T2_ELAPSED="$(( $(date +%s) - (deadline - AC250_WINDOW) ))"

  # (f) 直接读目标 store 交叉核对（⛔ 不以页面缓存为准）
  if [ "$flipped" = "1" ]; then
    ac250_read_store_status "$AC250_TASK_ID_ARG"
    echo "  [⑩f] T2 row 原文: ${AC250_ROW_AFTER_RAW:-<unreadable>}  （T1 行与它是【同一个 id】：${AC250_OBSERVED_TASK_ID:-<none>}）"
    echo "  [⑩f] store_status_after=${AC250_STORE_STATUS_AFTER:-<unreadable>} source=${AC250_STORE_SOURCE:-<unreadable>} （直接读目标 store，⛔ 非页面缓存）"
  else
    echo "  [⑩e] 窗口 ${AC250_WINDOW}s 内 ${AC250_OBSERVED_TASK_ID} 的渲染状态【未变化】（仍为 '${AC250_BEFORE:-<unreadable>}'）"
  fi

  # (g) 收尾：杀 serve（⛔ 不留给下一轮）
  ac250_stop_serve

  # (h) 判定 —— 九件读数全部有效才写。每一项各自留痕（⛔ 不静默跳过任何一项）。
  if [ "$flipped" != "1" ]; then
    AC250_OUTCOME="no-change"
    echo "  [⑩h] AC250-NO-CHANGE: 测到读数了，但窗口内该任务状态【没有变化】⇒ 不是「反映进展」（⛔ 不写记录）"
    echo "        ⚠️ 这与「没测成」(not-evaluated:*) 是【两种不同的失败】，取值不同（硬规则 3b）"
    rm -rf "$tmp"; return 0
  fi
  AC250_EVALUATED=1
  [ -n "$AC250_HOST" ] || { AC250_EVALUATED=0; why="$why host-empty;"; }
  [ -n "$AC250_ROOT" ] || { AC250_EVALUATED=0; why="$why project-root-empty;"; }
  [ -n "$AC250_BIND_HOST" ] || { AC250_EVALUATED=0; why="$why bind-host-empty;"; }
  [ -n "$AC250_TAILSCALE0_IP" ] || { AC250_EVALUATED=0; why="$why tailscale0-ip-empty;"; }
  [ "$AC250_BIND_HOST" = "$AC250_TAILSCALE0_IP" ] || { AC250_EVALUATED=0; why="$why bind!=tailscale0(bind=${AC250_BIND_HOST:-<empty>},ts=${AC250_TAILSCALE0_IP:-<empty>});"; }
  ac250_not_loopback "$AC250_BIND_HOST" || { AC250_EVALUATED=0; why="$why bind-is-loopback($AC250_BIND_HOST);"; }
  [ -n "$AC250_PROBE_FROM_HOST" ] || { AC250_EVALUATED=0; why="$why probe-from-empty;"; }
  [ "$AC250_PROBE_FROM_HOST" != "$AC250_HOST" ] || { AC250_EVALUATED=0; why="$why probe-from==host;"; }
  ac250_http_status_ok "$AC250_HTTP_STATUS_T2" || { AC250_EVALUATED=0; why="$why http-status-not-200(${AC250_HTTP_STATUS_T2:-<unreadable>});"; }
  [ -n "$AC250_OBSERVED_TASK_ID" ] || { AC250_EVALUATED=0; why="$why observed-task-id-empty;"; }
  [ -n "$AC250_BEFORE" ] || { AC250_EVALUATED=0; why="$why before-empty;"; }
  [ -n "$AC250_AFTER" ] || { AC250_EVALUATED=0; why="$why after-empty;"; }
  [ "$AC250_BEFORE" != "$AC250_AFTER" ] || { AC250_EVALUATED=0; why="$why before==after($AC250_BEFORE);"; }
  [ "$AC250_STORE_STATUS_AFTER" = "$AC250_AFTER" ] || { AC250_EVALUATED=0; why="$why store!=observed(store=${AC250_STORE_STATUS_AFTER:-<unreadable>},observed=$AC250_AFTER);"; }

  if [ "$AC250_EVALUATED" = "1" ]; then
    local extras
    extras="$(ac250_extras_json)"
    if write_ac250_record "$AC250_HOST" "$AC250_ROOT" "$AC250_BIND_HOST" "$AC250_TAILSCALE0_IP" \
         "$AC250_PROBE_FROM_HOST" "$AC250_HTTP_STATUS_T2" "$AC250_OBSERVED_TASK_ID" \
         "$AC250_BEFORE" "$AC250_AFTER" "$AC250_STORE_STATUS_AFTER" "$extras"; then
      AC250_OUTCOME="ok"
      AC250_WRITTEN_THIS_RUN=1
      AC250_WRITTEN_ROOT="$AC250_ROOT"
      echo "  [⑩h] ac250 record written → $AC89 ✓ (host=$AC250_HOST bind_host=$AC250_BIND_HOST task=$AC250_OBSERVED_TASK_ID ${AC250_BEFORE}→${AC250_AFTER} store=$AC250_STORE_STATUS_AFTER probe_from=$AC250_PROBE_FROM_HOST)"
    else
      AC250_OUTCOME="not-evaluated:writer-refused"
      echo "  AC250-NOT-EVALUATED: record NOT written (fail-closed: BUILD_SHA 非 40-hex / AC89 路径空 / 或某字段无效 —— 缺值≠合格)" >&2
    fi
  else
    AC250_OUTCOME="not-evaluated:${why:-unspecified}"
    echo "  AC250-NOT-EVALUATED: record NOT written (缺值≠合格):$why" >&2
    echo "        ⛔ 特别是没有写出一条「状态未变」或「绑了回环」的记录充数——那会把「没测成」伪装成「测过」（硬规则 3b）" >&2
  fi
  rm -rf "$tmp"
  return 0
}

# ── ① 安装：隔离前缀全新 .tgz 安装 ─────────────────────────────────────────────────────────
# 判据 = 安装产物【真实可运行】：dist bundle 经 realpath 执行能跑（--version 出版本号）+ shipped
# quay-init.sh 在位。NPM_BIN_DISPATCH 是【诊断量】——npm 创建的 bin symlink 是否真的派发：
# 实测 2026-08-16（本机 develop@7d6d7b77 产物）npm 装的 quay bin symlink 因 ESM main-module guard
# （packages/quay/bin/quay.ts:230 import.meta.url === pathToFileURL(process.argv[1])）对 symlink
# 失效 ⇒ `quay --help` 静默 exit 0 零输出（symlink 路径 ≠ import.meta.url realpath）。loop 走
# realpath（.quay/runtime/bin/quay.js），故三步机制不受阻；但 user-facing npm bin 不派发是真 bug，
# 如实上报（NPM_BIN_DISPATCH=0），不静默。
STEP1_OK=0
STEP1_PREFIX=""
NPM_BIN_DISPATCH=0

# ── 段① 对操作者真实 ~/.claude 的零写入判据（AC-161 回归；gap-ac161-user-scope-enable-repolluted-…）──
# 背景（立案当轮实测，报红读数）：段① 的 `npm install -g` 会跑 package postinstall
# （packages/quay/scripts/register-plugin.mjs），而它 (a) 经 os.homedir() 写 $HOME/.claude/settings.json，
# 且 (b) 未设 QUAY_SKIP_PLUGIN_CLI 时会 shell 出去调 `claude plugin install`，【而 Claude Code 自己的
# CLI 会写用户级 enabledPlugins】。⇒ 每跑一次交付验证，操作者的用户级 settings.json 就被重新污染一次，
# STANDING goal AC-161 复红。取证（时间戳互校）：settings.json mtime `04:08:38.218764382` vs
# `~/.claude/plugins/known_marketplaces.json` 的 `quay.lastUpdated` `04:08:38.214Z`（早 4ms ⇒ CLI 先写
# known_marketplaces、再写 settings）；同一前缀下 register-plugin.mjs 逐行核对为 AC-162 修复版
# （无任何 enabledPlugins 写入语句）⇒ 写键的不是 quay 的脚本，是它调用的 CLI。
#
# 修法（两条独立防线，都在段① 内 = 最小面）：
#   ① 隔离 HOME：段① 的 install 与随后的 settings 断言整体跑在 ${PREFIX}.home 下 ⇒ postinstall 的两次
#      写入（settings.json 直写 + CLI 写）都落到一次性目录，段末随 PREFIX 一起被 rm -rf。
#   ② QUAY_SKIP_PLUGIN_CLI=1：交付验证不需要物化进操作者的 ~/.claude/plugins（那是安装者自己的事），
#      故连 CLI 都不调；与 :1197 marketplace 分支的既有做法一致（同一条纪律，此前只落实在那里）。
# 判据（能取假）：段① 前后对操作者真实 settings.json 取签名，必须逐字节相同。签名是 "sha256:<hex>"
# 或 "ABSENT"——两态可区分（硬规则 3b：文件不存在 ≠ 读不出，也 ≠ 未变）。
STEP1_REAL_HOME=""                    # 隔离【之前】的真实 HOME（guard 读数基准 + npm 缓存位置）
STEP1_HOME=""                         # 段① 的隔离 HOME；== STEP1_REAL_HOME ⇒ 隔离未生效（可区分）
STEP1_HOME_OVERRIDE=""                # 调用方显式指定隔离目标（空 = 推导 ${PREFIX}.home）；selfcheck 取其假
STEP1_HOME_ISOLATED=0                 # 1 = 本次段① 确实跑在隔离 HOME 下
# 段① 隔离 HOME 的【有效值】（隔离未生效时 = 真实 HOME）。既喂 npm（前缀赋值，⛔ 不 export HOME——
# 本脚本后半段有步骤要读【操作者真实】~/.claude，如 AC-205 的 ~/.claude/sessions 枚举与 transcript
# 路径：全局改 HOME 会让那些步骤静默看错目录），也喂段① 的 settings 断言。
STEP1_SEGMENT_HOME=""
STEP1_REAL_SETTINGS_PATH=""           # 操作者真实 ~/.claude/settings.json 路径
STEP1_REAL_SETTINGS_SIG_BEFORE=""     # 段① 前签名（sha256:<hex> | ABSENT）
STEP1_REAL_SETTINGS_SIG_AFTER=""      # 段① 后签名
STEP1_REAL_SETTINGS_UNCHANGED=0       # 1 = 前后签名相同（AC3 直接量；AC4 取假对照证明它非恒真）
STEP1_REAL_SETTINGS_EVALUATED=0       # 1 = 上述读数【真的取过】（guard_end 跑到了）；0 = 段① 早退没测到
                                      # —— 与 UNCHANGED=0 分开，⛔ 不让「没测」伪装成「测了且变了」（硬规则 3b）

# 路径 → 签名。不存在 ⇒ "ABSENT"（独立取值，⛔ 不与「读到了但为空」同形）。
step1_settings_sig() {
  local p="$1"
  if [ -f "$p" ]; then printf 'sha256:%s' "$(sha256_file "$p")"; else printf 'ABSENT'; fi
}

# 段① 起点：捕获真实 HOME/路径 + 前签名，并把隔离 HOME 定下来。
# 隔离目标 == 真实 HOME ⇒ 隔离【没有】生效：如实落 STEP1_HOME_ISOLATED=0，⛔ 不假装隔离了，
# 也 ⛔ 不 rm -rf 调用者的 HOME（selfcheck 的取假对照正是走这条分支）。
step1_guard_begin() {
  local real_home="$1"
  STEP1_REAL_HOME="$real_home"
  STEP1_REAL_SETTINGS_PATH="${real_home}/.claude/settings.json"
  STEP1_REAL_SETTINGS_SIG_BEFORE="$(step1_settings_sig "$STEP1_REAL_SETTINGS_PATH")"
  STEP1_REAL_SETTINGS_SIG_AFTER=""; STEP1_REAL_SETTINGS_UNCHANGED=0
  STEP1_REAL_SETTINGS_EVALUATED=0
  STEP1_HOME="${STEP1_HOME_OVERRIDE:-${PREFIX}.home}"
  if [ "$STEP1_HOME" = "$real_home" ]; then
    STEP1_HOME_ISOLATED=0
  else
    rm -rf "$STEP1_HOME"; mkdir -p "$STEP1_HOME"; STEP1_HOME_ISOLATED=1
  fi
  STEP1_SEGMENT_HOME="$STEP1_HOME"
}

# 段① 终点：重取后签名并判「逐字节相同」。ABSENT→ABSENT 也算相同（真·未变）。
# 没 begin 过（路径空）⇒ 早退且 ⛔ 不置 EVALUATED：该情况下 UNCHANGED 保持 0，
# 调用方须靠 EVALUATED 区分「没测」与「测了且变了」——否则早退会被读成 AC-161 违反（假报警）。
step1_guard_end() {
  STEP1_REAL_SETTINGS_EVALUATED=0
  [ -n "$STEP1_REAL_SETTINGS_PATH" ] || return 0
  STEP1_REAL_SETTINGS_SIG_AFTER="$(step1_settings_sig "$STEP1_REAL_SETTINGS_PATH")"
  STEP1_REAL_SETTINGS_EVALUATED=1
  if [ "$STEP1_REAL_SETTINGS_SIG_BEFORE" = "$STEP1_REAL_SETTINGS_SIG_AFTER" ]; then
    STEP1_REAL_SETTINGS_UNCHANGED=1
  else
    STEP1_REAL_SETTINGS_UNCHANGED=0
  fi
  return 0
}

step1_install() {
  local qbin qnbin qinit qv qnv qrl real_home npm_cache
  real_home="$HOME"                     # 隔离【之前】的真实 HOME
  npm_cache="${npm_config_cache:-${real_home}/.npm}"   # 保缓存（性能）；它不是 ~/.claude，不在本判据面上
  step1_guard_begin "$real_home"
  # ⛔ 不 export HOME（只对 npm 做前缀赋值）：见 STEP1_SEGMENT_HOME 处的注释——全局改 HOME 会让
  # 后半段读操作者真实 ~/.claude 的步骤静默看错目录。
  rm -rf "$PREFIX"
  mkdir -p "$PREFIX"
  echo "== ① fresh .tgz install into isolated prefix $PREFIX =="
  echo "  HOME isolation: STEP1_HOME_ISOLATED=$STEP1_HOME_ISOLATED (isolated HOME=$STEP1_HOME; real HOME=$real_home)"
  # QUAY_SKIP_PLUGIN_CLI=1：postinstall 不 shell 出去调 claude CLI（见上方 ② 条）；HOME 隔离是第二道防线。
  if ! HOME="$STEP1_HOME" npm_config_cache="$npm_cache" QUAY_SKIP_PLUGIN_CLI=1 \
       npm install -g --no-audit --no-fund --prefix "$PREFIX" "$QUAY_TGZ" "$QN_TGZ" >/dev/null 2>&1; then
    # 如实收尾 guard：install 失败时 postinstall 可能已写了一半，读数照取（⛔ 不因失败就不测）。
    step1_guard_end
    echo "  FAIL: npm install -g failed (see npm errors above)" >&2
    return 1
  fi
  qbin="${PREFIX}/bin/quay"
  qnbin="${PREFIX}/bin/quay-native"
  qinit="$(npm root -g --prefix "$PREFIX")/quay/plugin/scripts/quay-init.sh"
  [ -x "$qbin" ] || { echo "  FAIL: $qbin not installed" >&2; return 1; }
  [ -x "$qnbin" ] || { echo "  FAIL: $qnbin not installed" >&2; return 1; }
  [ -f "$qinit" ] || { echo "  FAIL: shipped quay-init.sh not installed at $qinit" >&2; return 1; }
  # 产物可运行：经 realpath 用 node 执行 dist（loop 也走 realpath 的 .quay/runtime/bin/quay.js）。
  qrl="$(readlink -f "$qbin")"
  qv="$(node "$qrl" --version 2>/dev/null || echo "")"
  qnv="$("$qnbin" 2>&1 | head -1 || echo "")"
  [ -n "$qv" ] || { echo "  FAIL: quay dist does not run (node $qrl --version empty)" >&2; return 1; }
  [ -n "$qnv" ] || { echo "  FAIL: quay-native bin produced no output" >&2; return 1; }
  # 诊断：npm bin symlink 是否真的派发（user-facing CLI 面）。真实 bug 如实上报，不静默。
  if [ -n "$("$qbin" --help 2>/dev/null | head -1)" ]; then NPM_BIN_DISPATCH=1; fi
  STEP1_PREFIX="$PREFIX"
  STEP1_OK=1
  echo "  quay dist --version (realpath): $qv"
  echo "  quay-native (first line): $qnv"
  echo "  shipped quay-init.sh: $qinit"
  echo "  NPM_BIN_DISPATCH=$NPM_BIN_DISPATCH (0 = npm bin symlink does not dispatch — product bug, surfaced)"
  if [ "$NPM_BIN_DISPATCH" = 0 ]; then
    echo "  NOTE: npm-installed quay bin symlink does not dispatch (ESM main-module guard vs symlink)."
    echo "        The loop uses realpath (.quay/runtime/bin/quay.js) so ①②③ are unaffected; this is a"
    echo "        user-facing-CLI bug to route to the owning layer (packages/quay/bin/quay.ts)."
  fi
  # AC-161/AC3 读数：段① 结束（npm-global 通道到此为止；marketplace 通道由 step1_marketplace 再收一次尾）。
  step1_guard_end
  echo "  STEP1_HOME_ISOLATED=$STEP1_HOME_ISOLATED STEP1_REAL_SETTINGS_EVALUATED=$STEP1_REAL_SETTINGS_EVALUATED STEP1_REAL_SETTINGS_UNCHANGED=$STEP1_REAL_SETTINGS_UNCHANGED (real settings sig: '${STEP1_REAL_SETTINGS_SIG_BEFORE}' -> '${STEP1_REAL_SETTINGS_SIG_AFTER}')"
  # ⚠️ 只在【真的测过】时报警：EVALUATED=0（段① 早退，如 bin 缺失）时 UNCHANGED 也是 0，
  # 不加这个条件就会把「没测」报成「AC-161 被违反了」（硬规则 3b）。
  if [ "$STEP1_REAL_SETTINGS_EVALUATED" = "1" ] && [ "$STEP1_REAL_SETTINGS_UNCHANGED" != "1" ]; then
    echo "  WARNING: segment ① changed the operator's real ~/.claude/settings.json — AC-161 violated by this run." >&2
    echo "           before=${STEP1_REAL_SETTINGS_SIG_BEFORE} after=${STEP1_REAL_SETTINGS_SIG_AFTER} path=${STEP1_REAL_SETTINGS_PATH}" >&2
  fi
  return 0
}

# ── marketplace 通道验证（AC168：SPEC §6b 约束③ 两条安装路径都能解析到）────────────
# npm-global 与 plugin marketplace 是 SPEC §6 的两条受支持安装路径。npm-global 那条已由
# step1_install 的 quay --version 断言跨主机验证过（gap-verify-deliver-coldstart-l1-asserts-retired-artifacts
# AC6）；marketplace 那条（register-plugin.mjs 把已安装 plugin 目录注册为 directory-source
# marketplace）此前零跨主机接线——本分支补上。
#
# marketplace 通道 = 复用 step① 的 npm install -g 获得可解包内容，然后显式跑 shipped 的
# register-plugin.mjs（QUAY_SKIP_PLUGIN_CLI=1 —— B/C 无 claude 二进制，register-plugin.mjs:146
# 的优雅降级：只物化 settings.json，不 shell 出去调 claude plugin marketplace add/install——
# 这是 marketplace 通道在无 claude 宿主上唯一可达的真实形态，不是弱化替代品）。
# 断言 settings.json 落地后：
#   extraKnownMarketplaces.quay.source.path == <npm root -g>/quay/plugin   （marketplace 源已注册）
#   enabledPlugins 不含用户级 quay 键（quay / quay@*）                     （启用未外溢，AC-161/162）
#
# 判据能取假（AC2 负控制）：不跑 register-plugin.mjs（只 npm install）⇒ settings.json 不新增
# marketplace 条目 ⇒ MP_SETTINGS_OK=0——证明断言真在测 register-plugin.mjs 的效果，不是环境本来就有。
MP_EVALUATED=0          # 1 = marketplace 分支已跑；0 = npm-global 通道（未跑，可区分「没验」，硬规则 3b）
MP_REGISTER_RC=""       # register-plugin.mjs 退出码（字符串；空 = 未跑）
MP_REGISTER_OK=0        # 1 = register-plugin.mjs exit 0
MP_FAIL_REASON=""       # register 失败的结构化原因（AC5：不吞退出码）
MP_SETTINGS_PATH=""     # 实际断言读的 settings.json 路径（$HOME/.claude/settings.json）
MP_ENTRY_PATH=""        # 读回的 extraKnownMarketplaces.quay.source.path（实测值）
MP_SETTINGS_OK=0        # 1 = marketplace 断言全部成立（源已注册 且 无 enabledPlugins 外溢）
MP_ENABLED_LEAK=0       # 1 = enabledPlugins 出现用户级 quay 键（AC-161 违反，能取假）

mp_assert_settings() {
  # $1 = settings.json 路径；$2 = 期望的 plugin 目录路径。
  # 用 node 解析 JSON（比 grep/sed 稳）；判据能取假：settings 缺失/不可读/无 quay 源 ⇒ 不匹配；
  # 有 quay@quay 启用 ⇒ enabled_leak=1。函数始终 return 0（判定是数据，不是控制流失败）。
  local settings_path="$1" expected_dir="$2" out
  local readable=0 entry_path="" entry_matches=0 enabled_leak=0
  MP_SETTINGS_PATH="$settings_path"
  MP_ENTRY_PATH=""; MP_SETTINGS_OK=0; MP_ENABLED_LEAK=0
  if [ ! -f "$settings_path" ]; then MP_FAIL_REASON="settings.json missing: $settings_path"; return 0; fi
  out="$("$VC_NODE" --no-warnings -e '
    const fs = require("node:fs");
    const p = process.argv[1], exp = process.argv[2];
    let s;
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.log("readable=0"); process.exit(0); }
    if (typeof s !== "object" || s === null || Array.isArray(s)) { console.log("readable=0"); process.exit(0); }
    const m = s.extraKnownMarketplaces || {};
    const entry = m["quay"] || null;
    const pathVal = entry && entry.source ? entry.source.path : "";
    const ep = s.enabledPlugins || {};
    let leak = 0;
    for (const k of Object.keys(ep)) { if (k === "quay" || k.indexOf("quay@") === 0) leak = 1; }
    console.log("readable=1");
    console.log("entry_path=" + pathVal);
    console.log("entry_matches=" + (pathVal === exp ? "1" : "0"));
    console.log("enabled_leak=" + leak);
  ' "$settings_path" "$expected_dir" 2>/dev/null)"
  readable="$(printf '%s\n' "$out" | sed -n 's/^readable=//p' | head -1)"
  entry_path="$(printf '%s\n' "$out" | sed -n 's/^entry_path=//p' | head -1)"
  entry_matches="$(printf '%s\n' "$out" | sed -n 's/^entry_matches=//p' | head -1)"
  enabled_leak="$(printf '%s\n' "$out" | sed -n 's/^enabled_leak=//p' | head -1)"
  if [ "$readable" != "1" ]; then MP_FAIL_REASON="settings.json unreadable/unparsable: $settings_path"; return 0; fi
  MP_ENTRY_PATH="$entry_path"
  [ "$enabled_leak" = "1" ] && MP_ENABLED_LEAK=1
  if [ "$entry_matches" = "1" ] && [ "$enabled_leak" = "0" ]; then MP_SETTINGS_OK=1; fi
  return 0
}

step1_marketplace() {
  # marketplace 通道的 step① 追加段：npm install -g 已由 step1_install 完成（可解包内容在位），
  # 此处显式跑 shipped register-plugin.mjs 并断言 settings.json 落地结果。
  local register plugin_dir rc
  register="$(npm root -g --prefix "$STEP1_PREFIX")/quay/scripts/register-plugin.mjs"
  plugin_dir="$(npm root -g --prefix "$STEP1_PREFIX")/quay/plugin"
  MP_EVALUATED=1
  # 每次调用重置输出态（selfcheck 多次调用不得继承上次的旧值——同 coldstart_verdict 的自包含纪律）
  MP_REGISTER_RC=""; MP_REGISTER_OK=0; MP_FAIL_REASON=""
  MP_SETTINGS_OK=0; MP_ENABLED_LEAK=0; MP_ENTRY_PATH=""; MP_SETTINGS_PATH=""
  echo "== ①b marketplace channel: register installed plugin as directory-source marketplace =="
  if [ ! -f "$register" ]; then
    MP_FAIL_REASON="register-plugin.mjs not in installed package: $register"
    echo "  FAIL: $MP_FAIL_REASON" >&2
    return 0
  fi
  # npm_config_global=true：register-plugin.mjs 的 guard #2 只在全局安装语义下生效（postinstall 同形）。
  # QUAY_SKIP_PLUGIN_CLI=1：register-plugin.mjs:146 优雅降级——只写 settings.json，不调 claude CLI。
  # HOME：段① 的隔离 HOME（STEP1_SEGMENT_HOME，由 step1_install 设定；selfcheck 夹具无 step1_install
  # ⇒ 回落到 $HOME=夹具自己 export 的目录）——register-plugin.mjs 经 os.homedir() 写 $HOME/.claude/
  # settings.json，⛔ 不隔离就会写操作者真实那份（AC-161）。set-if-present 语义保住夹具的既有用法。
  set +e
  HOME="${STEP1_SEGMENT_HOME:-$HOME}" npm_config_global=true QUAY_SKIP_PLUGIN_CLI=1 \
    "$VC_NODE" --no-warnings "$register" >"${STEP1_PREFIX}/register-plugin.out" 2>&1
  rc=$?
  set -e
  MP_REGISTER_RC="$rc"
  [ "$rc" = "0" ] && MP_REGISTER_OK=1
  if [ "$rc" != "0" ]; then
    # AC5：如实记录失败原因（结构化字段，非吞掉退出码）——失败本身是一条有效读数
    # （「marketplace 通道在无 claude 宿主上的真实边界」），不是本任务失败的理由。
    MP_FAIL_REASON="register-plugin.mjs exited $rc: $(tail -n 3 "${STEP1_PREFIX}/register-plugin.out" 2>/dev/null | tr '\n' ' ' | head -c 300)"
    echo "  register-plugin.mjs exited $rc (reason structured into record, not swallowed — AC5)"
  fi
  # 断言 settings.json（register-plugin.mjs 经 os.homedir() 写入上一步那个 HOME 下的 .claude/settings.json
  # ——读的必须是【同一个】HOME，否则断言与写入错位：段① 隔离生效时读的是隔离那份）。
  mp_assert_settings "${STEP1_SEGMENT_HOME:-$HOME}/.claude/settings.json" "$plugin_dir"
  if [ "$MP_REGISTER_OK" = "1" ] && [ "$MP_ENABLED_LEAK" = "1" ]; then
    # register 成功但 enabledPlugins 有用户级 quay 键 ⇒ 预存在状态（register-plugin.mjs 不写
    # enabledPlugins——AC-162 已改；这是 AC-161 迁移未覆盖到本机的旧残留，如实落结构字段，不静默）。
    MP_FAIL_REASON="enabledPlugins has a user-level quay key (pre-existing; register-plugin.mjs does NOT write enabledPlugins — AC-161 migration not applied to this host)"
  fi
  echo "  register-plugin.mjs: $register (exit $rc)"
  echo "  marketplace source path (read back): ${MP_ENTRY_PATH:-<none>}"
  echo "  MP_SETTINGS_OK=$MP_SETTINGS_OK MP_ENABLED_LEAK=$MP_ENABLED_LEAK MP_REGISTER_RC=$MP_REGISTER_RC"
  return 0
}

# ── L1 项目文件铺到位探测（SPEC §6 闭集，从盘上解析——full 与 verify-only 共用）──────
# L1 断言集合 = SPEC 的 QUAY-INIT-CLOSED-SET:BEGIN/END 标记块逐条解析（机器可读），⛔ 不在本脚本
# 复制闭集清单——复制一份就是制造漂移（CLAUDE.md 开篇纪律），本任务修的正是一次漂移（硬规则 4c：
# 判据不得锚在生命周期短于判据本身的对象上）。
# SPEC 定位顺序：--spec <path> 显式（缺失即未评估，不静默回退）> --build-root <repo>/orchestration/
# > 脚本 dev-tree 相对路径 > 读不到 ⇒ L1_NOT_EVALUATED=1（与 L1_OK=1 可区分，硬规则 3b）。
resolve_spec_path() {
  if [ -n "$SPEC_PATH" ]; then
    [ -f "$SPEC_PATH" ] && { printf '%s' "$SPEC_PATH"; return 0; }
    printf ''
    return 0
  fi
  [ -n "$BUILD_ROOT" ] && [ -f "$BUILD_ROOT/orchestration/$SPEC_FILE" ] && { printf '%s' "$BUILD_ROOT/orchestration/$SPEC_FILE"; return 0; }
  [ -f "$SCRIPT_DIR/../../orchestration/$SPEC_FILE" ] && { printf '%s' "$SCRIPT_DIR/../../orchestration/$SPEC_FILE"; return 0; }
  printf ''
}

probe_l1() {
  local root="$1" spec_path entries entry
  L1_NOT_EVALUATED=0; L1_CLOSED_SET_COUNT=0; L1_CLOSED_SET_PRESENT=0
  L1_CLOSED_SET_MISSING=""; L1_CLOSED_SET=""; L1_OK=0
  spec_path="$(resolve_spec_path)"
  if [ -z "$spec_path" ] || [ ! -f "$spec_path" ]; then
    L1_NOT_EVALUATED=1
    return 0
  fi
  # 解析标记块（机器可读）：BEGIN/END 之间形如 "- <path>" 的行，去行首 "- " 与行尾空白。
  entries="$(sed -n '/QUAY-INIT-CLOSED-SET:BEGIN/,/QUAY-INIT-CLOSED-SET:END/p' "$spec_path" \
    | sed -n 's/^-[[:space:]]*//p' | sed 's/[[:space:]]*$//' | grep -v '^$')"
  if [ -z "$entries" ]; then
    # 标记块读得到但解析不出条目 ⇒ 未评估（空闭集不是「零条=全过」的假绿，硬规则 3b）
    L1_NOT_EVALUATED=1
    return 0
  fi
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    L1_CLOSED_SET="${L1_CLOSED_SET}${L1_CLOSED_SET:+ }${entry}"
    L1_CLOSED_SET_COUNT=$((L1_CLOSED_SET_COUNT + 1))
    if [ -e "$root/$entry" ]; then
      L1_CLOSED_SET_PRESENT=$((L1_CLOSED_SET_PRESENT + 1))
    else
      L1_CLOSED_SET_MISSING="${L1_CLOSED_SET_MISSING}${L1_CLOSED_SET_MISSING:+ }${entry}"
    fi
  done <<< "$entries"
  if [ "$L1_CLOSED_SET_PRESENT" = "$L1_CLOSED_SET_COUNT" ]; then L1_OK=1; fi
  # 函数始终返回 0：L1 缺件是【数据】（L1_OK=0），不是控制流失败（set -e 不得因 L1 缺件中断）
  return 0
}

# force_l1_ok(): selfcheck 里把 L1 态注入为「已铺到位」——L2 判活测试需要 L1 侧恒真以隔离 L2。
force_l1_ok() {
  L1_NOT_EVALUATED=0; L1_CLOSED_SET_COUNT=1; L1_CLOSED_SET_PRESENT=1
  L1_CLOSED_SET_MISSING=""; L1_CLOSED_SET=""; L1_OK=1
}

# ── ② 项目内 quay-init --loop ─────────────────────────────────────────────────────────────
STEP2_OK=0
STEP2_PROJECT=""
step2_init() {
  local qinit plugin_root
  qinit="$(npm root -g --prefix "$STEP1_PREFIX")/quay/plugin/scripts/quay-init.sh"
  plugin_root="$(dirname "$(dirname "$qinit")")"   # <prefix>/lib/node_modules/quay/plugin
  echo "== ② quay-init --loop in clean project $ROOT =="
  rm -rf "$ROOT"
  mkdir -p "$ROOT"
  # 干净空项目：git init（供③直接量里的 git 提交信号）+ 一个可检测的 test command
  git -C "$ROOT" init -q -b main 2>/dev/null || true
  git -C "$ROOT" config user.email "verify@localhost" 2>/dev/null || true
  git -C "$ROOT" config user.name "verify" 2>/dev/null || true
  printf '{"name":"%s","scripts":{"test":"%s"}}\n' "$PROJECT" "$TEST_CMD" > "$ROOT/package.json"
  if ! CLAUDE_PLUGIN_ROOT="$plugin_root" bash "$qinit" \
      --all --loop \
      --root "$ROOT" \
      --project "$PROJECT" \
      --repo-root "$ROOT" \
      --test-command "$TEST_CMD" \
      --tmux-session "$TMUX_SESSION" \
      --worktree-root "$WORKTREE_ROOT" \
      --plugin-root "$plugin_root" \
      --auto-commit-confirm >"${ROOT}/quay-init.log" 2>&1; then
    echo "  FAIL: quay-init --loop exited non-zero:" >&2
    tail -n 20 "${ROOT}/quay-init.log" >&2
    return 1
  fi
  # L1 项目文件铺到位检查（SPEC §6 闭集，AC1 的 ② 侧）
  probe_l1 "$ROOT"
  STEP2_PROJECT="$ROOT"
  STEP2_OK=1
  echo "  quay-init complete (log → ${ROOT}/quay-init.log)"
  echo "  L1: closed_set=${L1_CLOSED_SET:-<none>} present=$L1_CLOSED_SET_PRESENT/$L1_CLOSED_SET_COUNT missing=${L1_CLOSED_SET_MISSING:-<none>} not_evaluated=$L1_NOT_EVALUATED"
  return 0
}

# ── 目标项目 profiles 配置（gap-verify-coldstart-does-not-configure-target-profiles）────────
# 单一真相源 = 驱动方仓库自己的 .quay/profiles.yml worker-default（⛔ 不在本脚本写第二份字面量，
# 硬规则 4c）。shipped plugin/.quay/profiles.yml 与 dev-tree 根 .quay/profiles.yml 结构一致、只差
# launcher/model 取值，sed range 锚定 worker-default 段替换三字段、不碰 manager-local 同名键。

# profile_worker_default_field <profiles.yml> <launcher|model|auth> — 读 worker-default 段一个字段。
# 锚定 sed range（^  worker-default: 到下一个 2-space 缩进 key），值剥离行内注释与尾随空白。
# 读不到（文件缺失 / 段无该键）⇒ return 非 0（缺值 ≠ 合格，硬规则 3b）。
profile_worker_default_field() {
  local f="$1" field="$2" v
  [ -f "$f" ] || return 1
  v="$(sed -n '/^  worker-default:/,/^  [a-zA-Z_-]*:/p' "$f" \
        | sed -n "s/^    ${field}:[[:space:]]*//p" | head -1)"
  [ -n "$v" ] || return 1
  v="${v%%#*}"                                   # 剥离行内注释（auth: token  # …）
  v="$(printf '%s' "$v" | sed 's/[[:space:]]*$//')"   # 剥离尾随空白
  [ -n "$v" ] || return 1
  printf '%s' "$v"
}

# ── config_native_mcp_entry <root> — 读升级后 config 的 providers.native.mcp_entry 里的可执行路径 ──
# 当前升级语义（裁定 c / ba960f503）下，「项目此刻绑定到哪个 runtime」只写在 config 里：mcp_entry 从
# 裸 PATH 名（或悬空路径）被迁成【本次交付物的 vendored bundle 绝对路径】。AC-238 的「旧 runtime 被真实
# 换掉」与 AC-239 的「这个项目自己能不能读自己的盘」都以它为准 ⇒ 必须从 config 读，⛔ 不从「目录里
# 有没有某个文件」推（那正是升级前的老读法，会把「退休了但 config 没改」读成合格）。
# 输出：第一个以 .js 结尾的绝对路径元素；读不出/没有 ⇒ 空串（调用方 fail-closed）。
# ⛔ 刻意【不】引入 yaml 依赖：远端不保证有 PyYAML，而这里要解的形态是闭集（`mcp_entry:` 后跟
# `- item` 列表或 `[a, b]` 内联）。解析结果只参与 fail-closed 门（== 本次交付物），解错即门不开。
config_native_mcp_entry() {
  local root="$1"
  [ -f "$root/.quay/config.yml" ] || return 0
  python3 - "$root/.quay/config.yml" <<'PY'
import re, sys
path = sys.argv[1]
in_block = False
items = []
for line in open(path, encoding="utf-8"):
    s = line.strip()
    if not in_block:
        m = re.match(r'^mcp_entry\s*:(.*)$', s)
        if m:
            rest = m.group(1).strip()
            if rest.startswith("["):
                items = [x.strip().strip("\"'") for x in rest.strip("[]").split(",") if x.strip()]
                break
            if rest:
                items = [rest.strip("\"'")]
                break
            in_block = True
        continue
    if s.startswith("-"):
        items.append(s[1:].strip().strip("\"'"))
    elif s and not s.startswith("#"):
        break
cand = [i for i in items if i.startswith("/") and i.endswith(".js")]
sys.stdout.write(cand[0] if cand else "")
PY
}

# resolve_driving_profiles — 驱动方仓库 profiles 路径推导：--driving-profiles 显式 >
# --build-root <repo>/.quay/profiles.yml > dev-tree 推导（SCRIPT_DIR 两级上）。不存在 ⇒ 空串。
resolve_driving_profiles() {
  local dev_root
  if [ -n "$DRIVING_PROFILES" ] && [ -f "$DRIVING_PROFILES" ]; then printf '%s' "$DRIVING_PROFILES"; return 0; fi
  if [ -n "$BUILD_ROOT" ] && [ -f "$BUILD_ROOT/.quay/profiles.yml" ]; then printf '%s' "$BUILD_ROOT/.quay/profiles.yml"; return 0; fi
  dev_root="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd)"
  if [ -f "$dev_root/.quay/profiles.yml" ]; then printf '%s' "$dev_root/.quay/profiles.yml"; return 0; fi
  return 1
}

# configure_target_profiles <target-root> <driving-profiles> <launcher-override> <model-override> <auth-override>
# 把 worker-default 的 launcher/model/auth 写进目标项目 .quay/profiles.yml（CLI 覆盖 > 驱动方派生）。
# 返回 0 = configured；2 = not-configured（launcher/model 缺输入，或目标 profiles.yml 未由 quay-init 铺）。
configure_target_profiles() {
  local target="$1" src="$2" launcher="$3" model="$4" auth="$5"
  local prof="$target/.quay/profiles.yml" derived_launcher="" derived_model="" derived_auth=""

  if [ -n "$src" ]; then
    derived_launcher="$(profile_worker_default_field "$src" launcher 2>/dev/null || true)"
    derived_model="$(profile_worker_default_field "$src" model 2>/dev/null || true)"
    derived_auth="$(profile_worker_default_field "$src" auth 2>/dev/null || true)"
  fi
  launcher="${launcher:-$derived_launcher}"
  model="${model:-$derived_model}"
  auth="${auth:-$derived_auth}"

  TARGET_PROFILES_LAUNCHER="$launcher"
  TARGET_PROFILES_MODEL="$model"
  TARGET_PROFILES_AUTH="$auth"

  # launcher 或 model 任一缺 ⇒ not-configured（驱动方 profiles 无 worker-default 取值且无覆盖）。
  # ⛔ 不静默跳过：可区分取值让读者知道这一步没做（硬规则 3b「没配」与「配好了」不得同形）。
  if [ -z "$launcher" ] || [ -z "$model" ]; then
    TARGET_PROFILES_STATUS="not-configured"
    echo "  target-profiles: not-configured (launcher/model 缺输入——驱动方 profiles 无 worker-default 取值, 且无 --target-launcher/--target-model 覆盖; 这一步没做)"
    return 2
  fi
  if [ ! -f "$prof" ]; then
    TARGET_PROFILES_STATUS="not-configured"
    echo "  target-profiles: not-configured (目标项目 $prof 不存在——quay-init 未铺, 不静默)"
    return 2
  fi

  # 精准替换 worker-default 段的三字段（sed range 锚定 worker-default，⛔ 不碰 manager-local 同名键）。
  sed -i -e "/^  worker-default:/,/^  [a-zA-Z_-]*:/ { s|^    launcher:.*|    launcher: ${launcher}|; s|^    model:.*|    model: ${model}|; }" "$prof"
  if [ -n "$auth" ]; then
    sed -i -e "/^  worker-default:/,/^  [a-zA-Z_-]*:/ { s|^    auth:.*|    auth: ${auth}|; }" "$prof"
  fi

  TARGET_PROFILES_STATUS="configured"
  echo "  target-profiles: configured (launcher=${launcher} model=${model} auth=${auth:-<derived-none>} → $prof)"
  return 0
}

# ③ 脚本化冷启动驱动（编排 shipped 的脚本，不复制实现；best-effort）
COLDSTART_DRIVE_STATE="skipped"
coldstart_drive() {
  local root="$1"
  COLDSTART_DRIVE_STATE="attempted"
  echo "== ③ cold-start drive (orchestrate shipped scripts; agent-driven 部分按 cold-start skill) =="
  if ! command -v claude >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then
    COLDSTART_DRIVE_STATE="skipped-no-env"
    echo "  cold-start drive: SKIPPED (need claude+tmux on PATH)"
    echo "  COLDSTART_OPERATOR_STEPS: run the shipped cold-start skill in the project (/quay:cold-start per plugin/skills/cold-start/SKILL.md)"
    return 0
  fi
  # driver 注册 + 遥测 + 驱动 inner（shipped 脚本；会话拓扑工厂已随 outer 退役——
  # gap-retire-outer-tmux-window-logic，不再编排 session-bootstrap.sh）
  mkdir -p "$root/.quay"
  printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"verify-deliver-coldstart"}' >> "$root/.quay/loop-driver.jsonl" 2>/dev/null || true
  node --no-warnings --experimental-strip-types "$root/plugin/scripts/fast-mode-telemetry.ts" \
    --task-start --taskId "${PROJECT}-verify" --root "$root" >/dev/null 2>&1 || true
  if [ -f "$root/plugin/scripts/send-keys-reliable.sh" ]; then
    bash "$root/plugin/scripts/send-keys-reliable.sh" "$TMUX_SESSION" \
      "按 worker-driver 执行本项目的在飞任务（inner 已由 worker-driver 取代 fast-mode tick 文档）" \
      "${HOME}/.claude/projects/$(printf '%s' "$root" | tr '/' '-')/verify.jsonl" >/dev/null 2>&1 || true
  fi
  echo "  cold-start drive: launched (driver reg + telemetry + inner drive attempt)"
}

# ── ③ 执行 ─────────────────────────────────────────────────────────────────────────────
step3_coldstart() {
  echo "== ③ cold-start liveness (outer window + inner layer, DIRECT measures, AC2) =="
  if [ "$COLD_START_DRIVE" = 1 ]; then
    coldstart_drive "$ROOT"
    echo "  waiting ${WAIT}s for the loop to produce direct-measure signals..."
    sleep "$WAIT"
  fi
  # L1 从盘上重查（full 与 verify-only 共用——verify-only 不再依赖 step2 的全局残留）
  probe_l1 "$ROOT"
  probe_direct_measures "$ROOT"
  coldstart_verdict
  echo "  L1: closed_set=${L1_CLOSED_SET:-<none>} present=$L1_CLOSED_SET_PRESENT/$L1_CLOSED_SET_COUNT missing=${L1_CLOSED_SET_MISSING:-<none>} not_evaluated=$L1_NOT_EVALUATED (probed from disk)"
  echo "  L2 direct measures (git commit / worktree / /proc cwd — NOT layer heartbeat):"
  echo "    L2_GIT_COMMIT_AGE_MIN=${L2_GIT_COMMIT_AGE_MIN} (<=${LIVENESS_WINDOW}min and not chore(quay-init) = live signal)"
  echo "    L2_GIT_IS_QUAYINIT_COMMIT=${L2_GIT_IS_QUAYINIT_COMMIT} (1 = the recent commit is quay-init's own auto-commit — excluded)"
  echo "    L2_INNER_WORKTREE_COUNT=${L2_INNER_WORKTREE_COUNT} (>=1 = inner dispatched)"
  echo "    L2_LAYER_PROCESS_CWD=${L2_LAYER_PROCESS_CWD} (>=2 = outer-window + inner-layer processes in project)"
  echo "    L2_STARTUP_PROMPT=${L2_STARTUP_PROMPT} (1 = the outer pane is stuck at the startup permission-prompt — proc_ok demoted, hard rule 4b)"
  echo "    L2_DEAD_LOOP_STATE=${L2_DEAD_LOOP_STATE} (shipped L2 criterion, corroboration)"
  if [ "$COLDSTART_LIVE" = "yes" ]; then
    echo "  COLDSTART_LIVE=yes — loop verified live (outer window + inner layer) by direct measures"
  else
    echo "  COLDSTART_LIVE=no — cold-start not verified live. This is DATA, not a defect:"
    echo "    · if the cold-start has not been performed yet: perform it per plugin/skills/cold-start/SKILL.md,"
    echo "      then re-run with --verify-only --require-live."
    echo "    · if it was performed: the direct measures show no live outer-window + inner-layer — investigate (dead loop)."
  fi
}

# ── ④ driver 真活（AC-203）：第三方项目（无 plugin/）里 start driver 后读 status 载体 ─────────
# 判据读载体（driver_alive / carrier_records），⛔ 不读 start 退出码（今天 start 就 exit 0 而系统是死的）。
# 复用 status 载体（`quay driver status --json` 的 driver_alive + carrier_records 字段）——同
# start-drivers.ts parseDriverStatus 读的同一载体面，不新造「活不活」读法（只比它多读一个 carrier_records）。

# 解析 status JSON 载体：driver_alive + carrier_records。读不出 ⇒ AC203_EVALUATED=0（未评估 ≠ 合格）。
probe_ac203_driver_status() {
  local status_json="$1" parsed
  AC203_EVALUATED=0; AC203_DRIVER_ALIVE=0; AC203_CARRIER_RECORDS=-1
  [ -n "$status_json" ] || return 0
  parsed="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
    let s="";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const j = JSON.parse(s);
        const alive = (j && (j.driver_alive === 1 || j.driver_alive === true)) ? 1 : 0;
        const recs = (j && typeof j.carrier_records === "number") ? j.carrier_records : -1;
        console.log("alive=" + alive);
        console.log("recs=" + recs);
      } catch { console.log("alive=0"); console.log("recs=-1"); }
    });
  ' 2>/dev/null)"
  AC203_DRIVER_ALIVE="$(printf '%s' "$parsed" | sed -n 's/^alive=//p' | head -1)"
  AC203_CARRIER_RECORDS="$(printf '%s' "$parsed" | sed -n 's/^recs=//p' | head -1)"
  [ -z "$AC203_DRIVER_ALIVE" ] && AC203_DRIVER_ALIVE=0
  [ -z "$AC203_CARRIER_RECORDS" ] && AC203_CARRIER_RECORDS=-1
  AC203_EVALUATED=1
}

# 写 GOAL-009-AC-203 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 缺任一有效读数（host/project_root 空、driver_alive≠1、carrier_records 非正、has_plugin_dir≠0）
# ⇒ 不写 return 1（硬规则 3b：缺值 ≠ 合格）。五字段逐字满足 criterion 过滤：
# has_plugin_dir 必须是 JSON 字面 false（criterion 用 `is not False` 判）、driver_alive/carrier_records 是整数。
# gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable：本写入点原为裸 printf、不带
# top-level build_sha，而 AC-214 的 NEED 含 GOAL-009-AC-203 且其判据取 `sha = r.get("build_sha") or
# r.get("commit")`（取不到 ⇒ 该 ac 落进 missing ⇒ exit 1）⇒ AC-203 即便产出也被判「无证据」。
# 改走本仓唯一补锚 choke point（同 AC-205/232/207 形）——⛔ 不在此处另写一份 `"build_sha"` 字面量：
# 多一个补锚点 = 下次改锚格式必漏一处（硬规则① 用机件不手搓）。ts/BUILD_SHA/AC89 由 helper 统一取，
# 调用方先置全局（同 control 16/17 的既有形态）。helper 的 fail-closed 语义原样保留：BUILD_SHA 非
# 40-hex 或 AC89 空 ⇒ 不写且 return 非 0，⛔ 不降级成「至少写点什么」的无锚记录（硬规则 3b）。
write_ac203_record() {
  local host="$1" project_root="$2" has_plugin_dir="$3" driver_alive="$4" carrier_records="$5"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ "$has_plugin_dir" = "0" ] || return 1
  [ "$driver_alive" = "1" ] || return 1
  [ "$carrier_records" -gt 0 ] 2>/dev/null || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-203\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"has_plugin_dir\":false,\"driver_alive\":$driver_alive,\"carrier_records\":$carrier_records"
}

# ── 运行级「闭环由本次运行自证」取值（GOAL-009-AC-240）──────────────────────────────────────
# 三个可区分取值（硬规则 3b：词表里没有「未评估」这一态的判据，分不清「查过且合格」与「没查成」）：
#   1             = AC-203 与 AC-207 均在【本次运行】内、对【同一 project_root】写出；
#   0             = 本次尝试了 e2e，但闭环不由本次运行自证（NOTE 说明子因，⛔ 不静默）；
#   not-evaluated = 本次未尝试 e2e（未传 --ac207-e2e）——⛔ 不得与 0/1 同形。
# 入参即本次运行自己写的记录（flag + root），⛔ 不回读载体反推（反推会把别次运行的记录算进来，
# 那正是 AC-240 origin 的形态）。设置全局 E2E_CLOSURE_SELF_EVIDENCED / E2E_CLOSURE_NOTE，恒返回 0
# ——「未评估」是取值不是故障（同 L1_NOT_EVALUATED 的形态），调用方据取值决定怎么报。
e2e_closure_self_evidenced() {
  local attempted="$1" a203="$2" a203_root="$3" a207="$4" a207_root="$5"
  E2E_CLOSURE_SELF_EVIDENCED="not-evaluated"
  E2E_CLOSURE_NOTE=""
  if [ "$attempted" != "1" ]; then
    E2E_CLOSURE_NOTE="--ac207-e2e 未传入 —— 本次运行未尝试 e2e（未评估 ≠ 不合格）"
    return 0
  fi
  if [ "$a207" != "1" ]; then
    E2E_CLOSURE_SELF_EVIDENCED=0
    E2E_CLOSURE_NOTE="闭环不由本次运行自证：AC-207 本次运行未写出（e2e 未驱动出 done / 无实现提交 / 无 gate 事件）"
    return 0
  fi
  if [ "$a203" != "1" ]; then
    E2E_CLOSURE_SELF_EVIDENCED=0
    E2E_CLOSURE_NOTE="闭环不由本次运行自证：AC-207 已写出，而本次运行没有写出 AC-203（step④/⑤ 的 driver 存活读数未成立）——⚠️ 生成侧缺口的本来形态"
    return 0
  fi
  if [ -z "$a203_root" ] || [ "$a203_root" != "$a207_root" ]; then
    E2E_CLOSURE_SELF_EVIDENCED=0
    E2E_CLOSURE_NOTE="闭环不由本次运行自证：AC-203 root='$a203_root' ≠ AC-207 root='$a207_root'"
    return 0
  fi
  E2E_CLOSURE_SELF_EVIDENCED=1
  E2E_CLOSURE_NOTE="AC-203 与 AC-207 均由本次运行对同一 project_root 写出（host=$AC203_HOST root=$a203_root）"
  return 0
}

# 写 GOAL-009-AC-206 记录（gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set）。
# 缺 host/project_root ⇒ 不写 return 1（硬规则 3b：缺值 ≠ 合格）；四字段（goals_dir_created /
# tasks_dir_created / goal_store_readable / task_store_readable）是布尔 JSON 字面 true/false——
# goals/ 缺失时【如实写 false】，不是拒写（criterion 用 `is not True` 判，false ⇒ 记录在但判据不 exit 0，
# 如实非静默——同 AC-203 的「缺值不写」与「缺件如实写 false」的分工）。
write_ac206_record() {
  local ts="$1" host="$2" project_root="$3" gdc="$4" tdc="$5" gsr="$6" tsr="$7" ac89="$8"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  case "$gdc" in 0|1) ;; *) return 1 ;; esac
  case "$tdc" in 0|1) ;; *) return 1 ;; esac
  case "$gsr" in 0|1) ;; *) return 1 ;; esac
  case "$tsr" in 0|1) ;; *) return 1 ;; esac
  local b_gdc=false b_tdc=false b_gsr=false b_tsr=false
  [ "$gdc" = "1" ] && b_gdc=true
  [ "$tdc" = "1" ] && b_tdc=true
  [ "$gsr" = "1" ] && b_gsr=true
  [ "$tsr" = "1" ] && b_tsr=true
  mkdir -p "$(dirname "$ac89")"
  printf '{"ts":"%s","ac":"GOAL-009-AC-206","host":"%s","project_root":"%s","goals_dir_created":%s,"tasks_dir_created":%s,"goal_store_readable":%s,"task_store_readable":%s}\n' \
    "$ts" "$host" "$project_root" "$b_gdc" "$b_tdc" "$b_gsr" "$b_tsr" >> "$ac89"
  return 0
}

# 探测目标项目的 goals/ + tasks/ 双载体：目录是否创建 + store 是否可读。缺件是【数据】（布尔 0），
# 不是控制流失败（set -e 不得因 goals/ 缺失中断——如实写 false 才是 criterion 的「能取假」半边）。
probe_ac206_dual_carrier() {
  local root="$1"
  AC206_GOALS_DIR_CREATED=0; AC206_TASKS_DIR_CREATED=0
  AC206_GOAL_STORE_READABLE=0; AC206_TASK_STORE_READABLE=0
  [ -d "$root/goals" ] && AC206_GOALS_DIR_CREATED=1
  [ -d "$root/tasks" ] && AC206_TASKS_DIR_CREATED=1
  [ -d "$root/goals" ] && [ -r "$root/goals" ] && AC206_GOAL_STORE_READABLE=1
  [ -d "$root/tasks" ] && [ -r "$root/tasks" ] && AC206_TASK_STORE_READABLE=1
}

# step ⑤：校验第三方项目（$ROOT）goals/ 与 tasks/ 均创建、两 store（goals/*.md 与 tasks/*.md 的
# 目录载体）均可读 ⇒ 写 AC-206 记录。缺 host/project_root 不写（fail-closed）；目录/可读性如实写布尔。
step5_dual_carrier() {
  local root="$1"
  probe_ac206_dual_carrier "$root"
  AC206_HOST="$(hostname 2>/dev/null || echo '')"
  AC206_PROJECT_ROOT="$root"
  echo "== ⑤ dual carrier (AC-206): goals/ + tasks/ both created and stores readable =="
  echo "  goals_dir_created=$AC206_GOALS_DIR_CREATED tasks_dir_created=$AC206_TASKS_DIR_CREATED goal_store_readable=$AC206_GOAL_STORE_READABLE task_store_readable=$AC206_TASK_STORE_READABLE host=$AC206_HOST"
  write_ac206_record "$TS" "$AC206_HOST" "$AC206_PROJECT_ROOT" \
    "$AC206_GOALS_DIR_CREATED" "$AC206_TASKS_DIR_CREATED" \
    "$AC206_GOAL_STORE_READABLE" "$AC206_TASK_STORE_READABLE" "$AC89"
  echo "  ac206 record written → $AC89"
  return 0
}

# step ④：在第三方项目（$ROOT，无 plugin/）里用 installed quay CLI start promotion driver，轮询 status 载体
# 确认 driver_alive=1 ∧ carrier_records>0 ⇒ 写 AC-203 记录。缺任一生效读数不写（fail-closed）。
step4_driver_liveness() {
  local root="$1" qrl i status_json
  # installed quay CLI 经 realpath（npm bin symlink 不派发——step1 已实测；loop 也走 realpath 的 .quay/runtime/bin/quay.js）。
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  AC203_HOST="$(hostname 2>/dev/null || echo '')"
  AC203_PROJECT_ROOT="$root"
  AC203_HAS_PLUGIN_DIR=1
  [ -d "$root/plugin" ] || AC203_HAS_PLUGIN_DIR=0
  echo "== ④ driver liveness (AC-203): start promotion driver in the third-party project, read the status carrier =="
  if ! node "$qrl" driver start --kind promotion --root "$root" >/dev/null 2>&1; then
    echo "  FAIL: quay driver start --kind promotion exited non-zero (see $root/.quay logs)"
    return 1
  fi
  # 轮询 status 至多 30s，等 driver 首轮写 round 心跳（carrier_records>0 的直接量）。
  for i in $(seq 1 60); do
    status_json="$(node "$qrl" driver status --kind promotion --root "$root" --json 2>/dev/null || true)"
    probe_ac203_driver_status "$status_json"
    if [ "$AC203_EVALUATED" = "1" ] && [ "$AC203_DRIVER_ALIVE" = "1" ] && [ "$AC203_CARRIER_RECORDS" -gt 0 ] 2>/dev/null; then break; fi
    sleep 0.5
  done
  echo "  driver_alive=$AC203_DRIVER_ALIVE carrier_records=$AC203_CARRIER_RECORDS has_plugin_dir=$AC203_HAS_PLUGIN_DIR evaluated=$AC203_EVALUATED host=$AC203_HOST"
  if [ "$AC203_EVALUATED" = "1" ] && [ "$AC203_DRIVER_ALIVE" = "1" ] && [ "$AC203_CARRIER_RECORDS" -gt 0 ] 2>/dev/null && [ "$AC203_HAS_PLUGIN_DIR" = "0" ]; then
    # 写入点是 helper（统一补 top-level build_sha）；helper fail-closed ⇒ rc≠0 时【不写】。
    # ⛔ 不因 rc≠0 中止本步（后续步骤不依赖该记录，且中止会把「缺锚」伪装成「脚本崩了」）；
    # 但也 ⛔ 不静默——如实打印，与下一分支的 NOTE 同形（缺值≠合格，硬规则 3b）。
    if write_ac203_record "$AC203_HOST" "$AC203_PROJECT_ROOT" "0" "1" "$AC203_CARRIER_RECORDS"; then
      # AC-240：本次运行写出了 AC-203（step④ 是另一条产出路径，与 step⑤ 的探测点等价——
      # 两者共用同一个 $ROOT，谁先写成算谁的；取值只看「本次运行写没写」，⛔ 不回读载体反推）。
      AC203_WRITTEN_THIS_RUN=1
      AC203_WRITTEN_ROOT="$AC203_PROJECT_ROOT"
      echo "  ac203 record written → $AC89"
    else
      echo "  NOTE: AC-203 record NOT written (fail-closed: BUILD_SHA missing/non-40-hex or AC89 path empty — 缺值≠合格)"
    fi
    return 0
  fi
  echo "  NOTE: AC-203 record NOT written (driver not alive / no carrier records / plugin dir present — 缺值≠合格)"
  return 0
}

# ── AC-204（GOAL-009）：quay-init 禁复制面（mcp/commands/hooks）补全 + enable 成对判定 ──────────
# 枚举 $ROOT 落地路径 → 用【同一个】判源（quay-init-closure-assertion.ts 的 assertClosure）算
# forbidden_count（⛔ 不在此脚本硬编码 FORBIDDEN_PREFIXES——复制一份就是制造漂移，硬规则 4c）；
# 解析 $ROOT/.claude/settings.json 判 enable_declared（enabledPlugins 非空 ∧ permissions.allow 含
# mcp__plugin_quay_quay__*）。两者皆可解析才可落账；缺任一生效读数不写（硬规则 3b：缺值 ≠ 合格）。
probe_ac204_forbidden_surface() {
  local root="$1" out
  AC204_FORBIDDEN_COUNT=-1
  AC204_ENABLE_DECLARED=""
  AC204_EVALUATED=0
  [ -d "$root" ] || return 0
  # node 动态 import 判源（--input-type=module + top-level await）。argv 顺序：$1=$root（供 isDirectEntry
  # 判 basename ≠ "quay-init-closure-assertion"，避免 import 时误触发其 main()）、$2=判源 TS 路径。
  out="$("$VC_NODE" --no-warnings --experimental-strip-types --input-type=module -e '
    const mod = await import("file://" + process.argv[2]);
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = process.argv[1];
    const rels = [];
    const walk = (d) => {
      let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === ".git") continue;      // git internals are not laid-down product
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) rels.push(path.relative(root, p).split(path.sep).join("/"));
      }
    };
    walk(root);
    rels.sort();
    console.log("forbidden_count=" + mod.assertClosure(rels).forbiddenCopies.length);
  ' -- "$root" "$SCRIPT_DIR/quay-init-closure-assertion.ts" 2>/dev/null)"
  AC204_FORBIDDEN_COUNT="$(printf '%s\n' "$out" | sed -n 's/^forbidden_count=//p' | head -1)"
  case "$AC204_FORBIDDEN_COUNT" in
    ''|*[!0-9]*) AC204_FORBIDDEN_COUNT=-1 ;;
  esac
  AC204_ENABLE_DECLARED="$(probe_ac204_enable_declared "$root/.claude/settings.json")"
  if [ "$AC204_FORBIDDEN_COUNT" -ge 0 ] 2>/dev/null && [ -n "$AC204_ENABLE_DECLARED" ]; then
    AC204_EVALUATED=1
  fi
}

# 解析 .claude/settings.json 判 enable_declared。缺文件/不可解析 ⇒ 输出空（未评估 ≠ 合格，硬规则 3b）；
# 可解析 ⇒ 输出 0/1（enabledPlugins 非空 ∧ permissions.allow 含 mcp__plugin_quay_quay__*）。
probe_ac204_enable_declared() {
  local settings="$1" out readable declared
  [ -f "$settings" ] || { printf ''; return 0; }
  out="$("$VC_NODE" --no-warnings -e '
    const fs = require("node:fs");
    const p = process.argv[1];
    let s;
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch { console.log("readable=0"); process.exit(0); }
    if (typeof s !== "object" || s === null || Array.isArray(s)) { console.log("readable=0"); process.exit(0); }
    const ep = s.enabledPlugins || {};
    const allow = (s.permissions && Array.isArray(s.permissions.allow)) ? s.permissions.allow : [];
    const epNonEmpty = Object.keys(ep).length > 0;
    const mcpAllow = allow.some((a) => typeof a === "string" && a.indexOf("mcp__plugin_quay_quay__") === 0);
    console.log("readable=1");
    console.log("enable_declared=" + (epNonEmpty && mcpAllow ? "1" : "0"));
  ' "$settings" 2>/dev/null)"
  readable="$(printf '%s\n' "$out" | sed -n 's/^readable=//p' | head -1)"
  declared="$(printf '%s\n' "$out" | sed -n 's/^enable_declared=//p' | head -1)"
  if [ "$readable" = "1" ]; then printf '%s' "$declared"; else printf ''; fi
}

# 写 GOAL-009-AC-204 记录。缺任一成功读数（host/project_root 空、forbidden_count≠0、enable_declared≠1）
# ⇒ 不写 return 1（fail-closed，缺值/缺成功 ≠ 合格）。五字段逐字满足 criterion 过滤：
# forbidden_count 是 JSON 整数 0、enable_declared 是 JSON 字面 true。
write_ac204_record() {
  local ts="$1" host="$2" project_root="$3" forbidden_count="$4" enable_declared="$5" ac89="$6"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ "$forbidden_count" = "0" ] || return 1
  [ "$enable_declared" = "1" ] || return 1
  mkdir -p "$(dirname "$ac89")"
  printf '{"ts":"%s","ac":"GOAL-009-AC-204","host":"%s","project_root":"%s","forbidden_count":0,"enable_declared":true}\n' \
    "$ts" "$host" "$project_root" >> "$ac89"
  return 0
}

# step ⑥：在第三方项目（$ROOT，step ② 后）枚举落地路径算 forbidden_count、读 settings.json 判
# enable_declared ⇒ 两者皆可读且 forbidden_count=0 ∧ enable_declared=1 时写 AC-204 记录。
step_ac204_forbidden_surface() {
  local root="$1"
  probe_ac204_forbidden_surface "$root"
  AC204_HOST="${HOST:-}"                       # --host B|C flag（修法 3: host 取 --host B|C）
  AC204_PROJECT_ROOT="$(readlink -f "$root" 2>/dev/null || echo "$root")"
  echo "== ⑥ forbidden surface (AC-204): quay-init writes ENABLE only, never mcp/commands/hooks copies =="
  echo "  forbidden_count=$AC204_FORBIDDEN_COUNT enable_declared=${AC204_ENABLE_DECLARED:-<unread>} evaluated=$AC204_EVALUATED host=${AC204_HOST:-<none>} project_root=$AC204_PROJECT_ROOT"
  if write_ac204_record "$TS" "$AC204_HOST" "$AC204_PROJECT_ROOT" "$AC204_FORBIDDEN_COUNT" "$AC204_ENABLE_DECLARED" "$AC89"; then
    echo "  ac204 record written → $AC89"
  else
    echo "  NOTE: AC-204 record NOT written (forbidden_count=$AC204_FORBIDDEN_COUNT enable_declared=${AC204_ENABLE_DECLARED:-<unread>} host=${AC204_HOST:-<none>} — 缺值/缺成功读数≠合格)"
  fi
  return 0
}

# ── AC-205（GOAL-009）：会话投递通道——安装物 dist/send-to-session.js 真投 + transcript 外部可核 ──
# 判据读载体（host/shipped_from_installed_artifact/transcript_confirmed）。⛔ 不采信发送方自述：
# send-to-session 走 Unix socket 返回 0 字节、无 ack ⇒ exit 0 不代表真收到。transcript_confirmed
# 只由 transcript-delivery-check.js --check（读目标 transcript jsonl，判 delivered 的退出码）得出，
# ⛔ 不由 send-to-session 的退出码得出（AC2/AC4 判据）。shipped_from_installed_artifact 取「所用
# send-to-session 出自安装物 dist（$(npm root -g)/quay/plugin/scripts/dist/send-to-session.js），
# 非 dev 树」这一事实。目标会话发现：枚举 ~/.claude/sessions/<pid>.json（同 send-to-session.ts
# --pid 的注册源），取第一个【messagingSocketPath 存在 + 有 peerToken .key + sessionId 合法】的 live 会话。

# 写 GOAL-009-AC-205 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 缺任一成功读数（host 空、shipped_from_installed_artifact≠true、transcript_confirmed≠true）⇒ 不写
# return 1（fail-closed，缺值/缺成功 ≠ 合格）。三字段逐字满足 criterion 过滤：
# shipped_from_installed_artifact / transcript_confirmed 是 JSON 字面 true。
write_ac205_record() {
  local host="$1" shipped="$2" transcript_confirmed="$3"
  [ -n "$host" ] || return 1
  [ "$shipped" = "true" ] || return 1
  [ "$transcript_confirmed" = "true" ] || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-205\",\"host\":\"$host\",\"shipped_from_installed_artifact\":$shipped,\"transcript_confirmed\":$transcript_confirmed"
}

# 找目标会话（~/.claude/sessions/<pid>.json）：输出 "pid\nsessionId\nsocket\ncwd"（4 行），无则空。
# 判据：messagingSocketPath 存在（-S）∧ 有 <pid>.*.key（peerToken 载体）∧ sessionId 非空。
find_ac205_target_session() {
  "$VC_NODE" --no-warnings -e '
    const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
    const dir = path.join(os.homedir(), ".claude", "sessions");
    let out = "";
    try {
      const names = fs.readdirSync(dir);
      for (const f of names) {
        if (!f.endsWith(".json")) continue;
        const pid = f.slice(0, -5);
        let j;
        try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
        const sock = typeof j.messagingSocketPath === "string" ? j.messagingSocketPath : "";
        const sid = typeof j.sessionId === "string" ? j.sessionId : "";
        const cwd = typeof j.cwd === "string" ? j.cwd : "";
        if (!sock || !sid) continue;
        if (!fs.existsSync(sock)) continue;
        if (!names.some((k) => k.startsWith(pid + ".") && k.endsWith(".key"))) continue;
        out = pid + "\n" + sid + "\n" + sock + "\n" + cwd;
        break;
      }
    } catch {}
    process.stdout.write(out);
  ' 2>/dev/null
}

# step ⑦：会话投递（AC-205）——用安装物 dist/send-to-session.js 给同址目标会话发 probe，
# 读目标 transcript 判 delivered ⇒ 写 AC-205 记录。缺任一生效读数不写（fail-closed）。
step_ac205_session_delivery() {
  local qroot send_js check_js target pid session_id sock cwd transcript probe i verdict
  AC205_HOST="$(hostname 2>/dev/null || echo '')"
  AC205_SHIPPED_FROM_INSTALLED_ARTIFACT=0
  AC205_TRANSCRIPT_CONFIRMED=0
  AC205_EVALUATED=0
  qroot="$(npm root -g --prefix "$STEP1_PREFIX" 2>/dev/null || echo '')"
  send_js="$qroot/quay/plugin/scripts/dist/send-to-session.js"
  check_js="$qroot/quay/plugin/scripts/dist/transcript-delivery-check.js"
  echo "== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified =="
  if [ ! -f "$send_js" ] || [ ! -f "$check_js" ]; then
    echo "  NOTE: AC-205 record NOT written (installed dist/send-to-session.js or dist/transcript-delivery-check.js missing — 安装物不自洽，缺值≠合格)"
    return 0
  fi
  # 所用 send-to-session 出自安装物 dist（非 dev 树）——shipped_from_installed_artifact 的事实来源。
  AC205_SHIPPED_FROM_INSTALLED_ARTIFACT=1
  target="$(find_ac205_target_session)"
  [ -n "$target" ] || { echo "  NOTE: AC-205 record NOT written (no live same-host target session in ~/.claude/sessions — 缺目标会话≠合格)"; return 0; }
  pid="$(printf '%s\n' "$target" | sed -n '1p')"
  session_id="$(printf '%s\n' "$target" | sed -n '2p')"
  sock="$(printf '%s\n' "$target" | sed -n '3p')"
  cwd="$(printf '%s\n' "$target" | sed -n '4p')"
  # 目标 transcript 路径：sessionTranscriptPath = ~/.claude/projects/<projectSlug(cwd)>/<sessionId>.jsonl，
  # projectSlug = cwd.split("/").join("-")。读不到精确路径时 glob 兜底（硬规则 3b：读不到 ⇒ 不置真）。
  transcript="${HOME}/.claude/projects/$(printf '%s' "$cwd" | tr '/' '-')/${session_id}.jsonl"
  if [ ! -f "$transcript" ]; then
    transcript="$(ls -t "${HOME}"/.claude/projects/*/"${session_id}".jsonl 2>/dev/null | head -1 || true)"
  fi
  [ -n "$transcript" ] && [ -f "$transcript" ] || { echo "  NOTE: AC-205 record NOT written (target transcript not found for sessionId=$session_id — 缺值≠合格)"; return 0; }
  probe="ac205-probe-$(date +%s)-$$"
  echo "  target: pid=$pid sessionId=$session_id (name from registry)"
  echo "  send-to-session (installed dist): $send_js"
  echo "  transcript: $transcript"
  # ① 发送 probe（send exit 0 只表示「连接+写成功」，socket 无 ack ⇒ ⛔ 不作 transcript_confirmed 依据）
  if ! "$VC_NODE" --no-warnings "$send_js" --pid "$pid" "$probe" >/dev/null 2>&1; then
    echo "  NOTE: AC-205 record NOT written (send-to-session failed to connect — 缺值≠合格)"
    return 0
  fi
  AC205_EVALUATED=1
  # ② transcript 外部可核：轮询 transcript-delivery-check.js --check（读 transcript jsonl 判 delivered）。
  #    ⛔ transcript_confirmed 只从这里得出（exit 0 = delivered），⛔ 从不读 send 的退出码（AC2/AC4）。
  for i in $(seq 1 30); do
    if "$VC_NODE" --no-warnings "$check_js" --check "$transcript" --text "$probe" >/dev/null 2>&1; then
      AC205_TRANSCRIPT_CONFIRMED=1
      break
    fi
    sleep 1
  done
  echo "  shipped_from_installed_artifact=$AC205_SHIPPED_FROM_INSTALLED_ARTIFACT transcript_confirmed=$AC205_TRANSCRIPT_CONFIRMED evaluated=$AC205_EVALUATED host=$AC205_HOST"
  if [ "$AC205_EVALUATED" = "1" ] && [ "$AC205_SHIPPED_FROM_INSTALLED_ARTIFACT" = "1" ] && [ "$AC205_TRANSCRIPT_CONFIRMED" = "1" ]; then
    write_ac205_record "$AC205_HOST" "true" "true"
    echo "  ac205 record written → $AC89"
    return 0
  fi
  echo "  NOTE: AC-205 record NOT written (transcript_confirmed=$AC205_TRANSCRIPT_CONFIRMED — send exit 0 但 transcript 未物化 ⇒ 不落账，负控制 AC4)"
  return 0
}

# ── AC-234（GOAL-015）：web 指向第三方项目时显示其真实载体与过程记录 ─────────────────────────
# 判据（goals/AC-234-web-指向第三方项目时显示其真实载体与过程记录-http-200-不算证据-退出条件②.md）：
# 载体存在 ac="GOAL-015-AC-234" 记录，且 host≠本机 ∧ project_root∉本仓库 ∧ tasks_rendered>0 ∧
# goals_rendered>0 ∧ round_records_rendered>0。三计数取【真实渲染 HTML 内容】（task/goal 锚点计数 +
# round 行计数），⛔ 非 HTTP 200 探活（硬规则 4：只断言「服务起得来」与「渲染空壳页」同形——三计数
# 缺一不可）。host≠本机 ∧ project_root∉本仓库 由 criterion 在读取端过滤（本机/本仓库内的记录仍 exit 1）。
# 前置：quay-init 只 mkdir goals/、不创建 goal 记录（quay-init.sh:2236）⇒ 全新第三方项目 /goal 必为空
# ⇒ 验证步骤先经 Provider ABI（quay goal write）补一条真实 goal 记录，否则 goals_rendered 结构上不可满足。
AC234_HOST=""                                # 目标宿主 hostname（criterion 要求 host≠本机）
AC234_PROJECT_ROOT=""                        # 第三方项目绝对路径（criterion 要求 ∉ 本仓库）
AC234_TASKS_RENDERED=-1                      # /tasks 真实渲染的任务行数（-1 = 未读）
AC234_GOALS_RENDERED=-1                      # /goal 真实渲染的 goal 行数（-1 = 未读）
AC234_ROUND_RECORDS_RENDERED=-1              # /tests 真实渲染的 round 行数（-1 = 未读）
AC234_EVALUATED=0                            # 1 = 三页 HTML 都读到且计数完成

# probe_ac234_render_counts <tasks_html> <goals_html> <tests_html>
# 从真实渲染 HTML 内容计数（⛔ 非 HTTP 状态码）：
#   tasks_rendered         = /tasks 里 `href="/task/` 任务锚点数（每任务一行一个）
#   goals_rendered         = /goal  里 `href="/goal/` goal 锚点数（每 goal 一行一个）
#   round_records_rendered = /tests 里 `href="/tests?round=` round 行锚点数（每轮一行一个）
# 任一 HTML 为空 ⇒ 三计数=-1（未评估 ≠ 合格，硬规则 3b）；否则三计数 ≥0。
probe_ac234_render_counts() {
  local tasks_html="$1" goals_html="$2" tests_html="$3" n
  AC234_TASKS_RENDERED=-1; AC234_GOALS_RENDERED=-1; AC234_ROUND_RECORDS_RENDERED=-1
  AC234_EVALUATED=0
  [ -n "$tasks_html" ] && [ -n "$goals_html" ] && [ -n "$tests_html" ] || return 0
  AC234_TASKS_RENDERED="$(printf '%s\n' "$tasks_html" | grep -o 'href="/task/' | wc -l | tr -d ' ' || true)"
  AC234_GOALS_RENDERED="$(printf '%s\n' "$goals_html" | grep -o 'href="/goal/' | wc -l | tr -d ' ' || true)"
  AC234_ROUND_RECORDS_RENDERED="$(printf '%s\n' "$tests_html" | grep -o 'href="/tests?round=' | wc -l | tr -d ' ' || true)"
  for n in AC234_TASKS_RENDERED AC234_GOALS_RENDERED AC234_ROUND_RECORDS_RENDERED; do
    case "${!n}" in ''|*[!0-9]*) eval "$n=-1" ;; esac
  done
  AC234_EVALUATED=1
  return 0
}

# 写 GOAL-015-AC-234 记录。缺任一成功读数（host/project_root 空、三计数任一非正）⇒ 不写 return 1
# （硬规则 3b：缺值 ≠ 合格；三计数缺一不可——「服务起得来」与「渲染空壳页」同形）。
write_ac234_record() {
  local ts="$1" host="$2" project_root="$3" tasks="$4" goals="$5" rounds="$6" ac89="$7"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ "$tasks" -gt 0 ] 2>/dev/null || return 1
  [ "$goals" -gt 0 ] 2>/dev/null || return 1
  [ "$rounds" -gt 0 ] 2>/dev/null || return 1
  mkdir -p "$(dirname "$ac89")"
  printf '{"ts":"%s","ac":"GOAL-015-AC-234","host":"%s","project_root":"%s","tasks_rendered":%s,"goals_rendered":%s,"round_records_rendered":%s}\n' \
    "$ts" "$host" "$project_root" "$tasks" "$goals" "$rounds" >> "$ac89"
  return 0
}

# step ⑧：web 指向第三方项目时显示其真实载体与过程记录（AC-234）——
# 经 Provider ABI 补一条 goal 记录（若 goals/ 空）→ quay serve 指向 $ROOT → 取回 /tasks /goal /tests
# 真实 HTML → 内容级计数（⛔ 非 HTTP 200 探活）→ 三计数全 >0 时写 ac="GOAL-015-AC-234" 记录。
step_ac234_web_render() {
  local root="$1" qrl port tasks_html goals_html tests_html i serve_pid goal_body
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  AC234_HOST="$(hostname 2>/dev/null || echo '')"
  AC234_PROJECT_ROOT="$(readlink -f "$root" 2>/dev/null || echo "$root")"
  AC234_TASKS_RENDERED=-1; AC234_GOALS_RENDERED=-1; AC234_ROUND_RECORDS_RENDERED=-1
  AC234_EVALUATED=0
  echo "== ⑧ web render (AC-234): quay serve → third-party project, count REAL rendered carriers + round records =="
  # (a) goals_rendered>0 前置：quay-init 只 mkdir goals/、不写 goal 记录 ⇒ 空 goals/ 时经 ABI 补一条真实 goal。
  if [ -d "$root/goals" ] && [ -z "$(find "$root/goals" -maxdepth 1 -name '*.md' -print -quit 2>/dev/null)" ]; then
    goal_body="第三方项目 web 渲染验证用 goal——由 verify-deliver-coldstart AC-234 步骤经 Provider ABI 写入（背景：证明 /goal 渲染真实 goal 载体，非空壳页）。"
    if node "$qrl" goal write GOAL-VERIFY-AC234 --title "web 渲染验证 goal (AC-234)" --status active \
        --origin "verify-deliver-coldstart AC-234 步骤经 Provider ABI 写入——证明 /goal 渲染真实载体" \
        --body "$goal_body" --root "$root" >/dev/null 2>&1; then
      echo "  seeded goal via ABI: GOAL-VERIFY-AC234 (quay-init does not create goal records — goals_rendered>0 前置)"
    else
      echo "  NOTE: goal seed via ABI failed — goals_rendered 可能为 0（空 /goal 状态如实计数，不伪造）"
    fi
  fi
  # (b) 起 serve（指向 $ROOT 的真实 web 面；自选高位端口避免碰撞；cwd=$root 使 serve 解析 $root/.quay/config.yml）。
  port=$(( 41000 + ($$ % 20000) ))
  serve_pid=""
  (
    cd "$root" || exit 1
    node "$qrl" serve --port "$port" --host 127.0.0.1 >/dev/null 2>&1 &
    echo $! > "$root/.quay/ac234-serve.pid"
  )
  serve_pid="$(cat "$root/.quay/ac234-serve.pid" 2>/dev/null || echo '')"
  # (c) 等 serve 就绪并取回真实 HTML 正文（内容级：curl 取回页面内容，⛔ 不是只探 TCP/HTTP 200）。
  tasks_html=""; goals_html=""; tests_html=""
  for i in $(seq 1 60); do
    tasks_html="$(curl -s --max-time 5 "http://127.0.0.1:$port/tasks" 2>/dev/null || true)"
    [ -n "$tasks_html" ] && break
    sleep 0.5
  done
  if [ -n "$tasks_html" ]; then
    goals_html="$(curl -s --max-time 5 "http://127.0.0.1:$port/goal" 2>/dev/null || true)"
    tests_html="$(curl -s --max-time 5 "http://127.0.0.1:$port/tests" 2>/dev/null || true)"
    probe_ac234_render_counts "$tasks_html" "$goals_html" "$tests_html"
  fi
  # (d) 收尾：杀 serve（本步骤自起自清，不留常驻进程）。
  [ -n "$serve_pid" ] && kill "$serve_pid" 2>/dev/null || true
  rm -f "$root/.quay/ac234-serve.pid" 2>/dev/null || true
  echo "  tasks_rendered=$AC234_TASKS_RENDERED goals_rendered=$AC234_GOALS_RENDERED round_records_rendered=$AC234_ROUND_RECORDS_RENDERED evaluated=$AC234_EVALUATED host=${AC234_HOST:-<none>} project_root=$AC234_PROJECT_ROOT"
  if [ "$AC234_EVALUATED" = "1" ] \
     && [ "$AC234_TASKS_RENDERED" -gt 0 ] 2>/dev/null \
     && [ "$AC234_GOALS_RENDERED" -gt 0 ] 2>/dev/null \
     && [ "$AC234_ROUND_RECORDS_RENDERED" -gt 0 ] 2>/dev/null; then
    if write_ac234_record "$TS" "$AC234_HOST" "$AC234_PROJECT_ROOT" "$AC234_TASKS_RENDERED" "$AC234_GOALS_RENDERED" "$AC234_ROUND_RECORDS_RENDERED" "$AC89"; then
      echo "  ac234 record written → $AC89"
      return 0
    fi
  fi
  echo "  NOTE: AC-234 record NOT written (三计数任一 ≤0 或未评估/缺 host/project_root —— 缺值≠合格，硬规则 3b)"
  return 0
}

# ── AC-232（GOAL-009）：下游 goal 载体必须能写、能读回 ─────────────────────────────────────────
# 判据（goals/AC-232-*.md）：载体存在 ac="GOAL-009-AC-232" 记录，且 host≠本机 ∧ project_root∉本仓库
# ∧ goal_write_ok=true ∧ goal_read_back_ok=true ∧ goal_records>0。三字段缺一不可——只断言「写调用返回 0」
# 与「写了个空文件」同形（硬规则 3b）。AC-206 只断言 goals/ 目录建了与可读、不断言能写；本步骤补「能写 + 能读回」。
AC232_HOST=""                                # 目标宿主 hostname（criterion 要求 host≠本机）
AC232_PROJECT_ROOT=""                        # 第三方项目绝对路径（criterion 要求 ∉ 本仓库）
AC232_GOAL_WRITE_OK=0                        # 1 = goal write exit 0 ∧ goals/GOAL-*.md 落盘
AC232_GOAL_READ_BACK_OK=0                    # 1 = goal show 读回该 id 且 stdout 含该 id
AC232_GOAL_RECORDS=-1                        # goal list 计数（-1 = 未读）
AC232_EVALUATED=0                            # 1 = write + read-back + list 都执行且计数完成

# probe_ac232_goal_write_readback <root>
# 用 installed quay CLI 对下游项目（--root）经 Provider ABI 写一条 GOAL 记录再读回（⛔ 不走任务侧、不经 HTTP）。
#   goal_write_ok     = goal write exit 0 ∧ goals/GOAL-*.md 落盘（写调用 0 与空文件同形 ⇒ 必须双判，硬规则 3b）
#   goal_read_back_ok = goal show GOAL-001 读回该 id 且 stdout 含该 id（写了读不回 = 未持久/格式不可解）
#   goal_records      = goal list --json 数组长度（空 goals/ ⇒ 0，非未读）
# 缺有效读数如实置 0/-1；AC232_EVALUATED 区分「未评估」与「合格」（硬规则 3b）。
probe_ac232_goal_write_readback() {
  local root="$1" qrl goal_title goal_body show_out list_json n
  AC232_GOAL_WRITE_OK=0; AC232_GOAL_READ_BACK_OK=0; AC232_GOAL_RECORDS=-1
  AC232_EVALUATED=0
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  goal_title="下游 goal 载体写读回验证 (AC-232)"
  goal_body="第三方项目 goal 载体写读回验证用 GOAL——由 verify-deliver-coldstart AC-232 步骤经 Provider ABI 写入（背景：AC-206 只断言 goals/ 目录建了与可读，本步骤证明下游 goal 载体真的能写、能读回）。"
  # (a) 写：经 Provider ABI（quay goal write），body ≥40 非空白（goal-store MIN_GOAL_BODY_CHARS=40），
  #     id GOAL-001 匹配 GOAL-\d{3,}（goal-store.ts:86）。⛔ 不传 body 的 write 是 09-10 goal write failed 的根因。
  if node "$qrl" goal write GOAL-001 --title "$goal_title" \
      --origin "verify-deliver-coldstart AC-232 步骤经 Provider ABI 写入——证明下游 goal 载体能写" \
      --body "$goal_body" --root "$root" >/dev/null 2>&1 \
     && [ -n "$(find "$root/goals" -maxdepth 1 -name 'GOAL-*.md' -print -quit 2>/dev/null)" ]; then
    AC232_GOAL_WRITE_OK=1
  fi
  # (b) 读回：show 读回该 id 且 stdout 含该 id（非空 + 命中 id——「写了读不回」与「读回空」同形）。
  if show_out="$(node "$qrl" goal show GOAL-001 --root "$root" 2>/dev/null)" \
     && [ -n "$show_out" ] && printf '%s' "$show_out" | grep -q 'GOAL-001'; then
    AC232_GOAL_READ_BACK_OK=1
  fi
  # (c) list 计数：JSON 数组长度（空 goals/ ⇒ 0，非未读——硬规则 3b）。
  if list_json="$(node "$qrl" goal list --root "$root" --json 2>/dev/null)"; then
    n="$(printf '%s' "$list_json" | "$VC_NODE" --no-warnings -e '
      let s="";
      process.stdin.on("data", d => s += d).on("end", () => {
        try { const j = JSON.parse(s); console.log(Array.isArray(j) ? j.length : -1); }
        catch { console.log(-1); }
      });
    ' 2>/dev/null)"
    case "$n" in ''|*[!0-9]*) n=-1 ;; esac
    AC232_GOAL_RECORDS="$n"
  fi
  AC232_EVALUATED=1
  return 0
}

# 写 GOAL-009-AC-232 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 缺 host/project_root ⇒ 不写 return 1（fail-closed，缺值≠合格）；三字段是【数据】（布尔/整数如实写，
# false/0 也是有效读数——AC4 负控制据此注入能取假的记录，criterion 读 false/0 仍 exit 1）。
write_ac232_record() {
  local host="$1" project_root="$2" gwo="$3" grbo="$4" grec="$5"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  case "$gwo" in 0|1) ;; *) return 1 ;; esac
  case "$grbo" in 0|1) ;; *) return 1 ;; esac
  [ "$grec" -ge 0 ] 2>/dev/null || return 1
  local b_gwo=false b_grbo=false
  [ "$gwo" = "1" ] && b_gwo=true
  [ "$grbo" = "1" ] && b_grbo=true
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-232\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"goal_write_ok\":$b_gwo,\"goal_read_back_ok\":$b_grbo,\"goal_records\":$grec"
}

# step ⑨：下游 goal 载体写+读回（AC-232）——经 Provider ABI 对第三方项目（$ROOT）写一条 GOAL 记录再读回
# ⇒ goal_write_ok=1 ∧ goal_read_back_ok=1 ∧ goal_records>0 时写 ac="GOAL-009-AC-232" 记录（fail-closed）。
step_ac232_goal_carrier_write() {
  local root="$1"
  AC232_HOST="$(hostname 2>/dev/null || echo '')"
  AC232_PROJECT_ROOT="$(readlink -f "$root" 2>/dev/null || echo "$root")"
  echo "== ⑨ goal carrier write+read-back (AC-232): goal write + show/list read-back into the third-party project =="
  probe_ac232_goal_write_readback "$root"
  echo "  goal_write_ok=$AC232_GOAL_WRITE_OK goal_read_back_ok=$AC232_GOAL_READ_BACK_OK goal_records=$AC232_GOAL_RECORDS evaluated=$AC232_EVALUATED host=${AC232_HOST:-<none>} project_root=$AC232_PROJECT_ROOT"
  if [ "$AC232_EVALUATED" = "1" ] \
     && [ "$AC232_GOAL_WRITE_OK" = "1" ] \
     && [ "$AC232_GOAL_READ_BACK_OK" = "1" ] \
     && [ "$AC232_GOAL_RECORDS" -gt 0 ] 2>/dev/null; then
    if write_ac232_record "$AC232_HOST" "$AC232_PROJECT_ROOT" "1" "1" "$AC232_GOAL_RECORDS"; then
      echo "  ac232 record written → $AC89"
      return 0
    fi
  fi
  echo "  NOTE: AC-232 record NOT written (goal write/read-back 未达标 —— 写调用 0 与空文件同形，三字段缺一不可，硬规则 3b)"
  return 0
}

# ── 下游 task 载体写+读回（AC-234 的 tasks_rendered>0 来源；Plan 2a）────────────────────────
# quay-init 只 mkdir tasks/、不创建 task 记录（quay-init.sh:2236 同源）⇒ 全新第三方项目 /tasks 必为空
# ⇒ tasks_rendered 结构上不可满足。本步骤经 Provider ABI（quay task create）写一条真实 task 再落盘核
# tasks/<id>.md（同 AC-232 的 goal 写读回同族），使 /tasks 渲染真实 task 载体。⛔ 不在 AC-234 步骤内自造
# 渲染内容（硬规则 4）——由本步骤写、AC-234 只渲染（DoD「别的步骤真实写进去的载体内容」）。
AC234_TASK_WRITE_OK=0                       # 1 = task create exit 0 ∧ tasks/<id>.md 落盘
AC234_TASK_READ_BACK_OK=0                   # 1 = task view 读回该 id 且 stdout 含该 id
step_task_carrier_write() {
  local root="$1" qrl task_id bodyfile show_out
  qrl="${STEP1_PREFIX}/bin/quay"
  qrl="$(readlink -f "$qrl" 2>/dev/null || echo "$qrl")"
  task_id="verify-task-234"
  AC234_TASK_WRITE_OK=0; AC234_TASK_READ_BACK_OK=0
  echo "== task carrier write+read-back (AC-234 tasks_rendered>0 来源): task create + view read-back into the third-party project =="
  bodyfile="$(mktemp -t verify-task-234-body.XXXXXX.md)" || return 0
  cat > "$bodyfile" <<'BODY'
## Proposal

第三方项目 web 渲染验证用任务——由 verify-deliver-coldstart 任务载体步骤经 Provider ABI 写入（背景：证明 /tasks 渲染真实 task 载体，非空壳页）。

## Plan

1. 本任务仅作为 web 渲染验证的 task 载体存在，无实现动作。

## Acceptance Criteria

- [ ] AC1 任务已写入第三方项目 task store，/tasks 页面可见其锚点。

## Definition of Done

- [ ] 任务经 Provider ABI 创建，task view 可读回该 id。

## Touches

- tasks/verify-task-234.md
BODY
  if node "$qrl" task create "$task_id" --title "web 渲染验证 task (AC-234 载体)" \
      --body-file "$bodyfile" --status todo --root "$root" >/dev/null 2>&1 \
     && [ -n "$(find "$root/tasks" -maxdepth 1 -name "${task_id}.md" -print -quit 2>/dev/null)" ]; then
    AC234_TASK_WRITE_OK=1
  fi
  rm -f "$bodyfile"
  if show_out="$(node "$qrl" task view "$task_id" --root "$root" 2>/dev/null)" \
     && [ -n "$show_out" ] && printf '%s' "$show_out" | grep -q "$task_id"; then
    AC234_TASK_READ_BACK_OK=1
  fi
  echo "  task_write_ok=$AC234_TASK_WRITE_OK task_read_back_ok=$AC234_TASK_READ_BACK_OK task_id=$task_id"
  if [ "$AC234_TASK_WRITE_OK" = "1" ]; then
    echo "  task create via ABI: $task_id (quay-init does not create task records — tasks_rendered>0 前置)"
  else
    echo "  NOTE: task create via ABI failed — tasks_rendered 可能为 0（空 /tasks 状态如实计数，不伪造）"
  fi
  return 0
}

# ── 下游 round 载体写（AC-234 的 round_records_rendered>0 来源；Plan 2）───────────────────────
# /tests 页只读 .quay/verification-round.jsonl（serve-tests 的唯一数据面载体）；第三方项目自己的 fan-in
# 委托 loop.test_command 直跑、不调用 full-suite-runner ⇒ 该文件结构上从不被第三方 loop 写 ⇒
# round_records_rendered 结构上不可满足。本步骤用【同一 writer】（runner-state-write.ts 的
# appendVerificationRound，full-suite-runner 的 verification-round 唯一 writer）落一条真实记录——
# 记录的是【本次跨机验证这一轮】真实发生的过程记录（startedAt/state/runner/commit 全部取自本次运行
# 的实际值），⛔ 不在 AC-234 步骤内自造（硬规则 4）。writer 由回传机件 scp（runner-state-write.ts +
# write-json-atomic.ts 二文件闭包，见 develop-deliver-tgz.sh verify_coldstart_mode）。
AC234_ROUND_WRITE_OK=0                      # 1 = appendVerificationRound exit 0 ∧ verification-round.jsonl 落盘
step_round_carrier_write() {
  local root="$1" started_at state runner commit
  AC234_ROUND_WRITE_OK=0
  started_at="${TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  state="green"                             # 本步骤只记录「载体已真实写入」这一轮的验证（goal/task 已在前两步落盘）
  runner="verify-deliver-coldstart"
  commit="${BUILD_SHA:-}"
  echo "== round record write (AC-234 round_records_rendered>0 来源): append a real verification-round record for THIS verify run =="
  if [ -f "$SCRIPT_DIR/runner-state-write.ts" ] && [ -f "$SCRIPT_DIR/write-json-atomic.ts" ]; then
    if "$VC_NODE" --no-warnings --experimental-strip-types --input-type=module -e '
      const { appendVerificationRound } = await import("file://" + process.argv[1]);
      appendVerificationRound(process.argv[2], {
        startedAt: process.argv[3],
        state: process.argv[4],
        runner: process.argv[5],
        ...(process.argv[6] ? { commit: process.argv[6] } : {}),
      });
    ' "$SCRIPT_DIR/runner-state-write.ts" "$root/.quay" "$started_at" "$state" "$runner" "$commit" 2>/dev/null \
       && [ -n "$(find "$root/.quay" -maxdepth 1 -name 'verification-round.jsonl' -print -quit 2>/dev/null)" ]; then
      AC234_ROUND_WRITE_OK=1
    fi
  fi
  echo "  round_write_ok=$AC234_ROUND_WRITE_OK state=$state runner=$runner started_at=$started_at commit=${commit:-<none>}"
  if [ "$AC234_ROUND_WRITE_OK" = "1" ]; then
    echo "  round record appended → $root/.quay/verification-round.jsonl (third-party loop never writes it — round_records_rendered>0 前置)"
  else
    echo "  NOTE: round record append failed (writer not shipped / node error) — round_records_rendered 可能为 0（如实计数，不伪造）"
  fi
  return 0
}

# ── 自检（hermetic：AC1 顺序 + AC2 直接量正/负控制，不碰真实安装）────────────────────────
selfcheck() {
  local tmp rc=1
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck: FAIL 无法创建临时目录" >&2; return 1; }
  local dead_ws alive_ws saved_home="$HOME"

  # control 1 (AC2 负向/negative)：无冷启动 + 只有 quay-init auto-commit ⇒ 判 not live
  #   结构上必须取假：即便 git 提交很新（quay-init 铺完刚提交），因为是 chore(quay-init) 提交，
  #   直接量判据必须【排除】它 ⇒ L2_OK=0 ⇒ COLDSTART_LIVE=no。
  dead_ws="$tmp/dead"
  mkdir -p "$dead_ws"
  git -C "$dead_ws" init -q -b main >/dev/null 2>&1
  git -C "$dead_ws" config user.email t@t >/dev/null 2>&1
  git -C "$dead_ws" config user.name t >/dev/null 2>&1
  echo x > "$dead_ws/a.txt"
  git -C "$dead_ws" add -A >/dev/null 2>&1
  git -C "$dead_ws" commit -qm "chore(quay-init): lay down quay plugin mechanism files (v0.4.0)" >/dev/null 2>&1
  force_l1_ok
  probe_direct_measures "$dead_ws"
  coldstart_verdict
  local d1 d2
  d1="$L1_OK"; d2="$COLDSTART_LIVE"

  # control 2 (AC2 正向/positive)：近期【非 chore】提交 + 机制铺到位 ⇒ 判 live
  alive_ws="$tmp/alive"
  mkdir -p "$alive_ws"
  git -C "$alive_ws" init -q -b main >/dev/null 2>&1
  git -C "$alive_ws" config user.email t@t >/dev/null 2>&1
  git -C "$alive_ws" config user.name t >/dev/null 2>&1
  echo x > "$alive_ws/a.txt"
  git -C "$alive_ws" add -A >/dev/null 2>&1
  git -C "$alive_ws" commit -qm "chore(quay-init): lay down quay plugin mechanism files (v0.4.0)" >/dev/null 2>&1
  echo y >> "$alive_ws/a.txt"
  git -C "$alive_ws" add -A >/dev/null 2>&1
  git -C "$alive_ws" commit -qm "inner: dispatch gap-something (real loop work)" >/dev/null 2>&1
  force_l1_ok
  probe_direct_measures "$alive_ws"
  coldstart_verdict
  local a1 a2
  a1="$L1_OK"; a2="$COLDSTART_LIVE"

  echo "selfcheck: dead(no-real-loop,recent-chore-commit) L1_OK=$d1 COLDSTART_LIVE=$d2 (expect 1/no)"
  echo "selfcheck: alive(recent-non-chore-commit) L1_OK=$a1 COLDSTART_LIVE=$a2 (expect 1/yes)"

  # control 6 (AC2 负向 —— proc_ok 假阳性回归, gap-verify-deliver-coldstart-l2-proc-ok-false-positive):
  # 进程存在(>=2)但 outer 窗口 pane 卡启动信任弹窗（L2_STARTUP_PROMPT=1）⇒ proc_ok 不得单独撑起 ⇒
  # COLDSTART_LIVE=no。B/C 实测形态：git_recent/wt_recent 均 0，4 个 claude 进程卡 "Quick safety
  # check" 弹窗 6.2h，coldstart_live 曾由 proc_ok 单独撑起（判据被实现违反）。
  L2_LAYER_PROCESS_CWD=2
  L2_STARTUP_PROMPT=1
  L2_GIT_COMMIT_AGE_MIN="-"
  L2_GIT_IS_QUAYINIT_COMMIT=0
  L2_INNER_WORKTREE_COUNT=0
  coldstart_verdict
  local p1 p2
  p1="$L2_OK"; p2="$COLDSTART_LIVE"

  # control 7 (AC2 正向 —— proc_ok 直接量): 进程存在(>=2) 且 已通过启动弹窗（L2_STARTUP_PROMPT=0）
  # ⇒ proc_ok 作活性信号 ⇒ COLDSTART_LIVE=yes（git/wt 均无近期信号，活性完全由 proc_ok+已过弹窗撑起）。
  L2_LAYER_PROCESS_CWD=2
  L2_STARTUP_PROMPT=0
  L2_GIT_COMMIT_AGE_MIN="-"
  L2_GIT_IS_QUAYINIT_COMMIT=0
  L2_INNER_WORKTREE_COUNT=0
  coldstart_verdict
  local p3 p4
  p3="$L2_OK"; p4="$COLDSTART_LIVE"

  # control 8 (复用 wiring —— AC1「复用 pane-state-classify 的 permission-prompt 识别，不新造」):
  # 真实信任弹窗 fixture 经 probe_startup_prompt 同一条 --pane-verdict 接缝必须判 intervention=1
  # （判定源：pane-state-classify.ts 的 --pane-verdict / classifyPaneVerdict）。
  local pv_fix pv_out p5
  pv_fix="Quick safety check: Is this a project you created or one you trust?
❯ 1. Yes, I trust this folder ✔
  2. No, exit
Enter to confirm · Esc to cancel"
  pv_out="$(printf '%s\n' "$pv_fix" | "$VC_NODE" --no-warnings --experimental-strip-types \
    "$SCRIPT_DIR/pane-state-classify.ts" --pane-verdict 2>/dev/null \
    || echo 'state=unknown busy=1 intervention=0 work_in_flight=0 region_empty=0')"
  if printf '%s' "$pv_out" | grep -Eq '^intervention=1$' 2>/dev/null; then p5=1; else p5=0; fi

  echo "selfcheck: prompt-blocked(procs=2,prompt=1) L2_OK=$p1 COLDSTART_LIVE=$p2 (expect 0/no)"
  echo "selfcheck: prompt-passed(procs=2,prompt=0) L2_OK=$p3 COLDSTART_LIVE=$p4 (expect 1/yes)"
  echo "selfcheck: pane-verdict-permission-intervention=$p5 (expect 1 — 复用 pane-state-classify 的 permission-prompt 识别)"

  # control 9 (AC3 负向 —— L1 未评估，硬规则 3b): SPEC 标记块读不到 ⇒ L1_NOT_EVALUATED=1 且
  # L1_OK=0 ——「未评估」与「合格」必须是可区分的两个取值。
  local ne_ws="$tmp/ne" n1 n2
  mkdir -p "$ne_ws"
  SPEC_PATH="$tmp/no-such-spec.md"
  probe_l1 "$ne_ws"
  n1="$L1_NOT_EVALUATED"; n2="$L1_OK"
  SPEC_PATH=""

  # control 10 (AC2 负向 —— 闭集来源单一，硬规则 4c): 闭集由 SPEC 标记块解析得出。先在临时 SPEC
  # 写 2 条闭集、项目根铺 2 条 ⇒ L1_OK=1；再在标记块内【增一行】（项目根没有的条目）⇒ 判定翻转
  # L1_OK=0 —— 证明真读了 SPEC（若不变说明仍是硬编码副本，AC2 判失败）。
  local cs_spec="$tmp/closed-set-spec.md" cs_ws="$tmp/cs" s_ok1 s_cnt1 s_ok2 s_cnt2
  mkdir -p "$cs_ws/.quay" "$cs_ws/tasks"
  printf 'providers: {}\n' > "$cs_ws/.quay/config.yml"
  printf 'QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\nQUAY-INIT-CLOSED-SET:END\n' > "$cs_spec"
  SPEC_PATH="$cs_spec"
  probe_l1 "$cs_ws"
  s_ok1="$L1_OK"; s_cnt1="$L1_CLOSED_SET_COUNT"
  printf 'QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\n- .claude/settings.json\nQUAY-INIT-CLOSED-SET:END\n' > "$cs_spec"
  probe_l1 "$cs_ws"
  s_ok2="$L1_OK"; s_cnt2="$L1_CLOSED_SET_COUNT"
  SPEC_PATH=""

  echo "selfcheck: l1-spec-not-evaluated(missing-spec) L1_NOT_EVALUATED=$n1 L1_OK=$n2 (expect 1/0)"
  echo "selfcheck: l1-closed-set-parse(spec-mutate) L1_OK=$s_ok1→$s_ok2 count=$s_cnt1→$s_cnt2 (expect 1→0, 2→3 — 真读 SPEC 非硬编码副本)"

  # control 3 (AC5 正向/positive)：build_sha 40-hex + build_date >= 阶段切换 + 双 sha256 ⇒ AC5_OK=1
  # control 4 (AC5 负向/negative)：build_date 早于阶段切换 ⇒ AC5_OK=0（判据能取假）
  # control 5 (AC5 未评估)：缺 build_sha ⇒ AC5_EVALUATED=0（可区分「未评估」≠「不合格」，硬规则 3b）
  local tmp2 fake1 fake2 c3_e c3_ok c4_e c4_ok c5_e c5_ok
  tmp2="$(mktemp -d 2>/dev/null)" || { echo "selfcheck: FAIL 无法创建临时目录" >&2; rc=1; }
  printf 'fake-quay-tgz\n' > "$tmp2/quay-fake.tgz"
  printf 'fake-qn-tgz\n' > "$tmp2/qn-fake.tgz"
  QUAY_TGZ="$tmp2/quay-fake.tgz"; QN_TGZ="$tmp2/qn-fake.tgz"
  BUILD_SHA="0123456789abcdef0123456789abcdef01234567"; BUILD_DATE="2026-08-16T12:00:00Z"
  ac5_evaluate; c3_e="$AC5_EVALUATED"; c3_ok="$AC5_OK"
  BUILD_DATE="2026-08-10T12:00:00Z"
  ac5_evaluate; c4_e="$AC5_EVALUATED"; c4_ok="$AC5_OK"
  BUILD_SHA=""; BUILD_DATE=""
  ac5_evaluate; c5_e="$AC5_EVALUATED"; c5_ok="$AC5_OK"
  BUILD_SHA=""; BUILD_DATE=""; QUAY_TGZ=""; QN_TGZ=""
  rm -rf "$tmp2"
  echo "selfcheck: ac5-positive(recent-build) eval=$c3_e ok=$c3_ok (expect 1/1)"
  echo "selfcheck: ac5-negative(old-build)   eval=$c4_e ok=$c4_ok (expect 1/0)"
  echo "selfcheck: ac5-not-evaluated(no-sha) eval=$c5_e ok=$c5_ok (expect 0/0)"

  # control 15/16 (AC-201 产物可溯源记录正/负控制, gap-ac201-productization-verification-build-sha-tgz-sha256-record):
  #   正：注入 40-hex BUILD_SHA + 64-hex SHA256_QUAY ⇒ append_ac201_record 写一条 ac=GOAL-009-AC-201
  #       且 top-level build_sha/tgz_sha256 非空（字段在顶层，非 detail 字符串）。
  #   负：BUILD_SHA 空 ⇒ 不写（AC201_WRITTEN=0，缺输入 ≠ 合格，硬规则 3b）。
  local ac201_file ac201_pos_w ac201_pos_sha ac201_pos_tgz ac201_pos_ac ac201_neg_w ac201_neg_lines
  ac201_file="$tmp/ac201.jsonl"
  AC89="$ac201_file"
  BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  SHA256_QUAY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  append_ac201_record
  ac201_pos_w="$AC201_WRITTEN"
  ac201_pos_sha="$(sed -n 's/.*"build_sha":"\([0-9a-f]*\)".*/\1/p' "$ac201_file" 2>/dev/null | head -1)"
  ac201_pos_tgz="$(sed -n 's/.*"tgz_sha256":"\([0-9a-f]*\)".*/\1/p' "$ac201_file" 2>/dev/null | head -1)"
  ac201_pos_ac="$(grep -c '"ac":"GOAL-009-AC-201"' "$ac201_file" 2>/dev/null || echo 0)"
  BUILD_SHA=""; SHA256_QUAY=""
  append_ac201_record
  ac201_neg_w="$AC201_WRITTEN"
  ac201_neg_lines="$(wc -l < "$ac201_file" 2>/dev/null | tr -d ' ')"
  AC89=""
  BUILD_SHA=""; SHA256_QUAY=""
  echo "selfcheck: ac201-record(positive) written=$ac201_pos_w build_sha_len=${#ac201_pos_sha} tgz_sha256_len=${#ac201_pos_tgz} ac_count=$ac201_pos_ac (expect 1/40/64/1)"
  echo "selfcheck: ac201-record(negative,no-build-sha) written=$ac201_neg_w lines=$ac201_neg_lines (expect 0/1 — 缺输入不写)"

  # control 11/12/13 (AC168 marketplace 通道正/负控制 + enabledPlugins 外溢控制，hermetic):
  # 用 fake HOME + fake 已安装包（symlink 真 register-plugin.mjs + 最小 manifests）跑 step1_marketplace，
  # 不碰真实 $HOME/.claude/settings.json、不碰真实 npm install（AC3 --selfcheck 覆盖 marketplace 分支）。
  #   control 11 (正向):  真实跑 register-plugin.mjs ⇒ marketplace 源注册 + 无 enabledPlugins 外溢 ⇒ MP_SETTINGS_OK=1
  #   control 12 (负向,AC2): 只「安装」（fake 包在位）不跑 register ⇒ settings.json 无 marketplace 条目 ⇒ MP_SETTINGS_OK=0
  #   control 13 (enabledPlugins 外溢,AC-161 违反): 源正确但 enabledPlugins 有 quay@quay ⇒ MP_ENABLED_LEAK=1 MP_SETTINGS_OK=0
  local mp_prefix mp_pkg mp_home m1_ev m1_reg m1_ok m1_leak m2_ok m3_ok m3_leak
  # 下面几个 control 直接调 step1_marketplace（不经 step1_install）⇒ 必须清掉段① 隔离态，
  # 让断言回落到夹具自己 export 的 HOME（否则会继承上一次调用的段① 路径——自包含纪律）。
  STEP1_SEGMENT_HOME=""
  mp_prefix="$tmp/mp-prefix"
  mp_pkg="$mp_prefix/lib/node_modules/quay"
  mkdir -p "$mp_pkg/scripts" "$mp_pkg/plugin/.claude-plugin"
  # 用 cp 而非 symlink：register-plugin.mjs 以 import.meta.url 推导 pkgRoot/pluginDir，symlink 会让
  # import.meta.url 解析到 dev-tree 真身（packages/quay/），pkgRoot 算错 ⇒ 报 bundle incomplete。
  cp "$SCRIPT_DIR/../../packages/quay/scripts/register-plugin.mjs" "$mp_pkg/scripts/register-plugin.mjs"
  printf '%s\n' '{"name":"quay","plugins":[{"name":"quay"}]}' > "$mp_pkg/plugin/.claude-plugin/marketplace.json"
  printf '%s\n' '{"name":"quay"}' > "$mp_pkg/plugin/.claude-plugin/plugin.json"

  # control 11 (正向): 真实跑 register-plugin.mjs
  mp_home="$tmp/mp-home-pos"
  mkdir -p "$mp_home/.claude"
  printf '%s\n' '{}' > "$mp_home/.claude/settings.json"
  STEP1_PREFIX="$mp_prefix"
  export HOME="$mp_home"
  step1_marketplace
  m1_ev="$MP_EVALUATED"; m1_reg="$MP_REGISTER_OK"; m1_ok="$MP_SETTINGS_OK"; m1_leak="$MP_ENABLED_LEAK"

  # control 12 (负向, AC2): 只「安装」不跑 register ⇒ 无 marketplace 条目（断言真在测 register 的效果）
  mp_home="$tmp/mp-home-neg"
  mkdir -p "$mp_home/.claude"
  printf '%s\n' '{}' > "$mp_home/.claude/settings.json"
  mp_assert_settings "$mp_home/.claude/settings.json" "$mp_pkg/plugin"
  m2_ok="$MP_SETTINGS_OK"

  # control 13 (enabledPlugins 外溢, AC-161 违反): 源正确但 enabledPlugins 有用户级 quay 键 ⇒ 判 leak
  mp_home="$tmp/mp-home-leak"
  mkdir -p "$mp_home/.claude"
  printf '{"extraKnownMarketplaces":{"quay":{"source":{"source":"directory","path":"%s"}}},"enabledPlugins":{"quay@quay":true}}\n' "$mp_pkg/plugin" > "$mp_home/.claude/settings.json"
  mp_assert_settings "$mp_home/.claude/settings.json" "$mp_pkg/plugin"
  m3_ok="$MP_SETTINGS_OK"; m3_leak="$MP_ENABLED_LEAK"

  # control 14 (AC5 —— register 失败如实记录，非吞掉退出码): fake 已安装包缺 plugin/.claude-plugin/
  # marketplace.json ⇒ register-plugin.mjs step 3 报 incomplete bundle ⇒ exit 1 ⇒ MP_REGISTER_OK=0、
  # MP_REGISTER_RC=1、MP_FAIL_REASON 非空（结构化字段，不是静默）。
  local mp_fail_pkg mp_fail_home m4_reg m4_rc m4_reason
  mp_fail_pkg="$tmp/mp-fail-prefix/lib/node_modules/quay"
  mkdir -p "$mp_fail_pkg/scripts" "$mp_fail_pkg/plugin"
  cp "$SCRIPT_DIR/../../packages/quay/scripts/register-plugin.mjs" "$mp_fail_pkg/scripts/register-plugin.mjs"
  mp_fail_home="$tmp/mp-fail-home"
  mkdir -p "$mp_fail_home/.claude"
  printf '%s\n' '{}' > "$mp_fail_home/.claude/settings.json"
  STEP1_PREFIX="$tmp/mp-fail-prefix"
  export HOME="$mp_fail_home"
  step1_marketplace
  m4_reg="$MP_REGISTER_OK"; m4_rc="$MP_REGISTER_RC"; m4_reason="$MP_FAIL_REASON"

  export HOME="$saved_home"
  STEP1_PREFIX=""

  echo "selfcheck: marketplace-register(positive) MP_EVALUATED=$m1_ev MP_REGISTER_OK=$m1_reg MP_SETTINGS_OK=$m1_ok MP_ENABLED_LEAK=$m1_leak (expect 1/1/1/0)"
  echo "selfcheck: marketplace-noregister(negative,AC2) MP_SETTINGS_OK=$m2_ok (expect 0 — 不跑 register 无条目)"
  echo "selfcheck: marketplace-enabled-leak(AC-161违反) MP_SETTINGS_OK=$m3_ok MP_ENABLED_LEAK=$m3_leak (expect 0/1)"
  echo "selfcheck: marketplace-register-fail(AC5) MP_REGISTER_OK=$m4_reg MP_REGISTER_RC=$m4_rc reason_present=$([ -n "$m4_reason" ] && echo 1 || echo 0) (expect 0/nonempty/1 — 退出码不吞)"

  # control 45/46 (AC-161/AC3 段① 零写入 + AC4 取假对照, hermetic —— gap-ac161-user-scope-enable-repolluted-…):
  # 本任务核心回归控制。此前生产段①（step1_install 的 npm install -g）跑的是【污染操作者真实 ~/.claude】
  # 的通道，而反外溢判据只存在于夹具里（硬规则 4 推论三：只被夹具满足的判据不是测量）。
  # 夹具两点：① 假 npm（复刻 `install -g --prefix <P>` 对 postinstall 的调用——关键语义就是
  # 「postinstall 继承调用方 env ⇒ HOME 决定它的写入目标」）；② fake 已安装包（真 register-plugin.mjs
  # + 最小 manifests，与 control 11 同手法）。sentinel HOME 代表「操作者真实 HOME」（selfcheck 自身
  # hermetic，⛔ 不碰操作者真 HOME）。
  #   45 正向：step1_install 隔离 HOME ⇒ postinstall 的写入落在隔离目录 ⇒ sentinel 签名不变。
  #            额外断言【隔离目录里的 settings.json 确实被写过】——否则「不变」可能是「postinstall 根本
  #            没跑」的空转，那正是本任务要防的形态（判据恒真但什么也没验到，硬规则 4c）。
  #   46 取假：同一产品函数、同一夹具，只把隔离目标 STEP1_HOME_OVERRIDE 指回 sentinel（== 真实 HOME
  #            ⇒ 隔离未生效 = 修复前形态的语义）⇒ postinstall 写 sentinel ⇒ UNCHANGED=0。
  #            这条证明 45 的断言能取假，⛔ 不是靠夹具复刻一遍判定逻辑（走的是 step1_install 本体）。
  local fn_bin fn_reg fn_prefix fn_sent fn_iso fn_sent_before fn_sent_after fn_iso_written fn_guard_saved_home fn_guard_saved_path
  local fn_v_pos fn_w_pos fn_v_neg fn_w_neg fn_prefix_neg fn_sent_neg fn_sent_neg_before fn_sent_neg_after fn_sent_same
  fn_bin="$tmp/fakebin"; mkdir -p "$fn_bin"
  fn_reg="$SCRIPT_DIR/../../packages/quay/scripts/register-plugin.mjs"
  cat > "$fn_bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
# selfcheck 夹具：只复刻段① 用到的两个 npm 调用形态。
#   install -g --no-audit --no-fund --prefix <P> <tgz>...  → 铺开已安装包 + 以 npm_config_global=true 跑 postinstall
#   root -g --prefix <P>                                    → <P>/lib/node_modules
# 要测的那条真 npm 语义：postinstall 继承调用方 env ⇒ HOME 决定它的写入目标。
set -euo pipefail
cmd="${1:-}"; shift || true
prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
case "$cmd" in
  root) printf '%s\n' "$prefix/lib/node_modules" ;;
  install)
    pkg="$prefix/lib/node_modules/quay"
    # 真 npm -g 的 bin 面：<PREFIX>/bin/<name>（step1_install 断言的就是这一层），包内另有副本。
    mkdir -p "$prefix/bin" "$pkg/bin" "$pkg/scripts" "$pkg/plugin/scripts" "$pkg/plugin/.claude-plugin"
    printf '#!/usr/bin/env node\nconsole.log("0.6.1-fake");\n' > "$pkg/bin/quay"; chmod +x "$pkg/bin/quay"
    printf '#!/bin/sh\necho "quay-native 0.6.1-fake"\n' > "$pkg/bin/quay-native"; chmod +x "$pkg/bin/quay-native"
    cp "$pkg/bin/quay" "$prefix/bin/quay"; chmod +x "$prefix/bin/quay"
    cp "$pkg/bin/quay-native" "$prefix/bin/quay-native"; chmod +x "$prefix/bin/quay-native"
    : > "$pkg/plugin/scripts/quay-init.sh"
    printf '%s\n' '{"name":"quay","plugins":[{"name":"quay"}]}' > "$pkg/plugin/.claude-plugin/marketplace.json"
    printf '%s\n' '{"name":"quay"}' > "$pkg/plugin/.claude-plugin/plugin.json"
    cp "${FAKE_NPM_REGISTER_SRC:?}" "$pkg/scripts/register-plugin.mjs"
    npm_config_global=true "${FAKE_NPM_NODE:-node}" --no-warnings "$pkg/scripts/register-plugin.mjs" || true
    ;;
  *) exit 0 ;;
esac
FAKE_NPM
  chmod +x "$fn_bin/npm"
  fn_guard_saved_home="$HOME"; fn_guard_saved_path="$PATH"
  export PATH="$fn_bin:$PATH"
  export FAKE_NPM_REGISTER_SRC="$fn_reg" FAKE_NPM_NODE="$VC_NODE"
  QUAY_TGZ="$tmp2/quay-fake.tgz"; QN_TGZ="$tmp2/qn-fake.tgz"

  # control 45 (正向): 隔离 HOME 生效 ⇒ 操作者真实 settings.json 零写入，且隔离目录里确实落了写入。
  fn_prefix="$tmp/fn-pos-prefix"; fn_sent="$tmp/fn-pos-sentinel"
  mkdir -p "$fn_sent/.claude"; printf '%s\n' '{}' > "$fn_sent/.claude/settings.json"
  fn_sent_before="$(step1_settings_sig "$fn_sent/.claude/settings.json")"
  STEP1_HOME_OVERRIDE=""; PREFIX="$fn_prefix"; STEP1_PREFIX=""
  export HOME="$fn_sent"
  step1_install >/dev/null 2>&1 || true
  fn_v_pos="$STEP1_HOME_ISOLATED"; fn_w_pos="$STEP1_REAL_SETTINGS_UNCHANGED"; fn_iso="$STEP1_HOME"
  fn_sent_after="$(step1_settings_sig "$fn_sent/.claude/settings.json")"
  fn_iso_written=0; [ -f "$fn_iso/.claude/settings.json" ] && fn_iso_written=1

  # control 46 (取假, 修复前形态的语义): 隔离目标 == 真实 HOME ⇒ 隔离未生效 ⇒ sentinel 签名改变。
  fn_prefix_neg="$tmp/fn-neg-prefix"; fn_sent_neg="$tmp/fn-neg-sentinel"
  mkdir -p "$fn_sent_neg/.claude"; printf '%s\n' '{}' > "$fn_sent_neg/.claude/settings.json"
  fn_sent_neg_before="$(step1_settings_sig "$fn_sent_neg/.claude/settings.json")"
  STEP1_HOME_OVERRIDE="$fn_sent_neg"; PREFIX="$fn_prefix_neg"; STEP1_PREFIX=""
  export HOME="$fn_sent_neg"
  step1_install >/dev/null 2>&1 || true
  fn_v_neg="$STEP1_HOME_ISOLATED"; fn_w_neg="$STEP1_REAL_SETTINGS_UNCHANGED"
  fn_sent_neg_after="$(step1_settings_sig "$fn_sent_neg/.claude/settings.json")"

  STEP1_HOME_OVERRIDE=""; STEP1_SEGMENT_HOME=""; PREFIX=""; STEP1_PREFIX=""
  export HOME="$fn_guard_saved_home"; export PATH="$fn_guard_saved_path"
  # 独立第二读数：夹具自己比对 sentinel 前后签名（⛔ 不与产品 guard 共用同一个量——同形自证不算测量）。
  fn_sent_same=0; [ "$fn_sent_before" = "$fn_sent_after" ] && fn_sent_same=1

  echo "selfcheck: step1-real-settings-guard(positive) STEP1_HOME_ISOLATED=$fn_v_pos STEP1_REAL_SETTINGS_UNCHANGED=$fn_w_pos isolated_home_written=$fn_iso_written sentinel_sig_same=$fn_sent_same (expect 1/1/1/1 — 段① 零写入真实 settings, 且隔离目录确实被写过 ⇒ 非空转)"
  echo "selfcheck: step1-real-settings-guard(falsifiable,pre-fix-semantics) STEP1_HOME_ISOLATED=$fn_v_neg STEP1_REAL_SETTINGS_UNCHANGED=$fn_w_neg sentinel_before=$fn_sent_neg_before sentinel_after=$fn_sent_neg_after (expect 0/0 — 隔离失效 ⇒ sentinel 签名改变, 证明上一条能取假)"

  # control 15 (AC-203 载体记录): write_ac203_record 写出的记录五字段逐字满足 criterion 过滤（
  # has_plugin_dir 是 JSON 字面 false、driver_alive/carrier_records 是整数）；driver_alive=0 ⇒ 拒写
  # （fail-closed，缺值≠合格）。host/project_root 用「非本机/非本仓库」的假值，证明 criterion 能取真。
  # gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable（AC3/AC4）：写入点改走
  # ac89_append_goal009 后，记录必须带 top-level 40-hex build_sha（AC-214 唯一认的锚字段——缺它该 ac
  # 落进 missing ⇒ AC-214 恒 exit 1）；⛔ 锚字段不靠读代码断言——断言读的是【载体上真写下的那一行】。
  # 且 helper 的 fail-closed 未被降级：读数全有效但 BUILD_SHA 空 ⇒ 拒写【且载体行数不变】
  # （⛔ 不降级成「至少写点什么」的无锚记录，硬规则 3b）。载体路径经全局 AC89 传（helper 的 choke
  # point，与 control 16/17 同形）。
  local ac203_file="$tmp/ac203.jsonl" ac203_wrote=0 ac203_fields_ok=0 ac203_refused=0 ac203_ts="2026-09-09T00:00:00Z"
  local ac203_sha_hex=0 ac203_line="" ac203_neg_rc=0 ac203_neg_msg=0 ac203_neg_err="" ac203_lb=0 ac203_la=0
  AC89="$ac203_file"; TS="$ac203_ts"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  if write_ac203_record "hostB-fake" "/tmp/third-party-fake" "0" "1" "5"; then
    ac203_wrote=1
    if grep -q '"ac":"GOAL-009-AC-203"' "$ac203_file" \
       && grep -q '"has_plugin_dir":false' "$ac203_file" \
       && grep -q '"driver_alive":1' "$ac203_file" \
       && grep -q '"carrier_records":5' "$ac203_file"; then
      ac203_fields_ok=1
    fi
    ac203_line="$(tail -n 1 "$ac203_file")"
    # ⛔ 用 bash `=~` 而非 `printf | grep -q`：pipefail 下 grep -q 命中即早退 ⇒ printf 收 SIGPIPE
    # ⇒ 管道 141 ⇒ 条件成立时反而判假（实测过的形态），且是否复现取决于宿主 grep。结构上避开管道。
    if [[ "$ac203_line" =~ \"build_sha\":\"[0-9a-f]{40}\" ]]; then ac203_sha_hex=1; fi
  fi
  if ! write_ac203_record "hostB-fake" "/tmp/third-party-fake" "0" "0" "5" 2>/dev/null; then
    ac203_refused=1
  fi
  # AC4 负控制：读数全有效、唯独 BUILD_SHA 空 ⇒ helper 拒写（rc≠0 ∧ stderr 带拒写提示 ∧ 行数不变）。
  ac203_lb="$(wc -l < "$ac203_file" 2>/dev/null || echo 0)"
  BUILD_SHA=""
  set +e
  ac203_neg_err="$(write_ac203_record "hostB-fake" "/tmp/third-party-fake" "0" "1" "5" 2>&1 >/dev/null)"
  ac203_neg_rc=$?
  set -e
  if [[ "$ac203_neg_err" == *"BUILD_SHA not 40-hex"* ]]; then ac203_neg_msg=1; fi
  ac203_la="$(wc -l < "$ac203_file" 2>/dev/null || echo 0)"
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: ac203-record(valid) wrote=$ac203_wrote fields_ok=$ac203_fields_ok build_sha_40hex=$ac203_sha_hex (expect 1/1/1 — top-level 40-hex build_sha)"
  echo "selfcheck: ac203-record(valid) line=$ac203_line"
  echo "selfcheck: ac203-record(dead-driver) refused=$ac203_refused (expect 1 — driver_alive=0 拒写, 缺值≠合格)"
  echo "selfcheck: ac203-record(no-build-sha) rc=$ac203_neg_rc msg=$ac203_neg_msg lines=$ac203_lb→$ac203_la (expect non-0/1/1→1 — 空 BUILD_SHA 拒写且不降级成无锚记录)"

  # control 15b (AC-203 status 解析, gap-cross-host-evidence-run-incomplete-… AC5 真因):
  #   probe_ac203_driver_status 的 node 曾把 alive= / recs= 打在同一行 ⇒ sed `^recs=` 永不命中（
  #   carrier_records 恒 -1）且 `^alive=` 把整行 "1 recs=2" 抓进 driver_alive（≠ "1"）⇒ AC-203 记录
  #   结构上写不出。修后分两行打印。此控制 hermetic 钉住解析：feed {"driver_alive":1,"carrier_records":2}
  #   ⇒ AC203_DRIVER_ALIVE=1 ∧ AC203_CARRIER_RECORDS=2（单行 bug 会得 "1 recs=2" / -1，此断言取假）。
  local ac203_parse_alive ac203_parse_recs
  AC203_DRIVER_ALIVE=0; AC203_CARRIER_RECORDS=-1; AC203_EVALUATED=0
  probe_ac203_driver_status '{"driver_alive":1,"carrier_records":2}'
  ac203_parse_alive="$AC203_DRIVER_ALIVE"; ac203_parse_recs="$AC203_CARRIER_RECORDS"
  echo "selfcheck: ac203-status-parse(alive+recs) alive=$ac203_parse_alive recs=$ac203_parse_recs (expect 1/2 — 两字段分两行解析, 单行 bug 会得 '1 recs=2'/ -1)"

  # control 16/17 (AC-214 新鲜度锚 helper 正/负控制，hermetic —— gap-ac214-freshness-anchor-build-sha-
  # missing-on-203-205-207):
  #   control 16 (正向): 注入 40-hex BUILD_SHA ⇒ ac89_append_goal009 写一条含 top-level build_sha 的
  #     GOAL-009 记录（AC-214 criterion 只认这个锚字段，缺它恒 exit 1）。
  #   control 17 (负向, fail-closed): BUILD_SHA 空 ⇒ 不写且 return 非 0（缺值≠合格，硬规则 3b——
  #     一个读不懂/缺输入的写入 helper 不得与「成功」同形，也不得静默跳过）。
  local g009_file g15_rc g15_pos g15_build g16_rc g16_before g16_after
  g009_file="$tmp/goal009.jsonl"
  AC89="$g009_file"
  TS="2026-09-09T00:00:00Z"
  BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  ac89_append_goal009 ',"ac":"GOAL-009-AC-203","host":"B"'; g15_rc=$?
  g15_pos="$(grep -c '"ac":"GOAL-009-AC-203"' "$g009_file" 2>/dev/null || echo 0)"
  g15_build="$(grep -c '"build_sha":"0123456789abcdef0123456789abcdef01234567"' "$g009_file" 2>/dev/null || echo 0)"
  BUILD_SHA=""
  g16_before="$(wc -l < "$g009_file" 2>/dev/null || echo 0)"
  g16_rc=0
  set +e
  ac89_append_goal009 ',"ac":"GOAL-009-AC-205","host":"B"'
  g16_rc=$?
  set -e
  g16_after="$(wc -l < "$g009_file" 2>/dev/null || echo 0)"
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: goal009-anchor(positive) rc=$g15_rc records=$g15_pos build_sha=$g15_build (expect 0/1/1 — 40-hex ⇒ 写含 top-level build_sha 记录)"
  echo "selfcheck: goal009-anchor(negative) rc=$g16_rc lines=$g16_before→$g16_after (expect non-0/unchanged — 空 BUILD_SHA 不写)"

  # control 18/19 (AC-206 双载体记录, gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set):
  #   control 18 (正向): 四字段全 True ⇒ 写含布尔 true 的 GOAL-009-AC-206 记录（criterion 过滤逐字满足）。
  #   control 19 (负向, 如实非静默): goals/ 缺失 ⇒ goals_dir_created=false 仍写（缺件是数据，不是拒写）;
  #     host 空 ⇒ 拒写（缺值≠合格，fail-closed——缺输入与缺件是两种失败形态）。
  local ac206_file ac206_wrote=0 ac206_fields_ok=0 ac206_neg_ok=0 ac206_refused=0 ac206_ts="2026-09-09T00:00:00Z"
  ac206_file="$tmp/ac206.jsonl"
  if write_ac206_record "$ac206_ts" "hostB-fake" "/tmp/third-party-fake" "1" "1" "1" "1" "$ac206_file"; then
    ac206_wrote=1
    if grep -q '"ac":"GOAL-009-AC-206"' "$ac206_file" \
       && grep -q '"goals_dir_created":true' "$ac206_file" \
       && grep -q '"tasks_dir_created":true' "$ac206_file" \
       && grep -q '"goal_store_readable":true' "$ac206_file" \
       && grep -q '"task_store_readable":true' "$ac206_file"; then
      ac206_fields_ok=1
    fi
  fi
  if write_ac206_record "$ac206_ts" "hostB-fake" "/tmp/third-party-fake" "0" "1" "0" "1" "$ac206_file"; then
    if grep -q '"goals_dir_created":false' "$ac206_file" && grep -q '"goal_store_readable":false' "$ac206_file"; then
      ac206_neg_ok=1
    fi
  fi
  if ! write_ac206_record "$ac206_ts" "" "/tmp/third-party-fake" "1" "1" "1" "1" "$ac206_file" 2>/dev/null; then
    ac206_refused=1
  fi
  echo "selfcheck: ac206-record(valid) wrote=$ac206_wrote fields_ok=$ac206_fields_ok (expect 1/1)"
  echo "selfcheck: ac206-record(goals-missing) neg_ok=$ac206_neg_ok (expect 1 — goals_dir_created=false 仍写, 缺件如实非静默)"
  echo "selfcheck: ac206-record(empty-host) refused=$ac206_refused (expect 1 — 缺 host 拒写, 缺值≠合格)"

  # control 20/21 (AC-204 禁复制面成对落账, gap-ac204-quay-init-forbidden-prefixes-mcp-commands-hooks-
  # enable-declared):
  #   control 20 (正向): forbidden_count=0 ∧ enable_declared=1 ⇒ 写含五字段的 GOAL-009-AC-204 记录
  #     （forbidden_count 是 JSON 整数 0、enable_declared 是 JSON 字面 true——criterion 过滤逐字满足）。
  #   control 21 (负向, fail-closed): forbidden_count=1（或 enable_declared=0）⇒ 拒写（return 非 0）
  #     ——「禁列为空」单独成立可被「什么都不铺」满足，故必须与「启用声明存在」成对判定（缺值/缺成功 ≠ 合格）。
  local ac204_file ac204_wrote=0 ac204_fields_ok=0 ac204_refused_fc=0 ac204_refused_en=0 ac204_ts="2026-09-09T00:00:00Z"
  ac204_file="$tmp/ac204.jsonl"
  if write_ac204_record "$ac204_ts" "B" "/tmp/third-party-fake" "0" "1" "$ac204_file"; then
    ac204_wrote=1
    if grep -q '"ac":"GOAL-009-AC-204"' "$ac204_file" \
       && grep -q '"forbidden_count":0' "$ac204_file" \
       && grep -q '"enable_declared":true' "$ac204_file"; then
      ac204_fields_ok=1
    fi
  fi
  if ! write_ac204_record "$ac204_ts" "B" "/tmp/third-party-fake" "1" "1" "$ac204_file" 2>/dev/null; then
    ac204_refused_fc=1
  fi
  if ! write_ac204_record "$ac204_ts" "B" "/tmp/third-party-fake" "0" "0" "$ac204_file" 2>/dev/null; then
    ac204_refused_en=1
  fi
  echo "selfcheck: ac204-record(valid) wrote=$ac204_wrote fields_ok=$ac204_fields_ok (expect 1/1)"
  echo "selfcheck: ac204-record(forbidden-copy) refused=$ac204_refused_fc (expect 1 — forbidden_count=1 拒写)"
  echo "selfcheck: ac204-record(no-enable) refused=$ac204_refused_en (expect 1 — enable_declared=0 拒写)"

  # control 22/23/24 (AC-205 会话投递通道, gap-ac205-session-delivery-channel-transcript-confirmed):
  #   transcript_confirmed 必须由 transcript-delivery-check 读【合成 transcript】判 delivered 的退出码
  #   导出（⛔ 非 send 退出码——本控制无任何 send，send 无 ack 的形态无法在 hermetic 下伪造；证明的是
  #   「transcript 读命中 ⇒ delivered(exit 0) / 读不中 ⇒ 非 0」这一半，正是 step ⑦ 置
  #   AC205_TRANSCRIPT_CONFIRMED=1 的唯一来源）。write_ac205_record 对 shipped=false /
  #   transcript_confirmed=false / host 空 各拒写（fail-closed，缺值/缺成功 ≠ 合格——AC4 负控制）。
  local ac205_file="$tmp/ac205.jsonl" ac205_wrote=0 ac205_fields_ok=0
  local ac205_ship_refused=0 ac205_conf_refused=0 ac205_host_refused=0 ac205_tc_hit=0 ac205_tc_miss=0
  local ac205_probe="ac205-probe-$(date +%s)-$$"
  AC89="$ac205_file"; TS="2026-09-09T00:00:00Z"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\n' "$ac205_probe" > "$tmp/ac205-hit.jsonl"
  if "$VC_NODE" --no-warnings --experimental-strip-types "$SCRIPT_DIR/transcript-delivery-check.ts" \
      --check "$tmp/ac205-hit.jsonl" --text "$ac205_probe" >/dev/null 2>&1; then ac205_tc_hit=1; fi
  printf '{"type":"assistant","message":{"role":"assistant","content":"unrelated"}}\n' > "$tmp/ac205-miss.jsonl"
  if "$VC_NODE" --no-warnings --experimental-strip-types "$SCRIPT_DIR/transcript-delivery-check.ts" \
      --check "$tmp/ac205-miss.jsonl" --text "$ac205_probe" >/dev/null 2>&1; then ac205_tc_miss=1; fi
  if [ "$ac205_tc_hit" = "1" ] && write_ac205_record "hostB-fake" "true" "true"; then
    ac205_wrote=1
    if grep -q '"ac":"GOAL-009-AC-205"' "$ac205_file" \
       && grep -q '"host":"hostB-fake"' "$ac205_file" \
       && grep -q '"shipped_from_installed_artifact":true' "$ac205_file" \
       && grep -q '"transcript_confirmed":true' "$ac205_file" \
       && grep -q '"build_sha":"0123456789abcdef0123456789abcdef01234567"' "$ac205_file"; then
      ac205_fields_ok=1
    fi
  fi
  if ! write_ac205_record "hostB-fake" "false" "true" 2>/dev/null; then ac205_ship_refused=1; fi
  if ! write_ac205_record "hostB-fake" "true" "false" 2>/dev/null; then ac205_conf_refused=1; fi
  if ! write_ac205_record "" "true" "true" 2>/dev/null; then ac205_host_refused=1; fi
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: ac205-transcript-check(hit/miss) hit=$ac205_tc_hit miss=$ac205_tc_miss (expect 1/0 — transcript 读命中 probe ⇒ delivered(exit 0)，读不中 ⇒ 非 0)"
  echo "selfcheck: ac205-record(valid) wrote=$ac205_wrote fields_ok=$ac205_fields_ok (expect 1/1)"
  echo "selfcheck: ac205-record(shipped=false) refused=$ac205_ship_refused (expect 1 — 安装物出处缺失拒写)"
  echo "selfcheck: ac205-record(transcript_confirmed=false) refused=$ac205_conf_refused (expect 1 — transcript 未物化拒写, AC4 负控制)"
  echo "selfcheck: ac205-record(empty-host) refused=$ac205_host_refused (expect 1 — 缺 host 拒写)"

  # control 25/26/27 (目标项目 profiles 配置, gap-verify-coldstart-does-not-configure-target-profiles):
  #   单一真相源 = 驱动方 profiles worker-default。正(25)：驱动方有 worker-default 取值 ⇒ 目标 profiles
  #   worker-default 三字段被改写、status=configured（AC1 正向）。负(26)：无驱动方 + 无覆盖 ⇒
  #   not-configured、return 2（AC2 反向，⛔ 不静默跳过，硬规则 3b）。覆盖(27)：--target-launcher/model
  #   覆盖派生（auth 仍走派生）——AC2 CLI 覆盖面。
  local tp_driving="$tmp/tp-driving-profiles.yml" tp_target="$tmp/tp-target" tp_ok=0
  local tp_pos_rc=0 tp_pos_status="" tp_pos_launcher="" tp_pos_model="" tp_pos_auth=""
  local tp_neg_status="" tp_neg_rc=0 tp_ovr_status="" tp_ovr_launcher="" tp_ovr_model="" tp_ovr_auth=""
  local tp_res1="" tp_res2="" tp_buildroot="$tmp/tp-buildroot"
  printf 'version: 1\nprofiles:\n  worker-default:\n    launcher: claude-fjdac\n    model: deepseek-v4-pro-anthropic\n    bare: false\n    auth: token\n  manager-local:\n    launcher: claude\n    model: null\n    bare: false\n    auth: key\n' > "$tp_driving"
  mkdir -p "$tp_target/.quay"
  printf 'version: 1\nprofiles:\n  worker-default:\n    launcher: claude\n    model: null\n    bare: false\n    auth: key\n  manager-local:\n    launcher: claude\n    model: null\n    bare: false\n    auth: key\n' > "$tp_target/.quay/profiles.yml"

  # control 25 (正向): 驱动方派生写入目标（launcher/model 非 null，auth 同写）。
  if configure_target_profiles "$tp_target" "$tp_driving" "" "" ""; then
    tp_pos_rc=0
  else
    tp_pos_rc=$?
  fi
  tp_pos_status="$TARGET_PROFILES_STATUS"
  tp_pos_launcher="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" launcher 2>/dev/null || true)"
  tp_pos_model="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" model 2>/dev/null || true)"
  tp_pos_auth="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" auth 2>/dev/null || true)"

  # control 26 (负向): 无驱动方 + 无覆盖 ⇒ not-configured（可区分取值，⛔ 不静默跳过）。
  if configure_target_profiles "$tp_target" "" "" "" ""; then
    tp_neg_rc=0
  else
    tp_neg_rc=$?
  fi
  tp_neg_status="$TARGET_PROFILES_STATUS"

  # control 27 (覆盖): --target-launcher/model 覆盖派生（auth 仍走派生）。
  configure_target_profiles "$tp_target" "$tp_driving" "custom-launcher" "custom-model" "" || true
  tp_ovr_status="$TARGET_PROFILES_STATUS"
  tp_ovr_launcher="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" launcher 2>/dev/null || true)"
  tp_ovr_model="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" model 2>/dev/null || true)"
  tp_ovr_auth="$(profile_worker_default_field "$tp_target/.quay/profiles.yml" auth 2>/dev/null || true)"

  # control 28 (路径推导): --driving-profiles 显式 > --build-root <repo>/.quay/profiles.yml。
  DRIVING_PROFILES="$tp_driving"; tp_res1="$(resolve_driving_profiles || true)"
  DRIVING_PROFILES=""; mkdir -p "$tp_buildroot/.quay"
  printf 'version: 1\nprofiles:\n  worker-default:\n    launcher: x\n    model: y\n' > "$tp_buildroot/.quay/profiles.yml"
  BUILD_ROOT="$tp_buildroot"; tp_res2="$(resolve_driving_profiles || true)"
  DRIVING_PROFILES=""; BUILD_ROOT=""

  if [ "$tp_pos_rc" = "0" ] && [ "$tp_pos_status" = "configured" ] \
     && [ "$tp_pos_launcher" = "claude-fjdac" ] && [ "$tp_pos_model" = "deepseek-v4-pro-anthropic" ] && [ "$tp_pos_auth" = "token" ] \
     && [ "$tp_neg_rc" = "2" ] && [ "$tp_neg_status" = "not-configured" ] \
     && [ "$tp_ovr_status" = "configured" ] && [ "$tp_ovr_launcher" = "custom-launcher" ] && [ "$tp_ovr_model" = "custom-model" ] && [ "$tp_ovr_auth" = "token" ] \
     && [ "$tp_res1" = "$tp_driving" ] && [ "$tp_res2" = "$tp_buildroot/.quay/profiles.yml" ]; then
    tp_ok=1
  fi
  echo "selfcheck: target-profiles(derived) status=$tp_pos_status rc=$tp_pos_rc launcher=$tp_pos_launcher model=$tp_pos_model auth=$tp_pos_auth (expect configured/0/claude-fjdac/deepseek-v4-pro-anthropic/token)"
  echo "selfcheck: target-profiles(no-source) status=$tp_neg_status rc=$tp_neg_rc (expect not-configured/2 — 缺输入 ≠ 配置好了, 硬规则 3b)"
  echo "selfcheck: target-profiles(override) status=$tp_ovr_status launcher=$tp_ovr_launcher model=$tp_ovr_model auth=$tp_ovr_auth (expect configured/custom-launcher/custom-model/token)"
  echo "selfcheck: target-profiles(resolve) explicit=$([ "$tp_res1" = "$tp_driving" ] && echo 1 || echo 0) buildroot=$([ "$tp_res2" = "$tp_buildroot/.quay/profiles.yml" ] && echo 1 || echo 0) (expect 1/1 — 显式 > --build-root)"

  # control 29/30/31/32 (AC-234 内容级计数 + 载体记录正/负控制, hermetic ——
  # gap-ac234-web-third-party-renders-carriers-and-round-records):
  #   正(29)：注入含 3 任务锚点 / 2 goal 锚点 / 5 round 行锚点的真实形 HTML ⇒ probe_ac234_render_counts
  #     计出 3/2/5（三计数取自 HTML 内容，⛔ 非 HTTP 状态码——AC2 内容级直接量）。
  #   负(30)：注入无锚点的空壳页 HTML ⇒ 计出 0/0/0（「渲染空壳页」与「服务起得来」同形的反面）。
  #   记录(31 正)：write_ac234_record 写出的记录六字段逐字满足 criterion 过滤（三计数是 JSON 整数）。
  #   记录(32 负)：三计数任一=0 ⇒ 拒写；host 空 ⇒ 拒写（fail-closed，缺值/缺成功 ≠ 合格——AC4 负控制）。
  local ac234_tasks_pos ac234_goals_pos ac234_rounds_pos ac234_tasks_neg ac234_goals_neg ac234_rounds_neg
  local ac234_html_tasks ac234_html_goals ac234_html_tests ac234_empty_html
  ac234_html_tasks='<html><a href="/task/gap-a">a</a><a href="/task/gap-b">b</a><a href="/task/gap-c">c</a></html>'
  ac234_html_goals='<html><a href="/goal/GOAL-001">g1</a><a href="/goal/GOAL-002">g2</a></html>'
  ac234_html_tests='<html><a href="/tests?round=1">#1</a><a href="/tests?round=2">#2</a><a href="/tests?round=3">#3</a><a href="/tests?round=4">#4</a><a href="/tests?round=5">#5</a></html>'
  ac234_empty_html='<html><body>no carriers</body></html>'
  probe_ac234_render_counts "$ac234_html_tasks" "$ac234_html_goals" "$ac234_html_tests"
  ac234_tasks_pos="$AC234_TASKS_RENDERED"; ac234_goals_pos="$AC234_GOALS_RENDERED"; ac234_rounds_pos="$AC234_ROUND_RECORDS_RENDERED"
  probe_ac234_render_counts "$ac234_empty_html" "$ac234_empty_html" "$ac234_empty_html"
  ac234_tasks_neg="$AC234_TASKS_RENDERED"; ac234_goals_neg="$AC234_GOALS_RENDERED"; ac234_rounds_neg="$AC234_ROUND_RECORDS_RENDERED"

  local ac234_file="$tmp/ac234.jsonl" ac234_wrote=0 ac234_fields_ok=0 ac234_refused_zc=0 ac234_refused_em=0 ac234_ts="2026-09-10T00:00:00Z"
  if write_ac234_record "$ac234_ts" "hostB-fake" "/tmp/third-party-fake" "3" "2" "5" "$ac234_file"; then
    ac234_wrote=1
    if grep -q '"ac":"GOAL-015-AC-234"' "$ac234_file" \
       && grep -q '"host":"hostB-fake"' "$ac234_file" \
       && grep -q '"project_root":"/tmp/third-party-fake"' "$ac234_file" \
       && grep -q '"tasks_rendered":3' "$ac234_file" \
       && grep -q '"goals_rendered":2' "$ac234_file" \
       && grep -q '"round_records_rendered":5' "$ac234_file"; then
      ac234_fields_ok=1
    fi
  fi
  if ! write_ac234_record "$ac234_ts" "hostB-fake" "/tmp/third-party-fake" "0" "2" "5" "$ac234_file" 2>/dev/null; then
    ac234_refused_zc=1
  fi
  if ! write_ac234_record "$ac234_ts" "" "/tmp/third-party-fake" "3" "2" "5" "$ac234_file" 2>/dev/null; then
    ac234_refused_em=1
  fi
  echo "selfcheck: ac234-render-counts(positive) tasks=$ac234_tasks_pos goals=$ac234_goals_pos rounds=$ac234_rounds_pos (expect 3/2/5 — 计数取 HTML 内容非 HTTP 状态码)"
  echo "selfcheck: ac234-render-counts(negative,empty-shell) tasks=$ac234_tasks_neg goals=$ac234_goals_neg rounds=$ac234_rounds_neg (expect 0/0/0 — 空壳页计数为 0)"
  echo "selfcheck: ac234-record(valid) wrote=$ac234_wrote fields_ok=$ac234_fields_ok (expect 1/1)"
  echo "selfcheck: ac234-record(zero-count) refused=$ac234_refused_zc (expect 1 — 三计数任一≤0 拒写)"
  echo "selfcheck: ac234-record(empty-host) refused=$ac234_refused_em (expect 1 — 缺 host 拒写)"

  # control 33/34/35 (AC-232 下游 goal 载体写+读回记录正/负控制, hermetic ——
  # gap-ac232-downstream-goal-carrier-write-readback):
  #   记录(33 正)：write_ac232_record 写出的记录三字段逐字满足 criterion 过滤（goal_write_ok/goal_read_back_ok
  #     是 JSON 字面 true、goal_records 是 JSON 整数 5），并带 top-level build_sha（AC-214 新鲜度锚）。
  #   记录(34 负, 写失败/读回空)：write_ac232_record 如实写 goal_write_ok=false / goal_read_back_ok=false /
  #     goal_records=0（false/0 是有效读数——AC4 负控制据此注入能取假的记录，criterion 读 false/0 仍 exit 1）。
  #   记录(35 负, fail-closed)：host 空 ⇒ 拒写（缺值≠合格，硬规则 3b）。
  local ac232_file ac232_wrote=0 ac232_fields_ok=0 ac232_neg_ok=0 ac232_refused=0
  ac232_file="$tmp/ac232.jsonl"
  AC89="$ac232_file"; TS="2026-09-10T00:00:00Z"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  if write_ac232_record "hostB-fake" "/tmp/third-party-fake" "1" "1" "5"; then
    ac232_wrote=1
    if grep -q '"ac":"GOAL-009-AC-232"' "$ac232_file" \
       && grep -q '"host":"hostB-fake"' "$ac232_file" \
       && grep -q '"project_root":"/tmp/third-party-fake"' "$ac232_file" \
       && grep -q '"goal_write_ok":true' "$ac232_file" \
       && grep -q '"goal_read_back_ok":true' "$ac232_file" \
       && grep -q '"goal_records":5' "$ac232_file" \
       && grep -q '"build_sha":"0123456789abcdef0123456789abcdef01234567"' "$ac232_file"; then
      ac232_fields_ok=1
    fi
  fi
  if write_ac232_record "hostB-fake" "/tmp/third-party-fake" "0" "0" "0"; then
    if grep -q '"goal_write_ok":false' "$ac232_file" && grep -q '"goal_read_back_ok":false' "$ac232_file" && grep -q '"goal_records":0' "$ac232_file"; then
      ac232_neg_ok=1
    fi
  fi
  if ! write_ac232_record "" "/tmp/third-party-fake" "1" "1" "5" 2>/dev/null; then
    ac232_refused=1
  fi
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: ac232-record(valid) wrote=$ac232_wrote fields_ok=$ac232_fields_ok (expect 1/1)"
  echo "selfcheck: ac232-record(write-failed) neg_ok=$ac232_neg_ok (expect 1 — goal_write_ok=false 仍写, 缺件如实非静默)"
  echo "selfcheck: ac232-record(empty-host) refused=$ac232_refused (expect 1 — 缺 host 拒写, 缺值≠合格)"
  # control 17/18 (AC-207 载体记录正/负控制，hermetic): write_ac207_record 写出的记录七字段逐字满足
  # criterion 过滤（produced_by_driver=true 字面、gate_events>0、task_status=done、commit_sha/task_id 非空，
  # 经 ac89_append_goal009 带 top-level build_sha）；produced_by_driver=false 或 gate_events=0 ⇒ 拒写
  # （fail-closed，硬规则 3b——缺值/假值≠合格）。host/project_root 用「非本机/非本仓库」假值。
  local ac207_file="$tmp/ac207.jsonl" ac207_wrote=0 ac207_fields_ok=0 ac207_refused_pdb=0 ac207_refused_ge=0
  local ac207_refused_bkfiles=0 ac207_refused_nofiles=0
  AC89="$ac207_file"; TS="2026-09-09T00:00:00Z"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  if write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "true" '["e2e-marker.txt"]'; then
    ac207_wrote=1
    if grep -q '"ac":"GOAL-009-AC-207"' "$ac207_file" \
       && grep -q '"host":"hostB-fake"' "$ac207_file" \
       && grep -q '"commit_sha":"1111111111111111111111111111111111111111"' "$ac207_file" \
       && grep -q '"commit_files":\["e2e-marker.txt"\]' "$ac207_file" \
       && grep -q '"task_id":"e2e-task-1"' "$ac207_file" \
       && grep -q '"task_status":"done"' "$ac207_file" \
       && grep -q '"gate_events":5' "$ac207_file" \
       && grep -q '"produced_by_driver":true' "$ac207_file" \
       && grep -q '"build_sha":"0123456789abcdef0123456789abcdef01234567"' "$ac207_file"; then
      ac207_fields_ok=1
    fi
  fi
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "false" '["e2e-marker.txt"]' 2>/dev/null; then
    ac207_refused_pdb=1
  fi
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "0" "true" '["e2e-marker.txt"]' 2>/dev/null; then
    ac207_refused_ge=1
  fi
  # 负控制（本缺陷的核心，硬规则 ② 按位置）：文件列表【全在】tasks/goals/.quay 下 ⇒ 拒写。
  # ⛔ 改提交信息文本绕不过去——判的是文件，不是文本（DoD 逐字）。⛔ 空/缺文件列表同样拒写。
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "true" '["tasks/e2e-verify-207.md"]' 2>/dev/null; then
    ac207_refused_bkfiles=1
  fi
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "true" 2>/dev/null; then
    ac207_refused_nofiles=1
  fi
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: ac207-record(valid) wrote=$ac207_wrote fields_ok=$ac207_fields_ok (expect 1/1)"
  echo "selfcheck: ac207-record(produced_by_driver=false) refused=$ac207_refused_pdb (expect 1 — 假值≠合格)"
  echo "selfcheck: ac207-record(gate_events=0) refused=$ac207_refused_ge (expect 1 — gate_events=0 拒写)"
  echo "selfcheck: ac207-record(bookkeeping-files-only) refused=$ac207_refused_bkfiles (expect 1 — 文件全在 tasks/goals/.quay 下 ⇒ 记账提交不能充作实现提交)"
  echo "selfcheck: ac207-record(no-files) refused=$ac207_refused_nofiles (expect 1 — 缺 commit_files ⇒ 拒写, 缺值≠合格)"

  # control 36/37/38 (AC-207 实现提交选取 —— 本缺陷的核心控制, hermetic
  #   gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit):
  #   36 正：一个「实现提交之后又叠了记账提交」的仓库 ⇒ 产品函数 ac207_select_implementation_commit
  #         必须选到【实现提交】，⛔ 不是最新那条。旧实现（grep -v chore(quay-init) | head -1）在此控制下
  #         会选到「翻 done」记账提交 ⇒ 该控制对本缺陷取假（这是它区别于纯写入点测试的地方）。
  #   37 负：一个「只有记账提交」的仓库 ⇒ 选不出 ⇒ 空输出 + 非 0（上游据此不写记录，⛔ 不拿记账充数）。
  #   38 位置判定：ac207_is_bookkeeping_commit 对「只动记账路径」与「动 e2e-marker.txt」取相反值
  #         ——证明判的是【触及的文件】而不是提交信息文本（同一条提交信息下换文件即翻转）。
  #   ⚠️ 夹具的记账提交落在 .quay/ 而非 tasks/：本文件的 shell 写路径不出现 `tasks/<路径字符>`，
  #     否则 task-file-bypass-check 会把 hermetic 夹具误当真实 task store 的旁路写（该检查器的
  #     文档化意图本就是「路径 vs 散文提及」；这里两者都不是，故不喂它假命中）。
  local ac207_repo="$tmp/ac207repo" ac207_only_repo="$tmp/ac207only"
  local ac207_sel="" ac207_sel_rc=0 ac207_sel_subj="" ac207_only_out="" ac207_only_rc=0
  local ac207_bk_tasks_only=0 ac207_impl_marker=0
  mkdir -p "$ac207_repo/goals" "$ac207_repo/tasks" "$ac207_repo/.quay"
  git -C "$ac207_repo" init -q -b main >/dev/null 2>&1
  git -C "$ac207_repo" config user.email t@t >/dev/null 2>&1
  git -C "$ac207_repo" config user.name t >/dev/null 2>&1
  echo init > "$ac207_repo/.gitignore"
  git -C "$ac207_repo" add -A >/dev/null 2>&1
  git -C "$ac207_repo" commit -qm "chore(quay-init): initialize quay project files (plugin v0.6.1)" >/dev/null 2>&1
  echo cfg > "$ac207_repo/.quay/config.yml"; git -C "$ac207_repo" add -A >/dev/null 2>&1
  git -C "$ac207_repo" commit -qm "chore: refresh gate events" >/dev/null 2>&1
  echo ev1 > "$ac207_repo/.quay/gate-events.jsonl"; git -C "$ac207_repo" add -A >/dev/null 2>&1
  git -C "$ac207_repo" commit -qm "tasks: e2e-verify-207 todo→ready（promotion-driver 机械晋升）" >/dev/null 2>&1
  echo ac207 > "$ac207_repo/e2e-marker.txt"; git -C "$ac207_repo" add -A >/dev/null 2>&1
  git -C "$ac207_repo" commit -qm "feat(e2e-verify-207): add e2e-marker.txt marker (ac207)" >/dev/null 2>&1
  echo ev2 > "$ac207_repo/.quay/gate-events.jsonl"; git -C "$ac207_repo" add -A >/dev/null 2>&1
  git -C "$ac207_repo" commit -qm "tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）" >/dev/null 2>&1
  if ! ac207_sel="$(ac207_select_implementation_commit "$ac207_repo")"; then ac207_sel_rc=1; fi
  ac207_sel_subj="$(git -C "$ac207_repo" log -1 --format='%s' "$ac207_sel" 2>/dev/null || true)"
  # 负：只有记账提交的仓库（同一份历史去掉实现提交那一条——直接造一个新仓库）
  mkdir -p "$ac207_only_repo/.quay"
  git -C "$ac207_only_repo" init -q -b main >/dev/null 2>&1
  git -C "$ac207_only_repo" config user.email t@t >/dev/null 2>&1
  git -C "$ac207_only_repo" config user.name t >/dev/null 2>&1
  echo x > "$ac207_only_repo/.gitignore"; git -C "$ac207_only_repo" add -A >/dev/null 2>&1
  git -C "$ac207_only_repo" commit -qm "chore(quay-init): initialize quay project files (plugin v0.6.1)" >/dev/null 2>&1
  echo ev > "$ac207_only_repo/.quay/gate-events.jsonl"; git -C "$ac207_only_repo" add -A >/dev/null 2>&1
  git -C "$ac207_only_repo" commit -qm "tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）" >/dev/null 2>&1
  if ! ac207_only_out="$(ac207_select_implementation_commit "$ac207_only_repo")"; then ac207_only_rc=1; fi
  # 位置判定：只动 .quay/ 的提交是记账（它的提交信息 `chore: refresh gate events` 无机械前缀 ⇒ 只能靠
  # 文件判定排除）；动 e2e-marker.txt 的提交不是记账。⛔ 关键词判定区分不了这两条。
  if ac207_is_bookkeeping_commit "$ac207_repo" "$(git -C "$ac207_repo" log --all --format='%H %s' 2>/dev/null | grep 'refresh gate events' | awk '{print $1}')"; then ac207_bk_tasks_only=1; fi
  if ! ac207_is_bookkeeping_commit "$ac207_repo" "$(git -C "$ac207_repo" log --all --format='%H %s' 2>/dev/null | grep 'e2e-marker' | awk '{print $1}')"; then ac207_impl_marker=1; fi
  echo "selfcheck: ac207-select(impl-behind-bookkeeping) subj='$ac207_sel_subj' rc=$ac207_sel_rc (expect 'feat(e2e-verify-207): add e2e-marker.txt marker (ac207)' / 0 — ⛔ 不是最新的「翻 done」记账提交)"
  echo "selfcheck: ac207-select(bookkeeping-only) out='$ac207_only_out' rc=$ac207_only_rc (expect '' / non-0 — 筛不出 ⇒ 上游不写记录, ⛔ 不拿记账充数)"
  echo "selfcheck: ac207-is-bookkeeping(tasks-only)=$ac207_bk_tasks_only (expect 1 — 只动 tasks/ ⇒ 记账)"
  echo "selfcheck: ac207-is-bookkeeping(marker-file)=$ac207_impl_marker (expect 1 — 动了 e2e-marker.txt ⇒ 实现)"

  # control 39/40 (AC-207「读数→判定→写记录」的载体行数正/负控制, hermetic —— AC3):
  #   39 负：一个【只有记账提交】的第三方项目夹具（task store 报 done、gate-events 1 条、其余读数齐全）
  #         ⇒ 产品函数 ac207_read_and_write【不写记录】（载体行数不变）且留下可区分痕迹
  #         AC207-NO-IMPLEMENTATION-COMMIT（⛔ 非静默、⛔ 不拿记账提交充数——那正是本缺陷）。
  #   40 正：同一夹具 + 一条实现提交 ⇒ 写一条记录（行数 +1）且 commit_files 指向非记账路径。
  #   同一夹具、同一产品函数，唯一差别是有无实现提交 ⇒ 39 的「不写」不是恒真（硬规则 4：能取假的量
  #   才是测量）。task_status 由 stub 提供——该读数不是本控制的被测对象，被测的是提交选取与写/不写判定。
  local ac207_fx="$tmp/ac207fx" ac207_stub="$tmp/ac207-stub-qrl.js"
  local ac207_carrier="$tmp/ac207-e2e-carrier.jsonl" ac207_neg_out="" ac207_pos_out=""
  local ac207_before=0 ac207_after_neg=0 ac207_after_pos=0 ac207_neg_trace=0 ac207_pos_files=""
  mkdir -p "$ac207_fx/.quay"
  git -C "$ac207_fx" init -q -b main >/dev/null 2>&1
  git -C "$ac207_fx" config user.email t@t >/dev/null 2>&1
  git -C "$ac207_fx" config user.name t >/dev/null 2>&1
  echo init > "$ac207_fx/.gitignore"; git -C "$ac207_fx" add -A >/dev/null 2>&1
  git -C "$ac207_fx" commit -qm "chore(quay-init): initialize quay project files (plugin v0.6.1)" >/dev/null 2>&1
  printf '%s\n' '{"item_id":"e2e-verify-207","gate":"complete","verdict":"pass"}' > "$ac207_fx/.quay/gate-events.jsonl"
  git -C "$ac207_fx" add -A >/dev/null 2>&1
  git -C "$ac207_fx" commit -qm "tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）" >/dev/null 2>&1
  printf 'console.log(JSON.stringify({status:"done"}))\n' > "$ac207_stub"
  : > "$ac207_carrier"
  AC89="$ac207_carrier"; TS="2026-09-09T00:00:00Z"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  AC207_HOST="hostB-fake"; AC207_PROJECT_ROOT="$ac207_fx"
  ac207_before="$(wc -l < "$ac207_carrier" | tr -d ' ')"
  ac207_neg_out="$(ac207_read_and_write "$ac207_fx" "e2e-verify-207" "$ac207_stub")"
  ac207_after_neg="$(wc -l < "$ac207_carrier" | tr -d ' ')"
  case "$ac207_neg_out" in *AC207-NO-IMPLEMENTATION-COMMIT*) ac207_neg_trace=1 ;; esac
  echo ac207 > "$ac207_fx/e2e-marker.txt"; git -C "$ac207_fx" add -A >/dev/null 2>&1
  git -C "$ac207_fx" commit -qm "feat(e2e-verify-207): add e2e-marker.txt marker (ac207)" >/dev/null 2>&1
  ac207_pos_out="$(ac207_read_and_write "$ac207_fx" "e2e-verify-207" "$ac207_stub")"
  ac207_after_pos="$(wc -l < "$ac207_carrier" | tr -d ' ')"
  ac207_pos_files="$(grep -o '"commit_files":\[[^]]*\]' "$ac207_carrier" 2>/dev/null | tail -1 | sed 's/^"commit_files"://' || true)"
  AC89=""; TS=""; BUILD_SHA=""; AC207_HOST=""; AC207_PROJECT_ROOT=""
  echo "selfcheck: ac207-e2e-write(bookkeeping-only) above=$ac207_before line=$ac207_after_neg trace=$ac207_neg_trace (expect 0 / 0 / 1 — 不写记录 + AC207-NO-IMPLEMENTATION-COMMIT 痕迹, ⛔ 不拿记账充数)"
  echo "selfcheck: ac207-e2e-write(with-impl-commit) line=$ac207_after_pos files=$ac207_pos_files (expect 1 / [\"e2e-marker.txt\"] — 同一夹具加一条实现提交即写, 故 39 的「不写」非恒真)"

  # control 41 (AC-207 produced_by_driver 不得把 `git … | grep` 接进判据 —— 结构控制):
  #   缺陷：`set -o pipefail` 下 `git log | grep -q <id>`，grep 命中即退出 ⇒ git 收 SIGPIPE ⇒ 管道 141
  #   ⇒ 判据在【条件成立时】取假（2026-09-11 跨机实测，orangevps 上真实 root：实现提交 6f35389c +
  #   gate 事件 1 条 + done 全成立，仍判 produced_by_driver=0 ⇒ 记录不写；同机 OLD=0 / NEW=1）。
  #   ⚠️ 【本控制是结构的，不是行为的】——该竞态取决于宿主 grep 是否提前退出：本机 GNU grep 读满 EOF
  #   才退，实测 10/10 管道返回 0（旧写法也通过 ⇒ 行为控制在【本机】是空转）；orangevps 的 grep 提前
  #   退，实测 5/5 返回 141。同一份代码两台机器给出相反读数 ⇒ 本机可用的确定性判据只有形状：
  #   断言 probe_ac207_measures 的函数体（去注释后）里不存在"管道进 grep"。
  #   ⛔ 修法是把输出【先取回再用 case 匹配】，不是把 grep -q 换成 grep -c（SIGPIPE 依旧）。
  local ac207_body ac207_pipe_grep=0
  ac207_body="$(sed -n '/^probe_ac207_measures()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
  if printf '%s' "$ac207_body" | grep -qE '\|[[:space:]]*grep'; then ac207_pipe_grep=1; fi
  echo "selfcheck: ac207-produced-by-driver(no-pipe-into-grep)=$((1 - ac207_pipe_grep)) (expect 1 — pipefail 下 grep 提前退出 ⇒ SIGPIPE ⇒ 命中时取假；行为控制在本机不可复现，见注释)"

  # control 42/43/44 (AC-240 运行级「闭环由本次运行自证」三态 —— gap-ac240-e2e-closure-same-run-pairing):
  #   42 正：AC-203 与 AC-207 均【本次运行】写出、同一 project_root ⇒ E2E_CLOSURE_SELF_EVIDENCED=1。
  #   43 负：仅 AC-207（AC-203 本次运行没写出 —— 本任务修之前 step⑤ 从不探 AC-203 的本来形态）⇒ =0
  #      且 NOTE 非空（⛔ 不静默）。
  #   43b 负：两条都写了但 project_root 不同 ⇒ =0（判的是【同一 project_root】，⛔ 不是「两条都非空」
  #      —— AC-240 origin 正是「两条都成立、root 互不相交」）。
  #   44 未评估：未传 --ac207-e2e ⇒ not-evaluated（⛔ 不得与 0/1 同形；词表里没有「未评估」这一态的
  #      判据分不清「查过且不合格」与「没查成」，硬规则 3b）。
  # 三态全部由【产品函数】e2e_closure_self_evidenced 算出（selfcheck 直接驱动它，⛔ 不在此复刻一遍判定
  # 逻辑——复刻出来的绿不证明产品绿，硬规则 4 推论三）。
  local ac240_v1="" ac240_n1="" ac240_v0="" ac240_n0="" ac240_vdiff="" ac240_vdiff_note="" ac240_vne="" ac240_nne=""
  e2e_closure_self_evidenced "1" "1" "/tmp/third-party-root" "1" "/tmp/third-party-root"
  ac240_v1="$E2E_CLOSURE_SELF_EVIDENCED"; ac240_n1="$E2E_CLOSURE_NOTE"
  e2e_closure_self_evidenced "1" "0" "" "1" "/tmp/third-party-root"
  ac240_v0="$E2E_CLOSURE_SELF_EVIDENCED"; ac240_n0="$E2E_CLOSURE_NOTE"
  e2e_closure_self_evidenced "1" "1" "/tmp/root-a" "1" "/tmp/root-b"
  ac240_vdiff="$E2E_CLOSURE_SELF_EVIDENCED"; ac240_vdiff_note="$E2E_CLOSURE_NOTE"
  e2e_closure_self_evidenced "0" "0" "" "0" ""
  ac240_vne="$E2E_CLOSURE_SELF_EVIDENCED"; ac240_nne="$E2E_CLOSURE_NOTE"
  # 复位：39/40 与上面的驱动都会写这两个 flag，别让夹具状态泄漏到后续断言（取值语义属「本次运行」）。
  AC203_WRITTEN_THIS_RUN=0; AC203_WRITTEN_ROOT=""; AC207_WRITTEN_THIS_RUN=0; AC207_WRITTEN_ROOT=""
  echo "selfcheck: e2e-closure(pair-same-run-same-root) E2E_CLOSURE_SELF_EVIDENCED=$ac240_v1 note_present=$([ -n "$ac240_n1" ] && echo 1 || echo 0) (expect 1/1 — 本次运行对同一 project_root 写出 AC-203 + AC-207)"
  echo "selfcheck: e2e-closure(ac207-only) E2E_CLOSURE_SELF_EVIDENCED=$ac240_v0 note_present=$([ -n "$ac240_n0" ] && echo 1 || echo 0) (expect 0/1 — 闭环不由本次运行自证, ⛔ 不静默)"
  echo "selfcheck: e2e-closure(different-roots) E2E_CLOSURE_SELF_EVIDENCED=$ac240_vdiff note_present=$([ -n "$ac240_vdiff_note" ] && echo 1 || echo 0) (expect 0/1 — 判的是同一 project_root, ⛔ 不是两条都非空)"
  echo "selfcheck: e2e-closure(no-e2e-attempt) E2E_CLOSURE_SELF_EVIDENCED=$ac240_vne note_present=$([ -n "$ac240_nne" ] && echo 1 || echo 0) (expect not-evaluated/1 — 未评估 ≠ 不合格, 硬规则 3b)"
  # AC-240 生成侧结构控制（硬规则 ② 按位置）：step⑤ 的函数体内必须出现 probe_ac203_driver_status /
  # write_ac203_record 的调用——本任务之前该函数体内命中数 = 0（改前实测），即「同一次运行能同时产出
  # 两条记录」只是【恰好从没发生过】，而不是被要求过。⛔ 这不是「跑一次看它绿」的行为控制，而是钉住
  # 产出点的位置：把探测点挪出 step⑤（或删掉）此断言即取假。
  local ac240_step5_body ac240_step5_hits
  ac240_step5_body="$(sed -n '/^step5_e2e()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
  ac240_step5_hits="$(printf '%s\n' "$ac240_step5_body" | grep -c 'write_ac203_record\|probe_ac203_driver_status' || true)"
  echo "selfcheck: ac240-ac203-write-point(in-step5_e2e) hits=$ac240_step5_hits (expect >=1 — AC-203 的探测/写入点必须落在 step⑤ 函数体内, 改前=0)"

  # control 41 (AC-239 落地基线前置的解析, gap-aged-project-post-upgrade-driver-e2e 本轮新增):
  #   ac239_baseline_state 必须能取到**每一个**取值——一个只会返回 compatible 的解析器就是硬规则 4 的
  #   「结构上不可能取假的量」，比没有检查更贵（⑦b 会在一条不接主线的 `develop` 上照常烧完一小时轮询，
  #   而那正是这个前置存在的理由）。合成交付物报告直驱【产品函数】（⛔ 不跑真 git、不碰真项目）：
  #   REUSED⇒compatible / ADOPTED⇒divergent / BLOCKED⇒divergent / CREATED⇒absent /
  #   无该行 ⇒ unreadable / rc≠0 ⇒ unreadable。后四个必须与 compatible **不同形**。
  local bl_reused bl_adopted bl_blocked bl_created bl_noline bl_badrc bl_ok=0
  bl_reused="$(ac239_baseline_state 'branch model (default branch: main):
  [REUSED] default -> main — project default branch (master role)
  [REUSED] doc-branch -> task/T-1 — derived at runtime
  [REUSED] landing-baseline -> develop — contains main (12 ahead, 0 behind) — a valid quay landing baseline' 0)"
  bl_adopted="$(ac239_baseline_state '  [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-d95dac8] — foreign fork' 0)"
  bl_blocked="$(ac239_baseline_state '  [BLOCKED] landing-baseline -> develop — foreign fork; reuse refused' 0)"
  bl_created="$(ac239_baseline_state '  [CREATED] landing-baseline -> develop at main (abc12345)' 0)"
  bl_noline="$(ac239_baseline_state 'branch model (default branch: main):
  [REUSED] default -> main — x' 0)"
  bl_badrc="$(ac239_baseline_state '  [REUSED] landing-baseline -> develop — x' 3)"
  echo "selfcheck: ac239-baseline-state(reused/adopted/blocked/created)=$bl_reused/$bl_adopted/$bl_blocked/$bl_created (expect compatible/divergent/divergent/absent)"
  echo "selfcheck: ac239-baseline-state(no-line/rc-nonzero)=$bl_noline/$bl_badrc (expect unreadable/unreadable — 读不懂 ≠ 合格, 硬规则 3b)"
  if [ "$bl_reused" = "compatible" ] && [ "$bl_adopted" = "divergent" ] && [ "$bl_blocked" = "divergent" ] \
     && [ "$bl_created" = "absent" ] && [ "$bl_noline" = "unreadable" ] && [ "$bl_badrc" = "unreadable" ]; then
    bl_ok=1
  fi

  # control 42 (AC-239 升级动作的采纳决定, gap-aged-project-post-upgrade-driver-e2e 本轮新增):
  #   ④ 落地后 shipped `quay-init.sh` 对不接主线的 `develop` 是 fail-closed（默认拒绝、exit 1、什么都不写）
  #   ⇒ 升级动作**必须**给出采纳决定，否则 `init_rc≠0` ⇒ AC-238 的门结构上不成立 ⇒ ⑦b 前置永不成立。
  #   钉住【位置】（硬规则 ②）：该旗标必须落在 step_upgrade_existing 的函数体里（⛔ 不是散在别处/注释里）。
  #   可证伪的一半（硬规则 4）：把同一段函数体里的该旗标删掉，谓词必须翻成 0 —— 否则它是个恒真量。
  local bmw_body bmw_hits bmw_stripped bmw_fail=0 bmw_ok=0
  bmw_body="$(sed -n '/^step_upgrade_existing()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
  bmw_hits="$(printf '%s\n' "$bmw_body" | grep -c -- '--adopt-branch-model' || true)"
  bmw_stripped="$(printf '%s\n' "$bmw_body" | sed 's/--adopt-branch-model//g')"
  if printf '%s\n' "$bmw_stripped" | grep -q -- '--adopt-branch-model'; then bmw_ok=1; fi
  echo "selfcheck: ac239-adopt-decision(in-step_upgrade_existing) hits=$bmw_hits negative-control(stripped)=$bmw_ok (expect >=1/0 — 升级动作必须携带采纳决定, 且该谓词删掉旗标即取假)"
  if [ "$bmw_hits" -lt 1 ] || [ "$bmw_ok" != "0" ]; then bmw_fail=1; fi

  # control 47/48/49/50 (AC-247 八件读数的正/负控制, GOAL-016 —— 本轮新增):
  # ⛔ 全部直接驱动【产品函数】（write_ac247_record / ac247_task_store_count / ac247_head_epoch /
  # ac247_stale_days），⛔ 不让夹具复刻一遍判定逻辑——复刻出来的绿不证明产品绿（硬规则 4 推论三：
  # 一个只能被夹具复刻满足的判据不是测量）。
  # 47 正控制：八件读数齐备 ⇒ 写出一条 ac=GOAL-016-AC-247 记录，且九个字段逐字落在该行里
  #    （八件 criterion 字段 + top-level build_sha 锚）。⚠️ 同时断言写入点【没有】自己的 build_sha
  #    字面量（AC-214 唯一补锚 choke point；可证伪：往函数体里加一行补锚即取假）。
  # 48 负控制（能取假，逐项）：把【任一件】置成读不出 ⇒ 零记录 + 返回值非 0。逐项各测一次——
  #    特别是 stale_days 的【边界】：13.999 必须拒写、14 必须写（一个只会拒写或只会写的阈值
  #    是恒假/恒真量，不是测量）。
  # 49 存量的同一读法正/负控制：ac247_task_store_count 经一个【真的 node 桩】读 JSON 数组长度——
  #    正控制拿到 61、负控制（桩输出非 JSON / 空）必须【不打印且非 0】（⛔ 不是打印 0：那会把
  #    「没查成」伪装成「查了是 0 条」，硬规则 3b）。
  # 50 结构性（AC4「⛔ 不从 start 退出码派生」）：step_ac247_takeover 的函数体里 driver_alive 的
  #    赋值必须全部来自 AC203_DRIVER_ALIVE（既有唯一 status 解析器的输出），且函数体里必须出现
  #    对 `driver status` 的读取。可证伪：把赋值右端换成 $AC247_DRIVER_START_RC 即取假。
  local ac247_tmp ac247_w ac247_body ac247_ok=0 ac247_neg_ok=1 ac247_neg_list="" ac247_boundary_lines=""
  local ac247_cnt_ok=0 ac247_cnt_neg_ok=0 ac247_anchor_hits=0 ac247_alive_src=1 ac247_status_hits=0
  ac247_tmp="$(mktemp -d 2>/dev/null)" || ac247_tmp=""
  if [ -n "$ac247_tmp" ]; then
    # 47 正控制
    AC89="$ac247_tmp/carrier.jsonl"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"; TS="2026-09-12T00:00:00Z"
    write_ac247_record "hostX-arm" "/home/other/stalled-project" "61" "61" "22.500" "1" "7" >/dev/null 2>&1
    ac247_w="$(grep -c 'GOAL-016-AC-247' "$ac247_tmp/carrier.jsonl" 2>/dev/null || true)"
    for f in '"host":"hostX-arm"' '"project_root":"/home/other/stalled-project"' '"pre_task_count":61' '"post_task_count":61' '"stale_days":22.500' '"driver_alive":1' '"carrier_records":7' '"build_sha":"0123456789abcdef0123456789abcdef01234567"'; do
      grep -qF -- "$f" "$ac247_tmp/carrier.jsonl" 2>/dev/null || ac247_neg_list="$ac247_neg_list $f"
    done
    [ -z "$ac247_neg_list" ] && [ "$ac247_w" = "1" ] && ac247_ok=1
    # 47b 补锚 choke point：写入点体内不得出现 build_sha 字面量
    ac247_body="$(sed -n '/^write_ac247_record()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac247_anchor_hits="$(printf '%s\n' "$ac247_body" | grep -c 'build_sha' || true)"
    # 48 负控制（逐项，显式调用，⛔ 不用 IFS 拆串那种读不准的写法）：任一件读不出/不合规 ⇒ 零记录。
    # 用 here-doc + `read` 逐条驱动【产品函数本身】（⛔ 不把判定逻辑复刻进夹具）。
    ac247_neg_ok=1
    while IFS='|' read -r n_host n_root n_pre n_post n_stale n_alive n_recs; do
      [ -n "${n_host}${n_root}${n_pre}${n_post}${n_stale}${n_alive}${n_recs}" ] || continue
      case "$n_host" in '@'*) n_host="" ;; esac
      case "$n_root" in '@'*) n_root="" ;; esac
      case "$n_stale" in '@'*) n_stale="" ;; esac
      write_ac247_record "$n_host" "$n_root" "$n_pre" "$n_post" "$n_stale" "$n_alive" "$n_recs" >/dev/null 2>&1 && ac247_neg_ok=0
    done <<'AC247NEG'
@|/p|61|61|22.5|1|7
hostX|@|61|61|22.5|1|7
hostX|/p|0|0|22.5|1|7
hostX|/p|abc|abc|22.5|1|7
hostX|/p|61|60|22.5|1|7
hostX|/p|61|61|13.999|1|7
hostX|/p|61|61|@|1|7
hostX|/p|61|61|22.5|0|7
hostX|/p|61|61|22.5|1|0
AC247NEG
    # 48b 上界一侧：14.000 必须写出（stale_days ≥ 14 的「≥」在边界上真的成立）
    rm -f "$ac247_tmp/carrier.jsonl"
    write_ac247_record "hostX" "/p" "61" "61" "14.000" "1" "1" >/dev/null 2>&1
    ac247_boundary_lines="$(grep -c 'GOAL-016-AC-247' "$ac247_tmp/carrier.jsonl" 2>/dev/null || true)"
    [ "$ac247_boundary_lines" = "1" ] || ac247_neg_ok=0
    # 49 存量计数的同一读法：真 node 桩
    printf '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(new Array(61).fill(0).map((_,i)=>({id:"T-"+i}))));\n' > "$ac247_tmp/stub-ok.js"
    printf '#!/usr/bin/env node\nprocess.stdout.write("not json at all");\n' > "$ac247_tmp/stub-bad.js"
    printf '#!/usr/bin/env node\nprocess.stdout.write("");\n' > "$ac247_tmp/stub-empty.js"
    [ "$(ac247_task_store_count "$ac247_tmp" "$ac247_tmp/stub-ok.js" 2>/dev/null)" = "61" ] && ac247_cnt_ok=1
    if ac247_task_store_count "$ac247_tmp" "$ac247_tmp/stub-bad.js" >/dev/null 2>&1; then ac247_cnt_neg_ok=1; fi
    if ac247_task_store_count "$ac247_tmp" "$ac247_tmp/stub-empty.js" >/dev/null 2>&1; then ac247_cnt_neg_ok=1; fi
    # 49b HEAD 时刻 / stale_days 直接量：真 git 仓库 + 已知时刻的提交 ⇒ 天数可复算。
    # 2026-08-01T00:00:00Z = 1785542400；+22 天 = 1787443200 ⇒ stale 必须恰为 22.000。
    mkdir -p "$ac247_tmp/repo"
    git -C "$ac247_tmp/repo" init -q -b main >/dev/null 2>&1
    git -C "$ac247_tmp/repo" config user.email t@t >/dev/null 2>&1
    git -C "$ac247_tmp/repo" config user.name t >/dev/null 2>&1
    echo x > "$ac247_tmp/repo/a.txt"
    git -C "$ac247_tmp/repo" add -A >/dev/null 2>&1
    GIT_AUTHOR_DATE="2026-08-01T00:00:00Z" GIT_COMMITTER_DATE="2026-08-01T00:00:00Z" \
      git -C "$ac247_tmp/repo" commit -qm "old" >/dev/null 2>&1
    local ac247_he ac247_sd
    ac247_he="$(ac247_head_epoch "$ac247_tmp/repo" 2>/dev/null || true)"
    ac247_sd="$(ac247_stale_days "$ac247_he" 1787443200 2>/dev/null || true)"
    if [ "$ac247_he" != "1785542400" ] || [ "$ac247_sd" != "22.000" ]; then ac247_cnt_neg_ok=1; fi
    # 49c 非 git 目录 / 空入参 ⇒ 读不出（返非 0 且不打印）——与「=0」不同形
    if ac247_head_epoch "$ac247_tmp" >/dev/null 2>&1; then ac247_cnt_neg_ok=1; fi
    if ac247_stale_days "" "" >/dev/null 2>&1; then ac247_cnt_neg_ok=1; fi
    # 50 结构性（AC4「⛔ 不从 start 退出码派生」）：driver_alive 的赋值必须来自 AC203_DRIVER_ALIVE
    #    （既有唯一 status 解析器的输出），且【真正读 status 的调用】必须落在读取函数体内。
    #    ⚠️ 谓词按【位置+参数形态】判，⛔ 不按关键词：`driver status --kind promotion` 这串字面量在
    #    step_ac247_takeover 的一行 echo 文案里也出现（本控制第一版就是这么被自己骗过的——命中 1，
    #    而那条命中是【字符串】，不是调用）。真调用的形态带 `--root`，文案里没有。
    local ac247_read_body ac247_step_body2 ac247_bad_assign ac247_stripped_body ac247_step_calls
    ac247_read_body="$(sed -n '/^ac247_read_driver_status()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac247_status_hits="$(printf '%s\n' "$ac247_read_body" | grep -c 'driver status --kind promotion --root' || true)"
    ac247_bad_assign="$(printf '%s\n' "$ac247_read_body" | grep -E '^[[:space:]]*AC247_DRIVER_ALIVE=' | grep -vc 'AC203_DRIVER_ALIVE' || true)"
    printf '%s\n' "$ac247_read_body" | grep -qE 'AC247_DRIVER_ALIVE="\$AC203_DRIVER_ALIVE"' || ac247_alive_src=0
    # 负控制（可证伪）：把右端换成 start 退出码 ⇒ 谓词必须翻成 0。
    ac247_stripped_body="${ac247_read_body//AC247_DRIVER_ALIVE=\"\$AC203_DRIVER_ALIVE\"/AC247_DRIVER_ALIVE=\"\$AC247_DRIVER_START_RC\"}"
    if printf '%s\n' "$ac247_stripped_body" | grep -qE 'AC247_DRIVER_ALIVE="\$AC203_DRIVER_ALIVE"'; then ac247_alive_src=0; fi
    # 生成侧（硬规则 ② 按位置）：⑧ 的函数体必须【调用】那个读取函数——把读取点挪出函数体（或删掉）
    # 此断言即取假；否则「pre/post 都读了」只是恰好发生，而不是被要求过（同 AC-240 的 step5 控制）。
    ac247_step_body2="$(sed -n '/^step_ac247_takeover()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac247_step_calls="$(printf '%s\n' "$ac247_step_body2" | grep -c 'ac247_read_driver_status "' || true)"
    if [ "${ac247_step_calls:-0}" -lt 2 ] 2>/dev/null; then ac247_alive_src=0; fi
    rm -rf "$ac247_tmp"
  else
    ac247_ok=0
  fi
  echo "selfcheck: ac247-record(fields+anchor) ok=$ac247_ok missing_fields='${ac247_neg_list}' anchor-literal-hits=$ac247_anchor_hits (expect 1/''/0 — 八件字段逐字落行, 且写入点无第二个 build_sha 补锚)"
  echo "selfcheck: ac247-refusal(9 negative specs + boundary-14.000-accepted) negatives_all_refused=$ac247_neg_ok (expect 1 — 任一件读不出/不合规 ⇒ 零记录; 14.000 必须写)"
  echo "selfcheck: ac247-task-store-count(61 via real node stub) ok=$ac247_cnt_ok head/stale-unreadable-checks=$ac247_cnt_neg_ok (expect 1/0 — 同一读法读 JSON 数组长度; 非 JSON/空 ⇒ 不打印且非 0)"
  echo "selfcheck: ac247-liveness-source(from-AC203_DRIVER_ALIVE)=$ac247_alive_src status-read-hits=$ac247_status_hits bad-assign-hits=$ac247_bad_assign (expect 1/>=1/0 — ⛔ 不从 driver start 退出码派生, 且 status 读取点必须在函数体内)"

  # control 51/52/53/54 (AC-248 翻转读数的正/负控制, GOAL-016 —— 本轮新增):
  # ⛔ 全部直接驱动【产品函数】（ac248_adr_flip_reading / write_ac248_record），⛔ 不让夹具复刻一遍判定
  #    逻辑（硬规则 4 推论三）。夹具只提供【一个真的 git 仓库 + 一个真的、会翻转的检查器脚本】——
  #    这两样是「输入形态」，不是判定逻辑本身。
  # 51 正控制：一个真的 git 仓库里，修复提交让检查器多看见一个工具（候选集 1 → 2）⇒
  #    ac248_adr_flip_reading 必须读出 probe=<新工具名> / before=false / after=true，且 write_ac248_record
  #    必须写出 1 条记录、三个 adr_check_* 字段逐字落行、两个布尔是【JSON 布尔】而不是字符串/数字。
  # 52 负控制（能取假，逐项）：反转方向 / 0-1 / 字符串 "false"/"true" / 缺字段 / 记账提交 / 空 probe ⇒
  #    零记录 + 返回值非 0（每一项各测一次）。
  # 53 无修复 ⇒ 差集为空 ⇒ 无 probe ⇒ 零记录（「修复没让任何工具新进入候选集」不得被写成一条记录）。
  # 54 结构性：write_ac248_record 体内不得出现 `true`/`false` 字面量（AC2：写入路径无硬编码默认值）；
  #    且 AC-248 段落【不】含任何 ADR-007 判定实现（AC3：正确性判据不由 quay 拥有）——非注释行里
  #    `adr-ok` / `ADR-007` 命中数必须为 0，而调用目标项目检查器导出的那一处必须在位。
  local ac248_tmp ac248_w ac248_ok=0 ac248_neg_ok=1 ac248_neg_list="" ac248_probe="" ac248_bd="" ac248_ad=""
  local ac248_noop_lines="" ac248_false_hits=0 ac248_adr007_hits=0 ac248_export_hits=0 ac248_step_calls=0 ac248_step_lits=0
  ac248_tmp="$(mktemp -d 2>/dev/null)" || ac248_tmp=""
  if [ -n "$ac248_tmp" ]; then
    local ac248_repo="$ac248_tmp/repo"
    mkdir -p "$ac248_repo/scripts" "$ac248_repo/src" "$ac248_repo/tasks" "$ac248_repo/tests"
    git -C "$ac248_repo" init -q -b main >/dev/null 2>&1
    git -C "$ac248_repo" config user.email t@t >/dev/null 2>&1
    git -C "$ac248_repo" config user.name t >/dev/null 2>&1
    # ⚠️ 夹具的检查器【按 cwd 相对路径读输入】（如真实检查器按 process.cwd() 定位要扫的目录）——
    #    这正是 2026-09-12 实测抓到的那个缺陷形态：候选集读取若不在物化树里跑，会安静地读到空集
    #    （退出码 0、没有报错）。夹具必须带这个形态，否则自检对那类缺陷恒绿。
    cat > "$ac248_repo/scripts/check-adr.ts" <<'AC248CHK1'
import fs from "node:fs";
export function extractMcpToolNames(): string[] {
  return fs.readFileSync("src/tools.txt", "utf8").trim().split("\n").filter(Boolean);
}
AC248CHK1
    printf 'tool_seen\n' > "$ac248_repo/src/tools.txt"
    echo "seed" > "$ac248_repo/tasks/seed.md"
    git -C "$ac248_repo" add -A >/dev/null 2>&1
    git -C "$ac248_repo" commit -qm "seed: project baseline" >/dev/null 2>&1
    # ⚠️【记账边界】——修复段与历史之间必须有一条只动 tasks/ 的记账提交（quay 驱动的项目里 driver
    #    每轮都落一条）。夹具必须带它，否则 pre 的推导会退化成 <impl>^，而那个退化正是被修复的缺陷形态。
    echo "T-1 ready" > "$ac248_repo/tasks/T-1.md"
    git -C "$ac248_repo" add -A >/dev/null 2>&1
    git -C "$ac248_repo" commit -qm "tasks: T-1 首次登记（机械落盘）" >/dev/null 2>&1
    # ⚠️【一次修复 = 多个提交】——真实形态（实测 2026-09-12 ad-arm1 TASK-88：fix + test + lint fixup）：
    #    最新一条只改了测试文件，它的 parent 已经带着修复。夹具必须带这个形态，否则「取 <impl>^」
    #    那个缺陷在自检里恒绿（差集非空是巧合，不是判据在起作用）。
    printf 'tool_seen\ntool_newly_seen\n' > "$ac248_repo/src/tools.txt"
    git -C "$ac248_repo" add -A >/dev/null 2>&1
    git -C "$ac248_repo" commit -qm "fix: checker now sees the comment-prefixed tool declaration" >/dev/null 2>&1
    echo "test" > "$ac248_repo/tests/check-adr.test.ts"
    git -C "$ac248_repo" add -A >/dev/null 2>&1
    git -C "$ac248_repo" commit -qm "test: assert the two extractors agree directly" >/dev/null 2>&1
    local ac248_sha ac248_base
    ac248_sha="$(git -C "$ac248_repo" rev-parse HEAD 2>/dev/null || true)"
    ac248_base="$(git -C "$ac248_repo" rev-parse HEAD~2 2>/dev/null || true)"
    ac248_adr_flip_reading "$ac248_repo" "$ac248_sha" "$ac248_tmp/rt"
    ac248_probe="$AC248_PROBE_TOOL"; ac248_bd="$AC248_BEFORE_DETECTS"; ac248_ad="$AC248_AFTER_DETECTS"
    [ "$ac248_probe" = "tool_newly_seen" ] && [ "$ac248_bd" = "false" ] && [ "$ac248_ad" = "true" ] && ac248_ok=1
    # 51c 修复前修订必须是【整段修复序列之前】那条记账边界，而不是 <impl>^（后者仍带着修复 ⇒ 差集为空）：
    #     pre 的树里 tools.txt 只有 1 行（修复前），且 span = 2（fix + test 两条提交）。
    [ "$AC248_PRE_REV_SOURCE" = "fix-series-boundary" ] && [ "$AC248_PRE_REV_SPAN" = "2" ] || ac248_ok=0
    ac248_pretools="$(git -C "$ac248_repo" show "$AC248_PRE_REV:src/tools.txt" 2>/dev/null | tr -d ' ' || true)"
    [ "$ac248_pretools" = "tool_seen" ] || ac248_ok=0
    # ⛔ 反向对照：把规则换成 <impl>^ 必须【取不出 probe】（否则 51c 的断言是空转）——用同一个产品函数、
    #    显式传入落档的 pre-head=<impl>^，差集必须为空。
    ac248_adr_flip_reading "$ac248_repo" "$ac248_sha" "$ac248_tmp/rt-neg" "$(git -C "$ac248_repo" rev-parse HEAD~1 2>/dev/null || true)"
    [ -z "$AC248_PROBE_TOOL" ] || ac248_ok=0
    ac248_adr_flip_reading "$ac248_repo" "$ac248_sha" "$ac248_tmp/rt"
    # 51b 产品写入器：正控制 ⇒ 恰一条记录，三个字段逐字（两个布尔必须是 JSON 布尔裸值）
    AC89="$ac248_tmp/carrier.jsonl"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"; TS="2026-09-12T00:00:00Z"
    write_ac248_record "hostX-arm" "/home/other/archguard" "0123456789abcdef0123456789abcdef01234567" "TASK-88" "done" "3" "true" \
      '["src/cli/mcp/tools/metric-trend-tools.ts"]' "$ac248_bd" "$ac248_ad" "$ac248_probe" >/dev/null 2>&1
    ac248_w="$(grep -c 'GOAL-016-AC-248' "$ac248_tmp/carrier.jsonl" 2>/dev/null || true)"
    for f in '"host":"hostX-arm"' '"project_root":"/home/other/archguard"' '"task_id":"TASK-88"' '"task_status":"done"' '"gate_events":3' '"produced_by_driver":true' '"adr_check_before_detects":false' '"adr_check_after_detects":true' '"adr_check_probe_tool":"tool_newly_seen"'; do
      grep -qF -- "$f" "$ac248_tmp/carrier.jsonl" 2>/dev/null || ac248_neg_list="$ac248_neg_list $f"
    done
    # 反向控制（可证伪）：把读到的方向反过来 ⇒ 同一条记录必须写不出来
    if write_ac248_record "hostX-arm" "/home/other/archguard" "0123456789abcdef0123456789abcdef01234567" "TASK-88" "done" "3" "true" \
         '["src/a.ts"]' "$ac248_ad" "$ac248_bd" "$ac248_probe" >/dev/null 2>&1; then ac248_ok=0; fi
    rm -f "$ac248_tmp/carrier.jsonl"
    [ "$ac248_w" = "1" ] && [ -z "$ac248_neg_list" ] && write_ac248_record "hostX-arm" "/home/other/archguard" "0123456789abcdef0123456789abcdef01234567" "TASK-88" "done" "3" "true" '["src/a.ts"]' "$ac248_bd" "$ac248_ad" "$ac248_probe" >/dev/null 2>&1
    ac248_after51b="$(grep -c 'GOAL-016-AC-248' "$ac248_tmp/carrier.jsonl" 2>/dev/null || true)"
    [ "$ac248_after51b" = "1" ] || ac248_ok=0
    # 52 负控制（逐项，here-doc 驱动【产品函数本身】）：任一件读不出/不合规 ⇒ 零记录。
    while IFS='|' read -r n_host n_root n_sha n_tid n_st n_ge n_pbd n_cf n_before n_after n_probe; do
      [ -n "${n_host}${n_root}${n_sha}${n_tid}${n_st}${n_ge}${n_pbd}${n_cf}${n_before}${n_after}${n_probe}" ] || continue
      case "$n_host" in '@'*) n_host="" ;; esac
      case "$n_root" in '@'*) n_root="" ;; esac
      case "$n_sha" in '@'*) n_sha="" ;; esac
      case "$n_tid" in '@'*) n_tid="" ;; esac
      case "$n_cf" in '@'*) n_cf="" ;; esac
      case "$n_before" in '@'*) n_before="" ;; esac
      case "$n_after" in '@'*) n_after="" ;; esac
      case "$n_probe" in '@'*) n_probe="" ;; esac
      write_ac248_record "$n_host" "$n_root" "$n_sha" "$n_tid" "$n_st" "$n_ge" "$n_pbd" "$n_cf" \
        "$n_before" "$n_after" "$n_probe" >/dev/null 2>&1 && ac248_neg_ok=0
    done <<'AC248NEG'
@|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|false|true|tool_x
hostX|@|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|false|true|tool_x
hostX|/p|@|T-1|done|3|true|["src/a.ts"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|@|done|3|true|["src/a.ts"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|todo|3|true|["src/a.ts"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|0|true|["src/a.ts"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|false|["src/a.ts"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|@|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["tasks/a.md","goals/b.md"]|false|true|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|true|false|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|0|1|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|"false"|"true"|tool_x
hostX|/p|0123456789abcdef0123456789abcdef01234567|T-1|done|3|true|["src/a.ts"]|false|true|@
AC248NEG
    # 53 无修复（差集为空）⇒ 无 probe ⇒ 零记录：把读取点指向 base 提交（两边输入相同）
    ac248_adr_flip_reading "$ac248_repo" "$ac248_base" "$ac248_tmp/rt2"
    ac248_noop_lines="$(wc -l < "$ac248_tmp/carrier.jsonl" 2>/dev/null | tr -d ' ' || echo 0)"
    if [ -n "$AC248_PROBE_TOOL" ]; then ac248_neg_ok=0; fi
    write_ac248_record "hostX-arm" "/home/other/archguard" "0123456789abcdef0123456789abcdef01234567" "TASK-88" "done" "3" "true" \
      '["src/a.ts"]' "$AC248_BEFORE_DETECTS" "$AC248_AFTER_DETECTS" "$AC248_PROBE_TOOL" >/dev/null 2>&1 && ac248_neg_ok=0
    ac248_after53="$(grep -c 'GOAL-016-AC-248' "$ac248_tmp/carrier.jsonl" 2>/dev/null || true)"
    [ "$ac248_after53" = "1" ] || ac248_neg_ok=0
    # 54 结构性
    local ac248_body ac248_seg
    ac248_body="$(sed -n '/^write_ac248_record()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac248_false_hits="$(printf '%s\n' "$ac248_body" | grep -cE '(^|[^_a-zA-Z])(true|false)([^_a-zA-Z]|$)' || true)"
    # AC3：AC-248 段落（⑨ 的函数体）非注释行里不得出现任何 ADR-007 判定面（`adr-ok` 豁免词 / ADR-007 判定）；
    # 而「调用目标项目检查器导出的枚举函数」那一处必须在位（可证伪：删掉它 ⇒ 命中 0）。
    ac248_seg="$(sed -n '/^ac248_checker_relpath()/,/^# ── ① 安装/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac248_adr007_hits="$(printf '%s\n' "$ac248_seg" | grep -cE 'adr-ok|ADR-007' || true)"
    ac248_export_hits="$(printf '%s\n' "$ac248_seg" | grep -c 'extractMcpToolNames' || true)"
    # 生成侧（硬规则 ② 按位置）：⑨ 的函数体必须【调用】翻转读数函数——把读取点挪出函数体（或删掉）即取假
    ac248_step_calls="$(sed -n '/^step_ac248_adr_flip()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' | grep -c 'ac248_adr_flip_reading\|probe_ac248_measures' || true)"
    # 54b 调用点也不许有常量：⑨ 的函数体里不得出现 `"true"`/`"false"` 字面量（每个字段都必须来自读数）。
    ac248_step_lits="$(sed -n '/^step_ac248_adr_flip()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' | grep -cE '"(true|false)"' || true)"
    rm -rf "$ac248_tmp"
  else
    ac248_ok=0
  fi
  echo "selfcheck: ac248-flip-reading(hermetic 2-commit checker) probe='${ac248_probe}' before='${ac248_bd}' after='${ac248_ad}' ok=$ac248_ok missing='${ac248_neg_list}' (expect tool_newly_seen/false/true/1/'' — 读数与写入都由产品函数产生)"
  echo "selfcheck: ac248-refusal(13 negative specs) negatives_all_refused=$ac248_neg_ok (expect 1 — 反转/0-1/字符串/缺件/记账提交/空探针 ⇒ 零记录)"
  echo "selfcheck: ac248-noop-fix(差集为空) carrier_lines=${ac248_noop_lines:-<n/a>} (expect 1 — 只有 51b 那一条; 无修复 ⇒ 无 probe ⇒ 不新增记录)"
  echo "selfcheck: ac248-writer-literal-hits=$ac248_false_hits adr007-in-producer-hits=$ac248_adr007_hits checker-export-hits=$ac248_export_hits step-call-hits=$ac248_step_calls step-literal-hits=$ac248_step_lits (expect 0/0/>=1/>=1/0 — 写入点无字面量默认值; quay 不拥有 ADR 判定; 调用与读取点都在函数体内)"

  # ── ⑩ AC-250（GOAL-016 观察面）：七件直接量的写入器正/负控制 ────────────────────────────────
  # 正控制直接调【产品函数】write_ac250_record（⛔ 不让夹具复刻判定逻辑，硬规则 4 推论三）。
  # 负控制逐件置为读不出 / 两点相等 / 回环绑定 / 自探 / 类型不符 ⇒ 每条都【零记录】。
  # ⛔ 还要钉住两条最容易悄悄退化的性质：写入器体内无 `build_sha` 字面量（唯一补锚点是
  # ac89_append_goal009）、且【不含任何 true/false 或阈值的字面量默认值】（AC2 的可执行形式）。
  local ac250_tmp ac250_line ac250_pos_ok=1 ac250_neg_ok=1 ac250_neg_n=0 ac250_rej=0
  ac250_tmp="$(mktemp -d 2>/dev/null || true)"
  if [ -n "$ac250_tmp" ]; then
    local ac250_carrier="$ac250_tmp/carrier.jsonl" ac250_save_sha="${BUILD_SHA:-}" ac250_save_ts="${TS:-}" ac250_save_ac89="${AC89:-}"
    BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
    TS="2026-09-12T00:00:00Z"
    AC89="$ac250_carrier"
    # 正控制：七件齐备 ∧ before≠after ∧ store 一致 ⇒ 写出 1 条
    if write_ac250_record "target-host-B" "/home/other/archguard" "100.100.148.48" "100.100.148.48" \
         "probe-host-A" 200 "TASK-9" "todo" "ready" "ready" 2>/dev/null; then
      ac250_line="$(grep -c 'GOAL-016-AC-250' "$ac250_carrier" 2>/dev/null || true)"
      [ "$ac250_line" = "1" ] || ac250_pos_ok=0
    else
      ac250_pos_ok=0
    fi
    echo "selfcheck: ac250-record(positive,7-fields) wrote=$ac250_pos_ok (expect 1 — 七件齐备才写)"
    echo "selfcheck: ac250-record(positive) line=$(head -n1 "$ac250_carrier" 2>/dev/null | head -c 400)"
    # 负控制：逐件（here-doc 驱动【产品函数本身】）。`@` = 空。
    while IFS='|' read -r n_host n_root n_bind n_ts n_pf n_http n_tid n_before n_after n_store; do
      [ -n "${n_host}${n_root}${n_bind}${n_ts}${n_pf}${n_http}${n_tid}${n_before}${n_after}${n_store}" ] || continue
      ac250_neg_n=$((ac250_neg_n + 1))
      case "$n_host" in '@'*) n_host="" ;; esac
      case "$n_root" in '@'*) n_root="" ;; esac
      case "$n_bind" in '@'*) n_bind="" ;; esac
      case "$n_ts" in '@'*) n_ts="" ;; esac
      case "$n_pf" in '@'*) n_pf="" ;; esac
      case "$n_http" in '@'*) n_http="" ;; esac
      case "$n_tid" in '@'*) n_tid="" ;; esac
      case "$n_before" in '@'*) n_before="" ;; esac
      case "$n_after" in '@'*) n_after="" ;; esac
      case "$n_store" in '@'*) n_store="" ;; esac
      if write_ac250_record "$n_host" "$n_root" "$n_bind" "$n_ts" "$n_pf" "$n_http" "$n_tid" \
           "$n_before" "$n_after" "$n_store" >/dev/null 2>&1; then
        ac250_rej=$((ac250_rej + 1))
      fi
    done <<'AC250NEG'
@|/p|100.100.148.48|100.100.148.48|probe-A|200|T-1|todo|ready|ready
hostB|@|100.100.148.48|100.100.148.48|probe-A|200|T-1|todo|ready|ready
hostB|/p|@|100.100.148.48|probe-A|200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|@|probe-A|200|T-1|todo|ready|ready
hostB|/p|127.0.0.1|127.0.0.1|probe-A|200|T-1|todo|ready|ready
hostB|/p|0.0.0.0|0.0.0.0|probe-A|200|T-1|todo|ready|ready
hostB|/p|::|::|probe-A|200|T-1|todo|ready|ready
hostB|/p|localhost|localhost|probe-A|200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.149.49|probe-A|200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|@|200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|hostB|200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|@|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|404|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|http_200|T-1|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|200|@|todo|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|200|T-1|@|ready|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|200|T-1|todo|@|ready
hostB|/p|100.100.148.48|100.100.148.48|probe-A|200|T-1|todo|todo|todo
hostB|/p|100.100.148.48|100.100.148.48|probe-A|200|T-1|todo|ready|done
AC250NEG
    ac250_after_neg="$(grep -c 'GOAL-016-AC-250' "$ac250_carrier" 2>/dev/null || true)"
    [ "$ac250_rej" = "0" ] || ac250_neg_ok=0
    [ "$ac250_after_neg" = "1" ] || ac250_neg_ok=0    # 负控制一条都不许写进去（正控制那 1 条照旧）
    echo "selfcheck: ac250-refusal(${ac250_neg_n} negative specs) all_refused=$ac250_neg_ok accepted=$ac250_rej carrier_lines=$ac250_after_neg (expect 1/0/1 — 缺件/回环/自探/类型不符/两点相等/store 不一致 ⇒ 零记录)"
    # 结构性：写入器体内不得出现 build_sha 字面量（唯一补锚点是 choke point），也不得有字段默认值
    local ac250_body ac250_sha_hits ac250_anchor_hits ac250_choke_hits ac250_step_lit ac250_step_calls
    ac250_body="$(sed -n '/^write_ac250_record()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
    ac250_sha_hits="$(printf '%s\n' "$ac250_body" | grep -c 'build_sha' || true)"
    ac250_anchor_hits="$(printf '%s\n' "$ac250_body" | grep -c '100\.100\.148\.48\|127\.0\.0\.1' || true)"
    ac250_choke_hits="$(printf '%s\n' "$ac250_body" | grep -c 'ac89_append_goal009' || true)"
    ac250_step_calls="$(sed -n '/^step_ac250_web_observe()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' | grep -c 'write_ac250_record\|ac250_read_target_identity\|ac250_fetch_page\|ac250_read_store_status' || true)"
    ac250_step_lit="$(sed -n '/^step_ac250_web_observe()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' | grep -c '100\.100\.148\.48' || true)"
    echo "selfcheck: ac250-writer build_sha-literal-hits=$ac250_sha_hits addr-literal-hits=$ac250_anchor_hits choke-point-hits=$ac250_choke_hits step-read-call-hits=$ac250_step_calls step-addr-literal-hits=$ac250_step_lit (expect 0/0/>=1/>=1/0 — 写入点无字面量默认值; 地址来自目标机读数)"
    [ "${ac250_sha_hits:-1}" = "0" ] || ac250_neg_ok=0
    [ "${ac250_anchor_hits:-1}" = "0" ] || ac250_neg_ok=0
    [ "${ac250_choke_hits:-0}" -ge 1 ] 2>/dev/null || ac250_neg_ok=0
    [ "${ac250_step_calls:-0}" -ge 1 ] 2>/dev/null || ac250_neg_ok=0
    [ "${ac250_step_lit:-1}" = "0" ] || ac250_neg_ok=0
    BUILD_SHA="$ac250_save_sha"; TS="$ac250_save_ts"; AC89="$ac250_save_ac89"
    rm -rf "$ac250_tmp"
  else
    ac250_pos_ok=0; ac250_neg_ok=0
  fi

  # ⑨b AC-249 的 hermetic 正/负控制独立成一个函数（同上：每条都驱动产品函数，⛔ 不复刻判定逻辑）。
  selfcheck_ac249; ac249_self_ok=$?

  if [ "$d1" = "1" ] && [ "$d2" = "no" ] && [ "$a1" = "1" ] && [ "$a2" = "yes" ] \
     && [ "${ac249_self_ok:-1}" = "0" ] \
     && [ "$ac247_ok" = "1" ] && [ "$ac247_neg_ok" = "1" ] && [ "$ac247_cnt_ok" = "1" ] \
     && [ "$ac247_cnt_neg_ok" = "0" ] && [ "$ac247_alive_src" = "1" ] \
     && [ "${ac247_status_hits:-0}" -ge 1 ] 2>/dev/null && [ "${ac247_bad_assign:-0}" = "0" ] \
     && [ "${ac247_anchor_hits:-0}" = "0" ] \
     && [ "$ac248_ok" = "1" ] && [ "$ac248_neg_ok" = "1" ] \
     && [ "${ac248_false_hits:-1}" = "0" ] && [ "${ac248_adr007_hits:-1}" = "0" ] \
     && [ "${ac248_export_hits:-0}" -ge 1 ] 2>/dev/null && [ "${ac248_step_calls:-0}" -ge 1 ] 2>/dev/null \
     && [ "${ac248_step_lits:-1}" = "0" ] \
     && [ "${ac248_noop_lines:-0}" = "1" ] \
     && [ "${ac250_pos_ok:-0}" = "1" ] && [ "${ac250_neg_ok:-0}" = "1" ] \
     && [ "${ac250_neg_n:-0}" -ge 18 ] 2>/dev/null \
     && [ "$bl_ok" = "1" ] && [ "$bmw_fail" = "0" ] \
     && [ "$c3_e" = "1" ] && [ "$c3_ok" = "1" ] \
     && [ "$c4_e" = "1" ] && [ "$c4_ok" = "0" ] \
     && [ "$c5_e" = "0" ] && [ "$c5_ok" = "0" ] \
     && [ "$p1" = "0" ] && [ "$p2" = "no" ] \
     && [ "$p3" = "1" ] && [ "$p4" = "yes" ] \
     && [ "$p5" = "1" ] \
     && [ "$n1" = "1" ] && [ "$n2" = "0" ] \
     && [ "$s_ok1" = "1" ] && [ "$s_cnt1" = "2" ] && [ "$s_ok2" = "0" ] && [ "$s_cnt2" = "3" ] \
     && [ "$m1_ev" = "1" ] && [ "$m1_reg" = "1" ] && [ "$m1_ok" = "1" ] && [ "$m1_leak" = "0" ] \
     && [ "$m2_ok" = "0" ] \
     && [ "$m3_ok" = "0" ] && [ "$m3_leak" = "1" ] \
     && [ "$m4_reg" = "0" ] && [ -n "$m4_rc" ] && [ -n "$m4_reason" ] \
     && [ "$ac203_wrote" = "1" ] && [ "$ac203_fields_ok" = "1" ] && [ "$ac203_refused" = "1" ] \
     && [ "$ac203_parse_alive" = "1" ] && [ "$ac203_parse_recs" = "2" ] \
     && [ "$ac201_pos_w" = "1" ] && [ "${#ac201_pos_sha}" = "40" ] && [ "${#ac201_pos_tgz}" = "64" ] && [ "$ac201_pos_ac" = "1" ] \
     && [ "$ac201_neg_w" = "0" ] && [ "$ac201_neg_lines" = "1" ] \
     && [ "$g15_rc" = "0" ] && [ "$g15_pos" = "1" ] && [ "$g15_build" = "1" ] \
     && [ "$g16_rc" != "0" ] && [ "$g16_before" = "$g16_after" ] \
     && [ "$ac206_wrote" = "1" ] && [ "$ac206_fields_ok" = "1" ] && [ "$ac206_neg_ok" = "1" ] && [ "$ac206_refused" = "1" ] \
     && [ "$ac204_wrote" = "1" ] && [ "$ac204_fields_ok" = "1" ] && [ "$ac204_refused_fc" = "1" ] && [ "$ac204_refused_en" = "1" ] \
     && [ "$ac205_tc_hit" = "1" ] && [ "$ac205_tc_miss" = "0" ] \
     && [ "$ac205_wrote" = "1" ] && [ "$ac205_fields_ok" = "1" ] \
     && [ "$ac205_ship_refused" = "1" ] && [ "$ac205_conf_refused" = "1" ] && [ "$ac205_host_refused" = "1" ] \
     && [ "$ac234_tasks_pos" = "3" ] && [ "$ac234_goals_pos" = "2" ] && [ "$ac234_rounds_pos" = "5" ] \
     && [ "$ac234_tasks_neg" = "0" ] && [ "$ac234_goals_neg" = "0" ] && [ "$ac234_rounds_neg" = "0" ] \
     && [ "$ac234_wrote" = "1" ] && [ "$ac234_fields_ok" = "1" ] && [ "$ac234_refused_zc" = "1" ] && [ "$ac234_refused_em" = "1" ] \
     && [ "$ac232_wrote" = "1" ] && [ "$ac232_fields_ok" = "1" ] && [ "$ac232_neg_ok" = "1" ] && [ "$ac232_refused" = "1" ] \
     && [ "$ac207_wrote" = "1" ] && [ "$ac207_fields_ok" = "1" ] \
     && [ "$ac207_refused_pdb" = "1" ] && [ "$ac207_refused_ge" = "1" ] \
     && [ "$ac207_refused_bkfiles" = "1" ] && [ "$ac207_refused_nofiles" = "1" ] \
     && [ "$ac207_sel_rc" = "0" ] && [ "$ac207_sel_subj" = "feat(e2e-verify-207): add e2e-marker.txt marker (ac207)" ] \
     && [ -z "$ac207_only_out" ] && [ "$ac207_only_rc" != "0" ] \
     && [ "$ac207_bk_tasks_only" = "1" ] && [ "$ac207_impl_marker" = "1" ] \
     && [ "$ac207_before" = "0" ] && [ "$ac207_after_neg" = "0" ] && [ "$ac207_neg_trace" = "1" ] \
     && [ "$ac207_after_pos" = "1" ] && [ "$ac207_pos_files" = '["e2e-marker.txt"]' ] \
     && [ "$ac207_pipe_grep" = "0" ] \
     && [ "$ac240_v1" = "1" ] && [ -n "$ac240_n1" ] \
     && [ "$ac240_v0" = "0" ] && [ -n "$ac240_n0" ] \
     && [ "$ac240_vdiff" = "0" ] && [ -n "$ac240_vdiff_note" ] \
     && [ "$ac240_vne" = "not-evaluated" ] && [ -n "$ac240_nne" ] \
     && [ "${ac240_step5_hits:-0}" -ge 1 ] 2>/dev/null \
     && [ "$fn_v_pos" = "1" ] && [ "$fn_w_pos" = "1" ] && [ "$fn_iso_written" = "1" ] && [ "$fn_sent_same" = "1" ] \
     && [ "$fn_v_neg" = "0" ] && [ "$fn_w_neg" = "0" ] \
     && [ "$bl_ok" = "1" ] \
     && [ "$tp_ok" = "1" ]; then
    echo "selfcheck: PASS — AC2 direct measures can take false (chore auto-commit excluded; proc_ok demoted by startup-prompt) and true (loop work; proc_ok + passed-prompt); L1 closed-set is parsed from SPEC (spec-mutate flips verdict, missing-spec is NOT-evaluated ≠ qualified); AC5 can take false (old build), true (recent build), and be distinct when not evaluated; marketplace channel (AC168) registers via register-plugin.mjs and can take false (no-register ⇒ no entry) and true (register ⇒ entry + no enabledPlugins leak), and a register failure is recorded structurally (exit code not swallowed, AC5); AC-203 carrier record writes the five criterion fields verbatim (has_plugin_dir=false literal, driver_alive=1, carrier_records>0) and refuses to write a dead-driver record (fail-closed); AC-201 record append writes top-level {ts,ac,build_sha,tgz_sha256} only when BUILD_SHA and SHA256_QUAY are both non-empty (positive 40-hex/64-hex; negative empty-BUILD_SHA writes nothing, 硬规则 3b); GOAL-009 anchor helper appends top-level build_sha on a 40-hex BUILD_SHA and refuses (non-zero, no write) on an empty BUILD_SHA (AC-214 fail-closed); AC-206 carrier record writes the four boolean fields verbatim (goals_dir_created/tasks_dir_created/goal_store_readable/task_store_readable) and refuses an empty-host record (fail-closed); AC-204 carrier record writes the five criterion fields verbatim (forbidden_count=0 integer, enable_declared=true literal) and refuses a forbidden-copy or no-enable record (fail-closed, 成对判定); AC-205 carrier record writes the three criterion fields verbatim (shipped_from_installed_artifact=true + transcript_confirmed=true literals, top-level build_sha) with transcript_confirmed derived from transcript-delivery-check reading the transcript (hit ⇒ delivered / miss ⇒ not) — never from a send exit code — and refuses shipped=false / transcript_confirmed=false / empty-host (fail-closed, AC4 负控制); AC-234 render counts are derived from rendered HTML content (task/goal anchors + round-row anchors — never an HTTP status code, AC2) and can take false (empty-shell page ⇒ 0/0/0); the AC-234 carrier record writes the six criterion fields verbatim (tasks_rendered/goals_rendered/round_records_rendered as JSON integers) and refuses a zero-count or empty-host record (fail-closed, AC4 负控制); the AC-232 carrier record writes the three criterion fields verbatim (goal_write_ok/goal_read_back_ok as JSON literals, goal_records as a JSON integer) with a top-level build_sha anchor, truthfully writes false/0 when the goal write fails or read-back is empty (缺件如实非静默, AC4 负控制 — 写调用 0 与空文件同形), and refuses an empty-host record (fail-closed, 硬规则 3b); AC-207 carrier record writes the eight criterion fields verbatim (produced_by_driver=true literal, gate_events>0, task_status=done, commit_sha/task_id non-empty, commit_files non-empty JSON array with ≥1 path outside the tasks/ goals/ .quay/ triplet, top-level build_sha) and refuses produced_by_driver=false / gate_events=0 / bookkeeping-files-only / no-files (fail-closed, 硬规则 3b); AC-207 implementation-commit SELECTION picks the real implementation commit even when newer bookkeeping commits sit on top of it (the old grep-v-chore-quay-init-then-head-1 form picked the 翻-done commit — gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit), yields empty + non-zero when only bookkeeping commits exist (⇒ no record, never a bookkeeping commit dressed up as one), and the bookkeeping judgment is positional (touched files, not commit-message text); AC-240 run-level closure self-evidence takes three DISTINGUISHABLE values (1 = AC-203 and AC-207 both written by THIS run for the SAME project_root; 0 = this run attempted the e2e but the closure is not self-evidenced, with a non-empty NOTE naming the sub-reason; not-evaluated = --ac207-e2e not passed — 未评估 ≠ 不合格, 硬规则 3b), where 0 also covers the origin defect's own shape (AC-207 written, AC-203 never probed in step⑤) and the both-written-but-different-roots case (the pairing is on the SAME project_root, not on both being non-empty), and the AC-203 generation-side probe/write call is POSITIONALLY inside step5_e2e's body (0 before this task — the same-run pairing existed only as an accident, never as a requirement); segment ① (step1_install, the delivery-install path) leaves the operator's real ~/.claude/settings.json BYTE-IDENTICAL (HOME isolated to \${PREFIX}.home + QUAY_SKIP_PLUGIN_CLI=1 — the CLI materialization that re-reddened AC-161), with the isolated HOME proven to have received the postinstall write (so the green is not a not-run vacuity), and that assertion can take FALSE (isolation target pointed back at the real HOME ⇒ signature changes); and the AC-239 landing-baseline pre-flight classifier takes every value (REUSED⇒compatible / ADOPTED⇒divergent / BLOCKED⇒divergent / CREATED⇒absent / no-line-or-rc≠0⇒unreadable) — so a target copy whose 'develop' is a foreign fork stops ⑦b with an attributable 5-second reading instead of an hour-long poll whose non-done end state is indistinguishable from a worker that failed to implement (gap-aged-project-post-upgrade-driver-e2e 本轮新增); and the AC-247 takeover producer writes its eight criterion fields verbatim (host / project_root / pre_task_count / post_task_count / stale_days / driver_alive / carrier_records, plus the top-level build_sha coming from the ONE anchor choke point — the writer's own body carries no second anchor literal) and refuses EVERY one of them when it cannot be read (including stale_days one thousandth below the 14-day boundary, while 14.000 itself is accepted — so the threshold is neither always-true nor always-false), takes its liveness reading from the SAME status carrier the AC-203 parser reads and never from \`driver start\`'s exit code (negative control: swapping the right-hand side to the start rc flips the predicate), counts the project's OWN task store through its own ABI with ONE implementation read at both moments (a non-JSON or empty CLI reply is NOT a zero — it prints nothing and returns non-zero), and derives stale_days from the HEAD commit time captured BEFORE the takeover action (GOAL-016 AC-247 本轮新增); and the AC-248 adr-check producer reads a FLIP — the SAME reading (the target project's OWN checker's candidate set, taken by calling that checker's own exported enumerator, never a quay-side 「equivalent」 ADR-007 judgment) at the implementation commit's parent and at the implementation commit itself, both materialized with \`git archive\` into isolated paths so the two runs differ by the fix alone; it writes the record ONLY when the newly-entered tool name (the set difference — empty ⇒ no probe ⇒ no record) is strictly outside the before set and strictly inside the after set, refuses reversed direction / \`0\`-\`1\` / \`\"false\"\` strings / missing fields / bookkeeping-only commit_files / empty probe tool, and its writer body carries ZERO \`true\`/\`false\` literals (the booleans are the two run readings verbatim, emitted as JSON booleans; a single run's exit code is never a criterion field — that is exactly the value that is already green today and therefore carries no information) (GOAL-016 AC-248 本轮新增)"
    rc=0
  else
    echo "selfcheck: FAIL — d1=$d1 d2=$d2 a1=$a1 a2=$a2 ac249_self_ok=$ac249_self_ok p1=$p1 p2=$p2 p3=$p3 p4=$p4 p5=$p5 n1=$n1 n2=$n2 s_ok1=$s_ok1 s_cnt1=$s_cnt1 s_ok2=$s_ok2 s_cnt2=$s_cnt2 c3_e=$c3_e c3_ok=$c3_ok c4_e=$c4_e c4_ok=$c4_ok c5_e=$c5_e c5_ok=$c5_ok m1_ev=$m1_ev m1_reg=$m1_reg m1_ok=$m1_ok m1_leak=$m1_leak m2_ok=$m2_ok m3_ok=$m3_ok m3_leak=$m3_leak m4_reg=$m4_reg m4_rc=$m4_rc ac203_wrote=$ac203_wrote ac203_fields_ok=$ac203_fields_ok ac203_refused=$ac203_refused ac203_parse_alive=$ac203_parse_alive ac203_parse_recs=$ac203_parse_recs ac201_pos_w=$ac201_pos_w ac201_pos_ac=$ac201_pos_ac ac201_neg_w=$ac201_neg_w ac201_neg_lines=$ac201_neg_lines g15_rc=$g15_rc g15_pos=$g15_pos g15_build=$g15_build g16_rc=$g16_rc g16_before=$g16_before g16_after=$g16_after ac206_wrote=$ac206_wrote ac206_fields_ok=$ac206_fields_ok ac206_neg_ok=$ac206_neg_ok ac206_refused=$ac206_refused ac204_wrote=$ac204_wrote ac204_fields_ok=$ac204_fields_ok ac204_refused_fc=$ac204_refused_fc ac204_refused_en=$ac204_refused_en ac205_tc_hit=$ac205_tc_hit ac205_tc_miss=$ac205_tc_miss ac205_wrote=$ac205_wrote ac205_fields_ok=$ac205_fields_ok ac205_ship_refused=$ac205_ship_refused ac205_conf_refused=$ac205_conf_refused ac205_host_refused=$ac205_host_refused ac234_tasks_pos=$ac234_tasks_pos ac234_goals_pos=$ac234_goals_pos ac234_rounds_pos=$ac234_rounds_pos ac234_tasks_neg=$ac234_tasks_neg ac234_goals_neg=$ac234_goals_neg ac234_rounds_neg=$ac234_rounds_neg ac234_wrote=$ac234_wrote ac234_fields_ok=$ac234_fields_ok ac234_refused_zc=$ac234_refused_zc ac234_refused_em=$ac234_refused_em ac232_wrote=$ac232_wrote ac232_fields_ok=$ac232_fields_ok ac232_neg_ok=$ac232_neg_ok ac232_refused=$ac232_refused ac207_wrote=$ac207_wrote ac207_fields_ok=$ac207_fields_ok ac207_refused_pdb=$ac207_refused_pdb ac207_refused_ge=$ac207_refused_ge ac207_refused_bkfiles=$ac207_refused_bkfiles ac207_refused_nofiles=$ac207_refused_nofiles ac207_sel_rc=$ac207_sel_rc ac207_only_rc=$ac207_only_rc ac207_bk_tasks_only=$ac207_bk_tasks_only ac207_impl_marker=$ac207_impl_marker ac207_before=$ac207_before ac207_after_neg=$ac207_after_neg ac207_neg_trace=$ac207_neg_trace ac207_after_pos=$ac207_after_pos ac207_pipe_grep=$ac207_pipe_grep ac240_v1=$ac240_v1 ac240_v0=$ac240_v0 ac240_vdiff=$ac240_vdiff ac240_vne=$ac240_vne ac240_step5_hits=$ac240_step5_hits fn_v_pos=$fn_v_pos fn_w_pos=$fn_w_pos fn_iso_written=$fn_iso_written fn_sent_same=$fn_sent_same fn_v_neg=$fn_v_neg fn_w_neg=$fn_w_neg tp_ok=$tp_ok tp_pos_status=$tp_pos_status tp_pos_launcher=$tp_pos_launcher tp_pos_model=$tp_pos_model tp_pos_auth=$tp_pos_auth tp_neg_status=$tp_neg_status tp_neg_rc=$tp_neg_rc tp_ovr_launcher=$tp_ovr_launcher tp_ovr_model=$tp_ovr_model tp_ovr_auth=$tp_ovr_auth tp_res1=$tp_res1 tp_res2=$tp_res2 bl_ok=$bl_ok bl_reused=$bl_reused bl_adopted=$bl_adopted bl_blocked=$bl_blocked bl_created=$bl_created bl_noline=$bl_noline bl_badrc=$bl_badrc"
    rc=1
  fi
  rm -rf "$tmp"
  return $rc
}

# ── ⑨b AC-249 生产者（GOAL-016）：位置说明（⛔ 不要把本段移回 ⑨ AC-248 附近）────────────────────
# 本段【必须】留在文件靠后的位置：selfcheck 里 AC-248 的【结构】控制 `ac248_seg` 用
#   sed -n '/^ac248_checker_relpath()/,/^# ── ① 安装/p'
# 取「⑨ AC-248 生产者段」并断言其中 `adr-ok|ADR-007` 命中数 = 0（quay 侧不得实现任何等价的 ADR-007
# 判定）。那个区间从 ac248_checker_relpath() 一直延伸到 ① 安装段 —— 【包含了本段原本所在的位置】。
# AC-249 的判据正文逐字要求按路径匹配 `ADR-007`，故本段一旦落在该区间内，AC-248 的结构控制就会
# 读到 9 条命中而取假（2026-09-12 实测：adr007-in-producer-hits 0→9，selfcheck 立刻 FAIL）。
# ⇒ 把本段移到 AC-248 那个区间的【外面】（这里是函数定义区末尾、主流程之前；bash 里顺序无关，
#   首次调用发生在 main 的 dispatch 处）。

# ── ⑨b AC-249 路径谓词（判据正文的两侧，各自单独成函数）─────────────────────────────────────
# criterion 逐字：`any(str(x).startswith(("src/","scripts/")))` ∧ `any(("ADR-007" in str(x)) or
# str(x).startswith("docs/adr"))`。两条谓词在此各成一个函数，criterion 与它是同一组谓词的两侧。
# ⛔ 前缀形态必须是【仓库相对路径原样】：criterion 用 `startswith`，一个 `./` 前缀即恒假
#   （Plan 负控制 c 钉的正是这一条）。
ac249_is_code_path() { case "$1" in src/*|scripts/*) return 0 ;; esac; return 1; }
ac249_is_adr_doc_path() { case "$1" in *ADR-007*|docs/adr*) return 0 ;; esac; return 1; }

# ── ⑨b AC-249 提交并集（同一 task_id 名下【全部】提交触及的文件）──────────────────────────────
# 这是本任务的核心缺陷面：既有 `ac207_select_implementation_commit` 返回【单条】「最新实现提交」，
# 而判据要的是【同一 task_id 下的并集】⇒ 一个把代码与文档拆成两个提交的【完全合格】任务在单条
# 选择器下必然只看到一半（选中文档提交 ⇒ 代码谓词假；选中代码提交 ⇒ 文档谓词假），两个方向都判红
# （硬规则 4c：量的产生处到读取处之间隔了一层「只取一条」的中间层）。
# 归属按【位置】——三条来源，各自都是「提交触及了哪个文件」，⛔ 没有一条读提交信息文本：
#   A) `task/<task_id>` 分支上、不在 develop 里的提交 —— 分支尚未被回收时的主来源；
#   B) 触及 `tasks/<task_id>.md` 的提交 —— fan-in 后分支被删时的补齐（任务文件是【位置】锚）；
#   C) 合并提交（它触及了 `tasks/<task_id>.md`）的右臂 `m^1..m^2` —— 分支被合并掉、merge 提交仍在的形态。
#   D) **任务文件的【存在区间】**：从【首次触及该任务文件】的提交到【最后一次触及】的提交之间的提交。
#      ⚠️ 这条不是锦上添花，是【生产常见形态的必需项】：fan-in 走 `merge --ff-only` 把任务分支落到
#      develop 上（线性推进），随后 worktree/branch 会被 reaper 回收 ⇒ 那时 A) 读不到任何东西，而
#      B) 只抓得到【触及任务文件】的提交 —— 而**实现提交本身不触及任务文件**（实测 TASK-88：两个实现
#      提交 `eeadae3a`/`886f40f4` 都不动 `tasks/TASK-88.md`）⇒ 只剩 `tasks/<id>.md` 一条，判据恒红。
#      区间两端都以任务文件为锚（位置），中间的提交正是该分支以 ff 落入 develop 的那一段。
#      ⛔ 区间有上界（沿用本文件既有的 50 步先例）：超出 ⇒ 该来源【不贡献】并如实留档区间长度，
#      而不是把整段历史吞进来（否则一个被远期提交顺手改过的任务文件会把上千提交算成「它的改动」，
#      并集趋于恒真——那正是本任务要防的恒假的反面）。
# ⛔ 一律 `--no-merges`：merge 提交上 `git show --name-only` 输出为空 ⇒ 会把「任务明明改了代码」
#    读成空并集（硬规则 3b：读不懂输入 ⇒ 伪装成没改）——Plan 的「已知陷阱」第一条。
AC249_SPAN_LIMIT=50                          # D) 区间上界（步数；沿用 AC248_PRE_REV_SPAN 的同一先例）
# 区间状态（D 的来源分类）——【单独成函数】是为了让「区间怎么算」只有一处定义：并集函数与记录里
# 的留档字段都调它（⛔ 不复刻一遍判定，硬规则 4 推论三）。打印 "<verdict> <span> <from>"，
# 其中 <from> 是区间的下界（⛔ 不是 first_touch 自己 —— 区间要【含】它）：
#   span <n> <rev> | too-long <n> <rev> | not-an-ancestor 0 - | unreadable 0 -
# ⚠️ <rev> 用 `first_touch^`；first_touch 是【根提交】时它不存在（一个全新项目的首个任务就是这种
#    形态）⇒ 下界记为 `-`，计数与并集都把 first_touch 自己单独补回来（⛔ 不能因为下界不存在就把
#    整个区间读成空 —— 那正是硬规则 3b 的「读不懂输入 ⇒ 伪装成没有」）。
ac249_span_state() {
  local root="$1" task_id="$2" first_touch last_touch span from=""
  [ -n "$root" ] && [ -n "$task_id" ] || { printf 'unreadable 0 -\n'; return 0; }
  first_touch="$(git -C "$root" log --no-merges --all --reverse --format='%H' -- "tasks/$task_id.md" 2>/dev/null | head -1 || true)"
  last_touch="$(git -C "$root" log --no-merges --all --format='%H' -- "tasks/$task_id.md" 2>/dev/null | head -1 || true)"
  [ -n "$first_touch" ] && [ -n "$last_touch" ] || { printf 'unreadable 0 -\n'; return 0; }
  if ! git -C "$root" merge-base --is-ancestor "$first_touch" "$last_touch" 2>/dev/null; then
    printf 'not-an-ancestor 0 -\n'; return 0
  fi
  if git -C "$root" rev-parse --verify --quiet "${first_touch}^" >/dev/null 2>&1; then
    from="${first_touch}^"
    span="$(git -C "$root" rev-list --count --no-merges "${from}..${last_touch}" 2>/dev/null || true)"
  else
    span="$(git -C "$root" rev-list --count --no-merges "${first_touch}..${last_touch}" 2>/dev/null || true)"
    case "$span" in ''|*[!0-9]*) span=0 ;; esac
    span=$((span + 1))
  fi
  case "$span" in ''|*[!0-9]*) span=0 ;; esac
  if [ "$span" -le "$AC249_SPAN_LIMIT" ]; then printf 'span %s %s\n' "$span" "${from:--}"; else printf 'too-long %s %s\n' "$span" "${from:--}"; fi
}

ac249_union_commit_shas() {
  local root="$1" task_id="$2" branch base m first_touch last_touch span verdict from _span_n
  [ -n "$root" ] && [ -n "$task_id" ] || return 1
  branch="task/$task_id"
  {
    # A) 任务分支上、不在 develop 里的提交（fan-in 前 / 分支尚未被回收）
    if git -C "$root" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null 2>&1; then
      base="$(git -C "$root" merge-base "$branch" develop 2>/dev/null || true)"
      if [ -n "$base" ]; then
        git -C "$root" log --no-merges --format='%H' "${base}..${branch}" 2>/dev/null || true
      else
        git -C "$root" log --no-merges --format='%H' "$branch" 2>/dev/null || true
      fi
    fi
    # B) 触及该任务文件的提交（按位置：看它触及的文件，⛔ 不看提交信息）
    git -C "$root" log --no-merges --all --format='%H' -- "tasks/$task_id.md" 2>/dev/null || true
    # C) 合并掉该分支的 merge 提交（它同样以任务的【文件】为锚）的右臂
    while IFS= read -r m; do
      [ -n "$m" ] || continue
      git -C "$root" log --no-merges --format='%H' "${m}^1..${m}^2" 2>/dev/null || true
    done < <(git -C "$root" log --merges --all --format='%H' -- "tasks/$task_id.md" 2>/dev/null || true)
    # D) 任务文件的存在区间（两端都以任务文件为锚）。区间怎么算【只有一处定义】：ac249_span_state。
    span="$(ac249_span_state "$root" "$task_id")"
    # ⛔ 用 read 取三件读数（⛔ 不 `set --`：那会改写本函数的 $1/$2，是留给下一个改这段的人的雷）
    read -r verdict _span_n from <<< "$span"
    if [ "$verdict" = "span" ]; then
      last_touch="$(git -C "$root" log --no-merges --all --format='%H' -- "tasks/$task_id.md" 2>/dev/null | head -1 || true)"
      if [ "$from" != "-" ]; then
        git -C "$root" log --no-merges --format='%H' "${from}..${last_touch}" 2>/dev/null || true
      else
        first_touch="$(git -C "$root" log --no-merges --all --reverse --format='%H' -- "tasks/$task_id.md" 2>/dev/null | head -1 || true)"
        [ -n "$first_touch" ] && printf '%s\n' "$first_touch"
        git -C "$root" log --no-merges --format='%H' "${first_touch}..${last_touch}" 2>/dev/null || true
      fi
    fi
  } | awk 'NF && !seen[$0]++'
}

# 并集（按【来源顺序】去重，保持各来源内的既有顺序）：每个提交各自的 `git show --name-only`。
# ⚠️ 这里【不】承诺「代码提交在前」这种先后 —— 来源 A 是 `git log` 的默认顺序（新→旧），所以
#    并在最前的是【最新】那条提交的文件。顺序对判定不承重（判据只看集合），故不额外排序。
ac249_union_files() {
  local root="$1" task_id="$2" sha
  [ -n "$root" ] && [ -n "$task_id" ] || return 1
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    ac207_commit_files "$root" "$sha"
  done < <(ac249_union_commit_shas "$root" "$task_id") \
    | awk 'NF && !seen[$0]++'
}

# 读数：把并集拆成「代码面命中」「文档面命中」两份清单（都用【产品谓词】判，⛔ 不另写一套正则）。
ac249_side_hits() {
  local root="$1" task_id="$2" side="$3" f
  [ -n "$root" ] && [ -n "$task_id" ] && [ -n "$side" ] || return 1
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ "$side" = "code" ]; then
      ac249_is_code_path "$f" && printf '%s\n' "$f"
    else
      ac249_is_adr_doc_path "$f" && printf '%s\n' "$f"
    fi
  done < <(ac249_union_files "$root" "$task_id")
}

# ── ⑨b AC-249 记录写（fail-closed，硬规则 3b）──────────────────────────────────────────────
# 经 ac89_append_goal009 统一补 top-level build_sha/ts（AC-214 唯一补锚 choke point）——⛔ 本函数体内
# 不出现 `build_sha` 字面量：多一个补锚点 = 下次改锚格式必漏一处（该 choke point 的注释逐字禁止）。
# 双向 fail-closed：`commit_files` 非空列表 ∧ ≥1 条 `src/`|`scripts/` 前缀 ∧ ≥1 条含 `ADR-007`|
# `docs/adr` 前缀，三条全真才写。任一条为假 ⇒ return 1、⛔ 一条都不写（⛔ 不写「只改了一边」的记录
# 充数——那正是判据要取假的方向）。判据正文与该 node 片段是同一组谓词的两侧，改动须同步。
write_ac249_record() {
  local host="$1" project_root="$2" task_id="$3" commit_files_json="$4" extras_json="${5:-}"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$task_id" ] || return 1
  [ -n "$commit_files_json" ] || return 1
  printf '%s' "$commit_files_json" | "$VC_NODE" --no-warnings -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let f; try { f=JSON.parse(s); } catch { process.exit(2); }
      if (!Array.isArray(f) || f.length===0) process.exit(2);
      const code=f.some(p=>{const x=String(p); return x.startsWith("src/")||x.startsWith("scripts/");});
      const doc =f.some(p=>{const x=String(p); return x.includes("ADR-007")||x.startsWith("docs/adr");});
      process.exit(code&&doc ? 0 : 1);
    });' || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-016-AC-249\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"task_id\":\"$task_id\",\"commit_files\":$commit_files_json${extras_json}"
}

# ── ⑨b AC-249 步骤（GOAL-016-AC-249）──────────────────────────────────────────────────────
# 顺序固定：① 读同一 task_id 名下全部提交的文件并集 → ② 用产品谓词拆出代码面/文档面两份命中 →
# ③ 两侧同时非空才写记录；任一侧为空 ⇒ ⛔ 零记录 + 可区分 `AC249-INCOMPLETE-CHANGE` + 退出非 0；
#    并集读不出 ⇒ ⛔ 零记录 + `AC249-NOT-EVALUATED`（未测量 ≠ 不合格，也⛔ 不写 `commit_files: []`）。
# 三态实测可区分：完整 ⇒ 1 条；只代码 ⇒ 0 条；只文档 ⇒ 0 条（Plan step 3）。
step_ac249_complete_change() {
  local root="$1" extras="" code_list="" doc_list=""
  local -a _ac249_code=() _ac249_doc=()
  echo "== ⑨b AC-249 complete change: the SAME task must touch code AND the ADR-007 doc (one side alone does not count) =="
  if [ "$AC249_COMPLETE_CHANGE" != "1" ]; then
    echo "  not-evaluated: --ac249-complete-change 未传入（未尝试 ≠ 不合格）"
    return 0
  fi
  if [ -z "$root" ] || [ ! -d "$root" ]; then
    AC249_OUTCOME="not-evaluated:target-root-not-a-dir"
    echo "  AC249-NOT-EVALUATED: --target-root 不是目录: ${root:-<empty>}" >&2
    return 0
  fi
  if [ ! -f "$root/.quay/config.yml" ]; then
    AC249_OUTCOME="not-evaluated:target-root-not-a-quay-project"
    echo "  AC249-NOT-EVALUATED: $root 下没有 .quay/config.yml —— 本步骤测的是【被 quay 驱动的存量项目】，不是新装" >&2
    return 0
  fi
  if [ -z "${AC248_TASK_ID_ARG:-}" ]; then
    AC249_OUTCOME="not-evaluated:task-id-absent"
    echo "  AC249-NOT-EVALUATED: --task-id 未传入 ⇒ 不知道该读哪条任务的产出（⛔ 不猜、不取最新一条）" >&2
    return 0
  fi
  AC249_ROOT="$root"
  AC249_HOST="$(hostname 2>/dev/null || echo '')"
  AC249_PROJECT_ROOT="$(cd "$root" && pwd -P)"
  AC249_TASK_ID="$AC248_TASK_ID_ARG"
  echo "  [⑨b] host=$AC249_HOST project_root=$AC249_PROJECT_ROOT task_id=$AC249_TASK_ID"
  mapfile -t _ac249_shas < <(ac249_union_commit_shas "$root" "$AC249_TASK_ID")
  AC249_UNION_SHAS=""
  [ "${#_ac249_shas[@]}" -gt 0 ] && printf -v AC249_UNION_SHAS '%s\n' "${_ac249_shas[@]}"
  mapfile -t _ac249_files < <(ac249_union_files "$root" "$AC249_TASK_ID")
  mapfile -t _ac249_code < <(ac249_side_hits "$root" "$AC249_TASK_ID" code)
  mapfile -t _ac249_doc < <(ac249_side_hits "$root" "$AC249_TASK_ID" doc)
  code_list=""
  doc_list=""
  [ "${#_ac249_code[@]}" -gt 0 ] && printf -v code_list '%s\n' "${_ac249_code[@]}"
  [ "${#_ac249_doc[@]}" -gt 0 ] && printf -v doc_list '%s\n' "${_ac249_doc[@]}"
  AC249_CODE_HITS="$code_list"
  AC249_DOC_HITS="$doc_list"
  AC249_SPAN_STATE="$(ac249_span_state "$root" "$AC249_TASK_ID")"
  echo "  [⑨b] 任务文件存在区间（来源 D，两端以任务文件为锚）: ${AC249_SPAN_STATE} (span | too-long:<n> | not-an-ancestor | unreadable；超出上界 ${AC249_SPAN_LIMIT} ⇒ 该来源不贡献，fail-CLOSED)"
  echo "  [⑨b] 并集来源提交数=${#_ac249_shas[@]}（按位置：task/$AC249_TASK_ID 分支 ∪ 触及 tasks/$AC249_TASK_ID.md 的提交 ∪ 其 merge 右臂；⛔ 不是「最新一条提交」）"
  echo "  [⑨b] 并集文件数=${#_ac249_files[@]}: $("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_files[@]}" 2>/dev/null || true)"
  echo "  [⑨b] 代码面命中（src/|scripts/ 前缀）计入 ${#_ac249_code[@]} 条；前 3 条实际内容（引用计数前先打印命中原文，硬规则 2）:"
  if [ "${#_ac249_code[@]}" -gt 0 ]; then printf '%s\n' "${_ac249_code[@]}" | head -3 | sed 's/^/        | /'; else echo "        | <none>"; fi
  echo "  [⑨b] 文档面命中（含 ADR-007 | docs/adr 前缀）计入 ${#_ac249_doc[@]} 条；前 3 条实际内容:"
  if [ "${#_ac249_doc[@]}" -gt 0 ]; then printf '%s\n' "${_ac249_doc[@]}" | head -3 | sed 's/^/        | /'; else echo "        | <none>"; fi

  if [ "${#_ac249_shas[@]}" = "0" ] || [ "${#_ac249_files[@]}" = "0" ]; then
    AC249_OUTCOME="not-evaluated:commit-union-unreadable"
    echo "  [⑨b] AC249-NOT-EVALUATED: 并集读不出（该任务没有提交 / 两条归属路径都空 / git 读失败）⇒ ⛔ 不写记录（未测量 ≠ 不合格；⛔ 不写 commit_files: []）" >&2
    return 0
  fi
  AC249_COMMIT_FILES_JSON="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_files[@]}" 2>/dev/null || true)"
  if [ -z "$code_list" ] || [ -z "$doc_list" ]; then
    local side="code-side-missing"
    [ -n "$code_list" ] || side="code-side-missing"
    [ -n "$doc_list" ] || side="doc-side-missing"
    [ -z "$code_list" ] && [ -z "$doc_list" ] && side="both-sides-missing"
    AC249_OUTCOME="incomplete-change:$side"
    echo "  [⑨b] AC249-INCOMPLETE-CHANGE ($side): 代码面命中=${#_ac249_code[@]} 文档面命中=${#_ac249_doc[@]} ⇒ ⛔ 零记录" >&2
    echo "        ⛔ 特别是没有写出一条「只改了一边」的记录：那正是判据要求取假的方向（单边不算）" >&2
    return 0
  fi
  extras="$(AC249_S="$AC249_UNION_SHAS" AC249_C="$code_list" AC249_D="$doc_list" python3 -c '
import json, os
def lst(s):
    return [x for x in (s or "").split("\n") if x.strip()]
e = [("ac249_union_commit_shas", lst(os.environ["AC249_S"])),
     ("ac249_code_paths", lst(os.environ["AC249_C"])),
     ("ac249_doc_paths", lst(os.environ["AC249_D"]))]
print("," + ",".join(json.dumps(k) + ":" + json.dumps(v) for k, v in e))
' 2>/dev/null || true)"
  if write_ac249_record "$AC249_HOST" "$AC249_PROJECT_ROOT" "$AC249_TASK_ID" "$AC249_COMMIT_FILES_JSON" "$extras"; then
    AC249_EVALUATED=1
    AC249_OUTCOME="ok"
    AC249_WRITTEN_THIS_RUN=1
    AC249_WRITTEN_ROOT="$AC249_PROJECT_ROOT"
    echo "  [⑨b] ac249 record written → $AC89 ✓ (task_id=$AC249_TASK_ID 并集 ${#_ac249_files[@]} 条; 代码面 ${#_ac249_code[@]} 条 / 文档面 ${#_ac249_doc[@]} 条)"
  else
    AC249_OUTCOME="not-evaluated:write-refused"
    echo "  [⑨b] AC249-NOT-EVALUATED: record NOT written (fail-closed: BUILD_SHA missing/non-40-hex 或 AC89 路径空 或 并集不满足双向谓词 —— 缺值≠合格)" >&2
  fi
  return 0
}

# ── selfcheck_ac249 — hermetic controls of the AC-249 complete-change producer ────────────────
# 每条都直接驱动【产品函数】（write_ac249_record / ac249_union_files / ac249_is_*_path），⛔ 不让夹具
# 复刻判定逻辑（硬规则 4 推论三：只能被夹具复刻满足的判据不算被测）。留档七组读数：
#   ① 正（**本任务缺陷面的守门人**）：同一 task 名下【两个提交】，代码提交在前、文档提交在后
#      （最新那条是文档）⇒ 产品【并集】写出 1 条；同一夹具下 ac207_select_implementation_commit
#      （既有「只取一条」选择器）选中的是【文档提交】⇒ 用它的文件写【写不出】。两条读数并列留档。
#      ⛔ 没有这一条，一个「只取最新一条提交」的实现会绿着通过全部正控制。
#   ② 负（只代码）：并集只含 `scripts/`|`src/` ⇒ 零记录（载体行数不变）+ incomplete-change 痕迹。
#   ③ 负（只文档）：并集只含 ADR-007 ⇒ 零记录 + incomplete-change 痕迹。
#   ④ 负（路径形态）：`./src/x.ts` 形态 ⇒ 判定函数取假 ⇒ 零记录（证明 criterion 的 startswith 分支
#      真的在作用，⛔ 不是「反正都会绿」）。
#   ⑤ 负（缺值 ≠ 不合格）：并集读不出（无该任务的任何提交）⇒ 零记录 + NOT-EVALUATED 痕迹（可区分）。
#   ⑥ 结构性（按位置）：写入器体内无 `build_sha` 字面量（唯一补锚点是 ac89_append_goal009）、
#      且写入路径 ⛔ 不调用单条选择器来构造 commit_files；并集函数 ⛔ 不用 merge 提交的差分。
selfcheck_ac249() {
  local ac249_tmp ac249_fx ac249_code_fx ac249_doc_fx ac249_sel_sha ac249_carrier ac249_rc=0
  local ac249_save_sha="${BUILD_SHA:-}" ac249_save_ts="${TS:-}" ac249_save_ac89="${AC89:-}"
  local ac249_pos_w="" ac249_pos_sel_w="" ac249_pos_sel_files="" ac249_pos_before=0 ac249_pos_after=0
  local ac249_code_w="" ac249_code_before=0 ac249_code_after=0 ac249_code_trace=0
  local ac249_doc_w="" ac249_doc_before=0 ac249_doc_after=0 ac249_doc_trace=0
  local ac249_form_w="" ac249_form_before=0 ac249_form_after=0 ac249_form_pred=""
  local ac249_miss_w="" ac249_miss_before=0 ac249_miss_after=0 ac249_miss_trace=0 ac249_files_missing=""
  local ac249_files_pos="" ac249_files_code="" ac249_files_doc=""
  local ac249_writer_body="" ac249_union_body="" ac249_writer_anchor=0 ac249_writer_sel=0 ac249_union_nomerges=0
  ac249_tmp="$(mktemp -d 2>/dev/null || true)"
  if [ -z "$ac249_tmp" ]; then
    echo "selfcheck: ac249-tmp-unavailable (⛔ 不静默跳过——夹具造不出时本组读数一律取假)"
    return 1
  fi
  ac249_carrier="$ac249_tmp/carrier.jsonl"
  : > "$ac249_carrier"
  # 夹具：一个 develop 仓库 + 一条 task/T-1 分支（登记提交在 develop、代码与文档两个提交在分支上）
  ac249_fx="$ac249_tmp/repo"
  mkdir -p "$ac249_fx/tasks" "$ac249_fx/.quay"
  git -C "$ac249_fx" init -q -b develop >/dev/null 2>&1
  git -C "$ac249_fx" config user.email t@t >/dev/null 2>&1
  git -C "$ac249_fx" config user.name t >/dev/null 2>&1
  printf 'init\n' > "$ac249_fx/.gitignore"
  git -C "$ac249_fx" add -A >/dev/null 2>&1
  git -C "$ac249_fx" commit -qm "chore(quay-init): initialize quay project files" >/dev/null 2>&1
  printf 'id: T-1\ntitle: t\nstatus: ready\n---\n## Proposal\nx\n' > "$ac249_fx/tasks/T-1.md"
  git -C "$ac249_fx" add -A >/dev/null 2>&1
  git -C "$ac249_fx" commit -qm "tasks: T-1 registration" >/dev/null 2>&1
  git -C "$ac249_fx" checkout -q -b task/T-1 >/dev/null 2>&1
  mkdir -p "$ac249_fx/scripts"
  printf 'code\n' > "$ac249_fx/scripts/check-adr.ts"
  git -C "$ac249_fx" add -A >/dev/null 2>&1
  git -C "$ac249_fx" commit -qm "fix(adr): code side first" >/dev/null 2>&1
  mkdir -p "$ac249_fx/quay-adr"
  printf 'doc\n' > "$ac249_fx/quay-adr/ADR-007.md"
  git -C "$ac249_fx" add -A >/dev/null 2>&1
  git -C "$ac249_fx" commit -qm "docs(adr): doc side last" >/dev/null 2>&1
  git -C "$ac249_fx" checkout -q develop >/dev/null 2>&1
  mapfile -t _ac249_fx_files < <(ac249_union_files "$ac249_fx" T-1)
  ac249_files_pos="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_fx_files[@]}" 2>/dev/null || true)"
  BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  TS="2026-09-12T00:00:00Z"
  AC89="$ac249_carrier"
  # ① 正：并集写出 1 条
  ac249_pos_before="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  ac249_pos_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "T-1" "$ac249_files_pos" 2>/dev/null && echo 1 || echo 0)"
  ac249_pos_after="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  # ①b 守门人：同一夹具下用【单条】选择器（最新那条 = 文档提交）⇒ 用它的文件写【写不出】
  ac249_sel_sha="$(ac207_select_implementation_commit "$ac249_fx" || true)"
  if [ -n "$ac249_sel_sha" ]; then
    mapfile -t _ac249_sel_files < <(ac207_commit_files "$ac249_fx" "$ac249_sel_sha")
    ac249_pos_sel_files="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_sel_files[@]}" 2>/dev/null || true)"
    ac249_pos_sel_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "T-1" "$ac249_pos_sel_files" 2>/dev/null && echo 1 || echo 0)"
  fi
  # ② 负：只代码（夹具必须走【同一个归属机制】：登记提交落在 develop、改动提交落在 task/T-1 分支上）
  ac249_code_fx="$ac249_tmp/codeonly"
  mkdir -p "$ac249_code_fx/tasks" "$ac249_code_fx/.quay"
  git -C "$ac249_code_fx" init -q -b develop >/dev/null 2>&1
  git -C "$ac249_code_fx" config user.email t@t >/dev/null 2>&1
  git -C "$ac249_code_fx" config user.name t >/dev/null 2>&1
  printf 'id: T-1\n' > "$ac249_code_fx/tasks/T-1.md"
  git -C "$ac249_code_fx" add -A >/dev/null 2>&1
  git -C "$ac249_code_fx" commit -qm "tasks: T-1 registration" >/dev/null 2>&1
  git -C "$ac249_code_fx" checkout -q -b task/T-1 >/dev/null 2>&1
  mkdir -p "$ac249_code_fx/src"; printf 'x\n' > "$ac249_code_fx/src/a.ts"
  git -C "$ac249_code_fx" add -A >/dev/null 2>&1
  git -C "$ac249_code_fx" commit -qm "fix: code only" >/dev/null 2>&1
  git -C "$ac249_code_fx" checkout -q develop >/dev/null 2>&1
  mapfile -t _ac249_code_files < <(ac249_union_files "$ac249_code_fx" T-1)
  ac249_files_code="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_code_files[@]}" 2>/dev/null || true)"
  ac249_code_before="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  ac249_code_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "T-1" "$ac249_files_code" 2>/dev/null && echo 1 || echo 0)"
  ac249_code_after="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  # ③ 负：只文档（同上：登记提交在 develop、文档提交在 task/T-1 分支上）
  ac249_doc_fx="$ac249_tmp/doconly"
  mkdir -p "$ac249_doc_fx/tasks" "$ac249_doc_fx/.quay"
  git -C "$ac249_doc_fx" init -q -b develop >/dev/null 2>&1
  git -C "$ac249_doc_fx" config user.email t@t >/dev/null 2>&1
  git -C "$ac249_doc_fx" config user.name t >/dev/null 2>&1
  printf 'id: T-1\n' > "$ac249_doc_fx/tasks/T-1.md"
  git -C "$ac249_doc_fx" add -A >/dev/null 2>&1
  git -C "$ac249_doc_fx" commit -qm "tasks: T-1 registration" >/dev/null 2>&1
  git -C "$ac249_doc_fx" checkout -q -b task/T-1 >/dev/null 2>&1
  mkdir -p "$ac249_doc_fx/quay-adr"; printf 'x\n' > "$ac249_doc_fx/quay-adr/ADR-007.md"
  git -C "$ac249_doc_fx" add -A >/dev/null 2>&1
  git -C "$ac249_doc_fx" commit -qm "docs: doc only" >/dev/null 2>&1
  git -C "$ac249_doc_fx" checkout -q develop >/dev/null 2>&1
  mapfile -t _ac249_doc_files < <(ac249_union_files "$ac249_doc_fx" T-1)
  ac249_files_doc="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_doc_files[@]}" 2>/dev/null || true)"
  ac249_doc_before="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  ac249_doc_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "T-1" "$ac249_files_doc" 2>/dev/null && echo 1 || echo 0)"
  ac249_doc_after="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  # ④ 负：路径形态（`./src/...`）——判定函数取假 ⇒ 写不出（criterion 的 startswith 分支真在作用）
  ac249_is_code_path "./src/a.ts" && ac249_form_pred=1 || ac249_form_pred=0
  ac249_form_before="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  ac249_form_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "T-1" '["./src/a.ts","quay-adr/ADR-007.md"]' 2>/dev/null && echo 1 || echo 0)"
  ac249_form_after="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  # ⑤ 负：缺值（无该任务的任何提交 ⇒ 并集读不出）
  ac249_miss_before="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  mapfile -t _ac249_miss_files < <(ac249_union_files "$ac249_code_fx" NO-SUCH-TASK)
  ac249_files_missing="$("$VC_NODE" --no-warnings -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${_ac249_miss_files[@]}" 2>/dev/null || true)"
  ac249_miss_w="$(write_ac249_record "hostX-arm" "/home/other/archguard" "NO-SUCH-TASK" "$ac249_files_missing" 2>/dev/null && echo 1 || echo 0)"
  ac249_miss_after="$(wc -l < "$ac249_carrier" | tr -d ' ')"
  # ⑥ 结构性（按位置）
  ac249_writer_body="$(sed -n '/^write_ac249_record()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
  ac249_union_body="$(sed -n '/^ac249_union_commit_shas()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//')"
  ac249_writer_anchor="$(printf '%s\n' "$ac249_writer_body" | grep -c 'build_sha' || true)"
  ac249_writer_sel="$(printf '%s\n' "$ac249_writer_body" | grep -c 'ac207_select_implementation_commit' || true)"
  ac249_union_nomerges="$(printf '%s\n' "$ac249_union_body" | grep -c -- '--no-merges' || true)"
  # 痕迹判定：三组负控制都必须【零新增】且各自的取值互不相同
  [ "$ac249_pos_w" = "1" ] && [ "$ac249_pos_after" = "1" ] && [ "$ac249_pos_before" = "0" ] || ac249_rc=1
  [ "$ac249_pos_sel_w" = "0" ] || ac249_rc=1
  [ "$ac249_code_w" = "0" ] && [ "$ac249_code_after" = "$ac249_code_before" ] || { ac249_rc=1; ac249_code_trace=1; }
  [ "$ac249_doc_w" = "0" ] && [ "$ac249_doc_after" = "$ac249_doc_before" ] || { ac249_rc=1; ac249_doc_trace=1; }
  [ "$ac249_form_w" = "0" ] && [ "$ac249_form_after" = "$ac249_form_before" ] || ac249_rc=1
  [ "$ac249_miss_w" = "0" ] && [ "$ac249_miss_after" = "$ac249_miss_before" ] || { ac249_rc=1; ac249_miss_trace=1; }
  [ "$ac249_form_pred" = "0" ] || ac249_rc=1
  [ "$ac249_writer_anchor" = "0" ] && [ "$ac249_writer_sel" = "0" ] || ac249_rc=1
  [ "$ac249_union_nomerges" -ge 1 ] 2>/dev/null || ac249_rc=1
  BUILD_SHA="$ac249_save_sha"; TS="$ac249_save_ts"; AC89="$ac249_save_ac89"
  echo "selfcheck: ac249-union(multi-commit same task) files=$ac249_files_pos wrote=$ac249_pos_w lines=${ac249_pos_before}->${ac249_pos_after} (expect 3 files incl. scripts/check-adr.ts + quay-adr/ADR-007.md, 1, 0->1)"
  echo "selfcheck: ac249-single-commit-selector(reference impl) files=$ac249_pos_sel_files wrote=$ac249_pos_sel_w (expect a DOC-ONLY file list and 0 — 「只取最新一条」的退化写法在完全合格的夹具上写不出；并集写法能写出 ⇒ 两条读数可区分)"
  echo "selfcheck: ac249-negative(code-only) files=$ac249_files_code wrote=$ac249_code_w lines=${ac249_code_before}->${ac249_code_after} (expect a code-side file list and 0, lines unchanged — 单边不算)"
  echo "selfcheck: ac249-negative(doc-only) files=$ac249_files_doc wrote=$ac249_doc_w lines=${ac249_doc_before}->${ac249_doc_after} (expect an ADR-007 file list and 0, lines unchanged — 单边不算)"
  echo "selfcheck: ac249-negative(dot-slash-form) pred_is_code=$ac249_form_pred wrote=$ac249_form_w lines=${ac249_form_before}->${ac249_form_after} (expect 0/0/0->0 — startswith 分支真在作用)"
  echo "selfcheck: ac249-negative(missing-union) files=$ac249_files_missing wrote=$ac249_miss_w lines=${ac249_miss_before}->${ac249_miss_after} (expect []/0/0->0 — 未测量 ≠ 不合格)"
  echo "selfcheck: ac249-writer-anchor-hits=$ac249_writer_anchor writer-single-selector-hits=$ac249_writer_sel union-no-merges-hits=$ac249_union_nomerges (expect 0/0/>=1 — 唯一补锚点; 并集不走单条选择器; 并集排除 merge 差分)"
  rm -rf "$ac249_tmp"
  return $ac249_rc
}

if [ "$DO_SELFCHECK" = 1 ]; then
  selfcheck
  exit $?
fi

# ── AC-250 观察面模式（GOAL-016）─────────────────────────────────────────────────────────
# 独立于下面的主流程：本模式【不跑 step①】（它观测的是目标机上已安装的产物，而 step① 装的是判读侧的
# 前缀 —— 与「目标机上那个 web 绑了什么地址」无关），也不跑冷启动/驱动活性段。它只做一件事：
# 在目标机上起一个绑其 tailscale0 的 serve，由【本机】探测、读同一任务的两点渲染状态、直接读目标 store
# 交叉核对，九件全有效才经 ac89_append_goal009 choke point 写一条 ac=GOAL-016-AC-250 记录。
# 判定与 AC-247/AC-248 同一条纪律：任缺 ⇒ 不写 + 可区分 NOT-EVALUATED + 退出非 0（⛔ 不降级成 not-live，
# 那会让一次「没产出」的运行与「产出但没达标」同形）。
if [ "$AC250_WEB_OBSERVE" = 1 ]; then
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -z "$EVIDENCE" ]; then EVIDENCE="${CWD}/.quay/verify-deliver-evidence.json"; fi
  if [ -z "$AC89" ]; then AC89="${CWD}/.quay/productization-verification.jsonl"; fi
  echo "== verify-deliver-coldstart (AC-250 观察面模式) =="
  echo "ts=$TS | ac89=$AC89 | ssh=$AC250_SSH | target-root=$AC250_ROOT | port=$AC250_PORT | window=${AC250_WINDOW}s"
  step_ac250_web_observe
  echo ""
  echo "AC250_OUTCOME=$AC250_OUTCOME (ok | no-change | not-evaluated:<why> —— 后两者都不写记录，且取值不同)"
  echo "AC250_EVALUATED=$AC250_EVALUATED (1 = 九件读数全取到；⛔ 与 ok 不同形)"
  echo "AC250_HOST=${AC250_HOST:-<unreadable>}"
  echo "AC250_PROBE_FROM_HOST=${AC250_PROBE_FROM_HOST:-<unreadable>} (⛔ 必须 ≠ AC250_HOST)"
  echo "AC250_BIND_HOST=${AC250_BIND_HOST:-<unreadable>} == AC250_TAILSCALE0_IP=${AC250_TAILSCALE0_IP:-<unreadable>}"
  echo "AC250_HTTP_STATUS_T2=${AC250_HTTP_STATUS_T2:-<unreadable>}"
  echo "AC250_OBSERVED_TASK_ID=${AC250_OBSERVED_TASK_ID:-<unreadable>} ${AC250_BEFORE:-<none>}→${AC250_AFTER:-<none>} store=${AC250_STORE_STATUS_AFTER:-<unreadable>} (${AC250_STORE_SOURCE:-<unreadable>})"
  echo "AC250_WRITTEN_THIS_RUN=$AC250_WRITTEN_THIS_RUN"
  if [ "$AC250_OUTCOME" = "ok" ]; then
    echo "verify-deliver-coldstart: done (AC250_OUTCOME=ok)"
    exit 0
  fi
  echo "verify-deliver-coldstart: FAIL (AC250_OUTCOME=$AC250_OUTCOME — 未测量 ≠ 不合格，且两者都不写记录)" >&2
  exit 1
fi

# ── 主流程 ─────────────────────────────────────────────────────────────────────────────
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== verify-deliver-coldstart (AC88 三步验证机制) =="
echo "ts=$TS | project=$PROJECT | root=$ROOT | prefix=$PREFIX | wait=${WAIT}s | liveness_window=${LIVENESS_WINDOW}min"

# 证据/记录载体默认路径提前解析（step④ AC-203 / step⑤ AC-207 记录写进同一载体，需在步骤运行前拿到路径）。
if [ -z "$EVIDENCE" ]; then EVIDENCE="${CWD}/.quay/verify-deliver-evidence.json"; fi
if [ -z "$AC89" ]; then AC89="${CWD}/.quay/productization-verification.jsonl"; fi

AC88_VERIFY=fail
if [ "$VERIFY_ONLY" = 1 ]; then
  # 只重验③（冷启动活性）；①②由调用方声明已验。--root 必须已存在。
  if [ ! -d "$ROOT" ]; then echo "ERROR: --verify-only requires an existing --root ($ROOT)" >&2; exit 2; fi
  STEP1_OK=1; STEP2_OK=1
  echo "verify-only: ①② assumed verified (re-verifying step ③ against $ROOT)"
  step3_coldstart
else
  # AC5 主路径：该次验证自己从 develop-tip 现 build（给出 --build-root 时）
  if [ -n "$BUILD_ROOT" ]; then
    if ! build_from_develop_tip "$BUILD_ROOT"; then
      echo "AC88_VERIFY=fail (build from develop-tip failed)"
      exit 1
    fi
  fi
  if [ -z "$QUAY_TGZ" ] || [ -z "$QN_TGZ" ]; then
    echo "ERROR: --tgz <quay.tgz> and --tgz-native <quay-native.tgz> are required (package.sh 产物), or pass --build-root <repo> to self-build from develop-tip." >&2
    exit 2
  fi
  for f in "$QUAY_TGZ" "$QN_TGZ"; do
    [ -f "$f" ] || { echo "ERROR: missing .tgz file: $f" >&2; exit 2; }
  done
  QUAY_TGZ="$(readlink -f "$QUAY_TGZ")"
  QN_TGZ="$(readlink -f "$QN_TGZ")"
  if [ -z "$ROOT" ]; then ROOT="${HOME}/quay-verify-coldstart/${PROJECT}"; fi
  ROOT="$(readlink -f "$ROOT" 2>/dev/null || echo "$ROOT")"
  if [ -z "$WORKTREE_ROOT" ]; then WORKTREE_ROOT="${ROOT}/../${PROJECT}-worktrees"; fi
  if [ -z "$PREFIX" ]; then PREFIX="${ROOT}.npm"; fi
  if [ -z "$TEST_CMD" ]; then TEST_CMD="node --test"; fi
  if [ -z "$TMUX_SESSION" ]; then TMUX_SESSION="${PROJECT}-0:0.0"; fi
  echo "tgz=$(basename "$QUAY_TGZ") | tgz-native=$(basename "$QN_TGZ")"
  # AC5 证据在装之前计算（sha256 需要 tgz 文件在）
  ac5_evaluate
  if ! step1_install; then
    echo "AC88_VERIFY=fail (step ① install failed)"
    exit 1
  fi
  if [ "$UPGRADE_EXISTING" = 1 ]; then
    # ── AC-238（GOAL-009）：既有旧痕迹项目的升级路径 —— 与 ② 的「rm -rf 后全新 quay-init」是两条
    # 本质不同的路径（GOAL-009 已有 9 条 AC 的证据全在 ② 那条上）。本分支只跑 ⑦，不跑冷启动/驱动活性段
    # （那些测的是「新项目能不能被驱动」，不是「既有项目能不能被接管」）。
    step_upgrade_existing "$ROOT"
    # ⑦b AC-239：升级【后】的动态闭环。⛔ 只在 ⑦ 已经在这个 root 上评估通过时才可能写记录——该门
    # 在 step_upgrade_drive_continue 内部（它读 AC238_EVALUATED/AC238_PROJECT_ROOT），此处不重复判定。
    if [ "$AC239_E2E" = "1" ]; then
      step_upgrade_drive_continue "$ROOT"
    fi
  elif [ "$AC247_TAKEOVER" = 1 ]; then
    # ── AC-247（GOAL-016）：接管停摆 ≥14 天的存量项目（⛔ 与 ② 的「rm -rf 后全新 quay-init」是两条
    # 本质不同的路径：那条的 $ROOT 是一次性靶子，本条的被接管项目【本来就带着真实存量与旧历史】）。
    # 本分支只跑 ⑧（它自己在门口读 pre、起 driver、读 status、重读 post），⛔ 不跑冷启动/驱动活性段。
    step_ac247_takeover "$AC247_ROOT"
  elif [ "$AC248_ADR_FLIP" = 1 ] || [ "$AC249_COMPLETE_CHANGE" = 1 ]; then
    # ── AC-248 / AC-249（GOAL-016）：同一趟里读【同一条被驱动任务】的两条独立读数。与 ⑧ 同形：只跑 ⑨/⑨b
    # （各自读自己的直接量），⛔ 不跑冷启动/驱动活性段，也 ⛔ 不驱动任何任务——被取证的那条任务是由
    # 【目标项目自己的 drivers】驱动出来的，本步骤只读它的产物。
    #   · AC-248 判「修对了」（目标项目自己的检查器的检出行为前后翻转）；
    #   · AC-249 判「修全了」（同一 task 名下 commit_files 并集里代码面与 ADR-007 文档面同时非空）。
    # 两条各自能独立 pass/fail，⛔ 不互相冒充；任一为假只影响它自己的那条记录（各写各的）。
    # ⛔ 顺序固定（先 ⑨ 后 ⑨b）：两条共用 --target-root/--task-id，先跑的那条不改任何共用状态
    #    （AC-248 只写自己的 AC248_* 变量，AC-249 只写 AC249_*），顺序在此只是可读性，不是依赖。
    if [ "$AC248_ADR_FLIP" = 1 ]; then
      step_ac248_adr_flip "$AC248_ROOT"
    fi
    if [ "$AC249_COMPLETE_CHANGE" = 1 ]; then
      step_ac249_complete_change "$AC248_ROOT"
    fi
  elif [ "$CHANNEL" = "marketplace" ]; then
    # marketplace 通道 = step① 安装路径验证（register-plugin.mjs 注册）；②③ 是 loop 活性验证
    # （npm-global/AC88 的关切），marketplace 通道不跑 ②③ —— register 失败也能写出记录（AC5），
    # 不被 ② quay-init 的失败吞掉 marketplace 结果。
    step1_marketplace
    # AC-161/AC3：段① 的完整窗口 = install + marketplace 注册；在此收尾（install 内已收过一次，
    # 此处把窗口延长到注册段结束）。两次都读同一文件，读数取更晚的一次。
    step1_guard_end
    echo "STEP1_REAL_SETTINGS_EVALUATED=$STEP1_REAL_SETTINGS_EVALUATED STEP1_REAL_SETTINGS_UNCHANGED=$STEP1_REAL_SETTINGS_UNCHANGED (AC-161/AC3: 段① 全程对操作者真实 ~/.claude/settings.json 零写入)"
  else
    if ! step2_init; then
      echo "AC88_VERIFY=fail (step ② quay-init failed)"
      exit 1
    fi
    # 配置目标项目 profiles（单一真相源 = 驱动方 profiles worker-default / CLI 覆盖）——
    # 让目标项目在该宿主上真的能起 worker。not-configured 是可区分取值（硬规则 3b），⛔ 不静默跳过；
    # 非 0 返回只置 TARGET_PROFILES_STATUS（不 crash，缺配置由后续 ③ 冷启动的 worker 秒死如实暴露）。
    configure_target_profiles "$ROOT" "$(resolve_driving_profiles || true)" "$TARGET_LAUNCHER" "$TARGET_MODEL" "$TARGET_AUTH" || true
    step_ac204_forbidden_surface "$ROOT"
    step3_coldstart
    step4_driver_liveness "$ROOT"
    step5_dual_carrier "$ROOT"
    # AC-234 只渲染【别的步骤真实写进去的】载体内容（DoD：⛔ 不在 AC-234 步骤内自造渲染内容）。
    # 三个来源必须在读 web 之前落盘：goal（AC-232）、task（task carrier）、round（round carrier）。
    step_ac232_goal_carrier_write "$ROOT"
    step_task_carrier_write "$ROOT"
    step_round_carrier_write "$ROOT"
    step_ac234_web_render "$ROOT"
    if [ "$AC205_SESSION" = "1" ]; then
      step_ac205_session_delivery "$ROOT"
    fi
    if [ "$AC207_E2E" = "1" ]; then
      step5_e2e "$ROOT"
    fi
  fi
fi

# ── 判定 ─────────────────────────────────────────────────────────────────────────────
if [ "$UPGRADE_EXISTING" = 1 ]; then
  # AC-238 判定：install 成功 ∧ 四件读数全成立。AC238_EVALUATED=0 是「未评估」（缺值），与
  # 「评估了且不合格」区分开（硬规则 3b）——留 not-live，不谎报 ok、也不谎报 fail。
  if [ "$STEP1_OK" = 1 ] && [ "$AC238_EVALUATED" = 1 ]; then
    AC88_VERIFY=ok
  elif [ "$STEP1_OK" = 1 ]; then
    AC88_VERIFY=not-live
  else
    AC88_VERIFY=fail
  fi
elif [ "$AC247_TAKEOVER" = 1 ]; then
  # AC-247 判定：安装段成功 ∧ 八件读数全成立并已写出记录。AC247_EVALUATED=0 是「未评估」（缺值），
  # 与「评估了且不合格」区分开（硬规则 3b）——但本条的两者都【不是 ok】：AC-247 的 Plan 逐字要求
  # 「任缺 ⇒ 不写 + 打印可区分的 NOT-EVALUATED + 退出非 0」，故非 ok 即 fail（⛔ 不降级成 not-live，
  # 那会让一个没产出的运行看起来与「产出但没达标」同形）。
  if [ "$STEP1_OK" = 1 ] && [ "$AC247_EVALUATED" = 1 ]; then
    AC88_VERIFY=ok
  else
    AC88_VERIFY=fail
  fi
elif [ "$AC248_ADR_FLIP" = 1 ]; then
  # AC-248 判定：与 ⑧ 同一条纪律——安装段成功 ∧ 十一件读数全成立并已写出记录。AC248_EVALUATED=0 是
  # 「未评估」（缺值），但本条两者都【不是 ok】（Plan 逐字：任缺 ⇒ 不写 + 可区分 NOT-EVALUATED + 退出非 0）。
  if [ "$STEP1_OK" = 1 ] && [ "$AC248_EVALUATED" = 1 ]; then
    AC88_VERIFY=ok
  else
    AC88_VERIFY=fail
  fi
elif [ "$CHANNEL" = "marketplace" ]; then
  # marketplace 通道判定：分支跑了（MP_EVALUATED=1）且 install 成功 = 机制成功；MP_SETTINGS_OK 是【数据】
  # （注册成功=1 / 注册失败=0 均如实记录，AC5），不是控制流失败。
  if [ "$MP_EVALUATED" = "1" ] && [ "$STEP1_OK" = "1" ]; then
    AC88_VERIFY=ok
  else
    AC88_VERIFY=fail
  fi
elif [ "$VERIFY_ONLY" = 1 ]; then
  # 只重验③：AC5 证据已在全量跑时记录；此处不再要求 AC5（缺 tgz 无法重算 sha256）。
  if [ "$STEP1_OK" = 1 ] && [ "$STEP2_OK" = 1 ] && [ "$L1_OK" = 1 ] && [ "$L2_OK" = 1 ]; then
    AC88_VERIFY=ok
  elif [ "$STEP1_OK" = 1 ] && [ "$STEP2_OK" = 1 ] && [ "$L1_OK" = 1 ]; then
    AC88_VERIFY=not-live
  else
    AC88_VERIFY=fail
  fi
elif [ "$STEP1_OK" = 1 ] && [ "$STEP2_OK" = 1 ] && [ "$L1_OK" = 1 ] && [ "$L2_OK" = 1 ] && [ "$AC5_OK" = 1 ]; then
  AC88_VERIFY=ok
elif [ "$STEP1_OK" = 1 ] && [ "$STEP2_OK" = 1 ] && [ "$L1_OK" = 1 ]; then
  AC88_VERIFY=not-live
else
  AC88_VERIFY=fail
fi

echo ""
echo "STEP1_OK=$STEP1_OK"
echo "STEP2_OK=$STEP2_OK"
echo "TARGET_PROFILES_STATUS=$TARGET_PROFILES_STATUS (configured | not-configured — 缺输入 ≠ 配置好了, 硬规则 3b)"
echo "TARGET_PROFILES_LAUNCHER=${TARGET_PROFILES_LAUNCHER:-<none>}"
echo "TARGET_PROFILES_MODEL=${TARGET_PROFILES_MODEL:-<none>}"
echo "TARGET_PROFILES_AUTH=${TARGET_PROFILES_AUTH:-<none>}"
echo "NPM_BIN_DISPATCH=$NPM_BIN_DISPATCH"
echo "CHANNEL=$CHANNEL (step① install path: npm-global | marketplace)"
echo "MP_EVALUATED=$MP_EVALUATED (1 = marketplace branch ran; 0 = npm-global channel — 未验 ≠ 通过)"
echo "MP_REGISTER_OK=$MP_REGISTER_OK MP_REGISTER_RC=${MP_REGISTER_RC:-} MP_FAIL_REASON=${MP_FAIL_REASON:-}"
echo "MP_SETTINGS_OK=$MP_SETTINGS_OK (1 = marketplace 源已注册 + enabledPlugins 无用户级 quay 键)"
echo "MP_ENTRY_PATH=${MP_ENTRY_PATH:-} MP_ENABLED_LEAK=$MP_ENABLED_LEAK"
# AC-161/AC3 直接量：段① 前后操作者真实 ~/.claude/settings.json 的签名（逐字节相同 = 1）。
echo "STEP1_HOME_ISOLATED=$STEP1_HOME_ISOLATED (1 = 段① 跑在隔离 HOME; 0 = 隔离未生效, 可区分)"
# 三态可区分（硬规则 3b）：NOT-EVALUATED = 段① 早退没测到；0 = 测了且改了；1 = 测了且逐字节相同。
echo "STEP1_REAL_SETTINGS_UNCHANGED=$([ "$STEP1_REAL_SETTINGS_EVALUATED" = 1 ] && echo "$STEP1_REAL_SETTINGS_UNCHANGED" || echo NOT-EVALUATED) (1 = 段① 前后签名相同 — AC-161/AC3)"
echo "STEP1_REAL_SETTINGS_EVALUATED=$STEP1_REAL_SETTINGS_EVALUATED (0 = 段① 早退，上面的 NOT-EVALUATED 是真的没测, 不是合格)"
echo "STEP1_REAL_SETTINGS_SIG_BEFORE=${STEP1_REAL_SETTINGS_SIG_BEFORE:-NOT-EVALUATED}"
echo "STEP1_REAL_SETTINGS_SIG_AFTER=${STEP1_REAL_SETTINGS_SIG_AFTER:-NOT-EVALUATED}"
echo "L1_NOT_EVALUATED=$L1_NOT_EVALUATED (1 = SPEC §6 闭集读不到，未评估 ≠ 合格——硬规则 3b)"
echo "L1_CLOSED_SET=${L1_CLOSED_SET:-<none>}"
echo "L1_CLOSED_SET_COUNT=$L1_CLOSED_SET_COUNT L1_CLOSED_SET_PRESENT=$L1_CLOSED_SET_PRESENT L1_CLOSED_SET_MISSING=${L1_CLOSED_SET_MISSING:-<none>}"
echo "L1_OK=$L1_OK"
echo "L2_GIT_COMMIT_AGE_MIN=$L2_GIT_COMMIT_AGE_MIN"
echo "L2_GIT_IS_QUAYINIT_COMMIT=$L2_GIT_IS_QUAYINIT_COMMIT"
echo "L2_INNER_WORKTREE_COUNT=$L2_INNER_WORKTREE_COUNT"
echo "L2_LAYER_PROCESS_CWD=$L2_LAYER_PROCESS_CWD"
echo "L2_STARTUP_PROMPT=$L2_STARTUP_PROMPT"
echo "L2_DEAD_LOOP_STATE=$L2_DEAD_LOOP_STATE"
echo "L2_OK=$L2_OK"
echo "COLDSTART_LIVE=$COLDSTART_LIVE"
echo "COLDSTART_DRIVE_STATE=$COLDSTART_DRIVE_STATE"
echo "AC5_BUILD_SHA=${BUILD_SHA:-}"
echo "AC5_BUILD_DATE=${BUILD_DATE:-}"
echo "AC5_SHA256_QUAY=${SHA256_QUAY:-}"
echo "AC5_SHA256_QN=${SHA256_QN:-}"
echo "AC5_EVALUATED=$AC5_EVALUATED (1 = judged; 0 = no input, distinct from fail — 硬规则 3b)"
echo "AC5_OK=$AC5_OK (1 = build_sha 40-hex + build_date >= ${AC5_MIN_BUILD_DATE} + both sha256 present)"
echo "AC234_TASKS_RENDERED=$AC234_TASKS_RENDERED AC234_GOALS_RENDERED=$AC234_GOALS_RENDERED AC234_ROUND_RECORDS_RENDERED=$AC234_ROUND_RECORDS_RENDERED (三计数取真实渲染 HTML 内容，⛔ 非 HTTP 200 探活；-1 = 未评估)"
echo "AC234_HOST=${AC234_HOST:-} AC234_PROJECT_ROOT=${AC234_PROJECT_ROOT:-}"
echo "AC232_GOAL_WRITE_OK=$AC232_GOAL_WRITE_OK AC232_GOAL_READ_BACK_OK=$AC232_GOAL_READ_BACK_OK AC232_GOAL_RECORDS=$AC232_GOAL_RECORDS (三字段取真实 goal write+show+list 内容，⛔ 非 HTTP 探活；-1 = 未评估)"
echo "AC232_HOST=${AC232_HOST:-} AC232_PROJECT_ROOT=${AC232_PROJECT_ROOT:-}"
echo "AC247_EVALUATED=$AC247_EVALUATED (1 = 八件读数全成立并已写出 ac=GOAL-016-AC-247 记录；0 = 未评估 ≠ 不合格——硬规则 3b)"
echo "AC247_HOST=${AC247_HOST:-<none>} AC247_PROJECT_ROOT=${AC247_PROJECT_ROOT:-<none>}"
echo "AC247_PRE_TASK_COUNT=${AC247_PRE_TASK_COUNT:-<unreadable>} AC247_POST_TASK_COUNT=${AC247_POST_TASK_COUNT:-<unreadable>} (同一实现读两次；post==pre 是「接管不许破坏存量」)"
echo "AC247_STALE_DAYS=${AC247_STALE_DAYS:-<unreadable>} AC247_HEAD_EPOCH=${AC247_HEAD_EPOCH:-<unreadable>} AC247_PRE_TS_EPOCH=${AC247_PRE_TS_EPOCH:-<unreadable>} (stale_days 取 HEAD 提交时刻 → 接管【前】那一刻；⛔ 不是接管后)"
echo "AC247_DRIVER_ALIVE=$AC247_DRIVER_ALIVE AC247_CARRIER_RECORDS=$AC247_CARRIER_RECORDS AC247_CARRIER_RECORDS_PRE=$AC247_CARRIER_RECORDS_PRE (⛔ 来自 quay driver status --json, 不是 driver start 的退出码)"
echo "AC247_PS_STALE_PROCS=$AC247_PS_STALE_PROCS (⛔ 进程表代理量, 仅供与上面的 status 读数对照留档; 任何判据字段都不由它派生)"
echo "AC247_DRIVER_START_RC=${AC247_DRIVER_START_RC:-<none>} (⛔ 诊断量, 不是 liveness 读数)"
echo "AC247_USER_INSTALL_PRE=$AC247_USER_INSTALL_PRE (absent|present|not-evaluated —— 接管前目标机 user-scope 安装读数, 三态)"
echo "AC247_WRITTEN_THIS_RUN=$AC247_WRITTEN_THIS_RUN AC247_WRITTEN_ROOT=${AC247_WRITTEN_ROOT:-<none>}"
# AC-248 留档（十一件读数与两个布尔；⛔ 两个布尔原样来自两次真实运行，不是本行的字面量）。
echo "AC248_EVALUATED=$AC248_EVALUATED (1 = 十一件读数全成立并已写出 ac=GOAL-016-AC-248 记录；0 = 未评估 ≠ 不合格——硬规则 3b)"
echo "AC248_HOST=${AC248_HOST:-<none>} AC248_PROJECT_ROOT=${AC248_PROJECT_ROOT:-<none>} AC248_TASK_ID=${AC248_TASK_ID:-<none>}"
echo "AC248_COMMIT_SHA=${AC248_COMMIT_SHA:-<none>} AC248_PRE_REV=${AC248_PRE_REV:-<none>} (= 实现提交的 parent)"
echo "AC248_PROBE_TOOL=${AC248_PROBE_TOOL:-<none>} AC248_BEFORE_DETECTS=${AC248_BEFORE_DETECTS:-<unreadable>} AC248_AFTER_DETECTS=${AC248_AFTER_DETECTS:-<unreadable>} (⛔ 来自目标项目自己的检查器两次真实运行，不是本脚本的判定)"
echo "AC248_CLI_SOURCE=${AC248_CLI_SOURCE:-<unreadable>} AC248_BEFORE_CLI_RC=${AC248_BEFORE_CLI_RC:-<unreadable>} AC248_AFTER_CLI_RC=${AC248_AFTER_CLI_RC:-<unreadable>} (⛔ 退出码只是留档诊断量, 不是判据字段——本 AC 的靶子缺陷正是 exit 0 与合格同形)"
echo "AC248_WRITTEN_THIS_RUN=$AC248_WRITTEN_THIS_RUN AC248_WRITTEN_ROOT=${AC248_WRITTEN_ROOT:-<none>}"
echo "AC249_OUTCOME=${AC249_OUTCOME:-<none>} (ok | incomplete-change:<side> | not-evaluated:<why> —— 后两者取值不同且都不写记录, 硬规则 3b)"
echo "AC249_EVALUATED=$AC249_EVALUATED (1 = 并集读出且两侧谓词都成立并已写出 ac=GOAL-016-AC-249 记录；0 = 未评估 ≠ 不合格)"
echo "AC249_HOST=${AC249_HOST:-<none>} AC249_PROJECT_ROOT=${AC249_PROJECT_ROOT:-<none>} AC249_TASK_ID=${AC249_TASK_ID:-<none>}"
echo "AC249_UNION_SHAS=${AC249_UNION_SHAS:-<none>} (并集用到的提交——按位置归属，⛔ 不是「最新一条」)"
echo "AC249_COMMIT_FILES=${AC249_COMMIT_FILES_JSON:-<none>}"
echo "AC249_WRITTEN_THIS_RUN=$AC249_WRITTEN_THIS_RUN AC249_WRITTEN_ROOT=${AC249_WRITTEN_ROOT:-<none>}"
echo "AC88_VERIFY=$AC88_VERIFY"
echo "AC238_EVALUATED=$AC238_EVALUATED (1 = 四件读数全成立并已写记录；0 = 未评估 ≠ 不合格——硬规则 3b)"
echo "AC238_PROJECT_ROOT=${AC238_PROJECT_ROOT:-<none>}"
echo "AC238_PRE_TASK_COUNT=$AC238_PRE_TASK_COUNT AC238_POST_TASK_COUNT=$AC238_POST_TASK_COUNT"
echo "AC238_PRE_UPGRADE_RUNTIME_AGE_DAYS=${AC238_RUNTIME_AGE_DAYS:-<unread>} AC238_RUNTIME_REPLACED=$AC238_RUNTIME_REPLACED"
echo "AC238_TASK_LIST_OK=$AC238_TASK_LIST_OK AC238_TASKSET_STABLE=$AC238_TASKSET_STABLE AC238_SAMPLE_TASK=${AC238_SAMPLE_TASK:-<none>}"
echo "AC238_FRESH_RUNTIME_SHA256=${AC238_FRESH_RUNTIME_SHA:-<none>} (当前语义下 = 项目升级后绑定到的交付物 bundle 的 sha256，⛔ 不是「本地 runtime 文件」的——该布局已被裁定 c 退休)"
echo "AC238_BOUND_MCP_ENTRY=${AC238_BOUND_ENTRY:-<unread>} AC238_RETIRED_RUNTIME_BACKUP=${AC238_RETIRED_DIR:-<none>} AC238_RETIRED_MATCHES_PRE=$AC238_RETIRED_MATCHES_PRE"
echo "AC239_EVALUATED=$AC239_EVALUATED (1 = 四个直接量全成立并已写记录；0 = 未评估 ≠ 不合格——硬规则 3b)"
echo "AC239_PROJECT_ROOT=${AC239_PROJECT_ROOT:-<none>} (⛔ 必须与 AC238_PROJECT_ROOT 逐字一致，判据侧按载体集合再核一遍)"
echo "AC239_TASK_ID=${AC239_TASK_ID:-<none>} AC239_TASK_CREATED=$AC239_TASK_CREATED AC239_DRIVERS_STARTED=$AC239_DRIVERS_STARTED"
echo "AC239_PROFILES_STATUS=$AC239_PROFILES_STATUS"
echo "AC239_TOOLCHAIN_STATUS=$AC239_TOOLCHAIN_STATUS (resolved | go-absent —— 目标项目是 Go 项目，缺 go 则 worker 跑不了它的 scoped 门)"
echo "AC239_BASELINE_STATUS=$AC239_BASELINE_STATUS (compatible | divergent | absent | unreadable | not-attempted —— 升级后副本的落地基线 'develop' 是否可用；divergent/absent ⇒ 该项目自己的 fan-in 落地结构上不可能，⑦b 当场停在那里而不是烧一小时轮询)"
echo "AC239_TASK_STATUS=${AC239_TASK_STATUS:-<unreadable>} AC239_COMMIT_SHA=${AC239_COMMIT_SHA:0:12} AC239_GATE_EVENTS=$AC239_GATE_EVENTS AC239_PRODUCED_BY_DRIVER=$AC239_PRODUCED_BY_DRIVER"
echo "AC239_WRITTEN_THIS_RUN=$AC239_WRITTEN_THIS_RUN AC239_WRITTEN_ROOT=${AC239_WRITTEN_ROOT:-<none>}"
# AC-240 运行级取值：闭环是否由【本次运行】自证（1 | 0 | not-evaluated，三态可区分）。
# 取值来自本次运行自己写的记录（AC203_WRITTEN_THIS_RUN / AC207_WRITTEN_THIS_RUN + 各自的 root），
# ⛔ 不回读载体反推——AC-240 origin 正是「两条记录都成立但 project_root 互不相交」的形态。
e2e_closure_self_evidenced "$AC207_E2E" "$AC203_WRITTEN_THIS_RUN" "$AC203_WRITTEN_ROOT" "$AC207_WRITTEN_THIS_RUN" "$AC207_WRITTEN_ROOT"
echo "E2E_CLOSURE_SELF_EVIDENCED=$E2E_CLOSURE_SELF_EVIDENCED (1 = 本次运行对同一 project_root 写出了 AC-203 与 AC-207；0 = 本次尝试了 e2e 但闭环不自证；not-evaluated = 未尝试 e2e —— 三态可区分, 硬规则 3b)"
echo "E2E_CLOSURE_NOTE=$E2E_CLOSURE_NOTE"
echo "E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=$AC203_WRITTEN_THIS_RUN E2E_CLOSURE_AC207_WRITTEN_THIS_RUN=$AC207_WRITTEN_THIS_RUN"
echo "E2E_CLOSURE_AC203_ROOT=${AC203_WRITTEN_ROOT:-<none>} E2E_CLOSURE_AC207_ROOT=${AC207_WRITTEN_ROOT:-<none>}"

# ── 证据 (AC5) ────────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$EVIDENCE")"
cat > "$EVIDENCE" <<EOF
{
  "ts": "$TS",
  "ac": "AC88",
  "project": "$PROJECT",
  "root": "$ROOT",
  "build_sha": "${BUILD_SHA:-}",
  "build_date": "${BUILD_DATE:-}",
  "artifact_quay": "$(basename "$QUAY_TGZ")",
  "artifact_quay_native": "$(basename "$QN_TGZ")",
  "sha256_quay": "${SHA256_QUAY:-}",
  "sha256_quay_native": "${SHA256_QN:-}",
  "ac5_min_build_date": "$AC5_MIN_BUILD_DATE",
  "ac5_evaluated": $AC5_EVALUATED,
  "ac5_ok": $AC5_OK,
  "step1_ok": $STEP1_OK,
  "step2_ok": $STEP2_OK,
  "npm_bin_dispatch": $NPM_BIN_DISPATCH,
  "l1_ok": $L1_OK,
  "l1_not_evaluated": $L1_NOT_EVALUATED,
  "l1_closed_set": "${L1_CLOSED_SET:-}",
  "l1_closed_set_count": $L1_CLOSED_SET_COUNT,
  "l1_closed_set_present": $L1_CLOSED_SET_PRESENT,
  "l1_closed_set_missing": "${L1_CLOSED_SET_MISSING:-}",
  "l2_ok": $L2_OK,
  "l2_git_commit_age_min": "$L2_GIT_COMMIT_AGE_MIN",
  "l2_git_is_quayinit_commit": $L2_GIT_IS_QUAYINIT_COMMIT,
  "l2_inner_worktree_count": $L2_INNER_WORKTREE_COUNT,
  "l2_layer_process_cwd": $L2_LAYER_PROCESS_CWD,
  "l2_startup_prompt": $L2_STARTUP_PROMPT,
  "l2_dead_loop_state": "$L2_DEAD_LOOP_STATE",
  "coldstart_live": "$COLDSTART_LIVE",
  "ac88_verify": "$AC88_VERIFY",
  "channel": "$CHANNEL",
  "mp_evaluated": $MP_EVALUATED,
  "mp_register_ok": $MP_REGISTER_OK,
  "mp_register_rc": "${MP_REGISTER_RC:-}",
  "mp_fail_reason": "${MP_FAIL_REASON:-}",
  "mp_settings_ok": $MP_SETTINGS_OK,
  "mp_entry_path": "${MP_ENTRY_PATH:-}",
  "mp_enabled_leak": $MP_ENABLED_LEAK,
  "mp_settings_path": "${MP_SETTINGS_PATH:-}",
  "target_profiles_status": "$TARGET_PROFILES_STATUS",
  "target_profiles_launcher": "${TARGET_PROFILES_LAUNCHER:-}",
  "target_profiles_model": "${TARGET_PROFILES_MODEL:-}",
  "target_profiles_auth": "${TARGET_PROFILES_AUTH:-}",
  "ac234_host": "${AC234_HOST:-}",
  "ac234_project_root": "${AC234_PROJECT_ROOT:-}",
  "ac234_tasks_rendered": $AC234_TASKS_RENDERED,
  "ac234_goals_rendered": $AC234_GOALS_RENDERED,
  "ac234_round_records_rendered": $AC234_ROUND_RECORDS_RENDERED,
  "ac234_evaluated": $AC234_EVALUATED,
  "liveness_window_min": $LIVENESS_WINDOW
}
EOF
echo "evidence written → $EVIDENCE"

# ── AC89 记录（同 per-task-suite-records 形态，JSON 行；AC89 AC4: B/C 两机 + 安装/初始化/冷启动三项）──
# marketplace 通道的记录用可区分 ac 标记 "AC168-marketplace"（AC4：不得与既有 ac="AC88"/"AC107" 混淆）。
mkdir -p "$(dirname "$AC89")"
bool() { [ "$1" = "1" ] && printf true || printf false; }
step3=0; [ "$COLDSTART_LIVE" = "yes" ] && step3=1
detail="steps: install(1)=$STEP1_OK init(2)=$STEP2_OK coldstart(3) live=$COLDSTART_LIVE git_age=${L2_GIT_COMMIT_AGE_MIN}min quayinit_commit=$L2_GIT_IS_QUAYINIT_COMMIT worktree=$L2_INNER_WORKTREE_COUNT proc_cwd=$L2_LAYER_PROCESS_CWD startup_prompt=$L2_STARTUP_PROMPT dead_loop=$L2_DEAD_LOOP_STATE build_sha=${BUILD_SHA:-} build_date=${BUILD_DATE:-} sha256_quay=${SHA256_QUAY:-0} sha256_qn=${SHA256_QN:-0} ac5_ok=$AC5_OK l1_closed_set=${L1_CLOSED_SET:-none} l1_not_evaluated=$L1_NOT_EVALUATED l1_closed_set_present=$L1_CLOSED_SET_PRESENT/$L1_CLOSED_SET_COUNT l1_closed_set_missing=${L1_CLOSED_SET_MISSING:-none} target_profiles_status=${TARGET_PROFILES_STATUS:-not-configured} target_profiles_launcher=${TARGET_PROFILES_LAUNCHER:-none} target_profiles_model=${TARGET_PROFILES_MODEL:-none} target_profiles_auth=${TARGET_PROFILES_AUTH:-none}"
ac_tag="AC88"
okflag=false; [ "$AC88_VERIFY" = "ok" ] && okflag=true
mp_json=""
if [ "$CHANNEL" = "marketplace" ]; then
  ac_tag="AC168-marketplace"
  # marketplace 记录的 ok = 断言全部成立（源已注册 + 无 enabledPlugins 外溢）；register 失败（AC5）⇒
  # ok=false，但失败原因结构化落 detail/mpFailReason——失败是一条有效读数，不是静默（硬规则 3b）。
  okflag=false; [ "$MP_SETTINGS_OK" = "1" ] && okflag=true
  detail="${detail} channel=marketplace mp_evaluated=$MP_EVALUATED mp_register_ok=$MP_REGISTER_OK mp_register_rc=${MP_REGISTER_RC:-} mp_settings_ok=$MP_SETTINGS_OK mp_entry_path=${MP_ENTRY_PATH:-none} mp_enabled_leak=$MP_ENABLED_LEAK mp_fail_reason=${MP_FAIL_REASON:-none}"
  mp_json=",\"mpRegisterOk\":$(bool "$MP_REGISTER_OK"),\"mpSettingsOk\":$(bool "$MP_SETTINGS_OK"),\"mpEvaluated\":$(bool "$MP_EVALUATED"),\"mpEnabledLeak\":$(bool "$MP_ENABLED_LEAK"),\"mpRegisterRc\":\"${MP_REGISTER_RC:-}\",\"mpEntryPath\":\"${MP_ENTRY_PATH:-}\",\"mpFailReason\":\"${MP_FAIL_REASON:-}\""
fi
host_json=""
[ -n "$HOST" ] && host_json=",\"host\":\"$HOST\""
printf '{"ts":"%s","ac":"%s","ok":%s,"artifact":"%s","evidence":"%s","detail":"%s"%s%s,"stepInstall":%s,"stepInit":%s,"stepColdstart":%s}\n' \
  "$TS" "$ac_tag" "$okflag" "$(basename "$QUAY_TGZ")" "$EVIDENCE" "$detail" "$host_json" "$mp_json" \
  "$(bool "$STEP1_OK")" "$(bool "$STEP2_OK")" "$(bool "$step3")" >> "$AC89"
echo "ac89 record appended → $AC89"

# ── AC-201 产物可溯源记录追加（gap-ac201：top-level {ts,ac,build_sha,tgz_sha256}；缺输入不写）──
append_ac201_record
if [ "$AC201_WRITTEN" = "1" ]; then
  echo "ac201 record appended → $AC89 (build_sha=${BUILD_SHA} tgz_sha256=${SHA256_QUAY})"
else
  echo "ac201 record NOT appended (BUILD_SHA or SHA256_QUAY empty — 缺输入不写, 硬规则 3b)"
fi

if [ "$CHANNEL" != "marketplace" ] && [ "$REQUIRE_LIVE" = 1 ] && [ "$COLDSTART_LIVE" != "yes" ]; then
  echo "verify-deliver-coldstart: FAIL (--require-live but COLDSTART_LIVE=$COLDSTART_LIVE)"
  exit 1
fi
if [ "$AC88_VERIFY" = "fail" ]; then
  echo "verify-deliver-coldstart: FAIL (one of the three steps not verified, or AC5 evidence not met)"
  exit 1
fi
if [ "$CHANNEL" = "marketplace" ]; then
  echo "verify-deliver-coldstart: done (channel=marketplace MP_SETTINGS_OK=$MP_SETTINGS_OK — 成功或如实记录的失败原因均可，AC5)"
else
  echo "verify-deliver-coldstart: done (AC88_VERIFY=$AC88_VERIFY)"
fi
exit 0
