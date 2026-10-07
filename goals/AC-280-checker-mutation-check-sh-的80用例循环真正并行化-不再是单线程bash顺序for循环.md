---
id: AC-280
title: checker-mutation-check.sh 的80用例循环真正并行化，不再是单线程bash顺序for循环
status: superseded
kind: criterion
goal: GOAL-022
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  SRC="plugin/scripts/checker-mutation-check.sh"

  if [ ! -f "$SRC" ]; then
    echo "CAUSE=source-absent — $SRC does not exist => the mutation-check driver moved and this criterion can no longer judge it" >&2; exit 1
  fi

  # Measured 2026-09-16/17: this script's run_cases() loop runs its 80
  registered mutation cases

  # ONE AT A TIME in a plain `for` loop (run_one_case "$name" "$workdir";
  exit_code=$?) — confirmed

  # taking 18-30s single-threaded on the 128-core self-hosted runner while the
  rest of the suite's

  # main phase ran hundreds of files in parallel. A position-based check (hard
  rule 2): the fix must

  # actually background the per-case invocation (a `&` on the line that calls
  run_one_case) AND

  # reap it with a `wait` afterward in the same function — not just mention
  "parallel" in a comment.

  CALL_LINE="$(grep -n 'run_one_case "\$name" "\$workdir"' "$SRC" | head -1 ||
  true)"

  if [ -z "$CALL_LINE" ]; then
    echo "CAUSE=call-site-not-found — no line in $SRC calls run_one_case \"\$name\" \"\$workdir\" verbatim; the refactor may have renamed the call — this criterion needs updating, not silently passed" >&2; exit 1
  fi

  CALL_LINE_NO="${CALL_LINE%%:*}"

  CALL_LINE_TEXT="${CALL_LINE#*:}"

  BACKGROUNDED=0

  case "$CALL_LINE_TEXT" in
    *"&"*) BACKGROUNDED=1 ;;
  esac

  HAS_WAIT=0

  if awk -v n="$CALL_LINE_NO" 'NR>n && NR<=n+40 &&
  /(^|[^_a-zA-Z])wait([^_a-zA-Z]|$)/{found=1} END{exit !found}' "$SRC"; then
    HAS_WAIT=1
  fi

  if [ "$BACKGROUNDED" -eq 1 ] && [ "$HAS_WAIT" -eq 1 ]; then
    echo "OK — run_one_case is backgrounded (line ${CALL_LINE_NO}) and reaped via a wait within 40 lines after it"
    exit 0
  fi

  echo "CAUSE=still-sequential — $SRC:${CALL_LINE_NO} calls run_one_case without
  backgrounding it (backgrounded=${BACKGROUNDED},
  wait-found-within-40-lines=${HAS_WAIT}); the 80-case mutation-check loop is
  still single-threaded" >&2; exit 1

  CRIT
expect: criterion exits 0 once the run_one_case call site is backgrounded and
  reaped with a wait
origin: GOAL-022 背景：checker-mutation-check.sh 的80个用例单独占静态检查阶段18秒，无backgrounding
activatedAt: 2026-09-17T00:46:12.705Z
statusLog:
  - at: 2026-09-17T00:46:12.705Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-022 激活，三条 AC 同步激活为可判定态
  - at: 2026-09-17T03:21:48.880Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-10-07T08:20:14.717Z
    from: achieved
    to: superseded
    actor: human
    reason: 人 2026-10-07 裁定取消（判据陈旧，非未达成）：判据 grep
      plugin/scripts/checker-mutation-check.sh 里字面量 run_one_case "$name"
      "$workdir"；该 bash 循环已被 GOAL-026
      §5.2（gap-arch-tsify-checker-mutation-check-sh）迁进
      plugin/scripts/checker-mutation-check.ts，入口成薄垫片 ⇒
      谓词要找的调用点结构上不存在，判据恒红（CAUSE=call-site-not-found）。保证本身仍在 .ts 的
      bounded-parallel 用例池（poolMax / Promise.race / Promise.all）。
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T00:46:12.704Z
---
