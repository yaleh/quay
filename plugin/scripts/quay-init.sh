#!/usr/bin/env bash
# quay-init.sh — quay project initializer (SPEC §6 closed set; gap-quay-init-closure-shrink-body, AC168).
#
# 裁定 6（SPEC-plugin-lifecycle-single-bundle-2026-09-02）：quay-init 的**主要操作 = 创建符合 quay 要求的
# 项目文件**（任务目录、quay 配置），⛔ 不复制任何 Claude Code 扩展或脚本。它是一个**项目初始化器，
# 不是一个安装器**。扩展与脚本由 quay Claude Code plugin 原生交付（skill 载入时 ${CLAUDE_PLUGIN_ROOT}
# 文本级展开 / 非 skill 入口走 packages/quay/src/plugin-root.ts 解析器）。
#
# 写入闭集（QUAY-INIT-CLOSED-SET）——只写这 7 项：
#   .quay/config.yml         provider map + loop 参数（生成）
#   .quay/profiles.yml       launcher/model 承载（模板 verbatim）
#   tasks/                   任务目录（mkdir）
#   goals/                   目标目录（mkdir，与 tasks/ 双载体）
#   .gitignore               quay 运行时状态条目（追加，幂等）
#   .claude/launch.settings.json   每角色启动配置模板（模板 verbatim）
#   .claude/settings.json    enabledPlugins + permissions.allow（生成）
#
# ⚠️ 显式安装步骤（AC4 / T3）：enabledPlugins 只能启用【已安装】插件、不会安装它，未信任目录的项目
# settings 整份不被读 ⇒「配置提交进仓库就自动装上」不成立——输出文案显式指引 `claude plugin marketplace
# add` + `claude plugin install`（或 npm 全局 register-plugin.mjs），不暗示"配置即生效"。
#
# 已退役（copy 机器，AC1 archive）：copy_one/copy_dir/write_state_file/write_session_env + managed/
# conflict/stale 三态判定 + .quay/runtime 铺设 + ensure_vendor_runtime + verify_provider_runtime_existence
# + --check-drift/--check-dependency-closure 的铺设面消费。
# ⚠️ 2026-09-18（gap-quay-init-native-reconcile）：上述退役体的【死代码】已从本文件物理删除——它们
# 当时即已无任何调用者（保留的只是定义）。同批删除的还有：write_provider_config（被 write_config
# 的新装分支取代的重复 writer）、backup_config / rollback_config_on_exit（同一批无人调用的回滚件）、
# drift_report（--check-drift 的打印器）、ensure_runtime_gitignore（被 ensure_runtime_artifacts_gitignore
# 取代）、以及 _precompute_states/_CMP_STATE/_DST_HASH 批量化（其生产者即 copy 机器，删后 _is_identical
# 的"批量查表"分支从未被执行过 ⇒ 一并退化为直接 `cmp -s`）。2959 → 2426 行；判定方式见该任务的 DoD
# 证据小节（reachability + `derive_loop_scripts` 输出逐字不变 + 真实铺设产物逐字不变）。
# ⚠️ 铺设退役【不等于】既有项目的
# `.quay/runtime/` 无人管：其继任者是 migrate_stale_mcp_entry（升级通道）——把 provider 绑定迁到
# 插件交付的 runtime 绝对路径，并把无引用且陈旧的本地副本退役（gap-upgrade-leaves-legacy-project-
# runtime-stale-and-unmigrated AC1/AC2，裁定见该函数头）。⚠️ 保留为【库函数】（供 laydown-set-check.sh /
# build-plugin-dist.mjs 等 SOURCE 后调用，本脚本的 library-mode guard 使 source 不执行安装流）：
# derive_loop_scripts / verify_referenced_landed / _read_declarations 及其 helper——它们不再是 quay-init
# 的写路径，只是仍然被下游机件按库方式消费；它们的整体退役属 AC158/AC159 波次。
#
# Flags: 见 plugin/skills/init/SKILL.md（--root/--project/--repo-root/--test-command/--tmux-session/
# --worktree-root/--plugin-root/--force/--dry-run/--auto-commit-confirm/--auto-commit-skip/
# --adopt-branch-model/--doc-branch-name）。
#   --doc-branch-name <name>  establish the doc-only work branch: when the main checkout is sitting
#     on the landing baseline 'develop', create <name> at that tip and switch the main checkout to
#     it (human edits and driver commits then stop sharing one branch and one git index). Already
#     off 'develop' ⇒ no-op; <name> taken by an UNRELATED branch ⇒ REFUSED, nothing moved; HEAD
#     detached ⇒ NOT-EVALUATED, nothing moved. Default 'author'; a project's existing
#     `loop.doc_branch` overrides it. Passed through to `quay init --branch-model-only`.
# --all/--loop/--manager/--workflows/--agents 为向后兼容 no-op（收敛到同一闭集）。
# Plugin root: ${CLAUDE_PLUGIN_ROOT} 或 --plugin-root <dir>。Fail-closed if unset/missing.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# ── resolve plugin root ─────────────────────────────────────────────────────────────────────────────
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
# gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down AC6: the host does NOT inject
# CLAUDE_PLUGIN_ROOT when a Skill invokes quay-init.sh, so the documented call (init/SKILL.md
# step 3) must work without it. Fall back to self-resolving from $0 — this file lives at
# <plugin-root>/scripts/quay-init.sh. The plugin.json validation below still FAILS CLOSED when
# neither yields a valid plugin root: never a silent wrong path.
if [ -z "$PLUGIN_ROOT" ]; then
  SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
  PLUGIN_ROOT="$(cd "$(dirname "$(dirname "$SELF")")" 2>/dev/null && pwd || true)"
fi
WORKSPACE_ROOT="$(pwd)"
PROJECT_NAME=""
REPO_ROOT=""
TMUX_SESSION=""
TEST_COMMAND=""
WORKTREE_ROOT=""
FORCE=false
DRY_RUN=false
# gap-upgrade-entry-never-establishes-branch-model: the branch-model adoption DECISION. Default false
# ⇒ a divergent landing baseline REFUSES the whole upgrade (fail-closed, config untouched) and prints
# the remedy; true ⇒ `ensureBranchModel` preserves the foreign tip under
# `<branch>-pre-quay-init-<sha>` and re-points the branch at the default branch tip. The DECISION is
# the operator's; the JUDGMENT is never re-implemented here (see ensure_target_branch_model).
ADOPT_BRANCH_MODEL=false
# gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop: the DOC-branch NAME.
# ⛔ This is the CLI-PARAMETER layer, and it is the ONLY place the default value of a doc-branch name
# lives in this repo. The judgment layer (`packages/quay/src/branch-model.ts`) is NAME-AGNOSTIC and
# carries no branch-name literal at all: `author` is deliberately excluded from
# `target-identity-literal-check.ts`'s `LEGAL_IDENTITY_VALUES`, so a literal there would (a) turn
# that check RED and (b) hardcode a per-project convention into the mechanism. Resolution order is
# the config-preserving-upgrade idiom already used for repo_root/test_command (see the
# defaults block below): --doc-branch-name wins, else the project's existing `loop.doc_branch`,
# else this default.
DOC_BRANCH_NAME=""
DO_WORKFLOWS=false
DO_AGENTS=false
DO_LOOP=false
DO_MANAGER=false
DO_CHECK_DRIFT=false
DO_CHECK_DEPENDENCY_CLOSURE=false
ANY_CATEGORY=false
# gap-quay-init-never-commits-broken-committed-state AC3: how the auto-commit prompt resolves when
# the consumer repo already carries uncommitted changes. "prompt" (default) = interactive read when
# stdin is a TTY, fail-closed decline when not; "yes" = commit anyway (only quay-init's laid-down
# paths staged); "no" = skip the commit.
AUTO_COMMIT_CONFIRM=prompt

# ── parse args ─────────────────────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --workflows) DO_WORKFLOWS=true; ANY_CATEGORY=true; shift ;;
    --agents) DO_AGENTS=true; ANY_CATEGORY=true; shift ;;
    --loop) DO_LOOP=true; DO_WORKFLOWS=true; ANY_CATEGORY=true; shift ;;
    --manager) DO_MANAGER=true; shift ;;
    --check-drift) DO_CHECK_DRIFT=true; shift ;;
    --check-dependency-closure) DO_CHECK_DEPENDENCY_CLOSURE=true; shift ;;
    --all) DO_WORKFLOWS=true; DO_AGENTS=true; ANY_CATEGORY=true; shift ;;
    --force) FORCE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --adopt-branch-model) ADOPT_BRANCH_MODEL=true; shift ;;
    --doc-branch-name) DOC_BRANCH_NAME="$2"; shift 2 ;;
    --auto-commit-confirm) AUTO_COMMIT_CONFIRM=yes; shift ;;
    --auto-commit-skip) AUTO_COMMIT_CONFIRM=no; shift ;;
    --check-drift) DO_CHECK_DRIFT=true; shift ;;
    --root) WORKSPACE_ROOT="$2"; shift 2 ;;
    --project) PROJECT_NAME="$2"; shift 2 ;;
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --tmux-session) TMUX_SESSION="$2"; shift 2 ;;
    --test-command) TEST_COMMAND="$2"; shift 2 ;;
    --worktree-root) WORKTREE_ROOT="$2"; shift 2 ;;
    --plugin-root) PLUGIN_ROOT="$2"; shift 2 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# Default category: --all if no category flag given (matches the skill's historical default).
if [ "$ANY_CATEGORY" = false ]; then
  DO_WORKFLOWS=true; DO_AGENTS=true
fi

# Normalize workspace root (must exist).
if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "ERROR: --root does not exist: $WORKSPACE_ROOT" >&2
  exit 2
fi
WORKSPACE_ROOT="$(cd "$WORKSPACE_ROOT" && pwd)"

# ── pre-write closed-set snapshot (gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade)
# report_closed_set_state (below) classifies each of the seven closed-set items by comparing their
# CURRENT fingerprint against this snapshot. Taken HERE — before any other statement can write — so the
# comparison is by position (not by an argument that "nothing writes before the write section"), and
# read back by the EXIT trap wherever the abort lands.
#
# Why the snapshot exists: the retired form tested `[ -e <path> ]` — EXISTENCE — which only coincides
# with "this run wrote it" on a FRESH target. On a non-empty target (upgrading a project that already
# ran quay-native) the two quantities separate and the report over-credits: a pre-write failure on an
# existing project reported a byte-for-byte untouched `.quay/config.yml` as `written:`, i.e. it
# described a run that changed nothing as a partial takeover (hard rule 4b: 代理量会与实际偏离 — here
# on the dangerous side). The fingerprint comparison is CONTENT-level, so a run that rewrote a file
# with identical bytes is also honestly reported as not-changed.
#
# Fingerprint: a file → sha256 of its bytes; a directory → sha256 of its sorted entry listing (the
# exact content granularity of quay-init's only directory write, `mkdir -p`); ABSENT when the path is
# not there. UNREADABLE is kept DISTINCT from ABSENT: a path that exists but whose content cannot be
# read must never be reported as "not there / not written" (hard rule 3b — 读不懂输入不得返回与合格
# 同形的值).
CLOSED_SET_ITEMS=".quay/config.yml .quay/profiles.yml tasks goals .gitignore .claude/launch.settings.json .claude/settings.json"
declare -A PRE_WRITE_FINGERPRINTS=()

# _closed_set_fingerprint <abs-path> — ABSENT | UNREADABLE | <sha256>. Never fails the caller under
# `set -e` (every subprocess is guarded), because it also runs inside the EXIT trap.
_closed_set_fingerprint() {
  local p="$1" out=""
  if [ -d "$p" ]; then
    out="$(ls -A "$p" 2>/dev/null | LC_ALL=C sort | sha256sum 2>/dev/null | cut -d' ' -f1)" || out=""
    if [ -n "$out" ]; then echo "$out"; return 0; fi
    if [ -d "$p" ]; then echo UNREADABLE; else echo ABSENT; fi
  elif [ -f "$p" ]; then
    out="$(sha256sum "$p" 2>/dev/null | cut -d' ' -f1)" || out=""
    if [ -n "$out" ]; then echo "$out"; return 0; fi
    if [ -f "$p" ]; then echo UNREADABLE; else echo ABSENT; fi
  elif [ -e "$p" ]; then
    echo UNREADABLE   # exists but is neither a regular file nor a directory — nothing comparable to
  else
    echo ABSENT
  fi
  return 0
}

_snapshot_closed_set() {
  local p
  for p in $CLOSED_SET_ITEMS; do
    PRE_WRITE_FINGERPRINTS["$p"]="$(_closed_set_fingerprint "$WORKSPACE_ROOT/$p")"
  done
  return 0
}
_snapshot_closed_set

# gap-the-runtime-has-nowhere-safe-to-land: the RUNTIME LANDING BASE. The quay runtime (Core
# bundle + native-provider bundle + provider.yml) used to land under `<target>/vendor/quay/` —
# `vendor/` is a RESERVED directory name in Go (module vendoring resolves it), and `<target>/dist/`
# is a reserved build-output name for a dozen toolchains. The landing decision (SPEC AC2 in the
# task): the runtime is a GENERATED ARTIFACT, not source — so it lives OUTSIDE the target's git in
# quay's OWN namespace `.quay/runtime/`, gitignored by quay-init itself (AC10). Path segments avoid
# every reserved name (`vendor`/`node_modules`/`target`/`build`/`dist` — AC9). The `dist/` under
# plugin/vendor/ is the PLUGIN's own build output (unaffected); only the TARGET landing path must
# stay reserved-name-free.
RUNTIME_BASE="$WORKSPACE_ROOT/.quay/runtime"

# read_existing_loop_value <key> — the config-preserving upgrade's source of truth
# (gap-quay-init-config-preserving-incremental-upgrade). An EXISTING consumer's `.quay/config.yml`
# `loop:` section carries values the project already chose (repo_root / test_command / tmux_session /
# worktree_root — the fast-mode keys — AND board / gates / stop / policy / concurrency_bands /
# fork_baseline / routines — the loop-driver + fast-mode keys). The upgrade must KEEP
# those values, never re-detect/re-derive them: an explicit CLI flag wins, otherwise the existing
# config value wins, otherwise the fresh-install default/detection applies. Reads ONE key from an
# existing config (empty when the config is absent or the key is unset).
read_existing_loop_value() {
  local key="$1"
  [ -f "$WORKSPACE_ROOT/.quay/config.yml" ] || { echo ""; return; }
  python3 - "$WORKSPACE_ROOT/.quay/config.yml" "$key" <<'PYEOF'
import sys, yaml
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}
    print((d.get("loop") or {}).get(sys.argv[2]) or "")
except Exception:
    pass
PYEOF
}

# Defaults for loop params. repo_root defaults to the workspace root on a FRESH install; on an
# EXISTING consumer the config-preserving upgrade keeps the consumer's recorded loop.repo_root
# (explicit --repo-root always wins).
if [ -z "$PROJECT_NAME" ]; then PROJECT_NAME="$(basename "$WORKSPACE_ROOT")"; fi
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(read_existing_loop_value repo_root)"
  if [ -z "$REPO_ROOT" ]; then REPO_ROOT="$WORKSPACE_ROOT"; fi
fi
# DOC_BRANCH_NAME: explicit --doc-branch-name wins, else the consumer's recorded loop.doc_branch,
# else the CLI-parameter default. Same precedence shape as repo_root above (and it MUST keep that
# shape: a project that pinned a doc-branch name is not silently given a different one).
if [ -z "$DOC_BRANCH_NAME" ]; then
  DOC_BRANCH_NAME="$(read_existing_loop_value doc_branch)"
fi
if [ -z "$DOC_BRANCH_NAME" ]; then DOC_BRANCH_NAME="author"; fi
# NOTE: TMUX_SESSION is deliberately NOT defaulted here. The old default was a guessed
# "<project>-0:0.0" (gap-init-guesses-the-tmux-session): it only worked for the project it was
# written for, and a monitor aimed at a nonexistent session reports a LIVE inner as GONE (the
# false-negative this monitor must never emit). The --loop block DETECTS the real session by
# project name as a BEST-EFFORT convenience — since the outer/inner dual-tmux model retired
# (SPEC-tmux-retirement-2026-09-03) the session is OPTIONAL: quay-init's seven-item closed-set write
# never uses tmux, so a missing/ambiguous session leaves loop.tmux_session null instead of failing
# the init (gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write). Only a downstream
# action that actually uses tmux fails closed at runtime — never this initializer.

# Verify plugin root.
if [ -z "$PLUGIN_ROOT" ]; then
  echo "ERROR: CLAUDE_PLUGIN_ROOT is not set (or pass --plugin-root). quay-init must know where the plugin lives." >&2
  exit 2
fi
if [ ! -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
  echo "ERROR: ${PLUGIN_ROOT} is not a quay plugin (missing .claude-plugin/plugin.json)." >&2
  exit 2
fi
PLUGIN_ROOT="$(cd "$PLUGIN_ROOT" && pwd)"

PLUGIN_VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null || echo unknown)"
PLUGIN_NAME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null || echo quay)"

# ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
# Backup timestamp for AC4 residue cleanup: every cleanup in one run is grouped under a single
# per-run backup dir (<workspace>/.quay/quay-init-backups/<ts>/), so "backup 在哪" is one line.
BACKUP_TS="$(date +%s)"

# _is_identical <src> <dst> — byte comparison.
# ⚠️ 2026-09-18 (gap-quay-init-native-reconcile): this used to consult a precomputed `_CMP_STATE`
# array filled by `_precompute_states`, falling back to `cmp -s` for a dst the batch had not covered.
# That producer belonged to the copy machinery AC168 retired and had been unreachable ever since, so
# the fallback arm was the ONLY arm ever taken and the batching
# (gap-suite-serial-install-copy-one-subprocess-batching) had been buying nothing. The arrays and the
# lookup are gone; the remaining live caller (`compute_drift_report`) gets the same answer.
_is_identical() {
  cmp -s "$1" "$2"
}

# render_substitutions has been REMOVED (gap-install-rewrites-files-so-upgrade-cannot-tell-
# who-changed-them): install is configuration-driven, not text-substitution. Every laid-down
# file is byte-identical to the product artifact (SPEC AC1); the target-project values
# (repo_root / test_command / tmux_session) live in ONE config file (.quay/config.yml `loop:`
# section, AC2) and are READ at runtime, never baked in (AC3).

