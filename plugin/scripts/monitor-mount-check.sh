#!/usr/bin/env bash
# monitor-mount-check.sh — 外层挂的 Monitor 是否真的挂上、挂对目标、属于本会话。
#
# 三条判据（gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right）：
#   1. mounted             — /proc 里有 argv 前两 token 精确等于 `bash <本仓>/plugin/scripts/inner-state.sh`
#                            的进程。容忍 N>1：一个逻辑 monitor 每轮起子 shell（实测 2 个 pid）。
#   2. targetRoot          — 有效根 = argv 脚本路径的 ../..，除非 /proc/<pid>/environ 有
#                            INNER_STATE_WORK_ROOT 覆盖（后者同样可读）。「挂在别的项目上」在 argv 里就看得见。
#   3. ownedByThisSession  — 沿每个匹配 pid 的 ppid 链找最近的 claude 进程，与本进程（$$）的链比对。
#                            同一个 claude pid ⇒ 属于本会话。上一个会话遗留的进程显示「活着」，但事件
#                            送不到现在这个会话——这条判据就是为了区分。
#
# 纯读契约（AC7，与 inner-state.sh 的纯读契约同源）：本脚本只读 /proc（及 git——当前实现只用 /proc），
# 不写任何文件。观测命令不得改变被观测对象。全部 /proc 扫描在单个 python3 进程内完成，
# 不为每个 pid 起子进程。
#
# 不自匹配（AC2）：谓词是 argv 前两 token 精确等于 `bash <绝对路径>`，不是子串——子串会匹配到发起
# 查询的命令自己（外层验证可行性时当场踩过；tick 文档步骤 0 记的 pgrep -f 自匹配是同一个坑）。
#
# 测试接缝：MONITOR_CHECK_INNER_STATE 覆盖要匹配的 inner-state 脚本路径（默认本仓
# plugin/scripts/inner-state.sh）；MONITOR_CHECK_SELF_PID 覆盖「本会话」起点 pid（默认 $$）。
# 生产调用不设这两个变量 → 行为不变。
#
# 用法: bash plugin/scripts/monitor-mount-check.sh [--json]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INNER_STATE="${MONITOR_CHECK_INNER_STATE:-$SCRIPT_DIR/inner-state.sh}"
# 本仓根 = inner-state 脚本所在目录的 ../..（与 inner-state.sh 的 BASH_SOURCE 自定位同构）。
INNER_STATE_DIR="$(cd "$(dirname "$INNER_STATE")" && pwd)"
REPO_ROOT="$(cd "$INNER_STATE_DIR/../.." && pwd)"
SELF_PID="${MONITOR_CHECK_SELF_PID:-$$}"

FORMAT=human
for a in "$@"; do [ "$a" = "--json" ] && FORMAT=json; done

MMC_INNER_STATE="$INNER_STATE" MMC_REPO_ROOT="$REPO_ROOT" MMC_SELF_PID="$SELF_PID" MMC_FORMAT="$FORMAT" python3 - <<'PY'
import json, os, glob

INNER_STATE = os.environ["MMC_INNER_STATE"]
REPO_ROOT = os.environ["MMC_REPO_ROOT"]
SELF_PID = int(os.environ["MMC_SELF_PID"])
FMT = os.environ["MMC_FORMAT"]


def read_cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().split(b"\0")
    except OSError:
        return []


def read_ppid(pid):
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            stat = f.read()
    except OSError:
        return None
    # comm 字段可能含空格/括号——从最后一个 ')' 之后解析；fields[0]=state, fields[1]=ppid。
    fields = stat[stat.rfind(b")") + 2:].split()
    if len(fields) < 2:
        return None
    try:
        return int(fields[1])
    except ValueError:
        return None


def nearest_claude(pid):
    cur = pid
    for _ in range(64):
        cmd = read_cmdline(cur)
        if not cmd:
            break
        if b"claude" in b" ".join(cmd):
            return str(cur)
        pp = read_ppid(cur)
        if pp is None or pp == cur or pp == 0:
            break
        cur = pp
    return ""


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


my_claude = nearest_claude(SELF_PID)

targets = []
for d in glob.glob("/proc/[0-9]*"):
    pid = int(os.path.basename(d))
    argv = read_cmdline(pid)
    if len(argv) >= 2 and argv[0] == b"bash" and argv[1].decode("utf-8", "replace") == INNER_STATE:
        root = work_root(pid)
        mc = nearest_claude(pid)
        targets.append({
            "pid": pid,
            "targetRoot": root,
            "owned": bool(my_claude and mc and mc == my_claude),
        })

targets.sort(key=lambda t: t["pid"])
mounted = bool(targets)
target_root = targets[0]["targetRoot"] if targets else ""
target_ok = bool(targets) and all(t["targetRoot"] == REPO_ROOT for t in targets)
owned = bool(targets) and all(t["owned"] for t in targets)
session_claude = my_claude or None

if FMT == "json":
    print(json.dumps({
        "mounted": mounted,
        "targetRoot": target_root,
        "targetOk": target_ok,
        "ownedByThisSession": owned,
        "repoRoot": REPO_ROOT,
        "innerState": INNER_STATE,
        "sessionClaudePid": session_claude,
        "pids": [t["pid"] for t in targets],
        "targets": targets,
    }, ensure_ascii=False, indent=2))
else:
    print(f"mounted={str(mounted).lower()}")
    print(f"targetRoot={target_root}")
    print(f"targetOk={str(target_ok).lower()}")
    print(f"ownedByThisSession={str(owned).lower()}")
    for t in targets:
        print(f"  pid {t['pid']}: targetRoot={t['targetRoot']} owned={str(t['owned']).lower()}")
    if session_claude:
        print(f"sessionClaudePid={session_claude}")
PY
