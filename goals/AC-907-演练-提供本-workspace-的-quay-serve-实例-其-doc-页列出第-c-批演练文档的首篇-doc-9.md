---
id: AC-907
title: 演练：提供本 workspace 的 quay serve 实例，其 /doc 页列出第 C 批演练文档的首篇
  DOC-930（并入前由预览实例满足、并入后由生产实例满足）
status: active
kind: criterion
goal: GOAL-905
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

  printf '%s' "$body" | grep -q 'DOC-930' || { echo "CAUSE=drill-doc-not-served
  — http://$host:$port/doc does not list DOC-930: the instance serving $root
  lacks the drill record" >&2; exit 1; }

  echo "PASS: http://$host:$port/doc lists DOC-930"
expect: exit 0 = 本 workspace root 下登记在册且存活的 quay.ts serve 实例，其 /doc 页列出
  DOC-930；exit 1 = 该实例的 /doc 页没有 DOC-930（实例所在树缺这批文档）；exit 3 = 该 root 下没有登记在册且存活的
  serve 实例。
origin: 人 2026-10-05「补上没覆盖的路径」：对 GOAL-028 做第二次演练（多任务并发落同一 goal 分支、goal 分支落后
  develop、真实大小的并入、修复后的刷新与预览自动装配）；判据能在生产实例上判假（落笔当轮读数见各 AC 的验证）。
activatedAt: 2026-10-05T14:27:55.320Z
statusLog:
  - at: 2026-10-05T14:27:55.320Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-05 授权第二次合并演练（GOAL-905）；承接任务已立并停放（needs-human），激活本 AC 不会触发乱序自动立案
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-05T14:27:55.320Z
---
