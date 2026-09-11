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
#       [--evidence <path>] [--ac89 <path>] [--host <B|C>] [--spec <path>] [--channel npm-global|marketplace] [--ac205-session] [--ac207-e2e] [--selfcheck] [--help] \
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
#   --verify-only    只跑③（对已存在的 --root 重验冷启动活性；①②被调用方声明已验）。
#   --ac205-session  ⑦ 会话投递（GOAL-009-AC-205）：用安装物 dist/send-to-session.js 给同址目标会话
#                    发 probe，读目标 transcript（transcript-delivery-check.js --check）判 delivered
#                    ⇒ 写 AC-205 记录（transcript_confirmed=true）。opt-in：需同址 live 目标会话。
#   --require-live   ③ 若 COLDSTART_LIVE != yes 则 exit 1（严格验证——冷启动确认跑用）。
#   --selfcheck      全 hermetically 自检（AC2 直接量正/负控制 + L1 闭集解析/未评估正负控制 + AC5 判据正/负控制 + 目标项目 profiles 配置正/负/覆盖控制），不碰真实安装。exit 0/1。
#   --ac207-e2e      ⑤ 端到端（GOAL-009-AC-207）：第三方项目里用 shipped CLI 建真实任务、起 *-drivers
#                    驱动到 done、读直接量写 AC-207 记录。昂贵（worker-driver spawn claude -p）——
#                    opt-in；缺任一读数不写（fail-closed）。⛔ 产品文档/skill 文案不得声称 quay 会启动会话。
#   --target-launcher/--target-model/--target-auth  配置目标项目 profiles 的 CLI 覆盖
#                    （gap-verify-coldstart-does-not-configure-target-profiles）。缺省由驱动方仓库
#                    .quay/profiles.yml 的 worker-default 派生（单一真相源，⛔ 不写第二份字面量）；
#                    --driving-profiles <p> 显式指定该来源。launcher/model 任一缺 ⇒
#                    target-profiles: not-configured（可区分取值，⛔ 不静默跳过，硬规则 3b）。
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
# 判据读载体（host/project_root/commit_sha/task_id/task_status/gate_events/produced_by_driver），
# ⛔ 不采信驱动方自述（硬规则 4b）：commit_sha 取第三方项目 git 历史（经共享裸仓库镜像可核）、
# gate_events 取 .quay/gate-events.jsonl 计数、task_status 取目标项目 task store。produced_by_driver
# 最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，不能完全排除
# 人在会话手敲——该半判据属人裁定口证，不冒充测量（AC-207 正文逐字）。⛔ 产品/夹具边界：允许
# claude --bg / -p 作验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话。
AC207_HOST=""
AC207_PROJECT_ROOT=""
AC207_COMMIT_SHA=""
AC207_TASK_ID=""
AC207_TASK_STATUS=""
AC207_GATE_EVENTS=-1
AC207_PRODUCED_BY_DRIVER=0
AC207_EVALUATED=0
AC207_E2E=0                                  # 1 = --ac207-e2e 触发端到端段（昂贵，opt-in）

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
    --ac205-session) AC205_SESSION=1; shift ;;
    --target-launcher) TARGET_LAUNCHER="$2"; shift 2 ;;
    --target-model) TARGET_MODEL="$2"; shift 2 ;;
    --target-auth) TARGET_AUTH="$2"; shift 2 ;;
    --driving-profiles) DRIVING_PROFILES="$2"; shift 2 ;;
    --upgrade-existing) UPGRADE_EXISTING=1; shift ;;
    --upgrade-source) UPGRADE_SOURCE="$2"; shift 2 ;;
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