# detect_test_command <root>: AC2 (gap-cold-start-...-eight-steps) — the target project's test
# command is DETECTABLE, not something the human must already know. Priority ladder (first match
# wins; measured on three real projects, each on a different rung):
#   scripts/test.sh            → "bash scripts/test.sh"  (quay's own convention)
#   package.json scripts.test  → "npm test"              (e.g. archguard: "vitest run" via npm test)
#   go.mod                     → "go test ./..."         (e.g. meta-cc)
#   Cargo.toml                 → "cargo test"
# Prints the detected command on stdout and returns 0; returns 1 (silent) when nothing is detected.
# The caller FAILS CLOSED on a miss — this function never guesses a default (AC3 negative control).
detect_test_command() {
  local root="$1"
  if [ -f "$root/scripts/test.sh" ]; then
    echo "bash scripts/test.sh"
    return 0
  fi
  if [ -f "$root/package.json" ]; then
    if python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    scripts = d.get("scripts")
    if isinstance(scripts, dict) and isinstance(scripts.get("test"), str) and scripts["test"].strip():
        sys.exit(0)
except Exception:
    pass
sys.exit(1)
' "$root/package.json" 2>/dev/null; then
      echo "npm test"
      return 0
    fi
  fi
  if [ -f "$root/go.mod" ]; then
    echo "go test ./..."
    return 0
  fi
  if [ -f "$root/Cargo.toml" ]; then
    echo "cargo test"
    return 0
  fi
  return 1
}

# detect_tmux_session <project>: detect the target project's tmux session by matching
# `tmux list-sessions` against the project name (gap-init-guesses-the-tmux-session). The
# session-name convention is <project> (first session) or <project>-<n> (subsequent), so a
# project named "meta-cc" has sessions like "meta-cc-4". Detection is by NAME PREFIX — the
# installer must NEVER guess a session: a guessed "<project>-0:0.0" only works for the project
# it was written for, and a monitor aimed at a nonexistent session reports a LIVE inner as
# GONE (the false-negative this task exists to kill; the same shape as the placeholder
# /home/yale/work/quay — silently correct on the dev box, silently wrong elsewhere).
# Prints:
#   exactly one match  → the session name on stdout, exit 0 (caller writes it)
#   multiple matches   → each matching session name on its own line, exit 2 (ambiguous — the
#                        caller leaves loop.tmux_session null, never picks one)
#   zero matches       → nothing, exit 1 (caller leaves loop.tmux_session null — never write a guess)
detect_tmux_session() {
  local project="$1" m
  local -a matches=()
  command -v tmux >/dev/null 2>&1 || return 1
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    case "$m" in
      "$project"|"$project"-*) matches+=("$m") ;;
    esac
  done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
  if [ "${#matches[@]}" -eq 1 ]; then
    printf '%s\n' "${matches[0]}"
    return 0
  fi
  if [ "${#matches[@]}" -gt 1 ]; then
    printf '%s\n' "${matches[@]}"
    return 2
  fi
  return 1
}

# ensure_loop_config: add/update the `loop:` section in an EXISTING `.quay/config.yml` with the
# four fast-mode target-project values (repo_root / test_command / tmux_session / worktree_root —
# SPEC AC2, the single config source for the loop). Laid-down scripts and tick docs READ these at
# runtime instead of having them baked in at install (SPEC AC3), so two installs of the same product
# are byte-identical except this config (AC4). A pre-existing config's other keys (providers,
# credentials) are preserved; only the loop section is added/updated. Used only when the config
# already exists — a config-less target gets its loop section from `write_config`'s own heredoc, the
# ONE remaining fresh-install writer (the orphaned `write_provider_config` duplicate that this
# comment used to point at was removed 2026-09-18, gap-quay-init-native-reconcile). Uses python3 +
# yaml so the values are always valid YAML scalars regardless of their content.
# CONFIG-PRESERVING UPGRADE (gap-quay-init-config-preserving-incremental-upgrade, AC1): the loop
# section is MERGED, never replaced. `data["loop"] = {...}` (the pre-fix form) DESTROYED every
# non-fast-mode key the consumer owned — the loop-driver schema (board / gates / stop / policy) and
# the fast-mode schema's extras (concurrency_bands / fork_baseline / routines) were
# silently dropped on upgrade. The fix updates ONLY the four fast-mode keys and leaves every other
# loop: key byte-for-byte intact (the consumer's loop values survive the upgrade unchanged).
# NO GRATUITOUS REWRITE (gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated AC3): the
# write happens ONLY when a VALUE actually changed. `yaml.safe_dump` reformats the whole document
# (an inline `mcp_entry: [...]` becomes a block sequence), so an unconditional write would mutate
# the provider block of a project that needed no change at all — a byte-level side effect of a
# value-level no-op. Values equal ⇒ no write, and the config survives byte-identical.
ensure_loop_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$REPO_ROOT" "$TEST_COMMAND" "$TMUX_SESSION" "$WORKTREE_ROOT" "$DRY_RUN" <<'PYEOF'
import sys, yaml
cfg, repo, test, tmux, wtroot = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
dry_run = sys.argv[6] == "true"
with open(cfg, encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}
# gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated AC3 (负控制: 不得做无谓改写):
# a re-dump is not free — `yaml.safe_dump` REFORMATS the whole file (an inline `mcp_entry: [...]`
# becomes a block sequence), so an upgrade that changes no VALUE must not rewrite the file at all.
# Snapshot the data before the loop update and compare after: equal ⇒ skip the write, so a project
# whose runtime binding is already current survives the upgrade byte-identical.
def dump(d):
    return yaml.safe_dump(d, allow_unicode=True, sort_keys=False, default_flow_style=False)
before = dump(data)
loop = data.get("loop")
if not isinstance(loop, dict):
    loop = {}
loop["repo_root"] = repo
loop["test_command"] = test
# gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write: an empty session (no tmux
# host / no matching session) is written as an explicit YAML null, not an empty string — the
# session is optional since SPEC-tmux-retirement-2026-09-03, and null is the honest "not set".
loop["tmux_session"] = tmux if tmux else None
loop["worktree_root"] = wtroot
data["loop"] = loop
after = dump(data)
if after == before:
    print("  unchanged: .quay/config.yml loop: (values already current — no gratuitous rewrite, AC3)")
    sys.exit(0)
if dry_run:
    print("  would-write: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated; 其余 loop 键保留 — config 保留 增量升级)")
    sys.exit(0)
with open(cfg, "w", encoding="utf-8") as f:
    f.write(after)
print("  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated; 其余 loop 键保留 — config 保留 增量升级)")
PYEOF
}

# ensure_provider_carrier_env: pin the provider's carrier directories in an EXISTING
# `.quay/config.yml`'s `providers.native.env` map (AC4 of
# gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak).
#
# WHY THE PIN EXISTS EVEN THOUGH THE ROOT CAUSE IS FIXED: packages/quay-native's carrier-dirs.ts now
# derives adr/goals/meta from the RESOLVED tasks dir, so the isolation is correct without any pin.
# The pin is the second, independent half — it makes the isolation VISIBLE AND AUDITABLE in the
# config the user owns, instead of leaving it implicit in a resolution rule. Before the root-cause fix
# a config carrying only QUAY_NATIVE_TASKS_DIR leaked its adr/goal/meta stores into whichever quay
# workspace sat above the provider package (measured 2026-09-13: a real third-party project's
# `goal list` returned quay's own AC-143…AC-157 and `adr list` quay's ADR-001…ADR-011).
#
# VALUE FORM: the siblings MIRROR the existing QUAY_NATIVE_TASKS_DIR value's form — `./tasks` gets
# `./adr`, an absolute `/ws/tasks` gets `/ws/adr` — so the env block stays internally consistent
# rather than mixing forms. Core resolves `./`-relative values against workspaceRoot
# (packages/quay/src/provider-env.ts), so both forms point at the same place.
#
# IDEMPOTENT + MINIMAL (AC4): a LINE-LEVEL insert, never a yaml round-trip. `yaml.safe_dump`
# reformats the whole document (an inline `mcp_entry: [...]` becomes a block sequence, comments are
# lost), so "add three keys" implemented that way would silently rewrite every other key of a file
# that needed no change. Here only the missing keys are appended to the env block, adjacent to the
# existing ones; a key already present is NEVER overwritten (a user's own value wins), and a config
# whose env block already carries all four is left byte-for-byte untouched — no write, hence no diff.
ensure_provider_carrier_env() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$WORKSPACE_ROOT" "$DRY_RUN" <<'PYEOF'
import re, sys

cfg, ws_root = sys.argv[1], sys.argv[2]
dry_run = sys.argv[3] == "true"

KINDS = [("QUAY_NATIVE_ADR_DIR", "adr"),
         ("QUAY_NATIVE_GOAL_DIR", "goals"),
         ("QUAY_NATIVE_META_DIR", "meta")]

with open(cfg, encoding="utf-8") as f:
    lines = f.read().split("\n")


def indent_of(s):
    return len(s) - len(s.lstrip(" "))


def block_end(start, parent_ind):
    """First index >= start+1 that is non-blank with indent <= parent_ind, else len(lines)."""
    j = start + 1
    while j < len(lines):
        if lines[j].strip() and indent_of(lines[j]) <= parent_ind:
            return j
        j += 1
    return len(lines)


def find_child(start, end, key, min_indent):
    """(index, indent) of the first `key:` line in [start, end) at indent >= min_indent."""
    pat = re.compile(r"^(\s*)" + re.escape(key) + r"\s*:")
    for i in range(start, end):
        m = pat.match(lines[i])
        if m and len(m.group(1)) >= min_indent:
            return i, len(m.group(1))
    return None, None


# ── locate providers[: -> <id>: -> env:] by INDENTATION, not by a yaml round-trip ────────────────
prov_i, prov_ind = find_child(0, len(lines), "providers", 0)
if prov_i is None:
    print("  note: .quay/config.yml has no providers: section — carrier env pins not applicable (nothing written)")
    sys.exit(0)
native_i, native_ind = find_child(prov_i + 1, block_end(prov_i, prov_ind), "native", prov_ind + 1)
if native_i is None:
    print("  note: providers: has no native: entry — carrier env pins not applicable (nothing written)")
    sys.exit(0)
native_end = block_end(native_i, native_ind)
env_i, env_ind = find_child(native_i + 1, native_end, "env", native_ind + 1)

# ── collect the keys the env block already carries ───────────────────────────────────────────────
key_re = re.compile(r"^(\s*)(QUAY_NATIVE_\w+)\s*:\s*(.*)$")
present = {}
if env_i is not None:
    rest = lines[env_i].split(":", 1)[1].strip()
    if rest and not rest.startswith("{"):
        print("  note: providers.native.env has an unrecognized inline form — carrier env pins NOT applied "
              "(add QUAY_NATIVE_ADR_DIR/QUAY_NATIVE_GOAL_DIR/QUAY_NATIVE_META_DIR by hand)", file=sys.stderr)
        sys.exit(0)
    if rest.startswith("{"):
        for m in re.finditer(r"(QUAY_NATIVE_\w+)\s*:", rest):
            present[m.group(1)] = ""
    else:
        for i in range(env_i + 1, block_end(env_i, env_ind)):
            m = key_re.match(lines[i])
            if m and len(m.group(1)) > env_ind:
                present[m.group(2)] = m.group(3).strip()

missing = [(k, kind) for k, kind in KINDS if k not in present]
if not missing:
    print("  unchanged: .quay/config.yml providers.native.env: (four carrier dirs already pinned — no rewrite, AC4)")
    sys.exit(0)

# Mirror the form of the existing tasks-dir pin so the env block does not mix absolute and relative.
tasks_val = present.get("QUAY_NATIVE_TASKS_DIR", "./tasks").strip().strip('"').strip("'")
absolute = tasks_val.startswith("/") or tasks_val.startswith("~")
def value_for(kind):
    return f"{ws_root}/{kind}" if absolute else f"./{kind}"

if dry_run:
    for k, kind in missing:
        print(f"  would-pin: providers.native.env.{k}: \"{value_for(kind)}\" (carrier dir pin — AC4)")
    sys.exit(0)

# ── append the missing keys to the END of the env block (or create the block, if absent) ─────────
new_lines = list(lines)
if env_i is None:
    insert_at = native_end
    base_ind = native_ind + 2
    added = [f'{" " * base_ind}env:'] + [f'{" " * (base_ind + 2)}{k}: "{value_for(kind)}"' for k, kind in missing]
else:
    last = env_i
    for i in range(env_i + 1, block_end(env_i, env_ind)):
        if lines[i].strip():
            last = i
    insert_at = last + 1
    base_ind = env_ind + 2
    added = [f'{" " * base_ind}{k}: "{value_for(kind)}"' for k, kind in missing]

new_lines[insert_at:insert_at] = added
with open(cfg, "w", encoding="utf-8") as f:
    f.write("\n".join(new_lines))
for k, kind in missing:
    print(f'  pinned: .quay/config.yml providers.native.env.{k}: "{value_for(kind)}" (carrier dir pin — AC4)')
PYEOF
}

# migrate_stale_mcp_entry: the UPGRADE-CHANNEL migration for the RETIRED project-local runtime
# (gap-dist-runtime-not-self-contained-reads-external-package-json AC4; extended by
# gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated AC1/AC2/AC3).
#
# ── RULING (AC1) ────────────────────────────────────────────────────────────────────────────────
# Of the three offered options (refresh the project-local runtime / remove it / point the config at
# the plugin's vendored runtime), the ruling is **(c): the provider binding is migrated to THIS
# plugin delivery's vendored runtime — an ABSOLUTE path under $PLUGIN_ROOT**. Rationale: 裁定 6
# (SPEC-plugin-lifecycle-single-bundle-2026-09-02) retired `.quay/runtime` lay-down and made the
# quay Claude Code plugin the SINGLE delivery surface for the runtime (quay-init is a project
# initializer, not an installer) — so options (a) "refresh" would resurrect a mechanism a ratified
# SPEC retired. Option (c)'s corollary for the now-unreferenced project-local copy is (b) "remove":
# a stale copy that no product path updates is a FALSE TARGET (it silently looks like the runtime
# while nothing maintains it), so it is retired — backed up, never silently deleted — but ONLY when
# it is unreferenced, recognizably quay's own install-generated runtime, and STALE (a byte-current
# copy is left byte-identical — AC3).
#
# ── WHAT WAS BROKEN ────────────────────────────────────────────────────────────────────────────
# The pre-fix predicate recognized only `mcp_entry` refs whose BASENAME ended in `.js`/`.ts`
# (`^quay(-native)?\.(js|ts)$`). A legacy project bound to the BARE PATH form
# (`mcp_entry: ["quay-native", "mcp"]`) matched NEITHER branch ⇒ `changed` stayed False ⇒ the
# config was preserved verbatim, the project stayed bound to "whatever $PATH happens to resolve
# on this host", and its `.quay/runtime/bin/*` bundle became a copy no product path updates or
# clears. Measured on a real legacy project 2026-09-11 (see the task's Finding).
#
# ── MIGRATION RULES ────────────────────────────────────────────────────────────────────────────
#   path       : dangling, OR a quay runtime dir under a reserved segment (pre-fix vendor/ land),
#                OR the RETIRED project-local `.quay/runtime` dir  -> $PLUGIN_ROOT/vendor/quay-native
#   mcp_entry ①: the BARE PATH form (`quay` / `quay-native`, no path separator)  -> plugin runtime
#   mcp_entry ②: a dangling reference to a quay runtime file (basename quay[-native].{js,ts}) -> plugin runtime
#   mcp_entry ③: a reference into the RETIRED project-local runtime that is STALE (bytes differ
#                from this delivery's bundle) -> plugin runtime
#   mcp_entry ④: the legacy vendor/ layout (fires even when that stale copy still exists) -> plugin runtime
# SCOPE GUARD (unchanged): an arbitrary dangling path (e.g. ./nonexistent/runtime.js) is left
# untouched so the landed vendor-runtime negative control (verify FAILS CLOSED on a dangling
# mcp_entry it cannot recognize) keeps its meaning.
# AC3 NEGATIVE CONTROL (can take false): every rule above fires only on an OLD/AMBIGUOUS form. A
# project whose `.quay/runtime/` is byte-identical to this delivery AND whose `mcp_entry` is
# already an absolute path is left byte-for-byte untouched — including its runtime dir, which must
# NOT be retired (a byte-current copy is indistinguishable from a legitimate one).
migrate_stale_mcp_entry() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  local install_provider="${PLUGIN_ROOT}/vendor/quay-native"
  local install_runtime="${install_provider}/dist/quay-native.js"
  local install_core="${PLUGIN_ROOT}/vendor/quay/dist/quay.js"
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$install_provider" "$install_runtime" "$install_core" "$WORKSPACE_ROOT" "$DRY_RUN" "$BACKUP_TS" <<'PYEOF'
import sys, os, re, yaml, hashlib, shutil
cfg, install_provider, install_runtime, install_core, ws_root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
dry_run = sys.argv[6] == "true"
backup_ts = sys.argv[7]
with open(cfg, encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}
prov = (data.get("providers") or {}).get("native")
if not isinstance(prov, dict):
    sys.exit(0)

def sha(p):
    try:
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return None

def under(path, base):
    p = os.path.abspath(str(path))
    return p == base or p.startswith(base + os.sep)

# gap-the-runtime-has-nowhere-safe-to-land: reserved directory names that must never hold the quay
# runtime in a target (Go vendor/, npm node_modules/, cargo target/, make/build/, bundler dist/).
# The landing path check is by PATH LITERAL segment (task AC9), the same list here. An EXISTING
# install (pre-fix) laid the runtime into `<target>/vendor/quay[-native]/` — on upgrade that dir
# EXISTS, so a bare `not os.path.isdir(p)` guard would never migrate it and the target would stay
# pointed at the Go-reserved directory forever. The upgrade path therefore migrates any provider
# path/mcp_entry that is (a) dangling, OR (b) a quay runtime path sitting under a reserved segment.
RESERVED = {"vendor", "node_modules", "target", "build", "dist"}
def under_reserved(p):
    parts = [seg for seg in str(p).split(os.sep) if seg]
    return any(seg in RESERVED for seg in parts)
def is_quay_runtime_dir(p):
    base = os.path.basename(str(p).rstrip(os.sep))
    return base in ("quay", "quay-native")
