#!/usr/bin/env bash
# @instrument "AC88 三步交付验证机制：① 干净目录全新 .tgz 安装 → ② 项目内 quay-init → ③ 双层(outer+inner)冷启动活性（直接量：git 提交 / /proc cwd / worktree）"
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
#               （安装源 = 本机 .tgz 产物内的插件包，非 dev 树），验证双层机制铺到位 (L1)：
#               outer tick doc (orchestration/orchestrator-loop-tick.md) + inner tick doc
#               (docs/analysis/fast-mode-loop-tick.md) + loop 脚本 (session-liveness.sh) +
#               .quay/config.yml + 项目本地 runtime (.quay/runtime/bin/quay.js)。
#   ③ 冷启动 — 双层 (outer+inner) 活性验证，判据是【直接量】(AC2 / CLAUDE.md 硬规则 4b)：
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
#   send-keys 驱动 inner）。本脚本的 --cold-start-drive 只【编排 shipped 的脚本】（session-bootstrap.sh +
#   loop-driver 注册 + send-keys-reliable.sh 驱动 + task-start 遥测），绝不复制 cold-start 的实现。
#   典型流程：先跑本脚本（①②③，③报 not-live 基线）→ 按 cold-start skill 起双层 →
#   重跑本脚本 --verify-only --require-live 确认 COLDSTART_LIVE=yes。
#   判据能取假：冷启动没做/没活 ⇒ AC88_VERIFY=not-live（非恒绿）。
#
# 运行形态：本脚本在【目标宿主上】运行（B/C 机 local 模式）；跨主机驱动由 develop-deliver-tgz.sh
#   --verify-coldstart 承担（scp 本脚本 + .tgz 过去执行，再取回证据）。
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
#       [--evidence <path>] [--ac89 <path>] [--host <B|C>] [--selfcheck] [--help]
#
#   --build-root <repo> 该次验证【自己】从 <repo> 的 develop-tip 现 build quay+quay-native tgz
#                       （AC5 主路径：build_sha/日期/产物 sha256 全由本脚本取，不引用外部产物），
#                       然后继续 ①②③；与 --tgz/--tgz-native 二选一。
#   --build-sha <sha>   现 build 所用 tgz 对应的 develop commit（跨主机驱动时由 build 方传入；
#                       --build-root 时自动取，无需传）。
#   --build-date <ISO>  该 commit 的提交时间（--build-root 时自动取；跨主机时由 build 方传入）。
#   --verify-only    只跑③（对已存在的 --root 重验冷启动活性；①②被调用方声明已验）。
#   --require-live   ③ 若 COLDSTART_LIVE != yes 则 exit 1（严格验证——冷启动确认跑用）。
#   --selfcheck      全 hermetically 自检（AC1 顺序 + AC2 直接量正/负控制 + AC5 判据正/负控制），不碰真实安装。exit 0/1。
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
    --selfcheck) DO_SELFCHECK=1; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── 直接量探测（AC2 / 硬规则 4b）────────────────────────────────────────────────────────
