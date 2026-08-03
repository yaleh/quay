#!/usr/bin/env bash
# quay-init.sh — mechanized implementation of the quay:init skill's copy logic.
# gap-loop-mechanism-lives-outside-the-package-and-cannot-ship: consolidates the
# idempotent-copy + `--loop` lay-down + placeholder substitution into ONE executable,
# so the e2e (test/cold-start-e2e.sh) and the skill (plugin/skills/init/SKILL.md) both
# exercise the SAME mechanism (ADR-004: hard checks over prose; no second copy of the
# copy logic).
#
# The skill's inline bash was the original source of truth; this script is that logic
# extracted + extended with the `--loop` category. The skill now delegates here, so
# there is exactly one lay-down implementation.
#
# Categories:
#   --workflows     plugin/workflows/     → <workspace>/.claude/workflows/
#   --agents        plugin/agents/        → <workspace>/.claude/agents/
#   --gate-scripts  plugin/gate-scripts/  → <workspace>/scripts/gates/
#   --loop          two-layer loop mechanism (tick docs + checkers + gate + token + observation)
#   --all           all of the above except --loop (matching the skill's historical default)
# Flags:
#   --force         overwrite on conflict (backup the existing file first)
#   --dry-run       list what would happen, copy nothing
# Loop params (consumed only by --loop):
#   --root <dir>           workspace root (default: cwd)
#   --project <name>       project name (default: basename of --root)
#   --repo-root <path>     the repo root literal that replaces /home/yale/work/quay in laid-down
#                          tick docs (default: --root)
#   --tmux-session <sess>  tmux session that replaces quay-0:0.0 (default: <project>-0:0.0)
#   --test-command <cmd>   the target project's test command that replaces scripts/test.sh
#                          (REQUIRED for --loop; there is no universal default)
#
# Plugin root: ${CLAUDE_PLUGIN_ROOT} or --plugin-root <dir>. Fail-closed if unset/missing.

set -euo pipefail

# ── resolve plugin root ─────────────────────────────────────────────────────────────────────────────
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
WORKSPACE_ROOT="$(pwd)"
PROJECT_NAME=""
REPO_ROOT=""
TMUX_SESSION=""
TEST_COMMAND=""
FORCE=false
DRY_RUN=false
DO_WORKFLOWS=false
DO_AGENTS=false
DO_GATE_SCRIPTS=false
DO_LOOP=false
ANY_CATEGORY=false

# ── parse args ─────────────────────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --workflows) DO_WORKFLOWS=true; ANY_CATEGORY=true; shift ;;
    --agents) DO_AGENTS=true; ANY_CATEGORY=true; shift ;;
    --gate-scripts) DO_GATE_SCRIPTS=true; ANY_CATEGORY=true; shift ;;
    --loop) DO_LOOP=true; ANY_CATEGORY=true; shift ;;
    --all) DO_WORKFLOWS=true; DO_AGENTS=true; DO_GATE_SCRIPTS=true; ANY_CATEGORY=true; shift ;;
    --force) FORCE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --root) WORKSPACE_ROOT="$2"; shift 2 ;;
    --project) PROJECT_NAME="$2"; shift 2 ;;
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --tmux-session) TMUX_SESSION="$2"; shift 2 ;;
    --test-command) TEST_COMMAND="$2"; shift 2 ;;
    --plugin-root) PLUGIN_ROOT="$2"; shift 2 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# Default category: --all if no category flag given (matches the skill's historical default).
if [ "$ANY_CATEGORY" = false ]; then
  DO_WORKFLOWS=true; DO_AGENTS=true; DO_GATE_SCRIPTS=true
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
if [ -z "$TMUX_SESSION" ]; then TMUX_SESSION="${PROJECT_NAME}-0:0.0"; fi

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