# The RETIRED project-local runtime dir + a predicate for "this reference points into it".
rt_dir = os.path.join(ws_root, ".quay", "runtime")
def in_retired_runtime(p):
    s = str(p)
    cands = [s] if os.path.isabs(s) else [s, os.path.join(ws_root, s)]
    return any(under(c, rt_dir) for c in cands)
# gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated AC2: the BARE PATH form. The OS
# resolves it through $PATH, so the effective runtime is "whatever this host happens to have" —
# exactly the ambiguity AC2 forbids. No separator ⇒ it is a PATH lookup, not a path.
def is_bare_path_quay(ref):
    return os.sep not in str(ref) and str(ref) in ("quay", "quay-native")
RUNTIME_BASENAME = re.compile(r"^quay(-native)?\.(js|ts)$")
# The element that NAMES the runtime is NOT always index 1. The canonical node form is
# ["node", <runtime>, "mcp"] (runtime at index 1), but the legacy BARE PATH form is
# ["quay-native", "mcp"] — the executable is index 0 there. A fixed `me[1]` therefore read "mcp",
# matched nothing, and left the whole bare form unmigrated. Scoped to the two real shapes (index 0
# bare / index 1 runtime file) so an unrelated "quay" argument deeper in the list is never touched.
def runtime_ref_index(me):
    if not isinstance(me, list) or len(me) < 2:
        return None
    if isinstance(me[0], str) and is_bare_path_quay(me[0]):
        return 0
    if isinstance(me[1], str) and RUNTIME_BASENAME.match(os.path.basename(me[1])):
        return 1
    return None

# retired_rt_state — the single source of truth for the fate of <ws>/.quay/runtime, computed ONCE
# from the ORIGINAL bytes (before any move). Both the binding rules and the retirement below read
# it, so "the runtime dir is stale" has one definition:
#   absent  — nothing there
#   retire  — recognizably quay's install-generated runtime, and STALE vs this delivery
#   keep    — recognizably quay's install-generated runtime, and byte-identical (AC3: never touch)
#   unknown — not quay's runtime shape, or the delivered bundle is unreadable ⇒ NEVER touch
# The `unknown` state exists so "cannot evaluate" never shares an output with "evaluated, fine"
# (硬规则 3b): a directory we cannot recognize is left alone rather than treated as stale.
def retired_rt_state():
    if not os.path.isdir(rt_dir):
        return "absent"
    known = [(os.path.join(rt_dir, "bin", "quay-native.js"), install_runtime),
             (os.path.join(rt_dir, "bin", "quay.js"), install_core)]
    known = [(t, s) for t, s in known if os.path.isfile(t)]
    if not known or any(sha(s) is None for _, s in known):
        return "unknown"
    return "retire" if any(sha(t) != sha(s) for t, s in known) else "keep"

rt_state = retired_rt_state()

changed = False
migrated = []   # (old, reason) — printed as the AC1/AC2 observable artifact

# path: a stale provider dir is migrated to the install-state provider dir. "Stale" = the dir does
# not exist, OR it is a quay runtime dir sitting under a reserved segment (the pre-fix vendor/
# land), OR it is the retired project-local runtime dir AND that runtime is stale. The staleness
# gate matters: a byte-current project-local runtime is a working binding, and AC3 forbids
# rewriting it (防「为修 A 而破坏 B」) — only a copy this delivery supersedes is migrated away.
p = prov.get("path")
if isinstance(p, str) and p != install_provider and (
        (not os.path.isdir(p)) or (under_reserved(p) and is_quay_runtime_dir(p))
        or (in_retired_runtime(p) and rt_state == "retire")):
    prov["path"] = install_provider
    changed = True
    migrated.append(f"path {p!r} -> {install_provider}")

# mcp_entry: any OLD/AMBIGUOUS binding form is migrated to this delivery's runtime bundle.
me = prov.get("mcp_entry")
legacy_native = os.path.join(ws_root, "vendor", "quay-native", "dist", "quay-native.js")
legacy_core = os.path.join(ws_root, "vendor", "quay", "dist", "quay.js")
if isinstance(me, list) and len(me) >= 2 and isinstance(me[1], str):
    idx = runtime_ref_index(me)
    ref = me[idx] if idx is not None else None
    reason = None
    if idx is not None and ref != install_runtime:
        if is_bare_path_quay(ref):
            reason = f"bare PATH reference {ref!r} (resolved by whatever $PATH happens to hold)"
        elif RUNTIME_BASENAME.match(os.path.basename(ref)) and (not os.path.exists(ref) or under_reserved(ref)):
            reason = f"dangling reference to a quay runtime file {ref!r}"
        # Legacy layout migration: a config from an install that laid the runtime under vendor/
        # (the OLD layout — a Go-reserved dir whose 1.3MB bundles trip common large-file hooks).
        # Fires EVEN IF the legacy vendor/ copy still exists — the layout moved.
        elif RUNTIME_BASENAME.match(os.path.basename(ref)) and ref in (legacy_native, legacy_core):
            reason = f"legacy vendor/ layout {ref!r}"
        # Retired project-local runtime that is STALE: the binding must not stay pinned to a copy
        # no product path updates. A byte-current copy is left alone (AC3 negative control) — it is
        # indistinguishable from a legitimate one.
        elif in_retired_runtime(ref) and rt_state == "retire":
            reason = f"stale retired project-local runtime {ref!r}"
    if reason:
        # Rebuild canonically: ["node", <plugin runtime>] + everything the old entry carried after
        # the runtime/executable token (the "mcp" verb + any trailing args) — identical to the
        # pre-fix output for the index-1 form, and the correct shape for the index-0 bare form.
        prov["mcp_entry"] = ["node", install_runtime] + list(me[idx + 1:])
        prov["path"] = install_provider
        changed = True
        migrated.append(f"mcp_entry {reason} -> {install_runtime}")

# ── retire the unreferenced project-local runtime (AC1 ruling (c) + its (b) corollary) ──────────
# Decide the fate of <ws>/.quay/runtime AFTER the migrations above, from the state computed before
# them. Retire it only when the post-migration binding no longer references it AND it is STALE. A
# byte-current copy is left byte-identical (AC3); an unrecognized directory is NEVER touched. The
# three outcomes each report a DISTINCT word so "retired" and "could not evaluate" never look alike.
def referenced_by_binding():
    refs = [prov.get("path")] if isinstance(prov.get("path"), str) else []
    if isinstance(prov.get("mcp_entry"), list):
        refs += [x for x in prov["mcp_entry"] if isinstance(x, str)]
    return any(in_retired_runtime(r) for r in refs)

backup_dir = os.path.join(ws_root, ".quay", "quay-init-backups", backup_ts)
if rt_state == "retire" and not referenced_by_binding():
    dest = os.path.join(backup_dir, "runtime")
    if dry_run:
        print(f"  would-retire-orphan-runtime: {rt_dir} -> {dest} (retired layout, unreferenced, stale vs this delivery — AC1)")
    else:
        os.makedirs(backup_dir, exist_ok=True)
        n = 1
        while os.path.exists(dest):
            dest = os.path.join(backup_dir, f"runtime-{n}")
            n += 1
        shutil.move(rt_dir, dest)
        print(f"  retired-orphan-runtime: {rt_dir} -> backup {dest} (retired layout, unreferenced, stale vs this delivery — AC1)")
elif rt_state == "retire":
    print(f"  kept-referenced-runtime: {rt_dir} (still referenced by the provider binding — NOT retired)")
elif rt_state == "keep":
    print(f"  kept-runtime-copy: {rt_dir} (byte-identical to this delivery — untouched, AC3)")
elif rt_state == "unknown":
    print(f"  kept-unrecognized-runtime-dir: {rt_dir} (not quay's install-generated runtime shape — never touched)")

if not changed:
    sys.exit(0)
if dry_run:
    for m in migrated:
        print(f"  would-migrate: {m} (upgrade-channel runtime migration — AC1/AC2)")
    sys.exit(0)
with open(cfg, "w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
for m in migrated:
    print(f"  migrated: {m} (upgrade-channel runtime migration — AC1/AC2)")
PYEOF
}

# validate_worktree_root (gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs):
# FAIL CLOSED when the worktree root is on tmpfs. /tmp is tmpfs — every MB is RAM — and the
# 2026-08-04 machine-wide OOM traced straight to in-flight worktrees living in it. The root dir may
# not exist yet, so stat the nearest existing ancestor. AC3 (tmpfs → reject non-zero, name the
# reason and the fix) / AC4 (a real disk root proceeds — never reject what would work).
validate_worktree_root() {
  local root="$1"
  local probe="$root"
  while [ ! -e "$probe" ] && [ "$probe" != "/" ]; do probe="$(dirname "$probe")"; done
  local fstype
  fstype="$(stat -f -c %T "$probe" 2>/dev/null || echo unknown)"
  if [ "$fstype" = "tmpfs" ]; then
    echo "ERROR: worktree root '$root' is on tmpfs ('$probe' is tmpfs) — this is memory, not disk." >&2
    echo "       Every worktree under it consumes RAM; the 2026-08-04 machine-wide OOM traced straight to it." >&2
    echo "       Change it to a real disk path — e.g. '${REPO_ROOT}/../$(basename "$REPO_ROOT")-worktrees'." >&2
    return 1
  fi
  echo "  worktree root: $root (filesystem: $fstype — not tmpfs, OK)"
  return 0
}

# ── loop-script set derivation (gap-laydown-derivation-is-sensitive-to-reference-spelling-...):
# The --loop laydown set is DERIVED from the shipped mechanism docs' OWN references, so there is
# no second hand-maintained copy to drift. It is the union of FOUR sources:
#   (a) prefix-derived — every `plugin/scripts/<name>` reference in ALL shipped skills + tick docs
#       (the doc spells the full target-local path — unambiguous → the full corpus).
#   (b) bare-resolved  — every BARE `<name>.<ext>` filename token in the MECHANISM corpus (the
#       cold-start skill + the loop tick docs — the docs that describe how the LAID-DOWN mechanism
#       operates) that exists under plugin/scripts/. A bare filename there is a target-local
#       mechanism reference (reference-spelling independence: 文档写裸文件名不再静默漏铺). Scoped to
#       the mechanism corpus because the pipeline/routine/init skills bare-MENTION plugin-local
#       tools (proposal-convergence.ts, routine-*, quay-init.sh) whose
#       transitive deps are NOT loop mechanisms — auto-laying those would ship broken files.
#   (c) explicit       — documented additions below (bare-name mechanism files the docs call with
#       no path at all, the checkers' transitive deps, the self-describing capability catalog).
#   (d) closure        — every script in the set that calls a SIBLING in the same dir
#       (`${SCRIPT_DIR}/<name>` / `$SCRIPT_DIR/<name>`) pulls that sibling in, repeated to fixpoint.
#       This is the dependency-closure invariant (铺了消费者必然铺依赖): send-keys-reliable.sh:41
#       `CHECKER="${SCRIPT_DIR}/transcript-delivery-check.ts"` is the
#       regression control — before this, the laid-down delivery-verification was broken from first use.
# Scripts that must NEVER auto-lay-down (the installer itself — it is the script doing the
# laying down; send-keys-verified.sh was DELETED by gap-retired-script-still-callable, so it is
# no longer an entry here — a superseded implementation must not exist, not merely not be laid):
NEVER_LAYDOWN="quay-init.sh"

# Cross-machine VERIFICATION mechanism (gap-no-post-merge-cross-machine-verification-detection-latency-is-luck):
# `cross-machine-verify.sh` ships with the loop because the loop tick docs reference it by full path
# (fast-mode 4b / orchestrator 3b+3d — the SAME derivation that puts sync-lag-check.sh in the set). It
# needs NO explicit entry here: the derived (a) source over plugin/loop/*.md pulls it in, and its
# sibling dependency `laydown-set-check.sh` (the default fast gate) is already in the set, so the
# dependency-closure invariant (d) is satisfied. The mechanism's shared state rides git notes
# (refs/notes/quay-cmv-*) — a notes ref, not a file, so nothing extra to lay down.

