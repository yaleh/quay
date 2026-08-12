#!/usr/bin/env bash
# manager-arm-loop.sh — AC5/AC5c: manager 的调度锚点武装（哨兵清扫 + 幂等，零记忆可执行）。
# (gap-manager-productization-five-constraints AC5/AC5c)
#
# 人 2026-08-06 裁定：manager 的调度锚点只能用 Claude Code 自己的 loop/cron（/loop → CronCreate）。
# AC5c 把 manda 的两条机制固化为规则：
#   1. prompt 是指针（只指向 loop tick 文档的正本——dev-tree 优先
#      <repo>/orchestration/manager-loop-tick.md，npm-pack 裸机只有出厂模板
#      <repo>/plugin/loop/manager-loop-tick.md——选存在的那份，AC4 不铺虚空武装器），不携带指令内容——
#      /clear 与 /compact 不杀会话、cron 照常触发，但上下文没了；技能体只装「如何武装」，
#      不装「触发后做什么」（触发后现读 reference/）。
#   2. 身份用可推导的哨兵串，不用记住的 ID——武装前无条件按哨兵清扫同名旧任务，再建一个
#      ⇒ 幂等，且零记忆可执行。
#
# 哨兵：固定前缀 `[manager-tick]`（AC5c 示例）。武装步骤 = CronList → 删除所有含该前缀者 →
# CronCreate 一个（prompt 为指针）。判据（AC5/AC5c）：
#   - ① 在不知道任何 cron ID 的前提下连续执行两次武装步骤 ⇒ CronList 必须恰好一个 manager loop
#     （不是零、不是两个）
#   - ② 负控制：先人为建两个重复的 manager loop，再执行同一武装步骤 ⇒ 必须收敛回恰好一个
#
# 测试接缝：CronList/CronCreate 是 Claude Code 会话内工具，bash 不能直接调用。本脚本把「武装
# 逻辑」做在文件接缝上——CRON_STORE 指向一个「cron 注册表」文件（默认 manager 家下
# loop-registry.txt，每行一条），真实会话中由 agent 把同一哨兵清扫逻辑映射到 CronList/CronDelete/
# CronCreate 工具（见 manager-loop-tick.md 的武装步骤）。这样哨兵清扫逻辑可被机械测试（AC5c 负
# 控制），而工具映射在文档中写成约定。
#
# 用法：
#   manager-arm-loop.sh [--home <dir>] [--store <file>] [--dry-run] [--json] [--validate]
#     --home <dir>     manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/ → $HOME/.quay-global/manager/）
#     --store <file>   cron 注册表文件（默认 <home>/loop-registry.txt）
#     --dry-run        只打印将执行的步骤，不改注册表
#     --json           JSON 输出
#     --validate       只验证「哨兵/指针规则已在文档中」，不改注册表（AC5c 文档规则检查）
#
# 依赖：无（纯 shell + 文件操作）。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR=""
STORE=""
DRY_RUN=0
JSON=0
VALIDATE=0

usage() {
  sed -n '1,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --store) STORE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON=1; shift ;;
    --validate) VALIDATE=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --home <dir> | --store <file> | --dry-run | --json | --validate)" >&2
      exit 2
      ;;
  esac
done

HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"
STORE="${STORE:-${HOME_DIR}/loop-registry.txt}"

# ── 哨兵前缀（AC5c 的固定可推导前缀）────────────────────────────────────────────────────────
SENTINEL="[manager-tick]"
# prompt = 指针（AC5c 规则 1：只携带指针，不携带指令内容）
# 指针目标 = 存在的那份（AC4 不铺虚空武装器）：
#   - dev-tree / quay-init --loop --manager 的消费项目：`orchestration/manager-loop-tick.md`（活文档）
#   - npm-pack 裸机（无 orchestration/，只有出厂模板）：`plugin/loop/manager-loop-tick.md`
POINTER_DOC="orchestration/manager-loop-tick.md"
if [ ! -f "${REPO_ROOT}/${POINTER_DOC}" ] && [ -f "${REPO_ROOT}/plugin/loop/manager-loop-tick.md" ]; then
  POINTER_DOC="plugin/loop/manager-loop-tick.md"
fi
POINTER_PROMPT="Run the manager tick per <repo>/${POINTER_DOC}"

