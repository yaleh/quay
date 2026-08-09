#!/usr/bin/env bash
# inbox-reader.sh — the CONSUMER MECHANICAL MOUNT POINT for the human channel's inbox
# (tasks/gap-message-bus-human-third-target-transport-agnostic, AC4/AC5/AC6).
#
# The message bus's human target (packages/quay/src/message-bus.ts) DELIVERS by writing a
# timestamped, seq-numbered JSON record to `.quay/manager-inbox/`. A delivered message is NOT a
# read message (AC3: delivered ≠ consciousness-received). This script is the first-class consumer
# that turns `delivered` into `consumed`: it reads every delivered-but-unconsumed record, marks it
# consumed with a receipt timestamp, and prints one `read <id> …` line per message.
#
# It is the "mechanical mount point" the ordering hard-constraint demands — without it the inbox
# degenerates back to "3 messages on disk, nobody reads" (the failure form this task exists to kill).
#
# CONTRACT measure (from the task's ## Contract block):
#   delivered_vs_read = `bash <inbox-reader.sh> 2>&1 | grep -c 'read\|consumed'`
# Each consumed message emits EXACTLY ONE line containing the word `read`, so the count equals the
# number of messages this mount point actually consumed. The trailing `measurement-protocol:` line
# (AC6) deliberately contains neither `read` nor `consumed`, so it can never inflate the count.
#
# Usage:
#   bash inbox-reader.sh [--inbox <dir>] [--dry-run] [--json] [--help]
#   --inbox <dir>   read/write this inbox directory (default: <repo-root>/.quay/manager-inbox/)
#   --dry-run       report what WOULD be consumed without writing any file
#   --json          emit one JSON object instead of human lines
#   --help          show this usage
#
# Exit status: 0 on success; 1 on a hard error (inbox missing and not creatable). An empty inbox
# (nothing to read) is success with zero `read` lines — the CONTRACT band delivered_vs_read >= 1 is
# then legitimately false until a reader actually reads something.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# Self-locate (works in the repo AND in an installed target project):
SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"

# Resolve the repo root: the inbox default is <repo-root>/.quay/manager-inbox/. Walk up from
# SELF_DIR until we find a `.git` marker (or the filesystem root).
repo_root=""
d="$SELF_DIR"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ -d "$d/.git" ]; then
    repo_root="$d"
    break
  fi
  d="$(dirname "$d")"
done
[ -z "$repo_root" ] && repo_root="$SELF_DIR"

inbox="${QUAY_MANAGER_INBOX:-$repo_root/.quay/manager-inbox}"
dry_run=0
json=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --inbox) shift; inbox="$1" ;;
    --dry-run) dry_run=1 ;;
    --json) json=1 ;;
    --help|-h) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "inbox-reader: unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# The mount point must exist to be read. Create it if absent (deliver() also creates it); a
# non-creatable path is the one hard failure.
if [ ! -d "$inbox" ]; then
  if ! mkdir -p "$inbox" 2>/dev/null; then
    echo "inbox-reader: ERROR cannot create inbox directory: $inbox" >&2
    exit 1
  fi
fi

# Mark-unconsumed + receipt, via a small node inline (JSON transform is node's job).
# Every consumed message emits EXACTLY ONE line (the Contract measure's grep target):
#   newly consumed this run → a line containing `read`
#   already consumed (prior run) → a line containing `consumed`
# so `delivered_vs_read = grep -c "read|consumed"` = the total number of messages this mount
# point has consumed — stable at >= 1 once the reader has proven itself, never inflated by the
# protocol line (which contains neither word).
node -e '
const fs = require("fs");
const path = require("path");
const inbox = process.argv[1];
const dryRun = process.argv[2] === "1";
const json = process.argv[3] === "1";
let files = [];
try { files = fs.readdirSync(inbox).filter(f => f.endsWith(".json")).sort(); } catch { files = []; }
const readLines = [];
const consumedLines = [];
for (const f of files) {
  const p = path.join(inbox, f);
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
  const id = rec && rec.id ? rec.id : f;
  const meta = `seq=${rec && rec.seq != null ? rec.seq : "?"} from=${rec && rec.from ? rec.from : "?"} deliveredAt=${rec && rec.deliveredAt ? rec.deliveredAt : "?"} target=${rec && rec.target ? rec.target : "human"}`;
  if (rec && rec.consumed === true) {
    // already consumed — idempotent, but REPORT the receipt so the Contract measure stays stable.
    consumedLines.push(`consumed ${id} ${meta}`);
    continue;
  }
  const now = new Date().toISOString();
  if (!dryRun && rec) {
    rec.consumed = true;
    rec.consumedAt = now;
    try { fs.writeFileSync(p, JSON.stringify(rec, null, 2) + "\n", "utf8"); } catch (e) { continue; }
  }
  readLines.push(`read ${id} ${meta}`);
}
// AC6 fail-safe protocol line — deliberately contains NEITHER "read" NOR "consumed" so the
// Contract measure (grep -c "read|consumed") counts only actual consumption, never this line.
const protocol = "measurement-protocol: unattended-interval estimate is valid only when humans communicate exclusively through this inbox channel (bypassing the channel overestimates the unattended interval; AC6 fail-safe)";
const total = readLines.length + consumedLines.length;
if (json) {
  console.log(JSON.stringify({ read: total, newly_read: readLines.length, consumed: consumedLines.length, messages: readLines.concat(consumedLines), protocol }));
} else {
  for (const l of readLines) console.log(l);
  for (const l of consumedLines) console.log(l);
  console.log(protocol);
}
' "$inbox" "$dry_run" "$json"
