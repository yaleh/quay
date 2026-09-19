#!/usr/bin/env bash
#
# p2-archive-selfcheck.sh — context-slimming P2: plan / apply / check the memory archive.
#
# WHY ONE SCRIPT HOLDS BOTH --apply AND --check: tasks/gap-context-slim-p2-memory-archive.md
# declares exactly two new files (this one and p2-archive-manifest.tsv). A separate generator
# script would be a write outside the declared Touches (anti-drift HARD FAIL), so the apply
# path and the check path live in the same file, separated by subcommand.
#
#   --plan     (default) print what WOULD be archived. Writes nothing.
#   --apply    write the manifest, then move each file into <memory-dir>/archive/.
#              Refuses to run when the archive already exists (idempotence guard).
#   --check    verify AC1..AC5 of the task against the manifest + the live memory directory.
#
# THE NEVER-READ PREDICATE IS readings.sh's, NOT A NEW ONE. This script re-derives the
# per-file read records with the same Read-tool_use regex that readings.sh uses to emit
# memory_files_read_14d, and then CROSS-CHECKS the two: if this script's distinct-file count
# disagrees with readings.sh's aggregate, that is an INSTRUMENT FAILURE (two readings of the
# same quantity disagree), reported as such — never silently resolved in either direction.
# (hard rule 4 推论二: 恒零/恒真的读数携带零信息; the detection half is two independent
# readings cross-checked.)
#
# WHY EVERY grep IS SPELLED /usr/bin/grep: in this environment `grep` is a shell function that
# shells out to ugrep and silently returns nothing for some inputs — a fake zero. readings.sh
# carries the same note; keep it that way when editing.
#
# NOT-EVALUATED: an input that cannot be read yields the literal NOT-EVALUATED, never 0. A
# fabricated 0 is indistinguishable from a genuine zero ("searched, found none").
#
# Usage: p2-archive-selfcheck.sh [--plan|--apply|--check] [--memory-dir DIR] [--days N]
#                                [--repo-root DIR] [--manifest FILE] [--baseline FILE]
set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${HOME:?p2-archive-selfcheck.sh: HOME is unset}"

MODE='--plan'
DAYS=14
DEFAULT_REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
DEFAULT_MEMORY_DIR="$HOME/.claude/projects/-home-yale-work-quay/memory"
MEMORY_DIR=''
REPO_ROOT=''
MANIFEST=''
BASELINE=''
TRANSCRIPTS_DIR=''

usage() {
  printf 'usage: p2-archive-selfcheck.sh [--plan|--apply|--check] [--memory-dir DIR] [--days N]\n'
  printf '                             [--repo-root DIR] [--manifest FILE] [--baseline FILE]\n'
  printf '  --plan          (default) print the archive plan; writes nothing\n'
  printf '  --apply         write the manifest and move the files into <memory-dir>/archive/\n'
  printf '  --check         verify AC1..AC5 (default mode is --plan, so --check is explicit)\n'
  printf '  --memory-dir D  memory directory (default %s)\n' "$DEFAULT_MEMORY_DIR"
  printf '  --days N        lookback window for the never-read predicate (default %s)\n' "$DAYS"
  printf '  --repo-root D   checkout holding the baseline/MEMORY.md.snapshot (default %s)\n' "$DEFAULT_REPO_ROOT"
  printf '  --manifest F    manifest path (default <repo-root>/orchestration/context-slimming/p2-archive-manifest.tsv)\n'
  printf '  --baseline F    pre-P2 MEMORY.md snapshot (default <repo-root>/orchestration/context-slimming/baseline/MEMORY.md.snapshot)\n'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --plan|--apply|--check) MODE="$1"; shift ;;
    --days)           DAYS="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --memory-dir)     MEMORY_DIR="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --repo-root)      REPO_ROOT="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --manifest)       MANIFEST="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --baseline)       BASELINE="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    -h|--help)        usage; exit 0 ;;
    *) printf 'p2-archive-selfcheck.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$DAYS" in
  ''|*[!0-9]*) printf 'p2-archive-selfcheck.sh: --days must be a positive integer, got: %s\n' "$DAYS" >&2; exit 2 ;;
esac
[ "$DAYS" -ge 1 ] || { printf 'p2-archive-selfcheck.sh: --days must be >= 1\n' >&2; exit 2; }

