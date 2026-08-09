#!/usr/bin/env bash
# supervisor-observe.sh — the supervisor base layer's OBSERVATION interface
# (tasks/gap-cross-machine-readonly-observation-orchestration-not-a-tool).
#
# observe(target) -> {git_state, suite_state, session_state, process_state}
#   READ-ONLY, ssh-transport-agnostic, local/remote SAME shape.
#   --host local       gather state on this machine
#   --host <hostname>  ssh to <hostname> and gather state there (self-transports the script
#                      over ssh — the remote runs this same script with --host local)
#
# This is the READ-side counterpart to supervisor-deliver.sh (the crystallized WRITE side).
# supervisor-deliver.sh's own header says it best: the ONE unreliable operation goes from
# "3 agents each hand-write" to "one hardened implementation". The read side was never
# crystallized — every time the manager wanted a cross-host target's state, it hand-assembled
# ssh+git+capture-pane+/proc per call, all night, with real mistakes. This adapter is the
# narrow interface: a consumer that wants a target's git/suite/session/process state calls
# THIS and learns the state. No consumer hand-writes an ssh+git+capture-pane sequence.
#
# The FOUR error classes from the filing night, each baked in (negative controls live in
# plugin/test/supervisor-observe.test.mjs):
#   1. fetch-before-compare   git_state ALWAYS runs `git fetch` against the branch's remote
#     BEFORE computing ahead/behind. A stale remote-tracking ref (12 behind reported as 0)
#     is impossible — the refresh is part of the read. The fetch updates ONLY remote-tracking
#     refs (refs/remotes/*, FETCH_HEAD); it never touches the working tree, HEAD, or any
#     local branch. THIS is observe()'s only "write" to the target, and it is the refresh
#     the Contract (fetch_before_compare) mandates.
#   2. HEAD-vs-branch        git_state ALWAYS NAMES the branch it compares (git symbolic-ref
#     --short HEAD, or --branch <name>) and compares <branch> against <branch>'s OWN
#     configured upstream (origin/<branch> when no explicit upstream). It never compares
#     HEAD-as-one-branch against another branch — the manager compared origin/master with
#     master while meaning develop. observe() reports branch/upstream/comparedRef so what
#     was compared is never ambiguous.
#   3. monitor-cache-stale    session_state ALWAYS reads tmux LIVE at call time (tmux
#     list-sessions / list-windows / list-panes). It NEVER reads a Monitor's cached stdout
#     stream — observe() is a point-in-time probe, fresh every call, so a 5-minute-poll
#     Monitor can never report a stale topology.
#   4. process-comm-field-match  process_state scans /proc directly in ONE python3 process.
#     No pgrep/grep field matching at all: /proc/<pid>/comm is the kernel's exact comm
#     (already truncated to 15 chars — never `awk $2` on a `ps` line, which misses on comm
#     truncation), /proc/<pid>/cmdline is the full argv. The observer's own process tree is
#     excluded (a pgrep -c self-match is impossible). The match is: comm == pattern (exact)
#     OR basename(argv[0]) == pattern — a mere substring in a path (`~/.claude/...`) does NOT
#     match (the pgrep -af too-broad failure). Both the exact comm and the full cmdline are
#     reported so the caller can verify the match.
#
# Usage:
#   bash supervisor-observe.sh observe --host <local|hostname> --root <path> \
#        [--branch <branch>] [--comm <pattern>] [--json]
#   --host <local|hostname>  "local" = this machine; any other value = ssh to it
#   --root <path>            the target quay checkout to observe (default: this script's ../..)
#   --branch <branch>        override which branch's git_state to compare (default: current branch)
#   --comm <pattern>         process comm/cmdline pattern (default: claude)
#   --json                   machine-readable JSON (the four-field shape)
# Exit: 0 always (observation either succeeded or reported ok:false per-field; a non-git root
#        or tmux-less host is a FIELD result, not a crash)
#
# Env (test seams):
#   OBSERVE_SKIP_FETCH=1   skip the git fetch (hermetic tests that cannot network). NOT the
#                          default — production MUST fetch-before-compare (Contract control).
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

# Self-location. When the script is transported over ssh and run via `bash -s` (stdin), $0 is
# "bash" and BASH_SOURCE[0] is unbound — guard both so the transported instance (which always
# receives an explicit --root) degrades gracefully instead of tripping set -u.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
REPO_ROOT=""
if [ -n "$SCRIPT_DIR" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

printf 'supervisor-observe: starting pid=%s file=%s md5=%s\n' \
  "$$" "$(basename "${BASH_SOURCE[0]:-stdin}")" "$(md5sum "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | cut -c1-16)" >&2

