---
id: AC-291
title: /live 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  root=$(git rev-parse --show-toplevel)

  ROUTE="/live"

  LABEL_EN="Live"


  # ── address derivation (the ONE step this amendment re-anchors)
  ──────────────────────────────

  # WHY IT CHANGED (2026-09-23, gap-ac291-criterion-cmdline-port-literal-stale):
  the launcher default

  # for the web port is now 0 = kernel-assigned ephemeral
  (plugin/scripts/start-drivers.ts:20-28,

  # "临时端口下真实端口只在载体里可知"; changed by ce0f47518,
  gap-serve-same-root-admission-lock), so a

  # live instance is a `quay.ts serve` process whose port flag carries that 0
  (measured 2026-09-23:

  # pid 1449431, cwd = the repo root). This criterion's old step grepped the
  process's own cmdline for

  # the host/port flag PAIR -- which was then the only place the port was
  knowable -- so it derived the

  # structurally unfetchable "<host>:0" and died with CAUSE=en-fetch-failed
  against a server that was

  # up the whole time. The ledger pins the CARRIER as the thing that moved, not
  the criterion's

  # subject: item_id=AC-291, the SAME criterionHash 848bfb6418f2a892, goal-sweep
  pass at

  # 2026-09-23T05:08:40.467Z and fail at 08:36:03.044Z; the goal-cli runs from
  08:43:41.902Z read

  # CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/live (later 127.0.0.1:0,
  after the bind host

  # changed). Nothing about the /live assertions below changed.

  # The real listening port is knowable only from the live host's own carrier
  $root/.quay/server.json

  # (writer packages/quay/src/serve.ts; read contract
  packages/quay/src/server-state.ts, which already

  # owns the shape + the three-way read outcome this step mirrors as distinct
  causes).

  # ⛔ No host/port literal is written down here -- the value is re-derived on
  every run, so a restart

  # (which binds a different ephemeral port) cannot stale it again. The carrier
  is used ONLY to derive

  # an address; the verdict stays the external HTTP GET below (hard rule 4b --
  never judge a live

  # surface by a reading that surface produced about itself). Both deployment
  shapes stay supported: an

  # explicit non-zero port on the cmdline is still used as-is, and a
  kernel-assigned (or absent) one

  # falls through to the carrier. Every candidate is reported with its own pid +
  address + cause and

  # none can wipe a derived address -- including the gate's OWN `sh -c` runner,
  whose cwd is $root and

  # whose cmdline contains this very text, so it matches pgrep too. That runner
  is why `nserve` counts

  # only candidates whose argv carries the `serve` subcommand as its own
  element: without it, the

  # no-instance refusal below would be unreachable (the runner would always look
  like a candidate) and

  # "there is no serve here" would wear the same shape as "there is one and I
  could not reach it".

  ncand=0


  nserve=0


  nderived=0


  addr=""


  report=""


  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ -d /proc/$p ] || continue
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    ncand=$((ncand + 1))
    if tr '\0' '\n' < /proc/$p/cmdline 2>/dev/null | grep -qx -- 'serve'; then nserve=$((nserve + 1)); fi
    a=""
    cause=""
    lit=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    case "$lit" in *:0) lit="" ;; esac
    if [ -n "$lit" ]; then
    a="$lit"
    else
    a=$(node -e 'const fs=require("fs");const R=process.argv[1],P=String(process.argv[2]);let s=null;try{s=JSON.parse(fs.readFileSync(R+"/.quay/server.json","utf8"))}catch(e){process.exit(2)}if(!s||s.schemaVersion!==1||!Array.isArray(s.services))process.exit(2);if(String(s.pid)!==P)process.exit(3);const w=s.services.filter(function(x){return x&&x.name==="web"})[0];if(!w)process.exit(4);if(w.up===false)process.exit(5);if(typeof w.host!=="string"||w.host===""||typeof w.port!=="number"||!(w.port>0))process.exit(6);process.stdout.write(w.host+":"+w.port)' "$root" "$p" 2>/dev/null)
    rc=$?
    if [ "$rc" != 0 ]; then a=""; case "$rc" in 2) cause="carrier-unreadable" ;; 3) cause="carrier-pid-mismatch" ;; 4) cause="carrier-no-web-entry" ;; 5) cause="carrier-web-marked-down" ;; 6) cause="carrier-web-address-unusable" ;; *) cause="carrier-read-failed(exit=$rc)" ;; esac; fi
    fi
    case "$a" in 0.0.0.0:*) a="127.0.0.1:${a#0.0.0.0:}" ;; ::*) a="127.0.0.1:${a#::}" ;; esac
    if [ -n "$a" ]; then nderived=$((nderived + 1)); fi
    if [ -z "$a" ]; then report="$report; pid=$p addr=<none> cause=${cause:-not-derivable}"; continue; fi
    if [ -n "$addr" ]; then report="$report; pid=$p addr=$a cause=not-probed -- an earlier candidate already answered"; continue; fi
    curl -sf --max-time 10 -o /dev/null "http://$a$ROUTE" 2>/dev/null
    crc=$?
    if [ "$crc" = 0 ]; then addr="$a"; report="$report; pid=$p addr=$a cause=fetch-answered"; continue; fi
    case "$crc" in 6) cc="host-unresolvable" ;; 7) cc="connection-refused" ;; 22) cc="http-error" ;; 28) cc="timeout" ;; *) cc="curl-exit-$crc" ;; esac
    why=$(curl -sfS --max-time 10 -o /dev/null "http://$a$ROUTE" 2>&1 | tr '\n' ' ')
    report="$report; pid=$p addr=$a cause=fetch-failed($cc) -- ${why:-curl exited $crc with no message}"
  done


  printf 'AC-291 candidate readings (cwd=%s, nserve=%s, ncand=%s,
  nderived=%s):%s\n' "$root" "$nserve" "$ncand" "$nderived" "$report" >&2


  if [ -z "$addr" ] && [ "$nserve" = 0 ]; then echo
  "CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=$root;
  $ROUTE cannot be evaluated on a live surface (AC-179 probe pattern)" >&2; exit
  1; fi


  if [ -z "$addr" ] && [ "$nderived" = 0 ]; then printf
  'CAUSE=no-derivable-serve-address -- %s quay.ts serve candidate(s) with
  cwd=%s, none yielded a derivable address; per-candidate readings:%s\n'
  "$nserve" "$root" "$report" >&2; exit 1; fi


  if [ -z "$addr" ]; then printf 'CAUSE=no-reachable-serve-address -- %s
  derivable address(es) among %s candidate(s) for cwd=%s, none answered $ROUTE
  (connection refused / timed out / non-2xx); per-candidate readings:%s\n'
  "$nderived" "$nserve" "$root" "$report" >&2; exit 1; fi

  en=$(curl -sf --max-time 10 "http://$addr$ROUTE" 2>/dev/null)

  if [ -z "$en" ]; then echo "CAUSE=en-fetch-failed -- GET http://$addr$ROUTE
  returned nothing (addr=$addr)" >&2; exit 1; fi

  zh=$(curl -sf --max-time 10 -H 'Cookie: lang=zh' "http://$addr$ROUTE"
  2>/dev/null)

  if [ -z "$zh" ]; then echo "CAUSE=zh-fetch-failed -- GET http://$addr$ROUTE
  with Cookie: lang=zh returned nothing (addr=$addr)" >&2; exit 1; fi

  nav_en=$(printf '%s' "$en" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  nav_zh=$(printf '%s' "$zh" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  if [ -z "$nav_en" ]; then echo "CAUSE=no-nav-region -- default-locale $ROUTE
  exposes no <nav>...</nav> region to assert on" >&2; exit 1; fi

  if [ -z "$nav_zh" ]; then echo "CAUSE=no-nav-region-zh -- $ROUTE under Cookie:
  lang=zh exposes no <nav>...</nav> region" >&2; exit 1; fi

  case "$nav_en" in *"$LABEL_EN"*) ;; *) echo "CAUSE=english-baseline-missing --
  the default-locale nav region of $ROUTE does not contain \"$LABEL_EN\"; this
  probe's baseline assumption is stale, re-derive it against the live page" >&2;
  exit 1 ;; esac

  title_of() { printf '%s' "$1" | tr '\n' ' ' | grep -oE '<title>[^<]*</title>'
  | head -1 | sed -e 's|^<title>||' -e 's|</title>$||'; }

  t_en=$(title_of "$en")

  if [ -z "$t_en" ]; then echo "CAUSE=no-title-tag -- default-locale $ROUTE has
  no <title> to compare against" >&2; exit 1; fi

  case "$zh" in *'<html lang="zh"'*) ;; *) echo "CAUSE=html-lang-not-zh --
  $ROUTE with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=$addr)"
  >&2; exit 1 ;; esac

  case "$nav_zh" in *"$LABEL_EN"*) echo "CAUSE=nav-label-untranslated -- the nav
  region of $ROUTE under Cookie: lang=zh still renders the literal English nav
  label \"$LABEL_EN\"; the nav is not wired to the zh dictionary" >&2; exit 1 ;;
  esac

  t_zh=$(title_of "$zh")

  if [ -z "$t_zh" ]; then echo "CAUSE=no-title-tag-zh -- $ROUTE under Cookie:
  lang=zh has no <title> to compare against" >&2; exit 1; fi

  if [ "$t_zh" = "$t_en" ]; then echo "CAUSE=title-unchanged -- $ROUTE own
  <title> is byte-identical under the zh cookie (\"$t_en\"); only the shared nav
  bar changed, so this page's own chrome was never wired to the locale switch"
  >&2; exit 1; fi

  echo "OK -- $ROUTE: default nav region carries \"$LABEL_EN\" and
  <title>=\"$t_en\"; under Cookie: lang=zh the response is <html lang=zh>, that
  English nav label is gone from the nav region, and this page's own <title>
  became \"$t_zh\""

  exit 0
expect: "criterion exits 0 once the default-locale NAV REGION of /live carries
  the literal nav label \"Live\", and under Cookie: lang=zh the response is
  <html lang=\"zh\">, that literal is absent from the nav region, and this
  page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES 页面之一（/live，nav
  标签 "Live"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep 源码只证明能产出，不证明已产出）。判据走 AC-179
  既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔ 不自己启服务），并在【chrome 作用域】上断言：导航标签只对
  `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔ 不对整段响应体做子串匹配 —— 2026-09-17 实测两处非
  chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含 "Board"（`...and the Board NEW badge.
  */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含 "Dashboard"/"Tasks"
  的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T15:56:00.897Z
statusLog:
  - at: 2026-09-17T15:56:00.898Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」；判据已按人裁定改为 AC-179 探针形态（探已在运行的 serve
      实例），激活动作对应该指示。
  - at: 2026-09-17T23:46:08.586Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T15:56:00.890Z
---