# mechanism_corpus — the docs that describe how the LAID-DOWN mechanism operates (bare-filename
# resolution scope for (b) above).
mechanism_corpus() {
  printf '%s\n' "$PLUGIN_ROOT/skills/cold-start/SKILL.md"
  for f in "$PLUGIN_ROOT"/loop/*.md; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done
}

# bare_resolved_scripts <doc>... — for each BARE `<name>.<ext>` token in the given docs that
# resolves (by existence) under plugin/scripts/ and is not NEVER_LAYDOWN, print `plugin/scripts/<tok>`.
bare_resolved_scripts() {
  [ $# -gt 0 ] || return 0   # no corpus docs → nothing to resolve (never read stdin)
  grep -ohE '(^|[^/a-zA-Z0-9._-])[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+' "$@" 2>/dev/null \
    | sed -E 's/^[^a-zA-Z0-9._-]//' | sort -u \
    | while read -r tok; do
        [ -f "$PLUGIN_ROOT/scripts/$tok" ] || continue
        case " $NEVER_LAYDOWN " in *" $tok "*) continue ;; esac
        printf 'plugin/scripts/%s\n' "$tok"
      done || true
}

# consolidated_member_files — the 40→6 grouped entry points' member implementation files
# (SPEC-instruments-behind-one-entry.md AC8/AC12). The docs/skills invoke members via the ENTRY
# POINT (`quay-<group>.ts <member>` — a subcommand name, never a plugin/scripts/ path), so the
# member files are INVISIBLE to (a)/(b) bare/path derivation but MUST ship for the entry point to
# be able to dispatch to them (a cold-started project running `quay-session.ts monitor-mount-check`
# would otherwise fail on a missing implementation). Derived from the MEMBERS declarations in each
# quay-<group>.ts — never a hand-maintained list. Prints one member basename per line.
consolidated_member_files() {
  grep -hoE 'name: "[a-zA-Z0-9._-]+", file: "[a-zA-Z0-9._-]+"' "$PLUGIN_ROOT"/scripts/quay-*.ts 2>/dev/null \
    | sed -E 's/.*file: "([^"]+)"/\1/' | sort -u
}

# _derive_loop_scripts_once — one derivation pass of the COMPLETE --loop script laydown set
# (one basename per line), derived as (a)+(b)+(c)+(d) above.
_derive_loop_scripts_once() {
  local out changed round s dep f
  local -a mech_files=()
  out="$(mktemp)"
  while IFS= read -r f; do mech_files+=("$f"); done < <(mechanism_corpus)
  # (a) prefix-derived over the FULL corpus — INCLUDING the shipped workflows (AC91
  # gap-ac91-delivery-core-refs-undelivered-files): a delivered workflow (plugin/workflows/*.js →
  # .claude/workflows/ on the target) that calls plugin/scripts/<x> makes <x> a required landing —
  # a workflow referencing a script the loop does not lay down is the same referenced-not-landed
  # defect the loop docs' refs already guard. fan-in-execute.js pulls in per-task-suite-record.ts /
  # fan-in-ac-completion-gate.ts / anti-drift-touches-check.ts this way.
  grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' "$PLUGIN_ROOT/skills"/*/SKILL.md "$PLUGIN_ROOT"/loop/*.md "$PLUGIN_ROOT"/workflows/*.js 2>/dev/null \
    | sed 's#^plugin/scripts/##' | sort -u >> "$out" || true
  # (b) bare-resolved over the MECHANISM corpus
  bare_resolved_scripts "${mech_files[@]}" | sed 's#^plugin/scripts/##' >> "$out" || true
  # (c) explicit additions:
  #   tick-doc BARE-NAME mechanism files (no plugin/scripts/ prefix in the docs → not derivable):
  #   inner-idle-log.ts, it0-split-or-commit-check.ts, pipe-exit-code-check.sh;
  #   transitive deps of the checkers (imported by them, not doc-referenced): gate-script-base.ts,
  #   workflow-event-schema.mjs, task-schema.ts, touches-parser.ts, task-status.ts, wiring-coverage-check.ts;
  #   capability catalog (gap-eighty-two-shipped-checks-and-none-says-what-it-answers): ships with
  #   the loop so an installed project can see what each laid-down check answers. Deliberate
  #   explicit addition (no doc references it by path — the catalog is self-describing).
  #   l1-delivery-surface-check.ts (gap-complete-delivery-surface-spec-and-l1-verification): the
  #   SIX-category L1 delivery-completeness check ships with the loop so an installed project can
  #   re-run it (装后能跑). Deliberate explicit addition — no shipped doc references it by path
  #   (the SPEC §6 machine-readable list is its single source, resolved via --spec).
  #   verify-delivery-surface.ts (gap-verify-delivery-surface-checks-source-layout-not-consumer-laid,
  #   追加两半 #2): the embedded-manifest L1 check ships with the loop so an installed project can
  #   SELF-CHECK its six-category delivery surface in the LAID layout (--layout laid auto-detects a
  #   consumer root). Archguard's 0/6 had two halves — wrong layout AND the check not being delivered;
  #   this explicit addition closes the "检查本身没交付" half. Same class as l1-delivery-surface-check.ts.
  #   dead-loop-check.sh (gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed):
  #   the L2 continuous-health DEAD-LOOP criterion (transcript user messages + git commit window)
  #   ships with the loop so an installed project's manager can ask "is the loop actually running".
  #   Deliberate explicit addition — the SPEC §5 annotation is the cross-reference (not a shippable
  #   SKILL.md/loop-doc path reference, so (a)/(b) derivation would miss it).
  #   inner-blocked-signal.ts + inner-forensics.mjs (the shared-events mechanism retired,
  #   found by the quay-init-loop AC3 green requirement): the docs invoke them via the quay-deliver.ts
  #   subcommand registry (`plugin/scripts/quay-deliver.ts inner-blocked-signal` / `... inner-forensics`),
  #   so (a) derives quay-deliver.ts but not the implementation files — a cold-started project would run
  #   the subcommand and fail on a missing implementation. Deliberate explicit additions so the registered
  #   subcommands' implementations ship with the loop.
  #   task-contract-check.ts + task-status-drift-check.ts + touches-orthogonality-check.ts (same finding):
  #   the fast-mode gate checkers (## Contract / task-status drift / touch orthogonality) are invoked by
  #   the tick docs WITHOUT a `plugin/scripts/` path and are not bare-resolved by the mechanism corpus, so
  #   (a)/(b) derivation misses them — a cold-started project would run the gates and fail on missing
  #   checkers. Deliberate explicit additions (same class as the other checker transitive deps above).
  #   quay-session.ts (gap-quay-init-real-install-regression-fix ②): the manager tick core's A0 readings
  #   script (`node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings`).
  #   The shipped plugin/loop/manager-tick-core.md is a one-line POINTER to the orchestration/ 正本
  #   (gap-plugin-loop-manager-drifted-copies-pointerize), so the (a) scan of the SHIPPED docs no longer
  #   sees `plugin/scripts/quay-session.ts` and it stopped shipping — but the REAL core laid down to
  #   orchestration/ still references it (gate-validated dep). Deliberate explicit addition so a
  #   cold-started --manager project's core runs its A0 readings instead of failing on a missing script.
  #   precommit-guard.ts (gap-precommit-guard-wire-into-quay-init-and-cold-start): the SHARED pre-commit
  #   guard ships with the loop so a provisioned project has the guard script laid down for its
  #   `--install-hook` step (quay-init --loop installs the hook post-laydown; cold-start re-verifies it).
  #   The guard is a CROSS-CUTTING mechanism (covers ALL writers — outer/manager/inner), not a
  #   tick-doc-invoked script, so (a)/(b) derivation from the docs would miss it; the cold-start skill
  #   ALSO references it by path (rule (a)), but the explicit entry keeps the guard shipping even if a
  #   future doc edit drops that reference. The guard's data dependency judged-object-registry.json is
  #   NOT shipped — it is A0b③ GENERATED per project (empty patterns ⇒ the guard takes its narrowed
  #   fallback tasks/** + plugin/loop/** + scripts/test.sh @static-object aggregate, which is the
  #   intended target behavior).
  #   touches-one-entry-one-path-check.ts (gap-quay-init-laydown-missing-touches-checker): precommit-
  #   guard.ts imports it via ESM `./touches-one-entry-one-path-check.ts` (the Touches「一条目一路径」
  #   check the guard runs on every commit). The dependency-closure step (d) below only scans
  #   `${SCRIPT_DIR}/<name>` sibling references in shell scripts — an ESM relative `./` import is
  #   INVISIBLE to it — so without an explicit entry a cold-started consumer workspace lays down
  #   precommit-guard.ts without its imported checker and the guard's `--install-hook` step dies with
  #   ERR_MODULE_NOT_FOUND (the delta-scope unverified-landing the touches fan-in's skipped full suite
  #   let through). Same class as the other checker transitive deps listed above.
  #   repo-root.sh + repo-root.ts (gap-b2-repo-root-unification): capability-catalog.sh sources
  #   repo-root.sh via `${SELF_DIR}/repo-root.sh` (NOT `${SCRIPT_DIR}/` — the closure step (d)
  #   below only scans `${SCRIPT_DIR}/` shell sibling refs, so the SELF_DIR form is INVISIBLE to
  #   it), and the migrated scripts import repo-root.ts via ESM `./repo-root.ts` (also invisible to
  #   (d)). Without an explicit entry a laid-down catalog/precommit-guard sources/imports a missing
  #   repo-root and dies with "No such file or directory" / ERR_MODULE_NOT_FOUND. Same class as
  #   touches-one-entry-one-path-check.ts above — the single repo-root resolver must land with
  #   every consumer.
  #   checker-io.ts + driver-result.ts (gap-b4-checker-reuse-driver-result): the laid-down checkers
  #   outer-anchor-check.ts (derived via (a)) and adr016-screen-use-check.ts (via (b)) import
  #   checker-io.ts via ESM `./checker-io.ts`, which re-exports driver-result.ts at runtime — an ESM
  #   `./` import is INVISIBLE to closure step (d) (same class as touches-one-entry-one-path-check.ts
  #   above), so without an explicit entry a cold-started project lays the checkers without their
  #   DriverResult<T> bridge and dies with ERR_MODULE_NOT_FOUND. driver-result.ts is itself the ESM dep
  #   of the laid-down driver-runtime.ts / promotion-driver.ts / worker-driver.ts (AC153), so it ships
  #   here too (checker-io.ts re-exports it at runtime — both must land or neither works).
  #   canonical-test-files.ts (gap-canonical-test-files-glob-vs-realpath-divergence): test-framework-
  #   policy-check.ts is laid down via a bare-name mention in plugin/loop/orchestrator-tick-core.md,
  #   and imports this lib via ESM `./canonical-test-files.ts` — an ESM relative `./` import is
  #   INVISIBLE to the dependency-closure step (d) below (it only scans `${SCRIPT_DIR}/<name>`
  #   sibling references in shell scripts), so without this explicit entry a cold-started consumer
  #   lays down test-framework-policy-check.ts without its imported lib and the check dies with
  #   ERR_MODULE_NOT_FOUND. Same class as touches-one-entry-one-path-check.ts above.
  #   suite-params.ts (gap-suite-knobs-config-file-priority): full-suite-runner.ts is laid down via
  #   plugin/workflows/fan-in-execute.js (rule (a)) and imports suite-params.ts via ESM `./suite-params.ts`
  #   — an ESM relative `./` import is INVISIBLE to closure step (d) (same class as canonical-test-files.ts
  #   above), so without this explicit entry a cold-started consumer lays down full-suite-runner.ts
  #   without its suite-knob config reader and the runner dies with ERR_MODULE_NOT_FOUND.
  #   over90-task-gate.ts + semantic-trigger.ts + main-thread-edit-check.ts (gap-retire-inner-hygiene-
  #   migrate-helper): the three ①类 live helpers migrated OUT of inner-blocked-signal.ts /
  #   inner-wakeup-heartbeat-check.ts / inner-exec-mode-report.ts into non-inner names. Their consumers
  #   (inner-blocked-signal.ts — already in the (c) list — supervisor-preempt-candidates.ts, semantic-
  #   observer-judge.ts, inner-exec-mode-report.ts shim) import them via ESM `./x.ts`, which is INVISIBLE
  #   to closure step (d) (same class as repo-root.ts / checker-io.ts / canonical-test-files.ts above) —
  #   without explicit entries a laid-down inner-blocked-signal.ts / judge / shim dies with
  #   ERR_MODULE_NOT_FOUND.
  #   per-file-cpu-report.mjs (gap-perfile-cpu-cost-collection): full-suite-runner.ts (laid down via
  #   fan-in-execute.js rule (a)) loads this preload seam at RUNTIME via `NODE_OPTIONS=--require=<abs>`
  #   built from a path.join STRING constant (PER_FILE_CPU_PRELOAD) — NOT an ESM `./` import, NOT a
  #   `${SCRIPT_DIR}/` shell sibling ref, NOT a doc `plugin/scripts/` path, so (a)/(b)/(d) all miss it.
  #   Without this explicit entry a cold-started consumer lays down full-suite-runner.ts and dies at
  #   suite launch with ERR_MODULE_NOT_FOUND (the --require target is absent). Same class as
  #   suite-params.ts / repo-root.ts above.
  #   task-ops.ts (gap-task-ops-consolidate-driver-frontmatter-writers): the single library owning
  #   "parse task frontmatter, mutate a field, commit it". driver-filters.ts / worker-driver.ts /
  #   ready-pool-check.ts (all laid down via (a)/(b)) import it via ESM `./task-ops.ts`, which is
  #   INVISIBLE to closure step (d) (same class as task-schema.ts above) — without this explicit entry a
  #   cold-started consumer lays the drivers without their shared parse/patch/commit library and dies
  #   with ERR_MODULE_NOT_FOUND.
  #   shape-sections.ts (gap-shape-section-tables-dual-copy-no-single-source): the PURE-DATA single
  #   source of the shape section-heading lists. ready-pool-check.ts (laid down) imports it via ESM
  #   `./shape-sections.ts` (INVISIBLE to closure step (d), same class as task-schema.ts / task-ops.ts
  #   above), AND packages/quay-native/src/store.ts imports it via a relative path that esbuild inlines
  #   into the dist bundle. Without this explicit entry a cold-started consumer lays ready-pool-check.ts
  #   with no sibling shape-sections.ts and dies with ERR_MODULE_NOT_FOUND (this is exactly the defect
  #   this task closed: the section list lived in store.ts which is NOT laid down).
  printf '%s\n' inner-idle-log.ts it0-split-or-commit-check.ts pipe-exit-code-check.sh \
    gate-script-base.ts workflow-event-schema.mjs task-schema.ts task-ops.ts shape-sections.ts touches-parser.ts task-status.ts wiring-coverage-check.ts \
    capability-catalog.sh l1-delivery-surface-check.ts dead-loop-check.sh inner-blocked-signal.ts \
    inner-forensics.mjs task-contract-check.ts task-status-drift-check.ts touches-orthogonality-check.ts \
    verify-delivery-surface.ts precommit-guard.ts touches-one-entry-one-path-check.ts quay-session.ts \
    repo-root.sh repo-root.ts checker-io.ts driver-result.ts canonical-test-files.ts suite-params.ts \
    over90-task-gate.ts semantic-trigger.ts main-thread-edit-check.ts per-file-cpu-report.mjs >> "$out"
  # (c3) exec-core tick docs (gap-ac37-exec-core-ships-with-package): the three ≤80-line execution
  #   cores ship with the loop so an installed project can read "每轮该做什么" — the shipped tick
  #   templates (orchestrator-loop-tick.md / fast-mode-loop-tick.md) reference them by the
  #   `orchestration/<name>` path, and the referenced⊆landed gate (:1081) must see them LAND (this
  #   entry makes them part of the derived set ⇒ no new check needed). They live under plugin/loop/
  #   (source: orchestration/<name>), NOT plugin/scripts/, so the laydown loop + drift report treat
  #   them as loop docs (orchestration/ landing), distinct from scripts. manager-tick-core.md is
  #   OPT-IN: laid only with --manager (human ruling 2026-08-10: the typical path is two-layer), but
  #   still derived so ITS OWN references are gate-validated in every --loop run.
  printf '%s\n' orchestrator-tick-core.md fast-mode-tick-core.md manager-tick-core.md >> "$out"
  # (c2) consolidated grouped-entry members (SPEC-instruments-behind-one-entry.md AC8/AC12): the
  #   docs invoke them via `quay-<group>.ts <member>` (a subcommand, never a plugin/scripts/ path),
  #   so (a)/(b) cannot see them — but the entry point must dispatch to them, so they ship. Only
  #   EXISTING members land here (a missing member is a plugin defect, surfaced by
  #   verify_referenced_landed's unconditional member reference, not silently dropped from the set).
  for f in $(consolidated_member_files); do
    [ -f "$PLUGIN_ROOT/scripts/$f" ] || continue
    case " $NEVER_LAYDOWN " in *" $f "*) continue ;; esac
    printf '%s\n' "$f" >> "$out"
  done
  sort -u "$out" -o "$out"
  # archive/** exclusion (§12c, SPEC-plugin-lifecycle-single-bundle-2026-09-02): a doc-referenced
  # script that has been archived (moved to archive/<date>/plugin/scripts/<name>) is no longer part of
  # the laydown set — restore re-registers it (SPEC §12b-3). Only consult archive/ when it exists.
  if [ -d "${PLUGIN_ROOT}/../archive" ]; then
    _archived_names="$(find "${PLUGIN_ROOT}/../archive" -type f 2>/dev/null | sed 's#.*/##' | sort -u | tr '\n' ' ')"
    if [ -n "${_archived_names}" ]; then
      awk -v names="${_archived_names}" 'BEGIN{split(names,a," "); for(i in a) skip[a[i]]=1} !($0 in skip)' "$out" > "$out.archfilt"
      mv "$out.archfilt" "$out"
    fi
  fi
  # (d) dependency closure — repeat until fixpoint. ONE python3 pass replaces the retired per-script
  # `grep -oE … | sed … | sort -u` triple + per-dep `grep -qxF` (the per-script subprocess spawns were
  # the dominant wall-clock cost of derive_loop_scripts; gap-quay-init-install-wall-clock-slow AC1/AC3
  # batched ~1000 fork/execve per pass into ONE). The closure regex keeps the PACKAGED two-segment
  # form `${SCRIPT_DIR}/dist/X.js` (gap-delivery-laydown-dist-closure-gap: package.sh rewrites .ts refs
  # to dist/X.js; a single-segment `[a-zA-Z0-9._-]*` truncated it to `dist` and the sed basename-strip
  # then dropped the dist/ prefix — the bundle never entered the laydown set). Allow `/` in the matched
  # path and strip ONLY the ${SCRIPT_DIR}/ or $SCRIPT_DIR/ prefix (NOT a basename-strip) so the
  # scripts/-relative path `dist/X.js` resolves under scripts/. The python pass mirrors the retired
  # loop EXACTLY: iterate the round-start snapshot (`for s in $(cat "$out")`), append new deps (picked
  # up next round), membership = the LIVE set (`grep -qxF "$dep" "$out"`), same filters (non-empty →
  # not NEVER_LAYDOWN → exists under scripts/), same round<20 bound, same sorted-unique output.
  python3 - "$out" "$PLUGIN_ROOT" "$NEVER_LAYDOWN" <<'PYEOF'
import sys, os, re
out_path, root, never = sys.argv[1], sys.argv[2], set(sys.argv[3].split())
pat = re.compile(r'(?:\$\{SCRIPT_DIR\}/|\$SCRIPT_DIR/)([a-zA-Z0-9][a-zA-Z0-9._/-]*)')
def read(p):
    try:
        with open(p, "rb") as fh:
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""
names = []
with open(out_path, "r", encoding="utf-8") as fh:
    for ln in fh:
        ln = ln.strip("\n")
        if ln:
            names.append(ln)
seen = set(names)
changed, rnd = True, 0
while changed and rnd < 20:
    changed = False
    rnd += 1
    for s in names[:]:                        # the round-start snapshot ($(cat "$out"))
        script = os.path.join(root, "scripts", s)
        if not os.path.isfile(script):        # [ -f "$PLUGIN_ROOT/scripts/$s" ] || continue
            continue
        for dep in pat.findall(read(script)):
            if not dep:                       # [ -n "$dep" ] || continue
                continue
            if dep in never:                  # case " $NEVER_LAYDOWN " in *" $dep "*
                continue
            if not os.path.isfile(os.path.join(root, "scripts", dep)):  # [ -f …/$dep ]
                continue
            if dep not in seen:               # ! grep -qxF "$dep" "$out"
                names.append(dep)
                seen.add(dep)
                changed = True
with open(out_path, "w", encoding="utf-8") as fh:
    for x in sorted(set(names)):              # sort -u "$out"
        fh.write(x + "\n")
PYEOF
  sort -u "$out"
  rm -f "$out"
}

# derive_loop_scripts — stability-checked wrapper over _derive_loop_scripts_once
# (gap-quay-init-torn-read-derive-loop-scripts). The laydown set is derived by grep over the shipped
# corpus (skills/*/SKILL.md + loop/*.md + workflows/*.js); under heavy concurrent load a grep/sort in
# a command substitution can be killed mid-stream (the `|| true` masks it), returning a PARTIAL (torn)
# set — which then lays down FEWER scripts than the docs reference, and verify_referenced_landed
# (which re-derives the reference set independently) false-positives every missing script as
# referenced-not-landed (observed at cc8: 104 scripts ≈ the ENTIRE reference set in one run). Same
# torn-read class as _read_declarations (a4f1e41d) — same fix: two independent passes must produce
# IDENTICAL output (a torn pass truncates at a nondeterministic point, so it differs from a full pass
# ⇒ retry); only two agreeing non-empty passes are accepted. A stable corpus derives deterministically,
# so real drift is never masked: a genuinely-absent script is absent from EVERY pass, and the
# downstream verify_referenced_landed still fail-closes on it.
derive_loop_scripts() {
  local a b attempt
  for attempt in 1 2 3; do
    a="$(_derive_loop_scripts_once)"
    b="$(_derive_loop_scripts_once)"
    if [ -n "$a" ] && [ "$a" = "$b" ]; then
      printf '%s\n' "$a"
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 0.2
  done
  # All passes torn or mutually inconsistent — output the LAST snapshot. A torn laydown lays fewer
  # scripts, so the downstream verify_referenced_landed fail-closes on a genuinely-missing file (the
  # install fails, never a false pass). The normal case (stable corpus) never reaches this branch.
  printf '%s\n' "$a"
  return 0
}

# ── exec-core pointer resolution (gap-quay-init-real-install-regression-fix ②) ─────────────────────
# resolve_tick_core_src <basename> — the --loop laydown copies the exec-core tick docs from
# plugin/loop/<name> to the target's orchestration/<name>. Since gap-plugin-loop-manager-drifted-
# copies-pointerize, the SHIPPED plugin/loop/manager-tick-core.md is a one-line POINTER
# (`> 正本: orchestration/<name> — ...`) to the orchestration/ 正本 — laying the pointer line into a
# cold-started target would deliver a self-referential stub instead of the real core, and the real
# core's deps (e.g. plugin/scripts/quay-session.ts) would stop shipping (the derive_loop_scripts (a)
# scan only sees refs in the SHIPPED docs). Resolve the pointer: return the ABSOLUTE path of the
# 正本 (${PLUGIN_ROOT}/../<pointed-path>) when the shipped file is a pointer, else the shipped path
# itself (unchanged verbatim laydown). The 正本 lives beside the plugin (the quay repo layout: plugin/
# and orchestration/ are siblings), so a --loop install lays the REAL core, byte-identical to 正本.
resolve_tick_core_src() {
  local name="$1" shipped resolved cand
  shipped="$PLUGIN_ROOT/loop/$name"
  if [ -f "$shipped" ]; then
    resolved="$(sed -n '1s/^> 正本: \([a-zA-Z0-9._\/-]*\).*$/\1/p' "$shipped" 2>/dev/null | head -1)"
    if [ -n "$resolved" ]; then
      cand="$PLUGIN_ROOT/../$resolved"
      if [ -f "$cand" ]; then
        printf '%s\n' "$cand"
        return 0
      fi
    fi
  fi
  printf '%s\n' "$shipped"
}

