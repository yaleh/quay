#!/usr/bin/env bash
#
# v-run.sh — context-slimming V: run the constructed minimal validation tasks against a real
# Claude Code worker session, once per ARM (old = P0 snapshot CLAUDE.md/MEMORY.md, new = post-slim
# live CLAUDE.md/MEMORY.md).
#
# WHY A PROBE CHECKOUT AND NOT THE MAIN CHECKOUT: the resident injection (CLAUDE.md + the memory
# index) is resolved from the *session's cwd*, so an A/B on it needs two session cwds whose
# injected files differ. The main checkout is production (hard rule 11b — the working tree IS the
# production input), so the arms run in throwaway probe checkouts under
# /home/yale/work/quay-worktrees/vprobe-<arm>. A probe is `git archive <sha> | tar -x` (NOT
# `git worktree add`): `git worktree add` leaves the probe sharing the MAIN repo's git common dir,
# and Claude Code keys the auto-memory directory on the git common dir — measured: a session whose
# cwd was a quay worktree read /home/yale/.claude/projects/-home-yale-work-quay/memory/MEMORY.md,
# i.e. the MAIN memory index, not one for the worktree. `rm .git && git init` gives the probe its
# own common dir, and the memory index then resolves to the probe's own slug (verified by planting
# a marker token in both places and reading back what the session actually saw).
#
# WHAT IS REAL HERE (DoD: "不是 fixture 或 dry-run"): each case is one real `claude -p` session
# launched through the repo's own launcher argv shape (claude-fjdac + the repo's checked-in
# .claude/launch.settings.json + the role's -n name + the profile's model), working in a real quay
# checkout, writing real deliverables, and leaving a real transcript on disk. The judge reads that
# transcript (and the deliverable), never a synthesized stand-in.
#
# WHAT IS NOT: this does not run the full driver→worker→fan-in pipeline (no worktree isolation, no
# fan-in). The layer under test — "does the resident injection still keep the worker off the trap?"
# — is exactly the layer that is exercised. See v-validation.md §Limits.
#
# Usage:
#   v-run.sh --arm <old|new> [--cases "W1 W2 ..."] [--timeout SECONDS] [--runs-dir DIR]
#            [--rebuild-probe] [--base <commit-ish>]
#
# Exit: 0 = every case produced a run record (a case whose session failed is still recorded, with
#       exit_code != 0 — that is data, not a script error); 2 = usage/env error.
set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)

ARM=''
CASES='W1 W2 W3 J1 J2 J3 S1 S2'
TIMEOUT=420
RUNS_DIR=''
REBUILD=0
BASE=''

while [ $# -gt 0 ]; do
  case "$1" in
    --arm) ARM="${2:-}"; shift 2 ;;
    --cases) CASES="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --runs-dir) RUNS_DIR="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --rebuild-probe) REBUILD=1; shift ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "v-run.sh: unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$ARM" in
  old|new) ;;
  *) echo "v-run.sh: --arm must be old|new (got '${ARM}')" >&2; exit 2 ;;
esac

: "${HOME:?v-run.sh: HOME is unset}"

PROBE_BASE="${V_PROBE_BASE:-/home/yale/work/quay-worktrees}"
PROBE="$PROBE_BASE/vprobe-$ARM"
# Claude Code's project slug: the absolute cwd with every `/` and `.` replaced by `-` (measured:
# /home/yale/work/quay -> -home-yale-work-quay; /home/yale/work/quay/.claude/worktrees/X ->
# -home-yale-work-quay--claude-worktrees-X). No extra leading dash.
SLUG="$(printf '%s' "$PROBE" | sed 's#[/.]#-#g')"
MEMDIR="$HOME/.claude/projects/$SLUG/memory"
RUNS_DIR="${RUNS_DIR:-$ROOT/.quay/v-runs/$ARM}"
BASE="${BASE:-$(git -C "$ROOT" rev-parse HEAD)}"

# The launcher/model/-n shape mirrors .quay/profiles.yml role worker-default (launcher claude-fjdac,
# model deepseek-v4-pro-anthropic) — see driver-runtime.ts launchArgv for the argv it composes.
LAUNCHER="${V_LAUNCHER:-claude-fjdac}"
MODEL="${V_MODEL:-deepseek-v4-pro-anthropic}"

role_for() {
  case "$1" in
    W*) echo task-worker ;;
    J*) echo pool-judge ;;
    S*) echo selector ;;
    *) echo '' ;;
  esac
}

say() { printf 'v-run: %s\n' "$*" >&2; }

# ── probe construction ────────────────────────────────────────────────────────────────────────────
build_probe() {
  say "building probe $PROBE from $BASE"
  rm -rf "$PROBE"
  mkdir -p "$PROBE"
  git -C "$ROOT" archive "$BASE" | tar -x -C "$PROBE" || return 2
  # gitignored-but-required (same set .worktreeinclude declares): config.yml + vendor dist bundles.
  mkdir -p "$PROBE/.quay"
  cp "$ROOT/.quay/config.yml" "$PROBE/.quay/config.yml"
  mkdir -p "$PROBE/plugin/vendor/quay/dist" "$PROBE/plugin/vendor/quay-native/dist"
  cp "$ROOT/plugin/vendor/quay/dist/quay.js" "$PROBE/plugin/vendor/quay/dist/quay.js" 2>/dev/null || true
  cp "$ROOT/plugin/vendor/quay-native/dist/quay-native.js" "$PROBE/plugin/vendor/quay-native/dist/quay-native.js" 2>/dev/null || true
  [ -d "$ROOT/node_modules" ] && ln -sfn "$ROOT/node_modules" "$PROBE/node_modules"
  # Own git common dir ⇒ own auto-memory slug (see header). Committed so `git status` is clean in
  # the probe and the session sees a normal checkout.
  ( cd "$PROBE" \
    && git init -q . \
    && git add -A >/dev/null 2>&1 \
    && git -c user.email=v-probe@local -c user.name='v-probe' commit -q -m 'v-probe baseline' >/dev/null 2>&1 ) || return 2
  return 0
}

