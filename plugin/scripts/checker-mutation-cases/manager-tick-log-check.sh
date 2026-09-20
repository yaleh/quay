#!/usr/bin/env bash
# Mutation case for manager-tick-log-check (gap-manager-tick-log-check-mutation-case).
#
# WHY THIS FILE EXISTS: manager-tick-log-check.sh 在 P4 守卫谱系里是【已声明】守卫
# (capability-catalog GUARD_OBJECT: `manager-tick-log-check.sh → file:orchestration/manager-tick-log.md`)
# 且在外层 tick doc 里每轮被真实调用（quay-init 把它落到 consumer 的 orchestration/ 布局）——
# 但它的判定窗口内 `fired` 为空，
# 又【没有 mutation case】⇒ guard-lineage-check.ts 把它归入 suspicious（「never-fired and not
# mutation-verified — indistinguishable from a broken guard」，P4 定义）。姊妹档 outer-tick-log-check.sh
# 同样从未变红，唯一差别就是它【有】这个 case 文件 ⇒ 归 preventive。本文件补上那个差别。
#
# 两个方向各至少一条（该守卫的两条【独立】判据，只证明一条 ⇒ 另一条仍是「从未被证明能红」）：
#   ① 陈旧分支  — 守卫判据② mtime 新鲜度：`--stale-hours <n>` 缩小 + 把 fixture log 的 mtime 推到
#      2 小时前 ⇒ 必红 reason=stale。「跳过一轮不写」就是这个形态。
#   ② 缩水棘轮  — 守卫判据③ 行数棘轮：高 `--baseline` sidecar + 小 log（277→5 截断的形态）⇒
#      必红 reason=shrink-detected。注意这条断言的是【棘轮】本身，不是缩水后的行判据。
#   ③ (附加) 无 tick 行 — 守卫判据① no-tick-row：只剩表头的 log ⇒ 必红 reason=no-tick-row。
#      两条必需的之外多覆盖一条，因为它是同一个 `--log/--baseline` 接缝上的第三条独立判据。
#
# 契约（同 outer-tick-log-check.sh，也是 checker-mutation-check.sh 头注释的 case 契约）：
#   bash manager-tick-log-check.sh <workdir>
#   未逮住（注入后仍绿）        ⇒ exit 1
#   恢复后仍红（守卫卡死）      ⇒ exit 4
#   exit 0 = baseline 绿 → 注入红 → 恢复绿 全部走通。
#
# ⛔ 变异的对象是【真实脚本】plugin/scripts/manager-tick-log-check.sh（不是副本、不是桩）。
# ⛔ fixture 全部落在 <workdir>（checker-mutation-check.sh 每次给一个 mktemp -d）：--log 与
#    --baseline 都指到这里 ⇒ 本 case 不写仓内文件（守卫在 LINES > BASELINE 时会写 <LOG>.baseline）。
set -u
name="manager-tick-log-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${workdir}"
LOG_F="${workdir}/manager-tick-log.md"
BASE_F="${workdir}/manager-tick-log.md.baseline"

OUT=""
RC=0

# ── fixture 构造 ────────────────────────────────────────────────────────────────────────────────
# 合法 fixture：表头 + 一条【新格式】tick 行（`| HH:MMZ |`，2026-08-07 16:5x 起的形式；旧格式是
# `| YYYY-`）——两种格式守卫都数，这里用新格式是因为它才是「最近 24 轮」的实际形态。mtime = now。
write_fresh_log() {
  {
    printf '# Manager Tick Log\n'
    printf '| 时间 | 层 | 动作 |\n'
    printf -- '| 17:3xZ | manager | fixture tick row |\n'
  } > "$LOG_F"
  touch "$LOG_F"
}

# 只剩表头（0 条 tick 行）——判据① no-tick-row 的注入形态。
write_header_only_log() {
  {
    printf '# Manager Tick Log\n'
    printf '| 时间 | 层 | 动作 |\n'
  } > "$LOG_F"
  touch "$LOG_F"
}

# 基线 sidecar 同步到 log 的当前行数 ⇒ 棘轮判据绿（LINES == BASELINE，不触发上调也不触发缩水）。
sync_baseline() {
  wc -l < "$LOG_F" | tr -d ' ' > "$BASE_F"
}

