#!/usr/bin/env bash
# manager-arm-loop.sh — AC5/AC5c: manager 的调度锚点武装（哨兵清扫 + 幂等，零记忆可执行）。
# (gap-manager-productization-five-constraints AC5/AC5c)
#
# 人 2026-08-06 裁定：manager 的调度锚点只能用 Claude Code 自己的 loop/cron（/loop → CronCreate）。
# AC5c 把 manda 的两条机制固化为规则：
#   1. prompt 是指针（只指向 loop tick 文档的正本——dev-tree 优先
#      <repo>/orchestration/manager-loop-tick.md，npm-pack 裸机只有出厂模板
#      <repo>/plugin/loop/manager-loop-tick.md——选存在的那份，AC4 不铺虚空武装器），不携带指令内容——
#      /clear 与 /compact 不杀会话、cron 照常触发，但上下文没了；技能体只装「如何武装」，
#      不装「触发后做什么」（触发后现读 reference/）。
#   2. 身份用可推导的哨兵串，不用记住的 ID——武装前无条件按哨兵清扫同名旧任务，再建一个
#      ⇒ 幂等，且零记忆可执行。
#
# 哨兵：固定前缀 `[manager-tick]`（AC5c 示例）。武装步骤 = CronList → 删除所有含该前缀者 →
# CronCreate 一个（prompt 为指针）。判据（AC5/AC5c）：
#   - ① 在不知道任何 cron ID 的前提下连续执行两次武装步骤 ⇒ CronList 必须恰好一个 manager loop
#     （不是零、不是两个）
#   - ② 负控制：先人为建两个重复的 manager loop，再执行同一武装步骤 ⇒ 必须收敛回恰好一个
#
# 测试接缝：CronList/CronCreate 是 Claude Code 会话内工具，bash 不能直接调用。本脚本把「武装
# 逻辑」做在文件接缝上——CRON_STORE 指向一个「cron 注册表」文件（默认 manager 家下
# loop-registry.txt，每行一条），真实会话中由 agent 把同一哨兵清扫逻辑映射到 CronList/CronDelete/
# CronCreate 工具（见 manager-loop-tick.md 的武装步骤）。这样哨兵清扫逻辑可被机械测试（AC5c 负
# 控制），而工具映射在文档中写成约定。
#
# 注册表↔真 cron 核实（gap-manager-cold-start-no-falsifiable-checklist AC4）：哨兵行只是「武装」，
# 不等于「真有 cron」——真正的 CronCreate 在会话内做，bash 看不到。本脚本把核实做成两段：
#   --record-cron <id>   会话内 agent 在 CronCreate + CronList 确认后，把真实 cron id 连同
#                        ISO 时刻写回注册表的哨兵行（形如 `… |cron:<id>|verified:<ISO>`）。
#                        一个空哨兵行（无收据）不再是「已核实」。
#   --verify             从外部判定注册表状态：恰好一个哨兵 且 该行带 cron:<id> 且 verified:<ISO>
#                        在 STALE 窗口内 ⇒ `registry-verified`（exit 0）；缺任一条 ⇒
#                        `registry-only` / `registry-missing` / `registry-multiple` / `receipt-stale`
#                        （exit 1）。这样「注册表说武装了」与「注册表说武装了且真 cron 已核实」
#                        在记录上可区分——不会再有「无机件能外部核实」的 manager。
#
# 用法：
#   manager-arm-loop.sh [--home <dir>] [--store <file>] [--dry-run] [--json] [--validate]
#                       [--record-cron <cronId>] [--verify] [--stale-seconds <n>]
#     --home <dir>        manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/ → $HOME/.quay-global/manager/）
#     --store <file>      cron 注册表文件（默认 <home>/loop-registry.txt）
#     --dry-run           只打印将执行的步骤，不改注册表
#     --json              JSON 输出
#     --validate          只验证「哨兵/指针/收据规则已在文档中」，不改注册表（AC5c 文档规则检查）
#     --record-cron <id>  把 CronCreate 的核实收据（cron id + 时刻）写回注册表哨兵行（AC4）
#     --verify            外部核实注册表 ↔ 真 cron（registry-verified exit 0，registry-only 等 exit 1）
#     --stale-seconds <n> --verify 的收据新鲜度窗口（默认 604800 = 7 天；超过报 receipt-stale）
#
# 依赖：无（纯 shell + 文件操作）。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR=""
STORE=""
DRY_RUN=0
JSON=0
VALIDATE=0
RECORD_CRON=""
VERIFY=0
STALE_SECONDS="${MANAGER_ARM_STALE_SECONDS:-604800}"

