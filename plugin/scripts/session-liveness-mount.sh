#!/usr/bin/env bash
# plugin/scripts/session-liveness-mount.sh — 会话存活监视器的单飞挂载入口（AC20）。
#
# 为什么有这一层：AC20 把「挂载」从「谁需要谁自己起一个」改成一个【有主的、可接管的角色】。
# 本脚本是那个角色的显式入口；真正的单飞门（取锁 / 空操作 / 接管 / 心跳 / 共享事件）在
# session-liveness.sh 内部（它是等价入口——直接挂 session-liveness.sh 同样单飞）。
#
# 挂载语义（复用 heavy-op-token.sh 已验证的锁，管理者 AC20a–d 判据逐字照搬，不改写）：
#   - 第一个挂载：取单飞锁成功 → exec session-liveness.sh，本进程（同一 pid）成为持有者。
#   - 第二个挂载：检测到活持有者 → 打印属主与 pid，退出 0（空操作，不是失败）。
#   - 持有者被 kill -9 后：下一次挂载有界等待接管（陈旧回收），输出 takeover_ms。
#   - 持有者活着时：绝不接管、绝不 kill 任何进程（反向负控制 AC5）。
#
# 用法：bash plugin/scripts/session-liveness-mount.sh [--once] [--mask] [--api-errors <t>] [--last-input <t>]
#   --once 等诊断接缝透传给 session-liveness.sh（不取锁）。
# 环境：SESSION_LIVENESS_OWNER（挂载者身份，默认项目根 basename）、
#       SESSION_LIVENESS_GLOBAL_DIR / QUAY_GLOBAL_DIR（状态目录）、
#       SESSION_LIVENESS_MOUNT_STALE_S（死持有者回收阈值，默认 3）。

set -uo pipefail

_slm_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$_slm_script_dir/session-liveness.sh" "$@"
