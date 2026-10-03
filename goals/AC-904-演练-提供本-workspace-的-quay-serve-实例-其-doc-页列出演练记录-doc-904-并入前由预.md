---
id: AC-904
title: 演练：提供本 workspace 的 quay serve 实例，其 /doc 页列出演练记录 DOC-904（并入前由预览实例满足、并入后由生产实例满足）
status: draft
kind: criterion
goal: GOAL-904
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  st="$root/.quay/server.json"

  [ -s "$st" ] || { echo "NOT-EVALUATED: no quay.ts serve instance is registered
  for $root ($st absent)" >&2; exit 3; }

  reg=$(node -e '(() => { try { const s =
  JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const w =
  (s.services || []).find((x) => x.name === "web"); console.log([s.pid, w &&
  w.host, w && w.port].join(" ")); } catch { console.log(""); } })()' "$st")

  set -- $reg

  pid=${1:-}; host=${2:-}; port=${3:-}

  [ -n "$pid" ] && [ -n "$host" ] && [ -n "$port" ] || { echo "NOT-EVALUATED:
  the quay.ts serve registration at $st has no web host/port" >&2; exit 3; }

  kill -0 "$pid" 2>/dev/null || { echo "NOT-EVALUATED: registered quay.ts serve
  pid $pid is not alive (stale registration)" >&2; exit 3; }

  [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$root" ] || { echo
  "NOT-EVALUATED: registered quay.ts serve pid $pid does not run in $root" >&2;
  exit 3; }

  body=$(curl -s --max-time 20 "http://$host:$port/doc") || { echo
  "NOT-EVALUATED: GET http://$host:$port/doc failed" >&2; exit 3; }

  printf '%s' "$body" | grep -q 'DOC-904' || { echo "CAUSE=drill-doc-not-served
  — http://$host:$port/doc does not list DOC-904: the instance serving $root
  lacks the drill record" >&2; exit 1; }

  echo "PASS: http://$host:$port/doc lists DOC-904"
expect: exit 0 = 本 workspace root 下登记在册且存活的 quay.ts serve 实例，其 /doc 页列出
  DOC-904（演练记录文档）；exit 1 = 该实例的 /doc 页没有 DOC-904（实例所在树缺该文档）；exit 3 = 该 root
  下没有登记在册且存活的 serve 实例（预览实例没起，或生产 serve 不在）。
origin: 人 2026-10-03「第二步先做合并演练再做试点」：对 GOAL-028 跑一遍 goal
  分支完整路径（演练，非真实开发方向）；判据能在生产实例上判假（落笔当轮读数：生产 /doc 无 DOC-904 ⇒ exit 1）
---