# verify_referenced_landed <workspace-root> — gap-init-ships-a-skill-that-calls-files-it-does-not-
# lay-down. The mechanical constraint "referenced set ⊆ landed set": every file the shipped skills
# and tick docs reference — by path (plugin/scripts/*, orchestration/*, docs/analysis/*) OR by BARE
# filename in the mechanism corpus (resolved under plugin/scripts/, the SAME derivation the laydown
# uses — AC3: checker and checked can no longer share a blind spot) — must exist in the target
# workspace after the --loop lay-down, AND every laid-down script's same-dir sibling dependency
# (${SCRIPT_DIR}/<name>) must be laid down too (dependency closure, AC1), UNLESS explicitly
# declared in plugin/skills/init/SKILL.md as self-create (local state the first run creates — AC8)
# or reference-doc (quay-specific template prose that is not a loop-mechanism deliverable). The two
# hand-maintained lists (call sites vs landing set) with no mechanical bond must drift; this is
# the bond. A referenced file that is neither landed nor declared = drift → FAIL CLOSED.
# AC2 (gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop): the reference set ALSO
# includes the CONSUMER-LAID docs at <ws>/docs/analysis/ — the byte-identical copies a target
# project actually reads. The source scan alone could not see the AC37 blind spot (a laid tick doc
# referencing plugin/loop/* paths that never land); scanning the laid docs closes it.