usage() {
  sed -n '1,64p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ── arg parse ──────────────────────────────────────────────────────────────────────────────────────
CMD="${1:-}"
[ -n "$CMD" ] || { usage; exit 2; }
shift || true
HOST="local"
ROOT=""
BRANCH=""
COMM="claude"
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --host)  [ $# -ge 2 ] || { echo "supervisor-observe: --host needs a value" >&2; exit 2; }; HOST="$2"; shift 2 ;;
    --root)  [ $# -ge 2 ] || { echo "supervisor-observe: --root needs a value" >&2; exit 2; }; ROOT="$2"; shift 2 ;;
    --branch) [ $# -ge 2 ] || { echo "supervisor-observe: --branch needs a value" >&2; exit 2; }; BRANCH="$2"; shift 2 ;;
    --comm)  [ $# -ge 2 ] || { echo "supervisor-observe: --comm needs a value" >&2; exit 2; }; COMM="$2"; shift 2 ;;
    --json)  JSON=1; shift ;;
    -h|--help) usage ;;
    *) echo "supervisor-observe: unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$CMD" in
  observe) : ;;
  *) echo "supervisor-observe: unknown command: $CMD (expected: observe)" >&2; exit 2 ;;
esac

[ -n "$ROOT" ] || ROOT="$REPO_ROOT"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "supervisor-observe: --root $ROOT is not a directory" >&2; exit 2; }

# ── remote transport (ssh-transport-agnostic: same shape, --host decides the wrapper) ──────────────
# For --host <hostname>: pipe THIS script over ssh and run it remotely with --host local.
# `bash -s --` reads the script from stdin and assigns the trailing args to $1.. — so the
# remote instance parses exactly like a local call. ssh quotes each argument, so a --root with
# spaces survives. The remote instance self-locates REPO_ROOT from its own (transported) path,
# but --root always overrides.
if [ "$HOST" != "local" ]; then
  args=(observe --host local)
  [ -n "$ROOT" ] && args+=(--root "$ROOT")
  [ -n "$BRANCH" ] && args+=(--branch "$BRANCH")
  args+=(--comm "$COMM")
  [ "$JSON" = 1 ] && args+=(--json)
  # shellcheck disable=SC2029
  exec ssh "$HOST" "bash -s --" "${args[@]}" < "$0"
fi

# ── git_state (fetch-before-compare + named-branch comparison) ─────────────────────────────────────
git_state_json() {
  local root="$1" branch="$2"
  local gb head remote upstream compared ahead behind dirty err
  # Determine the branch to inspect: explicit --branch wins; else the current branch.
  if [ -n "$branch" ]; then
    if git -C "$root" rev-parse --verify -q "refs/heads/$branch" >/dev/null 2>&1; then
      gb="$branch"
    else
      printf '{"ok":false,"error":"branch %s not found in %s"}\n' "$branch" "$root"
      return 0
    fi
  else
    gb="$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null)" || {
      printf '{"ok":false,"error":"%s is not a git checkout"}\n' "$root"
      return 0
    }
  fi
  head="$(git -C "$root" rev-parse --short "refs/heads/$gb" 2>/dev/null)" || head=""
  # The branch's own remote (never guessed): branch.<name>.remote, else origin if it exists.
  remote="$(git -C "$root" config "branch.$gb.remote" 2>/dev/null || true)"
  [ -n "$remote" ] || remote="origin"
  if [ "${OBSERVE_SKIP_FETCH:-0}" != "1" ] && git -C "$root" config --get "remote.$remote.url" >/dev/null 2>&1; then
    # fetch-before-compare (error class 1): refresh remote-tracking refs BEFORE reading them.
    git -C "$root" fetch --quiet "$remote" 2>/dev/null || true
  fi
  # The comparison ref: the branch's configured upstream, else origin/<branch>.
  # `$gb@{upstream}` (not `refs/heads/$gb@{upstream}` — the refs/heads/ prefix breaks the
  # @{upstream} syntax) resolves the branch's own configured upstream.
  upstream="$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name "$gb@{upstream}" 2>/dev/null || true)"
  ahead=""; behind=""
  if [ -n "$upstream" ]; then
    compared="$upstream"
    read -r ahead behind <<< "$(git -C "$root" rev-list --left-right --count "$gb...$upstream" 2>/dev/null || echo "0 0")"
  elif git -C "$root" rev-parse --verify -q "refs/remotes/origin/$gb" >/dev/null 2>&1; then
    compared="origin/$gb"
    read -r ahead behind <<< "$(git -C "$root" rev-list --left-right --count "$gb...origin/$gb" 2>/dev/null || echo "0 0")"
  else
    compared="none (no upstream for $gb)"
    ahead="null"; behind="null"
  fi
  dirty=0
  [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ] && dirty=1
  printf '{"ok":true,"branch":"%s","head":"%s","remote":"%s","upstream":%s,"comparedRef":"%s","ahead":%s,"behind":%s,"dirty":%s}\n' \
    "$gb" "$head" "$remote" \
    "$([ -n "$upstream" ] && printf '"%s"' "$upstream" || printf 'null')" \
    "$compared" "$ahead" "$behind" "$dirty"
}

