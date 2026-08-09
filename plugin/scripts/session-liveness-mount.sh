#!/usr/bin/env bash
# plugin/scripts/session-liveness-mount.sh — 会话存活监视器的挂载入口。
#
# 2026-08-06 人裁定（gap-session-liveness-remove-shared-events-and-lock）：观测是树、只读天然不排他，
# 互斥锁彻底移除。挂载不再取任何锁、不再区分「第一个/第二个挂载」——本脚本只是 session-liveness.sh
# 的等价入口（exec 同一脚本，保持同一 pid），谁挂谁拥有自己的 stdout 事件流（Monitor 工具消费），
# 多观察者并行挂载天然无冲突、互不知情、谁先启动无关。
#
# 用法：bash plugin/scripts/session-liveness-mount.sh [--once] [--mask] [--api-errors <t>] [--last-input <t>]
#   --once 等诊断接缝透传给 session-liveness.sh。
# 环境：无（不再有 SESSION_LIVENESS_OWNER / SESSION_LIVENESS_GLOBAL_DIR / 锁相关变量）。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

_slm_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$_slm_script_dir/session-liveness.sh" "$@"