# _reference_set_once <ws> — ONE derivation pass of the complete verify_referenced_landed reference
# set (one path per line, sorted unique): (1) path-prefixed refs in the shipped corpus (skills +
# loop docs + workflows) — incl. the `.claude/workflows|.claude/agents` delivery class (AC91); (2)
# path-prefixed refs in the CONSUMER-LAID docs at <ws>/docs/analysis/ (AC2 — the byte-identical
# copy a target project actually reads; `plugin/loop` is in the alternation so a shipped doc
# referencing the non-landed bundle-source path fails closed); (3) BARE filename refs in the
# mechanism corpus resolved under plugin/scripts/ (bare_resolved_scripts — the SAME derivation the
# laydown uses, AC3: checker and checked share no blind spot); (4) consolidated grouped-entry
# members (SPEC-instruments-behind-one-entry.md — EVERY member of a shipped quay-<group>.ts must
# land; a member absent from the plugin source is exactly the referenced-not-landed defect, so it is
# unconditional). Read-only over the plugin source + <ws>.
_reference_set_once() {
  local ws="$1"
  local mech_bare consolidated_refs member
  local -a mech_files=()
  while IFS= read -r f; do mech_files+=("$f"); done < <(mechanism_corpus)
  mech_bare="$(bare_resolved_scripts "${mech_files[@]}")"
  consolidated_refs=""
  for member in $(consolidated_member_files); do
    case " $NEVER_LAYDOWN " in *" $member "*) continue ;; esac
    consolidated_refs+="plugin/scripts/$member"$'\n'
  done
  ( grep -ohE '(plugin/scripts|plugin/loop|orchestration|docs/analysis|\.claude/workflows|\.claude/agents)/[a-zA-Z0-9._-]+' "$PLUGIN_ROOT/skills"/*/SKILL.md "$PLUGIN_ROOT"/loop/*.md "$PLUGIN_ROOT"/workflows/*.js 2>/dev/null
    grep -ohE '(plugin/scripts|plugin/loop|orchestration|docs/analysis)/[a-zA-Z0-9._-]+' "$ws"/docs/analysis/*.md 2>/dev/null
    printf '%s\n' "$mech_bare"
    printf '%s' "$consolidated_refs"
  ) | sort -u || true
}

# _read_references <ws> — stability-checked wrapper over _reference_set_once
# (gap-verify-referenced-landed-concurrency-hardening-insufficient). The reference set is derived by
# grep over the shipped corpus + the consumer-laid docs; under heavy concurrent load a grep/sort in a
# command substitution can be killed mid-stream (the pipeline's `|| true` masks the death), returning
# a PARTIAL (torn) set. Same torn-read class as _read_declarations (a4f1e41d) and derive_loop_scripts
# (089365b5) — same fix: two independent passes must produce IDENTICAL output (a torn pass truncates
# at a nondeterministic point ⇒ differs from a full pass ⇒ retry); only two agreeing non-empty passes
# are accepted. A single torn pass would silently MISS a genuinely-referenced-but-not-landed file (a
# false negative that violates fail-closed), so the check never accepts one. A genuinely-missing ref
# is absent from EVERY pass, so real drift is never masked.
_read_references() {
  local ws="$1" a b attempt
  for attempt in 1 2 3; do
    a="$(_reference_set_once "$ws")"
    b="$(_reference_set_once "$ws")"
    if [ -n "$a" ] && [ "$a" = "$b" ]; then
      printf '%s\n' "$a"
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 0.2
  done
  # All passes torn or mutually inconsistent — output the LAST snapshot (never a silent empty set;
  # the downstream landed-scan + declaration/landed fresh re-read still fail-closes on a genuine miss).
  printf '%s\n' "$a"
  return 0
}

# _read_declarations — stability-checked declaration reads (self-create + reference-doc), EXTRACTED
# from verify_referenced_landed (gap-quay-init-reduce-real-install-count) so a torn-read test can
# SOURCE quay-init.sh and call it directly (免完整安装) instead of running a full --loop install.
# Reads the machine-readable `<!-- self-create: … -->` / `<!-- reference-doc: … -->` declarations in
# plugin/skills/init/SKILL.md with the SAME multi-attempt stability check the gate has always used:
# two independent reads must agree AND the always-present sentinel lines must be in the agreed
# snapshot. On success it sets the globals QUAY_INIT_SELFCREATE / QUAY_INIT_REFDOC (newline-separated
# sets) and returns 0; on exhaustion (all attempts torn/inconsistent) it sets them to the LAST
# snapshot and returns 1. verify_referenced_landed consumes the globals; a direct caller uses the
# return code.
_read_declarations() {
  local attempt=1 s r s2 r2
  for attempt in 1 2 3; do
    s="$(grep -oE '<!-- self-create: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- self-create: //; s/ -->//' | sort -u || true)"
    r="$(grep -oE '<!-- reference-doc: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- reference-doc: //; s/ -->//' | sort -u || true)"
    # Stability check: a SECOND, independent read must return the SAME sets. A transiently
    # incomplete read (that kept the old 2-line sentinel but dropped a later declaration) will
    # differ from a full read here, so this is strictly stronger than the retired sentinel.
    s2="$(grep -oE '<!-- self-create: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- self-create: //; s/ -->//' | sort -u || true)"
    r2="$(grep -oE '<!-- reference-doc: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- reference-doc: //; s/ -->//' | sort -u || true)"
    # The original 2-line sentinel is kept as a cheap additional guard on top of stability:
    # the always-present sentinel lines must be in the agreed snapshot too (a read torn before
    # them is caught even if both reads agree on the torn set). A genuinely-missing declaration
    # file never passes either guard.
    if [ "$s" = "$s2" ] && [ "$r" = "$r2" ] \
      && printf '%s\n' "$s" | grep -qxF 'orchestration/tick-log.md' \
      && printf '%s\n' "$r" | grep -qxF 'orchestration/manager-tick-log.md'; then
      QUAY_INIT_SELFCREATE="$s"; QUAY_INIT_REFDOC="$r"; return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 0.2
  done
  # All 3 reads incomplete or mutually inconsistent — keep the LAST snapshot; the per-reference
  # loop in verify_referenced_landed will fail on a genuine miss (real drift is never masked).
  QUAY_INIT_SELFCREATE="$s"; QUAY_INIT_REFDOC="$r"; return 1
}

verify_referenced_landed() {
  local ws="$1" missing=0 closure_missing=0 r sd script
  local refs selfcreate refdoc
  # Machine-readable declarations live in the shipped init skill (single source of truth — the
  # same doc the human reads). Marker lines:
  #   <!-- self-create: <path> -->       local state, first run creates it (AC8)
  #   <!-- reference-doc: <path> -->     quay-specific reference doc, not a loop deliverable
  # gap-verify-referenced-landed-concurrency-hardening AC1: read the declaration sets ONCE, with
  # multi-level retry. gap-lowconc AC3's single re-read proved insufficient under cc3 load — the
  # concurrent --loop installs' reads of init/SKILL.md transiently return INCOMPLETE output, so a
  # DECLARED reference-doc is false-positived as not-declared (4 files in one run). Retry up to 3
  # times with the SAME stable snapshot until the read is complete; a genuinely-undeclared ref
  # never satisfies any read, so real drift still fails (negative control unchanged).
  #
  # 2026-08-18 STRENGTHENING (suite-fix, worktree-root-fs-check AC4 false positive at cc8): the
  # original completeness sentinel pinned only TWO always-present lines (tick-log.md self-create +
  # manager-tick-log.md reference-doc). A transiently-partial read can keep BOTH sentinel lines yet
  # drop a LATER declaration (observed: SPEC-methodology-as-a-deliverable.md at line 173) — the
  # sentinel passes, the incomplete snapshot is accepted, and a declared ref is false-positived as
  # not-declared. The sentinel is therefore replaced by a STABILITY check: two independent reads
  # of init/SKILL.md must produce IDENTICAL declaration sets. A torn read (which truncates at a
  # nondeterministic point) differs from a full read, so it retries; only two agreeing reads are
  # accepted as complete. A genuinely-undeclared ref is absent from every read, so real drift
  # still fails (negative control unchanged).
  # Read the declaration sets once with the multi-level stability retry. The verdict is captured via
  # `if` (NOT a bare call — a bare `_read_declarations` returning 1 under `set -e` would abort the
  # whole check with no verdict). A torn up-front read is re-stabilized per-reference below, never
  # trusted blindly: a declared self-create (e.g. orchestration/escalations.md) read as absent is
  # exactly the false positive this gate must not emit.
  if _read_declarations; then :; fi
  selfcreate="$QUAY_INIT_SELFCREATE"
  refdoc="$QUAY_INIT_REFDOC"
  # The reference set is derived once, STABILITY-CHECKED (two agreeing passes — _read_references),
  # so the landed-scan below runs against a deterministic snapshot (gap-verify-referenced-landed-
  # concurrency-hardening-insufficient: the reference-scan grep was the last single-pass "裸 grep"
  # face, torn under concurrent --loop load).
  refs="$(_read_references "$ws")"
  for r in $refs; do
    # exact-line membership in the declared sets (newline-separated — a `case` pattern would
    # need spaces the multi-line variable does not have)
    if printf '%s\n' "$selfcreate" "$refdoc" | grep -qxF "$r"; then
      continue   # declared self-create or reference-doc — not a defect
    fi
    if [ ! -e "$ws/$r" ]; then
      # last line of defense: re-read the declarations with the SAME stability check the up-front read
      # uses (two agreeing passes + sentinel), NOT a single-pass grep. The retired single-pass
      # fresh-read could itself be torn under concurrent --loop load and false-positive a DECLARED
      # self-create/reference-doc (observed: orchestration/escalations.md — declared at
      # init/SKILL.md:143 but read as absent). A stability-checked re-read retries a torn pass; a
      # genuinely-undeclared ref is absent from every stable pass, so fail-closed is unchanged.
      local fresh_stable=0
      if _read_declarations; then fresh_stable=0; else fresh_stable=1; fi
      if printf '%s\n' "$QUAY_INIT_SELFCREATE" "$QUAY_INIT_REFDOC" | grep -qxF "$r"; then
        continue   # stability-checked re-read confirms the declaration — the up-front snapshot was torn
      fi
      if [ "$fresh_stable" != 0 ]; then
        # The declaration file could not be stabilized across retries (torn under load). Do NOT emit
        # "referenced-not-landed" from an unreliable read — that would false-positive a declared file
        # (硬规则 3b mirror: an unreadable input must not masquerade as a definitive miss). Report a
        # DISTINGUISHABLE failure instead and fail closed.
        echo "  FAIL (declaration-read-unstable): $r — init/SKILL.md declarations could not be read reliably (torn under load); re-run quay-init" >&2
        missing=1
        continue
      fi
      # last line of defense for the LANDED set (same torn-read class, opposite face): a concurrent
      # --loop install's write can transiently make a just-laid file invisible to the `-e` scan (the
      # "landed 集扫描" torn snapshot). Re-scan existence once more before failing; a genuinely-
      # missing file is absent from BOTH scans, so real drift still fails (fail-closed unchanged).
      if [ -e "$ws/$r" ]; then
        continue   # fresh existence scan finds it landed — the first scan was a transiently-torn snapshot
      fi
      echo "  FAIL (referenced-not-landed): $r — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md" >&2
      echo "       Fix: add \"<!-- reference-doc: $r -->\" (or \"<!-- self-create: $r -->\" if the loop lays it down) to plugin/skills/init/SKILL.md, or fix the doc's path to a file the loop actually lays down" >&2
      missing=1
    fi
  done
  # dependency-closure check (AC1/AC3): every LAID-DOWN script's same-dir sibling reference must be
  # laid down too — a script calling `${SCRIPT_DIR}/<sibling>` with the sibling absent is a broken
  # mechanism (send-keys-reliable.sh:41 → transcript-delivery-check.ts).
  if [ -d "$ws/plugin/scripts" ]; then
    for script in "$ws"/plugin/scripts/*.sh; do
      [ -f "$script" ] || continue
      # gap-delivery-laydown-dist-closure-gap: same two-segment tolerance as the derive closure —
      # a laid-down script's `${SCRIPT_DIR}/dist/X.js` reference must be checked as
      # $ws/plugin/scripts/dist/X.js, NOT truncated to the dist/ directory (which exists once any
      # other bundle lands ⇒ the old check passed while the specific .js was missing). Strip only
      # the ${SCRIPT_DIR}/ or $SCRIPT_DIR/ prefix so the scripts/-relative path is preserved.
      for sd in $(grep -oE '\$\{SCRIPT_DIR\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*' "$script" 2>/dev/null | sed -E 's#^\$\{SCRIPT_DIR\}/##; s#^\$SCRIPT_DIR/##' | sort -u || true); do
        [ -n "$sd" ] || continue
        case " $NEVER_LAYDOWN " in *" $sd "*) continue ;; esac
        if [ ! -e "$ws/plugin/scripts/$sd" ]; then
          echo "  FAIL (dependency-not-landed): $script references plugin/scripts/$sd but it is not laid down" >&2
          closure_missing=1
        fi
      done
    done
  fi
  if [ "$missing" = 1 ] || [ "$closure_missing" = 1 ]; then
    echo "ERROR: quay-init --loop would ship skills/tick docs (source OR consumer-laid docs/analysis/) that reference files it does not lay down (referenced ⊆ landed violated)." >&2
    echo "       Add the script to the landing set, declare the file self-create/reference-doc in plugin/skills/init/SKILL.md, or fix the doc's path to the real landing." >&2
    return 1
  fi
  echo "  verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc; every laid-down script's same-dir dependency is landed)"
  return 0
}

# verify_delivery_surface_l1 — gap-complete-delivery-surface-spec-and-l1-verification (AC5): the
# SIX-category L1 delivery-completeness check. verify_referenced_landed (above) covers category 1
# (mechanisms/runtime: referenced ⊆ landed); this extends the L1 surface to ALL SIX categories —
# each category's deliverables present + owning gap task filed (SPEC §6 machine-readable list is
# the single source). Runs against the SHIPPED delivery surface (the quay checkout root — the SPEC
# lives at <repo>/orchestration/, outside the plugin bundle), fail-closed on any uncovered category.
# In a BARE plugin copy (hermetic tests) the repo-level SPEC is absent → SKIP (referenced⊆landed
# still guards the mechanism axis). This wiring was re-added after being removed by the AC168
# closed-set shrink (commit 6358b2cd6) — the L1 check ships in the derived laydown set (explicit
# addition `l1-delivery-surface-check.ts` in derive_loop_scripts) and must still be invoked post-init
# beside verify_referenced_landed (the AC5 wiring contract, gap-suite-baseline-red-l1-wiring-...).
verify_delivery_surface_l1() {
  local delivery_root spec_file
  l1_script="$PLUGIN_ROOT/scripts/l1-delivery-surface-check.ts"
  delivery_root="$(cd "$(dirname "$PLUGIN_ROOT")" && pwd)"
  spec_file="$delivery_root/orchestration/SPEC-complete-delivery-surface-2026-08-05.md"
  if [ -f "$l1_script" ] && [ -f "$spec_file" ]; then
    if node --no-warnings --experimental-strip-types "$l1_script" --surface --root "$delivery_root" --spec "$spec_file"; then
      : # six-category delivery surface complete — the OK line is on the check's stdout
    else
      echo "ERROR: delivery-surface L1 check failed — the six-category delivery surface is incomplete." >&2
      return 1
    fi
  elif [ -f "$l1_script" ]; then
    echo "  delivery-surface-l1: SKIP (repo-level SPEC not found at $spec_file — bare plugin copy; referenced⊆landed still guards the mechanism axis)"
  fi
  return 0
}

# dist_stale <bundle> <src_dir> — AC1 stale detection for the vendored runtime bundle
# (gap-upgrade-channel-cant-sync-build-artifacts-dist-stale). A git pull syncs SOURCE (tracked)
# but not the gitignored dist/, so the bundle can be older than the source that produced it — the
# exact B-machine mixed state (dist built 13:34, fix merged 15:10, ENOENT persists because verify
# checked existence, not freshness). Returns:
#   0 (STALE) when any source file under <src_dir> is newer than <bundle>
#   1 (fresh) when <bundle> is newer than every source file (or the src dir is empty)
#   2 (no-source-tree) when <src_dir> does not exist — an installed plugin cache (user-scope) has
#     no packages/ tree, so this check cannot fire there (AC4's version-based check owns that path).
dist_stale() {
  local bundle="$1" src_dir="$2" newest=0 m bm
  [ -d "$src_dir" ] || return 2
  while IFS= read -r -d '' f; do
    m="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    [ "$m" -gt "$newest" ] && newest="$m"
  done < <(find "$src_dir" -type f -print0 2>/dev/null || true)
  bm=0
  if [ -f "$bundle" ]; then
    bm="$(stat -c %Y "$bundle" 2>/dev/null || echo 0)"
  fi
  [ "$newest" -gt "$bm" ] && return 0
  return 1
}

# vendor_runtime_user_scope_stale_check — AC4 stale detection for the USER-SCOPE install cache
# (~/.local/share/quay-plugin/ or the Claude Code plugin cache). The cache carries the vendored
# dist bundle but NO packages/ source tree, so the AC1 mtime check cannot fire. Its freshness
# criterion is VERSION CONSISTENCY: the version embedded in the built bundle
# (`node dist/quay.js --version`) must match the plugin's vendored package.json version — both are
# written by sync-vendor.sh from the SAME source at build time (plugin/vendor/quay/package.json is
# tracked in git; the dist is the gitignored generated mirror of the same version). A mismatch
# means one is stale relative to the other (a mixed snapshot); the negative control is that BEFORE
# this check the 06:01 stale dist was treated as fresh. Prints a visible STALE warning + the fix;
# NEVER fail-closed (there is no source tree to rebuild from in the cache — the action is a prompt
# to update/reinstall the plugin). Returns 0 when consistent or unverifiable, 1 when a mismatch was
# reported (callers decide whether a warning is fatal).
vendor_runtime_user_scope_stale_check() {
  local dist="$PLUGIN_ROOT/vendor/quay/dist/quay.js"
  local pkg="$PLUGIN_ROOT/vendor/quay/package.json"
  [ -f "$dist" ] && [ -f "$pkg" ] || return 0
  local embedded declared
  embedded="$(node "$dist" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  declared="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' "$pkg" 2>/dev/null || true)"
  [ -n "$embedded" ] && [ -n "$declared" ] || return 0
  if [ "$embedded" != "$declared" ]; then
    echo "  STALE (user-scope vendor runtime): the built bundle embeds version ${embedded} but plugin/vendor/quay/package.json declares ${declared}." >&2
    echo "         The 06:01 stale dist was previously treated as fresh (AC4 negative control). Update/reinstall the plugin so the runtime matches the plugin version." >&2
    return 1
  fi
  return 0
}

# ensure_vendor_runtime — gap-vendor-runtime-not-in-git-clone-broken-mcp-entry (AC1/AC2) +
# gap-upgrade-channel-cant-sync-build-artifacts-dist-stale (AC1/AC4).
# The vendored runtime bundles (plugin/vendor/quay/dist/quay.js + plugin/vendor/quay-native/dist/
# quay-native.js) are GENERATED artifacts — gitignored by the bare `dist/` rule (M172), so a fresh
# plugin clone has NONE of them. Writing a provider config whose mcp_entry references a missing
# runtime is the exact broken-MCP-entry defect: it blocks the whole Provider ABI / MCP (AC12b hard
# blocker #2) and the pre-fix behavior WARNED and reported complete anyway ("判据存在但绕过了真正
# 重要的东西"). Resolution (the manager-verified path 2): if the bundles are missing, AUTO-BUILD them
# via the plugin's own sync-vendor.sh; only when the build cannot produce them, FAIL CLOSED (exit
# non-zero, no `quay-init complete`) naming the missing bundles + the fix.
# Returns 0 only when BOTH bundles are present (present to begin with, or auto-built); exits 2
# otherwise. In --dry-run it prints what would happen and returns 0 so the dry-run listing continues.
ensure_vendor_runtime() {
  local missing=0 stale=0
  [ -f "$PLUGIN_ROOT/vendor/quay/dist/quay.js" ] || missing=1
  [ -f "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" ] || missing=1

  # AC1 (gap-upgrade-channel-cant-sync-build-artifacts-dist-stale): STALE detection — the bundles
  # exist but the SOURCE is newer. The pre-fix code only rebuilt on MISSING; a git pull that synced
  # source without rebuilding the gitignored dist left a STALE bundle that was silently accepted
  # (B machine: dist built 13:34, fix merged 15:10, ENOENT persists — verify checked existence, not
  # freshness). When the source tree is absent (user-scope install cache) the mtime check cannot
  # fire — AC4's version-consistency check below owns that path.
  if [ "$missing" = 0 ]; then
    local core_src="$PLUGIN_ROOT/../packages/quay/src"
    local native_src="$PLUGIN_ROOT/../packages/quay-native/src"
    local rc=0 core_stale=0 native_stale=0 core_nosrc=0 native_nosrc=0
    rc=0; dist_stale "$PLUGIN_ROOT/vendor/quay/dist/quay.js" "$core_src" || rc=$?
    [ "$rc" = 0 ] && core_stale=1
    [ "$rc" = 2 ] && core_nosrc=1
    rc=0; dist_stale "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" "$native_src" || rc=$?
    [ "$rc" = 0 ] && native_stale=1
    [ "$rc" = 2 ] && native_nosrc=1
    [ "$core_stale" = 1 ] && stale=1
    [ "$native_stale" = 1 ] && stale=1
    # AC4 (user-scope): no packages/ source tree → the mtime check cannot fire. The user-scope
    # install cache's freshness criterion is VERSION CONSISTENCY (embedded dist version vs the
    # vendored package.json version). WARN + prompt only — there is no source to rebuild from in
    # the cache, so this never fail-closes (the negative control was NO check at all: the 06:01
    # stale dist was treated as fresh).
    if [ "$core_nosrc" = 1 ] && [ "$native_nosrc" = 1 ] && [ "$DRY_RUN" != true ]; then
      vendor_runtime_user_scope_stale_check || true
    fi
  fi

  [ "$missing" = 0 ] && [ "$stale" = 0 ] && return 0

  if [ "$DRY_RUN" = true ]; then
    if [ "$missing" = 1 ]; then
      echo "  would-ensure-vendor-runtime: plugin source lacks the built vendor runtime (gitignored dist/) — quay-init would auto-build via sync-vendor.sh or fail closed (AC1/AC2)" >&2
    else
      echo "  would-ensure-vendor-runtime: the vendored dist is STALE (source newer than the bundle — a git pull synced source without rebuilding the gitignored dist) — quay-init would auto-rebuild via sync-vendor.sh or fail closed (AC1)" >&2
    fi
    return 0
  fi

  if [ "$missing" = 1 ]; then
    echo "  vendor runtime missing from plugin source (gitignored dist/ — a fresh clone has no built bundles). Attempting auto-build via sync-vendor.sh (AC2, path 2) ..." >&2
  else
    echo "  vendor runtime STALE (source mtime newer than dist mtime — a git pull synced source without rebuilding the gitignored bundle). Attempting auto-rebuild via sync-vendor.sh (AC1) ..." >&2
  fi
  local vlog
  vlog="$(mktemp)"
  if [ -f "$PLUGIN_ROOT/scripts/sync-vendor.sh" ] && bash "$PLUGIN_ROOT/scripts/sync-vendor.sh" >"$vlog" 2>&1; then
    if [ -f "$PLUGIN_ROOT/vendor/quay/dist/quay.js" ] && [ -f "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" ]; then
      rm -f "$vlog"
      if [ "$stale" = 1 ]; then
        echo "  auto-rebuilt STALE vendor runtime via sync-vendor.sh (AC1)" >&2
      else
        echo "  auto-built vendor runtime via sync-vendor.sh (AC2)" >&2
      fi
      return 0
    fi
  fi
  echo "ERROR: plugin source has no built vendor runtime and the auto-build did not produce one (gap-vendor-runtime-not-in-git-clone-broken-mcp-entry AC1)." >&2
  echo "       The provider mcp_entry would reference a nonexistent runtime — the install FAILS CLOSED instead of shipping a broken MCP entry." >&2
  echo "       Missing bundles:" >&2
  echo "         - plugin/vendor/quay/dist/quay.js" >&2
  echo "         - plugin/vendor/quay-native/dist/quay-native.js" >&2
  echo "       Fix one of:" >&2
  echo "         - run 'npm install' at the repo root (the postinstall runs sync-vendor.sh to build them), then re-run quay-init" >&2
  echo "         - run 'bash plugin/scripts/sync-vendor.sh' manually to build + mirror the bundles" >&2
  echo "         - install the plugin from the dist-plugin orphan branch, which TRACKS the built bundles" >&2
  if [ -s "$vlog" ]; then
    echo "       sync-vendor.sh output (last 15 lines):" >&2
    tail -n 15 "$vlog" >&2
  fi
  rm -f "$vlog"
  exit 2
}

# verify_provider_runtime_existence <workspace-root> — gap-vendor-runtime-not-in-git-clone-broken-
# mcp-entry (AC3). verify_referenced_landed above checks the LANDING SET (every skill/tick-doc
# referenced file is laid down), but NOT that the provider config's mcp_entry references a file that
# ACTUALLY EXISTS in the target. This is the referenced-not-landed complement: it reads the generated
# .quay/config.yml provider mcp_entry and asserts the referenced runtime file is present. Defense in
# depth — AC1 (fail-closed) prevents writing a broken config in the first place; this second check
# catches a config that already exists (or a lay-down regression) whose mcp_entry points at a missing
# runtime. FAIL CLOSED (return 1) when the referenced file does not exist.
verify_provider_runtime_existence() {
  local ws="$1" plugin_root="${2:-}"
  local cfg="$ws/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  verify-provider-runtime-existence: (dry-run, skipped)"
    return 0
  fi
  if [ ! -f "$cfg" ]; then
    echo "  verify-provider-runtime-existence: FAIL — no .quay/config.yml to verify" >&2
    return 1
  fi
  local entry_file
  entry_file="$(python3 - "$cfg" <<'PYEOF'
import sys, yaml
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}
    prov = (d.get("providers") or {}).get("native") or {}
    mcp = prov.get("mcp_entry") or []
    if isinstance(mcp, list) and len(mcp) >= 2:
        print(mcp[1])
except Exception:
    pass
PYEOF
)"
  if [ -z "$entry_file" ]; then
    echo "  verify-provider-runtime-existence: OK (no mcp_entry path found in the provider config — nothing to verify)"
    return 0
  fi
  if [ -f "$entry_file" ]; then
    echo "  verify-provider-runtime-existence: OK ($entry_file exists)"
    # AC2 (gap-upgrade-channel-cant-sync-build-artifacts-dist-stale): the verify now checks
    # FRESHNESS, not just existence — the referenced runtime must be byte-identical to the
    # plugin's CURRENT vendored bundle (the source-derived artifact quay-init lays down). A target
    # copy that differs is a stale dist from an older install (git pull synced source; the
    # gitignored target dist did not follow) and FAILS CLOSED. Scoped to KNOWN quay runtime
    # basenames (quay.js / quay-native.js); an arbitrary runtime is existence-checked only (the
    # AC3 negative control's scope guard).
    local base src_bundle
    base="$(basename "$entry_file")"
    src_bundle=""
    case "$base" in
      quay.js) src_bundle="$plugin_root/vendor/quay/dist/quay.js" ;;
      quay-native.js) src_bundle="$plugin_root/vendor/quay-native/dist/quay-native.js" ;;
    esac
    if [ -n "$src_bundle" ] && [ -n "$plugin_root" ] && [ -f "$src_bundle" ]; then
      if cmp -s "$entry_file" "$src_bundle"; then
        echo "  verify-provider-runtime-freshness: OK ($entry_file matches the plugin's current vendored bundle)"
      else
        echo "  FAIL (stale-runtime): $entry_file differs from the plugin's current vendored bundle ($src_bundle) — a stale dist from an older install" >&2
        return 1
      fi
    fi
    return 0
  fi
  echo "  FAIL (referenced-runtime-missing): the provider mcp_entry references $entry_file but it does not exist in the target" >&2
  return 1
}

# ── derived laydown set + drift report (gap-delivery-surface-grows-but-target-freezes-no-upgrade) ────
# The delivery surface grows (new derived scripts ship) while an installed target freezes at install
# time — there was no upgrade/refresh channel and no drift report. These two functions are the
# mechanism: the drift report (漂移/缺失/一致 on the DERIVED-SET axis, not the raw plugin/scripts file
# count — L_D) + the upgrade-path integration in the --loop block. Contract measure/invoke:
#   `bash plugin/scripts/quay-init.sh --check-drift` stdout's 漂移/缺失/一致 number fields.


# compute_drift_report <workspace-root> — the derived-set-axis drift report (AC2). For every script
# in the derived laydown set, classify the target's copy:
#   一致 (consistent) = present + byte-identical to the plugin's current delivery
#   缺失 (missing)    = absent — the target froze at install time and never received this mechanism
#   漂移 (drift)      = present but differs from the current delivery — stale install content OR a
#                       local edit (never silent: the --loop upgrade backs it up + reports, and this
#                       report lists it for confirmation)
# Emits the parseable summary `漂移 N / 缺失 N / 一致 N` plus a per-file listing of drift/missing.
# READ-ONLY: never writes (no state, no backups, no copies). Returns 0 — the report is the
# deliverable, not a pass/fail gate (Contract band: parseable; missing/drift upgradeable to 0 via
# --loop or listed).
compute_drift_report() {
  local ws="$1" drift=0 missing=0 consistent=0 n=0 s tgt rel src i
  local -a drift_list=() missing_list=() drift_src=() drift_tgt=()
  for s in "${LOOP_SCRIPTS[@]}"; do
    # opt-in exec core (gap-ac37-exec-core-ships-with-package): manager-tick-core lands only with
    # --manager; when not requested AND not already present in the target it is not a defect — skip
    # it so the drift denominator is the DEFAULT landing + whatever was opted into (a target that
    # DID opt in earlier still has its manager core drift-checked, because it exists there).
    if [ "$s" = "manager-tick-core.md" ] && [ "$DO_MANAGER" != true ] && [ ! -f "$ws/orchestration/$s" ]; then
      continue
    fi
    if [ -f "$PLUGIN_ROOT/scripts/$s" ]; then
      src="$PLUGIN_ROOT/scripts/$s"; tgt="$ws/plugin/scripts/$s"; rel="plugin/scripts/$s"
    elif [ -f "$PLUGIN_ROOT/loop/$s" ]; then
      # exec-core tick doc (gap-ac37-exec-core-ships-with-package): lands at orchestration/ (the
      # path the shipped tick templates reference), distinct from the scripts landing. The source
      # RESOLVES a pointerized shipped copy to its orchestration/ 正本 (gap-quay-init-real-install-
      # regression-fix ②) so the drift axis compares the REAL core, not the pointer line.
      src="$(resolve_tick_core_src "$s")"; tgt="$ws/orchestration/$s"; rel="orchestration/$s"
    else
      echo "  WARN: loop mechanism file missing from plugin: plugin/scripts/$s (or plugin/loop/$s)" >&2
      continue
    fi
    n=$((n + 1))
    if [ ! -f "$tgt" ]; then
      missing=$((missing + 1)); missing_list+=("$rel")
    elif _is_identical "$src" "$tgt"; then
      consistent=$((consistent + 1))
    else
      drift=$((drift + 1)); drift_list+=("$rel"); drift_src+=("$src"); drift_tgt+=("$tgt")
    fi
  done
  echo "drift-report: 漂移 ${drift} / 缺失 ${missing} / 一致 ${consistent} (derived-set ${n})"
  # AC2 (gap-tick-core-drift-check-not-in-suite): a drift entry prints BOTH sides' line counts + a
  # diff summary (not a "drift/consistent" boolean) so a reader sees the magnitude/character of the
  # drift. The `drift:` line itself is unchanged (tests parse it); the 行数/diff lines are additive.
  for i in "${!drift_list[@]}"; do
    rel="${drift_list[$i]}"; src="${drift_src[$i]}"; tgt="${drift_tgt[$i]}"
    echo "  drift: $rel — target differs from the plugin's current delivery (stale install or local edit); --loop upgrade backs it up + reports, never silent"
    echo "    行数: $(wc -l < "$src") (plugin: ${src#"$PLUGIN_ROOT/"}) vs $(wc -l < "$tgt") (target: ${tgt#"$ws/"})"
    local _dstat
    _dstat="$(diff -U0 "$src" "$tgt" 2>/dev/null | grep -c '^[+-][^+-]' || true)"
    echo "    diff: ${_dstat} changed lines (unified diff, 0-context)"
  done
  for rel in "${missing_list[@]}"; do
    echo "  missing: $rel — not installed (target froze at install time); --loop upgrade auto-adds it"
  done
  return 0
}

# ── --check-drift mode (Contract invoke) ──────────────────────────────────────────────────────────────
# READ-ONLY drift report over the derived laydown set for the target workspace (--root, default cwd).
# No category dispatch, no --loop params (test-command/tmux-session are NOT needed to report drift).
# Exits 0 — the report is the deliverable.
if [ "$DO_CHECK_DRIFT" = true ]; then
  echo "quay-init drift report (plugin v${PLUGIN_VERSION})"
  echo "  derived-set axis: the delivery surface's DERIVED scripts (L_D — the functional surface is the"
  echo "  derived laydown set, NOT the raw plugin/scripts file count)."
  LOOP_SCRIPTS=()
  while IFS= read -r s; do LOOP_SCRIPTS+=("$s"); done < <(derive_loop_scripts)
  compute_drift_report "$WORKSPACE_ROOT"
  exit 0
fi

# compute_dependency_closure_gaps — the gap-laydown-derivation-is-sensitive-to-reference-spelling-
# dependency-closure Contract measure: how many LAID-DOWN scripts reference a same-dir sibling that
# is NOT in the FINAL (post-closure) laydown set — "已铺但依赖未铺的脚本数". derive_loop_scripts
# runs the closure to a fixpoint, so on the fixed repo every sibling that EXISTS in plugin/scripts/
# is already in the set ⇒ gaps = 0 (the band; 铺了消费者必然铺依赖). A gap survives the closure
# only when the referenced sibling DOES NOT EXIST in plugin/scripts/ (the dependency cannot ship —
# fail loud, the AC4 spirit) or when the closure pass itself is broken (a regression guard: if the
# closure silently stopped, send-keys-reliable.sh's sibling would re-appear as a gap here). The
# validator is SCRIPT CONTENT (${SCRIPT_DIR}/<sibling>), never doc wording (invariant
# closure_not_documentation = 1). Exits 0 on 0 gaps, 1 when gaps > 0.
compute_dependency_closure_gaps() {
  local gaps=0 s name v
  for s in "${LOOP_SCRIPTS[@]}"; do
    [ -f "$PLUGIN_ROOT/scripts/$s" ] || continue
    local vars
    vars="$(script_dir_vars "$PLUGIN_ROOT/scripts/$s")"
    [ -n "$vars" ] || continue
    # distinct same-dir sibling references, UNFILTERED by existence — a reference to a sibling that
    # does not exist in plugin/scripts/ is exactly the "已铺但依赖未铺" gap this check must surface.
    local refs
    refs="$(closure_ref_names "$PLUGIN_ROOT/scripts/$s" $vars | sort -u)"
    [ -n "$refs" ] || continue
    for name in $refs; do
      [ -n "$name" ] || continue
      local in_set=0 tt
      for tt in "${LOOP_SCRIPTS[@]}"; do
        [ "$tt" = "$name" ] && { in_set=1; break; }
      done
      if [ "$in_set" = 0 ]; then
        echo "  gap: plugin/scripts/$s references same-dir sibling plugin/scripts/$name which is NOT in the laydown set — the dependency cannot ship (missing from plugin, or the closure pass is broken)" >&2
        gaps=$((gaps + 1))
      fi
    done
  done
  echo "dependency_closure_gaps: $gaps"
  [ "$gaps" -eq 0 ]
}

# ── --check-dependency-closure mode (Contract measure/invoke) ────────────────────────────────────────
# READ-ONLY dependency-closure report over the derived laydown set. No category dispatch, no --loop
# params. Emits the parseable `dependency_closure_gaps: N` field (Contract band N = 0). Exits 0 when
# the set is closure-complete, 1 when gaps exist (a regression that would ship a consumer without its
# dependency). Contract invoke: `grep -n 'transcript-delivery-check' plugin/scripts/send-keys-reliable.sh
# plugin/scripts/quay-init.sh` must show the consumer → checker reference on both sides.
if [ "$DO_CHECK_DEPENDENCY_CLOSURE" = true ]; then
  echo "quay-init dependency-closure report (plugin v${PLUGIN_VERSION})"
  derive_loop_scripts
  compute_dependency_closure_gaps
  exit $?
fi

# ── library mode (gap-quay-init-reduce-real-install-count) ────────────────────────────────────────────
# When SOURCED (not executed as $0), stop here — the caller wants to invoke a derivation/stability
# function directly (derive_loop_scripts / _read_declarations / _read_references /
# verify_referenced_landed) without running a full install. Every function + its deps
# (mechanism_corpus / bare_resolved_scripts / consolidated_member_files) and the PLUGIN_ROOT /
# NEVER_LAYDOWN environment are defined ABOVE this guard; the install flow below must not run.
# The torn-read family (quay-init.test.mjs + quay-init-loop-consumer-doc-refs.test.mjs) sources this
# script and calls the function it exercises, so a stability-check test no longer pays a ~33s install.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  return 0
fi

# report_closed_set_state — the AC3 failure-path report: mechanically list each of the seven closed-set
# items in ONE of four states, by comparing the current fingerprint against the pre-write snapshot:
#   written:      this run created it, or changed its content
#   pre-existing: it was already there before this run and this run left it byte-unchanged
#   unwritten:    it is not there now
#   unreadable:   it is there but its content could not be read (never folded into `unwritten:` —
#                 hard rule 3b: "could not look" must not be reported with the shape of a verdict)
# Wired as an EXIT trap below so a non-zero exit — a pre-write fail-closed check (test command / plugin
# root / worktree root), a mid-write abort, or a post-write auto-commit failure — always reports WHAT
# THIS RUN ACTUALLY DID. The retired existence test (`[ -e ]`) could not tell "written now" from
# "already there", so on a non-empty (upgrade) target it credited a no-op failure with rewriting config
# (gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade). This keeps "initialized
# half-way" distinguishable from "not initialized" (hard rule 3b write-side mirror) AND from "already
# initialized before this run" — the third distinction the upgrade path needs and existence cannot make.
report_closed_set_state() {
  local p now before
  for p in $CLOSED_SET_ITEMS; do
    now="$(_closed_set_fingerprint "$WORKSPACE_ROOT/$p")"
    before="${PRE_WRITE_FINGERPRINTS[$p]:-ABSENT}"
    if [ "$now" = UNREADABLE ]; then
      echo "  unreadable:   $p" >&2
    elif [ "$now" = ABSENT ]; then
      echo "  unwritten:    $p" >&2
    elif [ "$before" = "$now" ]; then
      echo "  pre-existing: $p" >&2
    else
      echo "  written:      $p" >&2
    fi
  done
  return 0
}

# _on_exit — EXIT trap: report the closed-set state on a non-zero exit only (a success run is already
# fully reported by the install flow's own output).
_on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "quay-init FAILED (exit $rc) — closed-set write state:" >&2
    report_closed_set_state
  fi
}
trap _on_exit EXIT

# ── closed-set write (SPEC §6 / gap-quay-init-closure-shrink-body AC168) ────────────────────────────
echo "quay-init (plugin v${PLUGIN_VERSION})"
echo "  closed set: .quay/config.yml, .quay/profiles.yml, tasks/, goals/, .gitignore, .claude/launch.settings.json, .claude/settings.json"

# write_config — generate .quay/config.yml (provider map → the plugin's vendored native runtime; loop section).
write_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  # EXISTENCE FIRST, then --dry-run (gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated):
  # the pre-fix order returned on --dry-run BEFORE the existing-config branch, so on an existing
  # project `--dry-run` printed "would-write: .quay/config.yml" (a fresh-install report) while the
  # real run would NOT write the provider block at all — it would MIGRATE. A dry run whose report
  # describes a different code path than the real run is worse than no dry run (硬规则 3b: the
  # output must distinguish "nothing to migrate" from "would migrate"). Both callees handle
  # DRY_RUN internally, so the upgrade path is now REPORTED in dry-run, not skipped.
  if [ -f "$cfg" ]; then
    echo "  note: .quay/config.yml already exists — upgrade path: the provider binding is migrated to the plugin's delivered native runtime (absolute), and the retired project-local .quay/runtime/ is cleared if unreferenced + stale (AC1/AC2)"
    migrate_stale_mcp_entry
    # Carrier-dir pins: independent of the runtime migration above. A project installed before the
    # carrier pins existed carries QUAY_NATIVE_TASKS_DIR alone, and its adr/goal/meta stores then
    # resolved through the provider package's own location (AC4 of
    # gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak). Backfilled here, idempotently.
    ensure_provider_carrier_env
    ensure_loop_config
  elif [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml (provider map → plugin vendored native runtime; loop: repo_root/test_command/tmux_session/worktree_root/fork_baseline)"
  else
    mkdir -p "$WORKSPACE_ROOT/.quay" "$WORKSPACE_ROOT/tasks"
    cat > "$cfg" <<EOF
# .quay/config.yml — generated by quay-init (SPEC §6 closed set).
# The provider mcp_entry points at the quay PLUGIN's vendored native runtime (delivered by the plugin,
# not laid down into this project). The loop section carries the target-project values the driver reads.
providers:
  native:
    enabled: true
    path: "${PLUGIN_ROOT}/vendor/quay-native"
    tasks_dir: "${WORKSPACE_ROOT}/tasks"
    mcp_entry: ["node", "${PLUGIN_ROOT}/vendor/quay-native/dist/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "${WORKSPACE_ROOT}/tasks"
      QUAY_NATIVE_GOAL_DIR: "${WORKSPACE_ROOT}/goals"
      QUAY_NATIVE_ADR_DIR: "${WORKSPACE_ROOT}/adr"
      QUAY_NATIVE_META_DIR: "${WORKSPACE_ROOT}/meta"
loop:
  repo_root: ${REPO_ROOT}
  # quay's mechanical fan-in runs this project's test entrypoint with its own value-taking flags
  # (--buckets / --root / --state-dir / --runner / --log-file / --run-id, plus --test-concurrency=N).
  # If you ship scripts/test.sh, it MUST consume such a flag together with its VALUE (shift 2) and
  # MUST NOT read a flag's value as a positional test-file argument — otherwise every fan-in round
  # reds with "Could not find '<value>'" and burns a whole worker session.
  # Full contract + a drop-in case block: plugin/skills/init/SKILL.md, section "loop.test_command
  # contract".
  test_command: ${TEST_COMMAND}
  tmux_session: ${TMUX_SESSION:-null}
  worktree_root: ${WORKTREE_ROOT}
  # ⚠️ 本 heredoc 是【新装】写者，而版本级默认值的正本是 packages/quay/src/init.ts 的
  # LOOP_VERSION_DEFAULTS（CLI `quay init --reconcile` 用它做 diff）。shell 无法 import TS，
  # 所以这一行是【镜像】：新增版本级默认值时要同时改两处，或把这里改成从 schema 派生。
  # ⛔ 不要在这里补那个已被删除的零消费者分支键：plugin/test/quay-init.test.mjs 以可执行的判据
  # 钉住"它不被写出"（gap-config-key-consumer-check-mechanical-enumeration）；理由见 init.ts。
  fork_baseline: develop
EOF
    echo "  wrote: .quay/config.yml (provider map → plugin vendored native runtime; loop: repo_root/test_command/tmux_session/worktree_root/fork_baseline)"
  fi
}

# write_template <src> <dst> [label] — verbatim copy of ONE closed-set template (no managed/conflict/stale
# judgment; a same-name target is left untouched unless --force — config is the consumer's to edit).
write_template() {
  local src="$1" dst="$2" label="${3:-$dst}"
  if [ ! -f "$src" ]; then
    echo "  WARN: template missing from plugin: $src" >&2
    return
  fi
  if [ -f "$dst" ]; then
    if [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  would-overwrite: $dst (--force)"
      else
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$src" "$dst"
        echo "  overwritten (backed up): $dst"
      fi
    elif [ "$DRY_RUN" = true ]; then
      echo "  would-skip (exists): $dst"
    else
      echo "  skipped (exists): $dst"
    fi
  else
    if [ "$DRY_RUN" = true ]; then
      echo "  would-copy: $dst"
    else
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      echo "  wrote: $dst ($label)"
    fi
  fi
}

# profiles_name_prefix — the `<project>-<role>` session-name prefix, derived from the workspace
# directory name. MIRRORED by profilesNamePrefix() in packages/quay/src/init.ts (same rule, same
# output); a divergence is caught by the byte-equality test in
# plugin/test/profiles-role-coverage-check.test.mjs. A hardcoded `quay-` prefix made every
# third-party project copy quay's OWN session names, and cross-session delivery addresses peers BY
# NAME ⇒ misrouting (sendmessage-shared-worker-name-misroutes).
profiles_name_prefix() {
  local base="${WORKSPACE_ROOT%/}"
  base="${base##*/}"
  base="$(printf '%s' "$base" | tr -c 'A-Za-z0-9._-' '-')"
  [ -n "$base" ] || base="quay"
  printf '%s' "$base"
}

