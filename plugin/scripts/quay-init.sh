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
#   --loop          two-layer loop mechanism (tick docs + checkers + gate + token + observation).
#                   ALSO lays --workflows (the loop execution cores reference .claude/workflows/* —
#                   fan-in-execute / execute-suite-fix / pool-quality-judge — so a loop without its
#                   workflows is a broken loop; AC91 gap-ac91-delivery-core-refs-undelivered-files)
#   --all           all of the above except --loop (matching the skill's historical default)
# NOTE (2026-08-05 retirement): the old gate-script category that copied the plugin's
# classic-pipeline era gates (it0-*/audit-*/drain-*/vmeta-lag) into <workspace>/scripts/gates/
# is RETIRED. Those gates were laid into every target project but nothing called them — dead
# weight shipped to every install. 分层退休（Layered retirement）: the files
# stay in the plugin tree, but no category lays them down and sync.sh no longer syncs them. The
# live fast-mode gate scripts ship via the --loop plugin/scripts/ landing.
# Flags:
#   --force         overwrite on conflict (backup the existing file first)
#   --dry-run       list what would happen, copy nothing
#   --manager       with --loop: ALSO lay the opt-in manager exec core
#                   (orchestration/manager-tick-core.md — gap-ac37-exec-core-ships-with-package).
#                   The typical path is two-layer (outer + inner), so the default --loop set does
#                   NOT include the manager core; --manager opts in.
# Read-only report modes (no category dispatch, no target writes):
#   --check-drift                  drift report over the derived laydown set (漂移/缺失/一致, L_D)
#   --check-dependency-closure     dependency-closure report over the derived laydown set
#                                  (dependency_closure_gaps: N; band 0 — 铺了消费者必然铺依赖)
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
# fork_baseline / merge_target / routines — the loop-driver + fast-mode keys). The upgrade must KEEP
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

# ── batched file-state precompute (gap-suite-serial-install-copy-one-subprocess-batching) ────────────
# copy_one / compute_drift_report used to spawn ONE `cmp -s` per file (plus one `sha256sum | cut` per
# managed file) — ~400 subprocess spawns per --loop run, the dominant wall-clock cost of the serial-
# install family (the 7 slow files run a real `quay init --loop` under concurrency-1 serial, so their
# wall-clock floor IS the per-file subprocess count). The two associative arrays below hold the result
# of ONE python3 pass over a <src>\t<dst> manifest:
#   _CMP_STATE[dst] ∈ missing|identical|differ   (byte comparison, replaces per-file `cmp -s`)
#   _DST_HASH[dst]  = sha256(dst) when present   (replaces per-managed-file `sha256sum | cut`)
# The copy_one decision logic and every output line are UNCHANGED — only the comparison primitive is
# swapped for an array lookup (AC2: byte-identical output). A dst whose state was NOT precomputed
# (e.g. a standalone copy_one caller outside a precompute window) falls back to the subprocess form,
# so a future caller stays correct, just unbatched.
declare -A _CMP_STATE=()
declare -A _DST_HASH=()

# _precompute_states <manifest> — ONE python3 pass over a <src>\t<dst> manifest (one pair per line),
# classifying each pair by in-memory byte comparison and hashing each present dst. Populates
# _CMP_STATE + _DST_HASH. Deterministic: output order = manifest order, so the caller feeds a
# manifest built in lay-down order and the copy_one lines stay byte-identical to the pre-batch form.
_precompute_states() {
  local manifest="$1" dst state hash
  _CMP_STATE=()
  _DST_HASH=()
  while IFS=$'\t' read -r dst state hash; do
    [ -n "$dst" ] || continue
    _CMP_STATE["$dst"]="$state"
    # `if` (not `&&`) so the loop body always ends exit-0 — under `set -e` a body ending on
    # `[ -n "$hash" ] && …` aborts the whole loop when the last row's hash is empty (missing).
    if [ -n "$hash" ]; then _DST_HASH["$dst"]="$hash"; fi
  done < <(python3 - "$manifest" <<'PYEOF'
import sys, os, hashlib
manifest = sys.argv[1]
pairs = []
with open(manifest, "r", encoding="utf-8") as f:
    for ln in f:
        ln = ln.rstrip("\n")
        if not ln or "\t" not in ln:
            continue
        src, dst = ln.split("\t", 1)
        pairs.append((src, dst))
for src, dst in pairs:
    if not os.path.isfile(dst):
        print("%s\tmissing\t" % dst)
        continue
    try:
        with open(src, "rb") as fh:
            sc = fh.read()
        with open(dst, "rb") as fh:
            dc = fh.read()
    except OSError:
        # Unreadable → treat as differ (the pre-batch `cmp -s` returned non-zero the same way).
        print("%s\tdiffer\t" % dst)
        continue
    state = "identical" if sc == dc else "differ"
    print("%s\t%s\t%s" % (dst, state, hashlib.sha256(dc).hexdigest()))
PYEOF
)
}

# _is_identical <src> <dst> — the batched replacement for `cmp -s "$src" "$dst"`. Consults the
# precomputed _CMP_STATE when present; falls back to `cmp -s` for a dst that was never precomputed.
_is_identical() {
  local src="$1" dst="$2" st
  st="${_CMP_STATE[$dst]:-}"
  case "$st" in
    identical) return 0 ;;
    differ) return 1 ;;
    missing) return 1 ;;
    *) cmp -s "$src" "$dst" ;;
  esac
}

# _dst_sha256 <dst> — the batched replacement for `sha256sum "$dst" | cut -d' ' -f1`. Consults the
# precomputed _DST_HASH when present; falls back to the two-subprocess form otherwise.
_dst_sha256() {
  local dst="$1" h
  h="${_DST_HASH[$dst]:-}"
  if [ -n "$h" ]; then
    printf '%s' "$h"
  else
    sha256sum "$dst" | cut -d' ' -f1
  fi
}

# _LAID_TOOK[rel]=1 — the set of workspace-rel paths whose lay-down TOOK EFFECT this round: the
# installer wrote the product (copied / clean-replaced / managed-replaced / --force overwritten) or
# found the disk already byte-identical to the product (skipped). write_state_file only recomputes
# laidFiles hashes for THIS set; every other path — the CONFLICT branches, where a user edit is
# PRESERVED and the installer wrote nothing — keeps the previous round's record, so a preserved edit
# is never mis-recorded as "laid" (gap-quay-init-write-state-file-corrupts-hash-after-conflict:
# unconditionally hashing current disk content made a preserved CONFLICT edit look stale-installed
# next round, and a zero-change 3rd run silently ate the edit without reporting CONFLICT).
declare -A _LAID_TOOK=()

