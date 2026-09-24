#!/usr/bin/env bash
# release-branch-finish.sh — FINISH a release branch: the "合回后删除" half of the release
# protocol, as a command — AND the cut's landing face (`--cut`), so that the end of a release
# cut and the disappearance of its branch are ONE action instead of two remembered ones.
# SPEC: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §4.1 — a `release/vX.Y.Z`
# is cut from develop → version bump → merged back to develop → tagged at the merge point →
# **the branch is DELETED**. This script is that last step (the SPEC wrote the protocol as prose;
# ADR-004: prose gets paraphrased away, so the rule ships with its execution face).
#
# It is NOT a general "delete a branch" tool. Four properties are load-bearing, and each is a
# distinct, non-silent failure:
#
#   1. ONLY release branch names. `<branch>` must match `release-*` or `release/*`; anything
#      else is refused (a generic deleter would get misused).
#   2. NO LICENSE TO DELETE ⇒ REFUSED. A branch may be deleted when EITHER of AC-271's two
#      compliant forms holds — this is the SAME compliance definition the criterion uses, and
#      it is the whole point of this file (gap-ac271-release-branch-outlives-its-tag-again):
#        (a) it is merged back — `git rev-list --count <base>..<branch>` == 0; or
#        (b) its tip is contained in a tag — `git tag --contains <branch>` non-empty, i.e. the
#            tip is parked on (or is an ancestor of) its version tag, so the tag holds every
#            commit and deleting the branch loses nothing.
#      Neither ⇒ REFUSED, with its own exit code and CAUSE= (that is the only真 "would lose
#      work" shape, and it must stay refused — a looser rule would degrade into "everything
#      is acceptable"). A tag scan that cannot be PERFORMED is its own failure, never read as
#      "no tag" (hard rule 3b).
#   3. A FAILED REMOTE DELETE IS NEVER SWALLOWED. After the local delete, if the same ref
#      exists on the remote (origin, or --remote), it is deleted too; a failure there leaves a
#      trace (its own CAUSE=) and exits non-zero. A remote that cannot be READ is also a
#      failure — "could not look" must not be reported as "nothing there" (hard rule 3b).
#   4. THE FINISH LEAVES A RECORD. Every decision (deleted / refused / instrument failure) is
#      appended to a local trace (.quay/release-branch-finish.jsonl by default), readable with
#      `--log`. Before this existed the command only wrote to stdout, so "was the finish step
#      run, and how?" was indistinguishable in the record from "it never ran" (hard rule 9) —
#      measured cost 2026-09-19: a release branch vanished with NO attributable trace at all.
#   5. THE RECORD LANDS IN THE **MAIN CHECKOUT**, NOT IN THE CHECKOUT THE COMMAND RAN FROM
#      (gap-release-cut-single-carrier-and-main-ledger-trace, AC-320, 2026-09-24). A linked
#      worktree and its main checkout SHARE one `.git`, so the ledger must live with the OWNER
#      of that git dir — otherwise "THE FINISH LEAVES A RECORD" is true of a file nobody reads.
#      Measured cost 2026-09-24: the v0.12.0 cut was run from an independent clone
#      (/data/scratch/yale/quay-release-cut-v0120) because `--cut` needs HEAD == base; the
#      record landed in THAT clone's `.quay/`, and the main checkout's ledger末行 stayed at
#      2026-09-20. So the default trace path is now `dirname(git-common-dir)/.quay/…`
#      (order-independent — never `git worktree list`'s first entry, see repo-root.ts), the
#      absolute path is printed to stderr on every write and by `--log`, and `--trace-path`
#      answers "where would the record land?" without writing anything.
#      ⚠️ A checkout that IS its own git-common-dir root (the main checkout, or a throwaway
#      clone) is indistinguishable from inside git — both get one WARN line naming the
#      absolute path. The WARN is a pointer at the DIRECT quantity (the path), not a verdict
#      about which checkout you are in.
#
# `--cut` — THE CUT'S LANDING FACE (AC4). SPEC §4.1's protocol ends with three steps (合回 →
# 在合并点打 tag → 删除). `--cut` performs all three in ONE invocation on the LOCAL side
# (release branches exist only locally — measured: `git ls-remote --heads origin release/v0.10.0`
# is empty, so any remote-side carrier structurally cannot reach them):
#     merge <branch> back into <base> (--no-ff, HEAD must already be <base>)  ← 合并点
#   → tag <tag> at that merge point (refused if <tag> already exists)
#   → finish: delete <branch> via property 2's own predicate, which the tag just licensed.
# ⇒ "this cut got all the way through" and "the branch is gone" are the same command's exit 0.
# ⛔ It does not make a MANUAL cut throw — AC-271's criterion still catches a leftover branch; but
# whoever runs the cut through this command cannot skip the finish step, because the finish step
# IS a stage of it.
#
# Usage:
#   release-branch-finish.sh <branch> [--root <repo>] [--remote <name>] [--no-remote]
#                            [--base <ref>] [--dry-run] [--trace <file>]
#   release-branch-finish.sh <branch> --cut --tag <vX.Y.Z> [--root <repo>] [--base <ref>]
#                            [--remote <name>] [--no-remote] [--dry-run] [--trace <file>]
#   release-branch-finish.sh --log [--trace <file>] [--root <repo>]
#   release-branch-finish.sh --trace-path [--trace <file>] [--root <repo>]
#   <branch>     a release branch name matching release-* / release/*
#   --root       repo to operate on (default: the repo this script lives in)
#   --remote     remote to also delete the ref from (default: origin)
#   --no-remote  explicitly skip remote handling (local-only finish)
#   --base       the ref the branch must be merged into (default: develop, else origin/develop)
#   --cut        ALSO perform the cut's landing: merge <branch> into <base> + tag the merge
#                point (requires --tag) + finish. HEAD must already be <base>.
#   --tag        the version tag to create at the merge point (required by --cut; refused if it
#                already exists)
#   --dry-run    print what WOULD happen, exit 0, mutate nothing
#   --trace      the finish-record file (default: <main checkout>/.quay/release-branch-finish.jsonl
#                — the checkout that OWNS `<root>`'s shared git dir, so a linked worktree and its
#                main checkout share ONE ledger; ⛔ NOT `<root>/.quay/…`)
#   --trace-path PRINT the absolute record path (the same value stderr shows on every write) and
#                exit 0 — answers "where does the record land?" without writing anything
#   --log        READ the finish record: print one line per recorded decision (branch, time,
#                form, tag, result) + the record count. Absent trace file ⇒ exit 2 with its own
#                CAUSE (never ran is ⛔ not "ran with no records")
#
# Exit codes:
#   0  finished — the branch is gone locally (and remotely, when a remote was consulted);
#      also 0 when it was already gone (idempotent finish), and for `--log` on a readable trace,
#      and for `--trace-path`
#   1  a delete actually failed, or the remote could not be read / deleted, or a --cut stage
#      after the merge failed — CAUSE= names which
#   2  usage error / the name is not a release branch / the check could not be performed /
#      a --cut precondition failed / the trace could not be read or written /
#      the record's landing root could not be derived
#   3  no license to delete: the branch is neither merged into <base> nor contained in any tag
#      — refused, nothing deleted
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
remote="origin"
use_remote=1
base=""
dry_run=0
branch=""
do_cut=0
cut_tag=""
trace_file=""
log_mode=0
trace_path_mode=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --no-remote) use_remote=0; shift ;;
    --base) base="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --cut) do_cut=1; shift ;;
    --tag) cut_tag="$2"; shift 2 ;;
    --trace) trace_file="$2"; shift 2 ;;
    --trace-path) trace_path_mode=1; shift ;;
    --log) log_mode=1; shift ;;
    -*) echo "release-branch-finish: unknown option: $1" >&2; exit 2 ;;
    *) branch="$1"; shift ;;
  esac