# write_profiles_template — lay down the shipped profile carrier, then derive the role session names
# from THIS project.
#
# ⛔ Deliberately NOT routed through write_template(). write_template has ONE value — `skipped
# (exists)` — for two different states: "the user already had this file, leave it alone" and "THIS
# RUN created it one step ago as its own intermediate product". A single value covering both is how
# this defect stayed silent (hard rule 3b). `ensure_target_branch_model` above invokes `quay init
# --branch-model-only` through the plugin's vendored bundle; when that bundle predates the flag the
# CLI runs the FULL init and lays down its own .quay/profiles.yml from the inline TS template —
# after which a plain write_template skipped the shipped one, forever. With a fresh bundle the CLI
# returns early and none of this fires, so the ordering is invisible exactly when it is harmless and
# load-bearing exactly when it is not. PROFILES_PRE_EXISTED is captured BEFORE this run writes
# anything, which is what makes "user's file" distinguishable from "our own intermediate".
write_profiles_template() {
  local src="$PLUGIN_ROOT/.quay/profiles.yml" dst="$WORKSPACE_ROOT/.quay/profiles.yml"
  if [ ! -f "$src" ]; then
    echo "  WARN: template missing from plugin: $src" >&2
    return
  fi
  # User-owned: the file was here BEFORE this run and --force was not given ⇒ never touch it.
  if [ "$PROFILES_PRE_EXISTED" = true ] && [ -f "$dst" ] && [ "$FORCE" != true ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  would-skip (exists): $dst"
    else
      echo "  skipped (exists): $dst"
    fi
    return
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: $dst (profile carrier (template), role names prefixed '$(profiles_name_prefix)')"
    return
  fi
  local replaced_own=false
  if [ -f "$dst" ]; then
    if [ "$FORCE" = true ]; then
      cp "$dst" "$dst.bak.$(date +%s)"
      echo "  overwritten (backed up): $dst"
    else
      replaced_own=true
    fi
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  # Derive the role session names (`name: quay-<role>` → `name: <project>-<role>`) — the SAME rule
  # packages/quay/src/init.ts applies. Anchored on `name:` lines only, so the `quay-launch.sh`
  # reference in the header comment is left alone.
  local prefix
  prefix="$(profiles_name_prefix)"
  if [ "$prefix" != "quay" ]; then
    sed -i -E "s/^([[:space:]]*name:[[:space:]]*)quay-/\1${prefix}-/" "$dst"
  fi
  if [ "$replaced_own" = true ]; then
    echo "  wrote: $dst (profile carrier (template); replaced this run's own intermediate write)"
  else
    echo "  wrote: $dst (profile carrier (template))"
  fi
}

# ensure_gitignore — append the quay runtime-state ignore (idempotent, non-destructive; .quay/config.yml
# + .quay/profiles.yml stay tracked).
ensure_gitignore() {
  local gi="$WORKSPACE_ROOT/.gitignore" entry=".quay/*"
  if [ -f "$gi" ] && grep -qxF "$entry" "$gi"; then
    [ "$DRY_RUN" = true ] || echo "  skipped: .gitignore already carries $entry"
    return
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  would-append: $entry (+ negation for config.yml/profiles.yml) to .gitignore"
    return
  fi
  {
    printf '# quay runtime state (generated by the loop — .quay/config.yml + .quay/profiles.yml stay tracked)\n'
    printf '%s\n' "$entry"
    printf '!.quay/config.yml\n'
    printf '!.quay/profiles.yml\n'
  } >> "$gi"
  echo "  appended: $entry (+ negation for config.yml/profiles.yml) to .gitignore"
}

# ensure_runtime_artifacts_gitignore — tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-
# outside-dot-quay. quay writes runtime state OUTSIDE `.quay/`: the native store's parse cache lands
# at `<tasksDir>/.quay-parse-cache.json`, fast-mode telemetry under `milestones/`, the tick ledgers
# under `orchestration/`, per-run event logs under `.workflow-events/`. `.quay/*` above cannot reach
# ANY of those, and the writers run on the READ path (`task_list` / `task_get`, plus the fan-in's own
# `ac-precheck` / `anti-drift` steps) ⇒ merely listing tasks leaves the project dirty, and the
# mechanical fan-in's `ff` then refuses with "working tree not clean" for EVERY task, forever.
# Measured on a real third-party project (quay-fleet, 2026-09-13): a task with a 55/55-green suite
# could not land; the repair at the time was two hand-added lines in THAT project — which leaves the
# generator (this template) drifting for the next consumer.
#
# ⛔ The pattern list is NOT written here. It is READ from the single-source manifest
# `${SCRIPT_DIR}/quay-runtime-artifacts.txt` — the same file the fan-in's clean-tree judgment reads
# and the same set `gitignore-runtime-coverage-check.ts` binds to quay's own `.gitignore`. Re-listing
# the patterns here would re-create exactly the copy-that-drifted defect (硬规则 5b).
# Idempotent (the block header is the marker) + append-only (never rewrites, reorders or clobbers
# the consumer's other gitignore content); a pattern already present verbatim is not duplicated.
# A missing manifest is REPORTED (never silent) and degrades to "no runtime ignore rules written".
RUNTIME_ARTIFACTS_BLOCK_HEADER='# quay runtime artifacts outside .quay/ (written by quay itself; list = plugin/scripts/quay-runtime-artifacts.txt — do NOT hand-edit, add to that manifest)'
ensure_runtime_artifacts_gitignore() {
  local gi="$WORKSPACE_ROOT/.gitignore"
  local manifest="${PLUGIN_ROOT}/scripts/quay-runtime-artifacts.txt"
  if [ ! -f "$manifest" ]; then
    echo "  WARNING: runtime-artifact manifest not found at $manifest — no quay runtime ignore rules written (a consumer project will go dirty on any task-store read)" >&2
    return
  fi
  if [ -f "$gi" ] && grep -qxF "$RUNTIME_ARTIFACTS_BLOCK_HEADER" "$gi"; then
    [ "$DRY_RUN" = true ] || echo "  skipped: .gitignore already carries the quay runtime-artifact block"
    return
  fi
  local patterns=()
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    patterns+=("$line")
  done < "$manifest"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-append: quay runtime-artifact block (${#patterns[@]} pattern(s) from $manifest)"
    return
  fi
  {
    printf '%s\n' "$RUNTIME_ARTIFACTS_BLOCK_HEADER"
    for p in "${patterns[@]}"; do
      if [ -f "$gi" ] && grep -qxF "$p" "$gi"; then continue; fi
      printf '%s\n' "$p"
    done
  } >> "$gi"
  echo "  appended: quay runtime-artifact block (${#patterns[@]} pattern(s) from $manifest)"
}

# write_claude_settings — generate .claude/settings.json (project-level enable + MCP pre-approval).
write_claude_settings() {
  local dst="$WORKSPACE_ROOT/.claude/settings.json"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .claude/settings.json (enabledPlugins: {\"${PLUGIN_NAME}@${PLUGIN_NAME}\": true} + permissions.allow: [\"mcp__plugin_${PLUGIN_NAME}_${PLUGIN_NAME}__*\"])"
    return
  fi
  if [ -f "$dst" ] && [ "$FORCE" != true ]; then
    echo "  note: .claude/settings.json already exists — leave it untouched (re-run with --force to add the quay enabledPlugins block)"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  python3 - "$dst" "$PLUGIN_NAME" <<'PYEOF'
import json, sys, os
dst, name = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(dst):
    try:
        with open(dst, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
ep = data.setdefault("enabledPlugins", {})
ep[f"{name}@{name}"] = True
perm = data.setdefault("permissions", {})
allow = perm.setdefault("allow", [])
entry = f"mcp__plugin_{name}_{name}__*"
if entry not in allow:
    allow.append(entry)
with open(dst, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PYEOF
  echo "  wrote: .claude/settings.json (enabledPlugins: {\"${PLUGIN_NAME}@${PLUGIN_NAME}\": true} + permissions.allow: [\"mcp__plugin_${PLUGIN_NAME}_${PLUGIN_NAME}__*\"])"
}

# print_install_steps — explicit install steps (AC4 / SPEC §6 T3): never imply "config-just-works".
print_install_steps() {
  echo
  echo "━━━ quay plugin install steps (explicit — config does NOT auto-install) ━━━"
  cat <<'EOF'
The files just written ENABLE the quay plugin for this project, but they DO NOT install it.
`enabledPlugins` only toggles an ALREADY-INSTALLED plugin, and an untrusted directory's project
settings are not read at all — so "config committed => auto-installed" is FALSE. Install it first:

  # 1. register the marketplace source (User Scope, machine-specific path — not committed):
EOF
  printf '  claude plugin marketplace add quay "%s"\n\n' "$PLUGIN_ROOT"
  cat <<'EOF'
  # 2. install the plugin for THIS project (⛔ always pass --scope: `claude plugin install` defaults
  #    to `user`, which writes a user-level enabledPlugins key and reddens the STANDING goal AC-161):
  claude plugin install quay@quay --scope project

  # (or the npm-global path: `npm install -g quay` — its register-plugin.mjs postinstall registers the
  #  marketplace source only; the enable is deliberately NOT user-scope by default)
  #
  # ⚠️ To merely RE-FILL a shared plugin-cache entry (~/.claude/plugins/cache/<mkt>/<plugin>/<ver> is
  #    keyed by marketplace+plugin+version and SHARED ACROSS SCOPES), do NOT reach for --scope user.
  #    `plugin update` and a re-`install` both short-circuit on an unchanged version (measured
  #    2026-09-15 / Claude Code 2.1.271: file count 0→0). The refresh is scope-COMPLETE — and the
  #    resolve step is NOT optional, because `uninstall --scope project` FAILS outright when the
  #    record is held at USER scope ("... is installed in user scope, not project. Use --scope user
  #    to uninstall.") — i.e. the CLI's own error hands you the one command to avoid:
  #      claude plugin list --json | jq -r '.[] | select(.id=="quay@quay") | .scope' | sort -u
  #      claude plugin uninstall quay@quay --scope <the scope just printed>
  #      claude plugin install   quay@quay --scope project -y
  #    (a USER-scope uninstall is AC-161-safe: it DELETES the user-level key, it never adds one, and
  #     it does not remove the shared cache payload. Measured 2026-09-15: 0→1, no user key, exit 0.)

  # 3. accept the trust dialog the FIRST time you enter this directory, then restart the session.
After that, the enabledPlugins block below takes effect (a restart is required to apply).
EOF
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# auto_commit_laid_down — stage ONLY the closed-set paths and commit (so the enable propagates on clone).
auto_commit_laid_down() {
  if ! git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "  auto-commit: SKIP (not a git repository — the laid-down files are not committed; init a repo or commit manually)"
    return 0
  fi
  local changes
  changes="$(git -C "$WORKSPACE_ROOT" status --porcelain 2>/dev/null || true)"
  if [ -z "$changes" ]; then
    echo "  auto-commit: nothing to commit (working tree clean)"
    return 0
  fi
  local do_commit=1
  if [ "$AUTO_COMMIT_CONFIRM" = "no" ]; then
    do_commit=0
  elif [ "$AUTO_COMMIT_CONFIRM" != "yes" ]; then
    if [ -t 0 ]; then
      local resp=""
      read -r -p "  Proceed with auto-commit? (only quay-init's laid-down files are staged) [y/N] " resp
      case "$resp" in [yY]|[yY][eE][sS]) do_commit=1 ;; *) do_commit=0 ;; esac
    else
      echo "  auto-commit: DECLINED (non-interactive — pass --auto-commit-confirm to commit, or --auto-commit-skip to skip)" >&2
      do_commit=0
    fi
  fi
  if [ "$do_commit" = 0 ]; then
    echo "  auto-commit: skipped as chosen — the laid-down files remain uncommitted"
    return 0
  fi
  for p in .quay/config.yml .quay/profiles.yml tasks .gitignore .claude/launch.settings.json .claude/settings.json; do
    if [ -e "$WORKSPACE_ROOT/$p" ]; then
      ( cd "$WORKSPACE_ROOT" && git add -- "$p" ) 2>/dev/null || true
    fi
  done
  if [ -z "$(git -C "$WORKSPACE_ROOT" diff --cached --name-only 2>/dev/null || true)" ]; then
    echo "  auto-commit: nothing staged (all laid-down files are gitignored or already committed)"
    return 0
  fi
  local n
  n="$(git -C "$WORKSPACE_ROOT" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
  if ( cd "$WORKSPACE_ROOT" && git commit -q -m "chore(quay-init): initialize quay project files (plugin v${PLUGIN_VERSION})" ); then
    echo "  auto-commit: committed ${n} file(s) as chore(quay-init) (plugin v${PLUGIN_VERSION})"
  else
    echo "ERROR: auto-commit failed (git commit returned non-zero). Configure git identity, then re-run quay-init (idempotent) to commit." >&2
    exit 2
  fi
}

# ── loop params (config.yml loop: section — resolved for EVERY mode; the driver reads them) ───────────
if [ -z "$TEST_COMMAND" ]; then
  TEST_COMMAND="$(read_existing_loop_value test_command)"
  [ -n "$TEST_COMMAND" ] && echo "  using existing config loop.test_command: $TEST_COMMAND (config-preserving upgrade — explicit --test-command overrides)"
else
  echo "  using explicit --test-command: $TEST_COMMAND"
fi
if [ -z "$TEST_COMMAND" ]; then
  if DETECTED="$(detect_test_command "$WORKSPACE_ROOT")"; then
    TEST_COMMAND="$DETECTED"
    echo "  detected test command: $TEST_COMMAND (from the target project — confirm this is correct)"
  else
    echo "ERROR: quay-init needs the target project's test command but none could be detected in $WORKSPACE_ROOT." >&2
    echo "       Searched: scripts/test.sh → package.json scripts.test → go.mod → Cargo.toml." >&2
    echo "       Pass --test-command <cmd> explicitly." >&2
    exit 2
  fi
fi

if [ -z "$TMUX_SESSION" ]; then
  TMUX_SESSION="$(read_existing_loop_value tmux_session)"
  [ -n "$TMUX_SESSION" ] && echo "  using existing config loop.tmux_session: $TMUX_SESSION (config-preserving upgrade — explicit --tmux-session overrides)"
else
  echo "  using explicit --tmux-session: $TMUX_SESSION"
fi
if [ -z "$TMUX_SESSION" ]; then
  # tmux session is OPTIONAL since the outer/inner dual-tmux model retired (SPEC-tmux-retirement-
  # 2026-09-03): quay-init's seven-item closed-set write never uses tmux, so a missing/ambiguous
  # session must NOT fail the init (gap-quay-init-hard-requires-tmux-session-and-leaves-partial-
  # write). Detection is best-effort — exactly one match wins; zero or multiple matches leave
  # loop.tmux_session null (never a guess, never a hard failure). Only a downstream action that
  # actually uses tmux fails closed at runtime.
  DETECT_RC=0
  DETECT_OUT="$(detect_tmux_session "$PROJECT_NAME")" || DETECT_RC=$?
  if [ "$DETECT_RC" = 0 ]; then
    TMUX_SESSION="$DETECT_OUT"
    echo "  detected tmux session: $TMUX_SESSION (matching project '$PROJECT_NAME' — confirm this is correct)"
  elif [ "$DETECT_RC" = 2 ]; then
    echo "  note: multiple tmux sessions match project '$PROJECT_NAME' — loop.tmux_session left null (tmux is optional; pass --tmux-session to pin one)"
  else
    echo "  note: no tmux session detected for project '$PROJECT_NAME' — loop.tmux_session left null (tmux is optional; SPEC-tmux-retirement-2026-09-03)"
  fi
fi

if [ -z "$WORKTREE_ROOT" ] && [ -f "$WORKSPACE_ROOT/.quay/config.yml" ]; then
  WORKTREE_ROOT="$(python3 - "$WORKSPACE_ROOT/.quay/config.yml" <<'PYEOF' 2>/dev/null || true
import sys, yaml
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}
    print((d.get("loop") or {}).get("worktree_root") or "")
except Exception:
    pass
PYEOF
)"
fi
if [ -z "$WORKTREE_ROOT" ]; then
  WORKTREE_ROOT="${REPO_ROOT}/../$(basename "$REPO_ROOT")-worktrees"
fi
validate_worktree_root "$WORKTREE_ROOT" || exit 2

# ── branch model (gap-upgrade-entry-never-establishes-branch-model) ────────────────────────────────────
# THE DEFECT THIS CLOSES. quay's fan-in / anti-drift path judges a task's work by
# `git diff --name-only develop...HEAD` (worker-driver.ts `opts.mergeTarget ?? "develop"`, anti-drift
# `--merge-target ?? "develop"`). That judgment is only meaningful when the target project's `develop`
# IS the mainline's continuation — the line the task branch forks from and fast-forwards onto. This
# script used to write `fork_baseline: develop` into the config (`:995`/`:2217`) while never checking
# that such a ref exists, let alone that it connects to the mainline.
#
# Measured (2026-09-11, real machine, three independent upgrade copies of an aged third-party project):
# every copy's `develop` was an ancient foreign fork (`d95dac8`, 2025-10-14) whose merge-base with the
# real mainline `main` was 553-589 commits back and whose tree held ZERO `tasks/*.md`. A worker that
# implemented its fix CORRECTLY and committed it died at `ANTI-DRIFT HARD FAIL: <N> violation(s)`,
# where N (1566) was the entire divergent history — a number no `## Touches` list can cover. The task
# was structurally un-landable, and the failure text blamed the task rather than the baseline.
#
# ⛔ THE JUDGMENT IS NOT RE-IMPLEMENTED HERE. `classifyBranch` / `ensureBranchModel`
# (packages/quay/src/branch-model.ts) is the single implementation (ADR-004), reached through the
# delivery's own `quay init --branch-model-only` — the config-FREE entry, because the shipped upgrade
# runs on projects that ALREADY have a `.quay/config.yml` and a full `quay init` would rewrite
# (destroy) their `gates:` / `loop:` / `routines:`. ⇒ Do NOT add a `git merge-base --is-ancestor`
# (or any other compatibility predicate) to this file: that would be a second implementation of the
# same rule, drifting from the first.
#
# PLACEMENT IS PART OF THE CONTRACT. This runs BEFORE `write_config` and every other write below, so a
# refusal leaves `.quay/config.yml` byte-for-byte unchanged (AC2) and never half-upgrades a project.
ensure_target_branch_model() {
  local qrl="$PLUGIN_ROOT/vendor/quay/dist/quay.js"
  if [ ! -f "$qrl" ]; then
    # Reuse the existing fail-closed runtime provisioning mechanism rather than hand-rolling a
    # second remedy: a fresh plugin clone has NO built bundles (the vendored dist is a gitignored
    # generated artifact), and `ensure_vendor_runtime` auto-builds them via sync-vendor.sh or exits 2
    # naming the fix.
    ensure_vendor_runtime
  fi
  if [ ! -f "$qrl" ]; then
    # CANNOT-EVALUATE, kept DISTINCT from both "divergent" and "compatible" (hard rule 3b: a judge
    # that cannot read its input must not return the value a judge that read it would return). The
    # upgrade refuses — silently proceeding would report success for a project whose landing baseline
    # was never judged, which is precisely the defect this step exists to end.
    echo "ERROR: cannot judge this project's branch model — the delivered CLI is absent: $qrl" >&2
    echo "       Refusing to continue: an unjudged landing baseline is not a passing one." >&2
    return 3
  fi

  # Argument order matters: the CLI's flag parser only treats `--dry-run` as boolean (BOOLEAN_FLAGS),
  # so a bare boolean flag is followed by the NEXT `--flag`. Every optional flag is therefore emitted
  # before the value-bearing `--root` tail — do not reorder `--root` into the middle.
  # `--doc-branch-name` (gap-quay-init-no-doc-branch-bootstrap-…) rides the SAME config-free entry:
  # after the landing baseline is judged, the CLI establishes the doc-only work branch. The NAME is
  # resolved HERE (this script is the CLI-parameter/config-default layer — see the defaults block
  # above); `branch-model.ts` never names a branch. Value-bearing, so it must stay before `--root`.
  local -a bm_args
  bm_args=(init --branch-model-only)
  if [ "$ADOPT_BRANCH_MODEL" = true ]; then bm_args+=(--adopt-branch-model); fi
  if [ "$DRY_RUN" = true ]; then bm_args+=(--dry-run); fi
  bm_args+=(--doc-branch-name "$DOC_BRANCH_NAME")
  bm_args+=(--root "$WORKSPACE_ROOT")

  # The report is captured (not just streamed) so the three outcomes stay DISTINGUISHABLE below. It
  # is echoed verbatim either way — the operator sees the same lines they would have.
  local bm_rc=0 bm_out=""
  set +e
  bm_out="$(node "$qrl" "${bm_args[@]}")"
  bm_rc=$?
  set -e
  printf '%s\n' "$bm_out"
  if [ "$bm_rc" -eq 0 ]; then return 0; fi

  # ⛔ A non-zero exit is NOT by itself the "divergent" verdict. A crash, an unknown flag, a CLI that
  # could not read the project — none of those is "the landing baseline is a foreign fork", and
  # printing the divergence text for them would be exactly the failure hard rule 3b names: a judge
  # that could not read its input returning the value it returns on a verdict. So the refusal path is
  # entered only when the delivered report LITERALLY carries the `[BLOCKED] landing-baseline` line.
  # This COMPARES a token the report prints; it does not compute the verdict (branch-model.ts owns
  # that). `case` (not `printf | grep -q`) on purpose: under `set -o pipefail` a `-q` grep can
  # SIGPIPE its producer, making the predicate read FALSE when it is TRUE.
  case "$bm_out" in
    *"[BLOCKED] doc-branch"*)
      # The doc-BRANCH step's refusal, not the baseline's: the requested doc-branch name is already
      # taken by a branch with no ancestry relation to `develop`. The CLI has already printed the
      # detail; ⛔ nothing was moved (no branch created, HEAD not switched) — that is what the
      # judgment guarantees and what this branch must not paper over.
      echo "" >&2
      echo "ERROR: quay-init REFUSES to establish the doc-only work branch — the name '${DOC_BRANCH_NAME}'" >&2
      echo "       is already taken by a branch unrelated to the landing baseline 'develop'." >&2
      echo "       NOTHING WAS MOVED (no branch created, HEAD not switched, config untouched)." >&2
      echo "       Resolve that branch by hand, or re-run with a different name:" >&2
      echo "           bash $0 --root $WORKSPACE_ROOT --doc-branch-name <other-name> <same flags as before>" >&2
      return 1
      ;;
    *"[BLOCKED] landing-baseline"*) ;;
    *"[FAILED] baseline-checkout"*)
      # The baseline→checkout handoff failed (gap-quay-init-doc-branch-noop-when-fresh-develop-…):
      # `develop` was created/re-pointed at the checked-out commit, but the main checkout could not be
      # moved onto it. Continuing is NOT safe: the doc-branch judgment reads the UNMOVED checkout, so
      # it would report "the invariant already holds" and the doc-only work branch would be skipped
      # silently — exactly the defect that handoff exists to end. Its own detail line is above; this
      # branch names the consequence, and does NOT re-judge (branch-model.ts owns the verdict).
      echo "" >&2
      echo "ERROR: quay-init could not switch the main checkout onto the landing baseline 'develop'" >&2
      echo "       it had just established — the doc-only work branch would then be silently skipped" >&2
      echo "       and your edits would land on the branch fan-in fast-forwards." >&2
      echo "       NOTHING WAS WRITTEN — .quay/config.yml is byte-for-byte unchanged." >&2
      echo "       Move the checkout by hand and re-run:" >&2
      echo "           git -C $WORKSPACE_ROOT checkout develop" >&2
      echo "           bash $0 --root $WORKSPACE_ROOT <same flags as before>" >&2
      return 1
      ;;
    *"doc branch (name:"*)
      # The doc-branch step RAN and reported something other than a name collision (a failed
      # `git checkout`, say). Its own line carries the reason; this is NOT "cannot judge the branch
      # model", so it must not take the cannot-evaluate exit below.
      echo "ERROR: quay-init could not establish the doc-only work branch (its report is above)." >&2
      echo "       Refusing to continue: the branch model was judged but not established." >&2
      return 1
      ;;
    *)
      echo "ERROR: cannot judge this project's branch model — the delivered CLI exited ${bm_rc} without" >&2
      echo "       reporting a landing-baseline verdict (its output is above)." >&2
      echo "       Refusing to continue: an unjudged landing baseline is not a passing one." >&2
      return 3
      ;;
  esac

  echo "" >&2
  echo "ERROR: quay-init REFUSES to upgrade this project — its landing baseline ('develop') is not a" >&2
  echo "       continuation of the project's default branch, so every task would be structurally" >&2
  echo "       un-landable (anti-drift would diff against the whole divergent history)." >&2
  echo "       NOTHING WAS WRITTEN — .quay/config.yml is byte-for-byte unchanged." >&2
  echo "       Re-run with the adoption decision to proceed; the existing tip is preserved under" >&2
  echo "       '<branch>-pre-quay-init-<sha>' and NOTHING is destroyed:" >&2
  echo "           bash $0 --root $WORKSPACE_ROOT --adopt-branch-model <same flags as before>" >&2
  return 1
}

