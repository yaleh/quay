#!/usr/bin/env bash
# verify-installed-executables.sh — AC6 (gap-quay-init-rewrites-an-executable-instead-of-generating-config).
#
# 原则（写进任务体，2026-08-03）：可执行文件一律原样复制，只生成配置；散文可以本地化，代码不行。
# quay-init --loop 铺出的【可执行文件】必须与其 plugin 源逐字节相同（cmp -s）——历史缺陷正是
# session-observation.sh 走了 render_substitutions 改写路径，导致安装副本与源永远无法 diff（升级时
# 无法区分「生成的差异」与「用户改过的差异」）。本检查把那条原则做成机械断言。
#
# 配置类文件【显式列为例外】，理由是它们属于「可以生成」的一类：
#   - plugin/loop/orchestrator-loop-tick.md、plugin/loop/fast-mode-loop-tick.md —— tick 文档
#     是散文，placeholder 替换（本地化）是对的（AC8 用负控制钉住，不许改这条路径）；
#   - orchestration/session-config.env —— quay-init --loop 生成的每项目配置（SESSION_TMUX_SESSION）。
# 本检查只看 <workspace>/plugin/scripts/ 下的已铺文件：每个与 <plugin-src>/scripts/ 里同名源文件
# 做 cmp。目标项目自己放进 plugin/scripts/ 的、源里没有的文件（quay 资产之外）不在本检查范围。
#
# 用法：  verify-installed-executables.sh <plugin-src> <workspace-root>
#   exit 0 = 每个已铺可执行文件与源逐字节相同；非 0 = 至少一个漂移，第一个漂移在 stderr 点名。
# 本脚本只读，不写任何东西；被 quay-init --loop 与 test/cold-start-e2e.sh 共同调用（ADR-004：
# 一份逻辑，两个调用方，不复制实现）。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ $# -ne 2 ]; then
  echo "Usage: verify-installed-executables.sh <plugin-src> <workspace-root>" >&2
  exit 2
fi

PLUGIN_SRC="$(cd "$1" 2>/dev/null && pwd)" || { echo "FAIL: plugin source dir not readable: $1" >&2; exit 2; }
WORKSPACE="$(cd "$2" 2>/dev/null && pwd)" || { echo "FAIL: workspace root not readable: $2" >&2; exit 2; }

FAILED=0
checked=0
for f in "$WORKSPACE"/plugin/scripts/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  src="$PLUGIN_SRC/scripts/$name"
  [ -f "$src" ] || continue   # target-local script (not a quay asset) — out of scope
  if ! cmp -s "$src" "$f"; then
    echo "FAIL: installed executable $f differs from its source $src — 可执行文件必须逐字节与源相同" >&2
    FAILED=1
  fi
  checked=$((checked + 1))
done

if [ "$FAILED" = 1 ]; then
  echo "verify-installed-executables: FAIL — an installed executable drifted from its plugin source (checked ${checked})" >&2
  exit 1
fi
echo "verify-installed-executables: OK — every installed executable is byte-identical to its source (checked ${checked})"
exit 0