# ── suite_state (.quay/full-suite-state.json — the well-known red-window state file) ───────────────
suite_state_json() {
  local root="$1" f
  f="$root/.quay/full-suite-state.json"
  if [ ! -f "$f" ]; then
    printf '{"ok":true,"state":"absent"}\n'
    return 0
  fi
  if python3 - "$f" <<'PY'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        d = json.load(fh)
except Exception as e:
    print(json.dumps({"ok": False, "error": f"unparseable {sys.argv[1]}: {e}"}, ensure_ascii=False))
    sys.exit(0)
out = {"ok": True}
for k in ("state", "reason", "runner", "startedAt", "finishedAt", "durationMs", "laneCount"):
    if k in d:
        out[k] = d[k]
print(json.dumps(out, ensure_ascii=False))
PY
  then :; fi
}

# ── session_state (LIVE tmux topology — error class 3: never a Monitor's cached stream) ────────────
# Reuses the pane-pid→claude-subtree judgment topology-check.sh's has_claude_child uses, but as a
# point-in-time probe. Reads tmux directly at call time; no cache file, no state file, no Monitor
# stream is ever consulted.
_session_has_claude() {
  local pid="$1" cmd c
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  case "$cmd" in *claude*) return 0 ;; esac
  for c in $(pgrep -P "$pid" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$c/cmdline" 2>/dev/null || true)"
    case "$cmd" in *claude*) return 0 ;; esac
  done
  return 1
}

session_state_json() {
  local root="$1" sess wname npanes pane_pid line
  if ! command -v tmux >/dev/null 2>&1; then
    printf '{"ok":false,"error":"tmux not available on this host"}\n'
    return 0
  fi
  local sessions_json=""
  local first=1
  while IFS= read -r sess; do
    [ -n "$sess" ] || continue
    local windows_json="" wfirst=1 claude=0
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      wname="${line%%	*}"; npanes="${line##*	}"
      # claude presence: any pane in the window whose process subtree is claude
      claude=0
      for pane_pid in $(tmux list-panes -t "$sess:$wname" -F '#{pane_pid}' 2>/dev/null); do
        if _session_has_claude "$pane_pid"; then claude=1; break; fi
      done
      [ "$wfirst" = 1 ] || windows_json="$windows_json,"
      wfirst=0
      windows_json="$windows_json{\"name\":\"$wname\",\"panes\":$npanes,\"claude\":$claude}"
    done < <(tmux list-windows -t "$sess" -F '#{window_name}	#{window_panes}' 2>/dev/null)
    [ "$first" = 1 ] || sessions_json="$sessions_json,"
    first=0
    sessions_json="$sessions_json{\"name\":\"$sess\",\"windows\":[$windows_json]}"
  done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null)
  if [ -z "$sessions_json" ]; then
    printf '{"ok":true,"tmuxAvailable":true,"sessions":[]}\n'
    return 0
  fi
  printf '{"ok":true,"tmuxAvailable":true,"sessions":[%s]}\n' "$sessions_json"
}

