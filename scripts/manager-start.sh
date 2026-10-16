#!/usr/bin/env bash
# manager-start.sh — C4/C5: `quay manager start`（无项目参数）独立拉起 manager。
# (gap-manager-productization-five-constraints AC1/AC2/AC5)
#
# 角色（gap-manager-skill-session-embodiment-activation，2026-09-06）：本脚本是【备选路径】——
# 仅用于第三方裸机冷启动场景（无 quay 开发树）拉起独立 tmux 会话。日常激活的【默认路线】是
# 会话内调用 manager skill（见 plugin/skills/manager/SKILL.md）——当前会话变身为 manager，不另起
# 会话、不敲 tmux/CLI。两条路线同时可用：①默认 = skill 激活（会话内）②备选 = 本脚本（机器冷启动）。
#
# 规格：SPEC-manager-productization-2026-08-05 §4.1。manager 的启动与启动项目完全分开：
#   - `manager start` 不接受任何项目参数（C5：两条命令分开，不是一条带参数的命令）
#   - 建自己的会话：独立 tmux session，名字显式优先序 = --session / MANAGER_START_SESSION /
#     启动器解析出的 profiles roles.manager.name；**都不给时按 <repo> 绝对路径派生**
#     （不再用固定字面量 `quay-manager`——两个同名 checkout 会争抢同一个会话名，见下方 §会话名与归属），
#     不进任何项目的 session（C2：身份不属于任何单个项目）
#   - 设自己的家：$QUAY_GLOBAL_DIR/manager/（状态、tick 日志、观测器配置；C2）
#   - 起会话时锚点确定性建立（AC5）：装上 manager 自己的 `/loop` 作为其中一步——冷启动后锚点必然
#     在位。本脚本负责把「武装」的确定性步骤做成出厂命令（manager-arm-loop.sh），而不是靠谁记得。
#
# 2026-08-06 范围收窄（人裁定）：OS watchdog / OS cron / Desktop 定时任务全部禁用；唯一允许的调度
# 锚点是 Claude Code 自己的 loop/cron（AC5）。本脚本不装 systemd unit、不写 crontab。
#
# 用法：
#   manager-start.sh [--session <sess>] [--dry-run] [--json] [--home <dir>]
#     --session <sess>    目标 tmux 会话（默认：MANAGER_START_SESSION → 启动器解析出的
#                         profiles roles.manager.name → 按 <repo> 绝对路径派生的
#                         quay-manager-<8 位摘要>；见下方 §会话名与归属）
#     --dry-run           只打印将执行的命令，不实际改动（校验用）
#     --json              JSON 输出（机器消费）；默认人读表格 + 退出码
#     --home <dir>        覆盖 manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/ → $HOME/.quay-global/manager/）
#
# 会话名与归属（gap-manager-start-tmux-session-name-not-path-derived，2026-10-08）：
#   默认名按 <repo> 绝对路径派生（quay-manager-<8 位摘要>）——两个都叫 "quay" 的不同 checkout
#   得到不同名字，不再争抢共享 tmux server 上的同一个字面量。建会话时把本 root 写进会话的
#   tmux 用户选项 @quay_manager_root（归属记录）；之后每次调用若同名会话已存在，先【核验归属】：
#     · 归属 = 本 root                          ⇒ in-place（幂等，不重建）
#     · 归属 = 另一个 root                      ⇒ fail-closed，不静默附着
#     · 无归属记录 且 名字是脚本派生的（无人选过）⇒ fail-closed（无法证明是我的）
#     · 无归属记录 且 名字是 --session/env/profiles 显式给的 ⇒ in-place（沿用既有语义）
#   fail-closed 的报错给出两条出路：`--session <name>` 或 `tmux kill-session -t <name>`。
#
# 冷启动判据（gap-manager-cold-start-no-falsifiable-checklist AC2/AC4）：
#   本脚本在 manager 家下写一份可证伪产物——
#     <home>/cold-start-checklist.md   —— 5 条 observable consequences，
#                                        冷启动完成 = 五键全 true；一条为假 ⇒ 未完成
#   启动本身完成 SESSION-CREATED / HOME-CREATED / LOOP-ARMED 三键；CRON-EVIDENCED
#   与 CHECKLIST-REPORTED 由首 tick 填（manager-tick-core.md B4/A10）。
#
# 测试接缝：
#   MANAGER_START_SESSION         覆盖会话名
#   MANAGER_START_REPO_ROOT       覆盖仓库根（默认 <script>/../..；测试用两个不同 root 验证
#                                 默认会话名按路径派生、互不相等）
#   MANAGER_START_HOME            覆盖家目录（等价 --home）
#   MANAGER_LAUNCH_CMD            覆盖「拉起会话」的运行命令（默认 <repo>/plugin/scripts/quay-launch.sh manager）
#   MANAGER_ARM_CMD               覆盖「武装 loop」命令（默认 <repo>/plugin/scripts/manager-arm-loop.sh；
#                                 测试可喂 `true` 等无害命令）
#   TOPOLOGY_LOCK_DIR / TOPOLOGY_LOCK_RETRIES / TOPOLOGY_LOCK_STALE_SECONDS
#                                 传给 quay-topology.sh 的单飞锁参数（本脚本对 manager 会话复用同一锁）
#
# 纯读/少写契约：本脚本只建 manager 自己的家与会话，不碰任何项目的文件/会话。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# 仓库根：默认 = 脚本位置上溯两级。MANAGER_START_REPO_ROOT 是测试接缝（同一台机上让两个不同 root
# 各跑一次本脚本，验证默认会话名互不相等——AC1）。解析为绝对物理路径：会话名与归属比较都按它。
if [ -n "${MANAGER_START_REPO_ROOT:-}" ]; then
  if ! REPO_ROOT="$(cd "$MANAGER_START_REPO_ROOT" 2>/dev/null && pwd -P)"; then
    echo "ERROR: manager-start: MANAGER_START_REPO_ROOT is not a readable directory: $MANAGER_START_REPO_ROOT" >&2
    exit 2
  fi
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
fi