done

# ── property 5: the record's LANDING ROOT (the checkout that OWNS the shared git dir) ─────────
# A linked worktree and its main checkout share ONE `.git`; the record must live with its owner,
# so "THE FINISH LEAVES A RECORD" is true of the file a reader of the main ledger opens. This is
# the order-independent derivation (parent of `--git-common-dir`), never `git worktree list`'s
# first entry — that list's order is not guaranteed (see plugin/scripts/repo-root.ts).
ledger_root_of() { # <dir> → absolute checkout path, or "" when it cannot be derived
  local d="$1" gd=""
  gd="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || gd=""
  if [ -z "$gd" ]; then
    # Older git has no --path-format: --git-common-dir may come back RELATIVE to <dir>.
    gd="$(git -C "$d" rev-parse --git-common-dir 2>/dev/null)" || gd=""
    [ -n "$gd" ] || return 1
    case "$gd" in /*) : ;; *) gd="$d/$gd" ;; esac
  fi
  [ -n "$gd" ] || return 1
  ( cd "$(dirname "$gd")" 2>/dev/null && pwd -P ) || return 1
}

# The invocation is "self-rooted" when the checkout it operates on IS the owner of its own git
# dir — i.e. no *other* checkout shares this ledger. The real main checkout and a throwaway clone
# are indistinguishable from inside git (both are self-rooted), so this is deliberately a
# POINTER, not a verdict: it names the absolute path so the reader can judge. A linked-worktree
# invocation can never set it, because there the ledger root is a DIFFERENT directory — which is
# exactly the sharing this property provides.
self_rooted=0
toplevel_of_root="$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null)" || toplevel_of_root=""

[ -n "$trace_file" ] || {
  ledger_root="$(ledger_root_of "$repo_root")" || ledger_root=""
  if [ -z "$ledger_root" ]; then
    echo "CAUSE=release-branch-ledger-root-unresolvable — could not derive the checkout that owns '$repo_root''s shared git dir (git rev-parse --git-common-dir failed), so where the record would land is UNKNOWN; refusing to write it to a guess (hard rule 3b)" >&2
    exit 2
  fi
  trace_file="$ledger_root/.quay/release-branch-finish.jsonl"
  # Spelled as an `if` on purpose: the `[ A ] || [ B ] && c=1` shorthand reads as
  # "(A || B) && c=1" to the shell, which sets c when the toplevel is EMPTY (an
  # undeterminable read) — the "could not look ⇒ looks like a hit" shape (hard rule 3b).
  if [ -n "$toplevel_of_root" ] && [ "$ledger_root" = "$toplevel_of_root" ]; then
    self_rooted=1
  fi
}

abs_path() { # <path> → absolute path of the LEAF (which need not exist yet)
  local p="$1" d b d2
  case "$p" in /*) : ;; *) p="$PWD/$p" ;; esac
  d="$(dirname "$p")"; b="$(basename "$p")"
  if d2="$(cd "$d" 2>/dev/null && pwd -P)"; then :; else d2="$d"; fi
  printf '%s/%s\n' "${d2%/}" "$b"
}

# ── --trace-path: answer "where does the record land?" without writing anything ───────────────
if [ "$trace_path_mode" -eq 1 ]; then
  abs_path "$trace_file"
  exit 0
fi

# ── the finish record (property 4): one JSONL line per decision ───────────────────────────────
# Keys are written in a FIXED order (ts, branch, sha, form, tag, base, result, remote_result,
# exit) so `--log`'s reader can pull them back with a positional awk split (no jq dependency,
# and no second parser shape to drift). Values are JSON-escaped: a backslash or a double quote
# in a ref name would otherwise forge a key.
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# ── property 5's disclosure face: name the DIRECT quantity (the absolute path) every time ─────
# The WARN is a pointer at that path, not a verdict about which checkout this is (see the header:
# the main checkout and a throwaway clone are indistinguishable from inside git). It is emitted on
# the write path only — `--log` prints the plain `reading:` line instead, and `--trace-path` IS the
# path. A reader who sees a path that is not their main checkout has the whole finding.
trace_landing_note() {
  local abs
  abs="$(abs_path "$trace_file")"
  echo "release-branch-finish: trace=$abs" >&2
  if [ "$self_rooted" -eq 1 ]; then
    echo "WARN: trace lands in an independent clone, not a linked worktree of the main checkout — $abs (this invocation's git dir IS its own root, so NO other main checkout shares this ledger; if '$repo_root' is a scratch clone or a copy, the record is invisible to whoever reads the main checkout's ledger)" >&2
  fi
}

trace_append() { # <result> <form> <tag> <sha> <remote_result> <exit>
  local ts line dir
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dir="$(dirname "$trace_file")"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir" 2>/dev/null || true
  fi
  trace_landing_note
  line="$(printf '{"ts":"%s","branch":"%s","sha":"%s","form":"%s","tag":"%s","base":"%s","result":"%s","remote_result":"%s","exit":%s}' \
    "$ts" "$(json_escape "$branch")" "$(json_escape "$4")" "$(json_escape "$2")" \
    "$(json_escape "$3")" "$(json_escape "$base")" "$(json_escape "$1")" "$(json_escape "$5")" "$6")"
  if ! printf '%s\n' "$line" >> "$trace_file" 2>/dev/null; then
    echo "CAUSE=release-branch-trace-write-failed — the finish record could not be appended to '$trace_file'; the decision above DID take effect, but it left no trace (hard rule 9)" >&2
    return 1
  fi
  return 0
}

# ── --log: read the record back (property 4's read face) ──────────────────────────────────────
if [ "$log_mode" -eq 1 ]; then
  if [ -n "$branch" ]; then
    echo "release-branch-finish: --log takes no branch name (got '$branch')" >&2
    exit 2
  fi
  # Name the file being read BEFORE judging it: "which ledger did I just read?" is otherwise
  # unanswerable from the transcript, and it is the whole question property 5 turns on.
  echo "release-branch-finish: reading=$(abs_path "$trace_file")" >&2
  if [ ! -e "$trace_file" ]; then
    echo "CAUSE=release-branch-trace-missing — no finish record at '$trace_file': the finish step has never been recorded here. This is 'never ran' — ⛔ NOT the same as 'ran and recorded nothing' (hard rule 3b)" >&2
    exit 2
  fi
  if [ ! -r "$trace_file" ]; then
    echo "CAUSE=release-branch-trace-unreadable — '$trace_file' exists but cannot be read; refusing to report 'no finish recorded' for a record that could not be looked at (hard rule 3b)" >&2
    exit 2
  fi
  awk -F'"' '
    {
      ts=""; br=""; sha=""; form=""; tg=""; result=""; rem="";
      for (i = 1; i <= NF; i++) {
        if ($i == "ts") ts = $(i + 2);
        else if ($i == "branch") br = $(i + 2);
        else if ($i == "sha") sha = $(i + 2);
        else if ($i == "form") form = $(i + 2);
        else if ($i == "tag") tg = $(i + 2);
        else if ($i == "result") result = $(i + 2);
        else if ($i == "remote_result") rem = $(i + 2);
      }
      if (tg == "") tg = "-";
      if (rem == "") rem = "-";
      if (sha == "") sha = "-"; else sha = substr(sha, 1, 12);
      printf "%s  %s  form=%s  tag=%s  result=%s  sha=%s  remote=%s\n", ts, br, form, tg, result, sha, rem;
      n++;
    }
    END { printf "trace: %d record(s) in %s\n", n + 0, FILENAME }
  ' "$trace_file"
  exit 0
fi

if [ -z "$branch" ]; then
  echo "release-branch-finish: missing branch name" >&2
  echo "用法: bash $(basename "$0") <release-branch> [--cut --tag <vX.Y.Z>] [--root <repo>] [--remote <name>] [--no-remote] [--base <ref>] [--dry-run] [--trace <file>]" >&2
  echo "     bash $(basename "$0") --log [--trace <file>]" >&2
  exit 2
fi
if [ "$do_cut" -eq 0 ] && [ -n "$cut_tag" ]; then
  echo "release-branch-finish: --tag is only meaningful with --cut (refusing to accept a flag that would do nothing)" >&2
  exit 2
fi

# ── property 1: release names only ────────────────────────────────────────────────────────────
# Refuse anything that is not `release-<x>` / `release/<x>`. This is what keeps the command from
# being a generic branch deleter: `develop`, `master`, `task/<id>` are all refused by NAME, before
# any ref is looked at. A name with whitespace, a leading dash, or a double quote is a usage
# error, not a branch (the quote is also what keeps the finish record unforgeable).
case "$branch" in
  release-?*|release/*) : ;;
  *) echo "CAUSE=not-a-release-branch — refusing to finish '$branch': only release-* or release/* branch names are accepted (this is not a general branch deleter)" >&2; exit 2 ;;
esac
case "$branch" in
  *' '*|*$'\t'*|*..*|*'"'*) echo "CAUSE=invalid-branch-name — '$branch' contains whitespace, '..' or a double quote" >&2; exit 2 ;;
esac

# ── resolve the merge base (fail-closed: 'cannot check' is not 'merged') ──────────────────────
if [ -z "$base" ]; then
  if git -C "$repo_root" rev-parse --verify --quiet refs/heads/develop >/dev/null; then
    base="develop"
  elif git -C "$repo_root" rev-parse --verify --quiet refs/remotes/origin/develop >/dev/null; then
    base="origin/develop"
  else
    echo "CAUSE=release-branch-base-unresolvable — neither 'develop' nor 'origin/develop' resolves in $repo_root, so 'is it merged back?' cannot be answered; refusing to delete anything" >&2
    exit 2
  fi
fi
if ! git -C "$repo_root" rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "CAUSE=release-branch-base-unresolvable — --base '$base' does not resolve to a commit in $repo_root" >&2
  exit 2
fi

local_ref="refs/heads/$branch"
local_exists=0
tip_sha=""
if git -C "$repo_root" rev-parse --verify --quiet "$local_ref" >/dev/null; then
  local_exists=1
  tip_sha="$(git -C "$repo_root" rev-parse --verify "$local_ref" 2>/dev/null)"
fi

# ── --cut: the cut's landing face (merge back → tag the merge point → finish) ─────────────────
cut_form=""
if [ "$do_cut" -eq 1 ]; then
  if [ -z "$cut_tag" ]; then
    echo "CAUSE=release-branch-cut-needs-tag — --cut needs --tag <vX.Y.Z>: the merge point must be tagged, and the command will not guess a version out of the branch name" >&2
    exit 2
  fi
  case "$cut_tag" in
    *' '*|*$'\t'*|*'"'*) echo "CAUSE=release-branch-cut-invalid-tag — '$cut_tag' contains whitespace or a double quote" >&2; exit 2 ;;
  esac
  if [ "$local_exists" -eq 0 ]; then
    echo "CAUSE=release-branch-cut-no-branch — '$branch' does not exist in $repo_root; there is nothing to land" >&2
    exit 2
  fi
  if git -C "$repo_root" rev-parse --verify --quiet "refs/tags/$cut_tag" >/dev/null; then
    echo "CAUSE=release-branch-cut-tag-exists — tag '$cut_tag' already exists in $repo_root; refusing to re-point an existing version tag (delete it deliberately first if that is really what you mean)" >&2
    exit 2
  fi
  head_ref="$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null)"
  if [ "$head_ref" != "$base" ]; then
    echo "CAUSE=release-branch-cut-head-not-base — --cut merges INTO '$base', so HEAD must already be '$base' (it is '${head_ref:-detached}'); check out '$base' first (this command does not move your checkout for you)" >&2
    exit 2
  fi
  if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    echo "CAUSE=release-branch-cut-dirty-tree — tracked files are modified in $repo_root; a merge needs a clean tree (untracked files do not block it)" >&2
    exit 2
  fi
  if [ "$dry_run" -eq 1 ]; then
    echo "would-cut: merge '$branch' into '$base' (--no-ff) -> tag '$cut_tag' at the merge point -> finish (delete) '$branch'"
    echo "dry-run: no ref was touched"
    exit 0
  fi
  cut_ahead="$(git -C "$repo_root" rev-list --count "$base..$branch" 2>/dev/null)"
  if [ -z "$cut_ahead" ]; then
    echo "CAUSE=release-branch-cut-merge-check-failed — could not count $base..$branch in $repo_root; refusing to merge (an unanswerable check must not read as 'nothing to merge')" >&2
    exit 2
  fi
  if [ "$cut_ahead" -ne 0 ]; then
    # git-merge(1) runs pre-merge-commit for a --no-ff merge; a rejecting hook aborts it here,
    # and that abort is reported (never a silent merge-missing landing).
    if ! git -C "$repo_root" merge --no-ff --no-edit "$branch" >/dev/null 2>&1; then
      echo "CAUSE=release-branch-cut-merge-failed — merging '$branch' into '$base' failed in $repo_root; the tag was NOT created and the branch was NOT deleted (if the merge is left in progress, resolve or \`git merge --abort\` before retrying)" >&2
      exit 1
    fi
  fi
  merge_point="$(git -C "$repo_root" rev-parse --verify HEAD 2>/dev/null)"
  if [ -z "$merge_point" ]; then
    echo "CAUSE=release-branch-cut-merge-point-unresolvable — could not resolve HEAD after merging '$branch'" >&2
    exit 1
  fi
  if ! git -C "$repo_root" tag -a "$cut_tag" -m "release $cut_tag (SPEC §4.1 release cut)" "$merge_point" >/dev/null 2>&1; then
    echo "CAUSE=release-branch-cut-tag-failed — the merge into '$base' DID land at $merge_point, but creating tag '$cut_tag' failed; the branch is still present, so re-running the tag + finish by hand is safe" >&2
    exit 1
  fi
  echo "cut-merged: '$branch' -> '$base' at $merge_point"
  echo "cut-tagged: '$cut_tag' at $merge_point"
  cut_form="cut"
fi

# ── property 2: the SHARED compliance definition — merged into <base>, OR contained in a tag ──
# ⛔ Fail-closed: neither ⇒ refuse. That is the only shape where deleting loses work.
finish_form=""
finish_tag=""
if [ "$local_exists" -eq 1 ]; then
  ahead="$(git -C "$repo_root" rev-list --count "$base..$branch" 2>/dev/null)"
  if [ -z "$ahead" ]; then
    echo "CAUSE=release-branch-merge-check-failed — could not count $base..$branch in $repo_root; refusing to delete (an unanswerable check must not read as 'merged')" >&2
    trace_append "refused-merge-check-failed" "none" "" "" "skipped" 2
    exit 2
  fi
  if [ "$ahead" -eq 0 ]; then
    finish_form="merged"
  else
    # AC-271's second compliant form, spelled the same way the criterion spells it: the tip is
    # held by a tag ⇒ the tag (not the branch) carries those commits ⇒ deleting loses nothing.
    # Read the status on its own line (see the remote-read note below): the "cmd OR rc=status"
    # shorthand reads as a status-read after a pipe to instrument-failure-check's FAMILY-3.
    tags_out="$(git -C "$repo_root" tag --contains "$branch" 2>&1)"
    tag_rc=$?
    if [ "$tag_rc" -ne 0 ]; then
      echo "CAUSE=release-branch-tag-scan-failed — could not enumerate tags containing '$branch' in $repo_root (git tag --contains exited $tag_rc): $tags_out => 'could not look' must not be read as 'no tag holds it' (hard rule 3b)" >&2
      trace_append "refused-tag-scan-failed" "none" "" "" "skipped" 2
      exit 2
    fi
    finish_tag="$(printf '%s\n' "$tags_out" | awk 'NF { print; exit }')"
    if [ -n "$finish_tag" ]; then
      finish_form="tagged"
      echo "tag-license: '$finish_tag' contains '$branch' — its commits are held by the tag"
    else
      echo "CAUSE=release-branch-not-merged — '$branch' carries $ahead commit(s) not in $base and its tip is contained in NO tag; deleting it would lose work. Merge it back first, or run the cut's landing (--cut --tag <vX.Y.Z>) so its version tag holds the tip (AC-271 accepts either form)" >&2
      trace_append "refused-no-license" "none" "" "$tip_sha" "skipped" 3
      exit 3
    fi
  fi
fi

# ── property 3: the remote is consulted and never fails silently ──────────────────────────────
remote_has=0
if [ "$use_remote" -eq 1 ]; then
  # Read the exit status on its own line. Writing the "cmd OR rc=status" shorthand inline would be
  # read by instrument-failure-check's FAMILY-3 detector as a status-read that follows a pipe
  # character (it does not distinguish the OR operator from a pipe), which is a shrink-only
  # baseline violation and blocks the commit. There is no `set -e` here, so a failing assignment
  # simply falls through to the status read on the following line.
  remote_out="$(git -C "$repo_root" ls-remote --heads "$remote" "$local_ref" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "CAUSE=release-branch-remote-unreadable — could not read remote '$remote' in $repo_root (ls-remote exited $rc): $remote_out => 'could not look' is not 'nothing there'; refusing to report a finish" >&2
    trace_append "refused-remote-unreadable" "${finish_form:-none}" "" "$tip_sha" "remote-unreadable" 1
    exit 1
  fi
  if printf '%s\n' "$remote_out" | awk -v ref="$local_ref" '$2 == ref {found=1} END {exit !found}'; then
    remote_has=1
  fi
fi

if [ "$dry_run" -eq 1 ]; then
  if [ "$local_exists" -eq 1 ]; then
    echo "would-delete-local: $branch (license: $finish_form${finish_tag:+ via tag $finish_tag})"
  else
    echo "local-already-gone: $branch"
  fi
  if [ "$use_remote" -eq 1 ]; then
    if [ "$remote_has" -eq 1 ]; then
      echo "would-delete-remote: $remote/$branch"
    else
      echo "remote-already-clean: $remote/$branch"
    fi
  else
    echo "remote-skipped: --no-remote"
  fi
  echo "dry-run: no ref was touched"
  exit 0
fi

[ -n "$cut_form" ] && finish_form="$cut_form" && finish_tag="$cut_tag"

# ── local delete ──────────────────────────────────────────────────────────────────────────────
if [ "$local_exists" -eq 1 ]; then
  # -D (not -d): the license test above is against $base / the tag set, not against HEAD, so
  # `git branch -d` would refuse a legitimately-finished release branch whose tip is not an
  # ancestor of HEAD.
  if ! git -C "$repo_root" branch -D "$branch" >/dev/null 2>&1; then
    echo "CAUSE=release-branch-local-delete-failed — git branch -D '$branch' failed in $repo_root" >&2
    trace_append "delete-failed" "$finish_form" "$finish_tag" "$tip_sha" "skipped" 1
    exit 1
  fi
  echo "deleted-local: $branch (license: $finish_form${finish_tag:+ via tag $finish_tag})"
else
  echo "local-already-gone: $branch"
fi

# ── remote delete ─────────────────────────────────────────────────────────────────────────────
remote_result="skipped"
if [ "$use_remote" -eq 1 ]; then
  if [ "$remote_has" -eq 1 ]; then
    if ! git -C "$repo_root" push -q "$remote" --delete "$local_ref" 2>/dev/null; then
      echo "CAUSE=release-branch-remote-delete-failed — the local branch is gone but '$remote/$branch' was NOT deleted (the push --delete was rejected); re-run to retry the remote half" >&2
      trace_append "remote-delete-failed" "$finish_form" "$finish_tag" "$tip_sha" "remote-delete-failed" 1
      exit 1
    fi
    echo "deleted-remote: $remote/$branch"
    remote_result="deleted-remote"
  else
    echo "remote-already-clean: $remote/$branch"
    remote_result="remote-already-clean"
  fi
else
  echo "remote-skipped: --no-remote"
fi

trace_append "deleted-local" "$finish_form" "$finish_tag" "$tip_sha" "$remote_result" 0 || exit 1

echo "finished: $branch"
exit 0