: "${MEMORY_DIR:=$DEFAULT_MEMORY_DIR}"
: "${REPO_ROOT:=$DEFAULT_REPO_ROOT}"
: "${MANIFEST:=$REPO_ROOT/orchestration/context-slimming/p2-archive-manifest.tsv}"
: "${BASELINE:=$REPO_ROOT/orchestration/context-slimming/baseline/MEMORY.md.snapshot}"
MEMORY_DIR="${MEMORY_DIR%/}"
TRANSCRIPTS_DIR=$(dirname -- "$MEMORY_DIR")
ARCHIVE_DIR="$MEMORY_DIR/archive"

# ---------------------------------------------------------------------------------------
# P2 policy constants (each one is a rule the task states, made executable)
# ---------------------------------------------------------------------------------------

# MAX_INDEX_LINES / MAX_LINE_CHARS: AC2 — MEMORY.md <= 40 lines, no line longer than 150 chars.
MAX_INDEX_LINES=40
MAX_LINE_CHARS=150

# TRAP_EXCLUDE: the "environment-trap class" the task's clause ③ excludes from archiving.
#
# DEFINITION (task clause ③): a fact whose source of truth is OUTSIDE this repository — you
# cannot re-derive it by reading the repo's code, tests, docs, or git history. Examples the
# task names: `claude plugin disable` keeping the enabledPlugins key, and the Remote Control
# endpoint.
#
# WHY AN EXPLICIT LIST AND NOT A KEYWORD PATTERN: the first cut of this script used a broad
# regex and it over-matched badly — "chrome" caught serve's shared page chrome, "heredoc"
# caught quay-init's own config heredoc, "npm" caught a worktree-symlink note. Those are all
# repo-derivable facts, and calling them "environment traps" would be a mislabelled exclusion.
# The list below is the reviewed residue: every entry was read and confirmed to be a host /
# tooling / runtime fact. A name is here because it is a trap, not because it contains a word.
#
# THE EXCLUSION DIRECTION IS STILL THE SAFE ONE: an entry wrongly kept out of the archive
# stays exactly where it is — nothing is lost, the index just does not link it. The failure
# this list exists to prevent is the opposite one: moving a host fact into archive/.
declare -A TRAP_EXCLUDE=()
while IFS= read -r _tn; do
  case "$_tn" in ''|'#'*) continue ;; esac
  TRAP_EXCLUDE["$_tn"]=1
done <<'TRAP_LIST'
# --- Claude Code / harness itself (the agent's own environment) ---
blocking-tool-call-stalls-autonomous-loop.md
cc-daemon-spare-pool-memory-pressure.md
claude-code-bg-pty-host-attach-channel.md
claude-code-plugin-cache-copies-whole-dir-and-bin-joins-path.md
claude-plugin-disable-keeps-the-key.md
harness-waitfor-returns-falsy-on-timeout-not-throw.md
midturn-human-messages-invisible-to-audit.md
remote-control-endpoint-is-anthropic-base-url.md
sendmessage-delivery-meta-cc-recheck-retired.md
sendmessage-shared-worker-name-misroutes.md
subagent-no-turn-timeout-fan-in-premise-debunked.md
unrecognized-model-warning-benign.md
# --- node / npm runtime semantics not encoded in this repo ---
force-color-breaks-node-console-log-read-parsing.md
nested-node-test-exits-zero-under-node-test-context.md
nested-node-test-runner-silently-skips-on-inherited-node-test-context.md
node-modules-ts-type-stripping-blocks-installed-quay-loader.md
node-test-concurrency-does-not-parallelize-sibling-top-level-tests.md
node-test-summary-lines-are-ansi-colored-so-caret-greps-return-zero.md
npm-allow-scripts-warning-does-not-mean-postinstall-skipped.md
rmsync-cannot-remove-a-readonly-tree.md
# --- install / packaging layout (the artifact, not the source tree) ---
plugin-install-reuses-same-version-cache-dir.md
plugin-scope-locked-uninstall-recipe-is-self-defeating.md
plugin-tarball-layout-breaks-packages-relative-imports.md
publish-dist-branch-blocked-by-precommit-hook-locally.md
shipped-artifact-lacks-dist-driver-anchor.md
# --- github / CI runner / hosted services ---
ci-step-wallclock-only-via-gh-jobs-api-not-carrier.md
ci-test-job-runs-on-self-hosted-uid0-nonC-locale.md
develop-ci-test-job-wallclock-has-27s-non-suite-floor.md
gh-config-dir-empty-emulates-ci-unauthenticated-gh.md
github-job-log-lines-carry-an-iso-timestamp-prefix.md
github-token-cannot-push-workflow-file-changes.md
verify-transport-scp-r-yaml-is-slow-not-stalled.md
# --- OS / process / shell semantics ---
flock-lock-lives-in-the-fd-not-the-pid.md
fuser-open-fd-not-flock-holder.md
inflight-read-after-driver-restart-orphans.md
pkill-serve-matches-production-watch-server.md
precommit-guard-doc-check-empty-output-is-timeout.md
python-heredoc-backslash-b-becomes-backspace-in-task-text.md
sandbox-date-u-clock-can-drift-use-git-log.md
ssh-non-login-shell-misses-user-local-bin.md
tmp-shares-root-fs-enospc-makes-suite-red.md
tmux-tmpdir-honored-when-tmux-stripped.md
TRAP_LIST