# _record_laid_took <dst>: mark an absolute dst path's workspace-rel form as "took effect this round".
_record_laid_took() {
  local dst="$1"
  [ -n "$dst" ] || return
  _LAID_TOOK["${dst#"$WORKSPACE_ROOT"/}"]=1
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
  # ${dst##*/} is the bash builtin for basename (no subprocess) — same for ${dst%/*} (dirname).
  # All callers pass an absolute dst, so ${dst%/*} is always the parent dir (gap-quay-init-install-
  # wall-clock-slow: per-file basename/dirname subprocess spawns in the copy loop).
  fname="${dst##*/}"

  if [ ! -f "$dst" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  would-copy: $dst"
    else
      mkdir -p "${dst%/*}"
      cp "$src" "$dst"
      echo "  copied: $dst"
    fi
    COPIED=$((COPIED + 1))
    _record_laid_took "$dst"
  elif _is_identical "$src" "$dst"; then
    SKIPPED=$((SKIPPED + 1))
    _record_laid_took "$dst"
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
      mkdir -p "${dst%/*}"
      cp "$src" "$dst"
      echo "  cleaned-residue: $dst"
      echo "    backup: $backup_dir/$fname"
    fi
    COPIED=$((COPIED + 1))
    _record_laid_took "$dst"
  elif [ "$mode" = "managed" ]; then
    # Install-managed localizable file (config-driven install, SPEC AC5/AC6). A target that
    # still equals the previous install's recorded laid-down hash is stale product from an
    # OLDER plugin version → replaced. A target that differs from both the product and that
    # hash is a genuine user edit → CONFLICT, preserved (AC6 must still fire).
    local laid_hash cur_hash
    laid_hash="$(state_laid_hash "${dst#"$WORKSPACE_ROOT"/}")"
    cur_hash="$(_dst_sha256 "$dst")"
    if [ -n "$laid_hash" ] && [ "$laid_hash" = "$cur_hash" ]; then
      CLEANED=$((CLEANED + 1))
      if [ "$DRY_RUN" = true ]; then
        echo "  would-replace-stale-install: $dst (previous quay-init laid it verbatim; upgrade to the new product)"
      else
        local backup_dir="$WORKSPACE_ROOT/.quay/quay-init-backups/$BACKUP_TS"
        mkdir -p "$backup_dir"
        cp "$dst" "$backup_dir/$fname"
        mkdir -p "${dst%/*}"
        cp "$src" "$dst"
        echo "  replaced-stale-install: $dst"
        echo "    backup: $backup_dir/$fname"
      fi
      COPIED=$((COPIED + 1))
      _record_laid_took "$dst"
    elif [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  would-overwrite (conflict, --force): $dst"
      else
        mkdir -p "${dst%/*}"
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$src" "$dst"
        echo "  overwritten (backed up): $dst"
      fi
      COPIED=$((COPIED + 1))
      _record_laid_took "$dst"
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
        mkdir -p "${dst%/*}"
        cp "$dst" "$dst.bak.$(date +%s)"
        cp "$src" "$dst"
        echo "  overwritten (backed up): $dst"
      fi
      COPIED=$((COPIED + 1))
      _record_laid_took "$dst"
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
  if [ ! -d "$src_dir" ]; then
    echo "  (source directory missing — skipped category)"
    return
  fi
  # gap-verify-referenced-landed-concurrency-hardening-insufficient: the empty-source check must NOT
  # shell out to `ls -A` — under heavy concurrent load a `$(ls …)` command substitution can be killed
  # mid-stream (returning empty) and an EMPTY source is falsely reported for a NON-empty dir, skipping
  # the whole category (observed: .claude/workflows/* false-positived referenced-not-landed). The
  # `for f in "$src_dir"/*` glob is a bash builtin (no subprocess), so it cannot be torn — count the
  # files it actually iterates instead.
  local f found=0 manifest
  manifest="$(mktemp)"
  # First glob pass: build the (src,dst) manifest + detect emptiness. The glob stays a bash builtin
  # (no subprocess) so the empty-source check cannot be torn (same rationale as above); the per-file
  # `cmp -s` that copy_one used to spawn is then batched into ONE python3 pass (gap-suite-serial-
  # install-copy-one-subprocess-batching), so the copy loop below consults _CMP_STATE instead.
  for f in "$src_dir"/*; do
    [ -f "$f" ] || continue
    found=1
    printf '%s\t%s\n' "$f" "$dst_dir/${f##*/}" >> "$manifest"
  done
  if [ "$found" = 0 ]; then
    rm -f "$manifest"
    echo "  (source directory empty — skipped category)"
    return
  fi
  _precompute_states "$manifest"
  rm -f "$manifest"
  for f in "$src_dir"/*; do
    [ -f "$f" ] || continue
    copy_one "$f" "$dst_dir/${f##*/}"
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
# into the laid-down project-local runtime (.quay/runtime/bin/quay-native.js — the self-contained
# native provider bundle quay-init lays down alongside the Core bundle; see the AC7b lay-down below;
# the landing dir is .quay/runtime/, never vendor/ — gap-the-runtime-has-nowhere-safe-to-land). If a
# config already exists, the project owns it — just note the AC7b requirement
# (a future --force could patch it; not silently rewritten).
# ensure_loop_config: add/update the `loop:` section in an EXISTING `.quay/config.yml` with the
# four fast-mode target-project values (repo_root / test_command / tmux_session / worktree_root —
# SPEC AC2, the single config source for the loop). Laid-down scripts and tick docs READ these at
# runtime instead of having them baked in at install (SPEC AC3), so two installs of the same product
# are byte-identical except this config (AC4). A pre-existing config's other keys (providers,
# credentials) are preserved; only the loop section is added/updated. Used only when the config
# already exists — a config-less target gets the loop section from write_provider_config's heredoc
# (which preserves the inline `["node", ...]` mcp_entry the AC7b test pins). Uses python3 + yaml so
# the values are always valid YAML scalars regardless of their content.
# CONFIG-PRESERVING UPGRADE (gap-quay-init-config-preserving-incremental-upgrade, AC1): the loop
# section is MERGED, never replaced. `data["loop"] = {...}` (the pre-fix form) DESTROYED every
# non-fast-mode key the consumer owned — the loop-driver schema (board / gates / stop / policy) and
# the fast-mode schema's extras (concurrency_bands / fork_baseline / merge_target / routines) were
# silently dropped on upgrade. The fix updates ONLY the four fast-mode keys and leaves every other
# loop: key byte-for-byte intact (the consumer's loop values survive the upgrade unchanged).
ensure_loop_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated; 其余 loop 键保留 — config 保留 增量升级)"
    return
  fi
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$REPO_ROOT" "$TEST_COMMAND" "$TMUX_SESSION" "$WORKTREE_ROOT" <<'PYEOF'
import sys, yaml
cfg, repo, test, tmux, wtroot = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
with open(cfg, encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}
loop = data.get("loop")
if not isinstance(loop, dict):
    loop = {}
loop["repo_root"] = repo
loop["test_command"] = test
loop["tmux_session"] = tmux
loop["worktree_root"] = wtroot
data["loop"] = loop
with open(cfg, "w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
print(f"  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated; 其余 loop 键保留 — config 保留 增量升级)")
PYEOF
}

# migrate_stale_mcp_entry: upgrade-channel config migration (gap-dist-runtime-not-self-contained-
# reads-external-package-json AC4). A pre-existing .quay/config.yml from an OLD install can carry a
# provider `path` / `mcp_entry` that points at a path which does NOT exist in the target — the
# manager-verified case is a dev-tree source residual (`path: <ws>/bin`, `mcp_entry: .../bin/quay-
# native.ts`) left by an earlier install, which the AC3 referenced-existence verify would otherwise
# FAIL CLOSED on forever (the "config already exists is never rewritten" upgrade hole). quay-init
# lays the install-state provider (.quay/runtime/bin/quay-native.js + .quay/runtime/provider.yml)
# BEFORE write_provider_config runs, so a stale provider path is migrated to that install-state
# provider dir (bin/quay.ts uses `provider.path` as the provider spawn cwd — a nonexistent dir makes
# the spawn ENOENT) and a dangling reference to a QUAY runtime file is migrated to the install-state
# runtime bundle (config migration, not a blank rewrite — other keys are preserved). A config from
# an install that laid the runtime under the OLD vendor/ layout is migrated to .quay/runtime/ even
# when the stale vendor/ copy still exists (the layout moved — gap-the-runtime-has-nowhere-safe-to-
# land). SCOPE GUARD:
# only a `path` that is not a real directory AND only references whose basename is a quay runtime
# file (`quay-native.js/ts`, `quay.js/ts`) are migrated; an arbitrary dangling path (e.g.
# ./nonexistent/runtime.js) is left untouched so the landed vendor-runtime AC3 negative control
# (verify FAILS CLOSED on a dangling mcp_entry it cannot recognize) keeps its meaning.
migrate_stale_mcp_entry() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  local install_provider="${WORKSPACE_ROOT}/.quay/runtime"
  local install_runtime="${install_provider}/bin/quay-native.js"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-migrate: stale provider path/mcp_entry -> ${install_provider} (upgrade-channel config migration — AC4)"
    return
  fi
  if [ ! -f "$cfg" ]; then return; fi
  python3 - "$cfg" "$install_provider" "$install_runtime" "$WORKSPACE_ROOT" <<'PYEOF'
import sys, os, re, yaml
cfg, install_provider, install_runtime, ws_root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(cfg, encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}
prov = (data.get("providers") or {}).get("native")
if not isinstance(prov, dict):
    sys.exit(0)
# gap-the-runtime-has-nowhere-safe-to-land: reserved directory names that must never hold the quay
# runtime in a target (Go vendor/, npm node_modules/, cargo target/, make/build/, bundler dist/).
# The landing path check is by PATH LITERAL segment (task AC9), the same list here. An EXISTING
# install (pre-fix) laid the runtime into `<target>/vendor/quay[-native]/` — on upgrade that dir
# EXISTS, so the old `not os.path.isdir(p)` guard would never migrate it and the target would stay
# pointed at the Go-reserved directory forever. The upgrade path therefore migrates any provider
# path/mcp_entry that is (a) dangling, OR (b) a quay runtime path sitting under a reserved segment.
RESERVED = {"vendor", "node_modules", "target", "build", "dist"}
def under_reserved(p):
    parts = [seg for seg in str(p).split(os.sep) if seg]
    return any(seg in RESERVED for seg in parts)
def is_quay_runtime_dir(p):
    base = os.path.basename(str(p).rstrip(os.sep))
    return base in ("quay", "quay-native")
changed = False
# path: a stale provider dir is migrated to the install-state provider dir. "Stale" = the dir does
# not exist, OR it is a quay runtime dir sitting under a reserved segment (the pre-fix vendor/ land).
p = prov.get("path")
if isinstance(p, str) and p != install_provider and (not os.path.isdir(p) or (under_reserved(p) and is_quay_runtime_dir(p))):
    prov["path"] = install_provider
    changed = True
# mcp_entry: a dangling reference to a QUAY runtime file is migrated to the install-state runtime.
me = prov.get("mcp_entry")
legacy_native = os.path.join(ws_root, "vendor", "quay-native", "dist", "quay-native.js")
legacy_core = os.path.join(ws_root, "vendor", "quay", "dist", "quay.js")
if isinstance(me, list) and len(me) >= 2 and isinstance(me[1], str):
    ref = me[1]
    is_quay_runtime = re.match(r"^quay(-native)?\.(js|ts)$", os.path.basename(ref)) is not None
    # Scope guard (see header comment): only a dangling reference to a quay runtime file is migrated.
    if re.match(r"^quay(-native)?\.(js|ts)$", os.path.basename(ref)) and ref != install_runtime and (not os.path.exists(ref) or under_reserved(ref)):
        prov["mcp_entry"] = ["node", install_runtime, "mcp"] + (list(me[3:]) if len(me) > 3 else [])
        changed = True
    # Legacy layout migration (gap-the-runtime-has-nowhere-safe-to-land): a config from an
    # install that laid the runtime under vendor/ (the OLD layout — vendor/ is a Go reserved
    # dir and the 1.3MB bundles hit common large-file hooks) is moved to the .quay/runtime/
    # layout. Fires EVEN IF the legacy vendor/ file still exists — the layout moved, and the
    # config must not keep pinning the provider to the Go-reserved dir.
    elif is_quay_runtime and ref in (legacy_native, legacy_core):
        prov["mcp_entry"] = ["node", install_runtime, "mcp"] + (list(me[3:]) if len(me) > 3 else [])
        prov["path"] = install_provider
        changed = True
if not changed:
    sys.exit(0)
with open(cfg, "w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
print(f"  migrated: stale provider config -> {install_provider} (upgrade-channel config migration — AC4)")
PYEOF
}

# ensure_runtime_gitignore — gap-the-runtime-has-nowhere-safe-to-land AC10. The chosen
# mechanism is "the runtime does NOT go into the target's git" (it is install-generated
# product, never source, and a 1.3MB committed bundle trips common 500KB large-file hooks).
# quay-init therefore MUST write the .gitignore entry itself — an instruction to the user
# to add it would be exactly the manual patch G0 bans (人工补丁数必须为 0). Idempotent +
# non-destructive: if the target's .gitignore already carries the entry (or the whole
# .quay/ dir, which subsumes it), SKIP; else append (creating the file if needed). NEVER
# rewrites, reorders, or clobbers the target's other gitignore content (AC10 negative
# control: a pre-existing same-name entry → no duplicate write, no overwrite).
ensure_runtime_gitignore() {
  local gi="$WORKSPACE_ROOT/.gitignore"
  local entry=".quay/runtime/"
  if [ -f "$gi" ] && { grep -qxF "$entry" "$gi" || grep -qxF ".quay/" "$gi" || grep -qxF ".quay" "$gi"; }; then
    if [ "$DRY_RUN" = true ]; then
      echo "  would-skip: .gitignore already carries $entry"
    else
      echo "  skipped: .gitignore already carries $entry"
    fi
    return
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  would-append: $entry to .gitignore"
    return
  fi
  {
    printf '# quay runtime (install-generated, not source — gap-the-runtime-has-nowhere-safe-to-land)\n'
    printf '%s\n' "$entry"
  } >> "$gi"
  echo "  appended: $entry to .gitignore"
}

# backup_config — gap-quay-init-config-preserving-incremental-upgrade AC2 (config backup before
# upgrade). The --loop upgrade MODIFIES an existing consumer's `.quay/config.yml` (migrate_stale_
# mcp_entry + ensure_loop_config). Before ANY modification, the pre-upgrade config is backed up to
# the SAME per-run backup dir as the residue cleanup (<workspace>/.quay/quay-init-backups/<ts>/), so
# "backup 在哪" stays one line. Prints the backup path on stdout (empty when there was nothing to
# back up — a config-less fresh install has nothing to preserve).
backup_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ] || [ ! -f "$cfg" ]; then echo ""; return; fi
  local backup_dir="$WORKSPACE_ROOT/.quay/quay-init-backups/$BACKUP_TS"
  mkdir -p "$backup_dir"
  cp "$cfg" "$backup_dir/config.yml"
  echo "$backup_dir/config.yml"
}