# Captured BEFORE this run writes anything (see write_profiles_template): the ONLY way to tell a
# user's pre-existing profile carrier apart from one this run created as its own intermediate.
# ⛔ `[ -f … ] && VAR=true` is NOT usable here: under `set -e` a false test would kill the script.
PROFILES_PRE_EXISTED=false
if [ -f "$WORKSPACE_ROOT/.quay/profiles.yml" ]; then PROFILES_PRE_EXISTED=true; fi

ensure_target_branch_model

# ── main dispatch: the SEVEN-item closed set ────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  write_config
  write_profiles_template
  echo "  would-create: tasks/"
  echo "  would-create: goals/"
  ensure_gitignore
  ensure_runtime_artifacts_gitignore
  write_template "$PLUGIN_ROOT/.claude/launch.settings.json" "$WORKSPACE_ROOT/.claude/launch.settings.json" "launch template"
  write_claude_settings
  echo "  auto-commit: SKIP (--dry-run — nothing was written)"
  print_install_steps
  echo "quay-init complete (dry-run)."
  exit 0
fi

write_config
write_profiles_template
mkdir -p "$WORKSPACE_ROOT/tasks"
echo "  created: tasks/"
mkdir -p "$WORKSPACE_ROOT/goals"
echo "  created: goals/"
ensure_gitignore
ensure_runtime_artifacts_gitignore
write_template "$PLUGIN_ROOT/.claude/launch.settings.json" "$WORKSPACE_ROOT/.claude/launch.settings.json" "launch template"
write_claude_settings

# L1 delivery-surface check (post-init, beside verify_referenced_landed): the six-category delivery
# surface of the SHIPPED quay checkout is complete. Read-only over the plugin's own root — never
# writes to the target, so the seven-item closed set is unaffected.
verify_delivery_surface_l1 || exit 2

auto_commit_laid_down
print_install_steps
echo "quay-init complete."