usage() {
  sed -n '1,44p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --store) STORE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON=1; shift ;;
    --validate) VALIDATE=1; shift ;;
    --record-cron) RECORD_CRON="$2"; shift 2 ;;
    --verify) VERIFY=1; shift ;;
    --stale-seconds) STALE_SECONDS="$2"; shift 2 ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --home <dir> | --store <file> | --dry-run | --json | --validate | --record-cron <id> | --verify | --stale-seconds <n>)" >&2
      exit 2
      ;;
  esac
done

HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"
STORE="${STORE:-${HOME_DIR}/loop-registry.txt}"

# ── 哨兵前缀（AC5c 的固定可推导前缀）────────────────────────────────────────────────────────
SENTINEL="[manager-tick]"
# 哨兵行的收据尾缀（AC4）：` |cron:<id>|verified:<ISO>`。判定用字面串（grep -qF，`|` 在
# ERE 里是或运算——ID_RE/AT_RE 用 `\|` 转义成字面竖线，否则空分支恒真、把空哨兵误判成
# registry-verified，AC4 核实会当场失效）。RECEIPT_STRIP 用于剥离旧收据尾缀。
ID_PAT='\|cron:[^|[:space:]]+'
AT_PAT='\|verified:[0-9]{4}-[0-9]{2}-[0-9]{2}T'
ANCHOR_PAT='\|anchor:[0-9a-f]{64}'
RECEIPT_STRIP='s/[[:space:]]*\|cron:[^|]*\|verified:[^|[:space:]]*(\|anchor:[^|[:space:]]*)?[[:space:]]*$//'
# prompt = 指针（AC5c 规则 1：只携带指针，不携带指令内容）
# 指针目标 = 存在的那份（AC4 不铺虚空武装器）：
#   - dev-tree / quay-init --loop --manager 的消费项目：`orchestration/manager-loop-tick.md`（活文档）
#   - npm-pack 裸机（无 orchestration/，只有出厂模板）：`plugin/loop/manager-loop-tick.md`
POINTER_DOC="orchestration/manager-loop-tick.md"
if [ ! -f "${REPO_ROOT}/${POINTER_DOC}" ] && [ -f "${REPO_ROOT}/plugin/loop/manager-loop-tick.md" ]; then
  POINTER_DOC="plugin/loop/manager-loop-tick.md"
fi
POINTER_PROMPT="Run the manager tick per <repo>/${POINTER_DOC}"