# rollback_config_on_exit — gap-quay-init-config-preserving-incremental-upgrade AC2 (rollback config
# unchanged on failure). Wired as an EXIT trap while the upgrade's config write is armed; if the
# --loop run fails for ANY reason before the config is disarmed (a config write that aborts, a
# post-config verification that fails closed), the pre-upgrade config is restored from the backup —
# the consumer's config is byte-for-byte unchanged by a failed upgrade. Disarmed by clearing
# CONFIG_BACKUP once the config is in its final good state (a later auto-commit failure is a git
# failure, not a config failure — rolling back the config then would be wrong).
rollback_config_on_exit() {
  if [ -n "${CONFIG_BACKUP:-}" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp "$CONFIG_BACKUP" "$WORKSPACE_ROOT/.quay/config.yml"
    echo "  rolled back .quay/config.yml from backup (upgrade did not complete — config unchanged)" >&2
  fi
}

write_provider_config() {
  local cfg="$WORKSPACE_ROOT/.quay/config.yml"
  if [ "$DRY_RUN" = true ]; then
    echo "  would-write: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b)"
    return
  fi
  if [ -f "$cfg" ]; then
    echo "  note: .quay/config.yml already exists — keep the provider mcp_entry on project-local absolute paths, never a PATH-resolved quay-native (AC7b)"
    migrate_stale_mcp_entry
    ensure_loop_config
  else
    mkdir -p "$WORKSPACE_ROOT/.quay" "$WORKSPACE_ROOT/tasks"
    cat > "$cfg" <<EOF
# Generated by quay-init --loop (gap-cold-start-...-eight-steps AC7b).
# The provider mcp_entry uses ABSOLUTE project-local paths — never a PATH-resolved
# \`quay-native\` symlink into the quay dev tree. The native provider runtime
# (.quay/runtime/bin/quay-native.js) is the self-contained bundle quay-init lays down
# alongside the Core bundle (see the AC7b lay-down in quay-init.sh). The landing dir is
# .quay/runtime/ — quay's own namespace, NOT vendor/ (Go reserved), node_modules,
# target, build or dist (gap-the-runtime-has-nowhere-safe-to-land AC9) — and quay-init
# writes the .gitignore entry so the install-generated runtime is not committed (AC10).
providers:
  native:
    enabled: true
    path: "${WORKSPACE_ROOT}/.quay/runtime"
    tasks_dir: "${WORKSPACE_ROOT}/tasks"
    mcp_entry: ["node", "${WORKSPACE_ROOT}/.quay/runtime/bin/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "${WORKSPACE_ROOT}/tasks"
# Target-project loop values (gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them,
# SPEC AC2): the single config source for repo_root / test_command / tmux_session / worktree_root,
# plus the branch-model keys fork_baseline / merge_target (SPEC-branching-model current ruling:
# develop/integration are the working branches — defaults ship WITH quay-init, never hardcoded
# master, so a brand-new host's first quay-init --loop does not silently fall back to the retired
# master-only model). Scripts and tick docs read these at runtime instead of having them baked in
# at install (AC3).
loop:
  repo_root: ${REPO_ROOT}
  test_command: ${TEST_COMMAND}
  tmux_session: ${TMUX_SESSION}
  worktree_root: ${WORKTREE_ROOT}
  fork_baseline: develop
  merge_target: integration
EOF
    echo "  wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b; loop: repo_root/test_command/tmux_session/worktree_root/fork_baseline/merge_target — SPEC AC2 + SPEC-branching-model)"
  fi
}

# write_state_file: record what --loop laid down, for the upgrade path (AC5).
# gap-verify-delivery-surface-checks-source-layout-not-consumer-laid (追加两半 #3): the record must
# match the DELIVERY, not a hand-picked 2 tick docs. archguard found laidFiles hardcoded only
# ["orchestration/orchestrator-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md"] and
# laidCategories only {"loop"} — while the lay-down actually ships scripts/probes/
# runtime/config/workflows/agents. Fix: enumerate EVERY root-relative path quay-init owns/lays,
# sha256 each existing file, and derive the category list from the laid roots.
write_state_file() {
  if [ "$DRY_RUN" = true ]; then return; fi
  if [ ! -d "$WORKSPACE_ROOT/.quay" ]; then
    # A workspace without .quay/ still gets the state record in a sibling location.
    mkdir -p "$WORKSPACE_ROOT/.quay"
  fi
  local laid_rel_file took_rel_file root f rel
  laid_rel_file="$(mktemp)"
  : > "$laid_rel_file"
  took_rel_file="$(mktemp)"
  : > "$took_rel_file"
  # The paths whose lay-down TOOK EFFECT this round (copy_one's _record_laid_took). write_state_file
  # only recomputes laidFiles hashes for THIS set; every other path keeps the previous round's record
  # (gap-quay-init-write-state-file-corrupts-hash-after-conflict — a CONFLICT-preserved user edit must
  # NOT be re-hashed into laidFiles, or a zero-change next run mis-reads it as stale-installed).
  for rel in "${!_LAID_TOOK[@]}"; do
    printf '%s\n' "$rel" >> "$took_rel_file"
  done
  # Every root-relative path quay-init --loop lays/owns. Files listed directly; dirs expand to all
  # files under them (sorted). .quay/quay-init-state.json is included so the record self-tracks.
  for root in \
    "plugin/scripts" "plugin/probes" "orchestration" "docs/analysis" \
    ".quay/config.yml" ".quay/profiles.yml" ".quay/quay-init-state.json" ".quay/runtime" \
    ".claude/workflows" ".claude/agents" ".claude/launch.settings.json"; do
    if [ -f "$WORKSPACE_ROOT/$root" ]; then
      printf '%s\n' "$root" >> "$laid_rel_file"
    elif [ -d "$WORKSPACE_ROOT/$root" ]; then
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        printf '%s\n' "${f#"$WORKSPACE_ROOT"/}" >> "$laid_rel_file"
      done < <(find "$WORKSPACE_ROOT/$root" -type f | sort)
    fi
  done
  python3 - "$PLUGIN_VERSION" "$WORKSPACE_ROOT/.quay/quay-init-state.json" "$WORKSPACE_ROOT" "$laid_rel_file" "$took_rel_file" <<'PYEOF'
import json, os, sys, time, hashlib
version, path, workspace_root, rel_file, took_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
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
with open(rel_file, encoding="utf-8") as f:
    rels = [line.strip() for line in f if line.strip()]
with open(took_file, encoding="utf-8") as f:
    took = {line.strip() for line in f if line.strip()}
# laidCategories: derive from the laid roots (stable tokens, not just {"loop"}).
cats = set(state.get("laidCategories", []))
if any(r.startswith("plugin/scripts") for r in rels): cats.add("scripts")
if any(r.startswith("plugin/probes") for r in rels): cats.add("probes")
if any(r.startswith("orchestration") or r.startswith("docs/analysis") for r in rels): cats.add("loop")
if any(r.startswith(".quay/runtime") for r in rels): cats.add("runtime")
if any(r.startswith(".claude/workflows") for r in rels): cats.add("workflows")
if any(r.startswith(".claude/agents") for r in rels): cats.add("agents")
state["laidCategories"] = sorted(cats)
# laidFiles: sha256 of each install-managed product file's CURRENT content — the upgrade path's
# record of "what quay-init laid down". A file that on a later run still equals this hash is stale
# install-managed content from an OLDER plugin version (replaced, AC5); a file that differs from
# BOTH this hash and the new product is a genuine user edit (CONFLICT, AC6). The config-driven
# install makes this distinction possible: every laid-down file is byte-identical to the product,
# so the ONLY reason a managed file can differ on upgrade is either a stale previous install or a
# user edit — and the hash tells them apart.
# gap-quay-init-write-state-file-corrupts-hash-after-conflict: only recompute the hash for a path
# whose lay-down TOOK EFFECT this round (copy_one wrote the product, or found it already identical).
# Every other path keeps the previous round's record UNCHANGED — a CONFLICT branch preserved a user
# edit (the installer wrote nothing), and re-hashing that edit into laidFiles would make the next
# zero-change run mis-read it as a stale install and silently overwrite it without reporting CONFLICT.
prev_laid = state.get("laidFiles", {})
laid = {}
for rel in rels:
    if rel in took:
        p = os.path.join(workspace_root, rel)
        if os.path.isfile(p):
            with open(p, "rb") as f:
                laid[rel] = hashlib.sha256(f.read()).hexdigest()
        # a took path that is no longer a file is dropped (the copy wrote it, so this is unexpected)
    elif rel in prev_laid:
        # Not written this round (CONFLICT-preserved user edit, or a skipped product that was
        # already recorded) → keep the previous record byte-for-byte.
        laid[rel] = prev_laid[rel]
    # else: not written this round AND no prior record → leave out (honest "unknown", never hashing
    # a pre-existing file the installer did not lay down).
state["laidFiles"] = laid
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
print(f"  state: .quay/quay-init-state.json pluginVersion={version} previous={prev or 'none'} laidFiles={len(laid)} laidCategories={','.join(sorted(cats))}")
PYEOF
  rm -f "$laid_rel_file" "$took_rel_file"
}

# write_session_env: generate/update orchestration/session-liveness.env with the per-project
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
    printf '# Generated by quay-init --loop: per-project session config.\n' > "$tmp"
    printf '# SESSION_TMUX_SESSION sets the default-target session (read by the session topology scripts).\n' >> "$tmp"
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
  printf '%s\n' inner-idle-log.ts it0-split-or-commit-check.ts pipe-exit-code-check.sh \
    gate-script-base.ts workflow-event-schema.mjs task-schema.ts touches-parser.ts task-status.ts wiring-coverage-check.ts \
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

# ── drift report (gap-delivery-surface-grows-but-target-freezes-no-upgrade) ─────────────────────────
# --check-drift: the L2 "upgrade correctness" drift report. The delivery surface (the DERIVED loop
# script set) GROWS as the plugin ships new mechanism scripts; a target project installed at time T
# is frozen at T and never receives scripts added after T (the meta-cc measurement: 7 of the 8
# missing derived scripts were built after 08-03 — drift is the surface growing, not a misinstall).
# This report mechanically compares the CURRENT derived set (derive_loop_scripts — the SAME
# derivation the --loop lay-down uses) against the target's plugin/scripts/:
#   一致  — present in target AND byte-identical to the plugin source
#   漂移  — present but content differs (a local edit or a stale install) — listed, never silently
#           overwritten: the upgrade path (--loop re-run) backs it up + reports before replacing
#   缺失  — absent from the target — the upgrade path auto-fills it (copy_one's `! -f` branch)
# Prints per-item lines for 漂移/缺失 + a parseable summary `漂移 N / 缺失 N / 一致 N`.
# Read-only: never modifies the target. Exit 0 always (a report, not a gate).
drift_report() {
  local drift=0 missing=0 consistent=0 total=0 s src dst
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    src="$PLUGIN_ROOT/scripts/$s"
    [ -f "$src" ] || continue   # only the CURRENT derived set that actually exists in the plugin
    total=$((total + 1))
    dst="$WORKSPACE_ROOT/plugin/scripts/$s"
    if [ ! -f "$dst" ]; then
      missing=$((missing + 1))
      echo "  缺失: $s"
    elif cmp -s "$src" "$dst"; then
      consistent=$((consistent + 1))
    else
      drift=$((drift + 1))
      echo "  漂移: $s"
    fi
  done < <(derive_loop_scripts)
  echo "漂移报告: 漂移 ${drift} / 缺失 ${missing} / 一致 ${consistent}（派生集 ${total}）"
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

# ── categories ─────────────────────────────────────────────────────────────────────────────────────
echo "quay-init (plugin v${PLUGIN_VERSION})"

# ── --check-drift (gap-delivery-surface-grows-but-target-freezes-no-upgrade) ────────────────────────
# The L2 "upgrade correctness" drift report (Contract measure: the 漂移/缺失/一致 numbers on stdout).
# Read-only — never writes to the target; exit 0 always (a report, not a gate). Runs the SAME
# derived-set derivation the --loop lay-down uses, so the denominator is the CURRENT delivery
# surface, not a frozen snapshot.
if [ "$DO_CHECK_DRIFT" = true ]; then
  echo "  drift report (派生集轴, not file count — the delivery surface GROWS, the target must follow):"
  drift_report
  exit 0
fi

# Per-category counters via deltas on the global COPIED/SKIPPED/CONFLICTED.
record_category() {
  local label="$1" base_copied="$2" base_skipped="$3" base_conflicted="$4"
  echo "  $label: copied=$((COPIED - base_copied)) skipped=$((SKIPPED - base_skipped)) conflicted=$((CONFLICTED - base_conflicted))"
}

# ── pre-existing uncommitted changes snapshot (gap-quay-init-never-commits-broken-committed-state) ──
# Captured BEFORE any category lays files down: the consumer repo's uncommitted working-tree delta
# (vs HEAD) that quay-init did NOT produce. AC3: quay-init must never silently sweep these into its
# auto-commit — it stages ONLY its own laid-down paths, and it prompts when these exist. Empty when
# the workspace is not a git repo (auto-commit is then a no-op) or the tree is clean.
PRE_EXISTING_CHANGES=""
if [ "$DRY_RUN" != true ] && git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PRE_EXISTING_CHANGES="$(git -C "$WORKSPACE_ROOT" status --porcelain 2>/dev/null || true)"
fi

# auto_commit_laid_down — gap-quay-init-never-commits-broken-committed-state AC1/AC2/AC3.
# quay-init 铺文件但从不 commit ⇒ consumer 仓库的机制默认活在未提交工作树里，committed 态是否自洽纯属
# 运气（archguard 实测：提交了 ready-pool-check 却没提交它的三个 helper ⇒ fresh-clone broken）。
# 铺完机制后自动 commit（固定 `chore(quay-init):` 前缀）⇒ committed 态自洽、git log 直接回答「装的是
# 哪一版机制」（补齐交付契约 铺设→版本→提交→升级 的「提交」环）。
#   AC1/AC2 — 自动提交：non-git 工作区跳过（没有 commit 的目标）；工作树无变化跳过；否则 stage 本机件
#              铺设的路径并 `git commit`。
#   AC3 — 已有未提交改动时 不静默覆盖：检测（PRE_EXISTING_CHANGES）+ 提示 + 待确认。默认只在 TTY 上
#         交互确认；非交互（脚本/测试/CI）没有显式 --auto-commit-confirm 时 fail-closed 不提交（提示后
#         退出 0——安装本身成功了，只是 delivery 的提交环节被用户/调用方搁置）。提交只 stage 本机件铺设
#         的路径（.gitignore / .quay/config.yml / .quay/quay-init-state.json / plugin/scripts /
#         orchestration / docs/analysis / .claude/{workflows,agents} / tasks），绝不 `git add -A` ——
#         使用者的未提交改动留在工作树里，不被卷进 quay-init 的提交。
# `.quay/runtime/`（安装产物 bundle，AC10）已由 ensure_runtime_gitignore 写进 .gitignore，不在提交面。
auto_commit_laid_down() {
  local changes p n
  if ! git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "  auto-commit: SKIP (not a git repository — the laid-down files are not committed; init a repo or commit manually)"
    return 0
  fi
  changes="$(git -C "$WORKSPACE_ROOT" status --porcelain 2>/dev/null || true)"
  if [ -z "$changes" ]; then
    echo "  auto-commit: nothing to commit (working tree clean)"
    return 0
  fi
  local do_commit=1
  if [ -n "$PRE_EXISTING_CHANGES" ]; then
    echo "  auto-commit: WARNING — the consumer repo already had uncommitted change(s) BEFORE quay-init ran; they are NOT silently swept into the commit:" >&2
    printf '%s\n' "$PRE_EXISTING_CHANGES" | sed 's/^/    /' >&2
    echo "  auto-commit will stage ONLY quay-init's laid-down paths; the pre-existing change(s) stay uncommitted." >&2
    case "$AUTO_COMMIT_CONFIRM" in
      yes) do_commit=1 ;;
      no)  do_commit=0 ;;
      *)
        if [ -t 0 ]; then
          local resp=""
          read -r -p "  Proceed with auto-commit? (only quay-init's laid-down files are staged; pre-existing changes stay uncommitted) [y/N] " resp
          case "$resp" in
            [yY]|[yY][eE][sS]) do_commit=1 ;;
            *) do_commit=0 ;;
          esac
        else
          echo "  auto-commit: DECLINED (non-interactive — pass --auto-commit-confirm to commit, or --auto-commit-skip to skip). Laid-down files remain uncommitted." >&2
          do_commit=0
        fi
        ;;
    esac
  fi
  if [ "$do_commit" = 0 ]; then
    echo "  auto-commit: skipped as chosen — the laid-down files remain uncommitted in the working tree" >&2
    return 0
  fi
  # Stage ONLY the paths quay-init owns/lays down (never `git add -A` when the repo may carry
  # unrelated uncommitted work — AC3). Missing paths are skipped; gitignored runtime bundles never
  # reach the stage. Runs in a subshell at the workspace root so the literal `git add` / `git commit`
  # (the Contract invoke's surface) are the real operations, not prose.
  for p in .gitignore .quay/config.yml .quay/profiles.yml .quay/quay-init-state.json plugin/scripts orchestration docs/analysis .claude/workflows .claude/agents .claude/launch.settings.json tasks; do
    if [ -e "$WORKSPACE_ROOT/$p" ]; then
      ( cd "$WORKSPACE_ROOT" && git add -- "$p" ) 2>/dev/null || true
    fi
  done
  if [ -z "$(git -C "$WORKSPACE_ROOT" diff --cached --name-only 2>/dev/null || true)" ]; then
    echo "  auto-commit: nothing staged (all laid-down files are gitignored or already committed)"
    return 0
  fi
  n="$(git -C "$WORKSPACE_ROOT" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
  # gap-precommit-guard-wire-into-quay-init-and-cold-start (回归修正, 2026-08-13): quay-init's OWN
  # auto-commit must not be blocked by the pre-commit guard it just provisioned. The guard FAILS-LOUD
  # on a missing .quay/full-suite-state.json (AC2 of the guard task: 参照系缺失时谓词必须崩) — and a
  # FRESH project (never had a round) has NO state file. This is the documented override case:
  # QUAY_ALLOW_DIRTY_ROUND=1 IS the "确认这是刻意维护缺口" escape hatch, and auto-commit is a
  # PROVISIONING step (lays down quay-init's own paths — the delivery commit), NOT an in-round dirty
  # write by a round participant. The override is scoped to THIS commit only (env form — the ONLY
  # channel a pre-commit hook receives; the guard records it as allow-dirty-round-override). It does
  # NOT weaken the guard for any other commit — a real running-round assertion-surface commit (the
  # AC4 case, the main checkout's actual round) still rejects.
  if ( cd "$WORKSPACE_ROOT" && QUAY_ALLOW_DIRTY_ROUND=1 git commit -q -m "chore(quay-init): lay down quay plugin mechanism files (v${PLUGIN_VERSION})" ); then
    echo "  auto-commit: committed ${n} file(s) as chore(quay-init) (plugin v${PLUGIN_VERSION})"
  else
    echo "ERROR: auto-commit failed (git commit returned non-zero). The laydown is complete but the delivery contract's 提交 环节 was not met." >&2
    echo "       Configure the repo's git identity (user.name/user.email), then re-run quay-init (idempotent) to commit." >&2
    exit 2
  fi
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
    # Config-preserving upgrade (gap-quay-init-config-preserving-incremental-upgrade AC1): an
    # existing consumer's recorded loop.test_command is KEPT — never re-detected/re-derived. An
    # explicit --test-command on the upgrade command line overrides it.
    TEST_COMMAND="$(read_existing_loop_value test_command)"
    if [ -n "$TEST_COMMAND" ]; then
      echo "  using existing config loop.test_command: $TEST_COMMAND (config-preserving upgrade — explicit --test-command overrides)"
    fi
  else
    echo "  using explicit --test-command: $TEST_COMMAND"
  fi
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
  fi

  # AC1/AC2/AC3 (gap-init-guesses-the-tmux-session): the target project's tmux session is
  # DETECTED, not guessed. An explicit --tmux-session always wins; otherwise tmux list-sessions
  # is matched by project name: a UNIQUE match is used (printed for the human to confirm), a
  # MULTIPLE match requires explicit --tmux-session (never pick one), and a ZERO match FAILS
  # CLOSED (AC2) — the old "<project>-0:0.0" default only worked for the project it was written
  # for, and a monitor aimed at a nonexistent session reports a LIVE inner as GONE (the
  # false-negative this task exists to kill). Never write a guessed value into the monitor config.
  if [ -z "$TMUX_SESSION" ]; then
    # Config-preserving upgrade (gap-quay-init-config-preserving-incremental-upgrade AC1): an
    # existing consumer's recorded loop.tmux_session is KEPT — the upgrade must not re-detect (and
    # possibly fail closed on) a session that is not running RIGHT NOW. An explicit --tmux-session
    # on the upgrade command line overrides it.
    TMUX_SESSION="$(read_existing_loop_value tmux_session)"
    if [ -n "$TMUX_SESSION" ]; then
      echo "  using existing config loop.tmux_session: $TMUX_SESSION (config-preserving upgrade — explicit --tmux-session overrides)"
    fi
  else
    echo "  using explicit --tmux-session: $TMUX_SESSION"
  fi
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

  # Config-preserving upgrade (gap-quay-init-config-preserving-incremental-upgrade AC2): back up the
  # consumer's .quay/config.yml BEFORE the upgrade modifies it, and arm the EXIT-trap rollback so a
  # failed upgrade restores the config byte-for-byte unchanged. Disarmed below once the config is in
  # its final good state (after the post-laydown verifications). A config-less fresh install gets an
  # empty CONFIG_BACKUP → the trap is a no-op → AC3 (fresh install path unaffected) holds.
  CONFIG_BACKUP="$(backup_config)"
  if [ -n "$CONFIG_BACKUP" ]; then
    trap rollback_config_on_exit EXIT
  fi

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
  # (the observer mechanism was retired 2026-09-03; its env config was the session config).
  # gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure: the laydown set
  # is DERIVED from the shipped mechanism docs' OWN references at BOTH spellings (path-prefixed AND
  # bare filename) PLUS the laid-down scripts' TRANSITIVE SIBLING DEPENDENCIES — so the mechanism
  # is functional and reference-spelling-independent (see derive_loop_scripts above; the old
  # hand-written explicit list now lives in derive_loop_scripts' source-(c) additions).
  # shellcheck disable=SC2207
  LOOP_SCRIPTS=()
  while IFS= read -r s; do LOOP_SCRIPTS+=("$s"); done < <(derive_loop_scripts)

  # AC1/AC2 (gap-delivery-surface-grows-but-target-freezes-no-upgrade): the upgrade/refresh path's
  # drift report. BEFORE the update, classify the target's derived scripts (漂移/缺失/一致 on the
  # derived-set axis) so the upgrade action below is preceded by the L2 "升级正确性" diagnosis —
  # exactly what the frozen-at-install-time target needs: what it is missing (auto-added) and what
  # has drifted (backed up + replaced, never silent). LOOP_SCRIPTS is populated above so the
  # before-report's derived-set is non-empty (compute_drift_report reads the global — a stale
  # empty-array call reported derived-set 0 and the before/after reports disagreed with reality).
  # The POST report after the loop proves the upgrade brought the derived set to 一致.
  # gap-suite-serial-install-copy-one-subprocess-batching: build ONE (src,dst) manifest for the
  # loop-scripts lay-down and precompute the PRE-COPY byte-comparison state in a single python3 pass.
  # This one pass feeds BOTH the before-drift report and the copy loop's copy_one decisions (which,
  # like the pre-batch per-file `cmp -s`, see the target as it was BEFORE any copy). The manager-
  # tick-core opt-in skip mirrors the copy loop below so the two never disagree on the pair set.
  _laydown_manifest="$(mktemp)"
  for s in "${LOOP_SCRIPTS[@]}"; do
    if [ -f "$PLUGIN_ROOT/scripts/$s" ]; then
      printf '%s\t%s\n' "$PLUGIN_ROOT/scripts/$s" "$WORKSPACE_ROOT/plugin/scripts/$s" >> "$_laydown_manifest"
    elif [ -f "$PLUGIN_ROOT/loop/$s" ]; then
      [ "$s" = "manager-tick-core.md" ] && [ "$DO_MANAGER" != true ] && continue
      printf '%s\t%s\n' "$(resolve_tick_core_src "$s")" "$WORKSPACE_ROOT/orchestration/$s" >> "$_laydown_manifest"
    fi
  done
  _precompute_states "$_laydown_manifest"

  echo "  drift report (before upgrade):"
  compute_drift_report "$WORKSPACE_ROOT"
  for s in "${LOOP_SCRIPTS[@]}"; do
    if [ -f "$PLUGIN_ROOT/scripts/$s" ]; then
      # mode "clean": a stale same-name target is RESIDUE (AC4) — backed up + replaced, never
      # silently skipped. Mechanism executables must be current (verify-installed-executables.sh
      # fails closed on any drift, so a leftover stale copy would otherwise abort the install).
      copy_one "$PLUGIN_ROOT/scripts/$s" "$WORKSPACE_ROOT/plugin/scripts/$s" clean
    elif [ -f "$PLUGIN_ROOT/loop/$s" ]; then
      # exec-core tick doc (gap-ac37-exec-core-ships-with-package): the ≤80-line execution cores
      # lay VERBATIM to orchestration/ (the path the shipped tick templates reference) in "managed"
      # mode, like the other tick docs. manager-tick-core.md is OPT-IN (--manager): laid only when
      # requested, but still reported here so the operator knows it is available.
      if [ "$s" = "manager-tick-core.md" ] && [ "$DO_MANAGER" != true ]; then
        echo "  skip (opt-in): orchestration/$s — manager exec core requires --manager"
        continue
      fi
      # resolve_tick_core_src: a pointerized shipped core (plugin/loop/manager-tick-core.md is a
      # one-line pointer to orchestration/ 正本) lays down the REAL core — byte-identical to 正本,
      # cold-start readable — never the pointer line (gap-quay-init-real-install-regression-fix ②).
      copy_one "$(resolve_tick_core_src "$s")" "$WORKSPACE_ROOT/orchestration/$s" managed
    else
      echo "  WARN: loop mechanism file missing from plugin: plugin/scripts/$s (or plugin/loop/$s)" >&2
    fi
  done
  # Re-precompute AFTER the copies: the after-drift report must see the UPDATED targets the copy
  # loop just wrote, not the stale pre-copy state (the copy loop laid byte-identical content, so
  # the after-report proves 漂移→一致 — the same semantics as the pre-batch per-file cmp re-scan).
  _precompute_states "$_laydown_manifest"
  rm -f "$_laydown_manifest"
  echo "  drift report (after upgrade):"
  compute_drift_report "$WORKSPACE_ROOT"

  # Probes (routine-track probe specs — DIR-056) → <workspace>/plugin/probes/.
  # AC3 (gap-delivery-outline-vs-verify-surface-single-source): probes are a DELIVERABLE
  # (human ruling 2026-08-06) but quay-init never laid them down (grep 0) — a cold-started
  # target had no probe specs on disk for the routine track's readProbeSpec("<probe>", pluginRoot)
  # to resolve against the target's own plugin/ tree (self-contained runtime, same as the laid
  # plugin/scripts/). Lay them VERBATIM — product-owned .md, mode "clean" (a stale same-name
  # target is residue, backed up + replaced like the mechanism executables).
  if [ -d "$PLUGIN_ROOT/probes" ]; then
    mkdir -p "$WORKSPACE_ROOT/plugin/probes"
    for pprobe in "$PLUGIN_ROOT"/probes/*; do
      [ -f "$pprobe" ] || continue
      copy_one "$pprobe" "$WORKSPACE_ROOT/plugin/probes/${pprobe##*/}" clean
    done
    echo "  probes: copied from plugin/probes/ (routine-track probe specs — DIR-056)"
  else
    echo "  WARN: probe specs missing from plugin: $PLUGIN_ROOT/probes" >&2
  fi

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

  # Per-project session config (SESSION_TMUX_SESSION): written to orchestration/session-liveness.env
  # so the session topology/check scripts (quay-topology.sh / topology-check.sh / session-bootstrap.sh)
  # resolve the real session name without a guessed default. The observer that previously consumed
  # this config was retired 2026-09-03; the session-name config itself is still needed by topology.
  write_session_env

  # Launch config (gap-quay-init-coldstart-usability-launch-not-used-... F4/AC2): the checked-in
  # per-role launch command lives in <target>/.claude/launch.settings.json (Claude Code 认识的键
  # $schema/permissions/env) + <target>/.quay/profiles.yml（AC154 profile 抽层后 launcher/model/--bare/
  # -n/unset + flag-only 参数的承载），materialized by quay-launch.sh — but quay-init NEVER laid it
  # down, so a cold-started third-party target had a laid-down quay-launch.sh that FAILED CLOSED
  # ("launch settings file not found") and consumers hand-started sessions without --settings /
  # without the role-convention name (measured 2026-08-11 on ad-arm1 archguard). Lay the DEFAULT
  # template verbatim; the consumer edits model/env per project (the launcher reads it at runtime —
  # no bake-in). mode "managed" (like tick docs): a target that still equals the previous install's
  # laid-down hash is stale install → replaced on upgrade; a genuine user edit differs from both
  # product and hash → CONFLICT, preserved (never a silent overwrite of a customized launch config).
  ls_src="$PLUGIN_ROOT/.claude/launch.settings.json"
  ls_dst="$WORKSPACE_ROOT/.claude/launch.settings.json"
  if [ ! -f "$ls_src" ]; then
    echo "  WARN: launch settings template missing from plugin: $ls_src" >&2
  else
    copy_one "$ls_src" "$ls_dst" managed
    echo "  launch-config: laid down .claude/launch.settings.json (default template — edit model/env per project; quay-launch.sh materializes it)"
  fi
  # profiles.yml 同源铺设（AC154）：profile/roles/flags 承载；缺 plugin 模板则警告、不影响已铺设的 settings。
  pf_src="$PLUGIN_ROOT/.quay/profiles.yml"
  pf_dst="$WORKSPACE_ROOT/.quay/profiles.yml"
  if [ ! -f "$pf_src" ]; then
    echo "  WARN: profiles template missing from plugin: $pf_src" >&2
  else
    copy_one "$pf_src" "$pf_dst" managed
    echo "  launch-config: laid down .quay/profiles.yml (default profile carrier — edit launcher/model per project)"
  fi

  # AC7b (gap-cold-start-...-eight-steps) + gap-vendor-runtime-not-in-git-clone-broken-mcp-entry
  # (AC1/AC2): lay the runtime INTO the target. The target's loop must NOT depend on the quay dev
  # tree through PATH symlinks (quay-native → /home/yale/work/quay/packages/quay-native/dist/). The
  # built Core runtime (plugin/vendor/quay/dist/quay.js) AND the built native provider runtime
  # (plugin/vendor/quay-native/dist/quay-native.js + provider.yml — the self-contained provider
  # bundle, gap-ac3b-prove-installed-quay-runs-without-dev-tree) are copied into the target so the
  # target's .quay/config.yml can point its provider mcp_entry at a PROJECT-LOCAL copy of the
  # provider runtime (an absolute path into .quay/runtime/, never a bare `quay-native` that
  # PATH-resolves to a dev tree). The two laid-down files must stay together: the bundle resolves
  # provider.yml relative to its own location (so the bundle sits in `.quay/runtime/bin/` and
  # provider.yml in `.quay/runtime/` — one level up, exactly the `../provider.yml` contract). The
  # runtimes are GENERATED artifacts (gitignored dist/ — M172), so a fresh
  # plugin clone has none: ensure_vendor_runtime AUTO-BUILDS them via sync-vendor.sh (AC2) or FAILS
  # CLOSED (AC1) — never a WARN-and-complete with a broken mcp_entry. After it returns, both bundles
  # are guaranteed present, so the lay-down is unconditional.
  ensure_vendor_runtime
  # gap-the-runtime-has-nowhere-safe-to-land: the runtime lands in .quay/runtime/ — quay's
  # own namespace — NOT vendor/ (a Go reserved dir whose mere presence flips a Go module
  # with dependencies into vendor mode → "inconsistent vendoring" build failure) and NOT
  # node_modules / target / build / dist (other language conventions, AC9). The bundle's
  # internal `bin/` subdir keeps the native provider's `../provider.yml` resolution intact.
  # ensure_runtime_gitignore then writes the .gitignore entry so the 1.3MB install-generated
  # bundles are never committed (AC10) — the target's commit stays under any large-file hook.
  copy_one "$PLUGIN_ROOT/vendor/quay/dist/quay.js" "$WORKSPACE_ROOT/.quay/runtime/bin/quay.js" clean
  copy_one "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" "$WORKSPACE_ROOT/.quay/runtime/bin/quay-native.js" clean
  copy_one "$PLUGIN_ROOT/vendor/quay-native/provider.yml" "$WORKSPACE_ROOT/.quay/runtime/provider.yml" clean
  ensure_runtime_gitignore
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
    # AC3 (gap-vendor-runtime-not-in-git-clone-broken-mcp-entry): verify_referenced_landed checks
    # the LANDING SET; this second check verifies the provider config's mcp_entry references a
    # runtime that ACTUALLY EXISTS in the target — the referenced-not-landed complement. Defense in
    # depth after AC1's fail-closed (a config that already exists still gets checked every run).
    verify_provider_runtime_existence "$WORKSPACE_ROOT" "$PLUGIN_ROOT" || exit 2
    # gap-complete-delivery-surface-spec-and-l1-verification (AC2): the SIX-category L1
    # delivery-completeness check. verify_referenced_landed above covers category 1 (mechanisms/
    # runtime: referenced ⊆ landed); this extends the L1 surface to ALL SIX categories — each
    # category's deliverables present + owning gap task filed (SPEC §6 machine-readable list is the
    # single source). Runs post-laydown against the SHIPPED delivery surface (the quay checkout
    # root — the SPEC lives at <repo>/orchestration/, outside the plugin bundle), fail-closed on any
    # uncovered category. In a BARE plugin copy (hermetic tests) the repo-level SPEC is absent →
    # SKIP (referenced⊆landed still guards the mechanism axis).
    l1_script="$PLUGIN_ROOT/scripts/l1-delivery-surface-check.ts"
    delivery_root="$(cd "$(dirname "$PLUGIN_ROOT")" && pwd)"
    spec_file="$delivery_root/orchestration/SPEC-complete-delivery-surface-2026-08-05.md"
    if [ -f "$l1_script" ] && [ -f "$spec_file" ]; then
      if node --no-warnings --experimental-strip-types "$l1_script" --surface --root "$delivery_root" --spec "$spec_file"; then
        : # six-category delivery surface complete — the OK line is on the check's stdout
      else
        echo "ERROR: delivery-surface L1 check failed — the six-category delivery surface is incomplete." >&2
        exit 2
      fi
    elif [ -f "$l1_script" ]; then
      echo "  delivery-surface-l1: SKIP (repo-level SPEC not found at $spec_file — bare plugin copy; referenced⊆landed still guards the mechanism axis)"
    fi
  fi

  # Config-preserving upgrade (AC2): the config is now in its final good state — DISARM the
  # rollback. A later auto-commit failure is a git failure, not a config failure; rolling back the
  # config then would discard a valid upgrade.
  CONFIG_BACKUP=""
  trap - EXIT
