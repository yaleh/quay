---
id: AC-292
title: /board 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  # WHY THIS CRITERION'S CARRIER-ABSENCE BRANCHES NOW REPORT NOT-EVALUATED
  (2026-09-29,

  # gap-ac292-criterion-carrier-absence-not-evaluated): the four branches below
  that report

  # "I could not find / reach a live surface" used to exit with status 1, so a
  run in which no

  # cwd=repo-root `quay.ts serve` existed was RECORDED as this criterion being
  FALSE. That is "I

  # cannot evaluate this HERE" wearing the same output shape as "this is false"
  (hard rule 3b) --

  # and this repo already fixed the value for that state:
  packages/quay/src/goal-store.ts:305-318

  # names it verbatim ("exit 3 -- this repo's convention, e.g. NOT-EVALUATED:
  carrier absent") and

  # packages/quay/src/gate/acceptance-runner.ts:97-114 maps status 3 to verdict
  "not-evaluated" /

  # cause "declared" (NOT_RUNNABLE_EXIT_CODES holds only 126/127, never 3).

  #

  # WHAT IT COST (a ledger reading, not an assertion -- re-take it by grepping
  the token over the

  # events file): at filing (2026-09-29T01:53Z) 18 events carried the token,
  across 2 dates

  # (2026-09-23 x16, 2026-09-29 x2) and 9 distinct ACs (AC-288 .. AC-296).
  Re-read at 2026-09-29T02:10:58Z it was

  # 24 events across 2 dates (2026-09-23 x16, 2026-09-29 x8) and 10 distinct ACs
  (AC-288 .. AC-301)

  # -- it accrued for as long as the carrier stayed absent. The goal driver's
  `runPrefilingRecheck`

  # sends verdict "fail" to outcome "confirmed-failing" (FILE a task) and every
  other verdict --

  # "not-evaluated" included -- to "not-evaluated" (file nothing), so the status
  alone decided

  # whether this gap was re-filed EVERY round. This amendment's own task is that
  difference.

  #

  # WHAT IS NOT CHANGED, DELIBERATELY: `expect`, the post-derivation assertion
  branches, and all

  # eleven refusal branches below are byte-identical to the previous revision.
  Exactly FOUR

  # carrier-absence branches moved into the not-evaluated status: the
  workspace-root-unresolvable

  # branch, the no-derivable-serve-address branch, the
  no-reachable-serve-address branch, and the

  # no-running-serve-instance branch. The criterion can still be FALSE: a live
  instance whose /board

  # under `Cookie: lang=zh` still renders the literal English nav label refuses
  with the

  # nav-label-untranslated token at status 1. Withdrawing the carrier no longer
  wears that refusal's

  # shape -- it now says, distinguishably, that it could not look.

  #

  # NOT A PRECONDITION, AN OBSERVATION: `quay serve` has no supervisor (web is
  not among

  # plugin/scripts/driver-anchor.ts's DRIVER_KINDS), so an instance that dies is
  not pulled back

  # automatically and this criterion then reads not-evaluated until something
  starts one.

  # WHY THIS STEP WAS RE-ANCHORED (2026-09-23,
  gap-ac292-criterion-cmdline-port-literal-stale):

  # the launcher default for the web port is now 0 = kernel-assigned ephemeral

  # (plugin/scripts/start-drivers.ts), so a live gen-2 instance's cmdline
  literally reads

  # "--host H --port 0" and the previous derivation produced the structurally
  unfetchable "H:0",

  # failing with the en-fetch-failed refusal against a server that was up the
  whole time. The ledger shows

  # the SAME criterionHash 3709e687ffb0f9e2 green at 2026-09-23T05:08:40.614Z
  (goal-sweep) and red at

  # 2026-09-23T08:36:03.135Z (no-running-serve-instance, the instance having
  been restarted onto the

  # launcher default): the CARRIER moved, not the criterion's subject. The real
  listening port

  # is knowable only from the live host's OWN carrier $root/.quay/server.json
  (reader

  # packages/quay/src/server-state.ts, whose absent / unreadable / present
  three-way outcome is mirrored

  # by the carrier-unreadable token below). No host/port literal is written down
  here -- it is re-derived

  # on EVERY run, so a restart (which binds a different ephemeral port) cannot
  stale it again. The carrier

  # is used ONLY to derive an address; the verdict stays the external HTTP GET
  further down (hard rule 4b

  # -- never judge a live surface by a reading that surface produced about
  itself). The eleven

  # CAUSE-prefixed refusal branches below are byte-identical to the
  pre-amendment criterion, so the two

  # refusal modes this amendment ADDS carry their own FAIL-prefixed token rather
  than a twelfth one -- a

  # distinct value, so "could not derive/reach an address" never wears the same
  shape as the branch it was

  # added beside (hard rule 3b).

  # >>> addr-derivation (this block is run VERBATIM by
  packages/quay/test/ac292-criterion-address-derivation.test.mjs)

  root=$(git rev-parse --show-toplevel)

  ROUTE="/board"

  LABEL_EN="Board"

  if [ -z "$root" ]; then printf 'FAIL=workspace-root-unresolvable -- git
  rev-parse --show-toplevel in cwd=%s produced nothing, so no candidate can be
  attributed to a workspace and every unreadable /proc/<pid>/cwd would compare
  equal to the empty root\n' "$(pwd)" >&2; exit 3; fi

  cands=""

  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ -d "/proc/$p" ] || continue
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    cands="$cands $p"
  done

  argv_addr() { tr '\0' '\n' < "/proc/$1/cmdline" 2>/dev/null | awk
  '{arg[NR]=$0} END{s=0; for(i=1;i<=NR;i++) if(arg[i]=="serve"){s=i; break};
  if(s==0){print "argv-no-serve-subcommand"; exit}; h=""; q="";
  for(i=s+1;i<=NR;i++){ if(arg[i]=="--host"&&i<NR) h=arg[i+1]; else
  if(arg[i]=="--port"&&i<NR) q=arg[i+1]; else if(arg[i]~/^--host=/)
  h=substr(arg[i],8); else if(arg[i]~/^--port=/) q=substr(arg[i],8)};
  if(q==""){print "argv-port-absent"; exit}; if(q+0<1){print
  "argv-port-kernel-assigned"; exit}; if(h==""){print "argv-host-absent"; exit};
  print "addr="h":"(q+0)}'; }

  carrier_addr() {
    f="$root/.quay/server.json"
    [ -f "$f" ] || { echo "carrier-absent"; return; }
    kill -0 "$1" 2>/dev/null || { echo "candidate-pid-dead"; return; }
    if command -v node >/dev/null 2>&1; then
      o=$(node -e '(()=>{const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){return console.log("carrier-unreadable")};if(!j||j.schemaVersion!==1||!Array.isArray(j.services))return console.log("carrier-unreadable");if(String(j.pid)!==process.argv[2])return console.log("carrier-pid-mismatch");const w=j.services.filter(x=>x&&x.name==="web");if(!w.length)return console.log("carrier-no-web-service");if(w[0].up!==true)return console.log("carrier-web-down");const h=w[0].host,p=w[0].port;if(typeof h!=="string"||h===""||typeof p!=="number"||!(p>0))return console.log("carrier-web-address-unusable");console.log("addr="+h+":"+p)})()' "$f" "$1" 2>/dev/null)
    elif command -v python3 >/dev/null 2>&1; then
      o=$(python3 -c 'import json,sys
  try: j=json.load(open(sys.argv[1]))

  except Exception: print("carrier-unreadable"); sys.exit()

  if j.get("schemaVersion")!=1 or not isinstance(j.get("services"),list):
  print("carrier-unreadable"); sys.exit()

  if str(j.get("pid"))!=sys.argv[2]: print("carrier-pid-mismatch"); sys.exit()

  w=[x for x in j.get("services") if isinstance(x,dict) and
  x.get("name")=="web"]

  if not w: print("carrier-no-web-service"); sys.exit()

  if w[0].get("up") is not True: print("carrier-web-down"); sys.exit()

  h=w[0].get("host"); p=w[0].get("port")

  if not isinstance(h,str) or not h or not isinstance(p,int) or p<1:
  print("carrier-web-address-unusable"); sys.exit()

  print("addr=%s:%d"%(h,p))' "$f" "$1" 2>/dev/null)
    else
      o="carrier-no-json-tool"
    fi
    rc=$?
    if [ -z "$o" ]; then if [ "$rc" != 0 ]; then o="carrier-unreadable-rc$rc"; else o="carrier-unreadable"; fi; fi
    echo "$o"
  }

  addr=""

  src=""

  rep=""

  ncand=0

  nderived=0

  nserve=0

  for p in $cands; do
    ncand=$((ncand + 1))
    a=""
    c=""
    s=""
    isserve=0
    ra=$(argv_addr "$p")
    case "$ra" in addr=*) a="${ra#addr=}"; s="argv"; isserve=1 ;; argv-no-serve-subcommand) c="$ra" ;; *) c="$ra"; isserve=1 ;; esac
    if [ -z "$a" ]; then rb=$(carrier_addr "$p"); case "$rb" in addr=*) a="${rb#addr=}"; s="carrier"; isserve=1 ;; *) c="${c:+$c,}$rb" ;; esac; fi
    case "$a" in 0.0.0.0:*) a="127.0.0.1:${a#0.0.0.0:}" ;; "::"*) a="127.0.0.1:${a#::}" ;; esac
    if [ "$isserve" = 1 ]; then nserve=$((nserve + 1)); fi
    if [ -z "$a" ]; then rep="$rep; pid=$p addr=- cause=${c:-address-not-derivable}"; continue; fi
    nderived=$((nderived + 1))
    if [ -n "$addr" ]; then rep="$rep; pid=$p addr=$a cause=derived-from-$s-not-probed (an earlier candidate already answered $ROUTE)"; continue; fi
    curl -sf --max-time 10 -o /dev/null "http://$a$ROUTE" 2>/dev/null
    crc=$?
    if [ "$crc" = 0 ]; then addr="$a"; src="$s"; rep="$rep; pid=$p addr=$a cause=derived-from-$s-fetch-answered"; continue; fi
    case "$crc" in 6) cc="host-unresolvable" ;; 7) cc="connection-refused" ;; 22) cc="http-error" ;; 28) cc="timeout" ;; *) cc="curl-exit-$crc" ;; esac
    why=$(curl -sfS --max-time 10 -o /dev/null "http://$a$ROUTE" 2>&1 | tr '\n' ' ')
    rep="$rep; pid=$p addr=$a cause=derived-from-$s-fetch-failed($cc) -- ${why:-curl exited $crc with no message}"
  done

  if [ -z "$addr" ] && [ "$ncand" != 0 ]; then printf 'AC-292 candidate readings
  (cwd=%s, nserve=%s, ncand=%s, nderived=%s):%s\n' "$root" "$nserve" "$ncand"
  "$nderived" "$rep" >&2; fi

  if [ -z "$addr" ] && [ "$nserve" != 0 ] && [ "$nderived" = 0 ]; then printf
  'FAIL=no-derivable-serve-address -- %s quay.ts serve process(es) with cwd=%s,
  none yielded an address (no explicit --port >= 1 on its own argv, and no
  .quay/server.json entry naming that pid with an up web service); per-candidate
  readings on stderr above\n' "$nserve" "$root" >&2; exit 3; fi

  if [ -z "$addr" ] && [ "$nserve" != 0 ]; then printf
  'FAIL=no-reachable-serve-address -- %s derivable address(es) among %s quay.ts
  serve process(es) for cwd=%s, none answered %s (connection refused / timed out
  / non-2xx); per-candidate readings on stderr above\n' "$nderived" "$nserve"
  "$root" "$ROUTE" >&2; exit 3; fi

  if [ -z "$addr" ]; then echo "CAUSE=no-running-serve-instance -- no quay.ts
  serve process with cwd=$root; $ROUTE cannot be evaluated on a live surface
  (AC-179 probe pattern)" >&2; exit 3; fi

  printf 'AC-292 serve address derived from %s as %s (per-candidate
  readings:%s)\n' "$src" "$addr" "$rep"

  # <<< addr-derivation

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
expect: "criterion exits 0 once the default-locale NAV REGION of /board carries
  the literal nav label \"Board\", and under Cookie: lang=zh the response is
  <html lang=\"zh\">, that literal is absent from the nav region, and this
  page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/board，nav 标签 "Board"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔
  不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔
  不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含
  "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含
  "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T15:58:53.361Z
statusLog:
  - at: 2026-09-17T15:58:53.362Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」；判据已按人裁定改为 AC-179 探针形态（探已在运行的 serve
      实例），激活动作对应该指示。
  - at: 2026-09-17T23:47:16.099Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T15:58:53.345Z
---