# ── 默认会话名：按【仓库根路径】派生（不是项目名，也不是固定字面量）────────────────────────────
# 旧行为是字面常量 `quay-manager`：两个都叫 "quay" 的不同 checkout（生产检出 + dogfood clone）在
# 【共享的 tmux server】上争抢同一个名字，后启动的一方静默附着到先启动者的会话。
# 手法对齐 Core 的 scopeUnitName（按路径派生，⛔ 不按项目名/不按固定常量），但【不带时间戳】：
# 名字必须能被下一次 `tmux has-session` 稳定寻址；带时间戳会让每次调用都换名 ⇒ 永远新建、
# 幂等失效、每轮留一个垃圾会话。
# ⊢ 判据（可证伪）：同一 root 两次 ⇒ 同名；两个不同 root ⇒ 不同名（AC1）。
manager_default_session_name() {
  local root="$1" digest=""
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(printf '%s' "$root" | sha256sum | cut -c1-8)"
  elif command -v shasum >/dev/null 2>&1; then
    digest="$(printf '%s' "$root" | shasum -a 256 | cut -c1-8)"
  elif command -v md5sum >/dev/null 2>&1; then
    digest="$(printf '%s' "$root" | md5sum | cut -c1-8)"
  fi
  if [ -n "$digest" ]; then
    printf 'quay-manager-%s\n' "$digest"
  else
    # 无任何哈希工具：退化为【整条路径】的 slug——仍按路径、仍 root 唯一，只是更长。
    # ⛔ 不用 basename：两个 root 都叫 "quay" 正是要区分的那个情形。
    printf 'quay-manager-%s\n' "$(printf '%s' "$root" | tr -c 'A-Za-z0-9_.-' '-' | sed 's/^-\+//')"
  fi
}

# 归属记录：建会话时把本 root 写进会话的 tmux 用户选项（`@` 前缀 = user option，不与 tmux 内置
# 选项冲突）。下次调用据此区分「我自己建的」与「另一个 root 建的同名会话」。
OWNER_OPTION="@quay_manager_root"

SESSION="${MANAGER_START_SESSION:-}"
# SESSION_DERIVED=1 ⇔ 名字是本脚本【自己按路径派生】的（--session / MANAGER_START_SESSION /
# profiles.yml 都没给）。归属核验对「无人选过的派生名」必须 fail-closed——见 §会话名与归属。
SESSION_DERIVED=0
DRY_RUN=0
JSON=0
HOME_DIR="${MANAGER_START_HOME:-}"

