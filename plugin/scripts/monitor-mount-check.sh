#!/usr/bin/env bash
# monitor-mount-check.sh — 监视器是否真的挂上、挂对目标、事件是否真的送达。
#
# 三条判据（gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right + AC9 改写）：
#   1. mounted             — /proc 里有 argv 前两 token 精确等于 `bash <本仓>/plugin/scripts/inner-state.sh`
#                            的进程。容忍 N>1：一个逻辑 monitor 每轮起子 shell（实测 2 个 pid）。
#   2. targetRoot          — 有效根 = argv 脚本路径的 ../..，除非 /proc/<pid>/environ 有
#                            INNER_STATE_WORK_ROOT 覆盖（后者同样可读）。「挂在别的项目上」在 argv 里就看得见。
#   3. delivered（AC9，2026-08-03 取代 ownedByThisSession）— 【事件是否真的送达】：共享事件文件
#      $QUAY_GLOBAL_DIR/session-liveness/events.jsonl 有新事件（mtime 新鲜 / REPO-STALL 可见）。
#      判据不是「是不是本会话挂的」——AC20c 的设计正是一方挂载、多方订阅：别的会话挂的、投递正常
#      也必须判 PASS；无人挂载 ⇒ 必须判 FAIL（两个方向都是硬判据）。
#      真实投递已由 REPO-STALL 事件证明过；旧判据沿 ppid 链比对 claude 进程，把别的会话挂的成功
#      挂载一律判 false——判据比现实严，与「事件送得到」不符。
#
# 纯读契约（AC7，与 inner-state.sh 的纯读契约同源）：本脚本只读 /proc 与共享事件文件，
# 不写任何文件。观测命令不得改变被观测对象。全部 /proc 扫描在单个 python3 进程内完成，
# 不为每个 pid 起子进程。
#
# 不自匹配（AC2）：谓词是 argv 前两 token 精确等于 `bash <绝对路径>`，不是子串——子串会匹配到发起
# 查询的命令自己（外层验证可行性时当场踩过；tick 文档步骤 0 记的 pgrep -f 自匹配是同一个坑）。
#
# 测试接缝：MONITOR_CHECK_INNER_STATE 覆盖要匹配的脚本路径（默认本仓 plugin/scripts/inner-state.sh）；
# MONITOR_CHECK_EVENTS_FILE 覆盖共享事件文件（默认 $QUAY_GLOBAL_DIR/session-liveness/events.jsonl）；
# MONITOR_DELIVERY_FRESH_S 覆盖「多久没新事件判 FAIL」的窗口（默认 300）。生产调用不设 → 行为不变。
#
# 用法: bash plugin/scripts/monitor-mount-check.sh [--json]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INNER_STATE="${MONITOR_CHECK_INNER_STATE:-$SCRIPT_DIR/inner-state.sh}"
# 本仓根 = inner-state 脚本所在目录的 ../..（与 inner-state.sh 的 BASH_SOURCE 自定位同构）。
INNER_STATE_DIR="$(cd "$(dirname "$INNER_STATE")" && pwd)"
REPO_ROOT="$(cd "$INNER_STATE_DIR/../.." && pwd)"
# 共享事件文件（AC20c/AC9）：事件写进这里，订阅与挂载分离——交付判据看它，不看「是不是我挂的」。
SL_GLOBAL_DIR="${SESSION_LIVENESS_GLOBAL_DIR:-${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}/session-liveness}"
EVENTS_FILE="${MONITOR_CHECK_EVENTS_FILE:-$SL_GLOBAL_DIR/events.jsonl}"
DELIVERY_FRESH_S="${MONITOR_DELIVERY_FRESH_S:-300}"

FORMAT=human
for a in "$@"; do [ "$a" = "--json" ] && FORMAT=json; done

