#!/usr/bin/env bash
# quay-launch.sh — 双层循环会话启动器（gap-crystallize-launch-config-into-checked-in-settings-file；
# AC154 profile 抽层后：profile 承载从 _launchSpec 迁到 .quay/profiles.yml）。
#
# 从检查进仓库的 .quay/profiles.yml（Claude Code profile 承载，AC154）生成并启动一个双层循环会话。
# 启动参数只存在于 profiles 文件里（profiles/roles + flag-only 参数），本脚本负责把 profile 里的
# flag-only 参数翻译成 CLI 参数——冷启动不再靠手打一行 shell。
# launch.settings.json 只留 Claude Code 认识的键（$schema/permissions/env），是 --settings 的输入；
# launcher/model/--bare/-n/unset 全部来自 profiles.yml（quay-launch.sh 经 python3+yaml → JSON 消费）。
#
# 用法：
#   quay-launch.sh <role> [--dry-run] [--bare]
#     role      ∈ manager | outer | task-worker | selector | fix-worker（定义在 profiles.yml.roles）
#     --dry-run  只打印将执行的启动命令，不实际启动（AC4 正/负控制校验用）
#     --bare     追加 --bare 最小模式（一次性验证会话用，AC5；不长驻）
#
# 依赖：jq（读 settings JSON + profile JSON）、python3+yaml（读 profiles.yml；同 quay-init.sh 解析
# .quay/config.yml 的手法）。缺 jq / python3+yaml 时输出错误并退出。
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
# 显式 QUAY_LAUNCH_SETTINGS 可覆盖 settings 文件路径（测试/负控制用；默认检查进仓库的那份）。
# gap-manager-layer-no-verified-install-vector (bare-metal 冷启动向量): 在 npm pack 的裸机安装里
# `.claude/launch.settings.json` 不在包根（npm `files` 只随包根 plugin/ 走），它在
# `plugin/.claude/launch.settings.json`（plugin 交付面）。dev-tree 的包根 settings 带 deepseek
# 917k 角色 env（外层用），是开发树的优先选择；裸机包只有 plugin 拷贝（manager 角色的
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
  echo "ERROR: role required — see roles in .quay/profiles.yml" >&2
  exit 1
fi
if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "ERROR: launch settings file not found: ${SETTINGS_FILE}" >&2
  exit 1
fi

# ── profile 承载（AC154）：profiles.yml 优先（dev-tree 根 → plugin 出厂回退，同 settings 的 fallback
#    手法）。显式 QUAY_LAUNCH_PROFILES 可覆盖 profiles 文件路径（测试/负控制用）。⛔ 无 _launchSpec
#    回退——profile 抽层后 _launchSpec 已从两份 launch.settings.json 移除，profiles.yml 是唯一承载。
PROFILES_FILE="${QUAY_LAUNCH_PROFILES:-}"
if [ -z "$PROFILES_FILE" ]; then
  if [ -f "${REPO_ROOT}/.quay/profiles.yml" ]; then
    PROFILES_FILE="${REPO_ROOT}/.quay/profiles.yml"
  else
    PROFILES_FILE="${REPO_ROOT}/plugin/.quay/profiles.yml"
  fi
fi
if [[ ! -f "$PROFILES_FILE" ]]; then
  echo "ERROR: profiles file not found: ${PROFILES_FILE}" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: quay-launch.sh requires python3 to read ${PROFILES_FILE}" >&2
  exit 1
fi
if ! PROFILES_JSON="$(python3 -c 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))' "$PROFILES_FILE" 2>/dev/null)"; then
  echo "ERROR: failed to parse ${PROFILES_FILE} as YAML (python3+yaml)" >&2
  exit 1
fi