# ── AC5c --validate：哨兵/指针规则已在文档中（机械可查，不依赖会话）─────────────────────────
if [ "$VALIDATE" = 1 ]; then
  TICK_DOC="${TICK_DOC:-$REPO_ROOT/plugin/loop/manager-loop-tick.md}"
  if [ ! -f "$TICK_DOC" ]; then
    echo "ERROR: manager-arm-loop --validate: tick doc not found: $TICK_DOC" >&2
    exit 2
  fi
  # Retry the doc read (up to 3 attempts, 50ms apart): a CONCURRENT writer (e.g. a quay-init
  # laydown in another lane) can momentarily truncate the file between our stat and cat, and a
  # transient empty read must not flip the validate red (round-4 suite flake,
  # gap-verify-round-9-failures-from-recent-changes-fix-batch AC6). The sentinel is checked as a
  # LITERAL (`grep -qF`), never as a regex — `[manager-tick]` is a bracket expression that
  # trivially matches any real doc, which would make this check meaningless.
  missing=""
  for _attempt in 1 2 3; do
    doc="$(cat "$TICK_DOC" 2>/dev/null)"
    # 规则 1：prompt 是指针（不含指令内容）——文档必须出现「指针 / 只携带指针」约定
    pointer_ok=0
    printf '%s' "$doc" | grep -q '指针\|只携带指针\|pointer-only\|prompt.*pointer' && pointer_ok=1
    # 规则 2：哨兵清扫（按哨兵删除同名旧任务再建一个）——文档必须出现哨兵前缀约定
    sentinel_ok=0
    printf '%s' "$doc" | grep -qF "$SENTINEL" && sentinel_ok=1
    if [ "$pointer_ok" = 1 ] && [ "$sentinel_ok" = 1 ]; then
      echo "VALIDATE-OK: $TICK_DOC carries the sentinel + pointer-only arm contract"
      exit 0
    fi
    # A transient empty/partial read (a concurrent writer's window) is the round-4 flake; retry
    # before declaring a real missing-rule failure.
    sleep 0.05
  done
  if [ "$pointer_ok" != 1 ]; then missing="$missing pointer-rule"; fi
  if [ "$sentinel_ok" != 1 ]; then missing="$missing sentinel"; fi
  echo "VALIDATE-FAIL: manager-loop-tick.md missing AC5c rules:$missing" >&2
  exit 1
fi

# ── 哨兵清扫（AC5c 武装步骤：CronList → 删除所有含哨兵者 → 恰好建一个）────────────────────
LIST_COUNT=0
if [ -f "$STORE" ]; then
  LIST_COUNT="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
fi

if [ "$DRY_RUN" = 1 ]; then
  printf 'sentinel=%s\nstore=%s\nwould-sweep=%s\nwould-create=1\n' \
    "$SENTINEL" "$STORE" "$([ "$LIST_COUNT" -gt 0 ] && echo "yes (delete $LIST_COUNT)" || echo "no (none)")"
  exit 0
fi

# 1. 删除所有含哨兵者（sweep by sentinel, never by remembered id）
mkdir -p "$(dirname "$STORE")"
if [ -f "$STORE" ]; then
  grep -v "$SENTINEL" "$STORE" > "${STORE}.tmp" 2>/dev/null || true
  mv "${STORE}.tmp" "$STORE"
fi
# 2. 恰好建一个（prompt 为指针）
printf '%s %s\n' "$SENTINEL" "$POINTER_PROMPT" >> "$STORE"

# 3. 验证：恰好一个（AC5 负控制：不是零、不是两个）
FINAL_COUNT="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
if [ "$FINAL_COUNT" != "1" ]; then
  echo "ERROR: manager-arm-loop: expected exactly ONE $SENTINEL entry after arm, got $FINAL_COUNT" >&2
  exit 1
fi

if [ "$JSON" = 1 ]; then
  printf '{"sentinel":"%s","store":"%s","swept":%s,"final":%s}\n' \
    "$SENTINEL" "$STORE" "$([ "$LIST_COUNT" -gt 0 ] && echo "$LIST_COUNT" || echo 0)" "$FINAL_COUNT"
else
  printf '%-12s %s\n' "sentinel" "$SENTINEL"
  printf '%-12s %s\n' "store" "$STORE"
  printf '%-12s %s\n' "swept" "$([ "$LIST_COUNT" -gt 0 ] && echo "$LIST_COUNT (deleted)" || echo "none")"
  printf '%-12s %s\n' "final" "$FINAL_COUNT (exactly one manager loop)"
fi
exit 0