MMC_INNER_STATE="$INNER_STATE" MMC_REPO_ROOT="$REPO_ROOT" MMC_FORMAT="$FORMAT" \
MMC_EVENTS_FILE="$EVENTS_FILE" MMC_DELIVERY_FRESH_S="$DELIVERY_FRESH_S" python3 - <<'PY'
import json, os, glob, time

INNER_STATE = os.environ["MMC_INNER_STATE"]
REPO_ROOT = os.environ["MMC_REPO_ROOT"]
FMT = os.environ["MMC_FORMAT"]
EVENTS_FILE = os.environ["MMC_EVENTS_FILE"]
DELIVERY_FRESH_S = int(os.environ["MMC_DELIVERY_FRESH_S"])


def read_cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().split(b"\0")
    except OSError:
        return []


def work_root(pid):
    default_root = os.path.normpath(os.path.join(os.path.dirname(INNER_STATE), "..", ".."))
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            environ = f.read()
    except OSError:
        return default_root
    for kv in environ.split(b"\0"):
        if kv.startswith(b"INNER_STATE_WORK_ROOT="):
            return kv.split(b"=", 1)[1].decode("utf-8", "replace")
    return default_root


def last_event_of(path):
    """返回共享事件文件最后一条的 event 字段（如 SESSION-OVERDUE / HEARTBEAT）与 ts，读不到返回空。"""
    try:
        with open(path, "rb") as f:
            line = f.readlines()[-1]
        for tok in line.split(b","):
            if tok.startswith(b'"event":'):
                return tok.split(b":", 1)[1].strip().strip(b'"').decode("utf-8", "replace")
    except (OSError, IndexError):
        pass
    return ""


targets = []
for d in glob.glob("/proc/[0-9]*"):
    pid = int(os.path.basename(d))
    argv = read_cmdline(pid)
    if len(argv) >= 2 and argv[0] == b"bash" and argv[1].decode("utf-8", "replace") == INNER_STATE:
        root = work_root(pid)
        targets.append({
            "pid": pid,
            "targetRoot": root,
        })

targets.sort(key=lambda t: t["pid"])
mounted = bool(targets)
target_root = targets[0]["targetRoot"] if targets else ""
target_ok = bool(targets) and all(t["targetRoot"] == REPO_ROOT for t in targets)

# AC9 交付判据：共享事件文件有新事件（mtime 新鲜）。文件 mtime 随每轮 HEARTBEAT 更新，
# 所以「新鲜」= 持有者活着且在投递；「陈旧/不存在」= 无人挂载或看门的已死 ⇒ FAIL。
events_mtime = 0
events_fresh = False
last_event = ""
if os.path.exists(EVENTS_FILE):
    try:
        events_mtime = int(os.path.getmtime(EVENTS_FILE))
        events_fresh = (time.time() - events_mtime) <= DELIVERY_FRESH_S
        last_event = last_event_of(EVENTS_FILE)
    except OSError:
        pass
delivered = events_fresh

if FMT == "json":
    print(json.dumps({
        "mounted": mounted,
        "targetRoot": target_root,
        "targetOk": target_ok,
        "delivered": delivered,
        "eventsFresh": events_fresh,
        "eventsMtime": events_mtime,
        "lastEvent": last_event,
        "repoRoot": REPO_ROOT,
        "innerState": INNER_STATE,
        "eventsFile": EVENTS_FILE,
        "pids": [t["pid"] for t in targets],
        "targets": targets,
    }, ensure_ascii=False, indent=2))
else:
    print(f"mounted={str(mounted).lower()}")
    print(f"targetRoot={target_root}")
    print(f"targetOk={str(target_ok).lower()}")
    print(f"delivered={str(delivered).lower()}")
    print(f"eventsFresh={str(events_fresh).lower()}")
    print(f"lastEvent={last_event}")
    print(f"eventsFile={EVENTS_FILE}")
    for t in targets:
        print(f"  pid {t['pid']}: targetRoot={t['targetRoot']}")
PY