# INDEX_CLUSTER_PATTERN: files that ARE the new MEMORY.md's navigation layer.
#
# The task's clause ① mandates "每个主题簇一个入口" (one entry per topic cluster) in the new
# index, and clause ② deletes index lines that point at never-read files. Those two pull in
# opposite directions for a topic-*.md shard that was never read: it is neither hot (so ② would
# drop its index line) nor trash (so ③ would archive it) — but ① designates it as the cluster
# entry itself. Resolution: the topic-* shards are index INFRASTRUCTURE, not memories, and are
# excluded from archiving; the new index links each cluster to its shard. Excluding them is
# what keeps clause ① intact and AC3 (no broken index link) satisfiable.
INDEX_CLUSTER_PATTERN='^topic-.*\.md$'

# DEDUP_COVERED: task clause ④ — memories already carried by CLAUDE.md. They are never-read
# here too, so they are archived like the rest, but they carry a distinct reason column value
# so the de-duplication is auditable rather than merged into the generic reason.
DEDUP_COVERED_PATTERN='^(quay-config-yml-is-gitignored|memory-directory-shared-across-layers|meta-cc-main-session-query-is-fresh-dont-handgrep)\.md$'

# The two samples AC5 names, asserted absent from the manifest.
AC5_SAMPLES='claude-plugin-disable-keeps-the-key remote-control-endpoint-is-anthropic-base-url'

# ---------------------------------------------------------------------------------------
# readings.sh's predicate, re-derived (see the header note on the cross-check)
# ---------------------------------------------------------------------------------------

