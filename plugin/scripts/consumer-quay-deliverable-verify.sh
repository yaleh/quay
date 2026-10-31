#!/usr/bin/env bash
# consumer-quay-deliverable-verify.sh — verify quay's Claude Code + Codex deliverables from a
# CONSUMER project (e.g. meta-cc): the MCP servers are connected AND serve THIS project's task
# store, and the human-facing skills are discoverable/invocable.
#
# ⛔ Dev-tree only: uses the host-specific launcher `claude-fjdac` + model `v4pro-anthropic`
#    (this repo's worker profile, `.quay/profiles.yml` worker-default), not a shipped consumer tool.
#
# Usage:
#   bash consumer-quay-deliverable-verify.sh --root <project> [--launcher claude-fjdac] [--model v4pro-anthropic]
#
# Exit: 0 = all checks pass; 1 = at least one FAIL; 2 = usage error.
#
# ① Claude Code MCP     — `claude-fjdac -p` 调 task_list，返回本项目任务
# ② Claude Code skills  — `/quay-task-operator` 可调用
# ③ Codex MCP           — `codex mcp list` 有 quay + `codex exec` task_list 返回本项目任务
# ④ Codex skills        — `$quay-task-operator` 可调用

set -uo pipefail

ROOT=""
LAUNCHER="${QUAY_VERIFY_LAUNCHER:-claude-fjdac}"
MODEL="${QUAY_VERIFY_MODEL:-v4pro-anthropic}"

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --launcher) LAUNCHER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --help|-h) echo "用法: bash $0 --root <project> [--launcher claude-fjdac] [--model v4pro-anthropic]"; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$ROOT" ] || { echo "ERROR: --root <project> required" >&2; exit 2; }
[ -f "$ROOT/.quay/config.yml" ] || { echo "ERROR: $ROOT is not a quay workspace (no .quay/config.yml)" >&2; exit 2; }
cd "$ROOT" || exit 2

note() { printf '%s\n' "$*"; }
pass=0; fail=0
ok()  { note "PASS: $*"; pass=$((pass+1)); }
bad() { note "FAIL: $*"; fail=$((fail+1)); }

CC_TASKLIST_PROMPT="使用 quay MCP 的 task_list 工具（不带参数）列出任务，只报告任务总数和前 2 条 id。不要修改任何文件。"
CC_SKILL_PROMPT="/quay-task-operator 读取当前项目任务，不要做任何修改"
CX_TASKLIST_PROMPT="使用 quay MCP 的 task_list 工具列出任务，只报告任务总数和前 2 条 id，不要修改任何文件。"
CX_SKILL_PROMPT='$quay-task-operator 读取当前项目任务，不要做任何修改'

# ① Claude Code MCP（worker 的 launcher + model + permissionMode）
note "=== ① Claude Code MCP (task_list) ==="
cc_mcp_out="$(timeout 300 "$LAUNCHER" -p --model "$MODEL" --permission-mode bypassPermissions "$CC_TASKLIST_PROMPT" 2>&1)"
note "$cc_mcp_out" | tail -6
if printf '%s\n' "$cc_mcp_out" | grep -qiE '任务|task|total|条|count'; then
  ok "Claude Code MCP 有返回"
else
  bad "Claude Code MCP 无返回（或超时/连接失败）"
fi

# ② Claude Code skills（/quay-task-operator）
note "=== ② Claude Code skills (/quay-task-operator) ==="
cc_skill_out="$(timeout 300 "$LAUNCHER" -p --model "$MODEL" --permission-mode bypassPermissions "$CC_SKILL_PROMPT" 2>&1)"
note "$cc_skill_out" | tail -6
if printf '%s\n' "$cc_skill_out" | grep -qiE '任务|task|total|条|count'; then
  ok "/quay-task-operator 可调用"
else
  bad "/quay-task-operator 不可调用"
fi

# ③ Codex MCP（mcp list + task_list）
# ⚠️ `codex exec` 在 stdin 打开时会读 stdin（挂在 "Reading additional input from stdin..."）甚至
#    把技能输出写到 /dev/tty，`$(... 2>&1)` 抓不到 ⇒ `</dev/null` 强制非交互、输出走 stdout/stderr。
note "=== ③ Codex MCP ==="
if timeout 30 codex mcp list --json 2>/dev/null | grep -q '"quay"'; then
  ok "codex mcp list 有 quay"
else
  bad "codex mcp list 无 quay"
fi
cx_mcp_out="$(timeout 300 codex exec --dangerously-bypass-approvals-and-sandbox -C "$ROOT" "$CX_TASKLIST_PROMPT" </dev/null 2>&1)"
note "$cx_mcp_out" | tail -6
if printf '%s\n' "$cx_mcp_out" | grep -qiE 'task|任务|total|条|count'; then
  ok "codex task_list 有返回"
else
  bad "codex task_list 无返回"
fi

# ④ Codex skills（$quay-task-operator，单引号防 bash 展开 $）
note "=== ④ Codex skills (\$quay-task-operator) ==="
cx_skill_out="$(timeout 300 codex exec --dangerously-bypass-approvals-and-sandbox -C "$ROOT" "$CX_SKILL_PROMPT" </dev/null 2>&1)"
note "$cx_skill_out" | tail -6
if printf '%s\n' "$cx_skill_out" | grep -qiE 'task|任务|total|条|count'; then
  ok '$quay-task-operator 可调用'
else
  bad '$quay-task-operator 不可调用'
fi

note "=== RESULT: pass=$pass fail=$fail ==="
[ "$fail" -eq 0 ]