install_injection() {
  # CLAUDE.md
  if [ "$ARM" = old ]; then
    cp "$SCRIPT_DIR/baseline/CLAUDE.md.snapshot" "$PROBE/CLAUDE.md"
  else
    cp "$ROOT/CLAUDE.md" "$PROBE/CLAUDE.md"
  fi
  # memory index (+ the memory files the index points at)
  rm -rf "$MEMDIR"
  mkdir -p "$MEMDIR"
  LIVE_MEM="$HOME/.claude/projects/-home-yale-work-quay/memory"
  if [ -d "$LIVE_MEM" ]; then
    cp -a "$LIVE_MEM/." "$MEMDIR/" 2>/dev/null || true
  fi
  if [ "$ARM" = old ]; then
    # Pre-P2 state = the archived (never-read) memory files back at the top level + the P0 index.
    if [ -d "$MEMDIR/archive" ]; then
      find "$MEMDIR/archive" -maxdepth 1 -name '*.md' -exec mv -f {} "$MEMDIR/" \; 2>/dev/null || true
    fi
    cp "$SCRIPT_DIR/baseline/MEMORY.md.snapshot" "$MEMDIR/MEMORY.md"
  else
    cp "$LIVE_MEM/MEMORY.md" "$MEMDIR/MEMORY.md" 2>/dev/null || true
  fi
  say "injection: CLAUDE.md=$([ "$ARM" = old ] && echo snapshot || echo live)  memory=$MEMDIR"
}

# ── one case ─────────────────────────────────────────────────────────────────────────────────────
run_case() {
  local c="$1"
  local role; role=$(role_for "$c")
  local rd="$RUNS_DIR/$c"
  local prompt_file="$SCRIPT_DIR/v-prompts/$c.md"
  rm -rf "$rd"; mkdir -p "$rd/out"
  if [ ! -f "$prompt_file" ]; then
    say "$c: NO PROMPT at $prompt_file"; return 1
  fi
  rm -rf "$PROBE/.v-out"; mkdir -p "$PROBE/.v-out"
  local t0 t1 rc
  t0=$(date +%s)
  ( cd "$PROBE" && timeout "$TIMEOUT" "$LAUNCHER" \
      --settings "$PROBE/.claude/launch.settings.json" \
      --exclude-dynamic-system-prompt-sections --prompt-suggestions false \
      --model "$MODEL" -n "quay-$role" \
      --output-format json \
      -p "$(cat "$prompt_file")" ) >"$rd/result.json" 2>"$rd/stderr.txt"
  rc=$?
  t1=$(date +%s)
  {
    printf 'case=%s\narm=%s\nrole=%s\nexit_code=%s\nduration_s=%s\nprobe=%s\nbase=%s\nprompt=%s\n' \
      "$c" "$ARM" "$role" "$rc" "$((t1 - t0))" "$PROBE" "$BASE" "$prompt_file"
  } >"$rd/meta.txt"
  # transcript
  local sid
  sid=$(jq -r '.session_id // empty' "$rd/result.json" 2>/dev/null)
  printf 'session_id=%s\n' "${sid:-}" >>"$rd/meta.txt"
  if [ -n "$sid" ] && [ -f "$HOME/.claude/projects/$SLUG/$sid.jsonl" ]; then
    cp "$HOME/.claude/projects/$SLUG/$sid.jsonl" "$rd/transcript.jsonl"
  else
    # fall back to the newest transcript in the slug dir (only sound because cases run serially)
    local newest
    newest=$(ls -t "$HOME/.claude/projects/$SLUG"/*.jsonl 2>/dev/null | head -1)
    [ -n "$newest" ] && cp "$newest" "$rd/transcript.jsonl"
  fi
  # deliverables
  cp -a "$PROBE/.v-out/." "$rd/out/" 2>/dev/null || true
  # judged numbers
  local v comp
  v=$(bash "$SCRIPT_DIR/v-judge.sh" "$c" "$rd" 2>"$rd/judge.err"); local jrc=$?
  comp=$(bash "$SCRIPT_DIR/v-judge.sh" --completion "$c" "$rd" 2>/dev/null)
  printf 'violations=%s\njudge_exit=%s\ncompleted=%s\n' "$v" "$jrc" "$comp" >>"$rd/meta.txt"
  say "$c: exit=$rc dur=$((t1 - t0))s violations=$v completed=$comp"
  return 0
}

if [ "$REBUILD" = 1 ] || [ ! -d "$PROBE" ]; then
  build_probe || { echo "v-run.sh: probe build failed" >&2; exit 2; }
fi
install_injection
mkdir -p "$RUNS_DIR"

fail=0
for c in $CASES; do
  run_case "$c" || fail=1
done
say "done: arm=$ARM runs=$RUNS_DIR"
exit "$fail"