# ── 被测对象的调用面 ─────────────────────────────────────────────────────────────────────────────
# run_check <stale-hours> — 跑【真实守卫】，--log/--baseline 都指 fixture，结果落 OUT/RC。
# `if ... then/else` 形式（不是 `$?` 紧跟在赋值后）——避免 shell 的 $? 读取陷阱。
run_check() {
  if OUT="$(bash "${checker_dir}/manager-tick-log-check.sh" --log "$LOG_F" --baseline "$BASE_F" --stale-hours "$1" --json 2>&1)"; then
    RC=0
  else
    RC=$?
  fi
}

# assert_reason <expected-reason> <context> — 红必须【因为该判据】而红，不是碰巧非零。
# 只断言「非零」会把「守卫因别的原因坏了」也算成逮住 —— 那是把「读不懂」伪装成「合格」的镜像
# （硬规则 3b：无法评估不得与合格同形）。
assert_reason() {
  case "$OUT" in
    *"\"reason\":\"$1\""*) return 0 ;;
    *) echo "$2: went RED for the WRONG reason (expected reason=$1, got: $OUT)" >&2; exit 1 ;;
  esac
}

# ── baseline：合法 fixture 必须绿（否则本 case 自己就在「恒红」形态上）────────────────────────────
write_fresh_log
sync_baseline
run_check 24
if [ "$RC" -ne 0 ]; then
  echo "baseline RED on a legal fresh fixture (checker always-red?): rc=$RC out=$OUT" >&2
  exit 4
fi

# ── INJECT 1（陈旧分支）：最后一次 tick 写入推到 2 小时前 + --stale-hours 1 ⇒ 必红 reason=stale ──
touch -d '2 hours ago' "$LOG_F"
run_check 1
if [ "$RC" -eq 0 ]; then
  echo "mutation NOT caught: a 2h-stale tick log stayed GREEN under --stale-hours 1 (a skipped round is invisible) — out=$OUT" >&2
  exit 1
fi
assert_reason "stale" "INJECT 1 (stale)"

# RESTORE 1：mtime 回到 now ⇒ 判据② 绿（--stale-hours 1 也绿）。
touch "$LOG_F"
run_check 1
if [ "$RC" -ne 0 ]; then
  echo "RESTORE 1 still RED after refreshing the mtime (checker stuck red?): rc=$RC out=$OUT" >&2
  exit 4
fi

# ── INJECT 2（缩水棘轮）：高 baseline sidecar + 小 log ⇒ 必红 reason=shrink-detected ─────────────
# 这是 2026-08-09 read-modify-write 事故把 log 截成 0 字节的形态；缩水后若仍保留若干 tick 行，
# 判据①/② 都会静默 PASS —— 只有棘轮逮得住。所以这条判据必须被单独证明能红。
printf '100\n' > "$BASE_F"
run_check 24
if [ "$RC" -eq 0 ]; then
  echo "mutation NOT caught: baseline=100 vs a 3-line log stayed GREEN (shrink ratchet dead — 277→5 truncation would be silent) — out=$OUT" >&2
  exit 1
fi
assert_reason "shrink-detected" "INJECT 2 (shrink)"

# RESTORE 2：baseline 重新同步到当前行数 ⇒ 绿。
sync_baseline
run_check 24
if [ "$RC" -ne 0 ]; then
  echo "RESTORE 2 still RED after re-syncing the baseline (checker stuck red?): rc=$RC out=$OUT" >&2
  exit 4
fi

# ── INJECT 3（无 tick 行）：只剩表头 ⇒ 必红 reason=no-tick-row ───────────────────────────────────
# 基线先同步（否则棘轮会先逮住，红的是另一条判据 —— assert_reason 正是为了防这个）。
write_header_only_log
sync_baseline
run_check 24
if [ "$RC" -eq 0 ]; then
  echo "mutation NOT caught: a header-only tick log stayed GREEN (no-tick-row judgement dead) — out=$OUT" >&2
  exit 1
fi
assert_reason "no-tick-row" "INJECT 3 (no-tick-row)"

# RESTORE 3：写回合法 tick 行 ⇒ 绿。
write_fresh_log
sync_baseline
run_check 24
if [ "$RC" -ne 0 ]; then
  echo "RESTORE 3 still RED after restoring the tick row (checker stuck red?): rc=$RC out=$OUT" >&2
  exit 4
fi

echo "manager-tick-log-check mutation case: PASS (stale caught + shrink-ratchet caught + no-tick-row caught; all three restored to GREEN)" >&2
exit 0
