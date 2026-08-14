#!/usr/bin/env bash
# monitor-mount-check.sh — 监视器是否真的挂上、挂对目标。
#
# 观测只有一个工具（SPEC-one-observer-two-surfaces.md，gap-retire-inner-state-one-observer-
# targets-by-parameter AC1）：`session-liveness.sh`。inner-state.sh 已退役——它不观测会话
# （tmux 命中 0），它的招牌信号 .quay/inner-blocked.json 在三个项目里从未产生。本检查器
# 不再把 `inner-state` 挂载当成通过条件。
#
# 两条判据（gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right；2026-08-06 人裁定
# gap-session-liveness-remove-shared-events-and-lock 移除第三条共享事件交付判据）：
#   1. mounted             — /proc 里有 argv[0..1] 为 `bash <...>/session-liveness.sh` 的常驻进程。
#                            匹配按 argv[1] 的 basename == `session-liveness.sh`，兼容绝对/相对路径
#                            两种挂载方式（Monitor 挂 session-liveness-mount.sh → exec 同一脚本；
#                            直接挂 session-liveness.sh 同样成立）。容忍 N>1：一个逻辑 monitor 每轮
#                            起子 shell。负控制（AC1）：session-liveness 不挂 ⇒ mounted=false ⇒
#                            六键判「冷启动未完成」。
#   2. targetRoot          — 有效根 = argv 脚本路径的 ../..，除非 /proc/<pid>/environ 有
#                            SESSION_ROOT 覆盖（后者同样可读）。「挂在别的项目上」在 argv 里就看得见。
#
# 2026-08-06 移除的第三条判据（AC9 的 delivered）：旧判据读共享事件文件
# $QUAY_GLOBAL_DIR/session-liveness/events.jsonl 的 mtime 判断「事件有没有送达」。共享文件已随
# 人裁定移除——观测是树（manager→N 个 outer、outer_i→inner_i），每条边是独立的 (观察者,目标) 对，
# 事件只走观察者自己的 stdout（谁挂的谁拥有）。「事件真的送达」由挂载方自己的 Monitor 事件流承担
# （cold-start 的 MONITORS-DELIVERING 判据），不再有跨观察者的共享写点可供本检查器读取。挂载检查
# 因此收敛为「挂没挂 + 挂的哪个仓库」两条。
#
# 纯读契约（AC7）：本脚本只读 /proc，不写任何文件。观测命令不得改变被观测对象。
# 全部 /proc 扫描在单个 python3 进程内完成，不为每个 pid 起子进程。
#
# 不自匹配（AC2）：谓词只看 argv[1] 的 basename 等于 `session-liveness.sh`——发起查询的命令自己
# （bash .../monitor-mount-check.sh）argv[1] 是 monitor-mount-check.sh，永不命中。子串匹配会匹配
# 到发起查询的命令自己（外层验证可行性时当场踩过；tick 文档步骤 0 记的 pgrep -f 自匹配是同一个坑）。
#
# 测试接缝：MONITOR_CHECK_SESSION_LIVENESS 覆盖要匹配的脚本路径（默认本仓
# plugin/scripts/session-liveness.sh）。生产调用不设 → 行为不变。
#
# 输出前存活复验（gap-monitor-mount-check-stale-pids）：扫描到输出之间 pid 可能已死（TOCTOU）——
# 逐个 /proc/<pid> 存在性复验（等价 ps -p），死 pid 单独报 `stale_pids`（独立取值，不静默剔除，
# 不与 mounted 判据混为一谈）；mounted/targetOk 基于【存活 pid 集】。测试接缝
# MONITOR_CHECK_STALE_PIDS 模拟「扫描后已死」（生产不设）。
#
# 用法: bash plugin/scripts/monitor-mount-check.sh [--json]
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_LIVENESS="${MONITOR_CHECK_SESSION_LIVENESS:-$SCRIPT_DIR/session-liveness.sh}"
# 本仓根 = 监视脚本所在目录的 ../..（与 session-liveness.sh 的 BASH_SOURCE 自定位同构）。
SL_DIR="$(cd "$(dirname "$SESSION_LIVENESS")" && pwd)"
REPO_ROOT="$(cd "$SL_DIR/../.." && pwd)"

FORMAT=human
for a in "$@"; do [ "$a" = "--json" ] && FORMAT=json; done

MMC_SESSION_LIVENESS="$SESSION_LIVENESS" MMC_REPO_ROOT="$REPO_ROOT" MMC_FORMAT="$FORMAT" \
MMC_STALE_PIDS="${MONITOR_CHECK_STALE_PIDS:-}" \
python3 - <<'PY'
import json, os, glob

SESSION_LIVENESS = os.environ["MMC_SESSION_LIVENESS"]
REPO_ROOT = os.environ["MMC_REPO_ROOT"]
FMT = os.environ["MMC_FORMAT"]