# ── AC-207 记录写（fail-closed，硬规则 3b）────────────────────────────────────────────────
# 写 GOAL-009-AC-207 记录（经 ac89_append_goal009 统一补 top-level build_sha/ts——AC-214 新鲜度锚）。
# 缺任一有效读数 ⇒ 不写 return 1（缺值≠合格，也≠静默跳过）。字段逐字满足 criterion 过滤：
#   host 非空（≠本机由 criterion 判）、project_root 非空（∉本仓库由 criterion 判）、
#   commit_sha 非空（异仓库 sha，⛔ 非新鲜度锚——AC-214 只认 top-level build_sha）、task_id 非空、
#   task_status="done"、gate_events>0（整数）、produced_by_driver=true（JSON 字面 true，criterion `is True`）。
write_ac207_record() {
  local host="$1" project_root="$2" commit_sha="$3" task_id="$4" task_status="$5" gate_events="$6" produced_by_driver="$7"
  [ -n "$host" ] || return 1
  [ -n "$project_root" ] || return 1
  [ -n "$commit_sha" ] || return 1
  [ -n "$task_id" ] || return 1
  [ "$task_status" = "done" ] || return 1
  [ "$gate_events" -gt 0 ] 2>/dev/null || return 1
  [ "$produced_by_driver" = "true" ] || return 1
  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-207\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"commit_sha\":\"$commit_sha\",\"task_id\":\"$task_id\",\"task_status\":\"$task_status\",\"gate_events\":$gate_events,\"produced_by_driver\":$produced_by_driver"
}

# ── AC-207 直接量读取（硬规则 4b：全部外部可核，⛔ 不采信驱动方自述）──────────────────────
#   commit_sha  = 第三方项目 git 历史第一条【非 chore(quay-init)】提交（任务实现提交；排除安装
#                 auto-commit——那是对「没在转」也成立的提交，硬规则 4b）
#   task_status = 目标项目 task store（installed quay CLI task view，cwd=第三方项目根）
#   gate_events = .quay/gate-events.jsonl 行数（载体计数，缺文件 = 0）
#   produced_by_driver = task_status=done ∧ gate_events>0 ∧ 实现提交出自 task/<id> 分支或
#                 develop 已含该 task_id（时间线交错）。最强可得直接量，非机械证明（AC-207 正文）。
probe_ac207_measures() {
  local root="$1" task_id="$2" qrl="$3" status_json
  AC207_EVALUATED=0; AC207_COMMIT_SHA=""; AC207_TASK_STATUS=""; AC207_GATE_EVENTS=-1; AC207_PRODUCED_BY_DRIVER=0
  [ -n "$root" ] || return 0
  [ -n "$task_id" ] || return 0
  # commit_sha：--all 覆盖 task/<id> 分支与 develop（fan-in 后分支删了、提交进 develop）
  AC207_COMMIT_SHA="$(git -C "$root" log --all --format='%H %s' 2>/dev/null \
    | grep -v 'chore(quay-init):' | head -1 | awk '{print $1}' || true)"
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
  # produced_by_driver 直接量：done ∧ gate>0 ∧ 提交出自 task/<id> 分支或 develop 已含该 task_id
  if [ "$AC207_TASK_STATUS" = "done" ] && [ "$AC207_GATE_EVENTS" -gt 0 ] 2>/dev/null && [ -n "$AC207_COMMIT_SHA" ]; then
    if git -C "$root" branch --list "task/$task_id" 2>/dev/null | grep -q "task/$task_id" \
       || git -C "$root" log --all --format='%s' 2>/dev/null | grep -q "$task_id"; then
      AC207_PRODUCED_BY_DRIVER=1
    fi
  fi
  AC207_EVALUATED=1
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
  for i in $(seq 1 "${AC207_POLL_SECS:-1800}"); do
    status_json="$( (cd "$root" && node "$qrl" task view "$task_id" --json) 2>/dev/null || true)"
    AC207_TASK_STATUS="$(printf '%s' "$status_json" | "$VC_NODE" --no-warnings -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try{ const j=JSON.parse(s); console.log(j && j.status ? String(j.status) : ""); }catch{ console.log(""); } });
    ' 2>/dev/null)"
    [ "$AC207_TASK_STATUS" = "done" ] && break
    sleep 1
  done
  # ④ 读直接量 + 写记录（缺任一读数不写）
  probe_ac207_measures "$root" "$task_id" "$qrl"
  AC207_TASK_ID="$task_id"
  echo "  task_status=$AC207_TASK_STATUS commit_sha=${AC207_COMMIT_SHA:0:12} gate_events=$AC207_GATE_EVENTS produced_by_driver=$AC207_PRODUCED_BY_DRIVER evaluated=$AC207_EVALUATED host=$AC207_HOST"
  if [ "$AC207_EVALUATED" = "1" ] && [ "$AC207_TASK_STATUS" = "done" ] \
     && [ -n "$AC207_COMMIT_SHA" ] && [ "$AC207_GATE_EVENTS" -gt 0 ] 2>/dev/null \
     && [ "$AC207_PRODUCED_BY_DRIVER" = "1" ]; then
    write_ac207_record "$AC207_HOST" "$AC207_PROJECT_ROOT" "$AC207_COMMIT_SHA" "$AC207_TASK_ID" "done" "$AC207_GATE_EVENTS" "true"
    echo "  ac207 record written → $AC89"
    return 0
  fi
  echo "  NOTE: AC-207 record NOT written (task not driven to done / no commit / no gate events — 缺值≠合格)"
  return 0
}