# 用【外部可核】的直接量判双层活性，不用层自己的心跳自报：
#   L2_GIT_COMMIT_AGE_MIN    --all 最近提交时刻距今分钟数（"-"=无提交）—— loop 产出过工作
#   L2_GIT_IS_QUAYINIT_COMMIT 该提交是否 `chore(quay-init):` 前缀（硬规则 4b：排除安装自己的 auto-commit）
#   L2_INNER_WORKTREE_COUNT  项目 worktree 里在飞 task worktree 数 —— inner 派发过任务
#   L2_LAYER_PROCESS_CWD     /proc/<pid>/cwd 解析到项目根的 claude/node 进程数 —— 双层会话进程活着在项目里
#   L2_STARTUP_PROMPT        双层窗口 pane 是否卡在启动信任弹窗（permission-prompt；复用
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
# Enter to confirm …；session-liveness.sh 已把该弹窗归类为 SESSION-INTERVENTION-REQUIRED，
# busy=0 intervention=1），经 --pane-verdict 接缝（与 session-liveness.sh 的 _sl_pane_verdict 同一
# 判定源）分类双层窗口 pane：
#   任一 outer/inner 窗口 pane 分类为 permission-prompt ⇒ L2_STARTUP_PROMPT=1（进程卡在启动弹窗）。
# 捕获不到 pane（无 tmux / 会话未建 / 窗口缺失）⇒ L2_STARTUP_PROMPT=0 —— 无法观测弹窗，不据此推翻
# proc_ok；这不是恒真项（能观测到弹窗时仍会置 1），git/wt 直接量仍独立判活。
probe_startup_prompt() {
  local root="$1" sess cap verdict socket role
  L2_STARTUP_PROMPT=0
  # 会话名解析（与 session-bootstrap.sh / quay-topology.sh 同源——绝不猜会话名）：
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
  # tmux 控制套接字解析（同 session-liveness.sh 的 SL_TMUX_SOCKET；VC_TMUX_SOCKET 为测试接缝）。
  socket="${VC_TMUX_SOCKET:-}"
  if [ -z "$socket" ] && [ -n "${TMUX_TMPDIR:-}" ]; then socket="${TMUX_TMPDIR}/tmux-$(id -u)/default"; fi
  if [ -z "$socket" ]; then socket="${TMPDIR:-/tmp}/tmux-$(id -u)/default"; fi
  # 双层拓扑窗口 = outer + inner（quay-topology.sh 的 <project>-N:outer / :inner）。
  for role in outer inner; do
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
L1_OUTER_TICK=0; L1_INNER_TICK=0; L1_LOOP_SCRIPTS=0; L1_CONFIG=0; L1_RUNTIME=0
L1_OK=0; L2_OK=0; COLDSTART_LIVE=no
coldstart_verdict() {
  L1_OK=$(( L1_OUTER_TICK && L1_INNER_TICK && L1_LOOP_SCRIPTS && L1_CONFIG && L1_RUNTIME ))
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

# ── L1 双层机制铺到位探测（从盘上重查——full 与 verify-only 共用）────────────────────
probe_l1() {
  local root="$1"
  L1_OUTER_TICK=0; L1_INNER_TICK=0; L1_LOOP_SCRIPTS=0; L1_CONFIG=0; L1_RUNTIME=0
  [ -f "$root/orchestration/orchestrator-loop-tick.md" ] && L1_OUTER_TICK=1
  [ -f "$root/docs/analysis/fast-mode-loop-tick.md" ] && L1_INNER_TICK=1
  [ -f "$root/plugin/scripts/session-liveness.sh" ] && L1_LOOP_SCRIPTS=1
  [ -f "$root/.quay/config.yml" ] && L1_CONFIG=1
  [ -f "$root/.quay/runtime/bin/quay.js" ] && L1_RUNTIME=1
  # 函数始终返回 0：L1 缺件是【数据】（L1_OK=0），不是控制流失败（set -e 不得因 L1 缺件中断）
  return 0
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
  # L1 双层机制铺到位检查（AC1 的 ② 侧）
  probe_l1 "$ROOT"
  STEP2_PROJECT="$ROOT"
  STEP2_OK=1
  echo "  quay-init complete (log → ${ROOT}/quay-init.log)"
  echo "  L1: outer_tick=$L1_OUTER_TICK inner_tick=$L1_INNER_TICK loop_scripts=$L1_LOOP_SCRIPTS config=$L1_CONFIG runtime=$L1_RUNTIME"
  return 0
}

# ③ 脚本化冷启动驱动（编排 shipped 的脚本，不复制实现；best-effort）
COLDSTART_DRIVE_STATE="skipped"
coldstart_drive() {
  local root="$1"
  COLDSTART_DRIVE_STATE="attempted"
  echo "== ③ cold-start drive (orchestrate shipped scripts; agent-driven 部分按 cold-start skill) =="
  local sb
  sb="$root/plugin/scripts/session-bootstrap.sh"
  if ! command -v claude >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1 || [ ! -f "$sb" ]; then
    COLDSTART_DRIVE_STATE="skipped-no-env"
    echo "  cold-start drive: SKIPPED (need claude+tmux on PATH and session-bootstrap.sh laid down)"
    echo "  COLDSTART_OPERATOR_STEPS: run the shipped cold-start skill in the project:"
    echo "    bash ${sb} ${root} inner/outer --session ${TMUX_SESSION}   # (or /quay:cold-start per plugin/skills/cold-start/SKILL.md)"
    return 0
  fi
  # 会话拓扑（shipped session-bootstrap.sh，幂等）+ driver 注册 + 遥测 + 驱动 inner（shipped 脚本）
  bash "$sb" "$root" inner/outer --session "$TMUX_SESSION" >/dev/null 2>&1 || true
  mkdir -p "$root/.quay"
  printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"verify-deliver-coldstart"}' >> "$root/.quay/loop-driver.jsonl" 2>/dev/null || true
  node --no-warnings --experimental-strip-types "$root/plugin/scripts/fast-mode-telemetry.ts" \
    --task-start --taskId "${PROJECT}-verify" --root "$root" >/dev/null 2>&1 || true
  if [ -f "$root/plugin/scripts/send-keys-reliable.sh" ]; then
    bash "$root/plugin/scripts/send-keys-reliable.sh" "$TMUX_SESSION" \
      "执行 $root/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令" \
      "${HOME}/.claude/projects/$(printf '%s' "$root" | tr '/' '-')/verify.jsonl" >/dev/null 2>&1 || true
  fi
  echo "  cold-start drive: launched (session-bootstrap + driver reg + telemetry + inner drive attempt)"
}

# ── ③ 执行 ─────────────────────────────────────────────────────────────────────────────
step3_coldstart() {
  echo "== ③ two-layer (outer+inner) cold-start liveness (DIRECT measures, AC2) =="
  if [ "$COLD_START_DRIVE" = 1 ]; then
    coldstart_drive "$ROOT"
    echo "  waiting ${WAIT}s for the loop to produce direct-measure signals..."
    sleep "$WAIT"
  fi
  # L1 从盘上重查（full 与 verify-only 共用——verify-only 不再依赖 step2 的全局残留）
  probe_l1 "$ROOT"
  probe_direct_measures "$ROOT"
  coldstart_verdict
  echo "  L1: outer_tick=$L1_OUTER_TICK inner_tick=$L1_INNER_TICK loop_scripts=$L1_LOOP_SCRIPTS config=$L1_CONFIG runtime=$L1_RUNTIME (probed from disk)"
  echo "  L2 direct measures (git commit / worktree / /proc cwd — NOT layer heartbeat):"
  echo "    L2_GIT_COMMIT_AGE_MIN=${L2_GIT_COMMIT_AGE_MIN} (<=${LIVENESS_WINDOW}min and not chore(quay-init) = live signal)"
  echo "    L2_GIT_IS_QUAYINIT_COMMIT=${L2_GIT_IS_QUAYINIT_COMMIT} (1 = the recent commit is quay-init's own auto-commit — excluded)"
  echo "    L2_INNER_WORKTREE_COUNT=${L2_INNER_WORKTREE_COUNT} (>=1 = inner dispatched)"
  echo "    L2_LAYER_PROCESS_CWD=${L2_LAYER_PROCESS_CWD} (>=2 = outer+inner processes in project)"
  echo "    L2_STARTUP_PROMPT=${L2_STARTUP_PROMPT} (1 = a two-layer pane is stuck at the startup permission-prompt — proc_ok demoted, hard rule 4b)"
  echo "    L2_DEAD_LOOP_STATE=${L2_DEAD_LOOP_STATE} (shipped L2 criterion, corroboration)"
  if [ "$COLDSTART_LIVE" = "yes" ]; then
    echo "  COLDSTART_LIVE=yes — two-layer loop verified live by direct measures"
  else
    echo "  COLDSTART_LIVE=no — cold-start not verified live. This is DATA, not a defect:"
    echo "    · if the cold-start has not been performed yet: perform it per plugin/skills/cold-start/SKILL.md"
    echo "      (or bash ${ROOT}/plugin/scripts/session-bootstrap.sh ${ROOT} inner/outer), then re-run with --verify-only --require-live."
    echo "    · if it was performed: the direct measures show no live outer+inner — investigate (dead loop)."
  fi
}

# ── 自检（hermetic：AC1 顺序 + AC2 直接量正/负控制，不碰真实安装）────────────────────────
selfcheck() {
  local tmp rc=1
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck: FAIL 无法创建临时目录" >&2; return 1; }
  local dead_ws alive_ws

  # control 1 (AC2 负向/negative)：无冷启动 + 只有 quay-init auto-commit ⇒ 判 not live
  #   结构上必须取假：即便 git 提交很新（quay-init 铺完刚提交），因为是 chore(quay-init) 提交，
  #   直接量判据必须【排除】它 ⇒ L2_OK=0 ⇒ COLDSTART_LIVE=no。
  dead_ws="$tmp/dead"
  mkdir -p "$dead_ws/orchestration" "$dead_ws/docs/analysis" "$dead_ws/plugin/scripts" \
           "$dead_ws/.quay/runtime/bin" "$dead_ws/tasks"
  printf '# outer\n' > "$dead_ws/orchestration/orchestrator-loop-tick.md"
  printf '# inner\n' > "$dead_ws/docs/analysis/fast-mode-loop-tick.md"
  printf '#!/bin/bash\n' > "$dead_ws/plugin/scripts/session-liveness.sh"
  printf 'providers: {}\n' > "$dead_ws/.quay/config.yml"
  printf '//x\n' > "$dead_ws/.quay/runtime/bin/quay.js"
  git -C "$dead_ws" init -q -b main >/dev/null 2>&1
  git -C "$dead_ws" config user.email t@t >/dev/null 2>&1
  git -C "$dead_ws" config user.name t >/dev/null 2>&1
  echo x > "$dead_ws/a.txt"
  git -C "$dead_ws" add -A >/dev/null 2>&1
  git -C "$dead_ws" commit -qm "chore(quay-init): lay down quay plugin mechanism files (v0.4.0)" >/dev/null 2>&1
  L1_OUTER_TICK=1; L1_INNER_TICK=1; L1_LOOP_SCRIPTS=1; L1_CONFIG=1; L1_RUNTIME=1
  probe_direct_measures "$dead_ws"
  coldstart_verdict
  local d1 d2
  d1="$L1_OK"; d2="$COLDSTART_LIVE"

  # control 2 (AC2 正向/positive)：近期【非 chore】提交 + 机制铺到位 ⇒ 判 live
  alive_ws="$tmp/alive"
  mkdir -p "$alive_ws/orchestration" "$alive_ws/docs/analysis" "$alive_ws/plugin/scripts" \
           "$alive_ws/.quay/runtime/bin" "$alive_ws/tasks"
  printf '# outer\n' > "$alive_ws/orchestration/orchestrator-loop-tick.md"
  printf '# inner\n' > "$alive_ws/docs/analysis/fast-mode-loop-tick.md"
  printf '#!/bin/bash\n' > "$alive_ws/plugin/scripts/session-liveness.sh"
  printf 'providers: {}\n' > "$alive_ws/.quay/config.yml"
  printf '//x\n' > "$alive_ws/.quay/runtime/bin/quay.js"
  git -C "$alive_ws" init -q -b main >/dev/null 2>&1
  git -C "$alive_ws" config user.email t@t >/dev/null 2>&1
  git -C "$alive_ws" config user.name t >/dev/null 2>&1
  echo x > "$alive_ws/a.txt"
  git -C "$alive_ws" add -A >/dev/null 2>&1
  git -C "$alive_ws" commit -qm "chore(quay-init): lay down quay plugin mechanism files (v0.4.0)" >/dev/null 2>&1
  echo y >> "$alive_ws/a.txt"
  git -C "$alive_ws" add -A >/dev/null 2>&1
  git -C "$alive_ws" commit -qm "inner: dispatch gap-something (real loop work)" >/dev/null 2>&1
  L1_OUTER_TICK=1; L1_INNER_TICK=1; L1_LOOP_SCRIPTS=1; L1_CONFIG=1; L1_RUNTIME=1
  probe_direct_measures "$alive_ws"
  coldstart_verdict
  local a1 a2
  a1="$L1_OK"; a2="$COLDSTART_LIVE"

  echo "selfcheck: dead(no-real-loop,recent-chore-commit) L1_OK=$d1 COLDSTART_LIVE=$d2 (expect 1/no)"
  echo "selfcheck: alive(recent-non-chore-commit) L1_OK=$a1 COLDSTART_LIVE=$a2 (expect 1/yes)"

  # control 6 (AC2 负向 —— proc_ok 假阳性回归, gap-verify-deliver-coldstart-l2-proc-ok-false-positive):
  # 进程存在(>=2)但双层 pane 卡启动信任弹窗（L2_STARTUP_PROMPT=1）⇒ proc_ok 不得单独撑起 ⇒
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
  # （同一判定源：session-liveness.sh 的 _sl_pane_verdict / classifyPaneVerdict）。
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

  if [ "$d1" = "1" ] && [ "$d2" = "no" ] && [ "$a1" = "1" ] && [ "$a2" = "yes" ] \
     && [ "$c3_e" = "1" ] && [ "$c3_ok" = "1" ] \
     && [ "$c4_e" = "1" ] && [ "$c4_ok" = "0" ] \
     && [ "$c5_e" = "0" ] && [ "$c5_ok" = "0" ] \
     && [ "$p1" = "0" ] && [ "$p2" = "no" ] \
     && [ "$p3" = "1" ] && [ "$p4" = "yes" ] \
     && [ "$p5" = "1" ]; then
    echo "selfcheck: PASS — AC2 direct measures can take false (chore auto-commit excluded; proc_ok demoted by startup-prompt) and true (loop work; proc_ok + passed-prompt); AC5 can take false (old build), true (recent build), and be distinct when not evaluated"
    rc=0
  else
    echo "selfcheck: FAIL — d1=$d1 d2=$d2 a1=$a1 a2=$a2 p1=$p1 p2=$p2 p3=$p3 p4=$p4 p5=$p5 c3_e=$c3_e c3_ok=$c3_ok c4_e=$c4_e c4_ok=$c4_ok c5_e=$c5_e c5_ok=$c5_ok" >&2
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
  if ! step2_init; then
    echo "AC88_VERIFY=fail (step ② quay-init failed)"
    exit 1
  fi
  step3_coldstart
fi

if [ -z "$EVIDENCE" ]; then EVIDENCE="${CWD}/.quay/verify-deliver-evidence.json"; fi
if [ -z "$AC89" ]; then AC89="${CWD}/.quay/productization-verification.jsonl"; fi

# ── 判定 ─────────────────────────────────────────────────────────────────────────────
if [ "$VERIFY_ONLY" = 1 ]; then
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
echo "NPM_BIN_DISPATCH=$NPM_BIN_DISPATCH"
echo "L1_OUTER_TICK=$L1_OUTER_TICK L1_INNER_TICK=$L1_INNER_TICK L1_LOOP_SCRIPTS=$L1_LOOP_SCRIPTS L1_CONFIG=$L1_CONFIG L1_RUNTIME=$L1_RUNTIME"
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
echo "AC88_VERIFY=$AC88_VERIFY"

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
  "l2_ok": $L2_OK,
  "l2_git_commit_age_min": "$L2_GIT_COMMIT_AGE_MIN",
  "l2_git_is_quayinit_commit": $L2_GIT_IS_QUAYINIT_COMMIT,
  "l2_inner_worktree_count": $L2_INNER_WORKTREE_COUNT,
  "l2_layer_process_cwd": $L2_LAYER_PROCESS_CWD,
  "l2_startup_prompt": $L2_STARTUP_PROMPT,
  "l2_dead_loop_state": "$L2_DEAD_LOOP_STATE",
  "coldstart_live": "$COLDSTART_LIVE",
  "ac88_verify": "$AC88_VERIFY",
  "liveness_window_min": $LIVENESS_WINDOW
}
EOF
echo "evidence written → $EVIDENCE"

# ── AC89 记录（同 per-task-suite-records 形态，JSON 行；AC89 AC4: B/C 两机 + 安装/初始化/冷启动三项）──
mkdir -p "$(dirname "$AC89")"
detail="steps: install(1)=$STEP1_OK init(2)=$STEP2_OK coldstart(3) live=$COLDSTART_LIVE git_age=${L2_GIT_COMMIT_AGE_MIN}min quayinit_commit=$L2_GIT_IS_QUAYINIT_COMMIT worktree=$L2_INNER_WORKTREE_COUNT proc_cwd=$L2_LAYER_PROCESS_CWD startup_prompt=$L2_STARTUP_PROMPT dead_loop=$L2_DEAD_LOOP_STATE build_sha=${BUILD_SHA:-} build_date=${BUILD_DATE:-} sha256_quay=${SHA256_QUAY:-0} sha256_qn=${SHA256_QN:-0} ac5_ok=$AC5_OK"
okflag=false; [ "$AC88_VERIFY" = "ok" ] && okflag=true
step3=0; [ "$COLDSTART_LIVE" = "yes" ] && step3=1
bool() { [ "$1" = "1" ] && printf true || printf false; }
host_json=""
[ -n "$HOST" ] && host_json=",\"host\":\"$HOST\""
printf '{"ts":"%s","ac":"AC88","ok":%s,"artifact":"%s","evidence":"%s","detail":"%s"%s,"stepInstall":%s,"stepInit":%s,"stepColdstart":%s}\n' \
  "$TS" "$okflag" "$(basename "$QUAY_TGZ")" "$EVIDENCE" "$detail" "$host_json" \
  "$(bool "$STEP1_OK")" "$(bool "$STEP2_OK")" "$(bool "$step3")" >> "$AC89"
echo "ac89 record appended → $AC89"

if [ "$REQUIRE_LIVE" = 1 ] && [ "$COLDSTART_LIVE" != "yes" ]; then
  echo "verify-deliver-coldstart: FAIL (--require-live but COLDSTART_LIVE=$COLDSTART_LIVE)"
  exit 1
fi
if [ "$AC88_VERIFY" = "fail" ]; then
  echo "verify-deliver-coldstart: FAIL (one of the three steps not verified, or AC5 evidence not met)"
  exit 1
fi
echo "verify-deliver-coldstart: done (AC88_VERIFY=$AC88_VERIFY)"
exit 0