# idempotent copy of one file. If RENDER is set, it is a prepared temp copy of SRC
# (e.g. a substitution-rendered tick doc) and is what gets copied to DST.
# CLEAN (4th arg: "clean"|"preserve", default preserve) distinguishes two conflict classes:
#   clean    — PRODUCT-OWNED files (loop mechanism executables: 可执行文件一律原样复制，只生成配置).
#              A same-name-different-content target is RESIDUE (a stale hot-copy leftover) and is
#              DISPOSED OF: backed up under <workspace>/.quay/quay-init-backups/<ts>/ and replaced
#              with the product content, with a visible report (gap-cold-start-...-eight-steps AC4).
#   preserve — localizable files (tick docs / prose): the conflict is listed and the target is left
#              untouched (upgrade path: local changes are never silently overwritten).
# Usage: copy_one <src> <dst> [render] [clean|preserve]
copy_one() {
  local src="$1" dst="$2" render="${3:-}" clean="${4:-preserve}"
  local eff_src="$src"
  if [ -n "$render" ]; then eff_src="$render"; fi
  local fname
  fname="$(basename "$dst")"

  if [ ! -f "$dst" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  would-copy: $dst"
    else
      mkdir -p "$(dirname "$dst")"
      cp "$eff_src" "$dst"
      echo "  copied: $dst"
    fi
    COPIED=$((COPIED + 1))
  elif cmp -s "$eff_src" "$dst"; then
    SKIPPED=$((SKIPPED + 1))
    if [ "$DRY_RUN" = true ]; then
      echo "  would-skip (identical): $dst"
    else
      echo "  skipped (identical): $dst"
    fi
  elif [ "$clean" = "clean" ]; then
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
      cp "$eff_src" "$dst"
      echo "  cleaned-residue: $dst"
      echo "    backup: $backup_dir/$fname"
    fi
    COPIED=$((COPIED + 1))
  else
    if [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  would-overwrite (conflict, --force): $dst"
      else
        mkdir -p "$(dirname "$dst")"
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$eff_src" "$dst"
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

# render_substitutions <src> <dst>: apply the --loop placeholder substitution to a tick-doc
# copy. Mechanized replacement of the quay-specific literals (gap-...-cannot-ship AC4):
#   /home/yale/work/quay → $REPO_ROOT
#   scripts/test.sh      → $TEST_COMMAND
#   quay-0:0.0           → $TMUX_SESSION
#   plugin/loop/*.md     → orchestration/*.md / docs/analysis/*.md  (the tick docs' self/reciprocal
#                         references are written for the quay repo's canonical layout; the target
#                         project lays them down at orchestration/ + docs/analysis/, so the laid-down
#                         copy's references are rewritten to the target layout)
# Uses python3 (same interpreter inner-state.sh already depends on) so the replacement is
# fixed-string, not regex — a '.' in quay-0:0.0 must not match arbitrary characters.
render_substitutions() {
  local src="$1" dst="$2"
  REPO_ROOT_ESC="$REPO_ROOT" TMUX_ESC="$TMUX_SESSION" TEST_ESC="$TEST_COMMAND" python3 - "$src" "$dst" <<'PYEOF'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
s = s.replace("/home/yale/work/quay", os.environ["REPO_ROOT_ESC"])
s = s.replace("scripts/test.sh", os.environ["TEST_ESC"])
s = s.replace("quay-0:0.0", os.environ["TMUX_ESC"])
s = s.replace("plugin/loop/orchestrator-loop-tick.md", "orchestration/orchestrator-loop-tick.md")
s = s.replace("plugin/loop/fast-mode-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md")
open(dst, "w", encoding="utf-8").write(s)
PYEOF
}

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

# write_provider_config: generate/ensure the target's .quay/config.yml provider mcp_entry is
# PROJECT-LOCAL (AC7b, gap-cold-start-...-eight-steps). The cold-started loop must NOT depend on the
# quay dev tree through PATH symlinks (quay-native → /home/yale/work/quay/packages/quay-native/dist/).
# If the target has no config yet, write one whose provider uses ABSOLUTE project-local paths (never
# a bare `quay-native` that PATH-resolves to the dev tree). If a config already exists, the project
# owns it — just note the AC7b requirement (a future --force could patch it; not silently rewritten).
write_provider_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b)"
    return
  fi
  if [ -f "$cfg" ]; then
    echo "  note: .quay/config.yml already exists — keep the provider mcp_entry on project-local absolute paths, never a PATH-resolved quay-native (AC7b)"
    return
  fi
  mkdir -p "$WORKSPACE_ROOT/.quay" "$WORKSPACE_ROOT/tasks"
  cat > "$cfg" <<EOF
# Generated by quay-init --loop (gap-cold-start-...-eight-steps AC7b).
# The provider mcp_entry uses ABSOLUTE project-local paths — never a PATH-resolved
# \`quay-native\` symlink into the quay dev tree. The native provider runtime must be
# present in the target (npm install / the cold-start dist extraction).
providers:
  native:
    enabled: true
    path: "${WORKSPACE_ROOT}/packages/quay-native"
    tasks_dir: "${WORKSPACE_ROOT}/tasks"
    mcp_entry: ["node", "${WORKSPACE_ROOT}/packages/quay-native/bin/quay-native.ts", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "${WORKSPACE_ROOT}/tasks"
EOF
  echo "  wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b)"
}

# write_state_file: record what --loop laid down, for the upgrade path (AC5).
write_state_file() {
  if [ "$DRY_RUN" = true ]; then return; fi
  if [ ! -d "$WORKSPACE_ROOT/.quay" ]; then
    # A workspace without .quay/ still gets the state record in a sibling location.
    mkdir -p "$WORKSPACE_ROOT/.quay"
  fi
  python3 - "$PLUGIN_VERSION" "$WORKSPACE_ROOT/.quay/quay-init-state.json" <<'PYEOF'
import json, os, sys, time
version, path = sys.argv[1], sys.argv[2]
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

if [ "$DO_GATE_SCRIPTS" = true ]; then
  local_base_copied="$COPIED"; local_base_skipped="$SKIPPED"; local_base_conflicted="$CONFLICTED"
  echo "  gate-scripts:"
  copy_dir "$PLUGIN_ROOT/gate-scripts" "$WORKSPACE_ROOT/scripts/gates"
  record_category "gate-scripts" "$local_base_copied" "$local_base_skipped" "$local_base_conflicted"
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

  echo "  loop (two-layer mechanism):"
  mkdir -p "$WORKSPACE_ROOT/plugin/scripts"
  mkdir -p "$WORKSPACE_ROOT/orchestration"
  mkdir -p "$WORKSPACE_ROOT/docs/analysis"

  # Mechanism scripts (checkers + gate + token + observation) → <workspace>/plugin/scripts/.
  # The last 5 are TRANSITIVE DEPENDENCIES of the checkers (imported by them): the laid-down
  # mechanism must be functional, so the dependency closure ships too (e2e proved inner-state.sh
  # cannot run without gate-script-base.ts / workflow-event-schema.mjs).
  LOOP_SCRIPTS=(
    fast-mode-telemetry.ts
    inner-blocked-signal.ts
    inner-forensics.mjs
    inner-idle-log.ts
    inner-state.sh
    resource-gate.sh
    heavy-op-token.sh
    task-contract-check.ts
    task-status-drift-check.ts
    touches-orthogonality-check.ts
    concurrent-batch-scheduler.ts
    it0-split-or-commit-check.ts
    pipe-exit-code-check.sh
    # transitive deps of the above:
    gate-script-base.ts
    workflow-event-schema.mjs
    task-schema.ts
    touches-parser.ts
    wiring-coverage-check.ts
  )
  for s in "${LOOP_SCRIPTS[@]}"; do
    if [ -f "$PLUGIN_ROOT/scripts/$s" ]; then
      # 4th arg "clean": a stale same-name target is RESIDUE (AC4) — backed up + replaced, never
      # silently skipped. Mechanism executables must be current (verify-installed-executables.sh
      # fails closed on any drift, so a leftover stale copy would otherwise abort the install).
      copy_one "$PLUGIN_ROOT/scripts/$s" "$WORKSPACE_ROOT/plugin/scripts/$s" "" clean
    else
      echo "  WARN: loop mechanism script missing from plugin: plugin/scripts/$s" >&2
    fi
  done

  # Tick docs → <workspace>/orchestration/ and <workspace>/docs/analysis/ (mirroring the quay repo's
  # own layout so the docs' internal relative references resolve), WITH placeholder substitution.
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
    if [ "$DRY_RUN" = true ]; then
      # Dry-run: report what the substituted copy would be. We judge copy/conflict by comparing
      # the TARGET against the rendered (substituted) source, so the accounting matches what a
      # real run would do — without writing anything.
      if [ ! -f "$dst" ]; then
        echo "  would-copy: $dst (with placeholder substitution)"
        COPIED=$((COPIED + 1))
      else
        # Render the substitution to a temp file just for the comparison, then discard it.
        render_tmp="$(mktemp)"
        render_substitutions "$src" "$render_tmp"
        if cmp -s "$render_tmp" "$dst"; then
          echo "  would-skip (identical after substitution): $dst"
          SKIPPED=$((SKIPPED + 1))
        else
          CONFLICTED=$((CONFLICTED + 1))
          echo "  would-conflict: $dst (local tick doc differs from the substituted plugin template — list for human)"
        fi
        rm -f "$render_tmp"
      fi
    else
      render_tmp="$(mktemp)"
      render_substitutions "$src" "$render_tmp"
      copy_one "$src" "$dst" "$render_tmp"
      rm -f "$render_tmp"
    fi
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
    # 4th arg "clean": session-liveness.sh is an executable that must be current (AC4 residue
    # cleanup — a stale copy is backed up + replaced, never silently left in place).
    copy_one "$sl_src" "$sl_dst" "" clean
    write_session_env
  fi

  # AC7b (gap-cold-start-...-eight-steps): lay down the runtime INTO the target. The target's loop
  # must NOT depend on the quay dev tree through PATH symlinks (quay-native → /home/yale/work/quay/
  # packages/quay-native/dist/). The built core runtime (vendor/quay/dist/quay.js) is copied into the
  # target so the target's .quay/config.yml can point its provider mcp_entry at a PROJECT-LOCAL copy.
  # A plugin source without the built bundle (a raw checkout that hasn't run sync-vendor.sh) warns
  # instead of failing — the runtime is a generated artifact, not a tracked source.
  if [ -f "$PLUGIN_ROOT/vendor/quay/dist/quay.js" ]; then
    copy_one "$PLUGIN_ROOT/vendor/quay/dist/quay.js" "$WORKSPACE_ROOT/vendor/quay/dist/quay.js" "" clean
  else
    echo "  WARN: plugin has no built runtime (vendor/quay/dist/quay.js) — skipping runtime lay-down (AC7b). Run sync-vendor.sh to build it." >&2
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
  # Config-class files are explicit exceptions (tick docs — 散文本地化；orchestration/session-liveness.env
  # — 生成配置). Fail-closed: a future regression that re-adds render_substitutions to an executable
  # stops the install here. The executor is every quay-init --loop run (incl. cold-start-e2e in CI).
  if [ "$DRY_RUN" != true ] && [ -f "$PLUGIN_ROOT/scripts/verify-installed-executables.sh" ]; then
    bash "$PLUGIN_ROOT/scripts/verify-installed-executables.sh" "$PLUGIN_ROOT" "$WORKSPACE_ROOT"
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