# read_records_basenames -> one basename per matching Read record, unsorted, not deduped.
read_records_basenames() {
  local esc dates pat xpat
  if [ ! -d "$TRANSCRIPTS_DIR" ] || [ ! -r "$TRANSCRIPTS_DIR" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  esc=$(printf '%s' "$MEMORY_DIR" | sed 's/[][\\.|$(){}?+*^]/\\&/g')
  dates=$(for i in $(seq 0 $((DAYS - 1))); do date -d "-$i day" +%Y-%m-%d; done | paste -sd'|')
  pat='"name":"Read","input":{"file_path":"'"$esc"'/[^"]*".*"timestamp":"('"$dates"')'
  xpat="$esc"'/[^"]*"'
  find "$TRANSCRIPTS_DIR" -name '*.jsonl' -mtime "-$DAYS" -print0 2>/dev/null \
    | xargs -0 -r /usr/bin/grep -hoE "$pat" 2>/dev/null \
    | /usr/bin/grep -hoE "$xpat" 2>/dev/null \
    | sed -e 's|.*/||' -e 's|"$||'
}

# all_memory_basenames -> basenames of every *.md under the memory dir (archive/ included).
all_memory_basenames() {
  find "$MEMORY_DIR" -type f -name '*.md' -printf '%f\n' 2>/dev/null | sort
}

# count_memory_md -> AC1's quantity. NOT-EVALUATED (never 0) when the directory is unreadable.
count_memory_md() {
  if [ ! -d "$MEMORY_DIR" ] || [ ! -r "$MEMORY_DIR" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  find "$MEMORY_DIR" -type f -name '*.md' 2>/dev/null | wc -l
}

# p0_read_count -> readings.sh's memory_files_read_14d, or NOT-EVALUATED.
p0_read_count() {
  if [ ! -x "$SCRIPT_DIR/readings.sh" ] && [ ! -f "$SCRIPT_DIR/readings.sh" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  bash "$SCRIPT_DIR/readings.sh" --days "$DAYS" --memory-dir "$MEMORY_DIR" --repo-root "$REPO_ROOT" 2>/dev/null \
    | sed -n 's/^memory_files_read_14d=//p'
}

# desc_of FILE -> the frontmatter description line (empty when absent). -a because one memory
# in this corpus carries bare NUL bytes and would otherwise be skipped as "binary".
desc_of() {
  /usr/bin/grep -m1 -a '^description:' "$1" 2>/dev/null | sed 's/^description: *//'
}

# is_trap FILE -> true when FILE's basename is in TRAP_EXCLUDE. Membership, not a keyword
# match: see the TRAP_EXCLUDE header for why a pattern was rejected.
is_trap() {
  local base
  base=$(basename -- "$1")
  [ -n "${TRAP_EXCLUDE[$base]:-}" ]
}

is_index_cluster() { [[ "$(basename -- "$1")" =~ $INDEX_CLUSTER_PATTERN ]]; }
is_dedup_covered() { [[ "$(basename -- "$1")" =~ $DEDUP_COVERED_PATTERN ]]; }

# ---------------------------------------------------------------------------------------
# plan: compute the three sets
# ---------------------------------------------------------------------------------------

build_plan() {
  local tmp; tmp=$(mktemp -d) || { printf 'mktemp failed\n' >&2; exit 2; }
  local rec="$tmp/records" all="$tmp/all" never="$tmp/never"
  read_records_basenames | sort -u > "$tmp/read"
  all_memory_basenames > "$all"
  comm -23 "$all" "$tmp/read" > "$never"
  local read_n all_n never_n stale_n
  read_n=$(wc -l < "$tmp/read")
  all_n=$(wc -l < "$all")
  never_n=$(wc -l < "$never")
  stale_n=$(comm -13 "$all" "$tmp/read" | wc -l)
  # KEY=VALUE lines go to STDERR: this function's STDOUT is the temp-directory path its caller
  # captures, and a diagnostic that lands in that variable is both invisible and corrupting.
  printf 'read_distinct=%s\n' "$read_n" >&2
  printf 'files_total=%s\n' "$all_n" >&2
  printf 'never_read=%s\n' "$never_n" >&2
  printf 'read_but_absent_on_disk=%s\n' "$stale_n" >&2
  # stale basenames (read in-window, no longer on disk) are reported, never silently dropped:
  # they make read_distinct + never_read != files_total, and a reader who does not know that
  # would read the difference as a bug in the partition.
  printf 'partition_check=%s\n' "$([ $((read_n + never_n)) -eq $((all_n + stale_n)) ] && echo OK || echo MISMATCH)" >&2

  # Classification lives HERE, not in run_plan, so that --apply and --plan cannot drift: both
  # consume the same three lists, computed once. (The first cut put the loop in run_plan only,
  # and --apply then read $tmp/archive as an empty file — it built an empty manifest and moved
  # nothing while reporting success. A list producer with two consumers must have one producer.)
  : > "$tmp/archive"; : > "$tmp/trap"; : > "$tmp/cluster"
  local n_trap=0 n_cluster=0 n_dedup=0 n_arch=0 base
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    # MEMORY.md is the index ITSELF — never a candidate, whatever its read count. Rewriting the
    # index is not a reason to move the index; without this guard the rule "never read in the
    # window ⇒ archive" would become a rule about the one file whose readers are the sessions.
    [ "$base" = 'MEMORY.md' ] && continue
    if is_index_cluster "$base"; then printf '%s\n' "$base" >> "$tmp/cluster"; n_cluster=$((n_cluster + 1)); continue; fi
    if is_trap "$MEMORY_DIR/$base"; then printf '%s\n' "$base" >> "$tmp/trap"; n_trap=$((n_trap + 1)); continue; fi
    printf '%s\n' "$base" >> "$tmp/archive"; n_arch=$((n_arch + 1))
    is_dedup_covered "$base" && n_dedup=$((n_dedup + 1))
  done < "$tmp/never"
  printf 'excluded_index_cluster=%s\n' "$n_cluster" >&2
  printf 'excluded_environment_trap=%s\n' "$n_trap" >&2
  printf 'archive_candidates=%s\n' "$n_arch" >&2
  printf 'of_which_dedup_covered_by_claudemd=%s\n' "$n_dedup" >&2
  printf '%s' "$tmp"
}

run_plan() {
  local tmp; tmp=$(build_plan)
  printf 'archive_list=%s\n' "$tmp/archive"
  printf 'trap_list=%s\n' "$tmp/trap"
  printf 'cluster_list=%s\n' "$tmp/cluster"
  printf 'all_list=%s\n' "$tmp/all"
}

# ---------------------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------------------

run_apply() {
  # Idempotence is keyed on the MANIFEST CARRYING DATA ROWS, not on the archive directory
  # existing: an interrupted run leaves an empty archive/ plus a header-only manifest, and a
  # guard that reads either of those as "already applied" would freeze the task in a state
  # where the ledger looks written and nothing has moved.
  if [ -f "$MANIFEST" ] && [ "$(manifest_rows | /usr/bin/grep -c .)" -gt 0 ]; then
    printf 'apply: already applied (manifest carries data rows) — nothing to do\n'
    return 0
  fi
  local tmp; tmp=$(build_plan)
  local files_before reads_before
  files_before=$(count_memory_md)
  reads_before=$(p0_read_count)
  [ "$files_before" != 'NOT-EVALUATED' ] || { printf 'apply: memory dir unreadable\n' >&2; exit 1; }
  [ "$reads_before" != 'NOT-EVALUATED' ] && [ -n "$reads_before" ] || { printf 'apply: readings.sh produced no memory_files_read_14d\n' >&2; exit 1; }

  mkdir -p "$ARCHIVE_DIR" || { printf 'apply: cannot create %s\n' "$ARCHIVE_DIR" >&2; exit 1; }

  # MOVE FIRST, WRITE THE LEDGER SECOND. The other order lets an interrupted run leave a ledger
  # claiming moves that never happened — a record that outruns its action, which is the shape
  # hard rule 7 forbids from the opposite side. The skip arm keeps the move loop resumable.
  local moved=0 skipped=0
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    if [ -e "$ARCHIVE_DIR/$base" ] && [ ! -e "$MEMORY_DIR/$base" ]; then
      skipped=$((skipped + 1)); continue
    fi
    mv -- "$MEMORY_DIR/$base" "$ARCHIVE_DIR/$base" || { printf 'apply: move failed: %s\n' "$base" >&2; exit 1; }
    moved=$((moved + 1))
  done < "$tmp/archive"

  local files_after archive_n want_n
  files_after=$(count_memory_md)
  archive_n=$(find "$ARCHIVE_DIR" -type f -name '*.md' 2>/dev/null | wc -l)
  want_n=$(wc -l < "$tmp/archive")
  printf 'apply: files_before=%s files_after=%s moved=%s already_in_place=%s archive_now=%s want=%s\n' \
    "$files_before" "$files_after" "$moved" "$skipped" "$archive_n" "$want_n"
  [ "$files_before" = "$files_after" ] || { printf 'apply: FILE CONSERVATION VIOLATED (AC1)\n' >&2; exit 1; }
  [ "$archive_n" = "$want_n" ] || { printf 'apply: archive/ holds %s files but the plan has %s (AC1 second clause)\n' \
    "$archive_n" "$want_n" >&2; exit 1; }

  {
    printf '# p2-archive-manifest.tsv — context-slimming P2 archive ledger\n'
    printf '# task=gap-context-slim-p2-memory-archive\n'
    printf '# memory_dir=%s\n' "$MEMORY_DIR"
    printf '# archive_dir=%s\n' "$ARCHIVE_DIR"
    printf '# observation_start=%s\n' "$(date +%Y-%m-%d)"
    printf '# applied_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# files_before=%s\n' "$files_before"
    printf '# files_after=%s\n' "$files_after"
    printf '# memory_files_read_%sd=%s\n' "$DAYS" "$reads_before"
    printf '# window_days=%s\n' "$DAYS"
    printf '# columns=original_path<TAB>archive_path<TAB>reason<TAB>reads_before_archive\n'
    printf '# reason vocabulary: never-read-%sd  [+ ;covered-by-CLAUDE.md]\n' "$DAYS"
    printf '# excluded_environment_trap: clause ③ — files whose source of truth is outside this repo; NOT archived.\n'
    printf '# excluded_index_cluster: clause ① — topic-*.md shards ARE the new index'"'"'s cluster entries; NOT archived.\n'
    printf '# misarchive_policy: 观察期 14 天内（observation_start 起）若某归档文件被找回（被读/被引用），\n'
    printf '#   `mv <archive>/<name> <memory-dir>/<name>` 移回原位，并在此清单追加一行 reason 含 `misarchive`\n'
    printf '#   记为误归档；该行是判据「观察期无找回」的唯一载体，⛔ 不要靠记忆。\n'
  } > "$MANIFEST"

  while IFS= read -r base; do
    [ -n "$base" ] || continue
    local reason="never-read-${DAYS}d"
    is_dedup_covered "$base" && reason="$reason;covered-by-CLAUDE.md"
    printf '%s\t%s\t%s\t%s\n' "$MEMORY_DIR/$base" "$ARCHIVE_DIR/$base" "$reason" 0 >> "$MANIFEST"
  done < "$tmp/archive"

  printf 'apply: manifest=%s\n' "$MANIFEST"
  rm -rf "$tmp"
}

# ---------------------------------------------------------------------------------------
# check (AC1..AC5)
# ---------------------------------------------------------------------------------------

PASS=0; FAIL=0; NOTEVAL=0
ok()  { PASS=$((PASS + 1));  printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1));  printf 'FAIL  %s\n' "$1"; }
ne()  { NOTEVAL=$((NOTEVAL + 1)); printf 'NOT-EVALUATED  %s\n' "$1"; }

manifest_header() { sed -n "s/^# $1=//p" "$MANIFEST" | head -1; }
manifest_rows()   { /usr/bin/grep -v '^#' "$MANIFEST" 2>/dev/null; }

run_check() {
  [ -f "$MANIFEST" ] || { ne "manifest not found: $MANIFEST"; printf 'VERDICT NOT-EVALUATED\n'; exit 2; }

  # ---- AC1: file conservation ---------------------------------------------------------
  #
  # AC1 IS EVALUATED AT THE ARCHIVE BOUNDARY. The AC's command is `find … | wc -l` before and
  # after the archive, and the archive itself asserts the two are equal before it exits; the
  # recorded files_before/files_after in the manifest header ARE those two readings. What this
  # check must NOT become is "the directory holds exactly 543 .md files forever": this memory
  # directory is written by every session on the host, so its count grows under the check
  # (observed: 543 at the 07:12Z archive → 546 at the 07:20Z check, three memories written by
  # another session — and it appended a line to the index too). Folding that growth into AC1
  # would make the criterion impossible to satisfy in the very environment it describes, which
  # is the shape hard rule 12 forbids from the other side. What AC1 exists to forbid is SILENT
  # LOSS, so loss is what is checked: boundary conservation, every archived file actually in
  # archive/, every original actually gone from the top level, and now >= files_after. Growth
  # is REPORTED (with its size), not failed.
  local files_before files_after now archive_n rows_n
  files_before=$(manifest_header files_before)
  files_after=$(manifest_header files_after)
  now=$(count_memory_md)
  rows_n=$(manifest_rows | /usr/bin/grep -c .)
  archive_n=$(find "$ARCHIVE_DIR" -type f -name '*.md' 2>/dev/null | wc -l)
  printf -- '-- AC1 conservation (recorded files_before=%s files_after=%s; now=%s; manifest rows=%s; archive/*.md=%s)\n' \
    "$files_before" "$files_after" "$now" "$rows_n" "$archive_n"
  if [ "$files_before" = "$files_after" ]; then
    ok "AC1a boundary conservation: recorded files_before == files_after ($files_before)"
  else
    bad "AC1a boundary conservation: files_before=$files_before files_after=$files_after"
  fi
  if [ "$rows_n" -gt 0 ] && [ "$archive_n" = "$rows_n" ]; then
    ok "AC1b archive complete: archive/*.md ($archive_n) == manifest rows ($rows_n)"
  else
    bad "AC1b archive complete: archive/*.md=$archive_n manifest rows=$rows_n"
  fi
  local still_here=0 n=0 orig
  while IFS=$'\t' read -r orig _rest; do
    [ -n "$orig" ] || continue
    n=$((n + 1))
    [ -e "$orig" ] && still_here=$((still_here + 1))
  done < <(manifest_rows)
  if [ "$still_here" -eq 0 ]; then
    ok "AC1c moved: 0 of $n manifest rows remain at their original path"
  else
    bad "AC1c moved: $still_here of $n manifest rows remain at their original path"
  fi
  case "$now" in
    ''|*[!0-9]*) ne "AC1d: the live file count is $now — cannot compare against files_after" ;;
    *)
      if [ "$now" -lt "$files_after" ]; then
        bad "AC1d loss: now=$now < files_after=$files_after — files disappeared after the archive"
      elif [ "$now" -eq "$files_after" ]; then
        ok "AC1d no loss: now == files_after ($now)"
      else
        ok "AC1d no loss: now=$now > files_after=$files_after (+$((now - files_after)) written by other sessions since the archive — growth, not loss)"
      fi
      ;;
  esac

  # ---- AC2: MEMORY.md shape, with a positive control on the baseline snapshot ----------
  local idx="$MEMORY_DIR/MEMORY.md" lines long_n base_long
  printf -- '-- AC2 index shape (<=%s lines, no line >%s chars; control on the pre-P2 snapshot)\n' "$MAX_INDEX_LINES" "$MAX_LINE_CHARS"
  if [ ! -r "$idx" ]; then
    ne "AC2: $idx unreadable"
  else
    lines=$(awk 'END{print NR}' "$idx")
    long_n=$(awk -v m="$MAX_LINE_CHARS" '{ if (length($0) > m) c++ } END{ print c+0 }' "$idx")
    if [ "$lines" -le "$MAX_INDEX_LINES" ] && [ "$long_n" -eq 0 ]; then
      ok "AC2 index shape: lines=$lines (<=$MAX_INDEX_LINES), lines-over-$MAX_LINE_CHARS=$long_n"
    else
      bad "AC2 index shape: lines=$lines (<=$MAX_INDEX_LINES?), lines-over-$MAX_LINE_CHARS=$long_n"
    fi
  fi
  if [ ! -r "$BASELINE" ]; then
    ne "AC2 control: baseline snapshot unreadable ($BASELINE) — predicate-not-firing is unproven"
  else
    base_long=$(awk -v m="$MAX_LINE_CHARS" '{ if (length($0) > m) c++ } END{ print c+0 }' "$BASELINE")
    if [ "$base_long" -gt 0 ]; then
      ok "AC2 control: same predicate on $BASELINE fires ($base_long lines over $MAX_LINE_CHARS) — the predicate can hit"
    else
      bad "AC2 control: same predicate on $BASELINE counts 0 — it cannot distinguish a compliant index from an unmeasured one"
    fi
  fi

  # ---- AC3: every ](path) link resolves (enumerated, not a boolean) ---------------------
  printf -- '-- AC3 index links (each one enumerated)\n'
  if [ ! -r "$idx" ]; then
    ne "AC3: $idx unreadable"
  else
    local broken=0 total=0 target
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      total=$((total + 1))
      case "$target" in
        http*|'#'*) printf 'SKIP  AC3 (external/anchor) %s\n' "$target"; continue ;;
      esac
      if [ -e "$MEMORY_DIR/$target" ]; then
        printf 'OK    AC3 %s\n' "$target"
      else
        printf 'BROKEN AC3 %s\n' "$target"
        broken=$((broken + 1))
      fi
    done < <(/usr/bin/grep -oE '\]\([^)]+\)' "$idx" | sed -e 's/^](//' -e 's/)$//' | sort -u)
    if [ "$total" -eq 0 ]; then
      bad "AC3: zero ](path) links found in the index — nothing was enumerated (an absent predicate is not a passing one)"
    elif [ "$broken" -eq 0 ]; then
      ok "AC3 links: $total distinct links enumerated, broken=$broken"
    else
      bad "AC3 links: $total distinct links enumerated, broken=$broken"
    fi
  fi

  # ---- AC4: every manifest row's reads_before_archive == 0, recomputed ------------------
  printf -- '-- AC4 archived files were never read in the %s-day window (recomputed)\n' "$DAYS"
  local tmp; tmp=$(mktemp -d)
  read_records_basenames | sort -u > "$tmp/read"
  local p0; p0=$(p0_read_count)
  local mine; mine=$(wc -l < "$tmp/read")
  if [ "$p0" = 'NOT-EVALUATED' ] || [ -z "$p0" ]; then
    ne "AC4 cross-check: readings.sh produced no memory_files_read_14d"
  elif [ "$p0" -eq "$mine" ]; then
    ok "AC4 cross-check: this script's distinct read set ($mine) == readings.sh memory_files_read_14d ($p0)"
  else
    bad "AC4 cross-check: this script=$mine vs readings.sh=$p0 — INSTRUMENT FAILURE, two readings of one quantity disagree"
  fi
  local nz=0 n=0 col4
  local shown=0
  while IFS=$'\t' read -r orig arch reason col4; do
    [ -n "$orig" ] || continue
    n=$((n + 1))
    local base; base=$(basename -- "$orig")
    local hits=0
    hits=$(/usr/bin/grep -c -x -F -- "$base" "$tmp/read" 2>/dev/null) || hits=0
    if [ "$shown" -lt 3 ]; then
      printf 'SAMPLE AC4 row %s: %s  reads_now=%s recorded=%s\n' "$n" "$base" "$hits" "$col4"
      shown=$((shown + 1))
    fi
    if [ "$hits" != '0' ] || [ "$col4" != '0' ]; then
      nz=$((nz + 1))
      printf 'NOT-ZERO AC4 %s reads_now=%s recorded=%s\n' "$base" "$hits" "$col4"
    fi
  done < <(manifest_rows)
  if [ "$n" -eq 0 ]; then
    bad "AC4: manifest has zero data rows"
  elif [ "$nz" -eq 0 ]; then
    ok "AC4: all $n rows are never-read (recomputed 0, recorded 0)"
  else
    bad "AC4: $nz of $n rows have a non-zero read count"
  fi

  # ---- AC5: the two named environment-trap samples are absent, with a dry-run control ---
  printf -- '-- AC5 environment traps are not in the manifest (samples: %s)\n' "$AC5_SAMPLES"
  local sample found=0
  for sample in $AC5_SAMPLES; do
    if /usr/bin/grep -q -F -- "$sample" "$MANIFEST"; then found=$((found + 1)); fi
  done
  local ctl; ctl=$(mktemp)
  { for sample in $AC5_SAMPLES; do printf 'x/%s.md\n' "$sample"; done; printf 'x/unrelated.md\n'; } > "$ctl"
  local ctl_hits=0 s
  for s in $AC5_SAMPLES; do
    /usr/bin/grep -q -F -- "$s" "$ctl" && ctl_hits=$((ctl_hits + 1))
  done
  if [ "$ctl_hits" -ge 1 ]; then
    ok "AC5 control: dry-run predicate on a temp file holding the samples fires ($ctl_hits/2) — the absence below is measured, not vacuous"
  else
    bad "AC5 control: the absence predicate counts 0 even on a file that CONTAINS the samples — it cannot report absence"
  fi
  if [ "$found" -eq 0 ]; then
    ok "AC5 samples: 0 of the 2 named samples appear in the manifest (grep -c == 0)"
  else
    bad "AC5 samples: $found of the 2 named samples appear in the manifest"
  fi
  rm -f "$ctl"; rm -rf "$tmp"

  printf -- '-- totals: %s PASS, %s FAIL, %s NOT-EVALUATED\n' "$PASS" "$FAIL" "$NOTEVAL"
  if [ "$FAIL" -gt 0 ]; then printf 'VERDICT RED\n'; return 1; fi
  if [ "$NOTEVAL" -gt 0 ]; then printf 'VERDICT NOT-EVALUATED\n'; return 2; fi
  printf 'VERDICT GREEN\n'
  return 0
}

case "$MODE" in
  --plan)  run_plan ;;
  --apply) run_apply ;;
  --check) run_check ;;
esac