# role → profile 引用 → profile 的 launcher/model/bare/unset。model 允许 null（manager 用 claude
# 默认模型），故不用 -e，null → ""（jq 的 `// ""`）。role 未定义 ⇒ 空值 → 下方显式报错（⛔ 不靠
# jq -e + set -e 隐式中止——错误信息要给出可用 role 清单）。
ROLE_PROFILE="$(jq -r --arg r "$ROLE" '.roles[$r].profile // empty' <<<"$PROFILES_JSON")"
LAUNCHER="$(jq -r --arg p "$ROLE_PROFILE" '.profiles[$p].launcher // empty' <<<"$PROFILES_JSON")"
NAME="$(jq -r --arg r "$ROLE" '.roles[$r].name // empty' <<<"$PROFILES_JSON")"
MODEL="$(jq -r --arg p "$ROLE_PROFILE" '.profiles[$p].model // ""' <<<"$PROFILES_JSON")"
# bare 只在 profile 一层（AC154 取假①：roles/顶层均无 bare）；profile 缺省 false。
ROLE_BARE="$(jq -r --arg p "$ROLE_PROFILE" '.profiles[$p].bare // false' <<<"$PROFILES_JSON")"
# env 的「取消继承」显式表达为 profile.unset: [...]（⛔ 非空字符串约定）；role.env 为叠加/覆盖。
UNSET_KEYS="$(jq -c --arg p "$ROLE_PROFILE" '.profiles[$p].unset // []' <<<"$PROFILES_JSON")"
ROLE_ENV="$(jq -c --arg r "$ROLE" '.roles[$r].env // {}' <<<"$PROFILES_JSON")"
EXCLUDE_DYNAMIC="$(jq -r '.excludeDynamicSystemPromptSections // false' <<<"$PROFILES_JSON")"
# ⛔ 不用 `// ""`——jq 的 `//` 把 false 当「无值」，`false // ""` = ""，会把显式 false 吃掉。
# 缺省 → jq 渲染 "null"（≠ "false" ⇒ 不 emit flag，与旧版「缺键默认 true = 不加 flag」一致）。
PROMPT_SUGGESTIONS="$(jq -r '.promptSuggestions' <<<"$PROFILES_JSON")"

if [[ -z "$LAUNCHER" || -z "$NAME" ]]; then
  echo "ERROR: role '${ROLE}' not defined in ${PROFILES_FILE} (roles)" >&2
  echo "       available roles: $(jq -r '.roles | keys | join(", ")' <<<"$PROFILES_JSON")" >&2
  exit 1
fi

# 角色的有效 env 与文件顶层 env 合并：无 unset 且无角色级 env（outer/selector/fix-worker，
# deepseek 角色直接用文件全量 env）→ 直接引用文件（可读、逐字可查）；有 unset（manager 取消继承
# 917k 上下文/压缩变量）或有角色级 env（task-worker 叠加 PRINT_BG_WAIT）→ 合并成 JSON 字符串传给
# --settings（--settings 接受 file-or-json）。这是把「917k 只给 deepseek、不给 manager」机械化的
# 地方——manager 跑 Anthropic 默认模型，若带上 917k 会在真实窗口之上压缩过晚导致 API 报错
# （session-launch-recipes §5）。取消继承 = 从 base env 删 unset 键（显式列表，⛔ 非空串约定）。
if [[ "$ROLE_ENV" == "{}" && "$UNSET_KEYS" == "[]" ]]; then
  SETTINGS_ARG="$SETTINGS_FILE"
else
  SETTINGS_ARG="$(jq -c --argjson roleEnv "$ROLE_ENV" --argjson unsetKeys "$UNSET_KEYS" '
    .env = (((.env // {}) | to_entries | map(select(.key as $k | ($unsetKeys | index($k) | not))) | from_entries) + $roleEnv)
  ' "$SETTINGS_FILE")"
fi

CMD=( "$LAUNCHER" "--settings" "$SETTINGS_ARG" )
if [[ "$EXCLUDE_DYNAMIC" == "true" ]]; then
  CMD+=( "--exclude-dynamic-system-prompt-sections" )
fi
# ghost-suggestion at-source elimination (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false):
# promptSuggestions === false ⇒ append the REQUIRED `--prompt-suggestions false` flag.
# (The env var CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false is carried via --settings; the flag is the
# belt-and-suspenders CLI-form REQUIRED by the human ruling. Absent key defaults to true = no flag.)
if [[ "$PROMPT_SUGGESTIONS" == "false" ]]; then
  CMD+=( "--prompt-suggestions" "false" )
fi
if [[ -n "$MODEL" && "$MODEL" != "null" ]]; then
  CMD+=( "--model" "$MODEL" )
fi
if [[ "$BARE" == "1" || "$ROLE_BARE" == "true" ]]; then
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