fi

# gap-quay-init-never-commits-broken-committed-state AC1/AC2/AC3: after ANY real laydown category,
# auto-commit the laid-down mechanism files (chore(quay-init): prefix) so the consumer repo's
# committed state is self-consistent (fresh-clone + quay-init ⇒ 机制完整, no broken committed state).
# Never in --dry-run (nothing was written); the read-only report modes (--check-drift /
# --check-dependency-closure) already exited above.
if [ "$DRY_RUN" = true ]; then
  echo "  auto-commit: SKIP (--dry-run — nothing was written, nothing to commit)"
else
  auto_commit_laid_down
fi

# ── pre-commit guard hook (gap-precommit-guard-wire-into-quay-init-and-cold-start AC1) ────────────────
# The pre-commit guard (plugin/scripts/precommit-guard.ts, laid down by --loop above) is only ACTIVE
# when the hook is installed — "built ≠ active" is the exact gap this wiring closes. The hook is
# CLONE-LOCAL (.git/hooks/pre-commit): provisioning the guard here means the guard runs for every
# subsequent commit in THIS clone (provisioned = active). It is installed AFTER the auto-commit —
# a fresh target has no .quay/full-suite-state.json yet, and the guard FAILS-LOUD on a missing state
# file (AC2 of the guard task: 参照系缺失时谓词必须崩), which would block quay-init's OWN delivery
# commit. Order: lay down → auto-commit → install hook ⇒ the auto-commit is not blocked and every
# later commit is guarded. Non-git targets skip (no commit surface); --dry-run skips (nothing written).
if [ "$DO_LOOP" = true ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "  pre-commit guard hook: SKIP (--dry-run — nothing written)"
  elif ! git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "  pre-commit guard hook: SKIP (target is not a git repository — no commit surface to guard)"
  elif [ ! -f "$WORKSPACE_ROOT/plugin/scripts/precommit-guard.ts" ]; then
    echo "ERROR: pre-commit guard script not laid down (plugin/scripts/precommit-guard.ts missing) — hook not installed" >&2
    exit 2
  else
    if node --no-warnings --experimental-strip-types "$WORKSPACE_ROOT/plugin/scripts/precommit-guard.ts" --install-hook --root "$WORKSPACE_ROOT"; then
      : # installed (idempotent) — the install line is on the guard's stdout
    else
      echo "ERROR: pre-commit guard hook install failed (precommit-guard.ts --install-hook returned non-zero)." >&2
      echo "       A pre-existing UNRELATED pre-commit hook refuses to be clobbered — merge the guard shim manually, then re-run quay-init (idempotent)." >&2
      exit 2
    fi
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