# ── AC5c --validate：哨兵/指针/收据规则已在文档中（机械可查，不依赖会话）────────────────────
if [ "$VALIDATE" = 1 ]; then
  TICK_DOC="${TICK_DOC:-$REPO_ROOT/plugin/loop/manager-loop-tick.md}"
  if [ ! -f "$TICK_DOC" ]; then
    echo "ERROR: manager-arm-loop --validate: tick doc not found: $TICK_DOC" >&2
    exit 2
  fi
  # Retry the doc read (up to 3 attempts, 50ms apart): a CONCURRENT writer (e.g. a quay-init
  # laydown in another lane) can momentarily truncate the file between our stat and cat, and a
  # transient empty read must not flip the validate red (round-4 suite flake,
  # gap-verify-round-9-failures-from-recent-changes-fix-batch AC6). The sentinel is checked as a
  # LITERAL (`grep -qF`), never as a regex — `[manager-tick]` is a bracket expression that
  # trivially matches any real doc, which would make this check meaningless.
  missing=""
  for _attempt in 1 2 3; do
    doc="$(cat "$TICK_DOC" 2>/dev/null)"
    # 规则 1：prompt 是指针（不含指令内容）——文档必须出现「指针 / 只携带指针」约定
    pointer_ok=0
    printf '%s' "$doc" | grep -q '指针\|只携带指针\|pointer-only\|prompt.*pointer' && pointer_ok=1
    # 规则 2：哨兵清扫（按哨兵删除同名旧任务再建一个）——文档必须出现哨兵前缀约定
    sentinel_ok=0
    printf '%s' "$doc" | grep -qF "$SENTINEL" && sentinel_ok=1
    # 规则 3（AC4）：注册表↔真 cron 核实——文档必须出现「record-cron / 写回收据」约定
    receipt_ok=0
    printf '%s' "$doc" | grep -q 'record-cron\|--record-cron\|核实收据\|写回收据\|cron.*收据' && receipt_ok=1
    if [ "$pointer_ok" = 1 ] && [ "$sentinel_ok" = 1 ] && [ "$receipt_ok" = 1 ]; then
      echo "VALIDATE-OK: $TICK_DOC carries the sentinel + pointer-only + cron-receipt arm contract"
      exit 0
    fi
    # A transient empty/partial read (a concurrent writer's window) is the round-4 flake; retry
    # before declaring a real missing-rule failure.
    sleep 0.05
  done
  if [ "$pointer_ok" != 1 ]; then missing="$missing pointer-rule"; fi
  if [ "$sentinel_ok" != 1 ]; then missing="$missing sentinel"; fi
  if [ "$receipt_ok" != 1 ]; then missing="$missing cron-receipt"; fi
  echo "VALIDATE-FAIL: manager-loop-tick.md missing AC5c rules:$missing" >&2
  exit 1
fi

# ── AC4 --record-cron <id>：把 CronCreate 的核实收据写回注册表哨兵行 ─────────────────────────
# 会话内 agent 在 CronCreate + CronList 确认后调用本段（bash 自己看不到会话内 cron，收据是
# agent 用 CronList 返回的真实 id 写的）。一个带收据的哨兵行 ≠ 空哨兵行——--verify 据此区分
# `registry-verified` 与 `registry-only`。
if [ -n "$RECORD_CRON" ]; then
  if [ ! -f "$STORE" ]; then
    echo "ERROR: manager-arm-loop --record-cron: registry $STORE missing (run arm first)" >&2
    exit 1
  fi
  LINE_COUNT="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
  if [ "$LINE_COUNT" != "1" ]; then
    echo "ERROR: manager-arm-loop --record-cron: expected exactly ONE $SENTINEL line to attach the receipt, got $LINE_COUNT" >&2
    exit 1
  fi
  NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # 判据④（人 2026-08-14 10:4xZ 裁定「把锚文件 sha256 写进 registry」）：record-cron 时把锚文件
  # （orchestration/manager-tick-prompt.txt，manager-anchor-check.py:18 校的同一个）的 sha256 一并
  # 写进 registry 哨兵行 → 每轮核实能答「活着的 cron 携带的 prompt 文本 == 当前正本」。锚文件缺席时
  # 不写 anchor 字段（npm-pack 裸机无 orchestration/，--verify 侧同样跳过）。
  ANCHOR_FILE="${REPO_ROOT}/orchestration/manager-tick-prompt.txt"
  ANCHOR_HASH=""
  if [ -f "$ANCHOR_FILE" ]; then
    ANCHOR_HASH="$(sha256sum "$ANCHOR_FILE" | awk '{print $1}')"
  fi
  RECEIPT=" |cron:${RECORD_CRON}|verified:${NOW_ISO}"
  [ -n "$ANCHOR_HASH" ] && RECEIPT="${RECEIPT}|anchor:${ANCHOR_HASH}"
  # 剥离旧收据尾缀（可重复 --record-cron，同一次 arm 周期内换 id/重写不累积两条；anchor 字段一并剥离）
  sed -E "${RECEIPT_STRIP}" "$STORE" > "${STORE}.tmp"
  # 在哨兵行行尾附上新收据（只在哨兵行上附，不动其它行）
  awk -v sent="$SENTINEL" -v rec="$RECEIPT" \
    '{ if ($0 ~ sent) print $0 rec; else print $0 }' "${STORE}.tmp" > "${STORE}.tmp2"
  mv "${STORE}.tmp2" "$STORE"
  rm -f "${STORE}.tmp"
  if [ "$JSON" = 1 ]; then
    printf '{"cronId":"%s","verifiedAt":"%s","store":"%s"}\n' "$RECORD_CRON" "$NOW_ISO" "$STORE"
  else
    printf '%-14s %s\n' "cron-id" "$RECORD_CRON"
    printf '%-14s %s\n' "verified-at" "$NOW_ISO"
    printf '%-14s %s\n' "store" "$STORE"
    echo "record-cron-ok: receipt written to the registry sentinel line"
  fi
  exit 0
