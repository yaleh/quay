---
id: AC-905
title: 演练：提供本 workspace 的 quay serve 实例，其 /doc 页列出第 A 批演练文档的首篇
  DOC-910（并入前由预览实例满足、并入后由生产实例满足）
status: achieved
kind: criterion
goal: GOAL-905
criterion: >-
  set -u


  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }


  cd "$root"


  out=$(node --no-warnings --experimental-strip-types
  "$root/plugin/scripts/live-web-address.ts" "$root" 2>&1)

  rc=$?

  case "$rc" in
    0) addr=$out ;;
    1) echo "CAUSE=carrier-web-down — the registered quay.ts serve marks its web service down" >&2; exit 1 ;;
    *) echo "NOT-EVALUATED: no live web address for $root ($out)" >&2; exit 3 ;;
  esac


  body=$(curl -s --max-time 20 "http://$addr/doc") || { echo "NOT-EVALUATED: GET
  http://$addr/doc failed" >&2; exit 3; }


  printf '%s' "$body" | grep -q 'DOC-910' || { echo "CAUSE=drill-doc-not-served
  — http://$addr/doc does not list DOC-910: the instance serving $root lacks the
  drill record" >&2; exit 1; }


  echo "PASS: http://$addr/doc lists DOC-910"
expect: exit 0 = 本 workspace root 下登记在册且存活的 quay.ts serve 实例，其 /doc 页列出
  DOC-910；exit 1 = 该实例的 /doc 页没有 DOC-910（实例所在树缺这批文档）；exit 3 = 该 root 下没有登记在册且存活的
  serve 实例。
origin: 人 2026-10-05「补上没覆盖的路径」：对 GOAL-028 做第二次演练（多任务并发落同一 goal 分支、goal 分支落后
  develop、真实大小的并入、修复后的刷新与预览自动装配）；判据能在生产实例上判假（落笔当轮读数见各 AC 的验证）。
activatedAt: 2026-10-05T14:26:55.819Z
statusLog:
  - at: 2026-10-05T14:26:55.819Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-05 授权第二次合并演练（GOAL-905）；承接任务已立并停放（needs-human），激活本 AC 不会触发乱序自动立案
  - at: 2026-10-05T16:17:31.663Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-05T14:26:55.818Z
---