# ── process_state (single python3 /proc scan — error class 4: no pgrep/grep field matching) ───────
process_state_json() {
  local pattern="$1"
  OBSERVE_COMM="$pattern" OBSERVE_SELF_PID="$$" python3 - <<'PY'
import json, os, time

PATTERN = os.environ.get("OBSERVE_COMM", "claude") or ""
SELF = {os.environ.get("OBSERVE_SELF_PID", ""), str(os.getpid())}
SELF.discard("")

CLK_TCK = float(os.sysconf("SC_CLK_TCK"))


def ppid_of(pid):
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            st = f.read()
        idx = st.rfind(b")")
        return st[idx + 2 :].split()[1].decode("ascii", "replace")
    except (OSError, IndexError, ValueError):
        return None


def is_observer_tree(pid):
    """True if the process IS the observer (bash script / python3) or a DESCENDANT of it.
    Walking the ancestor chain: any ancestor in SELF ⇒ this process is part of the observer's
    own tree and must never match (the pgrep -c self-match error class)."""
    seen = set()
    cur = pid
    for _ in range(64):
        if cur in SELF:
            return True
        if cur in seen or cur == "1" or not cur.isdigit():
            return False
        seen.add(cur)
        cur = ppid_of(cur)
        if cur is None:
            return False
    return False


def comm_of(pid):
    try:
        with open(f"/proc/{pid}/comm", "rb") as f:
            return f.read().decode("utf-8", "replace").strip()
    except OSError:
        return ""


def cmdline_of(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            raw = f.read()
        return " ".join(a.decode("utf-8", "replace") for a in raw.split(b"\0"))
    except OSError:
        return ""


def stat_fields(pid):
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            st = f.read()
        idx = st.rfind(b")")
        return st[idx + 2 :].split()
    except (OSError, IndexError):
        return []


btime = None
try:
    with open("/proc/stat", encoding="utf-8") as f:
        for line in f:
            if line.startswith("btime "):
                btime = int(line.split()[1])
                break
except OSError:
    pass

now = time.time()
results = []
for d in sorted(os.listdir("/proc")):
    if not d.isdigit():
        continue
    if is_observer_tree(d):
        continue
    comm = comm_of(d)
    cmd = cmdline_of(d)
    if not comm and not cmd:
        continue
    # Match rule (error class 4 — the hardened field match, never a raw `pgrep -f` substring):
    #   * comm == PATTERN            — the kernel's exact comm (already 15-char truncated; compare
    #                                  the truncated value exactly — never `awk $2` on a `ps` line);
    #   * basename(argv[0]) == PATTERN — the CLI binary itself (argv[0], not a later arg).
    # A process that merely CONTAINS PATTERN in a path (e.g. `source /home/yale/.claude/...`)
    # does NOT match — that was the `pgrep -af 'claude'` too-broad failure (the -c self-match is
    # handled separately by is_observer_tree; the path false-positive by THIS rule).
    argv0 = cmd.split()[0] if cmd else ""
    argv0base = argv0.rsplit("/", 1)[-1] if argv0 else ""
    matched = bool(PATTERN) and (comm == PATTERN or argv0base == PATTERN)
    if not matched:
        continue
    fields = stat_fields(d)
    start = None
    cpu_sec = None
    if len(fields) > 19:
        try:
            start = float(fields[19])
            utime = float(fields[11])
            stime = float(fields[12])
            cpu_sec = (utime + stime) / CLK_TCK
        except (ValueError, IndexError):
            pass
    elapsed = None
    if start is not None and btime is not None:
        elapsed = now - btime - start / CLK_TCK
        if elapsed < 0:
            elapsed = None
    cpu_pct = None
    if cpu_sec is not None and elapsed:
        cpu_pct = round(cpu_sec / elapsed * 100, 1)
    results.append({
        "pid": int(d),
        "comm": comm,
        "cmdline": cmd[:200],
        "elapsed_s": round(elapsed, 1) if elapsed is not None else None,
        "cpu_sec": round(cpu_sec, 2) if cpu_sec is not None else None,
        "cpu_pct": cpu_pct,
    })

results.sort(key=lambda p: p["pid"])
print(json.dumps(results))
PY
}

# ── assemble ────────────────────────────────────────────────────────────────────────────────────────
tmp="$(mktemp -d)"
git_state_json "$ROOT" "$BRANCH" > "$tmp/git"
suite_state_json "$ROOT" > "$tmp/suite"
session_state_json "$ROOT" > "$tmp/session"
process_state_json "$COMM" > "$tmp/process"

HOST_LABEL="local"
if [ "$JSON" = 1 ]; then
  HOST_LABEL="$HOST_LABEL" GIT_F="$(cat "$tmp/git")" SUITE_F="$(cat "$tmp/suite")" \
  SESSION_F="$(cat "$tmp/session")" PROCESS_F="$(cat "$tmp/process")" python3 - <<'PY'
import json, os
out = {
    "host": os.environ["HOST_LABEL"],
    "observedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    "git_state": json.loads(os.environ["GIT_F"]),
    "suite_state": json.loads(os.environ["SUITE_F"]),
    "session_state": json.loads(os.environ["SESSION_F"]),
    "process_state": json.loads(os.environ["PROCESS_F"]),
}
print(json.dumps(out, ensure_ascii=False))
PY
else
  echo "host=$HOST_LABEL root=$ROOT"
  echo "--- git_state ---"; cat "$tmp/git"
  echo "--- suite_state ---"; cat "$tmp/suite"
  echo "--- session_state ---"; cat "$tmp/session"
  echo "--- process_state ---"; cat "$tmp/process"
fi
rm -rf "$tmp"
exit 0