fi

# ── AC4 --verify：从外部核实注册表 ↔ 真 cron ────────────────────────────────────────────────
# 判据（机械可答）：①恰好一个哨兵行 ②该行带 `cron:<id>` ③该行带 `verified:<ISO>` ④收据新鲜
# （now - verified <= STALE_SECONDS）。缺① ⇒ registry-missing / registry-multiple；缺②③ ⇒
# registry-only（这正是「注册表说武装了、实际没核实」的缺陷形态）；缺④ ⇒ receipt-stale。
if [ "$VERIFY" = 1 ]; then
  verify_reason() {
    if [ ! -f "$STORE" ]; then echo "registry-missing"; return; fi
    local n; n="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
    if [ "$n" = "0" ]; then echo "registry-missing"; return; fi
    if [ "$n" -gt 1 ]; then echo "registry-multiple"; return; fi
    local line; line="$(grep "$SENTINEL" "$STORE" | head -1)"
    if ! printf '%s' "$line" | grep -qE "$ID_PAT"; then echo "registry-only"; return; fi
    if ! printf '%s' "$line" | grep -qE "$AT_PAT"; then echo "registry-only"; return; fi
    # 判据④（人 2026-08-14 10:4xZ）：cron 携带的 prompt 文本 == 当前正本 —— 注册表记的 anchor sha256
    # 必须等于当前锚文件的 sha256。不等 ⇒ 正本已变而 cron 未重建 ⇒ 必须清扫重建（anchor-changed）。
    # 注册表无 anchor 字段（旧 registry）或锚文件缺席（npm-pack 裸机）⇒ 跳过（无法核，不误报）。
    if printf '%s' "$line" | grep -qE "$ANCHOR_PAT"; then
      local recorded_anchor current_anchor
      recorded_anchor="$(printf '%s' "$line" | sed -n 's/.*|anchor:\([0-9a-f]\{64\}\).*/\1/p' | head -1)"
      current_anchor=""
      if [ -f "${REPO_ROOT}/orchestration/manager-tick-prompt.txt" ]; then
        current_anchor="$(sha256sum "${REPO_ROOT}/orchestration/manager-tick-prompt.txt" | awk '{print $1}')"
      fi
      if [ -n "$recorded_anchor" ] && [ -n "$current_anchor" ] && [ "$recorded_anchor" != "$current_anchor" ]; then
        echo "anchor-changed"; return
      fi
    fi
    local at; at="$(printf '%s' "$line" | sed -n 's/.*|verified:\([^|[:space:]]*\).*/\1/p' | head -1)"
    local at_epoch now_epoch; now_epoch="$(date -u +%s)"
    at_epoch="$(date -u -d "$at" +%s 2>/dev/null)"
    if [ -z "$at_epoch" ]; then echo "receipt-unparseable"; return; fi
    local age=$(( now_epoch - at_epoch ))
    if [ "$age" -gt "$STALE_SECONDS" ] || [ "$age" -lt 0 ]; then echo "receipt-stale"; return; fi
    echo "registry-verified"
  }
  REASON="$(verify_reason)"
  if [ "$REASON" = "registry-verified" ]; then
    if [ "$JSON" = 1 ]; then
      printf '{"verified":true,"state":"%s","store":"%s","staleSeconds":%s}\n' "$REASON" "$STORE" "$STALE_SECONDS"
    else
      printf '%-14s %s\n' "state" "$REASON"
      printf '%-14s %s\n' "store" "$STORE"
      printf '%-14s %s\n' "stale-seconds" "$STALE_SECONDS"
      echo "registry-matches-cron: the loop-registry sentinel carries a fresh CronCreate receipt"
    fi
    exit 0
  fi
  if [ "$JSON" = 1 ]; then
    printf '{"verified":false,"state":"%s","store":"%s"}\n' "$REASON" "$STORE"
  else
    printf '%-14s %s\n' "state" "$REASON"
    printf '%-14s %s\n' "store" "$STORE"
    case "$REASON" in
      registry-only)      echo "registry-only: the registry says armed but carries NO CronCreate receipt (the AC4 defect)";;
      registry-missing)   echo "registry-missing: no $SENTINEL entry in $STORE";;
      registry-multiple)  echo "registry-multiple: expected exactly ONE $SENTINEL entry";;
      receipt-stale)      echo "receipt-stale: the cron receipt is older than ${STALE_SECONDS}s";;
      receipt-unparseable) echo "receipt-unparseable: the verified timestamp is not an ISO instant";;
      anchor-changed)     echo "anchor-changed: manager-tick-prompt.txt changed since the cron was recorded — the cron runs stale text (must clean + rebuild)";;
    esac
  fi
  exit 1
