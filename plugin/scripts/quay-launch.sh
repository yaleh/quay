#!/usr/bin/env bash
# quay-launch.sh — 双层循环会话启动器（gap-crystallize-launch-config-into-checked-in-settings-file）。
#
# 从检查进仓库的 .claude/launch.settings.json 生成并启动一个双层循环会话。
# 启动参数只存在于 settings 文件里（settings-schema 键 + _launchSpec 扩展），
# 本脚本负责把 _launchSpec 里的 flag-only 参数翻译成 CLI 参数——冷启动不再靠手打一行 shell。
#
# 用法：
#   quay-launch.sh <role> [--dry-run] [--bare]
#     role      ∈ manager | outer | inner（定义在 _launchSpec.roles）
#     --dry-run  只打印将执行的启动命令，不实际启动（AC4 正/负控制校验用）
#     --bare     追加 --bare 最小模式（一次性验证会话用，AC5；不长驻）
#
# 依赖：jq（读取 settings JSON）。无 jq 时输出错误并退出。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: quay-launch.sh requires jq (JSON query) — not found in PATH" >&2
  exit 1
fi

ROLE="${1:-}"
DRY_RUN=0
BARE=0
PASSTHRU=()
for a in "${@:2}"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    --bare)    BARE=1 ;;
    *) PASSTHRU+=("$a") ;;   # 其余参数原样透传给 claude（如 -p、--print、--resume）
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# 显式 QUAY_LAUNCH_SETTINGS 可覆盖 settings 文件路径（测试/负控制用；默认检查进仓库的那份）。
# gap-manager-layer-no-verified-install-vector (bare-metal 冷启动向量): 在 npm pack 的裸机安装里
# `.claude/launch.settings.json` 不在包根（npm `files` 只随包根 plugin/ 走），它在
# `plugin/.claude/launch.settings.json`（plugin 交付面）。dev-tree 的包根 settings 带 deepseek
# 917k 角色 env（外层/inner 用），是开发树的优先选择；裸机包只有 plugin 拷贝（manager 角色的
# launcher=claude / name=quay-manager 两份一致）——回退到它，`quay manager start` 才能在裸机
# 冷启动。fallback 顺序：显式 env > 包根 dev-tree settings > plugin 出厂 settings。
SETTINGS_FILE="${QUAY_LAUNCH_SETTINGS:-}"
if [ -z "$SETTINGS_FILE" ]; then
  if [ -f "${REPO_ROOT}/.claude/launch.settings.json" ]; then
    SETTINGS_FILE="${REPO_ROOT}/.claude/launch.settings.json"
  else
    SETTINGS_FILE="${REPO_ROOT}/plugin/.claude/launch.settings.json"
  fi
fi

if [[ -z "$ROLE" ]]; then
  echo "ERROR: role required (manager|outer|inner) — see _launchSpec.roles in ${SETTINGS_FILE}" >&2
  exit 1
fi
if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "ERROR: launch settings file not found: ${SETTINGS_FILE}" >&2
  exit 1
fi

# 从 settings 文件读取角色定义（jq 失败=JSON 无效=settings 校验失败，fail-closed）。
# 注意：model 允许为 null（manager 用 claude 默认模型），故不用 -e，null → ""（jq 的 `// ""`）。
LAUNCHER="$(jq -er --arg r "$ROLE" '._launchSpec.roles[$r].launcher // empty' "$SETTINGS_FILE")"
NAME="$(jq -er --arg r "$ROLE" '._launchSpec.roles[$r].name // empty' "$SETTINGS_FILE")"
MODEL="$(jq -r --arg r "$ROLE" '._launchSpec.roles[$r].model // ""' "$SETTINGS_FILE")"
EXCLUDE_DYNAMIC="$(jq -r '._launchSpec.excludeDynamicSystemPromptSections // false' "$SETTINGS_FILE")"
# _launchSpec.promptSuggestions — ghost-suggestion 源头消除（gap-ghost-suggestion-eliminated-at-source-
# prompt-suggestions-false，REQUIRED 非可选）。用 jq -e 判「字面 false」：键缺失或为 true 都不 emit，
# 只有显式 false 才翻译成 CLI 参数 `--prompt-suggestions false`（settings.json 无 promptSuggestions 键，
# 官方环境变量 CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false 由 env 块承载；两条路线都 REQUIRED）。
PROMPT_SUGGESTIONS="$(jq -r '._launchSpec.promptSuggestions' "$SETTINGS_FILE")"
ROLE_ENV="$(jq -c --arg r "$ROLE" '._launchSpec.roles[$r].env // {}' "$SETTINGS_FILE")"

if [[ -z "$LAUNCHER" || -z "$NAME" ]]; then
  echo "ERROR: role '${ROLE}' not defined in ${SETTINGS_FILE} (_launchSpec.roles)" >&2
  echo "       available roles: $(jq -r '._launchSpec.roles | keys | join(", ")' "$SETTINGS_FILE")" >&2
  exit 1
fi

# 角色的 env 与文件顶层 env 合并：无角色级 env（outer/inner，deepseek 角色直接用文件全量 env）→ 直接引用
# 文件（可读、逐字可查）；有角色级 env（manager 把 917k 上下文/压缩变量置空串）→ 合并成 JSON 字符串传给
# --settings（--settings 接受 file-or-json）。这是把「917k 只给 deepseek、不给 manager」机械化的地方——
# manager 跑 Anthropic 默认模型，若带上 917k 会在真实窗口之上压缩过晚导致 API 报错（session-launch-recipes §5）。
# 空串覆盖值表示「从该角色的 env 中删掉此键」：with_entries(select(.value != ""))。
if [[ "$ROLE_ENV" == "{}" ]]; then
  SETTINGS_ARG="$SETTINGS_FILE"
else
  SETTINGS_ARG="$(jq -c --argjson roleEnv "$ROLE_ENV" '.env = ((.env // {}) + $roleEnv | with_entries(select(.value != "")))' "$SETTINGS_FILE")"
fi

CMD=( "$LAUNCHER" "--settings" "$SETTINGS_ARG" )
if [[ "$EXCLUDE_DYNAMIC" == "true" ]]; then
  CMD+=( "--exclude-dynamic-system-prompt-sections" )
fi
# ghost-suggestion at-source elimination (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false):
# _launchSpec.promptSuggestions === false ⇒ append the REQUIRED `--prompt-suggestions false` flag.
# (The env var CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false is carried via --settings; the flag is the
# belt-and-suspenders CLI-form REQUIRED by the human ruling. Absent key defaults to true = no flag.)
if [[ "$PROMPT_SUGGESTIONS" == "false" ]]; then
  CMD+=( "--prompt-suggestions" "false" )
fi
if [[ -n "$MODEL" && "$MODEL" != "null" ]]; then
  CMD+=( "--model" "$MODEL" )
fi
if [[ "$BARE" == "1" ]]; then
  CMD+=( "--bare" )
fi
CMD+=( "-n" "$NAME" )
CMD+=( "${PASSTHRU[@]}" )

if [[ "$DRY_RUN" == "1" ]]; then
  printf '%s\n' "${CMD[*]}"
  exit 0
fi

# 实际启动：exec 替换当前 shell，在 tmux 窗口内直接附着一个会话。
exec "${CMD[@]}"
