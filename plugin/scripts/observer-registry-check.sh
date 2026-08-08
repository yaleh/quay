#!/usr/bin/env bash
# observer-registry-check.sh — 「观测者被杀」要有观测者（gap-sweeptmp-pkill-kills-live-observers-
# two-layer-blind 候选 D / AC5）。
#
# 背景（2026-08-08 事故）：一个按进程名批量杀 session-liveness 监视器的清理命令把在用监视器当
# 泄漏残留杀光，两层同时失明，而「观测者被杀」本身没有观测者——外层靠 Monitor 报 failed、manager
# 靠重挂才回来，都是被动、且会随会话一起死的通道。本脚本把【注册表】变成主动死亡探测器：
#   - session-liveness.sh 常驻启动时写 <root>/.quay/session-liveness.<pid>.json（记录 pid/started/
#     root/targets），退出时经 trap 移除（SIGKILL 无法 trap → 文件留下 = 死亡可被发现，这正是要的）。
#   - 本脚本读注册表 + 对照 /proc，发现「已注册但进程已消失」的实例 ⇒ 该观测者死亡，非零退出并指名。
#
# 纯读契约（AC7）：只读注册表文件 + /proc，不写任何文件、不杀任何进程。
# 用法: bash plugin/scripts/observer-registry-check.sh <workspace-root> [--json]
# 退出码: 0 = 所有已注册观测者存活（或没有注册表）; 1 = 至少一个已注册观测者已消失（死亡可检测）。
set -uo pipefail

root="${1:-}"
[ -n "$root" ] || { echo "observer-registry-check: usage: $0 <workspace-root> [--json]" >&2; exit 2; }
FORMAT=human
for a in "$@"; do [ "$a" = "--json" ] && FORMAT=json; done

reg_dir="$root/.quay"
if [ ! -d "$reg_dir" ]; then
  if [ "$FORMAT" = "json" ]; then
    echo '{"ok":true,"dead":[]}'
  else
    echo "observer-registry-check: clean — no registry dir at $reg_dir (no observers registered)"
  fi
  exit 0
fi

dead=""
alive=""
for f in "$reg_dir"/session-liveness.*.json; do
  [ -e "$f" ] || continue
  pid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$f" 2>/dev/null || echo "")"
  if [ -z "$pid" ]; then
    dead="$dead $f"
    continue
  fi
  # Is <pid> still a live `bash …/session-liveness.sh` process? /proc/cmdline is authoritative.
  if python3 -c 'import sys,os
try:
    with open(f"/proc/{sys.argv[1]}/cmdline","rb") as fh: argv=fh.read().split(b"\0")
except OSError:
    sys.exit(1)
ok = len(argv) >= 2 and argv[0] == b"bash" and os.path.basename(argv[1].decode("utf-8","replace")) == "session-liveness.sh"
sys.exit(0 if ok else 1)' "$pid" 2>/dev/null; then
    alive="$alive $f"
  else
    dead="$dead $f"
  fi
done

if [ -n "$dead" ]; then
  if [ "$FORMAT" = "json" ]; then
    # build {"ok":false,"dead":["<f>", ...]}
    items=""
    for f in $dead; do
      items="$items\"$f\","
    done
    printf '{"ok":false,"dead":[%s]}\n' "${items%,}"
  else
    echo "observer-registry-check: FAIL — registered observer(s) gone (observer was killed by a name-based cleanup / crash; no passive Monitor to notice):" >&2
    for f in $dead; do echo "  DEAD  $f" >&2; done
    echo "observer-registry-check: alive:${alive:-none}" >&2
  fi
  exit 1
fi

if [ "$FORMAT" = "json" ]; then
  echo '{"ok":true,"dead":[]}'
else
  echo "observer-registry-check: clean — all $(echo -n "$alive" | wc -w) registered observer(s) alive"
fi
exit 0