fi

# ── 哨兵清扫（AC5c 武装步骤：CronList → 删除所有含哨兵者 → 恰好建一个）────────────────────
LIST_COUNT=0
if [ -f "$STORE" ]; then
  LIST_COUNT="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
fi

if [ "$DRY_RUN" = 1 ]; then
  printf 'sentinel=%s\nstore=%s\nwould-sweep=%s\nwould-create=1\n' \
    "$SENTINEL" "$STORE" "$([ "$LIST_COUNT" -gt 0 ] && echo "yes (delete $LIST_COUNT)" || echo "no (none)")"
  exit 0
fi

# 1. 删除所有含哨兵者（sweep by sentinel, never by remembered id）
mkdir -p "$(dirname "$STORE")"
if [ -f "$STORE" ]; then
  grep -v "$SENTINEL" "$STORE" > "${STORE}.tmp" 2>/dev/null || true
  mv "${STORE}.tmp" "$STORE"
fi
# 2. 恰好建一个（prompt 为指针）
printf '%s %s\n' "$SENTINEL" "$POINTER_PROMPT" >> "$STORE"

# 3. 验证：恰好一个（AC5 负控制：不是零、不是两个）
FINAL_COUNT="$(grep -c "$SENTINEL" "$STORE" 2>/dev/null || echo 0)"
if [ "$FINAL_COUNT" != "1" ]; then
  echo "ERROR: manager-arm-loop: expected exactly ONE $SENTINEL entry after arm, got $FINAL_COUNT" >&2
  exit 1
fi

if [ "$JSON" = 1 ]; then
  printf '{"sentinel":"%s","store":"%s","swept":%s,"final":%s}\n' \
    "$SENTINEL" "$STORE" "$([ "$LIST_COUNT" -gt 0 ] && echo "$LIST_COUNT" || echo 0)" "$FINAL_COUNT"
else
  printf '%-12s %s\n' "sentinel" "$SENTINEL"
  printf '%-12s %s\n' "store" "$STORE"
  printf '%-12s %s\n' "swept" "$([ "$LIST_COUNT" -gt 0 ] && echo "$LIST_COUNT (deleted)" || echo "none")"
  printf '%-12s %s\n' "final" "$FINAL_COUNT (exactly one manager loop)"
fi
exit 0