# ── ⑦ 既有旧痕迹项目的升级路径（GOAL-009-AC-238）───────────────────────────────────────────
# 四件要测的事与「为什么两个方向都要取」见顶部 --upgrade-existing 的变量块注释。本函数只做
# 「取直接量 + 写记录」；升级动作本身 = 跑【本次交付物自带的】quay-init（SPEC §5 的部署/升级入口：
# 已有 config ⇒ 配置保留分支，⛔ 不是空仓库重写），再把项目本地 runtime 换成本次交付物。
# ⛔ 每个前置不成立都 return 0 且【不改 AC238_EVALUATED】——「读不出」是一个独立取值，不与「合格」同形
# （硬规则 3b：恒绿的检查比没有检查更贵）。
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
  old_epoch="$(find "$rtbin" -maxdepth 1 -type f -name '*.js' -printf '%T@\n' 2>/dev/null | sort -n | head -1)"
  now_epoch="$(date +%s)"
  [ -n "$old_epoch" ] || { echo "  NOT-EVALUATED: cannot read old runtime mtime under $rtbin" >&2; return 0; }
  AC238_RUNTIME_AGE_DAYS="$(python3 -c "print(round((${now_epoch} - float('${old_epoch}'))/86400.0, 3))" 2>/dev/null || echo "")"
  pre_q="$(sha256sum "$rtbin/quay.js" | awk '{print $1}')"
  pre_qn="$(sha256sum "$rtbin/quay-native.js" | awk '{print $1}')"
  # 存量指纹：逐文件 sha 的聚合（相对路径 + sort，故与本机绝对路径无关）。用于证明升级【没动】存量。
  pre_set="$(cd "$root" && find tasks -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  echo "  pre: tasks=$AC238_PRE_TASK_COUNT runtime_age_days=$AC238_RUNTIME_AGE_DAYS taskset=$(printf '%.12s' "$pre_set")"

  # ③ 升级动作 = 跑【本次交付物自带的】quay-init。已有 config ⇒ 配置保留分支（migrate_stale_mcp_entry
  #    + ensure_loop_config），⛔ 不是空仓库重写；任务目录只 mkdir -p，不删不覆盖。
  # ⛔ 刻意【不】把退出码捕获写成「命令 ... 或运算 赋给 rc」的一行形式：instrument-failure-check 的
  # FAMILY-3 规则是 raw indexOf 找第一个竖线字符（不区分单竖线与双竖线），那种写法会被读成
  # 「管道后读退出码」并往该族新增一条实例，而那一族的门是 shrink-only。本实现落地时被 pre-commit
  # guard 实测拦下（计数 15→16）；⚠️ 该检测器是【行扫描器】，连注释里出现同形字面量也计入——
  # 本条注释本身第一次就是这么被计进去的。改用本文件既有的 set +e / 取 rc / set -e 形
  # （同 :973/:2116/:2156）。
  set +e
  CLAUDE_PLUGIN_ROOT="$(dirname "$(dirname "$qinit")")" \
    bash "$qinit" --root "$root" --repo-root "$root" \
      --worktree-root "$(dirname "$root")/$(basename "$root")-worktrees" \
      --auto-commit-skip >"$root/.quay-upgrade-init.log" 2>&1
  init_rc=$?
  set -e
  echo "  upgrade action: shipped quay-init (config-preserving branch) rc=$init_rc → $root/.quay-upgrade-init.log"

  # ④ runtime 刷新 = 用本次真实交付物【就地替换】旧 vendored bundle。⛔ 不是旁路共存：换完之后
  #    project-local runtime 的 .js 与本次交付物逐字一致。wrapper 重写为指向刷新后的本地 bundle
  #    （旧 wrapper 指向的正是同一个绝对路径，此处保持同一形态、只换被指向的内容）。
  cp -f "$fresh_quay" "$rtbin/quay.js" || { echo "  NOT-EVALUATED: refresh quay.js failed" >&2; return 0; }
  cp -f "$fresh_qn"   "$rtbin/quay-native.js" || { echo "  NOT-EVALUATED: refresh quay-native.js failed" >&2; return 0; }
  local nodebin; nodebin="$(command -v node)"
  printf '#!/bin/bash\nexec %s %s/quay.js "$@"\n' "$nodebin" "$rtbin" > "$rtbin/quay"
  printf '#!/bin/bash\nexec %s %s/quay-native.js "$@"\n' "$nodebin" "$rtbin" > "$rtbin/quay-native"
  chmod +x "$rtbin/quay" "$rtbin/quay-native"
  if [ -f "${npmroot}/quay-native/provider.yml" ]; then
    mkdir -p "$root/.quay/runtime"
    cp -f "${npmroot}/quay-native/provider.yml" "$root/.quay/runtime/provider.yml"
  fi

  # ⑤ 升级【后】直接量
  AC238_POST_TASK_COUNT="$(find "$root/tasks" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  post_set="$(cd "$root" && find tasks -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  [ -n "$post_set" ] && [ "$post_set" = "$pre_set" ] && AC238_TASKSET_STABLE=1
  post_q="$(sha256sum "$rtbin/quay.js" | awk '{print $1}')"
  post_qn="$(sha256sum "$rtbin/quay-native.js" | awk '{print $1}')"
  fresh_q="$(sha256sum "$fresh_quay" | awk '{print $1}')"
  fresh_qn_sha="$(sha256sum "$fresh_qn" | awk '{print $1}')"
  AC238_FRESH_RUNTIME_SHA="${fresh_q},${fresh_qn_sha}"
  # replaced 的两个方向（逐文件比较——⛔ 不把 sha 拼成一串比，glob 展开顺序会让拼接串在本就相同时判「不等」）：
  if [ "$post_q" = "$fresh_q" ] && [ "$post_qn" = "$fresh_qn_sha" ] \
     && { [ "$post_q" != "$pre_q" ] || [ "$post_qn" != "$pre_qn" ]; }; then
    AC238_RUNTIME_REPLACED=1
  fi
  echo "  post: tasks=$AC238_POST_TASK_COUNT taskset_stable=$AC238_TASKSET_STABLE runtime_replaced=$AC238_RUNTIME_REPLACED"

  # ⑥ 新 CLI 能读出旧存量（文件还在 ≠ 读得出）：用【刷新后的 project-local runtime】跑 task list。
  #    PATH 前置本次安装前缀 ⇒ config 里那条裸 `quay-native`（mcp_entry）解析到本次交付物。
  tl_json="$(cd "$root" && PATH="$PREFIX/bin:$PATH" node "$rtbin/quay.js" task list --root "$root" --json 2>/dev/null)"
  tl_count="$(printf '%s' "$tl_json" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(len(d))' 2>/dev/null || echo "")"
  # 抽样 task_get：优先 DIR-001（meta-cc 真实存量任务），否则字典序第一个。
  sample_id=""
  if [ -f "$root/tasks/DIR-001.md" ]; then sample_id="DIR-001"
  else sample_id="$(find "$root/tasks" -maxdepth 1 -type f -name '*.md' -printf '%f\n' 2>/dev/null | sed 's/\.md$//' | sort | head -1)"; fi
  AC238_SAMPLE_TASK="$sample_id"
  sample_json=""
  if [ -n "$sample_id" ]; then
    sample_json="$(cd "$root" && PATH="$PREFIX/bin:$PATH" node "$rtbin/quay.js" task view "$sample_id" --root "$root" --json 2>/dev/null)"
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
     && [ "$init_rc" = "0" ]; then
    AC238_EVALUATED=1
  fi
  if [ "$AC238_EVALUATED" = "1" ]; then
    mkdir -p "$(dirname "$AC89")"
    printf '{"ts":"%s","ac":"GOAL-009-AC-238","host":"%s","project_root":"%s","pre_upgrade_task_count":%s,"post_upgrade_task_count":%s,"pre_upgrade_runtime_age_days":%s,"runtime_replaced":true,"task_list_ok":true,"build_sha":"%s","upgrade_source":"%s","upgrade_init_rc":%s,"isolated_copy":%s,"taskset_stable":true,"sample_task":"%s","fresh_runtime_sha256":"%s"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${HOST:-unknown}" "$AC238_PROJECT_ROOT" \
      "$AC238_PRE_TASK_COUNT" "$AC238_POST_TASK_COUNT" "$AC238_RUNTIME_AGE_DAYS" \
      "$BUILD_SHA" "${UPGRADE_SOURCE:-none}" "$init_rc" \
      "$([ -n "$UPGRADE_SOURCE" ] && [ "$UPGRADE_SOURCE" != "$root" ] && echo true || echo false)" \
      "$AC238_SAMPLE_TASK" "$AC238_FRESH_RUNTIME_SHA" >> "$AC89"
    echo "  ac238 record written → $AC89"
  else
    echo "  AC-238 record NOT written — 缺值≠合格 (pre_count=$AC238_PRE_TASK_COUNT post_count=$AC238_POST_TASK_COUNT age_days=${AC238_RUNTIME_AGE_DAYS:-<unread>} replaced=$AC238_RUNTIME_REPLACED task_list_ok=$AC238_TASK_LIST_OK build_sha=${BUILD_SHA:-<empty>} upgrade_init_rc=$init_rc)" >&2
  fi
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
step1_install() {
  local qbin qnbin qinit qv qnv qrl
  rm -rf "$PREFIX"
  mkdir -p "$PREFIX"
  echo "== ① fresh .tgz install into isolated prefix $PREFIX =="
  if ! npm install -g --no-audit --no-fund --prefix "$PREFIX" "$QUAY_TGZ" "$QN_TGZ" >/dev/null 2>&1; then
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
  set +e
  npm_config_global=true QUAY_SKIP_PLUGIN_CLI=1 "$VC_NODE" --no-warnings "$register" >"${STEP1_PREFIX}/register-plugin.out" 2>&1
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
  # 断言 settings.json（register-plugin.mjs 经 os.homedir() 写入 $HOME/.claude/settings.json）
  mp_assert_settings "${HOME}/.claude/settings.json" "$plugin_dir"
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
  AC89="$ac207_file"; TS="2026-09-09T00:00:00Z"; BUILD_SHA="0123456789abcdef0123456789abcdef01234567"
  if write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "true"; then
    ac207_wrote=1
    if grep -q '"ac":"GOAL-009-AC-207"' "$ac207_file" \
       && grep -q '"host":"hostB-fake"' "$ac207_file" \
       && grep -q '"commit_sha":"1111111111111111111111111111111111111111"' "$ac207_file" \
       && grep -q '"task_id":"e2e-task-1"' "$ac207_file" \
       && grep -q '"task_status":"done"' "$ac207_file" \
       && grep -q '"gate_events":5' "$ac207_file" \
       && grep -q '"produced_by_driver":true' "$ac207_file" \
       && grep -q '"build_sha":"0123456789abcdef0123456789abcdef01234567"' "$ac207_file"; then
      ac207_fields_ok=1
    fi
  fi
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "5" "false" 2>/dev/null; then
    ac207_refused_pdb=1
  fi
  if ! write_ac207_record "hostB-fake" "/tmp/third-party-fake" "1111111111111111111111111111111111111111" "e2e-task-1" "done" "0" "true" 2>/dev/null; then
    ac207_refused_ge=1
  fi
  AC89=""; TS=""; BUILD_SHA=""
  echo "selfcheck: ac207-record(valid) wrote=$ac207_wrote fields_ok=$ac207_fields_ok (expect 1/1)"
  echo "selfcheck: ac207-record(produced_by_driver=false) refused=$ac207_refused_pdb (expect 1 — 假值≠合格)"
  echo "selfcheck: ac207-record(gate_events=0) refused=$ac207_refused_ge (expect 1 — gate_events=0 拒写)"

  if [ "$d1" = "1" ] && [ "$d2" = "no" ] && [ "$a1" = "1" ] && [ "$a2" = "yes" ] \
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
     && [ "$tp_ok" = "1" ]; then
    echo "selfcheck: PASS — AC2 direct measures can take false (chore auto-commit excluded; proc_ok demoted by startup-prompt) and true (loop work; proc_ok + passed-prompt); L1 closed-set is parsed from SPEC (spec-mutate flips verdict, missing-spec is NOT-evaluated ≠ qualified); AC5 can take false (old build), true (recent build), and be distinct when not evaluated; marketplace channel (AC168) registers via register-plugin.mjs and can take false (no-register ⇒ no entry) and true (register ⇒ entry + no enabledPlugins leak), and a register failure is recorded structurally (exit code not swallowed, AC5); AC-203 carrier record writes the five criterion fields verbatim (has_plugin_dir=false literal, driver_alive=1, carrier_records>0) and refuses to write a dead-driver record (fail-closed); AC-201 record append writes top-level {ts,ac,build_sha,tgz_sha256} only when BUILD_SHA and SHA256_QUAY are both non-empty (positive 40-hex/64-hex; negative empty-BUILD_SHA writes nothing, 硬规则 3b); GOAL-009 anchor helper appends top-level build_sha on a 40-hex BUILD_SHA and refuses (non-zero, no write) on an empty BUILD_SHA (AC-214 fail-closed); AC-206 carrier record writes the four boolean fields verbatim (goals_dir_created/tasks_dir_created/goal_store_readable/task_store_readable) and refuses an empty-host record (fail-closed); AC-204 carrier record writes the five criterion fields verbatim (forbidden_count=0 integer, enable_declared=true literal) and refuses a forbidden-copy or no-enable record (fail-closed, 成对判定); AC-205 carrier record writes the three criterion fields verbatim (shipped_from_installed_artifact=true + transcript_confirmed=true literals, top-level build_sha) with transcript_confirmed derived from transcript-delivery-check reading the transcript (hit ⇒ delivered / miss ⇒ not) — never from a send exit code — and refuses shipped=false / transcript_confirmed=false / empty-host (fail-closed, AC4 负控制); AC-234 render counts are derived from rendered HTML content (task/goal anchors + round-row anchors — never an HTTP status code, AC2) and can take false (empty-shell page ⇒ 0/0/0); the AC-234 carrier record writes the six criterion fields verbatim (tasks_rendered/goals_rendered/round_records_rendered as JSON integers) and refuses a zero-count or empty-host record (fail-closed, AC4 负控制); the AC-232 carrier record writes the three criterion fields verbatim (goal_write_ok/goal_read_back_ok as JSON literals, goal_records as a JSON integer) with a top-level build_sha anchor, truthfully writes false/0 when the goal write fails or read-back is empty (缺件如实非静默, AC4 负控制 — 写调用 0 与空文件同形), and refuses an empty-host record (fail-closed, 硬规则 3b); AC-207 carrier record writes the seven criterion fields verbatim (produced_by_driver=true literal, gate_events>0, task_status=done, commit_sha/task_id non-empty, top-level build_sha) and refuses produced_by_driver=false / gate_events=0 (fail-closed, 硬规则 3b)"
    rc=0
  else
    echo "selfcheck: FAIL — d1=$d1 d2=$d2 a1=$a1 a2=$a2 p1=$p1 p2=$p2 p3=$p3 p4=$p4 p5=$p5 n1=$n1 n2=$n2 s_ok1=$s_ok1 s_cnt1=$s_cnt1 s_ok2=$s_ok2 s_cnt2=$s_cnt2 c3_e=$c3_e c3_ok=$c3_ok c4_e=$c4_e c4_ok=$c4_ok c5_e=$c5_e c5_ok=$c5_ok m1_ev=$m1_ev m1_reg=$m1_reg m1_ok=$m1_ok m1_leak=$m1_leak m2_ok=$m2_ok m3_ok=$m3_ok m3_leak=$m3_leak m4_reg=$m4_reg m4_rc=$m4_rc m4_reason_present=$([ -n "$m4_reason" ] && echo 1 || echo 0) ac203_wrote=$ac203_wrote ac203_fields_ok=$ac203_fields_ok ac203_refused=$ac203_refused ac203_parse_alive=$ac203_parse_alive ac203_parse_recs=$ac203_parse_recs ac201_pos_w=$ac201_pos_w ac201_sha_len=${#ac201_pos_sha} ac201_tgz_len=${#ac201_pos_tgz} ac201_pos_ac=$ac201_pos_ac ac201_neg_w=$ac201_neg_w ac201_neg_lines=$ac201_neg_lines g15_rc=$g15_rc g15_pos=$g15_pos g15_build=$g15_build g16_rc=$g16_rc g16_before=$g16_before g16_after=$g16_after ac206_wrote=$ac206_wrote ac206_fields_ok=$ac206_fields_ok ac206_neg_ok=$ac206_neg_ok ac206_refused=$ac206_refused ac204_wrote=$ac204_wrote ac204_fields_ok=$ac204_fields_ok ac204_refused_fc=$ac204_refused_fc ac204_refused_en=$ac204_refused_en ac205_tc_hit=$ac205_tc_hit ac205_tc_miss=$ac205_tc_miss ac205_wrote=$ac205_wrote ac205_fields_ok=$ac205_fields_ok ac205_ship_refused=$ac205_ship_refused ac205_conf_refused=$ac205_conf_refused ac205_host_refused=$ac205_host_refused ac234_tasks_pos=$ac234_tasks_pos ac234_goals_pos=$ac234_goals_pos ac234_rounds_pos=$ac234_rounds_pos ac234_tasks_neg=$ac234_tasks_neg ac234_goals_neg=$ac234_goals_neg ac234_rounds_neg=$ac234_rounds_neg ac234_wrote=$ac234_wrote ac234_fields_ok=$ac234_fields_ok ac234_refused_zc=$ac234_refused_zc ac234_refused_em=$ac234_refused_em ac232_wrote=$ac232_wrote ac232_fields_ok=$ac232_fields_ok ac232_neg_ok=$ac232_neg_ok ac232_refused=$ac232_refused ac207_wrote=$ac207_wrote ac207_fields_ok=$ac207_fields_ok ac207_refused_pdb=$ac207_refused_pdb ac207_refused_ge=$ac207_refused_ge tp_ok=$tp_ok tp_pos_status=$tp_pos_status tp_pos_launcher=$tp_pos_launcher tp_pos_model=$tp_pos_model tp_pos_auth=$tp_pos_auth tp_neg_status=$tp_neg_status tp_neg_rc=$tp_neg_rc tp_ovr_launcher=$tp_ovr_launcher tp_ovr_model=$tp_ovr_model tp_ovr_auth=$tp_ovr_auth tp_res1=$tp_res1 tp_res2=$tp_res2" >&2
    rc=1
  fi
  rm -rf "$tmp"
  return $rc
}

if [ "$DO_SELFCHECK" = 1 ]; then
  selfcheck
  exit $?
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
  elif [ "$CHANNEL" = "marketplace" ]; then
    # marketplace 通道 = step① 安装路径验证（register-plugin.mjs 注册）；②③ 是 loop 活性验证
    # （npm-global/AC88 的关切），marketplace 通道不跑 ②③ —— register 失败也能写出记录（AC5），
    # 不被 ② quay-init 的失败吞掉 marketplace 结果。
    step1_marketplace
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
echo "AC88_VERIFY=$AC88_VERIFY"
echo "AC238_EVALUATED=$AC238_EVALUATED (1 = 四件读数全成立并已写记录；0 = 未评估 ≠ 不合格——硬规则 3b)"
echo "AC238_PROJECT_ROOT=${AC238_PROJECT_ROOT:-<none>}"
echo "AC238_PRE_TASK_COUNT=$AC238_PRE_TASK_COUNT AC238_POST_TASK_COUNT=$AC238_POST_TASK_COUNT"
echo "AC238_PRE_UPGRADE_RUNTIME_AGE_DAYS=${AC238_RUNTIME_AGE_DAYS:-<unread>} AC238_RUNTIME_REPLACED=$AC238_RUNTIME_REPLACED"
echo "AC238_TASK_LIST_OK=$AC238_TASK_LIST_OK AC238_TASKSET_STABLE=$AC238_TASKSET_STABLE AC238_SAMPLE_TASK=${AC238_SAMPLE_TASK:-<none>}"
echo "AC238_FRESH_RUNTIME_SHA256=${AC238_FRESH_RUNTIME_SHA:-<none>}"

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
