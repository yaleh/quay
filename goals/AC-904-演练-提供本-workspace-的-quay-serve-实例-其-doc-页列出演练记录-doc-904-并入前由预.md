---
id: AC-904
title: 演练：提供本 workspace 的 quay serve 实例，其 /doc 页列出演练记录 DOC-904（并入前由预览实例满足、并入后由生产实例满足）
status: achieved
kind: criterion
goal: GOAL-904
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

  printf '%s' "$body" | grep -q 'DOC-904' || { echo "CAUSE=drill-doc-not-served
  — http://$addr/doc does not list DOC-904: the instance serving $root lacks the
  drill record" >&2; exit 1; }

  echo "PASS: http://$addr/doc lists DOC-904"
expect: exit 0 = 本 workspace root 下登记在册且存活的 quay.ts serve 实例，其 /doc 页列出
  DOC-904（演练记录文档）；exit 1 = 该实例的 /doc 页没有 DOC-904（实例所在树缺该文档）；exit 3 = 该 root
  下没有登记在册且存活的 serve 实例（预览实例没起，或生产 serve 不在）。
origin: 人 2026-10-03「第二步先做合并演练再做试点」：对 GOAL-028 跑一遍 goal
  分支完整路径（演练，非真实开发方向）；判据能在生产实例上判假（落笔当轮读数：生产 /doc 无 DOC-904 ⇒ exit 1）
activatedAt: 2026-10-03T15:49:27.656Z
statusLog:
  - at: 2026-10-03T15:49:27.656Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定做 goal 分支合并演练；承接任务 gap-goal904-merge-drill-record-doc
      已立（needs-human 停放，待 goal 分支出现后放行），激活本 AC 不会触发乱序自动立案
  - at: 2026-10-03T17:48:54.559Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T15:49:27.655Z
---
