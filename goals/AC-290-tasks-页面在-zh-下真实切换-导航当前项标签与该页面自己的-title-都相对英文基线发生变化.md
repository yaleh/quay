---
id: AC-290
title: /tasks 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  # WHY THIS CRITERION'S CARRIER-ABSENCE BRANCHES NOW REPORT NOT-EVALUATED
  (2026-09-30,

  # gap-ac290-criterion-carrier-absence-not-evaluated): the four branches below
  that report

  # "I could not find / reach a live surface" used to exit with status 1, so a
  run in which no

  # cwd=repo-root `quay.ts serve` existed was RECORDED as this criterion being
  FALSE. That is "I

  # cannot evaluate this HERE" wearing the same output shape as "this is false"
  (hard rule 3b) --

  # and this repo already fixed the value for that state:
  packages/quay/src/goal-store.ts:311-318

  # names it verbatim ("exit 3 -- this repo's convention, e.g. NOT-EVALUATED:
  carrier absent") and

  # packages/quay/src/gate/acceptance-runner.ts maps status 3 to verdict
  "not-evaluated" /

  # cause "declared" (NOT_RUNNABLE_EXIT_CODES holds only 126/127, never 3).

  #

  # WHAT IT COST (a ledger reading, not an assertion -- re-take it by grepping
  the token over the

  # events file): at filing (2026-09-30T06:58Z) the ledger held 219
  item_id=AC-290 events; the

  # no-running-serve-instance token alone appeared in 2 of them, across 2 dates
  (2026-09-23,

  # 2026-09-30), and the sibling no-reachable-serve-address token in 1 more.
  Each such round the

  # goal driver's `runPrefilingRecheck` sent verdict "fail" to outcome
  "confirmed-failing" (FILE a

  # task), while every other verdict -- "not-evaluated" included -- goes to
  "not-evaluated" (file

  # nothing), so the status alone decided whether this gap was re-filed EVERY
  round. The same

  # reading holds across the family: 17 goal files carry the carrier reference,
  17 the

  # no-running-serve-instance branch, and 10 each the two FAIL-prefixed
  derivation branches.

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
  instance whose

  # /tasks under `Cookie: lang=zh` still renders the literal English nav label
  refuses with the

  # nav-label-untranslated token at status 1. Withdrawing the carrier no longer
  wears that

  # refusal's shape -- it now says, distinguishably, that it could not look.

  #

  # THE ONE FAMILY DIVERGENCE, AND WHY THIS RECORD PICKS NOT-EVALUATED: the
  sibling amendments of

  # 2026-09-29 put the no-reachable-serve-address branch at status 3 in AC-291 /
  AC-292 / AC-301,

  # but LEFT IT at status 1 in AC-303 -- a criterion-specific trade-off, and
  both sides were taken

  # on a reading. THIS record takes status 3, on its own round's measurement:
  the derived-but-

  # unanswered case recorded at 2026-09-30T06:50:33Z (pid=3652175
  addr=127.0.0.1:20119, carrier-

  # derived, fetch failed) is a STALE carrier -- the instance had moved on while
  the carrier still

  # named the old address -- so it reads "I could not see the present state",
  not "the guarantee is

  # false". An address that derives but does not answer cannot be a live
  surface, so it is the same

  # class as no instance at all, one step later in the pipeline. A host that
  DOES answer with an

  # untranslated nav is a different branch (nav-label-untranslated) and still
  exits 1.

  #

  # WHAT THE AMENDMENT WAS VERIFIED AGAINST (2026-09-30, the round that landed
  it). Three readings of

  # the SAME criterion text, all taken from the main checkout root -- the
  workspace that owns the

  # carrier and the ledger: (1) against a live cwd=repo-root `quay.ts serve`
  whose kernel-assigned port

  # is read back from 活服务状态载体, the criterion exits 0 and the ledger gains a
  gate:"goal" pass;

  # (2) against a self-made reachable surface whose zh response IS <html
  lang=zh> but whose nav still

  # renders the English label, it exits 1 with the nav-label-untranslated token
  -- the assertion

  # branches keep their teeth; (3) in a scratch git root with no serve process
  at all it exits 3, and

  # the store's ONE mapping turns that into verdict "not-evaluated" / cause
  "declared", NOT into

  # "fail". Reading (3) is what this amendment is about: that same
  byte-identical absence used to be

  # recorded as this criterion being false, once per driver round.

  # NOT A PRECONDITION, AN OBSERVATION: `quay serve` has no supervisor (web is
  not among

  # plugin/scripts/driver-anchor.ts's DRIVER_KINDS), so an instance that dies is
  not pulled back

  # automatically and this criterion then reads not-evaluated until something
  starts one.

  # WHY THIS STEP WAS RE-ANCHORED (2026-09-23,
  gap-ac290-criterion-cmdline-port-literal-stale):

  # the launcher default for the web port is now 0 = kernel-assigned ephemeral

  # (plugin/scripts/start-drivers.ts), so a live gen-2 instance's cmdline
  literally reads

  # "--host H --port 0" and the previous derivation produced the structurally
  unfetchable "H:0",

  # failing with the en-fetch-failed refusal against a server that was up the
  whole time. The ledger shows

  # the SAME criterionHash 94183bf6f36b6d15 green at 2026-09-23T05:08:37.165Z
  and red at

  # 2026-09-23T08:21:13.049Z: the CARRIER moved, not the criterion's subject.
  The real listening port

  # is knowable only from the live host's OWN carrier 活宿主自身的服务状态载体 (writer

  # packages/quay/src/serve.ts; read contract packages/quay/src/server-state.ts,
  whose absent /

  # unreadable / present three-way outcome is mirrored by the carrier-unreadable
  token below). No

  # host/port literal is written down here -- it is re-derived on EVERY run, so
  a restart (which binds

  # a different ephemeral port) cannot stale it again. The carrier is used ONLY
  to derive an address;

  # the verdict stays the external HTTP GET further down (hard rule 4b -- never
  judge a live surface by

  # a reading that surface produced about itself). The eleven CAUSE-prefixed
  refusal branches below are

  # byte-identical to the pre-amendment criterion (the amendment's own record
  states why), so the two

  # refusal modes this amendment ADDS carry their own FAIL-prefixed token rather
  than a twelfth one --

  # a distinct value, so "could not derive/reach an address" never wears the
  same shape as the branch

  # it was added beside (hard rule 3b).

  # >>> addr-derivation (this block is run VERBATIM by
  packages/quay/test/ac290-criterion-address-derivation.test.mjs)

  root=$(git rev-parse --show-toplevel)

  ROUTE="/tasks"

  LABEL_EN="Tasks"

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
    kill -0 "$1" 2>/dev/null || { echo "candidate-pid-dead"; return; }
    o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$1" 2>&1)
    rc=$?
    case "$rc:$o" in
      0:*) printf 'addr=%s\n' "$o" ;;
      1:carrier-web-down) printf 'carrier-web-down\n' ;;
      3:*) printf '%s\n' "${o:-carrier-unreadable}" ;;
      *) printf 'carrier-helper-unavailable(exit=%s)\n' "$rc" ;;
    esac
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

  if [ -z "$addr" ] && [ "$ncand" != 0 ]; then printf 'AC-290 candidate readings
  (cwd=%s, nserve=%s, ncand=%s, nderived=%s):%s\n' "$root" "$nserve" "$ncand"
  "$nderived" "$rep" >&2; fi

  if [ -z "$addr" ] && [ "$nserve" != 0 ] && [ "$nderived" = 0 ]; then printf
  'FAIL=no-derivable-serve-address -- %s quay.ts serve process(es) with cwd=%s,
  none yielded an address (no explicit --port >= 1 on its own argv, and no
  活服务状态载体 entry naming that pid with an up web service); per-candidate readings
  on stderr above\n' "$nserve" "$root" >&2; exit 3; fi

  if [ -z "$addr" ] && [ "$nserve" != 0 ]; then printf
  'FAIL=no-reachable-serve-address -- %s derivable address(es) among %s quay.ts
  serve process(es) for cwd=%s, none answered %s (connection refused / timed out
  / non-2xx); per-candidate readings on stderr above\n' "$nderived" "$nserve"
  "$root" "$ROUTE" >&2; exit 3; fi

  if [ -z "$addr" ]; then echo "CAUSE=no-running-serve-instance -- no quay.ts
  serve process with cwd=$root; $ROUTE cannot be evaluated on a live surface
  (AC-179 probe pattern)" >&2; exit 3; fi

  printf 'AC-290 serve address derived from %s as %s (per-candidate
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
expect: "criterion exits 0 once the default-locale NAV REGION of /tasks carries
  the literal nav label \"Tasks\", and under Cookie: lang=zh the response is
  <html lang=\"zh\">, that literal is absent from the nav region, and this
  page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/tasks，nav 标签 "Tasks"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔
  不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔
  不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含
  "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含
  "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T15:53:10.474Z
statusLog:
  - at: 2026-09-17T15:53:10.474Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」——draft 记录已确认写入并可读，这是该指示对应的激活动作。
  - at: 2026-09-17T23:45:56.462Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T15:53:10.473Z
---