LIVENESS_BASENAME = os.path.basename(SESSION_LIVENESS)

# 测试接缝（gap-monitor-mount-check-stale-pids）：MONITOR_CHECK_STALE_PIDS 列出要当作「扫描后已死」的
# pid（逗号分隔）。生产调用不设 → 行为不变；只用于把扫描→复验之间的 TOCTOU 死亡窗口做成可测
# （否则该窗口外部不可控，死 pid 无法确定性注入）。
_STALE_OVERRIDE = set()
_mmc_stale = os.environ.get("MMC_STALE_PIDS", "").strip()
if _mmc_stale:
    _STALE_OVERRIDE = {int(p) for p in _mmc_stale.split(",") if p.strip().isdigit()}


def read_cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().split(b"\0")
    except OSError:
        return []


def pid_alive(pid):
    """输出前存活复验（判据1）：扫描到输出之间 pid 可能已死，逐个用 /proc/<pid> 存在性复验
    （等价 ps -p）。死 pid 单独报 stale_pids，不静默剔除——「曾经挂过但死了」与「从没挂过」不同形
    （C29 家族）。"""
    if pid in _STALE_OVERRIDE:
        return False
    return os.path.exists(f"/proc/{pid}")


def resolve_script_path(pid, argv_script):
    """把 argv[1] 解析为绝对脚本路径：已是绝对路径 → 原样 normpath；相对路径 → 先按进程 cwd 解析
    再 normpath（挂载常以 `bash plugin/scripts/session-liveness.sh` 形式启动，cwd = 项目根）。"""
    if not os.path.isabs(argv_script):
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
            argv_script = os.path.join(cwd, argv_script)
        except OSError:
            pass
    return os.path.normpath(argv_script)


def is_liveness_process(pid, argv):
    """argv[0]=bash 且 argv[1] 解析后的脚本路径 == 配置的 SESSION_LIVENESS。

    basename 相等是预滤（兼容绝对/相对两种挂载方式——Monitor 挂 session-liveness-mount.sh →
    exec 同一脚本；直接挂 session-liveness.sh 同样成立）；解析后路径必须等于配置路径才计入——
    这是测试接缝（MONITOR_CHECK_SESSION_LIVENESS）的密封性：真正的挂载（如主检出那个）
    argv[1] 是别的路径，不得让负控制误判 mounted=true。"""
    if len(argv) < 2 or argv[0] != b"bash":
        return False
    if os.path.basename(argv[1].decode("utf-8", "replace")) != LIVENESS_BASENAME:
        return False
    return resolve_script_path(pid, argv[1].decode("utf-8", "replace")) == os.path.normpath(SESSION_LIVENESS)


def work_root(pid, argv_script):
    """进程实际工作根：argv[1] 是绝对路径 → 从脚本目录 ../.. 推导；是相对路径 → 先按进程 cwd 解析
    再推导（挂载常以 `bash plugin/scripts/session-liveness.sh` 形式启动，cwd = 项目根）。"""
    argv_script = resolve_script_path(pid, argv_script)
    default_root = os.path.normpath(os.path.join(os.path.dirname(argv_script), "..", ".."))
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            environ = f.read()
    except OSError:
        return default_root
    for kv in environ.split(b"\0"):
        if kv.startswith(b"SESSION_ROOT="):
            return kv.split(b"=", 1)[1].decode("utf-8", "replace")
    return default_root


targets = []
for d in glob.glob("/proc/[0-9]*"):
    pid = int(os.path.basename(d))
    argv = read_cmdline(pid)
    if is_liveness_process(pid, argv):
        root = work_root(pid, argv[1].decode("utf-8", "replace"))
        targets.append({
            "pid": pid,
            "targetRoot": root,
        })

targets.sort(key=lambda t: t["pid"])
live_targets = [t for t in targets if pid_alive(t["pid"])]
stale_pids = [t["pid"] for t in targets if not pid_alive(t["pid"])]
mounted = bool(live_targets)
target_root = live_targets[0]["targetRoot"] if live_targets else ""
target_ok = bool(live_targets) and all(t["targetRoot"] == REPO_ROOT for t in live_targets)

if FMT == "json":
    print(json.dumps({
        "mounted": mounted,
        "targetRoot": target_root,
        "targetOk": target_ok,
        "repoRoot": REPO_ROOT,
        "livenessScript": SESSION_LIVENESS,
        "pids": [t["pid"] for t in live_targets],
        "targets": live_targets,
        "stale_pids": stale_pids,
    }, ensure_ascii=False, indent=2))
else:
    print(f"mounted={str(mounted).lower()}")
    print(f"targetRoot={target_root}")
    print(f"targetOk={str(target_ok).lower()}")
    for t in live_targets:
        print(f"  pid {t['pid']}: targetRoot={t['targetRoot']}")
    if stale_pids:
        print(f"  stale_pids: {','.join(map(str, stale_pids))}")
PY