usage() {
  sed -n '1,61p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON=1; shift ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: manager start accepts NO project args (C5: start 与 adopt 分开). Unknown argument: $1" >&2
      echo "       (expected --session <sess> | --dry-run | --json | --home <dir>)" >&2
      exit 2
      ;;
  esac
done

# ── 家目录（C2：不属于任何项目）────────────────────────────────────────────────────────────
QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"

# ── 会话名：显式 > 环境 > 启动器解析出的 roles.manager.name → 按本 root 派生（AC1）──────────────
# ⛔ 本脚本【不再自己解析 profiles.yml】（原实现内联 `python3 -c 'import yaml…'`）。两条理由：
#   ① 单源：这个名字同时就是 quay-launch.sh 交给 claude 的 `-n`（两者都取自 profiles 的
#      roles.<role>.name）。问启动器一次 ⇒ 二者不可能漂移；本脚本再自己解析一遍就是【第二个读者】
#      （「修了一份、另一份没修」是该仓库已命名的缺陷类：profiles-role-coverage-check.ts 的存在理由）。
#   ② sh-census 棘轮只降不升（plugin/sh-census-check.ts，上限见 plugin/sh-census-baseline.json）：
#      【含内嵌解释器的 .sh 的全部代码行】计入 embeddedInterpreterLines ⇒ 本文件此前因这一个 python3
#      调用，整份行数都被计费，本次修复的任何新增行都会顶破棘轮。改为纯 bash 后本文件离开该棘轮
#      （读数下降 = 棘轮本来要的方向），新增行不再受限。
# 读的是 `quay-launch.sh manager --dry-run` 计划行里的 ` -n <name>`；该行形状已被
# plugin/test/manager-install-vector.test.mjs 的 /-n quay-manager/ 断言钉住。取不到（无 profiles.yml /
# 无 PyYAML / 启动器不在树里 / role 无 name）⇒ 空 ⇒ 走下面的按路径派生——安全的默认，绝不产生错名。
if [ -z "$SESSION" ]; then
  SESSION="$(bash "$REPO_ROOT/plugin/scripts/quay-launch.sh" manager --dry-run 2>/dev/null \
    | sed -n 's/.*[[:space:]]-n[[:space:]]\([^[:space:]]*\).*/\1/p' | tail -1)"
fi
if [ -z "$SESSION" ]; then
  # 无人显式选过名字 ⇒ 按本 root 路径派生（AC1：两个不同 root ⇒ 两个不同名字）。记住这一事实，
  # 归属核验要按它区分「派生名」与「人选名」。
  SESSION="$(manager_default_session_name "$REPO_ROOT")"
  SESSION_DERIVED=1
fi

# ── 启动命令（默认 quay-launch.sh manager；测试接缝覆盖）────────────────────────────────────
LAUNCH_CMD="${MANAGER_LAUNCH_CMD:-bash $REPO_ROOT/plugin/scripts/quay-launch.sh manager}"

# ── 武装 loop 命令（AC5：起会话时锚点确定性建立；默认 manager-arm-loop.sh）──────────────────
# 值 = 一个可执行路径（脚本 / 命令）。manager-start 用 `bash <path> --home …` 调用。
ARM_CMD="${MANAGER_ARM_CMD:-$REPO_ROOT/plugin/scripts/manager-arm-loop.sh}"

# ── 冷启动可证伪产物（AC2/AC4）─────────────────────────────────────────────────────────────
# 写 checklist（缺则建）——单一正本，避免多处复制同一 heredoc 造成漂移。
_ensure_cold_start_artifacts() {
  # 家目录必须先建（幂等）。
  mkdir -p "$HOME_DIR"

  # <home>/cold-start-checklist.md —— 5 条 observable consequences。
  # 冷启动完成 = 五键全 true；一条为假 ⇒ 未完成。启动态填三键，首 tick 填其余（B4/A10）。
  CHECKLIST="$HOME_DIR/cold-start-checklist.md"
  if [ ! -f "$CHECKLIST" ]; then
    cat > "$CHECKLIST" <<'MDEOF'
# manager cold-start — observable consequences（falsifiable checklist）

冷启动完成判据 = 下列 5 条可证伪项**全部为真**。
一条为假 ⇒ manager 冷启动未完成。每键给出可检查判据与证据。

| # | Key | 可检查判据 | 证据 |
|---|---|---|---|
| 1 | SESSION-CREATED | `tmux has-session -t <SESSION>` 且 pane 有 claude 进程（非裸 bash） | 启动时已建会话（manager-start.sh） |
| 2 | HOME-CREATED | `<home>/identity` 存在，含 `role=manager` | 启动时已写（manager-start.sh） |
| 3 | LOOP-ARMED | `manager-arm-loop.sh --home <home> --validate` 退出 0，且 `<home>/loop-registry.txt` 恰一条 `[manager-tick]` | 启动时已武装（manager-arm-loop.sh；失败时 manager-start 非零退出） |
| 4 | CRON-EVIDENCED | `manager-arm-loop.sh --home <home> --verify-cron` 退出 0（注册表↔真 CronCreate/CronList 证据一致且新鲜） | 首 tick 填（manager-tick-core.md B4 记 `<home>/cron-evidence.jsonl`） |
| 5 | CHECKLIST-REPORTED | 本文件五键全为 true 且各有证据 | 全部填完后为 true |

启动态预期满足：#1 #2 #3（arm 失败时 manager-start 非零退出）。待首 tick：#4 #5。全 true 才可报 COMPLETE。
MDEOF
  fi
}

if [ "$DRY_RUN" = 1 ]; then
  cat <<EOF
would-create-home: mkdir -p $HOME_DIR
would-write-identity: $HOME_DIR/identity
would-write-checklist: $HOME_DIR/cold-start-checklist.md
would-launch-session: tmux new-session -d -s $SESSION -n manager -c $REPO_ROOT "$LAUNCH_CMD"
would-arm-loop: $ARM_CMD --home $HOME_DIR
EOF
  exit 0
fi

# ── 归属核验（AC2）：在任何写入之前，先判同名会话是否确属本 root ─────────────────────────────
# 归属记录 = 建会话时写在会话上的 tmux 用户选项 @quay_manager_root。
# 两处判定（此处预检 / 建会话失败后的重判）共用【同一套谓词】——不允许预检严、重判松。
_existing_owner() { tmux show-options -t "$1" -v "$OWNER_OPTION" 2>/dev/null || true; }
_may_adopt() { [ "$1" = "$REPO_ROOT" ] && return 0; [ -z "$1" ] && [ "$SESSION_DERIVED" = 0 ] && return 0; return 1; }

# 三态判定（⛔ 不把「读不懂归属」与「归属合格」并成同一个值——硬规则 3b/6）：
#   归属 = 本 root                            ⇒ 可复用（幂等）
#   归属 = 另一个 root                        ⇒ 不可复用（明确外来，任何名字来源都拒）
#   无记录 且 名字是脚本派生的（无人选过）      ⇒ 不可复用（无法证明是我的）
#   无记录 且 名字是 --session/env/profiles 给的 ⇒ 可复用（沿用既有语义：名字是人选的）
_refuse_foreign_session() {
  local owner="$1"
  echo "ERROR: manager-start: tmux session '$SESSION' already exists but is NOT owned by this repo root." >&2
  echo "       session owner : ${owner:-<no $OWNER_OPTION record>}" >&2
  echo "       this repo root: $REPO_ROOT" >&2
  echo "       Refusing to silently attach to / reuse a session that may belong to another checkout." >&2
  echo "       → target it deliberately with --session '<name>', or kill it: tmux kill-session -t '$SESSION'" >&2
  exit 1
}

if tmux has-session -t "$SESSION" 2>/dev/null; then
  _PRE_OWNER="$(_existing_owner "$SESSION")"
  _may_adopt "$_PRE_OWNER" || _refuse_foreign_session "$_PRE_OWNER"
fi

# ── 建家（幂等）────────────────────────────────────────────────────────────────────────────
mkdir -p "$HOME_DIR"
IDENTITY="$HOME_DIR/identity"
if [ ! -f "$IDENTITY" ]; then
  printf 'role=manager\nsession=%s\ncreated=%s\n' "$SESSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$IDENTITY"
fi

# ── 冷启动可证伪产物（AC2/AC4）────────────────────────────────────────────────────────────
# 写 checklist（缺则建）。同一正本见函数定义。
_ensure_cold_start_artifacts

# ── 建独立会话（幂等：会话已存在且归属已核验 ⇒ 不动）────────────────────────────────────────
CREATED_SESSION=0
if tmux has-session -t "$SESSION" 2>/dev/null; then
  # 预检已核验过；此处按同一套谓词【重判】一次（写 identity/checklist 期间可能有别的进程建会话）。
  _NOW_OWNER="$(_existing_owner "$SESSION")"
  _may_adopt "$_NOW_OWNER" || _refuse_foreign_session "$_NOW_OWNER"
  SESSION_STATE="in-place"
else
  # 复用 quay-topology.sh 的单飞锁语义：双创建者竞态不双重创建（AC6）。manager 会话与项目会话
  # 不同锁名（锁按会话名寻址），互不争抢。
  # -c "$REPO_ROOT"：pane 起始 cwd = 本 root（会话在语义上确实属于这个 checkout）。
  if tmux new-session -d -s "$SESSION" -n manager -c "$REPO_ROOT" "$LAUNCH_CMD" >/dev/null 2>&1; then
    CREATED_SESSION=1
    SESSION_STATE="created"
    # 写归属记录（best-effort）：下次调用据此认出「这是我自己建的」。写不上（tmux 无 user option）
    # ⇒ 下次同名命中判「无记录」；派生名下那是 fail-closed——正是要的保守方向（硬规则 3b）。
    tmux set-option -t "$SESSION" "$OWNER_OPTION" "$REPO_ROOT" >/dev/null 2>&1 || true
  else
    # 可能恰好被并发创建者抢先——再查一次，仍不在则报错；在的话按【与预检同一套归属谓词】重判，
    # ⛔ 不因为「刚才还没有」就假定是我建的。
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      _POST_OWNER="$(_existing_owner "$SESSION")"
      _may_adopt "$_POST_OWNER" || _refuse_foreign_session "$_POST_OWNER"
      SESSION_STATE="in-place"
    else
      echo "ERROR: manager-start: could not create tmux session $SESSION" >&2
      exit 1
    fi
  fi
fi

# ── 武装 loop（AC5：冷启动后锚点必然在位；幂等 + 哨兵清扫见 manager-arm-loop.sh）──────────
if ! bash "$ARM_CMD" --home "$HOME_DIR" >/tmp/manager-arm.out 2>&1; then
  echo "WARNING: manager-start: arm-loop step failed (see /tmp/manager-arm.out) — anchor not guaranteed" >&2
  ARM_STATE="failed"
else
  ARM_STATE="armed"
fi

# 冷启动键（AC2 + AC5）：#1 SESSION-CREATED / #2 HOME-CREATED / #3 LOOP-ARMED 在启动后即为真；
# #4 CRON-EVIDENCED / #5 CHECKLIST-REPORTED 由首 tick 填。
CHECKLIST_EXISTS=$([ -f "$CHECKLIST" ] && echo true || echo false)

if [ "$JSON" = 1 ]; then
  cat <<EOF
{"session":"$SESSION","home":"$HOME_DIR","sessionState":"$SESSION_STATE","armState":"$ARM_STATE","checklist":"$CHECKLIST","checklistWritten":$CHECKLIST_EXISTS,"created":$([ "$CREATED_SESSION" = 1 ] && echo true || echo false)}
EOF
else
  printf '%-14s %s\n' "session" "$SESSION"
  printf '%-14s %s\n' "home" "$HOME_DIR"
  printf '%-14s %s\n' "session-state" "$SESSION_STATE"
  printf '%-14s %s\n' "arm-state" "$ARM_STATE"
  printf '%-14s %s\n' "checklist" "$CHECKLIST ($([ "$CHECKLIST_EXISTS" = true ] && echo 'written — 5 keys, #1-#3 启动态已真' || echo MISSING))"
  if [ "$ARM_STATE" = "armed" ]; then
    echo "manager started: $SESSION ($HOME_DIR)"
  else
    echo "manager started: $SESSION ($HOME_DIR) — WARNING: loop anchor not armed"
  fi
fi

# 失败即非零：会话建不起来或锚没装上都要大声，不能静默绿。
if [ "$CREATED_SESSION" = 0 ] && [ "$SESSION_STATE" = "in-place" ]; then
  exit 0
fi
[ "$ARM_STATE" = "armed" ] || exit 1
exit 0
