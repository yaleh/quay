---
id: AC-340
title: 预览运行分支代码：被求值树下登记在册且存活的 quay serve，其入口文件 realpath 位于该树内，且其 web 首页可访问
status: achieved
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"; rroot=$(readlink -f "$root")
  pid=$(node -e '(()=>{try{const j=JSON.parse(require("fs").readFileSync(".quay/server.json","utf8"));process.stdout.write(String(j.pid||""))}catch{}})()')
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] || { echo "NOT-EVALUATED: no live quay serve registered under $root (.quay/server.json absent or pid dead) — start the preview with: quay goal preview GOAL-030 start --port <n>" >&2; exit 3; }
  entry=$(tr '\0' '\n' < "/proc/$pid/cmdline" | grep -E 'packages/quay/bin/quay\.(ts|js)$' | head -1)
  [ -n "$entry" ] || { echo "NOT-EVALUATED: pid $pid cmdline has no packages/quay/bin/quay.ts entry: $(tr '\0' ' ' < /proc/$pid/cmdline | cut -c1-200)" >&2; exit 3; }
  case "$entry" in /*) ;; *) entry="$(readlink -f /proc/$pid/cwd)/$entry" ;; esac
  rentry=$(readlink -f "$entry")
  case "$rentry" in "$rroot"/*) ;; *) echo "CAUSE=serve-runs-foreign-code — the serve registered under $rroot runs $rentry, not this tree's own code" >&2; exit 1 ;; esac
  out=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" 2>&1); rc=$?
  case "$rc" in 0) addr=$out ;; 1) echo "CAUSE=carrier-web-down — the registered serve marks its web service down" >&2; exit 1 ;; *) echo "NOT-EVALUATED: no live web address for $root ($out)" >&2; exit 3 ;; esac
  code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "http://$addr/") || { echo "NOT-EVALUATED: GET http://$addr/ failed" >&2; exit 3; }
  [ "$code" = "200" ] || { echo "CAUSE=page-not-served — GET http://$addr/ returned $code after following redirects" >&2; exit 1; }
  echo "PASS: serve pid $pid under $rroot runs this tree's own entry ($rentry) and serves http://$addr/ (200 after redirects)"
expect: exit 0 = 该树登记的 serve 跑的是本树自己的入口且首页返回 200；exit 1 = serve
  跑的是别处的代码或页面不可用；exit 3 = 没有登记在册且存活的 serve（预览未起）。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:30:56.420Z
statusLog:
  - at: 2026-10-08T02:30:56.420Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08 授权立项并进入 GOAL-030（goal 分支首个真实试点）；承接任务已立并停放（needs-human），激活本
      AC 不会触发乱序自动立案
  - at: 2026-10-08T03:11:33.809Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-08T02:30:56.419Z
phase: pre-merge
---
