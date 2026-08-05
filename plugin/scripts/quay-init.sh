#!/usr/bin/env bash
# quay-init.sh — mechanized implementation of the quay:init skill's copy logic.
# gap-loop-mechanism-lives-outside-the-package-and-cannot-ship: consolidates the
# idempotent-copy + `--loop` lay-down + config generation into ONE executable,
# so the e2e (test/cold-start-e2e.sh) and the skill (plugin/skills/init/SKILL.md) both
# exercise the SAME mechanism (ADR-004: hard checks over prose; no second copy of the
# copy logic).
#
# gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them: install is
# CONFIGURATION-DRIVEN, not text-substitution. Every laid-down file is byte-identical
# to the product artifact (`cmp`-checkable, AC1). The target-project values
# (repo_root / test_command / tmux_session) live in ONE config file
# (`.quay/config.yml` `loop:` section, AC2); scripts and tick docs read them at runtime
# (AC3), so nothing is baked in and two installs of the same product are byte-identical
# except the config (AC4). The upgrade path replaces install-managed stale files (AC5)
# while a genuine user edit still raises CONFLICT and is preserved (AC6).
#
# The skill's inline bash was the original source of truth; this script is that logic
# extracted + extended with the `--loop` category. The skill now delegates here, so
# there is exactly one lay-down implementation.
#
# Categories:
#   --workflows     plugin/workflows/     → <workspace>/.claude/workflows/
#   --agents        plugin/agents/        → <workspace>/.claude/agents/
#   --loop          two-layer loop mechanism (tick docs + checkers + gate + token + observation)
#   --all           all of the above except --loop (matching the skill's historical default)
# NOTE (2026-08-05 retirement): the old gate-script category that copied the plugin's
# classic-pipeline era gates (it0-*/audit-*/drain-*/vmeta-lag) into <workspace>/scripts/gates/
# is RETIRED. Those gates were laid into every target project but nothing called them — dead
# weight shipped to every install. Layered retirement (send-keys-verified precedent): the files
# stay in the plugin tree, but no category lays them down and sync.sh no longer syncs them. The
# live fast-mode gate scripts ship via the --loop plugin/scripts/ landing.
# Flags:
#   --force         overwrite on conflict (backup the existing file first)
#   --dry-run       list what would happen, copy nothing
# Loop params (consumed only by --loop):
#   --root <dir>           workspace root (default: cwd)
#   --project <name>       project name (default: basename of --root)
#   --repo-root <path>     the target project root, recorded in .quay/config.yml loop.repo_root
#                          (default: --root)
#   --tmux-session <sess>  tmux session, recorded in .quay/config.yml loop.tmux_session and
#                          orchestration/session-liveness.env (default: DETECTED from
#                          `tmux list-sessions` by project name; when nothing unique is detected
#                          the install FAILS CLOSED — never a guessed "<project>-0:0.0", see
#                          detect_tmux_session / gap-init-guesses-the-tmux-session)
#   --test-command <cmd>   the target project's test command, recorded in .quay/config.yml
#                          loop.test_command (REQUIRED for --loop; there is no universal default)
#   --worktree-root <dir>  worktree root, recorded in .quay/config.yml loop.worktree_root
#                          (default: <repo_root>/../<basename>-worktrees, a DISK path — /tmp is
#                          tmpfs, and every worktree on tmpfs is RAM; a machine-wide OOM traced
#                          straight to it. Fail-closed on a tmpfs root, AC3/AC4)
#
# Plugin root: ${CLAUDE_PLUGIN_ROOT} or --plugin-root <dir>. Fail-closed if unset/missing.

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
DO_WORKFLOWS=false
DO_AGENTS=false
DO_LOOP=false
ANY_CATEGORY=false

# ── parse args ─────────────────────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --workflows) DO_WORKFLOWS=true; ANY_CATEGORY=true; shift ;;
    --agents) DO_AGENTS=true; ANY_CATEGORY=true; shift ;;
    --loop) DO_LOOP=true; ANY_CATEGORY=true; shift ;;
    --all) DO_WORKFLOWS=true; DO_AGENTS=true; ANY_CATEGORY=true; shift ;;
    --force) FORCE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
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

# Defaults for loop params.
if [ -z "$PROJECT_NAME" ]; then PROJECT_NAME="$(basename "$WORKSPACE_ROOT")"; fi
if [ -z "$REPO_ROOT" ]; then REPO_ROOT="$WORKSPACE_ROOT"; fi
# NOTE: TMUX_SESSION is deliberately NOT defaulted here. The old default was a guessed
# "<project>-0:0.0" (gap-init-guesses-the-tmux-session): it only worked for the project it was
# written for, and a monitor aimed at a nonexistent session reports a LIVE inner as GONE (the
# false-negative this monitor must never emit). The --loop block DETECTS the real session by
# project name and FAILS CLOSED when none is found — never a guess.

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

# ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
COPIED=0; SKIPPED=0; CONFLICTED=0; CLEANED=0
# Backup timestamp for AC4 residue cleanup: every cleanup in one run is grouped under a single
# per-run backup dir (<workspace>/.quay/quay-init-backups/<ts>/), so "backup 在哪" is one line.
BACKUP_TS="$(date +%s)"

# state_laid_hash <workspace-rel-path>: read the recorded laid-down hash of a managed product
# file from .quay/quay-init-state.json (written by the PREVIOUS install — the upgrade path's
# record of "what quay-init laid down"). Empty when there is no record (fresh install) or the
# file is not managed.
state_laid_hash() {
  local rel="$1"
  [ -f "$WORKSPACE_ROOT/.quay/quay-init-state.json" ] || { echo ""; return; }
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    print(d.get("laidFiles", {}).get(sys.argv[2], ""))
except Exception:
    print("")
' "$WORKSPACE_ROOT/.quay/quay-init-state.json" "$rel"
}

# idempotent copy of one file. The 3rd arg MODE ("clean"|"preserve"|"managed", default preserve)
# distinguishes three conflict classes for a same-name-different-content target:
#   clean    — PRODUCT-OWNED files (loop mechanism executables: 可执行文件一律原样复制，只生成配置).
#              A same-name-different-content target is RESIDUE (a stale hot-copy leftover) and is
#              DISPOSED OF: backed up under <workspace>/.quay/quay-init-backups/<ts>/ and replaced
#              with the product content, with a visible report (gap-cold-start-...-eight-steps AC4).
#   managed  — install-managed localizable files (tick docs / prose). The upgrade path (AC5)
#              distinguishes install-managed stale content from a genuine user edit by the
#              recorded laid-down hash: a target that still equals what the PREVIOUS install laid
#              down is stale product from an older plugin version → replaced (backed up + reported);
#              a target that differs from BOTH the product and that hash is a user edit → CONFLICT,
#              preserved (AC6 — replacing a silent skip with a silent overwrite is the worse trade).
#   preserve — localizable files: the conflict is listed and the target is left untouched.
# Usage: copy_one <src> <dst> [clean|preserve|managed]
copy_one() {
  local src="$1" dst="$2" mode="${3:-preserve}"
  local fname
  fname="$(basename "$dst")"

  if [ ! -f "$dst" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  would-copy: $dst"
    else
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      echo "  copied: $dst"
    fi
    COPIED=$((COPIED + 1))
  elif cmp -s "$src" "$dst"; then
    SKIPPED=$((SKIPPED + 1))
    if [ "$DRY_RUN" = true ]; then
      echo "  would-skip (identical): $dst"
    else
      echo "  skipped (identical): $dst"
    fi
  elif [ "$mode" = "clean" ]; then
    # AC4 residue cleanup: the target has a same-name file whose content differs from the product —
    # a stale hot-copy leftover. Dispose of it VISIBLY: back it up and replace it. 不静默覆盖 — the
    # backup path is always reported, never a silent overwrite.
    CLEANED=$((CLEANED + 1))
    if [ "$DRY_RUN" = true ]; then
      echo "  would-clean-residue: $dst (stale copy differs from the product — would back up + replace)"
    else
      local backup_dir="$WORKSPACE_ROOT/.quay/quay-init-backups/$BACKUP_TS"
      mkdir -p "$backup_dir"
      cp "$dst" "$backup_dir/$fname"
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      echo "  cleaned-residue: $dst"
      echo "    backup: $backup_dir/$fname"
    fi
    COPIED=$((COPIED + 1))
  elif [ "$mode" = "managed" ]; then
    # Install-managed localizable file (config-driven install, SPEC AC5/AC6). A target that
    # still equals the previous install's recorded laid-down hash is stale product from an
    # OLDER plugin version → replaced. A target that differs from both the product and that
    # hash is a genuine user edit → CONFLICT, preserved (AC6 must still fire).
    local laid_hash cur_hash
    laid_hash="$(state_laid_hash "${dst#"$WORKSPACE_ROOT"/}")"
    cur_hash="$(sha256sum "$dst" | cut -d' ' -f1)"
    if [ -n "$laid_hash" ] && [ "$laid_hash" = "$cur_hash" ]; then
      CLEANED=$((CLEANED + 1))
      if [ "$DRY_RUN" = true ]; then
        echo "  would-replace-stale-install: $dst (previous quay-init laid it verbatim; upgrade to the new product)"
      else
        local backup_dir="$WORKSPACE_ROOT/.quay/quay-init-backups/$BACKUP_TS"
        mkdir -p "$backup_dir"
        cp "$dst" "$backup_dir/$fname"
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        echo "  replaced-stale-install: $dst"
        echo "    backup: $backup_dir/$fname"
      fi
      COPIED=$((COPIED + 1))
    elif [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  would-overwrite (conflict, --force): $dst"
      else
        mkdir -p "$(dirname "$dst")"
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$src" "$dst"
        echo "  overwritten (backed up): $dst"
      fi
      COPIED=$((COPIED + 1))
    else
      CONFLICTED=$((CONFLICTED + 1))
      if [ "$DRY_RUN" = true ]; then
        echo "  would-conflict (content differs, skip unless --force): $dst"
      else
        echo "  CONFLICT: $dst (content differs — use --force to overwrite)"
      fi
    fi
  else
    # preserve (default): localizable files — the conflict is listed and the target is left untouched.
    if [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  would-overwrite (conflict, --force): $dst"
      else
        mkdir -p "$(dirname "$dst")"
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$src" "$dst"
        echo "  overwritten (backed up): $dst"
      fi
      COPIED=$((COPIED + 1))
    else
      CONFLICTED=$((CONFLICTED + 1))
      if [ "$DRY_RUN" = true ]; then
        echo "  would-conflict (content differs, skip unless --force): $dst"
      else
        echo "  CONFLICT: $dst (content differs — use --force to overwrite)"
      fi
    fi
  fi
}

# copy_dir <src_dir> <dst_dir>: idempotent-copy every file in src_dir.
copy_dir() {
  local src_dir="$1" dst_dir="$2"
  if [ ! -d "$src_dir" ] || [ -z "$(ls -A "$src_dir" 2>/dev/null)" ]; then
    echo "  (source directory missing or empty — skipped category)"
    return
  fi
  local f
  for f in "$src_dir"/*; do
    [ -f "$f" ] || continue
    copy_one "$f" "$dst_dir/$(basename "$f")"
  done
}

# render_substitutions has been REMOVED (gap-install-rewrites-files-so-upgrade-cannot-tell-
# who-changed-them): install is configuration-driven, not text-substitution. Every laid-down
# file is byte-identical to the product artifact (SPEC AC1); the target-project values
# (repo_root / test_command / tmux_session) live in ONE config file (.quay/config.yml `loop:`
# section, AC2) and are READ at runtime, never baked in (AC3). The tick docs are laid down
# VERBATIM, so a byte-identical landing is `cmp`-checkable and the upgrade path can tell a
# stale install-managed file from a user edit (state_laid_hash / the `managed` copy mode).

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
#                        caller REQUIRES explicit --tmux-session, never picks one)
#   zero matches       → nothing, exit 1 (caller FAILS CLOSED — never write a guess)
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

# write_provider_config: generate/ensure the target's .quay/config.yml provider mcp_entry is
# PROJECT-LOCAL (AC7b, gap-cold-start-...-eight-steps). The cold-started loop must NOT depend on the
# quay dev tree through PATH symlinks (quay-native → /home/yale/work/quay/packages/quay-native/dist/).
# If the target has no config yet, write one whose provider uses ABSOLUTE project-local paths (never
# a bare `quay-native` that PATH-resolves to the dev tree). The mcp_entry command is an absolute path
# into the laid-down project-local vendor runtime (vendor/quay-native/dist/quay-native.js — the
# self-contained native provider bundle quay-init lays down alongside the Core bundle; see the AC7b
# lay-down below). If a config already exists, the project owns it — just note the AC7b requirement
# (a future --force could patch it; not silently rewritten).
# ensure_loop_config: add/update the `loop:` section in an EXISTING `.quay/config.yml` with the
# three target-project values (repo_root / test_command / tmux_session — SPEC AC2, the single
# config source for the loop). Laid-down scripts and tick docs READ these at runtime instead of
# having them baked in at install (SPEC AC3), so two installs of the same product are byte-identical
# except this config (AC4). A pre-existing config's other keys (providers, credentials) are
# preserved; only the loop section is added/updated. Used only when the config already exists — a
# config-less target gets the loop section from write_provider_config's heredoc (which preserves
# the inline `["node", ...]` mcp_entry the AC7b test pins). Uses python3 + yaml so the values are
# always valid YAML scalars regardless of their content.
ensure_loop_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root — SPEC AC2)"
    return
  fi
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$REPO_ROOT" "$TEST_COMMAND" "$TMUX_SESSION" "$WORKTREE_ROOT" <<'PYEOF'
import sys, yaml
cfg, repo, test, tmux, wtroot = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
with open(cfg, encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}
data["loop"] = {"repo_root": repo, "test_command": test, "tmux_session": tmux, "worktree_root": wtroot}
with open(cfg, "w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
print(f"  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root — SPEC AC2)")
PYEOF
}

write_provider_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b)"
    return
  fi
  if [ -f "$cfg" ]; then
    echo "  note: .quay/config.yml already exists — keep the provider mcp_entry on project-local absolute paths, never a PATH-resolved quay-native (AC7b)"
    ensure_loop_config
  else
    mkdir -p "$WORKSPACE_ROOT/.quay" "$WORKSPACE_ROOT/tasks"
    cat > "$cfg" <<EOF
# Generated by quay-init --loop (gap-cold-start-...-eight-steps AC7b).
# The provider mcp_entry uses ABSOLUTE project-local paths — never a PATH-resolved
# \`quay-native\` symlink into the quay dev tree. The native provider runtime
# (vendor/quay-native/dist/quay-native.js) is the self-contained bundle quay-init
# lays down alongside the Core bundle (see the AC7b lay-down in quay-init.sh).
providers:
  native:
    enabled: true
    path: "${WORKSPACE_ROOT}/vendor/quay-native"
    tasks_dir: "${WORKSPACE_ROOT}/tasks"
    mcp_entry: ["node", "${WORKSPACE_ROOT}/vendor/quay-native/dist/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "${WORKSPACE_ROOT}/tasks"
# Target-project loop values (gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them,
# SPEC AC2): the single config source for repo_root / test_command / tmux_session / worktree_root.
# Scripts and tick docs read these at runtime instead of having them baked in at install (AC3).
loop:
  repo_root: ${REPO_ROOT}
  test_command: ${TEST_COMMAND}
  tmux_session: ${TMUX_SESSION}
  worktree_root: ${WORKTREE_ROOT}
EOF
    echo "  wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b; loop: repo_root/test_command/tmux_session/worktree_root — SPEC AC2)"
  fi
}

# write_state_file: record what --loop laid down, for the upgrade path (AC5).
write_state_file() {
  if [ "$DRY_RUN" = true ]; then return; fi
  if [ ! -d "$WORKSPACE_ROOT/.quay" ]; then
    # A workspace without .quay/ still gets the state record in a sibling location.
    mkdir -p "$WORKSPACE_ROOT/.quay"
  fi
  python3 - "$PLUGIN_VERSION" "$WORKSPACE_ROOT/.quay/quay-init-state.json" "$WORKSPACE_ROOT" <<'PYEOF'
import json, os, sys, time, hashlib
version, path, workspace_root = sys.argv[1], sys.argv[2], sys.argv[3]
state = {}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        state = {}
prev = state.get("pluginVersion")
state["pluginVersion"] = version
state["previousPluginVersion"] = prev if prev and prev != version else state.get("previousPluginVersion")
state["laidAt"] = time.time()
state["laidCategories"] = sorted(set(state.get("laidCategories", [])) | {"loop"})
# laidFiles: sha256 of each install-managed (tick-doc) product file's CURRENT content — the
# upgrade path's record of "what quay-init laid down". A file that on a later run still equals
# this hash is stale install-managed content from an OLDER plugin version (replaced, AC5); a
# file that differs from BOTH this hash and the new product is a genuine user edit (CONFLICT,
# AC6). The config-driven install makes this distinction possible: every laid-down file is
# byte-identical to the product, so the ONLY reason a managed file can differ on upgrade is
# either a stale previous install or a user edit — and the hash tells them apart.
laid = {}
for rel in ["orchestration/orchestrator-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md"]:
    p = os.path.join(workspace_root, rel)
    if os.path.exists(p):
        with open(p, "rb") as f:
            laid[rel] = hashlib.sha256(f.read()).hexdigest()
state["laidFiles"] = laid
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
print(f"  state: .quay/quay-init-state.json pluginVersion={version} previous={prev or 'none'}")
PYEOF
}

# write_session_env: generate/update orchestration/session-liveness.env with the session-liveness
# default-target session (gap-quay-init-rewrites-an-executable-instead-of-generating-config AC1/AC2).
# Principle: 可执行文件一律原样复制，只生成配置 — the per-project session is CONFIG (可以生成的一类),
# so quay-init writes it here and the script (copied verbatim) reads it. A pre-existing file's other
# keys (SESSION_TARGETS / SESSION_HEARTBEATS — the manager's per-machine topology) are preserved;
# only the SESSION_TMUX_SESSION line is added/updated. This file is per-project state, never packaged.
write_session_env() {
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: orchestration/session-liveness.env (SESSION_TMUX_SESSION=$TMUX_SESSION)"
    return
  fi
  local env_file="$WORKSPACE_ROOT/orchestration/session-liveness.env"
  local tmp
  tmp="$(mktemp)"
  if [ -f "$env_file" ]; then
    sed '/^SESSION_TMUX_SESSION=/d' "$env_file" > "$tmp"
  else
    printf '# Generated by quay-init --loop: per-project session-liveness config.\n' > "$tmp"
    printf '# SESSION_TMUX_SESSION sets the default-target session (see plugin/scripts/session-liveness.sh).\n' >> "$tmp"
  fi
  printf 'SESSION_TMUX_SESSION=%s\n' "$TMUX_SESSION" >> "$tmp"
  cp "$tmp" "$env_file"
  rm -f "$tmp"
  echo "  wrote: orchestration/session-liveness.env (SESSION_TMUX_SESSION=$TMUX_SESSION)"
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

# verify_referenced_landed <workspace-root> — gap-init-ships-a-skill-that-calls-files-it-does-not-
# lay-down. The mechanical constraint "referenced set ⊆ landed set": every file the shipped skills
# and tick docs reference by path (plugin/scripts/*, orchestration/*, docs/analysis/*) must exist
# in the target workspace after the --loop lay-down, UNLESS it is explicitly declared in
# plugin/skills/init/SKILL.md as self-create (local state the first run creates — AC8) or
# reference-doc (quay-specific template prose that is not a loop-mechanism deliverable). The two
# hand-maintained lists (call sites vs landing set) with no mechanical bond must drift; this is
# the bond. A referenced file that is neither landed nor declared = drift → FAIL CLOSED.
verify_referenced_landed() {
  local ws="$1" missing=0 r
  local refs selfcreate refdoc
  refs="$(grep -ohE '(plugin/scripts|orchestration|docs/analysis)/[a-zA-Z0-9._-]+' "$PLUGIN_ROOT/skills"/*/SKILL.md "$PLUGIN_ROOT"/loop/*.md 2>/dev/null | sort -u || true)"
  # Machine-readable declarations live in the shipped init skill (single source of truth — the
  # same doc the human reads). Marker lines:
  #   <!-- self-create: <path> -->       local state, first run creates it (AC8)
  #   <!-- reference-doc: <path> -->     quay-specific reference doc, not a loop deliverable
  selfcreate="$(grep -oE '<!-- self-create: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- self-create: //; s/ -->//' | sort -u || true)"
  refdoc="$(grep -oE '<!-- reference-doc: [a-zA-Z0-9._/-]+ -->' "$PLUGIN_ROOT/skills/init/SKILL.md" 2>/dev/null | sed -E 's/<!-- reference-doc: //; s/ -->//' | sort -u || true)"
  for r in $refs; do
    # exact-line membership in the declared sets (newline-separated — a `case` pattern would
    # need spaces the multi-line variable does not have)
    if printf '%s\n' "$selfcreate" "$refdoc" | grep -qxF "$r"; then
      continue   # declared self-create or reference-doc — not a defect
    fi
    if [ ! -e "$ws/$r" ]; then
      echo "  FAIL (referenced-not-landed): $r — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md" >&2
      missing=1
    fi
  done
  if [ "$missing" = 1 ]; then
    echo "ERROR: quay-init --loop would ship skills/tick docs that reference files it does not lay down (referenced ⊆ landed violated)." >&2
    echo "       Add the script to the landing set, or declare the file self-create/reference-doc in plugin/skills/init/SKILL.md." >&2
    return 1
  fi
  echo "  verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc)"
  return 0
}

# ── categories ─────────────────────────────────────────────────────────────────────────────────────
echo "quay-init (plugin v${PLUGIN_VERSION})"

# Per-category counters via deltas on the global COPIED/SKIPPED/CONFLICTED.
record_category() {
  local label="$1" base_copied="$2" base_skipped="$3" base_conflicted="$4"
  echo "  $label: copied=$((COPIED - base_copied)) skipped=$((SKIPPED - base_skipped)) conflicted=$((CONFLICTED - base_conflicted))"
}

if [ "$DO_WORKFLOWS" = true ]; then
  local_base_copied="$COPIED"; local_base_skipped="$SKIPPED"; local_base_conflicted="$CONFLICTED"
  echo "  workflows:"
  copy_dir "$PLUGIN_ROOT/workflows" "$WORKSPACE_ROOT/.claude/workflows"
  record_category "workflows" "$local_base_copied" "$local_base_skipped" "$local_base_conflicted"
fi

if [ "$DO_AGENTS" = true ]; then
  local_base_copied="$COPIED"; local_base_skipped="$SKIPPED"; local_base_conflicted="$CONFLICTED"
  echo "  agents:"
  copy_dir "$PLUGIN_ROOT/agents" "$WORKSPACE_ROOT/.claude/agents"
  record_category "agents" "$local_base_copied" "$local_base_skipped" "$local_base_conflicted"
fi

if [ "$DO_LOOP" = true ]; then
  local_base_copied="$COPIED"; local_base_skipped="$SKIPPED"; local_base_conflicted="$CONFLICTED"
  # AC2 (gap-cold-start-...-eight-steps): the target project's test command is DETECTABLE, not
  # something the human must know in advance. An explicit --test-command always wins; otherwise the
  # priority ladder (scripts/test.sh → package.json scripts.test → go.mod → Cargo.toml) detects it
  # and a successful detection is PRINTED for the human to confirm. A detection MISS FAILS CLOSED
  # (AC3) naming every location searched — the 判绿 convention (grep 'cancelled 0' / FULL-SUITE-EXIT /
  # tests=N) needs a concrete command, and a guessed default is exactly what the negative control
  # forbids (no leaking the quay-specific scripts/test.sh into a laid-down copy that doesn't use it).
  if [ -z "$TEST_COMMAND" ]; then
    if DETECTED="$(detect_test_command "$WORKSPACE_ROOT")"; then
      TEST_COMMAND="$DETECTED"
      echo "  detected test command: $TEST_COMMAND (from the target project — confirm this is correct)"
    else
      echo "ERROR: --loop needs the target project's test command but none could be detected in $WORKSPACE_ROOT." >&2
      echo "       Searched these detection sources (in order):" >&2
      echo "         - scripts/test.sh" >&2
      echo "         - package.json (a scripts.test entry)" >&2
      echo "         - go.mod" >&2
      echo "         - Cargo.toml" >&2
      echo "       There is no universal default (quay uses scripts/test.sh, archguard uses npm test, meta-cc uses go test)." >&2
      echo "       Pass --test-command <cmd> explicitly to set the target's test command." >&2
      exit 2
    fi
  else
    echo "  using explicit --test-command: $TEST_COMMAND"
  fi

  # AC1/AC2/AC3 (gap-init-guesses-the-tmux-session): the target project's tmux session is
  # DETECTED, not guessed. An explicit --tmux-session always wins; otherwise tmux list-sessions
  # is matched by project name: a UNIQUE match is used (printed for the human to confirm), a
  # MULTIPLE match requires explicit --tmux-session (never pick one), and a ZERO match FAILS
  # CLOSED (AC2) — the old "<project>-0:0.0" default only worked for the project it was written
  # for, and a monitor aimed at a nonexistent session reports a LIVE inner as GONE (the
  # false-negative this task exists to kill). Never write a guessed value into the monitor config.
  if [ -z "$TMUX_SESSION" ]; then
    # set -euo pipefail would terminate the script the instant detect_tmux_session returns
    # non-zero, so a bare `DETECT_RC=$?` on the next line never ran — the exit code was
    # hijacked into the script's own and the stderr branch was skipped. Capture it on the
    # SAME command line, zero-initialized (gap-init-guesses-the-tmux-session AC2/AC3 fix).
    DETECT_RC=0
    DETECT_OUT="$(detect_tmux_session "$PROJECT_NAME")" || DETECT_RC=$?
    if [ "$DETECT_RC" = 0 ]; then
      TMUX_SESSION="$DETECT_OUT"
      echo "  detected tmux session: $TMUX_SESSION (from tmux list-sessions matching project '$PROJECT_NAME' — confirm this is correct)"
    elif [ "$DETECT_RC" = 2 ]; then
      echo "ERROR: multiple tmux sessions match project '$PROJECT_NAME':" >&2
      printf '%s\n' "$DETECT_OUT" | sed 's/^/         - /' >&2
      echo "       Refusing to guess which one is the target session — a guessed value writes a lying monitor." >&2
      echo "       Pass --tmux-session <sess> explicitly (e.g. 'tmux list-sessions' to see the real sessions)." >&2
      exit 2
    else
      echo "ERROR: --loop needs the target project's tmux session but none could be detected." >&2
      echo "       Searched: tmux list-sessions -F '#{session_name}' for sessions matching '$PROJECT_NAME'." >&2
      echo "       There is no universal default — the old '<project>-0:0.0' only works for the project it was written for." >&2
      echo "       Pass --tmux-session <sess> explicitly (e.g. 'tmux list-sessions' to see the real sessions)." >&2
      exit 2
    fi
  else
    echo "  using explicit --tmux-session: $TMUX_SESSION"
  fi

  # worktree_root (gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs AC2):
  # resolved from an existing config loop.worktree_root first (an upgrade keeps its chosen path),
  # else --worktree-root, else the sibling-of-repo DISK default. Fail-closed on tmpfs (AC3) — a
  # real disk root proceeds (AC4). Written into .quay/config.yml below so tick docs + skills read
  # it at runtime instead of spelling a literal path (AC2).
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

  echo "  loop (two-layer mechanism):"
  mkdir -p "$WORKSPACE_ROOT/plugin/scripts"
  mkdir -p "$WORKSPACE_ROOT/orchestration"
  mkdir -p "$WORKSPACE_ROOT/docs/analysis"

  # Mechanism scripts (checkers + gate + token + observation) → <workspace>/plugin/scripts/.
  # gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down, Chosen-mechanism (a): the landing
  # list for scripts is DERIVED from the shipped skills + tick docs' own `plugin/scripts/*`
  # references — precise (only what is called ships, no dev-tree-only tools like sync-vendor.sh)
  # and drift-immune (a new reference auto-ships; there is no second hand-maintained copy to drift
  # from). The explicit additions below are ONLY files the docs call by BARE NAME (no
  # `plugin/scripts/` prefix, so not derivable) plus the checkers' TRANSITIVE DEPENDENCIES
  # (imported by them, not doc-referenced — the laid-down mechanism must be functional; e2e proved
  # the checkers cannot run without gate-script-base.ts / workflow-event-schema.mjs). The
  # referenced-set ⊆ landed-set invariant is mechanically enforced by verify_referenced_landed
  # below — a future skill/tick reference to a script that does not exist in the plugin FAILS the
  # install (never the empty-set verifier).
  # NOTE: inner-state.sh is deliberately NOT here (gap-retire-inner-state-one-observer-targets-by-
  # parameter AC3) — it is retired and not referenced by any shipped doc; observation has exactly
  # ONE tool, session-liveness.sh, which is laid down separately below (its env config is generated).
  DERIVED_SCRIPTS="$(grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' "$PLUGIN_ROOT/skills"/*/SKILL.md "$PLUGIN_ROOT"/loop/*.md 2>/dev/null | sed 's#^plugin/scripts/##' | sort -u || true)"
  # shellcheck disable=SC2207
  LOOP_SCRIPTS=(
    $DERIVED_SCRIPTS
    # tick-doc BARE-NAME mechanism files (no plugin/scripts/ prefix in the docs → not derivable):
    inner-idle-log.ts
    heavy-op-token.sh
    it0-split-or-commit-check.ts
    pipe-exit-code-check.sh
    # transitive deps of the checkers (imported by them, not doc-referenced):
    gate-script-base.ts
    workflow-event-schema.mjs
    task-schema.ts
    touches-parser.ts
    wiring-coverage-check.ts
    # capability catalog (gap-eighty-two-shipped-checks-and-none-says-what-it-answers):
    # ships with the loop so an installed project can see what each laid-down check
    # answers. Deliberate explicit addition (no doc references it by path — the catalog
    # is self-describing, so it cannot be derived from a doc's plugin/scripts reference).
    capability-catalog.sh
  )
  for s in "${LOOP_SCRIPTS[@]}"; do
    if [ -f "$PLUGIN_ROOT/scripts/$s" ]; then
      # mode "clean": a stale same-name target is RESIDUE (AC4) — backed up + replaced, never
      # silently skipped. Mechanism executables must be current (verify-installed-executables.sh
      # fails closed on any drift, so a leftover stale copy would otherwise abort the install).
      copy_one "$PLUGIN_ROOT/scripts/$s" "$WORKSPACE_ROOT/plugin/scripts/$s" clean
    else
      echo "  WARN: loop mechanism script missing from plugin: plugin/scripts/$s" >&2
    fi
  done

  # Tick docs → <workspace>/orchestration/ and <workspace>/docs/analysis/ (mirroring the quay repo's
  # own layout so the docs' internal relative references resolve), laid down VERBATIM — no text
  # substitution (gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them). The target
  # project's values live in `.quay/config.yml` `loop:` and are read at runtime, so the laid-down
  # copy is byte-identical to the product (SPEC AC1/AC3). mode "managed" distinguishes a stale
  # install-managed copy (previous install laid it — replaced on upgrade, AC5) from a genuine user
  # edit (CONFLICT, AC6).
  for pair in \
    "orchestrator-loop-tick.md:orchestration/orchestrator-loop-tick.md" \
    "fast-mode-loop-tick.md:docs/analysis/fast-mode-loop-tick.md"; do
    src_name="${pair%%:*}"
    dst_rel="${pair##*:}"
    src="$PLUGIN_ROOT/loop/$src_name"
    dst="$WORKSPACE_ROOT/$dst_rel"
    if [ ! -f "$src" ]; then
      echo "  WARN: loop tick doc missing from plugin: plugin/loop/$src_name" >&2
      continue
    fi
    copy_one "$src" "$dst" managed
  done

  # Session-liveness monitor (productization AC2/AC7; renamed+generalized from outer-liveness.sh,
  # AC10): laid down VERBATIM via cp (gap-quay-init-rewrites-an-executable-instead-of-generating-config
  # — 可执行文件一律原样复制，只生成配置). The default-target session no longer uses a placeholder:
  # the script resolves it itself (env SESSION_TMUX_SESSION → orchestration/session-liveness.env →
  # default), so the installed copy NEVER differs from its source. The per-project session value is
  # written to orchestration/session-liveness.env below (config = "可以生成" 的一类, per-project state).
  sl_src="$PLUGIN_ROOT/scripts/session-liveness.sh"
  sl_dst="$WORKSPACE_ROOT/plugin/scripts/session-liveness.sh"
  if [ ! -f "$sl_src" ]; then
    echo "  WARN: session-liveness.sh missing from plugin: $sl_src" >&2
  else
    # mode "clean": session-liveness.sh is an executable that must be current (AC4 residue
    # cleanup — a stale copy is backed up + replaced, never silently left in place).
    copy_one "$sl_src" "$sl_dst" clean
    write_session_env
  fi

  # AC7b (gap-cold-start-...-eight-steps): lay down the runtime INTO the target. The target's loop
  # must NOT depend on the quay dev tree through PATH symlinks (quay-native → /home/yale/work/quay/
  # packages/quay-native/dist/). The built Core runtime (vendor/quay/dist/quay.js) AND the built
  # native provider runtime (vendor/quay-native/dist/quay-native.js + provider.yml — the
  # self-contained provider bundle, gap-ac3b-prove-installed-quay-runs-without-dev-tree) are copied
  # into the target so the target's .quay/config.yml can point its provider mcp_entry at a
  # PROJECT-LOCAL copy of the provider runtime (an absolute path into vendor/quay-native/, never a
  # bare `quay-native` that PATH-resolves to a dev tree). The two laid-down files must stay together:
  # the bundle resolves provider.yml relative to its own location. A plugin source without the built
  # bundles (a raw checkout that hasn't run sync-vendor.sh) warns instead of failing — the runtimes
  # are generated artifacts, not tracked sources.
  if [ -f "$PLUGIN_ROOT/vendor/quay/dist/quay.js" ]; then
    copy_one "$PLUGIN_ROOT/vendor/quay/dist/quay.js" "$WORKSPACE_ROOT/vendor/quay/dist/quay.js" clean
  else
    echo "  WARN: plugin has no built Core runtime (vendor/quay/dist/quay.js) — skipping Core runtime lay-down (AC7b). Run sync-vendor.sh to build it." >&2
  fi
  if [ -f "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" ]; then
    copy_one "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" "$WORKSPACE_ROOT/vendor/quay-native/dist/quay-native.js" clean
    copy_one "$PLUGIN_ROOT/vendor/quay-native/provider.yml" "$WORKSPACE_ROOT/vendor/quay-native/provider.yml" clean
  else
    echo "  WARN: plugin has no built native provider runtime (vendor/quay-native/dist/quay-native.js) — the provider mcp_entry will reference a missing runtime (AC7b). Run sync-vendor.sh to build it." >&2
  fi
  write_provider_config

  # Upgrade-path state record (AC5): detect prior plugin version + already-laid assets.
  if [ -f "$WORKSPACE_ROOT/.quay/quay-init-state.json" ]; then
    prev="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pluginVersion","?"))' "$WORKSPACE_ROOT/.quay/quay-init-state.json" 2>/dev/null || echo '?')"
    echo "  upgrade: previous quay-init pluginVersion=${prev} → ${PLUGIN_VERSION}"
  fi
  write_state_file
  record_category "loop" "$local_base_copied" "$local_base_skipped" "$local_base_conflicted"

  # AC6/AC7 (gap-quay-init-rewrites-an-executable-instead-of-generating-config): after the lay-down,
  # assert EVERY installed executable under plugin/scripts/ is byte-identical to its plugin source.
  # Config-class files are explicit exceptions (tick docs — prose, laid verbatim but still localizable
  # via the `managed` mode; orchestration/session-liveness.env — 生成配置). Fail-closed: a future
  # regression that re-introduces install-time rewriting of an executable stops the install here.
  # The executor is every quay-init --loop run (incl. cold-start-e2e in CI).
  if [ "$DRY_RUN" != true ] && [ -f "$PLUGIN_ROOT/scripts/verify-installed-executables.sh" ]; then
    bash "$PLUGIN_ROOT/scripts/verify-installed-executables.sh" "$PLUGIN_ROOT" "$WORKSPACE_ROOT"
  fi

  # gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down: after the lay-down, enforce
  # "referenced set ⊆ landed set" mechanically (verify_referenced_landed above). This is the
  # two-hand-maintained-lists bond: a shipped skill/tick doc referencing a file that did NOT land
  # (and is not declared self-create/reference-doc) FAILS the install instead of shipping a
  # mechanism that calls files it never laid down. Same executor as the AC6 check — every --loop run.
  if [ "$DRY_RUN" != true ]; then
    verify_referenced_landed "$WORKSPACE_ROOT" || exit 2
  fi
fi

# ── summary ─────────────────────────────────────────────────────────────────────────────────────────
echo "quay-init complete."

# AC4: residue disposal is VISIBLE — when any stale same-name product file was cleaned, report
# the count and the backup location (never a silent overwrite).
if [ "$CLEANED" -gt 0 ]; then
  echo "cleaned-residue: ${CLEANED} stale same-name product file(s) — backups under ${WORKSPACE_ROOT}/.quay/quay-init-backups/${BACKUP_TS}/"
fi

if [ "$CONFLICTED" -gt 0 ]; then
  echo "Conflicts detected. To overwrite: /quay:init --force"
  echo "To see diffs: diff <target> ${PLUGIN_ROOT}/<category>/<file>"
  # Conflicts are REPORTED, not fatal: the upgrade path (AC5) must surface them for a human
  # without aborting the non-conflicting copies. Exit 0 so callers can distinguish "reported
  # conflicts" from "copy failed".
fi
